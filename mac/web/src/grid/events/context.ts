import { createContext, useContext } from "react";
import type { EventsState, Pile } from "@/grid/events/model";

// What the rows of the Events and Best-of steps share: the saved state and the ways to change it.
export type Focus = { key: string; list: string[]; i: number; pile: boolean };
export type EventsApi = {
  st: EventsState;
  shown: (p: Pile) => string[]; // its photos, without the ones in your albums when those are hidden
  edit: (path: string, body: object, keys: string[]) => Promise<unknown>; // save, then fetch only the events it touched
  picked: Set<string>; // photos on the selection pile
  pick: (us: string[], on: boolean, from?: Map<string, DOMRect | undefined>) => void;
  lastPick: React.RefObject<string | null>;
  open: (f: Omit<Focus, "i"> & { u: string }) => void;
  remove: (p: Pile, us: string[]) => Promise<void>;
  undoLast: () => Promise<void>;
};
export const Ctx = createContext<EventsApi | null>(null);
export const useEvents = () => useContext(Ctx) as EventsApi;
