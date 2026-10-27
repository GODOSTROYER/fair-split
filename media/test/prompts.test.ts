import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BR_PAGE_2, SCHEDULE_A, textLayerDocument } from "../src/content/br-2026-04.js";
import { findAsset, SLIP_0462, SPIKE_ASSETS } from "../src/content/spike.js";
import { expectedVisible, renderPrompt, requiredLiterals, washedOutPhrase } from "../src/prompts/render.js";
import { MEDIA_ROOT } from "../src/util/env.js";

describe("Codex prompts (AI-11)", () => {
  it.each(SPIKE_ASSETS.map((a) => [a.id, a] as const))(
    "%s asks for exactly one image_gen call and no files",
    (_id, asset) => {
      const p = renderPrompt(asset);
      expect(p).toMatch(/Call the built-in image_gen tool exactly once/);
      expect(p).toMatch(/do not create, copy or move any files/);
      expect(p).toMatch(/reply with the single word DONE/);
    },
  );

  it.each(SPIKE_ASSETS.map((a) => [a.id, a] as const))(
    "%s quotes every value it needs rendered",
    (_id, asset) => {
      const p = renderPrompt(asset);
      for (const lit of requiredLiterals(asset)) expect(p).toContain(`"${lit}"`);
    },
  );

  it("asks for synthetic, specimen-marked images with no logos or real seals", () => {
    for (const a of SPIKE_ASSETS) {
      const p = renderPrompt(a);
      expect(p).toMatch(/SPECIMEN · SYNTHETIC DEMO (PAD|DOCUMENT|LOGBOOK) · NOT A RECORD|DUPLICATE – OFFICE/);
      expect(p).toMatch(/logos/i);
    }
  });

  it("never quotes a stain's ? pattern (22 Oct: Codex drew a literal ? or a digit for it)", () => {
    const p = renderPrompt(findAsset("spike-0462"));
    expect(p).not.toContain("?");
    expect(p).toContain('in "64.80" the second character, the "4" is washed out');
    expect(p).toMatch(/never draw a question mark/);
    expect(renderPrompt(findAsset("spike-4up"))).not.toContain("?");
  });

  it("describes washed-out characters by position", () => {
    expect(washedOutPhrase("64.80", "6?.80")).toBe('in "64.80" the second character, the "4" is washed out');
    expect(washedOutPhrase("64.80", "??.80")).toBe(
      'in "64.80" the first character, the "6" and the second character, the "4" are washed out',
    );
    expect(() => washedOutPhrase("64.80", "64.80")).toThrow();
    expect(() => washedOutPhrase("64.80", "6?.8")).toThrow();
  });

  it("labels what a stained field visibly shows, and the truth separately", () => {
    const v = expectedVisible(SLIP_0462);
    expect(v.gross_kg).toBe("6?.80");
    expect(v.net_kg).toBe("6?.50");
    expect(v.payable_kg).toBe("64.50");
    expect(SLIP_0462.values.gross_kg).toBe("64.80");
  });

  it("makes the pink copy an edit that keeps every character and changes the footer", () => {
    const p = renderPrompt(findAsset("spike-0457-pink"));
    expect(p).toMatch(/Image 1 \(attached\) is the edit target/);
    expect(p).toContain('"DUPLICATE – OFFICE"');
    expect(p).toContain('"No. 0457"');
    expect(p).toContain('"42.00"');
  });

  it("prints Schedule A verbatim from S4.3 on BR 2026-04 page 2", () => {
    const p = renderPrompt(findAsset("br-2026-04-p2"));
    for (const c of SCHEDULE_A) expect(p).toContain(`"${c.quote}"`);
    expect(SCHEDULE_A.map((c) => c.ruleId)).toEqual(["R0", "R1", "R2", "R3", "R4", "R5", "R6", "CLOSED"]);
    expect(BR_PAGE_2.some((l) => l.text.includes("GUMAPAC"))).toBe(true);
  });

  it("keeps the text layer consistent with the printed pages", () => {
    const doc = textLayerDocument({ status: "unverified", by: null, at: null, notes: [] });
    expect(doc.pages).toHaveLength(2);
    for (const c of doc.clauses) expect(doc.pages[1]?.text).toContain(c.quote);
    expect(doc.pages[0]?.text).toContain("General Assembly");
    expect(doc.pages[0]?.text).toContain("RATIFIED this 14th day of March 2026");
    const committed = JSON.parse(readFileSync(join(MEDIA_ROOT, "docs", "BR-2026-04.text.json"), "utf8"));
    expect(committed.pages).toEqual(JSON.parse(JSON.stringify(doc.pages)));
    expect(committed.clauses).toEqual(JSON.parse(JSON.stringify(doc.clauses)));
  });

  it("logs the prompt each asset was last generated from (media/prompts/{id}.md)", () => {
    for (const a of SPIKE_ASSETS) {
      const logged = readFileSync(join(MEDIA_ROOT, "prompts", `${a.id}.md`), "utf8");
      expect(logged).toBe(renderPrompt(a));
    }
  });
});
