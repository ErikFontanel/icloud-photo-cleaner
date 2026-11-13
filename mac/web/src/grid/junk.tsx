import { CircleCheckIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ActionButton } from "@/components/action-button";
import { ApplyBar } from "@/components/apply-bar";
import { ConfirmButton } from "@/components/confirm-button";
import { FilterGroup } from "@/components/filter-group";
import { PhotoTile } from "@/components/photo-tile";
import { RescanButton } from "@/components/rescan-button";
import { RunsList } from "@/components/runs-list";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { StepProps } from "@/grid/app";
import { StepLayout } from "@/grid/step-layout";
import { type ApplyResult, api, type Run } from "@/lib/api";
import { appliedText } from "@/lib/format";

// Junk step: one page of up to 100 photos per group, worst first. Unclicked photos are marked junk; clicked ones are kept.
const PAGE = 100;
const ALL = "\u0000all"; // the "All" section filter; no section has this name
type Item = { uuid: string; date: string; score: number; blur: number; section: string; cluster: number; albums: string[] };
type Group = { key: string; label: string; items: Item[]; sections: { name: string; count: number }[] };
type Data = { groups: Group[]; pending: number; album: string; runs: Run[] };

// Consecutive photos of the same section and cluster form one "similar" run.
export function toRuns<T extends { cluster?: number; section?: string }>(items: T[]) {
  const runs: T[][] = [];
  items.forEach((it, n) => {
    const prev = items[n - 1];
    if (!prev || prev.cluster !== it.cluster || prev.section !== it.section) runs.push([]);
    runs[runs.length - 1].push(it);
  });
  return runs;
}
// Whole runs up to PAGE photos, so a page ends where a similar group ends. A run bigger than PAGE is split.
function firstPage(items: Item[]) {
  const page: Item[] = [];
  for (const run of toRuns(items)) {
    if (page.length && page.length + run.length > PAGE) break;
    page.push(...run.slice(0, PAGE - page.length));
    if (page.length >= PAGE) break;
  }
  return page;
}

export function Junk(props: StepProps) {
  const [data, setData] = useState<Data | null>(null),
    [group, setGroup] = useState<string | null>(null),
    [sect, setSect] = useState<string | null>(null),
    [keep, setKeep] = useState(new Set<string>());
  const load = useCallback(async () => {
    const d = await api<Data>("/api/junk");
    setGroup((k) => k ?? (d.groups.find((x) => x.items.length) || d.groups[0]).key);
    setData(d);
    setKeep(new Set());
    return d;
  }, []);
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [load]);
  if (!data)
    return (
      <StepLayout {...props} apply={null}>
        {null}
      </StepLayout>
    );

  const g = data.groups.find((x) => x.key === group) || data.groups.find((x) => x.items.length) || data.groups[0];
  const section = g.sections.some((s) => s.name === sect) ? sect : null;
  const items = section ? g.items.filter((i) => i.section === section) : g.items;
  const page = firstPage(items);
  const allKept = page.length > 0 && keep.size === page.length;
  const pick = (k: string | null, s: string | null) => {
    setGroup(k);
    setSect(s);
    setKeep(new Set());
  };
  const decide = async (list: Item[]) => {
    await api("/api/decide", {
      group: g.key,
      accept: list.filter((i) => !keep.has(i.uuid)).map((i) => i.uuid),
      reject: list.filter((i) => keep.has(i.uuid)).map((i) => i.uuid),
    });
    await load();
    scrollTo(0, 0);
  };
  const actions = page.length > 0 && (
    <div className="flex flex-wrap items-center gap-2">
      <ActionButton size="sm" action={() => decide(page)}>
        Mark {page.length - keep.size} as junk, keep {keep.size}
      </ActionButton>
      <Button variant="outline" size="sm" onClick={() => setKeep(allKept ? new Set() : new Set(page.map((i) => i.uuid)))}>
        {allKept ? "Junk all on this page" : "Keep all on this page"}
      </Button>
    </div>
  );
  const runs = toRuns(page);

  return (
    <StepLayout
      {...props}
      hint="Click a photo to keep it."
      apply={
        <ApplyBar
          summary={data.pending ? `${data.pending.toLocaleString()} photos marked as junk, not written to Photos yet.` : "Nothing to apply yet."}
          question={`Add ${data.pending.toLocaleString()} photos to “${data.album}” in the library Photos has open?`}
          canApply={data.pending > 0}
          onApply={async () => {
            const r = await api<ApplyResult>("/api/apply", {});
            await load();
            toast.success(appliedText(r, data.album));
          }}
        />
      }
    >
      <div className="grid gap-2">
        <FilterGroup
          label="Junk groups"
          value={g.key}
          onChange={(k) => pick(k, null)}
          items={data.groups.map((x) => ({ value: x.key, label: x.label, count: x.items.length }))}
        />
        {g.sections.length > 0 && (
          <FilterGroup
            label="Sections"
            value={section ?? ALL}
            onChange={(s) => pick(g.key, s === ALL ? null : s)}
            items={[{ value: ALL, label: "All", count: g.items.length }, ...g.sections.map((s) => ({ value: s.name, label: s.name, count: s.count }))]}
          />
        )}
      </div>
      {page.length ? (
        <div className="my-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Showing {page.length} of {items.length.toLocaleString()}, similar photos together.
          </span>
          {actions}
          {section && items.length > page.length && (
            <ConfirmButton
              variant="outline"
              size="sm"
              title={`Mark all of ${section} as junk?`}
              description={`Mark all ${(items.length - items.filter((i) => keep.has(i.uuid)).length).toLocaleString()} photos in ${section} as junk${keep.size ? ` and keep the ${keep.size} you clicked` : ""}? You have seen ${Math.min(PAGE, items.length)} of them. Nothing is written until you apply.`}
              confirm="Mark all"
              action={() => decide(items)}
            >
              Mark all {items.length.toLocaleString()} in {section} as junk…
            </ConfirmButton>
          )}
        </div>
      ) : (
        <Empty className="my-6 border">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="text-keep">
              <CircleCheckIcon />
            </EmptyMedia>
            <EmptyTitle>Every photo in this group is reviewed</EmptyTitle>
            <EmptyDescription>Build events and albums on the table: Pile or Events above.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <RescanButton done={(t) => load().then(() => toast.success(t))} />
          </EmptyContent>
        </Empty>
      )}
      <div className="flex flex-wrap gap-2">
        {runs.flatMap((run) => [
          runs.length > 1 && (
            <div key={`b${run[0].uuid}`} className="basis-full pt-4 text-xs font-medium text-muted-foreground first:pt-0">
              {run.length} similar
            </div>
          ),
          ...run.map((it) => {
            const kept = keep.has(it.uuid);
            return (
              <PhotoTile
                key={it.uuid}
                uuid={it.uuid}
                kept={kept}
                dim={kept}
                badge={kept ? "keep" : "junk"}
                albums={it.albums}
                title={`${it.date.slice(0, 10)} · score ${it.score.toFixed(2)} · sharpness ${it.blur.toFixed(2)}`}
                onToggle={() => {
                  const k = new Set(keep);
                  kept ? k.delete(it.uuid) : k.add(it.uuid);
                  setKeep(k);
                }}
              />
            );
          }),
        ])}
      </div>
      {page.length > 0 && <div className="mt-3">{actions}</div>}
      <RunsList
        runs={data.runs}
        album={data.album}
        onUndo={async (run) => {
          const r = await api<{ removed: number }>("/api/undo", { run });
          await load();
          toast.success(`Run ${run} undone: removed ${r.removed} photos from the album.`);
        }}
      />
    </StepLayout>
  );
}
