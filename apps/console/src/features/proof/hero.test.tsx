// Proof's hero, UI gate round 2: the verdict leads by the seal as the page's one dot-matrix count ("0/6" until this
// browser has checked, then "6/6"), "Sample keys, never Verified" sits with it, and the six checks read in a few
// words each. A screen reader hears the whole verdict in words; the matrix itself is hidden from it.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CHECK_SHORT } from "./copy.js";
import { DotMatrix, dotsOf } from "./DotMatrix.js";
import { VerifyPanel } from "./Hero.js";
import type { Verification } from "./useVerification.js";
import { PLATES, type VerifyOutcome } from "./verify.js";

const MATCHES = { state: "matches", reason: null } as const;

const sample: VerifyOutcome = {
  verdict: "sample",
  checks: {
    paid: MATCHES,
    ratified: MATCHES,
    read: MATCHES,
    computed: MATCHES,
    twoKeys: MATCHES,
    payoutItems: { state: "server", reason: null },
  },
  chain: { ok: true, entries: 91, brokenAtSeq: null },
  checkpoint: { ok: true, reason: null, seq: 91, keyId: "fs-ledger-s1" },
  sampleKeys: ["fs-analyn-s1", "fs-ernesto-s1"],
  anchors: {
    invoiceNumber: "FS-2026A-r37",
    invoiceReference: null,
    senderBatchId: "2026A-r37",
    batchNote: null,
    batchNoteDigest: null,
  },
  withheld: true,
  trust: "published",
  failure: null,
  head: "91:x",
};

const idle: Verification = { state: { kind: "idle", stale: false }, verify: () => undefined };
const done: Verification = {
  state: { kind: "done", outcome: sample, at: "2026-11-04T11:04:27.000Z", pressId: "press:verify:1" },
  verify: () => undefined,
};

function lit(svg: Element): number {
  return svg.querySelectorAll(".pf-dots__on").length;
}

describe("the dot-matrix count", () => {
  it("draws 5 x 7 glyphs with one empty column between them", () => {
    const { dots, columns } = dotsOf("6/6");
    expect(columns).toBe(17);
    expect(dots).toHaveLength(3 * 5 * 7);
    expect(dots.filter((d) => d.on).length).toBe(15 + 7 + 15);
  });

  it("is hidden from screen readers and only animates a count that changed after the first paint", () => {
    const { container, rerender } = render(<DotMatrix value="0/6" tone="dim" />);
    const first = container.querySelector("svg");
    expect(first?.getAttribute("aria-hidden")).toBe("true");
    expect(first?.hasAttribute("data-moved")).toBe(false);
    rerender(<DotMatrix value="6/6" />);
    const next = container.querySelector("svg");
    expect(next?.hasAttribute("data-moved")).toBe(true);
    expect(next?.getAttribute("data-tone")).toBe("ink");
  });
});

describe("the verdict card", () => {
  it("before a check: 0/6 in ink-3, one short line, and Verify as the one primary", () => {
    render(<VerifyPanel verification={idle} />);
    const verdict = screen.getByTestId("W-PF-01.verdict");
    const count = verdict.querySelector(".pf-verify__count");
    expect(count?.querySelector("svg")?.getAttribute("data-tone")).toBe("dim");
    expect(lit(count?.querySelector("svg") as Element)).toBe(dotsOf("0/6").dots.filter((d) => d.on).length);
    expect(verdict.textContent).toContain("not checked yet");
    expect(verdict.textContent).toContain("Runs in this browser. Nothing is sent.");
    expect(within(verdict).getByRole("button", { name: /Verify in your browser/ })).toBeTruthy();
  });

  it("after a check: 6/6 checks match, Sample paired with its keys, the time in Philippine time", () => {
    render(<VerifyPanel verification={done} />);
    const verdict = screen.getByTestId("W-PF-01.verdict");
    expect(lit(verdict.querySelector(".pf-verify__count svg") as Element)).toBe(
      dotsOf("6/6").dots.filter((d) => d.on).length,
    );
    expect(verdict.querySelector(".pf-verify__countword")?.textContent).toBe("checks match");
    // Said in words for a screen reader, in the live region.
    const status = within(verdict).getByRole("status");
    expect(status.textContent).toContain("Six of six match.");
    expect(screen.getByTestId("W-PF-01.verdict.word").textContent).toBe("Sample");
    expect(screen.getByTestId("W-PF-01.verdict.word").getAttribute("title")).toBe(
      "Sample keys. Never Verified.",
    );
    const sampleLine = screen.getByTestId("W-PF-01.verdict.sample");
    expect(sampleLine.textContent).toBe("Sample keys, never Verifiedfs-analyn-s1 · fs-ernesto-s1");
    expect(verdict.querySelector(".pf-verify__meta")?.textContent).toMatch(
      /^\d\d:\d\d:\d\d PHT · in this browser/,
    );
    expect(screen.getByTestId("W-PF-01.verdict.trust").textContent).toBe("keys.json");
    // The IDs wait behind a disclosure, with the honesty tag.
    const anchors = screen.getByTestId("W-PF-01.verdict.anchors");
    expect(anchors.closest("details")?.open).toBe(false);
    expect(anchors.querySelector(".fs-honesty")?.textContent).toBe("Simulated PayPal sandbox");
  });

  it("names each check in a few words, in order, and says when the server checked one", () => {
    render(<VerifyPanel verification={done} />);
    const rows = within(screen.getByTestId("W-PF-01.checks")).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector(".pf-checks__what")?.textContent)).toEqual(
      PLATES.map((p) => CHECK_SHORT[p]),
    );
    expect(rows[5]?.querySelector(".pf-checks__state")?.textContent).toBe("Matches (server)");
    expect(rows[0]?.querySelector(".pf-checks__state")?.textContent).toBe("Matches");
  });
});
