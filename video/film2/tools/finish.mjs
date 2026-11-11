// Fair Split film v7: the delivery files, from the rendered picture and SOUND's final mix.
//   npx hyperframes render --resolution 4k --fps 30 --quality delivery --crf 12 --output out/fair-split-film-v8-picture.mp4
//   node tools/finish.mjs
// Writes, in out/:
//   fair-split-film-v8.mp4         the picture as rendered (copied, not re-encoded), audio/mix.wav as AAC 320 kb/s,
//                                  audio/captions.vtt as a soft English subtitle track that is NOT on by default
//   fair-split-film-v8.en.vtt      the same captions, for YouTube; and .en.srt, the same again as SubRip
//   fair-split-film-v8-1080p.mp4   a 1920x1080 copy, downscaled from the 4K master, for quick viewing
// The browser's own audio mix in the picture file is dropped: the film's sound is audio/mix.wav.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const timing = JSON.parse(readFileSync(join(root, "timing.json"), "utf8"));
// the cut's name: node tools/finish.mjs --name fair-split-film-v9 for the next one
const NAME = process.argv.includes("--name")
  ? process.argv[process.argv.indexOf("--name") + 1]
  : "fair-split-film-v8";
const picture = join(root, "out", `${NAME}-picture.mp4`);
const mix = join(root, "audio", "mix.wav");
const captions = join(root, "audio", "captions.vtt");
const master = join(root, "out", `${NAME}.mp4`);
const small = join(root, "out", `${NAME}-1080p.mp4`);
for (const file of [picture, mix, captions]) {
  if (!existsSync(file)) {
    console.error(`finish: ${file} is missing`);
    process.exit(1);
  }
}

const ffmpeg = (args) => {
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

/** An MP4 muxer turns the first subtitle track on when none is flagged default. Players should show captions only
    when asked, so clear the "track enabled" bit (tkhd flag 0x1) of every subtitle track, in place. */
function subtitlesOffByDefault(file) {
  const data = readFileSync(file);
  const boxes = (from, to) => {
    const list = [];
    let at = from;
    while (at + 8 <= to) {
      let size = data.readUInt32BE(at);
      let head = 8;
      if (size === 1) {
        size = Number(data.readBigUInt64BE(at + 8));
        head = 16;
      } else if (size === 0) size = to - at;
      if (size < head) break;
      list.push({ type: data.toString("latin1", at + 4, at + 8), body: at + head, end: at + size });
      at += size;
    }
    return list;
  };
  const moov = boxes(0, data.length).find((box) => box.type === "moov");
  if (!moov) throw new Error(`${file}: no moov box`);
  let cleared = 0;
  for (const trak of boxes(moov.body, moov.end).filter((box) => box.type === "trak")) {
    const children = boxes(trak.body, trak.end);
    const tkhd = children.find((box) => box.type === "tkhd");
    const mdia = children.find((box) => box.type === "mdia");
    const hdlr = mdia && boxes(mdia.body, mdia.end).find((box) => box.type === "hdlr");
    if (!tkhd || !hdlr) continue;
    const handler = data.toString("latin1", hdlr.body + 8, hdlr.body + 12);
    if (!["sbtl", "text", "subt"].includes(handler)) continue;
    const flags = data.readUIntBE(tkhd.body + 1, 3);
    data.writeUIntBE(flags & ~1, tkhd.body + 1, 3);
    cleared += 1;
  }
  if (cleared === 0) throw new Error(`${file}: no subtitle track found`);
  writeFileSync(file, data);
}

// the master: picture copied, the final mix, the captions
ffmpeg([
  "-i",
  picture,
  "-i",
  mix,
  "-i",
  captions,
  "-map",
  "0:v:0",
  "-map",
  "1:a:0",
  "-map",
  "2:s:0",
  "-c:v",
  "copy",
  "-c:a",
  "aac",
  "-b:a",
  "320k",
  "-ar",
  "48000",
  "-c:s",
  "mov_text",
  "-metadata:s:v:0",
  "language=eng",
  "-metadata:s:a:0",
  "language=eng",
  "-metadata:s:s:0",
  "language=eng",
  "-metadata:s:s:0",
  "title=English",
  "-metadata",
  "title=Fair Split: co-op payroll",
  "-movflags",
  "+faststart",
  "-t",
  String(timing.duration),
  master,
]);
subtitlesOffByDefault(master);
copyFileSync(captions, join(root, "out", `${NAME}.en.vtt`));
ffmpeg(["-i", captions, join(root, "out", `${NAME}.en.srt`)]);

// the quick-view copy: downscaled from the 4K master, visually lossless
ffmpeg([
  "-i",
  master,
  "-map",
  "0:v:0",
  "-map",
  "0:a:0",
  "-map",
  "0:s:0",
  "-vf",
  `scale=${timing.canvas.width}:${timing.canvas.height}:flags=lanczos`,
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "10",
  "-pix_fmt",
  "yuv420p",
  "-color_primaries",
  "bt709",
  "-color_trc",
  "bt709",
  "-colorspace",
  "bt709",
  "-c:a",
  "copy",
  "-c:s",
  "copy",
  "-metadata:s:s:0",
  "language=eng",
  "-metadata:s:s:0",
  "title=English",
  "-movflags",
  "+faststart",
  small,
]);
subtitlesOffByDefault(small);

console.log(
  `finish: wrote out/${NAME}.mp4, out/${NAME}.en.vtt, out/${NAME}.en.srt and out/${NAME}-1080p.mp4`,
);
