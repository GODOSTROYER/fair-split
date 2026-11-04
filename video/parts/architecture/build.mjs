// Fair Split film, script v4: the ARCHITECTURE beat (film 30-44 s) as a standalone HyperFrames part, in DAYLIGHT
// (video/proto/STYLE.md §1: later acts stay bright). Four steps, one readable word each, the camera pushing node to
// node: Claude (slips go to Claude), Engine, Signed (two keys, one batch hash), PayPal (an outbox makes each simulated
// call safe to retry); then the whole line holds as the overview. Ink lines, the indigo trace with its travelling
// light, one jade pulse on the PayPal node; the standard "Simulated PayPal sandbox" tag turns on with the PayPal node.
// Every step lands on the narration word that names it, at the same word-proportional time the provisional captions
// use (script.ts `timeOf`), so the build moves with F4's alignment.
// No GSAP and no third-party code or artwork: every tween is compiled here into CSS keyframes sampled once per frame,
// which HyperFrames' CSS adapter seeks deterministically. Run: node video/parts/architecture/build.mjs
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { beats } from "../../script.ts";

const here = new URL("./", import.meta.url);
const beat = beats.find((b) => b.id === "architecture");
if (!beat) throw new Error("script.ts has no architecture beat");

// ---------- time ----------
const FPS = 30;
const DUR = beat.end - beat.start;
const N = Math.round(DUR * FPS);
const FILM0 = beat.start; // the day field drifts on the film's clock, as in every other day composition
const [say0, say1] = (beat.speech ?? [beat.start, beat.end]).map((s) => s - beat.start);
const spoken = beat.say.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
const bare = (w) => w.toLowerCase().replace(/^\W+/, "");
/**
 * Local second at which `phrase` is said: the recorded voice's word start (script.ts `words`, F4), else
 * word-proportional across the speech window (unrounded).
 */
function said(phrase) {
  const want = phrase.toLowerCase().split(/\s+/);
  const i = spoken.findIndex((_, k) => want.every((w, j) => bare(spoken[k + j] ?? "").startsWith(w)));
  if (i < 0) throw new Error(`architecture: "${phrase}" is not spoken`);
  const word = beat.words?.[i];
  return word ? word.start - beat.start : say0 + ((say1 - say0) * i) / spoken.length;
}
const W = {
  slips: said("slips"),
  claude: said("claude"),
  thenA: said("then"),
  deterministic: said("deterministic"),
  engine: said("engine"),
  two: said("two keys"),
  keys: said("keys"),
  sign: said("sign"),
  one: said("one batch"),
  batch: said("batch"),
  hash: said("hash"),
  an: said("an outbox"),
  outbox: said("outbox"),
  makes: said("makes"),
  simulated: said("simulated"),
  paypal: said("paypal"),
  call: said("call"),
  safe: said("safe"),
  to: said("to retry"),
  retry: said("retry"),
  end: say1,
};

// ---------- easing ----------
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const E = {
  linear: (x) => x,
  outCubic: (x) => 1 - (1 - x) ** 3,
  outQuart: (x) => 1 - (1 - x) ** 4,
  outExpo: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
  inCubic: (x) => x ** 3,
  inQuad: (x) => x * x,
  inOutCubic: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  outBack: (x) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2,
};
const prog = (t, t0, t1, ease = E.outCubic) => ease(clamp01((t - t0) / (t1 - t0)));
const lerp = (a, b, p) => a + (b - a) * p;
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const TAU = 2 * Math.PI;

// ---------- palette: Hayag day (research/theme-1104/final/tokens.json; video/proto/index.html :root) ----------
const C = {
  ground: "#F3F5F8",
  plate: "#FFFFFF",
  ink: "#0B1220",
  ink2: "#3A4456",
  ink3: "#5A6476",
  steel: "#7E8898",
  pod: "#4A2FD6", // indigo: Claude's reading, a person's hand, the trace
  jade: "#14CC90", // jade: money that arrived (the trace's final pulse)
};

// ---------- layout (world px; at the overview the camera is the identity, so world = screen) ----------
// One gentle left-to-right line in the order the batch flows; nothing enters the tag corner (x > 1335, y > 960: plan.mjs TAG, 32 px words in a 64 px pill).
const R = 56; // node disc radius
const RR = 66; // the batch-hash ring around its disc
const KR = 38; // key discs
const S = [220, 600]; // slips
const Cn = [510, 540]; // Claude
const En = [800, 600]; // deterministic engine
const H = [1100, 560]; // one batch hash
const KT = [1030, 380]; // Treasurer key
const KC = [1170, 380]; // Chair key
const O = [1400, 610]; // outbox
const P = [1690, 545]; // PayPal (simulated)

// ---------- geometry ----------
function cubicPts(p0, p1, p2, p3, n = 160) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n;
    const v = 1 - u;
    return [
      v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0],
      v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1],
    ];
  });
}
function poly(pts) {
  const acc = [0];
  for (let i = 1; i < pts.length; i++)
    acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, acc, len: acc.at(-1) };
}
function along(path, frac) {
  const d = clamp01(frac) * path.len;
  let lo = 0;
  let hi = path.acc.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path.acc[mid] <= d) lo = mid;
    else hi = mid;
  }
  const seg = path.acc[hi] - path.acc[lo] || 1;
  const k = (d - path.acc[lo]) / seg;
  return [lerp(path.pts[lo][0], path.pts[hi][0], k), lerp(path.pts[lo][1], path.pts[hi][1], k)];
}
const dPoly = (pts) => `M${pts.map((p) => `${r2(p[0])} ${r2(p[1])}`).join(" L")}`;
const dCubic = (a, b, c, d) =>
  `M${r2(a[0])} ${r2(a[1])} C${r2(b[0])} ${r2(b[1])} ${r2(c[0])} ${r2(c[1])} ${r2(d[0])} ${r2(d[1])}`;
const ease3 = (a, d, k = 0.45) => [
  [a[0] + (d[0] - a[0]) * k, a[1]],
  [d[0] - (d[0] - a[0]) * k, d[1]],
];
const link = (a, b) => {
  const ctl = ease3(a, b);
  return { d: dCubic(a, ...ctl, b), path: poly(cubicPts(a, ...ctl, b)) };
};

// 1. Slips -> Claude: the handwriting (an ink wave, loud at the paper, calm by the time Claude reads it).
const waveBase = poly(cubicPts(S, ...ease3(S, Cn, 0.5), Cn));
const wU0 = (R + 6) / waveBase.len;
const wU1 = 1 - (R + 6) / waveBase.len;
const wavePts = Array.from({ length: 241 }, (_, i) => {
  const u = i / 240;
  const base = along(waveBase, u);
  const w = clamp01((u - wU0) / ((wU1 - wU0) * 0.82));
  const env = Math.sin(Math.PI * w) ** 0.8 * (1 - 0.4 * w);
  return [base[0], base[1] + 24 * env * Math.sin(TAU * 3.5 * w)];
});
const wave = poly(wavePts);
// 2-4. The trace: Claude -> engine -> hash -> outbox (centre to centre; the discs cover the ends).
const ce = link(Cn, En);
const eh = link(En, H);
const ho = link(H, O);
// 5. Outbox -> PayPal: the connection (ink), the lost call and the retried one (indigo).
const op = link(O, P);
const DROP = 0.55; // where the first call is lost
// 64 member lines fan out of the engine and converge on the ring: the batch hash covers every line.
const FAN = 64;
const fan = Array.from({ length: FAN }, (_, i) => {
  const o = (i / (FAN - 1) - 0.5) * 2;
  const phi = Math.PI - o * 0.78; // entry angle on the ring's left half
  const end = [H[0] + RR * Math.cos(phi), H[1] + RR * Math.sin(phi)];
  const c1 = [En[0] + 180, En[1] + o * 165];
  const c2 = [end[0] + 62 * Math.cos(phi), end[1] + 62 * Math.sin(phi)]; // enter the ring along its radius
  return { o, d: dCubic(En, c1, c2, end), path: poly(cubicPts(En, c1, c2, end, 60)) };
});
// Two keys sign the ring: each thread enters it from above (a person's hand: indigo).
const keyThread = (k, ang) => {
  const a = [k[0], k[1] + KR];
  const end = [H[0] + RR * Math.cos(ang), H[1] + RR * Math.sin(ang)];
  const c1 = [a[0], a[1] + 62];
  const c2 = [end[0] + Math.cos(ang) * 48, end[1] + Math.sin(ang) * 48];
  return dCubic(a, c1, c2, end);
};
const ktD = keyThread(KT, (-118 * Math.PI) / 180);
const kcD = keyThread(KC, (-62 * Math.PI) / 180);
const ringD = `M${r2(H[0] - RR)} ${r2(H[1])} a${RR} ${RR} 0 1 1 ${2 * RR} 0 a${RR} ${RR} 0 1 1 ${-2 * RR} 0`;
// The retry loop: an arc over the outbox (clear of the threads in and out, and of its label), arrowhead down-right.
const RET = 80;
const retA0 = (198 * Math.PI) / 180;
const retA1 = (342 * Math.PI) / 180;
const onRet = (a) => [O[0] + RET * Math.cos(a), O[1] + RET * Math.sin(a)];
const retryD = (() => {
  const [sx, sy] = onRet(retA0);
  const [ex, ey] = onRet(retA1);
  return `M${r2(sx)} ${r2(sy)} A${RET} ${RET} 0 0 1 ${r2(ex)} ${r2(ey)}`;
})();
const retryHead = (() => {
  const [ex, ey] = onRet(retA1);
  const tx = -Math.sin(retA1); // clockwise tangent (y down)
  const ty = Math.cos(retA1);
  const L = 11;
  const b1 = [ex - tx * L - ty * L * 0.7, ey - ty * L + tx * L * 0.7];
  const b2 = [ex - tx * L + ty * L * 0.7, ey - ty * L - tx * L * 0.7];
  return `M${r2(b1[0])} ${r2(b1[1])} L${r2(ex)} ${r2(ey)} L${r2(b2[0])} ${r2(b2[1])}`;
})();

// ---------- schedule (local seconds, all derived from the words) ----------
const T = {
  slips: W.slips + 0.04,
  slipsLb: W.slips + 0.16,
  wave: [W.slips + 0.42, W.claude - 0.08],
  claude: W.claude - 0.14,
  claudeLb: W.claude - 0.04,
  slipsOut: W.claude + 0.2,
  demoTag: [W.claude + 0.15, W.deterministic + 0.2],
  ce: [W.thenA + 0.1, W.deterministic - 0.12],
  engine: W.deterministic - 0.12,
  engineLb: W.deterministic - 0.02,
  claudeOut: W.deterministic + 0.18,
  eh: [W.engine - 0.1, W.engine + 0.42],
  fan0: W.engine - 0.08,
  hashNode: W.engine + 0.08,
  ring: [W.engine + 0.26, W.two + 0.3],
  treasurer: W.two - 0.05,
  chair: W.keys - 0.1,
  engineOut: W.keys + 0.05,
  signT: [W.sign - 0.25, W.sign + 0.15],
  signC: [W.sign - 0.1, W.sign + 0.3],
  signedLb: W.sign + 0.02,
  glyph: [W.one - 0.04, W.batch + 0.1],
  ho: [W.an - 0.15, W.outbox - 0.08],
  signedOut: W.an + 0.1,
  outbox: W.outbox - 0.16,
  outboxLb: W.outbox - 0.05,
  conn: [W.makes + 0.02, W.simulated - 0.1],
  paypal: W.simulated - 0.12,
  paypalLb: W.paypal - 0.08,
  call1: [W.call - 0.3, W.call + 0.1],
  callLost: [W.call + 0.03, W.call + 0.21],
  call1Fade: [W.call + 0.1, W.call + 0.43],
  retry: [W.safe - 0.12, W.safe + 0.4],
  outboxOut: W.safe - 0.14,
  retryLb: W.safe + 0.04,
  call2In: [W.to - 0.1, W.to - 0.02],
  call2: [W.to - 0.03, W.retry],
  landed: W.retry,
  retryOut: W.retry + 0.22,
  back: W.end + 0.05,
};
T.simTag = T.paypal; // the tag starts on the same frame as the PayPal node (STYLE §7)
const HOLD_FROM = T.landed + 0.05; // every element has landed; the finished diagram holds from here

// ---------- camera: node-to-node pushes (sine.inOut, a small zoom-out dip mid-move), slow pushes between ----------
const CAM = [
  { t: 0, x: 365, y: 572, s: 1.9 },
  { t: T.slipsOut + 0.02, x: 392, y: 566, s: 1.93, e: E.inOutSine },
  { t: 2.85, x: 795, y: 588, s: 1.92, e: E.inOutSine, dip: 0.1 },
  { t: 3.4, x: 802, y: 585, s: 1.95, e: E.inOutSine },
  { t: 4.55, x: 1100, y: 528, s: 1.62, e: E.inOutSine, dip: 0.05 },
  { t: 6.15, x: 1104, y: 528, s: 1.65, e: E.inOutSine },
  { t: 7.35, x: 1525, y: 566, s: 1.6, e: E.inOutSine, dip: 0.08 },
  { t: 10.6, x: 1536, y: 563, s: 1.63, e: E.inOutSine },
  { t: 12.55, x: 960, y: 540, s: 1, e: E.inOutSine },
  { t: DUR, x: 960, y: 540, s: 1.012, e: E.inOutSine },
];
function camAt(t) {
  if (t <= CAM[0].t) return CAM[0];
  for (let i = 1; i < CAM.length; i++) {
    const a = CAM[i - 1];
    const b = CAM[i];
    if (t <= b.t) {
      const u = (t - a.t) / (b.t - a.t);
      const e = b.e(u);
      const dip = b.dip ? 1 - b.dip * Math.sin(Math.PI * E.inOutSine(u)) : 1;
      return {
        x: lerp(a.x, b.x, e),
        y: lerp(a.y, b.y, e),
        s: Math.exp(lerp(Math.log(a.s), Math.log(b.s), e)) * dip,
      };
    }
  }
  return CAM.at(-1);
}
const toScreen = (p, c) => [960 + c.s * (p[0] - c.x), 540 + c.s * (p[1] - c.y)];

// ---------- keyframe compiler ----------
const kf = [];
const rules = [];
let kid = 0;
const pct = (f) => `${r3((f / N) * 100)}%`;
/** Compile per-frame values of each CSS property into one keyframes rule; holds collapse to their end stops. */
const animated = [];
const values = {}; // selector -> prop -> per-frame values (for the self-checks)
function animate(selector, props, extra = "") {
  animated.push(selector);
  values[selector] = {};
  const list = [];
  for (const [prop, fn] of Object.entries(props)) {
    const vals = Array.from({ length: N + 1 }, (_, f) => fn(f / FPS));
    values[selector][prop] = vals;
    if (vals.every((v) => v === vals[0])) {
      extra += `${prop}:${vals[0]};`;
      continue;
    }
    const stops = [];
    for (let f = 0; f <= N; f++)
      if (f === 0 || f === N || vals[f] !== vals[f - 1] || vals[f] !== vals[f + 1])
        stops.push(`${pct(f)}{${prop}:${vals[f]}}`);
    const name = `arch-k${kid++}`;
    kf.push(`@keyframes ${name}{${stops.join("")}}`);
    list.push(`${name} ${DUR}s linear 0s 1 both`);
  }
  rules.push(`${selector}{${extra}${list.length ? `animation:${list.join(",")};` : ""}}`);
}
const opacity = (v) => `${r3(v)}`;
const draw = (p) => `${r3(1.002 - 1.002 * clamp01(p))}`;
const blurOf = (px) => (px < 0.05 ? "none" : `blur(${r1(px)}px)`);
// HyperFrames' CSS adapter seeks only HTML elements (offset by their clip's start); an SVG element's own CSS
// animation would be seeked on film time instead and jump to its end once this part sits at 30 s. So every SVG
// property is driven by a registered custom property animated on an HTML wrapper, which the SVG reads via var().
const svgVars = {};
const atProps = [];
function svgVar(name, fn, initial, ...uses) {
  svgVars[`--${name}`] = fn;
  atProps.push(`@property --${name}{syntax:"<number>";inherits:true;initial-value:${initial}}`);
  for (const [selector, declaration] of uses) rules.push(`${selector}{${declaration}}`);
}
const drawVar = (name, selector, fn) =>
  svgVar(name, (t) => draw(fn(t)), 1.002, [selector, `stroke-dashoffset:var(--${name})`]);

// ---------- icons (48-unit line icons, drawn in) ----------
const ICON = {
  slips: [
    "M14 6 H30 L36 12 V42 H14 Z",
    "M30 6 V12 H36",
    "M18.5 20 q2.2 -3 4.4 0 t4.4 0 t4.4 0",
    "M18.5 27 q2.2 -3 4.4 0 t4.4 0 t4.4 0",
    "M18.5 34 q2.2 -3 4.4 0 t4.4 0",
  ],
  claude: [
    "M8 16 V9 H15",
    "M33 9 H40 V16",
    "M40 32 V39 H33",
    "M15 39 H8 V32",
    "M15 19 H33",
    "M15 24.5 H33",
    "M15 30 H27",
  ],
  engine: ["M34 10 H14 L25 24 L14 38 H34", "M30.5 10 V13.5", "M30.5 38 V34.5"],
  hash: ["M20.5 11 L17 37", "M31 11 L27.5 37", "M12 19.5 H37", "M11 28.5 H36"],
  key: ["M4 24 a8.5 8.5 0 1 0 17 0 a8.5 8.5 0 1 0 -17 0", "M21 24 H45", "M37 24 V31.5", "M43 24 V30"],
  outbox: ["M8 29 H16.5 L19.5 33.5 H28.5 L31.5 29 H40 V40 H8 Z", "M24 25 V8", "M17.5 14.5 L24 8 L30.5 14.5"],
  paypal: ["M7 14 H41 V35 H7 Z", "M19 24.5 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0", "M12 19 V30", "M36 19 V30"],
};
const iconSvg = (name, size) =>
  `<svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">${ICON[name].map((d) => `<path class="ln" pathLength="1" d="${d}"/>`).join("")}</svg>`;
const FLASK =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5h6M10 3.5v5.2L4.8 17.6A2 2 0 0 0 6.5 20.5h11a2 2 0 0 0 1.7-2.9L14 8.7V3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><path d="M7.4 14.5h9.2" stroke="currentColor" stroke-width="2"/></svg>';

// ---------- nodes (HTML discs over the SVG lines, same world coordinates) ----------
const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const NODES = [
  // built: on screen from the first frame, fully drawn, because the opening's last second already draws this disc
  // under the veil (plan.mjs SLIPS_UNDER_VEIL); its word still lands the label at T.slipsLb
  { id: "slips", at: S, r: R, icon: "slips", land: T.slips, built: true },
  { id: "claude", at: Cn, r: R, icon: "claude", land: T.claude },
  { id: "engine", at: En, r: R, icon: "engine", land: T.engine },
  { id: "hash", at: H, r: R, icon: "hash", land: T.hashNode, iconAt: T.glyph },
  { id: "treasurer", at: KT, r: KR, icon: "key", land: T.treasurer },
  { id: "chair", at: KC, r: KR, icon: "key", land: T.chair },
  { id: "outbox", at: O, r: R, icon: "outbox", land: T.outbox },
  { id: "paypal", at: P, r: R, icon: "paypal", land: T.paypal, sim: true },
];
const node = (id) => NODES.find((n) => n.id === id);
// One readable word per step; a passed step's word leaves with the camera, the four step words return for the overview,
// each from the first frame of the pull-back on which it sits whole inside the frame (never at an edge).
function backAt(at, half) {
  for (let f = Math.ceil((T.retryOut + 0.3) * FPS); f <= N; f++) {
    const c = camAt(f / FPS);
    const [x] = toScreen(at, c);
    if (x - half * c.s >= 120 && x + half * c.s <= 1800) return f / FPS;
  }
  throw new Error("a step word never fits the frame");
}
const LABELS = [
  { id: "slips", node: "slips", text: "Slips", windows: [[T.slipsLb, T.slipsOut]] },
  {
    id: "claude",
    node: "claude",
    text: "Claude",
    windows: [
      [T.claudeLb, T.claudeOut],
      [backAt(Cn, 90), null],
    ],
  },
  {
    id: "engine",
    node: "engine",
    text: "Engine",
    windows: [
      [T.engineLb, T.engineOut],
      [backAt(En, 90), null],
    ],
  },
  {
    id: "signed",
    node: "hash",
    text: "Signed",
    top: RR + 20,
    windows: [
      [T.signedLb, T.signedOut],
      [backAt(H, 90), null],
    ],
  },
  { id: "outbox", node: "outbox", text: "Outbox", windows: [[T.outboxLb, T.outboxOut]] },
  { id: "retry", node: "outbox", text: "Safe to retry", windows: [[T.retryLb, T.retryOut]] },
  { id: "paypal", node: "paypal", text: "PayPal", windows: [[T.paypalLb, null]] },
];
const LB = 40; // label size at the overview (camera scale 1); every push is closer, so never under 36 px
function nodeHtml(n) {
  const [x, y] = n.at;
  const ic = n.r === KR ? 40 : 56;
  const labels = LABELS.filter((l) => l.node === n.id)
    .map(
      (l) =>
        // the outbox's two words share one place and cross-fade ("Outbox" -> "Safe to retry")
        `<div class="lb" id="arch-l-${l.id}" style="top:${l.top ?? n.r + 14}px"${n.id === "outbox" ? " data-layout-allow-overlap" : ""}>${esc(l.text)}</div>`,
    )
    .join("");
  return `<div class="node" id="arch-n-${n.id}" style="left:${r2(x)}px;top:${r2(y)}px"><div class="disc${n.sim ? " sim" : ""}" style="left:${-n.r}px;top:${-n.r}px;width:${2 * n.r}px;height:${2 * n.r}px"><div class="ic" style="left:${n.r - ic / 2}px;top:${n.r - ic / 2}px">${iconSvg(n.icon, ic)}</div></div>${labels}</div>`;
}

// ---------- the SVG (lines under the discs) ----------
const trace = (id) =>
  `<g id="arch-tr-${id}"><path class="tr glow" pathLength="1" d="${id === "c1" || id === "c2" ? op.d : { ce, eh, ho }[id].d}" style="stroke-dashoffset:var(--t-${id})"/><path class="tr main" pathLength="1" d="${id === "c1" || id === "c2" ? op.d : { ce, eh, ho }[id].d}" style="stroke-dashoffset:var(--t-${id})"/><path class="tr core" pathLength="1" d="${id === "c1" || id === "c2" ? op.d : { ce, eh, ho }[id].d}" style="stroke-dashoffset:var(--t-${id})"/></g>`;
const svg = `<svg id="arch-svg" viewBox="0 0 1920 1080" width="1920" height="1080" role="img" aria-label="Fair Split architecture: handwritten slips go to Claude (the demo replays a labelled seed stand-in), then a deterministic engine computes 64 member lines; the Treasurer and the Chair sign one batch hash; an outbox makes each call to the PayPal simulator safe to retry. Simulated PayPal sandbox.">
<defs><filter id="arch-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4.5"/></filter></defs>
<g class="fan">${fan.map((f, i) => `<path id="arch-f${i}" class="th" pathLength="1" d="${f.d}"/>`).join("")}</g>
<path id="arch-wave" class="th wave" pathLength="1" d="${dPoly(wavePts)}"/>
<path id="arch-conn" class="th conn" pathLength="1" d="${op.d}"/>
<path id="arch-ring" class="th ring" pathLength="1" d="${ringD}"/>
<path id="arch-retry" class="th retry" pathLength="1" d="${retryD}"/>
<path id="arch-retry-head" class="th retry" pathLength="1" d="${retryHead}"/>
<path id="arch-kt" class="th sig" pathLength="1" d="${ktD}"/>
<path id="arch-kc" class="th sig" pathLength="1" d="${kcD}"/>
${trace("ce")}${trace("eh")}${trace("ho")}${trace("c1")}${trace("c2")}
</svg>`;

// ---------- the day field (identical to the film's capture-slot beats: film-slots.js + film.css) ----------
const LIGHTS = [
  { id: "lightA", x: -700, y: -620, k: 0.5, dx: 60, dy: 40, f: 0.05, par: 0.1 },
  { id: "lightC", x: 900, y: -560, k: 0.8, dx: -50, dy: 50, f: 0.04, par: 0.14 },
  { id: "lightB", x: 160, y: 120, k: 1.1, dx: 70, dy: -40, f: 0.035, par: 0.2 },
];
const DAPPLE_PAR = 0.3;
// the field's own drift on the film clock, plus parallax with the camera (zero at the overview, so the beat ends on
// exactly the field the highlight reel opens on)
const field = (t) => {
  const Tf = FILM0 + t;
  return { cx: 260 * Math.sin((TAU * Tf) / 96), cy: 70 * Math.sin((TAU * Tf) / 71 + 0.6), Tf };
};
const parallax = (t, k) => {
  const c = camAt(t);
  return [-(c.x - 960) * c.s * k, -(c.y - 540) * c.s * k];
};
for (const L of LIGHTS)
  animate(`#arch-${L.id}`, {
    transform: (t) => {
      const { cx, cy, Tf } = field(t);
      const [qx, qy] = parallax(t, L.par);
      const px = L.x - cx * L.k + L.dx * Math.sin(TAU * L.f * Tf) + qx;
      const py = L.y - cy * L.k + L.dy * Math.cos(TAU * L.f * 0.8 * Tf) + qy;
      return `translate(${r1(px)}px,${r1(py)}px)`;
    },
  });
animate("#arch-dapple", {
  transform: (t) => {
    const { cx, cy, Tf } = field(t);
    const [qx, qy] = parallax(t, DAPPLE_PAR);
    const dx = -640 - cx * 0.3 + 26 * Math.sin(TAU * 0.09 * Tf) + qx;
    const dy = -360 - cy * 0.3 + 14 * Math.sin(TAU * 0.07 * Tf + 1) + qy;
    return `translate(${r1(dx)}px,${r1(dy)}px)`;
  },
});

// grain (STYLE §10): the film's first seeded tile, at a seeded offset every frame, 20% overlay by day
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function grainPng() {
  const rng = mulberry32(1104);
  const raw = Buffer.alloc(257 * 256);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) raw[y * 257 + 1 + x] = Math.round((255 * (rng() + rng())) / 2);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(256, 0);
  ihdr.writeUInt32BE(256, 4);
  ihdr[8] = 8; // bit depth; colour type 0 (grey)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
animate("#arch-grain", {
  "background-position": (t) => {
    const r = mulberry32(Math.round((FILM0 + t) * FPS) * 7919 + 13);
    const ox = Math.floor(r() * 256);
    const oy = Math.floor(r() * 256);
    return `${-ox}px ${-oy}px`;
  },
});

// ---------- camera, motion blur, depth of field ----------
// the joints (STYLE §5): the opening ends under a 92% daylight veil, so this beat opens under the same veil and
// lifts it (0-0.7 s) off the Slips disc, built from the first frame (plan.mjs SLIPS_UNDER_VEIL); at the end the diagram dissolves into the field (blur and fade,
// last 0.6 s) and the reel's focus pull starts on that same empty field at 44 s, with the sandbox tag running on
const veilAt = (t) => 0.92 * (1 - prog(t, 0, 0.7, E.inOutSine));
const dissolveAt = (t) => prog(t, DUR - 0.6, DUR - 1 / FPS, E.inQuad);
animate("#arch-veil", { opacity: (t) => opacity(veilAt(t)) });
animate("#arch-world", {
  transform: (t) => {
    const c = camAt(t);
    return `matrix(${r3(c.s)},0,0,${r3(c.s)},${r2(960 - c.s * c.x)},${r2(540 - c.s * c.y)})`;
  },
  opacity: (t) => opacity(1 - dissolveAt(t)),
  filter: (t) => blurOf(18 * (veilAt(t) / 0.92) + 16 * dissolveAt(t)),
});
// directional motion blur keyed to the camera's speed (STYLE §5), on a container of its own; one SVG filter per
// quantised (x, y) sigma that the camera actually uses
const blurKeys = new Set();
const mbAt = (t) => {
  const c = camAt(t);
  const p = camAt(Math.max(0, t - 1 / FPS));
  const vx = Math.abs(c.x - p.x) * c.s;
  const vy = Math.abs(c.y - p.y) * c.s;
  const bx = Math.round(Math.min(10, 0.2 * vx) * 2) / 2;
  const by = Math.round(Math.min(6, 0.2 * vy) * 2) / 2;
  return bx < 0.6 && by < 0.6 ? null : `${bx * 10}-${by * 10}`;
};
animate("#arch-mb", {
  filter: (t) => {
    const key = mbAt(t);
    if (!key) return "none";
    blurKeys.add(key);
    return `url(#arch-mb-${key})`;
  },
});
// depth of field: blur grows with a node's distance from the frame centre (none within 240 px), and only while
// the camera is pushed in; at the overview everything is sharp (STYLE §4)
function dofAt(n, t) {
  const c = camAt(t);
  const focus = clamp01((c.s - 1.15) / 0.35);
  const [x, y] = toScreen(n.at, c);
  const d = Math.hypot(x - 960, y - 540) - n.r * c.s;
  return clamp01((d - 240) / 520) * 6 * focus;
}

// ---------- the trace's travelling light and the pen ----------
const moves = [
  { at: T.ce, path: ce.path, ease: E.inOutCubic },
  { at: T.eh, path: eh.path, ease: E.inOutCubic },
  { at: T.ho, path: ho.path, ease: E.inOutCubic },
  { at: T.call1, path: op.path, ease: E.inQuad, to: DROP },
  { at: [T.call2In[0], T.call2In[0] + 1e-4], path: op.path, from: 0, to: 0 },
  { at: T.call2, path: op.path, ease: E.inOutCubic },
];
const moveP = (m, t) => lerp(m.from ?? 0, m.to ?? 1, prog(t, m.at[0], m.at[1], m.ease));
function headAt(t) {
  let pos = Cn;
  for (const m of moves) {
    if (t < m.at[0]) break;
    pos = along(m.path, moveP(m, t));
  }
  return pos;
}
animate("#arch-head", {
  transform: (t) => {
    const [x, y] = headAt(t);
    return `translate(${r2(x)}px,${r2(y)}px)`;
  },
  opacity: (t) =>
    opacity(
      prog(t, T.ce[0] - 0.1, T.ce[0], E.linear) * (1 - prog(t, T.callLost[0], T.callLost[1], E.linear)) +
        (t >= T.call2In[0] ? prog(t, T.call2In[0], T.call2In[1], E.linear) : 0) *
          (1 - prog(t, T.landed + 0.02, T.landed + 0.12, E.linear)),
    ),
});
animate("#arch-pen", {
  transform: (t) => {
    const [x, y] = along(wave, prog(t, T.wave[0], T.wave[1], E.inOutCubic));
    return `translate(${r2(x)}px,${r2(y)}px)`;
  },
  opacity: (t) =>
    opacity(
      prog(t, T.wave[0], T.wave[0] + 0.1, E.linear) * (1 - prog(t, T.wave[1] - 0.12, T.wave[1], E.linear)),
    ),
});

// ---------- lines ----------
drawVar("wave", "#arch-wave", (t) => prog(t, T.wave[0], T.wave[1], E.inOutCubic));
drawVar("t-ce", "#arch-tr-ce path", (t) => moveP(moves[0], t));
drawVar("t-eh", "#arch-tr-eh path", (t) => moveP(moves[1], t));
drawVar("t-ho", "#arch-tr-ho path", (t) => moveP(moves[2], t));
drawVar("t-c1", "#arch-tr-c1 path", (t) => moveP(moves[3], t));
svgVar("c1o", (t) => opacity(1 - prog(t, T.call1Fade[0], T.call1Fade[1], E.inOutSine)), 1, [
  "#arch-tr-c1",
  "opacity:var(--c1o)",
]);
drawVar("t-c2", "#arch-tr-c2 path", (t) => (t < T.call2[0] ? 0 : moveP(moves[5], t)));
fan.forEach((f, i) => {
  const t0 = T.fan0 + Math.abs(f.o) * 0.26 + (i % 2) * 0.02;
  drawVar(`f${i}`, `#arch-f${i}`, (t) => prog(t, t0, t0 + 0.5, E.inOutCubic));
});
drawVar("ring", "#arch-ring", (t) => prog(t, T.ring[0], T.ring[1], E.inOutCubic));
drawVar("kt", "#arch-kt", (t) => prog(t, T.signT[0], T.signT[1], E.inOutCubic));
drawVar("kc", "#arch-kc", (t) => prog(t, T.signC[0], T.signC[1], E.inOutCubic));
drawVar("conn", "#arch-conn", (t) => prog(t, T.conn[0], T.conn[1], E.inOutCubic));
drawVar("retry", "#arch-retry", (t) => prog(t, T.retry[0], T.retry[1], E.inOutCubic));
drawVar("retry-head", "#arch-retry-head", (t) => prog(t, T.retry[1] - 0.06, T.retry[1] + 0.14, E.outCubic));
animate("#arch-svgwrap", svgVars);

// ---------- nodes land: lift (scale 0.55 -> 1, y 30 -> 0, blur 10 -> 0, expo.out), icon draws, depth of field ----------
for (const n of NODES) {
  const t0 = n.land;
  if (n.built) {
    // the joint at 30 s: no lift-in, no blink; the disc only keeps its depth of field
    animate(`#arch-n-${n.id}`, { opacity: () => "1", filter: (t) => blurOf(dofAt(n, t)) });
    animate(`#arch-n-${n.id} .ic`, { "--icd": () => draw(1) });
    continue;
  }
  animate(`#arch-n-${n.id}`, {
    opacity: (t) => opacity(prog(t, t0, t0 + 0.4, E.outCubic)),
    transform: (t) => {
      const p = prog(t, t0, t0 + 0.75, E.outExpo);
      return `translate(0px,${r2(30 * (1 - p))}px) scale(${r3(0.55 + 0.45 * p)})`;
    },
    filter: (t) => blurOf(10 * (1 - prog(t, t0, t0 + 0.75, E.outExpo)) + dofAt(n, t)),
  });
  const i0 = n.iconAt ? n.iconAt[0] : t0 + 0.05;
  const i1 = n.iconAt ? n.iconAt[1] : t0 + 0.75;
  animate(`#arch-n-${n.id} .ic`, { "--icd": (t) => draw(prog(t, i0, i1, E.outCubic)) });
}
atProps.push('@property --icd{syntax:"<number>";inherits:true;initial-value:1.002}');

// labels: rise in (y 16 -> 0, blur 8 -> 0, 0.6 s power3.out), out 0.32 s power3.in
function labelState(l, t) {
  let v = 0;
  let y = 16;
  let b = 8;
  for (const [tin, tout] of l.windows) {
    if (t < tin) continue;
    const pin = prog(t, tin, tin + 0.6, E.outCubic);
    const pout = tout === null ? 0 : prog(t, tout, tout + 0.32, E.inCubic);
    v = pin * (1 - pout);
    y = 16 * (1 - pin) - 10 * pout;
    b = 8 * (1 - pin) + 8 * pout;
  }
  return { v, y, b };
}
for (const l of LABELS)
  animate(`#arch-l-${l.id}`, {
    opacity: (t) => opacity(labelState(l, t).v),
    transform: (t) => `translateY(${r2(labelState(l, t).y)}px)`,
    filter: (t) => blurOf(labelState(l, t).b),
  });

// pulses: two indigo signatures on the ring, one jade pulse on the PayPal node (0.7 s each)
const pulse = (id, t0, grow, peak) =>
  animate(`#arch-${id}`, {
    transform: (t) => `scale(${r3(1 + grow * prog(t, t0, t0 + 0.7, E.outExpo))})`,
    opacity: (t) => opacity(t < t0 ? 0 : peak * (1 - prog(t, t0, t0 + 0.7, E.linear))),
  });
pulse("sig-1", T.signT[1], 0.75, 0.9);
pulse("sig-2", T.signC[1], 0.75, 0.9);
pulse("jade", T.landed, 1.35, 0.95);
animate("#arch-end", {
  transform: (t) => `scale(${r3(prog(t, T.landed, T.landed + 0.42, E.outBack))})`,
});

// tags: one at a time, bottom-right (STYLE §7): the stand-in while Claude is the subject; the sandbox from the PayPal
// node's first frame to the end of the beat
const tagIn = (t, t0) => prog(t, t0, t0 + 0.4, E.outCubic);
animate("#arch-tag-demo", {
  opacity: (t) =>
    opacity(tagIn(t, T.demoTag[0]) * (1 - prog(t, T.demoTag[1], T.demoTag[1] + 0.25, E.inCubic))),
  transform: (t) => `translateX(${r2(14 * (1 - tagIn(t, T.demoTag[0])))}px)`,
});
animate("#arch-tag-sim", {
  opacity: (t) => opacity(tagIn(t, T.simTag)),
  transform: (t) => `translateX(${r2(14 * (1 - tagIn(t, T.simTag)))}px)`,
});

// ---------- styles ----------
const css = `
@font-face{font-family:"FS Sans";src:url("../assets/fonts/FSSans-VF.woff2") format("woff2");font-weight:200 900;font-stretch:75% 125%}
#root{position:absolute;inset:0;width:100%;height:100%;overflow:hidden;background:${C.ground}}
#arch-stage{position:absolute;inset:0;overflow:hidden;background:${C.ground};font-family:"FS Sans",sans-serif;font-variant-numeric:lining-nums proportional-nums;color:${C.ink};-webkit-font-smoothing:antialiased}
#arch-field{position:absolute;inset:0;overflow:hidden;background:${C.ground}}
.light{position:absolute;left:0;top:0;border-radius:50%}
#arch-lightA{width:1900px;height:1500px;background:radial-gradient(closest-side,rgb(20 204 144/.16),rgb(20 204 144/.11) 25%,rgb(20 204 144/.06) 50%,rgb(20 204 144/.02) 75%,transparent)}
#arch-lightB{width:1700px;height:1300px;background:radial-gradient(closest-side,rgb(255 255 255/.92),rgb(255 255 255/.62) 30%,rgb(255 255 255/.28) 60%,rgb(255 255 255/.07) 84%,transparent)}
#arch-lightC{width:1800px;height:1500px;background:radial-gradient(closest-side,rgb(74 47 214/.09),rgb(74 47 214/.06) 30%,rgb(74 47 214/.025) 62%,transparent)}
#arch-wash{position:absolute;inset:0;background:radial-gradient(56% 74% at 0% 0%,rgb(20 204 144/.15),rgb(20 204 144/.1) 20%,rgb(20 204 144/.055) 42%,rgb(20 204 144/.02) 66%,transparent 90%),radial-gradient(44% 60% at 64% 0%,rgb(74 47 214/.09),rgb(74 47 214/.06) 22%,rgb(74 47 214/.03) 46%,rgb(74 47 214/.01) 70%,transparent 92%)}
#arch-dapple{position:absolute;left:0;top:0;width:3200px;height:1800px;opacity:.85;background:url("../assets/dapple.png") 0 0/100% 100% no-repeat}
#arch-mb{position:absolute;inset:0}
#arch-veil{position:absolute;inset:0;background:${C.ground}}
#arch-veil::after{content:"";position:absolute;inset:0;background:radial-gradient(52% 70% at 0% 0%,rgb(20 204 144/.14),rgb(20 204 144/.07) 35%,rgb(20 204 144/.02) 65%,transparent 90%),radial-gradient(42% 58% at 62% 0%,rgb(74 47 214/.09),rgb(74 47 214/.04) 40%,transparent 85%)}
#arch-world{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0}
#arch-svgwrap{position:absolute;left:0;top:0;width:1920px;height:1080px}
#arch-svg{position:absolute;left:0;top:0;overflow:visible}
.th{fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1 2;stroke-dashoffset:1.002}
.fan .th{stroke:${C.ink};stroke-opacity:.13;stroke-width:1}
.wave{stroke:${C.ink2};stroke-opacity:.78;stroke-width:2.6}
.conn{stroke:${C.ink};stroke-opacity:.34;stroke-width:2}
.ring{stroke:${C.ink};stroke-opacity:.82;stroke-width:2.4}
.retry{stroke:${C.ink2};stroke-width:2.6}
.sig{stroke:${C.pod};stroke-width:3}
.tr{fill:none;stroke-linecap:round;stroke-dasharray:1 2;stroke-dashoffset:1.002}
.tr.glow{stroke:${C.pod};stroke-opacity:.3;stroke-width:13;filter:url(#arch-glow)}
.tr.main{stroke:${C.pod};stroke-width:5}
.tr.core{stroke:#fff;stroke-opacity:.35;stroke-width:1.5}
.node{position:absolute;width:0;height:0;opacity:0}
.disc{position:absolute;border-radius:50%;background:${C.plate};box-shadow:0 1px 2px rgb(11 18 32/.08),0 20px 36px -16px rgb(11 18 32/.3),0 0 0 1px rgb(11 18 32/.06)}
.disc.sim{background:rgb(255 255 255/.9);border:2.5px dashed ${C.steel};box-shadow:0 18px 32px -18px rgb(11 18 32/.22)}
.ic{position:absolute}
.ic svg{display:block;overflow:visible}
.disc.sim .ic{margin:-2.5px 0 0 -2.5px}
.ic .ln{fill:none;stroke:${C.ink};stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1 2;stroke-dashoffset:var(--icd)}
.lb{position:absolute;left:-300px;width:600px;text-align:center;white-space:nowrap;opacity:0;font-size:${LB}px;line-height:48px;font-stretch:112.5%;font-weight:660;letter-spacing:-.02em;color:${C.ink}}
#arch-head,#arch-pen{position:absolute;left:0;top:0;width:0;height:0;opacity:0}
#arch-head i{position:absolute;left:-26px;top:-26px;width:52px;height:52px;border-radius:50%;background:radial-gradient(circle,#fff 0,rgb(255 255 255/.9) 25%,rgb(156 140 255/.45) 50%,rgb(156 140 255/0) 100%)}
#arch-pen i{position:absolute;left:-5px;top:-5px;width:10px;height:10px;border-radius:50%;background:${C.ink2}}
.pulse{position:absolute;border-radius:50%;opacity:0}
#arch-sig-1,#arch-sig-2{left:${H[0] - RR}px;top:${H[1] - RR}px;width:${2 * RR}px;height:${2 * RR}px;border:3px solid ${C.pod}}
#arch-jade{left:${P[0] - R - 4}px;top:${P[1] - R - 4}px;width:${2 * R + 8}px;height:${2 * R + 8}px;border:4px solid ${C.jade};box-shadow:0 0 16px rgb(20 204 144/.6)}
#arch-end{position:absolute;left:${P[0] - R - 8}px;top:${P[1] - 8}px;width:16px;height:16px;border-radius:50%;background:${C.jade};border:3px solid #fff;transform:scale(0)}
.tag{position:absolute;right:64px;top:960px;display:inline-flex;align-items:center;gap:14px;height:64px;padding:0 28px 0 23px;border-radius:999px;font-stretch:100%;font-weight:600;font-size:32px;line-height:1;white-space:nowrap;opacity:0;color:${C.ink2};border:2px dashed ${C.steel};background:rgb(255 255 255/.9)}
.tag svg{width:30px;height:30px;flex:none;color:${C.ink3}}
.tag--nodot{padding-left:28px}
#arch-grain{position:absolute;left:0;top:0;width:960px;height:540px;transform:scale(2);transform-origin:0 0;pointer-events:none;mix-blend-mode:overlay;opacity:.2;background:url("../assets/grain.png") 0 0/256px 256px repeat}
`;

const mbDefs = () =>
  [...blurKeys]
    .sort()
    .map((key) => {
      const [x, y] = key.split("-").map((v) => Number(v) / 10);
      return `<filter id="arch-mb-${key}" x="-2%" y="-2%" width="104%" height="104%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${x} ${y}"/></filter>`;
    })
    .join("");

const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><title>Fair Split film · Architecture</title></head><body><template>
<style>${atProps.join("\n")}
${css}
${rules.join("\n")}
${kf.join("\n")}
</style>
<div id="root" data-no-timeline data-composition-id="architecture" data-width="1920" data-height="1080" data-duration="${DUR}">
<div id="arch-stage" class="clip" data-start="0" data-duration="${DUR}" data-track-index="0">
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${mbDefs()}</defs></svg>
<div id="arch-field" data-layout-allow-overflow><div id="arch-lightA" class="light" data-layout-allow-overflow></div><div id="arch-lightC" class="light" data-layout-allow-overflow></div><div id="arch-lightB" class="light" data-layout-allow-overflow></div><div id="arch-wash"></div><div id="arch-dapple" data-layout-allow-overflow></div></div>
<div id="arch-mb" data-layout-allow-overflow>
<div id="arch-world" data-layout-allow-overflow>
<div id="arch-svgwrap">${svg}</div>
<div id="arch-pen"><i></i></div>
<div id="arch-head"><i></i></div>
<div id="arch-sig-1" class="pulse"></div><div id="arch-sig-2" class="pulse"></div><div id="arch-jade" class="pulse"></div>
${NODES.map(nodeHtml).join("\n")}
<div id="arch-end"></div>
</div>
</div>
<div id="arch-veil"></div>
<div class="tag tag--nodot" id="arch-tag-demo">Seed stand-in reading</div>
<div class="tag" id="arch-tag-sim">${FLASK}Simulated PayPal sandbox</div>
<div id="arch-grain" data-layout-allow-overflow></div>
</div>
</div>
</template></body></html>
`;

const index = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080"><title>Fair Split film · Architecture beat</title>
<style>html,body{margin:0;background:${C.ground}}#root{position:relative;width:100%;height:100%;overflow:hidden}</style></head>
<body><div id="root" data-no-timeline data-composition-id="architecture-part" data-fps="${FPS}" data-width="1920" data-height="1080" data-duration="${DUR}"><div id="part-architecture" class="clip" data-no-timeline data-composition-id="architecture" data-composition-src="compositions/architecture.html" data-start="0" data-duration="${DUR}" data-track-index="0" data-width="1920" data-height="1080"></div></div></body></html>
`;

// ---------- self-checks: the build fails rather than ship a beat that drifts off its words or breaks STYLE ----------
const near = (label, at, word, before = 0.3, after = 0.5) =>
  assert(
    at >= word - before && at <= word + after,
    `${label} lands at ${r2(at)} s, off its word at ${r2(word)} s`,
  );
near("Slips", T.slips, W.slips);
near("Claude", T.claude, W.claude);
near("Engine", T.engine, W.deterministic);
near("64 lines", T.fan0, W.engine);
near("Treasurer key", T.treasurer, W.two);
near("Chair key", T.chair, W.keys);
near("Signatures", T.signT[1], W.sign);
near("Batch hash", T.glyph[0], W.one);
near("Outbox", T.outbox, W.outbox);
near("PayPal", T.paypal, W.simulated);
near("Lost call", T.call1[1], W.call);
near("Safe to retry", T.retryLb, W.safe);
near("Retried call lands", T.landed, W.retry);
assert(HOLD_FROM <= W.end + 0.1, "The build must finish with the narration");
assert(
  DUR - HOLD_FROM >= 3,
  `The finished diagram holds ${r2(DUR - HOLD_FROM)} s; it must hold at least 3 s`,
);
const settled = CAM.at(-2);
assert(settled.s === 1 && settled.x === 960 && settled.y === 540, "The camera must end on the overview");
assert(DUR - settled.t >= 1.2, "The overview must be settled for at least 1.2 s");
// per frame: the readable words (labels at least half on, not blurred out, on screen), the tag corner, label size,
// and the travel of every visible node between frames (STYLE §2, §5, §7, §11)
const words = (s) => s.split(/\s+/).length;
let maxTravel = 0;
let maxTravelAt = 0;
for (let f = 0; f <= N; f++) {
  const t = f / FPS;
  const c = camAt(t);
  assert(LB * c.s >= 36, `Labels fall under 36 px at ${r2(t)} s`);
  let readable = 0;
  for (const l of LABELS) {
    const st = labelState(l, t);
    const n = node(l.node);
    const [x, y] = toScreen(n.at, c);
    const on = x > -100 && x < 2020 && y > -100 && y < 1180;
    if (on && st.v > 0.5 && st.b < 4 && dofAt(n, t) < 2.5) readable += words(l.text);
  }
  assert(readable <= 4, `${readable} readable words at ${r2(t)} s (STYLE §2: at most four)`);
  for (const n of NODES) {
    if (t < n.land) continue;
    const [x, y] = toScreen(n.at, c);
    const half = n.r * c.s;
    const right = x + half;
    const bottom = y + (n.r + 14 + 48) * c.s; // disc and the label below it
    if (right > 1335 && bottom > 960 && x - half < 1920 && y - half < 1080)
      assert.fail(`${n.id} enters the tag corner at ${r2(t)} s`);
    if (f > 0 && x > 0 && x < 1920 && y > 0 && y < 1080) {
      const [px, py] = toScreen(n.at, camAt((f - 1) / FPS));
      const v = Math.hypot(x - px, y - py);
      if (v > maxTravel) {
        maxTravel = v;
        maxTravelAt = t;
      }
    }
  }
}
assert(
  maxTravel <= 36,
  `A node travels ${r2(maxTravel)} px in one frame at ${r2(maxTravelAt)} s (STYLE §5: 36)`,
);
assert(T.simTag <= node("paypal").land, "The sandbox tag must start with the PayPal node");
for (const text of beat.show)
  assert(html.includes(esc(text)), `Missing the script's on-screen line: ${text}`);
assert(html.includes("Simulated PayPal sandbox</div>"), "The frame must carry the visible sandbox tag");
const svgIds = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => `#${m[1]}`);
for (const selector of animated)
  assert(
    !svgIds.includes(selector) && !selector.includes(".ln"),
    `${selector} is an SVG element: drive it through a custom property on an HTML wrapper`,
  );

mkdirSync(new URL("assets/fonts/", here), { recursive: true });
mkdirSync(new URL("out/", here), { recursive: true });
copyFileSync(
  new URL("../../assets/fonts/FSSans-VF.woff2", here),
  new URL("assets/fonts/FSSans-VF.woff2", here),
);
copyFileSync(new URL("../../proto/assets/dapple.png", here), new URL("assets/dapple.png", here));
writeFileSync(new URL("assets/grain.png", here), grainPng());
mkdirSync(new URL("compositions/", here), { recursive: true });
writeFileSync(new URL("compositions/architecture.html", here), html);
writeFileSync(new URL("index.html", here), index);

// The per-second outline, for the README and the hand-off.
const outline = [
  [0, "Daylight field. The Slips disc, drawn under the veil, sharpens as it lifts (1.9x): 'Slips'."],
  [T.wave[0], "The handwriting runs from the slip to Claude as an ink wave that calms as it arrives."],
  [T.claude, "'Claude' lands (scan icon); the tag 'Seed stand-in reading' while Claude is the subject."],
  [T.ce[0], "The indigo trace leaves Claude, its light at the head; the camera pushes to the engine."],
  [T.engine, "'Engine' lands (sum icon)."],
  [T.fan0, "64 thin ink member lines fan out of the engine and converge on one ring."],
  [T.treasurer, "The camera pushes to the ring; two keys land above it."],
  [T.signT[0], "Each key signs with an indigo thread; two indigo pulses on the ring: 'Signed'."],
  [T.glyph[0], "A # draws inside the ring: one batch hash."],
  [T.ho[0], "The trace leaves the hash; the camera pushes on: 'Outbox' lands (tray icon)."],
  [T.conn[0], "An ink line draws out to PayPal."],
  [T.paypal, "'PayPal' lands on a dashed (simulated) node; the 'Simulated PayPal sandbox' tag turns on."],
  [T.call1[0], "The call leaves the outbox and is lost halfway: the light goes out, the trace fades."],
  [T.retry[0], "A retry loop draws over the outbox: 'Safe to retry'."],
  [T.call2[0], "The same call goes again and lands once: one jade pulse on the PayPal node."],
  [CAM.at(-3).t, "The camera pulls back to the whole line; 'Claude', 'Engine', 'Signed', 'PayPal' return."],
  [settled.t, "The overview holds with a 1.2% push to the cut."],
];
writeFileSync(
  new URL("out/outline.json", here),
  JSON.stringify(
    {
      words: W,
      schedule: T,
      labels: LABELS.map(({ id, windows }) => ({ id, windows })),
      camera: CAM.map(({ e, ...c }) => c),
      holdFrom: HOLD_FROM,
      outline,
    },
    null,
    2,
  ),
);
console.log(
  `architecture.html: ${kf.length} keyframe rules, ${Math.round(html.length / 1024)} KB; hold ${r2(DUR - HOLD_FROM)} s from ${r2(HOLD_FROM)} s; peak node travel ${r2(maxTravel)} px/frame at ${r2(maxTravelAt)} s; ${blurKeys.size} motion-blur filters`,
);
for (const [t, s] of outline) console.log(`${r2(t).toFixed(2).padStart(5)}  ${s}`);
