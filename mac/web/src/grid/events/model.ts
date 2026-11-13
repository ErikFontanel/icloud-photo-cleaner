import type { EditState, Spot } from "@/lib/api";
import { plural } from "@/lib/format";

// An event pile, the same piles as the table (/api/events/piles).
export type Pile = {
  key: string;
  kind: string; // "undated" when the date can't be trusted
  start: number;
  end: number;
  name?: string; // yours: becomes an album
  label?: string; // suggested
  kept?: boolean;
  uuids: string[];
  spots: Spot[];
  best: string[]; // suggested favourites
  favorite: string[];
};
export type EventsState = EditState & { piles: Pile[] };

const day = (t: number, year?: boolean) =>
  new Date(t * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });
export const when = (p: Pile) =>
  p.kind === "undated" ? "No reliable date" : day(p.start, true) === day(p.end, true) ? day(p.start, true) : `${day(p.start)}–${day(p.end, true)}`;
export const named = (p: Pile) => !!(p.name || (p.label && p.kind !== "undated"));
export const byTime = (a: Pile, b: Pile) => Number(a.kind === "undated") - Number(b.kind === "undated") || a.start - b.start;
export const titleOf = (p: Pile) => p.name || p.label || when(p);

// Merge joins the event shown above or below, plus the events the filter hides between them (same stretch of time).
export type Neighbour = { target: Pile; between: Pile[] };
export function neighbour(p: Pile, timeline: Pile[], visible: Pile[], dir: number): Neighbour | null {
  const v = visible[visible.indexOf(p) + dir];
  if (!v) return null;
  const [a, b] = [timeline.indexOf(p), timeline.indexOf(v)].sort((x, y) => x - y);
  return { target: v, between: timeline.slice(a + 1, b).filter((x) => x !== v && x !== p) };
}
export const mergeTip = (m: Neighbour) =>
  `Join ${m.target.name || m.target.label || "the event"} (${when(m.target)})` +
  (m.between.length
    ? ` and ${plural(m.between.length, "smaller event")} between them that this filter hides (${plural(
        m.between.reduce((n, x) => n + x.uuids.length, 0),
        "photo",
      )})`
    : "");
