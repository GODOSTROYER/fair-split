// Writes the Tablea console's noise tile (design §2.5, S2 §2.5): a seeded 128 px, 1-bit monochrome PNG that
// sits at 3% opacity on the ground of the web console only. Removed under data-rec="1", because noise turns
// to compression mush on YouTube.
//
//   corepack pnpm exec tsx assets/textures/build-noise.ts

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { mulberry32 } from "../../packages/motion/src/sound/recipes.js";

const SIZE = 128;
const SEED = 0x2026a;

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

export function noisePng(size = SIZE, seed = SEED): Buffer {
  const rng = mulberry32(seed);
  const rowBytes = size / 8;
  const raw = Buffer.alloc((rowBytes + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (rowBytes + 1)] = 0;
    for (let x = 0; x < rowBytes; x++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) byte = (byte << 1) | (rng() < 0.5 ? 1 : 0);
      raw[y * (rowBytes + 1) + 1 + x] = byte;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 1; // bit depth
  header[9] = 0; // greyscale
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(dirname(fileURLToPath(import.meta.url)), "noise-128.png");
  const png = noisePng();
  writeFileSync(out, png);
  console.log(`noise-128.png  ${png.length.toLocaleString("en")} B`);
}
