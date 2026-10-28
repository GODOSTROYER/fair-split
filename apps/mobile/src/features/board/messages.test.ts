import { describe, expect, it } from "vitest";
import type { HoldKind } from "../../_shims/contracts";
import { catalogProblems } from "../../_shims/i18n";
import { messages } from "./messages";

const HOLD_KINDS: readonly HoldKind[] = [
  "DUPLICATE_SLIP",
  "IMPLAUSIBLE_YIELD",
  "NO_RULE",
  "RATE_MISMATCH",
  "SUSPECTED_INJECTION",
  "LOW_CONFIDENCE",
  "MASS_BALANCE",
];

describe("board copy", () => {
  it("is complete in Cebuano, Filipino and English, with the same placeholders in each", () => {
    expect(catalogProblems(messages)).toEqual([]);
  });

  it("names every hold kind in the Chair's words, never a raw state name", () => {
    const catalog = messages as Readonly<Record<string, { en: string }>>;
    for (const kind of HOLD_KINDS) {
      const entry = catalog[`hold.${kind}`];
      expect(entry, kind).toBeDefined();
      expect(entry?.en).not.toContain("_");
    }
  });

  it("keeps S1.9's Cebuano lines word for word", () => {
    expect(messages["M-BD-01.changed"].ceb).toBe(
      "Nausab ang batch human nimo giablihan. Walay napirmahan. Susiha pag-usab.",
    );
    expect(messages["M-BD-01.offline"].ceb).toBe(
      "Kinahanglan og signal aron makapirma. Dili kini ipadala sa ulahi.",
    );
    expect(messages["M-BD-02.caption.biometric"].ceb).toBe("Kupti, dayon gamita ang inyong fingerprint.");
    expect(messages["M-BD-02.another"].ceb).toBe("Dili makakupti? Pirmahi sa laing paagi");
    expect(messages["M-BD-02.mismatch"].ceb).toBe("Lahi ang batch hash. Walay napirmahan.");
    expect(messages["M-BD-02.signed"].ceb).toBe("Napirmahan. Key {key}. Parehas ang batch hash sa console.");
    expect(messages["M-BD-01.none"].ceb).toBe("Walay pirmahan karon.");
    expect(messages["M-BD-01.presence"].ceb).toBe("Naa si {name} sa approval screen.");
  });

  it("never says error or fraud, and never shouts (S1.11)", () => {
    for (const [key, entry] of Object.entries(messages)) {
      for (const text of Object.values(entry)) {
        expect(text, key).not.toMatch(/\berror\b|\bfraud\b|!/i);
      }
    }
  });
});
