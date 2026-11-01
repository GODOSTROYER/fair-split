// W-PF-01 Proof against the mock world: every figure from the served bundle, member IDs only, "Verify in your
// browser" re-checking six plates on a person's press, MM-7 traced in full and reduced motion and laid out for a
// 375 px phone, and every state: loading (print beds), error, none (and a judge's run not posted yet), progress
// (while PayPal confirms, and on a settled run until a check here matches against keys that aren't samples),
// verified only after such a check, and failed on a tampered record.

import { getSnapshot } from "@fairsplit/api-client/seed";
import { type ProofBundle, webRoutes } from "@fairsplit/contracts";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { VerifyPanel } from "../../features/proof/Hero.js";
import type { ProgressCounts } from "../../features/proof/model.js";
import { proofState } from "../../features/proof/ProofView.js";
import type { Verification } from "../../features/proof/useVerification.js";
import type { VerifyOutcome } from "../../features/proof/verify.js";
import { cascaded, readRules } from "../../test/css.js";
import {
  createTestWorld,
  expectNoAxeViolations,
  recordRequests,
  renderConsole,
  resizeTo,
  timersBeforeCommit,
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

describe("Proof replay and simulation labels", () => {
  it("inv.i8.shows replay separately from matches and gives simulator anchors no dashboard instruction", () => {
    const reason =
      "Replayed (labelled): these statuses come from a recorded run, not from verified simulator notices";
    const outcome = {
      ...matched,
      verdict: "replay",
      checks: { ...matched.checks, payoutItems: { state: "replay", reason } },
      anchors: { ...matched.anchors, invoiceNumber: "SIM-INVOICE", senderBatchId: "SIM-BATCH" },
    } as VerifyOutcome;
    render(
      <VerifyPanel
        verification={{
          state: { kind: "done", outcome, at: "2026-11-01T00:00:00Z", pressId: "test" },
          verify: () => undefined,
        }}
      />,
    );
    expect(screen.getByTestId("W-PF-01.checks.payoutItems").dataset.state).toBe("replay");
    expect(screen.getByTestId("W-PF-01.verdict.word").textContent).toBe(
      "five of six match; one replayed, labelled",
    );
    expect(screen.getByTestId("W-PF-01.verdict").textContent).toContain(reason);
    expect(screen.getByTestId("W-PF-01.verdict").textContent).not.toContain("Six of six match");
    expect(screen.getByTestId("W-PF-01.verdict.anchors").textContent).toContain("Simulated PayPal sandbox");
    expect(screen.getByTestId("W-PF-01.verdict.anchors").textContent).not.toContain("Match it in PayPal");
  });
});

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

  // fs-api serves the seed's chunk uncompressed, so on a slow link the bundle lands first and the hero paints
  // before the seed that names the lot. The lot mark's line is there from the hero's first frame and fills in
  // place, so the sentence, the progress line and Verify never jump down when the code arrives, and the season
  // reads the same before and after (no re-wrap).
  it("holds the lot mark's line from the hero's first frame, and fills it in place when the seed lands", async () => {
    let land: (seed: typeof snapshot) => void = () => undefined;
    const late = new Promise<typeof snapshot>((resolve) => {
      land = resolve;
    });
    const firstFrame: { lot: Element | null; title: string | null }[] = [];
    const watch = new MutationObserver(() => {
      const title = document.getElementById("W-PF-01-title");
      if (title && firstFrame.length === 0) {
        firstFrame.push({
          lot: document.querySelector('[data-testid="W-PF-01.lot"]'),
          title: title.textContent,
        });
      }
    });
    watch.observe(document.body, { childList: true, subtree: true });
    try {
      await renderConsole({ path: webRoutes.proof(RUN), snapshot: () => late });
      const hero = await screen.findByTestId("W-PF-01.hero");
      const lot = within(hero).getByTestId("W-PF-01.lot");
      const title = document.getElementById("W-PF-01-title") as HTMLElement;
      expect(firstFrame).toHaveLength(1);
      expect(firstFrame[0]?.lot).toBe(lot);
      // Waiting, the line is empty and says nothing to a screen reader.
      expect(lot.textContent).toBe("");
      expect(lot.getAttribute("aria-hidden")).toBe("true");
      const sentence = title.textContent;
      expect(sentence).toContain("Season 2026-A");
      await act(async () => {
        land(snapshot);
      });
      await waitFor(() => expect(lot.textContent).toBe(snapshot.lot.lotCode));
      expect(within(hero).getByTestId("W-PF-01.lot")).toBe(lot);
      expect(lot.hasAttribute("aria-hidden")).toBe(false);
      expect(title.textContent).toBe(sentence);
    } finally {
      watch.disconnect();
    }
  });

  it("reserves the lot mark's line box at its settled height: 2.5rem, and 2rem up to 560 px", () => {
    const rules = readRules("src/features/proof/proof.css");
    const lot = document.createElement("p");
    lot.className = "pf-hero__lot";
    document.body.append(lot);
    try {
      for (const [width, size] of [
        [1470, "2.5rem"],
        [390, "2rem"],
      ] as const) {
        const medium = { width, motion: "full" } as const;
        expect(cascaded(rules, lot, "line-height", medium)).toBe(size);
        expect(cascaded(rules, lot, "min-block-size", medium)).toBe(size);
      }
    } finally {
      lot.remove();
    }
  });
});

/** A CSS length the cascade gives (rem, px, vw, unitless; clamp, min, max) in px at `width` and `em` px. */
function lengthPx(value: string, width: number, em: number): number {
  const v = value.trim();
  const call = /^(clamp|min|max)\((.*)\)$/.exec(v);
  if (call) {
    const args: string[] = [];
    let depth = 0;
    let start = 0;
    const inner = call[2] ?? "";
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === "(") depth++;
      else if (inner[i] === ")") depth--;
      else if (inner[i] === "," && depth === 0) {
        args.push(inner.slice(start, i));
        start = i + 1;
      }
    }
    args.push(inner.slice(start));
    const [a = 0, b = 0, c = 0] = args.map((arg) => lengthPx(arg, width, em));
    if (call[1] === "clamp") return Math.max(a, Math.min(b, c));
    const all = args.map((arg) => lengthPx(arg, width, em));
    return call[1] === "min" ? Math.min(...all) : Math.max(...all);
  }
  const m = /^(-?[\d.]+)(rem|px|vw|em)?$/.exec(v);
  if (!m) throw new Error(`lengthPx cannot read "${v}"`);
  const n = Number.parseFloat(m[1] ?? "");
  switch (m[2]) {
    case "rem":
      return n * 16;
    case "px":
      return n;
    case "vw":
      return (n * width) / 100;
    default:
      return n * em;
  }
}

describe("W-PF-01's hero reflows on a phone (WCAG 2.2 1.4.10)", () => {
  // The amount never breaks (white-space: nowrap), so at hero size (72 px) it alone would widen the hero, and the
  // page, past a 320 px viewport. Measured in Chromium in FS Sans Proof at stretch 75 % and weight 800: the seed's
  // US$4,333.50 advances 4.929 em, a twelve-character US$88,888.88 5.438 em.
  const TWELVE_CHARACTERS_EM = 5.438;
  const rules = [
    ...readRules("../../packages/tokens/src/generated/theme.web.css"),
    // Proof's own stylesheet loads after the theme's.
    ...readRules("src/features/proof/proof.css").map((rule) => ({ ...rule, order: rule.order + 100_000 })),
  ];

  it("scales the hero amount down to fit the column at 320 and 360 px, and keeps 4.5rem where it fits", () => {
    const hero = document.createElement("section");
    hero.className = "pf-hero";
    const title = document.createElement("h1");
    title.className = "pf-hero__title";
    const amount = document.createElement("span");
    amount.className = "pf-hero__amount fs-t-amount-hero";
    title.append(amount);
    hero.append(title);
    document.body.append(hero);
    try {
      for (const width of [320, 360, 375, 390, 480, 560, 768, 1470]) {
        const medium = { width, motion: "full" } as const;
        expect(cascaded(rules, amount, "white-space", medium)).toBe("nowrap");
        const size = lengthPx(cascaded(rules, amount, "font-size", medium) ?? "", width, 16);
        const leading = lengthPx(cascaded(rules, amount, "line-height", medium) ?? "", width, size);
        // The Proof surface's column: 680 px, inside a 16 px gutter on each side.
        const column = Math.min(680, width - 2 * 16);
        expect(TWELVE_CHARACTERS_EM * size, `at ${width} px`).toBeLessThanOrEqual(column);
        // The line box follows the figure: never a 72 px line around a smaller amount.
        expect(leading, `at ${width} px`).toBe(size);
        if (width > 560) expect(size, `at ${width} px`).toBe(72);
        else expect(size, `at ${width} px`).toBeGreaterThanOrEqual(40);
      }
    } finally {
      hero.remove();
    }
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
      "7 of 8 confirmed by PayPal (simulated sandbox), 1 returned to the co-op, cash due at the bodega.",
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
    const zoomIn = screen.getByTestId("W-PF-01.trace.zoom-in");
    zoomIn.focus();
    fireEvent.click(zoomIn);
    await expectNoAxeViolations(view.container);

    // Escape from the slip takes the zoom controls away: focus moves to the trace's Back, never to <body>.
    fireEvent.keyDown(zoomIn, { key: "Escape" });
    await waitFor(() => expect(screen.getByTestId("W-PF-01.trace.state").dataset.trace).toBe("line"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("W-PF-01.trace.back")));

    fireEvent.click(screen.getByTestId("W-PF-01.trace.slip.0403"));
    await waitFor(() => expect(screen.getByTestId("W-PF-01.trace.state").dataset.trace).toBe("slip"));
    fireEvent.click(screen.getByTestId("W-PF-01.trace.back"));
    await waitFor(() => expect(screen.getByTestId("W-PF-01.trace.state").dataset.trace).toBe("line"));
    const close = screen.getByTestId("W-PF-01.trace.back");
    close.focus();
    // Closing, the zero-delay timers fire before React commits the trace's removal (a loaded machine's order).
    const restoreTimers = timersBeforeCommit();
    try {
      fireEvent.click(close);
      await waitFor(() => expect(screen.getByTestId("W-PF-01.trace.state").dataset.trace).toBe("closed"), {
        timeout: 3000,
      });
      expect(lines.dataset.momentPhase).toBe("rest");
      // The Close went away with the trace: focus is back on the peso that opened it, never on <body>.
      await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("W-PF-01.peso.M-014")));
    } finally {
      restoreTimers();
    }

    const phases = tracedPhases("MM-7");
    for (const phase of ["framed", "expanded", "zooming", "zoomed", "tiled", "returning", "rest"] as const) {
      expect(phases).toContain(phase);
    }
  });
});

describe("W-PF-01 MM-7, the peso is back in view when the trace closes", () => {
  // In a browser the open trace pushes the rows below it down and the reader scrolls on: when the trace folds
  // away, the peso that opened it sits above the viewport (M-014 at -208 px at 1470, the W-PF-01 hero). Focus goes
  // back to it, and it scrolls into view the least it can, at once, so the keyboard's ring is never off screen.
  const ABOVE = { top: -208, bottom: -180, left: 120, right: 220, width: 100, height: 28, x: 120, y: -208 };
  const closes = {
    "Close (Enter)": async () => {
      const close = screen.getByTestId("W-PF-01.trace.back");
      close.focus();
      fireEvent.click(close);
    },
    "Escape on Close": async () => {
      const close = screen.getByTestId("W-PF-01.trace.back");
      close.focus();
      fireEvent.keyDown(close, { key: "Escape" });
    },
    "the slip, Back, then Escape": async () => {
      fireEvent.click(screen.getByTestId("W-PF-01.trace.slip.0403"));
      await waitFor(() => expect(screen.getByTestId("W-PF-01.trace.state").dataset.trace).toBe("slip"));
      const back = screen.getByTestId("W-PF-01.trace.back");
      back.focus();
      fireEvent.click(back);
      await waitFor(() => expect(screen.getByTestId("W-PF-01.trace.state").dataset.trace).toBe("line"));
      fireEvent.keyDown(screen.getByTestId("W-PF-01.trace.back"), { key: "Escape" });
    },
  };

  it.each(Object.keys(closes))("%s: focus is on the peso, scrolled into view", async (how) => {
    const close = closes[how as keyof typeof closes];
    await openProof();
    openPlate("computed");
    const lines = await screen.findByTestId("W-PF-01.lines");
    fireEvent.click(screen.getByTestId("W-PF-01.peso.M-014"));
    await waitFor(() => expect(lines.dataset.momentPhase).toBe("expanded"), { timeout: 3000 });

    const rect = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return (this as HTMLElement).dataset?.testid === "W-PF-01.peso.M-014"
        ? ({ ...ABOVE, toJSON: () => ({}) } as DOMRect)
        : rect.call(this);
    });
    const scrolled: Element[] = [];
    const options: unknown[] = [];
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element, arg) {
      scrolled.push(this);
      options.push(arg);
    });
    try {
      await close();
      await waitFor(() => expect(screen.getByTestId("W-PF-01.trace.state").dataset.trace).toBe("closed"), {
        timeout: 3000,
      });
      const peso = screen.getByTestId("W-PF-01.peso.M-014");
      await waitFor(() => expect(document.activeElement).toBe(peso));
      expect(scrolled).toContain(peso);
      expect(options[scrolled.indexOf(peso)]).toEqual({
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
      });
    } finally {
      vi.restoreAllMocks();
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
      "Simulated PayPal sandbox: waiting, 7 of 8 confirmed.",
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
    expect(cells[0]?.textContent).toBe("M-014Simulated PayPal sandbox");
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
