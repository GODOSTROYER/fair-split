// Offline, deterministic assembly. F1 owns words and time; F3 supplies captures; F4 supplies audio.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ARCHITECTURE, beats, CHAPTERS, FILM, READING_VARIANT } from "./script.ts";

const root = new URL("./", import.meta.url);
const esc = (text) =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const write = (name, content) => writeFileSync(new URL(name, root), content);
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

// One or more source ranges per beat, in absolute film seconds. F3 never changes filenames.
const definitions = [
  [
    "arrival-phone",
    "arrival",
    0,
    9,
    "phone recording",
    "MM-1 on M-MB-01",
    "done",
    "Nang Celing · Member · Synthetic persona",
  ],
  [
    "title-persona",
    "title",
    9,
    11,
    "console film mode",
    "Analyn beside synthetic weigh-slips",
    null,
    "Analyn · Treasurer · Synthetic persona",
  ],
  [
    "funding-console",
    "funding",
    20,
    12,
    "console film mode",
    "MM-S on W-TR-01",
    "funded",
    "Dana · Lantern Bay · Synthetic persona",
  ],
  [
    "reading-console",
    "reading",
    32,
    10,
    "console film mode",
    "MM-2 on W-TR-03",
    "landed",
    "Analyn · Treasurer · Synthetic persona",
  ],
  [
    "reading-logbook",
    "reading",
    42,
    2,
    "console film mode",
    "MM-2 by-hand on W-TR-04",
    "done",
    "Analyn · Treasurer · Synthetic persona",
  ],
  [
    "duplicate-console",
    "duplicate",
    44,
    12,
    "console film mode",
    "MM-3 on W-TR-06",
    "resolved",
    "Analyn · Treasurer · Synthetic persona",
  ],
  [
    "holds-console",
    "rules",
    56,
    8,
    "console film mode",
    "H2 and H3 evidence in ink",
    null,
    "Analyn · Treasurer · Synthetic persona",
  ],
  [
    "rules-console",
    "rules",
    64,
    6,
    "console film mode",
    "MM-4 on W-TR-02",
    "done",
    "Analyn · Treasurer · Synthetic persona",
  ],
  [
    "signing-console",
    "signing",
    70,
    7,
    "console film mode",
    "MM-5 on W-TR-07",
    "signed-1",
    "Analyn · Treasurer · Synthetic persona",
  ],
  [
    "signing-phone",
    "signing",
    77,
    7,
    "phone recording",
    "MM-5 on M-BD-02",
    "inked",
    "Ernesto · Chair · Synthetic persona",
  ],
  [
    "payouts-console",
    "payouts",
    84,
    18,
    "console film mode",
    "MM-6 on W-TR-08",
    "settled",
    "Analyn · Treasurer · Synthetic persona",
  ],
  [
    "proof-browser",
    "proof",
    102,
    18,
    "console film mode",
    "Verify locally on W-PF-01",
    null,
    "Dana · Lantern Bay · Synthetic persona",
  ],
  [
    "listening-phone",
    "listening",
    120,
    12,
    "phone recording",
    "MM-7 on M-MB-01",
    "zoomed",
    "Nang Celing · Member · Synthetic persona",
  ],
];
const previous = existsSync(new URL("captures.json", root))
  ? JSON.parse(readFileSync(new URL("captures.json", root), "utf8"))
  : [];
const slots = definitions.map(([id, beat, start, duration, source, state, phase, persona]) => ({
  id,
  beat,
  start,
  duration,
  source,
  file: `captures/${id}.mp4`,
  placeholder: `Capture pending: ${state}`,
  state,
  phase,
  selector: phase ? `[data-moment="${state.split(" ")[0]}"][data-moment-phase="${phase}"]` : null,
  persona,
  // Only F3 may mark a recorded wait accelerated. No implied acceleration on placeholders.
  playbackRate: previous.find((slot) => slot.id === id)?.playbackRate ?? 1,
  mediaStart: previous.find((slot) => slot.id === id)?.mediaStart ?? 0,
  requirements: [
    beats.find((item) => item.id === beat).picture,
    ...beats
      .find((item) => item.id === beat)
      .cues.filter((cue) => cue.at >= start && cue.at < start + duration)
      .map((cue) => cue.picture),
  ],
}));
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
    return { beat: beat.id, start: Number(start.toFixed(6)), end: Number(end.toFixed(6)), text };
  });
});
write("captions.json", `${JSON.stringify(captions, null, 2)}\n`);
const stamp = (seconds) => {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};
write(
  "captions.vtt",
  `WEBVTT\n\n${captions.map((cue, i) => `${i + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`).join("\n")}`,
);

// Original diagram: exact F1 box strings and edges. No imported logos or artwork.
const positions = {
  paper: [40, 20, 430, 100],
  read: [40, 165, 430, 110],
  engine: [40, 325, 430, 100],
  keys: [540, 325, 430, 100],
  outbox: [1040, 325, 650, 100],
  invoice: [1040, 175, 650, 100],
  payouts: [1040, 20, 650, 100],
  paypal: [1040, 490, 650, 100],
  confirmation: [540, 490, 430, 130],
  surfaces: [40, 490, 430, 100],
  host: [540, 20, 430, 110],
};
function wrap(text, max = 28) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + word.length > max) {
      lines.push(line);
      line = "";
    }
    line += `${line ? " " : ""}${word}`;
  }
  if (line) lines.push(line);
  return lines;
}
function edge(from, to) {
  // Route the long branches through the right gutter, clear of intervening boxes.
  if (from === "outbox" && to === "payouts") return "M 1690 350 L 1715 350 L 1715 70 L 1690 70";
  if (from === "invoice" && to === "paypal") return "M 1690 225 L 1740 225 L 1740 530 L 1690 530";
  if (from === "payouts" && to === "paypal") return "M 1690 70 L 1770 70 L 1770 560 L 1690 560";
  const [x, y, w, h] = positions[from];
  const [tx, ty, tw, th] = positions[to];
  if (Math.abs(tx - x) > Math.abs(ty - y)) {
    const right = tx > x;
    return `M ${right ? x + w : x} ${y + h / 2} L ${right ? tx : tx + tw} ${ty + th / 2}`;
  }
  const down = ty > y;
  return `M ${x + w / 2} ${down ? y + h : y} L ${tx + tw / 2} ${down ? ty : ty + th}`;
}
const architecture = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1810 650" role="img" aria-label="${esc(ARCHITECTURE.boxes.map((box) => box.label).join("; "))}"><defs><marker id="architecture-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#BDB1A4"/></marker></defs>${ARCHITECTURE.arrows.map(([from, to]) => `<path data-edge="${from}:${to}" d="${edge(from, to)}" stroke="#BDB1A4" stroke-width="2" fill="none" marker-end="url(#architecture-arrow)"/>`).join("")}${ARCHITECTURE.boxes
  .map((box) => {
    const [x, y, w, h] = positions[box.id];
    const lines = wrap(box.label, w > 500 ? 40 : 27);
    return `<g data-box="${box.id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#2A1F18" stroke="#BDB1A4" stroke-width="2"/><text x="${x + 20}" y="${y + (h - lines.length * 30) / 2 + 24}" fill="#F4EDE4" font-family="FS Sans" font-size="26">${lines.map((line, i) => `<tspan x="${x + 20}" dy="${i ? 30 : 0}">${esc(line)}</tspan>`).join("")}</text></g>`;
  })
  .join("")}</svg>`;
write("assets/architecture.svg", architecture);

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
    : `<div id="${slot.id}-pending" class="clip pending" data-slot="${slot.id}" data-start="${localStart}" data-duration="${slot.duration}" data-track-index="1"><h2>${esc(slot.placeholder)}</h2><p>${esc(slot.source)} · ${esc(slot.file)} · ${slot.duration}s</p><p class="brief">${esc(slot.requirements.join(" "))}</p><p>F3 capture slot · ${esc(slot.phase ? `data-moment-phase=${slot.phase}` : "human evidence state")} · No screen recording supplied</p></div>`;
  return `${body}<div id="${slot.id}-persona" class="clip persona" data-start="${localStart}" data-duration="${slot.duration}" data-track-index="3">${esc(slot.persona)}</div>${slot.playbackRate === 12 && available ? `<div id="${slot.id}-speed" class="clip speed" data-start="${localStart}" data-duration="${slot.duration}" data-track-index="3">×12 real time</div>` : ""}`;
}
for (const beat of beats) {
  const duration = beat.end - beat.start;
  const chapter = [...CHAPTERS].reverse().find((chapter) => chapter.start <= beat.start)?.title ?? FILM.title;
  const captures = slots.filter((slot) => slot.beat === beat.id);
  let body = captures.map((slot) => slotMarkup(slot, slot.start - beat.start)).join("");
  if (beat.id === "title")
    body = `<div class="title-layout"><div class="title-copy"><h1 class="headline">${esc(FILM.title)}</h1><p class="tagline">${esc(FILM.endCard[1])}</p></div><div class="content">${body}</div></div>`;
  if (beat.id === "architecture")
    body = `<h2 class="tagline">${esc(beat.show[2])}</h2><div class="architecture">${architecture}</div>`;
  if (beat.id === "limits")
    body = `<div id="limits-card" class="clip" data-start="0" data-duration="8" data-track-index="1"><div class="content"><h2 class="headline">${esc(FILM.endCard[2])}</h2><div class="limits-list"><p>${esc(FILM.endCard[3])}</p><p>Seed-written invoice placeholder; statements are hand-written templates; audit agent paused.</p><p>Judge readings are a seed stand-in.</p></div></div></div><div id="end-card" class="clip" data-start="8" data-duration="8" data-track-index="1"><div class="content"><h1 class="headline">${esc(FILM.endCard[0])}</h1><p class="tagline">${esc(FILM.endCard[1])}</p><div class="limits-list">${FILM.endCard
      .slice(2, 4)
      .map((text) => `<p>${esc(text)}</p>`)
      .join("")}</div></div></div>`;
  const disclosure =
    beat.id === "arrival"
      ? FILM.firstCaption
      : beat.id === "limits"
        ? FILM.endCard[4]
        : beat.id === "listening"
          ? "Gemini TTS · Machine-translated, pending native review"
          : "";
  write(
    `compositions/${beat.id}.html`,
    `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"></head><body><template><style>#root{position:absolute;inset:0;width:100%;height:100%}</style><div id="root" data-no-timeline data-composition-id="${beat.id}" data-width="1920" data-height="1080" data-duration="${duration}"><section class="scene"><header class="header"><span>${esc(chapter)}</span><span class="season">2026-A</span></header><div class="content">${body}</div>${beat.id === "limits" ? "" : labels(beat)}</section><div class="simulation">Simulated PayPal sandbox</div>${disclosure ? `<div class="disclosure">${esc(disclosure)}</div>` : ""}</div></template></body></html>\n`,
  );
}
// Static, duration-driven hard cuts use the native HyperFrames clip runtime; no animation dependency or CDN.
write(
  "index.html",
  `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080"><title>${esc(FILM.title)} · Rough cut v1</title><link rel="stylesheet" href="film.css"></head><body><div id="root" data-no-timeline data-composition-id="main" data-fps="30" data-width="1920" data-height="1080" data-duration="${FILM.duration}">${beats.map((beat) => `<div id="scene-${beat.id}" class="clip" data-no-timeline data-composition-id="${beat.id}" data-start="${beat.start}" data-duration="${beat.end - beat.start}" data-composition-src="compositions/${beat.id}.html" data-track-index="0" data-width="1920" data-height="1080"></div>`).join("\n")}${captions.map((cue, i) => `<p id="caption-${i}" class="clip caption" data-track-kind="captions" data-caption-layer="fg" data-start="${cue.start}" data-duration="${Number((cue.end - cue.start).toFixed(6))}" data-track-index="8">${esc(cue.text)}</p>`).join("\n")}</div></body></html>\n`,
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
  `Built ${beats.length} scenes, ${captions.length} captions, ${slots.length} capture slots; ${FILM.duration}s; reading=${READING_VARIANT}. Project: ${fileURLToPath(root)}`,
);
