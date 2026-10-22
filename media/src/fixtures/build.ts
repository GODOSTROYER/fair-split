import { join } from "node:path";
import { SCHEDULE_A } from "../content/br-2026-04.js";
import type {
  LogbookPageAsset,
  PhotoPosition,
  RateCardPageAsset,
  SlipPageAsset,
  SlipPhotoAsset,
  SlipSpec,
} from "../content/types.js";
import type { AssetEntry } from "../imagegen/manifest.js";
import { expectedVisible } from "../prompts/render.js";
import { SLIP_BOXES, SLIP_FIELDS, type SlipField } from "../template/slip-template.js";
import {
  detectTextBlocks,
  findPaperQuads,
  orderTwoByTwo,
  pointsToImage,
  type RectifiedSlip,
  rectify,
} from "./detect.js";
import { type Box, normaliseBox, type Pt, type Quad, roundBox } from "./geometry.js";
import { cellCorners, detectLedgerGrid, detectSlipGrid, type Line, type SlipGrid } from "./grid.js";
import { loadRgb } from "./raster.js";
import type {
  FieldFixture,
  FixtureReview,
  LogbookPageFixture,
  RateCardPageFixture,
  SlipFixture,
  SlipImageFixture,
} from "./schema.js";

export const DETECTOR =
  "grid-detect v1: paper quads, rectified; every ruled line fitted on its own from two strips or bands";

export function draftReview(method = DETECTOR): FixtureReview {
  return { status: "draft", method, reviewer: null, reviewedAt: null, notes: [] };
}

function imageRef(entry: AssetEntry) {
  if (!entry.master || !entry.display) throw new Error(`${entry.id} has no accepted master`);
  return {
    master: entry.master.file,
    display: entry.display.file,
    width: entry.master.width,
    height: entry.master.height,
    sha256: entry.master.sha256,
  };
}

/** Corner points of every field's cell in one detected slip grid (rectified pixels, inset from the rules). */
export function gridFieldCorners(grid: SlipGrid): Partial<Record<SlipField, readonly Pt[]>> {
  const [, , lv, right] = grid.cols;
  const out: Partial<Record<SlipField, readonly Pt[]>> = {};
  for (const b of SLIP_BOXES) {
    const top = grid.rows[b.no - 1] as Line;
    const bottom = grid.rows[b.no] as Line;
    if (b.lines === 1) {
      const f = b.fields[0];
      if (f) out[f] = cellCorners({ top, bottom, left: lv, right });
    } else {
      const mid: Line =
        grid.kaltas.length === 1
          ? (grid.kaltas[0] as Line)
          : { a: [top.a[0], (top.a[1] + bottom.a[1]) / 2], b: [top.b[0], (top.b[1] + bottom.b[1]) / 2] };
      const [f1, f2] = b.fields;
      if (f1) out[f1] = cellCorners({ top, bottom: mid, left: lv, right });
      if (f2) out[f2] = cellCorners({ top: mid, bottom, left: lv, right });
    }
  }
  if (grid.signature) out.signature = cellCorners(grid.signature);
  if (grid.clerk) out.clerk_initials = cellCorners(grid.clerk);
  if (grid.serial) {
    const s = grid.serial;
    out.serial = [
      [s.x1, s.y1],
      [s.x2, s.y1],
      [s.x2, s.y2],
      [s.x1, s.y2],
    ];
  }
  return out;
}

/**
 * Geometry sanity checks on one slip's field rectangles (normalised image coordinates). A detector
 * mistake (a run of rules matched one row off, strips paired across different rows) shows up as rows out
 * of order or rows of very different heights, so the draft is refused instead of written.
 */
export function checkSlipLayout(rects: Record<SlipField, Box>): string[] {
  const problems: string[] = [];
  const rows: SlipField[] = SLIP_BOXES.filter((b) => b.lines === 1).flatMap((b) => [...b.fields]);
  const h = (b: Box) => b.y2 - b.y1;
  const w = (b: Box) => b.x2 - b.x1;
  const cy = (b: Box) => (b.y1 + b.y2) / 2;
  const heights = rows.map((f) => h(rects[f]));
  const widths = rows.map((f) => w(rects[f]));
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] as number;
  const mh = med(heights);
  const mw = med(widths);
  rows.forEach((f, i) => {
    if (Math.abs(h(rects[f]) - mh) > mh * 0.35)
      problems.push(`${f}: height ${h(rects[f]).toFixed(4)} vs median ${mh.toFixed(4)}`);
    if (Math.abs(w(rects[f]) - mw) > mw * 0.15)
      problems.push(`${f}: width ${w(rects[f]).toFixed(4)} vs median ${mw.toFixed(4)}`);
    const prev = rows[i - 1];
    if (prev && cy(rects[f]) <= cy(rects[prev])) problems.push(`${f} is not below ${prev}`);
    if (prev && rects[f].y1 < rects[prev].y2 - mh * 0.3) problems.push(`${f} overlaps ${prev}`);
  });
  const last = rects.grade;
  if (cy(rects.deduction_1) <= cy(last) || cy(rects.deduction_2) <= cy(rects.deduction_1))
    problems.push("deduction lines out of order");
  if (cy(rects.signature) <= cy(rects.deduction_2) || cy(rects.clerk_initials) <= cy(rects.deduction_2)) {
    problems.push("signature or clerk box is not below the table");
  }
  if (cy(rects.serial) >= cy(rects.date)) problems.push("serial is not above the table");
  return problems;
}

function fieldFixture(slip: SlipSpec, field: SlipField, rect: Box): FieldFixture {
  const visible = expectedVisible(slip)[field];
  const value =
    field === "serial" ? slip.serial : field === "signature" ? slip.signature.mark : slip.values[field];
  const stained = visible.includes("?") && visible !== value;
  return {
    rect,
    value,
    visible,
    legibility: stained ? "SMUDGED" : value === "" ? "ABSENT" : "CLEAR",
    expect: stained ? "HUMAN" : "AUTO",
  };
}

function slipTraps(slip: SlipSpec): string[] {
  const traps: string[] = [];
  for (const a of slip.artifacts) traps.push(a.kind);
  if (slip.values.deduction_1 || slip.values.deduction_2) traps.push("DEDUCTION_MARKS");
  if (slip.copy !== "WHITE_ORIGINAL") traps.push("CARBON_COPY");
  return traps;
}

function buildSlip(
  rgbW: number,
  rgbH: number,
  slip: SlipSpec,
  position: PhotoPosition | "FULL",
  quad: Quad,
  rect: RectifiedSlip,
  grid: SlipGrid,
  duplicateOf: string | null,
): SlipFixture {
  const corners = gridFieldCorners(grid);
  const fields: Partial<Record<SlipField, FieldFixture>> = {};
  for (const f of SLIP_FIELDS) {
    const c = corners[f];
    if (!c) throw new Error(`slip ${slip.serial}: no rectangle detected for ${f}`);
    fields[f] = fieldFixture(slip, f, roundBox(normaliseBox(pointsToImage(rect, c), rgbW, rgbH)));
  }
  const complete = fields as Record<SlipField, FieldFixture>;
  const problems = checkSlipLayout(
    Object.fromEntries(SLIP_FIELDS.map((f) => [f, complete[f].rect])) as Record<SlipField, Box>,
  );
  if (problems.length)
    throw new Error(
      `slip ${slip.serial} (${position}): layout check failed: ${problems.slice(0, 4).join("; ")}`,
    );
  return {
    position,
    serial: slip.serial,
    copy: slip.copy,
    quad: quad.map(([x, y]) => [round4(x / rgbW), round4(y / rgbH)]) as unknown as SlipFixture["quad"],
    fields: fields as Record<SlipField, FieldFixture>,
    traps: slipTraps(slip),
    duplicateOf,
  };
}

function round4(n: number): number {
  return Math.round(Math.min(1, Math.max(0, n)) * 10_000) / 10_000;
}

export interface BuildOptions {
  mediaRoot: string;
  /** For carbon copies: the id of the other copy of the same slip, e.g. "spike-0457-white". */
  duplicateOf?: (serial: string, assetId: string) => string | null;
}

/** Draft fixture for a one-slip page or a four-slip photo. */
export async function buildSlipFixture(
  asset: SlipPageAsset | SlipPhotoAsset,
  entry: AssetEntry,
  opts: BuildOptions,
): Promise<SlipImageFixture> {
  const image = imageRef(entry);
  const rgb = await loadRgb(join(opts.mediaRoot, image.master));
  const dup = opts.duplicateOf ?? (() => null);
  const slips: SlipFixture[] = [];
  if (asset.kind === "slip_page") {
    const [q] = findPaperQuads(rgb, 1);
    if (!q) throw new Error(`${asset.id}: no slip found`);
    const r = rectify(rgb, q.quad);
    slips.push(
      buildSlip(
        rgb.width,
        rgb.height,
        asset.slip,
        "FULL",
        q.quad,
        r,
        detectSlipGrid(r),
        dup(asset.slip.serial, asset.id),
      ),
    );
  } else {
    const quads = orderTwoByTwo(findPaperQuads(rgb, 4));
    for (const pos of ["TL", "TR", "BL", "BR"] as const) {
      const q = quads[pos];
      const r = rectify(rgb, q.quad);
      const spec = asset.slips[pos];
      slips.push(
        buildSlip(rgb.width, rgb.height, spec, pos, q.quad, r, detectSlipGrid(r), dup(spec.serial, asset.id)),
      );
    }
  }
  return {
    v: 1,
    id: asset.id,
    kind: asset.kind,
    template: "slip-v1",
    synthetic: true,
    image,
    slips,
    review: draftReview(),
  };
}

/** Draft fixture for a BR 2026-04 page: one rectangle per clause (page 2) or per resolution block (page 1). */
export async function buildRateCardFixture(
  asset: RateCardPageAsset,
  entry: AssetEntry,
  opts: BuildOptions,
): Promise<RateCardPageFixture> {
  const image = imageRef(entry);
  const rgb = await loadRgb(join(opts.mediaRoot, image.master));
  const blocks = detectTextBlocks(rgb);
  const W = rgb.width;
  // Body paragraphs have every line starting at the left margin; centred titles and headings have at
  // least one line that starts further in.
  const leftEdge = Math.min(...blocks.map((b) => b.box.x1));
  const leftAligned = blocks.filter(
    (b) => b.lines.length >= 2 && b.lines.every((l) => l.x1 <= leftEdge + W * 0.02),
  );
  const named: { id: string; text: string }[] =
    asset.page === 2
      ? SCHEDULE_A.map((c) => ({ id: c.ruleId, text: `${c.heading}\n${c.quote}` }))
      : [
          { id: "GA_CITATION", text: "WHEREAS, the General Assembly, at its meeting of …" },
          { id: "MANDATE", text: "WHEREAS, the General Assembly directed the Board of Directors …" },
          { id: "RESOLVED", text: "NOW, THEREFORE, … to adopt Schedule A …" },
        ];
  if (leftAligned.length < named.length) {
    throw new Error(
      `${asset.id}: found ${leftAligned.length} left-aligned blocks, expected at least ${named.length}`,
    );
  }
  const out = named.map((n, i) => ({
    id: n.id,
    text: n.text,
    rect: roundBox(normaliseBox(pad(leftAligned[i]?.box as Box, 6), rgb.width, rgb.height)),
  }));
  return {
    v: 1,
    id: asset.id,
    kind: "rate_card_page",
    synthetic: true,
    image,
    page: asset.page,
    textLayer: asset.textLayerFile,
    blocks: out,
    review: draftReview("text-block detect v1 (dark-pixel line profile, blocks split on blank lines)"),
  };
}

function pad(b: Box, p: number): Box {
  return { x1: b.x1 - p, y1: b.y1 - p, x2: b.x2 + p, y2: b.y2 + p };
}

const LOGBOOK_COLUMNS = [
  "line",
  "date",
  "serial",
  "member_no",
  "member_name",
  "net_kg",
  "grade",
  "remarks",
] as const;

/** Draft fixture for a logbook page: one rectangle per line and per cell. */
export async function buildLogbookFixture(
  asset: LogbookPageAsset,
  entry: AssetEntry,
  opts: BuildOptions,
): Promise<LogbookPageFixture> {
  const image = imageRef(entry);
  const rgb = await loadRgb(join(opts.mediaRoot, image.master));
  // The logbook is shot from straight above, and the facing page joins the page's paper across a light
  // gutter, so the paper quad is unreliable: work on the whole frame and let the per-line fit absorb
  // the small tilt. Fall back to the paper quad if the frame does not show a clean grid.
  const frame: Quad = [
    [0, 0],
    [rgb.width, 0],
    [rgb.width, rgb.height],
    [0, rgb.height],
  ];
  let page = rectify(rgb, frame);
  let grid: ReturnType<typeof detectLedgerGrid>;
  try {
    grid = detectLedgerGrid(page, asset.slots, LOGBOOK_COLUMNS.length);
  } catch {
    const [q] = findPaperQuads(rgb, 1, { minAreaFrac: 0.2 });
    if (!q) throw new Error(`${asset.id}: no page found`);
    page = rectify(rgb, q.quad);
    grid = detectLedgerGrid(page, asset.slots, LOGBOOK_COLUMNS.length);
  }
  const toImg = (pts: readonly Pt[]) =>
    roundBox(normaliseBox(pointsToImage(page, pts), rgb.width, rgb.height));
  const lines = asset.lines.map((l) => {
    const top = grid.rows[l.line - 1] as Line;
    const bottom = grid.rows[l.line] as Line;
    const cells: Record<string, { rect: Box; value: string; visible: string }> = {};
    LOGBOOK_COLUMNS.forEach((c, i) => {
      const value = c === "line" ? String(l.line) : l[c];
      const corners = cellCorners({
        top,
        bottom,
        left: grid.cols[i] as Line,
        right: grid.cols[i + 1] as Line,
      });
      cells[c] = { rect: toImg(corners), value, visible: value };
    });
    const whole = cellCorners(
      { top, bottom, left: grid.cols[0] as Line, right: grid.cols[grid.cols.length - 1] as Line },
      0,
    );
    return { line: l.line, serial: l.serial, rect: toImg(whole), cells };
  });
  return {
    v: 1,
    id: asset.id,
    kind: "logbook_page",
    synthetic: true,
    image,
    page: asset.page,
    columns: [...LOGBOOK_COLUMNS],
    lines,
    review: draftReview("ledger grid-detect v1 (page quad, rectified, snapped to ruled lines)"),
  };
}
