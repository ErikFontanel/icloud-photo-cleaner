import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/action-button";
import { EventTitle } from "@/components/event-title";
import { PhotoMeta } from "@/components/meta/photo-meta";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { type Focus, useEvents } from "@/grid/events/context";
import { type Pile, when } from "@/grid/events/model";
import type { Spot } from "@/lib/api";
import { fade, fit, flip, flyBack, slideIn } from "@/lib/motion";

// A photo large, one at a time, with its own place, tags, albums and Delete: a photo from a strip (← → step through
// its event), or the selection pile (← → step through the pile). Esc or a click outside closes it. It flies out of its
// thumbnail (lifted out of the strip meanwhile) and back into it on close.
const thumbOf = (f: Focus, u: string) => document.querySelector<HTMLImageElement>(f.pile ? `[data-pile="${f.key}"] img:last-child` : `[data-ph="${u}"] img`);
export function PhotoDialog({ focus, setFocus, spotsOf }: { focus: Focus | null; setFocus: (f: Focus | null) => void; spotsOf: (p: Pile) => Spot[] }) {
  const { st, edit, picked, pick, remove } = useEvents();
  const p = focus && st.piles.find((x) => x.key === focus.key);
  const u = focus?.list[focus.i];
  const [hi, setHi] = useState<{ u: string; src: string; aspect: number } | null>(null),
    [shape, setShape] = useState<{ u: string; aspect: number } | null>(null); // from whichever copy is on screen once it loads
  useEffect(() => {
    setHi(null);
    if (!u) return;
    const img = new Image();
    img.onload = () => setHi({ u, src: img.src, aspect: img.naturalWidth / img.naturalHeight });
    img.src = `/thumb/${u}?s=2048`;
    return () => {
      img.onload = null; // a late load of the previous photo must not replace this one
    };
  }, [u]);
  const big = useRef<HTMLImageElement>(null),
    shown = useRef<{ u: string; i: number } | null>(null), // the photo on stage at the last render
    closing = useRef(false),
    openFrom = useRef<DOMRect | undefined>(undefined); // the dialog's content mounts a render later: its img starts the flight
  const takeOff = () => {
    if (!big.current || !openFrom.current) return;
    flip(big.current, openFrom.current);
    fade(document.querySelector("[data-slot=dialog-overlay]"), true);
    openFrom.current = undefined;
  };
  // Open: from the thumbnail. Step: slide in from that side. The thumbnail on stage is hidden in its strip.
  // biome-ignore lint/correctness/useExhaustiveDependencies: takeOff reads refs only
  useLayoutEffect(() => {
    if (!focus || !u) return;
    const was = shown.current;
    shown.current = { u, i: focus.i };
    if (!was) {
      openFrom.current = thumbOf(focus, u)?.getBoundingClientRect();
      takeOff();
    } else if (was.u !== u) slideIn(big.current, focus.i > was.i ? 1 : -1);
    const t = focus.pile ? null : thumbOf(focus, u)?.closest<HTMLElement>("[data-ph]");
    if (t) t.style.visibility = "hidden";
    return () => {
      if (t) t.style.visibility = "";
    };
  }, [focus, u]);
  if (!focus || !u) {
    shown.current = null;
    return <Dialog open={false} />;
  }
  const n = focus.list.length;
  const step = (d: number) => setFocus({ ...focus, i: (focus.i + d + n) % n });
  // Close: back onto its thumbnail, then the dialog goes.
  const close = async () => {
    if (closing.current) return;
    closing.current = true;
    const to = thumbOf(focus, u)?.getBoundingClientRect();
    fade(document.querySelector("[data-slot=dialog-overlay]"), false);
    big.current?.parentElement?.querySelector("aside")?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: "forwards" });
    await flyBack(big.current, to);
    closing.current = false;
    setFocus(null);
  };
  const thumb = thumbOf(focus, u),
    loaded = hi?.u === u ? hi : null,
    aspect = loaded?.aspect || (shape?.u === u && shape.aspect) || (thumb?.naturalWidth ? thumb.naturalWidth / thumb.naturalHeight : 4 / 3),
    side = matchMedia("(min-width: 768px)").matches, // md: the panel sits beside the photo (same breakpoint as md:flex-row)
    size = fit(aspect, side ? innerWidth - 32 - 320 - 24 : innerWidth - 32, innerHeight * (side ? 0.84 : 0.55));
  // After a change on the pile: drop u from the list, show the next one, or close when none is left.
  const drop = () => {
    const list = focus.list.filter((v) => v !== u);
    if (list.length) setFocus({ ...focus, list, i: Math.min(focus.i, list.length - 1) });
    else close();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent
        className="flex max-h-[calc(100vh-2rem)] w-max max-w-[calc(100vw-2rem)] animate-none! flex-col items-center gap-6 border-0 bg-transparent p-0 shadow-none sm:max-w-[calc(100vw-2rem)] md:flex-row"
        showCloseButton={false}
        onKeyDown={(e) => {
          if (n < 2 || (e.target as HTMLElement).closest("input, textarea")) return;
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            step(e.key === "ArrowRight" ? 1 : -1);
          }
        }}
      >
        <img
          ref={(node) => {
            big.current = node;
            takeOff();
          }}
          src={loaded?.src || `/thumb/${u}?s=320`}
          onLoad={(e) => setShape({ u, aspect: e.currentTarget.naturalWidth / e.currentTarget.naturalHeight })}
          alt=""
          style={size}
          className="block max-w-none shrink-0 rounded-xl bg-tile object-contain shadow-2xl" // sized by fit(), not by the dialog
        />
        <aside className="grid max-h-[84vh] w-[min(320px,calc(100vw-2rem))] shrink-0 content-start gap-3 overflow-auto rounded-xl border bg-card p-4">
          <div>
            <DialogTitle asChild>{p ? <EventTitle name={p.name} label={p.label} /> : <div>Photo</div>}</DialogTitle>
            <DialogDescription>{p && when(p)}</DialogDescription>
          </div>
          {n > 1 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Button variant="outline" size="icon-sm" aria-label="Previous photo" onClick={() => step(-1)}>
                <ChevronLeftIcon />
              </Button>
              <span>
                <b className="text-primary">{focus.i + 1}</b> of {n} {focus.pile ? "selected" : "in this event"}
              </span>
              <Button variant="outline" size="icon-sm" aria-label="Next photo" onClick={() => step(1)}>
                <ChevronRightIcon />
              </Button>
            </div>
          )}
          {p && (
            <PhotoMeta
              uuids={[u]}
              st={st}
              eventName={p.name}
              withEventAlbum
              spots={spotsOf(p)
                .map((g) => ({ ...g, uuids: g.uuids.filter((v) => v === u) }))
                .filter((g) => g.uuids.length)}
              edit={(path, body) => edit(path, body, [p.key])}
            />
          )}
          <div className="flex flex-wrap gap-2">
            {p && (
              <ActionButton
                variant="outline"
                size="sm"
                className="text-destructive"
                action={async () => {
                  if (picked.has(u)) pick([u], false);
                  drop(); // the next photo takes its place, as in Photos
                  await remove(p, [u]);
                }}
              >
                Delete photo
              </ActionButton>
            )}
            {focus.pile ? (
              <Button variant="outline" size="sm" onClick={() => (pick([u], false), drop())}>
                Remove from selection
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => (close(), pick([u], true))}>
                Add to selection
              </Button>
            )}
          </div>
        </aside>
      </DialogContent>
    </Dialog>
  );
}
