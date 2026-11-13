import { EventTitle } from "@/components/event-title";
import type { Pile } from "@/grid/events/model";
import { when } from "@/grid/events/model";
import { plural } from "@/lib/format";

// The date column and the title: your name (an album), a suggestion, or nothing yet.
export function When({ p, n, extra }: { p: Pile; n: number; extra?: string }) {
  return (
    <div className="self-start md:sticky md:top-20">
      <div className="font-semibold">{when(p)}</div>
      <div className="text-xs text-muted-foreground">
        {plural(n, "photo")}
        {extra}
      </div>
    </div>
  );
}
export const Title = ({ p }: { p: Pile }) => <EventTitle name={p.name} label={p.label} />;
