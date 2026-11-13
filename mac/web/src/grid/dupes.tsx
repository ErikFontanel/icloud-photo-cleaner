import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ActionButton } from "@/components/action-button";
import { ApplyBar } from "@/components/apply-bar";
import { FilterGroup } from "@/components/filter-group";
import { PhotoTile } from "@/components/photo-tile";
import { RescanButton } from "@/components/rescan-button";
import { RunsList } from "@/components/runs-list";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import type { StepProps } from "@/grid/app";
import { StepLayout } from "@/grid/step-layout";
import { type ApplyResult, api, type Run } from "@/lib/api";
import { appliedText, minute } from "@/lib/format";

// Duplicates step. Review: duplicate sets in two tiers; click photos to keep or drop them; nothing is written until
// Apply. Label: answer S (duplicate), D (keep both), J (both junk), Backspace (undo) for a sample of pairs.
const PAGE = 100;
type Tier = "near" | "possible";
type DupeSet = { best: string; uuids: string[]; date: string };
type Sets = Record<Tier, DupeSet[]> & { pending: number; album: string; runs: Run[] };
type LabelState = { pair: { a: string; b: string } | null; done: number; total: number };
const TIER: Record<Tier, string> = { near: "Near-identical", possible: "Possible duplicates" };

export function Dupes(props: StepProps) {
  const [mode, setMode] = useState<"review" | "label">("review");
  const [data, setData] = useState<Sets | null>(null);
  const load = useCallback(async () => setData(await api<Sets>("/api/dupes/sets")), []);
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [load]);
  return (
    <StepLayout
      {...props}
      apply={
        data && (
          <ApplyBar
            summary={data.pending ? `${data.pending.toLocaleString()} duplicates marked for To Delete, not written to Photos yet.` : "Nothing to apply yet."}
            question={`Add ${data.pending.toLocaleString()} photos to “${data.album}” in the library Photos has open?`}
            canApply={data.pending > 0}
            onApply={async () => {
              const r = await api<ApplyResult>("/api/apply", { step: "dupes" });
              await load();
              toast.success(appliedText(r, data.album));
            }}
          />
        )
      }
    >
      <FilterGroup
        label="Mode"
        value={mode}
        onChange={setMode}
        items={[
          { value: "review", label: "Review sets" },
          { value: "label", label: "Label pairs" },
        ]}
      />
      {mode === "review" ? data && <Review data={data} load={load} /> : <Label />}
    </StepLayout>
  );
}

function Review({ data, load }: { data: Sets; load: () => Promise<void> }) {
  const [tier, setTier] = useState<Tier>("near"),
    [keep, setKeep] = useState(new Map<string, Set<string>>());
  const kept = (s: DupeSet) => keep.get(s.best) ?? new Set(tier === "near" ? [s.best] : s.uuids);
  const sets: DupeSet[] = [];
  let n = 0;
  for (const s of data[tier]) {
    if (sets.length && n + s.uuids.length > PAGE) break;
    sets.push(s);
    n += s.uuids.length;
  }
  const drop = sets.reduce((c, s) => c + s.uuids.length - kept(s).size, 0);
  const decide = async () => {
    const accept: string[] = [],
      reject: string[] = [];
    for (const s of sets) for (const u of s.uuids) (kept(s).has(u) ? reject : accept).push(u);
    await api("/api/decide", { step: "dupes", group: tier, accept, reject });
    await load();
    setKeep(new Map());
    scrollTo(0, 0);
  };
  const mark = (
    <ActionButton size="sm" action={decide}>
      Mark {drop} for To Delete, keep {n - drop}
    </ActionButton>
  );
  return (
    <>
      <div className="mt-2">
        <FilterGroup
          label="Tiers"
          value={tier}
          onChange={(t) => {
            setTier(t);
            setKeep(new Map());
          }}
          items={(["near", "possible"] as const).map((t) => ({ value: t, label: TIER[t], count: data[t].length }))}
        />
      </div>
      {sets.length ? (
        <div className="my-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {sets.length} sets on this page.{" "}
            {tier === "near"
              ? "The best shot of each set is kept; click any other photo to keep it too."
              : "Everything is kept by default; click the photos that should go."}
          </span>
          {mark}
        </div>
      ) : (
        <Empty className="my-6 border">
          <EmptyHeader>
            <EmptyTitle>No sets left in this tier</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <RescanButton done={(t) => load().then(() => toast.success(t))} />
          </EmptyContent>
        </Empty>
      )}
      <div className="flex flex-wrap gap-2">
        {sets.flatMap((s) => [
          <div key={`h${s.best}`} className="basis-full border-t pt-1 text-xs text-muted-foreground">
            {minute(s.date)} · {s.uuids.length} photos
          </div>,
          ...s.uuids.map((u) => {
            const k = kept(s).has(u),
              best = u === s.best;
            return (
              <PhotoTile
                key={u}
                uuid={u}
                kept={k}
                badge={k ? (best ? "best · keep" : "keep") : "to delete"}
                title={best ? "Suggested best shot" : undefined}
                onToggle={() => {
                  const next = new Set(kept(s));
                  k ? next.delete(u) : next.add(u);
                  setKeep(new Map(keep).set(s.best, next));
                }}
              />
            );
          }),
        ])}
      </div>
      {sets.length > 0 && <div className="mt-3">{mark}</div>}
      <RunsList
        runs={data.runs.map((r) => ({ ...r, step: "duplicates" }))}
        album={data.album}
        onUndo={async (run) => {
          const r = await api<{ removed: number }>("/api/undo", { run });
          await load();
          toast.success(`Run ${run} undone: removed ${r.removed} photos from the album.`);
        }}
      />
    </>
  );
}

function Label() {
  const [state, setState] = useState<LabelState | null>(null);
  const busy = useRef(false); // one labelling request at a time: a fast double key press cannot label twice or out of order
  const label = useCallback(async (path: string, body?: object) => {
    if (busy.current) return;
    busy.current = true;
    try {
      setState(await api<LabelState>(path, body));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      busy.current = false;
    }
  }, []);
  useEffect(() => {
    label("/api/dupes/label");
  }, [label]);
  const pair = state?.pair;
  const answer = (same: number) => pair && label("/api/dupes/label", { a: pair.a, b: pair.b, same });
  const junkBoth = () => pair && label("/api/dupes/junk", { a: pair.a, b: pair.b });
  const back = () => label("/api/dupes/unlabel", {});
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || (e.target as HTMLElement).closest?.("input, textarea, [role=dialog], [role=alertdialog]")) return;
      if (e.key === "s") answer(1);
      else if (e.key === "d") answer(0);
      else if (e.key === "j") junkBoth();
      else if (e.key === "Backspace") {
        e.preventDefault();
        back();
      }
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  });
  if (!state) return null;
  return (
    <div className="mt-3 grid gap-3">
      <p className="text-xs text-muted-foreground">
        {pair
          ? `Pair ${state.done + 1} of ${state.total}. Would you keep only one of these two? Duplicate means a near-copy, burst frame or retake where the best one is enough. Same event alone is not a duplicate.`
          : `All ${state.total} pairs labelled.`}
      </p>
      {pair && (
        <div className="flex flex-wrap gap-3">
          {[pair.a, pair.b].map((u) => (
            <figure key={u} className="m-0 flex h-[62vh] min-w-0 flex-[1_1_360px] items-center justify-center overflow-hidden rounded-md bg-tile">
              <img src={`/preview/${u}`} alt="" className="block max-h-full max-w-full object-contain" />
            </figure>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {pair && (
          <>
            <Button size="sm" onClick={() => answer(1)}>
              Duplicate, keep one <Kbd>S</Kbd>
            </Button>
            <Button size="sm" onClick={() => answer(0)}>
              Keep both <Kbd>D</Kbd>
            </Button>
            <Button variant="outline" size="sm" onClick={junkBoth}>
              Both are junk <Kbd>J</Kbd>
            </Button>
          </>
        )}
        {state.done > 0 && (
          <Button variant="outline" size="sm" onClick={back}>
            Undo last <Kbd>⌫</Kbd>
          </Button>
        )}
      </div>
    </div>
  );
}
