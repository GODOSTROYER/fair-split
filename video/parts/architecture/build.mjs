// Fair Split film, script v4: the ARCHITECTURE beat (film 30-44 s) as a standalone HyperFrames part.
// An original line-and-node diagram in the reference reel's language: one glowing node, thin threads, nodes that land
// with a small line icon and a 1-3 word label. Every step lands on the narration word that names it, at the same
// word-proportional time the provisional captions use (script.ts `timeOf`), so the build moves with F4's alignment.
// No GSAP and no third-party code or artwork: every tween is compiled here into CSS keyframes sampled once per frame,
// which HyperFrames' CSS adapter seeks deterministically. Run: node video/parts/architecture/build.mjs
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { beats } from "../../script.ts";

const here = new URL("./", import.meta.url);
const beat = beats.find((b) => b.id === "architecture");
if (!beat) throw new Error("script.ts has no architecture beat");

// ---------- time ----------
const FPS = 30;
const DUR = beat.end - beat.start;
const N = Math.round(DUR * FPS);
const [say0, say1] = (beat.speech ?? [beat.start, beat.end]).map((s) => s - beat.start);
const spoken = beat.say.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
const bare = (w) => w.toLowerCase().replace(/^\W+/, "");
/** Local second at which `phrase` is said (word-proportional across the speech window, unrounded). */
function said(phrase) {
  const want = phrase.toLowerCase().split(/\s+/);
  const i = spoken.findIndex((_, k) => want.every((w, j) => bare(spoken[k + j] ?? "").startsWith(w)));
  if (i < 0) throw new Error(`architecture: "${phrase}" is not spoken`);
  return say0 + ((say1 - say0) * i) / spoken.length;
}
const W = {
  slips: said("slips"),
  claude: said("claude"),
  deterministic: said("deterministic"),
  engine: said("engine"),
  two: said("two keys"),
  keys: said("keys"),
  sign: said("sign"),
  one: said("one batch"),
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
  inOutCubic: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  outBack: (x) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2,
  inQuad: (x) => x * x,
};
const prog = (t, t0, t1, ease = E.outCubic) => ease(clamp01((t - t0) / (t1 - t0)));
const lerp = (a, b, p) => a + (b - a) * p;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

// ---------- palette: Gabii night film card (theme-1104 decision, tokens.json `tablea`) ----------
const C = {
  ground: "#090D18",
  ink: "#F4F6FA",
  ink2: "#C3C9D6",
  ink3: "#8E98AE",
  steel: "#8996B4",
  pod: "#9C8CFF", // the one accent: ballpoint indigo, night value
  podDeep: "#5B43EA",
};

// ---------- layout (world px; the camera ends on the identity frame) ----------
const DX = -10;
const DY = 0;
const pt = (x, y) => [x + DX, y + DY];
const S = pt(206, 590); // slips
const Cn = pt(512, 520); // Claude
const En = pt(808, 640); // deterministic engine
const H = pt(1118, 612); // one batch hash (ring centre)
const HR = 32;
const KT = pt(1046, 392); // Treasurer key (icon centre)
const KC = pt(1190, 392); // Chair key
const O = pt(1420, 522); // outbox
const P = pt(1694, 616); // PayPal (simulated)

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
const ease3 = (a, d, k = 0.42) => [
  [a[0] + (d[0] - a[0]) * k, a[1]],
  [d[0] - (d[0] - a[0]) * k, d[1]],
];

// 1. Slips -> Claude: a handwriting wave (the oscillating line of the reference) that Claude straightens.
const waveBase = poly(cubicPts(S, ...ease3(S, Cn, 0.5), Cn));
const wavePts = Array.from({ length: 241 }, (_, i) => {
  const u = i / 240;
  const base = along(waveBase, u);
  // loud near the paper, calming as Claude reads it, flat for the last fifth so it lands clean
  const w = clamp01(u / 0.78);
  const env = Math.sin(Math.PI * w) ** 0.8 * (1 - 0.45 * w);
  return [base[0], base[1] + 34 * env * Math.sin(2 * Math.PI * 4 * w)];
});
const wave = poly(wavePts);
// 2. Claude -> engine: clean.
const ceCtl = ease3(Cn, En);
const ce = poly(cubicPts(Cn, ...ceCtl, En));
// 3. Engine -> hash: 64 member lines fan out and converge on the ring (the batch hash covers every line).
const FAN = 64;
const fan = Array.from({ length: FAN }, (_, i) => {
  const o = (i / (FAN - 1) - 0.5) * 2;
  const phi = Math.PI - o * 0.95; // entry angle on the ring's left half
  const end = [H[0] + HR * Math.cos(phi), H[1] + HR * Math.sin(phi)];
  const c1 = [En[0] + 130, En[1] + o * 165];
  const c2 = [end[0] + 95 * Math.cos(phi), end[1] + 95 * Math.sin(phi)]; // enter the ring along its radius
  return { o, d: dCubic(En, c1, c2, end), path: poly(cubicPts(En, c1, c2, end, 60)) };
});
const fanTop = Math.min(...fan.flatMap((f) => f.path.pts.map((p) => p[1])));
const ehHead = poly(cubicPts(En, [En[0] + 120, En[1]], [H[0] - 150, H[1]], H));
// 4. Keys -> hash: two signatures enter the ring from above.
const keyThread = (k, ang) => {
  const a = [k[0], k[1] + 34];
  const end = [H[0] + HR * Math.cos(ang), H[1] + HR * Math.sin(ang)];
  const c1 = [a[0], a[1] + 90];
  const c2 = [end[0] + Math.cos(ang) * 70, end[1] + Math.sin(ang) * 70];
  return { d: dCubic(a, c1, c2, end), path: poly(cubicPts(a, c1, c2, end, 80)) };
};
const ktT = keyThread(KT, (-118 * Math.PI) / 180);
const ktC = keyThread(KC, (-62 * Math.PI) / 180);
// 5. Hash -> outbox.
const hoStart = [H[0] + HR, H[1]];
const hoCtl = ease3(hoStart, O);
const ho = poly(cubicPts(hoStart, ...hoCtl, O));
const hoHead = poly([H, ...ho.pts]);
// 6. Outbox -> PayPal (simulated).
const opCtl = ease3(O, P);
const op = poly(cubicPts(O, ...opCtl, P));
const DROP = 0.56; // where the first call is lost
const dropPt = along(op, DROP);

// ---------- schedule (local seconds, all derived from the words) ----------
const T = {
  bloom: [0.04, 0.5],
  slips: W.slips + 0.12,
  wave: [W.slips + 0.5, W.claude - 0.04],
  claude: W.claude - 0.1,
  claudeTag: W.claude + 0.42,
  ce: [W.claude + 0.5, W.deterministic - 0.05],
  engine: W.deterministic - 0.1,
  fan0: W.engine - 0.12,
  eh: [W.engine - 0.05, W.two + 0.02],
  members: W.engine + 0.12,
  ring: [W.two - 0.18, W.two + 0.28],
  treasurer: W.two - 0.04,
  chair: W.keys - 0.22,
  signT: [W.sign - 0.22, W.sign + 0.28],
  signC: [W.sign - 0.04, W.sign + 0.46],
  glyph: [W.one - 0.08, W.one + 0.42],
  hashLabel: W.one - 0.02,
  ho: [W.an - 0.16, W.outbox - 0.1],
  outbox: W.outbox - 0.14,
  op: [W.makes + 0.02, W.simulated - 0.06],
  paypal: W.simulated - 0.06,
  paypalTag: W.paypal - 0.08,
  call1: [W.call - 0.26, W.call + 0.3],
  callFade: [W.call + 0.16, W.call + 0.32],
  retryRing: [W.safe - 0.12, W.safe + 0.5],
  retryLabel: W.safe + 0.02,
  call2In: [W.to - 0.18, W.to - 0.04],
  call2: [W.to - 0.06, W.retry],
  landed: W.retry,
};
const HOLD_FROM = T.landed + 0.05; // every element has landed; the finished diagram holds from here

// ---------- keyframe compiler ----------
const kf = [];
const rules = [];
let kid = 0;
const pct = (f) => `${r3((f / N) * 100)}%`;
/** Compile per-frame values of each CSS property into one keyframes rule; holds collapse to their end stops. */
const animated = [];
function animate(selector, props, extra = "") {
  animated.push(selector);
  const list = [];
  for (const [prop, fn] of Object.entries(props)) {
    const vals = Array.from({ length: N + 1 }, (_, f) => fn(f / FPS));
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
// HyperFrames' CSS adapter seeks only HTML elements (offset by their clip's start); an SVG element's own CSS
// animation would be seeked on film time instead and jump to its end once this part sits at 30 s. So every SVG
// property is driven by a registered custom property animated on an HTML wrapper, which the SVG reads via var().
const svgVars = {};
const atProps = ['@property --icd{syntax:"<number>";inherits:true;initial-value:1.002}'];
function svgVar(name, fn, initial, ...uses) {
  svgVars[`--${name}`] = fn;
  atProps.push(`@property --${name}{syntax:"<number>";inherits:true;initial-value:${initial}}`);
  for (const [selector, declaration] of uses) rules.push(`${selector}{${declaration}}`);
}
const drawVar = (name, selector, fn) =>
  svgVar(name, (t) => draw(fn(t)), 1.002, [selector, `stroke-dashoffset:var(--${name})`]);

// ---------- motion helpers ----------
/** A node lands: the dot pops, the icon draws itself in, the label sharpens out of a blur. */
function land(id, t0, { icon = true, label = true, tag = null } = {}) {
  svgVar(`d-${id}`, (t) => `${r3(prog(t, t0, t0 + 0.42, E.outBack))}`, 0, [
    `#arch-d-${id}`,
    `transform:scale(var(--d-${id}))`,
  ]);
  if (icon)
    animate(`#arch-n-${id} .ic`, {
      opacity: (t) => opacity(prog(t, t0, t0 + 0.3)),
      transform: (t) => `translateY(${r2(10 * (1 - prog(t, t0, t0 + 0.55)))}px)`,
      "--icd": (t) => draw(prog(t, t0 + 0.04, t0 + 0.7)),
    });
  if (label) soften(`#arch-n-${id} .lb`, t0 + 0.12);
  if (tag !== null) soften(`#arch-n-${id} .tw`, tag);
}
function soften(selector, t0, dur = 0.5, rise = 12) {
  animate(selector, {
    opacity: (t) => opacity(prog(t, t0, t0 + dur * 0.8)),
    transform: (t) => `translateY(${r2(rise * (1 - prog(t, t0, t0 + dur)))}px)`,
    filter: (t) => `blur(${r2(7 * (1 - prog(t, t0, t0 + dur, E.outQuart)))}px)`,
  });
}

// The glowing head: one indigo node that carries the batch through the system.
const moves = [
  { at: T.wave, path: wave, ease: E.inOutCubic },
  { at: T.ce, path: ce, ease: E.inOutCubic },
  { at: T.eh, path: ehHead, ease: E.inOutCubic },
  { at: T.ho, path: hoHead, ease: E.inOutCubic },
  { at: T.call1, path: op, ease: E.inQuad, to: DROP },
  { at: [T.call2In[0], T.call2In[0] + 1e-4], path: op, from: 0, to: 0 },
  { at: T.call2, path: op, ease: E.inOutCubic },
];
function headAt(t) {
  let pos = S;
  for (const m of moves) {
    if (t < m.at[0]) break;
    const from = m.from ?? 0;
    const to = m.to ?? 1;
    pos = along(m.path, lerp(from, to, prog(t, m.at[0], m.at[1], m.ease)));
  }
  return pos;
}
const moveP = (m, t) => lerp(m.from ?? 0, m.to ?? 1, prog(t, m.at[0], m.at[1], m.ease));

// ---------- camera: Catmull-Rom through waypoints (continuous velocity), log-scale ----------
const cam = [
  { t: 0, x: S[0] + 170, y: S[1] - 15, s: 2 },
  { t: W.claude + 0.15, x: Cn[0] + 60, y: (S[1] + Cn[1]) / 2, s: 1.66 },
  { t: W.deterministic + 0.3, x: En[0] - 20, y: (Cn[1] + En[1]) / 2 + 15, s: 1.38 },
  { t: W.two + 0.45, x: 935, y: 545, s: 1.13 },
  { t: W.hash, x: 950, y: 542, s: 1.08 },
  { t: W.outbox + 0.3, x: 962, y: 540, s: 1.04 },
  { t: W.paypal, x: 960, y: 540, s: 1.01 },
  { t: W.retry - 0.3, x: 960, y: 540, s: 1 },
  { t: DUR, x: 960, y: 540, s: 1 },
];
function camAt(t) {
  const k = Math.max(
    0,
    cam.findLastIndex((c) => c.t <= t),
  );
  if (k >= cam.length - 1) return cam.at(-1);
  const a = cam[k];
  const b = cam[k + 1];
  const pa = cam[k - 1] ?? a;
  const pb = cam[k + 2] ?? b;
  const h = b.t - a.t;
  const u = (t - a.t) / h;
  const hermite = (key, f = (v) => v) => {
    const p0 = f(a[key]);
    const p1 = f(b[key]);
    const m0 = k === 0 ? 0 : (f(b[key]) - f(pa[key])) / (b.t - pa.t);
    const m1 = k + 1 >= cam.length - 1 ? 0 : (f(pb[key]) - f(a[key])) / (pb.t - a.t);
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * h * m1
    );
  };
  return { x: hermite("x"), y: hermite("y"), s: Math.exp(hermite("s", Math.log)) };
}
const drift = (t) => 1 + 0.012 * prog(t, HOLD_FROM - 0.4, DUR, E.inOutSine);

// ---------- icons (48 px, 1.8 px line) ----------
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
  key: ["M4 24 a8.5 8.5 0 1 0 17 0 a8.5 8.5 0 1 0 -17 0", "M21 24 H45", "M37 24 V31.5", "M43 24 V30"],
  outbox: ["M8 29 H16.5 L19.5 33.5 H28.5 L31.5 29 H40 V40 H8 Z", "M24 25 V8", "M17.5 14.5 L24 8 L30.5 14.5"],
  paypal: ["M7 14 H41 V35 H7 Z", "M19 24.5 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0", "M12 19 V30", "M36 19 V30"],
};
const iconSvg = (name) =>
  `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">${ICON[name].map((d) => `<path class="ln" pathLength="1" d="${d}"/>`).join("")}</svg>`;

// ---------- nodes (HTML labels over the SVG threads, same world coordinates) ----------
const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const NODES = [
  { id: "slips", at: S, icon: "slips", label: "Slips", count: "48" },
  { id: "claude", at: Cn, icon: "claude", label: "Claude reads", tag: "Demo: labelled stand-in" },
  { id: "engine", at: En, icon: "engine", label: "Deterministic engine", align: "end", below: 20 },
  { id: "hash", at: H, icon: null, label: "One batch hash", align: "start", below: HR + 14 },
  { id: "treasurer", at: KT, icon: "key", label: "Treasurer", above: true },
  { id: "chair", at: KC, icon: "key", label: "Chair", above: true },
  { id: "outbox", at: O, icon: "outbox", label: "Outbox", sub: "Safe to retry", below: 34 },
  { id: "paypal", at: P, icon: "paypal", label: "PayPal", tag: "Simulated PayPal sandbox", below: 22 },
];
function nodeHtml(n) {
  const [x, y] = n.at;
  const isKey = n.icon === "key";
  const ic = n.icon
    ? `<div class="ic" style="left:-24px;top:${isKey ? -24 : -82}px">${iconSvg(n.icon)}</div>`
    : "";
  const count = n.count ? ` <span class="ct">${esc(n.count)}</span>` : "";
  const labelTop = n.above ? -76 : (n.below ?? 22);
  // centred under the node, or set beside it (end: the text ends at the node; start: it starts there)
  const place =
    n.align === "end"
      ? "left:-616px;text-align:right;"
      : n.align === "start"
        ? "left:-24px;text-align:left;"
        : "";
  const lb = `<div class="lb${n.above ? " lb-s" : ""}" style="${place}top:${labelTop}px">${esc(n.label)}${count}</div>`;
  const tw = n.tag
    ? `<div class="tw" style="top:${labelTop + 46}px"><span class="tag">${esc(n.tag)}</span></div>`
    : "";
  const sub = n.sub ? `<div class="tw sub" style="top:${labelTop + 40}px">${esc(n.sub)}</div>` : "";
  return `<div class="node" id="arch-n-${n.id}" style="left:${r2(x)}px;top:${r2(y)}px">${ic}${lb}${tw}${sub}</div>`;
}

// ---------- the SVG ----------
const ringD = `M${r2(H[0] - HR)} ${r2(H[1])} a${HR} ${HR} 0 1 1 ${2 * HR} 0 a${HR} ${HR} 0 1 1 ${-2 * HR} 0`;
const retryR = 23;
const retryD = (() => {
  // three-quarter loop around the outbox dot, ending in an arrowhead (drawn as one path)
  const a0 = (-200 * Math.PI) / 180;
  const a1 = (70 * Math.PI) / 180;
  const p = (a) => [O[0] + retryR * Math.cos(a), O[1] + retryR * Math.sin(a)];
  const [sx, sy] = p(a0);
  const [ex, ey] = p(a1);
  return `M${r2(sx)} ${r2(sy)} A${retryR} ${retryR} 0 1 1 ${r2(ex)} ${r2(ey)}`;
})();
const retryHead = (() => {
  const a1 = (70 * Math.PI) / 180;
  const [ex, ey] = [O[0] + retryR * Math.cos(a1), O[1] + retryR * Math.sin(a1)];
  // tangent direction at a1 for a clockwise (sweep=1) arc is (-sin, cos)
  const tx = -Math.sin(a1);
  const ty = Math.cos(a1);
  const nx = -ty;
  const ny = tx;
  const L = 7;
  const b1 = [ex - tx * L + nx * L * 0.7, ey - ty * L + ny * L * 0.7];
  const b2 = [ex - tx * L - nx * L * 0.7, ey - ty * L - ny * L * 0.7];
  return `M${r2(b1[0])} ${r2(b1[1])} L${r2(ex)} ${r2(ey)} L${r2(b2[0])} ${r2(b2[1])}`;
})();
const hashGlyph = [
  [-4, -10, -7, 10],
  [6, -10, 3, 10],
  [-10.5, -3.5, 10.5, -3.5],
  [-11.5, 3.5, 9.5, 3.5],
]
  .map(([a, b, c, d]) => `M${r2(H[0] + a)} ${r2(H[1] + b)} L${r2(H[0] + c)} ${r2(H[1] + d)}`)
  .join(" ");

const svg = `<svg id="arch-svg" viewBox="0 0 1920 1080" width="1920" height="1080" role="img" aria-label="Fair Split architecture: handwritten slips go to Claude (the demo replays a labelled stand-in), then a deterministic engine computes 64 member lines; the Treasurer and the Chair sign one batch hash; an outbox makes each call to the PayPal simulator safe to retry. Simulated PayPal sandbox.">
<defs><filter id="arch-glow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<g id="arch-fan" class="fan">${fan.map((f, i) => `<path id="arch-f${i}" class="th" pathLength="1" d="${f.d}"/>`).join("")}</g>
<g class="threads" filter="url(#arch-glow)">
<path id="arch-t-wave" class="th main" pathLength="1" d="${dPoly(wavePts)}"/>
<path id="arch-t-ce" class="th main" pathLength="1" d="${dCubic(Cn, ...ceCtl, En)}"/>
<path id="arch-t-kt" class="th key" pathLength="1" d="${ktT.d}"/>
<path id="arch-t-kc" class="th key" pathLength="1" d="${ktC.d}"/>
<path id="arch-t-ho" class="th main" pathLength="1" d="${dCubic(hoStart, ...hoCtl, O)}"/>
<path id="arch-t-op" class="th main" pathLength="1" d="${dCubic(O, ...opCtl, P)}"/>
<path id="arch-ring" class="th ring" pathLength="1" d="${ringD}"/>
<path id="arch-glyph" class="th glyph" pathLength="1" d="${hashGlyph}"/>
<path id="arch-retry" class="th retry" pathLength="1" d="${retryD}"/>
<path id="arch-retry-head" class="th retry" pathLength="1" d="${retryHead}"/>
</g>
<circle id="arch-gap" cx="${r2(dropPt[0])}" cy="${r2(dropPt[1])}" r="8.5" fill="${C.ground}"/>
<circle id="arch-pulse-1" class="pulse" cx="${r2(H[0])}" cy="${r2(H[1])}" r="${HR}"/>
<circle id="arch-pulse-2" class="pulse" cx="${r2(H[0])}" cy="${r2(H[1])}" r="${HR}"/>
<circle id="arch-pulse-3" class="pulse" cx="${r2(P[0])}" cy="${r2(P[1])}" r="13"/>
${["slips", "claude", "engine", "outbox"]
  .map((id) => {
    const n = NODES.find((m) => m.id === id);
    return `<circle id="arch-d-${id}" class="dot" cx="${r2(n.at[0])}" cy="${r2(n.at[1])}" r="6"/>`;
  })
  .join("")}
<circle id="arch-d-paypal" class="dot sim" cx="${r2(P[0])}" cy="${r2(P[1])}" r="13"/>
<circle id="arch-d-treasurer" class="dot" cx="${r2(KT[0])}" cy="${r2(KT[1] + 34)}" r="4"/>
<circle id="arch-d-chair" class="dot" cx="${r2(KC[0])}" cy="${r2(KC[1] + 34)}" r="4"/>
</svg>`;

// Faint fragments of the real code drift at depth (names from packages/*; decoration, blurred and small).
const FRAGS = [
  { text: "@fairsplit/ai · ClaudeGateway", x: 250, y: 352, dx: 18 },
  { text: "requiresChair(input, cosign)", x: 700, y: 268, dx: 14 },
  { text: "Ed25519 · batchSha256", x: 1300, y: 300, dx: -14 },
  { text: "FOR UPDATE SKIP LOCKED", x: 1560, y: 412, dx: 12 },
  { text: "@fairsplit/domain", x: 520, y: 806, dx: -16 },
  { text: "linesDigest(lines)", x: 980, y: 826, dx: 16 },
  { text: "enqueue(tx, name, args, dedupeKey)", x: 1330, y: 800, dx: -18 },
];
const fragsHtml = FRAGS.map(
  (f, i) =>
    `<div class="frag" id="arch-frag-${i}" style="left:${f.x + DX}px;top:${f.y + DY}px">${esc(f.text)}</div>`,
).join("");

// ---------- timeline ----------
// camera and the parallax layer
animate("#arch-world", {
  transform: (t) => {
    const c = camAt(t);
    const s = c.s * drift(t);
    return `matrix(${r3(s)},0,0,${r3(s)},${r2(960 - s * c.x)},${r2(540 - s * c.y)})`;
  },
});
animate("#arch-bg", {
  transform: (t) => {
    const c = camAt(t);
    const s = 1 + (c.s * drift(t) - 1) * 0.45;
    const fx = 960 + (c.x - 960) * 0.55;
    const fy = 540 + (c.y - 540) * 0.55;
    return `matrix(${r3(s)},0,0,${r3(s)},${r2(960 - s * fx)},${r2(540 - s * fy)})`;
  },
});
for (const [i, f] of FRAGS.entries())
  animate(`#arch-frag-${i}`, {
    transform: (t) => `translateX(${r2((f.dx * t) / DUR)}px)`,
    opacity: (t) => opacity(0.15 * prog(t, 0.3 + i * 0.35, 1.6 + i * 0.35, E.inOutSine)),
  });

// head
animate("#arch-head", {
  transform: (t) => {
    const [x, y] = headAt(t);
    return `translate(${r2(x)}px,${r2(y)}px)`;
  },
  opacity: (t) =>
    opacity(
      prog(t, T.bloom[0], T.bloom[1]) * (1 - prog(t, T.callFade[0], T.callFade[1], E.linear)) +
        (t >= T.call2In[0] ? prog(t, T.call2In[0], T.call2In[1] + 0.12, E.linear) : 0),
    ),
});
animate("#arch-head .glow", {
  transform: (t) => {
    const bloom = 0.25 + 0.75 * prog(t, T.bloom[0], T.bloom[1] + 0.2, E.outBack);
    const settle = t >= HOLD_FROM ? 1 + 0.05 * Math.sin(((t - HOLD_FROM) / (DUR - HOLD_FROM)) * Math.PI) : 1;
    return `scale(${r3(bloom * settle)})`;
  },
});

// threads drawn behind the head
const mWave = moves[0];
const mCe = moves[1];
const mHo = moves[3];
drawVar("t-wave", "#arch-t-wave", (t) => moveP(mWave, t));
drawVar("t-ce", "#arch-t-ce", (t) => moveP(mCe, t));
const hoLead = HR / hoHead.len;
drawVar("t-ho", "#arch-t-ho", (t) => (moveP(mHo, t) - hoLead) / (1 - hoLead));
drawVar("t-op", "#arch-t-op", (t) => prog(t, T.op[0], T.op[1], E.inOutCubic));
fan.forEach((f, i) => {
  const t0 = T.fan0 + Math.abs(f.o) * 0.26 + (i % 2) * 0.02;
  drawVar(`f${i}`, `#arch-f${i}`, (t) => prog(t, t0, t0 + 0.5, E.inOutCubic));
});
// a white spark rides the tip of the outbox -> PayPal thread as it draws out
animate("#arch-spark", {
  transform: (t) => {
    const [x, y] = along(op, prog(t, T.op[0], T.op[1], E.inOutCubic));
    return `translate(${r2(x)}px,${r2(y)}px)`;
  },
  opacity: (t) =>
    opacity(prog(t, T.op[0], T.op[0] + 0.12, E.linear) * (1 - prog(t, T.op[1], T.op[1] + 0.25, E.linear))),
});

// nodes
land("slips", T.slips);
land("claude", T.claude, { tag: T.claudeTag });
land("engine", T.engine);
soften("#arch-n-members", T.members, 0.5, 8);
drawVar("ring", "#arch-ring", (t) => prog(t, T.ring[0], T.ring[1], E.inOutCubic));
land("treasurer", T.treasurer);
land("chair", T.chair);
drawVar("t-kt", "#arch-t-kt", (t) => prog(t, T.signT[0], T.signT[1], E.inOutCubic));
drawVar("t-kc", "#arch-t-kc", (t) => prog(t, T.signC[0], T.signC[1], E.inOutCubic));
const pulse = (n, t0, grow) => {
  svgVar(`p${n}s`, (t) => `${r3(1 + grow * prog(t, t0, t0 + 0.7, E.outCubic))}`, 1, [
    `#arch-pulse-${n}`,
    `transform:scale(var(--p${n}s));opacity:var(--p${n}o)`,
  ]);
  svgVar(`p${n}o`, (t) => opacity(t < t0 ? 0 : 0.95 * (1 - prog(t, t0, t0 + 0.7, E.outQuart))), 0);
};
pulse(1, T.signT[1], 1.1);
pulse(2, T.signC[1], 1.1);
pulse(3, T.landed, 1.5);
drawVar("glyph", "#arch-glyph", (t) => prog(t, T.glyph[0], T.glyph[1], E.outCubic));
soften("#arch-n-hash .lb", T.hashLabel);
land("outbox", T.outbox);
land("paypal", T.paypal, { tag: T.paypalTag });
// the first call is lost mid-thread; the outbox retries the same call and it lands once
// the gap stays open until the retried call crosses it, which closes it
let healAt = T.call2[1];
for (let f = Math.ceil(T.call2[0] * FPS); f <= N; f++)
  if (moveP(moves.at(-1), f / FPS) >= DROP) {
    healAt = f / FPS;
    break;
  }
svgVar(
  "gap",
  (t) =>
    opacity(
      prog(t, T.callFade[1] - 0.06, T.callFade[1] + 0.04, E.linear) *
        (1 - prog(t, healAt - 0.04, healAt, E.linear)),
    ),
  0,
  ["#arch-gap", "opacity:var(--gap)"],
);
drawVar("retry", "#arch-retry", (t) => prog(t, T.retryRing[0], T.retryRing[1], E.inOutCubic));
drawVar("retry-head", "#arch-retry-head", (t) =>
  prog(t, T.retryRing[1] - 0.06, T.retryRing[1] + 0.14, E.outCubic),
);
soften("#arch-n-outbox .sub", T.retryLabel);
animate("#arch-svgwrap", svgVars);

// ---------- styles ----------
const css = `
@font-face{font-family:"FS Sans";src:url("../assets/fonts/FSSans-VF.woff2") format("woff2");font-weight:200 900;font-stretch:75% 125%}
#root{position:absolute;inset:0;width:100%;height:100%;overflow:hidden;background:${C.ground}}
#arch-stage{position:absolute;inset:0;overflow:hidden;background:radial-gradient(34% 140% at 52% 0%,rgb(91 67 234/.16),transparent 72%),radial-gradient(36% 150% at 0% 100%,rgb(61 230 174/.07),transparent 70%),${C.ground};font-family:"FS Sans",sans-serif;font-variant-numeric:lining-nums proportional-nums;color:${C.ink}}
#arch-bg,#arch-world{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0}
#arch-svgwrap{position:absolute;left:0;top:0;width:1920px;height:1080px}
#arch-svg{position:absolute;left:0;top:0;overflow:visible}
.frag{position:absolute;white-space:nowrap;font-size:19px;font-stretch:87.5%;font-weight:520;letter-spacing:.01em;color:${C.ink3};filter:blur(1.7px);opacity:0}
.th{fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1 2;stroke-dashoffset:1.002}
.main{stroke:${C.ink};stroke-opacity:.82;stroke-width:2}
.fan .th{stroke:${C.ink};stroke-opacity:.26;stroke-width:1}
.key{stroke:${C.ink};stroke-opacity:.7;stroke-width:1.6}
.ring{stroke:${C.ink};stroke-opacity:.9;stroke-width:2}
.glyph{stroke:${C.ink};stroke-width:2.2}
.retry{stroke:${C.ink2};stroke-width:1.8}
.pulse{fill:none;stroke:${C.pod};stroke-width:2;opacity:0;transform-box:fill-box;transform-origin:center}
.dot{fill:${C.ink};transform-box:fill-box;transform-origin:center;transform:scale(0)}
.dot.sim{fill:${C.ground};stroke:${C.steel};stroke-width:1.8;stroke-dasharray:4.2 3.6}
.node{position:absolute;width:0;height:0}
.ic{position:absolute;width:48px;height:48px;opacity:0}
.ic svg{display:block;overflow:visible}
.ic .ln{fill:none;stroke:${C.ink};stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1 2;stroke-dashoffset:var(--icd)}
.lb,.tw{position:absolute;left:-320px;width:640px;text-align:center;white-space:nowrap;opacity:0}
.lb{font-size:29px;line-height:34px;font-stretch:112.5%;font-weight:640;letter-spacing:-.012em;color:${C.ink}}
.lb-s{font-size:24px;line-height:28px;font-weight:600;color:${C.ink2}}
.ct{font-size:21px;font-stretch:100%;font-weight:520;color:${C.ink3};margin-left:6px}
.tag{display:inline-block;font-size:18px;line-height:22px;font-stretch:100%;font-weight:560;color:${C.ink2};padding:5px 14px 6px;border:1.5px dashed ${C.steel};border-radius:999px}
.sub{font-size:21px;line-height:26px;font-stretch:100%;font-weight:540;color:${C.ink2}}
#arch-n-members{font-size:21px;line-height:26px;font-stretch:100%;font-weight:520;color:${C.ink3}}
#arch-head,#arch-spark{position:absolute;left:0;top:0;width:0;height:0;opacity:0}
#arch-head .glow{position:absolute;left:-110px;top:-110px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgb(156 140 255/.95) 0,rgb(120 100 245/.55) 9%,rgb(91 67 234/.22) 26%,rgb(91 67 234/0) 62%)}
#arch-head .core{position:absolute;left:-8px;top:-8px;width:16px;height:16px;border-radius:50%;background:#EDEAFF;box-shadow:0 0 10px 3px rgb(156 140 255/.9),0 0 34px 10px rgb(91 67 234/.55)}
#arch-spark i{position:absolute;left:-5px;top:-5px;width:10px;height:10px;border-radius:50%;background:${C.ink};box-shadow:0 0 12px 4px rgb(244 246 250/.45)}
#arch-vignette{position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 95% at 50% 50%,transparent 58%,rgb(4 6 12/.55) 100%)}
`;
const membersHtml = `<div class="node" style="left:${r2((En[0] + H[0]) / 2)}px;top:${r2(fanTop - 46)}px"><div class="lb" id="arch-n-members">64 members</div></div>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><title>Fair Split film · Architecture</title></head><body><template>
<style>${atProps.join("\n")}
${css}
${rules.join("\n")}
${kf.join("\n")}
</style>
<div id="root" data-no-timeline data-composition-id="architecture" data-width="1920" data-height="1080" data-duration="${DUR}">
<div id="arch-stage" class="clip" data-start="0" data-duration="${DUR}" data-track-index="0">
<div id="arch-bg" data-layout-allow-overflow>${fragsHtml}</div>
<div id="arch-world" data-layout-allow-overflow>
<div id="arch-svgwrap">${svg}</div>
<div id="arch-spark"><i></i></div>
<div id="arch-head"><div class="glow"></div><div class="core"></div></div>
${NODES.map(nodeHtml).join("\n")}
${membersHtml}
</div>
<div id="arch-vignette"></div>
</div>
</div>
</template></body></html>
`;

const index = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080"><title>Fair Split film · Architecture beat</title>
<style>html,body{margin:0;background:${C.ground}}#root{position:relative;width:100%;height:100%;overflow:hidden}</style></head>
<body><div id="root" data-no-timeline data-composition-id="architecture-part" data-fps="${FPS}" data-width="1920" data-height="1080" data-duration="${DUR}"><div id="part-architecture" class="clip" data-no-timeline data-composition-id="architecture" data-composition-src="compositions/architecture.html" data-start="0" data-duration="${DUR}" data-track-index="0" data-width="1920" data-height="1080"></div></div></body></html>
`;

// ---------- self-checks: the build fails rather than ship a beat that drifts off its words ----------
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
near("Batch hash", T.hashLabel, W.one);
near("Outbox", T.outbox, W.outbox);
near("PayPal", T.paypal, W.simulated);
near("Sandbox tag", T.paypalTag, W.paypal);
near("Lost call", T.call1[1], W.call);
near("Safe to retry", T.retryLabel, W.safe);
near("Retried call lands", T.landed, W.retry);
assert(HOLD_FROM <= W.end + 0.1, "The build must finish with the narration");
assert(
  DUR - HOLD_FROM >= 3,
  `The finished diagram holds ${r2(DUR - HOLD_FROM)} s; it must hold at least 3 s`,
);
assert(Math.abs(camAt(HOLD_FROM).s - 1) < 1e-3, "The camera must frame the whole diagram before the hold");
for (const text of beat.show)
  assert(html.includes(esc(text)), `Missing the script's on-screen line: ${text}`);
assert(html.includes(">Simulated PayPal sandbox<"), "The PayPal node must carry the visible sandbox tag");
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
mkdirSync(new URL("compositions/", here), { recursive: true });
writeFileSync(new URL("compositions/architecture.html", here), html);
writeFileSync(new URL("index.html", here), index);

// The per-second outline, for the README and the hand-off.
const outline = [
  [0, "Navy dark. One indigo node blooms; the slip icon lands: 'Slips 48'."],
  [T.wave[0], "A handwriting wave runs from the slips to Claude, the glowing node riding its tip."],
  [T.claude, "'Claude reads' lands (scan icon); the dashed tag 'Demo: labelled stand-in' follows."],
  [T.ce[0], "A clean line now (Claude straightened the writing) runs to the engine."],
  [T.engine, "'Deterministic engine' lands (sum icon)."],
  [T.fan0, "64 thin member lines fan out of the engine and converge on one ring: '64 members'."],
  [T.treasurer, "Two keys land above the ring: 'Treasurer', 'Chair'."],
  [T.signT[0], "Each key draws a thread into the ring; two indigo pulses: two signatures."],
  [T.glyph[0], "A # draws inside the ring: 'One batch hash'."],
  [T.ho[0], "The node leaves the hash for the outbox: 'Outbox' lands (tray icon)."],
  [
    T.op[0],
    "A thread draws out to PayPal; 'PayPal' lands on a dashed (simulated) node with the dashed tag 'Simulated PayPal sandbox'.",
  ],
  [T.call1[0], "The call leaves the outbox and is lost mid-thread (the node fades, a gap opens)."],
  [T.retryRing[0], "A retry loop draws around the outbox: 'Safe to retry'."],
  [T.call2[0], "The same call goes again and lands once at PayPal (one indigo pulse)."],
  [HOLD_FROM, "Camera settles on the full diagram and holds (slow 1.2% drift) to the cut."],
];
writeFileSync(
  new URL("out/outline.json", here),
  JSON.stringify({ words: W, schedule: T, holdFrom: HOLD_FROM, outline }, null, 2),
);
console.log(
  `architecture.html: ${kf.length} keyframe rules, ${Math.round(html.length / 1024)} KB; hold ${r2(DUR - HOLD_FROM)} s from ${r2(HOLD_FROM)} s`,
);
for (const [t, s] of outline) console.log(`${r2(t).toFixed(2).padStart(5)}  ${s}`);
