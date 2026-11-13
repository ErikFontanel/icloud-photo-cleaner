import { HeartIcon } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { Card, CardContent } from "@/components/ui/card";
import { useEvents } from "@/grid/events/context";
import { Title, When } from "@/grid/events/event-header";
import type { Pile } from "@/grid/events/model";
import { Strip, Thumb } from "@/grid/events/strip";
import { cn } from "@/lib/utils";

// Best-of: like Photos, a click opens the photo large (← → through the event); the heart on hover makes it a favourite.
export function BestRow({ p }: { p: Pile }) {
  const { st, shown, edit, open } = useEvents();
  const us = shown(p),
    fav = new Set(p.favorite),
    mine = new Set(st.fav_edits),
    sug = new Set(p.best);
  const n = us.filter((u) => fav.has(u) || mine.has(u)).length;
  return (
    <Card className="py-3">
      <CardContent className="grid gap-3.5 px-3 md:grid-cols-[150px_minmax(0,1fr)_280px]">
        <When p={p} n={us.length} extra={n ? ` · ${n} ♥` : ""} />
        <div className="min-w-0">
          <Title p={p} />
          <Strip>
            {us.map((u) => {
              const on = fav.has(u) || mine.has(u);
              const tip = fav.has(u) ? "A favourite in Photos already" : mine.has(u) ? "Becomes a favourite on Apply. Click to undo" : "Favourite";
              return (
                <div
                  key={u}
                  data-ph={u}
                  className={cn(
                    "group relative rounded leading-none",
                    mine.has(u) && "outline-3 outline-event",
                    !on && sug.has(u) && "outline-2 outline-dashed outline-event",
                  )}
                >
                  <button type="button" title="Click to open" className="cursor-zoom-in rounded" onClick={() => open({ key: p.key, list: us, pile: false, u })}>
                    <Thumb u={u} />
                  </button>
                  <ActionButton
                    variant="ghost"
                    size="icon-sm"
                    title={tip}
                    aria-label={tip}
                    aria-pressed={on}
                    disabled={fav.has(u)}
                    className={cn(
                      "absolute bottom-1 left-1 text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-100 hover:bg-transparent hover:text-white focus-visible:opacity-100 disabled:opacity-100",
                      on && "opacity-100",
                    )}
                    action={() => edit("/api/table/favorite", { uuids: [u], on: !mine.has(u) }, [p.key])}
                  >
                    <HeartIcon className={cn("size-5", fav.has(u) && "fill-white", mine.has(u) && "fill-event stroke-event")} />
                  </ActionButton>
                </div>
              );
            })}
          </Strip>
        </div>
        <div className="grid content-start gap-2 self-start md:sticky md:top-20">
          {sug.size ? (
            <ActionButton size="sm" action={() => edit("/api/table/favorite", { uuids: p.best }, [p.key])}>
              Favourite the {sug.size} suggested
            </ActionButton>
          ) : (
            <p className="text-xs text-muted-foreground">Enough favourites for its size.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Dashed: suggested by aesthetics score. Click the heart on a photo to make it a favourite, or again to undo. 3 per event, plus 1 per 50 photos, up to
            8.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
