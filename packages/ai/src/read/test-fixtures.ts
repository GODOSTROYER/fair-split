// Test-only builders for Extraction JSON and a plain synthetic page. Not exported from the package.
import sharp from "sharp";
import type { PhotoFixture } from "./_shims/contracts.js";
import type { Box, Extraction, FieldRead, Legibility, Row, RowField } from "./schema.js";

export const PAGE = { width: 1000, height: 1400 } as const;

/** Field rectangles of the synthetic single-slip page, in pixels (one row per field, top to bottom). */
export const FIELD_RECTS: Record<RowField, Box> = (() => {
  const order: RowField[] = [
    "serial",
    "line_no",
    "date",
    "member_no",
    "member_name",
    "plot_no",
    "sacks",
    "gross_kg",
    "tare_kg",
    "net_kg",
    "mc_pct",
    "mc_less_kg",
    "payable_kg",
    "grade",
    "clerk_initials",
  ];
  return Object.fromEntries(
    order.map((f, i) => [f, { x1: 500, y1: 100 + i * 70, x2: 900, y2: 150 + i * 70 }]),
  ) as Record<RowField, Box>;
})();
export const DEDUCTION_RECTS: Box[] = [
  { x1: 100, y1: 1180, x2: 900, y2: 1220 },
  { x1: 100, y1: 1230, x2: 900, y2: 1270 },
];
export const SLIP_RECT: Box = { x1: 40, y1: 40, x2: 960, y2: 1360 };

export const CLEAN_VALUES: Record<RowField, string> = {
  serial: "0901",
  line_no: "",
  date: "7/14/26",
  member_no: "M-101",
  member_name: "ROSA LIM",
  plot_no: "P-101-A",
  sacks: "2 PP",
  gross_kg: "64.80",
  tare_kg: "0.30",
  net_kg: "64.50",
  mc_pct: "7.5",
  mc_less_kg: "0.00",
  payable_kg: "64.50",
  grade: "G1",
  clerk_initials: "JD",
};

export function field(
  value: string,
  box: Box,
  legibility: Legibility = value ? "CLEAR" : "ABSENT",
  from = "",
): FieldRead {
  return { box, value_text: value, legibility, overwritten_from: from };
}

export function row(
  over: Partial<Record<RowField, FieldRead>> = {},
  extra: { deductions?: FieldRead[]; slip_box?: Box; copy?: Row["copy"] } = {},
): Row {
  const fields = Object.fromEntries(
    (Object.keys(CLEAN_VALUES) as RowField[]).map((f) => [
      f,
      over[f] ?? field(CLEAN_VALUES[f], f === "line_no" ? { x1: 0, y1: 0, x2: 0, y2: 0 } : FIELD_RECTS[f]),
    ]),
  ) as Record<RowField, FieldRead>;
  return {
    slip_box: extra.slip_box ?? SLIP_RECT,
    copy: extra.copy ?? "WHITE_ORIGINAL",
    ...fields,
    deductions: extra.deductions ?? [],
    signature: "SIGNED",
  };
}

export function extraction(
  rows: Row[],
  anomalies: Extraction["anomalies"] = [],
  rotation: "0" | "90" | "180" | "270" = "0",
): Extraction {
  return { page: { rotation, issues: [] }, rows, anomalies };
}

/** The JSON text exactly as the model would stream it (schema key order). */
export const json = (e: unknown): string => JSON.stringify(e);

export function pageFixture(): PhotoFixture {
  const n = (b: Box) => ({
    x1: b.x1 / PAGE.width,
    y1: b.y1 / PAGE.height,
    x2: b.x2 / PAGE.width,
    y2: b.y2 / PAGE.height,
  });
  return {
    photo: "TEST",
    slips: [
      {
        serial: "0901",
        copy: "WHITE_ORIGINAL",
        rect: n(SLIP_RECT),
        fields: Object.fromEntries(
          (Object.keys(FIELD_RECTS) as RowField[])
            .filter((f) => f !== "line_no")
            .map((f) => [f, n(FIELD_RECTS[f])]),
        ),
        deductions: DEDUCTION_RECTS.map(n),
      },
    ],
  };
}

/** A page covered in 4 px black and white stripes: any pixel a sanitiser misses shows through. */
export async function stripedPage(width: number = PAGE.width, height: number = PAGE.height): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs><pattern id="s" width="8" height="8" patternUnits="userSpaceOnUse">
<rect width="4" height="8" fill="#000"/><rect x="4" width="4" height="8" fill="#fff"/></pattern></defs>
<rect width="${width}" height="${height}" fill="url(#s)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Min and max channel value over a region of an image, the region given in pixels of that image and
 * shrunk by `inset` on every side (JPEG and Lanczos ringing stay out of the sample).
 */
export async function regionStats(image: Buffer, b: Box, inset = 4): Promise<{ min: number; max: number }> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  let min = 255;
  let max = 0;
  const x1 = Math.max(0, Math.ceil(b.x1) + inset);
  const y1 = Math.max(0, Math.ceil(b.y1) + inset);
  const x2 = Math.min(info.width, Math.floor(b.x2) - inset);
  const y2 = Math.min(info.height, Math.floor(b.y2) - inset);
  if (x2 <= x1 || y2 <= y1) throw new RangeError(`empty sample region ${JSON.stringify(b)}`);
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      for (let c = 0; c < Math.min(3, info.channels); c++) {
        const v = data[(y * info.width + x) * info.channels + c] as number;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
  }
  return { min, max };
}

/** A plain, deterministic page image (contents do not matter to a mocked model). */
export async function plainPage(seed = 0): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.width}" height="${PAGE.height}">
<rect width="100%" height="100%" fill="#fbf8f0"/>
<rect x="${SLIP_RECT.x1}" y="${SLIP_RECT.y1}" width="${SLIP_RECT.x2 - SLIP_RECT.x1}" height="${SLIP_RECT.y2 - SLIP_RECT.y1}" fill="none" stroke="#333" stroke-width="3"/>
${Object.values(FIELD_RECTS)
  .map(
    (b, i) =>
      `<rect x="${b.x1}" y="${b.y1}" width="${b.x2 - b.x1}" height="${b.y2 - b.y1}" fill="${i % 2 ? "#eee" : "#ddd"}"/>`,
  )
  .join("\n")}
<circle cx="${100 + seed * 37}" cy="${200 + seed * 11}" r="30" fill="#1d3fa6"/>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
