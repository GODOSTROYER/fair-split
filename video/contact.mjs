// Tiles 24 frames of the rough cut into one contact sheet (6 × 4), at least one per beat, each labelled with its
// film time. Usage (from the worktree root): node video/contact.mjs [ffmpeg] [in.mp4] [out.png] [t1,t2,...]
// The optional fourth argument picks other frames (e.g. both sides of every cut); the grid grows to fit them.
import { spawnSync } from "node:child_process";

const [
  ffmpeg = "ffmpeg",
  input = "video/out/rough-cut-v3.mp4",
  output = "video/out/rough-cut-v3-sheet.png",
  times,
] = process.argv.slice(2);
// problem · the turn · solution · the end line · architecture (four steps, the overview) · the reel · the deep dive
// · the close (figures, the slip, the limits, the trace, the name)
const TIMES = times
  ? times.split(",").map(Number)
  : [
      2.4, 8.9, 13.9, 15.2, 18.3, 24.2, 27.6, 31.5, 35.5, 39.6, 42.8, 46.5, 57.6, 66.5, 75, 88, 107.5, 125,
      131.5, 145, 151, 158, 169.5, 173.5,
    ];
const select = TIMES.map((t) => `eq(n\\,${Math.round(t * 30)})`).join("+");
const font = "C\\:/Windows/Fonts/arial.ttf";
const label = `drawtext=fontfile='${font}':text='%{pts\\:hms}':x=14:y=h-th-14:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8`;
const rows = Math.ceil(TIMES.length / 6);
const run = spawnSync(
  ffmpeg,
  [
    "-y",
    "-loglevel",
    "error",
    "-i",
    input,
    "-vf",
    `select='${select}',scale=480:-1,${label},tile=6x${rows}:padding=6:margin=6:color=0x111111`,
    "-frames:v",
    "1",
    "-fps_mode",
    "vfr",
    output,
  ],
  { encoding: "utf8" },
);
if (run.status !== 0) throw new Error(run.stderr);
console.log(output);
