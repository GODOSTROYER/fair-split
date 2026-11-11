// Proof's hero, UI gate rounds 2 and 3: the verdict leads by the seal as the page's one hero count in FS Sans
// ("0/6" until this browser has checked, then "6/6"; tabular figures, no dot-matrix), the explicit result under it
// ("6 of 6 integrity checks match", seen and heard alike), the sample keys right under it on the body step with no
// check mark ("Sample keys · not PayPal-verified"; round 4: a line, not a chip), the ids and the keys document
// behind "IDs", and the six checks read in a few words each.

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
    // The sample keys: one line right under the result (round 4: the body step, not a chip), a key and the words,
    // with the verdict word inside it and no check mark.
    expect(screen.getByTestId("W-PF-01.verdict.word").textContent).toBe("Sample");
    const sample = screen.getByTestId("W-PF-01.verdict.sample");
    expect(sample.contains(screen.getByTestId("W-PF-01.verdict.word"))).toBe(true);
    expect(sample.querySelector('[data-glyph="ms:check"]')).toBeNull();
    expect(sample.querySelector(".pf-sample__glyph")).not.toBeNull();
    expect(sample.getAttribute("title")).toBe(
      "Signed with sample keys, so this Proof reads Sample, never Verified.",
    );
    // On screen, the short form; a screen reader hears why as well.
    const words = sample.querySelector(".pf-sample__words");
    const visible = [...(words?.childNodes ?? [])]
      .filter((n) => !(n instanceof Element && n.classList.contains("fs-sr")))
      .map((n) => n.textContent)
      .join("");
    expect(visible).toBe("Sample keys · not PayPal-verified");
    expect(sample.textContent).toContain("never Verified");
    expect(verdict.querySelector('.pf-verdict [data-glyph="ms:check"]')).toBeNull();
    // The check's time is the id role and says where it ran; no file name sits in view (round 4).
    expect(verdict.querySelector(".pf-verify__meta")?.textContent).toMatch(
      /^\d\d:\d\d:\d\d PHT · in this browser$/,
    );
    expect(verdict.querySelector(".pf-verify__meta time.fs-t-id")?.textContent).toMatch(/^\d\d:\d\d:\d\d$/);
    // The headline count is FS Sans on the hero step, never a drawing.
    expect(count().classList.contains("fs-t-hero")).toBe(true);
    // The IDs wait behind a disclosure, the rail in words for a screen reader (round 5: no legend glyph, no tag):
    // the sample keys whole, one a line in the id role, and where the keys came from, the file's path cut to its
    // name and whole as its title.
    const anchors = screen.getByTestId("W-PF-01.verdict.anchors");
    expect(anchors.closest("details")?.open).toBe(false);
    const keys = screen.getByTestId("W-PF-01.verdict.keys");
    expect(anchors.contains(keys)).toBe(true);
    expect([...keys.children].map((k) => k.textContent)).toEqual(["fs-analyn-s1", "fs-ernesto-s1"]);
    for (const key of keys.children) expect(key.classList.contains("fs-t-id")).toBe(true);
    const trust = screen.getByTestId("W-PF-01.verdict.trust");
    expect(anchors.contains(trust)).toBe(true);
    expect(trust.dataset.trust).toBe("published");
    expect(trust.querySelector('[aria-hidden="true"]')?.textContent).toBe("…fairsplit-keys.json");
    expect(trust.querySelector(".fs-idtext")?.getAttribute("title")).toBe("/.well-known/fairsplit-keys.json");
    expect(anchors.querySelector(".fs-honesty")).toBeNull();
    expect(anchors.querySelector(".fs-legend-glyph")).toBeNull();
    expect(anchors.querySelector(".pf-verify__anchors-head .fs-sr")?.textContent).toBe(
      "Simulated PayPal sandbox: ",
    );
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
