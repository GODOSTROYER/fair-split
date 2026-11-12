// Proof and the brand view, UI gate round 4: who signed reads by name and role, readable without zooming (round 5:
// the key is the row's title, never in view); an id never breaks mid-word; no developer word in view (file names
// and full ids wait behind "IDs"); the hero row and the brand strip on the console's one 12-column grid, top-aligned; avatars
// white on an ink-2 ring (indigo is for action only); a slip chip's serial in ink-3, its kilos in ink. Every figure
// is the bundle's own; none changes.

import { getSnapshot } from "@fairsplit/api-client/seed";
import { webRoutes } from "@fairsplit/contracts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { developerWords } from "../../lib/plain.js";
import { cascaded, readRules } from "../../test/css.js";
import { renderConsole } from "../../test/index.js";
import { KEY_SHOWN, type SignerView, VerifyPanel } from "./Hero.js";
import { signersOf } from "./ProofView.js";
import type { Verification } from "./useVerification.js";
import type { VerifyOutcome } from "./verify.js";

const snapshot = getSnapshot();
const MATCHES = { state: "matches", reason: null } as const;

const outcome: VerifyOutcome = {
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
  sampleKeys: ["fs-analyn-demo-v9kuqr", "fs-ernesto-demo-mj2ng2"],
  anchors: {
    invoiceNumber: "FS-2026A-r1",
    invoiceReference: null,
    senderBatchId: "2026A-r1",
    batchNote: null,
    batchNoteDigest: null,
  },
  withheld: true,
  trust: "published",
  failure: null,
  head: "91:x",
};

const done: Verification = {
  state: { kind: "done", outcome, at: "2026-11-04T11:04:27.000Z", pressId: "press:verify:1" },
  verify: () => undefined,
};

/** A judge's own run: the demo keys its browser made, as long as the record mints them. */
const signers: SignerView[] = [
  { role: "Treasurer", keyId: "fs-analyn-demo-v9kuqr", name: "Analyn R. Sumalinog", initials: "AS" },
  { role: "Chair", keyId: "fs-ernesto-demo-mj2ng2", name: "Ernesto P. Cabahug", initials: "EC" },
];

/**
 * What a sighted reader sees: no screen-reader-only words, nothing hidden, nothing behind a closed disclosure. Each
 * text node is its own word run, so two elements side by side never read as one camelCase word.
 */
function visibleText(root: Element): string {
  const copy = root.cloneNode(true) as Element;
  for (const el of copy.querySelectorAll(".fs-sr, [hidden], details:not([open]) > :not(summary)"))
    el.remove();
  const runs: string[] = [];
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) runs.push(node.textContent ?? "");
  return runs.join(" ").replace(/\s+/g, " ").trim();
}

describe("who signed", () => {
  it("reads each officer by name and role; round 5, no ids for people: the key is the row's title", () => {
    render(<VerifyPanel verification={done} signers={signers} />);
    const list = screen.getByTestId("W-PF-01.verdict.stamps");
    expect(list.tagName).toBe("UL");
    expect(list.getAttribute("aria-label")).toBe("Signed by");
    const rows = within(list).getAllByTestId("W-PF-01.verdict.signer");
    expect(rows.map((row) => visibleText(row))).toEqual([
      "AS Analyn R. Sumalinog · Treasurer",
      "EC Ernesto P. Cabahug · Chair",
    ]);
    for (const [i, row] of rows.entries()) {
      // The key waits behind IDs (and in plate 5); here it is only the row's title.
      expect(row.querySelector(".fs-t-id")).toBeNull();
      expect(row.getAttribute("title")).toBe(`Key ${signers[i]?.keyId}`);
      // A person is never an indigo tile: ui-web's Avatar (white, an ink-2 ring), its name printed beside it.
      const avatar = row.querySelector(".pf-signer__avatar");
      expect(avatar?.classList.contains("fs-avatar")).toBe(true);
      expect(avatar?.getAttribute("aria-hidden")).toBe("true");
      expect(row.querySelector(".fs-stamp")).toBeNull();
    }
    expect(KEY_SHOWN).toEqual({ max: 17, tail: 6 });
  });

  it("names the officers from the seed in signing order, and stands on the record's role and key before it lands", () => {
    const bundle = snapshot.proof;
    const keyOf = (role: string) => bundle.approvals.find((a) => a.role === role)?.keyId;
    expect(signersOf(snapshot, bundle)).toEqual([
      { role: "Treasurer", keyId: keyOf("treasurer"), name: "Analyn R. Sumalinog", initials: "AS" },
      { role: "Chair", keyId: keyOf("chair"), name: "Ernesto P. Cabahug", initials: "EC" },
    ]);
    expect(signersOf(undefined, bundle)).toEqual([
      { role: "Treasurer", keyId: keyOf("treasurer") },
      { role: "Chair", keyId: keyOf("chair") },
    ]);
    render(<VerifyPanel verification={done} signers={signersOf(undefined, bundle)} />);
    const row = screen.getAllByTestId("W-PF-01.verdict.signer")[0];
    expect(row?.querySelector(".pf-signer__who")?.textContent).toBe("Treasurer");
    expect(row?.querySelector(".fs-avatar")).toBeNull();
  });
});

describe("no developer word in view", () => {
  it("keeps the keys document's file name and the full key ids behind IDs", () => {
    render(<VerifyPanel verification={done} signers={signers} />);
    const verdict = screen.getByTestId("W-PF-01.verdict");
    expect(developerWords(visibleText(verdict))).toEqual([]);
    expect(visibleText(verdict)).not.toContain("fs-ernesto-demo-mj2ng2");
    // Behind IDs, for a technical reader: the keys whole and where they came from.
    const details = verdict.querySelector("details.pf-verify__ids") as HTMLDetailsElement;
    details.open = true;
    expect(visibleText(verdict)).toContain("fs-ernesto-demo-mj2ng2");
    expect(visibleText(verdict)).toContain("…fairsplit-keys.json");
  });

  it("Proof after a check: every visible word is a farmer's or a judge's, and no id breaks mid-word", async () => {
    await renderConsole({ path: webRoutes.proof("2026A-r37") });
    const root = await screen.findByTestId("W-PF-01");
    await waitFor(() => expect(root.dataset.state).not.toBe("loading"));
    fireEvent.keyDown(screen.getByTestId("W-PF-01.verify.face"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("W-PF-01.verdict").dataset.state).toBe("sample"), {
      timeout: 10_000,
    });
    fireEvent.click(screen.getByTestId("W-PF-01.plate.twoKeys.toggle"));
    expect(developerWords(visibleText(root))).toEqual([]);
    // Every key id and every id in a plate's fact line is one nowrap line: printed whole, or cut in the middle.
    const ids = [...root.querySelectorAll(".pf-plate__fact .fs-t-id, .pf-keys .fs-t-id")];
    expect(ids.length).toBeGreaterThanOrEqual(7);
    // Round 5: no id beside a person.
    expect(root.querySelectorAll(".pf-signers .fs-t-id")).toHaveLength(0);
    expect(ids.filter((id) => !id.matches(".pf-id, .fs-idtext")).map((id) => id.outerHTML)).toEqual([]);
    expect(screen.getAllByTestId("W-PF-01.verdict.signer")).toHaveLength(2);
    expect(screen.getByTestId("W-PF-01.keys").querySelectorAll(".pf-keys__id")).toHaveLength(2);
  });
});

describe("the one grid, top-aligned", () => {
  const proof = readRules("src/features/proof/proof.css");
  const brand = readRules("src/features/brand/brand.css");
  const wide = { width: 1920, height: 1080, motion: "full" } as const;
  const laptop = { width: 1280, height: 800, motion: "full" } as const;

  function el(className: string, parent?: Element): Element {
    const node = document.createElement("div");
    node.className = className;
    (parent ?? document.body).append(node);
    return node;
  }

  it("lays Proof's hero row on twelve columns: the verdict card on seven, the money card on five, the checks under them", () => {
    const row = el("pf-verify");
    const card = el("pf-verify__card", row);
    const money = el("pf-card pf-money", row);
    const checks = el("pf-checks", row);
    for (const medium of [wide, laptop]) {
      expect(cascaded(proof, row, "grid-template-columns", medium)).toBe("repeat(12, minmax(0, 1fr))");
      expect(cascaded(proof, row, "column-gap", medium)).toBe("24px");
      expect(cascaded(proof, card, "grid-column", medium)).toBe("1 / span 7");
      expect(cascaded(proof, money, "grid-column", medium)).toBe("8 / -1");
      expect(cascaded(proof, checks, "grid-template-columns", medium)).toBe("subgrid");
    }
    // Nothing is centred in a tall card: the seal and the verdict start at its top edge.
    expect(cascaded(proof, card, "align-items", wide)).toBe("start");
    expect(cascaded(proof, el("pf-verify__body"), "align-content", wide)).toBe("start");
    expect(cascaded(proof, money, "align-content", wide)).toBe("start");
  });

  it("lays the brand strip on the same twelve columns: who and the facts on seven, the export on five", () => {
    const strip = el("br-strip");
    expect(cascaded(brand, strip, "grid-template-columns", wide)).toBe("repeat(12, minmax(0, 1fr))");
    expect(cascaded(brand, strip, "align-items", wide)).toBe("start");
    expect(cascaded(brand, el("br-strip__who", strip), "grid-column", wide)).toBe("1 / span 7");
    expect(cascaded(brand, el("br-strip__facts", strip), "grid-column", wide)).toBe("1 / span 7");
    expect(cascaded(brand, el("br-strip__export", strip), "grid-column", wide)).toBe("8 / -1");
  });

  it("draws a slip chip as data: the serial in ink-3, the kilos in ink", () => {
    const chip = el("pf-slipchip");
    expect(cascaded(proof, el("pf-slipchip__no fs-t-id", chip), "color", wide)).toBe("var(--fs-ink-3)");
    expect(cascaded(proof, el("pf-slipchip__kg fs-t-figure", chip), "color", wide)).toBe("var(--fs-ink)");
  });
});
