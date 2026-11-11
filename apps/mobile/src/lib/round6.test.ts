// UI gate round 6 on the phone (docs/DESIGN.md §11, film feedback U5): nothing under a hold slab moves while it is
// held (reduced motion's stepped progress has its row reserved), and the Chair's seal card takes the height the sheet
// has left above the pinned slab.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

describe("UI gate round 6 on the phone", () => {
  it("reserves the stepped-progress row while a hold slab can be held, so a hold shifts nothing (film U5)", () => {
    const slab = src("ui/slab.tsx");
    // The slot is in the layout whenever the slab is live under reduced motion, held or not.
    expect(slab).toMatch(
      /\{motion\.reduced && !flush && hs !== "committed" \? \(\s*<View style=\{styles\.steppedSlot\}>/,
    );
    // Its cells and count show only during a hold; the slot's height does not depend on them.
    expect(slab).toMatch(
      /<View style=\{styles\.steppedSlot\}>\s*\{hs === "holding" \|\| hs === "armed" \? \(\s*<View style=\{styles\.stepped\}/,
    );
    expect(slab).toMatch(/steppedSlot: \{ minHeight: 20, marginTop: space\.s8, justifyContent: "center" \}/);
    // The old shape (a row that appears only during the hold, with its own top margin) is gone.
    expect(slab).not.toMatch(/stepped: \{[^}]*marginTop/);
  });

  it("says the member's pay split once: rows with their keys, no bar repeating them above", () => {
    const bar = src("features/statement/receipt-bar.tsx");
    expect(bar).not.toMatch(/BarSegment|styles\.bar\b|receiptBarWeights/);
    expect(bar).toMatch(/function Swatch\(/);
    // The fee row's label is the label role at width 100, never the condensed figure cut.
    expect(bar).toMatch(/<Txt kind="label" color="statementInk2">\s*\{tr\("M-MB-01\.feesShort"/);
    expect(bar).not.toMatch(/<Txt kind="figureS" color="statementInk2">\s*\{tr\("M-MB-01\.feesShort"/);
  });

  it("leads the statement's rate-card row with a lock until a signed batch has a seal to show", () => {
    const bayad = src("features/statement/bayad-screen.tsx");
    expect(bayad).toMatch(
      /\{dto\.batchSha256 && signers \? \(\s*<SealView batchSha256=\{dto\.batchSha256\} size=\{48\} keys=\{2\}/,
    );
    expect(bayad).toMatch(/<Glyph name="lock" size=\{16\} color=\{t\.color\.statementInk2\} \/>/);
  });

  it("opens a slip on an opaque sheet, its sample mark clear of the form's words", () => {
    expect(src("features/statement/slip-zoom.tsx")).toMatch(/\nconst DIM = 1;\n/);
    const paper = src("features/statement/slip-paper.tsx");
    expect(paper).toMatch(
      /mark: \{ position: "absolute", right: space\.s8, bottom: space\.s8, padding: 3 \}/,
    );
  });

  it("has no amber on Hayag: what waits for a person is the person's indigo", () => {
    const tokens = src("_shims/tokens.native.ts");
    const adlaw = tokens.slice(tokens.indexOf("export const adlaw"), tokens.indexOf("export const tablea"));
    expect(adlaw).toMatch(/canary: "#4A2FD6",\s+onCanary: "#FFFFFF",/);
    expect(adlaw).not.toMatch(/#FFA41B/i);
  });

  it("lets the Chair's seal card take the height above the pinned slab, the seal centred in it", () => {
    const sign = src("features/board/sign-screen.tsx");
    const styles = sign.slice(sign.indexOf("const styles = StyleSheet.create({"));
    expect(styles).toMatch(/content: \{[^}]*flexGrow: 1[^}]*\}/);
    expect(styles).toMatch(/moment: \{ gap: space\.s24, flexGrow: 1 \}/);
    expect(styles).toMatch(/plate: \{\s*flexGrow: 1,\s*justifyContent: "center",/);
  });
});
