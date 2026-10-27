// Motion mock for the cards. Every card keeps its screenshot as the still frame: it is what shows
// before the loop is ready, under reduced motion, and if anything here fails. A loop only runs while
// its card is on screen and the tab is visible.

const mqRM = window.matchMedia("(prefers-reduced-motion: reduce)");
const DPR = Math.min(2, window.devicePixelRatio || 1);
const smooth = (k) => k * k * (3 - 2 * k);
const approach = (dt, rate) => 1 - Math.exp(-dt * rate);

// One scheduler for every card. A piece is { card, frame(now, dt), still() }.
const pieces = [];
function register(piece) {
  piece.inView = false;
  piece.running = false;
  piece.last = 0;
  pieces.push(piece);
  io.observe(piece.card);
  piece.still();
}
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const p = pieces.find((x) => x.card === e.target);
    if (p) p.inView = e.isIntersecting;
  }
  schedule();
}, { rootMargin: "80px 0px" });
function schedule() {
  for (const p of pieces) {
    const run = !mqRM.matches && p.inView && !document.hidden;
    if (run === p.running) continue;
    p.running = run;
    p.card.dataset.motion = run ? "running" : "paused";
    if (run) { p.last = performance.now(); requestAnimationFrame((t) => tick(p, t)); }
    else p.still();
  }
}
function tick(p, now) {
  if (!p.running) return;
  const dt = Math.min(0.05, (now - p.last) / 1000);
  p.last = now;
  p.frame(now, dt);
  requestAnimationFrame((t) => tick(p, t));
}
document.addEventListener("visibilitychange", schedule);
mqRM.addEventListener("change", schedule);

// A canvas laid exactly over the card's screenshot. The screenshot stays in the flow so the card
// keeps its size and its rounded top; the canvas only paints over it.
function overlay(card, img, cls = "") {
  const c = document.createElement("canvas");
  c.className = "motion-layer " + cls;
  c.setAttribute("aria-hidden", "true");
  card.classList.add("has-motion");
  card.append(c);
  const place = () => {
    c.style.top = img.offsetTop + "px";
    c.style.left = img.offsetLeft + "px";
    c.style.width = img.offsetWidth + "px";
    c.style.height = img.offsetHeight + "px";
    const w = Math.round(img.offsetWidth * DPR), h = Math.round(img.offsetHeight * DPR);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  };
  new ResizeObserver(place).observe(img);
  place();
  return c;
}

// The full-resolution frame, decoded once, so the canvas can repaint parts of it.
function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.decoding = "async";
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}
// The colour of the screenshot's own ground at one point, read from its pixels.
function sample(img, x, y) {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const g = c.getContext("2d");
  g.drawImage(img, x, y, 1, 1, 0, 0, 1, 1);
  const d = g.getImageData(0, 0, 1, 1).data;
  return `rgb(${d[0]},${d[1]},${d[2]})`;
}
// The breathing still's disc, from its pixels: the centroid of the pixels more than 101 levels (sum of |r|+|g|+|b|)
// off the ground at (60, 300) in the frame's middle (x 340 to 780, y 200 to 510, under the title and above the foot
// on both stills so far), and its edge, the first ring past the disc's own area radius whose mean distance from the
// ground is under 8, so the soft rim goes with it. f7c92fd's still reads (562.8, 342.3), area radius 100, edge 113;
// 1ab2a74's read (559.6, 376.6), 94, 99. Nothing else is drawn within r 170 of either.
function discOf(img) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, W, H).data;
  const at = (x, y) => (y * W + x) * 4;
  const gr = [0, 1, 2].map((i) => d[at(60, 300) + i]);
  const off = (i) => Math.abs(d[i] - gr[0]) + Math.abs(d[i + 1] - gr[1]) + Math.abs(d[i + 2] - gr[2]);
  let n = 0, sx = 0, sy = 0;
  for (let y = 200; y < 510; y++) for (let x = 340; x < 780; x++) if (off(at(x, y)) > 101) { n++; sx += x; sy += y; }
  const cx = sx / n, cy = sy / n, r = Math.sqrt(n / Math.PI);
  const sum = new Float64Array(171), cnt = new Uint32Array(171);
  for (let y = Math.max(0, Math.floor(cy - 170)); y < Math.min(H, cy + 170); y++)
    for (let x = Math.max(0, Math.floor(cx - 170)); x < Math.min(W, cx + 170); x++) {
      const k = Math.floor(Math.hypot(x - cx, y - cy));
      if (k <= 170) { sum[k] += off(at(x, y)); cnt[k]++; }
    }
  let edge = Math.ceil(r);
  while (edge < 170 && sum[edge] >= 8 * cnt[edge]) edge++;
  return { cx, cy, r, edge };
}

/* ---------- breathe: the disc runs box breathing, four in, four hold, four out, four hold ---------- */

async function breathe(card) {
  const img = card.querySelector("img");
  const src = await loadImage("img/breathe-1120.webp");
  const c = overlay(card, img);
  const g = c.getContext("2d");
  const IW = 1120, IH = 700;
  // The disc in the 1120 frame, measured from img/breathe-1120.webp's own pixels each load (discOf), so a re-shot
  // still cannot leave the canvas painting the old disc. Twice a number kept in this file went stale: 560, 302, 152
  // after 1ab2a74 re-shot the still (Levi 10-25: "the circle isnt circular"), then 560, 377, 95 after f7c92fd moved
  // the disc to about (563, 342), r 100, and the card filled a ground circle 35px low under a crescent of the real disc.
  const { cx: CX, cy: CY, edge: E } = discOf(src);
  const ground = sample(src, 60, 300);
  // breathe.html's box exercise: where each phase ends, 0 empty to 1 full.
  const phases = [{ s: 4, d: 1 }, { s: 4, d: 1 }, { s: 4, d: 0 }, { s: 4, d: 0 }];
  const cycle = phases.reduce((a, p) => a + p.s, 0);
  const at = (t) => {
    t %= cycle;
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      if (t < p.s) {
        const from = phases[(i + phases.length - 1) % phases.length].d;
        return from + (p.d - from) * smooth(t / p.s);
      }
      t -= p.s;
    }
    return 0;
  };
  // The loop starts at T0, and the disc is painted at its captured size there, so the first frame matches the still.
  const T0 = 2.6;
  const scaleOf = (v) => (0.55 + 0.45 * v) / (0.55 + 0.45 * at(T0));
  function paint(v) {
    const k = c.width / IW;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.drawImage(src, 0, 0);
    g.fillStyle = ground;
    g.beginPath(); g.arc(CX, CY, E + 4, 0, Math.PI * 2); g.fill();
    const s = scaleOf(v);
    g.save();
    g.beginPath(); g.arc(CX, CY, E * s, 0, Math.PI * 2); g.clip();
    g.translate(CX, CY); g.scale(s, s); g.translate(-CX, -CY);
    g.drawImage(src, CX - E - 4, CY - E - 4, 2 * E + 8, 2 * E + 8, CX - E - 4, CY - E - 4, 2 * E + 8, 2 * E + 8);
    g.restore();
  }
  let t = T0;
  register({
    card,
    frame(now, dt) { t += dt; paint(at(t)); },
    still() { c.classList.toggle("is-live", false); },
  });
  const show = () => c.classList.add("is-live");
  // The canvas only covers the screenshot once it is painting.
  const orig = pieces[pieces.length - 1].frame;
  pieces[pieces.length - 1].frame = (n, d) => { orig(n, d); show(); };
}

/* ---------- journey: the orb glows on its breath and the dust around it drifts toward a finger ---------- */

/* ---------- still: the live "intention is a muscle." scene from still.html ---------- */

// The attention scene's code, as it is in work-cards 685a189 still.html (class Attention: onResize and draw, and the
// constants they read), run in that page's own 1280 by 800 frame, the frame tools/shots.mjs shoots the card picture
// at, and scaled onto the card, so the card shows the page's frame. The page scrubs it with the scroll; the card plays
// it on a clock from the first time it comes into view, then holds on the line, and the pointer pushes the points as it
// does on the page. The mast and the line under it are the card picture's own pixels, laid over the points as the
// page's copy sits over its canvas.
const NIGHT_INK = "#EDEDED";
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
// still.html's own face, from the same pinned URL that page loads, so the line is sampled from the same glyphs.
const ASPEKTA = "https://cdn.jsdelivr.net/gh/ivodolenc/aspekta@cd08efde1a0484c3626818ac59a6933e59f71531/packages/fonts/variable/AspektaVF.woff2";

class Attention {
  constructor(w, h) { this.w = w; this.h = h; this.pts = null; this.px = -1e4; this.py = -1e4; }
  // still.html 685a189, Attention.onResize, unchanged.
  onResize() {
    // Sample the target line into points. Step widens until the count is kind.
    const line = "intention is a muscle.";
    const off = document.createElement("canvas");
    const c = off.getContext("2d");
    let size = Math.min(64, this.w * 0.078);
    c.font = `600 ${size}px Aspekta, sans-serif`;
    const tw = c.measureText(line).width;
    if (tw > this.w * 0.92) size *= (this.w * 0.92) / tw;
    off.width = Math.ceil(this.w); off.height = Math.ceil(size * 1.6);
    c.font = `600 ${size}px Aspekta, sans-serif`;
    c.textBaseline = "middle";
    c.fillStyle = "#fff";
    c.fillText(line, (off.width - c.measureText(line).width) / 2, off.height / 2);
    const img = c.getImageData(0, 0, off.width, off.height).data;
    let step = 3, pts;
    do {
      pts = [];
      for (let y = 0; y < off.height; y += step)
        for (let x = 0; x < off.width; x += step)
          if (img[(y * off.width + x) * 4 + 3] > 128) pts.push([x, y]);
      step++;
    } while (pts.length > 1900);
    const oy = this.h / 2 - off.height / 2;
    this.pts = pts.map(([x, y], i) => ({
      tx: x, ty: y + oy,
      sx: hash(i * 2 + 9) * this.w,
      sy: hash(i * 2 + 10) * this.h,
      d: hash(i * 3 + 4) * 0.25,      // per-point convergence delay
      ox: 0, oy: 0,                    // pointer offset, decays
    }));
  }
  // still.html 685a189, Attention.draw, unchanged.
  draw(t, interactive) {
    if (!this.pts) return;
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = NIGHT_INK;
    for (const p of this.pts) {
      const k = clamp01((t - p.d) / (1 - p.d));
      const e = k * k * (3 - 2 * k);
      let x = lerp(p.sx, p.tx, e), y = lerp(p.sy, p.ty, e);
      if (interactive) {
        const dx = x - this.px, dy = y - this.py, d2 = dx * dx + dy * dy;
        if (d2 < 80 * 80) { const d = Math.sqrt(d2) || 1, f = (80 - d) / 80 * 30; p.ox += dx / d * f * 0.2; p.oy += dy / d * f * 0.2; }
        p.ox *= 0.86; p.oy *= 0.86;
        x += p.ox; y += p.oy;
      }
      c.fillRect(x, y, 1.7, 1.7);
    }
  }
}

async function still(card) {
  const img = card.querySelector("img");
  // Under reduced motion the card paints one settled frame, the line formed, and holds it: no gather, no pointer and no
  // glow. The picture is the still until then. Scaled down to the card, the picture's thin glyphs lose most of their
  // light (the line peaks at 254 in still-1120.webp and paints about 99 at 1x), and the drawn points keep it.
  const FW = 1280, FH = 800;                 // still.html's frame, as tools/shots.mjs shoots it
  const face = new FontFace("Aspekta", `url(${ASPEKTA}) format("woff2")`, { weight: "100 900" });
  const [src] = await Promise.all([loadImage("img/still-1120.webp"), face.load().then((f) => document.fonts.add(f)).catch(() => {})]);
  // The card picture's own copy, the mast and the line under the scene, cut from its ground into ink with coverage,
  // so it sits over the points the way the page's copy sits over its canvas. The scene's own line band stays empty.
  const ground = [10, 10, 10];              // still.html --night, the page's ground
  const k0 = src.naturalWidth / FW, band = [372 - 12, 419 + 12];   // the line's rows in the 1280 by 800 frame, padded
  const copy = document.createElement("canvas");
  copy.width = src.naturalWidth; copy.height = src.naturalHeight;
  const cg = copy.getContext("2d", { willReadFrequently: true });
  cg.drawImage(src, 0, 0);
  const cd = cg.getImageData(0, 0, copy.width, copy.height);
  const ink = [143, 143, 143];               // still.html --night-muted, the mast's and the sub's colour
  for (let i = 0; i < cd.data.length; i += 4) {
    const y = (i / 4 / copy.width | 0) / k0;
    // The webp lifts the ground a level or two; under 4 percent coverage is that, not copy.
    const c = (cd.data[i + 1] - ground[1]) / (ink[1] - ground[1]);
    const a = y > band[0] && y < band[1] || c < 0.04 ? 0 : Math.min(1, c);
    cd.data[i] = ink[0]; cd.data[i + 1] = ink[1]; cd.data[i + 2] = ink[2]; cd.data[i + 3] = Math.round(a * 255);
  }
  cg.putImageData(cd, 0, 0);

  const box = document.createElement("div");
  box.className = "motion-loop motion-scene";
  box.setAttribute("aria-hidden", "true");
  box.style.setProperty("--scene-ground", `rgb(${ground.join(",")})`);
  const gl = glow(box);
  const win = document.createElement("div");
  win.className = "motion-window";
  const cv = document.createElement("canvas");
  win.append(cv);
  box.append(win);
  card.classList.add("has-motion");
  card.append(box);
  const g = cv.getContext("2d");
  const scene = new Attention(FW, FH);
  scene.ctx = g;
  scene.onResize();
  let settled = false;
  const place = () => {
    box.style.top = img.offsetTop + "px";
    box.style.left = img.offsetLeft + "px";
    box.style.width = img.offsetWidth + "px";
    box.style.height = img.offsetHeight + "px";
    if (settled) settle();
  };
  new ResizeObserver(place).observe(img);
  place();
  const arm = (e) => {
    const r = win.getBoundingClientRect();
    scene.px = (e.clientX - r.left) / r.width * FW;
    scene.py = (e.clientY - r.top) / r.height * FH;
  };
  card.addEventListener("pointermove", arm);
  card.addEventListener("pointerdown", arm);
  card.addEventListener("pointerleave", () => { scene.px = scene.py = -1e4; });
  const GATHER = 3.2;                        // seconds from scattered to the line; then it holds
  let t = 0;
  function frame(k, interactive) {
    const W = win.offsetWidth, H = win.offsetHeight;
    const w = Math.round(W * DPR), h = Math.round(H * DPR);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    g.setTransform(w / FW, 0, 0, h / FH, 0, 0);
    scene.draw(k, interactive);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(copy, 0, 0, w, h);
    return [W, H, w, h];
  }
  // The settled frame: every point on the line, no pointer, painted once (and again only if the card is resized).
  function settle() {
    frame(1, false);
    settled = true;
    box.classList.add("is-settled");
  }
  function paint(dt) {
    const [W, H, w, h] = frame(Math.min(1, t / GATHER), true);
    // In both themes the frame runs edge to edge, like the 3D and breathing cards' pictures (Levi 10-25 b10e5c45), and
    // the glow lifts the scene's own ground under the points.
    gl.place(0, 0, W, H, 1, 1, box.offsetWidth * 0.06);
    gl.draw(cv, 0, 0, w, h, ground, true, dt);
  }
  register({
    card,
    frame(now, dt) {
      if (settled) { settled = false; box.classList.remove("is-settled"); }
      t += dt; paint(dt); box.classList.add("is-live"); gl.wrap.classList.add("is-live");
    },
    // Off screen or in a hidden tab it keeps its place; under reduced motion it holds the settled frame, with no glow.
    still() { if (mqRM.matches) { box.classList.remove("is-live"); gl.wrap.classList.remove("is-live"); settle(); } },
  });
}

/* ---------- olmec: form.html's viewer cut to one object, turned by a drag, swaying when left alone ---------- */

async function olmec(card) {
  const img = card.querySelector("img");
  const src = await loadImage("img/form-1120.webp");
  // The canvas covers only the head's part of the screenshot, so the page around it stays.
  const box = document.createElement("div");
  box.className = "motion-olmec";
  card.classList.add("has-motion");
  card.append(box);
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  box.append(canvas);
  box.style.background = sample(src, 160, 600);
  const place = () => {
    // x 148..628 and y 110..630 of the 1120 by 700 frame. The head in the still is at x 217..559 and y 140..601 since
    // form.html's layout B (work-cards 1ab2a74), so the box must cover all of it, or the still's own head shows beside
    // the drawn one.
    const k = img.offsetWidth / 1120;
    box.style.left = img.offsetLeft + 148 * k + "px";
    box.style.top = img.offsetTop + 110 * k + "px";
    box.style.width = 480 * k + "px";
    box.style.height = 520 * k + "px";
  };
  new ResizeObserver(place).observe(img);
  place();

  const THREE = await import("three");
  const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([
    import("three/addons/loaders/GLTFLoader.js"),
    import("three/addons/loaders/DRACOLoader.js"),
  ]);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: DPR < 2, alpha: true, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(DPR);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 30);
  const DIST = 4;
  camera.position.set(0, 0, DIST);
  const group = new THREE.Group();
  scene.add(group);
  scene.add(new THREE.AmbientLight(0xffffff, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 3.4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.8);
  fill.position.set(-2.5, -1, 2);
  scene.add(fill);

  const draco = new DRACOLoader();
  draco.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/");
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync("./assets/playground/olmec-head.glb");
  draco.dispose();
  const skin = gltf.scene;
  const root = new THREE.Group();
  const bb = new THREE.Box3().setFromObject(skin);
  const size = bb.getSize(new THREE.Vector3());
  root.scale.setScalar(2 / Math.max(size.x, size.y, size.z));
  skin.position.copy(bb.getCenter(new THREE.Vector3())).multiplyScalar(-1);
  root.add(skin);
  skin.traverse((o) => {
    if (o.isMesh && o.material && o.material.map && !o.material.userData.trimmed) {
      o.material.color.multiplyScalar(0.62);
      o.material.userData.trimmed = true;
    }
  });
  group.add(root);

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const tanHalf = Math.tan(camera.fov * Math.PI / 360);
    group.scale.setScalar(Math.min(0.78 * DIST * tanHalf * camera.aspect, 0.78 * DIST * tanHalf));
    draw();
  }

  const TAU = Math.PI * 2, SWAY = 0.6, SWAY_PERIOD = 14;
  const SPIN_REST = { x: 0.16, y: 0.5 };
  const spin = { x: SPIN_REST.x, y: SPIN_REST.y, vel: 0, dragging: false, lastX: 0, lastY: 0, lastT: 0, idle: 1, moved: 0 };
  const light = { az: -0.7, el: 0.55 };
  let sway = 0;
  function step(dt) {
    if (!spin.dragging) {
      spin.vel *= Math.exp(-dt * 1.9);
      if (Math.abs(spin.vel) < 0.14) spin.idle += (1 - spin.idle) * approach(dt, 0.8);
      spin.x += (SPIN_REST.x - spin.x) * approach(dt, 0.3);
    }
    sway += dt * spin.idle;
    const home = SPIN_REST.y + TAU * Math.round((spin.y - SPIN_REST.y) / TAU);
    const target = home + SWAY * Math.sin(sway * TAU / SWAY_PERIOD);
    spin.y += spin.vel * dt + (target - spin.y) * approach(dt, 0.6) * spin.idle;
  }
  function draw() {
    group.rotation.set(spin.x, spin.y, 0);
    key.position.setFromSphericalCoords(4, Math.PI / 2 - light.el, light.az);
    renderer.render(scene, camera);
  }

  // A drag turns the head; a tap still opens the page. Vertical swipes scroll, so a phone can pass it.
  canvas.addEventListener("pointerdown", (e) => {
    spin.dragging = true; spin.vel = 0; spin.idle = 0; spin.moved = 0;
    spin.lastX = e.clientX; spin.lastY = e.clientY; spin.lastT = performance.now();
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    light.az = ((e.clientX - r.left) / r.width - 0.5) * 2.6;
    light.el = (0.5 - (e.clientY - r.top) / r.height) * 1.6 + 0.4;
    if (spin.dragging) {
      const now = performance.now(), dt = Math.max(8, now - spin.lastT);
      const dx = e.clientX - spin.lastX, dy = e.clientY - spin.lastY;
      spin.moved += Math.abs(dx) + Math.abs(dy);
      spin.y += dx * 0.009;
      spin.x = Math.min(0.9, Math.max(-0.9, spin.x + dy * 0.004));
      spin.vel = spin.vel + (dx / dt * 7 - spin.vel) * 0.4;
      spin.lastX = e.clientX; spin.lastY = e.clientY; spin.lastT = now;
    }
    if (!piece.running) draw();
  });
  const release = () => { spin.dragging = false; if (mqRM.matches) { spin.vel = 0; draw(); } };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  card.addEventListener("click", (e) => {
    if (spin.moved > 8) { e.preventDefault(); spin.moved = 0; }
  }, true);

  new ResizeObserver(resize).observe(canvas);
  resize();
  box.classList.add("is-live");
  const piece = {
    card,
    frame(now, dt) { step(dt); draw(); },
    still() { draw(); },
  };
  register(piece);
}

/* ---------- ambient: the plate takes a soft, enlarged, blurred copy of the frame playing right now ---------- */

// Drawn from the live frame at 12 by 16 pixels, eased over time so it drifts rather than flickers, and blown up and
// blurred by CSS. On a dark plate it adds the frame's colour and light to the plate's own colour; on a light plate
// it multiplies the frame's colour in, so the plate takes a tinted shade. One strength in both themes: the lightest of the three compared.
const AMBIENT = 0.3;
const TW = 12, TH = 16;
const LIGHT_SAT = 1.6, LIGHT_DIM = 0.3, LIGHT_MIX = 1;   // light theme: saturation push, shade, and multiply depth at strength 1
function readColour(css) {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.fillStyle = css; g.fillRect(0, 0, 1, 1);
  return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)];
}
function glow(parent) {
  const wrap = document.createElement("div");
  wrap.className = "motion-glow";
  wrap.setAttribute("aria-hidden", "true");
  const cv = document.createElement("canvas");
  cv.width = TW; cv.height = TH;
  wrap.append(cv);
  parent.append(wrap);
  const g = cv.getContext("2d", { willReadFrequently: true });
  const acc = new Float32Array(TW * TH * 3);
  let primed = false;
  return {
    wrap,
    // src's (sx, sy, sw, sh) is the device; plate is the colour under it; dark says whether light may spill too.
    draw(src, sx, sy, sw, sh, plate, dark, dt) {
      g.globalAlpha = 1;
      g.drawImage(src, sx, sy, sw, sh, 0, 0, TW, TH);
      const px = g.getImageData(0, 0, TW, TH);
      const d = px.data, k = primed ? approach(dt, 3) : 1;
      primed = true;
      const Lp = 0.2126 * plate[0] + 0.7152 * plate[1] + 0.0722 * plate[2];
      for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
        acc[j] += (d[i] - acc[j]) * k; acc[j + 1] += (d[i + 1] - acc[j + 1]) * k; acc[j + 2] += (d[i + 2] - acc[j + 2]) * k;
        const L = 0.2126 * acc[j] + 0.7152 * acc[j + 1] + 0.0722 * acc[j + 2];
        if (dark) {
          const lift = Math.max(0, L - Lp) * 0.9;
          for (let n = 0; n < 3; n++) d[i + n] = plate[n] + ((acc[j + n] - L) * 1.8 + lift) * AMBIENT;
        } else {
          // A near-white plate has no room to get lighter, so here the frame is multiplied in: its colour, brought to
          // full value and saturation pushed, tints the plate, and its darkness shades it a little, the way a coloured
          // light reads on paper. Value first, or a dark screen multiplies in as a grey drop shadow.
          const V = Math.max(acc[j], acc[j + 1], acc[j + 2], 1), Ln = 255 * L / V;
          for (let n = 0; n < 3; n++) {
            const f = Math.min(255, Math.max(0, Ln + (acc[j + n] * 255 / V - Ln) * LIGHT_SAT)) / 255 * (1 - LIGHT_DIM * (1 - V / 255));
            d[i + n] = plate[n] * (1 - LIGHT_MIX * AMBIENT * (1 - f));
          }
        }
        d[i + 3] = 255;
      }
      g.putImageData(px, 0, 0);
    },
    // Centred on the device's box (css px in the parent), blown up by ex and ey, blurred by b.
    place(x, y, w, h, ex, ey, b) {
      cv.style.left = x + w / 2 - w * ex / 2 + "px";
      cv.style.top = y + h / 2 - h * ey / 2 + "px";
      cv.style.width = w * ex + "px";
      cv.style.height = h * ey + "px";
      cv.style.filter = `blur(${b.toFixed(1)}px)`;
    },
  };
}

/* ---------- work cards: a short loop through real frames of the product ---------- */

// The frames stack over the card's picture, each with the picture's own class, so they sit on the same
// plate at the same size. A timeline maps the loop clock to each frame's opacity and offset; nothing
// is on a CSS timer, so a paused card simply stops where it is.
function frameLoop(card, steps, opts = {}) {
  const img = card.querySelector("img");
  const box = document.createElement("div");
  box.className = "motion-loop";
  box.setAttribute("aria-hidden", "true");
  const els = steps.map((s) => {
    const f = document.createElement("img");
    f.className = img.className;
    f.src = s.src;
    f.alt = "";
    f.decoding = "async";
    box.append(f);
    return f;
  });
  let tap = null;
  if (steps.some((s) => s.tap)) {
    tap = document.createElement("span");
    tap.className = "motion-tap";
    box.append(tap);
  }
  card.classList.add("has-motion");
  card.append(box);
  const place = () => {
    box.style.top = img.offsetTop + "px";
    box.style.left = img.offsetLeft + "px";
    box.style.width = img.offsetWidth + "px";
    box.style.height = img.offsetHeight + "px";
  };
  new ResizeObserver(place).observe(img);
  place();

  const T = opts.transition || 0.7;
  const tr = (s) => s.t ?? T; // a step may set its own hand-over time
  const total = steps.reduce((a, s) => a + s.hold + tr(s), 0);
  const shift = opts.slide ? 7 : 0; // percent of the plate a frame travels as it hands over
  // Where a point in the picture lands on the plate: object-fit contain inside the picture's padding.
  function toPlate(fx, fy) {
    const cs = getComputedStyle(img);
    const pt = parseFloat(cs.paddingTop), pb = parseFloat(cs.paddingBottom);
    const W = img.offsetWidth, H = img.offsetHeight - pt - pb;
    const ar = img.naturalWidth / img.naturalHeight;
    const w = Math.min(W, H * ar), h = w / ar;
    return [(W - w) / 2 + fx * w, pt + (H - h) / 2 + fy * h, w];
  }
  // Start on the frame that matches the card's own screenshot, so going live never pops, and hand over
  // to the next frame about a second after the card comes into view.
  const at = (n) => steps.slice(0, n).reduce((a, s) => a + s.hold + tr(s), 0);
  const still0 = opts.stillFrame || 0;
  const start = at(still0) + Math.max(0, steps[still0].hold - (opts.lead || 1.2));
  let t = start;
  function paint() {
    let u = t % total, i = 0;
    while (u >= steps[i].hold + tr(steps[i])) { u -= steps[i].hold + tr(steps[i]); i++; }
    const j = (i + 1) % steps.length;
    const Ti = tr(steps[i]);
    const k = u <= steps[i].hold ? 0 : smooth((u - steps[i].hold) / Ti);
    // A step's fx says how it hands over. "clear": the outgoing frame lifts off, growing and going soft, while the
    // next settles in under it. "fade": a plain cross-fade in place. "scroll": the next frame is the same page cut
    // lower (dy of the frame's height), so both slide up together with no fade, like the page scrolling.
    const fx = steps[i].fx;
    const clear = fx === "clear", still = fx === "fade" || fx === "scroll";
    let dy = 0;
    if (fx === "scroll" && k > 0) dy = steps[i].dy * (toPlate(0, 1)[1] - toPlate(0, 0)[1]);
    els.forEach((el, n) => {
      let o = 0, x = 0, y = 0, sc = 1, b = 0;
      if (n === i) { o = 1 - k; x = still ? 0 : -shift * k; if (clear) { sc = 1 + 0.06 * k; b = 6 * k; } }
      if (n === j) { o = Math.max(o, k); x = still ? 0 : shift * (1 - k); if (clear) sc = 0.97 + 0.03 * k; }
      if (fx === "scroll") {
        if (n === i) { o = k < 1 ? 1 : 0; y = -dy * k; }
        if (n === j) { o = k > 0 ? 1 : 0; y = dy * (1 - k); }
      }
      el.style.opacity = o.toFixed(3);
      const tf = (x ? `translateX(${x.toFixed(2)}%) ` : "") + (y ? `translateY(${y.toFixed(2)}px) ` : "") + (sc !== 1 ? `scale(${sc.toFixed(4)})` : "");
      el.style.transform = tf.trim();
      el.style.filter = b > 0.01 ? `blur(${b.toFixed(2)}px)` : "";
    });
    if (tap) {
      // The press lands on the step's own Continue button just before it hands over.
      const s = steps[i];
      const lead = u - (s.hold - 0.55);
      if (s.tap && lead > 0 && u <= s.hold + Ti * 0.4) {
        const [x, y, w] = toPlate(s.tap[0], s.tap[1]);
        const p = Math.min(1, lead / 0.55);
        tap.style.left = x + "px";
        tap.style.top = y + "px";
        tap.style.setProperty("--tap-size", Math.max(28, w * 0.09) + "px");
        tap.style.opacity = (u > s.hold ? 1 - (u - s.hold) / (Ti * 0.4) : Math.min(1, p * 2)).toFixed(3);
        tap.style.transform = `translate(-50%, -50%) scale(${(0.7 + 0.3 * smooth(p)).toFixed(3)})`;
      } else tap.style.opacity = "0";
    }
  }
  return {
    card,
    frame(now, dt) { t += dt; paint(); box.classList.add("is-live"); },
    // Paused offscreen it keeps its place; under reduced motion it goes back to the first frame.
    still() { if (mqRM.matches) t = start; paint(); },
  };
}

async function phonezero(card) {
  // Noise, then calm. A home screen packed with badged social apps (real App Store icons on the App Store widget shot's
  // own frame, status bar and dock, tools/phonezero_social.py): the counts climb, then the apps leave in a sweep, the
  // widget shot (the card's own picture) settles in under them and holds, and the apps flood back. Drawn on a canvas
  // over the card's picture from three layers: the bare frame, the icon layer and the widget shot; badges are live.
  const img = card.querySelector("img");
  // Under reduced motion the layers are never fetched; the card's own picture is the still.
  while (mqRM.matches) await new Promise((r) => mqRM.addEventListener("change", r, { once: true }));
  const [base, icons, widget] = await Promise.all(["img/motion/phonezero-social-base-480.webp",
    "img/motion/phonezero-social-icons-480.webp", "img/phonezero-480.webp"].map(loadImage));
  const c = overlay(card, img);
  const g = c.getContext("2d");
  // Ambient: a plate of its own under the picture (z -1), so the phone's own pixels stay on top of the glow. It takes
  // the picture's plate colour; the picture's own plate goes clear only while it shows.
  const amb = document.createElement("div");
  amb.className = "motion-ambient";
  amb.setAttribute("aria-hidden", "true");
  const gl = glow(amb);
  const contact = document.createElement("div");
  contact.className = "motion-contact";
  amb.append(contact);
  card.append(amb);
  const placeAmb = () => {
    amb.style.top = img.offsetTop + "px";
    amb.style.left = img.offsetLeft + "px";
    amb.style.width = img.offsetWidth + "px";
    amb.style.height = img.offsetHeight + "px";
  };
  new ResizeObserver(placeAmb).observe(img);
  placeAmb();
  const FW = 1320, FH = 2868, I = 200;   // the frame the layers were shot at, and the icon size in it
  // x, y of each icon's top left in the frame, its starting badge, and whether it sits in the dock (no label).
  const apps = [
    [80, 269, 99, 0], [400, 269, 1284, 0], [720, 269, 47, 0], [1040, 269, 23, 0],
    [80, 601, 312, 0], [400, 601, 2367, 0], [720, 601, 86, 0], [1040, 601, 41, 0],
    [80, 933, 158, 0], [400, 933, 643, 0], [720, 933, 1029, 0], [1040, 933, 12, 0],
    [80, 1265, 9, 0], [400, 1265, 74, 0], [720, 1265, 33, 0], [1040, 1265, 18, 0],
    [80, 1597, 2, 0], [400, 1597, 517, 0], [720, 1597, 27, 0], [1040, 1597, 64, 0],
    [80, 1929, 1, 0], [400, 1929, 5, 0], [720, 1929, 38, 0], [1040, 1929, 3, 0],
    [80, 2543, 21, 1], [400, 2543, 4, 1], [720, 2543, 16, 1], [1040, 2543, 7, 1],
  ];
  // Each app's badge climbs at its own pace; the big ones fastest. A fixed hash, so every loop plays the same.
  const hash = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const rate = apps.map((a, n) => 0.5 + 1.6 * hash(n + 1) + (a[2] > 500 ? 2.2 : 0));
  const back = apps.map((a, n) => hash(n + 40) * 0.5);          // the order the apps flood back in, seconds
  const C = 10.4, NOISE = 3.0, CALM = 4.6, RETURN = 9.4;
  function plate() {
    // Where the phone lands in the canvas: object-fit contain inside the picture's 24px top and bottom padding.
    const cs = getComputedStyle(img);
    const pt = parseFloat(cs.paddingTop) * DPR, pb = parseFloat(cs.paddingBottom) * DPR;
    const W = c.width, H = c.height - pt - pb;
    const h = Math.min(H, W * FH / FW), w = h * FW / FH;
    return [(W - w) / 2, pt + (H - h) / 2, w / FW];
  }
  function paint(t) {
    t %= C;
    const [ox, oy, k] = plate();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.setTransform(k, 0, 0, k, ox, oy);
    g.globalAlpha = 1;
    g.drawImage(base, 0, 0, FW, FH);
    // The widget shot settles in as the apps leave, and lifts as they come back.
    const m = t < NOISE + 0.7 ? 0 : t < CALM ? smooth((t - NOISE - 0.7) / (CALM - NOISE - 0.7))
      : t < RETURN ? 1 : 1 - smooth(Math.min(1, (t - RETURN) / 0.35));   // smooth() climbs again past 1, so clamp
    if (m > 0) { g.globalAlpha = m; g.drawImage(widget, 0, 0, FW, FH); }
    const u = t >= RETURN ? 0 : t;                                   // badge clock: back at the start when they return
    const sx = icons.naturalWidth / FW;
    g.font = "600 46px -apple-system, system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    apps.forEach(([x, y, b, dock], n) => {
      let a = 1, s = 1;
      if (t >= NOISE && t < RETURN) {                                // leave in a sweep, top left to the dock
        const p = Math.min(1, Math.max(0, (t - NOISE - n * 0.03) / 0.45));
        a = 1 - smooth(p); s = 1 - 0.3 * smooth(p);
      }
      if (t >= RETURN) {                                             // flood back, in no particular order
        const p = Math.min(1, Math.max(0, (t - RETURN - 0.05 - back[n]) / 0.3));
        a = smooth(p); s = 0.85 + 0.15 * smooth(p);
      }
      if (a <= 0.004) return;
      const cx = x + I / 2, cy = y + I / 2;
      g.save();
      g.globalAlpha = a;
      g.translate(cx, cy); g.scale(s, s); g.translate(-cx, -cy);
      const lx = x - 60, ly = y - 4, lw = I + 120, lh = dock ? I + 8 : I + 74;   // the icon and its label in the layer
      g.drawImage(icons, lx * sx, ly * sx, lw * sx, lh * sx, lx, ly, lw, lh);
      const ticks = u * rate[n], count = b + Math.floor(ticks);
      const since = (ticks % 1) / rate[n];
      const pop = u > 0 && since < 0.18 ? 1 + 0.28 * (1 - since / 0.18) : 1;
      const label = String(count), tw = g.measureText(label).width;
      const bw = Math.max(72, tw + 40), bx = x + I + 24 - bw, by = y - 24;
      g.translate(bx + bw / 2, by + 36); g.scale(pop, pop); g.translate(-(bx + bw / 2), -(by + 36));
      g.fillStyle = "rgb(255,59,48)";
      g.beginPath(); g.roundRect(bx, by, bw, 72, 36); g.fill();
      g.fillStyle = "#fff";
      g.fillText(label, bx + bw / 2, by + 38);
      g.restore();
    });
  }
  let plateRGB = null, plateN = 0;
  function ambient(dt) {
    const [ox, oy, k] = plate();
    const D = c.width / img.offsetWidth, w = FW * k / D, h = FH * k / D, x = ox / D, y = oy / D;
    if (!plateRGB || ++plateN % 30 === 0) plateRGB = readColour(getComputedStyle(amb).backgroundColor);   // follows the theme
    const dark = 0.2126 * plateRGB[0] + 0.7152 * plateRGB[1] + 0.0722 * plateRGB[2] < 128;
    gl.place(x, y, w, h, 1.75, 1.1, w * 0.24);
    gl.draw(c, ox, oy, FW * k, FH * k, plateRGB, dark, dt);
    contact.style.left = x + "px"; contact.style.top = y + "px";
    contact.style.width = w + "px"; contact.style.height = h + "px";
    contact.style.borderRadius = w * 0.135 + "px";
  }
  // Start on the widget shot, the card's own picture, so going live never pops; the noise floods in about a second later.
  let t = RETURN - 0.9;
  register({
    card,
    frame(now, dt) {
      t += dt; paint(t); c.classList.add("is-live");
      ambient(dt); card.classList.add("has-ambient"); gl.wrap.classList.add("is-live");
    },
    // Paused offscreen it keeps its place; under reduced motion the card's own picture is the still, on its own plate.
    still() {
      if (mqRM.matches) { t = RETURN - 0.9; c.classList.remove("is-live"); card.classList.remove("has-ambient"); gl.wrap.classList.remove("is-live"); }
    },
  });
}

// A recorded loop over the card's picture, which is the loop's own still. The scheduler plays it only while the card
// is on screen, the tab is visible and motion is allowed; anywhere else it is paused, and under reduced motion it is
// never fetched or played, so the card's own picture is all that shows.
function videoLoop(card, opts) {
  const img = card.querySelector("img");
  const box = document.createElement("div");
  box.className = "motion-loop motion-video";
  box.setAttribute("aria-hidden", "true");
  const v = document.createElement("video");
  v.muted = true;
  v.defaultMuted = true;
  v.loop = true;
  v.playsInline = true;
  for (const a of ["muted", "loop", "playsinline"]) v.setAttribute(a, "");
  v.preload = mqRM.matches ? "none" : "auto";
  v.src = opts.src;
  v.disablePictureInPicture = true;
  box.append(v);
  card.classList.add("has-motion");
  card.append(box);
  const place = () => {
    box.style.top = img.offsetTop + "px";
    box.style.left = img.offsetLeft + "px";
    box.style.width = img.offsetWidth + "px";
    box.style.height = img.offsetHeight + "px";
  };
  new ResizeObserver(place).observe(img);
  place();
  // Ambient, on the recording's own ground beside the promo: a soft copy of the promo's frame playing right now, cut
  // out where the frame sits (opts.frame, a fixed box in the video's pixels), so it lights the side bands and never the
  // frame. The ground is the promo's own #0a0a0a in both themes, so both take the dark plate's path, which adds the
  // frame's colour and light; the light plate's path multiplies into the plate and cannot show on a near-black one.
  // Made on the first live frame, so under reduced motion there is no glow at all.
  const ground = [10, 10, 10];
  let gl = null, armed = false, lastAt = 0;
  function ambient() {
    const q = opts.frame;
    if (!gl || !q || !v.videoWidth) return;
    const W = box.offsetWidth, H = box.offsetHeight, s = Math.max(W / q.w, H / q.h);   // object-fit: cover
    const ox = (W - q.w * s) / 2, oy = (H - q.h * s) / 2;
    const x = ox + q.x0 * s, y = oy + q.y0 * s, w = (q.x1 - q.x0) * s, h = (q.y1 - q.y0) * s;
    const now = performance.now(), dt = Math.min(0.1, Math.max(0, (now - lastAt) / 1000));
    lastAt = now;
    const vs = v.videoWidth / q.w;
    // Phone Zero's placement around its phone, the other portrait object on a plate.
    gl.place(x, y, w, h, 1.75, 1.1, w * 0.24);
    gl.draw(v, q.x0 * vs, q.y0 * vs, (q.x1 - q.x0) * vs, (q.y1 - q.y0) * vs, ground, true, dt);
    const f = (n) => n.toFixed(1);
    gl.wrap.style.clipPath = `path(evenodd, "M0 0H${f(W)}V${f(H)}H0Z M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z")`;
    gl.wrap.classList.add("is-live");
  }
  // One callback chain per presented frame, and only while the card wants to play; it never doubles on a restart.
  const onVideoFrame = () => { armed = false; if (!wanted) return; ambient(); arm(); };
  const arm = () => { if (armed || !("requestVideoFrameCallback" in v)) return; armed = true; v.requestVideoFrameCallback(onVideoFrame); };
  let wanted = false;
  return {
    card,
    frame() {
      if (!wanted) {
        wanted = true;
        if (v.preload === "none") v.preload = "auto";
        v.play().then(() => box.classList.add("is-live")).catch(() => { wanted = false; });
        if (opts.frame && !gl) gl = glow(box);
        arm();
      }
      if (!("requestVideoFrameCallback" in v) && !v.paused) ambient();
    },
    still() {
      wanted = false;
      v.pause();
      if (mqRM.matches) { v.currentTime = 0; box.classList.remove("is-live"); if (gl) gl.wrap.classList.remove("is-live"); }
    },
  };
}

async function nanolearner(card) {
  // The promo Maecenas made for the nanolearner.com home page (#183, nl-mock-brilliant 6321db4 prod-g/hero.html), a DOM
  // loop of four steps with its own cursor and taps, recorded in real time by tools/nanolearner_promo.mjs and laid on
  // its own dark ground at 16:10. The card's picture is the promo's own reduced-motion still. The promo has no light
  // version, so both themes show it as it is.
  register(videoLoop(card, {
    src: "img/motion/nanolearner-promo.mp4",
    // The promo's frame in the 960 by 600 mp4: its 458 by 570 portrait box, centred (the recording json's out.inner),
    // which is also where the still's lighter box runs, x 502 to 1417 and y 30 to 1169 of its 1920 by 1200 pixels.
    frame: { w: 960, h: 600, x0: 251, y0: 15, x1: 709, y1: 585 },
  }));
}

/* ---------- boot ---------- */

const run = (fn, sel) => {
  const card = document.querySelector(sel);
  if (card) fn(card).catch((e) => { console.warn("motion:", sel, e); card.dataset.motion = "failed"; });
};
function start() {
  run(phonezero, 'a[href^="https://apps.apple.com"]');
  run(nanolearner, 'a[href="https://nanolearner.com"]');
  run(breathe, 'a[href="breathe.html"]');
  run(still, 'a[href="still.html"]');
  run(olmec, 'a[href="form.html"]');
}
if (document.readyState === "complete") start();
else window.addEventListener("load", start, { once: true });
