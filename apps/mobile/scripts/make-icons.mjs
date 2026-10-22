// Draws the app icon set (design §2.6): the bodega's hanging-scale dial on tablea, with a pod-orange needle resting
// on the centre mark. Pure Node (zlib + a hand-written PNG encoder), so the PNGs are reproducible from this file.
// TEMPORARY: WS-DS owns the final icon artwork (assets/**); swap when it lands.
// Usage: node scripts/make-icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const TABLEA = [0x20, 0x17, 0x12, 255];
const CHALK = [0xf4, 0xed, 0xe4, 255];
const POD = [0xff, 0x8a, 0x2a, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Square-capped stroke: inside when the point projects onto the segment and sits within half the width. */
const segRect = (px, py, ax, ay, bx, by, w) => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0 || t > 1) return false;
  return Math.abs((px - ax) * dy - (py - ay) * dx) / Math.sqrt(len2) < w;
};

/** The dial in unit space; returns the paint for a point, later shapes on top. */
function dial(x, y, mono) {
  const cx = 0.5;
  const cy = 0.52;
  const ink = mono ? WHITE : CHALK;
  const needle = mono ? WHITE : POD;
  let paint = null;
  const r = Math.hypot(x - cx, y - cy);
  // ring
  if (Math.abs(r - 0.3) < 0.016) paint = ink;
  // hanger: a ring and a stem above the dial
  if (Math.abs(Math.hypot(x - cx, y - 0.125) - 0.04) < 0.012) paint = ink;
  if (segRect(x, y, cx, 0.165, cx, 0.225, 0.012)) paint = ink;
  // the hook below, where the sack hangs
  if (segRect(x, y, cx, 0.815, cx, 0.875, 0.012)) paint = ink;
  const hr = Math.hypot(x - (cx - 0.032), y - 0.875);
  if (y >= 0.875 && Math.abs(hr - 0.032) < 0.012) paint = ink;
  // ticks over a 240° sweep, every 15°, longer every 60°
  for (let deg = -120; deg <= 120; deg += 15) {
    const a = (deg * Math.PI) / 180;
    const major = deg % 60 === 0;
    const r0 = major ? 0.19 : 0.215;
    const r1 = 0.255;
    const sx = Math.sin(a);
    const sy = -Math.cos(a);
    if (segRect(x, y, cx + sx * r0, cy + sy * r0, cx + sx * r1, cy + sy * r1, major ? 0.011 : 0.007))
      paint = ink;
  }
  // needle resting on the centre mark (12 o'clock)
  if (segRect(x, y, cx, cy + 0.04, cx, cy - 0.235, 0.014)) paint = needle;
  // hub
  if (r < 0.034) paint = ink;
  if (!mono && r < 0.014) paint = TABLEA;
  return paint;
}

function render(size, { bg, scale = 1, mono = false }) {
  const out = Buffer.alloc(size * size * 4);
  const S = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const ux = (px + (sx + 0.5) / S) / size;
          const uy = (py + (sy + 0.5) / S) / size;
          const x = 0.5 + (ux - 0.5) / scale;
          const y = 0.5 + (uy - 0.5) / scale;
          const c = dial(x, y, mono) ?? bg;
          const alpha = c[3] / 255;
          r += c[0] * alpha;
          g += c[1] * alpha;
          b += c[2] * alpha;
          a += alpha;
        }
      }
      const i = (py * size + px) * 4;
      const n = S * S;
      out[i] = a ? Math.round(r / a) : 0;
      out[i + 1] = a ? Math.round(g / a) : 0;
      out[i + 2] = a ? Math.round(b / a) : 0;
      out[i + 3] = Math.round((a / n) * 255);
    }
  }
  return png(size, out);
}

const dir = new URL("../assets/images/", import.meta.url);
const write = (name, buf) => {
  writeFileSync(new URL(name, dir), buf);
  console.log(`${name} ${buf.length} B`);
};
write("icon.png", render(1024, { bg: TABLEA }));
write("android-icon-background.png", render(512, { bg: TABLEA, scale: 0.0001 }));
write("android-icon-foreground.png", render(1024, { bg: CLEAR, scale: 0.62 }));
write("android-icon-monochrome.png", render(1024, { bg: CLEAR, scale: 0.62, mono: true }));
write("splash-icon.png", render(512, { bg: TABLEA }));
write("favicon.png", render(48, { bg: TABLEA }));
