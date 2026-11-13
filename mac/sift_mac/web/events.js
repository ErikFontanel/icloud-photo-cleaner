// Grid steps 3 Events (with places) and 4 Best-of: the table's event piles as a list. Same data and endpoints as the
// table (/api/table/*), so a name, merge, place, tag or album made here shows there and the other way round.
// Nothing reaches Photos until Apply.
(() => {
  const PAGE = 40;
  const $ = (id) => document.getElementById(id);
  let piles = [],
    st = null,
    mode = "events",
    page = 0,
    hide = false;
  const filter = { events: "noplace", best: "named" };
  const drafts = new Map(); // typed but not saved yet, key "<pile>|name|tag|album|place"; survives re-renders
  const picked = new Set(); // photos selected in an event's strip: for a place of their own, or to delete
  let lastPick = null;
  try {
    hide = localStorage.getItem("sift-hide-albums") === "1";
  } catch {
    /* default: shown */
  }

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => (k.startsWith("on") ? (e[k] = v) : e.setAttribute(k, v)));
    e.append(...kids.filter((k) => k !== null && k !== undefined && k !== false && k !== 0));
    return e;
  }
  async function api(path, body) {
    const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j;
  }
  function say(text, err) {
    const m = $("eventsmsg");
    m.textContent = text;
    m.title = text;
    m.className = err ? "msg err" : "msg";
  }

  let loads = 0; // only the newest reload is shown: an older one finishing late would show the list before your edit
  async function load() {
    const mine = ++loads;
    say("Loading events…");
    try {
      const r = await api("/api/events/piles");
      if (mine !== loads) return;
      piles = r.piles;
      st = r;
      say("");
      render();
    } catch (e) {
      if (mine === loads) say(e.message, true);
    }
  }
  // After an edit: fetch only the events it touched and swap those rows; every other event stays as it is.
  const byTime = (a, b) => (a.kind === "undated") - (b.kind === "undated") || a.start - b.start;
  async function update(keys) {
    const mine = ++loads,
      want = new Set(keys);
    try {
      const r = await api("/api/events/piles", { keys: [...want] });
      if (mine !== loads) return;
      const before = piles.filter((p) => want.has(p.key)).flatMap((p) => p.uuids);
      piles = piles
        .filter((p) => !want.has(p.key))
        .concat(r.piles)
        .sort(byTime);
      for (const m of ["tags", "albums", "album_adds", "album_removes"]) {
        before.forEach((u) => delete st[m][u]);
        Object.assign(st[m], r[m]);
      }
      for (const k of ["names", "kept", "fav_edits", "undo", "pending", "tag_index", "album_index"]) st[k] = r[k];
      say("");
      render();
    } catch (e) {
      if (mine === loads) say(e.message, true);
    }
  }
  // A script error shows next to Apply instead of failing silently.
  addEventListener("error", (e) => {
    if (!$("eventsview").hidden) say(`Something went wrong: ${e.message}. Reload the page.`, true);
  });
  addEventListener("unhandledrejection", (e) => {
    if (!$("eventsview").hidden) say(`Something went wrong: ${e.reason?.message || e.reason}`, true);
  });

  const inAlbum = (u) => (st.albums[u] || []).length > 0;
  const shown = (p) => (hide ? p.uuids.filter((u) => !inAlbum(u)) : p.uuids);
  // A pile's places: groups of its photos without GPS, each with a city that is set or suggested (city null: no idea).
  const spots = (p) => {
    const s = new Set(shown(p));
    return p.spots.map((g) => ({ ...g, uuids: g.uuids.filter((u) => s.has(u)) })).filter((g) => g.uuids.length);
  };
  const noGps = (p) => spots(p).flatMap((g) => g.uuids);
  const day = (t, year) => new Date(t * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });
  const when = (p) =>
    p.kind === "undated" ? "No reliable date" : day(p.start, true) === day(p.end, true) ? day(p.start, true) : `${day(p.start)}–${day(p.end, true)}`;
  const named = (p) => !!(p.name || (p.label && p.kind !== "undated"));
  const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;
  const useAll = (gs, keys) =>
    run(async () => {
      for (const g of gs) await api("/api/table/place", { uuids: g.uuids, city: g.city, country: g.country });
    }, keys);

  // Each step: which piles it lists, its filters (key, label, test) and its row.
  const MODES = {
    events: {
      pool: (p) => shown(p).length > 0,
      filters: [
        ["noplace", "No location", (p) => !p.kept && spots(p).some((g) => !g.set)],
        ["named", "Named & suggested", (p) => !p.kept && named(p)],
        ["unnamed", "Unnamed", (p) => !p.kept && !named(p)],
        ["place", "Place suggested", (p) => !p.kept && spots(p).some((g) => g.city && !g.set)],
        ["kept", "Kept", (p) => p.kept],
        ["all", "All", (p) => !p.kept],
      ],
      row: eventRow,
      bulk: (list) => {
        const gs = list.flatMap((p) => spots(p).filter((g) => g.city && !g.set));
        return (
          gs.length > 0 &&
          el(
            "button",
            {
              onclick: () =>
                useAll(
                  gs,
                  list.map((p) => p.key),
                ),
            },
            `Use all ${plural(gs.length, "suggested place")} on this page`,
          )
        );
      },
    },
    best: {
      pool: (p) => shown(p).length >= 3,
      filters: [
        ["named", "Named & suggested", named],
        ["all", "All", () => true],
      ],
      row: bestRow,
      bulk: (list) => {
        const us = list.flatMap((p) => p.best);
        return (
          us.length > 0 &&
          el(
            "button",
            {
              onclick: () =>
                run(
                  () => api("/api/table/favorite", { uuids: us }),
                  list.map((p) => p.key),
                ),
            },
            `Favourite the ${plural(us.length, "suggestion")} on this page`,
          )
        );
      },
    },
  };

  function render() {
    const M = MODES[mode],
      pool = piles.filter(M.pool);
    const test = (M.filters.find(([k]) => k === filter[mode]) || M.filters[0])[2];
    const list = pool.filter(test),
      pages = Math.max(1, Math.ceil(list.length / PAGE));
    page = Math.min(page, pages - 1);
    const onPage = list.slice(page * PAGE, (page + 1) * PAGE);
    $("eventsfilters").replaceChildren(
      ...M.filters.map(([k, t, f]) =>
        el(
          "button",
          {
            class: "chip",
            "aria-pressed": String(filter[mode] === k),
            onclick: () => {
              filter[mode] = k;
              page = 0;
              render();
            },
          },
          `${t} · ${pool.filter(f).length.toLocaleString()}`,
        ),
      ),
      el(
        "button",
        {
          class: "chip",
          "aria-pressed": String(hide),
          title: "Hide photos already in one of your albums (H on the table)",
          onclick: () => {
            hide = !hide;
            try {
              localStorage.setItem("sift-hide-albums", hide ? "1" : "0");
            } catch {
              /* not remembered */
            }
            render();
          },
        },
        "Hide in albums",
      ),
      ...[M.bulk?.(onPage)].filter(Boolean),
    );
    const pager = () =>
      el(
        "div",
        { class: "actions" },
        el(
          "button",
          {
            ...(page ? {} : { disabled: "" }),
            onclick: () => {
              page--;
              render();
              scrollTo(0, 0);
            },
          },
          "← Earlier",
        ),
        el("span", { class: "msg" }, `${plural(list.length, "event")} · page ${page + 1} of ${pages}`),
        el(
          "button",
          {
            ...(page < pages - 1 ? {} : { disabled: "" }),
            onclick: () => {
              page++;
              render();
              scrollTo(0, 0);
            },
          },
          "Later →",
        ),
      );
    const timeline = piles.filter((p) => shown(p).length); // every event in time order, also the ones the filter hides
    $("eventslist").replaceChildren(pager(), ...onPage.map((p) => M.row(p, timeline, list)), pager());
    if (focused && !focused.pile) {
      const t = document.querySelector(`.ph[data-u="${focused.list[focused.i]}"]`);
      if (t) t.style.visibility = "hidden";
    }
    renderApply();
  }

  function summary(us, of) {
    const c = new Map();
    us.forEach((u) => (of[u] || []).forEach((w) => c.set(w, (c.get(w) || 0) + 1)));
    return [...c].sort((a, b) => b[1] - a[1]);
  }
  function input(p, field, placeholder, list_, value) {
    const key = `${p.key}|${field}`,
      i = el("input", { placeholder, ...(list_ ? { list: list_ } : {}), "aria-label": placeholder });
    i.value = drafts.has(key) ? drafts.get(key) : value || "";
    i.oninput = () => {
      if (i.value.trim() && i.value !== (value || "")) drafts.set(key, i.value);
      else drafts.delete(key);
      $("eventsmsg").className = "msg";
      renderApply();
    };
    i.onkeydown = (e) => {
      if (e.key === "Enter" && drafts.has(key)) saveDrafts();
    };
    return i;
  }
  const title = (p) =>
    p.name
      ? el("div", { class: "evname album" }, p.name)
      : p.label
        ? el("div", { class: "evname" }, `Suggested: ${p.label}`)
        : el("div", { class: "evname none" }, "Unnamed");
  const head = (p, n, extra) => el("div", { class: "when" }, el("b", {}, when(p)), el("div", { class: "msg" }, plural(n, "photo") + (extra || "")));
  const thumb = (u) => el("img", { src: `/thumb/${u}?s=320`, loading: "lazy", alt: "" });
  const heart = () => {
    // the heart Photos shows on a thumbnail: outline, filled when a favourite (CSS)
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
      path = document.createElementNS(svg.namespaceURI, "path");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    path.setAttribute(
      "d",
      "M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.5 0 5.5 3.5 4.2 6.8-1.8 4.6-9.3 9.2-9.3 9.2z",
    );
    svg.append(path);
    return svg;
  };
  const strip = (us, img) => el("div", { class: "strip" }, ...us.map(img || thumb));
  const where = (g) =>
    !g.city ? "No location" : g.exact ? `${g.lat.toFixed(5)}, ${g.lon.toFixed(5)} near ${g.city}, ${g.country}` : `${g.city}, ${g.country}`;

  // A place you can click to change: it turns into a field (Enter saves for those photos, Esc cancels).
  let editing = null; // "<pile>|<first photo>" of the place being edited
  function placeLabel(p, g, text) {
    const key = `${p.key}|${g.uuids[0]}`;
    if (editing === key) {
      const i = el("input", {
        class: "placeedit",
        "data-editing": "",
        "aria-label": "City or coordinates",
        placeholder: "City (Kyoto, JP) or coordinates (35.01, 135.77)",
      });
      i.value = g.city ? (g.exact ? `${g.lat.toFixed(5)}, ${g.lon.toFixed(5)}` : `${g.city}, ${g.country}`) : "";
      i.onkeydown = (e) => {
        if (e.key === "Escape") {
          editing = null;
          render();
        }
        if (e.key === "Enter") {
          editing = null;
          edit("/api/table/place", { uuids: g.uuids, city: i.value.trim() }, [p.key]);
        }
      };
      i.onblur = () => {
        if (editing === key) {
          editing = null;
          render();
        }
      };
      return i;
    }
    return el(
      "button",
      {
        class: `placebtn ${g.set ? "set" : g.city ? "sug" : "none"}`,
        title: `${g.set ? "Set" : g.city ? `Suggested from ${g.from}` : "No location yet"}. Click to change`,
        onclick: () => {
          editing = key;
          render();
          const f = document.querySelector("[data-editing]");
          f && (f.focus(), f.select());
        },
      },
      text,
    );
  }
  // Merge joins the event shown above or below, plus the events the filter hides between them (same stretch of time).
  function neighbour(p, timeline, visible, dir) {
    const v = visible[visible.indexOf(p) + dir];
    if (!v) return null;
    const [a, b] = [timeline.indexOf(p), timeline.indexOf(v)].sort((x, y) => x - y);
    return { target: v, between: timeline.slice(a + 1, b).filter((x) => x !== v && x !== p) };
  }
  const mergeTip = (m) =>
    `Join ${m.target.name || m.target.label || "the event"} (${when(m.target)})` +
    (m.between.length
      ? ` and ${plural(m.between.length, "smaller event")} between them that this filter hides (${plural(
          m.between.reduce((n, x) => n + x.uuids.length, 0),
          "photo",
        )})`
      : "");
  function eventRow(p, timeline, visible) {
    const us = shown(p),
      prev = neighbour(p, timeline, visible, -1),
      next = neighbour(p, timeline, visible, 1);
    const tags = summary(us, st.tags),
      albums = summary(us, st.albums),
      adds = summary(us, st.album_adds);
    const of = (n) => (n === us.length ? "" : ` · ${n} of ${us.length}`);
    const hidden = us.length < p.uuids.length ? ` (${p.uuids.length - us.length} in albums hidden)` : "";
    // Photos without GPS grouped by place (set, suggested or none), then the ones with GPS. Click selects (⇧ a range).
    const gs = spots(p),
      noLoc = new Set(gs.flatMap((g) => g.uuids)),
      gps = us.filter((u) => !noLoc.has(u));
    const order = [...gs.flatMap((g) => g.uuids), ...gps],
      sel = order.filter((u) => picked.has(u));
    // Click: the photo opens large. ⌘/Ctrl-click: onto the selection pile. ⇧-click: a range onto the pile.
    const pick = (u) => (e) => {
      const from = e.currentTarget.getBoundingClientRect();
      if (e.shiftKey && lastPick && order.includes(lastPick)) {
        const [a, b] = [order.indexOf(lastPick), order.indexOf(u)].sort((x, y) => x - y);
        const add = order.slice(a, b + 1).filter((v) => !picked.has(v));
        const rects = new Map(add.map((v) => [v, document.querySelector(`.ph[data-u="${v}"]`)?.getBoundingClientRect()]));
        add.forEach((v) => picked.add(v));
        lastPick = u;
        render();
        rects.forEach((rc, v) => {
          const c = document.querySelector(`.pile img[data-u="${v}"]`);
          if (c && rc) flip(c, rc);
        });
      } else if (e.metaKey || e.ctrlKey || picked.size)
        toggle(u, from); // with a selection, a click adds or removes
      else focusPhoto(p, u, e.currentTarget, order); // ← → step through the event's photos
    };
    const img = (u) =>
      el(
        "button",
        {
          class: `ph${picked.has(u) ? " picked" : ""}`,
          "data-u": u,
          title: picked.size ? "Click to add to or remove from the selection" : "Click to open · ⌘-click to select · ⇧-click for a range",
          onclick: pick(u),
        },
        thumb(u),
      );
    const clear = () => {
      sel.forEach((u) => picked.delete(u));
      render();
    };
    const ROT = [0, -5, 4, -8];
    const photos = !gs.length
      ? [strip(us, img)]
      : [
          ...gs.map((g) =>
            el(
              "div",
              { class: "spot" },
              el(
                "div",
                { class: "place" },
                "📍",
                placeLabel(p, g, where(g)),
                el("span", { class: "msg" }, `${plural(g.uuids.length, "photo")}${g.set ? "" : g.city ? ` · suggested from ${g.from}` : ""}`),
                g.city && !g.set ? el("button", { class: "use", onclick: () => useAll([g], [p.key]) }, "Use") : null,
              ),
              strip(g.uuids, img),
            ),
          ),
          gps.length > 0 && el("div", { class: "spot" }, el("div", { class: "place gps" }, `📍 ${plural(gps.length, "photo")} with GPS`), strip(gps, img)),
        ];
    // The three columns sit in their own box, so the sticky date and side columns stop above the buttons row.
    return el(
      "article",
      { class: "event split" },
      el(
        "div",
        { class: "cols" },
        head(p, us.length, hidden),
        el(
          "div",
          { class: "body" },
          title(p),
          ...photos,
          el(
            "div",
            { class: "chips" },
            ...tags.map(([w, n]) =>
              el(
                "span",
                { class: "tag" },
                w + of(n),
                el("button", { title: "Remove", onclick: () => edit("/api/table/tags", { uuids: us, remove: [w] }, [p.key]) }, "×"),
              ),
            ),
            ...albums.map(([a, n]) => el("span", { class: "tag album" }, `▣ ${a}${of(n)}`)),
            ...adds.map(([a, n]) =>
              el(
                "span",
                { class: "tag new" },
                `+ ${a}${of(n)}`,
                el("button", { title: "Remove", onclick: () => edit("/api/table/album", { uuids: us, album: a, remove: true }, [p.key]) }, "×"),
              ),
            ),
          ),
        ),
        el(
          "div",
          { class: "acts" },
          input(p, "name", p.name ? "Rename (album name)" : "Name it: becomes an album", null, p.name),
          // With a selection, tags and albums go to the selected photos only, so their fields sit in the selection.
          sel.length > 0 &&
            el(
              "div",
              { class: "selbox" },
              el(
                "div",
                {
                  class: "pile",
                  "data-pile": p.key,
                  title: "Open the selected photos (Space; ← → to step)",
                  onclick: (e) => focusPhoto(p, sel[sel.length - 1], e.currentTarget.lastElementChild, sel, true),
                },
                ...sel.slice(-4).map((u, i, a) => el("img", { src: `/thumb/${u}?s=320`, alt: "", "data-u": u, style: `rotate: ${ROT[a.length - 1 - i]}deg` })),
              ),
              el("div", { class: "selcount" }, el("b", {}, String(sel.length)), ` photo${sel.length === 1 ? "" : "s"} selected`),
              input(p, "place", "Place: city, coordinates or map link"),
              el("div", { class: "seclabel" }, "Albums"),
              albumChips(p, sel, () => update([p.key]), true),
              input(p, "seltag", `Add a tag to the ${sel.length}`, "tagindex"),
              input(p, "selalbum", `Add the ${sel.length} to an album`, "albumindex"),
              el(
                "div",
                { class: "actions" },
                el(
                  "button",
                  {
                    class: "danger",
                    onclick: () => {
                      clear();
                      remove(p, sel);
                    },
                  },
                  `Delete ${sel.length}`,
                ),
                el("button", { onclick: clear }, "Clear selection"),
              ),
            ),
          !sel.length && input(p, "tag", "Add a tag to all", "tagindex"),
          !sel.length && input(p, "album", "Add all to an album", "albumindex"),
        ),
      ),
      el(
        "div",
        { class: "foot" },
        el("button", { ...(prev ? { title: mergeTip(prev) } : { disabled: "" }), onclick: () => merge(p, prev.target, prev.between) }, "↑ Merge earlier"),
        el("button", { ...(next ? { title: mergeTip(next) } : { disabled: "" }), onclick: () => merge(p, next.target, next.between) }, "↓ Merge later"),
        el("span", { class: "grow" }),
        el(
          "button",
          { class: "danger", title: "Mark these photos To Delete, like ⌫ on the table", onclick: () => remove(p, us) },
          `Delete ${plural(us.length, "photo")}`,
        ),
        p.kept
          ? el("button", { onclick: () => edit("/api/table/keep", { pile: p.key, on: false }, [p.key]) }, "Unkeep")
          : el("button", { class: "keep", title: "Done with this event: hide it from this list (Kept shows it again)", onclick: () => keepIt(p) }, "Keep"),
      ),
    );
  }

  function bestRow(p) {
    const us = shown(p),
      fav = new Set(p.favorite),
      pick = new Set(st.fav_edits),
      sug = new Set(p.best);
    // Like Photos: a click opens the photo large (← → through the event); the heart on hover makes it a favourite.
    const img = (u) => {
      const cls = fav.has(u) ? "fav" : pick.has(u) ? "fav pick" : sug.has(u) ? "sug" : "";
      const tip = fav.has(u) ? "A favourite in Photos already" : pick.has(u) ? "Becomes a favourite on Apply. Click to undo" : "Favourite";
      return el(
        "div",
        { class: `ph ${cls}`, "data-u": u },
        el("button", { class: "open", title: "Click to open", onclick: (e) => focusPhoto(p, u, e.currentTarget, us) }, thumb(u)),
        el(
          "button",
          {
            class: "heart",
            title: tip,
            "aria-label": tip,
            "aria-pressed": String(fav.has(u) || pick.has(u)),
            onclick: () => fav.has(u) || edit("/api/table/favorite", { uuids: [u], on: !pick.has(u) }, [p.key]),
          },
          heart(),
        ),
      );
    };
    const n = us.filter((u) => fav.has(u) || pick.has(u)).length;
    return el(
      "article",
      { class: "event" },
      head(p, us.length, n ? ` · ${n} ♥` : ""),
      el("div", { class: "body" }, title(p), strip(us, img)),
      el(
        "div",
        { class: "acts" },
        sug.size
          ? el("button", { class: "primary", onclick: () => edit("/api/table/favorite", { uuids: p.best }, [p.key]) }, `Favourite the ${sug.size} suggested`)
          : el("div", { class: "msg" }, "Enough favourites for its size."),
        el(
          "div",
          { class: "msg" },
          "Dashed: suggested by aesthetics score. Click the heart on a photo to make it a favourite, or again to undo. 3 per event, plus 1 per 50 photos, up to 8.",
        ),
      ),
    );
  }

  // ---- motion: Apple's ease-out curve; a plain cut when the system asks for reduced motion ----
  const EASE = "cubic-bezier(0.32, 0.72, 0, 1)",
    DUR = 420;
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  // FLIP: draw node where `from` was, then let it glide to where the layout put it.
  function flip(node, from, opts) {
    const to = node.getBoundingClientRect();
    if (!to.width || !from) return;
    const t = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
    return node.animate(
      [
        { transformOrigin: "0 0", transform: t },
        { transformOrigin: "0 0", transform: "none" },
      ],
      { duration: still() ? 0 : DUR, easing: EASE, ...opts },
    );
  }
  // ⌘-click: onto the pile (it flies there), or off it (it flies back into the strip).
  function toggle(u, from) {
    const was = picked.has(u),
      back = was && document.querySelector(`.pile img[data-u="${u}"]`)?.getBoundingClientRect();
    was ? picked.delete(u) : picked.add(u);
    lastPick = u;
    render();
    const node = document.querySelector(was ? `.ph[data-u="${u}"]` : `.pile img[data-u="${u}"]`);
    if (node) flip(node, was ? back : from);
  }

  // Photos large, one at a time, each with its own place and Delete: a photo from a strip (← → step through its
  // event), or the selection pile (← → step through the pile). Click outside or Esc puts it back where it came from.
  let focused = null; // { ov, big, panel, key (the event), list, i, pile }
  const pileOf = (key) => piles.find((x) => x.key === key);
  function focusPhoto(p, u, fromEl, list, pile = false) {
    if (focused) return;
    const small = fromEl.tagName === "IMG" ? fromEl : fromEl.querySelector("img"),
      from = small.getBoundingClientRect();
    const big = el("img", { class: "focusimg", alt: "" }),
      panel = el("aside", { class: "focuspanel" });
    const ov = el(
      "div",
      {
        class: "focus",
        onclick: (e) => {
          if (e.target === e.currentTarget || e.target.classList.contains("focusstage")) closeFocus();
        },
      }, // the backdrop only: panel buttons replace themselves
      el("div", { class: "focusstage" }, big, panel),
    );
    document.body.append(ov);
    list = list || [u];
    focused = { ov, big, panel, key: p.key, list, i: list.indexOf(u), pile };
    showPhoto(focused.i, 0, small);
    const d = still() ? 0 : DUR;
    ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: d * 0.7, easing: "ease-out" });
    panel.animate(
      [
        { opacity: 0, transform: "translateX(16px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: d, delay: d * 0.25, easing: EASE, fill: "backwards" },
    );
    flip(big, from);
  }
  // Put photo i of the open list on stage; dir -1/1 slides it in from that side.
  function showPhoto(i, dir, small) {
    const f = focused,
      n = f.list.length;
    f.i = (i + n) % n;
    const u = f.list[f.i],
      p = pileOf(f.key);
    small = small || document.querySelector(`.ph[data-u="${u}"] img`);
    const aspect = (small?.naturalWidth || 4) / (small?.naturalHeight || 3);
    const narrow = innerWidth < 800,
      maxW = narrow ? innerWidth - 32 : innerWidth - 400,
      maxH = innerHeight * (narrow ? 0.55 : 0.84);
    const w = Math.min(maxW, maxH * aspect);
    Object.assign(f.big.style, { width: `${w}px`, height: `${w / aspect}px` });
    f.big.src = small?.src || `/thumb/${u}?s=320`;
    const hi = new Image();
    hi.onload = () => {
      if (focused === f && f.list[f.i] === u) f.big.src = hi.src;
    };
    hi.src = `/thumb/${u}?s=2048`;
    f.panel.replaceChildren(...panelFor(p, u));
    if (!f.pile) document.querySelectorAll(".ph").forEach((b) => (b.style.visibility = b.dataset.u === u ? "hidden" : "")); // lifted out of the strip
    if (dir)
      f.big.animate(
        [
          { opacity: 0, transform: `translateX(${dir * 48}px)` },
          { opacity: 1, transform: "none" },
        ],
        { duration: still() ? 0 : DUR * 0.8, easing: EASE },
      );
  }
  // After a change in the pile mode: drop u from the list, show the next one, or close when none is left.
  function dropFromList(u) {
    const f = focused;
    f.list = f.list.filter((v) => v !== u);
    if (!f.list.length) return closeFocus(true);
    showPhoto(Math.min(f.i, f.list.length - 1), 1);
  }
  function panelFor(p, u) {
    const f = focused,
      g = p && spots(p).find((x) => x.uuids.includes(u));
    const refresh = async () => {
      await update([f.key]);
      if (focused === f) showPhoto(f.i, 0);
    };
    const field = g && el("input", { class: "placeedit", placeholder: "City, coordinates or map link", "aria-label": "Place of this photo" });
    if (field) {
      field.value = g.set ? (g.exact ? `${g.lat.toFixed(5)}, ${g.lon.toFixed(5)}` : `${g.city}, ${g.country}`) : "";
      field.onkeydown = async (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        try {
          await api("/api/table/place", { uuids: [u], city: field.value.trim() });
          await refresh();
        } catch (err) {
          field.setCustomValidity(err.message);
          field.reportValidity();
        }
      };
      field.oninput = () => field.setCustomValidity("");
    }
    return [
      f.list.length > 1
        ? el("div", { class: "focuscount" }, el("b", {}, `${f.i + 1}`), ` of ${f.list.length} ${f.pile ? "selected" : "in this event"} · ← → to step`)
        : null,
      p ? eventTitle(p, u, refresh) : null,
      p ? el("div", { class: "msg" }, when(p)) : null,
      el("h3", {}, "Place"),
      g
        ? el(
            "div",
            { class: `place ${g.set ? "set" : g.city ? "" : "none"}` },
            `📍 ${where(g)}${g.set ? "" : g.city ? " (suggested)" : ""}`,
            g.city && !g.set
              ? el(
                  "button",
                  {
                    class: "use",
                    onclick: async () => {
                      await api("/api/table/place", { uuids: [u], city: g.city, country: g.country });
                      await refresh();
                    },
                  },
                  "Use",
                )
              : null,
          )
        : el("div", { class: "place gps" }, "📍 Has its own GPS location"),
      field,
      el("h3", {}, "Albums"),
      albumChips(p, [u], refresh),
      el(
        "div",
        { class: "actions" },
        el(
          "button",
          {
            class: "danger",
            onclick: () => {
              picked.delete(u);
              dropFromList(u);
              remove(p, [u]); // the next photo takes its place, as in Photos
            },
          },
          "Delete photo",
        ),
        f.pile
          ? el(
              "button",
              {
                onclick: () => {
                  picked.delete(u);
                  render();
                  dropFromList(u);
                },
              },
              "Remove from selection",
            )
          : el(
              "button",
              {
                onclick: () => {
                  closeFocus();
                  toggle(u, document.querySelector(`.ph[data-u="${u}"]`)?.getBoundingClientRect());
                },
              },
              "Add to selection",
            ),
      ),
      el("div", { class: "msg" }, "Click outside or press Esc to go back."),
    ];
  }
  // The photo's albums: hover one for Remove. Event albums and additions Sift makes can be taken back; your own
  // Photos albums can't (Photos would have to rebuild them, losing folder and order), so they say so instead.
  // ---- albums of one or more photos: one model and one chip, shared by the large view and the selection box ----
  // kind: event (the event's own album, made on Apply or already in Photos), sift (another event album), own (your
  // Photos album: Sift won't take photos out of it), add (added on Apply). n: photos in it; out: photos taken out.
  function albumsOf(p, us) {
    const events_ = new Set(Object.values(st.names)),
      m = new Map();
    const get = (t, kind) => (m.has(t) ? m : m.set(t, { title: t, kind, n: 0, out: 0 })).get(t);
    for (const u of us) {
      const out = st.album_removes[u] || [];
      if (p?.name) get(p.name, "event")[out.includes(p.name) ? "out" : "n"]++;
      for (const a of st.albums[u] || []) if (a !== p?.name) get(a, events_.has(a) ? "sift" : "own")[out.includes(a) ? "out" : "n"]++;
      for (const a of st.album_adds[u] || []) if (a !== p?.name) get(a, "add").n++;
    }
    return [...m.values()];
  }
  const ALBUM_TIP = {
    event: "The event's album",
    sift: "An event album in Photos",
    add: "Added on Apply",
    own: "Your own album in Photos: take photos out of it in Photos (Sift won't rebuild your albums)",
  };
  function albumChip(a, us, refresh, asTitle) {
    const act = (remove) => async () => {
      const done = busy();
      try {
        await api("/api/table/album", { uuids: us, album: a.title, remove });
        await refresh();
      } catch (e) {
        say(e.message, true);
      } finally {
        done();
      }
    };
    const count = us.length > 1 ? ` · ${a.n} of ${us.length}` : "",
      can = a.kind !== "own";
    return el(
      asTitle ? "div" : "span",
      { class: `achip k-${a.kind}${a.n ? "" : " removed"}${asTitle ? " astitle" : ""}`, title: ALBUM_TIP[a.kind] },
      el("span", { class: "aname" }, `${a.kind === "add" ? "+" : "▣"} ${a.title}${count}`),
      can && a.n ? el("button", { class: "rm", onclick: act(true) }, asTitle ? "Remove from album" : "Remove") : null,
      can && a.out ? el("button", { class: "rm back", onclick: act(false) }, "Put back") : null,
    );
  }
  // The large view: the event's album is its title; the other albums are listed under Albums.
  function eventTitle(p, u, refresh) {
    const ev = p.name && albumsOf(p, [u]).find((a) => a.kind === "event");
    return ev ? albumChip(ev, [u], refresh, true) : title(p);
  }
  function albumChips(p, us, refresh, withEvent) {
    const list = albumsOf(p, us).filter((a) => withEvent || a.kind !== "event");
    return list.length ? el("div", { class: "achips" }, ...list.map((a) => albumChip(a, us, refresh))) : el("div", { class: "msg" }, "In no album");
  }
  function closeFocus(gone) {
    if (!focused) return;
    const { ov, big, panel, list, i, pile, key } = focused,
      d = still() ? 0 : DUR;
    focused = null;
    const home = pile ? document.querySelector(`.pile[data-pile="${key}"] img:last-child`) : document.querySelector(`.ph[data-u="${list[i]}"]`);
    const to = !gone && home?.getBoundingClientRect(),
      from = big.getBoundingClientRect();
    if (home && !pile) home.style.visibility = "hidden"; // until the large photo has landed on it
    ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: d * 0.8, easing: "ease-in", fill: "forwards" });
    panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: d * 0.4, fill: "forwards" });
    const t = to ? `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})` : "scale(0.6)";
    const a = big.animate(
      [
        { transformOrigin: "0 0", transform: "none", opacity: 1 },
        { transformOrigin: to ? "0 0" : "50% 50%", transform: t, opacity: to ? 1 : 0 },
      ],
      { duration: d, easing: EASE, fill: "forwards" },
    );
    const done = () => {
      ov.remove();
      document.querySelectorAll(".ph").forEach((b) => (b.style.visibility = ""));
    };
    d ? (a.onfinish = done) : done();
  }
  // Esc: close the open photo, else clear the selection (the pile flies back into the strips). ⌘Z: undo.
  addEventListener("keydown", (e) => {
    if ($("eventsview").hidden) return;
    const typing = e.target.closest?.("input, textarea");
    if (e.key === "Escape" && focused) {
      e.preventDefault();
      closeFocus();
    } else if (focused && focused.list.length > 1 && !typing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      showPhoto(focused.i + dir, dir);
    } else if (e.key === "Escape" && picked.size && !typing) {
      e.preventDefault();
      const back = new Map([...picked].map((u) => [u, document.querySelector(`.pile img[data-u="${u}"]`)?.getBoundingClientRect()]));
      picked.clear();
      render();
      back.forEach((rc, u) => {
        const t = document.querySelector(`.ph[data-u="${u}"]`);
        if (t && rc) flip(t, rc);
      });
    } else if (e.key === " " && !typing && (focused || picked.size)) {
      // Space: the selection's gallery, open or closed
      e.preventDefault();
      if (focused) closeFocus();
      else {
        const piles_ = [...document.querySelectorAll(".pile")]; // the selection pile nearest the middle of the screen
        const mid = innerHeight / 2,
          pl = piles_.sort((a, b) => Math.abs(a.getBoundingClientRect().top - mid) - Math.abs(b.getBoundingClientRect().top - mid))[0];
        pl?.click();
      }
    } else if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !typing && !focused) {
      e.preventDefault();
      undoLast();
    }
  });

  // The same rule as M on the table: your name beats a suggestion beats none; then the bigger pile keeps its key.
  async function merge(a, b, between = []) {
    const rank = (p) => (p.name ? 2 : named(p) ? 1 : 0);
    const [keep, move] = rank(a) > rank(b) || (rank(a) === rank(b) && a.uuids.length >= b.uuids.length) ? [a, b] : [b, a];
    await edit(
      "/api/table/sync",
      { piles: Object.fromEntries([move, ...between].flatMap((x) => x.uuids).map((u) => [u, keep.key])) },
      [keep, move, ...between].map((x) => x.key),
    );
  }
  // Same as ⌫ on the table: junk marks, moved to "Sift – To Delete" on Apply. Undo restores just these photos.
  async function remove(p, us) {
    await edit("/api/table/sync", { marked: us }, [p.key]);
    say(`${plural(us.length, "photo")} of ${p.name || p.label || when(p)} marked To Delete. Undo (⌘Z) brings them back.`);
  }
  async function keepIt(p) {
    await edit("/api/table/keep", { pile: p.key }, [p.key]);
    say(`Kept ${p.name || p.label || when(p)}. Undo (⌘Z) shows it again.`);
  }

  // Saves every typed field to Sift's database (not to Photos). Enter in a field or the Save button does this.
  async function saveDrafts() {
    const byKey = new Map(piles.map((p) => [p.key, p])),
      done = busy(),
      touched = new Set();
    try {
      for (const [key, v] of [...drafts]) {
        touched.add(key.split("|")[0]);
        const [pile, field] = key.split("|"),
          p = byKey.get(pile),
          us = p && shown(p);
        if (p && field === "name") await api("/api/table/name", { pile, name: v.trim() });
        if (p && field === "place") {
          const sel = shown(p).filter((u) => picked.has(u)); // photos with GPS among them keep theirs on Apply
          await api("/api/table/place", { uuids: sel.length ? sel : noGps(p), city: v.trim() });
          sel.forEach((u) => picked.delete(u));
        }
        const sel = p ? us.filter((u) => picked.has(u)) : [];
        if (p && field === "tag") await api("/api/table/tags", { uuids: us, add: [v.trim()] });
        if (p && field === "album") await api("/api/table/album", { uuids: us, album: v.trim() });
        if (p && field === "seltag" && sel.length) await api("/api/table/tags", { uuids: sel, add: [v.trim()] });
        if (p && field === "selalbum" && sel.length) await api("/api/table/album", { uuids: sel, album: v.trim() });
        drafts.delete(key);
      }
      await update([...touched]);
    } catch (e) {
      renderApply();
      say(e.message, true);
    } finally {
      done();
    }
  }
  addEventListener("beforeunload", (e) => {
    if (drafts.size) e.preventDefault();
  });
  // Loading state: the button that started a save spins and is disabled, and its event dims, until the list is back.
  let clicked = null;
  document.addEventListener(
    "click",
    (e) => {
      clicked = e.target.closest?.("button");
    },
    true,
  );
  function busy() {
    const b = clicked,
      ev = b?.closest(".event");
    clicked = null;
    b?.classList.add("busy");
    if (b) b.disabled = true;
    ev?.classList.add("working");
    say("Saving…");
    return () => {
      b?.classList.remove("busy");
      if (b) b.disabled = false;
      ev?.classList.remove("working");
    };
  }
  // keys: the events the edit touches, so only those are fetched again; without keys the whole list is.
  async function edit(path, body, keys) {
    const done = busy();
    try {
      await api(path, body);
      await (keys ? update(keys) : load());
    } catch (e) {
      say(e.message, true);
    } finally {
      done();
    }
  }
  async function run(fn, keys) {
    const done = busy();
    try {
      await fn();
      await (keys ? update(keys) : load());
    } catch (e) {
      say(e.message, true);
    } finally {
      done();
    }
  }

  // Undo the last saved edit, whichever step or the table made it (places, merges, names, tags, albums, deletes, keep).
  async function undoLast() {
    if (!st?.undo) return say("Nothing to undo.");
    const done = busy();
    try {
      const r = await api("/api/table/undo-edit", {});
      await load();
      say(`Undone: ${r.undone}.`);
    } catch (e) {
      say(e.message, true);
    } finally {
      done();
    }
  }

  function pendingParts() {
    const p = st.pending;
    return [
      p.delete && `${p.delete} to delete`,
      p.albums && `${p.album_photos} photos into ${plural(p.albums, "album")}`,
      p.renames && plural(p.renames, "album rename"),
      p.keywords && `keywords on ${plural(p.keywords, "photo")}`,
      p.locations && `pins on ${plural(p.locations, "photo")}`,
      p.favorites && plural(p.favorites, "favourite"),
      p.album_removals && `${plural(p.album_removals, "photo")} out of albums`,
    ].filter(Boolean);
  }
  function renderApply() {
    const parts = pendingParts(),
      n = drafts.size;
    $("tagindex").replaceChildren(...st.tag_index.map((w) => el("option", { value: w })));
    $("albumindex").replaceChildren(...st.album_index.map((w) => el("option", { value: w })));
    $("eventsapplybox").replaceChildren(
      el("button", { ...(st.undo ? { title: `Undo: ${st.undo} (⌘Z)` } : { disabled: "", title: "Nothing to undo" }), onclick: undoLast }, "↶ Undo"),
      ...(n ? [el("button", { onclick: saveDrafts }, `Save ${plural(n, "edit")}`)] : []),
      el(
        "button",
        {
          class: "primary",
          ...(parts.length || n ? {} : { disabled: "" }),
          onclick: async () => {
            if (drafts.size) {
              await saveDrafts();
              if (drafts.size) return;
            }
            confirmApply(pendingParts());
          },
        },
        "Apply to Photos",
      ),
    );
    if (!$("eventsmsg").className.includes("err"))
      say([n && `${n} unsaved`, parts.length ? `${parts.join(" · ")}, saved, not in Photos yet` : !n && "Nothing to apply yet."].filter(Boolean).join(" · "));
  }
  function confirmApply(parts) {
    if (!parts.length) {
      renderApply();
      return;
    }
    say(`Write ${parts.join(", ")} to the library Photos has open?`);
    $("eventsapplybox").replaceChildren(
      el("button", { class: "primary", onclick: applyNow }, "Write to Photos"),
      el("button", { onclick: renderApply }, "Cancel"),
    );
  }
  async function applyNow() {
    say("Writing to Photos…");
    const stop = applyProgress($("eventsapplybox"));
    try {
      const r = await api("/api/table/apply", {}).finally(stop),
        t = r.result.table;
      await load();
      const done = [
        ...Object.entries(r.result)
          .filter(([k]) => k !== "table")
          .map(([k, v]) => `${k}: ${v.added ?? 0} to To Delete`),
        t &&
          [
            t.added && `${t.added} into albums`,
            t.renamed && `${t.renamed} renamed`,
            t.keywords && `keywords on ${t.keywords}`,
            t.locations && `${t.locations} pins`,
            t.favorites && `${t.favorites} favourites`,
            t.removed && `${t.removed} out of albums`,
          ]
            .filter(Boolean)
            .join(", "),
      ].filter(Boolean);
      say(`Written: ${done.join(" · ") || "nothing"}. Undo is under Applied runs on the table.`);
    } catch (e) {
      renderApply();
      say(e.message, true);
    }
  }

  // The side column sticks under the header while you scroll through a long event.
  const headerHeight = () => document.documentElement.style.setProperty("--toph", `${document.querySelector(".top").offsetHeight}px`);
  headerHeight();
  addEventListener("resize", headerHeight);

  // ---- navigation: steps 3 and 4 share this view ----
  const STEPS = { "nav-events": "events", "nav-best": "best" };
  const HASH = { events: "#events", best: "#best-of" };
  function open(id) {
    mode = STEPS[id];
    page = 0;
    ["junkview", "junkapply", "dupesview", "dupesapply"].forEach((v) => ($(v).hidden = true));
    ["nav-junk", "nav-dupes", ...Object.keys(STEPS)].forEach((b) => $(b).setAttribute("aria-pressed", String(b === id)));
    $("eventsview").hidden = false;
    $("eventsapply").hidden = false;
    if (location.hash !== HASH[mode]) history.replaceState(null, "", HASH[mode]);
    if (st) render();
    load();
  }
  Object.keys(STEPS).forEach((id) => ($(id).onclick = () => open(id)));
  ["nav-junk", "nav-dupes"].forEach((b) =>
    $(b).addEventListener("click", () => {
      $("eventsview").hidden = true;
      $("eventsapply").hidden = true;
      Object.keys(STEPS).forEach((s) => $(s).setAttribute("aria-pressed", "false"));
      if (location.hash) history.replaceState(null, "", location.pathname);
    }),
  );
  const start = location.hash === "#locations" ? "events" : Object.keys(HASH).find((m) => HASH[m] === location.hash); // old link
  if (start) open(Object.keys(STEPS).find((id) => STEPS[id] === start));
})();
