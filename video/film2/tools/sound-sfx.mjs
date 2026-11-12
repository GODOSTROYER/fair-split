// Film v7 effects stem: audio/sfx-cues.json -> audio/sfx.wav (the film's length, 48 kHz stereo), audio/sfx/ (the CC0
// kit files in use, copied byte for byte) and audio/cue-sheet.txt.
//
//   node video/film2/tools/sound-sfx.mjs <kit-sfx-dir>
//        e.g. Z:/Projects/Paypal/tools-ext/motion-graphics/skills/sound-effects/sfx
//
// Only CC0 1.0 files of the Barty-Bart motion-graphics kit are accepted (checked against the kit's manifest.json
// and LICENSES.md); Mixkit files are never used. Nothing is processed but length (a cut with a short fade) and
// level. Levels are set by measurement against the narration, not by ear: a cue's loudest 400 ms and its loudest
// 50 ms (K-weighted, BS.1770) both sit at least `under` dB (never less than 12) below what the voice reaches in the
// same windows (the 95th percentile of the voice while it speaks), and no cue's sample peak passes `peakCap` dBFS
// (low thuds measure quiet on a K-weighted meter, so the peak holds them).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FFMPEG = process.env.HYPERFRAMES_FFMPEG_PATH ?? "ffmpeg";
const SR = 48000;
const audio = new URL("../audio/", import.meta.url);
const path = (url) => fileURLToPath(url);
const kit = process.argv[2] ? resolve(process.argv[2]) : null;
if (!kit) throw new Error("usage: sound-sfx.mjs <kit-sfx-dir>");
const sheet = JSON.parse(readFileSync(new URL("sfx-cues.json", audio), "utf8"));
const words = JSON.parse(readFileSync(new URL("words.json", audio), "utf8"));
const N = Math.round(words.duration * SR);
const r2 = (v) => Math.round(v * 100) / 100;
const db = (v) => 10 ** (v / 20);

function decode(file, channels) {
  const run = spawnSync(
    FFMPEG,
    ["-hide_banner", "-nostats", "-i", file, "-ac", String(channels), "-ar", String(SR), "-f", "f32le", "-"],
    { maxBuffer: 1 << 30 },
  );
  if (run.status !== 0) throw new Error(`ffmpeg failed on ${file}: ${String(run.stderr).slice(-400)}`);
  return new Float32Array(
    run.stdout.buffer.slice(run.stdout.byteOffset, run.stdout.byteOffset + run.stdout.length),
  );
}
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
/** Loudness (LUFS) of every window of `seconds`, one each 5 ms, over [from, to) samples of a K-weighted power. */
function windows(power, seconds, from = 0, to = power.length) {
  const w = Math.round(seconds * SR);
  const hop = SR / 200;
  const pre = new Float64Array(power.length + 1);
  for (let i = 0; i < power.length; i++) pre[i + 1] = pre[i] + power[i];
  const out = [];
  for (let i = Math.max(0, from); i + w <= Math.min(power.length, to); i += hop)
    out.push(-0.691 + 10 * Math.log10(Math.max(0, pre[i + w] - pre[i]) / w + 1e-20));
  return out;
}
const loudest = (list) => list.reduce((m, v) => Math.max(m, v), Number.NEGATIVE_INFINITY);

// ------------------------------------------------------------------------------------------- the voice's level
const voice = new Float32Array(N);
for (const [id, s] of Object.entries(words.sections)) {
  const master = new URL(`narration/${id}.wav`, audio);
  const samples = decode(existsSync(master) ? path(master) : path(new URL(s.clip, audio)), 1);
  const at = Math.round(s.start * SR);
  for (let i = 0; i < samples.length && at + i < N; i++) voice[at + i] += samples[i];
}
const voicePower = kPower(voice, 1).map((p) => 2 * p); // the voice plays in both channels
const spoken = (list) => list.filter((v) => v > -40).sort((a, b) => a - b);
const p95 = (list) => list[Math.floor(list.length * 0.95)];
const MEASURED = {
  momentary: r2(p95(spoken(windows(voicePower, 0.4)))),
  short: r2(p95(spoken(windows(voicePower, 0.05)))),
};
// (a sheet may pin the reference of an approved mix, so a retimed film keeps exactly the approved levels)
const REF = sheet.voiceReference ?? MEASURED;

// ----------------------------------------------------------------------------------------------- the kit's files
const manifest = JSON.parse(readFileSync(join(kit, "manifest.json"), "utf8"));
const kitLicences = readFileSync(join(kit, "..", "LICENSES.md"), "utf8");
mkdirSync(new URL("sfx/", audio), { recursive: true });
const used = new Set(sheet.cues.flatMap((cue) => cue.hits.map((h) => h.s)));
const sounds = {};
for (const name of used) {
  const sound = sheet.sounds[name];
  if (!sound) throw new Error(`no sound "${name}" in sfx-cues.json`);
  const listed = manifest.bundled.find((entry) => entry.file === sound.kit);
  const cc0 = listed
    ? listed.license === "CC0 1.0"
    : sound.kit.startsWith("kit/") && kitLicences.includes(`| ${sound.kit} |`);
  if (!cc0 || /mixkit/i.test(`${sound.kit} ${sound.source}`))
    throw new Error(`${name}: ${sound.kit} is not a CC0 kit file`);
  const file = `sfx/cc0-${basename(sound.kit)}`;
  copyFileSync(join(kit, sound.kit), path(new URL(file, audio)));
  sounds[name] = { ...sound, file, samples: decode(join(kit, sound.kit), 2) };
}

// ------------------------------------------------------------------------------------------------------ the cues
const out = new Float32Array(N * 2);
const rows = [];
for (const cue of sheet.cues) {
  if (cue.under < sheet.minUnder)
    throw new Error(`${cue.id}: under ${cue.under} dB is less than ${sheet.minUnder}`);
  // the cue on its own, hits at their relative levels
  const pieces = cue.hits.map((hit) => {
    const src = sounds[hit.s].samples;
    const from = Math.round((hit.from ?? 0) * SR);
    const len = Math.min(
      src.length / 2 - from,
      hit.len ? Math.round(hit.len * SR) : Number.POSITIVE_INFINITY,
    );
    const fade = Math.min(len, Math.round((hit.fade ?? (hit.len ? 0.03 : 0)) * SR));
    const fadeIn = hit.from ? Math.round(0.005 * SR) : 0;
    const g = db(hit.g ?? 0);
    const piece = new Float32Array(len * 2);
    for (let i = 0; i < len; i++) {
      const shape = (i < fadeIn ? i / fadeIn : 1) * (i >= len - fade ? (len - i) / fade : 1);
      piece[i * 2] = src[(from + i) * 2] * g * shape;
      piece[i * 2 + 1] = src[(from + i) * 2 + 1] * g * shape;
    }
    return { at: Math.round((hit.t ?? 0) * SR), piece };
  });
  const span = Math.max(...pieces.map((p) => p.at + p.piece.length / 2));
  const pad = Math.round(0.4 * SR);
  const local = new Float32Array((span + 2 * pad) * 2);
  for (const p of pieces) for (let i = 0; i < p.piece.length; i++) local[(pad + p.at) * 2 + i] += p.piece[i];
  const power = kPower(local, 2);
  const m400 = loudest(windows(power, 0.4));
  const m50 = loudest(windows(power, 0.05));
  let peak = 0;
  for (const v of local) peak = Math.max(peak, Math.abs(v));
  let gain = -cue.under - Math.max(m400 - REF.momentary, m50 - REF.short);
  const capped = 20 * Math.log10(peak) + gain > sheet.peakCap;
  if (capped) gain = sheet.peakCap - 20 * Math.log10(peak);
  // (`anchor: "end"`: the cue ends on `at`, as the riser does on the turn)
  const start = Math.round(cue.at * SR) - (cue.anchor === "end" ? span : 0);
  const g = db(gain);
  for (let i = 0; i < span; i++) {
    const j = start + i;
    if (j < 0 || j >= N) continue;
    out[j * 2] += local[(pad + i) * 2] * g;
    out[j * 2 + 1] += local[(pad + i) * 2 + 1] * g;
  }
  // what the voice is doing while the cue sounds
  const [a, b] = [start - Math.round(0.3 * SR), start + span + Math.round(0.3 * SR)];
  const near = loudest(windows(voicePower, 0.4, a, b));
  rows.push({
    id: cue.id,
    at: r2(start / SR),
    end: r2((start + span) / SR),
    sounds: [...new Set(cue.hits.map((h) => h.s))],
    hits: cue.hits.length,
    under: cue.under,
    gainDb: r2(gain),
    peakDbfs: r2(20 * Math.log10(peak) + gain),
    momentaryLufs: r2(m400 + gain),
    shortLufs: r2(m50 + gain),
    underVoiceDb: r2(Math.min(REF.momentary - (m400 + gain), REF.short - (m50 + gain))),
    limitedBy: capped ? "peak" : m400 - REF.momentary > m50 - REF.short ? "400 ms" : "50 ms",
    voiceNearLufs: near > -40 ? r2(near) : null,
    picture: cue.picture,
  });
}
for (const row of rows)
  if (row.underVoiceDb < sheet.minUnder - 0.01)
    throw new Error(`${row.id}: only ${row.underVoiceDb} dB under the voice`);

// 16-bit PCM, like the placeholder it replaces
const pcm = Buffer.alloc(44 + N * 4);
pcm.write("RIFF", 0, "ascii");
pcm.writeUInt32LE(36 + N * 4, 4);
pcm.write("WAVEfmt ", 8, "ascii");
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 4, 28);
pcm.writeUInt16LE(4, 32);
pcm.writeUInt16LE(16, 34);
pcm.write("data", 36, "ascii");
pcm.writeUInt32LE(N * 4, 40);
let top = 0;
for (let i = 0; i < N * 2; i++) {
  top = Math.max(top, Math.abs(out[i]));
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(out[i] * 32767))), 44 + i * 2);
}
writeFileSync(new URL("sfx.wav", audio), pcm);

const credits = [...used]
  .map((name) => sounds[name])
  .filter((s, i, all) => all.findIndex((x) => x.kit === s.kit) === i)
  .sort((x, y) => x.author.localeCompare(y.author) || x.title.localeCompare(y.title));
const pad = (text, n) => String(text).padEnd(n);
const lines = [
  "Fair Split film v7: effects cue sheet (made by tools/sound-sfx.mjs from audio/sfx-cues.json; do not edit)",
  "",
  `${rows.length} cues, ${rows.reduce((s, r) => s + r.hits, 0)} sounds played, from ${credits.length} CC0 files of the Barty-Bart motion-graphics sound-effects kit.`,
  `Voice reference (95th percentile while speaking, K-weighted, both channels): ${REF.momentary} LUFS over 400 ms, ${REF.short} LUFS over 50 ms.`,
  `Every cue is at least ${sheet.minUnder} dB under it in both windows, and no cue peaks above ${sheet.peakCap} dBFS. Stem peak: ${r2(20 * Math.log10(top))} dBFS.`,
  "",
  `${pad("film s", 9)}${pad("cue", 20)}${pad("under", 7)}${pad("peak", 8)}${pad("400 ms", 9)}${pad("sounds", 30)}picture`,
  ...rows
    .sort((x, y) => x.at - y.at)
    .map(
      (r) =>
        `${pad(r.at.toFixed(2), 9)}${pad(r.id, 20)}${pad(r.underVoiceDb.toFixed(1), 7)}${pad(r.peakDbfs.toFixed(1), 8)}${pad(r.momentaryLufs.toFixed(1), 9)}${pad(r.sounds.join("+"), 30)}${r.picture}`,
    ),
  "",
  "Left out",
  ...(sheet.dropped ?? []).map((d) => `${pad(d.at.toFixed(2), 9)}${d.picture}: ${d.why}`),
  "",
  "Sounds (all CC0 1.0; credit given voluntarily)",
  ...credits.map((s) => `"${s.title}" by ${s.author}: ${s.source}  [${s.file}]`),
  "",
];
writeFileSync(new URL("cue-sheet.txt", audio), lines.join("\n"));
writeFileSync(
  new URL("sfx.json", audio),
  `${JSON.stringify({ duration: words.duration, voiceReference: REF, peakDbfs: r2(20 * Math.log10(top)), cues: rows, dropped: sheet.dropped ?? [], sounds: credits.map(({ samples, ...s }) => s) }, null, 2)}\n`,
);
console.log(`voice reference ${JSON.stringify(REF)} (measured now: ${JSON.stringify(MEASURED)})`);
for (const r of rows)
  console.log(
    `${r.at.toFixed(2).padStart(7)}  ${r.id.padEnd(18)} gain ${String(r.gainDb).padStart(6)} dB  peak ${String(r.peakDbfs).padStart(6)}  400ms ${String(r.momentaryLufs).padStart(6)}  50ms ${String(r.shortLufs).padStart(6)}  under ${String(r.underVoiceDb).padStart(5)} (${r.limitedBy})  voice near ${r.voiceNearLufs ?? "-"}`,
  );
console.log(
  `sfx.wav: ${rows.length} cues, ${rows.reduce((s, r) => s + r.hits, 0)} sounds, stem peak ${r2(20 * Math.log10(top))} dBFS`,
);
