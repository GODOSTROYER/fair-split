import { describe, expect, it } from "vitest";
import { buildDemoStatement } from "../services/demo-fixtures";
import { fillSentence, hasDigit, statementSentences, statementValues } from "./statement";

const dto = buildDemoStatement({ stage: "paid", now: "2026-10-30T09:12:00+08:00" });

describe("statement sentences", () => {
  it("renders the hero line in Cebuano exactly as S1.10 reads", () => {
    const { sentences, rejected } = statementSentences(dto, "ceb");
    expect(rejected).toEqual([]);
    expect(sentences.map((s) => s.display)).toEqual([
      "Maayong adlaw, Nang Celing. Salamat sa inyong paghago.",
      "Nagdala mo og 148.0 kg nga uga nga cacao, tanan Grade 1.",
      "Premium gikan sa Lantern Bay: US$43.69, walay kaltas.",
      "Bonus sa kalidad: US$21.85, gikaltasan og US$1.09 para sa CBU (R1, BR 2026-04).",
      "Ang inyong bayad karong season: US$64.45, mga ₱4,028, pinaagi sa PayPal.",
      "Gikan kini sa inyong resibo 0403, 0419, 0436 ug 0467.",
      "Naa moy pangutana? Adto kang Treasurer Analyn sa bodega.",
    ]);
  });

  it("speaks money as words for device speech", () => {
    const { sentences } = statementSentences(dto, "en");
    expect(sentences.find((s) => s.id === "s5")?.spoken).toBe(
      "Your pay this season: sixty-four dollars and forty-five cents, about four thousand twenty-eight pesos, by PayPal.",
    );
  });

  it("names the slips so Paminawa can lift their chips", () => {
    const s6 = statementSentences(dto, "fil").sentences.find((s) => s.id === "s6");
    expect(s6?.mentions).toEqual(["slip:0403", "slip:0419", "slip:0436", "slip:0467"]);
    expect(s6?.display).toBe("Galing po ito sa inyong mga resibo 0403, 0419, 0436 at 0467.");
  });

  it("inv.i1.no-model-numbers: a model sentence with a digit is never shown", () => {
    const values = statementValues(dto, "ceb");
    expect(fillSentence({ id: "x", text: "Ang inyong bayad: 64.45 dolyar." }, values)).toEqual({
      ok: false,
      id: "x",
      reason: "digit-in-template",
    });
    // Non-ASCII digits too.
    expect(hasDigit("bayad ٦٤")).toBe(true);
    expect(hasDigit("bayad {{NET}}")).toBe(false);
  });

  it("inv.i1.placeholders-only: unknown placeholders and stray braces are rejected", () => {
    const values = statementValues(dto, "ceb");
    expect(fillSentence({ id: "y", text: "Bayad: {{AMOUNT}}." }, values)).toMatchObject({
      ok: false,
      reason: "unknown-placeholder",
    });
    expect(fillSentence({ id: "z", text: "Bayad: {{NET}} }}" }, values)).toMatchObject({
      ok: false,
      reason: "stray-braces",
    });
  });

  it("inv.i1.engine-values: every figure in the filled text comes from the DTO, formatted by format.*", () => {
    const { sentences } = statementSentences(dto, "en");
    const text = sentences.map((s) => s.display).join(" ");
    for (const figure of ["US$43.69", "US$21.85", "US$1.09", "US$64.45", "₱4,028", "148.0 kg"]) {
      expect(text).toContain(figure);
    }
  });
});
