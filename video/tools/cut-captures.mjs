// Cuts every capture slot's clip out of the recorded film take (e2e/film/slots.spec.ts, `FILM_TAKE=slots corepack pnpm
// e2e:film`) into video/captures/<slot>.mp4, and writes video/captures/take.json beside them: each clip's crop, its
// length and where its accent sits on it (plan.mjs reads that geometry, so the film's indigo box, button pulse, jade
// hit, the seven fills and the trace land on the recorded element).
//
// A clip covers its window's whole time on screen (plan.mjs clipSpan: media 0 = the start of its glide in). Its time
// comes from one action mark in the take: `at` is the film second that mark lands on (the press on its narration word,
// the accent's beat), so every product event keeps its real speed and lands where the sound already is. Its crop is
// the union of recorded element boxes (test ids), padded, grown to the window's aspect and kept inside the viewport;
// nothing is a fixed pixel, so a re-capture of a changed UI re-frames itself. Clips are quiet (STYLE §3): the product
// at reduced saturation, so the film's one accent is the only lit thing in the window.
//
//   node video/tools/cut-captures.mjs [take dir] [--only id,id] [--sheet]
//
// The take dir defaults to e2e/film-out/slots. `--sheet` also writes captures/sheet-<slot>.png contact sheets.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPTURE_RUN, WINDOWS, windowKind } from "../plan.mjs";
import { CAPTURES } from "../script.ts";

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
/** Quiet variant (STYLE §3): the product at this saturation, the film's accent the one lit thing. */
const QUIET = 0.5;

/**
 * One recipe per slot. `seg` the take's segment, `mark` its action and `at` the film second that action lands on (the
 * accent's beat, or the narration word it shows); `crop` the test ids whose union (at the segment's `box` label) the
 * window frames, `slice` [dy, h] an optional band of that union, `pad` CSS px round it; `accent` the ids (union) the
 * slot's accent sits on, `items` a test-id prefix for the fan-out's seven nodes, `real` when the product's own motion
 * carries the accent and the film draws none. Ids inside a phone frame read `<frame test id>><id>`.
 */
const PHONE_MEMBER = "W-JG-01.frame.member";
const PHONE_CHAIR = "W-JG-01.frame.chair";
const DRAWER = ["W-TR-06.drawer"];
const FAN = ["W-TR-08.fan"];
const APPROVE = ["W-TR-07.seal", "W-TR-07.amount", "W-TR-07.keys", "W-TR-07.rail"];
export const RECIPES = {
  "hl-matrix": {
    seg: "h1",
    mark: "countOnce",
    at: 45.0,
    box: "ready",
    crop: ["W-TR-05.dial", "W-TR-05.reading", "W-TR-05.pools", "W-TR-05.dup.M-007"],
    pad: 24,
  },
  "hl-ratecard": { seg: "rate", mark: "refused", at: 46.0, box: "plate", crop: ["W-TR-02.refusal"], pad: 40 },
  // both keys signed on the console, then the fan-out opens hollow and its first item confirms
  "hl-keys": { seg: "keys", mark: "count:1/8", at: 50.8, box: "fanout", crop: FAN, pad: 24 },
  "hl-proof": {
    seg: "proof",
    mark: "verdict",
    at: 50.2,
    box: "verified",
    crop: ["W-PF-01.seal", "W-PF-01.verdict.count", "W-PF-01.verdict.sample", "W-PF-01.verify"],
    pad: 30,
  },
  // the tap as the window glides in; the product opens the trace about 1.4 s later, as the window lands
  "hl-member": { seg: "member", mark: "tap", at: 51.9, box: "traced", crop: [PHONE_MEMBER], pad: 0 },
  "hl-break": {
    seg: "break",
    mark: "tamper",
    at: 55.15,
    box: "denied",
    crop: ["W-JG-01.tryToBreak"],
    pad: 24,
  },
  // the photo of four synthetic slips over the filmstrip A-L
  "paper-photos": { seg: "reading", mark: "start", at: 57.0, box: "done", crop: ["W-TR-03.film"], pad: 24 },
  "paper-carbon": {
    seg: "h1",
    mark: "start",
    at: 60.0,
    box: "ready",
    crop: DRAWER,
    slice: [314, 355],
    pad: 0,
  },
  "funding-console": {
    seg: "funding",
    mark: "funded",
    at: 66.1,
    box: "funded",
    crop: ["W-JG-01.invoice"],
    pad: 16,
    // the invoice card's own "Funded" line lights jade as the pool funds
    accent: ["W-JG-01.status"],
  },
  "reading-console": {
    seg: "heroes",
    mark: "start",
    at: 72.0,
    box: "heroes",
    // slip 0403's tile (never 0449's): its two captions and its comparison row, with the image above them
    crop: ["W-TR-03.hero.spike-0403"],
    slice: [330, 250],
    pad: 0,
    // Claude's two reads, "38.45 / 38.45" (no test id of its own: placed on the tile)
    accentRect: [-4, 504, 104, 30],
  },
  "reading-byhand": {
    seg: "byhand",
    mark: "useLogbook",
    // on "Analyn types", so the committed 64.80 and "Entered by Analyn" show before the window leaves (84)
    at: 79.3,
    box: "empty",
    crop: ["W-TR-04.entry"],
    pad: 24,
    accent: ["W-TR-04.input"],
  },
  "count-console": {
    seg: "h1",
    mark: "countOnce",
    at: 84.1,
    box: "ready",
    crop: DRAWER,
    slice: [40, 330],
    pad: 0,
    accent: ["W-TR-06.countOnce.face"],
  },
  "holds-console": {
    seg: "h3",
    mark: "returnCredit",
    at: 92.6,
    box: "returned",
    crop: DRAWER,
    slice: [40, 330],
    pad: 0,
  },
  "rules-console": {
    seg: "rate",
    mark: "refused",
    at: 97.3,
    box: "refused",
    crop: ["W-TR-02.bolted", "W-TR-02.add"],
    pad: 20,
  },
  "signing-console": {
    seg: "key1",
    mark: "key1.up",
    at: 103.3,
    box: "ready",
    crop: [...APPROVE, "W-TR-07.approve"],
    pad: 24,
    accent: ["W-TR-07.approve.face"],
  },
  "signing-phone": {
    seg: "keys",
    mark: "key2.up",
    at: 107.3,
    box: "chair",
    crop: [PHONE_CHAIR],
    pad: 0,
    accent: [`${PHONE_CHAIR}>M-BD-02.slab`],
  },
  "signing-approved": { seg: "keys", mark: "signed", at: 109.2, box: "approved", crop: APPROVE, pad: 30 },
  // "accepts the batch" over the console's Batch accepted, the fan-out opening hollow after "not yet paid", and its
  // first item confirming on "Seven": the product's own nodes fill at real speed (the film draws no fills over them)
  "payouts-console": {
    seg: "keys",
    mark: "count:1/8",
    at: 116.0,
    box: "fanout",
    crop: FAN,
    pad: 24,
    real: true,
  },
  "payouts-cash": {
    seg: "cash",
    mark: "payCash",
    at: 119.0,
    box: "parked",
    crop: ["W-TR-08.fan", "W-TR-08.payCash"],
    pad: 24,
  },
  "proof-browser": {
    seg: "proof",
    mark: "verify",
    at: 121.3,
    box: "verified",
    crop: ["W-PF-01.verdict"],
    pad: 20,
    accent: ["W-PF-01.verdict.count", "W-PF-01.verdict.result"],
  },
  "member-phone": {
    seg: "member",
    mark: "tap",
    // the product opens the trace about 1.4 s after the tap (130.0), before the film's threads reach her pay
    at: 128.6,
    box: "statement",
    crop: [PHONE_MEMBER],
    pad: 0,
    // the trace lands where her net pay sits once the tap has opened it (the phone scrolls it to the top)
    accentBox: "traced",
    accent: [`${PHONE_MEMBER}>M-MB-01.receipt.net.amount`],
  },
  "listening-phone": {
    seg: "listening",
    mark: "play",
    at: 134.2,
    box: "playing",
    crop: [PHONE_MEMBER],
    pad: 0,
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

/** The union of the named boxes at a box label (ids that are missing are reported), optionally a band of it. */
function boxOf(segment, label, ids, slice = null, missing = []) {
  const at = segment.boxes.find((b) => b.label === label) ?? segment.boxes.at(-1);
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
/** Padded, grown to the window's aspect round its centre, kept inside the viewport (shrunk only if it must be). */
function cropFor(rect, pad, aspect) {
  let [x, y, w, h] = [rect[0] - pad, rect[1] - pad, rect[2] + 2 * pad, rect[3] + 2 * pad];
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  if (w > view.width) [w, h] = [view.width, view.width / aspect];
  if (h > view.height) [w, h] = [view.height * aspect, view.height];
  x = Math.min(Math.max(0, cx - w / 2), view.width - w);
  // below the console's top bar (y 10-66) when the frame has the room
  y = Math.min(Math.max(TOP, cy - h / 2), view.height - h);
  if (y < 0) y = 0;
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
  });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
};

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
  const segment = take.segments.find((s) => s.name === recipe.seg);
  if (!segment) throw new Error(`${slot.id}: the take has no segment ${recipe.seg}`);
  const anchor =
    recipe.mark === "start" ? segment.startedAt : segment.marks.find((m) => m.name === recipe.mark)?.at;
  if (anchor === undefined) throw new Error(`${slot.id}: segment ${recipe.seg} has no mark ${recipe.mark}`);
  // the clip: media 0 at the glide in's start, the anchor on its film second
  const seconds = Math.round((move.glideOut[1] - move.glideIn[0]) * 1000) / 1000 + 0.1;
  const from = anchor - (recipe.at - move.glideIn[0]) * 1000;
  const missing = [];
  const rect = boxOf(segment, recipe.box, recipe.crop, recipe.slice, missing);
  if (!rect) throw new Error(`${slot.id}: none of ${recipe.crop.join(", ")} at ${recipe.seg}/${recipe.box}`);
  if (missing.length) report.push(`${slot.id}: crop ids not recorded: ${missing.join(", ")}`);
  const crop = cropFor(rect, recipe.pad, geo.w / geo.h);
  const k = geo.w / crop[2];
  const toWindow = (r) =>
    [(r[0] - crop[0]) * k, (r[1] - crop[1]) * k, r[2] * k, r[3] * k].map((v) => Math.round(v));
  const accent = recipe.real ? { kind: "real" } : {};
  if (recipe.accent) {
    const box = boxOf(segment, recipe.accentBox ?? recipe.box, recipe.accent);
    if (box) accent.box = toWindow(box);
    else report.push(`${slot.id}: accent ${recipe.accent.join("|")} not recorded; placeholder box kept`);
  }
  if (recipe.accentRect) {
    const at = segment.boxes.find((b) => b.label === recipe.box) ?? segment.boxes.at(-1);
    const base = at.items[recipe.crop[0]];
    const [dx, dy, w, h] = recipe.accentRect;
    if (base) accent.box = toWindow([base[0] + dx, base[1] + dy, w, h]);
  }
  if (recipe.items) {
    const at = segment.boxes.find((b) => b.label === recipe.box) ?? segment.boxes.at(-1);
    const items = Object.entries(at.items)
      .filter(([id]) => id.startsWith(recipe.items))
      .map(([, r]) => toWindow(r))
      .slice(0, 7);
    if (items.length) {
      const x0 = Math.min(...items.map((r) => r[0])) - 12;
      const y0 = Math.min(...items.map((r) => r[1])) - 12;
      const x1 = Math.max(...items.map((r) => r[0] + r[2])) + 12;
      const y1 = Math.max(...items.map((r) => r[1] + r[3])) + 12;
      accent.box = [x0, y0, x1 - x0, y1 - y0];
      accent.items = items;
    } else report.push(`${slot.id}: no ${recipe.items}* nodes recorded; placeholder fills kept`);
  }
  // frames on a 30 fps grid: each output frame shows the newest recorded frame at or before its time (the screencast
  // only sends a frame when the page changes); before the first frame, the first one
  const frames = segment.frames.map((f) => ({ file: f.file, t: f.ts > 1e12 ? f.ts : f.at }));
  const count = Math.ceil(seconds * FPS);
  const list = ["ffconcat version 1.0"];
  let j = 0;
  let last = null;
  let run = 0;
  const flush = () => {
    if (!last) return;
    list.push(
      `file '${join(takeDir, "frames", last).replaceAll("\\", "/")}'`,
      `duration ${(run / FPS).toFixed(6)}`,
    );
  };
  for (let i = 0; i < count; i++) {
    const t = from + (i * 1000) / FPS;
    while (j + 1 < frames.length && frames[j + 1].t <= t) j++;
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
  const listFile = join(out, `${slot.id}.ffconcat`);
  writeFileSync(listFile, `${list.join("\n")}\n`);
  const [ow, oh] = OUTPUT[kind];
  // the screencast's frames are the viewport's CSS size (Chromium caps them there whatever the device scale)
  const s = frameWidth(join(takeDir, "frames", segment.frames[0].file)) / view.width;
  const [cx, cy, cw, ch] = crop.map((v) => v * s);
  const file = join(out, `${slot.id}.mp4`);
  ff([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-vf",
    `crop=${cw.toFixed(2)}:${ch.toFixed(2)}:${cx.toFixed(2)}:${cy.toFixed(2)},scale=${ow}:${oh}:flags=lanczos,eq=saturation=${QUIET},fps=${FPS},format=yuv420p`,
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
    "-movflags",
    "+faststart",
    "-an",
    file,
  ]);
  rmSync(listFile, { force: true });
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
  const fromSegment = (from - segment.startedAt) / 1000;
  const toSegment = fromSegment + seconds;
  const segmentLength = (segment.endedAt - segment.startedAt) / 1000;
  if (fromSegment < -0.05 || toSegment > segmentLength + 0.05)
    report.push(
      `${slot.id}: clip ${fromSegment.toFixed(2)}–${toSegment.toFixed(2)} s runs outside segment ${recipe.seg} (0–${segmentLength.toFixed(2)} s); the edge frame holds`,
    );
  slots[slot.id] = {
    seconds: Math.round((count / FPS) * 1000) / 1000,
    segment: recipe.seg,
    mark: recipe.mark,
    at: recipe.at,
    clip: [Math.round(fromSegment * 1000) / 1000, Math.round(toSegment * 1000) / 1000],
    crop,
    window: kind,
    accent,
  };
  report.push(
    `${slot.id}: ${(count / FPS).toFixed(2)} s from ${recipe.seg} ${fromSegment.toFixed(2)} s, crop ${crop.map((v) => Math.round(v)).join("×")} (${recipe.crop.join("+")})${accent.box ? `, accent ${accent.box.join(",")}` : ""}`,
  );
}
writeFileSync(
  join(out, "take.json"),
  `${JSON.stringify({ recordedAt: take.recordedAt, takeDir: takeDir.replaceAll("\\", "/"), quiet: QUIET, slots }, null, 1)}\n`,
);
process.stdout.write(`${report.join("\n")}\n`);
