// Verifies the built film against script.ts and the plan (plan.mjs): timing, the parts in place, one window, one
// keyword and the right honesty tag per capture slot, and the closed captions word for word with the script.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BRACKETS,
  CAPTION,
  CLOSE_START,
  eventTime,
  KEYWORDS,
  MEMBER_CLIP,
  openingFromPrototype,
  REAL_READING_TAG,
  SEAMS,
  SEGMENTS,
  SIM,
  simSpan,
  slotTag,
  WINDOWS,
  windowKind,
} from "./plan.mjs";
import {
  ARCHITECTURE,
  BUMPER_SECONDS,
  beats,
  CHAPTERS,
  FILM,
  PARTS,
  REAL_READING_CAPTION,
} from "./script.ts";

const root = fileURLToPath(new URL("./", import.meta.url));
const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const round = (value) => Number(value.toFixed(6));
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) < tolerance;
const spoken = (say) => say.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
/**
 * When `phrase` is said in `beat`: the recorded voice's word start (F4), else word-proportional across its speech
 * window; the captions are timed the same way.
 */
function said(beat, phrase) {
  const words = spoken(beat.say);
  const want = phrase.toLowerCase().split(/\s+/);
  const index = words.findIndex((_, i) =>
    want.every((w, k) => (words[i + k] ?? "").toLowerCase().replace(/^\W+/, "").startsWith(w)),
  );
  assert(index >= 0, `${beat.id}: "${phrase}" is not spoken`);
  if (beat.words) return beat.words[index].start;
  const [from, to] = beat.speech ?? [beat.start, beat.end];
  return from + ((to - from) * index) / words.length;
}
const esc = (text) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const visible = (html) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\s+/g, " ");
const slots = JSON.parse(read("captures.json"));
const index = read("index.html");

// ------------------------------------------------------------------------------------- film and script data
const rootTag = index.match(/<div id="root"[^>]+>/)?.[0];
const duration = Number(rootTag?.match(/data-duration="([^"]+)"/)?.[1]);
assert(duration <= 175, "Film exceeds 2:55");
assert.equal(duration, FILM.duration, "Root duration differs from script");
for (const attr of ['data-width="1920"', 'data-height="1080"', 'data-fps="30"', 'data-composition-id="main"'])
  assert(rootTag.includes(attr), `Film root lacks ${attr}`);
assert.equal(new Set(slots.map((slot) => slot.id)).size, slots.length, "Duplicate slot IDs");
// The owner's order: the overview first (problem, solution, architecture, highlights), then the deep dive, then
// limits; parts tile the film and every beat sits inside its own part.
assert.equal(PARTS[0].start, 0, "Parts must start at 0");
assert.equal(PARTS.at(-1).end, FILM.duration, "Parts must end with the film");
for (const [i, part] of PARTS.entries()) if (i) assert.equal(part.start, PARTS[i - 1].end, `${part.id}: gap`);
assert.deepEqual(
  beats.filter((beat) => beat.part === "overview").map((beat) => beat.id),
  ["problem", "solution", "architecture", "highlights"],
  "The overview must open with the problem, then the solution, the architecture and the highlights",
);
for (const [i, beat] of beats.entries()) {
  assert.equal(beat.start, i ? beats[i - 1].end : 0, `${beat.id}: beats must be contiguous`);
  const part = PARTS.find((item) => item.id === beat.part);
  assert(part && beat.start >= part.start && beat.end <= part.end, `${beat.id}: outside its part`);
  // Pace in the speech window itself, not only across the beat (E-19 measures the beat).
  const [from, to] = beat.speech ?? [beat.start, beat.end];
  assert(from >= beat.start && to <= beat.end && to > from, `${beat.id}: speech outside its beat`);
  assert((spoken(beat.say).length / (to - from)) * 60 <= 140, `${beat.id}: narration over 140 wpm`);
}
assert.equal(beats.at(-1).end, FILM.duration, "Beats must end with the film");
// The animated architecture adds every box and arrow exactly once, in time order, inside its beat, then holds.
const architectureBeat = beats.find((beat) => beat.card?.kind === "architecture");
assert(architectureBeat, "No architecture beat");
assert.deepEqual(
  ARCHITECTURE.reveal.flatMap((step) => [...step.boxes, ...step.arrows.map((a) => a.join(":"))]).sort(),
  [...ARCHITECTURE.boxes.map((box) => box.id), ...ARCHITECTURE.arrows.map((a) => a.join(":"))].sort(),
  "Architecture reveal must add every box and arrow exactly once",
);
assert.equal(ARCHITECTURE.reveal[0].at, architectureBeat.start, "Architecture must start drawn at its beat");
for (const [i, step] of ARCHITECTURE.reveal.entries()) {
  if (i) assert(step.at > ARCHITECTURE.reveal[i - 1].at, "Architecture steps out of order");
  assert(step.at < architectureBeat.end, "Architecture step after its beat");
  const shown = new Set(ARCHITECTURE.reveal.slice(0, i + 1).flatMap((s) => s.boxes));
  for (const [from, to] of step.arrows)
    assert(shown.has(from) && shown.has(to), `Architecture arrow ${from}:${to} before its boxes`);
}
assert(
  architectureBeat.end - ARCHITECTURE.reveal.at(-1).at >= 3,
  "Architecture: the full diagram holds under 3 s",
);
// Every highlight clip names its feature; every clip after the reel's first cuts in on its word.
const reel = slots.filter((slot) => slot.beat === "highlights");
assert(
  reel.length >= 6 && reel.every((slot) => slot.label && slot.word),
  "Reel clips need a label and a word",
);
for (const slot of reel) assert(spoken(slot.label).length <= 5, `${slot.id}: label over 5 words`);
// Card beats carry no slots; every other beat is covered end to end, each word cut within 0.3 s of its word.
for (const beat of beats) {
  const ranges = slots.filter((slot) => slot.beat === beat.id).sort((a, b) => a.start - b.start);
  if (beat.card) {
    assert.equal(ranges.length, 0, `${beat.id}: a card beat carries no capture slots`);
    continue;
  }
  assert(ranges.length, `${beat.id}: no capture slots`);
  let end = beat.start;
  for (const [i, slot] of ranges.entries()) {
    assert(near(slot.start, end), `${beat.id}: capture gap/overlap at ${slot.id}`);
    end += slot.duration;
    if (!slot.word) continue;
    const t = said(beat, slot.word);
    const lead = i === 0 ? 1.5 : 0.3;
    assert(
      slot.start <= t + 0.3 && slot.start >= t - lead,
      `${slot.id}: starts at ${slot.start}, but "${slot.word}" is said at ${t.toFixed(2)}`,
    );
  }
  assert(near(end, beat.end), `${beat.id}: incomplete capture coverage`);
}
// R1's real-reading caption belongs only to the exhibit clip: never on a beat, never over the run's own rows.
for (const beat of beats)
  assert(!beat.show.includes(REAL_READING_CAPTION), `${beat.id}: real-reading caption on a beat`);
for (const slot of slots) {
  const real = slot.overlay.includes(REAL_READING_CAPTION);
  assert(
    !real || slot.state.startsWith("Hero-slip exhibit"),
    `${slot.id}: real-reading caption off the exhibit`,
  );
  assert(
    !(real && slot.overlay.some((text) => /stand-in/i.test(text))),
    `${slot.id}: stand-in over the exhibit`,
  );
}
// Chapters start on beats, and chapters.txt is exactly the script's.
for (const chapter of CHAPTERS)
  assert(
    beats.some((beat) => beat.start === chapter.start),
    `Chapter "${chapter.title}" is not on a beat`,
  );
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
assert.equal(
  read("chapters.txt"),
  `${CHAPTERS.map((chapter) => `${mmss(chapter.start)} ${chapter.title}`).join("\n")}\n`,
  "chapters.txt differs from CHAPTERS",
);
// Every reference screenshot exists, when research/design-1104 is next to this checkout (it is outside the repo).
const design = [1, 2, 3]
  .map((up) => new URL(`${"../".repeat(up + 1)}research/design-1104/`, import.meta.url))
  .find((dir) => existsSync(dir));
if (design)
  for (const slot of slots.filter((item) => item.reference))
    assert(
      existsSync(new URL(slot.reference.replace(/^research\/design-1104\//, ""), design)),
      `${slot.id}: ${slot.reference} does not exist`,
    );

// ------------------------------------------------------------------------------ the film's compositions
// Segments tile the film on track 0, each covering whole beats in script order, each as long as its own root says.
let cursor = 0;
const covered = [];
for (const segment of SEGMENTS) {
  assert(near(segment.start, cursor), `${segment.id}: gap or overlap at ${segment.start}`);
  cursor = segment.end;
  covered.push(...segment.beats);
  const host = `<div id="segment-${segment.id}" class="clip" data-composition-id="${segment.id}" data-composition-src="${segment.src}" data-start="${segment.start}" data-duration="${round(segment.end - segment.start)}" data-track-index="0" data-width="1920" data-height="1080" data-beats="${segment.beats.join(" ")}"></div>`;
  assert(index.includes(host), `${segment.id}: host clip missing or mistimed`);
  assert(existsSync(new URL(segment.src, import.meta.url)), `${segment.id}: ${segment.src} missing`);
  const own = read(segment.src).match(/<div id="root"[^>]*>/)?.[0] ?? "";
  assert(own.includes(`data-composition-id="${segment.id}"`), `${segment.id}: composition id differs`);
  assert.equal(
    Number(own.match(/data-duration="([\d.]+)"/)?.[1]),
    round(segment.end - segment.start),
    `${segment.id}: its own length differs from its beats (adjust script v4 only if a part really changed)`,
  );
}
assert.equal(cursor, FILM.duration, "Segments must end with the film");
assert.deepEqual(
  covered,
  beats.map((beat) => beat.id),
  "Every beat sits in exactly one segment, in order",
);
assert.equal((index.match(/data-composition-src=/g) ?? []).length, SEGMENTS.length, "Stray compositions");
assert.deepEqual(
  readdirSync(new URL("compositions/", import.meta.url))
    .filter((name) => name.endsWith(".html"))
    .sort(),
  SEGMENTS.filter((segment) => segment.src.startsWith("compositions/"))
    .map((segment) => segment.src.slice("compositions/".length))
    .sort(),
  "Stale or missing generated compositions",
);
// Seams dip the picture to night before a night part, on top of track 0, inside the main timeline.
for (const seam of SEAMS) {
  const start = round(seam.end - seam.duration);
  assert(
    index.includes(
      `<div id="${seam.id}" class="clip seam" data-start="${start}" data-duration="${seam.duration}" data-track-index="2"></div>`,
    ) &&
      index.includes(
        `tl.fromTo("#${seam.id}", { opacity: 0 }, { opacity: 1, duration: ${seam.duration}, ease: "power1.in" }, ${start});`,
      ),
    `${seam.id}: missing or mistimed`,
  );
  assert(
    SEGMENTS.some((segment) => near(segment.start, seam.end)),
    `${seam.id}: not on a segment cut`,
  );
}
// One turn (STYLE §1): night only in the opening; every later part stays bright, and no plate dips between them.
assert.deepEqual(
  SEGMENTS.filter((segment) => segment.field.includes("night")).map((segment) => segment.id),
  ["opening"],
  "Only the opening may have night",
);
assert.equal(SEAMS.length, 0, "No dips between the parts (STYLE §5)");
assert(index.includes("window.__timelines.main = tl;"), "No main timeline");

// The opening is the prototype (problem 0-14, solution 14-30): regenerated byte for byte, kinetic words and tags.
const opening = read("compositions/opening.html");
assert.equal(
  opening,
  openingFromPrototype().html,
  "compositions/opening.html is stale: rebuild from the prototype",
);
const openingText = visible(opening);
for (const words of [
  "farmers.",
  "one shoebox of slips.",
  "one slip, twice.",
  "a fine, no rule.",
  "unseen.",
  "one invoice.",
  "traced.",
  "read.",
  "checked.",
  "paid.",
  "Every peso, traced.",
  "Synthetic co-op",
  SIM,
])
  assert(openingText.includes(words), `opening: "${words}" missing`);
// The opening ends on its end line and the trace, not on the name: the name shows once, on the end card.
assert(!openingText.includes("Fair Split"), "opening: the name card belongs to the end of the film");
for (const [, id] of opening.matchAll(/\sid="([^"]+)"/g))
  assert(id === "root" || id.startsWith("op-"), `opening: id "${id}" is not prefixed`);
// The architecture part, 30-44, built from script.ts and labelled.
const architecture = read("parts/architecture/compositions/architecture.html");
assert(visible(architecture).includes(SIM), "architecture: no sandbox tag");
assert(visible(architecture).includes("PayPal"), "architecture: PayPal is not named");
// the joints: the architecture and the close open under the veil the side before them ends on (STYLE §5)
assert(architecture.includes('<div id="arch-veil">'), "architecture: no veil to lift at 30 s");
assert(
  read("parts/close/compositions/impressive.html").includes('<div id="ci-veil">'),
  "impressive: no veil at 143 s",
);
assert(
  existsSync(new URL("parts/architecture/assets/fonts/FSSans-VF.woff2", import.meta.url)),
  "architecture: its font is missing (run the build)",
);
// The close part, 143-175, in daylight (one turn, STYLE §1): the figures and the handwritten weigh-slip, one limit
// at a time while it is said (a keyword and its one tag, STYLE §7), then the trace, the end line and the film's one
// name card, with the voices disclosed on the end card (decision register: captions, end card and description).
const impressive = visible(read("parts/close/compositions/impressive.html"));
for (const words of ["5,000+", "kill switches", "handwritten."])
  assert(impressive.includes(words), `impressive: "${words}" missing`);
assert(!impressive.includes(SIM), "impressive: no PayPal value shows, so no sandbox tag");
const limitsBeat = beats.find((beat) => beat.id === "limits");
const limits = visible(read("parts/close/compositions/limits.html"));
// four limits (review v4 item 3: "generated." merged into "synthetic."), one voice wording everywhere
const LIMIT_TAGS = [
  ["simulated.", SIM],
  ["synthetic.", "Synthetic people and slips"],
  ["replayed.", "Seed stand-in reading"],
  ["synthesized.", FILM.voiceDisclosure],
];
// every card item is said while its limit is on screen (the voices' two items share the last one)
assert.equal(
  new Set(limitsBeat.card.items.map((item) => item.at)).size,
  LIMIT_TAGS.length,
  "limits: one per item",
);
for (const [keyword, tag] of LIMIT_TAGS)
  assert(
    limits.includes(keyword) && limits.includes(tag),
    `limits: missing "${keyword}" or its tag "${tag}"`,
  );
const endCard = visible(read("parts/close/compositions/end.html"));
for (const text of [SIM, "Every peso, traced.", "Fair Split", "co-op payroll", "Gemini TTS"])
  assert(endCard.includes(text), `end: missing "${text}"`);
for (const part of [impressive, limits, endCard])
  assert(!/None we found|Your demo replays|Prior-art/.test(part), "close: a sentence is back on screen");

// Capture slots: one calm floating window each, one keyword each, and the one honesty tag where it belongs.
const sceneOf = new Map(
  SEGMENTS.filter((segment) => segment.slots).flatMap((segment) => segment.beats.map((id) => [id, segment])),
);
for (const slot of slots) {
  const beat = beats.find((item) => item.id === slot.beat);
  assert(
    beat && slot.start >= beat.start && slot.duration > 0 && slot.start + slot.duration <= beat.end + 1e-9,
    `${slot.id}: outside beat`,
  );
  assert(slot.file === `captures/${slot.id}.mp4`, `${slot.id}: unstable capture path`);
  assert.equal(slot.placeholder, `capture pending: ${slot.id}`);
  assert(["console film mode", "phone recording", "Proof in the browser"].includes(slot.source));
  assert(typeof slot.shows === "string" && slot.shows.length > 20, `${slot.id}: no on-screen state`);
  assert(slot.reference === null || /^research\/design-1104\/[\w.-]+\.png$/.test(slot.reference));
  assert([1, 12].includes(slot.playbackRate) && Number.isFinite(slot.mediaStart) && slot.mediaStart >= 0);
  assert(
    (slot.beat !== "signing" && !slot.state.startsWith("MM-5")) || slot.playbackRate === 1,
    "Do not accelerate human signing",
  );
  const segment = sceneOf.get(slot.beat);
  assert(segment, `${slot.id}: its beat has no capture-slot composition`);
  const scene = read(segment.src);
  const kind = windowKind(slot);
  const local = round(slot.start - beat.start);
  const open = `<div id="${slot.id}-window" class="pf-win pf-win--${kind}" data-slot="${slot.id}" data-slot-start="${local}" data-slot-duration="${slot.duration}"`;
  assert(scene.includes(open), `${slot.id}: window missing or mistimed`);
  const win = scene.slice(scene.indexOf(open), scene.indexOf("</div></div>", scene.indexOf(open)));
  const recorded = existsSync(`${root}/${slot.file}`);
  if (recorded)
    assert(
      win.includes(
        `src="${slot.file}" muted playsinline data-has-audio="false" data-start="${local}" data-duration="${slot.duration}" data-media-start="${slot.mediaStart}" data-playback-rate="${slot.playbackRate}"`,
      ),
      `${slot.id}: capture missing or mistimed`,
    );
  else
    assert(
      visible(win).includes("capture pending:") && win.includes(`>${esc(slot.id)}</p>`),
      `${slot.id}: no "capture pending: ${slot.id}" window`,
    );
  // One keyword: one word and a period.
  assert(/^[\p{L}-]+\.$/u.test(KEYWORDS[slot.id] ?? ""), `${slot.id}: keyword must be one word`);
  assert.equal(slot.keyword, KEYWORDS[slot.id], `${slot.id}: captures.json keyword differs`);
  assert(
    new RegExp(
      `<div id="${slot.id}-kw" class="pf-kw pf-kw--${kind}"[^>]*><span[^>]*>${esc(slot.keyword)}</span></div>`,
    ).test(scene),
    `${slot.id}: keyword missing`,
  );
  // The tag: the slot's own honesty label, or the sandbox wherever a PayPal value can show, or none.
  const tag = slotTag(slot);
  assert.equal(slot.tag, tag?.text ?? null, `${slot.id}: captures.json tag differs`);
  if (beat.show.includes(SIM))
    assert(tag?.kind === "sim", `${slot.id}: a PayPal beat without the sandbox tag`);
  if (tag?.kind === "honesty")
    assert(
      scene.includes(
        `<div id="${slot.id}-tag" class="pf-tag pf-tag--nodot" data-layout-allow-occlusion>${esc(tag.text)}</div>`,
      ),
      `${slot.id}: honesty tag missing`,
    );
  if (tag?.kind === "sim") {
    assert(
      scene.includes(`<div id="${segment.id}-tag-sim" class="pf-tag" data-layout-allow-occlusion>`) &&
        visible(scene).includes(SIM),
      `${slot.id}: sandbox tag missing`,
    );
    const span = simSpan(segment);
    assert(span && slot.start >= span.from - 1e-9 && slot.start + slot.duration <= span.to + 1e-9);
  }
}
// The sandbox tag's span in each scene is the plan's, so it runs on across cuts and never blinks.
for (const segment of SEGMENTS.filter((item) => item.slots)) {
  const scene = read(segment.src);
  const span = simSpan(segment);
  const config = JSON.parse(scene.match(/FairSplitSlots\.build\(tl, (\{.*\})\);/)?.[1] ?? "null");
  assert(config, `${segment.id}: no slot driver`);
  const start = segment.start;
  assert.deepEqual(
    config.sim,
    span
      ? {
          from: round(span.from - start),
          to: round(span.to - start),
          continuesIn: span.continuesIn,
          continuesOut: span.continuesOut,
        }
      : null,
    `${segment.id}: sandbox tag span differs`,
  );
  assert(scene.includes(`window.__timelines["${segment.id}"] = tl;`), `${segment.id}: timeline key differs`);
  // Only one tag in a frame: a scene's own honesty labels never share time with its sandbox tag.
  if (span)
    for (const slot of slots.filter((item) => segment.beats.includes(item.beat)))
      if (slotTag(slot)?.kind === "honesty")
        assert(
          slot.start + slot.duration <= span.from || slot.start >= span.to,
          `${slot.id}: two tags at once`,
        );
}
// R1's caption is shown only as the exhibit clip's tag; the stand-in label only over the run's own clip.
for (const segment of SEGMENTS) {
  const text = visible(read(segment.src));
  const real = text.split(REAL_READING_TAG).length - 1;
  assert.equal(real, segment.id === "reading" ? 1 : 0, `${segment.id}: real-reading caption count`);
}
// Windows stay clear of the tag corner (x > 1396 and y > 960) and of the 64 px edge, floating and pushed.
for (const [kind, geo] of Object.entries(WINDOWS))
  for (const phase of [geo.a, geo.b]) {
    const s = phase.s * 1.02 * 1.01;
    const [left, right] = [phase.x - (geo.w * s) / 2, phase.x + (geo.w * s) / 2];
    const [top, bottom] = [phase.y - (geo.h * s) / 2 - 6, phase.y + (geo.h * s) / 2 + 6];
    assert(left >= 64 && top >= 64 && right <= 1856 && bottom <= 1016, `${kind}: window near the frame edge`);
    assert(!(right > 1396 && bottom > 960), `${kind}: window enters the tag corner`);
  }
// The deep dive's bumper reads as one end line (at most four words) over the first frames of its first beat.
for (const part of PARTS) {
  if (!part.bumper) continue;
  const first = beats.find((beat) => beat.start === part.start);
  const scene = read(sceneOf.get(first.id).src);
  const words = `${part.bumper.split(":")[0]}.`.split(" ");
  assert(words.length <= 4, `${part.id}: bumper over four words`);
  assert(
    scene.includes(
      `<div id="${first.id}-bumper" class="pf-endline" data-bumper="${esc(part.bumper)}" data-layout-allow-overlap>${words.map((w) => `<span class="w">${esc(w)}</span>`).join("")}</div>`,
    ) && scene.includes(`"bumper":${BUMPER_SECONDS}`),
    `${part.id}: bumper missing`,
  );
}

// ------------------------------------------------------------------------------------------ closed captions
// No caption is burned into the picture (STYLE §8).
const pictures = [index, ...SEGMENTS.map((segment) => read(segment.src))];
for (const html of pictures)
  assert(!/data-track-kind="captions"|class="[^"]*\bcaption\b/.test(html), "A caption is burned in");
/** WEBVTT: header, an optional NOTE, then numbered cues. */
function parseVtt(text) {
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n\n+/);
  assert.equal(blocks[0], "WEBVTT", "VTT header");
  const toSeconds = (stamp) => {
    const [h, m, s] = stamp.split(":");
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
  };
  return blocks
    .slice(1)
    .filter((block) => !block.startsWith("NOTE"))
    .map((block, i) => {
      const [id, timing, ...lines] = block.split("\n");
      assert.equal(id, String(i + 1), "VTT cue numbering");
      const found = /^(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})$/.exec(timing);
      assert(found, `VTT cue ${id}: bad timing line`);
      return { start: toSeconds(found[1]), end: toSeconds(found[2]), lines };
    });
}
const cues = parseVtt(read("captions.vtt"));
const isBracket = (line) => /^\[[^\]]+\]$/.test(line);
let captionEnd = 0;
for (const cue of cues) {
  const where = `caption ${cue.start}s`;
  assert(cue.start >= captionEnd - 1e-9, `${where}: overlaps the cue before`);
  captionEnd = cue.end;
  const length = cue.end - cue.start;
  assert(
    length >= CAPTION.min - 1e-3 && length <= CAPTION.max + 1e-3,
    `${where}: ${length.toFixed(2)} s long`,
  );
  assert(cue.lines.length >= 1 && cue.lines.length <= CAPTION.lines, `${where}: more than two lines`);
  for (const line of cue.lines) assert(line.length <= CAPTION.line, `${where}: "${line}" over 42 characters`);
}
// Word for word: each beat's cues sit inside its speech window and spell exactly its `say`; nothing else is said.
const used = new Set();
for (const beat of beats.filter((item) => item.say)) {
  const [from, to] = beat.speech ?? [beat.start, beat.end];
  const own = cues.filter((cue) => cue.start >= from - 1e-3 && cue.end <= to + 1e-3);
  assert(own.length, `${beat.id}: no captions`);
  for (const cue of own) used.add(cue);
  // a bracket is a line of its own, or a whole cue whose lines read as one bracket (review v5: her language)
  const whole = (cue) => isBracket(cue.lines.join(" "));
  assert.equal(
    own
      .filter((cue) => !whole(cue))
      .flatMap((cue) => cue.lines)
      .filter((line) => !isBracket(line))
      .join(" "),
    beat.say,
    `${beat.id}: captions.vtt differs from script.ts`,
  );
  assert(
    near(own[0].start, from, 1e-3) && near(own.at(-1).end, to, 1e-3),
    `${beat.id}: captions off its window`,
  );
  const brackets = own.flatMap((cue) => (whole(cue) ? [cue.lines] : cue.lines.filter(isBracket)));
  assert.deepEqual(brackets, BRACKETS[beat.id] ? [BRACKETS[beat.id]] : [], `${beat.id}: bracketed cues`);
  if (beat.id === "listening")
    assert(
      own[0].lines.join(" ").includes(FILM.translationDisclosure.replace(/^Cebuano: /, "")),
      "listening: no machine-translation bracket",
    );
}
assert.equal(used.size, cues.length, "A caption sits outside every beat's speech");
// captions.json is the same track, and the close part's close.vtt is its slice from 143 s, shifted.
const json = JSON.parse(read("captions.json"));
assert.deepEqual(
  json.map((cue) => [cue.start, cue.end, cue.lines]),
  cues.map((cue) => [round(cue.start), round(cue.end), cue.lines]),
  "captions.json differs from captions.vtt",
);
const close = parseVtt(read("parts/close/close.vtt"));
assert.deepEqual(
  close.map((cue) => [round(cue.start), round(cue.end), cue.lines]),
  cues
    .filter((cue) => cue.start >= CLOSE_START)
    .map((cue) => [round(cue.start - CLOSE_START), round(cue.end - CLOSE_START), cue.lines]),
  "parts/close/close.vtt differs from the film's captions",
);
// The sound sheet marks every narration window, the member's sentence, the dark-to-bright swell and the credited bed.
const audio = read("AUDIO-CUES.md");
for (const text of ["dark to bright", "Member audio alone", "Machina", "Aurora", "Gemini TTS"])
  assert(audio.includes(text), `AUDIO-CUES.md lacks "${text}"`);
assert(!audio.includes("**misses**"), "AUDIO-CUES.md: a narration line misses its place in the picture");
for (const beat of beats.filter((item) => item.id !== "listening"))
  assert(new RegExp(`\\|\\s*${beat.id}\\s*\\|`).test(audio), `AUDIO-CUES.md lacks the ${beat.id} narration`);
// The recorded voice (F4): one clip per narrated beat, as the manifest says, reading its line word for word, every
// word timed inside the beat; the clips are at -16 LUFS with a true peak at or under -1.5 dBTP.
const voice = JSON.parse(read("audio/narration/manifest.json"));
for (const beat of beats.filter((item) => item.id !== "listening")) {
  const clip = voice.beats.find((item) => item.beat === beat.id);
  assert(clip, `${beat.id}: no narration clip`);
  assert.equal(clip.text, beat.say, `${beat.id}: the clip reads another line`);
  const file = new URL(`audio/narration/${clip.file}`, import.meta.url);
  assert(existsSync(file), `${beat.id}: ${clip.file} missing`);
  assert.equal(
    createHash("sha256").update(readFileSync(file)).digest("hex"),
    clip.sha256,
    `${clip.file}: sha256`,
  );
  assert(
    Math.abs(clip.loudness.lufs + 16) <= 0.5 && clip.loudness.truePeak <= -1.5,
    `${clip.file}: loudness`,
  );
  assert.equal(beat.words?.length, spoken(beat.say).length, `${beat.id}: word times`);
  for (const w of beat.words)
    assert(w.start >= beat.start && w.end <= beat.end, `${beat.id}: "${w.w}" outside the beat`);
}
// The sound effects: every cue resolves to a picture event, none plays on the member's own sentence, and each file
// is CC0 from the kit or one of Fair Split's own product sounds (never a Mixkit file).
const sfx = JSON.parse(read("sfx-cues.json"));
const her = [MEMBER_CLIP.start, MEMBER_CLIP.start + MEMBER_CLIP.seconds];
for (const cue of sfx.cues) {
  const t = eventTime(cue.event) + cue.offset;
  assert(t >= 0 && t < FILM.duration, `${cue.id}: outside the film`);
  assert(t + 1 < her[0] || t > her[1], `${cue.id}: on the member's sentence`);
  for (const name of Array.isArray(cue.sound) ? cue.sound : [cue.sound]) {
    const sound = sfx.sounds[name];
    assert(sound && existsSync(new URL(sound.file, import.meta.url)), `${cue.id}: ${name} missing`);
    assert(
      ["CC0 1.0", "MIT (this repo)"].includes(sound.licence) && !/mixkit/i.test(JSON.stringify(sound)),
      `${name}: licence`,
    );
  }
}
// Her statement's language, in one wording everywhere (review v5 item 3): on the Paminawa transcript, the statement's
// voice in the limits, the end card, the captions' bracket and the description.
for (const [where, text] of [
  ["end", endCard],
  ["limits", limits],
  ["listening", read("compositions/listening.html")],
])
  assert(text.includes(FILM.translationDisclosure), `${where}: no "${FILM.translationDisclosure}"`);
assert(
  FILM.endCard.includes(FILM.translationDisclosure) &&
    FILM.descriptionDisclosure.includes(FILM.translationDisclosure),
  "FILM: the machine-translation disclosure is missing from the end card or the description",
);
// The night shows the problem only; the duplicate is counted once in the day (review v5 item 1).
assert(!openingText.includes("count it once"), "opening: the night must not count the duplicate once"); // The music's credit (CC BY 4.0) is on the end card and in the credits for the upload's description.
assert(endCard.includes(FILM.musicCredit), "end: the music's credit is missing");
assert(FILM.endCard.includes(FILM.musicCredit), "FILM.endCard lacks the music's credit");
for (const line of [
  "'Machina' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
  "'Aurora' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
])
  assert(read("CREDITS.txt").includes(line) && read("LICENSES.md").includes(line), `credits lack ${line}`);

console.log(
  `Film check passed: ${beats.length} beats in ${PARTS.length} parts, ${SEGMENTS.length} compositions, ${cues.length} caption cues (closed captions), ${slots.length} capture slots, ${FILM.duration}s`,
);
