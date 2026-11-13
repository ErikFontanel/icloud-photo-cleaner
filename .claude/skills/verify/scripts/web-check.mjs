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
await sleep(500);
const opened = !(await qlHidden());
check("Space on the table opens quick look", opened);
await shot("web-quicklook.png");
await key(" ", "Space", " ");
await sleep(400);
check("Space again closes quick look", await qlHidden());

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

// 4. Junk page still renders.
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
