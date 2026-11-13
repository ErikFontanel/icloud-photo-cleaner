// While Apply writes to Photos: a bar in `box` with what it is writing and how far it is. Call the result to stop.
window.applyProgress = (box) => {
  const bar = document.createElement("progress"),
    text = document.createElement("span");
  bar.style.cssText = "width: 220px; accent-color: var(--accent); vertical-align: middle";
  text.textContent = "Writing to Photos…";
  box.replaceChildren(bar, text);
  let on = true;
  (async () => {
    while (on) {
      try {
        const p = await (await fetch("/api/table/apply/progress")).json();
        if (!on) break;
        if (p.total) {
          bar.max = p.total;
          bar.value = p.done;
          text.textContent = `${p.step} · ${p.done.toLocaleString()} of ${p.total.toLocaleString()} photos`;
        } else {
          bar.removeAttribute("value");
          text.textContent = `${p.step || "Writing to Photos"}…`;
        }
      } catch {
        /* the next poll tries again */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();
  return () => {
    on = false;
  };
};

// For an empty step: rescan the library for photos added or changed since the last scan, then done(summary).
window.rescanButton = (done) => {
  const wrap = document.createElement("span"),
    b = document.createElement("button"),
    text = document.createElement("span");
  b.textContent = "Rescan for new photos";
  text.className = "msg";
  wrap.append(b, " ", text);
  const poll = async () => {
    const s = await (await fetch("/api/scan")).json();
    if (s.running) {
      text.textContent = "Scanning… new photos are analysed on this Mac; this can take a few minutes.";
      setTimeout(poll, 2000);
      return;
    }
    b.disabled = false;
    b.classList.remove("busy");
    text.textContent = s.error ? `Scan failed: ${s.error}` : `Scanned: ${s.result}.`;
    if (!s.error) done(text.textContent);
  };
  b.onclick = async () => {
    b.disabled = true;
    b.classList.add("busy");
    try {
      await fetch("/api/scan", { method: "POST", body: "{}" });
      poll();
    } catch (e) {
      b.disabled = false;
      b.classList.remove("busy");
      text.textContent = e.message;
    }
  };
  return wrap;
};
