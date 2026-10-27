import type { SlipSpec } from "../src/content/types.js";
import { draftField, draftReview, slipTraps } from "../src/fixtures/build.js";
import {
  FIXTURE_VERSION,
  type LogbookPageFixture,
  SLIP_ROW_FIELDS,
  type SlipFixture,
  type SlipImageFixture,
  type SlipRowField,
  type Slot,
} from "../src/fixtures/schema.js";
import { type AssetEntry, GENERATOR, SYNTHETIC_LABEL } from "../src/imagegen/manifest.js";
import { expectedVisible } from "../src/prompts/render.js";

/** Small helpers that build schema-valid fixtures and manifest entries for unit tests. */

export const SHA_A = "a".repeat(64);
export const SHA_B = "b".repeat(64);

function rect(i: number) {
  return { x1: 0.1, y1: 0.05 + i * 0.05, x2: 0.9, y2: 0.09 + i * 0.05 };
}

export function slipOf(slip: SlipSpec, slot: Slot, duplicateOf: string | null = null): SlipFixture {
  const requested = expectedVisible(slip);
  const value = (f: keyof typeof requested): string =>
    f === "serial" ? slip.serial : f === "signature" ? slip.signature.mark : slip.values[f];
  const traps = slipTraps(slip);
  return {
    slot,
    serial: slip.serial,
    copy: slip.copy,
    quad: [
      [0.05, 0.02],
      [0.95, 0.02],
      [0.95, 0.98],
      [0.05, 0.98],
    ],
    rect: { x1: 0.05, y1: 0.02, x2: 0.95, y2: 0.98 },
    fields: Object.fromEntries(
      SLIP_ROW_FIELDS.map((f, i) => [f, draftField(rect(i), value(f), requested[f])]),
    ) as Record<SlipRowField, ReturnType<typeof draftField>>,
    deductions: [
      draftField(rect(14), value("deduction_1"), requested.deduction_1),
      draftField(rect(15), value("deduction_2"), requested.deduction_2),
    ],
    signature: draftField(rect(16), value("signature"), requested.signature),
    anomalies: slip.artifacts.flatMap((a) =>
      a.kind === "MARGIN_NOTE"
        ? [
            {
              kind: "INSTRUCTION_LIKE_TEXT" as const,
              ...draftField({ x1: 0.1, y1: 0, x2: 0.6, y2: 0.04 }, a.text, a.text),
              expect: "HUMAN" as const,
            },
          ]
        : [],
    ),
    traps,
    trapChecks: traps
      .filter((t) => t === "WATER_STAIN" || t === "MARGIN_NOTE")
      .map((trap) => ({
        trap: trap as "WATER_STAIN" | "MARGIN_NOTE",
        status: "UNVERIFIED" as const,
        by: null,
        at: null,
        evidence: "",
      })),
    duplicateOf,
  };
}

export function slipPageFixture(
  id: string,
  slip: SlipSpec,
  opts: { group?: string; sha?: string; duplicateOf?: string | null } = {},
): SlipImageFixture {
  return {
    v: FIXTURE_VERSION,
    id,
    group: opts.group ?? "s3-hero",
    synthetic: true,
    image: {
      master: `masters/${id}.jpg`,
      display: `slips/${id}.webp`,
      width: 1000,
      height: 1200,
      sha256: opts.sha ?? SHA_A,
    },
    review: draftReview(),
    kind: "slip_page",
    template: "slip-v1",
    slips: [slipOf(slip, "ONLY", opts.duplicateOf ?? null)],
  };
}

export function logbookFixture(
  id: string,
  lines: { line: number; serial: string; values: Record<string, string> }[],
): LogbookPageFixture {
  const cols = ["line", "date", "serial", "member_no", "member_name", "net_kg", "grade", "remarks"] as const;
  return {
    v: FIXTURE_VERSION,
    id,
    group: "docs",
    synthetic: true,
    image: {
      master: `masters/${id}.jpg`,
      display: `docs/${id}.webp`,
      width: 1000,
      height: 1200,
      sha256: SHA_A,
    },
    review: draftReview(),
    kind: "logbook_page",
    page: 14,
    columns: [...cols],
    lines: lines.map((l, i) => ({
      line: l.line,
      serial: l.serial,
      rect: rect(i),
      cells: Object.fromEntries(
        cols.map((c) => [c, draftField(rect(i), l.values[c] ?? "", l.values[c] ?? "")]),
      ) as LogbookPageFixture["lines"][number]["cells"],
    })),
  };
}

export function entry(
  id: string,
  opts: { masterSha?: string; outputSha?: string; editOf?: string } = {},
): AssetEntry {
  return {
    id,
    kind: "slip_page",
    title: id,
    synthetic: true,
    label: SYNTHETIC_LABEL,
    pipeline: opts.editOf ? "edit" : "direct",
    generator: GENERATOR,
    codexCli: "codex-cli test",
    promptVersion: "p2",
    prompt: { file: `prompts/history/${id}.aaaaaaaa.md`, sha256: SHA_A },
    source: { kind: "provisional", note: "test" },
    ...(opts.editOf ? { editOf: opts.editOf } : {}),
    attempts: [
      {
        n: 1,
        purpose: "accept",
        promptFile: `prompts/history/${id}.aaaaaaaa.md`,
        promptSha256: SHA_A,
        inputImages: [],
        threadId: "t",
        startedAt: "2026-10-22T07:00:00Z",
        durationMs: 1,
        exitCode: 0,
        outcome: "accepted",
        output: { sha256: opts.outputSha ?? "c".repeat(64), width: 1000, height: 1200, bytes: 1 },
        usage: null,
      },
    ],
    master: {
      file: `masters/${id}.jpg`,
      sha256: opts.masterSha ?? SHA_A,
      width: 1000,
      height: 1200,
      bytes: 1,
    },
    display: { file: `slips/${id}.webp`, sha256: SHA_B, width: 1000, height: 1200, bytes: 1 },
    fixture: `fixtures/${id}.json`,
    review: { status: "pending", reviewer: null, at: null, method: null, fieldMatch: null, deviations: [] },
    trials: [],
  };
}
