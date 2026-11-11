// Fair Split film v7: check the finished MP4 (not the project).
//   node tools/verify.mjs [--sheet <path to a contact sheet PNG>]
// Reads out/fair-split-film-v7.mp4 and reports: the streams (duration, size, frame rate, the subtitle track's
// default flag), integrated loudness and true peak, the mean luma of a ground-only patch in every section (one
// ground, one brightness), and any run of frames that is nothing but the ground. Exports a frame every 5 s (and
// the last frame) to out/final-frames/ and a labelled contact sheet. Writes the numbers to out/verify.json.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const timing = JSON.parse(readFileSync(join(root, "timing.json"), "utf8"));
const film = join(root, "out", "fair-split-film-v7.mp4");
const args = process.argv.slice(2);
const sheet = args.includes("--sheet")
  ? args[args.indexOf("--sheet") + 1]
  : join(root, "out", "final-frames", "sheet.png");
const run = (command, list) => spawnSync(command, list, { encoding: "utf8", maxBuffer: 1 << 28 });

// 1. the streams
const probe = JSON.parse(
  run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", film]).stdout,
);
const video = probe.streams.find((stream) => stream.codec_type === "video");
const audio = probe.streams.find((stream) => stream.codec_type === "audio");
const subtitle = probe.streams.find((stream) => stream.codec_type === "subtitle");
const report = {
  file: "out/fair-split-film-v7.mp4",
  bytes: Number(probe.format.size),
  duration: Number(probe.format.duration),
  video: {
    codec: video.codec_name,
    width: video.width,
    height: video.height,
    fps: video.r_frame_rate,
    frames: Number(video.nb_frames),
    bitRate: Number(video.bit_rate),
  },
  audio: { codec: audio.codec_name, bitRate: Number(audio.bit_rate), sampleRate: Number(audio.sample_rate) },
  subtitle: subtitle
    ? {
        codec: subtitle.codec_name,
        language: subtitle.tags?.language,
        default: subtitle.disposition?.default === 1,
      }
    : null,
};

// 2. loudness
const loud = run("ffmpeg", [
  "-hide_banner",
  "-nostats",
  "-i",
  film,
  "-map",
  "0:a:0",
  "-af",
  "ebur128=peak=true:framelog=quiet",
  "-f",
  "null",
  "-",
]).stderr;
const summary = loud.slice(loud.lastIndexOf("Summary:"));
report.loudness = {
  integratedLufs: Number(/I:\s*(-?[\d.]+) LUFS/.exec(summary)?.[1]),
  rangeLu: Number(/LRA:\s*(-?[\d.]+) LU/.exec(summary)?.[1]),
  truePeakDbtp: Number(/Peak:\s*(-?[\d.]+) dBFS/.exec(summary)?.[1]),
};

// 3. the ground: a top-centre patch no section draws on, and the whole frame at quarter size
const stats = (filter) => {
  const out = run("ffmpeg", [
    "-v",
    "error",
    "-i",
    film,
    "-map",
    "0:v:0",
    "-vf",
    `${filter},signalstats,metadata=print:file=-`,
    "-f",
    "null",
    "-",
  ]).stdout;
  const frames = [];
  let current;
  for (const line of out.split(/\r?\n/)) {
    const time = /pts_time:([\d.]+)/.exec(line);
    if (time) {
      current = { t: Number(time[1]) };
      frames.push(current);
      continue;
    }
    const value = /signalstats\.(YMIN|YMAX|YAVG)=([\d.]+)/.exec(line);
    if (value && current) current[value[1]] = Number(value[2]);
  }
  return frames;
};
const scale = video.width / timing.canvas.width;
const patch = stats(`crop=${300 * scale}:${30 * scale}:${800 * scale}:${8 * scale}`);
report.groundPatch = "300 x 30 CSS px at (800, 8)";
report.ground = timing.sections.map((section) => {
  const own = patch.filter((frame) => frame.t >= section.start && frame.t < section.start + section.duration);
  return {
    section: section.id,
    frames: own.length,
    meanLuma: Math.round((own.reduce((sum, frame) => sum + frame.YAVG, 0) / own.length) * 1000) / 1000,
    minLuma: Math.min(...own.map((frame) => frame.YMIN)),
    maxLuma: Math.max(...own.map((frame) => frame.YMAX)),
  };
});
const ground = report.ground[0].meanLuma;
const whole = stats("scale=960:540");
const runs = [];
let open = null;
for (const frame of whole) {
  const blank = frame.YMIN >= ground - 1 && frame.YMAX <= ground + 1;
  if (blank) {
    open ??= { from: frame.t, to: frame.t };
    open.to = frame.t;
  } else if (open) {
    runs.push(open);
    open = null;
  }
}
if (open) runs.push(open);
const frameTime = 1 / timing.fps;
report.blankRuns = runs.map((item) => ({
  from: Math.round(item.from * 100) / 100,
  to: Math.round((item.to + frameTime) * 100) / 100,
  seconds: Math.round((item.to - item.from + frameTime) * 100) / 100,
}));
report.darkestFrame = whole.reduce((a, frame) => (frame.YAVG < a.YAVG ? frame : a));

// 4. a frame every 5 s, the last frame, and a labelled contact sheet
const dir = join(root, "out", "final-frames");
mkdirSync(dir, { recursive: true });
for (const name of readdirSync(dir)) if (/^f-.*\.png$/.test(name)) rmSync(join(dir, name));
const times = [];
for (let t = 0; t < timing.duration; t += 5) times.push(t);
times.push(timing.duration - 0.1);
const files = times.map((t) => {
  const file = join(dir, `f-${t.toFixed(1).padStart(5, "0")}s.png`);
  run("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", film, "-frames:v", "1", file]);
  return file;
});
const columns = 6;
const tile = { w: 640, h: 360 };
const inputs = files.flatMap((file) => ["-i", file]);
const cells = files.map((_, index) => {
  const label = `${times[index].toFixed(1)} s`;
  return `[${index}:v]scale=${tile.w}:${tile.h}:flags=lanczos,drawtext=text='${label}':x=10:y=10:fontsize=22:fontcolor=white:box=1:boxcolor=0x0E1525@0.9:boxborderw=6,pad=${tile.w + 4}:${tile.h + 4}:2:2:color=0xD9DEE7[v${index}]`;
});
const layout = files.map(
  (_, index) => `${(index % columns) * (tile.w + 4)}_${Math.floor(index / columns) * (tile.h + 4)}`,
);
run("ffmpeg", [
  "-v",
  "error",
  "-y",
  ...inputs,
  "-filter_complex",
  `${cells.join(";")};${files.map((_, index) => `[v${index}]`).join("")}xstack=inputs=${files.length}:layout=${layout.join("|")}`,
  sheet,
]);
report.frames = { folder: "out/final-frames", count: files.length, sheet };

writeFileSync(join(root, "out", "verify.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
const problems = [];
if (Math.abs(report.duration - timing.duration) > 0.02)
  problems.push(`duration ${report.duration}, expected ${timing.duration}`);
if (report.video.width !== timing.canvas.width * timing.outputScale)
  problems.push(`width ${report.video.width}`);
if (report.video.fps !== `${timing.fps}/1`) problems.push(`frame rate ${report.video.fps}`);
if (report.subtitle?.default) problems.push("the subtitle track is flagged default");
if (report.ground.some((item) => item.minLuma !== item.maxLuma || item.meanLuma !== ground))
  problems.push("the ground's brightness is not the same in every section");
for (const text of problems) console.error(`verify: ${text}`);
process.exit(problems.length > 0 ? 1 : 0);
