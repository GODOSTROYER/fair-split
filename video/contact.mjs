// Tiles 24 frames of the rough cut into one contact sheet (6 × 4), at least one per beat, each labelled with its
// film time. Usage (from the worktree root): node video/contact.mjs [ffmpeg] [in.mp4] [out.png]
import { spawnSync } from "node:child_process";

const [ffmpeg = "ffmpeg", input = "video/out/rough-cut-v2.mp4", output = "video/out/rough-cut-v2-sheet.png"] =
  process.argv.slice(2);
// problem · solution · architecture · the reel · the deep dive · the close
const TIMES = [
  2.4, 4.0, 8.9, 13.9, 15.0, 18.3, 20.9, 24.2, 29.2, 35, 44.5, 48, 53.5, 57.6, 63, 70, 75, 88, 107.5, 125,
  140, 145, 160, 172,
];
const select = TIMES.map((t) => `eq(n\\,${Math.round(t * 30)})`).join("+");
const font = "C\\:/Windows/Fonts/arial.ttf";
const label = `drawtext=fontfile='${font}':text='%{pts\\:hms}':x=14:y=h-th-14:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8`;
const run = spawnSync(
  ffmpeg,
  [
    "-y",
    "-loglevel",
    "error",
    "-i",
    input,
    "-vf",
    `select='${select}',scale=480:-1,${label},tile=6x4:padding=6:margin=6:color=0x111111`,
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
