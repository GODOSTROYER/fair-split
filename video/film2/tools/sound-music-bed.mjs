// Film v7 music bed (the film's length): Scott Buckley's "Machina" under sections 1-2, a clean cut at 38.0 s into "Aurora"
// (its build arriving on the cut), Aurora's calm tail under section 6, and Aurora's last crest landing where the
// narrator says the final "Fair Split.", ringing out to the end. In the retimed film (179.0 s) the calm tail also
// lifts gently for 2.5 s once section 6's voice has ended, while the finished diagram runs, and settles. CC BY 4.0, credited in audio/CREDITS.txt and on the
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
  const hood = words.sections.s6.start; // 112
  const close = words.sections.s7.start; // 166
  // the finished diagram runs without voice from here (the director's 160.0; never before the last word)
  const runs = Math.max(160, Math.ceil(words.sections.s6.speech[1] * 10) / 10);
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
      ref: [AURORA.arrival, 82.9], // levelled on the same stretch as the approved 175 s bed, so it is unchanged
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
      ref: [AURORA.calm, 40.1],
      lift: { from: runs, up: 1.0, hold: 0.7, down: 0.8, db: 5 },
      why: `Aurora's calm, glittering tail, lower, under the architecture; from ${runs} s it lifts 5 dB over 1.0 s, holds 0.7 s and settles by ${r3(runs + 2.5)} s (a gentle rise while the finished diagram runs, not a hit).`,
    },
    {
      id: "aurora-final",
      track: "aurora",
      film: [liftFrom, FILM],
      src: AURORA.crest - (last - liftFrom),
      // (the last word ends about 1.3 s before the film does: a short fade, so the crest still rings after it)
      fade: [2.5, 1.2],
      lufs: -20,
      ref: [287.8, 18.5],
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
  const length = piece.ref?.[1] ?? piece.film[1] - piece.film[0];
  const log = ffmpeg([
    "-ss",
    String(piece.ref?.[0] ?? piece.src),
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
/** A level rise and fall on one piece: up over `up` s from film `from`, held, back down (a volume envelope). */
function lift(piece) {
  if (!piece.lift) return "";
  const { from, up, hold, down, db } = piece.lift;
  const a = r3(from - piece.film[0]);
  const end = r3(a + up + hold + down);
  return `volume='pow(10,${db}*min(1,max(0,(t-${a})/${up}))*min(1,max(0,(${end}-t)/${down}))/20)':eval=frame,`;
}
const index = Object.keys(files);
const inputs = Object.values(files).flatMap((path) => ["-i", path]);
const chains = list.map((piece, i) => {
  const length = r3(piece.film[1] - piece.film[0]);
  const [fin, fout] = piece.fade;
  const delay = Math.round(piece.film[0] * 1000);
  return `[${index.indexOf(piece.track)}:a]atrim=start=${piece.src}:duration=${length},asetpts=PTS-STARTPTS,aresample=48000:resampler=soxr,aformat=channel_layouts=stereo,volume=${piece.gain}dB,${piece.accent ? `volume='pow(10,${piece.accent.db}*max(0,1-t/${piece.accent.seconds})/20)':eval=frame,` : ""}${lift(piece)}afade=t=in:d=${fin}:curve=qsin,afade=t=out:st=${r3(length - fout)}:d=${fout}:curve=qsin,adelay=${delay}|${delay}[p${i}]`;
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
