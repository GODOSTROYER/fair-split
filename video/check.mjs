import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beats, FILM } from "./script.ts";

const root = fileURLToPath(new URL("./", import.meta.url));
const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
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
  for (const text of beat.show) {
    const escaped = text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
    assert(scene.includes(escaped), `${beat.id}: missing script show/disclosure: ${text}`);
  }
  if (!["architecture", "limits"].includes(beat.id)) {
    const ranges = slots.filter((slot) => slot.beat === beat.id).sort((a, b) => a.start - b.start);
    assert(ranges.length, `${beat.id}: no capture slots`);
    let end = beat.start;
    for (const slot of ranges) {
      assert.equal(slot.start, end, `${beat.id}: capture gap/overlap`);
      end += slot.duration;
    }
    assert.equal(end, beat.end, `${beat.id}: incomplete capture coverage`);
  }
}
for (const slot of slots) {
  const scene = read(`compositions/${slot.beat}.html`);
  const beat = beats.find((item) => item.id === slot.beat);
  assert(
    beat && slot.start >= beat.start && slot.duration > 0 && slot.start + slot.duration <= beat.end,
    `${slot.id}: outside beat`,
  );
  assert(slot.file === `captures/${slot.id}.mp4`, `${slot.id}: unstable capture path`);
  assert.equal(slot.placeholder, `Capture pending: ${slot.state}`);
  assert(["console film mode", "phone recording"].includes(slot.source));
  assert([1, 12].includes(slot.playbackRate) && Number.isFinite(slot.mediaStart) && slot.mediaStart >= 0);
  assert(slot.beat !== "signing" || slot.playbackRate === 1, "Do not accelerate human signing");
  assert(
    scene.includes(slot.placeholder) || (existsSync(`${root}/${slot.file}`) && scene.includes(slot.file)),
    `${slot.id}: missing placeholder or capture`,
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
  assert(
    tag.endsWith(
      `>${cue.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")}</p>`,
    ),
    `${cue.beat}: rendered caption differs`,
  );
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
  `Film check passed: ${beats.length} beats, ${captions.length} captions, ${slots.length} slots, ${FILM.duration}s`,
);
