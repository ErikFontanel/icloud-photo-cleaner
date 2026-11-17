#!/usr/bin/env node
// Regression checks for the review page's keyboard and pointer states, in headless Chrome over the DevTools protocol.
// Use when the Chrome extension is not connected. Needs `mac.sh start` first. Usage: web-check.mjs [out-dir]
// Prints PASS/FAIL per check, saves screenshots, exits 1 on any FAIL.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const stamp = (d = new Date(), p = (n) => String(n).padStart(2, "0")) =>
  `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
const BASE = `http://127.0.0.1:${process.env.SIFT_VERIFY_PORT || 8766}`;
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../../../..");
const OUT = process.argv[2] || join(ROOT, "build/verify", `web-${stamp()}`);
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "cdp-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", `--user-data-dir=${profile}`,
  "--remote-debugging-port=0", "--window-size=1440,900", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50 && !targets; i++) {
  await sleep(200);
  const portFile = join(profile, "DevToolsActivePort"); // Chrome picks a free port and writes it here
  if (!existsSync(portFile)) continue;
  try { targets = await (await fetch(`http://127.0.0.1:${readFileSync(portFile, "utf8").split("\n")[0]}/json`)).json(); } catch {}
}
if (!targets) throw new Error("headless Chrome did not start");
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map(), logs = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) pending.get(d.id)(d), pending.delete(d.id);
  if (d.method === "Runtime.exceptionThrown") logs.push("EXCEPTION " + d.params.exceptionDetails.exception?.description);
  if (d.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(d.params.type)) logs.push(d.params.type + " " + d.params.args.map((a) => a.value ?? a.description).join(" "));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const key = async (k, code, text) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, text, windowsVirtualKeyCode: k === " " ? 32 : k.length === 1 ? k.toUpperCase().charCodeAt(0) : k === "Enter" ? 13 : 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: k === " " ? 32 : k.length === 1 ? k.toUpperCase().charCodeAt(0) : k === "Enter" ? 13 : 27 });
};
const type = async (s) => { for (const c of s) await key(c, c === " " ? "Space" : `Key${c.toUpperCase()}`, c); };
const shot = async (name) => { const r = await send("Page.captureScreenshot"); writeFileSync(join(OUT, name), Buffer.from(r.result.data, "base64")); };
const results = [];
const check = (name, ok, detail) => { results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url: BASE + "/table" });
for (let i = 0; i < 50 && !(await js(`!!document.querySelector("#ql") && /on the table/.test(document.body.innerText)`)); i++) await sleep(300);
await sleep(800);
await shot("web-table.png");
const qlHidden = () => js(`document.getElementById("ql").hidden`);

// 1. Space on the canvas opens quick look, Space again closes it (the gate must not break the normal path).
const cx = 720, cy = 450;
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy });
await js(`document.activeElement?.blur(); document.body.focus()`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 4, windowsVirtualKeyCode: 65 }); // Cmd-A selects all
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 4, windowsVirtualKeyCode: 65 });
await key(" ", "Space", " ");
await sleep(60);
const qlGrow = await js(`(() => { const i = document.querySelector("#ql img"); return i && [i.getAnimations().length, Math.round(i.getBoundingClientRect().width), i.offsetWidth]; })()`);
check("Quick look grows out of the photo on the table", qlGrow && qlGrow[0] > 0 && qlGrow[1] < qlGrow[2], `animations, width now, width at rest: ${qlGrow}`);
await sleep(440);
const opened = !(await qlHidden());
check("Space on the table opens quick look", opened);
await shot("web-quicklook.png");
await key(" ", "Space", " ");
await sleep(60);
const qlShrink = await js(`(() => { const i = document.querySelector("#ql img"); return i && [i.getAnimations().length, Math.round(i.getBoundingClientRect().width), i.offsetWidth]; })()`);
check("Quick look shrinks back onto the table", qlShrink && qlShrink[0] > 0 && qlShrink[1] < qlShrink[2], `${qlShrink}`);
await sleep(340);
check("Space again closes quick look", await qlHidden());

// 1b. Space to close, then Space again while it is still shrinking: the photo comes back whole, not stuck shrunk or
// invisible (the closing flight's held end used to take over once the new one finished).
await key(" ", "Space", " ");
await sleep(500);
await key(" ", "Space", " ");
await sleep(80);
await key(" ", "Space", " ");
await sleep(700);
const reopened = await js(`(() => { const i = document.querySelector("#ql img"), s = i && getComputedStyle(i); return !document.getElementById("ql").hidden && i && [s.opacity, s.transform, Math.round(i.getBoundingClientRect().width), i.offsetWidth]; })()`);
check(
  "Quick look reopened mid-close shows the whole photo",
  reopened && reopened[0] === "1" && reopened[1] === "none" && reopened[2] === reopened[3],
  `opacity, transform, width now, width at rest: ${reopened}`,
);
await key(" ", "Space", " ");
await sleep(500);

// 2. Typing a space in the tag field must not open quick look.
const tagVisible = await js(`(() => { const t = document.getElementById("tagin"); return !!t && t.offsetParent !== null; })()`);
await js(`document.getElementById("tagin").focus()`);
await type("New York");
await sleep(400);
const tagValue = await js(`document.getElementById("tagin").value`);
check("Typing 'New York' in the tag field keeps quick look closed", await qlHidden(), `field visible=${tagVisible}, value="${tagValue}"`);
await shot("web-tag-typing.png");
await key("Escape", "Escape");
await js(`document.getElementById("tagin").value = ""; document.activeElement?.blur()`);

// 3. During a pointer gesture keys are ignored; pointercancel releases the gate.
const layoutBefore = await js(`document.querySelector("[data-layout][aria-pressed=true], [data-layout].on")?.dataset.layout ?? null`);
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 300, y: 600, button: "left", clickCount: 1 });
await key("5", "Digit5", "5");
await sleep(300);
const layoutDuring = await js(`document.querySelector("[data-layout][aria-pressed=true], [data-layout].on")?.dataset.layout ?? null`);
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 300, y: 600, button: "left", clickCount: 1 });
check("A layout key during a pointer gesture is ignored", layoutBefore === layoutDuring, `${layoutBefore} -> ${layoutDuring}`);
await key("5", "Digit5", "5");
await sleep(600);
const layoutAfter = await js(`document.querySelector("[data-layout][aria-pressed=true], [data-layout].on")?.dataset.layout ?? null`);
check("The same key works after the gesture ends", layoutAfter !== layoutDuring, `${layoutDuring} -> ${layoutAfter}`);
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 300, y: 600, button: "left", clickCount: 1 }); // real gesture starts
await key("2", "Digit2", "2");
await sleep(300);
const blocked = await js(`document.querySelector("[data-layout][aria-pressed=true]")?.dataset.layout`);
check("A key during the real gesture is ignored", blocked === "time", `-> ${blocked}`);
await js(`document.querySelector("canvas").dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }))`); // system takes the pointer
await key("3", "Digit3", "3");
await sleep(600);
const layoutCancel = await js(`document.querySelector("[data-layout][aria-pressed=true], [data-layout].on")?.dataset.layout ?? null`);
check("Keys work again after a cancelled gesture", layoutCancel === "events", `-> ${layoutCancel}`);
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 300, y: 600, button: "left", clickCount: 1 });
await shot("web-after-cancel.png");

// 4. The inspector's tag field: Enter adds the typed tag to the selection (saved at once), its chip's × removes it.
const state = async () => (await fetch(BASE + "/api/table/state")).json();
const tagged = async (w) => Object.values((await state()).tags).some((t) => t.includes(w));
const center = (sel) => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r && [r.x + r.width / 2, r.y + r.height / 2]; })()`);
const click = async (sel) => {
  const c = await center(sel);
  if (!c) return false;
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: c[0], y: c[1], button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: c[0], y: c[1], button: "left", clickCount: 1 });
  return true;
};
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 4, windowsVirtualKeyCode: 65 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 4, windowsVirtualKeyCode: 65 });
await key("t", "KeyT", "t");
await sleep(300);
check("T focuses the tag field", await js(`document.activeElement?.id === "tagin"`));
await type("checktag");
await key("Enter", "Enter", "\r");
await sleep(700);
check("Enter in the tag field saves the tag", await tagged("checktag"), `focus after: ${await js(`document.activeElement?.tagName`)}`);
await shot("web-tag-added.png");
await click('[aria-label="Remove tag checktag"]');
await sleep(700);
check("The tag chip's × removes it", !(await tagged("checktag")));

// 4b. One photo selected: "N photos in this event" opens the large photo on all N, from the clicked one.
await key("f", "KeyF", "f"); // fit: a 2024 photo sits at (720, 190)
await sleep(700);
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 720, y: 190, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 720, y: 190, button: "left", clickCount: 1 });
await sleep(400);
const inEvent = await js(`(() => { const b = [...document.querySelectorAll("button")].find((b) => /photos in this event/.test(b.textContent)); return b ? parseInt(b.textContent) : 0; })()`);
await js(`[...document.querySelectorAll("button")].find((b) => /photos in this event/.test(b.textContent))?.click()`);
await sleep(600);
const caption = await js(`document.getElementById("ql").hidden ? "" : document.getElementById("ql").innerText`);
check("'N photos in this event' opens the large photo on the whole event", inEvent > 1 && caption.includes(`of ${inEvent} ·`), `N=${inEvent}, caption: ${caption.split("·").slice(1, 2)}`);
await shot("web-view-event.png");
await key("Escape", "Escape", "");
await sleep(500);

// 5. Grid, Events step: the album field adds the event's photos to an album; the event name field names it.
await send("Page.navigate", { url: BASE + "/#events" });
for (let i = 0; i < 30 && !(await js(`/Event name/.test(document.body.innerText)`)); i++) await sleep(300);
await click('[role="radio"][aria-checked="false"]:last-of-type'); // the All filter
await sleep(500);
const field = 'input[aria-label="Add to an album"]';
await click(field);
await type("checkalbum");
await key("Enter", "Enter", "\r");
await sleep(900);
const adds = Object.values((await state()).album_adds).flat();
check("Enter in an event's album field adds it on Apply", adds.includes("checkalbum"), `album_adds=${[...new Set(adds)]}`);
check("The new album shows as a chip", await js(`/\\+ checkalbum/.test(document.body.innerText)`));
await shot("web-events-album.png");
await click('[aria-label="Take out of checkalbum"]');
await sleep(800);
check("The album chip's × takes it back", !Object.values((await state()).album_adds).flat().includes("checkalbum"));
// The place field: after a save it shows the place the event's photos now share, and a toast names the place found.
const place = 'input[aria-label="Place for the selected photos"]';
await click(place);
await type("Lisbon");
await key("Enter", "Enter", "\r");
await sleep(1500);
const placeAfter = await js(`document.querySelector('${place}').value`);
const placeToast = await js(`[...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.innerText).join(" | ")`);
check("A saved place shows in the place field", /Lisbon/.test(placeAfter), `field="${placeAfter}"`);
check("A toast names the place it found", /Place set to Lisbon/.test(placeToast), placeToast);
await shot("web-place-saved.png");
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", modifiers: 4, windowsVirtualKeyCode: 90 }); // ⌘Z: undo the place
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", modifiers: 4, windowsVirtualKeyCode: 90 });
await sleep(800);

// The large photo: a click on a strip photo opens it, → steps, Esc closes.
await click("[data-ph]");
await sleep(60);
const big = `document.querySelector("[role=dialog] img")`;
const grow = await js(`(() => { const i = ${big}; const t = document.querySelector("[data-ph] img").getBoundingClientRect(); return i && [i.getAnimations().length, Math.round(i.getBoundingClientRect().width), i.offsetWidth, Math.round(t.width)]; })()`);
check("The large photo flies out of its thumbnail", grow && grow[0] > 0 && grow[1] < grow[2], `animations, width now, at rest, thumbnail: ${grow}`);
await sleep(540);
const step1 = await js(`document.querySelector('[role=dialog]')?.innerText.match(/(\\d+) of \\d+/)?.[1]`);
await key("ArrowRight", "ArrowRight");
await sleep(300);
const step2 = await js(`document.querySelector('[role=dialog]')?.innerText.match(/(\\d+) of \\d+/)?.[1]`);
check("A strip photo opens large and → steps", step1 === "1" && step2 === "2", `${step1} -> ${step2}`);
await shot("web-photo-dialog.png");
await key("Escape", "Escape");
await sleep(60);
const back = await js(`(() => { const i = ${big}; return i && [i.getAnimations().length, Math.round(i.getBoundingClientRect().width), i.offsetWidth]; })()`);
check("Esc flies the large photo back to its thumbnail", back && back[0] > 0 && back[1] < back[2], `${back}`);
await sleep(500);
check("Esc closes the large photo", !(await js(`!!document.querySelector('[role=dialog]')`)));
// The frame takes the photo's own shape even while its large copy is still loading (no bands).
await send("Fetch.enable", { patterns: [{ urlPattern: "*s=2048*" }] }); // hold every large copy
await js(`[...document.querySelectorAll("[data-ph]")].at(-1).click()`);
await sleep(1500);
const shape = await js(`(() => { const i = document.querySelector("[role=dialog] img"), b = i.getBoundingClientRect(); return [+(b.width / b.height).toFixed(2), +(i.naturalWidth / i.naturalHeight).toFixed(2)]; })()`);
check("The large photo's frame has the photo's shape before its large copy loads", shape && Math.abs(shape[0] - shape[1]) < 0.02, `frame, photo: ${shape}`);
await send("Fetch.disable");
await key("Escape", "Escape");
await sleep(600);
// A window too narrow for the panel beside the photo (it goes underneath): the frame keeps the photo's shape too.
await send("Emulation.setDeviceMetricsOverride", { width: 760, height: 1000, deviceScaleFactor: 1, mobile: false });
await sleep(500);
await js(`document.querySelector("[data-ph]").click()`);
await sleep(1500);
const narrow = await js(`(() => { const i = document.querySelector("[role=dialog] img"), b = i.getBoundingClientRect(); return [+(b.width / b.height).toFixed(2), +(i.naturalWidth / i.naturalHeight).toFixed(2), Math.round(b.width)]; })()`);
check("In a narrow window the large photo keeps its shape", narrow && Math.abs(narrow[0] - narrow[1]) < 0.02, `frame, photo, width: ${narrow}`);
await key("Escape", "Escape");
await sleep(600);
await send("Emulation.clearDeviceMetricsOverride");
await sleep(500);
// A photo with its own GPS: nothing to set, so its place field is disabled.
await js(`[...document.querySelectorAll("[data-ph]")].find((b) => b.closest(".mt-2")?.innerText.includes("with GPS"))?.click()`);
await sleep(900);
const gpsField = await js(`(() => { const f = document.querySelector('[role=dialog] input[aria-label="Place for the selected photos"]'); return f && [f.disabled, f.placeholder]; })()`);
check("A photo with its own GPS has a disabled place field", gpsField?.[0] === true, `${gpsField}`);
await key("Escape", "Escape");
await sleep(600);

// 6. Junk page still renders.
await send("Page.navigate", { url: BASE + "/" });
for (let i = 0; i < 30 && !(await js(`/Junk/.test(document.body.innerText)`)); i++) await sleep(300);
await sleep(800);
check("Junk page renders", await js(`/Nothing is written to Photos/.test(document.body.innerText)`));
await shot("web-junk.png");

check("No console errors or exceptions", logs.length === 0, logs.join(" | ").slice(0, 300));
console.log(`${results.join("\n")}\nscreenshots: ${OUT}`);
ws.close();
chrome.kill("SIGTERM");
await sleep(500);
rmSync(profile, { recursive: true, force: true });
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
