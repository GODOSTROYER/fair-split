// Downloads the film's two music tracks (Scott Buckley, CC BY 4.0) into a cache OUTSIDE the repo and checks their
// sha256. Third-party music is never committed: video/LICENSES.md and video/CREDITS.txt carry the credit lines.
//
//   node video/tools/fetch-music.mjs <cache-dir>      e.g. Z:/Projects/Paypal/media-cache/music
//
// Sources (read 5 Nov 2026): each track's page offers its MP3 as a direct, free download (no account, form or
// payment); the WAVs are Patreon-only, so the MP3 is the best free file. Licence: CC BY 4.0, credit in the video
// description (YouTube), cutting and fading only.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TRACKS = [
  {
    id: "machina",
    title: "Machina",
    page: "https://www.scottbuckley.com.au/library/machina",
    url: "https://www.scottbuckley.com.au/library/wp-content/uploads/2019/12/sb_machina.mp3",
    file: "sb_machina.mp3",
    sha256: "72f479c583fd1cb894584c51d4fb9b33200b098bd1b13195bd41d29586d9d344",
    credit: "'Machina' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
  },
  {
    id: "aurora",
    title: "Aurora",
    page: "https://www.scottbuckley.com.au/library/aurora",
    url: "https://www.scottbuckley.com.au/library/wp-content/uploads/2021/10/Aurora.mp3",
    file: "Aurora.mp3",
    sha256: "311ae35bf827be51372da47693357f79b8022b704d833cd26d547bbf67c117ed",
    credit: "'Aurora' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
  },
];
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: fetch-music.mjs <cache-dir> (outside the repo)");
  const to = resolve(dir);
  if (existsSync(join(to, ".git")) || /[\\/]video([\\/]|$)/.test(to))
    throw new Error("the music cache must sit outside the repo");
  mkdirSync(to, { recursive: true });
  for (const track of TRACKS) {
    const path = join(to, track.file);
    if (existsSync(path) && sha(readFileSync(path)) === track.sha256) {
      console.log(`${track.file}: cached, sha256 ok`);
      continue;
    }
    const response = await fetch(track.url, { redirect: "follow" });
    if (!response.ok) throw new Error(`${track.url}: HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    const got = sha(body);
    if (track.sha256 !== "PENDING" && got !== track.sha256)
      throw new Error(`${track.file}: sha256 ${got}, expected ${track.sha256}`);
    writeFileSync(path, body);
    console.log(
      `${track.file}: ${body.length} bytes, sha256 ${got}${track.sha256 === "PENDING" ? " (pin it)" : " ok"}`,
    );
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
