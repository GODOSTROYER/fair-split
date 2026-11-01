// The rate card's read model (W-TR-02): Schedule A printed from the ratified card, every rule pointing at the
// clause it was read from, and the refusal plate built from a 409 RATE_CARD_RATIFIED.

import { getSnapshot } from "@fairsplit/api-client/seed";
import { describe, expect, it } from "vitest";
import {
  allowedDeductions,
  clauseLines,
  nextSeason,
  refusalText,
  scheduleRules,
  sealedText,
} from "./model.js";

const snapshot = getSnapshot();
const card = snapshot.rateCard;
const printed = { R0: "R0 text", R1: "R1 text", R2: "R2 text", R3: "R3 text", R4: "R4 text" } as const;

describe("Schedule A, printed flat", () => {
  it("prints R0 to R4, then co-sign, holds and the closed list, each with its verbatim quote", () => {
    const rules = scheduleRules(card, printed);
    expect(rules.map((r) => r.ruleId)).toEqual(["R0", "R1", "R2", "R3", "R4", "R5", "R6", "CLOSED"]);
    for (const rule of rules) {
      const page = card.textLayer.pages.find((p) => p.page === rule.page);
      expect(page, rule.id).toBeDefined();
      expect(clauseLines(card.textLayer, rule.quote, rule.page).length, rule.id).toBeGreaterThan(0);
    }
  });

  it("states the hold and co-sign rules from the card's own numbers", () => {
    const rules = scheduleRules(card, printed);
    const holds = rules.find((r) => r.id === "holds")?.text ?? "";
    const cosign = rules.find((r) => r.id === "cosign")?.text ?? "";
    expect(holds).toContain("1.6 kg");
    expect(holds).toContain("±2.0%");
    expect(holds).toContain("0.85");
    expect(cosign).toContain("US$300.00");
    expect(cosign).toContain("US$150.00");
  });

  it("highlights only the clause a rule was read from", () => {
    const r1 = scheduleRules(card, printed).find((r) => r.id === "R1");
    expect(r1).toBeDefined();
    const lines = clauseLines(card.textLayer, r1?.quote ?? "", r1?.page ?? 0);
    expect(lines).toHaveLength(1);
    const text =
      card.textLayer.pages.find((p) => p.page === lines[0]?.page)?.lines[lines[0]?.line ?? -1] ?? "";
    expect(text.startsWith("R1 ")).toBe(true);
  });
});

describe("the bolted plate and the refusal (MM-4)", () => {
  it("names the card's hash in groups of four, its date and its resolution", () => {
    expect(sealedText(card)).toMatch(/^sha256 [0-9a-f]{4} [0-9a-f]{4}, sealed 14 Mar 2026 by BR 2026-04$/);
  });

  it("builds the refusal plate from the 409 body: the closed list, the next season, and the hash it cites", () => {
    const text = refusalText(card, { hash: card.sha256, rateCard: "BR 2026-04", ratifiedOn: "2026-03-14" });
    expect(text).toBe(
      `Closed list. BR 2026-04, Schedule A, allows only CBU, hauling, loans with an Authority to Deduct and advances with a voucher. A new deduction needs a new Board resolution for Season 2026-B. Rate card ${card.sha256.slice(0, 4)} ${card.sha256.slice(4, 8)}.`,
    );
  });

  it("cites whatever hash the server sent, not one the screen knows", () => {
    const other = "0123456789abcdef".repeat(4);
    expect(refusalText(card, { hash: other, rateCard: "BR 2026-04", ratifiedOn: "2026-03-14" })).toMatch(
      /Rate card 0123 4567\.$/,
    );
  });

  it("lists the closed list's deductions in the co-op's words", () => {
    expect(allowedDeductions(card)).toBe(
      "CBU, hauling, loans with an Authority to Deduct and advances with a voucher",
    );
  });

  it("knows the season after this one", () => {
    expect(nextSeason("2026-A")).toBe("2026-B");
    expect(nextSeason("2026-Z")).toBe("2027-A");
  });
});
