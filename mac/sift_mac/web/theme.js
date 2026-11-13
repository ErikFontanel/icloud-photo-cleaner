// Light or dark ground, chosen per viewer and remembered; the system setting decides until a choice is made.
// Loaded in <head> so the page never flashes the wrong ground. Any [data-theme-toggle] button switches it.
(() => {
  const KEY = "sift-theme",
    root = document.documentElement;
  const system = () => (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  let chosen = null;
  try {
    chosen = localStorage.getItem(KEY);
  } catch {
    /* private window: follow the system */
  }
  const current = () => chosen || system();
  function apply() {
    if (chosen) root.dataset.theme = chosen;
    else delete root.dataset.theme;
    document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
      b.textContent = current() === "dark" ? "Light ground" : "Dark ground";
    });
    dispatchEvent(new Event("themechange"));
  }
  addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-theme-toggle]").forEach(
      (b) =>
        (b.onclick = () => {
          chosen = current() === "dark" ? "light" : "dark";
          try {
            localStorage.setItem(KEY, chosen);
          } catch {
            /* not remembered, still applied */
          }
          apply();
        }),
    );
    apply();
  });
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", apply);
  if (chosen) root.dataset.theme = chosen;
})();
