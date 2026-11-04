// Offline, deterministic assembly. F1 owns words, time and capture slots (script.ts); F3 supplies captures;
// F4 supplies audio. Cards and the architecture are original typography and SVG; nothing imitates a screen.
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
import { ARCHITECTURE, beats, CAPTURES, CHAPTERS, FILM, PARTS, READING_VARIANT } from "./script.ts";

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
  return {
    id: capture.id,
    beat: capture.beat,
    start: capture.start,
    duration: capture.duration,
    source: capture.source,
    file: `captures/${capture.id}.mp4`,
    placeholder: `Capture pending: ${capture.state}`,
    state: capture.state,
    shows: capture.shows,
    phase: capture.phase,
    selector: capture.phase ? `[data-moment="${moment}"][data-moment-phase="${capture.phase}"]` : null,
    persona: capture.persona,
    label: capture.label,
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

// Phrase times are provisional until F4 alignment. Splitting only at spaces preserves every word.
const captions = beats.flatMap((beat) => {
  if (!beat.say) return [];
  const chunks = [];
  let current = "";
  for (const word of beat.say.split(" ")) {
    if (current && current.length + word.length + 1 > 76) {
      chunks.push(current);
      current = "";
    }
    current += `${current ? " " : ""}${word}`;
  }
  if (current) chunks.push(current);
  const total = chunks.reduce((sum, text) => sum + text.split(" ").length, 0);
  let consumed = 0;
  return chunks.map((text, index) => {
    const start = beat.start + ((beat.end - beat.start) * consumed) / total;
    consumed += text.split(" ").length;
    const end =
      index === chunks.length - 1 ? beat.end : beat.start + ((beat.end - beat.start) * consumed) / total;
    return { beat: beat.id, start: seconds(start), end: seconds(end), text };
  });
});
write("captions.json", `${JSON.stringify(captions, null, 2)}\n`);
const stamp = (value) => {
  const ms = Math.round(value * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};
write(
  "captions.vtt",
  `WEBVTT\n\n${captions.map((cue, i) => `${i + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`).join("\n")}`,
);

// Original diagram: exact F1 box strings and edges, built up in the script's reveal order. No logos or artwork.
const positions = {
  paper: [40, 30, 380, 110],
  read: [460, 30, 400, 110],
  engine: [900, 30, 400, 110],
  keys: [1340, 30, 430, 110],
  outbox: [1340, 230, 430, 110],
  invoice: [900, 200, 400, 85],
  payouts: [900, 305, 400, 85],
  paypal: [460, 230, 400, 110],
  confirmation: [40, 215, 380, 140],
  surfaces: [40, 440, 820, 110],
  cash: [900, 440, 400, 110],
  host: [40, 610, 1730, 80],
};
const routes = {
  "keys:outbox": "M 1555 140 L 1555 230",
  "keys:cash": "M 1770 85 L 1795 85 L 1795 495 L 1300 495",
  "outbox:invoice": "M 1340 285 L 1320 285 L 1320 242 L 1300 242",
  "outbox:payouts": "M 1340 285 L 1320 285 L 1320 347 L 1300 347",
  "invoice:paypal": "M 900 242 L 880 242 L 880 270 L 860 270",
  "payouts:paypal": "M 900 347 L 880 347 L 880 300 L 860 300",
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
function wrap(text, max) {
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
const key = ([from, to]) => `${from}:${to}`;
/** The diagram with only `shown` items; items in `fresh` are drawn heavier (the step that just arrived). */
function diagram(shown = null, fresh = new Set()) {
  const boxes = ARCHITECTURE.boxes.filter((box) => !shown || shown.has(box.id));
  const arrows = ARCHITECTURE.arrows.filter((arrow) => !shown || shown.has(key(arrow)));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1810 700" role="img" aria-label="${esc(boxes.map((box) => box.label).join("; "))}"><defs><marker id="architecture-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#BDB1A4"/></marker></defs>${arrows.map((arrow) => `<path data-edge="${key(arrow)}" d="${edge(...arrow)}" stroke="#BDB1A4" stroke-width="${fresh.has(key(arrow)) ? 4 : 2}" fill="none" marker-end="url(#architecture-arrow)"/>`).join("")}${boxes
    .map((box) => {
      const [x, y, w, h] = positions[box.id];
      const lines = wrap(box.label, Math.floor((w - 40) / 14));
      return `<g data-box="${box.id}"${fresh.has(box.id) ? ' data-fresh="true"' : ""}><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#2A1F18" stroke="#BDB1A4" stroke-width="${fresh.has(box.id) ? 5 : 2}"/><text x="${x + 20}" y="${y + (h - lines.length * 30) / 2 + 24}" fill="#F4EDE4" font-family="FS Sans, sans-serif" font-size="26">${lines.map((line, i) => `<tspan x="${x + 20}" dy="${i ? 30 : 0}">${esc(line)}</tspan>`).join("")}</text></g>`;
    })
    .join("")}</svg>`;
}
write("assets/architecture.svg", diagram());

// film.css is authored, not regenerated. Font paths are local.
const labels = (beat) =>
  `<div class="evidence">${beat.show
    .filter(
      (text) =>
        text !== FILM.firstCaption && text !== "Simulated PayPal sandbox" && !FILM.endCard.includes(text),
    )
    .map((text) => {
      const statement = beat.id === "listening" && text.startsWith("Premium from");
      const content = statement
        ? esc(text).replace(/US\$[\d,.]+/g, '<span class="figure">$&</span>')
        : esc(text);
      return `<p${statement ? ` class="statement" data-statement-text="${esc(text)}"` : ""}>${content}</p>`;
    })
    .join("")}</div>`;
function slotMarkup(slot, localStart) {
  const available = existsSync(new URL(slot.file, root));
  const body = available
    ? `<video id="${slot.id}-video" class="clip footage" src="${slot.file}" muted playsinline data-has-audio="false" data-start="${localStart}" data-duration="${slot.duration}" data-media-start="${slot.mediaStart}" data-playback-rate="${slot.playbackRate}" data-track-index="1"></video>`
    : `<div id="${slot.id}-pending" class="clip pending" data-slot="${slot.id}" data-start="${localStart}" data-duration="${slot.duration}" data-track-index="1"><h2>${esc(slot.placeholder)}</h2><p>${esc(slot.source)} · ${esc(slot.file)} · ${slot.duration}s</p><p class="brief">${esc(slot.shows)}</p><p>${esc(slot.requirements.join(" "))}</p><p>F3 capture slot · ${esc(slot.phase ? `data-moment-phase=${slot.phase}` : "human evidence state")} · ${esc(slot.reference ?? "no reference screenshot")} · No screen recording supplied</p></div>`;
  const label = slot.label
    ? `<div id="${slot.id}-label" class="clip reel-label" data-start="${localStart}" data-duration="${slot.duration}" data-track-index="4">${esc(slot.label)}</div>`
    : "";
  const persona = slot.persona
    ? `<div id="${slot.id}-persona" class="clip persona" data-start="${localStart}" data-duration="${slot.duration}" data-track-index="3">${esc(slot.persona)}</div>`
    : "";
  const speed =
    slot.playbackRate === 12 && available
      ? `<div id="${slot.id}-speed" class="clip speed" data-start="${localStart}" data-duration="${slot.duration}" data-track-index="5">×12 real time</div>`
      : "";
  return `${body}${label}${persona}${speed}`;
}
/** A card line appears at its word and stays to the end of the beat; each line has its own track. */
function cardItems(beat, className) {
  return beat.card.items
    .map((item, i) => {
      const start = seconds(item.at - beat.start);
      return `<li id="${beat.id}-item-${i}" class="clip card-item" data-start="${start}" data-duration="${seconds(beat.end - item.at)}" data-track-index="${10 + i}"><span class="${className}">${esc(item.text)}</span>${item.detail ? `<span class="detail">${esc(item.detail)}</span>` : ""}</li>`;
    })
    .join("");
}
function architectureMarkup(beat) {
  const shown = new Set();
  return ARCHITECTURE.reveal
    .map((step, i) => {
      const fresh = new Set([...step.boxes, ...step.arrows.map(key)]);
      for (const item of fresh) shown.add(item);
      const next = ARCHITECTURE.reveal[i + 1]?.at ?? beat.end;
      return `<div id="architecture-step-${i}" class="clip architecture-layer" data-step="${i}" data-start="${seconds(step.at - beat.start)}" data-duration="${seconds(next - step.at)}" data-track-index="2">${diagram(new Set(shown), fresh)}</div>`;
    })
    .join("");
}
function cardMarkup(beat) {
  const { card } = beat;
  const kicker = card.kicker ? `<p class="kicker">${esc(card.kicker)}</p>` : "";
  if (card.kind === "architecture")
    return `<div class="card card-architecture"><h1 class="card-heading">${esc(card.heading)}</h1>${kicker}<div class="architecture">${architectureMarkup(beat)}</div></div>`;
  if (card.kind === "end")
    return `<div class="card card-end"><h1 class="headline">${esc(card.heading)}</h1>${kicker}<div class="limits-list">${FILM.endCard
      .slice(2)
      .map((text) => `<p>${esc(text)}</p>`)
      .join("")}</div></div>`;
  const list = card.kind === "solution" ? "ol" : "ul";
  return `<div class="card card-${card.kind}"><h1 class="card-heading">${esc(card.heading)}</h1>${kicker}<${list} class="card-items">${cardItems(beat, "line")}</${list}></div>`;
}
const partTitle = { overview: "Overview", "deep-dive": "Deep dive", close: "Limits and impact" };
const written = new Set();
for (const [index, beat] of beats.entries()) {
  const duration = beat.end - beat.start;
  const chapter = [...CHAPTERS].reverse().find((item) => item.start <= beat.start)?.title ?? FILM.title;
  const captures = slots.filter((slot) => slot.beat === beat.id);
  const body = beat.card
    ? cardMarkup(beat)
    : captures.map((slot) => slotMarkup(slot, slot.start - beat.start)).join("");
  const disclosure =
    index === 0
      ? FILM.firstCaption
      : index === beats.length - 1
        ? FILM.voiceDisclosure
        : beat.id === "listening"
          ? "Gemini TTS · Machine-translated, pending native review"
          : "";
  write(
    `compositions/${beat.id}.html`,
    `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"></head><body><template><style>#root{position:absolute;inset:0;width:100%;height:100%}</style><div id="root" data-no-timeline data-composition-id="${beat.id}" data-width="1920" data-height="1080" data-duration="${duration}"><section class="scene" data-part="${beat.part}"><header class="header"><span>${esc(partTitle[beat.part])} · ${esc(chapter)}</span><span class="season">2026-A</span></header><div class="content">${body}</div>${beat.card ? "" : labels(beat)}</section><div class="simulation">Simulated PayPal sandbox</div>${disclosure ? `<div class="disclosure">${esc(disclosure)}</div>` : ""}</div></template></body></html>\n`,
  );
  written.add(`${beat.id}.html`);
}
// A beat the script dropped must not linger as a stale scene.
for (const name of readdirSync(new URL("compositions/", root)))
  if (name.endsWith(".html") && !written.has(name)) rmSync(new URL(`compositions/${name}`, root));
// Static, duration-driven hard cuts use the native HyperFrames clip runtime; no animation dependency or CDN.
write(
  "index.html",
  `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080"><title>${esc(FILM.title)} · Script v${FILM.version} assembly</title><link rel="stylesheet" href="film.css"></head><body><div id="root" data-no-timeline data-composition-id="main" data-fps="30" data-width="1920" data-height="1080" data-duration="${FILM.duration}">${beats.map((beat) => `<div id="scene-${beat.id}" class="clip" data-no-timeline data-composition-id="${beat.id}" data-start="${beat.start}" data-duration="${beat.end - beat.start}" data-composition-src="compositions/${beat.id}.html" data-track-index="0" data-width="1920" data-height="1080"></div>`).join("\n")}${captions.map((cue, i) => `<p id="caption-${i}" class="clip caption" data-track-kind="captions" data-caption-layer="fg" data-start="${cue.start}" data-duration="${seconds(cue.end - cue.start)}" data-track-index="8">${esc(cue.text)}</p>`).join("\n")}</div></body></html>\n`,
);
write(
  "chapters.txt",
  `${CHAPTERS.map((chapter) => `${stamp(chapter.start).slice(3, 8)} ${chapter.title}`).join("\n")}\n`,
);
// Format generated JSON with the already installed repo tool, without another dependency.
const format = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL("../node_modules/@biomejs/biome/bin/biome", root)),
    "format",
    "--write",
    "captions.json",
    "captures.json",
  ],
  { cwd: fileURLToPath(root), encoding: "utf8" },
);
if (format.status !== 0) throw new Error(`Generated JSON formatting failed: ${format.stderr}`);
console.log(
  `Built ${beats.length} scenes (${PARTS.map((part) => `${part.id} ${part.start}-${part.end}s`).join(", ")}), ${captions.length} captions, ${slots.length} capture slots; ${FILM.duration}s; reading=${READING_VARIANT}. Project: ${fileURLToPath(root)}`,
);
