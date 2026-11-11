// Film v7 premix: the narration and the music bed (and the effects stem once it exists), mastered to -14 LUFS with a
// true-peak ceiling. The same method as the v5 film's video/tools/mix.mjs, offline with ffmpeg: the bed follows the
// voice (a duck that starts 0.25 s before a line and releases over 0.6 s after it; gaps shorter than 1.6 s hold
// it, so it does not pump) and, under the voice, crossfades to a copy with the voice's band carved out (dips at
// 0.4-4 kHz), so it stays music while every word stays clear.
//
//   node video/film2/tools/sound-mix.mjs      -> audio/mix.wav (48 kHz stereo, 24-bit) and audio/mix.json when the
//                                                effects stem exists (audio/premix.* without it),
//                                                audio/work/stems/{voice,music,sum}.wav
//
// Reads audio/words.json (where each clip plays and every word's time), audio/narration/<id>.wav (the masters; the
// .m4a if a master is missing), audio/music-bed.wav, and audio/sfx.wav if present.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FFMPEG = process.env.HYPERFRAMES_FFMPEG_PATH ?? "ffmpeg";
const SR = 48000;
const film = new URL("../", import.meta.url);
const audio = new URL("audio/", film);
const stems = new URL("work/stems/", audio);
const path = (url) => fileURLToPath(url);
const words = JSON.parse(readFileSync(new URL("words.json", audio), "utf8"));
const DURATION = words.duration;
const N = Math.round(DURATION * SR);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const db = (v) => 10 ** (v / 20);

export const TARGET = {
  lufs: -14,
  truePeak: -1.5,
  ceiling: -4.6, // the limiter's ceiling: the mono fold-down adds 3 dB to the centred voice, so about -1.6 dBTP there
  musicUnder: 20, // dB the carved bed sits under the voice while it speaks
  // lower under the architecture; the two name moments ride the music (the turn at 38 s, the last crest)
  under: { s6: 22, fairSplit: 12, fairSplitFinal: 12, everyPesoTraced: 15 },
  attack: 0.25,
  release: 0.6,
  innerGap: 1.0,
  bridge: 1.6, // gaps shorter than this hold the duck (the demo's 1.2 s line gaps do not pump)
  foldDownPeak: -1.0,
};

function ffmpeg(args, opts = {}) {
  const run = spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-y", ...args], {
    maxBuffer: 1 << 30,
    encoding: opts.binary ? "buffer" : "utf8",
  });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${String(run.stderr).slice(-800)}`);
  return run;
}
function decode(file, channels, filter = null) {
  const buf = ffmpeg(
    [
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
    ],
    { binary: true },
  ).stdout;
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
}
function writeWav(url, data, channels) {
  const bytes = data.length * 4;
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(36 + bytes, 4);
  head.write("WAVEfmt ", 8, "ascii");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(3, 20);
  head.writeUInt16LE(channels, 22);
  head.writeUInt32LE(SR, 24);
  head.writeUInt32LE(SR * channels * 4, 28);
  head.writeUInt16LE(channels * 4, 32);
  head.writeUInt16LE(32, 34);
  head.write("data", 36, "ascii");
  head.writeUInt32LE(bytes, 40);
  writeFileSync(url, Buffer.concat([head, Buffer.from(data.buffer, data.byteOffset, bytes)]));
}
function measure(file, pre = "") {
  const chain = `${pre ? `${pre},` : ""}ebur128=peak=true:framelog=quiet`;
  const log = ffmpeg(["-i", file, "-af", chain, "-f", "null", "-"]).stderr;
  const s = log.slice(log.lastIndexOf("Summary"));
  return {
    lufs: Number(/I:\s+(-?[\d.]+) LUFS/.exec(s)?.[1]),
    lra: Number(/LRA:\s+(-?[\d.]+) LU/.exec(s)?.[1]),
    truePeak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(s)?.[1]),
  };
}
// K-weighted loudness (BS.1770), per sample
const KW = [
  { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] },
  { b: [1.0, -2.0, 1.0], a: [-1.99004745483398, 0.99007225036621] },
];
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

// ------------------------------------------------------------------------------------------------ the voice
/** The spans the bed ducks under, each with how far under the voice the bed sits there. */
export function voicePlan() {
  const spans = [];
  for (const [id, s] of Object.entries(words.sections)) {
    let from = s.words[0].start;
    s.words.forEach((w, k) => {
      const next = s.words[k + 1];
      if (!next) spans.push({ id, from, to: s.speech[1] });
      else if (next.start - w.end >= TARGET.innerGap) {
        spans.push({ id, from, to: w.end });
        from = next.start;
      }
    });
  }
  // the name moments are their own spans, with a shallower duck
  const out = [];
  for (const span of spans) {
    let parts = [{ ...span, under: TARGET.under[span.id] ?? TARGET.musicUnder }];
    for (const [mark, under] of Object.entries(TARGET.under)) {
      const m = words.marks[mark];
      if (!m) continue;
      parts = parts.flatMap((p) => {
        if (m.end <= p.from + 1e-6 || m.start >= p.to - 1e-6) return [p];
        return [
          ...(m.start > p.from + 1e-6 ? [{ ...p, to: m.start }] : []),
          { ...p, from: Math.max(p.from, m.start), to: Math.min(p.to, m.end), under, mark },
          ...(m.end < p.to - 1e-6 ? [{ ...p, from: m.end }] : []),
        ];
      });
    }
    // (a piece with no word in it is a pause, not a span: the bed there follows its neighbours)
    const said = words.sections[span.id].words;
    out.push(...parts.filter((p) => said.some((w) => w.start < p.to - 1e-6 && w.end > p.from + 1e-6)));
  }
  out.sort((a, b) => a.from - b.from);
  // where the bed is down at all: spans closer than `bridge` hold the duck between them
  // (except around a name moment: the bed comes up in the pause after it, so the music's hit is heard)
  const active = [];
  let before = null;
  for (const s of out) {
    const last = active.at(-1);
    const open = (s.mark || before?.mark) && s.from - (last?.[1] ?? -9) >= 0.5;
    if (last && s.from - last[1] < TARGET.bridge && !open) last[1] = Math.max(last[1], s.to);
    else active.push([s.from, s.to]);
    before = s;
  }
  return { spans: out, active };
}
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
/** A running mean over `seconds`, twice (a smooth glide between two duck depths). */
function smooth(x, seconds) {
  const half = Math.max(1, Math.round((seconds * SR) / 2));
  let cur = x;
  for (let pass = 0; pass < 2; pass++) {
    const pre = new Float64Array(cur.length + 1);
    for (let i = 0; i < cur.length; i++) pre[i + 1] = pre[i] + cur[i];
    const out = new Float32Array(cur.length);
    for (let i = 0; i < cur.length; i++) {
      const a = Math.max(0, i - half);
      const b = Math.min(cur.length, i + half + 1);
      out[i] = (pre[b] - pre[a]) / (b - a);
    }
    cur = out;
  }
  return cur;
}

// --------------------------------------------------------------------------------------------------- the mix
mkdirSync(stems, { recursive: true });
const { spans, active } = voicePlan();
const voice = new Float32Array(N);
const placed = [];
for (const [id, s] of Object.entries(words.sections)) {
  const master = new URL(`narration/${id}.wav`, audio);
  const file = existsSync(master) ? path(master) : path(new URL(s.clip, audio));
  const samples = decode(file, 1);
  const at = Math.round(s.start * SR);
  for (let i = 0; i < samples.length && at + i < N; i++) if (at + i >= 0) voice[at + i] += samples[i];
  placed.push({ section: id, at: s.start, seconds: r3(samples.length / SR), ...measure(file) });
}
const bedFile = path(new URL("music-bed.wav", audio));
if (!existsSync(bedFile)) throw new Error("audio/music-bed.wav is missing: run sound-music-bed.mjs first");
const bed = decode(bedFile, 2);
const carved = decode(
  bedFile,
  2,
  "equalizer=f=400:t=q:w=1.2:g=-4,equalizer=f=1000:t=q:w=1.2:g=-6,equalizer=f=1600:t=q:w=1.4:g=-8,equalizer=f=2500:t=q:w=1.2:g=-6,equalizer=f=4000:t=q:w=1:g=-3",
);
const env = duckEnvelope(active);
const voicePower = kPower(voice, 1).map((p) => 2 * p); // the voice plays in both channels
const carvedPower = kPower(carved, 2);
for (const s of spans) {
  const w = [[s.from, s.to]];
  s.voiceLufs = loudnessOver(voicePower, w);
  s.bedLufs = loudnessOver(carvedPower, w);
}
// one voice level per section (a two-word span would read low), so the depth follows the bed, not the phrase
for (const id of Object.keys(words.sections)) {
  const own = spans.filter((s) => s.id === id);
  const level = loudnessOver(
    voicePower,
    own.map((s) => [s.from, s.to]),
  );
  for (const s of own) s.depth = Math.min(0, level - s.under - s.bedLufs);
}
const depthAt = new Float32Array(N);
for (let k = 0; k < spans.length; k++) {
  const s = spans[k];
  const prev = spans[k - 1];
  const next = spans[k + 1];
  const a = prev ? Math.round(((prev.to + s.from) / 2) * SR) : 0;
  const b = next ? Math.round(((s.to + next.from) / 2) * SR) : N;
  for (let i = Math.max(0, a); i < Math.min(N, b); i++) depthAt[i] = s.depth;
}
const gainDb = smooth(depthAt, 0.2);
const music = new Float32Array(N * 2);
for (let i = 0; i < N; i++) {
  const e = env[i];
  const g = db(gainDb[i]);
  for (let c = 0; c < 2; c++)
    music[i * 2 + c] = (bed[i * 2 + c] ?? 0) * (1 - e) + (carved[i * 2 + c] ?? 0) * e * g;
}
const sfxFile = new URL("sfx.wav", audio);
// (the lead's placeholder stem is silence: it counts as no effects)
let sfx = existsSync(sfxFile) ? decode(path(sfxFile), 2) : null;
if (sfx && !sfx.some((v) => Math.abs(v) > 1e-5)) sfx = null;
const sum = new Float32Array(N * 2);
for (let i = 0; i < N; i++)
  for (let c = 0; c < 2; c++) sum[i * 2 + c] = voice[i] + music[i * 2 + c] + (sfx?.[i * 2 + c] ?? 0);
writeWav(new URL("voice.wav", stems), voice, 1);
writeWav(new URL("music.wav", stems), music, 2);
writeWav(new URL("sum.wav", stems), sum, 2);

// the master: one gain and a true-peak limiter, re-measured until it reads the target
const sumFile = path(new URL("sum.wav", stems));
const before = measure(sumFile);
// with the effects stem it is the full mix (mix.wav, mix.json); without, the premix
const NAME = sfx ? "mix" : "premix";
if (sfx) writeWav(new URL("sfx.wav", stems), sfx.subarray(0, N * 2), 2);
const premix = path(new URL(`${NAME}.wav`, audio));
let gain = TARGET.lufs - before.lufs;
let master = null;
for (let pass = 0; pass < 10; pass++) {
  const chain = `volume=${gain.toFixed(2)}dB,aresample=192000:resampler=soxr,alimiter=limit=${db(TARGET.ceiling).toFixed(4)}:attack=5:release=60:level=false,aresample=${SR}:resampler=soxr`;
  ffmpeg(["-i", sumFile, "-af", chain, "-ar", String(SR), "-c:a", "pcm_s24le", premix]);
  const stereo = measure(premix);
  const ituMono = measure(premix, "pan=mono|c0=0.7071*c0+0.7071*c1");
  master = { pass, gain: r2(gain), ...stereo, ituMonoTruePeak: ituMono.truePeak };
  if (Math.abs(stereo.lufs - TARGET.lufs) < 0.15) break;
  gain += TARGET.lufs - stereo.lufs;
}
if (master.truePeak > TARGET.truePeak)
  throw new Error(`true peak ${master.truePeak} dBTP: lower TARGET.ceiling`);

const musicPower = kPower(music, 2);
const sections = Object.entries(words.sections).map(([id, s]) => {
  const own = spans.filter((x) => x.id === id).map((x) => [x.from, x.to]);
  const v = loudnessOver(voicePower, own);
  const m = loudnessOver(musicPower, own);
  return {
    section: id,
    voiceLufs: r2(v),
    musicUnderVoiceLufs: r2(m),
    musicBelowVoiceDb: r2(v - m),
    musicInAirLufs: r2(
      loudnessOver(musicPower, [
        [s.start, s.speech[0] - TARGET.attack],
        [s.speech[1] + TARGET.release, s.end],
      ]),
    ),
  };
});
const report = {
  target: TARGET,
  effects: sfx ? "audio/sfx.wav" : "none yet (narration and music only)",
  voice: placed,
  active: active.map(([a, b]) => [r3(a), r3(b)]),
  spans: spans.map((s) => ({
    section: s.id,
    ...(s.mark ? { mark: s.mark } : {}),
    from: r3(s.from),
    to: r3(s.to),
    under: s.under,
    depthDb: r2(s.depth),
    musicBelowVoiceDb: r2(
      loudnessOver(voicePower, [[s.from, s.to]]) - loudnessOver(musicPower, [[s.from, s.to]]),
    ),
  })),
  sections,
  sum: before,
  master,
};
writeFileSync(new URL(`${NAME}.json`, audio), `${JSON.stringify(report, null, 2)}\n`);
for (const s of sections) console.log(JSON.stringify(s));
for (const s of report.spans.filter((x) => x.mark)) console.log(JSON.stringify(s));
console.log(`sum ${JSON.stringify(before)}`);
console.log(`${NAME}.wav ${JSON.stringify(master)}`);
