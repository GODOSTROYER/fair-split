// W-PF-01 Proof against the mock world: every figure from the served bundle, member IDs only, "Verify in your
// browser" re-checking six plates on a person's press, MM-7 traced in full and reduced motion, and every state:
// loading, error, none (and a judge's run not posted yet), progress while PayPal confirms, verified, failed.

import { webRoutes } from "@fairsplit/contracts";
import { getSnapshot } from "@fairsplit/seed";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VerifyPanel } from "../../features/proof/Hero.js";
import { proofState } from "../../features/proof/ProofView.js";
import type { Verification } from "../../features/proof/useVerification.js";
import type { VerifyOutcome } from "../../features/proof/verify.js";
import { createTestWorld, expectNoAxeViolations, renderConsole, tracedPhases } from "../../test/index.js";

const RUN = "2026A-r37";
const snapshot = getSnapshot();

async function openProof(options: Parameters<typeof renderConsole>[0] = {}) {
  const view = await renderConsole({ path: webRoutes.proof(RUN), ...options });
  const root = await screen.findByTestId("W-PF-01");
  await waitFor(() => expect(root.dataset.state).not.toBe("loading"));
  return { view, root };
}

function press(testId: string) {
  fireEvent.keyDown(screen.getByTestId(`${testId}.face`), { key: "Enter" });
}

function openPlate(plate: string) {
  fireEvent.click(screen.getByTestId(`W-PF-01.plate.${plate}.toggle`));
}

describe("W-PF-01 Proof: the season's settled run", () => {
  it("prints every metric from the served bundle and reads verified once PayPal has finished", async () => {
    const { view, root } = await openProof();
    expect(root.dataset.state).toBe("verified");
    expect(document.documentElement.dataset.theme).toBe("adlaw");
    expect(screen.getByTestId("W-PF-01.invoice-amount").textContent).toBe("US$4,333.50");
    expect(screen.getByTestId("W-PF-01.invoice-amount").dataset.amountState).toBe("landed");
    expect(screen.getByTestId("W-PF-01.lot").textContent).toBe(snapshot.lot.lotCode);
    expect(screen.getByTestId("W-PF-01.metric.explained").textContent).toContain("64 of 64");
    expect(screen.getByTestId("W-PF-01.tier.paypal").textContent).toContain("7 members");
    expect(screen.getByTestId("W-PF-01.tier.paypal.amount").textContent).toBe("US$341.74");
    expect(screen.getByTestId("W-PF-01.tier.paypal.amount").dataset.amountState).toBe("landed");
    expect(screen.getByTestId("W-PF-01.tier.attested").textContent).toContain("0 of 57");
    expect(screen.getByTestId("W-PF-01.tier.due.amount").textContent).toBe("US$3,876.43");
    expect(screen.getByTestId("W-PF-01.tier.due.amount").dataset.amountState).toBe("hollow");
    expect(screen.getByTestId("W-PF-01.metric.kept").textContent).toContain("US$21.14");
    expect(screen.getByTestId("W-PF-01.metric.holds").textContent).toContain("3 caught");
    expect(screen.getByTestId("W-PF-01.metric.onPaypal").textContent).toBe("7 of 64 members, 8.1% of value");
    expect(screen.getByTestId("W-PF-01.plate.payoutItems.fact").textContent).toBe(
      "7 of 8 confirmed by PayPal, 1 returned to the co-op and paid in cash.",
    );
    expect(screen.getByTestId("W-PF-01.progress").dataset.state).toBe("settled");
    // Nothing PayPal is unlabelled (I8): the simulated rail is named on the page.
    expect(screen.getByTestId("W-PF-01.rail").textContent).toContain("Simulated PayPal sandbox");
    await expectNoAxeViolations(view.container);
  });

  it("shows member IDs only, never a name or a receiver (C-23)", async () => {
    await openProof();
    openPlate("computed");
    openPlate("payoutItems");
    await screen.findByTestId("W-PF-01.lines");
    const text = document.body.textContent ?? "";
    expect(text).toContain("M-014");
    for (const m of snapshot.members.filter((x) => x.named)) {
      expect(text).not.toContain(m.displayName);
      if (m.receiverAlias) expect(text).not.toContain(m.receiverAlias);
    }
    expect(screen.getByTestId("W-PF-01.items").querySelectorAll("tbody tr")).toHaveLength(8);
  });

  it("re-checks six plates in this browser on a press and reads Sample, never Verified", async () => {
    const { view, root } = await openProof();
    expect(root.querySelector("[data-verify]")?.getAttribute("data-verify")).toBe("idle");
    for (const row of within(screen.getByTestId("W-PF-01.checks")).getAllByRole("listitem")) {
      expect(row.dataset.state).toBe("idle");
    }
    press("W-PF-01.verify");
    await waitFor(() => expect(screen.getByTestId("W-PF-01.verdict").dataset.state).toBe("sample"), {
      timeout: 10_000,
    });
    for (const row of within(screen.getByTestId("W-PF-01.checks")).getAllByRole("listitem")) {
      expect(row.dataset.state).toBe("matches");
    }
    expect(screen.getByTestId("W-PF-01.verdict.word").textContent).toBe("Sample");
    expect(screen.getByTestId("W-PF-01.verdict.sample").textContent).toContain("fs-analyn-s1");
    // The mock publishes no keys document, so the seed's published sample keys stand in, and the page says so.
    expect(screen.getByTestId("W-PF-01.verdict.trust").dataset.trust).toBe("seed");
    expect(root.querySelector("[data-verify]")?.getAttribute("data-verify")).toBe("sample");
    expect(screen.getByTestId("W-PF-01.plate.twoKeys").dataset.state).toBe("matches");
    expect(document.querySelector('[data-verdict="verified"]')).toBeNull();
    await expectNoAxeViolations(view.container);
  });

  it("reads the batch seal as its hash in Data mode", async () => {
    await openProof();
    fireEvent.keyDown(window, { key: "D" });
    await waitFor(() => expect(document.documentElement.hasAttribute("data-datamode")).toBe(true));
    const table = screen.getByTestId("W-PF-01.seal.table");
    expect(table.textContent).toContain(snapshot.proof.batch.batchSha256.slice(0, 4));
    expect(screen.getByTestId("W-PF-01.tierbar.table")).toBeTruthy();
    expect(screen.getByTestId("W-TR-10.datamode")).toBeTruthy();
  });
});

describe("W-PF-01 MM-7, tap a peso", () => {
  it.each(["full", "reduced"] as const)("traces a line to its slip and back (%s motion)", async (motion) => {
    const { view } = await openProof({ motion });
    openPlate("computed");
    const lines = await screen.findByTestId("W-PF-01.lines");
    expect(lines.dataset.moment).toBe("MM-7");
    expect(lines.dataset.momentPhase).toBe("rest");

    fireEvent.click(screen.getByTestId("W-PF-01.peso.M-014"));
    await waitFor(() => expect(lines.dataset.momentPhase).toBe("expanded"), { timeout: 3000 });
    expect(screen.getByTestId("W-PF-01.trace.state").dataset.trace).toBe("line");
    const receipt = screen.getByTestId("W-PF-01.trace.receipt");
    expect(receipt.textContent).toContain("US$43.69");
    expect(receipt.textContent).toContain("148.0 kg of the co-op's 9,780.6 kg verified kilos");
    expect(receipt.textContent).toContain("US$64.45");
    // Proof never prints a per-kg pool rate (S1.10).
    expect(receipt.textContent).not.toContain("a kg");

    fireEvent.click(screen.getByTestId("W-PF-01.trace.slip.0403"));
    await waitFor(() => expect(lines.dataset.momentPhase).toBe("tiled"), { timeout: 3000 });
    expect(screen.getByTestId("W-PF-01.trace.paper").textContent).toContain("Synthetic sample");
    fireEvent.click(screen.getByTestId("W-PF-01.trace.zoom-in"));
    await expectNoAxeViolations(view.container);

    fireEvent.click(screen.getByTestId("W-PF-01.trace.back"));
    await waitFor(() => expect(screen.getByTestId("W-PF-01.trace.state").dataset.trace).toBe("line"));
    fireEvent.click(screen.getByTestId("W-PF-01.trace.back"));
    await waitFor(() => expect(screen.getByTestId("W-PF-01.trace.state").dataset.trace).toBe("closed"), {
      timeout: 3000,
    });
    expect(lines.dataset.momentPhase).toBe("rest");

    const phases = tracedPhases("MM-7");
    for (const phase of ["framed", "expanded", "zooming", "zoomed", "tiled", "returning", "rest"] as const) {
      expect(phases).toContain(phase);
    }
  });
});

describe("W-PF-01 states", () => {
  it("none: no pay run for an unknown run", async () => {
    await renderConsole({ path: webRoutes.proof("2026A-r999") });
    const root = await screen.findByTestId("W-PF-01");
    await waitFor(() => expect(root.dataset.state).toBe("none"));
    expect(screen.getByTestId("W-PF-01.none").textContent).toContain("No pay run yet");
    expect(screen.getByTestId("W-PF-01.none.showcase").getAttribute("href")).toBe(webRoutes.proof(RUN));
  });

  it("error: says the Proof didn't load and tries again", async () => {
    const world = createTestWorld();
    world.failNext("proof", "INTERNAL");
    const view = await renderConsole({ path: webRoutes.proof(RUN), world });
    const root = await screen.findByTestId("W-PF-01");
    await waitFor(() => expect(root.dataset.state).toBe("error"));
    expect(screen.getByTestId("W-PF-01.error.notice")).toBeTruthy();
    await expectNoAxeViolations(view.container);
    fireEvent.click(screen.getByTestId("W-PF-01.error.notice.retry"));
    await waitFor(() => expect(root.dataset.state).toBe("verified"));
  });

  it("a judge's own run: none until posted, progress while PayPal confirms, verified once Rhea moves to cash", async () => {
    const view = await renderConsole({ path: webRoutes.proof(RUN) });
    await view.startSession();
    const root = await screen.findByTestId("W-PF-01");
    await waitFor(() => expect(root.dataset.state).toBe("none"));
    expect(screen.getByTestId("W-PF-01.none").textContent).toContain("published once both keys are signed");

    act(() => {
      view.world.markPaid();
      view.world.resolveAll();
      view.world.sign("treasurer");
      view.world.cosign();
    });
    await waitFor(() => expect(root.dataset.state).toBe("progress"), { timeout: 10_000 });
    const progress = screen.getByTestId("W-PF-01.progress");
    expect(progress.dataset.state).toBe("progress");
    expect(progress.textContent).toContain("7 of 8 confirmed");
    expect(screen.getByTestId("W-PF-01.plate.payoutItems.fact").textContent).toBe(
      "Waiting for PayPal. 7 of 8 confirmed.",
    );
    await expectNoAxeViolations(view.container);

    act(() => {
      view.world.payCash("M-031");
    });
    await waitFor(() => expect(root.dataset.state).toBe("verified"), { timeout: 10_000 });
    expect(screen.getByTestId("W-PF-01.metric.onPaypal").textContent).toBe("7 of 64 members, 8.1% of value");
  });
});

describe("W-PF-01 failed: a record that doesn't match", () => {
  const failed: VerifyOutcome = {
    verdict: "failed",
    checks: {
      paid: { state: "matches", reason: null },
      ratified: { state: "matches", reason: null },
      read: { state: "matches", reason: null },
      computed: { state: "matches", reason: null },
      twoKeys: { state: "matches", reason: null },
      payoutItems: {
        state: "differs",
        reason: "The batch hash doesn't match the signed batch. Proof withheld.",
      },
    },
    chain: { ok: true, entries: 91, brokenAtSeq: null },
    checkpoint: { ok: true, reason: null, seq: 91, keyId: "fs-ledger-s1" },
    sampleKeys: [],
    anchors: {
      invoiceNumber: null,
      invoiceReference: null,
      senderBatchId: null,
      batchNote: null,
      batchNoteDigest: null,
    },
    withheld: false,
    trust: "published",
    failure: {
      where: "payoutItems",
      reason: "The batch hash doesn't match the signed batch. Proof withheld.",
    },
    head: "91:x",
  };
  const verification: Verification = {
    state: { kind: "done", outcome: failed, at: "2026-10-30T02:15:00.000Z", pressId: "press:verify:1" },
    verify: () => undefined,
  };

  it("turns the page to failed and names the plate, in red", () => {
    expect(
      proofState(
        {
          phase: "ready",
          progress: {
            total: 8,
            sent: 0,
            confirmed: 7,
            held: 0,
            parked: 0,
            returned: 1,
            failed: 0,
            reversed: 0,
          },
        },
        verification,
      ),
    ).toBe("failed");
    render(<VerifyPanel verification={verification} />);
    expect(screen.getByTestId("W-PF-01.verdict").dataset.state).toBe("mismatch");
    expect(screen.getByTestId("W-PF-01.verdict.word").dataset.verdict).toBe("failed");
    expect(screen.getByTestId("W-PF-01.verdict.failure").textContent).toContain("Plate 6, Payout items");
    expect(screen.getByTestId("W-PF-01.checks.payoutItems").dataset.state).toBe("differs");
  });
});
