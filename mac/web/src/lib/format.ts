import type { ApplyResult, Pending, Spot } from "./api";

export const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;
export const minute = (iso: string) => iso.slice(0, 16).replace("T", " ");

// Where a place is, in words: coordinates near a city, a city, or nothing yet.
export const where = (g: Spot) =>
  !g.city ? "No location" : g.exact ? `${g.lat?.toFixed(5)}, ${g.lon?.toFixed(5)} near ${g.city}, ${g.country}` : `${g.city}, ${g.country}`;
// The same place as you would type it into a place field.
export const placeText = (g: Spot) => (!g.city ? "" : g.exact ? `${g.lat?.toFixed(5)}, ${g.lon?.toFixed(5)}` : `${g.city}, ${g.country}`);

// Saved changes not yet in Photos, as short parts ("3 to delete", "keywords on 4 photos").
export const pendingParts = (p: Pending) =>
  [
    p.delete && `${p.delete} to delete`,
    p.albums && `${p.album_photos} photos into ${plural(p.albums, "album")}`,
    p.renames && plural(p.renames, "album rename"),
    p.keywords && `keywords on ${plural(p.keywords, "photo")}`,
    p.locations && `pins on ${plural(p.locations, "photo")}`,
    p.favorites && plural(p.favorites, "favourite"),
    p.album_removals && `${plural(p.album_removals, "photo")} out of albums`,
  ].filter((x): x is string => !!x);

// How often each word occurs over these photos, most first.
export function counts(us: string[], of: Record<string, string[]>): [string, number][] {
  const c = new Map<string, number>();
  for (const u of us) for (const w of of[u] || []) c.set(w, (c.get(w) || 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1]);
}

// What one apply of a review step did, in a sentence.
export const appliedText = (r: ApplyResult, album: string) =>
  `Run ${r.run}: added ${r.added} photos to “${album}”${r.already ? `, ${r.already} were already there` : ""}${r.deleted ? `, ${r.deleted} skipped because they were deleted since the scan` : ""}${r.refused ? `, ${r.refused} refused by Photos` : ""}.`;
