// The breathe page's orb, glow (Levi 10-26 picked it from a round of React Bits ports). Ported from React Bits' Orb
// (github.com/DavidHDev/react-bits, src/content/Backgrounds) to plain WebGL2, with its shader math kept and its
// colours moved onto the page's sage ground. It breathes: its radius follows the page's disc,
// r = min(w,h) * 0.30 * (0.55 + 0.45 * v).
//
// draw(ctx, { w, h, v, time, amp, dpr, ink, rm, mx, my, hover }): ctx is the page's 2D canvas, cleared, already
// scaled by dpr. mx, my are the pointer from the stage centre (±1 at the stage's half width and half height, already
// eased) and hover is 0..1 while the pointer is over the stage. Levi 10-26 "responsive to the mouse, not a lot just a
// bit": each orb leans at most 3% of its radius toward the pointer and its light turns toward it. Reduced motion
// ignores the pointer.
// Each orb renders into its own offscreen WebGL2 canvas (a square the size of the stage's short side, centred) and is
// copied onto the page canvas in the same call. Without WebGL2 an orb draws a plain soft disc instead.

const GROUND = [0xE3 / 255, 0xE7 / 255, 0xDF / 255];
const hex = s => { const n = parseInt(s.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const radius = (w, h, v) => Math.min(w, h) * 0.30 * (0.55 + 0.45 * v);
// Reduced motion and still frames hold one calm moment rather than time zero, where some of these start blank.
const STILL = 7.3;
// The pointer, clamped to the unit circle and zeroed under reduced motion. y is flipped into GL's upward axis.
function pointer(o) {
  if (o.rm) return { x: 0, y: 0, hover: 0 };
  let x = +o.mx || 0, y = -(+o.my || 0);
  const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; }
  return { x, y, hover: Math.min(1, Math.max(0, +o.hover || 0)) };
}
const LEAN = 0.03;

const VERTEX = `#version 300 es
in vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }`;

function softDisc(ctx, w, h, v, ink) {
  const r = radius(w, h, v), x = w / 2, y = h / 2;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${ink},.55)`);
  g.addColorStop(0.8, `rgba(${ink},.5)`);
  g.addColorStop(1, `rgba(${ink},0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

// The sphere's light sits top left and turns a little toward the pointer while it is over the stage.
function lightDir(P) {
  const x = -0.45 + 0.4 * P.x * P.hover, y = 0.55 + 0.4 * P.y * P.hover, z = 0.7;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

// One offscreen WebGL2 canvas per orb, made on first draw. A failed context or shader leaves `dead` set and the orb
// falls back to the soft disc for good.
function makeGL(fragment) {
  const s = { canvas: null, gl: null, prog: null, u: {}, dead: false, side: 0 };
  s.init = () => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
    if (!gl) { s.dead = true; return; }
    const sh = (type, src) => {
      const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(o)); return null; }
      return o;
    };
    const vs = sh(gl.VERTEX_SHADER, VERTEX), fs = sh(gl.FRAGMENT_SHADER, fragment);
    if (!vs || !fs) { s.dead = true; return; }
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.bindAttribLocation(p, 0, "aPosition"); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { s.dead = true; return; }
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); s.u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name); }
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(p);
    Object.assign(s, { canvas, gl, prog: p });
  };
  // Renders a side x side (CSS px) square centred on the stage, then copies it onto the page canvas.
  s.frame = (ctx, w, h, dpr, side, set) => {
    if (!s.gl && !s.dead) s.init();
    if (s.dead) return false;
    const gl = s.gl, px = Math.max(1, Math.round(side * dpr));
    if (s.canvas.width !== px || s.canvas.height !== px) { s.canvas.width = px; s.canvas.height = px; }
    gl.viewport(0, 0, px, px);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(s.u.uResolution, px, px);
    set(gl, s.u, px);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    ctx.drawImage(s.canvas, (w - side) / 2, (h - side) / 2, side, side);
    return true;
  };
  return s;
}

/* ---------- orb: React Bits "Orb" ----------
   Source: https://github.com/DavidHDev/react-bits/blob/main/src/content/Backgrounds/Orb/Orb.jsx
   The fragment shader is the original's, cut only of the pointer reach, click echo and tilt (all zero here). Its own
   light-ground branch does the work: given the page's ground as uBackground it paints a lit rim and lets the ground
   through the middle. uColor3 fills the body so it reads as a sphere rather than a ring. */
const ORB_FRAG = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uBackground;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uScale;
uniform float uWobble;
uniform float uGlow;
uniform float uBleed;
uniform float uHighlight;
uniform float uSwirl;
uniform float uOrbit;
uniform float uTrail;
uniform float uFill;
uniform float uSoft;
uniform vec2 uShift;
uniform vec2 uPtr;
uniform float uClean;
out vec4 outColor;

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yxz + 19.19);
  return -1.0 + 2.0 * fract(vec3(p3.x + p3.y, p3.x + p3.z, p3.y + p3.z) * p3.zyx);
}
float snoise3(vec3 p) {
  const float K1 = 0.333333333;
  const float K2 = 0.166666667;
  vec3 i = floor(p + (p.x + p.y + p.z) * K1);
  vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
  vec3 e = step(vec3(0.0), d0 - d0.yzx);
  vec3 i1 = e * (1.0 - e.zxy);
  vec3 i2 = 1.0 - e.zxy * (1.0 - e);
  vec3 d1 = d0 - (i1 - K2);
  vec3 d2 = d0 - (i2 - K1);
  vec3 d3 = d0 - 0.5;
  vec4 h = max(0.6 - vec4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
  vec4 n = h * h * h * h * vec4(dot(d0, hash33(i)), dot(d1, hash33(i + i1)), dot(d2, hash33(i + i2)), dot(d3, hash33(i + 1.0)));
  return dot(vec4(31.316), n);
}
float light1(float intensity, float attenuation, float dist) { return intensity / (1.0 + dist * attenuation); }
float light2(float intensity, float attenuation, float dist) { return intensity / (1.0 + dist * dist * attenuation); }

vec4 draw(vec2 uv) {
  float len = length(uv);
  vec2 dir = len > 0.0001 ? uv / len : vec2(1.0, 0.0);
  float ang = atan(dir.y, dir.x);
  float invLen = len > 0.0 ? 1.0 / len : 0.0;
  float bgLuminance = dot(uBackground, vec3(0.299, 0.587, 0.114));

  float n0 = snoise3(vec3(uv * 0.65, uTime * 0.5)) * 0.5 + 0.5;
  float r0 = mix(0.8 - 0.04 * uWobble, 0.8 + 0.04 * uWobble, n0);
  float d0 = distance(uv, (r0 * invLen) * uv);
  float v0 = light1(1.0, 10.0 / uGlow, d0);
  // The rim gathers a little on the side facing the pointer.
  v0 *= 1.0 + 0.35 * max(dot(dir, uPtr), 0.0);
  v0 *= smoothstep(r0 * 1.05, r0, len);
  float reach = max(uBleed, 0.04);
  float innerFade = smoothstep(r0 * (1.0 - 0.2 * reach), r0 * (1.0 - 0.05 * reach), len);
  v0 *= mix(innerFade, 1.0, bgLuminance * 0.7 * min(uBleed, 1.0));
  float body = smoothstep(0.8 - 0.2 * reach, 0.8, len);
  float cl = cos(ang + uSwirl) * 0.5 + 0.5;

  vec2 pos = vec2(cos(uOrbit), sin(uOrbit)) * r0;
  float d = distance(uv, pos);
  vec2 head = vec2(cos(uOrbit), sin(uOrbit));
  float lag = atan(head.x * dir.y - head.y * dir.x, dot(dir, head));
  float trail = uTrail > 0.0 ? smoothstep(0.0, 0.35, lag) * exp(-max(lag, 0.0) * 2.6 / uTrail) : 0.0;
  float v1 = (light2(1.5, 5.0, d) + trail * 0.6) * uHighlight;
  v1 *= light1(1.0, 50.0, d0);
  float v2 = smoothstep(1.0, mix(0.6, 1.0, n0 * 0.5), len);
  float v3 = body;

  vec3 colBase = mix(uColor1, uColor2, cl);
  float fadeAmount = mix(1.0, 0.1, bgLuminance);

  // Inside the rim the rim's light fades onto the body, not onto the page's ground: fading onto the pale ground is
  // what drew a white line just inside the rim (Levi 10-26).
  float inside = smoothstep(r0 * 1.02, r0 * 0.75, len);
  vec3 bodyCol = mix(uColor3, colBase, (0.18 + 0.25 * n0) * smoothstep(0.0, r0 * 0.8, len));  // no pinch at the centre, where the angle has no meaning
  vec3 under = mix(uBackground, bodyCol, smoothstep(r0 * 1.0, r0 * 0.9, len) * step(0.001, uFill));
  vec3 lightCol = (colBase + v1) * mix(1.0, v2 * v3, fadeAmount);
  lightCol = mix(under, lightCol, clamp(v0, 0.0, 1.0));
  lightCol = clamp(mix(lightCol, vec3(1.0), clamp(v1 * 0.35, 0.0, 0.6)), 0.0, 1.0);

  // Added for the page: the inside of the rim is the body, a sphere of uColor3 that is densest at the centre and
  // gives way to the rim's light, so the ground does not show through the middle.
  float core = uFill * inside * (0.78 + 0.22 * (1.0 - len / r0));
  vec3 col = mix(lightCol, bodyCol, core * (1.0 - clamp(v0, 0.0, 1.0) * 0.6));
  float a = clamp(max(core, clamp(v0, 0.0, 1.0)), 0.0, 1.0) * smoothstep(r0 * (1.0 + uSoft), r0 * (1.0 - uSoft * 0.6), len);
  // Glow (Levi 10-26: "dont like the white line that sort of forms"): the line was the rim drawn half see-through
  // over the pale ground, a lighter band just inside the soft edge. Here the body is one soft disc whose opacity only
  // ever falls outward, and the rim is a tint on it, never a lighter layer over the ground.
  if (uClean > 0.5) {
    float edge = smoothstep(r0 * (1.0 + uSoft * 0.6), r0 * (1.0 - uSoft * 0.5), len);
    float rim = clamp(v0, 0.0, 1.0) * smoothstep(r0 * 0.55, r0 * 0.95, len);
    vec3 c = mix(bodyCol, colBase, rim * 0.75);
    return vec4(c, uFill * edge);
  }
  // Inside the rim the orb is never more see-through than at its centre. Without this floor the alpha dipped in a
  // band just inside the rim, and the pale ground showing through it read as a white line.
  a = max(a, min(uFill, 1.0) * smoothstep(r0 * 0.98, r0 * 0.72, len));
  return vec4(col, a);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - uResolution * 0.5) / min(uResolution.x, uResolution.y) * 2.0;
  uv *= uScale;
  vec4 col = draw(uv - uShift);
  float dither = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  float alpha = clamp(col.a + dither, 0.0, 1.0);
  outColor = vec4(col.rgb * alpha, alpha);
}`;

function orbOption(label, o) {
  const g = makeGL(ORB_FRAG);
  const C1 = hex(o.c1), C2 = hex(o.c2), C3 = hex(o.c3);
  return {
    label,
    draw(ctx, opt) {
      const { w, h, v, time, amp, dpr, ink, rm } = opt;
      const t = rm || !amp ? STILL : time;
      const P = pointer(opt);
      const side = Math.min(w, h);
      // The rim sits at uv 0.8; uv runs 1 to the square's half side, scaled by uScale.
      const sc = 0.4 * side / radius(w, h, v);
      const ok = g.frame(ctx, w, h, dpr, side, (gl, u) => {
        gl.uniform1f(u.uTime, t * 0.5 * o.speed);
        gl.uniform3fv(u.uBackground, GROUND);
        gl.uniform3fv(u.uColor1, C1); gl.uniform3fv(u.uColor2, C2); gl.uniform3fv(u.uColor3, C3);
        gl.uniform1f(u.uScale, sc);
        gl.uniform1f(u.uWobble, o.wobble * (1 + 0.3 * P.hover));
        gl.uniform1f(u.uGlow, o.glow * (1 + 0.12 * P.hover));
        gl.uniform2f(u.uShift, P.x * LEAN * 0.8, P.y * LEAN * 0.8);
        gl.uniform2f(u.uPtr, P.x * P.hover, P.y * P.hover);
        gl.uniform1f(u.uBleed, o.bleed);
        gl.uniform1f(u.uHighlight, o.highlight);
        gl.uniform1f(u.uSwirl, t * 0.9 * o.speed);
        gl.uniform1f(u.uOrbit, -t * 0.45 * o.speed);
        gl.uniform1f(u.uTrail, o.trail);
        gl.uniform1f(u.uFill, o.fill);
        gl.uniform1f(u.uSoft, o.soft);
        gl.uniform1f(u.uClean, o.clean ? 1 : 0);
      });
      if (!ok) softDisc(ctx, w, h, v, ink);
    },
  };
}

export const ORBS = {
  glow: orbOption("glow", { c1: "#3F6B55", c2: "#6E9C86", c3: "#9DB3A6", speed: 0.4, wobble: 2.2, glow: 2.2, bleed: 2, highlight: 0, trail: 0, fill: 0.9, soft: 0.3, clean: true }),
};
