// Sift Table. Every photo is one instance in a single WebGL2 draw: tiny thumbnails come from texture atlases;
// photos drawn large get a sharper copy at the size they are shown. ?demo=N draws N generated tiles instead of the
// library (used to test speed without showing photos).
// The canvas, labels and pointer/keyboard input live here; the HUD around it is React (table/app.tsx). The engine
// publishes what the HUD shows through `hud.set` and returns the actions the HUD's buttons call.
export function startTable(hud) {
  const $ = (id) => document.getElementById(id);
  const DEMO = Number(new URLSearchParams(location.search).get("demo")) || 0;
  const BORDER = 0.025,
    CELL = 1.08,
    HI_SLOTS = 256,
    HI_SIZE = 512,
    HI_MIN_PX = 90;
  const ON = 0,
    DELETE = 1,
    GONE = 3; // GONE: already written to To Delete in Photos; never shown
  // On the table: not marked, and not hidden by "Hide photos in albums".
  let hideAlbums = false,
    inAlbum = new Uint8Array(0);
  try {
    hideAlbums = localStorage.getItem("sift-hide-albums") === "1";
  } catch {
    /* default: shown */
  }
  const on = (i) => st[i] === ON && !(hideAlbums && inAlbum[i]);

  // ---------- data ----------
  let N = 0,
    uuid = [],
    looks_ = [],
    tsec,
    cl,
    grp,
    gord,
    hw,
    hh,
    uv,
    layerOf,
    x,
    y,
    rot,
    st,
    sel,
    order,
    zpos,
    hiSlot,
    hiUV,
    fav;
  let tile = 64,
    atlasSize = 2048,
    atlasCount = 0,
    key = "";

  function alloc(n) {
    N = n;
    tsec = new Float64Array(n);
    cl = new Int32Array(n);
    grp = new Int32Array(n);
    gord = new Int32Array(n);
    hw = new Float32Array(n);
    hh = new Float32Array(n);
    uv = new Float32Array(n * 4);
    layerOf = new Float32Array(n);
    x = new Float32Array(n);
    y = new Float32Array(n);
    rot = new Float32Array(n);
    st = new Uint8Array(n);
    sel = new Uint8Array(n);
    order = new Int32Array(n);
    zpos = new Int32Array(n);
    hiSlot = new Int16Array(n).fill(-1);
    hiUV = new Float32Array(n * 2);
    fav = new Uint8Array(n);
    for (let i = 0; i < n; i++) order[i] = zpos[i] = i;
  }

  function setPhoto(i, w, h) {
    const long = Math.max(w, h),
      per = atlasSize / tile,
      slot = i % (per * per);
    hw[i] = (w / long) * 0.5;
    hh[i] = (h / long) * 0.5;
    layerOf[i] = Math.floor(i / (per * per));
    uv[i * 4] = ((slot % per) * tile) / atlasSize;
    uv[i * 4 + 1] = (Math.floor(slot / per) * tile) / atlasSize;
    uv[i * 4 + 2] = w / atlasSize;
    uv[i * 4 + 3] = h / atlasSize;
  }

  async function loadManifest() {
    if (DEMO) return demoManifest(DEMO);
    for (;;) {
      const r = await fetch("/api/table");
      const m = await r.json();
      if (m.error) throw new Error(m.error);
      if (!m.building) return m;
      hud.set({ loading: `Making thumbnails: ${m.done.toLocaleString()} of ${m.total.toLocaleString()}…` });
      await new Promise((ok) => setTimeout(ok, 500));
    }
  }

  function demoManifest(n) {
    const rnd = rng(7),
      photos = [],
      aspects = [
        [4, 3],
        [3, 4],
        [16, 9],
        [1, 1],
        [9, 16],
      ];
    const t0 = Date.UTC(2010, 0, 1) / 1000,
      span = Date.UTC(2026, 10, 1) / 1000 - t0;
    for (let i = 0; i < n; i++) {
      const [a, b] = aspects[Math.floor(rnd() * aspects.length)],
        s = 64 / Math.max(a, b);
      photos.push({
        u: `demo${i}`,
        t: Math.floor(t0 + span * rnd() ** 0.6),
        w: Math.round(a * s),
        h: Math.round(b * s),
        c: Math.floor(rnd() * Math.max(1, n / 150)),
        f: 0,
      });
    }
    photos.sort((p, q) => p.t - q.t);
    const groups = [];
    for (let i = 0; i < n; ) {
      // demo events: runs of 1..80 photos, every 7th one named
      const size = 1 + Math.floor(rnd() * rnd() * 80),
        g = groups.length;
      groups.push({ label: g % 7 === 0 ? `Trip ${g}` : "", kind: g % 7 === 0 ? "trip" : "" });
      for (let k = 0; k < size && i < n; k++, i++) {
        photos[i].g = g;
        photos[i].o = Math.floor(rnd() * 1000);
      }
    }
    return { key: "demo", tile: 64, atlas: 2048, atlases: Math.ceil(n / 1024), photos, groups };
  }

  function rng(seed) {
    let s = seed >>> 0;
    return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  }

  // ---------- WebGL ----------
  const canvas = $("gl"),
    gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true, alpha: false });
  if (!gl) {
    hud.set({ loading: "This browser has no WebGL2." });
    return null;
  }
  const VS = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 corner;
  layout(location=1) in vec4 a0; // x y rot flags
  layout(location=2) in vec4 a1; // hw hh layer hiSlot
  layout(location=3) in vec4 a2; // atlas u v w h
  layout(location=4) in vec2 a3; // hi uv extent
  uniform vec2 uCam; uniform float uZoom; uniform vec2 uHalfView; uniform float uErase;
  out vec2 vLocal; flat out vec2 vHalf; flat out vec4 vUV; flat out vec2 vHiUV; flat out vec4 vInfo;
  void main() {
    float px = 1.0 / uZoom;
    float sel = mod(a0.w, 2.0);
    float b = sel > 0.5 || (a0.w >= 2.0 && uErase > 0.5) ? max(${BORDER}, 2.5 * px) : ${BORDER};
    float m = uZoom < 10.0 ? b + px : b + max(0.09, 3.0 * px);
    vec2 local = corner * (a1.xy + vec2(m));
    float c = cos(a0.z), s = sin(a0.z);
    vec2 w = a0.xy + vec2(c * local.x - s * local.y, s * local.x + c * local.y);
    vec2 clip = (w - uCam) * uZoom / uHalfView;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    vLocal = local; vHalf = a1.xy; vUV = a2; vHiUV = a3;
    vInfo = vec4(a1.z, a1.w, a0.w, b);
  }`;
  const FS = `#version 300 es
  precision highp float;
  precision highp sampler2DArray;
  uniform sampler2DArray uAtlas; uniform sampler2DArray uHi; uniform float uZoom; uniform float uErase;
  in vec2 vLocal; flat in vec2 vHalf; flat in vec4 vUV; flat in vec2 vHiUV; flat in vec4 vInfo;
  out vec4 o;
  void main() {
    vec2 d = abs(vLocal) - vHalf;
    float outside = max(d.x, d.y), b = vInfo.w, f = vInfo.z;
    if (outside <= 0.0) {
      vec2 t = vLocal / vHalf * 0.5 + 0.5;
      if (vInfo.y >= 0.0) o = texture(uHi, vec3(t * vHiUV, vInfo.y));
      else {
        vec2 inset = vec2(0.5 / ${2048}.0);
        o = texture(uAtlas, vec3(vUV.xy + clamp(t * vUV.zw, inset, vUV.zw - inset), vInfo.x));
      }
      o.a = 1.0;
    } else if (outside <= b) {
      bool sel = mod(f, 2.0) > 0.5, hover = f >= 2.0;
      o = hover && uErase > 0.5 ? vec4(1.0, 0.42, 0.37, 1.0) : sel ? vec4(0.353, 0.635, 1.0, 1.0) : hover ? vec4(1.0, 0.98, 0.93, 1.0) : vec4(0.93, 0.91, 0.87, 1.0);
    } else {
      float sd = length(max(d - vec2(b), 0.0));
      float a = 0.32 * (1.0 - smoothstep(0.0, max(0.08, 2.0 / uZoom), sd));
      o = vec4(0.0, 0.0, 0.0, a);
    }
  }`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const U = (n) => gl.getUniformLocation(prog, n);
  const uCam = U("uCam"),
    uZoom = U("uZoom"),
    uHalfView = U("uHalfView"),
    uErase = U("uErase");
  gl.uniform1i(U("uAtlas"), 0);
  gl.uniform1i(U("uHi"), 1);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  const inst = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  const STRIDE = 14;
  [
    [1, 4, 0],
    [2, 4, 4],
    [3, 4, 8],
    [4, 2, 12],
  ].forEach(([loc, size, off]) => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off * 4);
    gl.vertexAttribDivisor(loc, 1);
  });
  let instData = new Float32Array(0),
    instCount = 0;

  let atlasTex, hiTex;
  function makeTextures() {
    atlasTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlasTex);
    const levels = 7;
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, atlasSize, atlasSize, Math.max(1, atlasCount));
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, levels - 1);
    hiTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, hiTex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, HI_SIZE, HI_SIZE, HI_SLOTS);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  let mipTimer = 0;
  function putAtlas(i, source) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlasTex);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, atlasSize, atlasSize, 1, gl.RGBA, gl.UNSIGNED_BYTE, source);
    clearTimeout(mipTimer);
    mipTimer = setTimeout(() => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlasTex);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      redraw();
    }, 120);
    redraw();
  }

  async function loadAtlases(photos) {
    const jobs = [...Array(atlasCount).keys()];
    const worker = async () => {
      for (let i; (i = jobs.shift()) !== undefined; ) {
        const bmp = DEMO ? demoAtlas(i, photos) : await createImageBitmap(await (await fetch(`/api/table/atlas/${key}-${i}.jpg`)).blob());
        putAtlas(i, bmp);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  function demoAtlas(a, photos) {
    const c = new OffscreenCanvas(atlasSize, atlasSize),
      g = c.getContext("2d"),
      per = atlasSize / tile;
    g.fillStyle = "#282828";
    g.fillRect(0, 0, atlasSize, atlasSize);
    g.font = "bold 18px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (let s = 0; s < per * per; s++) {
      const i = a * per * per + s;
      if (i >= N) break;
      const p = photos[i],
        px = (s % per) * tile,
        py = Math.floor(s / per) * tile;
      g.fillStyle = `hsl(${(p.c * 47) % 360} 55% ${35 + (i % 7) * 5}%)`;
      g.fillRect(px, py, p.w, p.h);
      g.fillStyle = "#fff9";
      g.fillText(String(p.c), px + p.w / 2, py + p.h / 2);
    }
    return c.transferToImageBitmap();
  }

  // ---------- camera ----------
  let cam = { x: 0, y: 0, z: 10 },
    dpr = 1,
    vw = 0,
    vh = 0;
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    vw = innerWidth;
    vh = innerHeight;
    canvas.width = vw * dpr;
    canvas.height = vh * dpr;
    lassoCv.width = vw * dpr;
    lassoCv.height = vh * dpr;
    redraw();
  }
  const toWorld = (sx, sy) => [(sx - vw / 2) / cam.z + cam.x, (sy - vh / 2) / cam.z + cam.y];
  const toScreen = (wx, wy) => [(wx - cam.x) * cam.z + vw / 2, (wy - cam.y) * cam.z + vh / 2];
  // Where photo i is drawn on screen (unrotated): quick look grows out of it and shrinks back into it.
  const screenBox = (i) => {
    const [sx, sy] = toScreen(x[i], y[i]);
    return { left: sx - hw[i] * cam.z, top: sy - hh[i] * cam.z, width: 2 * hw[i] * cam.z, height: 2 * hh[i] * cam.z };
  };

  function fitTo(idx, animate = true) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const i of idx) {
      x0 = Math.min(x0, x[i] - 0.6);
      x1 = Math.max(x1, x[i] + 0.6);
      y0 = Math.min(y0, y[i] - 0.6);
      y1 = Math.max(y1, y[i] + 0.6);
    }
    if (!Number.isFinite(x0)) return;
    const z = Math.min(800, Math.min(vw / (x1 - x0), (vh - 150) / (y1 - y0)) * 0.92);
    flyCam((x0 + x1) / 2, (y0 + y1) / 2 + 20 / z, z, animate);
  }
  let camAnim = null;
  function flyCam(tx, ty, tz, animate) {
    if (!animate) {
      cam = { x: tx, y: ty, z: tz };
      redraw();
      return;
    }
    camAnim = { from: { ...cam }, to: { x: tx, y: ty, z: tz }, t0: performance.now(), dur: 450 };
    redraw();
  }

  // ---------- animation of photos ----------
  let anim = null;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  function animateTo(idx, tx, ty, tr, dur = 600) {
    finishAnim();
    const n = idx.length,
      sx = new Float32Array(n),
      sy = new Float32Array(n),
      sr = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      sx[k] = x[idx[k]];
      sy[k] = y[idx[k]];
      sr[k] = rot[idx[k]];
    }
    anim = { idx, sx, sy, sr, tx, ty, tr, t0: performance.now(), dur };
    redraw();
  }
  function finishAnim() {
    if (!anim) return;
    const { idx, tx, ty, tr } = anim;
    for (let k = 0; k < idx.length; k++) {
      x[idx[k]] = tx[k];
      y[idx[k]] = ty[k];
      rot[idx[k]] = tr[k];
    }
    anim = null;
    gridDirty = true;
  }
  function stepAnim(now) {
    const { idx, sx, sy, sr, tx, ty, tr, t0, dur } = anim;
    const t = Math.min(1, (now - t0) / dur),
      e = ease(t);
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      x[i] = sx[k] + (tx[k] - sx[k]) * e;
      y[i] = sy[k] + (ty[k] - sy[k]) * e;
      rot[i] = sr[k] + (tr[k] - sr[k]) * e;
    }
    if (t >= 1) {
      anim = null;
      gridDirty = true;
    }
  }

  // ---------- spatial grid for picking ----------
  const GCELL = 1.5;
  let grid = new Map(),
    gridDirty = true;
  const gkey = (cx, cy) => (cx + 32768) * 65536 + (cy + 32768);
  function rebuildGrid() {
    grid = new Map();
    for (let i = 0; i < N; i++) {
      if (!on(i)) continue;
      const r = Math.max(hw[i], hh[i]) * 1.42 + BORDER;
      const cx0 = Math.floor((x[i] - r) / GCELL),
        cx1 = Math.floor((x[i] + r) / GCELL);
      const cy0 = Math.floor((y[i] - r) / GCELL),
        cy1 = Math.floor((y[i] + r) / GCELL);
      for (let cx = cx0; cx <= cx1; cx++)
        for (let cy = cy0; cy <= cy1; cy++) {
          const k = gkey(cx, cy);
          let a = grid.get(k);
          if (!a) grid.set(k, (a = []));
          a.push(i);
        }
    }
    gridDirty = false;
  }
  function pick(sx, sy) {
    if (gridDirty && !anim) rebuildGrid();
    const [wx, wy] = toWorld(sx, sy);
    const cands = grid.get(gkey(Math.floor(wx / GCELL), Math.floor(wy / GCELL))) || [];
    let best = -1,
      bz = -1;
    for (const i of cands) {
      if (!on(i)) continue;
      const dx = wx - x[i],
        dy = wy - y[i],
        c = Math.cos(rot[i]),
        s = Math.sin(rot[i]);
      const lx = c * dx + s * dy,
        ly = -s * dx + c * dy;
      if (Math.abs(lx) <= hw[i] + BORDER && Math.abs(ly) <= hh[i] + BORDER && zpos[i] > bz) {
        best = i;
        bz = zpos[i];
      }
    }
    return best;
  }

  // ---------- drawing ----------
  let needDraw = true,
    hover = -1,
    frames = 0,
    fpsT = performance.now(),
    busyMs = 0;
  function redraw() {
    needDraw = true;
  }
  let ground = [0.11, 0.114, 0.122];
  function readGround() {
    // the table colour follows the light/dark ground (index.css --background)
    const hex = getComputedStyle(document.documentElement).getPropertyValue("--background").trim().replace("#", "");
    if (hex.length === 6) ground = [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);
    redraw();
  }
  addEventListener("themechange", readGround);
  readGround();
  function buildInstances() {
    if (instData.length !== N * STRIDE) instData = new Float32Array(N * STRIDE);
    let n = 0;
    for (let k = 0; k < N; k++) {
      const i = order[k];
      if (!on(i)) continue;
      const o = n * STRIDE;
      instData[o] = x[i];
      instData[o + 1] = y[i];
      instData[o + 2] = rot[i];
      instData[o + 3] = sel[i] + (i === hover ? 2 : 0);
      instData[o + 4] = hw[i];
      instData[o + 5] = hh[i];
      instData[o + 6] = layerOf[i];
      instData[o + 7] = hiSlot[i];
      instData[o + 8] = uv[i * 4];
      instData[o + 9] = uv[i * 4 + 1];
      instData[o + 10] = uv[i * 4 + 2];
      instData[o + 11] = uv[i * 4 + 3];
      instData[o + 12] = hiUV[i * 2];
      instData[o + 13] = hiUV[i * 2 + 1];
      n++;
    }
    instCount = n;
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    gl.bufferData(gl.ARRAY_BUFFER, instData.subarray(0, n * STRIDE), gl.DYNAMIC_DRAW);
  }
  function frame(now) {
    if (camAnim) {
      const t = Math.min(1, (now - camAnim.t0) / camAnim.dur),
        e = ease(t),
        a = camAnim.from,
        b = camAnim.to;
      const lz = Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * e;
      cam = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, z: Math.exp(lz) };
      if (t >= 1) camAnim = null;
      needDraw = true;
    }
    if (anim) {
      stepAnim(now);
      needDraw = true;
    }
    if (needDraw && N) {
      const t0 = performance.now();
      needDraw = false;
      buildInstances();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(...ground, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(uCam, cam.x, cam.y);
      gl.uniform1f(uZoom, cam.z);
      gl.uniform2f(uHalfView, vw / 2, vh / 2);
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instCount);
      placeLabels();
      busyMs = busyMs * 0.9 + (performance.now() - t0) * 0.1;
      frames++;
      scheduleHi();
    }
    if (now - fpsT > 500) {
      $("fps").textContent =
        `${instCount.toLocaleString()} photos · ${frames ? `${Math.round((frames * 1000) / (now - fpsT))} fps` : "idle"} · ${busyMs.toFixed(1)} ms/frame`;
      frames = 0;
      fpsT = now;
    }
    requestAnimationFrame(frame);
  }

  // ---------- sharp copies for photos drawn large ----------
  const slotOwner = new Int32Array(HI_SLOTS).fill(-1),
    slotUsed = new Float64Array(HI_SLOTS);
  let hiLoaded,
    hiPending = new Set(),
    hiTimer = 0;
  function scheduleHi() {
    clearTimeout(hiTimer);
    hiTimer = setTimeout(updateHi, 150);
  }
  function updateHi() {
    if (anim || camAnim || cam.z < HI_MIN_PX) return;
    const [x0, y0] = toWorld(0, 0),
      [x1, y1] = toWorld(vw, vh),
      want = [],
      px = Math.min(HI_SIZE, Math.ceil(cam.z * dpr));
    let visible = 0;
    for (let i = 0; i < N; i++) {
      if (!on(i) || x[i] < x0 - 1 || x[i] > x1 + 1 || y[i] < y0 - 1 || y[i] > y1 + 1) continue;
      if (++visible > HI_SLOTS - 16) return; // more on screen than slots: keep the atlas copies rather than churn
      if (hiLoaded[i] >= px * 0.75 || hiPending.has(i)) {
        if (hiSlot[i] >= 0) slotUsed[hiSlot[i]] = performance.now();
        continue;
      }
      want.push(i);
    }
    const cx = cam.x,
      cy = cam.y;
    want.sort((a, b) => (x[a] - cx) ** 2 + (y[a] - cy) ** 2 - ((x[b] - cx) ** 2 + (y[b] - cy) ** 2));
    want.slice(0, Math.max(0, 8 - hiPending.size)).forEach(loadHi);
  }
  async function loadHi(i) {
    const px = Math.min(HI_SIZE, 2 ** Math.ceil(Math.log2(cam.z * dpr)));
    hiPending.add(i);
    try {
      const bmp = DEMO ? demoHi(i, px) : await createImageBitmap(await (await fetch(`/thumb/${uuid[i]}?s=${px}`)).blob());
      let slot = hiSlot[i];
      if (slot < 0) {
        slot = 0;
        for (let s = 1; s < HI_SLOTS; s++) if (slotUsed[s] < slotUsed[slot]) slot = s;
        if (slotOwner[slot] >= 0) {
          hiSlot[slotOwner[slot]] = -1;
          hiLoaded[slotOwner[slot]] = 0;
        }
      }
      slotOwner[slot] = i;
      slotUsed[slot] = performance.now();
      hiSlot[i] = slot;
      hiLoaded[i] = Math.max(bmp.width, bmp.height);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, hiTex);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, slot, bmp.width, bmp.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
      hiUV[i * 2] = bmp.width / HI_SIZE;
      hiUV[i * 2 + 1] = bmp.height / HI_SIZE;
      redraw();
    } finally {
      hiPending.delete(i);
      scheduleHi();
    }
  }
  function demoHi(i, px) {
    const w = Math.round(hw[i] * 2 * px),
      h = Math.round(hh[i] * 2 * px),
      c = new OffscreenCanvas(w, h),
      g = c.getContext("2d");
    g.fillStyle = `hsl(${(cl[i] * 47) % 360} 55% ${35 + (i % 7) * 5}%)`;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#fffc";
    g.font = `bold ${Math.round(h / 5)}px sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(`#${i}`, w / 2, h / 2 - h / 8);
    g.font = `${Math.round(h / 10)}px sans-serif`;
    g.fillText(`cluster ${cl[i]}`, w / 2, h / 2 + h / 6);
    return c.transferToImageBitmap();
  }

  // ---------- layouts ----------
  let layout = "events",
    labels = [],
    groups = [];
  function onTable() {
    const a = [];
    for (let i = 0; i < N; i++) if (on(i)) a.push(i);
    return a;
  }
  function gridPositions(idx, ox, oy, cols) {
    const tx = new Float32Array(idx.length),
      ty = new Float32Array(idx.length);
    idx.forEach((_, k) => {
      tx[k] = ox + (k % cols) * CELL;
      ty[k] = oy + Math.floor(k / cols) * CELL;
    });
    return [tx, ty];
  }
  function members() {
    // event pile -> its photos on the table, in the pile's look order
    const m = new Map();
    for (let i = 0; i < N; i++)
      if (on(i)) {
        let a = m.get(grp[i]);
        if (!a) m.set(grp[i], (a = []));
        a.push(i);
      }
    for (const a of m.values()) a.sort((p, q) => gord[p] - gord[q] || tsec[p] - tsec[q]);
    return m;
  }
  const day = (t, year) => new Date(t * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });
  function pileText(g, a) {
    let t0 = Infinity,
      t1 = -Infinity;
    for (const i of a) {
      t0 = Math.min(t0, tsec[i]);
      t1 = Math.max(t1, tsec[i]);
    }
    const sameYear = new Date(t0 * 1000).getFullYear() === new Date(t1 * 1000).getFullYear();
    const when = groups[g].kind === "undated" ? "" : day(t1, true) === day(t0, true) ? day(t0, true) : `${day(t0, !sameYear)}–${day(t1, true)}`;
    return [groups[g].name || groups[g].label, when, String(a.length)].filter(Boolean).join(" · ");
  }
  // A name you set becomes an album on Apply; a suggested one (rule or model) is shown until you confirm it with R.
  const named = (g) => Boolean(groups[g].name) || (Boolean(groups[g].label) && groups[g].kind !== "undated");
  // One block per event pile, in time order, wrapped into rows; each year starts a new band. Undated piles come last.
  function eventBlocks(mem) {
    const GAP = 1.4,
      LABEL = 1.0,
      list = [];
    for (const [g, a] of mem) {
      let t = Infinity;
      for (const i of a) t = Math.min(t, tsec[i]);
      const cols = Math.ceil(Math.sqrt(a.length * 1.4));
      list.push({ g, a, t, cols, w: cols * CELL, h: Math.ceil(a.length / cols) * CELL, undated: groups[g].kind === "undated" });
    }
    list.sort((p, q) => p.undated - q.undated || p.t - q.t);
    const area = list.reduce((s, b) => s + (b.w + GAP) * (b.h + GAP + LABEL), 0),
      rowW = Math.sqrt((area * vw) / (vh - 150));
    let cx = 0,
      cy = 0,
      rowH = 0,
      band = null;
    for (const b of list) {
      const yr = b.undated ? "No date" : String(new Date(b.t * 1000).getFullYear());
      if (yr !== band) {
        if (band !== null) cy += rowH + 4;
        cx = 0;
        rowH = 0;
        band = yr;
        b.year = yr;
        b.yearY = cy;
      } else if (cx > 0 && cx + b.w > rowW) {
        cx = 0;
        cy += rowH + GAP;
        rowH = 0;
      }
      b.x = cx;
      b.y = cy + LABEL;
      cx += b.w + GAP;
      rowH = Math.max(rowH, b.h + LABEL);
    }
    return list;
  }
  const piled = () => layout === "events" || layout === "pile";
  // The box tipped out on the table: one loose heap per event, heaps placed along a spiral from the oldest at the
  // centre to the newest at the rim, each at the first free spot after the previous one, so neighbours are close in time.
  function pileHeaps(pos) {
    const r = rng(11),
      CELLS = 4,
      placed = new Map(),
      PITCH = 1.6;
    const heaps = [...members()]
      .map(([g, a]) => {
        let t = Infinity;
        for (const i of a) t = Math.min(t, tsec[i]);
        return { g, a, t, R: Math.sqrt(a.length) * 0.34, undated: groups[g].kind === "undated" };
      })
      .sort((p, q) => p.undated - q.undated || p.t - q.t);
    const free = (x0, y0, rad) => {
      for (let cx = Math.floor((x0 - rad) / CELLS); cx <= Math.floor((x0 + rad) / CELLS); cx++)
        for (let cy = Math.floor((y0 - rad) / CELLS); cy <= Math.floor((y0 + rad) / CELLS); cy++)
          for (const c of placed.get(cx * 100003 + cy) || []) if ((c[0] - x0) ** 2 + (c[1] - y0) ** 2 < (c[2] + rad) ** 2) return false;
      return true;
    };
    let th = 0;
    for (const h of heaps) {
      const rad = h.R + 0.9;
      let px, py;
      for (;;) {
        const rr = (PITCH * th) / 6.2832;
        px = Math.cos(th) * rr;
        py = Math.sin(th) * rr;
        if (free(px, py, rad)) break;
        th += 0.35 / Math.max(rr, 1);
      }
      for (let cx = Math.floor((px - rad) / CELLS); cx <= Math.floor((px + rad) / CELLS); cx++)
        for (let cy = Math.floor((py - rad) / CELLS); cy <= Math.floor((py + rad) / CELLS); cy++) {
          const k = cx * 100003 + cy;
          if (!placed.has(k)) placed.set(k, []);
          placed.get(k).push([px, py, rad]);
        }
      h.a.forEach((i) => {
        const a = r() * 6.2832,
          d = h.R * Math.sqrt(r());
        pos.set(i, [px + Math.cos(a) * d, py + Math.sin(a) * d, (r() - 0.5) * 0.8]);
      });
      labels.push({ x: px, y: py - h.R - 0.6, g: h.g, center: true });
    }
  }
  function applyLayout(name, animate = true, fly = true) {
    layout = name;
    try {
      history.replaceState(null, "", `#${name}`);
    } catch {
      /* the hash is only a convenience */
    }
    hud.set({ layout: name });
    const idx = onTable(),
      n = idx.length,
      tx = new Float32Array(n),
      ty = new Float32Array(n),
      tr = new Float32Array(n),
      pos = new Map();
    labels = [];
    if (name === "pile") pileHeaps(pos);
    else if (name === "events") {
      for (const b of eventBlocks(members())) {
        if (b.year) labels.push({ x: -1, y: b.yearY + 1.2, text: b.year, cls: "year" });
        b.a.forEach((i, k) => pos.set(i, [b.x + (k % b.cols) * CELL, b.y + Math.floor(k / b.cols) * CELL, 0]));
        labels.push({ x: b.x - 0.5, y: b.y - 0.5, g: b.g });
      }
    } else if (name === "look") {
      const looks = new Map();
      for (const i of idx) {
        if (!looks.has(cl[i])) looks.set(cl[i], []);
        looks.get(cl[i]).push(i);
      }
      const rowW = Math.sqrt(n * CELL * CELL) * 1.25;
      let cx = 0,
        cy = 0,
        rowH = 0;
      for (const c of [...looks.keys()].sort((a, b) => a - b)) {
        const g = looks.get(c).sort((a, b) => tsec[a] - tsec[b]),
          cols = Math.ceil(Math.sqrt(g.length * 1.4));
        const w = cols * CELL,
          h = Math.ceil(g.length / cols) * CELL;
        if (cx > 0 && cx + w > rowW) {
          cx = 0;
          cy += rowH + 1.6;
          rowH = 0;
        }
        g.forEach((i, k) => pos.set(i, [cx + (k % cols) * CELL, cy + Math.floor(k / cols) * CELL, 0]));
        labels.push({ x: cx - 0.5, y: cy - 0.65, text: looks_[c] || "Mixed", min: 7 });
        cx += w + 1.6;
        rowH = Math.max(rowH, h);
      }
    } else {
      const months = new Map();
      for (const i of idx) {
        const d = new Date(tsec[i] * 1000),
          k = d.getFullYear() * 12 + d.getMonth();
        if (!months.has(k)) months.set(k, []);
        months.get(k).push(i);
      }
      const yearsOf = new Map();
      for (const [k, g] of months) {
        const yr = Math.floor(k / 12);
        yearsOf.set(yr, Math.max(yearsOf.get(yr) || 0, g.length));
      }
      let COLS = 4; // month width chosen so the whole layout comes out about as wide as the screen
      for (let c = 4; c <= 60; c++) {
        let h = 0;
        for (const m of yearsOf.values()) h += Math.ceil(m / c) * CELL + 3.5;
        COLS = c;
        if ((12 * (c * CELL + 2.2)) / h >= vw / (vh - 150)) break;
      }
      const BW = COLS * CELL + 2.2,
        names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      let cy = 0;
      for (const yr of [...yearsOf.keys()].sort((a, b) => a - b)) {
        let rowH = 0;
        for (let m = 0; m < 12; m++) {
          const g = months.get(yr * 12 + m);
          if (!g) continue;
          g.sort((a, b) => tsec[a] - tsec[b]);
          g.forEach((i, k) => pos.set(i, [m * BW + (k % COLS) * CELL, cy + Math.floor(k / COLS) * CELL, 0]));
          labels.push({ x: m * BW - 0.5, y: cy - 0.7, text: `${names[m]} · ${g.length}`, min: 3 });
          rowH = Math.max(rowH, Math.ceil(g.length / COLS) * CELL);
        }
        labels.push({ x: -1, y: cy + 0.5, text: String(yr), cls: "year" });
        cy += rowH + 3.5;
      }
    }
    idx.forEach((i, k) => {
      const p = pos.get(i);
      tx[k] = p[0];
      ty[k] = p[1];
      tr[k] = p[2];
    });
    renderLabelEls();
    if (animate) animateTo(Int32Array.from(idx), tx, ty, tr, 900);
    else {
      idx.forEach((i, k) => {
        x[i] = tx[k];
        y[i] = ty[k];
        rot[i] = tr[k];
      });
      gridDirty = true;
    }
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (let k = 0; k < n; k++) {
      x0 = Math.min(x0, tx[k]);
      x1 = Math.max(x1, tx[k]);
      y0 = Math.min(y0, ty[k]);
      y1 = Math.max(y1, ty[k]);
    }
    if (name === "events" || name === "time") x0 -= 8; // room for the year labels
    if (n && fly) flyCam((x0 + x1) / 2, (y0 + y1) / 2, Math.min(vw / (x1 - x0 + 4), (vh - 150) / (y1 - y0 + 4)), animate);
    status();
  }

  let labelEls = [];
  function renderLabelEls() {
    $("labels").replaceChildren(
      ...(labelEls = labels.map((l) => {
        const d = document.createElement("div");
        if (l.text) d.textContent = l.text;
        if (l.cls) d.className = l.cls;
        return d;
      })),
    );
    refreshLabels();
  }
  function refreshLabels() {
    // pile labels follow merges, renames and marks
    const mem = members();
    labels.forEach((l, k) => {
      if (l.g === undefined) return;
      const a = mem.get(l.g);
      l.gone = !a;
      if (a) {
        labelEls[k].textContent = pileText(l.g, a);
        labelEls[k].className = groups[l.g].name ? "ev album" : named(l.g) ? "ev" : "";
        l.min = named(l.g) ? 2 : 4;
        l.pri = (named(l.g) ? 1e6 : 0) + a.length;
        l.w = 0;
      }
    });
    redraw();
  }
  // Labels are placed by priority (years, named events, bigger piles); one that would overlap a placed label waits
  // until zooming in makes room.
  const measure = document.createElement("canvas").getContext("2d");
  function placeLabels() {
    const cand = [];
    labelEls.forEach((el, k) => {
      const l = labels[k],
        [sx, sy] = toScreen(l.x, l.y);
      if (!l.gone && cam.z > (l.min || 0) && sx > -300 && sx < vw + 300 && sy > -50 && sy < vh + 50) {
        if (!l.w) {
          measure.font = getComputedStyle(el).font || "600 12px sans-serif";
          l.w = measure.measureText(el.textContent).width + 8;
        }
        const w = l.w,
          h = l.cls === "year" ? 34 : 17;
        const x0 = l.cls === "year" ? sx - w : l.center ? sx - w / 2 : sx;
        cand.push({ k, sx, sy, x0, x1: x0 + w, y0: sy - h, y1: sy, pri: l.cls === "year" ? 1e9 : l.pri || 0 });
      } else el.style.display = "none";
    });
    cand.sort((a, b) => b.pri - a.pri);
    const CELL_PX = 60,
      occ = new Map(),
      cells = (c, fn) => {
        for (let gx = Math.floor(c.x0 / CELL_PX); gx <= Math.floor(c.x1 / CELL_PX); gx++)
          for (let gy = Math.floor(c.y0 / CELL_PX); gy <= Math.floor(c.y1 / CELL_PX); gy++) if (fn(gx * 4099 + gy) === false) return false;
        return true;
      };
    for (const c of cand) {
      const el = labelEls[c.k],
        l = labels[c.k];
      const free = cells(c, (key) => !(occ.get(key) || []).some((o) => o.x0 < c.x1 && c.x0 < o.x1 && o.y0 < c.y1 && c.y0 < o.y1));
      el.style.display = free ? "" : "none";
      if (!free) continue;
      cells(c, (key) => {
        if (!occ.has(key)) occ.set(key, []);
        occ.get(key).push(c);
      });
      el.style.transform = `translate(${c.sx}px, ${c.sy - 16}px)${l.cls === "year" ? " translateX(-100%)" : l.center ? " translateX(-50%)" : ""}`;
    }
  }

  // ---------- events: merge, new, rename ----------
  function moveToPile(idx, g) {
    if (piled()) {
      // reflow, so the grown pile pushes later piles along instead of covering them
      snapshot(idx);
      undoStack[undoStack.length - 1].reflow = true;
      idx.forEach((i) => {
        grp[i] = g;
      });
      applyLayout(layout, true, false);
      status();
      return;
    }
    const mine = members().get(g) || [],
      anchor = mine.length ? mine : idx;
    const all = [...new Set([...mine, ...idx])].sort((p, q) => tsec[p] - tsec[q]);
    let x0 = Infinity,
      y0 = Infinity;
    anchor.forEach((i) => {
      x0 = Math.min(x0, x[i]);
      y0 = Math.min(y0, y[i]);
    });
    const cols = Math.ceil(Math.sqrt(all.length * 1.4)),
      rows = Math.ceil(all.length / cols);
    gather(all, [x0 + ((cols - 1) * CELL) / 2, y0 + ((rows - 1) * CELL) / 2]); // records grp before the change, for undo
    idx.forEach((i) => {
      grp[i] = g;
    });
    let l = labels.find((l) => l.g === g);
    if (!l) {
      labels.push((l = { g }));
      renderLabelEls();
    }
    l.x = x0 - 0.5;
    l.y = y0 - 0.5;
    refreshLabels();
    status();
  }
  function merge() {
    const idx = selected();
    if (!idx.length) return;
    const count = new Map();
    idx.forEach((i) => count.set(grp[i], (count.get(grp[i]) || 0) + 1));
    const rank = (g) => (groups[g].name ? 2 : named(g) ? 1 : 0); // your name beats a suggestion beats none
    const ranked = [...count.keys()].sort((a, b) => rank(b) - rank(a) || count.get(b) - count.get(a));
    moveToPile(idx, ranked[0]);
    save(idx);
    status(`Merged ${count.size} piles into one event: ${pileText(ranked[0], members().get(ranked[0]))}`);
  }
  function newEvent() {
    const idx = selected();
    if (!idx.length) return;
    groups.push({ key: `new-${Date.now()}`, label: "", kind: "new" });
    moveToPile(idx, groups.length - 1);
    save(idx);
    startRename(groups.length - 1);
  }
  let renaming = -1; // the event R or N names; else the one most of the selection is in
  function startRename(g) {
    if (g === undefined) {
      const idx = selected();
      if (!idx.length) return;
      const c = new Map();
      idx.forEach((i) => c.set(grp[i], (c.get(grp[i]) || 0) + 1));
      g = [...c.keys()].sort((a, b) => c.get(b) - c.get(a))[0];
    }
    renaming = g;
    inspect();
    hud.focus("evname");
  }
  // The inspector's name field: the event's name becomes its album's name on Apply.
  async function setName(value) {
    const g = hud.get().selection?.g;
    if (g === undefined) return;
    groups[g].name = value;
    refreshLabels();
    inspect();
    pending((await api("/api/table/name", { pile: groups[g].key, name: value })).pending);
  }

  // ---------- selection, actions, undo ----------
  const undoStack = [];
  function selected() {
    const a = [];
    for (let i = 0; i < N; i++) if (sel[i] && on(i)) a.push(i);
    return a;
  }
  function snapshot(idx) {
    undoStack.push({
      idx: Int32Array.from(idx),
      x: Float32Array.from(idx, (i) => x[i]),
      y: Float32Array.from(idx, (i) => y[i]),
      r: Float32Array.from(idx, (i) => rot[i]),
      st: Uint8Array.from(idx, (i) => st[i]),
      g: Int32Array.from(idx, (i) => grp[i]),
    });
    if (undoStack.length > 50) undoStack.shift();
  }
  function undo() {
    const s = undoStack.pop();
    if (!s) return;
    finishAnim();
    s.idx.forEach((i, k) => {
      st[i] = s.st[k];
      grp[i] = s.g[k];
    });
    save(Array.from(s.idx));
    note = "";
    if (s.reflow && piled()) {
      applyLayout(layout, true, false);
      counts();
      return;
    }
    const back = [];
    s.idx.forEach((_i, k) => {
      if (s.st[k] === ON) back.push(k);
    });
    animateTo(
      Int32Array.from(back, (k) => s.idx[k]),
      Float32Array.from(back, (k) => s.x[k]),
      Float32Array.from(back, (k) => s.y[k]),
      Float32Array.from(back, (k) => s.r[k]),
      400,
    );
    gridDirty = true;
    counts();
    status();
    refreshLabels();
  }
  function toTop(idx) {
    const set = new Set(idx);
    let k = 0;
    const rest = [];
    for (const i of order) if (!set.has(i)) rest.push(i);
    for (const i of rest) order[k++] = i;
    for (const i of idx) order[k++] = i;
    order.forEach((i, z) => {
      zpos[i] = z;
    });
  }
  function gather(idx, at) {
    if (!idx.length) return;
    snapshot(idx);
    toTop(idx);
    let cx = 0,
      cy = 0;
    idx.forEach((i) => {
      cx += x[i];
      cy += y[i];
    });
    cx /= idx.length;
    cy /= idx.length;
    if (at) [cx, cy] = at;
    const cols = Math.ceil(Math.sqrt(idx.length * 1.5)),
      rows = Math.ceil(idx.length / cols);
    const [tx, ty] = gridPositions(idx, cx - ((cols - 1) * CELL) / 2, cy - ((rows - 1) * CELL) / 2, cols);
    animateTo(Int32Array.from(idx), tx, ty, new Float32Array(idx.length), 500);
  }
  function mark(idx) {
    if (!idx.length) return;
    snapshot(idx);
    idx.forEach((i) => {
      st[i] = DELETE;
      sel[i] = 0;
    });
    gridDirty = true;
    counts();
    status("");
    refreshLabels();
    save(idx);
    const tray = $("tray");
    tray?.classList.add("hot");
    setTimeout(() => tray?.classList.remove("hot"), 250);
  }
  function restoreTray() {
    const idx = [];
    for (let i = 0; i < N; i++) if (st[i] === DELETE) idx.push(i);
    if (!idx.length) return;
    snapshot(idx);
    const before = undoStack.pop(); // undo sends them back to the tray
    sel.fill(0);
    idx.forEach((i) => {
      st[i] = ON;
      sel[i] = 1;
    });
    gather(idx, [cam.x, cam.y]);
    undoStack[undoStack.length - 1] = before;
    gridDirty = true;
    counts();
    status();
    save(idx);
  }
  async function pullSimilar() {
    const idx = selected();
    if (!idx.length) return;
    let near;
    if (DEMO) {
      const want = new Set(idx.map((i) => cl[i]));
      near = [];
      for (let i = 0; i < N && near.length < 60; i++) if (on(i) && !sel[i] && want.has(cl[i])) near.push(i);
    } else {
      const sample = idx.length > 40 ? idx.filter((_, k) => k % Math.ceil(idx.length / 40) === 0) : idx;
      const off = [];
      for (let i = 0; i < N; i++) if (!on(i)) off.push(uuid[i]);
      say("Finding similar photos…");
      const r = await (
        await fetch("/api/table/similar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uuids: sample.map((i) => uuid[i]), n: 60, exclude: off }),
        })
      ).json();
      const index = new Map(uuid.map((u, i) => [u, i]));
      near = r.uuids.map((u) => index.get(u)).filter((i) => i !== undefined && !sel[i]);
    }
    near.forEach((i) => {
      sel[i] = 1;
    });
    const all = [...idx, ...near];
    let cx = 0,
      cy = 0;
    idx.forEach((i) => {
      cx += x[i];
      cy += y[i];
    });
    gather(all, [cx / idx.length, cy / idx.length]);
    status(`Pulled in ${near.length} similar photos. ⇧-click the ones that don't belong, then ⌫, M or A.`);
  }

  // ---------- HUD ----------
  let note = "";
  function say(t) {
    note = t;
    status();
  }
  function status(t) {
    if (t !== undefined) note = t;
    let n = 0,
      s = 0;
    for (let i = 0; i < N; i++)
      if (on(i)) {
        n++;
        if (sel[i]) s++;
      }
    hud.set({ status: `${n.toLocaleString()} on the table${s ? ` · ${s.toLocaleString()} selected` : ""}${note ? ` · ${note}` : ""}` });
    inspect();
  }
  function counts() {
    let a = 0;
    for (let i = 0; i < N; i++) if (st[i] === DELETE) a++;
    hud.set({ deleteCount: a });
  }

  // ---------- quick look ----------
  let qlList = [],
    qlAt = 0;
  function quickLook(i) {
    const s = selected();
    qlList = s.length > 1 && s.includes(i) ? s.sort((a, b) => tsec[a] - tsec[b]) : [i];
    qlAt = qlList.indexOf(i);
    showQL();
  }
  function showQL() {
    if (!qlList.length) return closeQL();
    qlAt = Math.max(0, Math.min(qlAt, qlList.length - 1));
    const i = qlList[qlAt];
    let src = `/thumb/${uuid[i]}?s=1600`;
    if (DEMO) {
      const c = document.createElement("canvas"),
        b = demoHi(i, 900);
      c.width = b.width;
      c.height = b.height;
      c.getContext("2d").drawImage(b, 0, 0);
      src = c.toDataURL();
    }
    const was = hud.get().ql;
    hud.set({
      ql: {
        src,
        caption: `${new Date(tsec[i] * 1000).toLocaleString()} · ${qlAt + 1} of ${qlList.length} · ←/→ browse · ⌫ To Delete · Space close`,
        aspect: hw[i] / hh[i],
        at: qlAt,
        i,
        from: was && !was.closing ? undefined : screenBox(i), // opening: grow out of the photo
      },
    });
  }
  // The HUD shrinks the photo back onto the table (`to`), then clears ql.
  function closeQL() {
    const i = qlList[qlAt],
      ql = hud.get().ql;
    qlList = [];
    if (ql && !ql.closing) hud.set({ ql: { ...ql, closing: true, to: i !== undefined && on(i) ? screenBox(i) : null } });
  }

  // ---------- shared state: saved at once, the same decisions the Grid review uses ----------
  let tagsOf = new Map(),
    albumsOf = new Map(),
    addsOf = new Map(),
    lastApply = null;
  async function api(path, body) {
    if (DEMO) return demoApi(path, body);
    const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j;
  }
  const demoPlaces = new Map();
  function demoApi(path, body) {
    // the demo keeps tags, albums and places in the page only
    if (path === "/api/table/place") body.uuids.forEach((u) => (body.city ? demoPlaces.set(u, body.city) : demoPlaces.delete(u)));
    if (path === "/api/table/place-info") {
      const by = new Map();
      body.uuids.forEach((u) => {
        const c = demoPlaces.get(u) || "";
        by.set(c, [...(by.get(c) || []), u]);
      });
      return { spots: [...by].map(([c, us]) => ({ city: c || "Kyoto", country: c ? "" : "JP", set: !!c, from: "the demo", uuids: us })) };
    }
    if (path === "/api/table/tags")
      body.uuids.forEach((u) => {
        const t = new Set(tagsOf.get(u) || []);
        body.add?.forEach((w) => t.add(w));
        body.remove?.forEach((w) => t.delete(w));
        tagsOf.set(u, [...t]);
      });
    if (path === "/api/table/album")
      body.uuids.forEach((u) => {
        const a = new Set(addsOf.get(u) || []);
        body.remove ? a.delete(body.album) : a.add(body.album);
        addsOf.set(u, [...a]);
      });
    const tags = Object.fromEntries(tagsOf),
      adds = Object.fromEntries(addsOf);
    return {
      pending: { delete: 0, renames: 0, albums: 0, album_photos: 0, keywords: 0 },
      marked: [],
      gone: [],
      pile_of: {},
      names: {},
      tags,
      albums: {},
      album_adds: adds,
      album_removes: {},
      tag_index: [...new Set(Object.values(tags).flat())].sort(),
      album_index: [...new Set(Object.values(adds).flat())].sort(),
      runs: [],
    };
  }
  function takeState(s) {
    tagsOf = new Map(Object.entries(s.tags));
    albumsOf = new Map(Object.entries(s.albums));
    addsOf = new Map(Object.entries(s.album_adds));
    inAlbum = new Uint8Array(N);
    const index = new Map(uuid.map((u, i) => [u, i]));
    for (const u of albumsOf.keys()) {
      const i = index.get(u);
      if (i !== undefined) inAlbum[i] = 1;
    }
    hud.set({ st: s });
    pending(s.pending);
    inspect();
  }
  async function loadState() {
    const s = await api("/api/table/state"),
      index = new Map(uuid.map((u, i) => [u, i])),
      keyOf = new Map(groups.map((g, i) => [g.key, i]));
    for (const u of s.marked) {
      const i = index.get(u);
      if (i !== undefined) st[i] = DELETE;
    }
    for (const u of s.gone) {
      const i = index.get(u);
      if (i !== undefined) st[i] = GONE;
    }
    for (const [u, key] of Object.entries(s.pile_of)) {
      const i = index.get(u);
      if (i === undefined) continue;
      if (!keyOf.has(key)) {
        groups.push({ key, label: "", kind: "new" });
        keyOf.set(key, groups.length - 1);
      }
      grp[i] = keyOf.get(key);
    }
    for (const [key, name] of Object.entries(s.names)) if (keyOf.has(key)) groups[keyOf.get(key)].name = name;
    takeState(s);
  }
  let saving = Promise.resolve();
  function save(idx) {
    // marks and pile moves, in order, so a quick undo can't overtake its change
    const body = { marked: [], restored: [], piles: {} };
    for (const i of idx) {
      (st[i] === DELETE ? body.marked : body.restored).push(uuid[i]);
      body.piles[uuid[i]] = groups[grp[i]].key;
    }
    saving = saving
      .then(() => api("/api/table/sync", body))
      .then((r) => pending(r.pending))
      .catch((err) => say(`Not saved: ${err.message}`));
  }

  // ---------- apply to Photos ----------
  let pend = { delete: 0, renames: 0, albums: 0, album_photos: 0, keywords: 0 };
  function pending(p) {
    if (p) pend = p;
    hud.set({ pending: pend, lastApply: !!lastApply });
  }
  // Apply to Photos (the HUD asks first and shows progress): waits for the last save, then writes everything saved.
  async function apply() {
    await saving;
    const r = await api("/api/table/apply", {});
    lastApply = Object.values(r.result)
      .map((x) => x.run)
      .filter(Boolean);
    const index = new Map(uuid.map((u, i) => [u, i]));
    for (const u of r.gone) {
      const i = index.get(u);
      if (i !== undefined) st[i] = GONE;
    }
    counts();
    takeState(r);
    gridDirty = true;
    redraw();
    return `Written: ${Object.entries(r.result)
      .map(
        ([k, v]) =>
          `${k} ${v.added ?? 0} added${v.keywords ? `, ${v.keywords} keywords` : ""}${v.renamed ? `, ${v.renamed} renamed` : ""}${v.locations ? `, ${v.locations} pins` : ""}${v.favorites ? `, ${v.favorites} favourites` : ""}${v.refused ? `, ${v.refused} refused` : ""}`,
      )
      .join(" · ")}`;
  }
  async function undoApply() {
    say("Undoing the last apply in Photos…");
    try {
      for (const run of [...lastApply].reverse()) await api("/api/undo", { run });
      lastApply = null;
      location.reload(); // marks come back as undecided, as in the Grid review
    } catch (err) {
      say(err.message);
    }
  }

  // ---------- inspector: the HUD shows the event, place, tags and albums of the selection ----------
  function inspect() {
    const idx = selected();
    if (!idx.length || mode === "drag") {
      hud.set({ selection: null });
      return;
    }
    const piles = new Map();
    for (const i of idx) piles.set(grp[i], (piles.get(grp[i]) || 0) + 1);
    if (!piles.has(renaming)) renaming = -1;
    const g = renaming >= 0 ? renaming : [...piles.keys()].sort((a, b) => piles.get(b) - piles.get(a))[0];
    const pileUuids = (members().get(g) || []).map((i) => uuid[i]);
    hud.set({
      selection: {
        g,
        uuids: idx.map((i) => uuid[i]),
        pileUuids,
        name: groups[g].name || "",
        label: groups[g].label || "",
        events: piles.size,
      },
    });
  }
  function focusInspect(id) {
    if (!selected().length) return say("Select photos first");
    inspect();
    hud.focus(id);
  }

  // ---------- eraser: click or drag over photos to mark them To Delete ----------
  let erasing = false,
    stroke = [];
  function setEraser(on) {
    erasing = on;
    hud.set({ erasing: on });
    canvas.classList.toggle("erasing", on);
    gl.uniform1f(uErase, on ? 1 : 0);
    say(on ? "Eraser: click or drag over photos to mark them To Delete. E or Esc to stop." : "");
    redraw();
  }
  function erase(i) {
    if (i < 0 || !on(i)) return;
    stroke.push({ i, x: x[i], y: y[i], r: rot[i], g: grp[i] });
    st[i] = DELETE;
    sel[i] = 0;
    gridDirty = true;
    redraw();
  }
  function endStroke() {
    if (!stroke.length) return;
    const idx = stroke.map((s) => s.i);
    undoStack.push({
      idx: Int32Array.from(idx),
      x: Float32Array.from(stroke, (s) => s.x),
      y: Float32Array.from(stroke, (s) => s.y),
      r: Float32Array.from(stroke, (s) => s.r),
      st: new Uint8Array(idx.length),
      g: Int32Array.from(stroke, (s) => s.g),
    });
    stroke = [];
    counts();
    status("");
    refreshLabels();
    save(idx);
  }

  // ---------- input ----------
  const lassoCv = $("lasso"),
    lg = lassoCv.getContext("2d");
  let mode = null,
    last = null,
    lasso = [],
    moved = false,
    spaceDown = false,
    spaceUsed = false,
    dragStartSnap = false,
    hotTray = null;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    hud.set({ help: false }); // ? brings it back
    last = [e.clientX, e.clientY];
    moved = false;
    if (spaceDown || e.button === 1) {
      mode = "pan";
      spaceUsed = true;
      canvas.classList.add("panning");
      return;
    }
    finishAnim();
    const hit = pick(e.clientX, e.clientY);
    if (erasing) {
      mode = "erase";
      erase(hit);
      return;
    }
    if (hit >= 0) {
      if (e.shiftKey || e.metaKey) sel[hit] = sel[hit] ? 0 : 1;
      else if (!sel[hit]) {
        sel.fill(0);
        sel[hit] = 1;
      }
      if (sel[hit]) {
        mode = "drag";
        dragStartSnap = false;
        canvas.classList.add("dragging");
      } else mode = null;
      status();
      redraw();
    } else {
      mode = "lasso";
      lasso = [[e.clientX, e.clientY]];
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = [e.clientX, e.clientY];
    if (!mode) {
      const h = pick(p[0], p[1]);
      if (h !== hover) {
        hover = h;
        canvas.classList.toggle("over", h >= 0);
        redraw();
      }
      return;
    }
    const dx = p[0] - last[0],
      dy = p[1] - last[1];
    if (Math.abs(dx) + Math.abs(dy) > 0) moved = true;
    if (mode === "pan") {
      cam.x -= dx / cam.z;
      cam.y -= dy / cam.z;
      camAnim = null;
      redraw();
    } else if (mode === "erase") {
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 6));
      for (let k = 1; k <= steps; k++) erase(pick(last[0] + (dx * k) / steps, last[1] + (dy * k) / steps));
    } else if (mode === "drag") {
      const idx = selected();
      if (!dragStartSnap) {
        snapshot(idx);
        toTop(idx);
        dragStartSnap = true;
      }
      for (const i of idx) {
        x[i] += dx / cam.z;
        y[i] += dy / cam.z;
      }
      gridDirty = true;
      redraw();
      const t = document.elementFromPoint(p[0], p[1]);
      const tray = t?.closest("#tray");
      if (tray !== hotTray) {
        hotTray?.classList.remove("hot");
        hotTray = tray;
        tray?.classList.add("hot");
      }
    } else if (mode === "lasso") {
      lasso.push(p);
      drawLasso();
    }
    last = p;
  });
  canvas.addEventListener("pointerup", (e) => {
    if (mode === "erase") endStroke();
    else if (mode === "lasso") {
      if (lasso.length > 3 && moved) selectLasso(e.shiftKey ? 1 : e.altKey ? -1 : 0);
      else if (!e.shiftKey) {
        sel.fill(0);
        status();
        redraw();
      }
      lasso = [];
      drawLasso();
    } else if (mode === "drag") {
      if (hotTray) {
        hotTray.classList.remove("hot");
        hotTray = null;
        const idx = selected();
        if (idx.length) {
          const before = undoStack.pop(); // undo puts them back where the drag started
          mark(idx);
          undoStack[undoStack.length - 1] = before;
        }
      } else if (!moved && !(e.shiftKey || e.metaKey)) {
        const hit = pick(e.clientX, e.clientY);
        if (hit >= 0) {
          sel.fill(0);
          sel[hit] = 1;
          status();
        }
      } else if (!moved && dragStartSnap) undoStack.pop();
    }
    mode = null;
    canvas.classList.remove("dragging", "panning");
    redraw();
    inspect();
  });
  canvas.addEventListener("pointercancel", () => {
    // the system took the pointer (app switch, gesture): end without a drop, so the keys never stay blocked
    if (mode === "erase") endStroke();
    lasso = [];
    drawLasso();
    hotTray?.classList.remove("hot");
    hotTray = null;
    mode = null;
    canvas.classList.remove("dragging", "panning");
    redraw();
  });
  canvas.addEventListener("dblclick", (e) => {
    const h = pick(e.clientX, e.clientY);
    if (h >= 0) quickLook(h);
  });

  function drawLasso() {
    lg.setTransform(dpr, 0, 0, dpr, 0, 0);
    lg.clearRect(0, 0, vw, vh);
    if (lasso.length < 2) return;
    lg.beginPath();
    lg.moveTo(...lasso[0]);
    for (const p of lasso) lg.lineTo(...p);
    lg.closePath();
    lg.fillStyle = "rgba(90,162,255,0.10)";
    lg.fill();
    lg.setLineDash([5, 4]);
    lg.strokeStyle = "#5aa2ff";
    lg.lineWidth = 1.5;
    lg.stroke();
  }
  function selectLasso(modeSel) {
    const poly = lasso.map(([sx, sy]) => toWorld(sx, sy));
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const [px, py] of poly) {
      x0 = Math.min(x0, px);
      x1 = Math.max(x1, px);
      y0 = Math.min(y0, py);
      y1 = Math.max(y1, py);
    }
    if (modeSel === 0) sel.fill(0);
    for (let i = 0; i < N; i++) {
      if (!on(i) || x[i] < x0 || x[i] > x1 || y[i] < y0 || y[i] > y1) continue;
      let inside = false;
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const [ax, ay] = poly[a],
          [bx, by] = poly[b];
        if (ay > y[i] !== by > y[i] && x[i] < ((bx - ax) * (y[i] - ay)) / (by - ay) + ax) inside = !inside;
      }
      if (inside) sel[i] = modeSel === -1 ? 0 : 1;
    }
    status("");
    redraw();
  }

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      camAnim = null;
      const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
      if (e.ctrlKey || mouseWheel) {
        const [wx, wy] = toWorld(e.clientX, e.clientY);
        const z = Math.max(0.5, Math.min(Math.min(vw, vh) * 0.9, cam.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.002))));
        cam.x = wx - (e.clientX - vw / 2) / z;
        cam.y = wy - (e.clientY - vh / 2) / z;
        cam.z = z;
      } else {
        cam.x += e.deltaX / cam.z;
        cam.y += e.deltaY / cam.z;
      }
      redraw();
    },
    { passive: false },
  );

  addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, textarea, [role=dialog], [role=alertdialog]")) return; // typing in the HUD
    if (e.key === " ") {
      e.preventDefault();
      if (!e.repeat) {
        spaceDown = true;
        spaceUsed = false;
      }
      return;
    }
    if (mode) return; // no key changes selection, layout or undo during a pointer gesture
    const ql = qlList.length > 0;
    if (ql) {
      if (e.key === "ArrowRight") {
        qlAt++;
        showQL();
      } else if (e.key === "ArrowLeft") {
        qlAt--;
        showQL();
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        const i = qlList[qlAt];
        mark([i]);
        qlList.splice(qlAt, 1);
        showQL();
      } else if (e.key === "Escape") closeQL();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "z") {
      e.preventDefault();
      undo();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "a") {
      e.preventDefault();
      for (let i = 0; i < N; i++) sel[i] = on(i) ? 1 : 0;
      status("");
      redraw();
    } else if (e.metaKey || e.ctrlKey) return;
    else if (e.key === "Escape") {
      if (erasing) setEraser(false);
      sel.fill(0);
      status("");
      redraw();
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      mark(selected());
    } else if (e.key === "e") setEraser(!erasing);
    else if (e.key === "h") setHideAlbums(!hideAlbums);
    else if (e.key === "t") {
      e.preventDefault();
      focusInspect("tagin");
    } else if (e.key === "a") {
      e.preventDefault();
      focusInspect("albumin");
    } else if (e.key === "l") {
      e.preventDefault();
      focusInspect("placein");
    } else if (e.key === "g") gather(selected());
    else if (e.key === "s") pullSimilar();
    else if (e.key === "f") fitTo(onTable());
    else if (e.key === "z") fitTo(selected());
    else if (e.key === "1") location.href = "/";
    else if (e.key === "2") applyLayout("pile");
    else if (e.key === "3") applyLayout("events");
    else if (e.key === "4") applyLayout("look");
    else if (e.key === "5") applyLayout("time");
    else if (e.key === "m") merge();
    else if (e.key === "n") newEvent();
    else if (e.key === "r") {
      e.preventDefault();
      startRename();
    } else if (e.key === "?") hud.set({ help: !hud.get().help });
  });
  addEventListener("keyup", (e) => {
    if (e.key !== " " || e.target.closest?.("input, textarea")) return; // a space typed in a field
    spaceDown = false;
    if (!spaceUsed && !qlList.length) {
      const s = selected();
      const i = hover >= 0 ? hover : s[0];
      if (i !== undefined && i >= 0) quickLook(i);
    } else if (!spaceUsed) closeQL();
  });
  function setHideAlbums(v) {
    hideAlbums = v;
    try {
      localStorage.setItem("sift-hide-albums", v ? "1" : "0");
    } catch {
      /* not remembered */
    }
    hud.set({ hideAlbums: v });
    for (let i = 0; i < N; i++) if (!on(i)) sel[i] = 0;
    gridDirty = true;
    applyLayout(layout, true, false);
    refreshLabels();
    status(v ? "Photos already in an album are hidden" : "");
  }
  addEventListener("resize", resize);

  // ---------- start ----------
  (async () => {
    try {
      const m = await loadManifest();
      key = m.key;
      tile = m.tile;
      atlasSize = m.atlas;
      atlasCount = m.atlases;
      alloc(m.photos.length);
      hiLoaded = new Float32Array(N);
      groups = m.groups;
      looks_ = m.looks || [];
      m.photos.forEach((p, i) => {
        uuid[i] = p.u;
        tsec[i] = p.t;
        cl[i] = p.c;
        grp[i] = p.g;
        gord[i] = p.o;
        fav[i] = p.f;
        setPhoto(i, p.w, p.h);
      });
      makeTextures();
      resize();
      hud.set({ loading: null });
      await loadState();
      hud.set({ hideAlbums });
      const start = location.hash.slice(1);
      applyLayout(["pile", "events", "look", "time"].includes(start) ? start : "events", false);
      requestAnimationFrame(frame);
      counts();
      const t0 = performance.now();
      await loadAtlases(m.photos);
      status(`thumbnails loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    } catch (err) {
      hud.set({ loading: `Could not start: ${err.message}` });
    }
  })();
  return {
    layout: (name) => applyLayout(name),
    fit: () => fitTo(onTable()),
    undo,
    eraser: () => setEraser(!erasing),
    hideAlbums: () => setHideAlbums(!hideAlbums),
    restoreTray,
    closeQL,
    apply,
    undoApply,
    takeState,
    pending,
    setName,
    say,
    api,
  };
}
