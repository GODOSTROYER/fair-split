import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
const near = (a, b) => Math.abs(a - b) < 1e-6;
/** When `phrase` is said in `beat`: word-proportional across its speech window, as the captions are timed. */
function said(beat, phrase) {
  const words = beat.say.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  const want = phrase.toLowerCase().split(/\s+/);
  const index = words.findIndex((_, i) =>
    want.every((w, k) => (words[i + k] ?? "").toLowerCase().replace(/^\W+/, "").startsWith(w)),
  );
  assert(index >= 0, `${beat.id}: "${phrase}" is not spoken`);
  const [from, to] = beat.speech ?? [beat.start, beat.end];
  return from + ((to - from) * index) / words.length;
}
const esc = (text) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const captions = JSON.parse(read("captions.json"));
const slots = JSON.parse(read("captures.json"));
const index = read("index.html");
const rootTag = index.match(/<div id="root"[^>]+>/)?.[0];
const duration = Number(rootTag?.match(/data-duration="([^"]+)"/)?.[1]);
assert(duration <= 175, "Film exceeds 2:55");
assert.equal(duration, FILM.duration, "Root duration differs from script");
assert(rootTag.includes('data-width="1920"') && rootTag.includes('data-height="1080"'));
assert.equal(new Set(slots.map((slot) => slot.id)).size, slots.length, "Duplicate slot IDs");
assert.equal((index.match(/data-composition-src=/g) ?? []).length, beats.length);
assert.equal((index.match(/data-track-kind="captions"/g) ?? []).length, captions.length);
assert.deepEqual(
  readdirSync(new URL("compositions/", import.meta.url))
    .filter((name) => name.endsWith(".html"))
    .sort(),
  beats.map((beat) => `${beat.id}.html`).sort(),
  "Stale or missing scene compositions",
);

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
}
assert.equal(beats.at(-1).end, FILM.duration, "Beats must end with the film");

// The animated architecture adds every box and arrow exactly once, in time order, inside its beat.
const architectureBeat = beats.find((beat) => beat.card?.kind === "architecture");
assert(architectureBeat, "No architecture beat");
const revealed = ARCHITECTURE.reveal.flatMap((step) => [
  ...step.boxes,
  ...step.arrows.map((a) => a.join(":")),
]);
assert.deepEqual(
  [...revealed].sort(),
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

for (const beat of beats) {
  assert(
    index.includes(
      `data-composition-id="${beat.id}" data-start="${beat.start}" data-duration="${beat.end - beat.start}"`,
    ),
    `${beat.id}: beat timing differs`,
  );
  assert.equal(
    captions
      .filter((cue) => cue.beat === beat.id)
      .map((cue) => cue.text)
      .join(" "),
    beat.say,
    `${beat.id}: captions differ from script`,
  );
  const scene = read(`compositions/${beat.id}.html`);
  assert(scene.includes(`data-composition-id="${beat.id}"`));
  assert(
    scene.includes('<div class="simulation">Simulated PayPal sandbox</div>'),
    `${beat.id}: no rail label`,
  );
  for (const text of beat.show)
    assert(scene.includes(esc(text)), `${beat.id}: missing script show/disclosure: ${text}`);
  const ranges = slots.filter((slot) => slot.beat === beat.id).sort((a, b) => a.start - b.start);
  if (beat.card) {
    assert.equal(ranges.length, 0, `${beat.id}: a card beat carries no capture slots`);
    assert(scene.includes(esc(beat.card.heading)), `${beat.id}: missing card heading`);
    if (beat.card.kicker) assert(scene.includes(esc(beat.card.kicker)), `${beat.id}: missing card kicker`);
    for (const [i, item] of beat.card.items.entries()) {
      assert(item.at >= beat.start && item.at < beat.end, `${beat.id}: card line outside its beat`);
      const tag = scene.match(new RegExp(`<li id="${beat.id}-item-${i}"[^>]*>`))?.[0];
      assert(
        tag?.includes(`data-start="${Number((item.at - beat.start).toFixed(6))}"`) &&
          tag.includes(`data-duration="${Number((beat.end - item.at).toFixed(6))}"`),
        `${beat.id}: card line ${i} timing differs`,
      );
      assert(scene.includes(esc(item.text)), `${beat.id}: missing card line: ${item.text}`);
      if (item.detail) assert(scene.includes(esc(item.detail)), `${beat.id}: missing card detail`);
    }
    if (beat.card.kind === "architecture")
      for (const [i, step] of ARCHITECTURE.reveal.entries()) {
        const next = ARCHITECTURE.reveal[i + 1]?.at ?? beat.end;
        assert(
          scene.includes(
            `id="architecture-step-${i}" class="clip architecture-layer" data-step="${i}" data-start="${Number((step.at - beat.start).toFixed(6))}" data-duration="${Number((next - step.at).toFixed(6))}"`,
          ),
          `architecture step ${i}: timing differs`,
        );
      }
  } else {
    assert(ranges.length, `${beat.id}: no capture slots`);
    let end = beat.start;
    for (const slot of ranges) {
      assert(near(slot.start, end), `${beat.id}: capture gap/overlap at ${slot.id}`);
      end += slot.duration;
    }
    assert(near(end, beat.end), `${beat.id}: incomplete capture coverage`);
    // A clip that cuts in on narration words starts as they are said: within 0.3 s, or, for the clip that opens
    // its beat, no later than they are (it may lead in under the words that introduce it).
    for (const [i, slot] of ranges.entries()) {
      if (!slot.word) continue;
      const t = said(beat, slot.word);
      const lead = i === 0 ? 1.5 : 0.3;
      assert(
        slot.start <= t + 0.3 && slot.start >= t - lead,
        `${slot.id}: starts at ${slot.start}, but "${slot.word}" is said at ${t.toFixed(2)}`,
      );
    }
  }
  // Pace in the speech window itself, not only across the beat (E-19 measures the beat).
  const [from, to] = beat.speech ?? [beat.start, beat.end];
  assert(from >= beat.start && to <= beat.end && to > from, `${beat.id}: speech outside its beat`);
  const count = beat.say.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  assert((count / (to - from)) * 60 <= 140, `${beat.id}: narration over 140 wpm in its speech window`);
}
// Every highlight clip names its feature; every clip after the reel's first cuts in on its word.
const reel = slots.filter((slot) => slot.beat === "highlights");
assert(
  reel.length >= 6 && reel.every((slot) => slot.label && slot.word),
  "Reel clips need a label and a word",
);
for (const slot of reel)
  assert(
    slot.label.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length <= 5,
    `${slot.id}: label over 5 words`,
  );
// The full architecture holds on screen after its last step, long enough to read.
assert(
  architectureBeat.end - ARCHITECTURE.reveal.at(-1).at >= 3,
  "Architecture: the full diagram holds under 3 s",
);
// R1's real-reading caption appears only over the exhibit clip: never on a beat, never over the run's own rows.
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
    `${slot.id}: a stand-in label over the real exhibit`,
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
// A part's bumper sits over the first frames of its first beat.
for (const part of PARTS) {
  if (!part.bumper) continue;
  const first = beats.find((beat) => beat.start === part.start);
  assert(
    read(`compositions/${first.id}.html`).includes(
      `<div id="${first.id}-bumper" class="clip part-bumper" data-start="0" data-duration="${BUMPER_SECONDS}" data-track-index="7">${esc(part.bumper)}</div>`,
    ),
    `${part.id}: bumper missing`,
  );
}
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
const first = read(`compositions/${beats[0].id}.html`);
assert(first.includes(`<div class="disclosure">${esc(FILM.firstCaption)}</div>`), "First caption disclosure");
const last = read(`compositions/${beats.at(-1).id}.html`);
assert(last.includes(`<div class="disclosure">${esc(FILM.voiceDisclosure)}</div>`), "Final voice disclosure");
for (const text of FILM.endCard) assert(last.includes(esc(text)), `End card misses: ${text}`);
for (const slot of slots) {
  const scene = read(`compositions/${slot.beat}.html`);
  const beat = beats.find((item) => item.id === slot.beat);
  assert(
    beat && slot.start >= beat.start && slot.duration > 0 && slot.start + slot.duration <= beat.end,
    `${slot.id}: outside beat`,
  );
  assert(slot.file === `captures/${slot.id}.mp4`, `${slot.id}: unstable capture path`);
  assert.equal(slot.placeholder, `Capture pending: ${slot.state}`);
  assert(["console film mode", "phone recording", "Proof in the browser"].includes(slot.source));
  assert(typeof slot.shows === "string" && slot.shows.length > 20, `${slot.id}: no on-screen state`);
  assert(slot.reference === null || /^research\/design-1104\/[\w.-]+\.png$/.test(slot.reference));
  assert([1, 12].includes(slot.playbackRate) && Number.isFinite(slot.mediaStart) && slot.mediaStart >= 0);
  assert(
    (slot.beat !== "signing" && !slot.state.startsWith("MM-5")) || slot.playbackRate === 1,
    "Do not accelerate human signing",
  );
  assert(
    scene.includes(esc(slot.placeholder)) ||
      (existsSync(`${root}/${slot.file}`) && scene.includes(slot.file)),
    `${slot.id}: missing placeholder or capture`,
  );
  const timing = `data-start="${round(slot.start - beat.start)}" data-duration="${slot.duration}"`;
  if (slot.overlay.length)
    assert(
      scene.includes(
        `<div id="${slot.id}-evidence" class="clip slot-evidence" ${timing} data-track-index="6">${slot.overlay.map((text) => `<p>${esc(text)}</p>`).join("")}</div>`,
      ),
      `${slot.id}: clip evidence missing or mistimed`,
    );
  if (slot.label)
    assert(
      scene.includes(
        `<div id="${slot.id}-label" class="clip reel-label" ${timing} data-track-index="4">${esc(slot.label)}</div>`,
      ),
      `${slot.id}: reel label missing or mistimed`,
    );
  if (slot.persona)
    assert(
      scene.includes(
        `<div id="${slot.id}-persona" class="clip persona" ${timing} data-track-index="3">${esc(slot.persona)}</div>`,
      ),
      `${slot.id}: persona missing or mistimed`,
    );
}
let captionEnd = 0;
for (const [i, cue] of captions.entries()) {
  const beat = beats.find((item) => item.id === cue.beat);
  assert(beat && cue.start >= beat.start && cue.end <= beat.end && cue.end > cue.start);
  assert(cue.start >= captionEnd, "Overlapping captions");
  captionEnd = cue.end;
  const tag = index.match(new RegExp(`<p id="caption-${i}"[^>]*>[^<]*</p>`))?.[0];
  assert(
    tag?.includes(`data-start="${cue.start}"`) &&
      tag.includes(`data-duration="${Number((cue.end - cue.start).toFixed(6))}"`),
    "Rendered caption timing differs",
  );
  assert(tag.endsWith(`>${esc(cue.text)}</p>`), `${cue.beat}: rendered caption differs`);
}
assert.equal(
  read("captions.vtt")
    .trim()
    .split(/\r?\n\r?\n/)
    .slice(1)
    .map((block) => block.split(/\r?\n/).slice(2).join(" "))
    .join(" "),
  captions.map((cue) => cue.text).join(" "),
  "VTT words differ",
);
console.log(
  `Film check passed: ${beats.length} beats in ${PARTS.length} parts, ${captions.length} captions, ${slots.length} slots, ${FILM.duration}s`,
);
