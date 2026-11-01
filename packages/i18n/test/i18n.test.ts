import { readFileSync } from "node:fs";
import { IntlMessageFormat } from "intl-messageformat";
import { describe, expect, it } from "vitest";
import {
  CATALOGS,
  consoleStatusWord,
  createI18n,
  LANGS,
  LINE_STATES,
  MACHINE_TRANSLATED_LABEL,
  MEMBER_KEYS,
  type MessageKey,
  needsReviewChip,
  pluralCategory,
  reviewEntries,
  statusWord,
  translate,
} from "../src/index.js";
import { REVIEW_DOC, renderReviewDoc } from "../src/review-doc.js";

/** Argument names used by an ICU message, found by walking its AST. */
function argumentsOf(message: string, locale: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: readonly unknown[]) => {
    for (const node of nodes as { value?: unknown; options?: Record<string, { value: unknown[] }> }[]) {
      if (typeof node.value === "string" && "type" in node && (node as { type: number }).type !== 0) {
        names.add(node.value);
      }
      if (node.options) for (const opt of Object.values(node.options)) walk(opt.value);
    }
  };
  walk(new IntlMessageFormat(message, locale).getAst());
  return [...names].sort();
}

describe("catalogs", () => {
  it("every Cebuano and Filipino key exists in English", () => {
    for (const lang of ["ceb", "fil"] as const) {
      for (const key of Object.keys(CATALOGS[lang]))
        expect(CATALOGS.en, `${lang} ${key}`).toHaveProperty([key]);
    }
  });

  it("member surfaces have every key in all three languages", () => {
    expect(MEMBER_KEYS.length).toBeGreaterThan(40);
    for (const key of MEMBER_KEYS) {
      for (const lang of LANGS) expect(CATALOGS[lang][key], `${lang} ${key}`).toBeTruthy();
    }
  });

  it.each(LANGS)("%s: every message parses as ICU", (lang) => {
    for (const [key, message] of Object.entries(CATALOGS[lang])) {
      expect(() => new IntlMessageFormat(message ?? "", lang === "ceb" ? "fil" : lang), key).not.toThrow();
    }
  });

  it("translations use exactly the English arguments", () => {
    for (const lang of ["ceb", "fil"] as const) {
      for (const [key, message] of Object.entries(CATALOGS[lang])) {
        const english = CATALOGS.en[key as MessageKey];
        expect(argumentsOf(message ?? "", "fil"), `${lang} ${key}`).toEqual(argumentsOf(english, "en"));
      }
    }
  });

  it("member copy holds no figures: every digit arrives as an argument", () => {
    for (const lang of LANGS) {
      for (const key of MEMBER_KEYS) expect(CATALOGS[lang][key], `${lang} ${key}`).not.toMatch(/\d/);
    }
  });

  it("no message carries a money or kilo literal: every amount arrives as an argument (S5 lint)", () => {
    const literal = /(?:₱|\$)\s?\d|\d\s?(?:kg|PHP|USD)\b/i;
    for (const lang of LANGS) {
      for (const [key, message] of Object.entries(CATALOGS[lang])) {
        expect(message, `${lang} ${key}`).not.toMatch(literal);
      }
    }
  });

  it("rate-card rules print the ratified card's terms from arguments", () => {
    for (const rule of ["R0", "R1", "R2", "R3", "R4"] as const) {
      expect(CATALOGS.en[`W-TR-02.${rule}`], rule).not.toMatch(/\d/);
    }
    expect(translate("en", "W-TR-02.R1", { share: 5, cap: "₱5,000" })).toBe(
      "CBU: 5% of the bonus until ₱5,000 is paid up.",
    );
    expect(translate("en", "W-TR-02.R2", { rate: "₱1.50" })).toBe("Hauling: ₱1.50 a kg for purok pickups.");
    expect(translate("en", "W-TR-02.R3", { share: 50 })).toBe(
      "Loan: only with a signed Authority to Deduct, up to 50% of the bonus.",
    );
    expect(translate("en", "W-TR-02.R4", { share: 30 })).toBe(
      "Advance: only with a voucher, up to 30% of the bonus.",
    );
  });

  it("the hold slab speaks the Chair's language on his phone (S1 M-BD-02)", () => {
    const phoneWords = [
      "slab.release",
      "slab.nothingSigned",
      "slab.holdUntilClick",
      "slab.altRoute",
      "slab.progress",
      "confirm.cancel",
    ] as const;
    for (const key of phoneWords) {
      expect(MEMBER_KEYS).toContain(key);
      for (const lang of LANGS) expect(CATALOGS[lang][key], `${lang} ${key}`).toBeTruthy();
    }
    expect(translate("ceb", "slab.altRoute")).toBe("Dili makakupti? Pirmahi sa laing paagi");
    expect(translate("ceb", "slab.nothingSigned")).toBe("Walay napirmahan.");
    expect(translate("en", "slab.release")).toBe("Release to sign");
    expect(translate("en", "slab.nothingSigned")).toBe("Nothing was signed.");
  });

  it("names the simulated rail (ADR-0002) and never calls it live or verified", () => {
    for (const key of [
      "W-JG-01.notice.simulator",
      "W-PF-01.heroMarked.simulator",
      "W-PF-01.footer.simulator",
    ] as const) {
      expect(CATALOGS.en[key], key).toMatch(/simulated PayPal sandbox/);
      expect(CATALOGS.en[key], key).not.toMatch(/\blive\b|\bverified\b|real PayPal/i);
    }
  });

  it("says simulated wherever it names the sandbox or PayPal confirming, and moves no real money (E-19)", () => {
    for (const key of [
      "money.sandbox",
      "confirm.body",
      "run.SETTLING",
      "W-JG-01.markPaid",
      "W-JG-01.pill.markPaid",
      "W-JG-01.pill.confirming",
      "W-JG-01.state.queued",
      "W-TR-01.invoice.drafted",
      "W-TR-07.fees",
    ] as const) {
      expect(CATALOGS.en[key], key).toMatch(/simulated/i);
    }
    expect(CATALOGS.en["confirm.body"]).toMatch(/No real money moves/);
    expect(CATALOGS.en["confirm.body"]).not.toMatch(/This moves money/);
    // The PP_MODE=sandbox variants never claim a real sandbox run: that path is untested (ADR-0002).
    for (const key of ["W-JG-01.notice", "W-PF-01.heroMarked", "W-PF-01.footer.sandbox"] as const) {
      expect(CATALOGS.en[key], key).toMatch(/not yet tested/);
      expect(CATALOGS.en[key], key).not.toMatch(/real PayPal|recorded Claude run/i);
    }
  });

  it("gives the seed's recordedOn to no run: the reading pill replays a labelled seed stand-in (E-19)", () => {
    const pill = CATALOGS.en["W-JG-01.pill.reading"];
    expect(pill).toMatch(/labelled seed stand-in/);
    expect(pill).not.toMatch(/\{date\}|replay of the .*\brun\b|recorded/i);
  });

  it("names the PayPal webhook's signature as the simulator's (ADR-0002, E-19)", () => {
    const label = CATALOGS.en["provenance.paypal"];
    expect(label).toMatch(/\bSimulated PayPal sandbox\b/);
    expect(label).toMatch(/\bsimulator-signed\b/);
    expect(label).toMatch(/\bsignature verified\b/);
  });

  it("never says error, fraud or certified, and never shouts", () => {
    for (const lang of LANGS) {
      for (const [key, message] of Object.entries(CATALOGS[lang])) {
        expect(message, `${lang} ${key}`).not.toMatch(/\berror\b|\bfraud\b|\bcertified\b|!|→/i);
      }
    }
  });
});

describe("status words (register §7)", () => {
  it("keeps the register's fixed words", () => {
    expect(statusWord("HELD", "ceb")).toBe("Gisusi pa");
    expect(statusWord("HELD", "fil")).toBe("Sinusuri pa po");
    expect(statusWord("HELD", "en")).toBe("Still checking");
    expect(statusWord("PAYPAL_PENDING", "ceb")).toBe("Gipadala na, naghulat sa PayPal");
    expect(statusWord("PAID", "ceb")).toBe("Bayad na");
    expect(statusWord("OFF_RAIL_DUE", "ceb")).toBe("Andam sa bodega");
    expect(statusWord("OFF_RAIL_PAID", "ceb")).toBe("Nadawat");
    expect(statusWord("UNCLAIMED", "ceb")).toBe("Wala madawat sa PayPal");
    expect(consoleStatusWord("UNCLAIMED")).toBe("Parked");
  });

  it("has a word for every line state in every language, and never the raw state name", () => {
    for (const state of LINE_STATES) {
      for (const lang of LANGS) {
        const word = statusWord(state, lang);
        expect(word.length).toBeGreaterThan(2);
        expect(word).not.toContain(state);
      }
      expect(consoleStatusWord(state)).not.toContain("_");
    }
  });

  it("a hold is never red or an error: UNCLAIMED reads as parked, not failed", () => {
    expect(consoleStatusWord("UNCLAIMED")).not.toMatch(/fail/i);
    expect(statusWord("HELD", "en")).not.toMatch(/error|fail/i);
  });
});

describe("formatting", () => {
  it("formats the statement greeting in each language", () => {
    expect(translate("ceb", "M-MB-01.greeting", { name: "Nang Celing" })).toBe(
      "Maayong adlaw, Nang Celing. Salamat sa inyong paghago.",
    );
    expect(translate("fil", "M-MB-01.greeting", { name: "Gng. Bacus" })).toBe(
      "Magandang araw po, Gng. Bacus. Salamat po sa inyong pagsisikap.",
    );
    expect(translate("en", "M-MB-01.greeting", { name: "Nang Celing" })).toBe(
      "Good day, Nang Celing. Thank you for your hard work.",
    );
  });

  it("labels every peso figure as an estimate", () => {
    expect(translate("ceb", "money.estimate", { php: "₱4,028" })).toBe("mga ₱4,028 (gibanabana)");
    expect(translate("fil", "money.estimate", { php: "₱4,028" })).toBe("humigit-kumulang ₱4,028 (tantiya)");
    expect(translate("en", "money.estimate", { php: "₱4,028" })).toBe("about ₱4,028 (estimate)");
  });

  it("pluralises English counts with ICU", () => {
    expect(translate("en", "W-TR-05.summary", { holds: 3, byHand: 1 })).toBe("3 holds, 1 by hand");
    expect(translate("en", "W-TR-05.summary", { holds: 1, byHand: 0 })).toBe("1 hold, 0 by hand");
    expect(translate("en", "W-TR-07.approve", { count: 8 })).toBe("Approve 8 payouts");
  });

  it("falls back to English for console keys asked in Cebuano", () => {
    expect(translate("ceb", "W-TR-07.waiting")).toBe("Waiting for Ernesto");
  });

  it("inserts figures as given, never reformatting them", () => {
    const line = translate("en", "W-TR-06.H1.engine", {
      slip: "0457",
      photoA: "B",
      photoB: "D",
      amount: "US$17.94",
      members: 63,
      name: "Nong Dioning",
      shrink: "2.05%",
      limit: "2.0%",
    });
    expect(line).toBe(
      "Slip 0457 is in two photos: the white original (B) and the pink duplicate (D). Counting both moves US$17.94 from 63 members to Nong Dioning and puts shrink at 2.05%, over the 2.0% limit.",
    );
  });

  it("builds an independent synchronous instance per language", () => {
    const i18n = createI18n("fil");
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.t("status.PAID")).toBe("Bayad na po");
  });
});

describe("plural rules", () => {
  it("matches CLDR (Intl.PluralRules) for Filipino, which Cebuano shares", () => {
    const rules = new Intl.PluralRules("fil");
    for (let n = 0; n <= 200; n++) expect(pluralCategory("ceb", n), String(n)).toBe(rules.select(n));
    for (const s of ["1.5", "2.4", "0.06", "3.19"]) {
      expect(pluralCategory("fil", s), s).toBe(rules.select(Number(s)));
    }
  });

  it("matches CLDR for English", () => {
    const rules = new Intl.PluralRules("en");
    for (let n = 0; n <= 50; n++) expect(pluralCategory("en", n)).toBe(rules.select(n));
    expect(pluralCategory("en", "1.0")).toBe("other");
  });
});

describe("native review (OD-2)", () => {
  it("marks every Cebuano and Filipino string as pending native review", () => {
    const entries = reviewEntries();
    expect(entries.length).toBe(Object.keys(CATALOGS.ceb).length + Object.keys(CATALOGS.fil).length);
    for (const e of entries) expect(e.status).toBe("pending-native-review");
    expect(needsReviewChip("ceb")).toBe(true);
    expect(needsReviewChip("fil")).toBe(true);
    expect(needsReviewChip("en")).toBe(false);
    expect(MACHINE_TRANSLATED_LABEL).toBe("Machine-translated, pending native review");
  });

  it("REVIEW.md lists every string and is fresh (run the review script if this fails)", () => {
    expect(readFileSync(REVIEW_DOC, "utf8")).toBe(renderReviewDoc());
  });
});
