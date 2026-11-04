// The film's plan in the motion language of video/proto/STYLE.md: which composition covers which beats, the seams
// between them, the one keyword and the one honesty tag per capture slot, the closed captions and the audio cue
// points. Shared by build.mjs (which writes the film) and check.mjs (which verifies what was written). Words and time
// belong to script.ts; this file only places them.
import { readFileSync } from "node:fs";
import { BUMPER_SECONDS, beats, CAPTURES, FILM, PARTS, REAL_READING_CAPTION } from "./script.ts";

export const SIM = "Simulated PayPal sandbox";
export const NAVY = "#090D18";

/**
 * Every composition on the film's track 0, in order. Parts that exist as their own HyperFrames projects are mounted
 * in place (one source, no copies); the opening is generated from the prototype; capture-slot beats are generated.
 */
export const SEGMENTS = [
  {
    id: "opening",
    beats: ["problem", "solution"],
    src: "compositions/opening.html",
    from: "proto/index.html",
    field: "night, then day",
  },
  {
    id: "architecture",
    beats: ["architecture"],
    src: "parts/architecture/compositions/architecture.html",
    field: "day",
  },
  { id: "highlights", beats: ["highlights"], src: "compositions/highlights.html", slots: true, field: "day" },
  ...[
    "paper",
    "funding",
    "reading",
    "count-once",
    "holds",
    "signing",
    "payouts",
    "proof",
    "member",
    "listening",
  ].map((id) => ({ id, beats: [id], src: `compositions/${id}.html`, slots: true, field: "day" })),
  {
    id: "close-impressive",
    beats: ["impressive"],
    src: "parts/close/compositions/impressive.html",
    field: "day",
  },
  { id: "close-limits", beats: ["limits"], src: "parts/close/compositions/limits.html", field: "day" },
  { id: "close-end", beats: ["end"], src: "parts/close/compositions/end.html", field: "day" },
].map((segment) => {
  const covered = segment.beats.map((id) => beats.find((beat) => beat.id === id));
  if (covered.some((beat) => !beat)) throw new Error(`${segment.id}: unknown beat`);
  return { ...segment, start: covered[0].start, end: covered.at(-1).end };
});

/**
 * Overlay plates at a composition cut. Rough cut v2 dipped to navy at 30, 44 and 143 (a muddy day-to-night
 * crossfade, review item 4); the film now has one dark-to-bright turn (STYLE §1), so there are none. Each joint is
 * carried by the compositions on either side instead: see JOINTS.
 */
export const SEAMS = [];
/**
 * How the film's own compositions meet the parts at each cut (STYLE §5: glides, focus pulls and the daylight veil,
 * never a dip to navy). The other side of each joint belongs to its part.
 */
export const JOINTS = [
  {
    at: 30,
    side: "out",
    how: "glide",
    span: [29, 30],
    cue: "The end line holds, then the camera glides off it in one second (29.0–30.0) onto the architecture's Slips disc, already waiting under the 92% veil; the architecture lifts the veil off it (30.0–30.7); no dip, no resolve, the bed runs on.",
  },
  {
    at: 44,
    side: "in",
    how: "focus pull",
    span: [44, 44.8],
    cue: "The architecture's diagram dissolves into the field (43.4–44.0), then the reel opens by a focus pull on its first window (44.0–44.8): a lift, not a hit.",
  },
  {
    at: 143,
    side: "out",
    how: "veil",
    span: [141.9, 143],
    cue: "Her sentence ends as the camera glides off the phone (141.9–143.0) under a daylight veil (92% by 142.85) and rests on the field at 143.0; the close lifts the veil (143.0–143.7) and the bed comes back in low.",
  },
];
/**
 * The joint at 30 s (review v3 item 3): no empty veil. The opening's last second glides off its end line onto the
 * architecture's first node, so both sides of the cut draw the Slips disc where the architecture's first camera pose
 * (x 365, y 572, 1.9×) puts its node (world 220, 600): fully built, no label yet, under the 92% veil with the world
 * blurred 18 px. The opening brings it in with the glide and fades it up under the veil (29.2–29.75); the
 * architecture shows it from its first frame (no lift-in), lifts the veil off it (30.0–30.7) and lands "Slips" as
 * before. `proto/index.html` draws it from these numbers (the build refuses a drift).
 */
export const SLIPS_UNDER_VEIL = {
  at: 30,
  centre: { x: 684.5, y: 593.2 },
  disc: 112,
  scale: 1.9,
  veil: 0.92,
  blur: 18,
  label: false,
  fadeIn: [29.2, 29.75],
};

/** One word each (STYLE §2, day keyword), said or meant by the narration over that slot. */
export const KEYWORDS = {
  "hl-matrix": "balanced.",
  "hl-ratecard": "frozen.",
  "hl-keys": "signed.",
  "hl-proof": "checked.",
  "hl-member": "heard.",
  "hl-break": "refused.",
  "paper-photos": "paper.",
  "paper-carbon": "twice.",
  "funding-console": "funded.",
  "reading-console": "read.",
  "reading-byhand": "typed.",
  "count-console": "once.",
  "holds-console": "held.",
  "rules-console": "locked.",
  "signing-console": "signed.",
  "signing-phone": "co-signed.",
  "signing-approved": "approved.",
  "payouts-console": "sent.",
  "payouts-cash": "cash.",
  "proof-browser": "re-checked.",
  "member-phone": "traced.",
  "listening-phone": "heard.",
};

/**
 * Window geometry (STYLE §4): a 16:9 console or browser crop, or a phone. `a` beside the keyword (where the camera
 * holds), `b` where a long slot's camera pushes in after the keyword. Positions are on screen, at rest.
 */
export const WINDOWS = {
  landscape: { w: 1000, h: 562.5, radius: 22, a: { x: 1130, y: 625, s: 1 }, b: { x: 960, y: 524, s: 1.16 } },
  phone: { w: 330, h: 715, radius: 48, a: { x: 1250, y: 540, s: 1 }, b: { x: 960, y: 540, s: 1.06 } },
};
export const windowKind = (slot) => (slot.source === "phone recording" ? "phone" : "landscape");
/**
 * One keyword anchor for every beat of the film (STYLE §2 "left, x 140"; §11 keeps 64 px from every edge). Set in
 * film.css (.pf-kw) and in the opening (proto #kw1-#kw3); check that they agree when either moves.
 */
export const KEYWORD_ANCHOR = { left: 140, top: 150 };

const beatOf = (slot) => beats.find((beat) => beat.id === slot.beat);
/** The deep dive's PayPal run: from the first beat that shows a PayPal value to the last (STYLE §7). */
const deep = beats.filter((beat) => beat.part === "deep-dive" && beat.show.includes(SIM));
const RUN = [Math.min(...deep.map((b) => b.start)), Math.max(...deep.map((b) => b.end))];
/**
 * The reading's two honesty labels, as tags rather than sentences (STYLE §7). The full lines (R1's caption, the
 * stand-in chip) stay legible inside the captures themselves, beside the reading they describe.
 */
export const REAL_READING_TAG = "Real Claude reading · 1 Nov 2026";
/**
 * One wording for the stand-in disclosure everywhere in the film (review v3 item 7): the run's replay (76.5–83 s),
 * the architecture's Claude node (about 32 s) and the close's "replayed." (161–164 s) all say exactly this.
 */
export const STAND_IN_TAG = "Seed stand-in reading";
/**
 * The one honesty tag (STYLE §7, review v3 item 7): 32 px words in a 64 px pill, its corner kept free of windows.
 * film.css `.pf-tag` and the prototype's `.tag` draw it; every part draws the same pill so it runs on across a cut.
 */
export const TAG = { text: 32, height: 64, right: 64, top: 960, corner: { x: 1335, y: 960 } };
/** A slot's own honesty label (the reading's two clips), which takes the tag's place while it plays. */
const honesty = (slot) =>
  slot.overlay[0] === REAL_READING_CAPTION
    ? REAL_READING_TAG
    : /stand-in/i.test(slot.overlay[0] ?? "")
      ? STAND_IN_TAG
      : null;
/**
 * The one tag over a slot: its own honesty label, else "Simulated PayPal sandbox" wherever a PayPal value can show
 * (a beat that names the sandbox, or any slot inside the deep dive's PayPal run), else none.
 */
export function slotTag(slot) {
  const own = honesty(slot);
  if (own) return { kind: "honesty", text: own };
  const end = slot.start + slot.duration;
  if (beatOf(slot).show.includes(SIM) || (slot.start >= RUN[0] && end <= RUN[1] + 1e-9))
    return { kind: "sim", text: SIM };
  return null;
}
/** Cuts where a part ends with the sandbox tag on (the architecture's PayPal node), so the next tag runs on. */
const SIM_HANDOFFS = [44];
/** The sandbox tag's span inside one composition, and whether it runs on from or into a neighbour (no re-fade). */
export function simSpan(segment) {
  const own = CAPTURES.filter((slot) => segment.beats.includes(slot.beat) && slotTag(slot)?.kind === "sim");
  if (!own.length) return null;
  const from = Math.min(...own.map((slot) => slot.start));
  const to = Math.max(...own.map((slot) => slot.start + slot.duration));
  const spans = own.reduce((sum, slot) => sum + slot.duration, 0);
  if (Math.abs(spans - (to - from)) > 1e-6) throw new Error(`${segment.id}: the sandbox tag would blink`);
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const sim = CAPTURES.filter((slot) => slotTag(slot)?.kind === "sim");
  return {
    from,
    to,
    continuesIn:
      near(from, segment.start) &&
      (SIM_HANDOFFS.some((at) => near(at, from)) ||
        sim.some((slot) => near(slot.start + slot.duration, from))),
    continuesOut: near(to, segment.end) && sim.some((slot) => near(slot.start, to)),
  };
}

// ------------------------------------------------------------------------------ the capture run (44-143 s)
// One shared daylight field and one camera from the reel's first window to the listening beat's last frame
// (STYLE §4-§5). Every window has a place in the world; the camera holds beside each one (its keyword on the left
// at KEYWORD_ANCHOR), pushes in on a long hold, and glides to the next with the mid-move zoom-out dip. The camera is
// a function of film time alone, so the eleven beat compositions cut into each other without a seam: each one also
// carries its neighbours' windows ("ghosts") for the glides that cross its edges. film-slots.js draws it.
/** STYLE §5 and §6 limits for the run's camera. */
export const CAMERA = {
  fps: 30,
  maxPxPerFrame: 36,
  dip: 0.3,
  glide: 2.0,
  step: 1950,
  // the camera climbs a little at each glide, so the window it leaves sinks below the keyword box instead of rising
  // into it (review v3 item 4) and the next one settles in from just above the line it leaves on
  rise: -40,
  pushAfter: 4.0,
  intro: 1.3,
  keywordHeld: 1.2,
};
/**
 * Glides that swing back (review v3 item 4): out of the Chair's phone into the 1.5 s "approved." clip the camera
 * moves left and down, so the tall phone leaves to the right, away from the keyword, and the console rises in from
 * the lower left under it; the run then carries on to the right.
 */
export const SWING_BACK = { "signing-approved": { dy: 100 } };
/** The keyword box every window keeps out of while a keyword shows (review v3 item 4), with the windows' float. */
export const KEYWORD_BOX = { left: 146, top: 150, margin: 6 };
/** The film's keyword size (build.mjs keywordSize, kept in step): STYLE's 176 px, less for a long word by a phone. */
export const keywordSize = (word, kind) =>
  Math.min(
    176,
    Math.floor(
      (kind === "phone" ? WINDOWS.phone.a.x - WINDOWS.phone.w / 2 - 140 - 60 : 1640) / (word.length * 0.56),
    ),
  );
/**
 * Placeholder accent beats (review item 10), each on its slot's window, one accent per frame and each colour on its
 * one job (STYLE §3): indigo for a person's hand or Claude's reading, jade for money that arrived. `box` is
 * [x, y, w, h] in the window's own pixels and marks where the captured element should sit; when F3's captures land,
 * move each box onto its element (the timing stays). The pending plate keeps its words above y 380.
 */
export const ACCENTS = {
  // the reel's one peak (review v3 item 9): on "Try to break it" the lights go out (a cut, on the reel's own cut),
  // "refused." lands in the night over the lit window, and the day comes back through a focus pull before the
  // bumper; a short night insert (STYLE §1, at most 3 s), no hue
  "hl-break": {
    kind: "night",
    colour: "ink",
    box: [0, 0, 0, 0],
    what: "the break attempt refused: the lights go out, then come back by a focus pull",
  },
  "funding-console": {
    kind: "hit",
    colour: "jade",
    box: [610, 424, 290, 88],
    what: "the invoice paid into the pool",
  },
  "reading-console": { kind: "box", colour: "pod", box: [214, 424, 300, 88], what: "the figure Claude read" },
  "reading-byhand": { kind: "box", colour: "pod", box: [520, 424, 240, 88], what: "the digit Analyn typed" },
  "count-console": {
    kind: "pulse",
    colour: "pod",
    box: [610, 426, 300, 84],
    what: "the Count it once button",
  },
  "signing-console": { kind: "pulse", colour: "pod", box: [600, 426, 320, 84], what: "the first key" },
  "signing-phone": { kind: "pulse", colour: "pod", box: [40, 604, 250, 64], what: "the Chair's key" },
  "payouts-console": { kind: "hit", colour: "jade", box: [620, 424, 280, 88], what: "the batch sent" },
  "proof-browser": { kind: "box", colour: "pod", box: [110, 424, 780, 88], what: "six of six re-checked" },
  "member-phone": {
    kind: "trace",
    colour: "pod",
    box: [40, 520, 250, 76],
    slips: ["0403", "0419", "0436", "0467"],
    what: "her net pay traced to her four slips",
  },
  "listening-phone": { kind: "wave", colour: "ink", box: [40, 520, 76, 76], what: "her statement playing" },
};
const r3 = (value) => Math.round(value * 1000) / 1000;
/**
 * An accent's times: it fires as its keyword lands. A trace's slips rise from `at`, its threads start at `threads`
 * (0.45 s each, 0.1 s apart, STYLE §6) and its jade pulse runs from `landed`.
 */
function accentTimes(accent, at) {
  if (accent.kind !== "trace") return { ...accent, at: r3(at) };
  const threads = at + 0.35;
  return {
    ...accent,
    at: r3(at),
    threads: r3(threads),
    landed: r3(threads + 0.1 * (accent.slips.length - 1) + 0.45),
  };
}
/**
 * A night insert's times (STYLE §1, §5): the night cuts in with the slot (`at`), the focus pull starts once its word
 * has gone (`pull`: blur up, the night fades under it in `fade`, blur back to sharp two frames before the cut, so
 * the next composition opens on the plain day field). Every other window is off while the night is on.
 */
function nightTimes(accent, slot, kwOut) {
  const pull = [r3(kwOut + 0.1), r3(slot.end - 0.04)];
  const fade = [r3(kwOut + 0.15), r3(kwOut + 0.37)];
  if (fade[1] - slot.start > 3) throw new Error(`${slot.id}: a night insert runs over 3 s`);
  return { ...accent, at: r3(slot.start), pull, fade, peak: r3(kwOut + 0.27) };
}
/** The ordered capture-slot windows of the run, with their camera, glides, keyword times and accent. */
function choreograph() {
  const run = CAPTURES.filter((slot) =>
    SEGMENTS.some((segment) => segment.slots && segment.beats.includes(slot.beat)),
  ).sort((a, b) => a.start - b.start);
  const bumper = PARTS.find((part) => part.bumper)?.start;
  // The fastest a glide of `g` seconds can travel and keep the peak under STYLE's limit at the dip.
  const reach = (g) =>
    Math.floor((0.97 * 2 * g * CAMERA.maxPxPerFrame * CAMERA.fps) / (Math.PI * (1 - CAMERA.dip)));
  const slots = [];
  let cam = { x: 0, y: 0 };
  for (const [i, slot] of run.entries()) {
    const kind = windowKind(slot);
    const { a } = WINDOWS[kind];
    const prev = run[i - 1];
    let glideIn;
    let step = 0;
    if (!prev) glideIn = [slot.start, slot.start + CAMERA.intro];
    else {
      // The deep dive's bumper hides the move under its veil; elsewhere the glide straddles the cut.
      const g =
        slot.start === bumper
          ? CAMERA.glide
          : Math.min(CAMERA.glide, r3(0.7 * Math.min(prev.duration, slot.duration)));
      glideIn =
        slot.start === bumper ? [slot.start, slot.start + g] : [slot.start - g / 2, slot.start + g / 2];
      const swing = SWING_BACK[slot.id];
      step = swing ? -Math.floor(Math.sqrt(reach(g) ** 2 - swing.dy ** 2)) : Math.min(CAMERA.step, reach(g));
      cam = { x: cam.x + step, y: cam.y + (swing ? swing.dy : CAMERA.rise) };
    }
    slots.push({
      id: slot.id,
      beat: slot.beat,
      first: i === 0,
      last: i === run.length - 1,
      // phases differ per window so nothing floats in lockstep (STYLE §4)
      ph: r3(1.3 * i + 0.37 * slot.start),
      kind,
      start: slot.start,
      end: slot.start + slot.duration,
      keyword: KEYWORDS[slot.id],
      cam: { ...cam, s: 1 },
      // the window's centre in the world: where the camera's hold pose puts it at `a`
      x: cam.x + a.x - 960,
      y: cam.y + a.y - 540,
      glideIn: glideIn.map(r3),
      step,
    });
  }
  const last = slots.at(-1);
  // the glide off the last phone (review v3 item 3): it holds while her sentence plays and leaves in its last second,
  // so the field is empty only from the veil's 92% (142.85) to the close's lift
  const outro = {
    glide: [141.9, last.end],
    veil: [142.45, 142.85],
    step: Math.floor(0.9 * reach(last.end - 141.9)),
  };
  let lastOut = -Infinity;
  for (const [i, s] of slots.entries()) {
    const next = slots[i + 1];
    const arrive = s.glideIn[1];
    const depart = next ? next.glideIn[0] : outro.glide[0];
    const glideOut = next ? next.glideIn : outro.glide;
    const after = PARTS.find((part) => part.bumper && part.start === s.start);
    const held = CAMERA.keywordHeld;
    // the keyword lands as the window arrives (the wipe is the hit) and is gone before its composition ends (a wipe
    // out that would reach the cut is shortened in film-slots.js so it finishes two frames before it)
    let kwIn = Math.max(s.start + 0.05, arrive - 0.45, lastOut + 0.3);
    if (after) kwIn = Math.max(kwIn, s.start + BUMPER_SECONDS + 0.1);
    const push = depart - arrive >= CAMERA.pushAfter;
    const cap = beats.find((beat) => beat.id === s.beat).end - 0.33;
    // a phone is tall: its keyword is gone before the glide carries it into the keyword box, or (on a swing back)
    // before the next word comes in with the swing (review v3 item 4)
    const leaveBy = s.kind === "phone" && next ? depart - 0.1 : Infinity;
    let kwOut = Math.min(
      cap,
      leaveBy,
      push ? kwIn + 2.3 : Math.max(kwIn + held, Math.min(depart + 0.15, s.end - 0.05)),
    );
    kwIn = Math.max(Math.min(kwIn, kwOut - held), s.start - 0.1, lastOut + 0.3);
    // a swing back's window rises in clear of the keyword box, so its word can come in with the swing and hold longer
    if (SWING_BACK[s.id]) kwIn = Math.max(s.glideIn[0] + 0.25, lastOut + 0.3);
    // the night insert's word lands on the cut into the night and leaves before the focus pull back to day
    if (ACCENTS[s.id]?.kind === "night") {
      kwIn = Math.max(s.start + 0.05, lastOut + 0.3);
      kwOut = kwIn + held + 0.05;
    }
    lastOut = kwOut;
    const { b } = WINDOWS[s.kind];
    Object.assign(s, {
      arrive,
      depart,
      glideOut,
      kwIn: r3(kwIn),
      kwOut: r3(kwOut),
      push: push ? [r3(kwOut + 0.15), r3(kwOut + 1.8)] : null,
      // the push pose: the window centred and larger (STYLE §4 `b`)
      pushCam: push ? { x: r3(s.x - (b.x - 960) / b.s), y: r3(s.y - (b.y - 540) / b.s), s: b.s } : null,
      accent: !ACCENTS[s.id]
        ? null
        : ACCENTS[s.id].kind === "night"
          ? nightTimes(ACCENTS[s.id], s, kwOut)
          : accentTimes(ACCENTS[s.id], Math.max(kwIn + 0.35, arrive + 0.1)),
    });
  }
  // Camera keyframes in film seconds: [t, x, y, s, ease, dip]. Holds never stop dead (a slow push, STYLE §5).
  const keys = [];
  const key = (t, pose, ease = "sine.inOut", dip = 0) =>
    keys.push([r3(t), r3(pose.x), r3(pose.y), r3(pose.s), ease, dip]);
  const scaled = (pose, k) => ({ ...pose, s: pose.s * k });
  for (const [i, s] of slots.entries()) {
    if (i === 0) {
      key(s.start, scaled(s.cam, 0.94), "none");
      key(s.arrive, s.cam, "sine.out");
    } else key(s.arrive, s.cam, "sine.inOut", CAMERA.dip);
    if (s.push) {
      key(s.push[0], scaled(s.cam, 1.01));
      key(s.push[1], s.pushCam);
      key(s.depart, scaled(s.pushCam, 1.01));
    } else key(s.depart, scaled(s.cam, 1.015));
  }
  const end = { x: (last.pushCam ?? last.cam).x + outro.step, y: last.cam.y + 40, s: 1 };
  key(outro.glide[1], end, "sine.inOut", 0.25);
  return { slots, keys, outro };
}
export const CAPTURE_RUN = choreograph();

/** Where the run's camera puts a world point at film time `t` (the same curve film-slots.js draws). */
export function cameraAt(t, keys = CAPTURE_RUN.keys) {
  const sio = (u) => -(Math.cos(Math.PI * u) - 1) / 2;
  const ease = { "sine.inOut": sio, "sine.out": (u) => Math.sin((u * Math.PI) / 2), none: (u) => u };
  if (t <= keys[0][0]) return { x: keys[0][1], y: keys[0][2], s: keys[0][3] };
  for (let i = 1; i < keys.length; i++) {
    const [ta, xa, ya, sa] = keys[i - 1];
    const [tb, xb, yb, sb, name, dip] = keys[i];
    if (t <= tb) {
      const u = (t - ta) / (tb - ta);
      const e = ease[name](u);
      const k = dip ? 1 - dip * Math.sin(Math.PI * sio(u)) : 1;
      return { x: xa + (xb - xa) * e, y: ya + (yb - ya) * e, s: (sa + (sb - sa) * e) * k };
    }
  }
  const [, x, y, s] = keys.at(-1);
  return { x, y, s };
}
// The run holds to its own rules, or the film does not build: the camera's travel at the frame centre stays under
// STYLE §5's peak (the zoom-out dip adds a radial drift towards the centre on top, as in the prototype's glides),
// each keyword is held long enough and never shares the anchor, and every accent sits in its slot.
{
  const { slots } = CAPTURE_RUN;
  const step = 1 / CAMERA.fps;
  for (let t = slots[0].start; t < CAPTURE_RUN.outro.glide[1] - 1e-9; t += step) {
    const c0 = cameraAt(t);
    const c1 = cameraAt(t + step);
    const v = Math.hypot(c1.x - c0.x, c1.y - c0.y) * Math.max(c0.s, c1.s);
    if (v > CAMERA.maxPxPerFrame + 1e-6)
      throw new Error(`capture run: the camera travels ${v.toFixed(1)} px in the frame at ${t.toFixed(2)} s`);
  }
  for (const [i, s] of slots.entries()) {
    if (s.kwOut - s.kwIn < CAMERA.keywordHeld - 1e-9) throw new Error(`${s.id}: keyword held under 1.2 s`);
    if (i && s.kwIn < slots[i - 1].kwOut + 0.3 - 1e-9) throw new Error(`${s.id}: two keywords at the anchor`);
    if (s.accent && (s.accent.at < s.start || s.accent.at > s.end - 0.8))
      throw new Error(`${s.id}: accent outside its slot`);
  }
  // No window inside a showing keyword's box (review v3 item 4), and none in the tag corner, on any frame of the run.
  for (let f = Math.round(slots[0].start * CAMERA.fps); f <= Math.round(143 * CAMERA.fps); f++) {
    const t = f / CAMERA.fps;
    const boxes = runWindowsAt(t);
    for (const s of slots) {
      if (t < s.kwIn + 0.06 || t > s.kwOut + 0.28) continue;
      const size = keywordSize(s.keyword, s.kind);
      const [l, top, r, b] = [
        KEYWORD_BOX.left,
        KEYWORD_BOX.top,
        150 + 0.56 * size * s.keyword.length,
        150 + size,
      ];
      const m = KEYWORD_BOX.margin;
      for (const w of boxes)
        if (w.left - m < r && w.right + m > l && w.top - m < b && w.bottom + m > top)
          throw new Error(`${t.toFixed(2)} s: the ${w.id} window runs into the keyword "${s.keyword}"`);
    }
    for (const w of boxes)
      if (w.right > TAG.corner.x && w.bottom > TAG.corner.y)
        throw new Error(`${t.toFixed(2)} s: the ${w.id} window runs into the tag corner`);
  }
}
/**
 * The windows the run shows at film time `t` (film-slots.js's own rules: the glide fades, the night insert's cut, the
 * last window going with the veil), as screen boxes that include the float and the phone's bezel.
 */
export function runWindowsAt(t, run = CAPTURE_RUN) {
  const sio = (u) => -(Math.cos(Math.PI * u) - 1) / 2;
  const prog = (v, a, b) => (b <= a ? (v >= a ? 1 : 0) : Math.min(1, Math.max(0, (v - a) / (b - a))));
  const c = cameraAt(t, run.keys);
  const night = run.slots.find((s) => s.accent?.kind === "night" && t >= s.accent.at && t < s.accent.fade[1]);
  const out = [];
  for (const w of run.slots) {
    const [from, to] = [w.glideIn[0], w.glideOut[1]];
    if (t < from || t > to) continue;
    if (night && w !== night && w.start < night.start) continue;
    const fadeIn = w.first ? sio(prog(t, w.start, w.start + 0.5)) : sio(prog(t, from, from + 0.35));
    const fadeOut = w.last
      ? 1 - sio(prog(t, run.outro.veil[0], run.outro.veil[1]))
      : 1 - sio(prog(t, to - 0.35, to));
    if (fadeIn * fadeOut < 0.05) continue;
    const geo = WINDOWS[w.kind];
    const bezel = w.kind === "phone" ? 9 : 0;
    const [sx, sy] = [960 + (w.x - c.x) * c.s, 540 + (w.y - c.y) * c.s];
    const [hw, hh] = [(geo.w / 2 + bezel) * c.s + 6, (geo.h / 2 + bezel) * c.s + 6];
    out.push({ id: w.id, left: sx - hw, right: sx + hw, top: sy - hh, bottom: sy + hh });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the opening
// Generated from the prototype, the reference implementation of STYLE.md, so the two cannot drift: ids get the
// composition's prefix (one assembled page), images are read from proto/assets, fonts come from film.css.
export function openingFromPrototype(prefix = "op-") {
  const source = readFileSync(new URL("proto/index.html", import.meta.url), "utf8");
  const pick = (re, what) => {
    const found = re.exec(source);
    if (!found) throw new Error(`proto/index.html: no ${what}`);
    return found;
  };
  const style = pick(/<style>\n([\s\S]*?)<\/style>/, "style")[1];
  const defs = pick(/<svg width="0" height="0"[\s\S]*?<\/svg>/, "symbol defs")[0];
  const rootTag = pick(/<div id="root"[^>]*>/, "root")[0];
  const duration = Number(/data-duration="([\d.]+)"/.exec(rootTag)?.[1]);
  const body = source.slice(
    source.indexOf(rootTag) + rootTag.length,
    source.lastIndexOf("</div>\n\n<script>"),
  );
  const script = pick(/<script>\n([\s\S]*?)<\/script>\n<\/body>/, "timeline script")[1];
  const ids = [...new Set([...source.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]
    .filter((id) => id !== "root")
    .sort((a, b) => b.length - a.length);
  const rename = (text) => {
    let out = text;
    for (const id of ids) {
      const safe = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out
        .replace(new RegExp(`(?<=\\s)id="${safe}"`, "g"), `id="${prefix}${id}"`)
        .replace(new RegExp(`#${safe}(?![\\w-])`, "g"), `#${prefix}${id}`);
    }
    return out.replaceAll('"assets/', '"proto/assets/');
  };
  // The scoper prefixes every rule with the composition, so the prototype's :root tokens move onto #root.
  const css = rename(style)
    .replace(/^@font-face \{[^}]*\}\n/gm, "")
    .replace(/^html, body \{[^}]*\}\n/m, "")
    .replace(/^body \{[^}]*\}\n/m, "")
    .replace(
      /^#root \{[^}]*\}/m,
      "#root { position: absolute; inset: 0; overflow: hidden; background: #04060C; }",
    )
    .replace(/^:root \{/m, "#root {");
  const id = /data-composition-id="([^"]+)"/.exec(rootTag)?.[1];
  if (id !== "opening" || duration !== 30) throw new Error("The prototype is no longer the 30 s opening");
  // the joint at 30 s: the prototype's glide and its Slips disc are the plan's (SLIPS_UNDER_VEIL, OPENING.glide)
  const outro = pick(/const OUTRO = \{ t0: ([\d.]+), t1: ([\d.]+),/, "outro")
    .slice(1)
    .map(Number);
  const disc = pick(
    /const SLIPS = \{ x: ([\d.]+), y: ([\d.]+), disc: (\d+), scale: ([\d.]+), fade: \[([\d.]+), ([\d.]+)\] \};/,
    "Slips disc",
  )
    .slice(1)
    .map(Number);
  const S = SLIPS_UNDER_VEIL;
  if (
    outro.some((v, i) => v !== OPENING.glide[i]) ||
    disc.some((v, i) => v !== [S.centre.x, S.centre.y, S.disc, S.scale, ...S.fadeIn][i])
  )
    throw new Error("proto/index.html: the glide or the Slips disc drifted from plan.mjs (SLIPS_UNDER_VEIL)");
  if (!script.includes(`window.__timelines["${id}"] = tl;`))
    throw new Error("The prototype's timeline key moved");
  return {
    duration,
    html: `<!doctype html>
<!-- Generated by video/build.mjs from video/proto/index.html, the opening prototype and the reference implementation of
     video/proto/STYLE.md: ids prefixed ${prefix}, images read from proto/assets, fonts from film.css. Edit the prototype,
     then rebuild; never edit this file. Script v4 beats problem (0-14 s) and solution (14-30 s). -->
<html lang="en"><head><meta charset="UTF-8"></head><body><template>
<style>
${css}</style>
<div id="root" data-composition-id="${id}" data-width="1920" data-height="1080" data-duration="${duration}">
${rename(defs)}
${rename(body).trim()}
</div>
<script>
${rename(script)}</script>
</template></body></html>
`,
  };
}

// ---------------------------------------------------------------------------------------------------- captions
/** STYLE §8: a closed-caption track, word for word, at most two lines of 42 characters, each cue 1 to 6 seconds. */
export const CAPTION = { line: 42, lines: 2, min: 1, max: 6 };
/** Bracketed lines only where the sound carries meaning. */
export const BRACKETS = { listening: "[Her statement plays in Cebuano]" };
const breakCost = (word, last) => (last || /[.;:!?]$/.test(word) ? 0 : /,$/.test(word) ? 150 : 600);
/** A phrase as one line, or two balanced lines that break after punctuation where they can; null if it cannot fit. */
export function wrap(text, lines = CAPTION.lines) {
  if (text.length <= CAPTION.line) return [text];
  if (lines < 2) return null;
  let best = null;
  for (let k = text.indexOf(" "); k > 0; k = text.indexOf(" ", k + 1)) {
    const a = text.slice(0, k);
    const b = text.slice(k + 1);
    if (a.length > CAPTION.line || b.length > CAPTION.line) continue;
    // Balanced lines, broken at punctuation where possible and never after a little word that leads the next.
    const score =
      Math.max(a.length, b.length) +
      (/[.,;:!?]$/.test(a) ? 0 : 16) +
      (/\b(a|an|and|or|the|to|of|in|on|its|their|then|sa)$/i.test(a) ? 8 : 0) +
      Math.abs(a.length - b.length) / 100;
    if (!best || score < best.score) best = { score, lines: [a, b] };
  }
  return best?.lines ?? null;
}
const ms = (value) => Math.round(value * 1000) / 1000;
/**
 * One beat's cues. Timing is word-proportional across the beat's speech window (as every card, architecture step and
 * reel cut is timed) until F4 aligns the recorded voice; the cheapest split prefers breaks at punctuation.
 */
export function captionCues(beat) {
  const words = beat.say.split(" ");
  const [from, to] = beat.speech ?? [beat.start, beat.end];
  const per = (to - from) / words.length;
  const bracket = BRACKETS[beat.id] ?? null;
  const best = Array(words.length + 1).fill(null);
  best[0] = { cost: 0, from: -1, lines: null };
  for (let i = 1; i <= words.length; i++)
    for (let j = 0; j < i; j++) {
      if (!best[j]) continue;
      const text = words.slice(j, i).join(" ");
      const lines = wrap(text, j === 0 && bracket ? 1 : CAPTION.lines);
      const seconds = (i - j) * per;
      if (!lines || seconds < CAPTION.min - 1e-9 || seconds > CAPTION.max + 1e-9) continue;
      const cost =
        best[j].cost + 100 + breakCost(words[i - 1], i === words.length) + Math.max(0, 28 - text.length) ** 2;
      if (!best[i] || cost < best[i].cost) best[i] = { cost, from: j, lines };
    }
  if (!best[words.length])
    throw new Error(`${beat.id}: no caption split fits ${CAPTION.max} s and two lines`);
  const cues = [];
  for (let i = words.length; i > 0; i = best[i].from) {
    const j = best[i].from;
    cues.unshift({
      beat: beat.id,
      start: ms(from + j * per),
      end: i === words.length ? ms(to) : ms(from + i * per),
      lines: j === 0 && bracket ? [bracket, ...best[i].lines] : best[i].lines,
    });
  }
  return cues;
}
export const captions = beats.flatMap((beat) => (beat.say ? captionCues(beat) : []));

export const stamp = (value) => {
  const total = Math.round(value * 1000);
  const pad = (n, size = 2) => String(n).padStart(size, "0");
  return `${pad(Math.floor(total / 3600000))}:${pad(Math.floor(total / 60000) % 60)}:${pad(Math.floor(total / 1000) % 60)}.${pad(total % 1000, 3)}`;
};
export function vtt(cues, note, shift = 0) {
  const body = cues
    .map(
      (cue, i) =>
        `${i + 1}\n${stamp(cue.start - shift)} --> ${stamp(cue.end - shift)}\n${cue.lines.join("\n")}\n`,
    )
    .join("\n");
  return `WEBVTT\n\nNOTE ${note}\n\n${body}`;
}
export const VTT_NOTE =
  "Fair Split film, script v4: closed captions, word for word with every spoken line and never burned in (video/proto/STYLE.md §8). Generated from video/script.ts by video/build.mjs. Timing is word-proportional within each beat until F4 aligns the recorded voice.";
export const CLOSE_START = 143;
export const CLOSE_NOTE =
  "Closed captions for the film close (script v4 beats impressive, limits, end): video/captions.vtt from 143 s, shifted by -143 s and generated with it by video/build.mjs. Muxed into out/close.mp4 as a soft subtitle track; never burned in.";

// ------------------------------------------------------------------------------------------------ audio cues
/** Picture events the sound is cut to (film seconds). The opening's come from video/proto (its README outline). */
export const OPENING = {
  hairline: 0.3,
  farmers: 1.4,
  shoebox: 3.2,
  wave: 5.5,
  doubled: [7.6, 9.6],
  once: 9.7,
  ring: 12.85,
  invoice: 13.12,
  turn: [14.45, 15.8],
  keywords: [16.6, 20.2, 23.25],
  statement: 23.78,
  jadePulse: 26.6,
  endLine: 27.2,
  // the opening no longer ends on the name: it holds its end line, then glides off it in one second onto the
  // architecture's Slips disc waiting under the veil (review v3 item 3, SLIPS_UNDER_VEIL)
  glide: [29, 30],
};
/**
 * Where each narration line must sit in the picture (STYLE §9, AUDIO-CUES "Fit to the picture"). Lines not listed fit
 * their placeholder windows. `picture` is in film seconds.
 */
export const NARRATION_FIT = [
  {
    beat: "problem",
    picture: [1.4, 14.4],
    why: 'Under the night\'s words, from "64 farmers." to the turn; the hairline stays near silent.',
  },
  {
    beat: "solution",
    picture: [14.45, 27.2],
    why: '"Fair Split:" rides the swell at the turn (STYLE §9) and the line ends before "Every peso, traced." (27.2): its 36 words need 169 wpm there. Six words shorter fits about 141 wpm; seven shorter keeps it under the check\'s 140 wpm. Proposed line, 29 words, 136 wpm (for F1 and E-19 to decide; script.ts is not changed here): "Fair Split: Claude reads the paper. Code computes every amount and holds what it can\'t justify. Two officers sign large batches. A simulated PayPal pays. The buyer re-checks everything." With it, SPEECH.solution becomes 14.45–27.2 and caption cue 4 starts on the turn (it starts at 14.0 today because captions follow script.ts\'s speech window).',
  },
  {
    beat: "paper",
    picture: [58.2, 65],
    why: 'After the bumper\'s words ("The deep dive.", 57.25–58.1), which are an end line.',
  },
  {
    beat: "member",
    picture: [129, 133.8],
    why: "Ends before her own sentence starts (134.15) with a breath between.",
  },
];
/**
 * The close's own events (video/parts/close, film time), all in daylight on the reel's field: the figures, the hand's
 * box on the handwritten weigh-slip, one limit at a time (each with its tag), the trace's jade pulse, the end line
 * and the film's one name card.
 */
export const CLOSE = {
  figures: [143.3, 147.4],
  hand: 152.6,
  // each limit's keyword lands beside its object (limits.html LIMITS kw[0] + 143)
  limits: [155.2, 157.85, 160.6, 162.3, 165.25],
  jadePulse: 169.85,
  endLine: 170.6,
  name: 171.95,
};
/**
 * The IC-11 PREMIUM sentence, placed inside the listening beat: the phone holds while it plays and the camera glides
 * off it in its last second (141.9–143.0, under the veil from 142.45).
 */
export const MEMBER_CLIP = { start: 134.15, seconds: 8.44 };
export const FILM_SECONDS = FILM.duration;
