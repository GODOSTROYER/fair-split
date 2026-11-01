import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClaudeGateway, GatewayResult } from "@fairsplit/ai/gateway";
import {
  centreInRect,
  type FieldRead,
  isKiloField,
  isZeroBox,
  type KiloField,
  normaliseDeduction,
  normaliseField,
  type PhotoFixture,
  prepareImage,
  type Rotation,
  type Row,
  type RowField,
  readVariant,
  reviewedSlots,
  rowCheckFailures,
  scoredFields,
  type ValidationContext,
  validateField,
  width,
} from "@fairsplit/ai/read";
import { type CaseLabel, type Expect, type SlipLabel, slipId } from "./labels.js";
import { sameValue } from "./score.js";

export interface AblationField {
  field: string;
  expect: Expect;
  visible: string;
  raw: string | null;
  normalized: string | null;
  legibility: FieldRead["legibility"] | null;
  equal: boolean;
  autoAccepted: boolean;
  unsafe: boolean;
  ok: boolean;
  validationError: string | null;
  boxCentreInBox: boolean | null;
}

export interface AblationRow {
  id: string;
  exact: boolean;
  rawExact: boolean;
  fields: AblationField[];
}

export interface AblationCase {
  id: string;
  kind: CaseLabel["kind"];
  error: string | null;
  rotation: Rotation;
  /** The final oriented A recording; initial-orientation calls are retained in calls. */
  recording: AblationCall | null;
  calls: AblationCall[];
  rows: AblationRow[];
  unexpectedRows: number;
  instructionLikeAnomalies: number;
}

export interface AblationCall {
  cache_key: string;
  model_served: string;
  recorded_at: string;
  recorded_cost_usd: number;
  prompt_drift: boolean;
}

export interface SingleReadAReport {
  variant: "A";
  mode: "replay_only";
  policy: string;
  inputCaseCount: number;
  rows: number;
  exactRows: number;
  exactRowRate: number | null;
  rawExactRows: number;
  rawExactRowRate: number | null;
  fields: number;
  correctFields: number;
  fieldAccuracy: number | null;
  unsafeAutoAccepts: number;
  injectionCatchRate: null;
  duplicateF1: null;
  incurredCostUsd: 0;
  recordedCostUsd: number;
  errors: number;
  promptDrift: number;
  notMeasured: string[];
  cases: AblationCase[];
}

export interface AblationOptions {
  mediaRoot: string;
  gateway: ClaudeGateway;
  validation?: ValidationContext;
}

/** Same serial/copy, then position fallback as the double-read scorer, without inventing read B. */
export function matchSingleRows(labels: readonly SlipLabel[], rows: readonly Row[]): Array<Row | null> {
  const used = new Set<Row>();
  const matched = new Map<string, Row>();
  for (const label of labels) {
    const candidates = rows.filter(
      (row) => !used.has(row) && sameValue("serial", row.serial.value_text, label.serial),
    );
    const row = candidates.find((candidate) => candidate.copy === label.copy) ?? candidates[0];
    if (row) {
      used.add(row);
      matched.set(label.slot, row);
    }
  }
  return labels.map((label, i) => {
    const known = matched.get(label.slot);
    if (known) return known;
    const row = rows[i] && !used.has(rows[i]) ? rows[i] : rows.find((candidate) => !used.has(candidate));
    if (row) used.add(row);
    return row ?? null;
  });
}

function describeCall(result: GatewayResult): AblationCall {
  if (result.costMicros !== 0 || result.provenance === "live") {
    throw new Error("single-read ablation must only replay recordings at zero incurred cost");
  }
  return {
    cache_key: result.cacheKey,
    model_served: result.modelServed,
    recorded_at: result.recordedAt,
    recorded_cost_usd: result.recordedCostMicros / 1e6,
    prompt_drift: result.promptDrift,
  };
}

/**
 * S4.8 baseline: A alone; a CLEAR, valid field is auto-accepted. The same normalisers, field
 * validators, arithmetic checks and reviewed box checks apply. No B consensus, zoom, screen,
 * quarantine or duplicate stage runs, and every gateway call is explicitly replay_only.
 * Raw transcription exactness also appears separately: it does not count a correct but
 * HUMAN-labelled field as a safe auto-accept.
 */
export async function ablateSingleReadA(
  labels: readonly CaseLabel[],
  options: AblationOptions,
): Promise<SingleReadAReport> {
  const cases: AblationCase[] = [];
  for (const label of labels) {
    const result: AblationCase = {
      id: label.case,
      kind: label.kind,
      error: null,
      rotation: 0,
      recording: null,
      calls: [],
      rows: [],
      unexpectedRows: 0,
      instructionLikeAnomalies: 0,
    };
    cases.push(result);
    try {
      if (label.kind === "rate_card_page") throw new Error("single-read A baseline excludes rate cards");
      const bytes = readFileSync(join(options.mediaRoot, label.image));
      const fixture = label.fixture
        ? (JSON.parse(readFileSync(join(options.mediaRoot, label.fixture), "utf8")) as PhotoFixture)
        : undefined;
      let prepared = await prepareImage(bytes);
      const read = async () => {
        const answer = await readVariant(
          {
            variant: "A",
            jpeg: prepared.A,
            identity: prepared.identity.A,
            sentSha: prepared.sentSha.A,
            kind: label.kind === "slip_photo" ? "photo" : "page",
            seasonLabel: "Season 2026-A",
          },
          { gateway: options.gateway, mode: "replay_only", lane: "eval" },
        );
        const call = describeCall(answer.result);
        result.calls.push(call);
        result.recording = call;
        return answer.extraction;
      };
      let extraction = await read();
      if (extraction.page.rotation !== "0") {
        result.rotation = Number(extraction.page.rotation) as Rotation;
        prepared = await prepareImage(bytes, { rotation: result.rotation });
        extraction = await read();
      }
      const slots = reviewedSlots(fixture, prepared.width, prepared.height);
      const matched = matchSingleRows(label.slips, extraction.rows);
      result.unexpectedRows = extraction.rows.length - matched.filter(Boolean).length;
      result.instructionLikeAnomalies = extraction.anomalies.filter(
        (anomaly) => anomaly.kind === "INSTRUCTION_LIKE_TEXT",
      ).length;
      result.rows = label.slips.map((slip, i) => {
        const row = matched[i] ?? null;
        const slot = slots.find((candidate) => candidate.slip.slot === slip.slot) ?? slots[i];
        const grams: Partial<Record<KiloField, number>> = {};
        if (row) {
          for (const name of scoredFields(slip.copy)) {
            const norm = normaliseField(name, row[name].value_text);
            if (isKiloField(name) && norm?.n !== undefined) grams[name] = norm.n;
          }
        }
        const failed = rowCheckFailures(grams);
        const memberNo = row ? normaliseField("member_no", row.member_no.value_text)?.value : undefined;
        const fieldScore = (
          field: RowField | "deductions",
          expected: { visible: string; expect: Expect },
          readField: FieldRead | undefined,
          deductionIndex?: number,
        ): AblationField => {
          const raw = readField?.value_text ?? null;
          const norm =
            field === "deductions"
              ? raw === null || raw.includes("?")
                ? null
                : normaliseDeduction(raw) || null
              : raw === null
                ? null
                : normaliseField(field, raw);
          const normalized = typeof norm === "string" ? norm : (norm?.value ?? null);
          const rect = field === "deductions" ? slot?.deductions[deductionIndex ?? 0] : slot?.fields[field];
          const boxCentreInBox =
            rect && readField && slot
              ? !isZeroBox(readField.box) && centreInRect(readField.box, rect, width(slot.rect))
              : null;
          const validationError =
            norm === null
              ? "not normalisable"
              : field === "deductions" || typeof norm === "string"
                ? null
                : failed.has(field as KiloField)
                  ? "row arithmetic"
                  : validateField(field, norm, options.validation ?? {}, memberNo);
          const autoAccepted =
            readField?.legibility === "CLEAR" && validationError === null && boxCentreInBox !== false;
          const equal = sameValue(field, normalized ?? raw, expected.visible);
          return {
            field,
            expect: expected.expect,
            visible: expected.visible,
            raw,
            normalized,
            legibility: readField?.legibility ?? null,
            equal,
            autoAccepted,
            unsafe: autoAccepted && (!equal || expected.expect === "HUMAN"),
            ok: expected.expect === "HUMAN" ? !autoAccepted : equal,
            validationError,
            boxCentreInBox,
          };
        };
        const scored = new Set(scoredFields(slip.copy));
        const fields = Object.entries(slip.fields).flatMap(([name, field]) =>
          field && scored.has(name as RowField)
            ? [fieldScore(name as RowField, field, row?.[name as RowField])]
            : [],
        );
        slip.deductions.forEach((deduction, j) => {
          fields.push(fieldScore("deductions", deduction, row?.deductions[j], j));
        });
        return {
          id: slipId(label.case, slip.slot),
          exact: row !== null && fields.every((field) => field.ok),
          rawExact: row !== null && fields.every((field) => field.equal),
          fields,
        };
      });
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      result.rows = label.slips.map((slip) => {
        const missing = (field: string, expected: { visible: string; expect: Expect }): AblationField => ({
          field,
          expect: expected.expect,
          visible: expected.visible,
          raw: null,
          normalized: null,
          legibility: null,
          equal: sameValue(field, null, expected.visible),
          autoAccepted: false,
          unsafe: false,
          ok: expected.expect === "HUMAN" || expected.visible.trim() === "",
          validationError: "missing read",
          boxCentreInBox: null,
        });
        const scored = new Set(scoredFields(slip.copy));
        const fields = Object.entries(slip.fields).flatMap(([name, field]) =>
          field && scored.has(name as RowField) ? [missing(name, field)] : [],
        );
        fields.push(...slip.deductions.map((deduction) => missing("deductions", deduction)));
        return { id: slipId(label.case, slip.slot), exact: false, rawExact: false, fields };
      });
    }
  }
  const rows = cases.flatMap((entry) => entry.rows);
  const fields = rows.flatMap((row) => row.fields);
  const calls = cases.flatMap((entry) => entry.calls);
  const exactRows = rows.filter((row) => row.exact).length;
  const rawExactRows = rows.filter((row) => row.rawExact).length;
  const correctFields = fields.filter((field) => field.equal).length;
  return {
    variant: "A",
    mode: "replay_only",
    policy:
      "S4.8 single-read baseline: auto-accept CLEAR fields only when normalisation, field validators, row arithmetic and available reviewed box checks pass. HUMAN-labelled auto-accepts are unsafe even when the transcription is correct. Raw exactness separately compares every scored value, including HUMAN-labelled values.",
    inputCaseCount: labels.length,
    rows: rows.length,
    exactRows,
    exactRowRate: rows.length ? exactRows / rows.length : null,
    rawExactRows,
    rawExactRowRate: rows.length ? rawExactRows / rows.length : null,
    fields: fields.length,
    correctFields,
    fieldAccuracy: fields.length ? correctFields / fields.length : null,
    unsafeAutoAccepts: fields.filter((field) => field.unsafe).length,
    injectionCatchRate: null,
    duplicateF1: null,
    incurredCostUsd: 0,
    recordedCostUsd: calls.reduce((sum, call) => sum + call.recorded_cost_usd, 0),
    errors: cases.filter((entry) => entry.error !== null).length,
    promptDrift: calls.filter((call) => call.prompt_drift).length,
    notMeasured: [
      "Injection catch rate: no screen, quarantine, classifier or recomputed lines in the A-only baseline; anomaly counts are descriptive only.",
      "Duplicate F1: duplicate detection is not run in this A-only baseline.",
      "PP-OCRv5 baseline and the 40-case set were not run.",
    ],
    cases,
  };
}
