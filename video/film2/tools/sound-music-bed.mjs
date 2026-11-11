// Film v7 music bed (175.0 s): Scott Buckley's "Machina" under sections 1-2, a clean cut at 38.0 s into "Aurora"
// (its build arriving on the cut), Aurora's calm tail under section 6, and Aurora's last crest landing where the
// narrator says the final "Fair Split.", ringing out to 175.0. CC BY 4.0, credited in audio/CREDITS.txt and on the
// end card; the MP3s live in a cache outside the repo (video/tools/fetch-music.mjs) and the bed is git-ignored.
// Cuts, fades and one level per piece only (plus one accent: Aurora enters 3.5 dB up and settles over 2.5 s, so the
// cut at 38.0 reads as a hit): nothing is layered, retimed or re-pitched.
//
//   node video/film2/tools/sound-music-bed.mjs <music-cache-dir>     -> audio/music-bed.wav, audio/music-bed.json
//
// Where each piece sits in its track was measured (per-window RMS and onsets, 11 Nov 2026): Machina is a level
// drone from 2 s to 118 s (no percussion, so no beat grid); Aurora's build arrives at 64.1 s (-21 to -16 dBFS in
// 100 ms) after a quiet dip, its last crest is at 300 s, it decays from 303 s and its glittering tail runs from
// 316 s. The times in the film come from timing.json's windows and audio/words.json's real word times.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TRACKS } from "../../tools/fetch-music.mjs";

const FFMPEG = process.env.HYPERFRAMES_FFMPEG_PATH ?? "ffmpeg";
const audio = new URL("../audio/", import.meta.url);
const words = JSON.parse(readFileSync(new URL("words.json", audio), "utf8"));
const FILM = words.duration;
const r3 = (v) => Math.round(v * 1000) / 1000;
export const AURORA = { arrival: 64.08, crest: 300.0, calm: 318 };
export const MACHINA = { from: 1.5 };

export function pieces() {
  const turn = words.sections.s3.start; // 38.0: the cut, 0.4 s before the narrator's "Fair Split"
  const hood = words.sections.s6.start; // 124
  const close = words.sections.s7.start; // 160
  const last = words.marks.fairSplitFinal.start; // the final "Fair Split."
  const liftFrom = close - 1.5;
  return [
    {
      id: "machina",
      track: "machina",
      film: [0, turn - 0.2],
      src: MACHINA.from,
      fade: [1.0, 0.05],
      lufs: -24,
      why: "A low, level drone under the scenario and the problem; it stops dead 0.2 s before the cut: a breath of silence.",
    },
    {
      id: "aurora-arrival",
      track: "aurora",
      film: [turn, hood + 0.9],
      src: AURORA.arrival,
      fade: [0.012, 2.0],
      lufs: -20.5,
      accent: { db: 3.5, seconds: 2.5 },
      why: `Cut in on Aurora's arrival (track ${AURORA.arrival} s) at ${turn} s, ahead of the narrator's "Fair Split" (${words.marks.fairSplit.start} s); bright under the solution, the demo and the comparison.`,
    },
    {
      id: "aurora-low",
      track: "aurora",
      film: [hood - 1.1, close + 1.0],
      src: AURORA.calm,
      fade: [2.0, 2.5],
      lufs: -25,
      why: "Aurora's calm, glittering tail, lower, under the architecture.",
    },
    {
      id: "aurora-final",
      track: "aurora",
      film: [liftFrom, FILM],
      src: AURORA.crest - (last - liftFrom),
      fade: [2.5, 2.0],
      lufs: -20,
      why: `The last build: Aurora's final crest (track ${AURORA.crest} s) lands on the last "Fair Split." (${last} s) and rings out to ${FILM} s.`,
    },
  ].map((p) => ({ ...p, film: p.film.map(r3), src: r3(p.src) }));
}

function ffmpeg(args) {
  const run = spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-y", ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr.slice(-800)}`);
  return run.stderr;
}
const integrated = (log) => Number(/I:\s+(-?[\d.]+) LUFS/.exec(log.slice(log.lastIndexOf("Summary")))?.[1]);

const cache = process.argv[2];
if (!cache) throw new Error("usage: sound-music-bed.mjs <music-cache-dir>");
const files = {};
for (const track of TRACKS) {
  const path = join(resolve(cache), track.file);
  if (!existsSync(path)) throw new Error(`${path} is missing: run video/tools/fetch-music.mjs first`);
  if (createHash("sha256").update(readFileSync(path)).digest("hex") !== track.sha256)
    throw new Error(`${track.file}: sha256 differs from fetch-music.mjs`);
  files[track.id] = path;
}
const list = pieces();
for (const piece of list) {
  const length = piece.film[1] - piece.film[0];
  const log = ffmpeg([
    "-ss",
    String(piece.src),
    "-t",
    String(length),
    "-i",
    files[piece.track],
    "-af",
    "ebur128=framelog=quiet",
    "-f",
    "null",
    "-",
  ]);
  piece.measured = integrated(log);
  piece.gain = r3(piece.lufs - piece.measured);
}
const index = Object.keys(files);
const inputs = Object.values(files).flatMap((path) => ["-i", path]);
const chains = list.map((piece, i) => {
  const length = r3(piece.film[1] - piece.film[0]);
  const [fin, fout] = piece.fade;
  const delay = Math.round(piece.film[0] * 1000);
  return `[${index.indexOf(piece.track)}:a]atrim=start=${piece.src}:duration=${length},asetpts=PTS-STARTPTS,aresample=48000:resampler=soxr,aformat=channel_layouts=stereo,volume=${piece.gain}dB,${piece.accent ? `volume='pow(10,${piece.accent.db}*max(0,1-t/${piece.accent.seconds})/20)':eval=frame,` : ""}afade=t=in:d=${fin}:curve=qsin,afade=t=out:st=${r3(length - fout)}:d=${fout}:curve=qsin,adelay=${delay}|${delay}[p${i}]`;
});
const graph = `${chains.join(";")};${list.map((_, i) => `[p${i}]`).join("")}amix=inputs=${list.length}:normalize=0:dropout_transition=0,apad,atrim=duration=${FILM}[bed]`;
const wav = fileURLToPath(new URL("music-bed.wav", audio));
ffmpeg([...inputs, "-filter_complex", graph, "-map", "[bed]", "-ar", "48000", "-c:a", "pcm_s16le", wav]);
const whole = integrated(ffmpeg(["-i", wav, "-af", "ebur128=framelog=quiet", "-f", "null", "-"]));
writeFileSync(
  new URL("music-bed.json", audio),
  `${JSON.stringify({ duration: FILM, tracks: TRACKS.map(({ id, title, file, sha256, credit, page }) => ({ id, title, file, sha256, credit, page })), pieces: list, integrated: whole }, null, 2)}\n`,
);
for (const piece of list)
  console.log(
    `${piece.id.padEnd(15)} film ${piece.film.join("-")}  ${piece.track} from ${piece.src} s  ${piece.measured} LUFS -> ${piece.lufs} (${piece.gain > 0 ? "+" : ""}${piece.gain} dB)`,
  );
console.log(`music-bed.wav: ${FILM} s, ${whole} LUFS integrated`);
