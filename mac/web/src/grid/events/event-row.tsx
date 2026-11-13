import { ArrowDownIcon, ArrowUpIcon, MapPinIcon } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/action-button";
import { EventName, PhotoMeta, placeSetter } from "@/components/meta/photo-meta";
import { SpotRow } from "@/components/meta/spot-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useEvents } from "@/grid/events/context";
import { Title, When } from "@/grid/events/event-header";
import { mergeTip, named, neighbour, type Pile, titleOf } from "@/grid/events/model";
import { Strip, Thumb } from "@/grid/events/strip";
import type { Spot } from "@/lib/api";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";

const ROT = [0, -5, 4, -8];

// One event: its photos grouped by place, the event's name, and place, tags and albums for all its photos or, with a
// selection, for the selected ones. Merge, Delete and Keep along the bottom.
export function EventRow({ p, spots, timeline, visible }: { p: Pile; spots: Spot[]; timeline: Pile[]; visible: Pile[] }) {
  const { st, shown, edit, picked, pick, lastPick, open, remove, undoLast } = useEvents();
  const us = shown(p),
    prev = neighbour(p, timeline, visible, -1),
    next = neighbour(p, timeline, visible, 1);
  const noLoc = new Set(spots.flatMap((g) => g.uuids)),
    gps = us.filter((u) => !noLoc.has(u));
  const order = [...spots.flatMap((g) => g.uuids), ...gps],
    sel = order.filter((u) => picked.has(u));
  const hidden = us.length < p.uuids.length ? ` (${p.uuids.length - us.length} in albums hidden)` : "";
  const keys = [p.key];

  // Click: the photo opens large (← → through the event). ⌘/Ctrl-click: onto the selection pile; ⇧-click: a range.
  // With a selection, a click adds or removes.
  const click = (u: string) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const from = e.currentTarget.getBoundingClientRect();
    if (e.shiftKey && lastPick.current && order.includes(lastPick.current)) {
      const [a, b] = [order.indexOf(lastPick.current), order.indexOf(u)].sort((x, y) => x - y);
      const add = order.slice(a, b + 1).filter((v) => !picked.has(v));
      pick(add, true, new Map(add.map((v) => [v, document.querySelector(`[data-ph="${v}"]`)?.getBoundingClientRect()])));
    } else if (e.metaKey || e.ctrlKey || picked.size) pick([u], !picked.has(u), new Map([[u, from]]));
    else return open({ key: p.key, list: order, pile: false, u });
    lastPick.current = u;
  };
  const photo = (u: string) => (
    <button
      key={u}
      type="button"
      data-ph={u}
      title={picked.size ? "Click to add to or remove from the selection" : "Click to open · ⌘-click to select · ⇧-click for a range"}
      onClick={click(u)}
      className={cn("relative cursor-zoom-in rounded p-0 leading-none outline-offset-[-3px]", picked.has(u) && "outline-3 outline-primary")}
    >
      <Thumb u={u} />
    </button>
  );
  const editHere = (path: string, body: object) => edit(path, body, keys);
  const meta = (uuids: string[], withEventAlbum: boolean, sp: Spot[], listSpots = true) => (
    <PhotoMeta uuids={uuids} st={st} eventName={p.name} withEventAlbum={withEventAlbum} spots={sp} listSpots={listSpots} edit={editHere} />
  );

  return (
    <Card className="gap-0 py-3">
      <CardContent className="grid gap-3.5 px-3 md:grid-cols-[150px_minmax(0,1fr)_280px]">
        <When p={p} n={us.length} extra={hidden} />
        <div className="min-w-0">
          <Title p={p} />
          {!spots.length ? (
            <Strip>{us.map(photo)}</Strip>
          ) : (
            <>
              {spots.map((g) => (
                <div key={`${g.city}|${g.uuids[0]}`} className="mt-2">
                  <SpotRow spot={g} onSet={placeSetter(editHere, spots)} />
                  <Strip className="mt-1">{g.uuids.map(photo)}</Strip>
                </div>
              ))}
              {gps.length > 0 && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPinIcon className="size-4" />
                    {plural(gps.length, "photo")} with GPS
                  </div>
                  <Strip className="mt-1">{gps.map(photo)}</Strip>
                </div>
              )}
            </>
          )}
        </div>
        <div className="grid content-start gap-4 self-start md:sticky md:top-20">
          <EventName name={p.name} label={named(p) ? p.label : undefined} onSave={(name) => edit("/api/table/name", { pile: p.key, name }, keys)} />
          {sel.length > 0 ? (
            <Card className="gap-3 border-primary py-3">
              <CardContent className="grid gap-3 px-3">
                <button
                  type="button"
                  data-pile={p.key}
                  title="Open the selected photos (Space; ← → to step)"
                  onClick={() => open({ key: p.key, list: sel, pile: true, u: sel[sel.length - 1] })}
                  className="grid h-36 cursor-zoom-in place-items-center"
                >
                  {sel.slice(-4).map((u, i, a) => (
                    <img
                      key={u}
                      data-u={u}
                      src={`/thumb/${u}?s=320`}
                      alt=""
                      style={{ rotate: `${ROT[a.length - 1 - i]}deg` }}
                      className="col-start-1 row-start-1 max-h-32 max-w-48 rounded border-3 border-card bg-tile shadow-lg"
                    />
                  ))}
                </button>
                <div className="text-center text-sm">
                  <b className="text-primary">{sel.length}</b> photo{sel.length === 1 ? "" : "s"} selected
                </div>
                {meta(
                  sel,
                  true,
                  spots.map((g) => ({ ...g, uuids: g.uuids.filter((u) => picked.has(u)) })).filter((g) => g.uuids.length),
                )}
                <div className="flex flex-wrap gap-2">
                  <ActionButton
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    action={async () => {
                      pick(sel, false);
                      await remove(p, sel);
                    }}
                  >
                    Delete {sel.length}
                  </ActionButton>
                  <Button variant="outline" size="sm" onClick={() => pick(sel, false)}>
                    Clear selection
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            meta(us, false, spots, false)
          )}
        </div>
      </CardContent>
      <Separator className="my-3" />
      <div className="flex flex-wrap items-center gap-2 px-3">
        <ActionButton variant="outline" size="sm" disabled={!prev} title={prev ? mergeTip(prev) : undefined} action={() => merge(p, prev)}>
          <ArrowUpIcon />
          Merge earlier
        </ActionButton>
        <ActionButton variant="outline" size="sm" disabled={!next} title={next ? mergeTip(next) : undefined} action={() => merge(p, next)}>
          <ArrowDownIcon />
          Merge later
        </ActionButton>
        <span className="flex-1" />
        <ActionButton
          variant="outline"
          size="sm"
          className="text-destructive"
          title="Mark these photos To Delete, like ⌫ on the table"
          action={() => remove(p, us)}
        >
          Delete {plural(us.length, "photo")}
        </ActionButton>
        {p.kept ? (
          <ActionButton variant="outline" size="sm" action={() => edit("/api/table/keep", { pile: p.key, on: false }, keys)}>
            Unkeep
          </ActionButton>
        ) : (
          <ActionButton
            variant="outline"
            size="sm"
            className="font-semibold text-keep"
            title="Done with this event: hide it from this list (Kept shows it again)"
            action={async () => {
              await edit("/api/table/keep", { pile: p.key }, keys);
              toast(`Kept ${titleOf(p)}.`, { action: { label: "Undo", onClick: () => undoLast().catch((e) => toast.error(e.message)) } });
            }}
          >
            Keep
          </ActionButton>
        )}
      </div>
    </Card>
  );

  // The same rule as M on the table: your name beats a suggestion beats none; then the bigger pile keeps its key.
  async function merge(a: Pile, m: ReturnType<typeof neighbour>) {
    if (!m) return;
    const b = m.target;
    const rank = (x: Pile) => (x.name ? 2 : named(x) ? 1 : 0);
    const [keep, move] = rank(a) > rank(b) || (rank(a) === rank(b) && a.uuids.length >= b.uuids.length) ? [a, b] : [b, a];
    await edit(
      "/api/table/sync",
      { piles: Object.fromEntries([move, ...m.between].flatMap((x) => x.uuids).map((u) => [u, keep.key])) },
      [keep, move, ...m.between].map((x) => x.key),
    );
  }
}
