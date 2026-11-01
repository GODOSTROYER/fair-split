import { describe, expect, it } from "vitest";
import { jcsSha256 } from "../../_shims/domain";
import { checkLines } from "../../lib/signing";
import { buildDemoCosign } from "../../services/demo-fixtures";
import { type BatchView, digestLines, type LineList } from "./fs-api-view";

const dto = buildDemoCosign({ now: new Date(), treasurerSigned: true });
const source = dto.lines[0];
if (!source) throw new Error("Missing fixture line");
const canonical = {
  ...source.canonical,
  deductions: [{ ruleId: "R3" as const, amountCents: 100, ref: "loan-one", carriedCentavos: null }],
};
const lineSha256 = jcsSha256(canonical);
const line: LineList["lines"][number] = {
  ...canonical,
  id: dto.runId,
  workspaceId: dto.runId,
  runId: dto.runId,
  memberId: dto.runId,
  state: "READY",
  deductions: [{ ruleId: "R3", category: "LOAN", amountCents: 100, ref: "loan-one" }],
  creditsCents: 0,
  trace: [],
  provenance: "seeded",
  lineSha256,
  canonical,
};
const deduction = line.deductions[0];
if (!deduction) throw new Error("Missing deduction fixture");
const batch: BatchView = {
  ...dto,
  runState: "AWAITING_BOARD",
  memberLines: [{ memberNo: line.memberNo, lineSha256 }],
  chairReasons: [],
  blocking: [],
  unpayable: [],
  rail: "simulated",
};
const check = (changed: LineList["lines"][number]) =>
  checkLines(digestLines(batch, { runSlug: dto.runSlug, lines: [changed] }), dto.rateCardSha256);

describe("flat board line amounts", () => {
  it("accepts matching amounts and a deduction despite its display-only category", () => {
    expect(check(line).ok).toBe(true);
  });
  it.each([
    ["missing", []],
    ["extra", [...line.deductions, ...line.deductions]],
    ["amount", [{ ...deduction, amountCents: 101 }]],
    ["rule", [{ ...deduction, ruleId: "R1" }]],
    ["reference", [{ ...deduction, ref: "loan-two" }]],
    ["missing reference", [{ ...deduction, ref: null }]],
  ] as const)("inv.i4.flat-deduction-%s: refuses drift from the canonical preimage", (_name, deductions) => {
    expect(check({ ...line, deductions: [...deductions] }).ok).toBe(false);
  });
});
