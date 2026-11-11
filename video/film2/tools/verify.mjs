// Fair Split film v7: check the finished MP4 (not the project).
//   node tools/verify.mjs [--sheet <path to a contact sheet PNG>]
// Reads out/<name>.mp4 (--name, default fair-split-film-v8) and reports: the streams (duration, size, frame rate, the subtitle track's
// default flag), integrated loudness and true peak, the mean luma of a ground-only patch in every section (one
// ground, one brightness), any run of frames that is nothing but the ground, and how many pixels change across
// each section cut. Exports a frame every 5 s (and
// the last frame) to out/final-frames-<vN>/ and a labelled contact sheet. Writes the numbers to out/verify.json.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const timing = JSON.parse(readFileSync(join(root, "timing.json"), "utf8"));
const args = process.argv.slice(2);
const NAME = args.includes("--name") ? args[args.indexOf("--name") + 1] : "fair-split-film-v8";
const FRAMES = `final-frames-${NAME.split("-").pop()}`;
const film = join(root, "out", `${NAME}.mp4`);
const sheet = args.includes("--sheet")
  ? args[args.indexOf("--sheet") + 1]
  : join(root, "out", FRAMES, "sheet.png");
const run = (command, list) => spawnSync(command, list, { encoding: "utf8", maxBuffer: 1 << 28 });

// 1. the streams
const probe = JSON.parse(
  run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", film]).stdout,
);
const video = probe.streams.find((stream) => stream.codec_type === "video");
const audio = probe.streams.find((stream) => stream.codec_type === "audio");
const subtitle = probe.streams.find((stream) => stream.codec_type === "subtitle");
const report = {
  file: `out/${NAME}.mp4`,
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
// Several patches, because a close-up can cover any one of them: a frame's ground reading comes from a patch
// that is perfectly flat (one value). The film's ground is the value the first frames of section 1 show.
const PATCHES = [
  { name: "top centre", x: 800, y: 8, w: 300, h: 30 },
  { name: "bottom centre", x: 800, y: 1046, w: 300, h: 28 },
  { name: "bottom left", x: 12, y: 1046, w: 300, h: 28 },
  { name: "top left", x: 12, y: 4, w: 300, h: 16 },
  { name: "left edge", x: 4, y: 500, w: 24, h: 80 },
  { name: "right edge", x: 1892, y: 500, w: 24, h: 80 },
];
const patches = PATCHES.map((area) =>
  stats(`crop=${area.w * scale}:${area.h * scale}:${area.x * scale}:${area.y * scale}`),
);
const ground = patches[0][0].YAVG;
report.groundPatches = PATCHES.map(
  (area) => `${area.name}: ${area.w} x ${area.h} CSS px at (${area.x}, ${area.y})`,
);
report.groundLuma = ground;
const reading = patches[0].map((frame, index) => {
  const flat = patches.map((list) => list[index]).filter((item) => item.YMIN === item.YMAX);
  const onGround = flat.find((item) => item.YMIN === ground);
  // a flat patch that is not the ground's value is either a card's face or a veil: keep the darkest to report
  const other = flat.length > 0 ? Math.min(...flat.map((item) => item.YMIN)) : null;
  return { t: frame.t, ground: onGround ? ground : null, other };
});
report.ground = timing.sections.map((section) => {
  const own = reading.filter(
    (frame) => frame.t >= section.start - 1e-6 && frame.t < section.start + section.duration - 1e-6,
  );
  const seen = own.filter((frame) => frame.ground !== null);
  const unseen = own.filter((frame) => frame.ground === null);
  return {
    section: section.id,
    frames: own.length,
    framesWithAGroundPatch: seen.length,
    groundLuma: seen.length > 0 ? ground : null,
    framesWithoutOne: unseen.length,
    ...(unseen.length > 0
      ? {
          firstWithout: unseen[0].t,
          lastWithout: unseen[unseen.length - 1].t,
          darkestFlatPatchThere: Math.min(...unseen.map((frame) => frame.other ?? 255)),
        }
      : {}),
  };
});
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

// 4. the cuts (timing.json): the last frame before each cut and the first frame after it, compared pixel by pixel.
//    A seamless cut differs only by the encoder's residue: a handful of pixels, never a visible area.
const dir = join(root, "out", FRAMES);
mkdirSync(join(dir, "cuts"), { recursive: true });
const pngPixels = (file) => {
  const out = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "gray", "-"], {
    maxBuffer: 1 << 28,
  });
  return out.stdout;
};
report.cuts = timing.sections.slice(1).map((section) => {
  const frame = Math.round(section.start * timing.fps);
  const pattern = join(dir, "cuts", `cut-${section.start}s-%d.png`);
  run("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    film,
    "-vf",
    `select='between(n,${frame - 1},${frame})'`,
    "-fps_mode",
    "passthrough",
    "-start_number",
    "0",
    pattern,
  ]);
  const before = pngPixels(pattern.replace("%d", "0"));
  const after = pngPixels(pattern.replace("%d", "1"));
  let differing = 0;
  let largest = 0;
  for (let index = 0; index < before.length; index += 1) {
    const delta = Math.abs(before[index] - after[index]);
    if (delta >= 5) differing += 1;
    if (delta > largest) largest = delta;
  }
  return { at: section.start, into: section.id, pixelsDifferingBy5: differing, largestDifference: largest };
});

// 5. a frame every 5 s, the last frame, and a labelled contact sheet
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
  `${cells.join(";")};${files.map((_, index) => `[v${index}]`).join("")}xstack=inputs=${files.length}:layout=${layout.join("|")}:fill=0xF7F8FB`,
  sheet,
]);
report.frames = { folder: `out/${FRAMES}`, count: files.length, sheet };

writeFileSync(join(root, "out", "verify.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
const problems = [];
if (Math.abs(report.duration - timing.duration) > 0.02)
  problems.push(`duration ${report.duration}, expected ${timing.duration}`);
if (report.video.width !== timing.canvas.width * timing.outputScale)
  problems.push(`width ${report.video.width}`);
if (report.video.fps !== `${timing.fps}/1`) problems.push(`frame rate ${report.video.fps}`);
if (report.subtitle?.default) problems.push("the subtitle track is flagged default");
for (const cut of report.cuts)
  if (cut.pixelsDifferingBy5 > 2000)
    problems.push(`the cut at ${cut.at} s is not seamless: ${cut.pixelsDifferingBy5} pixels differ`);
if (report.ground.some((item) => item.framesWithoutOne > 0))
  problems.push("the ground's brightness is not the same in every section");
for (const text of problems) console.error(`verify: ${text}`);
process.exit(problems.length > 0 ? 1 : 0);
