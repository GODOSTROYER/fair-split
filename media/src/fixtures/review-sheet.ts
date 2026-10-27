import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import type { NRect } from "./schema.js";

/**
 * Review aids for the person checking fixtures (and for the agent's own check): an overlay of every
 * rectangle on the image, and a crop sheet that puts each field's crop beside the value it should show.
 */

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface LabelledRect {
  rect: NRect;
  label: string;
}

export async function renderOverlay(
  master: string,
  rects: readonly LabelledRect[],
  out: string,
): Promise<void> {
  const meta = await sharp(master).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const parts = rects.map((r, i) => {
    const x = r.rect.x1 * W;
    const y = r.rect.y1 * H;
    const w = (r.rect.x2 - r.rect.x1) * W;
    const h = (r.rect.y2 - r.rect.y1) * H;
    const colour = ["#e4572e", "#17bebb", "#ffc914", "#76b041", "#7d5ba6"][i % 5];
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="none" stroke="${colour}" stroke-width="2"/><text x="${(x + 2).toFixed(1)}" y="${(y + 10).toFixed(1)}" font-family="Arial" font-size="10" fill="${colour}">${escapeXml(r.label)}</text>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join("")}</svg>`;
  await mkdir(dirname(out), { recursive: true });
  await sharp(master)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toFile(out);
}

export interface SheetItem {
  rect: NRect;
  title: string;
  expected: string;
}

/** One row per field: the crop (scaled to a fixed height) and, to its right, "title: expected". */
export async function renderCropSheet(
  master: string,
  items: readonly SheetItem[],
  out: string,
  rowH = 64,
): Promise<void> {
  const meta = await sharp(master).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const cropW = 520;
  const textW = 420;
  const crops = await Promise.all(
    items.map(async (it) => {
      const left = Math.max(0, Math.floor(it.rect.x1 * W));
      const top = Math.max(0, Math.floor(it.rect.y1 * H));
      const width = Math.max(1, Math.min(W - left, Math.ceil((it.rect.x2 - it.rect.x1) * W)));
      const height = Math.max(1, Math.min(H - top, Math.ceil((it.rect.y2 - it.rect.y1) * H)));
      return sharp(master)
        .extract({ left, top, width, height })
        .resize({ height: rowH - 8, width: cropW, fit: "contain", background: "#ffffff" })
        .png()
        .toBuffer();
    }),
  );
  const sheetH = items.length * rowH + 8;
  const text = items
    .map(
      (it, i) =>
        `<text x="${cropW + 16}" y="${i * rowH + rowH / 2 + 4}" font-family="Arial" font-size="16" fill="#222">${escapeXml(`${it.title}: ${it.expected === "" ? "(blank)" : it.expected}`)}</text>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cropW + textW}" height="${sheetH}">${text}</svg>`;
  await mkdir(dirname(out), { recursive: true });
  await sharp({ create: { width: cropW + textW, height: sheetH, channels: 3, background: "#f4f4f4" } })
    .composite([
      ...crops.map((c, i) => ({ input: c, top: i * rowH + 4, left: 8 })),
      { input: Buffer.from(svg), top: 0, left: 0 },
    ])
    .png()
    .toFile(out);
}
