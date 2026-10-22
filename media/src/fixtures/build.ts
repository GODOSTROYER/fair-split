import { join } from "node:path";
import { SCHEDULE_A } from "../content/br-2026-04.js";
import type {
  AssetSpec,
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
  findInk,
  findPaperQuads,
  isGreenInk,
  orderTwoByTwo,
  pointsToImage,
  type RectifiedSlip,
  rectify,
  rectToImage,
} from "./detect.js";
import { type Box, normaliseBox, type Pt, type Quad, roundBox } from "./geometry.js";
import { cellCorners, detectLedgerGrid, detectSlipGrid, type Line, type SlipGrid } from "./grid.js";
import { loadRgb } from "./raster.js";
import {
  type AnomalyFixture,
  type ArtifactTrap,
  BEHAVIOURAL_TRAPS,
  type Expect,
  FIXTURE_VERSION,
  type FieldFixture,
  type Fixture,
  type FixtureReview,
  Fixture as FixtureSchema,
  LOGBOOK_COLUMNS,
  type LogbookPageFixture,
  type RateCardPageFixture,
  SLIP_ROW_FIELDS,
  type SlipFixture,
  type SlipImageFixture,
  type SlipRowField,
  type Slot,
  slipFieldEntries,
  type TrapCheck,
} from "./schema.js";

export const DETECTOR =
  "grid-detect v1: paper quads, rectified; every ruled line fitted on its own from two strips or bands";

export function draftReview(method = DETECTOR, notes: string[] = []): FixtureReview {
  return { status: "draft", method, reviewer: null, reviewedAt: null, notes, cropIssues: [] };
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

/** What a reader should do, as the content spec intends it: a washed-out character goes to a person. */
export function intendedExpect(requested: string): Expect {
  return requested.includes("?") ? "HUMAN" : "AUTO";
}

/**
 * A drafted field: the rectangle plus what was asked for. Nothing has looked at the image yet, so the field
 * is UNVERIFIED and `visible` repeats `requested` until a recorded check replaces it (C-24).
 */
export function draftField(rect: Box, value: string, requested: string): FieldFixture {
  return {
    ...rect,
    value,
    requested,
    visible: requested,
    legibility: "UNVERIFIED",
    expect: intendedExpect(requested),
    checkedBy: null,
  };
}

/** The template field holding a fixture path's value ("fields.gross_kg" → gross_kg, "deductions.1" → deduction_2). */
export function templateFieldOf(path: string): SlipField | null {
  const m = /^(?:fields\.(\w+)|deductions\.([01])|(signature))$/.exec(path);
  if (!m) return null;
  if (m[1]) return (SLIP_FIELDS as readonly string[]).includes(m[1]) ? (m[1] as SlipField) : null;
  if (m[2] !== undefined) return m[2] === "0" ? "deduction_1" : "deduction_2";
  return "signature";
}

export function slipTraps(slip: SlipSpec): ArtifactTrap[] {
  const traps: ArtifactTrap[] = [];
  for (const a of slip.artifacts) if (!traps.includes(a.kind)) traps.push(a.kind);
  if (slip.values.deduction_1 || slip.values.deduction_2) traps.push("DEDUCTION_MARKS");
  if (slip.copy !== "WHITE_ORIGINAL") traps.push("CARBON_COPY");
  return traps;
}

function trapChecksFor(traps: readonly ArtifactTrap[]): TrapCheck[] {
  return BEHAVIOURAL_TRAPS.filter((t) => traps.includes(t)).map((trap) => ({
    trap,
    status: "UNVERIFIED",
    by: null,
    at: null,
    evidence: "",
  }));
}

/** Decides `duplicateOf` for a slip: the white original of the same serial in the same set, if any. */
export type DuplicateResolver = (assetId: string, slip: SlipSpec) => string | null;

/**
 * S4.10 `duplicate_of`: only the non-original copy points at its original, keyed by serial and copy colour
 * within one replay or eval set. Two renders of one slip in different sets (an S3 flat and the spike's
 * four-slip photo) are separate images of the same paper, never a duplicate pair.
 */
export function duplicateResolver(assets: readonly AssetSpec[]): DuplicateResolver {
  const originals = new Map<string, string>();
  for (const a of assets) {
    const slips: [Slot, SlipSpec][] =
      a.kind === "slip_page"
        ? [["ONLY", a.slip]]
        : a.kind === "slip_photo"
          ? (Object.entries(a.slips) as [PhotoPosition, SlipSpec][])
          : [];
    for (const [slot, s] of slips) {
      if (s.copy !== "WHITE_ORIGINAL") continue;
      const key = `${a.group}/${s.serial}`;
      if (originals.has(key))
        throw new Error(`group ${a.group} holds two white originals of slip ${s.serial}`);
      originals.set(key, `${a.id}#${slot}`);
    }
  }
  return (assetId, slip) => {
    if (slip.copy === "WHITE_ORIGINAL") return null;
    const asset = assets.find((x) => x.id === assetId);
    if (!asset) throw new Error(`unknown asset ${assetId}`);
    return originals.get(`${asset.group}/${slip.serial}`) ?? null;
  };
}

/** Finds a margin note's ink on the rectified slip (0449's note is in green felt-tip, S4.7), padded. */
export function marginNoteRect(rect: RectifiedSlip): Box | null {
  const note = findInk(
    rect.rgb,
    { x1: 0, y1: 0, x2: rect.rgb.width, y2: rect.rgb.height },
    isGreenInk,
    () => true,
    60,
  );
  if (!note) return null;
  const pad = 8;
  return {
    x1: Math.max(0, note.x1 - pad),
    y1: Math.max(0, note.y1 - pad),
    x2: Math.min(rect.rgb.width, note.x2 + pad),
    y2: Math.min(rect.rgb.height, note.y2 + pad),
  };
}

function buildSlip(
  rgbW: number,
  rgbH: number,
  slip: SlipSpec,
  slot: Slot,
  quad: Quad,
  rect: RectifiedSlip,
  grid: SlipGrid,
  duplicateOf: string | null,
): SlipFixture {
  const corners = gridFieldCorners(grid);
  const rects = {} as Record<SlipField, Box>;
  for (const f of SLIP_FIELDS) {
    const c = corners[f];
    if (!c) throw new Error(`slip ${slip.serial}: no rectangle detected for ${f}`);
    rects[f] = roundBox(normaliseBox(pointsToImage(rect, c), rgbW, rgbH));
  }
  const problems = checkSlipLayout(rects);
  if (problems.length)
    throw new Error(`slip ${slip.serial} (${slot}): layout check failed: ${problems.slice(0, 4).join("; ")}`);

  const requested = expectedVisible(slip);
  const truthOf = (f: SlipField): string =>
    f === "serial" ? slip.serial : f === "signature" ? slip.signature.mark : slip.values[f];
  const field = (f: SlipField) => draftField(rects[f], truthOf(f), requested[f]);

  const anomalies: AnomalyFixture[] = [];
  for (const a of slip.artifacts) {
    if (a.kind !== "MARGIN_NOTE") continue;
    const r = marginNoteRect(rect);
    if (!r) throw new Error(`slip ${slip.serial} (${slot}): no margin-note ink found (expected ${a.pen})`);
    const box = roundBox(normaliseBox(rectToImage(rect, r), rgbW, rgbH));
    anomalies.push({ kind: "INSTRUCTION_LIKE_TEXT", ...draftField(box, a.text, a.text), expect: "HUMAN" });
  }

  const traps = slipTraps(slip);
  const xs = quad.map((p) => p[0]);
  const ys = quad.map((p) => p[1]);
  return {
    slot,
    serial: slip.serial,
    copy: slip.copy,
    quad: quad.map(([x, y]) => [round4(x / rgbW), round4(y / rgbH)]) as unknown as SlipFixture["quad"],
    rect: roundBox(
      normaliseBox(
        { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) },
        rgbW,
        rgbH,
      ),
    ),
    fields: Object.fromEntries(SLIP_ROW_FIELDS.map((f) => [f, field(f)])) as Record<
      SlipRowField,
      FieldFixture
    >,
    deductions: [field("deduction_1"), field("deduction_2")],
    signature: field("signature"),
    anomalies,
    traps,
    trapChecks: trapChecksFor(traps),
    duplicateOf,
  };
}

function round4(n: number): number {
  return Math.round(Math.min(1, Math.max(0, n)) * 10_000) / 10_000;
}

export interface BuildOptions {
  mediaRoot: string;
  /** `duplicateOf` for each slip (see {@link duplicateResolver}); by default no slip is a duplicate. */
  duplicateOf?: DuplicateResolver;
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
        "ONLY",
        q.quad,
        r,
        detectSlipGrid(r),
        dup(asset.id, asset.slip),
      ),
    );
  } else {
    const quads = orderTwoByTwo(findPaperQuads(rgb, 4));
    for (const pos of ["TL", "TR", "BL", "BR"] as const) {
      const q = quads[pos];
      const r = rectify(rgb, q.quad);
      const spec = asset.slips[pos];
      slips.push(
        buildSlip(rgb.width, rgb.height, spec, pos, q.quad, r, detectSlipGrid(r), dup(asset.id, spec)),
      );
    }
  }
  return {
    v: FIXTURE_VERSION,
    id: asset.id,
    group: asset.group,
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
    v: FIXTURE_VERSION,
    id: asset.id,
    group: asset.group,
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

/** Draft fixture for a logbook page: one rectangle per line and per cell, every cell UNVERIFIED. */
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
    const cells = {} as Record<(typeof LOGBOOK_COLUMNS)[number], FieldFixture>;
    LOGBOOK_COLUMNS.forEach((c, i) => {
      const value = c === "line" ? String(l.line) : l[c];
      const corners = cellCorners({
        top,
        bottom,
        left: grid.cols[i] as Line,
        right: grid.cols[i + 1] as Line,
      });
      cells[c] = draftField(toImg(corners), value, value);
    });
    const whole = cellCorners(
      { top, bottom, left: grid.cols[0] as Line, right: grid.cols[grid.cols.length - 1] as Line },
      0,
    );
    return { line: l.line, serial: l.serial, rect: toImg(whole), cells };
  });
  return {
    v: FIXTURE_VERSION,
    id: asset.id,
    group: asset.group,
    kind: "logbook_page",
    synthetic: true,
    image,
    page: asset.page,
    columns: [...LOGBOOK_COLUMNS],
    lines,
    review: draftReview("ledger grid-detect v1 (page quad, rectified, snapped to ruled lines)"),
  };
}

type Observed = Pick<FieldFixture, "requested" | "visible" | "legibility" | "expect" | "checkedBy">;

function observed(f: Observed): Observed {
  return {
    requested: f.requested,
    visible: f.visible,
    legibility: f.legibility,
    expect: f.expect,
    checkedBy: f.checkedBy,
  };
}

/**
 * Carries recorded observations from an earlier fixture of the same image into a redraft, field by field
 * where the requested value is unchanged and the crop was not marked wrong (a reading of a wrong crop is
 * not a reading of the field). Rectangles are new, so the redraft stays a draft until its crops are
 * checked again. An earlier fixture of another image, kind or schema version carries nothing.
 */
export function carryOver<F extends Fixture>(prev: unknown, next: F): F {
  const parsed = FixtureSchema.safeParse(prev);
  if (!parsed.success) return next;
  const p: Fixture = parsed.data;
  if (p.kind !== next.kind || p.image.sha256 !== next.image.sha256) return next;
  const wrongCrops = new Set(p.review.cropIssues);
  let carried = 0;
  const copy = (path: string, from: Observed | undefined, to: FieldFixture) => {
    if (!from || from.checkedBy === null || from.requested !== to.requested || wrongCrops.has(path)) return;
    Object.assign(to, observed(from));
    carried++;
  };
  if (next.kind === "logbook_page" && p.kind === "logbook_page") {
    const lb = next as LogbookPageFixture;
    for (const l of lb.lines) {
      const old = (p as LogbookPageFixture).lines.find((x) => x.line === l.line);
      for (const c of LOGBOOK_COLUMNS) copy(`line ${l.line}.${c}`, old?.cells[c], l.cells[c]);
    }
  } else if ((next.kind === "slip_page" || next.kind === "slip_photo") && p.kind === next.kind) {
    const sf = next as SlipImageFixture;
    for (const s of sf.slips) {
      const old = (p as SlipImageFixture).slips.find((x) => x.slot === s.slot && x.serial === s.serial);
      if (!old) continue;
      const prefix = sf.kind === "slip_page" ? "" : `${s.slot}.`;
      const before = new Map(slipFieldEntries(old).map((e) => [e.path, e.field]));
      for (const e of slipFieldEntries(s)) copy(`${prefix}${e.path}`, before.get(e.path), e.field);
      for (const t of s.trapChecks) {
        const was = old.trapChecks.find((x) => x.trap === t.trap);
        if (was) Object.assign(t, was);
      }
    }
  }
  if (carried)
    next.review.notes.push(`${carried} recorded observation(s) carried over; rectangles redrafted`);
  return next;
}
