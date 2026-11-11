// UI gate round 7 on the phone (docs/DESIGN.md §12): the member's statement says the rail's whole name beside her
// paid status ("Simulated PayPal sandbox", the console bar's wording), on one line under the pill in every state; no
// ghost text shows under the status inset; the folded fees row is named; the Chair's seal uses spare height.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { messages } from "../features/statement/messages";
import { MICRO_WORD } from "./honesty";

const src = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

describe("UI gate round 7 on the phone", () => {
  it("draws the tag's whole label where a screen is read on its own; the accessible name is unchanged", () => {
    const honesty = src("ui/honesty.tsx");
    expect(honesty).toMatch(/full\?: boolean;/);
    expect(honesty).toMatch(/\{full \? label : word\}/);
    // The label stays the accessible name and the hidden text, whatever is drawn.
    expect(honesty).toMatch(/accessibilityLabel=\{label\}/);
    expect(honesty).toMatch(/<Hidden>\{label\}<\/Hidden>/);
    expect(MICRO_WORD).toBe("Simulated");
    // The member's statement and the Chair's sign screen say it in full; a replayed rail keeps its one word.
    expect(src("features/statement/bayad-screen.tsx")).toMatch(/full=\{railLabel\.kind === "simulated"\}/);
    expect(src("features/board/sign-screen.tsx")).toMatch(
      /<MicroTag\s+testID="M-BD-02\.rail"\s+full\s+label=/,
    );
  });

  it("clips a line scrolled under the status inset: the fade's first two thirds are plain surface", () => {
    const chrome = src("ui/chrome.tsx");
    expect(chrome).toMatch(/const solid = Math\.round\(\(layout\.fade \* 2\) \/ 3\);/);
    expect(chrome).toMatch(/height: inset \+ solid, backgroundColor: color/);
    expect(chrome).toMatch(/topFadeBands\(soft\)/);
  });

  it("names the folded fees row in each language, its two rates under the name", () => {
    expect(messages["M-MB-01.feesLabel"]).toEqual({
      ceb: "Bayad sa padala",
      fil: "Bayad sa padala",
      en: "Transfer fees",
    });
    const bar = src("features/statement/receipt-bar.tsx");
    expect(bar).toMatch(/<Txt kind="label">\{tr\("M-MB-01\.feesLabel"\)\}<\/Txt>/);
  });

  it("the Chair's seal takes spare height only on a tall, quiet request, and never under 140", () => {
    const cosign = src("features/board/cosign-screen.tsx");
    expect(cosign).toMatch(/const roomy = dto\.holds\.length === 0 && !compact;/);
    expect(cosign).toMatch(/Math\.max\(layout\.cosignSeal, Math\.min\(190, height - 590\)\)/);
  });
});
