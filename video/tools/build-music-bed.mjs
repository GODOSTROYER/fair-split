// The film's music bed: Scott Buckley's "Machina" under the black opening, crossfading into "Aurora", whose build
// lands on the turn (CC BY 4.0, credited in LICENSES.md and CREDITS.txt). Cuts, fades and one level per piece only:
// nothing is re-orchestrated, layered or retimed. Every time comes from script.ts and plan.mjs, so the bed follows
// the picture when it moves.
//
//   node video/tools/build-music-bed.mjs <music-cache-dir>     (fetch it first with fetch-music.mjs)
//
// Writes video/out/music-bed.wav (48 kHz stereo, the film's length, git-ignored) and out/music-bed.json (the pieces
// with their measured loudness). Where each piece sits in its track was measured, not heard: per-window RMS and
// band levels (5 Nov 2026) put Aurora's build arriving at 63.3 s after a quiet dip (59-63 s), its climax at 300 s,
// and its glittering tail from 312 s; Machina is a low drone with no percussion (so no beat grid is needed).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CLOSE, MEMBER_CLIP, OPENING } from "../plan.mjs";
import { beats, FILM, PARTS } from "../script.ts";
import { TRACKS } from "./fetch-music.mjs";

const FFMPEG = process.env.HYPERFRAMES_FFMPEG_PATH ?? "ffmpeg";
const out = new URL("../out/", import.meta.url);
const r3 = (v) => Math.round(v * 1000) / 1000;
/** Aurora: where its build arrives (63.3 s), its climax (300 s) and its calm, glittering tail (316 s). */
export const AURORA = { arrival: 63.3, peak: 300, calm: 316 };

/** The bed's pieces, in film seconds, each a cut of one track with a fade at each end and one level. */
export function pieces() {
  const turn = OPENING.turn[0];
  const deepDive = PARTS.find((part) => part.id === "deep-dive")?.start ?? 57;
  const [herFirst, herLast] = MEMBER_CLIP.speech;
  const endBeat = beats.find((beat) => beat.id === "end")?.start ?? 164;
  const calmA = [deepDive - 0.4, MEMBER_CLIP.start - 0.05];
  const calmB = [herLast + 0.2, endBeat + 0.5];
  const liftFrom = endBeat - 1.0;
  return [
    {
      id: "machina",
      track: "machina",
      film: [0, turn + 0.25],
      src: 0,
      fade: [1.2, 1.6],
      lufs: -24,
      why: "A low drone under the black opening, from the first frame to the turn.",
    },
    {
      id: "aurora-build",
      track: "aurora",
      film: [turn - 3.4, deepDive + 0.6],
      src: AURORA.arrival - 3.4,
      fade: [2.6, 1.4],
      lufs: -22,
      why: `Aurora rises out of its quiet dip and its build arrives on the turn (${turn} s); bright under the solution, the architecture and the reel.`,
    },
    {
      id: "aurora-calm",
      track: "aurora",
      film: calmA,
      src: AURORA.calm,
      fade: [1.6, 0.8],
      lufs: -24,
      why: `Calmer under the deep dive (its glittering tail), out completely before her own sentence (${r3(herFirst)} s).`,
    },
    {
      id: "aurora-calm-return",
      track: "aurora",
      film: calmB,
      src: AURORA.calm + (calmA[1] - calmA[0]),
      fade: [1.2, 1.5],
      lufs: -24,
      why: `Back in low once her sentence ends (${r3(herLast)} s), where it left off, under why it holds up and the limits.`,
    },
    {
      id: "aurora-lift",
      track: "aurora",
      film: [liftFrom, FILM.duration],
      src: AURORA.peak - (CLOSE.endLine - liftFrom),
      fade: [1.5, 1.4],
      lufs: -21,
      why: `The final lift: Aurora's climax lands on the end line (${CLOSE.endLine} s) and falls away under the name (${CLOSE.name} s).`,
    },
  ].map((piece) => ({ ...piece, film: piece.film.map(r3), src: r3(piece.src) }));
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

function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: build-music-bed.mjs <music-cache-dir>");
  const files = {};
  for (const track of TRACKS) {
    const path = join(resolve(dir), track.file);
    if (!existsSync(path)) throw new Error(`${path} is missing: run fetch-music.mjs first`);
    const sha = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (sha !== track.sha256) throw new Error(`${track.file}: sha256 differs from fetch-music.mjs`);
    files[track.id] = path;
  }
  mkdirSync(out, { recursive: true });
  const list = pieces();
  // each piece's level: its own integrated loudness, measured on the cut, brought to its target
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
  const inputs = Object.values(files).flatMap((path) => ["-i", path]);
  const index = Object.keys(files);
  const chains = list.map((piece, i) => {
    const length = r3(piece.film[1] - piece.film[0]);
    const [fin, fout] = piece.fade;
    const delay = Math.round(piece.film[0] * 1000);
    return `[${index.indexOf(piece.track)}:a]atrim=start=${piece.src}:duration=${length},asetpts=PTS-STARTPTS,aresample=48000:resampler=soxr,aformat=channel_layouts=stereo,volume=${piece.gain}dB,afade=t=in:d=${fin}:curve=qsin,afade=t=out:st=${r3(length - fout)}:d=${fout}:curve=qsin,adelay=${delay}|${delay}[p${i}]`;
  });
  const graph = `${chains.join(";")};${list.map((_, i) => `[p${i}]`).join("")}amix=inputs=${list.length}:normalize=0:dropout_transition=0,atrim=duration=${FILM.duration}[bed]`;
  const wav = fileURLToPath(new URL("music-bed.wav", out));
  ffmpeg([...inputs, "-filter_complex", graph, "-map", "[bed]", "-ar", "48000", "-c:a", "pcm_s16le", wav]);
  const whole = integrated(ffmpeg(["-i", wav, "-af", "ebur128=framelog=quiet", "-f", "null", "-"]));
  writeFileSync(
    new URL("music-bed.json", out),
    `${JSON.stringify({ tracks: TRACKS.map(({ id, file, sha256, credit }) => ({ id, file, sha256, credit })), pieces: list, integrated: whole }, null, 2)}\n`,
  );
  for (const piece of list)
    console.log(
      `${piece.id.padEnd(19)} film ${piece.film.join("-")}  ${piece.track} from ${piece.src} s  ${piece.measured} LUFS -> ${piece.lufs} (${piece.gain > 0 ? "+" : ""}${piece.gain} dB)`,
    );
  console.log(`music-bed.wav: ${FILM.duration} s, ${whole} LUFS integrated`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
