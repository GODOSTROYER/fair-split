import { describe, expect, it } from "vitest";
import { figureRuns, figures, isFigure } from "./figures";

const figs = (text: string) =>
  figures(text)
    .filter((s) => s.value)
    .map((s) => s.text);

describe("figures in UI copy (design §2.3: money in the figure face inside prose)", () => {
  it("takes money, the peso estimate and kilos whole, with their units", () => {
    expect(figs("148.0 kg × US$0.29523 kada kilo")).toEqual(["148.0 kg", "US$0.29523"]);
    expect(figs("CBU −US$1.09, mga ₱4,028 (gibanabana)")).toEqual(["−US$1.09", "₱4,028"]);
    expect(figs("Cash sa bodega: ₱7,990.00")).toEqual(["₱7,990.00"]);
    expect(figs("Mass balance 1.62%.")).toEqual(["1.62%"]);
  });

  it("keeps a date in one face, in every language, and never swallows the full stop", () => {
    const ceb = figures("Gisusi pa ang inyong linya. Gilauman nga petsa: 30 Okt 2026.");
    expect(ceb.filter((s) => s.value).map((s) => s.text)).toEqual(["30 Okt 2026"]);
    expect(ceb.at(-1)).toEqual({ text: ".", value: false });
    expect(figs("At the bodega on cash day, 30 Oct 2026.")).toEqual(["30 Oct 2026"]);
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
    for (const text of [
      "Ngano ikaw: ang batch milapas sa US$300.00.",
      "Bakit kayo: lumampas ang batch sa US$300.00.",
      "Why you: the batch is over US$300.00.",
    ]) {
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

  it("splits engine values down to their figures, so a list's words stay in prose", () => {
    const runs = figureRuns([
      { text: "Gikan kini sa inyong resibo ", value: false },
      { text: "0403, 0419, 0436 ug 0467", value: true },
      { text: ".", value: false },
    ]);
    expect(runs.filter(isFigure).map((r) => r.text)).toEqual(["0403", "0419", "0436", "0467"]);
    expect(runs.some((r) => r.text.includes(" ug ") && !r.value)).toBe(true);
    expect(runs.map((r) => r.text).join("")).toBe("Gikan kini sa inyong resibo 0403, 0419, 0436 ug 0467.");
  });
});
