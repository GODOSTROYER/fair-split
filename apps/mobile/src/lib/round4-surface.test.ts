import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TITLE_WEB, TITLE_WEB_WEIGHTS } from "../_shims/fonts";
import { PUSH_SHOWN_MS } from "../features/board/cosign-model";
import { messages as board } from "../features/board/messages";
import { NAV_FADE_PX } from "../ui/nav-fade";
import { SNAP_SETTLE_MS, snapCoverFrom, snapEdge, viewportRows } from "./row-snap";

const src = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
/** A file's code without its comments (which may name what the code no longer does). */
const code = (path: string) => src(path).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("UI gate round 4 on the phone: whole rows above the bar, measured where they rest", () => {
  it("counts a row that ends inside the bar's fade as cut, and covers it from its top", () => {
    expect(snapEdge(700, NAV_FADE_PX)).toBe(688);
    const rows = [
      { top: 500, bottom: 600 },
      { top: 600, bottom: 694 },
    ];
    // The second row ends at 694, inside the fade (688-700): it is covered from 600.
    expect(snapCoverFrom(rows, 700, NAV_FADE_PX)).toBe(600);
    // Every row ends above the fade: nothing is covered.
    expect(snapCoverFrom([{ top: 500, bottom: 680 }], 700, NAV_FADE_PX)).toBeNull();
  });

  it("covers the fade itself when a row only starts inside it, so no sliver shows", () => {
    expect(snapCoverFrom([{ top: 692, bottom: 760 }], 700, NAV_FADE_PX)).toBe(688);
  });

  it("covers the lowest cut row when rows nest (a section and the row inside it)", () => {
    const section = { top: 400, bottom: 900 };
    const row = { top: 640, bottom: 720 };
    expect(snapCoverFrom([section, row], 700, NAV_FADE_PX)).toBe(640);
  });

  it("reads rows measured in the window against the viewport's top, and drops empty ones", () => {
    expect(
      viewportRows(100, [
        { y: 150, height: 40 },
        { y: 300, height: 0 },
      ]),
    ).toEqual([{ top: 50, bottom: 90 }]);
    expect(SNAP_SETTLE_MS).toBeGreaterThanOrEqual(300);
  });

  it("registers the statement's blocks, its receipt rows and the lists' rows as snap rows", () => {
    expect(src("features/statement/bayad-screen.tsx").match(/<SnapRow/g)?.length).toBeGreaterThanOrEqual(10);
    expect(code("features/statement/receipt-bar.tsx")).toMatch(/useSnapRow\(\)/);
    for (const file of [
      "features/statement/resibo-screen.tsx",
      "features/statement/board-bayad-screen.tsx",
      "features/board/cosign-screen.tsx",
      "features/clerk/capture-row.tsx",
      "features/clerk/cash-plate.tsx",
    ]) {
      expect(code(file), file).toMatch(/<SnapRow/);
    }
  });

  it("brings an opened receipt line up clear of the top fade (the traced peso starts whole)", () => {
    const chrome = code("ui/chrome.tsx");
    // Round 5: 32 px under the top inset, the 24 px fade and 8 more (REVEAL_GAP), never against the inset.
    expect(chrome).toMatch(/reveal\(node, gap = REVEAL_GAP\)/);
    expect(chrome).toMatch(/REVEAL_GAP = layout\.fade \+ space\.s8/);
    expect(chrome).toMatch(/- inset - gap/);
    expect(code("features/statement/receipt-bar.tsx")).toMatch(/scroll\.reveal\(node\.current\)/);
  });
});

describe("UI gate round 4 on the phone: the confirmed status is one row", () => {
  it("puts the time and the Simulated tag on the pill's row", () => {
    const screen = src("features/statement/bayad-screen.tsx");
    const status = screen.slice(screen.indexOf("  status: {"), screen.indexOf("  meta: {"));
    expect(status).toMatch(/flexDirection: "row"/);
    expect(status).toMatch(/flexWrap: "wrap"/);
    // "05:20 · Simulated": the time keeps its own test hook; the dot is drawn apart, hidden from screen readers.
    expect(screen).toMatch(/testID="M-MB-01\.when">\n\s+\{when\}/);
    expect(screen).toMatch(/aria-hidden>\n\s+·/);
  });
});

describe("UI gate round 4 on the phone: receipt chips are data everywhere", () => {
  it("draws the traced line's slips as inline receipt chips, never as paper", () => {
    const bar = code("features/statement/receipt-bar.tsx");
    expect(bar).toMatch(/<ReceiptChip\s+key=\{slip\.serial\}\s+inline/);
    expect(bar).not.toMatch(/copyWhite|slipChipPaper/);
    expect(code("ui/receipt-chip.tsx")).toMatch(/inline \? styles\.inline : styles\.chip/);
  });

  it("prints the serial alone on a tile, as the console's chip does", () => {
    expect(code("features/statement/slip-tiles.tsx")).toMatch(/<ReceiptChip serial=\{s\.serial\}/);
  });
});

describe("UI gate round 4 on the phone: titles at 600 like the console's", () => {
  it("loads the console's own variable FS Sans in the web frames with its whole weight range", () => {
    const sources = src("_shims/font-sources.web.ts");
    expect(sources).toMatch(
      /\[TITLE_WEB\]: \{\n\s+uri: require\("\.\.\/\.\.\/\.\.\/\.\.\/assets\/fonts\/web\/FSSans-VF\.woff2"\)/,
    );
    expect(TITLE_WEB_WEIGHTS).toBe("200 900");
    expect(TITLE_WEB).toBe("FSSans-Title");
    expect(src("../metro.config.js")).toMatch(/assets\/fonts\/web/);
  });

  it("sets titles, headings and button labels at 600 on the web, initials at 700", () => {
    const theme = code("theme/theme.tsx");
    expect(theme).toMatch(/web: \{ fontFamily: TITLE_WEB, fontWeight: "600" \}/);
    expect(theme).toMatch(/web: \{ fontFamily: TITLE_WEB, fontWeight: "700" \}/);
    expect(theme).toMatch(/const TITLE: TextStyle = \{\n\s+\.\.\.STRONG/);
    expect(theme).toMatch(/const HEADING: TextStyle = \{\n\s+\.\.\.STRONG/);
  });
});

describe("UI gate round 4 on the phone: the Chair's co-sign card ends above its button", () => {
  it("keeps the seal, its short hash and what to do with it in the card; the phone's workings follow it", () => {
    const screen = code("features/board/cosign-screen.tsx");
    const plate = screen.slice(
      screen.indexOf('testID="M-BD-01.seal-plate"'),
      screen.indexOf("styles.worked"),
    );
    expect(plate).toMatch(/layout\.cosignSeal|sealSize/);
    expect(plate).toMatch(/<ShortHash hex=\{ownHash\} testID="M-BD-01\.hash" \/>/);
    expect(code("features/board/parts.tsx")).toMatch(/dataSet=\{\{ hash: hex \}\}/);
    expect(plate).not.toMatch(/M-BD-01\.computed|M-BD-01\.lines/);
    expect(screen).toMatch(/testID="M-BD-01\.computed"/);
    expect(screen).toMatch(/testID="M-BD-01\.lines"/);
  });

  it("folds the simulated push away like a heads-up notification", () => {
    expect(PUSH_SHOWN_MS).toBeGreaterThanOrEqual(3000);
    expect(PUSH_SHOWN_MS).toBeLessThanOrEqual(6000);
  });

  it("says the season as 2026-A in one line, and the push in one line", () => {
    for (const lang of ["ceb", "fil", "en"] as const) {
      expect(board["M-BD-01.heading"][lang]).not.toMatch(/Season/);
      expect(board["M-BD-01.push.title"][lang]).not.toMatch(/\{n\}/);
    }
  });
});

describe("UI gate round 4 on the phone: one way to sign, its caption under it", () => {
  it("puts 'Hold to sign' under the slab, with no full stop", () => {
    expect(code("features/board/sign-screen.tsx")).toMatch(/below=\{\n\s+blocked \? undefined/);
    expect(code("ui/slab.tsx")).toMatch(/\{p\.below && !flush \? p\.below : null\}/);
    for (const lang of ["ceb", "fil", "en"] as const) {
      expect(board["M-BD-02.caption.demo"][lang]).not.toMatch(/\.$/);
    }
  });
});
