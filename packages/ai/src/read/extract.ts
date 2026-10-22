import { type GatewayResult, isGatewayError } from "../gateway/index.js";
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
import {
  injectionScreen,
  type ReadDeps,
  readVariant,
  rescreenStrings,
  type ScreenOutcome,
  zoomRead,
} from "./calls.js";
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
  /**
   * Reviewed fixture (photos), template rectangles (pages) or a fixture re-projected onto a crop
   * (`cropFixture`). C-10: these are the only source of crops. Without one, nothing is zoomed, no
   * dHash is taken and located instruction-like text fails closed.
   */
  fixture?: PhotoFixture;
  validation?: ValidationContext;
  seasonLabel?: string;
  emit?: (event: ReadingEvent) => void;
  /** AI-3 zoom re-reads (default on). */
  zoom?: boolean;
  /** AI-4 injection screen (default on). */
  screen?: boolean;
}

/** Why a zoom the field needed produced no read. The field then goes to a person (rule 7, 0.40). */
export interface ZoomFailure {
  /** The gateway error code (AI_STOP_REASON, AI_BUDGET, AI_UPSTREAM, AI_SCHEMA, ...) or ERROR. */
  code: string;
  message: string;
}

export interface FieldOutcome {
  field: RowField | "deductions";
  index?: number;
  a: FieldRead;
  b: FieldRead;
  /** The zoom re-read, box mapped onto the master. */
  zoom: FieldRead | null;
  /** The zoom ran and failed: recorded here, and the field scores rule 7 instead of failing the document. */
  zoomError: ZoomFailure | null;
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
  /** The reviewed fixture slot that places this row; null when no reviewed rectangle does. */
  slot: number | null;
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
  /** 64-bit dHash of the reviewed slip rectangle; null without one (never from a model box). */
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
  /** The text-only re-screen of the strings located instruction-like text does not explain, when one ran. */
  rescreen: ScreenOutcome | null;
  quarantined: ExtractQuarantinedEvent[];
  holds: HoldDraft[];
  events: ReadingEvent[];
  calls: GatewayResult[];
  costMicros: number;
  provenance: "live" | "replay" | "mixed";
}

const ABSENT: FieldRead = { box: ZERO_BOX, value_text: "", legibility: "ABSENT", overwritten_from: "" };
/** A zoom that did not happen or failed: agreement then reaches rule 7. */
const NO_ZOOM: ScoredRead = { legibility: "ABSENT", raw: "", norm: null, valid: false };

function absentRow(like: Row): Row {
  const row = { ...like, slip_box: like.slip_box, deductions: [], signature: "NONE" } as Row;
  for (const key of Object.keys(row) as Array<keyof Row>) {
    const v = row[key] as unknown;
    if (v && typeof v === "object" && "legibility" in (v as object))
      (row as Record<string, unknown>)[key] = ABSENT;
  }
  return row;
}

/** A fixture slip in pixels of the image as read: the reviewed rectangles crops and gating may use. */
export interface ReviewedSlot {
  slip: PhotoFixture["slips"][number];
  rect: Box;
  fields: Partial<Record<RowField, Box>>;
  deductions: Box[];
}

export function reviewedSlots(fixture: PhotoFixture | undefined, w: number, h: number): ReviewedSlot[] {
  if (!fixture) return [];
  const px = (r: NormRect) => toPixels(r, w, h);
  return fixture.slips.map((slip) => ({
    slip,
    rect: px(slip.rect),
    fields: Object.fromEntries(Object.entries(slip.fields).map(([k, r]) => [k, px(r as NormRect)])),
    deductions: (slip.deductions ?? []).map(px),
  }));
}

/**
 * The reviewed fixture of a crop of a photo, rectangles re-projected into the crop (normalised 0-1).
 * "Read a slip live" reads one slip's crop from photos A-L: with this fixture its zooms, dHash and
 * injection gating use the reviewed rectangles, as the recorded run does. Slips whose rectangle
 * centre lies outside the crop are dropped.
 */
export function cropFixture(fixture: PhotoFixture, crop: NormRect): PhotoFixture {
  const w = crop.x2 - crop.x1;
  const h = crop.y2 - crop.y1;
  if (!(w > 0 && h > 0)) throw new RangeError("crop rectangle is empty");
  const map = (r: NormRect): NormRect => ({
    x1: (r.x1 - crop.x1) / w,
    y1: (r.y1 - crop.y1) / h,
    x2: (r.x2 - crop.x1) / w,
    y2: (r.y2 - crop.y1) / h,
  });
  const inside = (r: NormRect) => {
    const cx = (r.x1 + r.x2) / 2;
    const cy = (r.y1 + r.y2) / 2;
    return cx >= crop.x1 && cx <= crop.x2 && cy >= crop.y1 && cy <= crop.y2;
  };
  return {
    photo: fixture.photo,
    slips: fixture.slips
      .filter((s) => inside(s.rect))
      .map((s) => ({
        ...s,
        rect: map(s.rect),
        fields: Object.fromEntries(Object.entries(s.fields).map(([k, r]) => [k, map(r as NormRect)])),
        deductions: s.deductions?.map(map),
      })),
  };
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
 * drafts. Model boxes only move the band and feed the box validator; crops come from reviewed
 * rectangles (C-10). A failed zoom sends its field to a person and never fails the document.
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
  const slots = reviewedSlots(input.fixture, W, H);
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

  /**
   * AI-3 on a reviewed rectangle. Any failure (a stop reason such as max_tokens or a refusal, the
   * budget, the upstream API after retries, the schema) is recorded on the field, which then goes to
   * a person. A replay miss (a configuration error) and an abort (the whole read is cancelled) are
   * rethrown.
   */
  const zoomField = async (
    rect: Box,
    label: string,
  ): Promise<{ read: FieldRead | null; error: ZoomFailure | null }> => {
    try {
      const crop = await cropForZoom(prep.A, { width: W, height: H }, rect);
      const z = await zoomRead(
        { documentSha256: prep.documentSha256, rotation: prep.rotation, crop, label },
        deps,
      );
      calls.push(z.result);
      return { read: { ...z.read, box: cropBoxToMaster(z.read.box, crop) }, error: null };
    } catch (err) {
      if (isGatewayError(err, "AI_LIVE_DISABLED") && err.details.reason === "replay_only") throw err;
      if (deps.signal?.aborted) throw err;
      // A call that ran (a stop-reason or schema failure) still cost money: keep it on the ledger.
      if (isGatewayError(err) && err.details.result) calls.push(err.details.result);
      return {
        read: null,
        error: {
          code: isGatewayError(err) ? err.code : "ERROR",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
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
    // A second row read onto an occupied slot ("s0#A2") is not placed by the slot's rectangles.
    const placed = /^s(\d+)$/.exec(key);
    const slotIndex = placed ? Number(placed[1]) : null;
    const slot = slotIndex !== null ? slots[slotIndex] : undefined;
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
    // Display only (the band, the event's row): the reviewed slip rectangle when there is one.
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

    // First pass: agreement without zoom. Zooms run only on reviewed rectangles (C-10): without one
    // the field goes straight to a person (rule 7).
    const fields: Partial<Record<RowField, FieldOutcome>> = {};
    const zoomJobs: Array<Promise<void>> = [];
    const serialForLabel = normA.get("serial")?.value ?? A.serial.value_text ?? "";
    for (const f of scored) {
      const rect = slot?.fields[f];
      const boxOk = { a: boxCheck(rect, A[f]), b: boxCheck(rect, B[f]), zoom: null as boolean | null };
      const sa = scoredRead(f, A[f], normA.get(f) ?? null, boxOk.a, failures);
      const sb = scoredRead(f, B[f], normB.get(f) ?? null, boxOk.b, failures);
      const outcome = agreement(sa, sb, undefined, { required: required.has(f) });
      const fo: FieldOutcome = { field: f, a: A[f], b: B[f], zoom: null, zoomError: null, boxOk, outcome };
      fields[f] = fo;
      if (outcome?.state !== "NEEDS_ZOOM" || input.zoom === false || !rect) continue;
      zoomJobs.push(
        zoomField(rect, zoomLabel(f, serialForLabel)).then((z) => {
          fo.zoom = z.read;
          fo.zoomError = z.error;
        }),
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
        const sz = fo.zoom ? scoredRead(f, fo.zoom, normOf(f, fo.zoom), fo.boxOk.zoom, failures2) : NO_ZOOM;
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
    const sr = (r: FieldRead, ok: boolean | null): ScoredRead => {
      const n = dedNorm(r);
      return { legibility: r.legibility, raw: r.value_text, norm: n, valid: n !== null && ok !== false };
    };
    const dedJobs: Array<Promise<void>> = [];
    for (let j = 0; j < lines; j++) {
      const da = A.deductions[j] ?? ABSENT;
      const db = B.deductions[j] ?? ABSENT;
      const rect = slot?.deductions[j];
      const boxOk = { a: boxCheck(rect, da), b: boxCheck(rect, db), zoom: null as boolean | null };
      const first = agreement(sr(da, boxOk.a), sr(db, boxOk.b), undefined, { required: false });
      const d: DeductionOutcome = {
        field: "deductions",
        index: j,
        a: da,
        b: db,
        zoom: null,
        zoomError: null,
        boxOk,
        outcome: first,
        text: "",
        quarantined: false,
      };
      deductions.push(d);
      if (first?.state !== "NEEDS_ZOOM" || input.zoom === false || !rect) continue;
      dedJobs.push(
        zoomField(rect, `Box 13 'Kaltas' line ${j + 1} of slip ${serialForLabel || "(serial unread)"}`).then(
          (z) => {
            d.zoom = z.read;
            d.zoomError = z.error;
          },
        ),
      );
    }
    await Promise.all(dedJobs);
    for (const d of deductions) {
      if (d.outcome?.state === "NEEDS_ZOOM") {
        d.boxOk.zoom = d.zoom ? boxCheck(slot?.deductions[d.index], d.zoom) : null;
        d.outcome = agreement(
          sr(d.a, d.boxOk.a),
          sr(d.b, d.boxOk.b),
          d.zoom ? sr(d.zoom, d.boxOk.zoom) : NO_ZOOM,
          { required: false },
        );
      }
      d.text = d.outcome?.value ?? "";
    }

    const outcomes = [
      ...Object.values(fields).map((fo) => fo?.outcome ?? null),
      ...deductions.map((d) => d.outcome),
    ].filter((o): o is AgreementOutcome => o !== null);
    const minScore = outcomes.length > 0 ? Math.min(...outcomes.map((o) => o.score)) : 0;
    const finalOf = (f: RowField) => {
      const o = fields[f]?.outcome;
      return o ? (o.score >= AUTO_ACCEPT_AT ? o.value : o.display) : "";
    };
    const result: RowOutcome = {
      docId: input.docId,
      row,
      slot: slot ? slotIndex : null,
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
      // Duplicate signal 3 hashes the reviewed slip rectangle only (C-10): never a model box.
      dhash: slot ? await dHash64(prep.A, clampBox(slot.rect, W, H)) : null,
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

  // Rows the trackers did not see (a snapshot that never parsed, or a legacy recording that reset
  // mid-stream) come from the final parse.
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
  const transcription = transcriptionOf(ra.extraction, rb.extraction);
  const screen =
    input.screen === false
      ? null
      : await injectionScreen(
          { documentSha256: prep.documentSha256, rotation: prep.rotation, jpegA: prep.A, transcription },
          deps,
        );
  if (screen?.result) calls.push(screen.result);

  const located = locateInjections(input.docId, ra.extraction, rb.extraction, rows, slots);
  // The screen fired and the reads located some instruction-like text: does that text explain the
  // hit? The remaining strings are screened once more, text only. A second injection transcribed as
  // an ordinary line (box 13, say) must not reach the classifier (S4.7 layer 4).
  let rescreen: ScreenOutcome | null = null;
  if (screen?.suspected && located.distinct.length > 0) {
    const rest = remainingStrings(transcription, located, rows);
    if (rest.length > 0) {
      rescreen = await rescreenStrings(
        { documentSha256: prep.documentSha256, rotation: prep.rotation, strings: rest },
        deps,
      );
      if (rescreen.result) calls.push(rescreen.result);
    }
  }
  const fallout = screenFallout(input.docId, rows, located, screen, rescreen);
  const quarantined = [...located.quarantined, ...fallout.quarantined];
  for (const q of quarantined) emit(q);

  const book = holdBook(input.docId);
  for (const h of [...located.holds, ...fallout.holds]) book.add(h);
  const holds: HoldDraft[] = book.list();
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
      anomalies: located.anomalies,
      screen,
      rescreen,
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

const OVERLAP_REASON = "Instruction-like text overlaps slip data";
const UNPLACED_REASON = "Instruction-like text found where no reviewed rectangle rules out an overlap";

/** SUSPECTED_INJECTION drafts, one per row: a second reason on the same row only raises the gate. */
function holdBook(docId: string) {
  const byRow = new Map<number | null, HoldDraft>();
  const add = (h: HoldDraft) => {
    if (h.kind !== "SUSPECTED_INJECTION") throw new Error("holdBook keeps SUSPECTED_INJECTION drafts only");
    const prev = byRow.get(h.row);
    if (!prev) {
      byRow.set(h.row, { ...h });
      return;
    }
    prev.gate = maxGate(prev.gate, h.gate);
    if (!prev.field && h.field) prev.field = h.field;
  };
  return {
    add,
    reserve(row: number, gate: HoldGate, field: RowField | "deductions" | undefined, reason: string) {
      add({ kind: "SUSPECTED_INJECTION", gate, docId, row, ...(field ? { field } : {}), reason });
    },
    list: (): HoldDraft[] => [...byRow.values()],
  };
}

export interface LocatedInjections {
  anomalies: LocatedAnomaly[];
  /** Distinct instruction-like texts: B's report of A's text is not a second one. */
  distinct: LocatedAnomaly[];
  quarantined: ExtractQuarantinedEvent[];
  holds: HoldDraft[];
}

/**
 * Quarantine by location (S4.2 AI-4): each instruction-like text either read reported is quarantined.
 * A SUSPECTED_INJECTION hold is drafted when the text overlaps a reviewed field rectangle or deduction
 * line (RESERVES_LINE; BLOCKS_APPROVAL for a kilo field), or when a deduction line reads as the text.
 * Model field boxes never decide: where no reviewed rectangle exists (no fixture, a row the fixture
 * does not place, a line or field without its rectangle) an overlap cannot be ruled out, so the line
 * fails closed: its deductions are quarantined and it is reserved. Mutates `quarantined` on the
 * deduction outcomes it quarantines.
 */
export function locateInjections(
  docId: string,
  a: Extraction,
  b: Extraction,
  rows: RowOutcome[],
  slots: readonly ReviewedSlot[],
): LocatedInjections {
  // The event's row is display data (the band, the pencil outline), so model slip boxes may place it.
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
  const book = holdBook(docId);
  for (const x of distinct) {
    const said = normaliseDeduction(x.verbatim);
    for (const r of rows) {
      if (r.slot === null) {
        // No reviewed rectangle places this row (no fixture, or a second row read onto an occupied
        // slip), so wherever the text is, an overlap with its data cannot be ruled out: fail closed.
        for (const d of r.deductions) d.quarantined = true;
        book.reserve(r.row, "RESERVES_LINE", undefined, UNPLACED_REASON);
        continue;
      }
      // A deduction line that reads as the instruction is quarantined wherever any box puts it.
      for (const d of r.deductions) {
        if (said && d.text === said) {
          d.quarantined = true;
          book.reserve(r.row, "RESERVES_LINE", "deductions", OVERLAP_REASON);
        }
      }
    }
    // Outside every reviewed slip, the text is over no placed slip's data.
    const i = slots.findIndex((s) => contains(s.rect, centre(x.box)));
    if (i < 0) continue;
    const slot = slots[i] as ReviewedSlot;
    for (const r of rows) {
      if (r.slot !== i) continue;
      for (const [name, fo] of Object.entries(r.fields) as Array<[RowField, FieldOutcome | undefined]>) {
        if (!fo?.outcome) continue;
        const rect = slot.fields[name];
        const gate: HoldGate = isKiloField(name) ? "BLOCKS_APPROVAL" : "RESERVES_LINE";
        if (!rect) book.reserve(r.row, gate, name, UNPLACED_REASON);
        else if (overlaps(rect, x.box)) book.reserve(r.row, gate, name, OVERLAP_REASON);
      }
      for (const d of r.deductions) {
        const rect = slot.deductions[d.index];
        if (rect && !overlaps(rect, x.box)) continue;
        d.quarantined = true;
        book.reserve(r.row, "RESERVES_LINE", "deductions", rect ? OVERLAP_REASON : UNPLACED_REASON);
      }
    }
  }
  return { anomalies, distinct, quarantined, holds: book.list() };
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The transcribed strings the located instruction-like text does not explain: the re-screen input.
 * Drops the located texts themselves (and fragments of them of 8 or more characters) and the text of
 * deduction lines already quarantined.
 */
export function remainingStrings(
  transcription: readonly string[],
  located: Pick<LocatedInjections, "distinct">,
  rows: readonly RowOutcome[],
): string[] {
  const explained = located.distinct.map((x) => squash(x.verbatim)).filter(Boolean);
  const quarantinedText = new Set(
    rows
      .flatMap((r) => r.deductions.filter((d) => d.quarantined))
      .flatMap((d) => [d.a.value_text, d.b.value_text, d.a.overwritten_from, d.b.overwritten_from])
      .map(squash)
      .filter(Boolean),
  );
  return transcription.filter((s) => {
    const n = squash(s);
    if (!n || quarantinedText.has(n)) return false;
    return !explained.some((v) => v === n || (n.length >= 8 && v.includes(n)));
  });
}

/**
 * What the screen adds (S4.2): when it fires and no read located the text, or the re-screen of the
 * strings the located text does not explain fires too, every deduction on the document is
 * quarantined and every row is reserved (RESERVES_LINE), with one `extract.quarantined` from the
 * screen. A refusal or a failure counts as firing (fail closed).
 */
export function screenFallout(
  docId: string,
  rows: readonly RowOutcome[],
  located: Pick<LocatedInjections, "distinct">,
  screen: ScreenOutcome | null,
  rescreen: ScreenOutcome | null,
): { quarantined: ExtractQuarantinedEvent[]; holds: HoldDraft[] } {
  if (!screen?.suspected) return { quarantined: [], holds: [] };
  const anyLocated = located.distinct.length > 0;
  if (anyLocated && !rescreen?.suspected) return { quarantined: [], holds: [] };
  const reason = screen.failed
    ? `Injection screen failed closed: ${screen.failed}`
    : !anyLocated
      ? "Injection screen fired; no read located the text"
      : rescreen?.failed
        ? `Re-screen of the remaining text failed closed: ${rescreen.failed}`
        : "Injection screen fired on text the reads did not locate";
  for (const r of rows) for (const d of r.deductions) d.quarantined = true;
  return {
    quarantined: [{ type: "extract.quarantined", docId, row: null, box: null, source: "screen" }],
    holds: rows.map((r) => ({
      kind: "SUSPECTED_INJECTION" as const,
      gate: "RESERVES_LINE" as const,
      docId,
      row: r.row,
      reason,
    })),
  };
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
