// UI gate round 5's shared pieces on the phone: every label at width 100 (the console's 520 label cut, never the
// condensed one), a revealed block clear of the 24 px top fade, every footer's last line 24 px above the bezel, no
// corner glyphs inside the stage's frames (the marks keep their hooks and words), deduction chips without ids, and
// the alternate link in each language saying "Other ways to sign".

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fontFamily, LABEL_WEB, TITLE_WEB } from "../_shims/fonts";
import { layout } from "../_shims/tokens.native";
import { messages } from "../features/board/messages";

const src = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

/** A `const NAME ... = { ... };` block of a source file, by its name. */
function block(file: string, name: string): string {
  const code = src(file);
  const at = code.indexOf(`const ${name}`);
  expect(at, name).toBeGreaterThanOrEqual(0);
  return code.slice(at, code.indexOf("};", at) + 2);
}

describe("UI gate round 5 on the phone: one language, one width", () => {
  it("sets labels at width 100 and 520 in the web frames, never in the condensed figure cut", () => {
    expect(LABEL_WEB).toBe(TITLE_WEB);
    const face = block("theme/theme.tsx", "LABEL_FACE");
    expect(face).toMatch(/web: \{ fontFamily: LABEL_WEB, fontWeight: "520"/);
    expect(face).toMatch(/default: \{ fontFamily: fontFamily\.ui \}/);
    expect(face).not.toMatch(/fontFamily\.figure/);
    const label = block("theme/theme.tsx", "LABEL:");
    expect(label).toMatch(/\.\.\.LABEL_FACE/);
    expect(label).not.toMatch(/fontFamily\.figure/);
  });

  it("keeps the figure cut for numerals only (the console's `figure` role)", () => {
    const theme = src("theme/theme.tsx");
    expect(theme).toMatch(/figure: FIGURE,/);
    expect(theme).toMatch(/figureS: FIGURE,/);
    expect(theme).toMatch(/label: LABEL,/);
    expect(fontFamily.figure).toBe("FSSans-SemiCondMedium");
  });
});

describe("UI gate round 5 on the phone: nothing clipped", () => {
  it("reveals a block 32 px under the top inset, clear of the 24 px fade", () => {
    const chrome = src("ui/chrome.tsx");
    expect(layout.fade).toBe(24);
    expect(chrome).toMatch(/export const REVEAL_GAP = layout\.fade \+ space\.s8;/);
    expect(chrome).toMatch(/reveal\(node, gap = REVEAL_GAP\)/);
  });

  it("ends every footer's last line 24 px above the bezel", () => {
    expect(layout.end).toBe(24);
    expect(src("ui/chrome.tsx")).toMatch(/return insets\.bottom \+ layout\.end;/);
    expect(src("features/board/sign-screen.tsx")).toMatch(/paddingBottom: compact \? 0 : footerEnd,/);
    expect(src("features/board/cosign-screen.tsx")).toMatch(/paddingBottom: footerEnd \}/);
    expect(src("features/onboarding/parts.tsx")).toMatch(/paddingBottom: footerEnd,/);
  });
});

describe("UI gate round 5 on the phone: provenance once, no ids for people", () => {
  it("draws no corner glyphs inside the stage's frames; the marks keep their hooks and words", () => {
    const primitives = src("ui/primitives.tsx");
    expect(primitives).toMatch(
      /return inFrame \? <QuietMarks marks=\{marks\} \/> : <MarkRow marks=\{marks\} \/>;/,
    );
    const honesty = src("ui/honesty.tsx");
    const quiet = honesty.slice(honesty.indexOf("export function QuietMarks"));
    expect(quiet).toMatch(/testID=\{m\.testID\}/);
    expect(quiet).toMatch(/accessibilityLabel=\{m\.label\}/);
    expect(quiet).not.toMatch(/MarkShape/);
  });

  it("a rule chip reads its words; the rule's id is only in its accessible name", () => {
    const primitives = src("ui/primitives.tsx");
    const chip = primitives.slice(primitives.indexOf("export function RuleChip"));
    const body = chip.slice(0, chip.indexOf("\n}\n"));
    expect(body).toMatch(/accessibilityLabel=\{ruleId \? `\$\{label\}, rule \$\{ruleId\}` : label\}/);
    expect(body).not.toMatch(/\{ruleId\}\s*<\/Txt>/);
  });

  it("the alternate link says 'Other ways to sign' in each language", () => {
    expect(messages["M-BD-02.another"]).toEqual({
      ceb: "Ubang paagi sa pagpirma",
      fil: "Ibang paraan ng pagpirma",
      en: "Other ways to sign",
    });
  });
});
