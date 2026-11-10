// F4 narration: the chosen Gemini TTS takes (video/audio/narration/takes.json) become video/audio/narration/<beat>.m4a
// and manifest.json, and a local transcript gives every spoken word its time.
//
//   node video/tools/narration.mjs encode <takes-dir>   raw takes <beat>-t<n>.wav (+ requests.json, the run's log)
//   node video/tools/narration.mjs align <asr-dir>      Whisper JSON (word timestamps) of out/narration/<beat>.wav
//
// encode: lengthens the listed sentence pauses (digital silence inserted inside an existing pause), trims the take
// to 0.10 s before its first sound and 0.25 s after its last, normalises it to -16 LUFS integrated with a true
// peak of -1.5 dBTP (ffmpeg loudnorm, two passes, linear), and writes 48 kHz mono AAC. The raw takes stay outside
// the repo. align: maps the transcript onto the script's own words (character alignment, so "sixty-four" can match
// "64") and records each word's start and end, clip-relative, clamped to the clip's measured speech.
// Offline: ffmpeg only (HYPERFRAMES_FFMPEG_PATH or ffmpeg on PATH); no Gemini request is made here.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beats } from "../script.ts";

const here = new URL("../", import.meta.url);
const dir = new URL("audio/narration/", here);
const work = new URL("out/narration/", here);
const FFMPEG = process.env.HYPERFRAMES_FFMPEG_PATH ?? "ffmpeg";
const takes = JSON.parse(readFileSync(new URL("takes.json", dir), "utf8"));
const spoken = (say) => say.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
const r3 = (v) => Math.round(v * 1000) / 1000;

function ffmpeg(args) {
  const run = spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-y", ...args], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr.slice(-800)}`);
  return run.stderr;
}

/** 16-bit PCM WAV -> { rate, samples (Int16Array, mono) }. */
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
    if (id === "data") data = buffer.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  if (!data || channels !== 1) throw new Error("expected mono PCM");
  const samples = new Int16Array(data.length / 2);
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
/** Integrated loudness and true peak (ffmpeg ebur128). */
function loudness(path) {
  const log = ffmpeg(["-i", path, "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"]);
  const summary = log.slice(log.lastIndexOf("Summary"));
  return {
    lufs: Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]),
    peak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]),
  };
}
/** The pauses inside a clip: [start, end] of each stretch under -45 dB for 0.1 s or more (ffmpeg silencedetect). */
function silences(path) {
  const log = ffmpeg(["-i", path, "-af", "silencedetect=n=-45dB:d=0.1", "-f", "null", "-"]);
  const starts = [...log.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Math.max(0, Number(m[1])));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((s, i) => [s, ends[i] ?? Number.POSITIVE_INFINITY]);
}
/** First and last 10 ms frame louder than -45 dBFS (RMS), in seconds. */
function envelope({ rate, samples }) {
  const frame = Math.round(rate / 100);
  let first = -1;
  let last = -1;
  for (let i = 0; i * frame < samples.length; i++) {
    let sum = 0;
    const end = Math.min(samples.length, (i + 1) * frame);
    for (let k = i * frame; k < end; k++) sum += (samples[k] / 32768) ** 2;
    const db = 10 * Math.log10(sum / (end - i * frame) + 1e-12);
    if (db > -45) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) throw new Error("silent take");
  return [first / 100, (last + 1) / 100];
}

function encode(takesDir) {
  mkdirSync(work, { recursive: true });
  const log = existsSync(`${takesDir}/requests.json`)
    ? JSON.parse(readFileSync(`${takesDir}/requests.json`, "utf8"))
    : null;
  const manifest = {
    v: 1,
    synthetic: true,
    notice:
      "Synthetic narration: Gemini TTS (voice Charon) reading video/script.ts word for word. Disclosed in the film as 'Synthetic voices · Gemini TTS'.",
    voice: takes.voice,
    model: takes.model,
    style: takes.style,
    target: takes.target,
    requests: 0,
    beats: [],
  };
  for (const [id, take] of Object.entries(takes.beats)) {
    const beat = beats.find((item) => item.id === id);
    if (!beat) throw new Error(`no beat ${id}`);
    const sent = log?.log.find((entry) => entry.beat === id && entry.take === take.take && entry.ok);
    if (log && sent?.text !== beat.say) throw new Error(`${id}: take ${take.take} did not read today's line`);
    const raw = readWav(readFileSync(`${takesDir}/${id}-t${take.take}.wav`));
    // lengthen the listed pauses, latest first, so earlier positions stay valid
    let samples = raw.samples;
    // (a negative value shortens the pause: that much silence, centred on the point, is cut out)
    for (const [at, add] of [...take.pauses].sort((a, b) => b[0] - a[0])) {
      const k = Math.round(at * raw.rate);
      const n = Math.round(Math.abs(add) * raw.rate);
      const reach = add < 0 ? Math.ceil(n / 2) + 240 : 240;
      const window = samples.subarray(Math.max(0, k - reach), k + reach);
      const peak = Math.max(...Array.from(window, (v) => Math.abs(v))) / 32768;
      if (peak > 0.01) throw new Error(`${id}: ${at} s is not inside a pause`);
      if (add >= 0) {
        const next = new Int16Array(samples.length + n);
        next.set(samples.subarray(0, k), 0);
        next.set(samples.subarray(k), k + n);
        samples = next;
      } else {
        const from = k - Math.floor(n / 2);
        samples = Int16Array.from([...samples.subarray(0, from), ...samples.subarray(from + n)]);
      }
    }
    const [lead, tail] = envelope({ rate: raw.rate, samples });
    const from = Math.max(0, Math.round((lead - 0.1) * raw.rate));
    const to = Math.min(samples.length, Math.round((tail + 0.25) * raw.rate));
    const trimmed = samples.slice(from, to);
    const edit = fileURLToPath(new URL(`${id}-edit.wav`, work));
    writeFileSync(edit, writeWav(raw.rate, trimmed));
    // Loudness: a gentle 2:1 compressor over -20 dBFS (speech from TTS has an 18 dB crest), a gain to -16 LUFS, then
    // a peak limiter run at 4× the rate (so it catches inter-sample peaks), then AAC; measured on the encoded file and
    // repeated until it reads -16 ± 0.3 LUFS with the true peak at or under -1.5 dBTP.
    const t = takes.target;
    const wav = fileURLToPath(new URL(`${id}.wav`, work));
    const file = `${id}.m4a`;
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
      // the peak first (a tighter limit), then the loudness (more gain into the limiter)
      if (peak > t.truePeak) limit -= peak - t.truePeak + 0.2;
      else if (Math.abs(lufs - t.lufs) > 0.3) gain += t.lufs - lufs;
      else break;
    }
    if (peak > t.truePeak || Math.abs(lufs - t.lufs) > 0.5)
      throw new Error(`${id}: ${lufs} LUFS, ${peak} dBTP after twelve passes`);
    const words = spoken(beat.say).length;
    const duration = trimmed.length / raw.rate;
    const speech = [r3(lead - from / raw.rate), r3(tail - from / raw.rate)];
    manifest.requests += take.requests;
    manifest.beats.push({
      beat: id,
      file,
      duration: r3(duration),
      speech,
      words,
      wpm: Math.round((words / (speech[1] - speech[0])) * 600) / 10,
      sha256: createHash("sha256")
        .update(readFileSync(new URL(file, dir)))
        .digest("hex"),
      voice: takes.voice,
      model: takes.model,
      take: take.take,
      requests: take.requests,
      pace: take.pace,
      pauses: take.pauses,
      loudness: { lufs, truePeak: peak },
      text: beat.say,
      alignment: null,
    });
    console.log(
      `${id.padEnd(12)} take ${take.take}  ${duration.toFixed(2)} s  speech ${speech.join("-")}  ${words} words  ${manifest.beats.at(-1).wpm} wpm  ${lufs} LUFS  ${peak} dBTP`,
    );
  }
  const old = existsSync(new URL("manifest.json", dir))
    ? JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8"))
    : null;
  for (const item of manifest.beats) {
    const before = old?.beats.find((b) => b.beat === item.beat);
    if (before?.sha256 === item.sha256) item.alignment = before.alignment;
  }
  writeFileSync(new URL("manifest.json", dir), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${manifest.beats.length} clips, ${manifest.requests} TTS requests`);
}

// ---------------------------------------------------------------------------------------------------- align
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
/** Letters only, numbers spelled out, so the script's words and the transcript's compare as sounds on paper. */
function letters(word) {
  return word
    .toLowerCase()
    .replace(/\$(\d[\d,]*)/g, (_, n) => `${n} dollars`)
    .replace(/\d[\d,]*/g, (n) => ` ${numberWords(Number(n.replaceAll(",", "")))} `)
    .replace(/[^a-z]/g, "");
}
/** Character alignment (edit distance) of two strings; returns, for each char of a, the index in b or -1. */
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
function align(asrDir) {
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8"));
  for (const item of manifest.beats) {
    const asr = JSON.parse(readFileSync(`${asrDir}/${item.beat}.json`, "utf8"));
    const heard = asr.segments.flatMap((segment) => segment.words ?? []);
    const script = spoken(item.text);
    const a = script.map(letters);
    const b = heard.map((word) => letters(word.word));
    const owner = (parts) => parts.flatMap((part, k) => Array.from(part, () => k));
    const [ownA, ownB] = [owner(a), owner(b)];
    const { map, distance } = alignChars(a.join(""), b.join(""));
    // each script word takes the span of the transcript words its letters landed on; script words that share one
    // transcript word ("$300" for "three hundred dollars") split its span by their letters
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
    // Whisper tends to start the word after a pause at the pause's start: a start inside a measured pause moves to
    // its end, an end inside one moves to its start (silences at -45 dB over 0.1 s in the trimmed take, before gain)
    const quiet = silences(fileURLToPath(new URL(`${item.beat}-edit.wav`, work)));
    for (const [k, t] of times.entries()) {
      if (!t) continue;
      for (const [q0, q1] of quiet) {
        if (t.start >= q0 - 0.02 && t.start < q1) t.start = q1;
        if (t.end > q0 && t.end <= q1 + 0.02) t.end = q0;
        // a word whose span swallows a pause of 0.2 s or more: TTS pauses at punctuation, so the word after a
        // punctuated one starts when the pause ends, and a punctuated word ends when it begins
        if (q1 - q0 >= 0.2 && t.start < q0 && t.end > q1) {
          if (/[,.;:]$/.test(script[k - 1] ?? "")) t.start = q1;
          else if (/[,.;:]$/.test(script[k])) t.end = q0;
        }
      }
      if (t.end <= t.start) t.end = t.start + 0.05;
    }
    // a punctuated word ends where the pause after it starts (whisper often runs it on into the pause)
    for (const [k, t] of times.entries()) {
      const next = times[k + 1];
      if (t && next && /[,.;:]$/.test(script[k]) && t.end > next.start) t.end = next.start;
    }
    // words the transcript missed sit between their neighbours; then clamp into the measured speech, in order
    for (let k = 0; k < times.length; k++) {
      if (times[k]) continue;
      const prev = times.slice(0, k).findLast(Boolean);
      const next = times.slice(k + 1).find(Boolean);
      const lo = prev?.end ?? item.speech[0];
      const hi = next?.start ?? item.speech[1];
      times[k] = { start: lo, end: Math.max(lo, hi) };
    }
    const [s0, s1] = item.speech;
    times[0].start = s0;
    times.at(-1).end = s1;
    let floor = s0;
    for (const t of times) {
      t.start = Math.min(Math.max(t.start, floor), s1);
      t.end = Math.min(Math.max(t.end, t.start + 0.02), s1);
      floor = t.start;
    }
    item.alignment = {
      source: "local transcript (openai-whisper small, word timestamps), offline",
      characterErrorRate: r3(distance / a.join("").length),
      heard: heard.map((w) => w.word.trim()).join(" "),
      words: script.map((w, k) => ({ w, start: r3(times[k].start), end: r3(times[k].end) })),
    };
    console.log(
      `${item.beat.padEnd(12)} CER ${(item.alignment.characterErrorRate * 100).toFixed(1)}%  heard: ${item.alignment.heard}`,
    );
  }
  writeFileSync(new URL("manifest.json", dir), `${JSON.stringify(manifest, null, 2)}\n`);
}

const [command, arg] = process.argv.slice(2);
if (command === "encode" && arg) encode(arg);
else if (command === "align" && arg) align(arg);
else throw new Error("usage: narration.mjs encode <takes-dir> | align <asr-dir>");
