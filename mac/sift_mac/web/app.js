// Junk step: one page of up to 100 photos per group, worst first. Unclicked photos are marked junk; clicked ones are kept.
(() => {
  const PAGE = 100;
  const $ = (id) => document.getElementById(id);
  let data = null,
    group = null,
    sect = null,
    keep = new Set();

  async function api(path, body) {
    const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j;
  }

  function say(text, err) {
    $("msg").textContent = text;
    $("msg").className = err ? "msg err" : "msg";
  }

  async function load() {
    data = await api("/api/junk");
    if (!group || !data.groups.some((g) => g.key === group)) group = (data.groups.find((g) => g.items.length) || data.groups[0]).key;
    const g = data.groups.find((x) => x.key === group);
    if (sect && !g.sections.some((s) => s.name === sect)) sect = null;
    keep = new Set();
    render();
  }

  function el(tag, attrs, text) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => (k === "onclick" ? (e.onclick = v) : e.setAttribute(k, v)));
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function render() {
    const g = data.groups.find((x) => x.key === group);
    const items = sect ? g.items.filter((i) => i.section === sect) : g.items;
    const page = firstPage(items);
    $("tabs").replaceChildren(
      ...data.groups.map((x) =>
        el(
          "button",
          {
            class: "chip",
            "aria-pressed": String(x.key === group),
            onclick: () => {
              group = x.key;
              sect = null;
              keep = new Set();
              render();
            },
          },
          `${x.label} · ${x.items.length.toLocaleString()}`,
        ),
      ),
    );
    $("sections").replaceChildren(
      ...(g.sections.length
        ? [
            el(
              "button",
              {
                class: "chip",
                "aria-pressed": String(!sect),
                onclick: () => {
                  sect = null;
                  keep = new Set();
                  render();
                },
              },
              `All · ${g.items.length.toLocaleString()}`,
            ),
            ...g.sections.map((s) =>
              el(
                "button",
                {
                  class: "chip",
                  "aria-pressed": String(s.name === sect),
                  onclick: () => {
                    sect = s.name;
                    keep = new Set();
                    render();
                  },
                },
                `${s.name} · ${s.count.toLocaleString()}`,
              ),
            ),
          ]
        : []),
    );

    const junkCount = page.length - keep.size;
    const markButton = () => el("button", { class: "primary", onclick: () => decide(page) }, `Mark ${junkCount} as junk, keep ${keep.size}`);
    const allKept = page.length && keep.size === page.length;
    const toggleButton = () =>
      el(
        "button",
        {
          onclick: () => {
            keep = allKept ? new Set() : new Set(page.map((i) => i.uuid));
            render();
          },
        },
        allKept ? "Junk all on this page" : "Keep all on this page",
      );
    const sectionButton = () => el("button", { onclick: () => confirmSection(items) }, `Mark all ${items.length.toLocaleString()} in ${sect} as junk…`);
    $("pageinfo").replaceChildren(
      el(
        "span",
        { class: "msg" },
        page.length
          ? `Showing ${page.length} of ${items.length.toLocaleString()}, similar photos together.`
          : "Every photo in this group is reviewed. Build events and albums on the table: Pile or Events above.",
      ),
      ...(page.length ? [markButton(), toggleButton()] : [rescanButton((t) => load().then(() => say(t)))]),
      ...(sect && items.length > page.length ? [sectionButton()] : []),
    );
    $("pageinfo2").replaceChildren(...(page.length ? [markButton(), toggleButton()] : []));

    const runs = toRuns(page);
    $("grid").replaceChildren(...runs.flatMap((run) => [el("div", { class: "break" }, runs.length > 1 ? `${run.length} similar` : ""), ...run.map(tile)]));
    function tile(it) {
      const kept = keep.has(it.uuid);
      const b = el("button", {
        class: `tile${kept ? " keep" : ""}`,
        title: `${it.date.slice(0, 10)} · score ${it.score.toFixed(2)} · blur ${it.blur.toFixed(1)}`,
        "aria-pressed": String(kept),
        onclick: () => {
          kept ? keep.delete(it.uuid) : keep.add(it.uuid);
          render();
        },
      });
      b.append(el("img", { src: `/preview/${it.uuid}`, loading: "lazy", alt: "" }), el("span", { class: "badge" }, kept ? "keep" : "junk"));
      return b;
    }

    $("runs").replaceChildren(...(data.runs.length ? data.runs.map(runItem) : [el("li", {}, "None yet.")]));
    renderApply();
  }

  // Consecutive photos of the same section and cluster form one "similar" run.
  function toRuns(items) {
    const runs = [];
    items.forEach((it, n) => {
      const prev = items[n - 1];
      if (!prev || prev.cluster !== it.cluster || prev.section !== it.section) runs.push([]);
      runs[runs.length - 1].push(it);
    });
    return runs;
  }

  // Whole runs up to PAGE photos, so a page ends where a similar group ends. A run bigger than PAGE is split.
  function firstPage(items) {
    const page = [];
    for (const run of toRuns(items)) {
      if (page.length && page.length + run.length > PAGE) break;
      page.push(...run.slice(0, PAGE - page.length));
      if (page.length >= PAGE) break;
    }
    return page;
  }

  function runItem(r) {
    const li = el("li", {}, `Run ${r.id} · ${r.step} · ${r.writes} added to album · ${r.created.slice(0, 16).replace("T", " ")} UTC `);
    if (r.undone) li.append(el("span", {}, `· undone ${r.undone.slice(0, 16).replace("T", " ")}`));
    else
      li.append(
        el("button", { onclick: () => confirmBox(`Remove the ${r.writes} photos of run ${r.id} from “${data.album}”?`, "Undo run", () => undo(r.id)) }, "Undo"),
      );
    return li;
  }

  function renderApply() {
    say(data.pending ? `${data.pending.toLocaleString()} photos marked as junk, not written to Photos yet.` : "No pending changes.");
    $("applybox").replaceChildren(
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
    $("applybox").replaceChildren(el("button", { class: "primary", onclick: action }, label), el("button", { onclick: renderApply }, "Cancel"));
  }

  function confirmSection(items) {
    const kept = items.filter((i) => keep.has(i.uuid));
    $("pageinfo").replaceChildren(
      el(
        "span",
        { class: "msg" },
        `Mark all ${(items.length - kept.length).toLocaleString()} photos in ${sect} as junk${kept.length ? ` and keep the ${kept.length} you clicked` : ""}? You have seen ${Math.min(PAGE, items.length)} of them. Nothing is written until you apply.`,
      ),
      el("button", { class: "primary", onclick: () => decide(items) }, "Mark all"),
      el("button", { onclick: render }, "Cancel"),
    );
  }

  async function decide(page) {
    const accept = page.filter((i) => !keep.has(i.uuid)).map((i) => i.uuid);
    const reject = page.filter((i) => keep.has(i.uuid)).map((i) => i.uuid);
    try {
      await api("/api/decide", { group, accept, reject });
      await load();
      window.scrollTo(0, 0);
    } catch (e) {
      say(e.message, true);
    }
  }

  async function applyNow() {
    say("Writing to Photos…");
    $("applybox").replaceChildren();
    try {
      const r = await api("/api/apply", {});
      await load();
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
      const r = await api("/api/undo", { run });
      await load();
      say(`Run ${run} undone: removed ${r.removed} photos from the album.`);
    } catch (e) {
      renderApply();
      say(e.message, true);
    }
  }

  load().catch((e) => say(e.message, true));
})();
