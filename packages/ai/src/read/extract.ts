import type { GatewayResult } from "../gateway/index.js";
import type {
  ExtractQuarantinedEvent,
  HoldDraft,
  HoldGate,
  NormRect,
  PhotoFixture,
  ReadingEvent,
} from "./_shims/contracts.js";
import {
  type AgreementOutcome,
  AUTO_ACCEPT_AT,
  agreement,
  type Norm,
  normaliseDeduction,
  normaliseField,
  rowCheckFailures,
  type ScoredRead,
  type ValidationContext,
  validateField,
} from "./_shims/domain.js";
import { injectionScreen, type ReadDeps, readVariant, type ScreenOutcome, zoomRead } from "./calls.js";
import {
  isKiloField,
  type KiloField,
  lowConfidenceGate,
  requiredFields,
  scoredFields,
  zoomLabel,
} from "./fields.js";
import {
  centre,
  centreInRect,
  contains,
  iou,
  isZeroBox,
  overlaps,
  toPixels,
  union,
  width,
  ZERO_BOX,
} from "./geometry.js";
import {
  cropBoxToMaster,
  cropForZoom,
  dHash64,
  type PreparedImage,
  prepareImage,
  type Rotation,
} from "./prep.js";
import type { Anomaly, Box, CopyColour, Extraction, FieldRead, Row, RowField } from "./schema.js";
import { ExtractionStreamTracker } from "./stream.js";

export type DocumentKind = "slip_photo" | "slip_page" | "logbook_page";

export interface ExtractInput {
  docId: string;
  kind: DocumentKind;
  /** The uploaded file's bytes. */
  bytes: Buffer;
  /** Reviewed fixture (photos) or template rectangles (pages). Crops and box checks come from it. */
  fixture?: PhotoFixture;
  validation?: ValidationContext;
  seasonLabel?: string;
  emit?: (event: ReadingEvent) => void;
  /** AI-3 zoom re-reads (default on). */
  zoom?: boolean;
  /** AI-4 injection screen (default on). */
  screen?: boolean;
}

export interface FieldOutcome {
  field: RowField | "deductions";
  index?: number;
  a: FieldRead;
  b: FieldRead;
  /** The zoom re-read, box mapped onto the master. */
  zoom: FieldRead | null;
  /** Box-in-rectangle validator per read: null when no fixture rectangle exists. */
  boxOk: { a: boolean | null; b: boolean | null; zoom: boolean | null };
  /** null: an optional field ABSENT in both reads (skipped, not scored). */
  outcome: AgreementOutcome | null;
}

export interface DeductionOutcome extends FieldOutcome {
  field: "deductions";
  index: number;
  /** The proposed line (normalised); "" when nothing usable was read. */
  text: string;
  /** Quarantined text never enters a later prompt (the classifier sees only `quarantined: true`). */
  quarantined: boolean;
}

export interface RowOutcome {
  docId: string;
  row: number;
  matched: "both" | "A_only" | "B_only";
  copy: CopyColour;
  slipBox: Box;
  serial: string;
  memberNo: string;
  fields: Partial<Record<RowField, FieldOutcome>>;
  deductions: DeductionOutcome[];
  signature: { a: Row["signature"]; b: Row["signature"] };
  state: "AUTO_ACCEPTED" | "NEEDS_HUMAN";
  minScore: number;
  dhash: string | null;
}

export interface LocatedAnomaly extends Anomaly {
  source: "read_a" | "read_b";
  row: number | null;
}

export interface ExtractResult {
  docId: string;
  kind: DocumentKind;
  documentSha256: string;
  width: number;
  height: number;
  rotation: Rotation;
  page: Extraction["page"];
  rows: RowOutcome[];
  anomalies: LocatedAnomaly[];
  screen: ScreenOutcome | null;
  quarantined: ExtractQuarantinedEvent[];
  holds: HoldDraft[];
  events: ReadingEvent[];
  calls: GatewayResult[];
  costMicros: number;
  provenance: "live" | "replay" | "mixed";
}

const ABSENT: FieldRead = { box: ZERO_BOX, value_text: "", legibility: "ABSENT", overwritten_from: "" };

function absentRow(like: Row): Row {
  const row = { ...like, slip_box: like.slip_box, deductions: [], signature: "NONE" } as Row;
  for (const key of Object.keys(row) as Array<keyof Row>) {
    const v = row[key] as unknown;
    if (v && typeof v === "object" && "legibility" in (v as object))
      (row as Record<string, unknown>)[key] = ABSENT;
  }
  return row;
}

interface Slot {
  slip: PhotoFixture["slips"][number];
  rect: Box;
  fields: Partial<Record<RowField, Box>>;
  deductions: Box[];
}

function slotsOf(fixture: PhotoFixture | undefined, w: number, h: number): Slot[] {
  if (!fixture) return [];
  const px = (r: NormRect) => toPixels(r, w, h);
  return fixture.slips.map((slip) => ({
    slip,
    rect: px(slip.rect),
    fields: Object.fromEntries(Object.entries(slip.fields).map(([k, r]) => [k, px(r as NormRect)])),
    deductions: (slip.deductions ?? []).map(px),
  }));
}

const maxGate = (a: HoldGate, b: HoldGate): HoldGate =>
  a === "BLOCKS_APPROVAL" || b === "BLOCKS_APPROVAL" ? "BLOCKS_APPROVAL" : "RESERVES_LINE";

/** Every transcribed string of both reads (AI-4 input), deduplicated, in reading order. */
export function transcriptionOf(...extractions: Extraction[]): string[] {
  const out = new Set<string>();
  const add = (s: string) => {
    const t = s.trim();
    if (t) out.add(t);
  };
  for (const ex of extractions) {
    for (const row of ex.rows) {
      for (const value of Object.values(row)) {
        const f = value as FieldRead;
        if (f && typeof f === "object" && "value_text" in f) {
          add(f.value_text);
          add(f.overwritten_from);
        }
      }
      for (const d of row.deductions) {
        add(d.value_text);
        add(d.overwritten_from);
      }
    }
    for (const a of ex.anomalies) add(a.verbatim);
  }
  return [...out];
}

interface PassOutcome {
  rotate: Rotation | null;
  result: ExtractResult | null;
}

/**
 * The `extract` task (S4.2): prep → reads A and B in parallel (streamed) → per-row agreement as rows
 * complete in both reads, with zoom re-reads for 0.40 fields → injection screen → quarantine and hold
 * drafts. Model boxes only move the band and feed the box validator; crops come from fixtures.
 */
export async function extract(input: ExtractInput, deps: ReadDeps): Promise<ExtractResult> {
  let rotation: Rotation = 0;
  for (let pass = 0; pass < 2; pass++) {
    const prep = await prepareImage(input.bytes, { rotation });
    const outcome = await runPass(input, deps, prep, pass === 0);
    if (outcome.result) return outcome.result;
    rotation = outcome.rotate ?? 0;
  }
  throw new Error("unreachable: the second pass never asks to rotate");
}

async function runPass(
  input: ExtractInput,
  deps: ReadDeps,
  prep: PreparedImage,
  mayRotate: boolean,
): Promise<PassOutcome> {
  const events: ReadingEvent[] = [];
  const emit = (e: ReadingEvent) => {
    events.push(e);
    input.emit?.(e);
  };
  const ctx = input.validation ?? {};
  const W = prep.width;
  const H = prep.height;
  const slots = slotsOf(input.fixture, W, H);
  const calls: GatewayResult[] = [];

  const slotKey = (slipBox: Box | null, idx: number): string => {
    if (slots.length > 0 && slipBox && !isZeroBox(slipBox)) {
      const c = centre(slipBox);
      const i = slots.findIndex((s) => contains(s.rect, c));
      if (i >= 0) return `s${i}`;
    }
    return `r${idx}`;
  };
  // Row numbers are stable across live and replayed runs: a fixture slot keeps its index; rows the
  // fixture does not place follow the slots in read order; a second row read onto an occupied slot
  // gets a number far past both.
  const rowNumber = (key: string, idx: number): number => {
    const slot = /^s(\d+)$/.exec(key);
    if (slot) return Number(slot[1]);
    if (/^r\d+$/.test(key)) return slots.length + idx;
    return slots.length + (key.includes("#B") ? 2000 : 1000) + idx;
  };

  const completed = {
    A: new Map<string, { idx: number; row: Row }>(),
    B: new Map<string, { idx: number; row: Row }>(),
  };
  const processing = new Map<string, Promise<RowOutcome>>();
  let rotateTo: Rotation | null = null;

  const schedule = (key: string) => {
    if (processing.has(key) || rotateTo !== null) return;
    const a = completed.A.get(key);
    const b = completed.B.get(key);
    if (a && b) processing.set(key, processRow(key, a, b));
  };

  const processRow = async (
    key: string,
    aIn: { idx: number; row: Row } | undefined,
    bIn: { idx: number; row: Row } | undefined,
  ): Promise<RowOutcome> => {
    const present = (aIn ?? bIn) as { idx: number; row: Row };
    const A = aIn?.row ?? absentRow(present.row);
    const B = bIn?.row ?? absentRow(present.row);
    const slot = key.startsWith("s") ? slots[Number(key.slice(1))] : undefined;
    const row = rowNumber(key, present.idx);
    const copy: CopyColour =
      slot?.slip.copy ??
      (A.copy === B.copy || !bIn
        ? A.copy
        : !aIn
          ? B.copy
          : A.copy === "UNKNOWN"
            ? B.copy
            : B.copy === "UNKNOWN"
              ? A.copy
              : "UNKNOWN");
    const slipRect = slot?.rect ?? (isZeroBox(A.slip_box) ? B.slip_box : A.slip_box);
    const slipWidth = Math.max(1, width(slipRect));
    const required = new Set(requiredFields(copy));
    const scored = scoredFields(copy);

    const normOf = (f: RowField, r: FieldRead): Norm | null =>
      r.legibility === "ABSENT" || r.legibility === "ILLEGIBLE" ? null : normaliseField(f, r.value_text);
    const boxCheck = (rect: Box | undefined, r: FieldRead): boolean | null =>
      rect ? !isZeroBox(r.box) && centreInRect(r.box, rect, slipWidth) : null;

    const normA = new Map<RowField, Norm | null>();
    const normB = new Map<RowField, Norm | null>();
    for (const f of scored) {
      normA.set(f, normOf(f, A[f]));
      normB.set(f, normOf(f, B[f]));
    }
    const consensusMember = (() => {
      const x = normA.get("member_no");
      const y = normB.get("member_no");
      return x && y && x.key === y.key ? x.value : (x?.value ?? y?.value);
    })();
    const grams: Partial<Record<KiloField, number>> = {};
    for (const f of scored) {
      if (!isKiloField(f)) continue;
      const x = normA.get(f);
      const y = normB.get(f);
      if (x && y && x.key === y.key && x.n !== undefined) grams[f] = x.n;
    }
    const failures = rowCheckFailures(grams);
    const scoredRead = (
      f: RowField,
      r: FieldRead,
      n: Norm | null,
      box: boolean | null,
      failed: Set<string>,
    ): ScoredRead => ({
      legibility: r.legibility,
      raw: r.value_text,
      norm: n,
      valid:
        n !== null && validateField(f, n, ctx, consensusMember) === null && !failed.has(f) && box !== false,
    });

    // First pass: agreement without zoom.
    const fields: Partial<Record<RowField, FieldOutcome>> = {};
    const zoomJobs: Array<Promise<void>> = [];
    const serialForLabel = normA.get("serial")?.value ?? A.serial.value_text ?? "";
    for (const f of scored) {
      const rect = slot?.fields[f];
      const boxOk = { a: boxCheck(rect, A[f]), b: boxCheck(rect, B[f]), zoom: null as boolean | null };
      const sa = scoredRead(f, A[f], normA.get(f) ?? null, boxOk.a, failures);
      const sb = scoredRead(f, B[f], normB.get(f) ?? null, boxOk.b, failures);
      const outcome = agreement(sa, sb, undefined, { required: required.has(f) });
      const fo: FieldOutcome = { field: f, a: A[f], b: B[f], zoom: null, boxOk, outcome };
      fields[f] = fo;
      if (outcome?.state !== "NEEDS_ZOOM") continue;
      const zoomRect = rect ?? union(A[f].box, B[f].box);
      if (input.zoom === false || isZeroBox(zoomRect)) continue;
      zoomJobs.push(
        (async () => {
          const crop = await cropForZoom(prep.A, { width: W, height: H }, zoomRect);
          const z = await zoomRead(
            {
              documentSha256: prep.documentSha256,
              rotation: prep.rotation,
              crop,
              label: zoomLabel(f, serialForLabel),
            },
            deps,
          );
          calls.push(z.result);
          fo.zoom = { ...z.read, box: cropBoxToMaster(z.read.box, crop) };
        })(),
      );
    }
    await Promise.all(zoomJobs);

    // Second pass: row checks with zoom-resolved values, then final agreement.
    const grams2: Partial<Record<KiloField, number>> = { ...grams };
    for (const f of scored) {
      const fo = fields[f];
      if (!fo?.zoom || !isKiloField(f)) continue;
      const nz = normOf(f, fo.zoom);
      if (nz?.n !== undefined) grams2[f] = nz.n;
    }
    const failures2 = rowCheckFailures(grams2);
    for (const f of scored) {
      const fo = fields[f];
      if (!fo) continue;
      if (fo.outcome?.state === "NEEDS_ZOOM") {
        const rect = slot?.fields[f];
        fo.boxOk.zoom = fo.zoom ? boxCheck(rect, fo.zoom) : null;
        const sa = scoredRead(f, A[f], normA.get(f) ?? null, fo.boxOk.a, failures);
        const sb = scoredRead(f, B[f], normB.get(f) ?? null, fo.boxOk.b, failures);
        const sz = fo.zoom
          ? scoredRead(f, fo.zoom, normOf(f, fo.zoom), fo.boxOk.zoom, failures2)
          : { legibility: "ABSENT" as const, raw: "", norm: null, valid: false };
        fo.outcome = agreement(sa, sb, sz, { required: required.has(f) });
      } else if (fo.outcome && fo.outcome.score >= AUTO_ACCEPT_AT && isKiloField(f) && failures2.has(f)) {
        // A zoom-resolved value broke a row check this field takes part in: it disagrees now.
        fo.outcome = { ...fo.outcome, score: 0.4, rule: 7, state: "PERSON_TYPES", decidedBy: "person" };
      }
    }

    // Deduction lines (box 13 / logbook remarks), paired by line.
    const deductions: DeductionOutcome[] = [];
    const lines = Math.max(A.deductions.length, B.deductions.length);
    const dedNorm = (r: FieldRead): Norm | null => {
      if (r.legibility === "ABSENT" || r.legibility === "ILLEGIBLE" || r.value_text.includes("?"))
        return null;
      const t = normaliseDeduction(r.value_text);
      return t ? { key: t, value: t } : null;
    };
    const dedJobs: Array<Promise<void>> = [];
    for (let j = 0; j < lines; j++) {
      const da = A.deductions[j] ?? ABSENT;
      const db = B.deductions[j] ?? ABSENT;
      const rect = slot?.deductions[j];
      const boxOk = { a: boxCheck(rect, da), b: boxCheck(rect, db), zoom: null as boolean | null };
      const sr = (r: FieldRead, ok: boolean | null): ScoredRead => {
        const n = dedNorm(r);
        return { legibility: r.legibility, raw: r.value_text, norm: n, valid: n !== null && ok !== false };
      };
      const first = agreement(sr(da, boxOk.a), sr(db, boxOk.b), undefined, { required: false });
      const d: DeductionOutcome = {
        field: "deductions",
        index: j,
        a: da,
        b: db,
        zoom: null,
        boxOk,
        outcome: first,
        text: "",
        quarantined: false,
      };
      deductions.push(d);
      const zoomRect = rect ?? union(da.box, db.box);
      if (first?.state === "NEEDS_ZOOM" && input.zoom !== false && !isZeroBox(zoomRect)) {
        dedJobs.push(
          (async () => {
            const crop = await cropForZoom(prep.A, { width: W, height: H }, zoomRect);
            const z = await zoomRead(
              {
                documentSha256: prep.documentSha256,
                rotation: prep.rotation,
                crop,
                label: `Box 13 'Kaltas' line ${j + 1} of slip ${serialForLabel || "(serial unread)"}`,
              },
              deps,
            );
            calls.push(z.result);
            d.zoom = { ...z.read, box: cropBoxToMaster(z.read.box, crop) };
            d.boxOk.zoom = boxCheck(rect, d.zoom);
            d.outcome = agreement(sr(da, boxOk.a), sr(db, boxOk.b), sr(d.zoom, d.boxOk.zoom), {
              required: false,
            });
          })(),
        );
      } else if (first?.state === "NEEDS_ZOOM") {
        d.outcome = agreement(
          sr(da, boxOk.a),
          sr(db, boxOk.b),
          { legibility: "ABSENT", raw: "", norm: null, valid: false },
          { required: false },
        );
      }
    }
    await Promise.all(dedJobs);
    for (const d of deductions) d.text = d.outcome?.value ?? "";

    const outcomes = [
      ...Object.values(fields).map((fo) => fo?.outcome ?? null),
      ...deductions.map((d) => d.outcome),
    ].filter((o): o is AgreementOutcome => o !== null);
    const minScore = outcomes.length > 0 ? Math.min(...outcomes.map((o) => o.score)) : 0;
    const finalOf = (f: RowField) => {
      const o = fields[f]?.outcome;
      return o ? (o.score >= AUTO_ACCEPT_AT ? o.value : o.display) : "";
    };
    const dhashRect = slot?.rect ?? (isZeroBox(slipRect) ? null : slipRect);
    const result: RowOutcome = {
      docId: input.docId,
      row,
      matched: aIn && bIn ? "both" : aIn ? "A_only" : "B_only",
      copy,
      slipBox: slipRect,
      serial: finalOf("serial"),
      memberNo: finalOf("member_no"),
      fields,
      deductions,
      signature: { a: A.signature, b: B.signature },
      state:
        outcomes.every((o) => o.score >= AUTO_ACCEPT_AT) && outcomes.length > 0
          ? "AUTO_ACCEPTED"
          : "NEEDS_HUMAN",
      minScore,
      dhash: dhashRect ? await dHash64(prep.A, clampBox(dhashRect, W, H)) : null,
    };
    emit({
      type: "extract.row",
      docId: input.docId,
      row,
      serial: result.serial,
      memberNo: result.memberNo,
      fields: Object.fromEntries(
        Object.entries(fields)
          .filter(([, fo]) => fo?.outcome)
          .map(([name, fo]) => {
            const o = fo?.outcome as AgreementOutcome;
            return [name, { value: o.value, score: o.score, decidedBy: o.decidedBy, display: o.display }];
          }),
      ),
    });
    return result;
  };

  const tracker = (variant: "A" | "B") =>
    new ExtractionStreamTracker({
      onPage: (page) => {
        if (variant === "A" && mayRotate && page.rotation !== "0")
          rotateTo = Number(page.rotation) as Rotation;
      },
      onField: (idx, field, box, slipBox) => {
        if (rotateTo !== null) return;
        emit({
          type: "extract.field",
          docId: input.docId,
          row: rowNumber(slotKey(slipBox, idx), idx),
          field,
          variant,
          box,
        });
      },
      onRow: (idx, row) => {
        let key = slotKey(row.slip_box, idx);
        if (completed[variant].has(key)) key = `${key}#${variant}${idx}`; // a second row on one slip
        completed[variant].set(key, { idx, row });
        schedule(key);
      },
    });
  const trackA = tracker("A");
  const trackB = tracker("B");
  const seasonLabel = input.seasonLabel ?? "Season 2026-A";
  const kind = input.kind === "slip_photo" ? "photo" : "page";
  const [ra, rb] = await Promise.all([
    readVariant(
      {
        variant: "A",
        jpeg: prep.A,
        identity: prep.identity.A,
        sentSha: prep.sentSha.A,
        kind,
        seasonLabel,
        onSnapshot: trackA.push,
      },
      deps,
    ),
    readVariant(
      {
        variant: "B",
        jpeg: prep.B,
        identity: prep.identity.B,
        sentSha: prep.sentSha.B,
        kind,
        seasonLabel,
        onSnapshot: trackB.push,
      },
      deps,
    ),
  ]);
  calls.push(ra.result, rb.result);

  // A page reported as rotated is rotated by code and read once more.
  if (mayRotate && ra.extraction.page.rotation !== "0") {
    await Promise.allSettled(processing.values());
    return { rotate: Number(ra.extraction.page.rotation) as Rotation, result: null };
  }

  // Rows the trackers did not see (a stream that continued after a fallback) come from the final parse.
  for (const [variant, ex] of [
    ["A", ra.extraction],
    ["B", rb.extraction],
  ] as const) {
    ex.rows.forEach((row, idx) => {
      const seen = [...completed[variant].values()].some((v) => v.idx === idx);
      if (!seen) {
        let key = slotKey(row.slip_box, idx);
        if (completed[variant].has(key)) key = `${key}#${variant}${idx}`;
        completed[variant].set(key, { idx, row });
      }
    });
  }
  const keys = new Set([...completed.A.keys(), ...completed.B.keys()]);
  for (const key of keys) {
    if (!processing.has(key))
      processing.set(key, processRow(key, completed.A.get(key), completed.B.get(key)));
  }
  const rows = (await Promise.all(processing.values())).sort((x, y) => x.row - y.row);

  // AI-4 injection screen, once per document, after both reads.
  const screen =
    input.screen === false
      ? null
      : await injectionScreen(
          {
            documentSha256: prep.documentSha256,
            rotation: prep.rotation,
            jpegA: prep.A,
            transcription: transcriptionOf(ra.extraction, rb.extraction),
          },
          deps,
        );
  if (screen?.result) calls.push(screen.result);

  const {
    anomalies,
    quarantined,
    holds: injectionHolds,
  } = quarantine(input.docId, ra.extraction, rb.extraction, rows, slots, screen);
  for (const q of quarantined) emit(q);

  const holds: HoldDraft[] = [...injectionHolds];
  for (const r of rows) {
    const low = [
      ...Object.values(r.fields).filter((fo) => fo?.outcome && fo.outcome.score < AUTO_ACCEPT_AT),
      ...r.deductions.filter((d) => d.outcome && d.outcome.score < AUTO_ACCEPT_AT),
    ] as FieldOutcome[];
    if (low.length === 0) continue;
    const gate = low.reduce<HoldGate>(
      (g, fo) => maxGate(g, fo.field === "deductions" ? "RESERVES_LINE" : lowConfidenceGate(fo.field)),
      "RESERVES_LINE",
    );
    holds.push({
      kind: "LOW_CONFIDENCE",
      gate,
      docId: input.docId,
      row: r.row,
      reason: `By hand: ${low.map((fo) => (fo.field === "deductions" ? `deduction line ${(fo.index ?? 0) + 1}` : fo.field)).join(", ")}`,
    });
  }

  const provenances = new Set(calls.map((c) => c.provenance));
  return {
    rotate: null,
    result: {
      docId: input.docId,
      kind: input.kind,
      documentSha256: prep.documentSha256,
      width: W,
      height: H,
      rotation: prep.rotation,
      page: ra.extraction.page,
      rows,
      anomalies,
      screen,
      quarantined,
      holds,
      events,
      calls,
      costMicros: calls.reduce((s, c) => s + c.costMicros, 0),
      provenance: provenances.size === 1 ? ([...provenances][0] as "live" | "replay") : "mixed",
    },
  };
}

function clampBox(b: Box, w: number, h: number): Box {
  const x1 = Math.min(Math.max(0, b.x1), w - 1);
  const y1 = Math.min(Math.max(0, b.y1), h - 1);
  return { x1, y1, x2: Math.min(Math.max(x1 + 1, b.x2), w), y2: Math.min(Math.max(y1 + 1, b.y2), h) };
}

/**
 * Quarantine (S4.2 AI-4): text is quarantined when the screen fires or either read reported
 * INSTRUCTION_LIKE_TEXT. A SUSPECTED_INJECTION hold is drafted only when the text overlaps a field
 * rectangle or a deduction line (RESERVES_LINE; BLOCKS_APPROVAL for a kilo field), or when the screen
 * fired but no read located the text (RESERVES_LINE on every row of the document).
 */
export function quarantine(
  docId: string,
  a: Extraction,
  b: Extraction,
  rows: RowOutcome[],
  slots: readonly Slot[],
  screen: ScreenOutcome | null,
): { anomalies: LocatedAnomaly[]; quarantined: ExtractQuarantinedEvent[]; holds: HoldDraft[] } {
  const rowOf = (box: Box): number | null => {
    const c = centre(box);
    const inside = rows.find((r) => !isZeroBox(r.slipBox) && contains(r.slipBox, c));
    if (inside) return inside.row;
    let best: { row: number; area: number } | null = null;
    for (const r of rows) {
      const area = iou(r.slipBox, box);
      if (area > 0 && (!best || area > best.area)) best = { row: r.row, area };
    }
    return best?.row ?? null;
  };
  const anomalies: LocatedAnomaly[] = [
    ...a.anomalies.map((x) => ({ ...x, source: "read_a" as const, row: rowOf(x.box) })),
    ...b.anomalies.map((x) => ({ ...x, source: "read_b" as const, row: rowOf(x.box) })),
  ];
  const instructions = anomalies.filter((x) => x.kind === "INSTRUCTION_LIKE_TEXT");
  // One quarantine per piece of text: B's report of the same text as A's is not a second event.
  const distinct: LocatedAnomaly[] = [];
  const same = (x: LocatedAnomaly, y: LocatedAnomaly) =>
    iou(x.box, y.box) > 0.3 ||
    x.verbatim.replace(/\s+/g, " ").trim().toLowerCase() ===
      y.verbatim.replace(/\s+/g, " ").trim().toLowerCase();
  for (const x of instructions) if (!distinct.some((y) => same(x, y))) distinct.push(x);

  const quarantined: ExtractQuarantinedEvent[] = distinct.map((x) => ({
    type: "extract.quarantined",
    docId,
    row: x.row,
    box: x.box,
    source: x.source,
  }));
  const holds: HoldDraft[] = [];
  const located = distinct.length > 0;
  if (screen?.suspected && !located) {
    quarantined.push({ type: "extract.quarantined", docId, row: null, box: null, source: "screen" });
    for (const r of rows) {
      for (const d of r.deductions) d.quarantined = true;
      holds.push({
        kind: "SUSPECTED_INJECTION",
        gate: "RESERVES_LINE",
        docId,
        row: r.row,
        reason: screen.failed
          ? `Injection screen failed closed: ${screen.failed}`
          : "Injection screen fired; no read located the text",
      });
    }
  }
  for (const x of distinct) {
    const r = rows.find((row) => row.row === x.row);
    if (!r) continue;
    const slot = slots.find((s) => contains(s.rect, centre(r.slipBox)));
    let gate: HoldGate | null = null;
    let field: RowField | "deductions" | undefined;
    for (const [name, fo] of Object.entries(r.fields) as Array<[RowField, FieldOutcome | undefined]>) {
      const rect = slot?.fields[name] ?? (fo && !isZeroBox(fo.a.box) ? fo.a.box : undefined);
      if (rect && overlaps(rect, x.box)) {
        const g: HoldGate = isKiloField(name) ? "BLOCKS_APPROVAL" : "RESERVES_LINE";
        gate = gate ? maxGate(gate, g) : g;
        field = field ?? name;
      }
    }
    for (const d of r.deductions) {
      const rect =
        slot?.deductions[d.index] ??
        (!isZeroBox(d.a.box) ? d.a.box : !isZeroBox(d.b.box) ? d.b.box : undefined);
      const textMatch = d.text && x.verbatim && normaliseDeduction(x.verbatim) === d.text;
      if ((rect && overlaps(rect, x.box)) || textMatch) {
        d.quarantined = true;
        gate = gate ? maxGate(gate, "RESERVES_LINE") : "RESERVES_LINE";
        field = field ?? "deductions";
      }
    }
    if (gate) {
      holds.push({
        kind: "SUSPECTED_INJECTION",
        gate,
        docId,
        row: r.row,
        field,
        reason: "Instruction-like text overlaps slip data",
      });
    }
  }
  return { anomalies, quarantined, holds };
}

/**
 * The Judge live lane's comparison (S4.9): "Live read matches the recorded read on n of N fields".
 * Compares each field's proposed value (normalised); a live read never writes rows.
 */
export function compareRows(
  live: RowOutcome,
  recorded: RowOutcome,
): {
  matching: number;
  total: number;
  fields: Array<{ field: RowField; live: string; recorded: string; same: boolean }>;
} {
  const fields: Array<{ field: RowField; live: string; recorded: string; same: boolean }> = [];
  const names = new Set([...Object.keys(recorded.fields), ...Object.keys(live.fields)] as RowField[]);
  for (const field of names) {
    const l = live.fields[field]?.outcome?.value ?? "";
    const r = recorded.fields[field]?.outcome?.value ?? "";
    const nl = normaliseField(field, l);
    const nr = normaliseField(field, r);
    const same = nl && nr ? nl.key === nr.key : l.trim() === r.trim();
    fields.push({ field, live: l, recorded: r, same });
  }
  return { matching: fields.filter((f) => f.same).length, total: fields.length, fields };
}
