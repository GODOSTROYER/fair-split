import { describe, expect, it } from "vitest";
import { catalogProblems } from "../../_shims/i18n";
import { messages, pluralKey, t } from "./messages";

const keys = Object.keys(messages);

describe("clerk copy", () => {
  it("is complete in Cebuano, Filipino and English, with the same placeholders in each", () => {
    expect(catalogProblems(messages)).toEqual([]);
  });

  it("gives every counted phrase both forms, and picks English's by count", () => {
    for (const k of keys.filter((k) => k.endsWith(".one"))) {
      expect(keys).toContain(`${k.slice(0, -".one".length)}.other`);
    }
    expect(t("en", pluralKey("M-CL-01.offline", 1), { n: 1 })).toBe("No signal. 1 slip saved on this phone.");
    expect(t("en", pluralKey("M-CL-01.offline", 3), { n: 3 })).toBe(
      "No signal. 3 slips saved on this phone.",
    );
    expect(t("en", pluralKey("M-CL-02.read", 0), { n: 0 })).toBe("0 rows read");
    // Cebuano nouns do not inflect: "3 ka resibo".
    expect(t("ceb", pluralKey("M-CL-01.offline", 3), { n: 3 })).toBe(
      "Walay signal. 3 ka resibo natipigan sa telepono.",
    );
  });

  it("keeps the design's own words for the clerk's states (design K1, S1.9)", () => {
    expect(t("ceb", "M-CL-01.quality")).toBe("Ngitngit kaayo. I-scan pag-usab.");
    expect(t("ceb", "M-CL-02.retryIn", { s: 40 })).toBe("Mosulay pag-usab sa 40 s");
    expect(t("ceb", "M-CL-02.sendNow")).toBe("Ipadala karon");
    expect(t("en", "M-CL-01.duplicate", { time: "09:12" })).toBe("Already sent at 09:12.");
    expect(t("ceb", "M-CL-01.station")).toBe("Purok 2 pickup");
  });

  it("never says error, fraud, or anything red to the clerk (S1.11 word list)", () => {
    for (const entry of Object.values(messages)) {
      for (const text of Object.values(entry)) {
        expect(text).not.toMatch(/\b(error|fraud|failed|failure|instant|certified)\b/i);
        expect(text).not.toMatch(/!/);
      }
    }
  });
});
