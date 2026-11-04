// Offline, deterministic assembly of the film in the motion language of video/proto/STYLE.md (rough cut v3).
// F1 owns words, time and capture slots (script.ts); F3 supplies captures; F4 supplies voice and music. The opening is
// generated from the prototype, the architecture and the close are mounted from their parts, and every capture-slot
// beat is a calm placeholder that a recording drops into without layout work. Captions are a closed-caption track.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CAPTURE_RUN,
  CLOSE_NOTE,
  CLOSE_START,
  captions,
  KEYWORDS,
  openingFromPrototype,
  SEAMS,
  SEGMENTS,
  SIM,
  simSpan,
  slotTag,
  stamp,
  VTT_NOTE,
  vtt,
  WINDOWS,
  windowKind,
} from "./plan.mjs";
import {
  ARCHITECTURE,
  BUMPER_SECONDS,
  beats,
  CAPTURES,
  CHAPTERS,
  FILM,
  PARTS,
  READING_VARIANT,
} from "./script.ts";
import { cueSheet, fitResults } from "./tools/cue-sheet.mjs";

const root = new URL("./", import.meta.url);
const esc = (text) =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const write = (name, content) => writeFileSync(new URL(name, root), content);
const seconds = (value) => Number(value.toFixed(6));
for (const dir of ["compositions", "assets/fonts", "assets/licences", "captures", "out"])
  mkdirSync(new URL(dir, root), { recursive: true });
for (const name of ["FSSans-VF.woff2", "AtkinsonNext-VF.woff2", "FSStencil.woff2", "FSSansPeso.woff2"])
  copyFileSync(new URL(`../assets/fonts/web/${name}`, root), new URL(`assets/fonts/${name}`, root));
for (const name of ["MonaSans", "AtkinsonHyperlegibleNext", "BigShouldersStencil", "NotoSans"]) {
  const licence = readFileSync(new URL(`../assets/fonts/licences/OFL-${name}.txt`, root), "utf8");
  write(
    `assets/licences/OFL-${name}.txt`,
    licence
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .join("\n"),
  );
}

// ------------------------------------------------------------------------------------------- capture slots
// Slots come from the script, in absolute film seconds. F3 never changes filenames; it may set mediaStart and
// playbackRate in captures.json, and regeneration keeps those two values.
const previous = existsSync(new URL("captures.json", root))
  ? JSON.parse(readFileSync(new URL("captures.json", root), "utf8"))
  : [];
const slots = CAPTURES.map((capture) => {
  const beat = beats.find((item) => item.id === capture.beat);
  if (!beat) throw new Error(`${capture.id}: no beat ${capture.beat}`);
  const kept = previous.find((slot) => slot.id === capture.id);
  const moment = /^MM-[\dS]+\b/.exec(capture.state)?.[0];
  if (capture.phase && !moment) throw new Error(`${capture.id}: a phase needs a moment in its state`);
  const keyword = KEYWORDS[capture.id];
  if (!keyword) throw new Error(`${capture.id}: no keyword`);
  const kind = windowKind(capture);
  const tag = slotTag(capture);
  return {
    id: capture.id,
    beat: capture.beat,
    start: capture.start,
    duration: capture.duration,
    source: capture.source,
    file: `captures/${capture.id}.mp4`,
    placeholder: `capture pending: ${capture.id}`,
    window: `${kind} ${WINDOWS[kind].w}×${WINDOWS[kind].h}`,
    keyword,
    tag: tag?.text ?? null,
    state: capture.state,
    shows: capture.shows,
    phase: capture.phase,
    selector: capture.phase ? `[data-moment="${moment}"][data-moment-phase="${capture.phase}"]` : null,
    persona: capture.persona,
    label: capture.label,
    word: capture.word,
    overlay: capture.overlay,
    // The film no longer lays sentences over a clip (STYLE §2): these lines must be legible in the capture itself,
    // beside the value they describe, or are carried by the slot's tag.
    evidence: [
      ...beat.show.filter(
        (text) => text !== SIM && text !== FILM.firstCaption && !FILM.endCard.includes(text),
      ),
      ...capture.overlay,
      ...(capture.persona ? [capture.persona] : []),
    ],
    reference: capture.reference ? `research/design-1104/${capture.reference}` : null,
    // Only F3 may mark a recorded wait accelerated. No implied acceleration on placeholders.
    playbackRate: kept?.playbackRate ?? 1,
    mediaStart: kept?.mediaStart ?? 0,
    requirements: [
      beat.picture,
      ...beat.cues
        .filter((cue) => cue.at >= capture.start && cue.at < capture.start + capture.duration)
        .map((cue) => cue.picture),
    ],
  };
});
write("captures.json", `${JSON.stringify(slots, null, 2)}\n`);

// ------------------------------------------------------------------------------------------------ captions
// A closed-caption track (STYLE §8), never burned in. close.vtt is the close part's slice, for its own render.
write("captions.json", `${JSON.stringify(captions, null, 2)}\n`);
write("captions.vtt", vtt(captions, VTT_NOTE));
write(
  "parts/close/close.vtt",
  vtt(
    captions.filter((cue) => cue.start >= CLOSE_START),
    CLOSE_NOTE,
    CLOSE_START,
  ),
);

// Original diagram kept as a still: exact F1 box strings and edges. No logos or artwork.
const positions = {
  paper: [40, 30, 380, 110],
  read: [460, 30, 400, 110],
  engine: [900, 30, 400, 110],
  keys: [1340, 30, 430, 110],
  outbox: [1340, 230, 430, 110],
  tools: [900, 230, 400, 110],
  paypal: [460, 230, 400, 110],
  confirmation: [40, 215, 380, 140],
  surfaces: [40, 440, 820, 110],
  cash: [900, 440, 400, 110],
};
const routes = {
  "keys:outbox": "M 1555 140 L 1555 230",
  "keys:cash": "M 1770 85 L 1795 85 L 1795 495 L 1300 495",
  "outbox:tools": "M 1340 285 L 1300 285",
  "tools:paypal": "M 900 285 L 860 285",
  "paypal:confirmation": "M 460 285 L 420 285",
  "confirmation:surfaces": "M 230 355 L 230 440",
  "cash:surfaces": "M 900 495 L 860 495",
};
function edge(from, to) {
  const route = routes[`${from}:${to}`];
  if (route) return route;
  const [x, y, w, h] = positions[from];
  const [tx, ty, , th] = positions[to];
  if (ty !== y || tx <= x) throw new Error(`No route for ${from} -> ${to}`);
  return `M ${x + w} ${y + h / 2} L ${tx} ${ty + th / 2}`;
}
function wrapWords(text, max) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + word.length + 1 > max) {
      lines.push(line);
      line = "";
    }
    line += `${line ? " " : ""}${word}`;
  }
  if (line) lines.push(line);
  return lines;
}
write(
  "assets/architecture.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1810 580" role="img" aria-label="${esc(ARCHITECTURE.boxes.map((box) => box.label).join("; "))}"><defs><marker id="architecture-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#BDB1A4"/></marker></defs>${ARCHITECTURE.arrows.map(([from, to]) => `<path data-edge="${from}:${to}" d="${edge(from, to)}" stroke="#BDB1A4" stroke-width="2" fill="none" marker-end="url(#architecture-arrow)"/>`).join("")}${ARCHITECTURE.boxes
    .map((box) => {
      const [x, y, w, h] = positions[box.id];
      const lines = wrapWords(box.label, Math.floor((w - 40) / 14));
      return `<g data-box="${box.id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#2A1F18" stroke="#BDB1A4" stroke-width="2"/><text x="${x + 20}" y="${y + (h - lines.length * 30) / 2 + 24}" fill="#F4EDE4" font-family="FS Sans, sans-serif" font-size="26">${lines.map((line, i) => `<tspan x="${x + 20}" dy="${i ? 30 : 0}">${esc(line)}</tspan>`).join("")}</text></g>`;
    })
    .join("")}</svg>`,
);

// ------------------------------------------------------------------------------------------------- parts
// The architecture part builds itself from script.ts (and copies its font); the film mounts it in place.
const arch = spawnSync(process.execPath, [fileURLToPath(new URL("parts/architecture/build.mjs", root))], {
  encoding: "utf8",
});
if (arch.status !== 0) throw new Error(`The architecture part did not build: ${arch.stderr}`);

// ------------------------------------------------------------------------------------------ capture slots
const FLASK =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5h6M10 3.5v5.2L4.8 17.6A2 2 0 0 0 6.5 20.5h11a2 2 0 0 0 1.7-2.9L14 8.7V3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><path d="M7.4 14.5h9.2" stroke="currentColor" stroke-width="2"/></svg>';
/** Keyword size: STYLE's 176 px, smaller only when the word would run into its window. */
function keywordSize(word, kind) {
  const room = kind === "phone" ? WINDOWS.phone.a.x - WINDOWS.phone.w / 2 - 140 - 60 : 1640;
  return Math.min(176, Math.floor(room / (word.length * 0.56)));
}
function slotIdSize(id, kind) {
  const room = (kind === "phone" ? WINDOWS.phone.w : WINDOWS.landscape.w) - 90;
  return Math.min(64, Math.floor(room / (id.length * 0.66)));
}
const pendingPlate = (slot, kind) =>
  `<div class="pf-pending"><i class="pf-crop pf-crop--tl"></i><i class="pf-crop pf-crop--tr"></i><i class="pf-crop pf-crop--bl"></i><i class="pf-crop pf-crop--br"></i><span class="pf-rec"></span><p class="pf-p1">capture pending:</p><p class="pf-p2" style="font-size:${slotIdSize(slot.id, kind)}px;line-height:1.15">${esc(slot.id)}</p><p class="pf-p3">${esc(slot.source)} · ${slot.duration} s</p></div>`;
function windowMarkup(slot, local) {
  const kind = windowKind(slot);
  const available = existsSync(new URL(slot.file, root));
  const inner = available
    ? `<video id="${slot.id}-video" class="clip pf-video" src="${slot.file}" muted playsinline data-has-audio="false" data-start="${local}" data-duration="${slot.duration}" data-media-start="${slot.mediaStart}" data-playback-rate="${slot.playbackRate}" data-track-index="1"></video>${slot.playbackRate === 12 ? '<span class="pf-speed">×12 real time</span>' : ""}`
    : pendingPlate(slot, kind);
  return `<div id="${slot.id}-window" class="pf-win pf-win--${kind}" data-slot="${slot.id}" data-slot-start="${local}" data-slot-duration="${slot.duration}" data-layout-allow-overflow><div class="pf-in">${inner}</div></div>`;
}
/**
 * A neighbour's window, drawn by this beat only while the camera's glide across their shared cut keeps it in frame
 * (plan.mjs CAPTURE_RUN), so the cut has no seam. A recording replays its own edge (its last or first seconds).
 */
function ghostMarkup(slot, segment) {
  const kind = windowKind(slot);
  const move = CAPTURE_RUN.slots.find((item) => item.id === slot.id);
  const from = Math.max(move.glideIn[0], segment.start);
  const to = Math.min(move.glideOut[1], segment.end);
  const length = seconds(to - from);
  const mediaStart = seconds(
    slot.mediaStart +
      Math.min(Math.max(0, from - slot.start), Math.max(0, slot.duration - length)) * slot.playbackRate,
  );
  const inner = existsSync(new URL(slot.file, root))
    ? `<video id="${segment.id}--${slot.id}-video" class="clip pf-video" src="${slot.file}" muted playsinline data-has-audio="false" data-start="${seconds(from - segment.start)}" data-duration="${length}" data-media-start="${mediaStart}" data-playback-rate="${slot.playbackRate}" data-track-index="1"></video>`
    : pendingPlate(slot, kind);
  return `<div id="${segment.id}--${slot.id}-window" class="pf-win pf-win--${kind}" data-ghost="${slot.id}" data-layout-allow-overflow><div class="pf-in">${inner}</div></div>`;
}
function slotComposition(segment) {
  const [beat] = segment.beats.map((id) => beats.find((item) => item.id === id));
  const id = segment.id;
  const duration = beat.end - beat.start;
  const own = slots.filter((slot) => slot.beat === beat.id).sort((a, b) => a.start - b.start);
  const part = PARTS.find((item) => item.id === beat.part);
  const bumper = part?.bumper && part.start === beat.start ? part.bumper : null;
  const span = simSpan(segment);
  const local = (value) => seconds(value - beat.start);
  // One camera over the whole run (plan.mjs CAPTURE_RUN): this beat draws its own windows and its neighbours'.
  const order = CAPTURE_RUN.slots.map((item) => item.id);
  const ghosts = [order[order.indexOf(own[0].id) - 1], order[order.indexOf(own.at(-1).id) + 1]]
    .filter(Boolean)
    .map((ghost) => slots.find((slot) => slot.id === ghost));
  const drawn = new Set([...own, ...ghosts].map((slot) => slot.id));
  const config = {
    id,
    filmStart: beat.start,
    duration,
    bumper: bumper ? BUMPER_SECONDS : null,
    windows: WINDOWS,
    run: {
      keys: CAPTURE_RUN.keys,
      outro: CAPTURE_RUN.outro,
      slots: CAPTURE_RUN.slots
        .filter((item) => drawn.has(item.id))
        .map(({ id: slot, kind, first, last, ph, start, x, y, glideIn, glideOut, kwIn, kwOut, accent }) => ({
          id: slot,
          kind,
          first,
          last,
          ph,
          start,
          x,
          y,
          glideIn,
          glideOut,
          kwIn,
          kwOut,
          accent,
        })),
    },
    sim: span
      ? {
          from: local(span.from),
          to: local(span.to),
          continuesIn: span.continuesIn,
          continuesOut: span.continuesOut,
        }
      : null,
    slots: own.map((slot) => ({
      id: slot.id,
      start: local(slot.start),
      duration: slot.duration,
      kind: windowKind(slot),
      tag: slotTag(slot)?.kind === "honesty",
    })),
  };
  const keywords = own
    .map((slot) => {
      const kind = windowKind(slot);
      const size = keywordSize(slot.keyword, kind);
      return `<div id="${slot.id}-kw" class="pf-kw pf-kw--${kind}" data-layout-allow-overlap data-layout-allow-occlusion data-layout-allow-overflow><span data-layout-allow-occlusion style="font-size:${size}px;line-height:${size}px">${esc(slot.keyword)}</span></div>`;
    })
    .join("");
  const tags = [
    ...(span
      ? [`<div id="${id}-tag-sim" class="pf-tag" data-layout-allow-occlusion>${FLASK}${esc(SIM)}</div>`]
      : []),
    ...own
      .filter((slot) => slotTag(slot)?.kind === "honesty")
      .map(
        (slot) =>
          `<div id="${slot.id}-tag" class="pf-tag pf-tag--nodot" data-layout-allow-occlusion>${esc(slotTag(slot).text)}</div>`,
      ),
  ].join("");
  // The bumper reads as an end line: the words before the colon (STYLE §2, at most four words).
  const bumperWords = bumper ? `${bumper.split(":")[0]}.`.split(" ") : [];
  const bumperMarkup = bumper
    ? `<div id="${id}-veil" class="pf-veil"></div><div id="${id}-bumper" class="pf-endline" data-bumper="${esc(bumper)}" data-layout-allow-overlap>${bumperWords.map((word) => `<span class="w">${esc(word)}</span>`).join("")}</div>`
    : "";
  const before = ghosts.filter((slot) => slot.start < beat.start).map((slot) => ghostMarkup(slot, segment));
  const after = ghosts.filter((slot) => slot.start > beat.start).map((slot) => ghostMarkup(slot, segment));
  const windows = [...before, ...own.map((slot) => windowMarkup(slot, local(slot.start))), ...after].join("");
  const day = `<div id="${id}-day" class="pf-day"><div id="${id}-field" class="pf-field" data-layout-allow-overflow><div id="${id}-lightA" class="pf-light pf-lightA" data-layout-allow-overflow></div><div id="${id}-lightC" class="pf-light pf-lightC" data-layout-allow-overflow></div><div id="${id}-lightB" class="pf-light pf-lightB" data-layout-allow-overflow></div><div class="pf-wash"></div><div id="${id}-dapple" class="pf-dapple" data-layout-allow-overflow></div></div><div id="${id}-world" class="pf-world">${windows}</div>${keywords}${tags}${bumperMarkup}</div>`;
  return `<!doctype html>
<!-- Generated by video/build.mjs (plan.mjs, film-slots.js): script v4 beat "${beat.id}", film ${beat.start}-${beat.end} s.
     One floating window per captures.json slot; drop the recording at captures/<slot-id>.mp4 and rebuild. -->
<html lang="en"><head><meta charset="UTF-8"></head><body><template>
<style>#root{position:absolute;inset:0;overflow:hidden;background:#F3F5F8}</style>
<div id="root" data-composition-id="${id}" data-width="1920" data-height="1080" data-duration="${duration}" data-film-start="${beat.start}">${day}<canvas id="${id}-grain" class="pf-grain" width="960" height="540" data-layout-allow-overflow></canvas></div>
<script>
(() => {
  const tl = gsap.timeline({ paused: true });
  window.FairSplitSlots.build(tl, ${JSON.stringify(config)});
  window.__timelines["${id}"] = tl;
})();
</script>
</template></body></html>
`;
}

const written = new Set();
for (const segment of SEGMENTS) {
  if (!segment.src.startsWith("compositions/")) continue;
  // The opening is generated from the prototype, the reference implementation of STYLE.md, so they cannot drift.
  const html = segment.from ? openingFromPrototype().html : slotComposition(segment);
  write(segment.src, html);
  written.add(segment.src.slice("compositions/".length));
}
// A beat the plan no longer generates must not linger as a stale scene.
for (const name of readdirSync(new URL("compositions/", root)))
  if (name.endsWith(".html") && !written.has(name)) rmSync(new URL(`compositions/${name}`, root));

// --------------------------------------------------------------------------------------------- the film
const rootDuration = (src) =>
  Number(/<div id="root"[^>]*data-duration="([\d.]+)"/.exec(readFileSync(new URL(src, root), "utf8"))?.[1]);
for (const segment of SEGMENTS) {
  const own = rootDuration(segment.src);
  if (Math.abs(own - (segment.end - segment.start)) > 1e-6)
    throw new Error(`${segment.id} runs ${own} s but its beats take ${segment.end - segment.start} s`);
}
const host = (segment) =>
  `<div id="segment-${segment.id}" class="clip" data-composition-id="${segment.id}" data-composition-src="${segment.src}" data-start="${segment.start}" data-duration="${seconds(segment.end - segment.start)}" data-track-index="0" data-width="1920" data-height="1080" data-beats="${segment.beats.join(" ")}"></div>`;
const seam = (item) =>
  `<div id="${item.id}" class="clip seam" data-start="${seconds(item.end - item.duration)}" data-duration="${item.duration}" data-track-index="2"></div>`;
write(
  "index.html",
  `<!doctype html>
<!-- Generated by video/build.mjs. Fair Split film, script v4, rough cut v3 in the motion language of video/proto/STYLE.md.
     Captions are the closed-caption track captions.vtt (muxed into the MP4), never burned in. -->
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080"><title>${esc(FILM.title)} · film v${FILM.version}, rough cut v3</title>
<link rel="stylesheet" href="film.css">
<script src="parts/close/assets/vendor/gsap.min.js"></script>
<script src="film-slots.js"></script>
</head><body>
<div id="root" data-composition-id="main" data-fps="30" data-width="1920" data-height="1080" data-duration="${FILM.duration}">
${SEGMENTS.map(host).join("\n")}
${SEAMS.map(seam).join("\n")}
</div>
<script>
(() => {
  const tl = gsap.timeline({ paused: true });
${SEAMS.map((item) => `  tl.fromTo("#${item.id}", { opacity: 0 }, { opacity: 1, duration: ${item.duration}, ease: "power1.in" }, ${seconds(item.end - item.duration)});`).join("\n")}
  window.__timelines.main = tl;
})();
</script>
</body></html>
`,
);
write(
  "chapters.txt",
  `${CHAPTERS.map((chapter) => `${stamp(chapter.start).slice(3, 8)} ${chapter.title}`).join("\n")}\n`,
);

// ------------------------------------------------------------------------------------------- the sound sheet
// AUDIO-CUES.md: narration where the voice says it, the fit to the picture, the bed, the effects and the mix
// (tools/cue-sheet.mjs). The build refuses a narration line that misses its place in the picture.
const misses = fitResults().filter((fit) => !fit.ok);
if (misses.length)
  throw new Error(
    `Narration off the picture: ${misses.map((fit) => `${fit.beat} ${fit.what} (${fit.t.toFixed(2)} s)`).join("; ")}`,
  );
write("AUDIO-CUES.md", cueSheet(captions));

// Format generated JSON and Markdown with the repo's Biome when it is installed (FS_BIOME names its JS entry
// otherwise, e.g. another checkout's node_modules/@biomejs/biome/bin/biome).
const biome =
  process.env.FS_BIOME ?? fileURLToPath(new URL("../node_modules/@biomejs/biome/bin/biome", root));
if (existsSync(biome)) {
  const format = spawnSync(
    process.execPath,
    [biome, "format", "--write", "captions.json", "captures.json", "AUDIO-CUES.md"],
    { cwd: fileURLToPath(root), encoding: "utf8" },
  );
  if (format.status !== 0) throw new Error(`Generated file formatting failed: ${format.stderr}`);
} else console.warn(`Biome not found at ${biome}; generated JSON and Markdown left unformatted.`);
console.log(
  `Built ${SEGMENTS.length} compositions for ${beats.length} beats (${PARTS.map((part) => `${part.id} ${part.start}-${part.end}s`).join(", ")}), ${captions.length} caption cues, ${slots.length} capture slots; ${FILM.duration}s; reading=${READING_VARIANT}. Project: ${fileURLToPath(root)}`,
);
