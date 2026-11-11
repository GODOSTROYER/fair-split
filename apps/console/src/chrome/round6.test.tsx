// UI gate round 6 (docs/DESIGN.md §11): never a blank page, every width keeps the evidence and the whole disclosure,
// each thing said once, one numeral face, no production wording where a judge reads, and a check result that never
// reads as a payment.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LogRow } from "../data/describe.js";
import {
  APPROVE_TALL_PX,
  SEAL_SIZE,
  SEAL_SIZE_HERO,
  SEAL_SIZE_WIDE,
  sealSizeFor,
} from "../features/approve/parts.js";
import { STATE_COPY, VERIFY_COPY } from "../features/proof/copy.js";
import { READING_COPY } from "../features/reading/copy.js";
import { FIRST_VIEW_COPY, shortBuyer } from "../features/season/copy.js";
import {
  COMPACT_COLUMNS,
  COMPACT_PX,
  columnSetFor,
  MEMBER_PX,
  NET_MAX_PX,
  opensParts,
} from "../features/split/SplitGrid.js";
import { Reconcile } from "../features/split/SplitHeader.js";
import { APPROVE, FANOUT, HOLDS, SPLIT } from "../features/split/shared/copy.js";
import { cascaded, readRules } from "../test/css.js";
import { BOOT_COPY, BootShell } from "./BootShell.js";
import { PROVENANCE, TRY_TO_BREAK, whatsReal } from "./copy.js";
import { toastWords } from "./toast.js";

const stage = readRules("src/theme/stage.css");
const split = readRules("src/features/split/split.css");
const at = (width: number, height = 1080) => ({ width, height, motion: "full" as const });

function el(className: string, attrs: Record<string, string> = {}, parent?: HTMLElement): HTMLElement {
  const node = document.createElement("div");
  node.className = className;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.append(node);
  return node;
}

function row(words: string): LogRow {
  return {
    id: "e1",
    lane: "MACHINE",
    words,
    detail: "",
    at: "2026-11-11T06:54:14Z",
    type: "extract.row",
    provenance: "simulated_rail",
    duplicate: false,
  };
}

describe("never a blank page (round 6)", () => {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

  it("index.html draws a shell inside #root before any script runs: the name, and what it waits for", () => {
    const root = /<div id="root">([\s\S]*?)<\/div>\s*<script type="module"/.exec(html)?.[1] ?? "";
    expect(root).toContain('data-testid="boot"');
    expect(root).toContain(BOOT_COPY.name);
    expect(root).toContain(BOOT_COPY.season);
    expect(root).toContain(BOOT_COPY.proof);
    expect(root).toContain('role="status"');
    // Its few rules are in the page (the stylesheet may not be in yet), and no inline script (fs-api's CSP).
    expect(html).toMatch(/<style>[\s\S]*\.fsc-boot\b[\s\S]*<\/style>/);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  });

  it("the router's pending state is the same shell", () => {
    render(<BootShell />);
    const boot = screen.getByTestId("boot");
    expect(boot.dataset.state).toBe("loading");
    expect(boot.textContent).toContain("Fair Split");
    expect(boot.querySelector('[role="status"]')?.textContent).toContain("Loading season 2026-A");
    expect(readFileSync(resolve(process.cwd(), "src/router.tsx"), "utf8")).toMatch(
      /defaultPendingComponent: BootShell,\s+defaultPendingMs: 0,\s+defaultPendingMinMs: 0,/,
    );
  });
});

describe("every width keeps the whole disclosure and the evidence (round 6)", () => {
  it.each([1024, 1280, 1470, 1920])("the bar's indicator keeps its whole name at %i px", (width) => {
    const rest = el("fsc-bar__tagrest");
    expect(cascaded(stage, rest, "clip-path", at(width))).toBeUndefined();
    expect(cascaded(stage, rest, "position", at(width))).toBeUndefined();
    expect(cascaded(stage, rest, "width", at(width))).toBeUndefined();
  });

  it("the 1,280 laptop keeps the money's evidence in columns; only a narrower grid opens a line's parts", () => {
    const compactFits = 900;
    expect(columnSetFor(910, false, 1100, compactFits)).toBe("compact");
    expect(columnSetFor(1100, false, 1100, compactFits)).toBe("default");
    expect(columnSetFor(880, false, 1100, compactFits)).toBe("narrow");
    expect(columnSetFor(700, false, 1100, compactFits)).toBe("slim");
    expect(columnSetFor(910, true, 1100, compactFits)).toBe("all");
    // Round 7: Bonus waits behind "Columns" so Member keeps a whole name's width (never an ellipsis).
    for (const column of ["member", "kg", "premium", "kaltas", "net", "rail", "status"] as const)
      expect(COMPACT_COLUMNS).toContain(column);
    expect(COMPACT_COLUMNS).not.toContain("slips");
    expect(COMPACT_COLUMNS).not.toContain("bonus");
    expect(opensParts("compact")).toBe(false);
    expect(MEMBER_PX).toBeGreaterThanOrEqual(184);
    expect(COMPACT_PX.net).toBeLessThanOrEqual(NET_MAX_PX);
    expect(NET_MAX_PX).toBeLessThanOrEqual(136);
  });

  it("Approve's seal is the hero on the 1,920 stage, and never crowds a laptop", () => {
    expect(sealSizeFor(1920, 1080)).toBe(SEAL_SIZE_HERO);
    expect(SEAL_SIZE_HERO).toBe(280);
    expect(sealSizeFor(1920, APPROVE_TALL_PX - 1)).toBe(SEAL_SIZE_WIDE);
    expect(sealSizeFor(1470, 956)).toBe(SEAL_SIZE);
    expect(sealSizeFor(1280, 800)).toBe(SEAL_SIZE);
  });

  it("Approve lists who is paid at every width: under the card on a laptop, a row of its own at 1,920", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/approve/approve.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    // Shown by default (no width hides it); only the 1,920 stage lays it out as two columns under the money bar.
    expect(/\.fsr-payees\s*\{[^}]*display:\s*grid;/.test(css)).toBe(true);
    expect(/\.fsr-payees\s*\{[^}]*display:\s*none;/.test(css)).toBe(false);
    expect(css).toMatch(
      /@media \(min-width: 1600px\) and \(min-height: 1000px\) \{[\s\S]*\.fsr-approve > \.fsr-approve__aside \{\s*display: contents;/,
    );
    expect(APPROVE.firstKey).toBe("Your key is the first of two · the Chair signs next");
  });
});

describe("the raised phone at 1,280 (round 6)", () => {
  it("takes no row of its own over the console; a moment's raise still stands beside it", () => {
    const user = el("fsc-stage", { "data-layout": "tab", "data-raised": "user" });
    const raised = el("fsc-dock", { "data-raised": "user" }, user);
    expect(cascaded(stage, raised, "height", at(1280, 800))).toBe("0");
    expect(cascaded(stage, raised, "background", at(1280, 800))).toBe("none");
    const body = el("fsc-stage__body", {}, user);
    expect(cascaded(stage, body, "grid-template-rows", at(1280, 800))).toBe("minmax(0, 1fr) 0");
    expect(cascaded(stage, body, "row-gap", at(1280, 800))).toBe("0");
    const moment = el("fsc-stage", { "data-layout": "tab", "data-raised": "moment" });
    const beside = el("fsc-dock", { "data-raised": "moment" }, moment);
    expect(cascaded(stage, beside, "height", at(1280, 800))).toBe("auto");
    expect(cascaded(stage, beside, "grid-column", at(1280, 800))).toBe("2");
  });
});

describe("each thing once (round 6)", () => {
  it("the bench's one money summary: pool − deductions = member net, the pool in pencil until the keys", () => {
    render(
      <Reconcile
        totals={{ poolCents: 427_350, deductionsCents: 5_865, creditsCents: 0, netCents: 421_485 }}
        poolState="pencil"
      />,
    );
    const pool = screen.getByTestId("W-TR-05.pool");
    expect(pool.textContent).toBe("US$4,273.50");
    expect(pool.dataset.amountState).toBe("pencil");
    expect(screen.getByTestId("W-TR-05.reconcile.net").textContent).toBe("US$4,214.85");
    expect(screen.getByTestId("W-TR-05.reconcile").querySelector(".fs-sr")?.textContent).toBe(
      SPLIT.reconcileSpoken("US$4,273.50", "58.65", null, "US$4,214.85"),
    );
    // Each term is its word over its figure, on the title step in FS Sans (never the mono).
    for (const figure of screen.getByTestId("W-TR-05.reconcile").querySelectorAll(".fsr-recon__figure"))
      expect(figure.classList.contains("fs-t-amount-l")).toBe(true);
  });

  it("a held line's tag is an outline in the decision's colour with ink text: never filled; the dial's mark is ink", () => {
    const status = el("fsr-status", { "data-tone": "canary" });
    const tag = el("fsr-status__hold", {}, status);
    expect(cascaded(split, tag, "background", at(1920))).toBe("transparent");
    expect(cascaded(split, tag, "color", at(1920))).toBe("var(--fs-ink)");
    expect(cascaded(split, tag, "border", at(1920))).toBe("1px solid var(--fs-canary-border)");
    const css = readFileSync(resolve(process.cwd(), "src/features/split/split.css"), "utf8");
    // Round 7: over the limit is an ink outline around a warning glyph and the words, never a round dot.
    expect(/\.fsr-dialstate\[data-status="OUTSIDE"\] \{[^}]*inset 0 0 0 1px var\(--fs-ink\)/.test(css)).toBe(
      true,
    );
  });

  it("a hold's drawer never dims the screen: its scrim is clear in Hayag", () => {
    const css = readFileSync(resolve(process.cwd(), "src/theme/stage.css"), "utf8");
    expect(/:root\[data-theme="adlaw"\] \.fsc-drawer-scrim \{\s*background: transparent;/.test(css)).toBe(
      true,
    );
  });
});

describe("words for a judge (round 6)", () => {
  it("the spent press says whose payment it is, never 'paid by' the treasurer", () => {
    expect(FIRST_VIEW_COPY.recorded("Lantern Bay Chocolate Co.", "Analyn", "18:58")).toBe(
      "Lantern Bay's payment · recorded by Analyn · 18:58",
    );
    expect(FIRST_VIEW_COPY.recorded("Lantern Bay", "Analyn", null)).toBe(
      "Lantern Bay's payment · recorded by Analyn",
    );
    expect(shortBuyer("Lantern Bay Chocolate Co.")).toBe("Lantern Bay");
    expect(shortBuyer("Lantern Bay")).toBe("Lantern Bay");
  });

  it("no production wording on the first view, the reading room or What's real's rows", () => {
    const facts = {
      rail: "simulator" as const,
      recordedOn: "2026-10-29",
      replayPhotos: 12,
      replaySlips: 48,
      earlierPhotos: 54,
      members: 64,
      paypalMembers: 8,
    };
    const sections = whatsReal(facts);
    const visible = [
      FIRST_VIEW_COPY.exhibit,
      PROVENANCE.standIn.text,
      PROVENANCE.seededSlips.text,
      READING_COPY.enterByHand("0462"),
      ...sections.map((s) => `${s.title} ${s.line}`),
      ...TRY_TO_BREAK.attempts,
      TRY_TO_BREAK.armed,
      TRY_TO_BREAK.voided,
      TRY_TO_BREAK.tooLate,
    ].join(" | ");
    expect(visible).not.toMatch(/Codex|hero|stand-in|Arm a payout|key 2|flat/i);
    // A row's line is a label: short, no full stop.
    for (const s of sections) {
      expect(s.line.endsWith(".")).toBe(false);
      expect(s.line.split(/\s+/).length).toBeLessThanOrEqual(8);
    }
    expect(sections.slice(0, 3).map((s) => s.id)).toEqual(["real", "simulated-paypal", "replayed"]);
    expect(FIRST_VIEW_COPY.exhibit).toBe("Claude's readings of 10 slips");
    expect(PROVENANCE.standIn.text).toBe("Synthetic co-op · replayed readings");
    // The pinned honesty phrase stays where assistive technology and a hover read it.
    expect(PROVENANCE.standIn.title).toContain("Seed stand-in, not a Claude recording");
    expect(TRY_TO_BREAK.attempts[3]).toBe("Change a payout after signing");
  });

  it("a slip's reading in the pill carries no member id", () => {
    expect(toastWords(row("Read slip 0428 for M-053"))).toBe("Reading slip 0428");
    expect(toastWords(row("Read slip 0428"))).toBe("Reading slip 0428");
  });

  it("Proof: a check result is never a payment's", () => {
    expect(VERIFY_COPY.result(6, 6)).toBe("6 integrity checks passed");
    expect(VERIFY_COPY.result(5, 6)).toBe("5 of 6 integrity checks passed");
    const p = { confirmed: 7, total: 8, returned: 1, parked: 0 } as Parameters<
      typeof STATE_COPY.liveShort
    >[0];
    expect(STATE_COPY.liveShort(p, true, 57)).toBe("7 confirmed on PayPal · 57 cash due");
    // Before PayPal has finished, and once the cash is handed over, the counts read as before.
    expect(STATE_COPY.liveShort(p, false, 57)).toBe(
      "Waiting · 7 of 8 PayPal payouts confirmed · 1 moved to cash",
    );
    expect(STATE_COPY.liveShort(p, true, 0)).toBe("7 of 8 PayPal payouts confirmed · 1 moved to cash");
  });
});

describe("the film's faults (round 6)", () => {
  it("the pill never takes an event that has nothing to say (no dot without words)", () => {
    const log = readFileSync(resolve(process.cwd(), "src/chrome/EventLog.tsx"), "utf8");
    expect(log).toMatch(/const words = toastWords\(row, event\)\.trim\(\);\s+if \(!words\) return;/);
  });

  it("a settled run read back after a reload never says 'No confirmations yet'", () => {
    expect(FANOUT.latencyUntimed(7)).toBe("7 confirmed · timed only while the run is live");
    const run = readFileSync(resolve(process.cwd(), "src/screens/W-TR-08/index.tsx"), "utf8");
    expect(run).toMatch(/counts\.confirmed > 0 && lat\.dots\.length === 0/);
  });

  it("the cash row's words are whole at every width: 'at the bodega' is the part that steps aside", () => {
    expect(`${FANOUT.cashBandShort(57)}${FANOUT.cashBandWhere}`).toBe(FANOUT.cashBandMembers(57));
  });

  it("a decided hold reads by name and says it is done", () => {
    expect(HOLDS.resolvedBy("Analyn", "18:58")).toBe("Resolved by Analyn · 18:58");
    expect(HOLDS.metaDone(1, 3)).toBe("Hold 1 of 3 · done");
  });

  it("the recorded exhibit shows each paper in colour on a grey ground, never the brown mat", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/reading/reading.css"), "utf8");
    expect(css).toMatch(/\.fsc-heroes__ground \{\s*filter: grayscale\(1\)/);
    expect(css).toMatch(/\.fsc-heroes__paper \{[^}]*clip-path: inset\(/);
  });
});

describe("one numeral face (round 6)", () => {
  it("no figure on the console is set in a condensed cut", () => {
    for (const file of [
      "src/features/judge/judge.css",
      "src/features/byhand/byhand.css",
      "src/features/proof/proof.css",
      "src/features/ratecard/ratecard.css",
      "src/theme/sheets.css",
    ]) {
      const css = readFileSync(resolve(process.cwd(), file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css, file).not.toMatch(/font-stretch:\s*87\.5%/);
    }
  });
});
