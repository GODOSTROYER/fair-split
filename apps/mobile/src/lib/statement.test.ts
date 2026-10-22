import { describe, expect, it } from "vitest";
import { buildDemoStatement } from "../services/demo-fixtures";
import { figureRuns, isFigure } from "../ui/figures";
import {
  applicableTemplates,
  fillSentence,
  hasDigit,
  statementSentences,
  statementValues,
} from "./statement";

const dto = buildDemoStatement({ stage: "paid", now: "2026-10-30T09:12:00+08:00" });

describe("statement sentences", () => {
  it("renders the hero line in Cebuano, one sentence per slot, PayPal variant", () => {
    const { sentences, rejected } = statementSentences(dto, "ceb");
    expect(rejected).toEqual([]);
    expect(sentences.map((s) => s.slot)).toEqual([
      "GREETING",
      "DELIVERY",
      "PREMIUM",
      "BONUS",
      "DEDUCTION",
      "PAY",
      "SOURCES",
      "HELP",
      "AI_NOTE",
    ]);
    expect(sentences.map((s) => s.display)).toEqual([
      "Maayong adlaw, Nang Celing. Salamat sa inyong paghago.",
      "Nagdala mo og 148.0 kg nga uga nga cacao, tanan Grade 1.",
      "Premium gikan sa Lantern Bay: US$43.69, walay kaltas.",
      "Bonus sa kalidad: US$21.85.",
      "Gikaltasan og US$1.09 para sa CBU (R1, BR 2026-04).",
      "Ang inyong bayad karong season: US$64.45, sa inyong PayPal. Kung ilisan sa peso, mga ₱4,028.",
      "Gikan kini sa inyong resibo 0403, 0419, 0436 ug 0467.",
      "Naa moy pangutana? Adto kang Treasurer Analyn sa bodega.",
      "Ang inyong mga resibo gibasa sa makaduha sa AI (Claude). Ang mga pagbasa nga dili sigurado gisusi sa usa ka tawo, ug si Treasurer Analyn ang miaprobar niini nga bayad.",
    ]);
  });

  it("speaks money as words for device speech", () => {
    const { sentences } = statementSentences(dto, "en");
    expect(sentences.find((s) => s.slot === "PAY")?.spoken).toBe(
      "Your pay this season: sixty-four dollars and forty-five cents, to your PayPal. Changed to pesos, about four thousand twenty-eight pesos.",
    );
  });

  it("names the slips so Paminawa can lift their chips", () => {
    const sources = statementSentences(dto, "fil").sentences.find((s) => s.slot === "SOURCES");
    expect(sources?.mentions).toEqual(["slip:0403", "slip:0419", "slip:0436", "slip:0467"]);
    expect(sources?.display).toBe("Galing po ito sa inyong mga resibo 0403, 0419, 0436 at 0467.");
  });

  it("reads the cash variant, exact pesos at the run's rate, once the line moves to the bodega", () => {
    const cash = buildDemoStatement({ stage: "cash-due", now: "2026-10-30T09:12:00+08:00" });
    const pay = statementSentences(cash, "en").sentences.find((s) => s.slot === "PAY");
    expect(pay?.display).toBe("Your pay this season: ₱4,028.13, in cash at the bodega on 30 Oct 2026.");
    expect(applicableTemplates(cash, "en", "cash").filter((s) => s.slot === "PAY")).toHaveLength(1);
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
    expect(hasDigit("bayad {{NET_USD}}")).toBe(false);
  });

  it("inv.i1.placeholders-only: unknown placeholders and stray braces are rejected", () => {
    const values = statementValues(dto, "ceb");
    expect(fillSentence({ id: "y", text: "Bayad: {{AMOUNT}}." }, values)).toMatchObject({
      ok: false,
      reason: "unknown-placeholder",
    });
    expect(fillSentence({ id: "z", text: "Bayad: {{NET_USD}} }}" }, values)).toMatchObject({
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

describe("statement segments", () => {
  it("splits words from engine values so money can be set in the figure face", () => {
    const premium = statementSentences(dto, "en").sentences.find((s) => s.slot === "PREMIUM");
    expect(premium?.segments).toEqual([
      { text: "Premium from ", value: false },
      { text: "Lantern Bay", value: true },
      { text: ": ", value: false },
      { text: "US$43.69", value: true },
      { text: ", with no deductions.", value: false },
    ]);
    expect(premium?.segments.map((x) => x.text).join("")).toBe(premium?.display);
  });

  it("changes face only for the figures inside an engine value, never for its words", () => {
    const sources = statementSentences(dto, "ceb").sentences.find((s) => s.slot === "SOURCES");
    const runs = figureRuns(sources?.segments ?? []);
    expect(runs.filter(isFigure).map((r) => r.text)).toEqual(["0403", "0419", "0436", "0467"]);
    expect(runs.some((r) => r.text.includes(" ug ") && !r.value)).toBe(true);
    expect(runs.map((r) => r.text).join("")).toBe(sources?.display);
  });

  it("keeps names and the payer in prose and sets every amount in the figure face", () => {
    const sentence = (lang: "ceb" | "en", slot: string) =>
      statementSentences(dto, lang).sentences.find((s) => s.slot === slot);
    expect(figureRuns(sentence("ceb", "GREETING")?.segments ?? []).filter(isFigure)).toEqual([]);
    const pay = figureRuns(sentence("en", "PAY")?.segments ?? []);
    expect(pay.filter(isFigure).map((r) => r.text)).toEqual(["US$64.45", "₱4,028"]);
  });
});
