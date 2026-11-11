// UI gate round 5 on the phone's surfaces (docs/DESIGN.md §10): the member's whole pay in the first viewport, one
// language a line, one marker vocabulary (8 px dots, the one 8 px legend square, hatch only for cash), provenance
// once (no inline legend glyphs), receipts once in one chip shape, the traced peso's equation on one line, and no
// line that ends on an orphan word.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { messages as board } from "../features/board/messages";
import { messages as statement } from "../features/statement/messages";
import { voiceWords } from "./display";

const src = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
/** A file's code without its comments (which may name what the code no longer does). */
const code = (path: string) => src(path).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const LANGS = ["ceb", "fil", "en"] as const;

describe("round 5: the voice in one short line, the provider in its spoken label", () => {
  it("drops the provider in brackets and breaks a mixed reading between its two voices", () => {
    expect(voiceWords("Sintetikong tingog (Gemini TTS)")).toBe("Sintetikong tingog");
    expect(voiceWords("Sintetikong tingog (Gemini TTS) ug tingog sa telepono")).toBe(
      "Sintetikong tingog\nug tingog sa telepono",
    );
    expect(voiceWords("Tingog sa telepono. Ang sintetikong tingog moabot pa.")).toBe(
      "Tingog sa telepono. Ang sintetikong tingog moabot pa.",
    );
  });

  it("shows the short words on the statement and in Paminawa, and keeps the whole label for assistive technology", () => {
    const bayad = code("features/statement/bayad-screen.tsx");
    expect(bayad).toMatch(/voiceWords\(voiceLabel\)/);
    expect(bayad).toMatch(/srLabel=\{`\$\{tr\("M-MB-01\.paminawaHint"\)\}\. \$\{voiceLabel \?\? ""\}`\}/);
    const panel = code("features/statement/paminawa-panel.tsx");
    expect(panel).toMatch(/\{voiceWords\(label\)\}/);
    expect(panel).toMatch(/<Hidden>\{label\}<\/Hidden>/);
    expect(panel).not.toMatch(/MarkShape/);
  });
});

describe("round 5: the member's whole pay in the first viewport", () => {
  it("says her number and the season only under her name", () => {
    expect(statement["M-MB-01.headMeta"].ceb).toBe("{no} · {season}");
    expect(code("features/statement/bayad-screen.tsx")).not.toMatch(/"M-MB-01\.headMeta", \{[^}]*coop/);
  });

  it("puts the peso estimate and her kilos on one line, and Paminawa in a 48 dp row", () => {
    expect(code("features/statement/bayad-screen.tsx")).toMatch(
      /style=\{peso \? styles\.facts : styles\.amount\}/,
    );
    const listen = code("features/statement/listen-button.tsx");
    expect(listen).toMatch(/width: target\.min,\s+height: target\.min/);
    expect(listen).toMatch(/minHeight: target\.min/);
  });
});

describe("round 5: one marker vocabulary on the phone", () => {
  it("leads history rows with an 8 px round dot, never a square or initials in the margin", () => {
    const parts = code("features/statement/parts.tsx");
    const mark = parts.slice(parts.indexOf("export function HistoryMark"));
    expect(mark).not.toMatch(/InkStamp|Hatch|square/);
    expect(parts).toMatch(/dot: \{ width: 8, height: 8, borderRadius: 4, borderWidth: 1 \}/);
    expect(code("features/statement/bayad-screen.tsx")).toMatch(/historyRow: \{[^}]*gap: space\.s8/);
  });

  it("never hatches a deduction (hatch is cash): its segment and its 8 px key are an outline", () => {
    const bar = code("features/statement/receipt-bar.tsx");
    expect(bar).not.toMatch(/<Hatch/);
    expect(bar).toMatch(/case "deducted":\s+return \{ fill: t\.color\.plate, edge: t\.color\.ink2 \}/);
    expect(bar).toMatch(/swatch: \{ width: 8, height: 8/);
  });
});

describe("round 5: provenance once, no ids for people", () => {
  it("draws no inline legend glyph on the statement, the slips, the push or the clerk's paper", () => {
    for (const file of [
      "features/statement/receipt-bar.tsx",
      "features/statement/resibo-screen.tsx",
      "features/statement/paminawa-panel.tsx",
      "features/board/parts.tsx",
      "features/clerk/paper.tsx",
    ]) {
      expect(code(file), file).not.toMatch(/<LegendGlyph|<MarkShape/);
    }
  });

  it("reads a deduction by its words; the rule's id is only in the row's spoken label", () => {
    const bar = code("features/statement/receipt-bar.tsx");
    expect(bar).not.toMatch(/RuleChip/);
    expect(bar).toMatch(/srLabel=\{`\$\{r\.label \?\? ""\}, \$\{r\.spoken\}, \$\{r\.ruleId \?\? ""\}/);
  });

  it("shows no key id on the signed line; the id is spoken and behind the demo key's mark", () => {
    for (const lang of LANGS) expect(board["M-BD-02.signedShort"][lang]).not.toMatch(/\{key\}/);
    const sign = code("features/board/sign-screen.tsx");
    expect(sign).toMatch(/tr\("M-BD-02\.signedShort"\)/);
    expect(sign).toMatch(
      /accessibilityLabel=\{tr\("M-BD-02\.signed", \{ key: key\?\.keyId \?\? nextKeyId \}\)\}/,
    );
  });
});

describe("round 5: one language a line on the Chair's phone", () => {
  it("puts the demo key's English note behind its mark at the caption's end, opened by a tap", () => {
    const sign = code("features/board/sign-screen.tsx");
    expect(sign).toMatch(/<KeyNote line=\{demoKey \? keyLine : null\} testID="M-BD-02\.key">/);
    expect(sign).toMatch(/\{line && open \? \(/);
    expect(sign).not.toMatch(/<Txt kind="hash" color="ink2" selectable>\s*\{key\.keyId\}/);
  });

  it("drops the English lines under why him, the treasurer's presence and each hold's kind", () => {
    expect(code("features/board/cosign-screen.tsx")).not.toMatch(/M-BD-01\.why\.gloss/);
    const parts = code("features/board/parts.tsx");
    const presence = parts.slice(parts.indexOf("export function PresenceLine"));
    expect(presence).not.toMatch(/<Gloss/);
    const hold = parts.slice(
      parts.indexOf("export function HoldRow"),
      parts.indexOf("export function PayoutRows"),
    );
    expect(hold).not.toMatch(/<Gloss/);
  });
});

describe("round 5: receipts once, the equation on one line, no orphan words", () => {
  it("keeps one receipt-chip shape, and steps her slip row aside while an opened line shows them", () => {
    expect(code("ui/receipt-chip.tsx")).not.toMatch(/inline/);
    const bayad = code("features/statement/bayad-screen.tsx");
    expect(bayad).toMatch(/!\(open\?\.state === "expanded" && listsSlips\(open\.id\)\)/);
  });

  it("sets the equation as one line that scales down to fit, never wrapping", () => {
    const bar = code("features/statement/receipt-bar.tsx");
    const eq = bar.slice(bar.indexOf("function Equation"), bar.indexOf("export function listsSlips"));
    expect(eq).toMatch(/numberOfLines=\{1\}/);
    expect(eq).toMatch(/natural > room \? room \/ natural : 1/);
  });

  it("says the seal's signers and the rate card in lines short enough for one line each", () => {
    for (const lang of LANGS) {
      expect(statement["M-MB-01.sealCaption"][lang].length).toBeLessThanOrEqual(26);
      expect(statement["M-MB-01.rateCardBoard"][lang].length).toBeLessThanOrEqual(30);
    }
    const bayad = code("features/statement/bayad-screen.tsx");
    expect(bayad).toMatch(/historyDay \? `\$\{tr\("M-MB-01\.history"\)\} · \$\{historyDay\}`/);
  });
});
