// The review server's JSON API. A body makes it a POST. An { error } answer (HTTP 4xx too) throws its message.
export async function api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j as T;
}

export type Pending = {
  delete?: number;
  albums?: number;
  album_photos?: number;
  renames?: number;
  keywords?: number;
  locations?: number;
  favorites?: number;
  album_removals?: number;
};

type ByPhoto = Record<string, string[]>;
// Saved edits, shared by the table and the Grid (GET /api/table/state; also returned by tag and album edits).
export type EditState = {
  marked: string[];
  gone: string[];
  pile_of: Record<string, string>;
  names: Record<string, string>;
  tags: ByPhoto;
  albums: ByPhoto;
  album_adds: ByPhoto;
  album_removes: ByPhoto;
  tag_index: string[];
  album_index: string[];
  kept: string[];
  undo: string | null;
  fav_edits: string[];
  pending: Pending;
};

// Photos without GPS that share a place: set by you, suggested (`from` says why) or unknown (city null).
export type Spot = {
  city: string | null;
  country: string;
  set: boolean;
  exact?: boolean;
  lat?: number;
  lon?: number;
  from?: string;
  uuids: string[];
};

export type ApplyResult = { run: number; added: number; already?: number; deleted?: number; refused?: number };
export type Run = { id: number; step?: string; created: string; undone: string | null; writes: number };
