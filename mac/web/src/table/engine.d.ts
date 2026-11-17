import type { Layout } from "@/components/view-nav";
import type { EditState, Pending } from "@/lib/api";
import type { Hud } from "@/table/hud";

export type Engine = {
  layout: (name: Layout) => void;
  fit: () => void;
  undo: () => void;
  eraser: () => void;
  hideAlbums: () => void;
  restoreTray: () => void;
  closeQL: () => void;
  viewEvent: () => void;
  apply: () => Promise<string>;
  undoApply: () => Promise<void>;
  takeState: (s: EditState) => void;
  pending: (p?: Pending) => void;
  setName: (name: string) => Promise<void>;
  say: (text: string) => void;
  api: <T = Record<string, unknown>>(path: string, body?: unknown) => Promise<T>;
};
export function startTable(hud: Hud): Engine | null;
