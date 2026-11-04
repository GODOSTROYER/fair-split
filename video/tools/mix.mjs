// The film's mix (ADR-0018): the narration and the member's own sentence, the music bed and the sound effects, mastered
// to -14 LUFS with a true-peak ceiling, reproducibly from the timeline. HyperFrames' voiceover carve
// (hyperframes-audio, carve.mjs) needs @hyperframes/core installed in the project, a new dependency this repo does not
// take, so this script does the same job offline with ffmpeg: the bed follows the voice (a duck that starts 0.25 s
// before each line and releases over 0.6 s after it) and, under the voice, crossfades to a copy with the voice's
// band carved out (dips at 0.4-2.5 kHz), so it stays music while the words stay clear. The member's sentence plays
// alone: the bed is out (build-music-bed.mjs) and no cue sits on it.
//
//   node video/tools/mix.mjs                       -> out/mix-v5.wav, out/stems/*.wav, out/mix-v5.json
//   node video/tools/mix.mjs mux <picture.mp4> <out.mp4>   -> the picture with the mix and the soft English captions,
//                                                             re-measured on the MP4 and re-levelled until it reads
//                                                             -14 ± 0.5 LUFS and at or under -1.5 dBTP
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { eventTime } from "../plan.mjs";
import { beats, FILM, MEMBER_AUDIO, NARRATION_AT } from "../script.ts";

const FFMPEG = process.env.HYPERFRAMES_FFMPEG_PATH ?? "ffmpeg";
const SR = 48000;
const video = new URL("../", import.meta.url);
const out = new URL("out/", video);
const path = (url) => fileURLToPath(url);
const N = Math.round(FILM.duration * SR);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const db = (v) => 10 ** (v / 20);

/** Master and mix targets (owner, 5 Nov; rubric "sound"). */
export const TARGET = {
  lufs: -14,
  truePeak: -1.5,
  ceiling: -2.4, // the limiter's ceiling, under the delivery limit to leave room for AAC and inter-sample peaks
  voiceClip: -16, // each narration clip, and the member's sentence, at -16 LUFS before the master gain
  musicUnder: 20, // dB the bed sits under the voice while it speaks (18-22)
  attack: 0.25,
  release: 0.6,
  innerGap: 1.0, // a pause inside a line this long lets the bed rise
};

function ffmpeg(args, opts = {}) {
  const run = spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-y", ...args], {
    maxBuffer: 1 << 30,
    encoding: opts.binary ? "buffer" : "utf8",
  });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${String(run.stderr).slice(-800)}`);
  return run;
}
/** Decode to float32 at 48 kHz (`channels` 1 or 2). */
function decode(file, channels, filter = null) {
  const args = [
    "-i",
    file,
    ...(filter ? ["-af", filter] : []),
    "-ac",
    String(channels),
    "-ar",
    String(SR),
    "-f",
    "f32le",
    "-",
  ];
  const buf = ffmpeg(args, { binary: true }).stdout;
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
}
function writeWav(url, data, channels) {
  const bytes = data.length * 4;
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(36 + bytes, 4);
  head.write("WAVEfmt ", 8, "ascii");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(3, 20); // IEEE float
  head.writeUInt16LE(channels, 22);
  head.writeUInt32LE(SR, 24);
  head.writeUInt32LE(SR * channels * 4, 28);
  head.writeUInt16LE(channels * 4, 32);
  head.writeUInt16LE(32, 34);
  head.write("data", 36, "ascii");
  head.writeUInt32LE(bytes, 40);
  writeFileSync(url, Buffer.concat([head, Buffer.from(data.buffer, data.byteOffset, bytes)]));
}
const summary = (log) => log.slice(log.lastIndexOf("Summary"));
function measure(file, extra = []) {
  const log = ffmpeg([
    "-i",
    file,
    ...extra,
    "-af",
    "ebur128=peak=true:framelog=quiet",
    "-f",
    "null",
    "-",
  ]).stderr;
  const s = summary(log);
  return {
    lufs: Number(/I:\s+(-?[\d.]+) LUFS/.exec(s)?.[1]),
    lra: Number(/LRA:\s+(-?[\d.]+) LU/.exec(s)?.[1]),
    truePeak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(s)?.[1]),
  };
}

// ---------------------------------------------------------------------------------- K-weighted loudness (BS.1770)
const KW = [
  { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] },
  { b: [1.0, -2.0, 1.0], a: [-1.99004745483398, 0.99007225036621] },
];
/** Per-sample K-weighted power (summed over channels) of an interleaved stem. */
function kPower(data, channels) {
  const n = data.length / channels;
  const power = new Float64Array(n);
  for (let c = 0; c < channels; c++) {
    const st = KW.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let x = data[i * channels + c];
      for (const [k, f] of KW.entries()) {
        const s = st[k];
        const y = f.b[0] * x + f.b[1] * s[0] + f.b[2] * s[1] - f.a[0] * s[2] - f.a[1] * s[3];
        s[1] = s[0];
        s[0] = x;
        s[3] = s[2];
        s[2] = y;
        x = y;
      }
      power[i] += x * x;
    }
  }
  return power;
}
/** Loudness (LUFS, ungated) of a stem's K-weighted power over a set of [from, to] windows. */
function loudnessOver(power, windows) {
  let sum = 0;
  let count = 0;
  for (const [a, b] of windows)
    for (let i = Math.max(0, Math.round(a * SR)); i < Math.min(power.length, Math.round(b * SR)); i++) {
      sum += power[i];
      count++;
    }
  return count ? -0.691 + 10 * Math.log10(sum / count + 1e-20) : Number.NEGATIVE_INFINITY;
}
/** The loudest momentary (400 ms) loudness of a stem inside [from, to]. */
function momentaryMax(power, from, to) {
  const w = Math.round(0.4 * SR);
  const a = Math.max(0, Math.round(from * SR));
  const b = Math.min(power.length, Math.round(to * SR));
  let best = Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (let i = a; i < b; i++) {
    sum += power[i];
    if (i - a >= w) sum -= power[i - w];
    // (a running sum can dip a hair under zero in float arithmetic after a loud sample leaves the window)
    if (i - a >= w - 1) best = Math.max(best, -0.691 + 10 * Math.log10(Math.max(0, sum) / w + 1e-20));
  }
  return best;
}

// --------------------------------------------------------------------------------------------- the voice
/** Lines whose first words ride the music at full (the beat, and the word the bed ducks from). */
export const SWELL = { solution: "claude" };
/** Every line and its windows: the clips, where each plays, and the spans the bed ducks under. */
export function voicePlan() {
  const manifest = JSON.parse(readFileSync(new URL("audio/narration/manifest.json", video), "utf8"));
  const clips = manifest.beats.map((clip) => ({
    beat: clip.beat,
    file: path(new URL(`audio/narration/${clip.file}`, video)),
    at: NARRATION_AT[clip.beat],
  }));
  clips.push({
    beat: "listening",
    file: path(new URL(`../${MEMBER_AUDIO.file}`, video)),
    at: MEMBER_AUDIO.start,
    member: true,
  });
  // active spans: each line from its first word to its last, split where a pause inside it reaches innerGap; the
  // swell carries "Fair Split:" across the turn (STYLE §9), so the bed ducks only from the word after it
  const active = [];
  for (const beat of beats) {
    if (!beat.words?.length) continue;
    const swell = SWELL[beat.id];
    const first = swell ? beat.words.findIndex((w) => w.w.toLowerCase().startsWith(swell)) : 0;
    if (first < 0) throw new Error(`${beat.id}: no "${swell}" to duck from`);
    let from = beat.words[first].start;
    for (const [k, w] of beat.words.entries()) {
      if (k < first) continue;
      const next = beat.words[k + 1];
      if (!next) active.push([from, beat.speech?.[1] ?? w.end]);
      else if (next.start - w.end >= TARGET.innerGap) {
        active.push([from, w.end]);
        from = next.start;
      }
    }
  }
  return { clips, active: active.sort((a, b) => a[0] - b[0]) };
}
/** 1 where the bed is fully under the voice, 0 where it is free: a raised-cosine ramp in before, out after. */
function duckEnvelope(active) {
  const env = new Float32Array(N);
  const ramp = (u) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));
  for (const [s, e] of active) {
    const a0 = Math.max(0, Math.round((s - TARGET.attack) * SR));
    const r1 = Math.min(N, Math.round((e + TARGET.release) * SR));
    for (let i = a0; i < r1; i++) {
      const t = i / SR;
      const v =
        t < s
          ? ramp((t - (s - TARGET.attack)) / TARGET.attack)
          : t <= e
            ? 1
            : 1 - ramp((t - e) / TARGET.release);
      if (v > env[i]) env[i] = v;
    }
  }
  return env;
}

// ---------------------------------------------------------------------------------------------- the mix
function mix() {
  mkdirSync(new URL("stems/", out), { recursive: true });
  const { clips, active } = voicePlan();
  // voice stem (mono): each clip at its place, each brought to -16 LUFS (the member's clip measures -17.1)
  const voice = new Float32Array(N);
  const placed = [];
  for (const clip of clips) {
    const m = measure(clip.file);
    const gain = clip.member ? db(TARGET.voiceClip - m.lufs) : 1;
    const samples = decode(clip.file, 1);
    const at = Math.round(clip.at * SR);
    for (let i = 0; i < samples.length && at + i < N; i++) voice[at + i] += samples[i] * gain;
    placed.push({
      beat: clip.beat,
      at: clip.at,
      seconds: r3(samples.length / SR),
      lufs: m.lufs,
      gain: r2(20 * Math.log10(gain)),
    });
  }
  // music stem (stereo): the bed, and a copy carved where the voice lives, crossfaded by the duck envelope
  const bedFile = path(new URL("music-bed.wav", out));
  if (!existsSync(bedFile)) throw new Error("out/music-bed.wav is missing: run build-music-bed.mjs first");
  const bed = decode(bedFile, 2);
  const carved = decode(
    bedFile,
    2,
    "equalizer=f=400:t=q:w=1.2:g=-4,equalizer=f=1000:t=q:w=1.2:g=-6,equalizer=f=1600:t=q:w=1.4:g=-8,equalizer=f=2500:t=q:w=1.2:g=-6,equalizer=f=4000:t=q:w=1:g=-3",
  );
  const env = duckEnvelope(active);
  // the voice plays in both channels, so it is measured as the stereo signal the viewer hears (twice the power)
  const voicePower = kPower(voice, 1).map((p) => 2 * p);
  // the duck depth, line by line, that puts the carved bed TARGET.musicUnder dB under that line's voice (the bed's
  // own level moves: bright under the reel, the lift under the end); between lines the depth glides from one to the
  // next while the bed is up
  const carvedPower = kPower(carved, 2);
  const depths = [];
  for (const beat of beats) {
    const spans = active.filter(
      ([s, e]) => beat.speech && s >= beat.speech[0] - 1e-6 && e <= beat.speech[1] + 1e-6,
    );
    const bedLoud = loudnessOver(carvedPower, spans);
    if (!spans.length || !Number.isFinite(bedLoud)) continue;
    const depth = Math.min(0, loudnessOver(voicePower, spans) - TARGET.musicUnder - bedLoud);
    for (const [s, e] of spans)
      depths.push({ beat: beat.id, from: s - TARGET.attack, to: e + TARGET.release, depth: r2(depth) });
  }
  depths.sort((a, b) => a.from - b.from);
  const gainAt = new Float32Array(N);
  for (let k = 0; k < depths.length; k++) {
    const d = depths[k];
    const next = depths[k + 1];
    const a = k === 0 ? 0 : Math.round(d.from * SR);
    const b = next ? Math.round(next.from * SR) : N;
    const holdTo = Math.min(b, Math.round(d.to * SR));
    for (let i = Math.max(0, a); i < Math.min(N, b); i++) {
      const u = i < holdTo || !next ? 0 : (i - holdTo) / Math.max(1, b - holdTo);
      gainAt[i] = d.depth + (next ? (next.depth - d.depth) * u : 0);
    }
  }
  const music = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const e = env[i];
    const g = db(gainAt[i]);
    for (let c = 0; c < 2; c++)
      music[i * 2 + c] = (bed[i * 2 + c] ?? 0) * (1 - e) + (carved[i * 2 + c] ?? 0) * e * g;
  }
  const duck = depths
    .map(({ beat, depth }) => ({ beat, depth }))
    .filter((d, i, all) => all.findIndex((x) => x.beat === d.beat) === i);
  // effects stem (stereo): one sound per cue at its event, levelled against the voice
  const cueFile = JSON.parse(readFileSync(new URL("sfx-cues.json", video), "utf8"));
  const sfx = new Float32Array(N * 2);
  const cueLog = [];
  const loudCache = new Map();
  for (const cue of cueFile.cues) {
    const t0 = eventTime(cue.event) + cue.offset;
    const names = Array.isArray(cue.sound) ? cue.sound : [cue.sound];
    const repeats = cue.repeat ?? [0];
    const hits = names.flatMap((name, k) => repeats.map((r) => ({ name, at: t0 + k * (cue.step ?? 0) + r })));
    let span = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const decoded = hits.map((hit) => {
      const file = path(new URL(cueFile.sounds[hit.name].file, video));
      const samples = decode(file, 2);
      const length = samples.length / 2 / SR;
      const start =
        cue.anchor === "end" ? hit.at - length : cue.anchor === "centre" ? hit.at - length / 2 : hit.at;
      span = [Math.min(span[0], start), Math.max(span[1], start + length)];
      if (!loudCache.has(hit.name)) {
        const pad = new Float32Array(samples.length + SR * 2);
        pad.set(samples, SR);
        loudCache.set(hit.name, momentaryMax(kPower(pad, 2), 0, pad.length / 2 / SR));
      }
      return { ...hit, samples, start };
    });
    const [s0, s1] = span;
    const memberSpan = [MEMBER_AUDIO.start, MEMBER_AUDIO.start + MEMBER_AUDIO.duration];
    if (s1 > memberSpan[0] && s0 < memberSpan[1])
      throw new Error(`${cue.id}: a cue on the member's sentence`);
    // under the voice when a third of the sound or more plays while a line is spoken (a riser that ends in a gap
    // is levelled for the gap it rises into)
    const overlap = active.reduce(
      (sum, [a, b]) => sum + Math.max(0, Math.min(s1, b + 0.1) - Math.max(s0, a - 0.1)),
      0,
    );
    const underVoice = overlap >= (s1 - s0) / 3;
    // under the voice: the cue's loudest 400 ms sits `underVoice` dB under the voice's loudest 400 ms around it; in a
    // gap, `inGap` dB under the voice's reference level (its stereo level, -13 LUFS for clips at -16 in each channel)
    const reference = underVoice ? momentaryMax(voicePower, s0 - 0.6, s1 + 0.6) : cueFile.voiceRef;
    const target = reference + (underVoice ? cueFile.underVoice : cueFile.inGap) + cue.trim;
    const loudest = Math.max(...decoded.map((h) => loudCache.get(h.name)));
    const gain = target - loudest;
    for (const hit of decoded) {
      const at = Math.round(hit.start * SR);
      const g = db(gain);
      for (let i = 0; i < hit.samples.length / 2; i++) {
        const j = at + i;
        if (j < 0 || j >= N) continue;
        sfx[j * 2] += hit.samples[i * 2] * g;
        sfx[j * 2 + 1] += hit.samples[i * 2 + 1] * g;
      }
    }
    cueLog.push({
      id: cue.id,
      event: cue.event,
      at: r3(t0),
      span: [r3(s0), r3(s1)],
      sound: names.join("+"),
      underVoice,
      gain: r2(gain),
      picture: cue.picture,
    });
  }
  // the sum, before the master
  const sum = new Float32Array(N * 2);
  for (let i = 0; i < N; i++)
    for (let c = 0; c < 2; c++) sum[i * 2 + c] = voice[i] + music[i * 2 + c] + sfx[i * 2 + c];
  writeWav(new URL("stems/voice.wav", out), voice, 1);
  writeWav(new URL("stems/music.wav", out), music, 2);
  writeWav(new URL("stems/sfx.wav", out), sfx, 2);
  writeWav(new URL("stems/sum.wav", out), sum, 2);
  // measurements on the stems: the bed under the voice, per section and per line; each cue under its voice
  const musicPower = kPower(music, 2);
  const sfxPower = kPower(sfx, 2);
  const sections = [
    ["overview", 0, 57],
    ["deep dive", 57, 134],
    ["listening", 134, 143],
    ["close", 143, FILM.duration],
  ].map(([name, a, b]) => {
    const speech = active.map(([s, e]) => [Math.max(s, a), Math.min(e, b)]).filter(([s, e]) => e > s);
    const gaps = [];
    let cursor = a;
    for (const [s, e] of speech) {
      if (s - TARGET.release > cursor) gaps.push([cursor, s - TARGET.attack]);
      cursor = e + TARGET.release + 0.4;
    }
    if (b > cursor) gaps.push([cursor, b]);
    const v = loudnessOver(voicePower, speech);
    const m = loudnessOver(musicPower, speech);
    return {
      section: name,
      from: a,
      to: b,
      voiceLufs: r2(v),
      musicUnderVoiceLufs: r2(m),
      musicBelowVoiceDb: r2(v - m),
      musicInGapsLufs: r2(
        loudnessOver(
          musicPower,
          gaps.filter(([s, e]) => e - s > 0.5),
        ),
      ),
    };
  });
  const lines = beats
    .filter((beat) => beat.speech && beat.id !== "listening")
    .map((beat) => {
      // while the line is spoken: its active spans (a pause of a second or more inside it lets the bed rise)
      const w = active.filter(([s, e]) => s >= beat.speech[0] - 1e-6 && e <= beat.speech[1] + 1e-6);
      return {
        beat: beat.id,
        musicBelowVoiceDb: r2(loudnessOver(voicePower, w) - loudnessOver(musicPower, w)),
      };
    });
  for (const cue of cueLog) {
    const [a, b] = cue.span;
    cue.momentaryLufs = r2(momentaryMax(sfxPower, a - 0.05, b + 0.45));
    if (cue.underVoice) cue.belowVoiceDb = r2(momentaryMax(voicePower, a - 0.6, b + 0.6) - cue.momentaryLufs);
  }
  const report = {
    target: TARGET,
    duckDb: duck,
    voice: placed,
    active: active.map(([a, b]) => [r3(a), r3(b)]),
    sections,
    lines,
    cues: cueLog,
    sum: measure(path(new URL("stems/sum.wav", out))),
  };
  writeFileSync(new URL("mix-v5.json", out), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `duck per line ${duck.map((d) => `${d.beat} ${d.depth}`).join(", ")} dB (+ the carve); sum ${JSON.stringify(report.sum)}`,
  );
  for (const s of sections) console.log(JSON.stringify(s));
  console.log(`${cueLog.length} cues`);
}

// --------------------------------------------------------------------------------------- master and mux
function mux(picture, target) {
  const sum = path(new URL("stems/sum.wav", out));
  const report = JSON.parse(readFileSync(new URL("mix-v5.json", out), "utf8"));
  let gain = TARGET.lufs - report.sum.lufs;
  let result = null;
  for (let pass = 0; pass < 5; pass++) {
    const master = path(new URL("mix-v5.wav", out));
    const chain = `volume=${gain.toFixed(2)}dB,aresample=192000:resampler=soxr,alimiter=limit=${db(TARGET.ceiling).toFixed(4)}:attack=5:release=60:level=false,aresample=${SR}:resampler=soxr`;
    ffmpeg(["-i", sum, "-af", chain, "-ar", String(SR), "-c:a", "pcm_s24le", master]);
    ffmpeg([
      "-i",
      picture,
      "-i",
      master,
      "-i",
      path(new URL("captions.vtt", video)),
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-map",
      "2:s",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      String(SR),
      "-c:s",
      "mov_text",
      "-metadata:s:s:0",
      "language=eng",
      "-metadata:s:a:0",
      "language=eng",
      target,
    ]);
    const stereo = measure(target);
    const mono = measure(target, ["-ac", "1"]);
    result = { pass, gain: r2(gain), stereo, mono, monoDeltaLu: r2(mono.lufs - stereo.lufs) };
    console.log(JSON.stringify(result));
    if (Math.abs(stereo.lufs - TARGET.lufs) <= 0.3 && stereo.truePeak <= TARGET.truePeak) break;
    gain += TARGET.lufs - stereo.lufs;
    if (stereo.truePeak > TARGET.truePeak) gain -= stereo.truePeak - TARGET.truePeak + 0.1;
  }
  report.master = result;
  writeFileSync(new URL("mix-v5.json", out), `${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [command, ...args] = process.argv.slice(2);
  if (!command) mix();
  else if (command === "mux" && args.length === 2) mux(args[0], args[1]);
  else throw new Error("usage: mix.mjs | mix.mjs mux <picture.mp4> <out.mp4>");
}
