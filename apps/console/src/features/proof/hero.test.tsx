// Proof's hero, UI gate rounds 2 and 3: the verdict leads by the seal as the page's one hero count in FS Sans
// ("0/6" until this browser has checked, then "6/6"; tabular figures, no dot-matrix), the explicit result under it
// ("6 of 6 integrity checks match", seen and heard alike), the sample keys beside it as a neutral key chip with no
// check mark ("Sample keys · not PayPal-verified"), and the six checks read in a few words each.

import { LAYOUT } from "@fairsplit/tokens";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CHECK_SHORT } from "./copy.js";
import { PROOF_SEAL, VerifyPanel } from "./Hero.js";
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
function count(): HTMLElement {
  return screen.getByTestId("W-PF-01.verdict.count");
}

it("draws the seal at the system's 180 px (LAYOUT.console.seal), the same as Approve's", () => {
  expect(PROOF_SEAL).toBe(LAYOUT.console.seal);
});

describe("the verdict card", () => {
  it("before a check: 0/6 in ink-3, one short line, and Verify as the one primary", () => {
    render(<VerifyPanel verification={idle} />);
    const verdict = screen.getByTestId("W-PF-01.verdict");
    const numeral = count();
    expect(numeral.classList.contains("fs-numeral")).toBe(true);
    expect(numeral.textContent).toBe("0/6");
    expect(numeral.getAttribute("data-tone")).toBe("dim");
    // The words under it say the count, so the numeral is hidden from a screen reader.
    expect(numeral.getAttribute("aria-hidden")).toBe("true");
    expect(verdict.querySelector(".pf-verify__count svg")).toBeNull();
    expect(screen.getByTestId("W-PF-01.verdict.result").textContent).toBe("not checked yet");
    expect(verdict.textContent).toContain("Runs in this browser. Nothing is sent.");
    expect(within(verdict).getByRole("button", { name: /Verify in your browser/ })).toBeTruthy();
  });

  it("after a check: 6 of 6 integrity checks match, the sample keys beside it, the time in Philippine time", () => {
    render(<VerifyPanel verification={done} />);
    const verdict = screen.getByTestId("W-PF-01.verdict");
    expect(count().textContent).toBe("6/6");
    expect(count().getAttribute("data-tone")).toBe("ink");
    // The explicit result, in view and in the live region, the same words.
    expect(screen.getByTestId("W-PF-01.verdict.result").textContent).toBe("6 of 6 integrity checks match");
    const status = within(verdict).getByRole("status");
    expect(status.textContent).toContain("6 of 6 integrity checks match");
    expect(status.textContent).toMatch(/Checked in this browser at \d\d:\d\d:\d\d, Davao time\./);
    // The sample keys: one neutral chip, a key and the words, with the verdict word inside it and no check mark.
    expect(screen.getByTestId("W-PF-01.verdict.word").textContent).toBe("Sample");
    const sample = screen.getByTestId("W-PF-01.verdict.sample");
    const chip = sample.querySelector(".pf-keychip");
    expect(chip?.contains(screen.getByTestId("W-PF-01.verdict.word"))).toBe(true);
    expect(chip?.querySelector('[data-glyph="ms:check"]')).toBeNull();
    expect(chip?.querySelector(".pf-keychip__glyph")).not.toBeNull();
    expect(chip?.getAttribute("title")).toBe(
      "Signed with sample keys, so this Proof reads Sample, never Verified.",
    );
    // On screen, the short form; a screen reader hears why as well.
    const words = chip?.querySelector(".pf-keychip__words");
    const visible = [...(words?.childNodes ?? [])]
      .filter((n) => !(n instanceof Element && n.classList.contains("fs-sr")))
      .map((n) => n.textContent)
      .join("");
    expect(visible).toBe("Sample keys · not PayPal-verified");
    expect(chip?.textContent).toContain("never Verified");
    expect(verdict.querySelector('.pf-verdict [data-glyph="ms:check"]')).toBeNull();
    expect(screen.getByTestId("W-PF-01.verdict.keys").textContent).toBe("fs-analyn-s1 · fs-ernesto-s1");
    // Round 3's one mono: the key ids and the check's time are the id role; the words around them are FS Sans.
    expect(screen.getByTestId("W-PF-01.verdict.keys").classList.contains("fs-t-id")).toBe(true);
    expect(verdict.querySelector(".pf-verify__meta")?.textContent).toMatch(
      /^\d\d:\d\d:\d\d PHT · in this browser/,
    );
    expect(verdict.querySelector(".pf-verify__meta time.fs-t-id")?.textContent).toMatch(/^\d\d:\d\d:\d\d$/);
    // The headline count is FS Sans on the hero step, never a drawing.
    expect(count().classList.contains("fs-t-hero")).toBe(true);
    expect(screen.getByTestId("W-PF-01.verdict.trust").textContent).toBe("keys.json");
    // The IDs wait behind a disclosure, with the simulated glyph (a glyph, not a tag: the page keeps its budget).
    const anchors = screen.getByTestId("W-PF-01.verdict.anchors");
    expect(anchors.closest("details")?.open).toBe(false);
    expect(anchors.querySelector(".fs-honesty")).toBeNull();
    const glyph = anchors.querySelector(".fs-legend-glyph");
    expect(glyph?.getAttribute("data-kind")).toBe("simulated");
    expect(glyph?.getAttribute("title")).toBe("Simulated PayPal sandbox");
  });

  it("a verdict other than Sample keeps its own word, and the sample keys still sit beside it", () => {
    const replay: Verification = {
      state: {
        kind: "done",
        outcome: {
          ...sample,
          verdict: "replay",
          checks: { ...sample.checks, payoutItems: { state: "replay", reason: "Replayed (labelled)" } },
        },
        at: "2026-11-04T11:04:27.000Z",
        pressId: "press:verify:2",
      },
      verify: () => undefined,
    };
    render(<VerifyPanel verification={replay} />);
    expect(screen.getByTestId("W-PF-01.verdict.word").textContent).toBe(
      "five of six match; one replayed, labelled",
    );
    expect(screen.getByTestId("W-PF-01.verdict.result").textContent).toBe("5 of 6 integrity checks match");
    expect(screen.getByTestId("W-PF-01.verdict.sample").textContent).toContain(
      "Sample keys · not PayPal-verified",
    );
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
