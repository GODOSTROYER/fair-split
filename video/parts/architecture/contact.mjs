// Contact sheet of out/architecture.mp4: one frame every half second (beat time stamped), 4 x 7 grid.
// Run after the render: node video/parts/architecture/contact.mjs [ffmpeg]
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const ffmpeg = process.argv[2] ?? process.env.HYPERFRAMES_FFMPEG_PATH ?? "ffmpeg";
const font = [
  "C:/Windows/Fonts/consola.ttf",
  "/System/Library/Fonts/Menlo.ttc",
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
].find((path) => existsSync(path));
const stamp = font
  ? `,drawtext=fontfile='${font.replace(":", "\\:")}':text='%{pts\\:hms}':x=10:y=10:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=6`
  : "";
execFileSync(
  ffmpeg,
  [
    "-v",
    "error",
    "-y",
    "-i",
    here("out/architecture.mp4"),
    "-vf",
    // exact frames 0, 15, 30, ... (the fps filter would sample between them)
    `select='not(mod(n\\,15))',scale=480:-2${stamp},tile=4x7:padding=4:margin=4:color=0x1a1a1a`,
    "-fps_mode",
    "vfr",
    "-frames:v",
    "1",
    here("out/contact-sheet.jpg"),
  ],
  { stdio: "inherit" },
);
console.log(here("out/contact-sheet.jpg"));
