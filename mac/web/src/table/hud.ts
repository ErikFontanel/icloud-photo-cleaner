import { useSyncExternalStore } from "react";
import type { Layout } from "@/components/view-nav";
import type { EditState, Pending } from "@/lib/api";
import type { Box } from "@/lib/motion";

// What the table engine shows around the canvas. The engine writes it (hud.set), React reads it (useHud).
export type Selection = { g: number; uuids: string[]; pileUuids: string[]; name: string; label: string; events: number };
export type HudState = {
  loading: string | null;
  status: string;
  deleteCount: number;
  // Quick look: `from` is the photo's place on the table when it opens; `closing` with `to` while it shrinks back.
  ql: { src: string; caption: string; aspect: number; at: number; i: number; from?: Box; closing?: boolean; to?: Box | null } | null;
  layout: Layout;
  erasing: boolean;
  hideAlbums: boolean;
  help: boolean;
  pending: Pending;
  lastApply: boolean;
  st: EditState | null;
  selection: Selection | null;
};

export function createHud() {
  let state: HudState = {
    loading: "Loading…",
    status: "",
    deleteCount: 0,
    ql: null,
    layout: "events",
    erasing: false,
    hideAlbums: false,
    help: false,
    pending: {},
    lastApply: false,
    st: null,
    selection: null,
  };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(part: Partial<HudState>) {
      state = { ...state, ...part };
      for (const l of listeners) l();
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    // Focus a HUD field (T, A, L, R) once React has drawn it.
    focus(id: string) {
      requestAnimationFrame(() => {
        const f = document.getElementById(id) as HTMLInputElement | null;
        f?.focus();
        f?.select();
      });
    },
  };
}
export type Hud = ReturnType<typeof createHud>;
export const useHud = (hud: Hud) => useSyncExternalStore(hud.subscribe, hud.get);
