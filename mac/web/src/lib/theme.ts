import { useSyncExternalStore } from "react";

// Light or dark ground, chosen per viewer and remembered; the system setting decides until a choice is made.
const KEY = "sift-theme";
const system = matchMedia("(prefers-color-scheme: light)");
let chosen: string | null = null;
try {
  chosen = localStorage.getItem(KEY);
} catch {
  /* private window: follow the system */
}
const listeners = new Set<() => void>();
const current = (): "light" | "dark" => (chosen === "light" || chosen === "dark" ? chosen : system.matches ? "light" : "dark");
function apply() {
  document.documentElement.classList.toggle("dark", current() === "dark");
  for (const l of listeners) l();
  dispatchEvent(new Event("themechange")); // the table redraws its ground
}
system.addEventListener("change", apply);

export function toggleTheme() {
  chosen = current() === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(KEY, chosen);
  } catch {
    /* not remembered, still applied */
  }
  apply();
}
export function useTheme() {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), current);
}
