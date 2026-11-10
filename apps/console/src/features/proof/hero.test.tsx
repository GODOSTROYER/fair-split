// Proof's hero, UI gate round 2 and 3: the verdict leads by the seal as the page's one hero count in FS Sans ("0/6"
// until this browser has checked, then "6/6"; no dot-matrix), "Sample keys, never Verified" sits with it, and the
// six checks read in a few words each. A screen reader hears the whole verdict in words; the numeral is hidden.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CHECK_SHORT } from "./copy.js";
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

/** The verdict's count: the FS Sans numeral (round 3), never a drawing. */
function count(verdict: HTMLElement): HTMLElement | null {
  return verdict.querySelector<HTMLElement>(".pf-verify__count .fs-numeral");
}

describe("the verdict card", () => {
  it("before a check: 0/6 in ink-3, one short line, and Verify as the one primary", () => {
    render(<VerifyPanel verification={idle} />);
    const verdict = screen.getByTestId("W-PF-01.verdict");
    expect(count(verdict)?.textContent).toBe("0/6");
    expect(count(verdict)?.dataset.tone).toBe("dim");
    expect(count(verdict)?.getAttribute("aria-hidden")).toBe("true");
    expect(verdict.querySelector(".pf-verify__count svg")).toBeNull();
    expect(verdict.textContent).toContain("not checked yet");
    expect(verdict.textContent).toContain("Runs in this browser. Nothing is sent.");
    expect(within(verdict).getByRole("button", { name: /Verify in your browser/ })).toBeTruthy();
  });

  it("after a check: 6/6 checks match, Sample paired with its keys, the time in Philippine time", () => {
    render(<VerifyPanel verification={done} />);
    const verdict = screen.getByTestId("W-PF-01.verdict");
    expect(count(verdict)?.textContent).toBe("6/6");
    expect(count(verdict)?.dataset.tone).toBe("ink");
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
