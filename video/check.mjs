import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ARCHITECTURE, beats, FILM, PARTS } from "./script.ts";

const root = fileURLToPath(new URL("./", import.meta.url));
const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
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
      assert.equal(slot.start, end, `${beat.id}: capture gap/overlap`);
      end += slot.duration;
    }
    assert.equal(end, beat.end, `${beat.id}: incomplete capture coverage`);
  }
}
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
  const timing = `data-start="${slot.start - beat.start}" data-duration="${slot.duration}"`;
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
