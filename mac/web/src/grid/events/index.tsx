import { EyeOffIcon, Undo2Icon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ActionButton } from "@/components/action-button";
import { ApplyBar } from "@/components/apply-bar";
import { FilterGroup } from "@/components/filter-group";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import type { StepProps } from "@/grid/app";
import { BestRow } from "@/grid/events/best-row";
import { Ctx, type EventsApi, type Focus } from "@/grid/events/context";
import { EventRow } from "@/grid/events/event-row";
import { byTime, type EventsState, named, type Pile, titleOf } from "@/grid/events/model";
import { PhotoDialog } from "@/grid/events/photo-dialog";
import { StepLayout } from "@/grid/step-layout";
import { api } from "@/lib/api";
import { pendingParts, plural } from "@/lib/format";
import { flip } from "@/lib/motion";

// Grid steps Events (with places) and Best-of: the table's event piles as a list. Same data and endpoints as the table
// (/api/table/*), so a name, merge, place, tag or album made here shows there and the other way round.
const PAGE = 40;
const DEFAULT_FILTER = { events: "noplace", best: "named" };
const rectOf = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
type Mode = "events" | "best";
type Filter = [key: string, label: string, test: (p: Pile) => boolean];

export function Events(props: StepProps) {
  const mode: Mode = props.step === "best" ? "best" : "events";
  const [st, setSt] = useState<EventsState | null>(null),
    // The filter and page live in the address too (?filter=named&page=5#events), so a reload comes back to them.
    [filter, setFilter] = useState<string>(() => new URLSearchParams(location.search).get("filter") || DEFAULT_FILTER[mode]),
    [page, setPage] = useState(() => Math.max(0, (Number(new URLSearchParams(location.search).get("page")) || 1) - 1)),
    [hide, setHide] = useState(() => {
      try {
        return localStorage.getItem("sift-hide-albums") === "1";
      } catch {
        return false;
      }
    }),
    [picked, setPicked] = useState(new Set<string>()),
    [focus, setFocus] = useState<Focus | null>(null);
  const lastPick = useRef<string | null>(null),
    flips = useRef(new Map<string, DOMRect | undefined>()), // selector -> where it was, animated after the next render
    loads = useRef(0); // only the newest reload is shown: an older one finishing late would show the list before your edit

  const load = useCallback(async () => {
    const mine = ++loads.current;
    const r = await api<EventsState>("/api/events/piles");
    if (mine === loads.current) setSt(r);
  }, []);
  // After an edit: fetch only the events it touched and swap those; every other event stays as it is.
  const update = useCallback(async (keys: string[]) => {
    const mine = ++loads.current,
      want = new Set(keys);
    const r = await api<EventsState>("/api/events/piles", { keys });
    if (mine !== loads.current) return;
    setSt((s) => {
      if (!s) return r;
      const before = s.piles.filter((p) => want.has(p.key)).flatMap((p) => p.uuids);
      const next = {
        ...s,
        piles: s.piles
          .filter((p) => !want.has(p.key))
          .concat(r.piles)
          .sort(byTime),
      };
      for (const m of ["tags", "albums", "album_adds", "album_removes"] as const) {
        next[m] = { ...s[m] };
        for (const u of before) delete next[m][u];
        Object.assign(next[m], r[m]);
      }
      for (const k of ["names", "kept", "fav_edits", "undo", "pending", "tag_index", "album_index"] as const) Object.assign(next, { [k]: r[k] });
      return next;
    });
  }, []);
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [load]);
  useLayoutEffect(() => {
    for (const [sel, from] of flips.current) flip(document.querySelector(sel), from);
    flips.current.clear();
  });

  const inAlbum = (u: string) => (st?.albums[u] || []).length > 0;
  const shown = (p: Pile) => (hide ? p.uuids.filter((u) => !inAlbum(u)) : p.uuids);
  const spotsOf = (p: Pile) => {
    const s = new Set(shown(p));
    return p.spots.map((g) => ({ ...g, uuids: g.uuids.filter((u) => s.has(u)) })).filter((g) => g.uuids.length);
  };
  const edit = async (path: string, body: object, keys: string[]) => {
    const r = await api(path, body);
    await update(keys);
    return r;
  };
  const undoLast = async () => {
    if (!st?.undo) return;
    const r = await api<{ undone: string }>("/api/table/undo-edit", {});
    await load();
    toast.success(`Undone: ${r.undone}.`);
  };
  // ⌘-click: onto the pile (it flies there), or off it (it flies back into the strip).
  const pick: EventsApi["pick"] = (us, on, from) => {
    const next = new Set(picked);
    for (const u of us) {
      const back = !on && rectOf(`[data-pile] img[data-u="${u}"]`);
      on ? next.add(u) : next.delete(u);
      if (on) flips.current.set(`[data-pile] img[data-u="${u}"]`, from?.get(u));
      else if (back) flips.current.set(`[data-ph="${u}"]`, back);
    }
    setPicked(next);
  };
  const ctx: EventsApi | null = st && {
    st,
    shown,
    edit,
    picked,
    pick,
    lastPick,
    open: ({ u, ...f }) => setFocus({ ...f, i: f.list.indexOf(u) }),
    undoLast,
    // Same as ⌫ on the table: junk marks, moved to "Sift – To Delete" on Apply. Undo restores just these photos.
    remove: async (p, us) => {
      await edit("/api/table/sync", { marked: us }, [p.key]);
      toast(`${plural(us.length, "photo")} of ${titleOf(p)} marked To Delete.`, {
        action: { label: "Undo", onClick: () => undoLast().catch((e) => toast.error(e.message)) },
      });
    },
  };

  // Esc clears the selection (the pile flies back into the strips), Space opens it, ⌘Z undoes the last edit.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (focus || (e.target as HTMLElement).closest?.("input, textarea, [role=dialog], [role=alertdialog]")) return;
      if (e.key === "Escape" && picked.size) {
        e.preventDefault();
        pick([...picked], false);
      } else if (e.key === " " && picked.size) {
        e.preventDefault(); // the selection pile nearest the middle of the screen
        const mid = innerHeight / 2;
        const pl = [...document.querySelectorAll<HTMLElement>("[data-pile]")].sort(
          (a, b) => Math.abs(a.getBoundingClientRect().top - mid) - Math.abs(b.getBoundingClientRect().top - mid),
        )[0];
        pl?.click();
      } else if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        undoLast().catch((err) => toast.error(err.message));
      }
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  });

  const filters: Filter[] =
    mode === "events"
      ? [
          ["noplace", "No location", (p) => !p.kept && spotsOf(p).some((g) => !g.set)],
          ["named", "Named & suggested", (p) => !p.kept && named(p)],
          ["unnamed", "Unnamed", (p) => !p.kept && !named(p)],
          ["place", "Place suggested", (p) => !p.kept && spotsOf(p).some((g) => g.city && !g.set)],
          ["kept", "Kept", (p) => !!p.kept],
          ["all", "All", (p) => !p.kept],
        ]
      : [
          ["named", "Named & suggested", named],
          ["all", "All", () => true],
        ];
  const current = filters.find(([k]) => k === filter) || filters[0];
  const pool = st ? st.piles.filter((p) => shown(p).length >= (mode === "best" ? 3 : 1)) : [];
  const list = pool.filter(current[2]),
    pages = Math.max(1, Math.ceil(list.length / PAGE)),
    at = Math.min(page, pages - 1);

  // Keep the address in step with the filter and page (once the events are in, so a reload doesn't lose the page).
  useEffect(() => {
    if (!st) return;
    const q = new URLSearchParams();
    if (current[0] !== DEFAULT_FILTER[mode]) q.set("filter", current[0]);
    if (at) q.set("page", String(at + 1));
    const url = `${location.pathname}${q.size ? `?${q}` : ""}${location.hash}`;
    if (url !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(null, "", url);
  }, [st, current[0], at, mode]);

  if (!st || !ctx)
    return (
      <StepLayout {...props} apply={null}>
        {null}
      </StepLayout>
    );

  const onPage = list.slice(at * PAGE, (at + 1) * PAGE);
  const timeline = st.piles.filter((p) => shown(p).length); // every event in time order, also the ones the filter hides
  const keys = onPage.map((p) => p.key);
  const suggested = onPage.flatMap((p) => spotsOf(p).filter((g) => g.city && !g.set));
  const favs = onPage.flatMap((p) => p.best);
  const parts = pendingParts(st.pending);

  const pager = (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={!at} onClick={() => (setPage(at - 1), scrollTo(0, 0))}>
        ← Earlier
      </Button>
      <span className="text-xs text-muted-foreground">
        {plural(list.length, "event")} · page {at + 1} of {pages}
      </span>
      <Button variant="outline" size="sm" disabled={at >= pages - 1} onClick={() => (setPage(at + 1), scrollTo(0, 0))}>
        Later →
      </Button>
    </div>
  );

  return (
    <Ctx.Provider value={ctx}>
      <StepLayout
        {...props}
        apply={
          <ApplyBar
            summary={parts.length ? `${parts.join(" · ")}, saved, not in Photos yet` : "Nothing to apply yet."}
            question={`Write ${parts.join(", ")} to the library Photos has open?`}
            canApply={parts.length > 0}
            onApply={async () => {
              const r = await api<{ result: Record<string, Record<string, number>> }>("/api/table/apply", {});
              await load();
              const t = r.result.table;
              const done = [
                ...Object.entries(r.result)
                  .filter(([k]) => k !== "table")
                  .map(([k, v]) => `${k}: ${v.added ?? 0} to To Delete`),
                t &&
                  [
                    t.added && `${t.added} into albums`,
                    t.renamed && `${t.renamed} renamed`,
                    t.keywords && `keywords on ${t.keywords}`,
                    t.locations && `${t.locations} pins`,
                    t.favorites && `${t.favorites} favourites`,
                    t.removed && `${t.removed} out of albums`,
                  ]
                    .filter(Boolean)
                    .join(", "),
              ].filter(Boolean);
              toast.success(`Written: ${done.join(" · ") || "nothing"}. Undo is under Applied runs on the table.`);
            }}
          >
            <ActionButton variant="outline" size="sm" disabled={!st.undo} title={st.undo ? `Undo: ${st.undo} (⌘Z)` : "Nothing to undo"} action={undoLast}>
              <Undo2Icon />
              Undo
            </ActionButton>
          </ApplyBar>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FilterGroup
            label="Which events"
            value={current[0]}
            onChange={(k) => (setFilter(k), setPage(0))}
            items={filters.map(([value, label, f]) => ({ value, label, count: pool.filter(f).length }))}
          />
          <Toggle
            variant="outline"
            size="sm"
            className="rounded-full px-3"
            pressed={hide}
            title="Hide photos already in one of your albums (H on the table)"
            onPressedChange={(v) => {
              setHide(v);
              try {
                localStorage.setItem("sift-hide-albums", v ? "1" : "0");
              } catch {
                /* not remembered */
              }
            }}
          >
            <EyeOffIcon />
            Hide in albums
          </Toggle>
          {mode === "events" && suggested.length > 0 && (
            <ActionButton
              variant="outline"
              size="sm"
              action={async () => {
                for (const g of suggested) await api("/api/table/place", { uuids: g.uuids, city: g.city, country: g.country });
                await update(keys);
              }}
            >
              Use all {plural(suggested.length, "suggested place")} on this page
            </ActionButton>
          )}
          {mode === "best" && favs.length > 0 && (
            <ActionButton variant="outline" size="sm" action={() => edit("/api/table/favorite", { uuids: favs }, keys)}>
              Favourite the {plural(favs.length, "suggestion")} on this page
            </ActionButton>
          )}
        </div>
        <div className="grid gap-3">
          {pager}
          {onPage.map((p) =>
            mode === "events" ? <EventRow key={p.key} p={p} spots={spotsOf(p)} timeline={timeline} visible={list} /> : <BestRow key={p.key} p={p} />,
          )}
          {pager}
        </div>
        <PhotoDialog focus={focus} setFocus={setFocus} spotsOf={spotsOf} />
      </StepLayout>
    </Ctx.Provider>
  );
}
