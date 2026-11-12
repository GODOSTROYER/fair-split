// UI gate round 3's shared pieces on the stage: one truth for counts and ids (display helpers, the Proof counter
// on Proof's six checks), the toast and Log that replace the ribbon, and the one focus ring (a screen's first
// pre-focus wears none until a key).

import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { applyRunEvents, firstView, sessionView } from "../data/run-view.js";
import { invoiceLabel, payCell, runLabel, seasonLabel, slipCounts, stageInvoice } from "../lib/display.js";
import { PROOF_CHECKS, proofChecksFor, recordProofChecks } from "../lib/proof-checks.js";
import { prefocusQuietly } from "../stage/context.js";
import { renderConsole } from "../test/render.js";
import { clickStageMenuItem } from "../test/stage-menu.js";
import { createTestWorld, seedSnapshot } from "../test/world.js";
import { TOAST_MS } from "./copy.js";

const snapshot = seedSnapshot();

describe("one truth for counts and ids (display helpers)", () => {
  it("says the season as 2026-A everywhere in display text; run slugs stay data", () => {
    expect(seasonLabel("2026A")).toBe("2026-A");
    expect(seasonLabel("2026-A")).toBe("2026-A");
    expect(runLabel("2026A-r37")).toEqual({ season: "2026-A", run: "r37", text: "2026-A · r37" });
    expect(runLabel("not-a-slug").text).toBe("not-a-slug");
  });

  it("labels the first view's invoice as the showcase run's; a session shows its own id alone", () => {
    expect(invoiceLabel("FS-2026A-r37", "showcase")).toEqual({
      number: "FS-2026A-r37",
      note: "showcase run",
      spoken: "Invoice FS-2026A-r37, the showcase run's",
    });
    expect(stageInvoice(snapshot, undefined, false)?.note).toBe("showcase run");
    const world = createTestWorld();
    world.markPaid();
    const view = applyRunEvents(sessionView(snapshot, world), world.eventsAfter(null));
    const session = stageInvoice(snapshot, view, true);
    expect(session?.note).toBeNull();
    expect(session?.number).toBe(view.invoice.number);
  });

  it("says which slip count is which: this run's 48 and the season's 264", () => {
    expect(slipCounts(snapshot)).toEqual({ run: 48, season: 264, text: "48 this run · 264 season" });
  });

  it("plans 8 · 56 until the run settles, then says 7 PayPal · 57 cash (every figure the snapshot's)", () => {
    expect(payCell(snapshot, firstView(snapshot))).toMatchObject({
      phase: "planned",
      text: "8 · 56 planned",
    });
    const world = createTestWorld();
    world.markPaid();
    world.enterByHand("64.80");
    world.resolveAll();
    world.sign("treasurer");
    world.cosign();
    world.payCash("M-031");
    const settled = applyRunEvents(sessionView(snapshot, world), world.eventsAfter(null));
    expect(payCell(snapshot, settled)).toMatchObject({ phase: "settled", text: "7 PayPal · 57 cash" });
  });
});

describe("the Proof counter counts Proof's six checks", () => {
  it("reads 0/6 until this browser has checked, then what matched; per run, kept for the tab", () => {
    expect(proofChecksFor("2026A-r1")).toEqual({ matched: 0, total: PROOF_CHECKS, checked: false });
    recordProofChecks("2026A-r1", 6);
    expect(proofChecksFor("2026A-r1")).toEqual({ matched: 6, total: 6, checked: true });
    expect(window.sessionStorage.getItem("fs.proofChecks.2026A-r1")).toBe("6");
    expect(proofChecksFor("2026A-r2").matched).toBe(0);
  });

  it("the top bar shows Proof 0/6 in a session and 6/6 once Proof's checks matched", async () => {
    const view = await renderConsole({ path: "/judge" });
    const session = await view.startSession();
    const chip = screen.getByTestId("W-JG-01.proofChip");
    expect(chip.textContent).toContain("Proof: 0 of 6 checks match");
    expect(chip.textContent).toContain("0/6");
    act(() => recordProofChecks(session.runSlug, 6));
    await waitFor(() => expect(chip.textContent).toContain("6/6"));
    expect(chip.dataset.complete).toBe("");
  });
});

describe("the toast and the Log replace the ribbon", () => {
  it("toasts each live event once, for 3 s, and keeps it in the Log", async () => {
    expect(TOAST_MS).toBe(3000);
    const view = await renderConsole({ path: "/judge" });
    await view.startSession();
    act(() => {
      view.world.markPaid();
    });
    const toast = await screen.findByTestId("W-JG-01.toast");
    expect(toast.dataset.state).toBe("in");
    // Round 5: the toast is the Next pill's own words for 3 s, hidden from assistive technology (the pill's name stays
    // "Next: …"; the run's own announcements speak). Then it leaves the pill.
    expect(toast.getAttribute("aria-hidden")).toBe("true");
    await waitFor(() => expect(screen.queryByTestId("W-JG-01.toast")).toBeNull(), {
      timeout: TOAST_MS + 2000,
    });
    // Round 4: the run log opens from the chevron's menu.
    await clickStageMenuItem("W-JG-01.logOpen");
    expect((await screen.findByTestId("W-JG-01.log.rows")).children.length).toBeGreaterThan(0);
  });
});

describe("one focus ring", () => {
  it("a screen's first pre-focus carries no ring until the viewer presses a key", () => {
    const button = document.createElement("button");
    document.body.append(button);
    prefocusQuietly(button);
    expect(document.activeElement).toBe(button);
    expect(button.dataset.prefocused).toBe("");
    fireEvent.keyDown(window, { key: "Tab" });
    expect(button.dataset.prefocused).toBeUndefined();
    button.remove();
  });
});
