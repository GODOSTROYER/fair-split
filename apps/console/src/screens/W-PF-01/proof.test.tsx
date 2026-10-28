// W-PF-01 Proof against the mock world: every figure from the served bundle, member IDs only, "Verify in your
// browser" re-checking six plates on a person's press, MM-7 traced in full and reduced motion and laid out for a
// 375 px phone, and every state: loading (print beds), error, none (and a judge's run not posted yet), progress
// (while PayPal confirms, and on a settled run until a check here matches against keys that aren't samples),
// verified only after such a check, and failed on a tampered record.

import { type ProofBundle, webRoutes } from "@fairsplit/contracts";
import { getSnapshot } from "@fairsplit/seed";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { VerifyPanel } from "../../features/proof/Hero.js";
import type { ProgressCounts } from "../../features/proof/model.js";
import { proofState } from "../../features/proof/ProofView.js";
import type { Verification } from "../../features/proof/useVerification.js";
import type { VerifyOutcome } from "../../features/proof/verify.js";
import {
  createTestWorld,
  expectNoAxeViolations,
  recordRequests,
  renderConsole,
  resizeTo,
  tracedPhases,
} from "../../test/index.js";
import { gate, withHandlers } from "../../test/proof-world.js";

const RUN = "2026A-r37";
const snapshot = getSnapshot();

const MATCHES = { state: "matches", reason: null } as const;

/** A check where every plate matched against published keys that are not samples. */
const matched: VerifyOutcome = {
  verdict: "verified",
  checks: {
    paid: MATCHES,
    ratified: MATCHES,
    read: MATCHES,
    computed: MATCHES,
    twoKeys: MATCHES,
    payoutItems: MATCHES,
  },
  chain: { ok: true, entries: 91, brokenAtSeq: null },
  checkpoint: { ok: true, reason: null, seq: 91, keyId: "fs-ledger-k1" },
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
  failure: null,
  head: "91:x",
};

describe("W-PF-01 loads without waiting on the seed", () => {
  it("renders and sends its own read while the seeded snapshot is still loading", async () => {
    const log = recordRequests();
    // A snapshot that never arrives: the route must not hold the page for it (S2.11, initial JS and LCP).
    await renderConsole({
      path: webRoutes.proof(RUN),
      handlers: [log.handler],
      snapshot: () => new Promise(() => undefined),
    });
    await screen.findByTestId("W-PF-01");
    await waitFor(() => expect(log.sent.some((r) => r.path === `/v1/proof/${RUN}`)).toBe(true));
  });
});

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

/** The seed's bundle with one line edited after it was signed: a record that no longer matches its signatures. */
function tamperedBundle(): ProofBundle {
  const bundle = structuredClone(snapshot.proof);
  const line = bundle.lines.find((l) => l.memberNo === "M-014");
  if (!line) throw new Error("the seed has M-014");
  line.netCents += 1;
  line.canonical.netCents += 1;
  return bundle;
}

describe("W-PF-01 Proof: the season's settled run", () => {
  it("prints every metric from the served bundle; settled but unchecked is progress, never verified", async () => {
    const { view, root } = await openProof();
    expect(root.dataset.state).toBe("progress");
    expect(root.querySelector("[data-verify]")?.getAttribute("data-verify")).toBe("idle");
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
      "7 of 8 confirmed by PayPal, 1 returned to the co-op, cash due at the bodega.",
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
    // The verdict prints under the six checks, below a laptop's fold: it is brought into view once it lands,
    // so "Sample" (and why) is never off screen beside six "Matches".
    const scrolled: Element[] = [];
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
      this: Element,
    ) {
      scrolled.push(this);
    });
    press("W-PF-01.verify");
    await waitFor(() => expect(screen.getByTestId("W-PF-01.verdict").dataset.state).toBe("sample"), {
      timeout: 10_000,
    });
    for (const row of within(screen.getByTestId("W-PF-01.checks")).getAllByRole("listitem")) {
      expect(row.dataset.state).toBe("matches");
    }
    expect(screen.getByTestId("W-PF-01.verdict.word").textContent).toBe("Sample");
    await waitFor(() =>
      expect(scrolled.some((el) => el.contains(screen.getByTestId("W-PF-01.verdict.sample")))).toBe(true),
    );
    scrollIntoView.mockRestore();
    expect(screen.getByTestId("W-PF-01.verdict.sample").textContent).toContain("fs-analyn-s1");
    // The mock publishes no keys document, so the seed's published sample keys stand in, and the page says so.
    expect(screen.getByTestId("W-PF-01.verdict.trust").dataset.trust).toBe("seed");
    expect(root.querySelector("[data-verify]")?.getAttribute("data-verify")).toBe("sample");
    expect(screen.getByTestId("W-PF-01.plate.twoKeys").dataset.state).toBe("matches");
    expect(document.querySelector('[data-verdict="verified"]')).toBeNull();
    // A Sample verdict never makes the page "verified": the seeded keys prove nothing about real people.
    expect(root.dataset.state).toBe("progress");
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
    const close = screen.getByTestId("W-PF-01.trace.back");
    close.focus();
    fireEvent.click(close);
    await waitFor(() => expect(screen.getByTestId("W-PF-01.trace.state").dataset.trace).toBe("closed"), {
      timeout: 3000,
    });
    expect(lines.dataset.momentPhase).toBe("rest");
    // The Close went away with the trace: focus is back on the peso that opened it, never on <body>.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("W-PF-01.peso.M-014")));

    const phases = tracedPhases("MM-7");
    for (const phase of ["framed", "expanded", "zooming", "zoomed", "tiled", "returning", "rest"] as const) {
      expect(phases).toContain(phase);
    }
  });
});

describe("W-PF-01 states", () => {
  it("none: no pay run for an unknown run", async () => {
    const view = await renderConsole({ path: webRoutes.proof("2026A-r999") });
    const root = await screen.findByTestId("W-PF-01");
    await waitFor(() => expect(root.dataset.state).toBe("none"));
    expect(screen.getByTestId("W-PF-01.none").textContent).toContain("No pay run yet");
    expect(screen.getByTestId("W-PF-01.none.showcase").getAttribute("href")).toBe(webRoutes.proof(RUN));
    await expectNoAxeViolations(view.container);
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
    await waitFor(() => expect(root.dataset.state).toBe("progress"));
    expect(screen.getByTestId("W-PF-01.progress").dataset.state).toBe("settled");
  });

  it("loading: print beds at their final size until the bundle arrives", async () => {
    const held = gate();
    const world = withHandlers(createTestWorld(), [
      http.get("*/v1/proof/:runSlug", async () => {
        await held.opened;
      }),
    ]);
    const view = await renderConsole({ path: webRoutes.proof(RUN), world });
    const root = await screen.findByTestId("W-PF-01");
    expect(root.dataset.state).toBe("loading");
    const loading = screen.getByTestId("W-PF-01.loading");
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(loading.querySelectorAll("[data-bed]").length).toBeGreaterThanOrEqual(10);
    expect(loading.querySelectorAll('[data-bed="plate"]')).toHaveLength(6);
    await expectNoAxeViolations(view.container);

    held.release();
    await waitFor(() => expect(root.dataset.state).toBe("progress"));
    expect(screen.queryByTestId("W-PF-01.loading")).toBeNull();
  });

  it("a judge's own run: none until posted, progress while PayPal confirms and after, until someone checks", async () => {
    const view = await renderConsole({ path: webRoutes.proof(RUN) });
    await view.startSession();
    const root = await screen.findByTestId("W-PF-01");
    await waitFor(() => expect(root.dataset.state).toBe("none"));
    expect(screen.getByTestId("W-PF-01.none").textContent).toContain("published once both keys are signed");
    await expectNoAxeViolations(view.container);

    act(() => {
      view.world.markPaid();
      view.world.resolveAll();
      view.world.sign("treasurer");
      view.world.cosign();
    });
    await waitFor(() => expect(root.dataset.state).toBe("progress"), { timeout: 10_000 });
    const progress = screen.getByTestId("W-PF-01.progress");
    expect(progress.dataset.state).toBe("progress");
    // The hero's live line: what PayPal confirmed, on which rail, and what waits on a person.
    expect(screen.getByTestId("W-PF-01.hero").contains(progress)).toBe(true);
    expect(progress.textContent).toContain(
      "Waiting for PayPal: 7 of 8 PayPal payouts confirmed in the simulated sandbox.",
    );
    expect(progress.textContent).toContain("1 parked for a decision.");
    expect(screen.getByTestId("W-PF-01.plate.payoutItems.fact").textContent).toBe(
      "Waiting for PayPal. 7 of 8 confirmed.",
    );
    await expectNoAxeViolations(view.container);

    act(() => {
      view.world.payCash("M-031");
    });
    await waitFor(() => expect(screen.getByTestId("W-PF-01.progress").dataset.state).toBe("settled"), {
      timeout: 10_000,
    });
    expect(screen.getByTestId("W-PF-01.progress").textContent).toContain(
      "7 of 8 PayPal payouts confirmed in the simulated sandbox. 1 moved to cash.",
    );
    expect(root.dataset.state).toBe("progress");
    expect(screen.getByTestId("W-PF-01.metric.onPaypal").textContent).toBe("7 of 64 members, 8.1% of value");
  });

  it("failed: a record edited after it was signed fails in this browser, names the plate and withholds the figures", async () => {
    const world = withHandlers(createTestWorld(), [
      http.get("*/v1/proof/:runSlug", () =>
        HttpResponse.json({ bundle: tamperedBundle(), provenance: "seeded", redacted: true }),
      ),
    ]);
    const { view, root } = await openProof({ world });
    expect(root.dataset.state).toBe("progress");
    press("W-PF-01.verify");
    await waitFor(() => expect(root.dataset.state).toBe("failed"), { timeout: 10_000 });
    expect(screen.getByTestId("W-PF-01.withheld").textContent).toContain("Plate 4");
    expect(screen.getByTestId("W-PF-01.checks.computed").dataset.state).toBe("differs");
    expect(screen.getByTestId("W-PF-01.figures.withheld")).toBeTruthy();
    expect(root.querySelector("[data-verify]")?.getAttribute("data-verify")).toBe("failed");
    await expectNoAxeViolations(view.container);
  });
});

describe("W-PF-01 on a 375 px phone", () => {
  it("folds the lines to three columns and keeps MM-7's trace inside the visible table", async () => {
    await openProof({ viewport: { width: 375, height: 812 } });
    openPlate("computed");
    const table = await screen.findByTestId("W-PF-01.lines.table");
    expect(table.hasAttribute("data-fold")).toBe(true);
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Member and rail", "Verified", "Net and status"]);

    const row = screen.getByTestId("W-PF-01.line.M-014");
    const cells = row.querySelectorAll(":scope > th, :scope > td");
    expect(cells).toHaveLength(3);
    // The rail sits under the member, the status under the net: nothing is left in a column off to the side.
    expect(cells[0]?.textContent).toBe("M-014PayPal");
    expect(cells[2]?.querySelector('[data-testid="W-PF-01.peso.M-014"]')).toBeTruthy();
    expect(cells[2]?.querySelector(".fs-chip")).toBeTruthy();

    fireEvent.click(screen.getByTestId("W-PF-01.peso.M-014"));
    const trace = await screen.findByTestId("W-PF-01.trace");
    // The trace spans every visible column and is pinned to the scroller's window (proof.css: sticky, 100cqi).
    expect(trace.closest("td")?.colSpan).toBe(3);
    expect(trace.dataset.pin).toBe("scroller");
    expect(trace.closest('[data-testid="W-PF-01.lines.scroller"]')).toBeTruthy();
    expect(screen.getByTestId("W-PF-01.trace.receipt").textContent).toContain("US$64.45");

    // Back on a wide screen the five columns return, the open trace with them.
    resizeTo(1470);
    await waitFor(() => expect(table.hasAttribute("data-fold")).toBe(false));
    expect(within(table).getAllByRole("columnheader")).toHaveLength(5);
    expect(screen.getByTestId("W-PF-01.trace").closest("td")?.colSpan).toBe(5);
  });
});

describe("proofState: verified is earned in this browser", () => {
  const settled: ProgressCounts = {
    total: 8,
    sent: 0,
    confirmed: 7,
    held: 0,
    parked: 0,
    returned: 1,
    failed: 0,
    reversed: 0,
  };
  const moving: ProgressCounts = { ...settled, sent: 1, returned: 0 };
  const done = (verdict: VerifyOutcome["verdict"]): Verification => ({
    state: {
      kind: "done",
      outcome: { ...matched, verdict },
      at: "2026-10-30T02:15:00.000Z",
      pressId: "press:verify:1",
    },
    verify: () => undefined,
  });
  const idle: Verification = { state: { kind: "idle", stale: false }, verify: () => undefined };

  it.each([
    ["nobody has pressed Verify", idle, settled, "progress"],
    [
      "the check is still running",
      { ...idle, state: { kind: "checking", pressId: "p" } },
      settled,
      "progress",
    ],
    [
      "the record moved on since the check",
      { ...idle, state: { kind: "idle", stale: true } },
      settled,
      "progress",
    ],
    ["the check read Sample (seeded or demo keys)", done("sample"), settled, "progress"],
    ["five plates of six checked here", done("partial"), settled, "progress"],
    ["every plate matched, PayPal still confirming", done("verified"), moving, "progress"],
    ["every plate matched on a settled run", done("verified"), settled, "verified"],
    ["a plate did not match", done("failed"), moving, "failed"],
  ] as const)("%s", (_, verification, progress, state) => {
    expect(proofState({ phase: "ready", progress }, verification as Verification)).toBe(state);
  });

  it("keeps the shell's states before there is a record", () => {
    expect(proofState({ phase: "loading", progress: settled }, done("verified"))).toBe("loading");
    expect(proofState({ phase: "none", progress: settled }, done("verified"))).toBe("none");
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
