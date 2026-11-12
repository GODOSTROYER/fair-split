// Fair Split film v7: validate timing.json, audio/words.json and stills/stills.json, then write film-data.js
// (window.FILM_DATA), which index.html loads before film.js. Run it after any of the three changes:
//   node tools/sync.mjs            write film-data.js
//   node tools/sync.mjs --check    validate only, exit 1 on any problem
// The shapes are defined in CONTRACT.md. Nothing here reads outside video/film2.
import { closeSync, existsSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeStills } from "./stills-shape.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const problems = [];
const notes = [];
const problem = (text) => problems.push(text);

const readJson = (relative, fallback) => {
  const file = join(root, relative);
  if (!existsSync(file)) {
    if (fallback !== undefined) {
      notes.push(`${relative} is not there yet`);
      return fallback;
    }
    problem(`${relative} is missing`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    problem(`${relative} is not valid JSON: ${error.message}`);
    return fallback ?? null;
  }
};

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
// windows may fall on a tenth of a second (53.6): compare and add times in whole milliseconds
const r3 = (value) => Math.round(value * 1000) / 1000;
const same = (a, b) => Math.abs(a - b) < 1e-6;
const warnings = [];

/** Width and height of a PNG from its IHDR, without decoding it. */
const pngSize = (file) => {
  const handle = openSync(file, "r");
  try {
    const head = Buffer.alloc(24);
    readSync(handle, head, 0, 24, 0);
    if (head.readUInt32BE(0) !== 0x89504e47) return null;
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  } finally {
    closeSync(handle);
  }
};

const timing = readJson("timing.json");
const words = readJson("audio/words.json", { version: 1, estimated: true, sections: {} });
const stills = normalizeStills(readJson("stills/stills.json", null));

if (timing) {
  let cursor = 0;
  for (const section of timing.sections) {
    if (!same(section.start, cursor))
      problem(`timing.json: ${section.id} starts at ${section.start}, expected ${cursor}`);
    cursor = r3(section.start + section.duration);
    if (!existsSync(join(root, section.file))) problem(`timing.json: ${section.file} does not exist`);
  }
  if (!same(cursor, timing.duration))
    problem(`timing.json: sections end at ${cursor}, the film is ${timing.duration}`);
}

if (timing && words) {
  for (const section of timing.sections) {
    const entry = words.sections?.[section.id];
    if (!entry) {
      notes.push(`audio/words.json has no section ${section.id} yet`);
      continue;
    }
    const end = r3(section.start + section.duration);
    if (
      isNumber(entry.start) &&
      isNumber(entry.end) &&
      (entry.start < section.start - 1e-6 || entry.end > end + 1e-6)
    ) {
      problem(
        `audio/words.json ${section.id} is fitted to ${entry.start} to ${entry.end}, but the window is ${section.start} to ${end}: ` +
          "its word times are stale until SOUND re-fits it",
      );
      continue;
    }
    let last = section.start;
    entry.words.forEach((word, index) => {
      const where = `audio/words.json ${section.id} word ${index} ("${word.w}")`;
      if (typeof word.w !== "string" || !isNumber(word.start) || !isNumber(word.end)) {
        problem(`${where}: needs w, start and end`);
        return;
      }
      if (word.end < word.start) problem(`${where}: ends before it starts`);
      if (word.start < last - 1e-6) problem(`${where}: starts before the previous word starts`);
      if (word.start < section.start - 1e-6 || word.end > end + 1e-6)
        problem(
          `${where}: ${word.start} to ${word.end} is outside the section's window ${section.start} to ${end}`,
        );
      last = word.start;
    });
    if (!isNumber(entry.start) || !isNumber(entry.end) || typeof entry.clip !== "string")
      problem(
        `audio/words.json ${section.id}: needs clip (the file) and start and end (where the clip plays, film seconds)`,
      );
    else if (entry.start < section.start - 1e-6 || entry.end > end + 1e-6)
      problem(
        `audio/words.json ${section.id}: the clip plays ${entry.start} to ${entry.end}, outside the window ${section.start} to ${end}`,
      );
    if (section.id === "s4")
      for (const name of ["4a", "4b", "4c", "4d", "4e", "4f", "4g", "4h"])
        if (!isNumber(entry.lines?.[name]?.start) || !isNumber(entry.lines?.[name]?.end))
          problem(`audio/words.json s4: needs lines["${name}"] with start and end`);
    if (entry.words.length > 0) {
      const first = entry.words[0].start - section.start;
      const tail = end - entry.words[entry.words.length - 1].end;
      // air is the director's call with SOUND (s3 and s5 end on about 0.4 s by design): say so, do not fail
      if (first < 0.4 - 1e-6)
        warnings.push(
          `audio/words.json ${section.id}: ${first.toFixed(2)} s of air before the first word (0.4 is usual)`,
        );
      if (tail < 0.6 - 1e-6)
        warnings.push(
          `audio/words.json ${section.id}: ${tail.toFixed(2)} s of air after the last word (0.6 is usual)`,
        );
    }
  }
}

if (timing && stills) {
  for (const [id, still] of Object.entries(stills.stills ?? {})) {
    const where = `stills/stills.json "${id}"`;
    if (
      typeof still.file !== "string" ||
      !isNumber(still.width) ||
      !isNumber(still.height) ||
      !isNumber(still.scale)
    ) {
      problem(`${where}: needs file, width, height and scale`);
      continue;
    }
    const file = join(root, "stills", still.file);
    if (!existsSync(file)) {
      problem(`${where}: stills/${still.file} does not exist`);
      continue;
    }
    const size = pngSize(file);
    if (!size) problem(`${where}: stills/${still.file} is not a PNG`);
    else if (
      Math.abs(size.width - still.width * still.scale) > 2 ||
      Math.abs(size.height - still.height * still.scale) > 2
    )
      problem(
        `${where}: the PNG is ${size.width}x${size.height}, but width x scale is ` +
          `${Math.round(still.width * still.scale)}x${Math.round(still.height * still.scale)}`,
      );
    for (const [name, box] of Object.entries(still.boxes ?? {})) {
      if (![box.x, box.y, box.w, box.h].every(isNumber))
        problem(`${where} box "${name}": needs x, y, w and h`);
      else if (
        box.x < 0 ||
        box.y < 0 ||
        box.x + box.w > still.width + 0.5 ||
        box.y + box.h > still.height + 0.5
      )
        problem(`${where} box "${name}": lies outside the still's ${still.width}x${still.height} CSS px`);
    }
  }
}

// index.html follows timing.json (the section mounts) and audio/words.json (where each narration clip plays),
// so a change of windows or a new narration fit needs no hand edit: run this and it is in.
if (timing) {
  const index = join(root, "index.html");
  let html = readFileSync(index, "utf8");
  const before = html;
  for (const section of timing.sections) {
    const end = r3(section.start + section.duration);
    html = html.replace(
      new RegExp(`(<div id="sec-${section.id}" [^>]*?)data-start="[^"]*" data-duration="[^"]*"`),
      `$1data-start="${section.start}" data-duration="${section.duration}"`,
    );
    const entry = words?.sections?.[section.id];
    const fits =
      entry &&
      isNumber(entry.start) &&
      isNumber(entry.end) &&
      entry.start >= section.start - 1e-6 &&
      entry.end <= end + 1e-6;
    const start = fits ? entry.start : section.start;
    const length = Math.round(((fits ? entry.end : end) - start) * 1000) / 1000;
    const clip = entry?.clip
      ? entry.clip.startsWith("audio/")
        ? entry.clip
        : `audio/${entry.clip}`
      : `audio/narration/${section.id}.m4a`;
    html = html.replace(
      new RegExp(`(<audio id="vo-${section.id}" )src="[^"]*" data-start="[^"]*" data-duration="[^"]*"`),
      `$1src="${clip}" data-start="${start}" data-duration="${length}"`,
    );
    // a section file states its own length; it must be the window's
    const file = join(root, section.file);
    if (existsSync(file)) {
      const own = /data-composition-id="[^"]*"[^>]*data-duration="([^"]*)"/.exec(
        readFileSync(file, "utf8"),
      )?.[1];
      if (own !== undefined && !same(Number(own), section.duration))
        problem(
          `${section.file}: its root says data-duration="${own}", the window is ${section.duration} s (timing.json)`,
        );
    }
  }
  html = html.replace(/(<div id="root" [^>]*?data-duration=")[^"]*(")/, `$1${timing.duration}$2`);
  // the music bed and the effects stem run the whole film
  html = html.replace(
    /(<audio id="(?:music-bed|sfx-stem)" [^>]*?data-duration=")[^"]*(")/g,
    `$1${timing.duration}$2`,
  );
  if (html !== before && !checkOnly) {
    writeFileSync(index, html);
    console.log("sync: index.html updated from timing.json and audio/words.json");
  } else if (html !== before)
    problem("index.html is behind timing.json or audio/words.json: run node tools/sync.mjs");
}
// --list: what a scene builder can mount
if (process.argv.includes("--list") && timing) {
  for (const [id, still] of Object.entries(stills.stills)) {
    const flagged = still.flags?.length
      ? `  DISCLOSURE WORDS INSIDE: ${still.flags.map((flag) => flag.text ?? flag).join(", ")}`
      : "";
    console.log(
      `${id}  ${still.kind}  ${Math.round(still.width)}x${Math.round(still.height)} CSS px at ${still.scale}x  ` +
        `(show up to ${Math.floor(still.width * (still.scale / timing.outputScale))} px wide)${flagged}`,
    );
    const names = Object.keys(still.boxes ?? {});
    if (names.length > 0) console.log(`    boxes: ${names.join("  ")}`);
  }
}

for (const note of notes) console.log(`note: ${note}`);
for (const text of warnings) console.log(`warn: ${text}`);
if (problems.length > 0) {
  for (const text of problems) console.error(`sync: ${text}`);
  console.error(
    `sync: ${problems.length} problem(s)${checkOnly ? "" : "; film-data.js was still written so the film plays"}`,
  );
}
if (!checkOnly && timing) {
  const body =
    "/* Generated by tools/sync.mjs from timing.json, audio/words.json and stills/stills.json. Do not edit. */\n" +
    `window.FILM_DATA = ${JSON.stringify({ timing, words, stills })};\n`;
  const target = join(root, "film-data.js");
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (current !== body) {
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, body);
    renameSync(temporary, target);
  }
  const wordCount = Object.values(words?.sections ?? {}).reduce((sum, entry) => sum + entry.words.length, 0);
  console.log(
    `sync: film-data.js ${current === body ? "is current" : "written"} ` +
      `(${wordCount} words${words?.estimated ? ", ESTIMATED times" : ""}, ${Object.keys(stills?.stills ?? {}).length} stills)`,
  );
}
process.exit(problems.length > 0 ? 1 : 0);
