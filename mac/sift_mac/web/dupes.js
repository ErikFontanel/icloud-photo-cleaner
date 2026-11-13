// Duplicates step. Labelling mode: answer S (duplicate), D (keep both), J (both junk), Backspace (undo) for a sample of pairs.
// Review mode: duplicate sets in two tiers. Click photos to keep or drop them; nothing is written until Apply.
(() => {
  const PAGE = 100;
  const $ = (id) => document.getElementById(id);
  let mode = "review",
    current = null,
    data = null,
    tier = "near",
    keep = new Map();

  function el(tag, attrs, text) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => (k === "onclick" ? (e.onclick = v) : e.setAttribute(k, v)));
    if (text !== undefined) e.textContent = text;
    return e;
  }

  async function call(path, body) {
    const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j;
  }

  function say(text, err) {
    $("dupesmsg").textContent = text;
    $("dupesmsg").className = err ? "msg err" : "msg";
  }

  // ---- labelling ----
  function showLabel(state) {
    current = state.pair;
    $("labelinfo").textContent = current
      ? `Pair ${state.done + 1} of ${state.total}. Would you keep only one of these two? Duplicate means a near-copy, burst frame or retake where the best one is enough. Same event alone is not a duplicate.`
      : `All ${state.total} pairs labelled.`;
    $("pair").replaceChildren(
      ...(current
        ? [current.a, current.b].map((u) => {
            const f = el("figure");
            f.append(el("img", { src: `/preview/${u}`, alt: "" }));
            return f;
          })
        : []),
    );
    $("labelactions").replaceChildren(
      ...(current
        ? [
            el("button", { class: "primary", onclick: () => answer(1) }, "Duplicate, keep one (S)"),
            el("button", { class: "primary", onclick: () => answer(0) }, "Keep both (D)"),
            el("button", { onclick: junkBoth }, "Both are junk (J)"),
          ]
        : []),
      ...(state.done ? [el("button", { onclick: back }, "Undo last (Backspace)")] : []),
    );
  }
  async function answer(same) {
    if (current) showLabel(await call("/api/dupes/label", { a: current.a, b: current.b, same }));
  }
  async function junkBoth() {
    if (current) showLabel(await call("/api/dupes/junk", { a: current.a, b: current.b }));
  }
  async function back() {
    showLabel(await call("/api/dupes/unlabel", {}));
  }

  // ---- review ----
  async function loadSets() {
    say("Finding duplicate sets…");
    data = await call("/api/dupes/sets");
    keep = new Map();
    renderSets();
  }

  function kept(set) {
    if (!keep.has(set.best)) keep.set(set.best, new Set(tier === "near" ? [set.best] : set.uuids));
    return keep.get(set.best);
  }

  function page() {
    const out = [];
    let n = 0;
    for (const s of data[tier]) {
      if (out.length && n + s.uuids.length > PAGE) break;
      out.push(s);
      n += s.uuids.length;
    }
    return out;
  }

  function renderSets() {
    const sets = page();
    const label = { near: "Near-identical", possible: "Possible duplicates" };
    $("tiertabs").replaceChildren(
      ...["near", "possible"].map((t) =>
        el(
          "button",
          {
            class: "chip",
            "aria-pressed": String(t === tier),
            onclick: () => {
              tier = t;
              keep = new Map();
              renderSets();
            },
          },
          `${label[t]} · ${data[t].length.toLocaleString()} sets`,
        ),
      ),
    );
    const drop = sets.reduce((n, s) => n + s.uuids.length - kept(s).size, 0);
    const photos = sets.reduce((n, s) => n + s.uuids.length, 0);
    const mark = () => el("button", { class: "primary", onclick: () => decide(sets) }, `Mark ${drop} for To Delete, keep ${photos - drop}`);
    const hint =
      tier === "near"
        ? "The best shot of each set is kept; click any other photo to keep it too."
        : "Everything is kept by default; click the photos that should go.";
    $("setinfo").replaceChildren(
      el("span", { class: "msg" }, sets.length ? `${sets.length} sets on this page. ${hint}` : "No sets left in this tier."),
      ...(sets.length ? [mark()] : [rescanButton((t) => loadSets().then(() => say(t)))]),
    );
    $("setinfo2").replaceChildren(...(sets.length ? [mark()] : []));
    $("setgrid").replaceChildren(
      ...sets.flatMap((s) => [
        el("div", { class: "break" }, `${s.date.slice(0, 16).replace("T", " ")} · ${s.uuids.length} photos`),
        ...s.uuids.map((u) => {
          const k = kept(s).has(u),
            best = u === s.best;
          const b = el("button", {
            class: `tile${k ? " best" : ""}`,
            "aria-pressed": String(k),
            title: best ? "Suggested best shot" : "",
            onclick: () => {
              k ? kept(s).delete(u) : kept(s).add(u);
              renderSets();
            },
          });
          b.append(
            el("img", { src: `/preview/${u}`, loading: "lazy", alt: "" }),
            el("span", { class: "badge" }, k ? (best ? "best · keep" : "keep") : "to delete"),
          );
          return b;
        }),
      ]),
    );
    $("duperuns").replaceChildren(...(data.runs.length ? data.runs.map(runItem) : [el("li", {}, "None yet.")]));
    renderApply();
  }

  function runItem(r) {
    const li = el("li", {}, `Run ${r.id} · duplicates · ${r.writes} added to album · ${r.created.slice(0, 16).replace("T", " ")} UTC `);
    if (r.undone) li.append(el("span", {}, `· undone ${r.undone.slice(0, 16).replace("T", " ")}`));
    else
      li.append(
        el("button", { onclick: () => confirmBox(`Remove the ${r.writes} photos of run ${r.id} from “${data.album}”?`, "Undo run", () => undo(r.id)) }, "Undo"),
      );
    return li;
  }

  function renderApply() {
    say(data.pending ? `${data.pending.toLocaleString()} duplicates marked for To Delete, not written to Photos yet.` : "No pending changes.");
    $("dupesapplybox").replaceChildren(
      el(
        "button",
        {
          class: "primary",
          ...(data.pending ? {} : { disabled: "" }),
          onclick: () => confirmBox(`Add ${data.pending.toLocaleString()} photos to “${data.album}” in the library Photos has open?`, "Apply", applyNow),
        },
        "Apply to Photos",
      ),
    );
  }

  function confirmBox(question, label, action) {
    say(question);
    $("dupesapplybox").replaceChildren(el("button", { class: "primary", onclick: action }, label), el("button", { onclick: renderApply }, "Cancel"));
  }

  async function decide(sets) {
    const accept = [],
      reject = [];
    sets.forEach((s) => s.uuids.forEach((u) => (kept(s).has(u) ? reject : accept).push(u)));
    try {
      await call("/api/decide", { step: "dupes", group: tier, accept, reject });
      await loadSets();
      window.scrollTo(0, 0);
    } catch (e) {
      say(e.message, true);
    }
  }

  async function applyNow() {
    say("Writing to Photos…");
    $("dupesapplybox").replaceChildren();
    try {
      const r = await call("/api/apply", { step: "dupes" });
      await loadSets();
      say(
        `Run ${r.run}: added ${r.added} photos to “${data.album}”${r.already ? `, ${r.already} were already there` : ""}${r.deleted ? `, ${r.deleted} skipped because they were deleted since the scan` : ""}${r.refused ? `, ${r.refused} refused by Photos` : ""}.`,
      );
    } catch (e) {
      renderApply();
      say(e.message, true);
    }
  }

  async function undo(run) {
    say(`Undoing run ${run}…`);
    try {
      const r = await call("/api/undo", { run });
      await loadSets();
      say(`Run ${run} undone: removed ${r.removed} photos from the album.`);
    } catch (e) {
      renderApply();
      say(e.message, true);
    }
  }

  // ---- navigation ----
  async function setMode(m) {
    mode = m;
    $("labelmode").hidden = m !== "label";
    $("reviewmode").hidden = m !== "review";
    $("modelabel").setAttribute("aria-pressed", String(m === "label"));
    $("modereview").setAttribute("aria-pressed", String(m === "review"));
    try {
      m === "label" ? showLabel(await call("/api/dupes/label")) : await loadSets();
    } catch (e) {
      say(e.message, true);
    }
  }

  function open() {
    $("junkview").hidden = true;
    $("junkapply").hidden = true;
    $("dupesview").hidden = false;
    $("dupesapply").hidden = false;
    $("nav-junk").setAttribute("aria-pressed", "false");
    $("nav-dupes").setAttribute("aria-pressed", "true");
    setMode(mode);
  }

  function close() {
    $("junkview").hidden = false;
    $("junkapply").hidden = false;
    $("dupesview").hidden = true;
    $("dupesapply").hidden = true;
    $("nav-junk").setAttribute("aria-pressed", "true");
    $("nav-dupes").setAttribute("aria-pressed", "false");
  }

  $("nav-dupes").onclick = open;
  $("nav-junk").onclick = close;
  $("modelabel").onclick = () => setMode("label");
  $("modereview").onclick = () => setMode("review");
  document.addEventListener("keydown", (e) => {
    if ($("dupesview").hidden || mode !== "label" || e.metaKey || e.ctrlKey) return;
    if (e.key === "s") answer(1);
    else if (e.key === "d") answer(0);
    else if (e.key === "j") junkBoth();
    else if (e.key === "Backspace") {
      e.preventDefault();
      back();
    }
  });
})();
