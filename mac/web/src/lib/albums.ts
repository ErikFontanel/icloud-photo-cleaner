import type { EditState } from "./api";

// The albums of one or more photos. kind: event (the event's own album, made on Apply or already in Photos), sift
// (another event album), own (your Photos album: Sift won't take photos out of it), add (added on Apply).
// n: photos in it; out: photos taken out of it on Apply.
export type AlbumKind = "event" | "sift" | "own" | "add";
export type Album = { title: string; kind: AlbumKind; n: number; out: number };

export function albumsOf(st: Pick<EditState, "names" | "albums" | "album_adds" | "album_removes">, us: string[], eventName?: string): Album[] {
  const events = new Set(Object.values(st.names)),
    m = new Map<string, Album>();
  const get = (title: string, kind: AlbumKind) => {
    if (!m.has(title)) m.set(title, { title, kind, n: 0, out: 0 });
    return m.get(title) as Album;
  };
  for (const u of us) {
    const out = st.album_removes[u] || [];
    if (eventName) get(eventName, "event")[out.includes(eventName) ? "out" : "n"]++;
    for (const a of st.albums[u] || []) if (a !== eventName) get(a, events.has(a) ? "sift" : "own")[out.includes(a) ? "out" : "n"]++;
    for (const a of st.album_adds[u] || []) if (a !== eventName) get(a, "add").n++;
  }
  return [...m.values()];
}

export const ALBUM_TIP: Record<AlbumKind, string> = {
  event: "The event's album",
  sift: "An event album in Photos",
  add: "Added on Apply",
  own: "Your own album in Photos: take photos out of it in Photos (Sift won't rebuild your albums)",
};
