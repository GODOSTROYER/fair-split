import { describe, expect, it } from "vitest";
import { translate } from "../_shims/i18n";
import { buildDemoStatement } from "../services/demo-fixtures";
import { figureRuns, figures, isFigure } from "./figures";
import { statementSentences } from "./statement";

const figs = (text: string) =>
  figures(text)
    .filter((s) => s.value)
    .map((s) => s.text);

describe("figures in UI copy (design §2.3: money in the figure face inside prose)", () => {
  it("takes money, the peso estimate and kilos whole, with their units", () => {
    expect(figs("148.0 kg × US$0.29523 kada kilo")).toEqual(["148.0 kg", "US$0.29523"]);
    expect(figs("CBU −US$1.09, mga ₱4,028 (gibanabana)")).toEqual(["−US$1.09", "₱4,028"]);
    expect(figs("Mass balance 1.62%.")).toEqual(["1.62%"]);
  });

  it("keeps a date in one face, in every language, and never swallows the full stop", () => {
    const ceb = figures(translate("ceb", "M-MB-01.checkingDetail", { date: "30 Okt 2026" }));
    expect(ceb.filter((s) => s.value).map((s) => s.text)).toEqual(["30 Okt 2026"]);
    expect(ceb.at(-1)).toEqual({ text: ".", value: false });
    expect(figs(translate("en", "M-MB-04.when", { date: "30 Oct 2026" }))).toEqual(["30 Oct 2026"]);
    expect(figs("Bayad na, 22 Okt")).toEqual(["22 Okt"]);
  });

  it("does not read the Filipino word 'May' as a month without a day before it", () => {
    expect(figs("May tanong po kayo? Lumapit po kay Treasurer Analyn sa bodega.")).toEqual([]);
    expect(figs("Natanggap noong 2 May 2026.")).toEqual(["2 May 2026"]);
  });

  it("keeps codes and IDs together: seasons, rate cards, members, rules and times", () => {
    expect(figs("Season 2026-A, rule R1, BR 2026-04")).toEqual(["2026-A", "R1", "2026-04"]);
    expect(figs("M-014 and hold H3")).toEqual(["M-014", "H3"]);
    expect(figs("Napadala na sa 09:12.")).toEqual(["09:12"]);
    expect(figs("4 ka linya nabasa, resibo 0403")).toEqual(["4", "0403"]);
  });

  it("reproduces the text exactly when the segments are joined", () => {
    for (const lang of ["ceb", "fil", "en"] as const) {
      const text = translate(lang, "M-BD-01.why", { threshold: "US$300.00" });
      expect(
        figures(text)
          .map((s) => s.text)
          .join(""),
      ).toBe(text);
      expect(figs(text)).toEqual(["US$300.00"]);
    }
  });

  it("sets only segments that carry a digit in the figure face", () => {
    expect(isFigure({ text: "Lantern Bay", value: true })).toBe(false);
    expect(isFigure({ text: "US$43.69", value: true })).toBe(true);
    expect(isFigure({ text: "2026", value: false })).toBe(false);
  });
});

describe("figures inside statement sentences", () => {
  const dto = buildDemoStatement({ stage: "paid", now: "2026-10-30T10:24:00+08:00" });
  const sentence = (lang: "ceb" | "fil" | "en", id: string) =>
    statementSentences(dto, lang).sentences.find((s) => s.id === id);

  it("changes face only for the figures inside an engine value, never for its words", () => {
    const s6 = sentence("ceb", "s6");
    const runs = figureRuns(s6?.segments ?? []);
    expect(runs.filter(isFigure).map((r) => r.text)).toEqual(["0403", "0419", "0436", "0467"]);
    expect(runs.some((r) => r.text.includes(" ug ") && !r.value)).toBe(true);
    expect(runs.map((r) => r.text).join("")).toBe(s6?.display);
  });

  it("keeps names and the payer in prose and sets every amount in the figure face", () => {
    const s1 = figureRuns(sentence("ceb", "s1")?.segments ?? []);
    expect(s1.filter(isFigure)).toEqual([]);
    const s5 = figureRuns(sentence("en", "s5")?.segments ?? []);
    expect(s5.filter(isFigure).map((r) => r.text)).toEqual(["US$64.45", "₱4,028"]);
  });
});
