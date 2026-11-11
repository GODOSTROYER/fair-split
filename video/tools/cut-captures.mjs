// Cuts every capture slot's clip out of the recorded film take (e2e/film/slots.spec.ts, `FILM_TAKE=slots corepack pnpm
// e2e:film`) into video/captures/<slot>.mp4, and writes video/captures/take.json beside them: each clip's shots, its
// length, its accent and its labels (plan.mjs reads that geometry, so the film's indigo box, button pulse, jade hit and
// trace land on the recorded element).
//
// A clip covers its window's whole time on screen (plan.mjs clipSpan: media 0 = the start of its glide in). Its time
// comes from one action mark in the take: `at` is the film second that mark lands on (the press on its narration word,
// the accent's beat), so every product event keeps its real speed and lands where the sound already is. A clip is one
// or more shots of the same recording (review v6 F3, F9): each frames one readable element (the union of recorded
// test-id boxes, padded, grown to the window's aspect and kept inside its panel, never a sliver of a neighbour), and
// the next shot dissolves in on the word that names it. Nothing is a fixed pixel, so a re-capture of a changed UI
// re-frames itself. Clips are quiet (STYLE §3, review v6 F5): the product at 0.15 saturation, its own indigo and
// colour greyed, full colour only inside the film's accent while it fires (and on the payouts as they confirm).
//
//   node video/tools/cut-captures.mjs [take dir] [--only id,id] [--sheet]
//
// The take dir defaults to e2e/film-out/slots. `--sheet` also writes captures/sheet-<slot>.png contact sheets.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPTURE_RUN, WINDOWS, windowKind } from "../plan.mjs";
import { beats, CAPTURES } from "../script.ts";

const here = dirname(fileURLToPath(import.meta.url));
const video = resolve(here, "..");
const repo = resolve(video, "..");
const args = process.argv.slice(2);
const takeDir = resolve(args.find((a) => !a.startsWith("--")) ?? join(repo, "e2e/film-out/slots"));
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const sheets = args.includes("--sheet");
const FFMPEG = process.env.FFMPEG ?? "C:/Users/user/AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe";
const FPS = 30;
/** Output size per window kind: a little over the window's largest size on screen (the 1.16× push). */
const OUTPUT = { landscape: [1280, 720], phone: [440, 954] };
/** Quiet variant (STYLE §3, review v6 F5): the product at this saturation outside the film's accent. */
const QUIET = 0.15;
/** A shot dissolves into the next over this long. */
const DISSOLVE = 0.35;
/** Crops stay this far inside their panel (review v6 F8). */
const INSET = 16;

/** When the voice says the first word starting with `prefix` in `beat` (film seconds). */
function word(beat, prefix) {
  const found = beats
    .find((b) => b.id === beat)
    ?.words?.find((w) => w.w.toLowerCase().replace(/^\W+/, "").startsWith(prefix));
  if (!found) throw new Error(`"${prefix}" is not said in ${beat}`);
  return found.start;
}

const PHONE_MEMBER = "W-JG-01.frame.member";
const PHONE_CHAIR = "W-JG-01.frame.chair";
const DRAWER = ["W-TR-06.drawer"];
/** The H1 drawer's head while it asks, and its result once counted (the readable element of once.). */
const H1_HEAD = ["W-TR-06.card.gate", "W-TR-06.card.effect", "W-TR-06.countOnce"];
const DIAL = ["W-TR-05.dial", "W-TR-05.reading", "W-TR-05.dial.status"];
const APPROVED = ["W-TR-07.seal", "W-TR-07.amount", "W-TR-07.keys"];
/** The fan-out's confirmed count, the seal and its eight lines to their nodes (names and amounts left out). */
const FAN = ["W-TR-08.count", "W-TR-08.thread.M-014", "W-TR-08.thread.M-031"];

/**
 * One recipe per slot. `seg` the take's segment, `mark` its action and `at` the film second that action lands on.
 * `shots`: the first frames the window from its glide in; each later one dissolves in at its film second `from`
 * (`src` replays another moment of the recording for a cutaway). A shot frames `crop` (test ids, union, at the box
 * label `box`; `also` adds ids at another label), optionally a band `slice` [dy, h] of it, padded `pad`, at least
 * `minWidth` wide, kept inside `within` (its panel). `accent`: the ids the slot's accent sits on (`steps` walk it down
 * a list, each on its word); `kind` overrides the accent's kind, `pulses` how many times a pulse rings. `speed`: a
 * labelled real-time multiplier between two marks (the fan-out's confirmations land on the seven notes). `chip`: a
 * film micro-tag beside a recorded element. `levels` lifts a clip recorded under a scrim. Ids inside a phone frame
 * read `<frame test id>><id>`.
 */
export const RECIPES = {
  // the mass-balance dial falling on "rebalances", over the top rows (recorded under the H1 drawer's scrim: lifted)
  "hl-matrix": {
    seg: "h1",
    mark: "countOnce",
    at: 45.0,
    shots: [
      {
        box: "ready",
        crop: [...DIAL, "W-TR-05.dup.M-007"],
        pad: 20,
        within: ["W-TR-05"],
        inset: -16,
        align: "left",
        valign: "top",
        maxWidth: 500,
      },
    ],
    levels: "eq=contrast=1.2:brightness=0.08",
  },
  // the refusal block: "Refused · Schedule A is closed until 2026-B"
  "hl-ratecard": {
    seg: "rate",
    mark: "refused",
    at: 46.0,
    shots: [
      {
        box: "plate",
        crop: ["W-TR-02.refusal"],
        pad: 20,
        within: ["W-TR-02.add"],
        inset: -12,
        align: "left",
        maxWidth: 560,
      },
    ],
  },
  // two keys, one hash: the seal, US$368.39 and the Chair's key landing, 2/2 signed (review v6 F2)
  "hl-keys": {
    seg: "keys",
    mark: "signed",
    at: 49.6,
    shots: [{ box: "approved", crop: APPROVED, pad: 20, within: ["W-TR-07.column"], inset: -16 }],
  },
  "hl-proof": {
    seg: "proof",
    mark: "verdict",
    at: 50.2,
    shots: [
      {
        box: "verified",
        crop: ["W-PF-01.seal", "W-PF-01.verdict.count", "W-PF-01.verdict.sample"],
        pad: 20,
        within: ["W-PF-01.hero"],
      },
    ],
  },
  // pay you can hear: Paminawa's premium line as it starts to play (review v6 F2)
  "hl-member": {
    seg: "listening",
    mark: "play",
    at: 52.75,
    shots: [{ box: "playing", crop: [PHONE_MEMBER], pad: 0 }],
  },
  // Try to break it: the overcharge row, refused, with the amount it blocked
  "hl-break": {
    seg: "break",
    mark: "tamper",
    at: 55.15,
    shots: [
      {
        box: "denied",
        crop: ["W-JG-01.tamper.amount", "W-JG-01.tamper.result"],
        pad: 20,
        within: ["W-JG-01.tryToBreak"],
        inset: -12,
      },
    ],
  },
  // the photo's lower slips over the filmstrip A-L, the pink copy D among them
  "paper-photos": {
    seg: "reading",
    mark: "start",
    at: 57.0,
    shots: [{ box: "done", crop: ["W-TR-03.film"], pad: 24, within: ["W-TR-03.desk"], inset: -16 }],
  },
  // the white original beside its pink copy and the four fields that match
  "paper-carbon": {
    seg: "h1",
    mark: "start",
    at: 60.0,
    shots: [{ box: "ready", crop: ["W-TR-06.card"], slice: [235, 335], pad: 0, within: DRAWER }],
    // the pink carbon copy keeps its colour (the slot's one accent: the duplicate), the rest is quiet
    keepWindow: [[500, 0, 500, 420]],
  },
  "funding-console": {
    seg: "funding",
    mark: "funded",
    at: 66.1,
    shots: [
      {
        box: "funded",
        crop: ["W-JG-01.invoice.amount", "W-JG-01.action", "W-JG-01.status"],
        pad: 24,
        minWidth: 600,
        valign: "bottom",
        within: ["W-JG-01.invoice"],
      },
    ],
    // the invoice's own "Funded" lights jade as the pool funds; the record is the simulator's (review v6 V6-05)
    accent: ["W-JG-01.status"],
    chip: { text: "Simulated record-payment", beside: "W-JG-01.markPaid", from: 0.4 },
  },
  "reading-console": {
    seg: "heroes",
    mark: "start",
    at: 72.0,
    // under the photo (no woven mat, review v6 F6): both captions and the comparison row, inside the tile
    shots: [
      {
        box: "heroes",
        crop: ["W-TR-03.hero.spike-0403"],
        slice: [422, 168],
        pad: 0,
        within: ["W-TR-03.hero.spike-0403"],
        inset: -4,
      },
    ],
    // Claude's two reads, "38.45 / 38.45" (no test id of its own: placed on the tile)
    accentRect: [-4, 504, 104, 30],
  },
  // the stained digit typed from the keyboard on the tick, then Enter, the result settling before the glide out
  "reading-byhand": {
    seg: "byhand",
    mark: "typed",
    at: 77.5,
    shots: [
      {
        box: "empty",
        crop: ["W-TR-04.prompt", "W-TR-04.input"],
        also: { box: "committed", ids: ["W-TR-04.committed"] },
        pad: 20,
        within: ["W-TR-04"],
        inset: -16,
        valign: "top",
      },
    ],
    accent: ["W-TR-04.input"],
    accentBox: "empty",
  },
  // Count it once on the tick, the money back to 63 members, then the dial for "the dial drops inside the limit"
  "count-console": {
    seg: "h1",
    mark: "countOnce",
    at: 84.1,
    shots: [
      { box: "ready", crop: H1_HEAD, pad: 24, within: DRAWER },
      // a cutaway to the dial, replaying its fall from the press (the same recording) on "drops"
      {
        from: word("count-once", "dial") - 0.25,
        box: "ready",
        crop: DIAL,
        pad: 16,
        within: ["W-TR-05"],
        inset: -16,
        valign: "top",
        src: { mark: "countOnce", at: word("count-once", "drops") - 0.35 },
        levels: "eq=contrast=1.2:brightness=0.08",
      },
    ],
    accent: ["W-TR-06.countOnce.face"],
    pulses: 1,
  },
  "holds-console": {
    seg: "h3",
    mark: "returnCredit",
    at: 92.6,
    shots: [{ box: "returned", crop: DRAWER, slice: [60, 260], pad: 0, within: DRAWER }],
  },
  // Analyn's deduction (the form), then the refusal on "Refused:"
  "rules-console": {
    seg: "rate",
    mark: "refused",
    at: 97.05,
    shots: [
      {
        box: "adding",
        crop: ["W-TR-02.addLabel", "W-TR-02.addCommit"],
        pad: 20,
        within: ["W-TR-02"],
        inset: -8,
      },
      {
        from: 96.9,
        box: "refused",
        crop: ["W-TR-02.refusal"],
        pad: 20,
        within: ["W-TR-02.add"],
        inset: -12,
        align: "left",
        maxWidth: 560,
      },
    ],
  },
  // the hold on "Approve 8 payouts", then her signature among the two keys
  "signing-console": {
    seg: "key1",
    // the slab released on the plunk (c21, 103.1); her signature shows about half a second later
    mark: "key1.up",
    at: 103.15,
    shots: [
      {
        box: "ready",
        crop: ["W-TR-07.safe", "W-TR-07.approve"],
        pad: 20,
        within: ["W-TR-07.column"],
        inset: -16,
      },
      {
        from: word("signing", "two") - 0.2,
        box: "signed",
        crop: APPROVED,
        pad: 20,
        within: ["W-TR-07.column"],
        inset: -16,
      },
    ],
    accent: ["W-TR-07.approve.face"],
    accentBox: "ready",
    pulses: 1,
  },
  "signing-phone": {
    seg: "keys",
    mark: "signed",
    at: 107.3,
    shots: [{ box: "chair", crop: [PHONE_CHAIR], pad: 0 }],
    // the Chair's key: an indigo box on his phone's signed line, "Napirmahan" (review v6 F10)
    accent: [`${PHONE_CHAIR}>M-BD-02.signed`],
    accentBox: "approved",
    kind: "box",
  },
  "signing-approved": {
    seg: "keys",
    mark: "signed",
    at: 109.2,
    shots: [{ box: "approved", crop: APPROVED, pad: 20, within: ["W-TR-07.column"], inset: -16 }],
  },
  // "accepts the batch" on Batch accepted, the fan-out opening hollow after "not yet paid", and the seven items
  // confirming on the seven notes: their real 1/8 -> 7/8, labelled with its real-time multiplier (review v6 F1)
  "payouts-console": {
    seg: "keys",
    mark: "count:1/8",
    at: 116.005,
    shots: [
      {
        box: "approved",
        crop: ["W-TR-07.safe", "W-TR-07.fanout"],
        pad: 20,
        within: ["W-TR-07.column"],
        inset: -16,
        src: { mark: "signed", at: 110.3 },
      },
      // the fan-out as the page opens on it (hollow, then confirming): its count, seal and lines to their nodes
      {
        fromMark: "count:0/8",
        fromOffset: 0.1,
        box: "fanout",
        crop: FAN,
        pad: 12,
        within: ["W-TR-08"],
        inset: -16,
        valign: "bottom",
      },
    ],
    speed: { from: 116.005, to: 116.845, marks: ["count:1/8", "count:7/8"] },
    real: true,
  },
  // Rhea parked, Pay in cash on "moves to cash", her line moving to cash: 57 members · cash at the bodega
  "payouts-cash": {
    seg: "cash",
    mark: "payCash",
    at: 118.75,
    shots: [
      {
        box: "parked",
        crop: ["W-TR-08.label.M-031", "W-TR-08.cashLabel", "W-TR-08.payCash"],
        pad: 20,
        within: ["W-TR-08"],
        inset: -16,
      },
    ],
  },
  // Verify, 6/6, then each check on its word (its row, read from its number), then where every dollar went
  // (review v6 F9, V6-07)
  "proof-browser": {
    seg: "proof",
    mark: "verify",
    at: 121.3,
    shots: [
      {
        box: "verified",
        crop: ["W-PF-01.seal", "W-PF-01.verdict.count", "W-PF-01.verdict.result", "W-PF-01.verify"],
        pad: 20,
        within: ["W-PF-01.hero"],
        inset: -16,
      },
      ...[
        ["rate", ["W-PF-01.checks.paid", "W-PF-01.checks.ratified", "W-PF-01.checks.read"]],
        ["both", ["W-PF-01.checks.computed", "W-PF-01.checks.twoKeys", "W-PF-01.checks.payoutItems"]],
      ].map(([said, ids]) => ({
        from: word("proof", said) - 0.3,
        box: "verified",
        crop: ids,
        pad: 14,
        within: ["W-PF-01"],
        inset: -16,
        align: "left",
        valign: "top",
        maxWidth: 440,
      })),
      {
        from: word("proof", "line") + 0.35,
        box: "verified",
        crop: ["W-PF-01.money"],
        slice: [140, 224],
        pad: 0,
        within: ["W-PF-01.money"],
        inset: 4,
      },
    ],
    accent: ["W-PF-01.verdict.count", "W-PF-01.verdict.result"],
    steps: [
      { at: word("proof", "rate"), ids: ["W-PF-01.checks.ratified"] },
      { at: word("proof", "signatures"), ids: ["W-PF-01.checks.twoKeys"] },
      { at: word("proof", "line"), ids: ["W-PF-01.checks.computed"] },
    ],
    stepHold: 0.3,
  }, // her net pay opens (framed -> expanded) as the window lands, then the film's trace runs from her four slips to
  // their own kg chips and pulses jade on US$64.45 (review v6 F4, F12)
  "member-phone": {
    seg: "member",
    mark: "tap",
    at: 128.85,
    shots: [{ box: "traced", crop: [PHONE_MEMBER], pad: 0 }],
    accent: [`${PHONE_MEMBER}>M-MB-01.receipt.net.amount`],
    accentBox: "traced",
    traceChips: `${PHONE_MEMBER}>M-MB-01.trace.net.slips`,
  },
  "listening-phone": {
    seg: "listening",
    mark: "play",
    at: 134.2,
    shots: [{ box: "playing", crop: [PHONE_MEMBER], pad: 0 }],
    accent: [`${PHONE_MEMBER}>M-MB-03.play`],
  },
};
const take = JSON.parse(readFileSync(join(takeDir, "take.json"), "utf8"));
const view = take.viewport;
const out = join(video, "captures");
mkdirSync(out, { recursive: true });
const previous = existsSync(join(out, "take.json"))
  ? JSON.parse(readFileSync(join(out, "take.json"), "utf8"))
  : null;

const labelOf = (segment, label) => segment.boxes.find((b) => b.label === label) ?? segment.boxes.at(-1);
/** The union of the named boxes at a box label (ids that are missing are reported), optionally a band of it. */
function boxOf(segment, label, ids, slice = null, missing = []) {
  const at = labelOf(segment, label);
  for (const id of ids) if (!at.items[id]) missing.push(id);
  const list = ids.map((id) => at.items[id]).filter(Boolean);
  if (!list.length) return null;
  const x0 = Math.min(...list.map((r) => r[0]));
  const y0 = Math.min(...list.map((r) => r[1]));
  const x1 = Math.max(...list.map((r) => r[0] + r[2]));
  const y1 = Math.max(...list.map((r) => r[1] + r[3]));
  return slice ? [x0, y0 + slice[0], x1 - x0, slice[1]] : [x0, y0, x1 - x0, y1 - y0];
}

/** The console's top bar ends here: a crop stays under it when it can. */
const TOP = 72;
/**
 * Padded, grown to the window's aspect round its centre, kept inside its panel (inset INSET px) or the viewport, and
 * shrunk to fit when the panel is narrower than the grown crop, so no sliver of a neighbouring panel shows.
 */
function cropFor(rect, pad, aspect, bound, opts = {}) {
  const { minWidth = 0, maxWidth = Infinity, inset = INSET, align = "centre", valign = "middle" } = opts;
  // `inset` < 0 lets a crop reach into a screen's own page margin (a screen container ends at its content's edge)
  const b = bound
    ? [
        Math.max(0, bound[0] + inset),
        Math.max(bound[1] + inset, 0),
        bound[2] - 2 * inset,
        bound[3] - 2 * inset,
      ]
    : [0, TOP, view.width, view.height - TOP];
  b[2] = Math.min(b[2], view.width - b[0]);
  b[3] = Math.min(b[3], view.height - b[1]);
  let [x, y, w, h] = [rect[0] - pad, rect[1] - pad, rect[2] + 2 * pad, rect[3] + 2 * pad];
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  if (w < minWidth) [w, h] = [minWidth, minWidth / aspect];
  if (w > maxWidth) [w, h] = [maxWidth, maxWidth / aspect];
  if (w > b[2]) [w, h] = [b[2], b[2] / aspect];
  if (h > b[3]) [w, h] = [b[3] * aspect, b[3]];
  // a text block is read from its left edge and its first line: anchor the crop there when it is narrower
  const left = align === "left" ? rect[0] - pad : cx - w / 2;
  const top =
    valign === "top" ? rect[1] - pad : valign === "bottom" ? rect[1] + rect[3] + pad - h : cy - h / 2;
  x = Math.min(Math.max(b[0], left), b[0] + b[2] - w);
  y = Math.min(Math.max(b[1], top), b[1] + b[3] - h);
  return [x, y, w, h].map((v) => Math.round(v * 100) / 100);
}

const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/, "ffprobe$1");
const widths = new Map();
function frameWidth(file) {
  if (!widths.has(file)) {
    const probe = spawnSync(
      FFPROBE,
      ["-v", "error", "-show_entries", "stream=width", "-of", "csv=p=0", file],
      {
        encoding: "utf8",
      },
    );
    widths.set(file, Number(probe.stdout.trim()));
  }
  return widths.get(file);
}

const ff = (list) => {
  const result = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...list], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
};
const r = (v) => Math.round(v);
const r3 = (v) => Math.round(v * 1000) / 1000;

const slots = {};
const report = [];
for (const slot of CAPTURES) {
  if (only && !only.includes(slot.id)) {
    if (previous?.slots?.[slot.id]) slots[slot.id] = previous.slots[slot.id];
    continue;
  }
  const recipe = RECIPES[slot.id];
  if (!recipe) throw new Error(`${slot.id}: no recipe`);
  const move = CAPTURE_RUN.slots.find((s) => s.id === slot.id);
  const kind = windowKind(slot);
  const geo = WINDOWS[kind];
  const [ow, oh] = OUTPUT[kind];
  const segment = take.segments.find((s) => s.name === recipe.seg);
  if (!segment) throw new Error(`${slot.id}: the take has no segment ${recipe.seg}`);
  const markOf = (name) => {
    const at = name === "start" ? segment.startedAt : segment.marks.find((m) => m.name === name)?.at;
    if (at === undefined) throw new Error(`${slot.id}: segment ${recipe.seg} has no mark ${name}`);
    return at;
  };
  const vis0 = move.glideIn[0];
  const seconds = r3(move.glideOut[1] - vis0 + 0.1);
  const count = Math.ceil(seconds * FPS);

  // the clip's clock: film second T -> take time (ms), at real speed, but for a labelled speed span
  const anchor = markOf(recipe.mark);
  let badge = null;
  let source = (T) => anchor + (T - recipe.at) * 1000;
  if (recipe.speed) {
    const [m0, m1] = recipe.speed.marks.map(markOf);
    const { from, to } = recipe.speed;
    const rate = (m1 - m0) / 1000 / (to - from);
    const base = source;
    source = (T) => (T <= from ? base(T) : T >= to ? m1 + (T - to) * 1000 : m0 + (T - from) * rate * 1000);
    if (rate > 1.05) badge = { text: `×${Math.round(rate)} real time`, from, to, rate: r3(rate) };
  }

  // the shots: each crop inside its panel, active from its `from` (the first from the glide in)
  const missing = [];
  const shots = recipe.shots.map((spec, i) => {
    let rect = boxOf(segment, spec.box, spec.crop, spec.slice, missing);
    if (!rect) throw new Error(`${slot.id}: none of ${spec.crop.join(", ")} at ${recipe.seg}/${spec.box}`);
    // `also`: more ids at another box label (an element that appears or leaves during the shot)
    if (spec.also) {
      const more = boxOf(segment, spec.also.box, spec.also.ids, null, missing);
      if (more) {
        const x0 = Math.min(rect[0], more[0]);
        const y0 = Math.min(rect[1], more[1]);
        rect = [
          x0,
          y0,
          Math.max(rect[0] + rect[2], more[0] + more[2]) - x0,
          Math.max(rect[1] + rect[3], more[1] + more[3]) - y0,
        ];
      }
    }
    const bound = spec.within ? boxOf(segment, spec.box, spec.within, null, missing) : null;
    const crop = kind === "phone" ? rect : cropFor(rect, spec.pad ?? 0, geo.w / geo.h, bound, spec);
    // a shot can start on a mark of the take (the fan-out opening), mapped through the clip's clock
    const from =
      i === 0
        ? vis0
        : spec.fromMark
          ? recipe.at + (markOf(spec.fromMark) - anchor) / 1000 + (spec.fromOffset ?? 0)
          : spec.from;
    const src = spec.src
      ? (
          (m, at) => (T) =>
            m + (T - at) * 1000
        )(markOf(spec.src.mark), spec.src.at)
      : source;
    return { ...spec, ids: spec.crop, crop, from, src, k: geo.w / crop[2] };
  });
  if (missing.length) report.push(`${slot.id}: ids not recorded: ${[...new Set(missing)].join(", ")}`);
  const shotAt = (T) => shots.filter((s) => s.from <= T + 1e-6).at(-1) ?? shots[0];
  const toWindow = (shot, rect, padBy = 0) =>
    [
      (rect[0] - padBy - shot.crop[0]) * shot.k,
      (rect[1] - padBy - shot.crop[1]) * shot.k,
      (rect[2] + 2 * padBy) * shot.k,
      (rect[3] + 2 * padBy) * shot.k,
    ].map(r);

  // the accent on its recorded element, through the shot active when it fires (padded about 8 px on screen)
  const accent = recipe.real ? { kind: "real" } : {};
  const keep = [];
  const firing = move.accent?.at ?? null;
  const accentEnd = move.kwOut + 0.3;
  if (recipe.kind) accent.kind = recipe.kind;
  if (recipe.pulses) accent.pulses = recipe.pulses;
  if (recipe.accent && firing !== null) {
    const shot = shotAt(firing);
    const box = boxOf(segment, recipe.accentBox ?? shot.box, recipe.accent);
    if (box) {
      accent.box = toWindow(shot, box, 8 / shot.k);
      keep.push({ shot, box: accent.box, from: firing, to: recipe.steps ? firing + 0.6 : accentEnd });
    } else report.push(`${slot.id}: accent ${recipe.accent.join("|")} not recorded; placeholder box kept`);
  }
  if (recipe.accentRect && firing !== null) {
    const shot = shotAt(firing);
    const base = labelOf(segment, shot.box).items[shot.ids[0]];
    if (base) {
      const [dx, dy, w, h] = recipe.accentRect;
      accent.box = toWindow(shot, [base[0] + dx, base[1] + dy, w, h]);
      keep.push({ shot, box: accent.box, from: firing, to: accentEnd });
    }
  }
  if (recipe.steps) {
    // the box leaves this long after its last step (before a following shot replaces the list)
    accent.stepHold = recipe.stepHold ?? 1.2;
    accent.steps = recipe.steps
      .map((step) => {
        const shot = shotAt(step.at);
        const box = boxOf(segment, shot.box, step.ids);
        if (!box) return null;
        // a row wider than its shot is boxed where the shot shows it (inside the window)
        const raw = toWindow(shot, box, 8 / shot.k);
        const x0 = Math.max(4, raw[0]);
        const y0 = Math.max(4, raw[1]);
        const inWindow = [
          x0,
          y0,
          Math.min(geo.w - 4, raw[0] + raw[2]) - x0,
          Math.min(geo.h - 4, raw[1] + raw[3]) - y0,
        ].map(r);
        keep.push({ shot, box: inWindow, from: step.at, to: step.at + (recipe.stepHold ?? 1.2) + 0.1 });
        return { at: r3(step.at), box: inWindow };
      })
      .filter(Boolean);
  }
  if (recipe.traceChips) {
    // the expanded breakdown's four slip chips (one container, two by two: 0403 0419 / 0436 0467)
    const shot = shotAt(firing ?? vis0);
    const box = boxOf(segment, recipe.accentBox ?? shot.box, [recipe.traceChips]);
    if (box) {
      const gap = 6;
      const [x, y, w, h] = box;
      const cw = (w - gap) / 2;
      const ch = (h - gap) / 2;
      accent.chips = [
        [x, y, cw, ch],
        [x + cw + gap, y, cw, ch],
        [x, y + ch + gap, cw, ch],
        [x + cw + gap, y + ch + gap, cw, ch],
      ].map((c) => toWindow(shot, c));
    } else report.push(`${slot.id}: the slip chips were not recorded; the trace ends on her pay`);
    if (accent.box) keep.push({ shot, box: accent.box, from: move.accent.landed ?? firing, to: accentEnd });
  } // the payouts confirm in full jade: the fan's lines and nodes keep their colour once the first confirms
  if (recipe.real && badge) {
    const shot = shotAt(badge.from);
    const fan = boxOf(segment, shot.box, ["W-TR-08.fan"]);
    if (fan) keep.push({ shot, box: toWindow(shot, fan), from: badge.from - 0.1, to: move.glideOut[1] + 1 });
  }
  // a kept-in-colour area of the window itself (the pink carbon copy in twice.)
  for (const kept of recipe.keepWindow ?? [])
    keep.push({ shot: shots[0], box: kept, from: vis0, to: move.glideOut[1] + 1 });
  let chip = null;
  if (recipe.chip) {
    const shot = shotAt(slot.start + recipe.chip.from);
    const beside = boxOf(segment, shot.box, [recipe.chip.beside]);
    if (beside) {
      const b = toWindow(shot, beside);
      chip = {
        text: recipe.chip.text,
        box: [b[0] + b[2] + 18, b[1] + b[3] / 2 - 26, 0],
        from: recipe.chip.from,
      };
    } else report.push(`${slot.id}: no ${recipe.chip.beside} for its micro-tag`);
  }

  // one frame list per shot (a shot may replay another moment), each graded quiet, kept in colour inside its keep
  // boxes while they fire, then dissolved into one clip
  const s = frameWidth(join(takeDir, "frames", segment.frames[0].file)) / view.width;
  const frames = segment.frames.map((f) => ({ file: f.file, t: f.ts > 1e12 ? f.ts : f.at }));
  const inputs = [];
  const graph = [];
  shots.forEach((shot, i) => {
    const list = ["ffconcat version 1.0"];
    let j = 0;
    let last = null;
    let run = 0;
    const flush = () => {
      if (last)
        list.push(
          `file '${join(takeDir, "frames", last).replaceAll("\\", "/")}'`,
          `duration ${(run / FPS).toFixed(6)}`,
        );
    };
    for (let n = 0; n < count; n++) {
      const t = shot.src(vis0 + n / FPS);
      while (j + 1 < frames.length && frames[j + 1].t <= t) j++;
      while (j > 0 && frames[j].t > t) j--;
      const pick = frames[j].file;
      if (pick === last) run++;
      else {
        flush();
        last = pick;
        run = 1;
      }
    }
    flush();
    list.push(`file '${join(takeDir, "frames", last).replaceAll("\\", "/")}'`);
    const listFile = join(out, `${slot.id}.${i}.ffconcat`);
    writeFileSync(listFile, `${list.join("\n")}\n`);
    inputs.push("-f", "concat", "-safe", "0", "-i", listFile);
    const [cx, cy, cw, ch] = shot.crop.map((v) => v * s);
    const levels = shot.levels ?? recipe.levels;
    const mine = keep.filter((kept) => kept.shot === shot);
    const head = `[${i}:v]crop=${cw.toFixed(2)}:${ch.toFixed(2)}:${cx.toFixed(2)}:${cy.toFixed(2)},scale=${ow}:${oh}:flags=lanczos,fps=${FPS}${levels ? `,${levels}` : ""},format=yuv420p`;
    if (!mine.length) graph.push(`${head},eq=saturation=${QUIET}[s${i}]`);
    else {
      const u = ow / geo.w;
      graph.push(`${head},split=${mine.length + 1}[g${i}]${mine.map((_, k) => `[k${i}_${k}]`).join("")}`);
      graph.push(`[g${i}]eq=saturation=${QUIET}[q${i}_0]`);
      mine.forEach((kept, k) => {
        const [bx, by, bw, bh] = kept.box.map((v) => v * u);
        const x0 = Math.max(0, Math.round(bx));
        const y0 = Math.max(0, Math.round(by));
        const w = Math.max(2, Math.min(ow - x0, Math.round(bw + bx - x0)));
        const h = Math.max(2, Math.min(oh - y0, Math.round(bh + by - y0)));
        const t0 = Math.max(0, kept.from - vis0).toFixed(3);
        const t1 = Math.max(0, kept.to - vis0).toFixed(3);
        graph.push(
          `[k${i}_${k}]crop=${w}:${h}:${x0}:${y0}[c${i}_${k}]`,
          `[q${i}_${k}][c${i}_${k}]overlay=${x0}:${y0}:enable='between(t,${t0},${t1})'${k === mine.length - 1 ? `[s${i}]` : `[q${i}_${k + 1}]`}`,
        );
      });
    }
  });
  let lastLabel = "s0";
  shots.slice(1).forEach((shot, n) => {
    const i = n + 1;
    const offset = Math.max(0.05, shot.from - vis0 - DISSOLVE / 2).toFixed(3);
    graph.push(
      `[s${i}]trim=start=${offset},setpts=PTS-STARTPTS[t${i}]`,
      `[${lastLabel}][t${i}]xfade=transition=fade:duration=${DISSOLVE}:offset=${offset}[x${i}]`,
    );
    lastLabel = `x${i}`;
  });
  const file = join(out, `${slot.id}.mp4`);
  ff([
    ...inputs,
    "-filter_complex",
    graph.join(";"),
    "-map",
    `[${lastLabel}]`,
    "-frames:v",
    String(count),
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "16",
    "-g",
    "15",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    file,
  ]);
  for (const i of shots.keys()) rmSync(join(out, `${slot.id}.${i}.ffconcat`), { force: true });
  if (sheets)
    ff([
      "-i",
      file,
      "-vf",
      `fps=${(8 / seconds).toFixed(4)},scale=${kind === "phone" ? 220 : 480}:-1,tile=8x1`,
      "-frames:v",
      "1",
      join(out, `sheet-${slot.id}.png`),
    ]);
  const segmentLength = (segment.endedAt - segment.startedAt) / 1000;
  const span = shots.map((shot) => [
    (shot.src(Math.max(vis0, shot.from - DISSOLVE)) - segment.startedAt) / 1000,
    (shot.src(move.glideOut[1]) - segment.startedAt) / 1000,
  ]);
  for (const [a, b] of span)
    if (a < -0.05 || b > segmentLength + 0.05)
      report.push(
        `${slot.id}: a shot reads ${a.toFixed(2)}–${b.toFixed(2)} s of segment ${recipe.seg} (0–${segmentLength.toFixed(2)} s); the edge frame holds`,
      );
  slots[slot.id] = {
    seconds: r3(count / FPS),
    segment: recipe.seg,
    mark: recipe.mark,
    at: recipe.at,
    clip: [r3(span[0][0]), r3(span[0][1])],
    shots: shots.map((shot) => ({ from: r3(shot.from), crop: shot.crop })),
    window: kind,
    accent,
    badge,
    chip,
  };
  report.push(
    `${slot.id}: ${(count / FPS).toFixed(2)} s, ${shots.length} shot(s): ${shots.map((shot) => `${shot.crop.map(r).join("×")}@${r3(shot.from)}`).join(" | ")}${accent.box ? `, accent ${accent.box.join(",")}` : ""}${badge ? `, ${badge.text}` : ""}`,
  );
}
writeFileSync(
  join(out, "take.json"),
  `${JSON.stringify({ recordedAt: take.recordedAt, takeDir: takeDir.replaceAll("\\", "/"), quiet: QUIET, slots }, null, 1)}\n`,
);
process.stdout.write(`${report.join("\n")}\n`);
