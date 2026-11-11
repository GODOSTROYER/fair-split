// UI gate round 7 (docs/DESIGN.md §12): nothing covers or cuts a key number (a drawer takes its room from the screen
// at every width and is a full-height sheet; below 1440 px the phone never opens on its own and never dims the page);
// the 1,280 laptop keeps a whole name and the holds' evidence; the parked payout's action names whose payment it is;
// one id line; supporting text that carries meaning is ink-2.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FAN } from "../features/fanout/model.js";
import { RATECARD_COPY } from "../features/ratecard/copy.js";
import { COMPACT_COLUMNS, COMPACT_PX, MEMBER_PX, minWidthOf } from "../features/split/SplitGrid.js";
import { FANOUT } from "../features/split/shared/copy.js";
import { runLabel } from "../lib/display.js";
import { phoneSizeFor, stageLayoutFor } from "../stage/layout.js";
import { PHONE_RAIL, TRY_TO_BREAK } from "./copy.js";

const css = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("nothing covers or cuts a key number (round 7)", () => {
  const stage = css("src/theme/stage.css");

  it("a drawer takes its 560 px from the screen from 1,280 px up, the 1,920 stage included", () => {
    expect(stage).toMatch(
      /\.fsc-console__body:has\(\.fsc-drawer:is\(\[data-mode="push"\], \[data-mode="overlay"\]\)\) > \.fsc-console__screen \{\s*right: var\(--fs-console-drawer\);/,
    );
  });

  it("every drawer is a full-height sheet: a hugging state no longer ends above the panel's foot", () => {
    expect(stage).not.toMatch(/\.fsc-drawer\[data-hug\] \{[^}]*bottom: auto/);
    expect(stage).toMatch(/\.fsc-drawer\[data-hug\] > \.fsc-drawer__foot \{[^}]*margin-top: 0;/);
  });

  it("the opened phone below 1,440 px never dims the page and says how to leave it", () => {
    expect(stage).toMatch(/\.fsc-dock__backdrop \{[^}]*background: transparent;/);
    expect(stage).not.toMatch(/\.fsc-dock__backdrop \{[^}]*var\(--fs-scrim\)/);
    expect(PHONE_RAIL.close).toBe("Close");
  });

  it("the opened sheet spends the laptop's height on the statement (a 600 px screen at 1,280 x 800)", () => {
    expect(phoneSizeFor(stageLayoutFor(1280), 800)).toEqual({ width: 360, height: 600 });
    expect(phoneSizeFor(stageLayoutFor(1280), 2000).height).toBe(720);
  });
});

describe("the 1,280 laptop keeps names and evidence (round 7)", () => {
  it("Member keeps a whole name's width; Bonus waits behind Columns; the set fits 910 px with a credit", () => {
    expect(COMPACT_COLUMNS).not.toContain("bonus");
    expect(COMPACT_COLUMNS).toContain("credit");
    const floors =
      MEMBER_PX +
      COMPACT_PX.kg +
      COMPACT_PX.premium +
      COMPACT_PX.deductions +
      COMPACT_PX.credit +
      COMPACT_PX.net +
      COMPACT_PX.rail +
      COMPACT_PX.status;
    // minWidthOf([]) is the grid's own chrome (its borders and the overlay scrollbar's margin).
    expect(floors + minWidthOf([])).toBeLessThanOrEqual(910);
  });

  it("the settled hero binds the cash's day to the cash count: each qualifier sits under its own word", () => {
    const fan = css("src/features/fanout/fanout.css");
    expect(fan).toMatch(/\.fsr-fanout__keys \{[^}]*display: inline-grid;/);
    expect(fan).toMatch(/\.fsr-fanout__part \{[^}]*white-space: nowrap;/);
  });
});

describe("the Run with a parked payout (round 7)", () => {
  it("the primary says whose payment it acts on", () => {
    expect(FANOUT.payCash("Rhea")).toBe("Pay Rhea in cash at the bodega");
  });

  it("the parked reason is short enough for her own row", () => {
    expect(FANOUT.rheaLine).toBe("No PayPal account");
    expect(FANOUT.returns).toBe("returns in 30 days");
  });

  it("the seal stands 30 units higher and the cash row leaves room for a parked row's second line", () => {
    expect(FAN.seal.cy).toBe(270);
    expect(FAN.seal.cy - FAN.seal.size / 2).toBe(180);
    expect(FAN.bar.y0).toBeLessThan(FAN.band.y0);
    expect(FAN.band.y0 + FAN.band.h).toBeLessThanOrEqual(FAN.bar.y1);
    expect(FAN.cash.y0 - (FAN.stub.y0 + FAN.stub.step * 7)).toBeGreaterThanOrEqual(56);
    expect(FAN.cash.y0).toBeLessThan(FAN.height);
  });
});

describe("one id line, readable supporting text (round 7)", () => {
  it("the id line's run id is the run alone: the title's suffix says the season", () => {
    expect(runLabel("2026A-r37").run).toBe("r37");
    expect(runLabel("2026A-r37").season).toBe("2026-A");
  });

  it("the id line and a member's id are ink-2, never ink-3", () => {
    const grid = css("src/theme/grid.css");
    expect(grid).toMatch(/\.fsc-screen__meta \{[^}]*color: var\(--fs-ink-2\);/);
    const split = css("src/features/split/split.css");
    expect(split).toMatch(/\.fsr-member__meta \{[^}]*color: var\(--fs-ink-2\);[^}]*font-size: 0\.8125rem;/);
  });

  it("over the limit is its own mark (an ink outline and a warning glyph), never a round dot", () => {
    const split = css("src/features/split/split.css");
    expect(split).toMatch(/\.fsr-dialstate\[data-status="OUTSIDE"\] \{[^}]*inset 0 0 0 1px var\(--fs-ink\)/);
    expect(split).not.toMatch(/\.fsr-dialstate\[data-status="OUTSIDE"\]::before/);
  });
});

describe("the rate card after a refusal, and What's real (round 7)", () => {
  it("the refused attempt stays readable and says what became of it", () => {
    expect(RATECARD_COPY.notAdded("BR 2026-04")).toBe("Not added · locked by BR 2026-04");
    const rc = css("src/features/ratecard/ratecard.css");
    expect(rc).not.toMatch(/\.fsc-rc__refused-row > s/);
  });

  it("the last attack's condition no longer contradicts its name", () => {
    expect(TRY_TO_BREAK.tooLate).toBe("After key 1, before the Chair");
  });
});
