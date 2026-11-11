// One command from the current UI to the finished film: re-record every capture slot from a real judge run, cut the
// clips, rebuild and check the film, render the picture, lay the approved sound under it and measure the result.
// The sound is not re-made: the narration, the music bed, the effects and the mix are the approved ones (ADR-0018);
// only the picture changes.
//
//   node video/tools/recapture.mjs [--name rough-cut-v6] [--quality draft|delivery] [--skip-take] [--skip-render]
//
// From the worktree root, Node 24, with the offline HyperFrames environment (video/proto/tools/env.sh: the cached
// headless Chromium and the WinGet ffmpeg; the defaults below are this laptop's). Steps:
//   1. FILM_TAKE=slots corepack pnpm e2e:film      the slots take (e2e/film/slots.spec.ts) on a private simulator
//                                                   stack, recorded to e2e/film-out/slots (free ports, its own
//                                                   database; set E2E_SKIP_BUILD=1 to serve the current dists)
//   2. node video/tools/cut-captures.mjs           every slot's clip into video/captures/, and captures/take.json
//   3. node video/build.mjs && node video/check.mjs
//   4. hyperframes render video                    out/<name>-picture.mp4 (draft: CRF default; delivery: CRF 14)
//   5. the approved sound: out/music-bed.wav (built from the music cache if missing), tools/mix.mjs, then
//      tools/mix.mjs mux -> out/<name>.mp4 at -14 LUFS, true peak at or under -1.5 dBTP; captions.vtt ->
//      out/<name>.en.vtt
//   6. loudness and true peak re-measured on the MP4 (ffmpeg ebur128) and printed
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const name = opt("--name", "rough-cut-v6");
const quality = opt("--quality", "draft");
const local = process.env.LOCALAPPDATA ?? "C:/Users/user/AppData/Local";
const env = {
  ...process.env,
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  npm_config_prefer_offline: "true",
  HYPERFRAMES_NO_UPDATE_CHECK: "1",
  HYPERFRAMES_NO_AUTO_INSTALL: "1",
  DO_NOT_TRACK: "1",
  HYPERFRAMES_BROWSER_PATH:
    process.env.HYPERFRAMES_BROWSER_PATH ??
    `${local}/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe`,
  HYPERFRAMES_FFMPEG_PATH:
    process.env.HYPERFRAMES_FFMPEG_PATH ?? `${local}/Microsoft/WinGet/Links/ffmpeg.exe`.replaceAll("\\", "/"),
  HYPERFRAMES_FFPROBE_PATH:
    process.env.HYPERFRAMES_FFPROBE_PATH ??
    `${local}/Microsoft/WinGet/Links/ffprobe.exe`.replaceAll("\\", "/"),
};
env.FFMPEG = env.HYPERFRAMES_FFMPEG_PATH;
// the music cache lives outside the repo (fetch-music.mjs); the first of these that exists
const MUSIC =
  process.env.FS_MUSIC_CACHE ??
  [resolve(repo, "../media-cache/music"), resolve(repo, "../../media-cache/music")].find((dir) =>
    existsSync(dir),
  ) ??
  resolve(repo, "../media-cache/music");
const take = process.env.FILM_SLOTS_OUT ?? join(repo, "e2e/film-out/slots");

function step(what, command, list, extra = {}) {
  process.stdout.write(`\n[recapture] ${what}\n`);
  // a .cmd shim (corepack, npx) only starts through the shell on Windows
  const shell = process.platform === "win32" && command.endsWith(".cmd");
  const run = spawnSync(command, list, { cwd: repo, env: { ...env, ...extra }, stdio: "inherit", shell });
  if (run.status !== 0) throw new Error(`[recapture] failed: ${what} (exit ${run.status})`);
}
const node = (what, list) => step(what, process.execPath, list);
const corepack = process.platform === "win32" ? "corepack.cmd" : "corepack";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

if (!args.includes("--skip-take"))
  step("1. the slots take (real judge run, recorded)", corepack, ["pnpm", "e2e:film"], {
    FILM_TAKE: "slots",
    FILM_SLOTS_OUT: take,
  });
node("2. cut every slot's clip", ["video/tools/cut-captures.mjs", take]);
node("3a. build the film", ["video/build.mjs"]);
node("3b. check the film", ["video/check.mjs"]);
if (!args.includes("--skip-render")) {
  const picture = `video/out/${name}-picture.mp4`;
  step("4. render the picture", npx, [
    "--yes",
    "hyperframes@0.8.157",
    "render",
    "video",
    "--quality",
    quality,
    ...(quality === "delivery" ? ["--crf", "14"] : []),
    "--fps",
    "30",
    "--workers",
    "1",
    "--output",
    picture,
  ]);
  if (!existsSync(join(repo, "video/out/music-bed.wav"))) {
    node("5a. fetch the music (sha256-pinned cache)", ["video/tools/fetch-music.mjs", MUSIC]);
    node("5b. build the music bed", ["video/tools/build-music-bed.mjs", MUSIC]);
  }
  node("5c. the approved mix (stems)", ["video/tools/mix.mjs"]);
  node("5d. mux the mix and the captions", ["video/tools/mix.mjs", "mux", picture, `video/out/${name}.mp4`]);
  copyFileSync(join(repo, "video/captions.vtt"), join(repo, `video/out/${name}.en.vtt`));
  process.stdout.write("\n[recapture] 6. loudness on the MP4\n");
  const meter = spawnSync(
    env.HYPERFRAMES_FFMPEG_PATH,
    [
      "-hide_banner",
      "-nostats",
      "-i",
      join(repo, `video/out/${name}.mp4`),
      "-af",
      "ebur128=peak=true",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  const summary = meter.stderr.slice(meter.stderr.lastIndexOf("Summary:"));
  process.stdout.write(`${summary}\n[recapture] done: video/out/${name}.mp4 and video/out/${name}.en.vtt\n`);
}
