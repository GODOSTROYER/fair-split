// Proof and the brand view, UI gate round 5 (docs/DESIGN.md §10): one marker vocabulary (a check that held is a
// 16 px line ✓ and its word, a chain step a 24 px outlined numeral, squares only as a legend's key), provenance
// once (one id-line phrase; no legend glyph anywhere else; the "Simulated" micro-tag stays beside PayPal money), a
// noun title with a grey suffix and the run's state in one chip on the same row, and no ids for people (a signer
// reads by name and role; the key waits behind "IDs"). Every figure is the bundle's own; none changes.

import { webRoutes } from "@fairsplit/contracts";
import { tagBudget } from "@fairsplit/ui-web";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { developerWords } from "../../lib/plain.js";
import { cascaded, readRules } from "../../test/css.js";
import { renderConsole } from "../../test/index.js";
import { type SignerView, VerifyPanel } from "./Hero.js";
import type { Verification } from "./useVerification.js";
import type { VerifyOutcome } from "./verify.js";

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

const signers: SignerView[] = [
  { role: "Treasurer", keyId: "fs-analyn-demo-v9kuqr", name: "Analyn R. Sumalinog", initials: "AS" },
  { role: "Chair", keyId: "fs-ernesto-demo-mj2ng2", name: "Ernesto P. Cabahug", initials: "EC" },
];

/** What a sighted reader sees: no screen-reader-only words, nothing hidden, nothing behind a closed disclosure. */
function visibleText(root: Element): string {
  const copy = root.cloneNode(true) as Element;
  for (const el of copy.querySelectorAll(".fs-sr, [hidden], details:not([open]) > :not(summary)"))
    el.remove();
  const runs: string[] = [];
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) runs.push(node.textContent ?? "");
  return runs.join(" ").replace(/\s+/g, " ").trim();
}

const proofCss = readRules("src/features/proof/proof.css");
const wide = { width: 1920, height: 1080, motion: "full" } as const;

describe("one marker vocabulary", () => {
  it("a check that held is a 16 px line ✓ and its word in ink, never a filled disc", () => {
    render(<VerifyPanel verification={done} signers={signers} />);
    for (const row of within(screen.getByTestId("W-PF-01.checks")).getAllByRole("listitem")) {
      const check = row.querySelector(".pf-checks__state .fs-check");
      expect(check, row.dataset.plate).not.toBeNull();
      expect(check?.querySelector("svg.fs-check__tick")?.getAttribute("width")).toBe("16");
      expect(row.querySelector('.pf-checks__state [data-glyph="ms:check"]')).toBeNull();
    }
    // No rule paints a disc behind a check anywhere on Proof.
    const tick = document.createElement("span");
    tick.className = "fs-glyph";
    const state = document.createElement("span");
    state.className = "pf-checks__state";
    const row = document.createElement("li");
    row.className = "pf-checks__row";
    row.dataset.state = "matches";
    state.append(tick);
    row.append(state);
    document.body.append(row);
    try {
      expect(cascaded(proofCss, tick, "background", wide)).toBeUndefined();
      expect(cascaded(proofCss, tick, "border-radius", wide)).toBeUndefined();
    } finally {
      row.remove();
    }
  });

  it("a chain step is a 24 px outlined numeral that stays outlined once its plate matches", async () => {
    await renderConsole({ path: webRoutes.proof("2026A-r37") });
    const root = await screen.findByTestId("W-PF-01");
    await waitFor(() => expect(root.dataset.state).not.toBe("loading"));
    fireEvent.keyDown(screen.getByTestId("W-PF-01.verify.face"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("W-PF-01.verdict").dataset.state).toBe("sample"), {
      timeout: 10_000,
    });
    const plates = within(screen.getByTestId("W-PF-01.chain")).getAllByRole("listitem");
    const steps = plates.map((plate) => plate.querySelector(":scope > .fs-step"));
    expect(steps.map((s) => s?.textContent)).toEqual(["1", "2", "3", "4", "5", "6"]);
    // Each plate's check line is the same line ✓ and word.
    for (const plate of ["paid", "ratified", "read", "computed", "twoKeys"]) {
      expect(screen.getByTestId(`W-PF-01.check.${plate}`).querySelector(".fs-check")).not.toBeNull();
    }
    // A matched plate's step is never filled.
    const node = document.createElement("span");
    node.className = "fs-step pf-plate__node";
    const plate = document.createElement("li");
    plate.className = "pf-plate";
    plate.dataset.state = "matches";
    plate.append(node);
    document.body.append(plate);
    try {
      const fill = cascaded(proofCss, node, "background", wide);
      expect(fill === undefined || fill === "var(--fs-plate)" || fill === "var(--fs-ground)").toBe(true);
    } finally {
      plate.remove();
    }
  });

  it("keeps squares to a legend's key: the money card's rows use ui-web's 8 px Swatch", async () => {
    await renderConsole({ path: webRoutes.proof("2026A-r37") });
    const money = await screen.findByTestId("W-PF-01.money");
    const paid = within(money).getByTestId("proof-distribution.paypal");
    expect(paid.querySelector('.fs-swatch[data-kind="paid"]')).not.toBeNull();
    expect(
      within(money).getByTestId("proof-distribution.cash").querySelector('.fs-swatch[data-kind="cash"]'),
    ).not.toBeNull();
  });
});

describe("provenance once, a noun title, the state in one chip", () => {
  it("Proof: 'Proof 2026-A', its state chip on the row, one id-line phrase, no legend glyph anywhere", async () => {
    await renderConsole({ path: webRoutes.proof("2026A-r37") });
    const root = await screen.findByTestId("W-PF-01");
    await waitFor(() => expect(root.dataset.state).not.toBe("loading"));
    const title = document.getElementById("W-PF-01-title") as HTMLElement;
    expect(title.tagName).toBe("H1");
    expect(visibleText(title)).toBe("Proof 2026-A");
    expect(title.querySelector(".fsc-screen__suffix")?.textContent).toBe("2026-A");
    // The settled showcase run: PayPal's part is complete and the bodega's cash is due, never "Settled" or "Paid".
    const chip = screen.getByTestId("W-PF-01.status");
    expect(chip.textContent).toBe("PayPal complete · cash due");
    expect(chip.querySelector(".fs-chip")?.getAttribute("data-tone")).toBe("hatch");
    // The id line: the payer, the lot in the mono, and the page's one provenance phrase, its sentence its title.
    const phrase = screen.getByTestId("W-PF-01.synthetic");
    expect(visibleText(phrase)).toBe("Synthetic co-op");
    expect(phrase.getAttribute("title")).toMatch(/^Synthetic co-op/);
    // The invoice's amount heads the money card it adds up to.
    const amount = screen.getByTestId("W-PF-01.invoice-amount");
    expect(screen.getByTestId("W-PF-01.money").contains(amount)).toBe(true);
    expect(amount.textContent).toBe("US$4,333.50");
    // Open every plate and the IDs: still no inline legend glyph, and the tag budget holds.
    for (const plate of ["paid", "ratified", "read", "computed", "twoKeys", "payoutItems"])
      fireEvent.click(screen.getByTestId(`W-PF-01.plate.${plate}.toggle`));
    await screen.findByTestId("W-PF-01.lines");
    fireEvent.click(screen.getByTestId("W-PF-01.peso.M-014"));
    await screen.findByTestId("W-PF-01.trace.slip.0403");
    fireEvent.click(screen.getByTestId("W-PF-01.trace.slip.0403"));
    await screen.findByTestId("W-PF-01.trace.paper");
    expect(document.querySelectorAll(".fs-legend-glyph")).toHaveLength(0);
    expect(tagBudget(document.body)).toMatchObject({ ok: true });
    expect(tagBudget(document.body).micro).toBeLessThanOrEqual(2);
    // The rail is still named to a screen reader where PayPal's figures sit (I8).
    expect(screen.getByTestId("W-PF-01.plate.payoutItems.rail").textContent).toContain(
      "Simulated PayPal sandbox",
    );
    expect(screen.getByTestId("W-PF-01.metric.rails").textContent).toContain("Simulated PayPal sandbox");
    expect(screen.getByTestId("W-PF-01.fees").textContent).toContain("Simulated PayPal sandbox");
    expect(screen.getByTestId("W-PF-01.trace.paper").getAttribute("title")).toBe("Synthetic sample");
  });

  it("no ids for people: a signer reads by name and role, the key waits behind IDs", () => {
    render(<VerifyPanel verification={done} signers={signers} />);
    const rows = screen.getAllByTestId("W-PF-01.verdict.signer");
    expect(rows.map((row) => visibleText(row))).toEqual([
      "AS Analyn R. Sumalinog · Treasurer",
      "EC Ernesto P. Cabahug · Chair",
    ]);
    expect(rows[0]?.getAttribute("title")).toBe("Key fs-analyn-demo-v9kuqr");
    const verdict = screen.getByTestId("W-PF-01.verdict");
    expect(visibleText(verdict)).not.toMatch(/fs-(analyn|ernesto)/);
    expect(developerWords(visibleText(verdict))).toEqual([]);
    (verdict.querySelector("details.pf-verify__ids") as HTMLDetailsElement).open = true;
    expect(visibleText(verdict)).toContain("fs-ernesto-demo-mj2ng2");
  });

  it("brand view: one title row for the brand, the season under it, one chip on the page", async () => {
    await renderConsole({ path: "/b/fsb_0123456789abcdef.sample" });
    const root = await screen.findByTestId("W-BR-01");
    await waitFor(() => expect(root.dataset.state).toBe("progress"));
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Proof for Lantern Bay Chocolate Co.");
    expect(h1.querySelector(".fsc-screen__suffix")?.textContent).toBe("for Lantern Bay Chocolate Co.");
    const season = document.getElementById("W-PF-01-title") as HTMLElement;
    expect(season.tagName).toBe("H2");
    expect(visibleText(season)).toBe("Season 2026-A");
    expect(document.querySelectorAll(".fs-chip").length).toBe(1);
    // The payouts fact in a few words; the rail stays in its words for a screen reader.
    const payouts = screen.getByTestId("W-BR-01.payouts");
    expect(visibleText(payouts)).toBe("Payouts 7 of 8 confirmed · 1 returned, cash due");
    expect(payouts.textContent).toContain("by the simulated PayPal sandbox");
    expect(document.querySelectorAll(".fs-legend-glyph")).toHaveLength(0);
    expect(tagBudget(document.body).ok).toBe(true);
  });
});

describe("the title row uses the console's own", () => {
  it("styles Proof's head with the console's title-row classes", () => {
    const grid = readRules("src/theme/grid.css");
    const head = document.createElement("header");
    head.className = "fsc-screen__head pf-head";
    document.body.append(head);
    try {
      expect(cascaded(grid, head, "display", wide)).toBe("flex");
      expect(cascaded(grid, head, "align-items", wide)).toBe("baseline");
    } finally {
      head.remove();
    }
  });
});
