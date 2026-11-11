// Film v7 narration: the chosen Gemini TTS takes (audio/narration/takes.json) become audio/narration/<section>.m4a
// (and a WAV master beside it, git-ignored), audio/words.json (every word in film seconds) and audio/captions.vtt.
// Adapted from video/tools/narration.mjs (the v5 film): same loudness chain, same alignment; the pause edits are
// now worked out here instead of typed by hand.
//
//   node video/film2/tools/sound-narration.mjs <takes-dir> <asr-dir> [--check]
//
// <takes-dir>: raw takes <unit>-t<n>.wav and requests.json (sound-tts.mjs); <asr-dir>: local Whisper JSON with word
// timestamps, <unit>-t<n>.json. --check stops after the listening report (no file is written).
//
// Per section: (1) the transcript is aligned to the script's own words (character alignment) and every word that
// was heard differently is listed; (2) the pauses in the take are measured (under -45 dBFS for 0.08 s or more) and
// named by what they follow (a paragraph, a full stop, a colon, a comma); (3) each pause gets a length that makes
// the section fit its window with the air it must keep: silence is inserted into, or cut out of the middle of, an
// existing pause. The voice itself is never stretched, squeezed or re-pitched. (4) The take is trimmed to 0.10 s
// before its first sound and 0.25 s after its last, levelled to -16 LUFS / -1.5 dBTP, and placed so its first
// sound falls `air.start` after the window opens. Offline: ffmpeg only; no Gemini request is made here.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const film = new URL("../", import.meta.url);
const audio = new URL("audio/", film);
const dir = new URL("narration/", audio);
const work = new URL("work/", audio);
const FFMPEG = process.env.HYPERFRAMES_FFMPEG_PATH ?? "ffmpeg";
const takes = JSON.parse(readFileSync(new URL("takes.json", dir), "utf8"));
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const [takesDir, asrDir] = args.filter((a) => !a.startsWith("--")).map((a) => resolve(a));
if (!takesDir || !asrDir) throw new Error("usage: sound-narration.mjs <takes-dir> <asr-dir> [--check]");
const r3 = (v) => Math.round(v * 1000) / 1000;
const spoken = (say) => say.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
const FILM = takes.duration;
// --keep s1,s2: sections whose clips are left exactly as they are on disk (their words must not have moved)
const keep = new Set((args.find((a) => a.startsWith("--keep="))?.slice(7) ?? "").split(",").filter(Boolean));

function ffmpeg(a) {
  const run = spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-y", ...a], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr.slice(-800)}`);
  return run.stderr;
}
function readWav(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE")
    throw new Error("not a WAV");
  let rate = 0;
  let channels = 0;
  let data = null;
  for (let at = 12; at + 8 <= buffer.length; ) {
    const id = buffer.toString("ascii", at, at + 4);
    const size = buffer.readUInt32LE(at + 4);
    if (id === "fmt ") {
      channels = buffer.readUInt16LE(at + 10);
      rate = buffer.readUInt32LE(at + 12);
      if (buffer.readUInt16LE(at + 8) !== 1 || buffer.readUInt16LE(at + 22) !== 16)
        throw new Error("not 16-bit PCM");
    }
    if (id === "data") data = buffer.subarray(at + 8, Math.min(buffer.length, at + 8 + size));
    at += 8 + size + (size % 2);
  }
  if (!data || channels !== 1) throw new Error("expected mono PCM");
  const samples = new Int16Array(Math.floor(data.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2);
  return { rate, samples };
}
function writeWav(rate, samples) {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + samples.length * 2, 4);
  out.write("WAVEfmt ", 8, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) out.writeInt16LE(samples[i], 44 + i * 2);
  return out;
}
function loudness(path) {
  const log = ffmpeg(["-i", path, "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"]);
  const summary = log.slice(log.lastIndexOf("Summary"));
  return {
    lufs: Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]),
    peak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]),
  };
}
/** dBFS (RMS) of each 10 ms frame. */
function frames({ rate, samples }) {
  const n = Math.round(rate / 100);
  const out = [];
  for (let i = 0; i * n < samples.length; i++) {
    let sum = 0;
    const end = Math.min(samples.length, (i + 1) * n);
    for (let k = i * n; k < end; k++) sum += (samples[k] / 32768) ** 2;
    out.push(10 * Math.log10(sum / (end - i * n) + 1e-12));
  }
  return out;
}
/** First and last sound (over -45 dBFS), and the pauses between them: [start, end] in seconds, 0.08 s or longer. */
function shape(wav) {
  const db = frames(wav);
  const first = db.findIndex((v) => v > -45);
  const last = db.findLastIndex((v) => v > -45);
  if (first < 0) throw new Error("silent take");
  const pauses = [];
  for (let i = first, from = -1; i <= last + 1; i++) {
    const quiet = i <= last && db[i] <= -45;
    if (quiet && from < 0) from = i;
    if (!quiet && from >= 0) {
      if (i - from >= 8) pauses.push([from / 100, i / 100]);
      from = -1;
    }
  }
  return { speech: [first / 100, (last + 1) / 100], pauses, db };
}

// ------------------------------------------------------------------------------------------------- alignment
const ONES =
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(
    " ",
  );
const TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
function numberWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberWords(n % 100)}` : ""}`;
  return `${numberWords(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${numberWords(n % 1000)}` : ""}`;
}
function letters(word) {
  return word
    .toLowerCase()
    .replace(/\$(\d[\d,]*)/g, (_, n) => `${n} dollars`)
    .replace(/\d[\d,]*/g, (n) => ` ${numberWords(Number(n.replaceAll(",", "")))} `)
    .replace(/[^a-z]/g, "");
}
function alignChars(a, b) {
  const n = a.length;
  const m = b.length;
  const d = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const map = new Int32Array(n).fill(-1);
  for (let i = n, j = m; i > 0 && j >= 0; ) {
    if (j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      map[i - 1] = j - 1;
      i--;
      j--;
    } else if (d[i][j] === d[i - 1][j] + 1) i--;
    else j--;
  }
  return { map, distance: d[n][m] };
}
/** Script words -> { start, end } in the take, from the transcript's word times, snapped to the measured pauses. */
function alignWords(script, heard, quiet, speech) {
  const a = script.map(letters);
  const b = heard.map((word) => letters(word.word));
  const owner = (parts) => parts.flatMap((part, k) => Array.from(part, () => k));
  const [ownA, ownB] = [owner(a), owner(b)];
  const { map, distance } = alignChars(a.join(""), b.join(""));
  const sharers = new Map();
  const hitsOf = script.map((_, k) => [
    ...new Set([...map.keys()].filter((i) => ownA[i] === k && map[i] >= 0).map((i) => ownB[map[i]])),
  ]);
  hitsOf.forEach((hits, k) => {
    if (hits.length === 1) sharers.set(hits[0], [...(sharers.get(hits[0]) ?? []), k]);
  });
  const times = script.map((_, k) => {
    const hits = hitsOf[k];
    if (!hits.length) return null;
    const share = hits.length === 1 ? sharers.get(hits[0]) : null;
    if (share && share.length > 1) {
      const h = heard[hits[0]];
      const total = share.reduce((sum, j) => sum + a[j].length, 0);
      const before = share.slice(0, share.indexOf(k)).reduce((sum, j) => sum + a[j].length, 0);
      const span = h.end - h.start;
      return {
        start: h.start + (span * before) / total,
        end: h.start + (span * (before + a[k].length)) / total,
      };
    }
    return {
      start: Math.min(...hits.map((i) => heard[i].start)),
      end: Math.max(...hits.map((i) => heard[i].end)),
    };
  });
  for (const [k, t] of times.entries()) {
    if (!t) continue;
    for (const [q0, q1] of quiet) {
      if (q1 - q0 < 0.1) continue;
      if (t.start >= q0 - 0.02 && t.start < q1) t.start = q1;
      if (t.end > q0 && t.end <= q1 + 0.02) t.end = q0;
      if (q1 - q0 >= 0.2 && t.start < q0 && t.end > q1) {
        if (/[,.;:]$/.test(script[k - 1] ?? "")) t.start = q1;
        else if (/[,.;:]$/.test(script[k])) t.end = q0;
      }
    }
    if (t.end <= t.start) t.end = t.start + 0.05;
  }
  for (const [k, t] of times.entries()) {
    const next = times[k + 1];
    if (t && next && /[,.;:]$/.test(script[k]) && t.end > next.start) t.end = next.start;
  }
  for (let k = 0; k < times.length; k++) {
    if (times[k]) continue;
    const prev = times.slice(0, k).findLast(Boolean);
    const next = times.slice(k + 1).find(Boolean);
    const lo = prev?.end ?? speech[0];
    const hi = next?.start ?? speech[1];
    times[k] = { start: lo, end: Math.max(lo, hi) };
  }
  const [s0, s1] = speech;
  times[0].start = s0;
  times.at(-1).end = s1;
  let floor = s0;
  for (const t of times) {
    t.start = Math.min(Math.max(t.start, floor), s1);
    t.end = Math.min(Math.max(t.end, t.start + 0.02), s1);
    floor = t.start;
  }
  // what the transcriber wrote for each script word, where it differs
  const questioned = [];
  script.forEach((w, k) => {
    const got = hitsOf[k].map((i) => heard[i]);
    const text = got.map((h) => h.word.trim()).join(" ");
    const same = share(k) ? true : letters(text) === a[k];
    const low = got.length ? Math.min(...got.map((h) => h.probability ?? 1)) : 0;
    if (!same || low < 0.5) questioned.push({ k, w, heard: text || "(nothing)", probability: r3(low), same });
  });
  function share(k) {
    const hits = hitsOf[k];
    const s = hits.length === 1 ? sharers.get(hits[0]) : null;
    if (!s || s.length < 2) return false;
    return letters(heard[hits[0]].word) === s.map((j) => a[j]).join("");
  }
  return { times, cer: r3(distance / a.join("").length), questioned };
}

// ----------------------------------------------------------------------------------------------- one section
// between paragraphs at least half a second; spare time goes to those gaps first, then to the full stops, and half a
// second of it stays as extra air at the end
const FIT = {
  paraMin: 0.5,
  paraMax: 1.2,
  paraShare: 0.75,
  sentenceMin: 0.35,
  sentenceMax: 1.1,
  endAirExtra: 0.5,
};
const FLOOR = { para: 0.45, sentence: 0.28, colon: 0.15, comma: 0.1 };

function loadSection(id) {
  const section = takes.sections[id];
  const use = section.use ?? [{ unit: id, take: 1 }];
  // The units of a split section follow each other with half a second of silence between them. A unit may give
  // only part of what it read (`say`: the run of its words to keep): it is cut in the middle of the pause before
  // and after that run, never inside speech, so a changed sentence or line is replaced without touching the rest.
  let rate = 0;
  const parts = [];
  const heard = [];
  const kept = [];
  let offset = 0;
  let midBefore = false;
  for (const [n, u] of use.entries()) {
    const wav = readWav(readFileSync(join(takesDir, `${u.unit}-t${u.take}.wav`)));
    rate ||= wav.rate;
    if (wav.rate !== rate) throw new Error(`${id}: takes at different rates`);
    const raw = shape(wav);
    const { speech } = raw;
    const asr = JSON.parse(readFileSync(join(asrDir, `${u.unit}-t${u.take}.json`), "utf8"));
    const all = asr.segments.flatMap((seg) => seg.words ?? []);
    const sent = log.find((e) => e.unit === u.unit && e.take === u.take && e.ok);
    if (!sent) throw new Error(`${u.unit} take ${u.take}: no request on record`);
    const unitWords = spoken(sent.text);
    let a = 0;
    let b = unitWords.length - 1;
    if (u.say) {
      const want = spoken(u.say);
      a = unitWords.findIndex((_, i) => want.every((w, j) => unitWords[i + j] === w));
      if (a < 0) throw new Error(`${u.unit} take ${u.take} did not read "${u.say}"`);
      b = a + want.length - 1;
    }
    let from = n === 0 ? 0 : Math.round(Math.max(0, speech[0] - 0.02) * rate);
    let to = n === use.length - 1 ? wav.samples.length : Math.round((speech[1] + 0.02) * rate);
    const [midStart, midEnd] = [a > 0, b < unitWords.length - 1];
    if (midStart || midEnd) {
      const { times } = alignWords(unitWords, all, raw.pauses, speech);
      const cutAfter = (i) => {
        const lo = times[i].start;
        const hi = times[Math.min(times.length - 1, i + 2)].end;
        const [pause] = raw.pauses
          .filter(([q0, q1]) => (q0 + q1) / 2 > lo && (q0 + q1) / 2 < hi)
          .sort((x, y) => y[1] - y[0] - (x[1] - x[0]));
        if (!pause || pause[1] - pause[0] < 0.2)
          throw new Error(`${u.unit}: no pause to cut at after "${unitWords[i]}"`);
        return Math.round(((pause[0] + pause[1]) / 2) * rate);
      };
      if (midStart) from = cutAfter(a - 1);
      if (midEnd) to = cutAfter(b);
    }
    const gap =
      n === 0 ? 0 : Math.round((midBefore && midStart ? 0 : midBefore || midStart ? 0.25 : 0.5) * rate);
    midBefore = midEnd;
    const shift = offset + gap - from;
    // (only a cut side leaves words out; the transcriber may stretch the word after a pause back across it, so a
    // word belongs to the side its end falls on)
    for (const w of all) {
      const end = w.end * rate;
      if ((midStart && end <= from + 0.05 * rate) || (midEnd && end > to + 0.05 * rate)) continue;
      heard.push({ ...w, start: w.start + shift / rate, end: w.end + shift / rate });
    }
    parts.push(new Int16Array(gap), wav.samples.subarray(from, to));
    offset += gap + (to - from);
    kept.push(...unitWords.slice(a, b + 1));
  }
  if (kept.join(" ") !== section.paragraphs.flatMap((text) => spoken(text)).join(" "))
    throw new Error(`${id}: the takes in use do not read today's words`);
  const samples = new Int16Array(offset);
  let at = 0;
  for (const p of parts) {
    samples.set(p, at);
    at += p.length;
  }
  const words = section.paragraphs.flatMap((text, p) => spoken(text).map((w) => ({ w, p })));
  return { id, section, use, wav: { rate, samples }, heard, words };
}

function fit(loaded) {
  const { id, section, wav, heard, words } = loaded;
  const { rate } = wav;
  const cfg = { sentenceKeep: 0.8, ...FIT, ...(section.fit ?? {}) };
  const raw = shape(wav);
  const script = words.map((x) => x.w);
  const { times, cer, questioned } = alignWords(script, heard, raw.pauses, raw.speech);
  // name each pause by the word it follows
  const kindAfter = (k) =>
    words[k].p !== words[k + 1]?.p
      ? "para"
      : /[.?!]["')]?$/.test(script[k])
        ? "sentence"
        : /[:;]$/.test(script[k])
          ? "colon"
          : /,$/.test(script[k])
            ? "comma"
            : "none";
  const pauses = [];
  // The transcriber sometimes glues a short word that opens a sentence ("A", "The") to the end of the one before,
  // so the pause seems to follow it. The voice pauses at the full stop: the word moves to the far side of the pause.
  for (const [q0, q1] of raw.pauses) {
    if (q1 - q0 < 0.25) continue;
    const k = times.findLastIndex((t) => t.start < (q0 + q1) / 2);
    if (k < 1 || k >= times.length - 1 || kindAfter(k) !== "none" || times[k].end > q0 + 0.03) continue;
    if (!["para", "sentence"].includes(kindAfter(k - 1)) || letters(script[k]).length > 4) continue;
    if (
      raw.pauses.some(([a, b]) => b - a >= 0.2 && a >= times[k - 1].end - 0.05 && b <= times[k].start + 0.05)
    )
      continue;
    const len = Math.min(0.12, Math.max(0.05, (times[k + 1].end - q1) / 3));
    times[k - 1].end = Math.min(q0, Math.max(times[k - 1].end, times[k].end));
    times[k] = { start: q1, end: q1 + len };
    times[k + 1].start = Math.max(times[k + 1].start, q1 + len);
    console.warn(`${id}: "${script[k]}" moved after the pause that follows "${script[k - 1]}"`);
  }
  for (const [q0, q1] of raw.pauses) {
    const mid = (q0 + q1) / 2;
    const k = times.findLastIndex((t) => t.start < mid);
    if (k < 0 || k >= times.length - 1) continue;
    const inner = times[k].end > q1 + 0.03; // a quiet stretch inside a word (a stop consonant): left alone
    pauses.push({ k, q0, q1, nat: q1 - q0, kind: inner ? "inner" : kindAfter(k) });
  }
  // a paragraph or sentence that the voice ran straight through: its quietest 10 ms becomes the edit point
  for (let k = 0; k < words.length - 1; k++) {
    const kind = kindAfter(k);
    if ((kind !== "para" && kind !== "sentence") || pauses.some((p) => p.k === k && p.kind === kind))
      continue;
    const a = Math.max(0, Math.round((times[k].end - 0.08) * 100));
    const b = Math.round((times[k + 1].start + 0.08) * 100);
    let best = a;
    for (let i = a; i <= b; i++) if (raw.db[i] < raw.db[best]) best = i;
    if (raw.db[best] > -38) {
      console.warn(`${id}: no pause after "${script[k]}" (quietest point ${raw.db[best].toFixed(0)} dBFS)`);
      continue;
    }
    pauses.push({ k, q0: best / 100, q1: (best + 1) / 100, nat: 0.01, kind, made: true });
  }
  pauses.sort((x, y) => x.q0 - y.q0);
  // a boundary the voice paused at twice (a breath between two quiet stretches): the longer stretch is the one
  // edited, the other stays as it is and counts towards the boundary's length (`extra`)
  for (const p of pauses) {
    if (p.kind !== "para" && p.kind !== "sentence") continue;
    const same = pauses.filter((x) => x.k === p.k && x.kind === p.kind);
    if (same.length < 2) continue;
    const main = same.reduce((a, b) => (b.nat > a.nat ? b : a));
    main.extra = same.filter((x) => x !== main).reduce((s, x) => s + x.nat, 0);
    for (const x of same) if (x !== main) x.kind = "inner";
  }
  for (const p of pauses) p.extra ??= 0;
  // what each pause should be
  // the air is measured to the clip's audible ends: 0.10 s of lead-in before the first word and 0.25 s of tail
  const [LEAD, TAIL] = [0.1, 0.25];
  // (`endBy`: the film second the last word must have ended by, when the picture needs the time after it)
  // (a section may state its own air: the retimed film's windows were drawn round takes that already existed)
  const air = { start: cfg.airStart ?? takes.air.start, end: cfg.airEnd ?? takes.air.end };
  const budget = Math.min(
    section.window[1] - section.window[0] - air.start - air.end - LEAD - TAIL,
    (cfg.endBy ?? Number.POSITIVE_INFINITY) - (section.window[0] + air.start + LEAD),
  );
  for (const p of pauses) {
    p.want =
      p.kind === "para"
        ? Math.max(0.05, cfg.paraMin - p.extra)
        : p.kind === "sentence"
          ? Math.max(p.nat, cfg.sentenceMin - p.extra)
          : p.nat;
    if (p.kind === "sentence" && p.nat + p.extra > cfg.sentenceKeep)
      p.want = Math.max(0.05, cfg.sentenceKeep - p.extra);
  }
  // `set`: pauses given outright, by the word they follow ("copy." or "Split.#2" for its second occurrence): the
  // gaps between a section's lines, or a section whose placement is kept from an earlier build. They are not
  // touched by the fitting below; `frozen` leaves every other pause as the voice made it.
  for (const [key, seconds] of Object.entries(cfg.set ?? {})) {
    const [token, nth = "1"] = key.split("#");
    const ks = script.map((w, k) => (w === token ? k : -1)).filter((k) => k >= 0);
    const k = ks[Number(nth) - 1];
    const p = pauses.filter((x) => x.k === k && x.kind !== "inner").sort((x, y) => y.nat - x.nat)[0];
    if (k === undefined || !p) throw new Error(`${id}: no pause after "${key}" to set`);
    p.want = Math.max(0.03, seconds - p.extra);
    p.fixed = true;
  }
  const floorOf = (p) => (p.fixed ? p.want : (FLOOR[p.kind] ?? p.want));
  const voiced = raw.speech[1] - raw.speech[0] - pauses.reduce((s, p) => s + p.nat, 0);
  const length = () => voiced + pauses.reduce((s, p) => s + p.want, 0);
  let over = length() - budget;
  if (cfg.frozen) {
    // placed as recorded and as set: nothing is fitted
  } else if (over > 0) {
    // too long: every pause gives up the same share of what it has above its floor
    const room = pauses.reduce((s, p) => s + Math.max(0, p.want - floorOf(p)), 0);
    const take = Math.min(1, over / (room || 1));
    for (const p of pauses) p.want -= Math.max(0, p.want - floorOf(p)) * take;
    over = length() - budget;
  } else {
    // room to spare: first the gaps between paragraphs (the demo's lines, the rules), then the full stops; what is
    // left stays as air at the end
    let slack = -over - cfg.endAirExtra;
    const paras = pauses.filter((p) => p.kind === "para" && !cfg.anchor && !p.fixed);
    if (paras.length && slack > 0) {
      const each = Math.min(cfg.paraMax - cfg.paraMin, (slack * cfg.paraShare) / paras.length);
      for (const p of paras) p.want += each;
      slack -= each * paras.length;
    }
    const stops = pauses.filter((p) => p.kind === "sentence" && !p.fixed);
    for (let pass = 0; pass < 4 && slack > 0.01 && stops.length; pass++) {
      const open = stops.filter((p) => p.want + p.extra < cfg.sentenceMax - 1e-6);
      if (!open.length) break;
      const each = slack / open.length;
      for (const p of open) {
        const add = Math.min(each, cfg.sentenceMax - p.want - p.extra);
        p.want += add;
        slack -= add;
      }
    }
  }
  // an anchored paragraph (the last "Fair Split."): the pause before it grows until its first word is on its time
  const start = section.window[0] + air.start + LEAD;
  const filmAt = (t) =>
    start +
    (t - raw.speech[0]) +
    pauses.filter((p) => (p.q0 + p.q1) / 2 < t).reduce((s, p) => s + p.want - p.nat, 0);
  // Pinned paragraphs (lines the scenes already time to): after a line is re-recorded its length changes, so the
  // full stop inside the line before the pin takes up the difference and the 1.2 s gap between lines stays; only
  // what that pause cannot take (it stays between 0.35 and 1.4 s) goes to the gap.
  const pinned = [];
  for (const [para, at] of Object.entries(cfg.pins ?? {}).sort((x, y) => x[0] - y[0])) {
    const k = words.findIndex((x) => x.p === Number(para));
    let d = at - filmAt(times[k].start);
    if (Math.abs(d) >= 0.002) {
      const inside = pauses.filter((p) => p.kind === "sentence" && words[p.k].p === Number(para) - 1).at(-1);
      if (inside) {
        const next = Math.min(1.4 - inside.extra, Math.max(0.35 - inside.extra, inside.want + d));
        d -= next - inside.want;
        inside.want = next;
      }
      const gap = pauses.find((p) => p.k === k - 1 && p.kind === "para");
      if (!gap || gap.want + d < FLOOR.para)
        throw new Error(`${id}: paragraph ${para} cannot start at ${at}`);
      gap.want += d;
    }
    pinned.push({ paragraph: Number(para), wanted: at, at: r3(filmAt(times[k].start)) });
  }
  let anchored = null;
  if (cfg.anchor) {
    const k = words.findIndex((x) => x.p === cfg.anchor.paragraph);
    const before = pauses.find((p) => p.k === k - 1 && p.kind === "para");
    if (!before) throw new Error(`${id}: no pause before the anchored paragraph`);
    for (const p of pauses) if (p.kind === "para" && p !== before) p.want = cfg.anchor.after ?? 0.7;
    const now = filmAt(times[k].start);
    before.want += Math.max(FLOOR.para - before.want, cfg.anchor.at - now);
    anchored = { word: script[k], wanted: cfg.anchor.at, at: r3(filmAt(times[k].start)) };
  }
  const total = length();
  const fits = total <= budget + 1e-6;
  // how fast the voice itself moves, paragraph by paragraph (letters a second, pauses left out): a long take that
  // speeds up shows here
  const rates = [...new Set(words.map((x) => x.p))].map((p) => {
    const ks = words.map((x, k) => (x.p === p ? k : -1)).filter((k) => k >= 0);
    const [a, b] = [times[ks[0]].start, times[ks.at(-1)].end];
    const quiet = pauses.filter((q) => q.q0 >= a && q.q1 <= b).reduce((s, q) => s + q.nat, 0);
    const chars = ks.reduce((s, k) => s + letters(script[k]).length, 0);
    return Math.round((chars / (b - a - quiet)) * 10) / 10;
  });
  // the edit: latest pause first, so earlier positions stay valid
  let samples = wav.samples;
  for (const p of [...pauses].sort((x, y) => y.q0 - x.q0)) {
    const delta = p.want - p.nat;
    const n = Math.round(Math.abs(delta) * rate);
    if (!n) continue;
    const k = Math.round(((p.q0 + p.q1) / 2) * rate);
    if (delta > 0) {
      // The takes are not digitally silent between words (a floor near -55 dBFS), so a longer pause is filled with
      // the pause's own floor, played forwards and backwards from the edit point, not with dead silence.
      const a = Math.round((p.q0 + 0.03) * rate);
      const b = Math.round((p.q1 - 0.03) * rate);
      const fill = new Int16Array(n);
      if (b - a > rate * 0.05) {
        let pos = Math.min(b - 1, Math.max(a, k));
        let step = 1;
        for (let i = 0; i < n; i++) {
          fill[i] = samples[pos];
          if (pos + step >= b || pos + step < a) step = -step;
          pos += step;
        }
      }
      const next = new Int16Array(samples.length + n);
      next.set(samples.subarray(0, k), 0);
      next.set(fill, k);
      next.set(samples.subarray(k), k + n);
      samples = next;
    } else {
      if (n > (p.nat - 0.03) * rate)
        throw new Error(`${id}: the cut after "${script[p.k]}" is longer than its pause`);
      const from = k - Math.floor(n / 2);
      const next = new Int16Array(samples.length - n);
      next.set(samples.subarray(0, from), 0);
      next.set(samples.subarray(from + n), from);
      samples = next;
    }
  }
  const edited = shape({ rate, samples });
  const from = Math.max(0, Math.round((edited.speech[0] - LEAD) * rate));
  const to = Math.min(samples.length, Math.round((edited.speech[1] + TAIL) * rate));
  // the clip is the whole window: clip time 0 is the section's start (the lead's index.html plays it that way), with
  // silence for the air before the first sound and after the last
  const clip = new Int16Array(Math.round((section.window[1] - section.window[0]) * rate));
  const lead = Math.round(air.start * rate);
  if (lead + (to - from) > clip.length - Math.round(air.end * rate) + 1 && fits)
    throw new Error(`${id}: the take does not sit inside its window`);
  const piece = samples.slice(from, Math.min(to, from + clip.length - lead));
  // the take's own floor comes in and goes out over its lead-in and tail, so nothing sounds inside the air
  const [fin, fout] = [Math.round(0.08 * rate), Math.round(0.2 * rate)];
  for (let i = 0; i < fin; i++) piece[i] = Math.round(piece[i] * (i / fin));
  for (let i = 0; i < fout; i++)
    piece[piece.length - 1 - i] = Math.round(piece[piece.length - 1 - i] * (i / fout));
  clip.set(piece, lead);
  const wordsOut = words.map((x, k) => ({
    w: x.w,
    start: r3(filmAt(times[k].start)),
    end: r3(filmAt(times[k].end)),
    ...(section.lines?.[x.p] ? { line: section.lines[x.p] } : {}),
  }));
  const speech = [r3(start), r3(start + edited.speech[1] - edited.speech[0])];
  wordsOut[0].start = speech[0];
  wordsOut.at(-1).end = speech[1];
  // in order, never overlapping (the lead's sync.mjs checks it)
  wordsOut.forEach((w, k) => {
    if (k > 0) w.start = Math.max(w.start, wordsOut[k - 1].end);
    w.end = Math.max(w.end, r3(w.start + 0.02));
  });
  wordsOut.at(-1).end = Math.max(speech[1], wordsOut.at(-1).start + 0.02);
  return {
    id,
    rate,
    trimmed: clip,
    clipStart: section.window[0],
    clipEnd: section.window[1],
    speech,
    words: wordsOut,
    paragraphs: words.map((x) => x.p),
    cer,
    questioned,
    heard: heard.map((w) => w.word.trim()).join(" "),
    pauses: pauses
      .filter((p) => p.kind !== "inner")
      .map((p) => ({
        after: script[p.k],
        kind: p.kind,
        at: r3((p.q0 + p.q1) / 2),
        was: r3(p.nat + p.extra),
        now: r3(p.want + p.extra),
        ...(p.made ? { made: true } : {}),
      })),
    rates,
    rawSeconds: r3(raw.speech[1] - raw.speech[0]),
    voicedSeconds: r3(voiced),
    fits,
    overSeconds: fits ? 0 : r3(total - budget),
    anchored,
    pinned,
  };
}

function encode(f) {
  mkdirSync(work, { recursive: true });
  const edit = fileURLToPath(new URL(`${f.id}-edit.wav`, work));
  writeFileSync(edit, writeWav(f.rate, f.trimmed));
  const t = takes.target;
  const wav = fileURLToPath(new URL(`${f.id}.wav`, dir));
  const file = `${f.id}.m4a`;
  const m4a = fileURLToPath(new URL(file, dir));
  let gain = t.lufs - loudness(edit).lufs + 2;
  let limit = t.truePeak - 1;
  let lufs = 0;
  let peak = 0;
  for (let pass = 0; pass < 12; pass++) {
    const chain = `acompressor=threshold=0.1:ratio=2:attack=5:release=60:knee=4,volume=${gain.toFixed(2)}dB,aresample=192000:resampler=soxr,alimiter=limit=${(10 ** (limit / 20)).toFixed(4)}:attack=5:release=40:level=false,aresample=${t.rate}:resampler=soxr,afade=t=in:d=0.01`;
    ffmpeg(["-i", edit, "-af", chain, "-ar", String(t.rate), "-ac", "1", "-c:a", "pcm_s16le", wav]);
    ffmpeg([
      "-i",
      wav,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      String(t.rate),
      "-ac",
      "1",
      "-map_metadata",
      "-1",
      "-fflags",
      "+bitexact",
      "-flags:a",
      "+bitexact",
      "-movflags",
      "+faststart",
      m4a,
    ]);
    ({ lufs, peak } = loudness(m4a));
    if (peak > t.truePeak) limit -= peak - t.truePeak + 0.2;
    else if (Math.abs(lufs - t.lufs) > 0.3) gain += t.lufs - lufs;
    else break;
  }
  if (peak > t.truePeak || Math.abs(lufs - t.lufs) > 0.5)
    throw new Error(`${f.id}: ${lufs} LUFS, ${peak} dBTP after twelve passes`);
  return { file, lufs, peak, sha256: createHash("sha256").update(readFileSync(m4a)).digest("hex") };
}

// --------------------------------------------------------------------------------------------------- captions
const stamp = (s) => {
  const ms = Math.round(s * 1000);
  const p = (v, n = 2) => String(v).padStart(n, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
};
/** One or two lines of at most 42 characters, split as near the middle as the words allow; null if it cannot be. */
function twoLines(text) {
  if (text.length <= 42) return [text];
  const parts = text.split(" ");
  let best = null;
  for (let i = 1; i < parts.length; i++) {
    const a = parts.slice(0, i).join(" ");
    const b = parts.slice(i).join(" ");
    if (a.length > 42 || b.length > 42) continue;
    const score = Math.abs(a.length - b.length) - (/[,.:;]$/.test(a) ? 6 : 0);
    if (!best || score < best.score) best = { score, lines: [a, b] };
  }
  return best?.lines ?? null;
}
function captions(sections) {
  const cues = [];
  for (const s of sections) {
    // sentences, then any that is too long for two lines or six seconds is cut at its commas and colons
    const groups = [];
    let cur = [];
    s.words.forEach((w, k) => {
      cur.push(w);
      if (/[.?!]["')]?$/.test(w.w) || s.paragraphs[k] !== s.paragraphs[k + 1]) {
        groups.push(cur);
        cur = [];
      }
    });
    if (cur.length) groups.push(cur);
    const ok = (g) => twoLines(g.map((w) => w.w).join(" ")) && g.at(-1).end - g[0].start <= 6;
    const chars = (g) => g.map((w) => w.w).join(" ").length;
    const split = (g) => {
      if (ok(g) || g.length < 2) return [g];
      // cut nearest the middle, at a comma or colon where there is one
      let best = 1;
      let bestScore = Number.POSITIVE_INFINITY;
      for (let i = 1; i < g.length; i++) {
        const score =
          Math.abs(chars(g.slice(0, i)) - chars(g.slice(i))) - (/[,:;]$/.test(g[i - 1].w) ? 30 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
      return [...split(g.slice(0, best)), ...split(g.slice(best))];
    };
    const pieces = groups.flatMap(split);
    // a cue shorter than a second joins its neighbour when the two still fit
    const merged = [];
    for (const g of pieces) {
      const last = merged.at(-1);
      const short = (x) => x.at(-1).end - x[0].start < 1.0;
      if (last && (short(g) || short(last)) && ok([...last, ...g]) && g[0].start - last.at(-1).end < 1.0)
        merged[merged.length - 1] = [...last, ...g];
      else merged.push(g);
    }
    for (const g of merged)
      cues.push({ start: g[0].start, end: g.at(-1).end, text: g.map((w) => w.w).join(" ") });
  }
  // hold each cue a little after its last word, at least a second, never into the next
  cues.forEach((c, i) => {
    const next = cues[i + 1]?.start ?? FILM;
    c.end = Math.min(Math.max(c.end + 0.25, c.start + 1.0), next - 0.04, c.start + 6);
  });
  const body = cues
    .map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${twoLines(c.text).join("\n")}`)
    .join("\n\n");
  return { cues, vtt: `WEBVTT\n\n${body}\n` };
}

// ------------------------------------------------------------------------------------------------------- main
const log = existsSync(join(takesDir, "requests.json"))
  ? JSON.parse(readFileSync(join(takesDir, "requests.json"), "utf8")).log
  : [];
const fitted = [];
for (const id of Object.keys(takes.sections)) {
  const loaded = loadSection(id);
  const f = fit(loaded);
  fitted.push(f);
  const n = f.words.length;
  const span = f.speech[1] - f.speech[0];
  const [w0, w1] = takes.sections[id].window;
  console.log(
    `\n${id}  ${n} words  raw speech ${f.rawSeconds} s (${Math.round((n / f.rawSeconds) * 60)} wpm; voiced only ${f.voicedSeconds} s = ${Math.round((n / f.voicedSeconds) * 60)} wpm)  fitted ${r3(span)} s (${Math.round((n / span) * 60)} wpm)  film ${f.speech[0]}-${f.speech[1]}  air ${r3(f.speech[0] - 0.1 - w0)} / ${r3(w1 - f.speech[1] - 0.25)} (to the clip's audible ends)  CER ${(f.cer * 100).toFixed(1)}%${f.fits ? "" : `  DOES NOT FIT: ${f.overSeconds} s over`}`,
  );
  console.log(`  heard: ${f.heard}`);
  console.log(`  letters a second, by paragraph: ${f.rates.join(", ")}`);
  for (const q of f.questioned)
    console.log(`  ? "${q.w}" heard as "${q.heard}"${q.same ? "" : " (differs)"} p=${q.probability}`);
  console.log(
    `  pauses: ${f.pauses.map((p) => `${p.after}${p.kind === "para" ? " ¶" : ""} ${p.was}→${p.now}${p.made ? "*" : ""}`).join(" | ")}`,
  );
  if (f.anchored)
    console.log(`  anchored "${f.anchored.word}" at ${f.anchored.at} (wanted ${f.anchored.wanted})`);
  if (f.pinned.length)
    console.log(`  pinned: ${f.pinned.map((p) => `¶${p.paragraph} ${p.at} (${p.wanted})`).join(", ")}`);
}
if (checkOnly) process.exit(0);

const manifest = {
  v: 2,
  synthetic: true,
  notice:
    "Synthetic narration: Gemini TTS (voice Charon) reading research/film-1111/script.md word for word. Disclosed on the end card as 'Voices: Gemini TTS'.",
  voice: takes.voice,
  model: takes.model,
  style: takes.style,
  target: takes.target,
  requests: log.length,
  sections: [],
};
// The lead's shape (tools/estimate-words.mjs, tools/sync.mjs): sections.<id> = { start, end (the window), clip
// (relative to audio/, clip time 0 = start), words: [{ w, start, end, line? }] }, film seconds; plus, for sound and
// scenes, `speech` (first and last sound), `lines` (section 4's 4a-4h, section 6's one-four) and `marks`.
const out = { version: 1, unit: "film seconds", duration: FILM, measured: true, sections: {}, marks: {} };
const before = {
  manifest: existsSync(new URL("manifest.json", dir))
    ? JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8"))
    : null,
  words: existsSync(new URL("words.json", audio))
    ? JSON.parse(readFileSync(new URL("words.json", audio), "utf8"))
    : null,
};
function kept(f) {
  const was = before.manifest?.sections.find((s) => s.section === f.id);
  if (!was || JSON.stringify(before.words?.sections[f.id]?.words) !== JSON.stringify(f.words))
    throw new Error(`${f.id}: cannot be kept, its words have moved`);
  const sha256 = createHash("sha256")
    .update(readFileSync(new URL(was.file, dir)))
    .digest("hex");
  if (sha256 !== was.sha256) throw new Error(`${f.id}: the clip on disk is not the one in the manifest`);
  return { file: was.file, lufs: was.loudness.lufs, peak: was.loudness.truePeak, sha256, kept: true };
}
for (const f of fitted) {
  const section = takes.sections[f.id];
  const enc = keep.has(f.id) ? kept(f) : encode(f);
  const n = f.words.length;
  const lines = {};
  (section.lines ?? []).forEach((name, p) => {
    if (!name) return;
    const own = f.words.filter((_, k) => f.paragraphs[k] === p);
    lines[name] = { start: own[0].start, end: own.at(-1).end, text: section.paragraphs[p] };
  });
  out.sections[f.id] = {
    start: f.clipStart,
    end: f.clipEnd,
    clip: `narration/${enc.file}`,
    speech: f.speech,
    text: section.paragraphs.join(" "),
    ...(Object.keys(lines).length ? { lines } : {}),
    words: f.words,
  };
  manifest.sections.push({
    section: f.id,
    file: enc.file,
    sha256: enc.sha256,
    use: takes.sections[f.id].use ?? [{ unit: f.id, take: 1 }],
    clip: [f.clipStart, f.clipEnd],
    speech: f.speech,
    words: n,
    wpm: Math.round((n / (f.speech[1] - f.speech[0])) * 600) / 10,
    rawWpm: Math.round((n / f.rawSeconds) * 600) / 10,
    air: [r3(f.speech[0] - 0.1 - section.window[0]), r3(section.window[1] - f.speech[1] - 0.25)],
    airToWords: [r3(f.speech[0] - section.window[0]), r3(section.window[1] - f.speech[1])],
    loudness: { lufs: enc.lufs, truePeak: enc.peak },
    pace: section.pace,
    pauses: f.pauses,
    alignment: {
      source: "local transcript (openai-whisper small, word timestamps), offline",
      characterErrorRate: f.cer,
      heard: f.heard,
      questioned: f.questioned,
    },
  });
  console.log(
    `${f.id}: ${enc.file}  clip ${f.clipStart}-${f.clipEnd}  ${enc.lufs} LUFS  ${enc.peak} dBTP${enc.kept ? "  (kept as it was)" : ""}`,
  );
}
const s3 = out.sections.s3.words;
const s7 = out.sections.s7.words;
const lastFair = s7.findLastIndex((w) => /^fair$/i.test(w.w));
out.marks = {
  fairSplit: {
    start: s3[0].start,
    end: s3[1].end,
    note: "section 3's first words: the music turn and the wordmark",
  },
  fairSplitFinal: {
    start: s7[lastFair].start,
    end: s7[lastFair + 1].end,
    note: "the last 'Fair Split.': the final hit",
  },
  everyPesoTraced: { start: s7[lastFair + 2].start, end: s7.at(-1).end },
};
const sectionsForCaptions = fitted.map((f) => ({ words: f.words, paragraphs: f.paragraphs }));
const { cues, vtt } = captions(sectionsForCaptions);
for (const c of cues) {
  const lines = twoLines(c.text);
  if (!lines) throw new Error(`caption too long: ${c.text}`);
  if (c.end - c.start < 0.999 || c.end - c.start > 6.001)
    console.warn(`caption ${r3(c.end - c.start)} s: ${c.text}`);
}
writeFileSync(new URL("words.json", audio), `${JSON.stringify(out, null, 2)}\n`);
writeFileSync(new URL("captions.vtt", audio), vtt);
writeFileSync(new URL("manifest.json", dir), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`words.json, captions.vtt (${cues.length} cues), narration/manifest.json written`);
console.log(JSON.stringify(out.marks));
