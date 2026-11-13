// Runs before paint so the page never flashes the wrong ground: a stored choice (sift-theme), else the system setting.
(() => {
  let chosen = null;
  try {
    chosen = localStorage.getItem("sift-theme");
  } catch {
    /* private window: follow the system */
  }
  const light = chosen ? chosen === "light" : matchMedia("(prefers-color-scheme: light)").matches;
  document.documentElement.classList.toggle("dark", !light);
})();
