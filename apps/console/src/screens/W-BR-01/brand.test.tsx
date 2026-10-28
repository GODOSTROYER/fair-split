// W-BR-01 Proof with the brand header, entered by `/b/:token`: the token is the brand tier's credential for one
// read and never reaches the page; names and masked receivers show on screen, complete receivers only in the
// export; states loading (print beds), unpaid (a judge's run before funding), progress (through to its final
// count), mismatch (a tampered record: proof and export withheld), and error when the link is refused.

import { INVOICE_STATUS_LABELS, pickLabel } from "@fairsplit/contracts";
import { getSnapshot } from "@fairsplit/seed";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestWorld, expectNoAxeViolations, renderConsole } from "../../test/index.js";
import { gate, withHandlers } from "../../test/proof-world.js";

// A signed brand link as fs-api issues them (`/b/fsb_…`): fs-api refuses it on every acting command, so the
// brand's read must be the public-or-tiered `proof`, never `proofExport` (the console's mock refuses it too).
const TOKEN = "fsb_0123456789abcdef.sample";
/** GET /v1/proof/:runSlug only (not .json, not /export). */
const PROOF_READ = /\/v1\/proof\/[^/.]+$/;
const PATH = `/b/${TOKEN}`;

async function openBrand(options: Parameters<typeof renderConsole>[0] = {}) {
  const view = await renderConsole({ path: PATH, ...options });
  const root = await screen.findByTestId("W-BR-01");
  await waitFor(() => expect(root.dataset.state).not.toBe("loading"));
  return { view, root };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("W-BR-01 the brand's view of the season's run", () => {
  it("shows the invoice, the final count and names under the agreement, and never shows the link", async () => {
    const { view, root } = await openBrand();
    expect(root.dataset.state).toBe("progress");
    expect(document.documentElement.dataset.theme).toBe("adlaw");
    const header = screen.getByTestId("W-BR-01.header");
    expect(header.textContent).toContain("Proof for Lantern Bay Chocolate Co.");
    expect(screen.getByTestId("W-BR-01.invoice").textContent).toContain("FS-2026A-r37");
    expect(screen.getByTestId("W-BR-01.invoice").textContent).toContain(
      pickLabel(INVOICE_STATUS_LABELS.MARKED_AS_PAID, "en"),
    );
    const payouts = screen.getByTestId("W-BR-01.payouts");
    expect(payouts.hasAttribute("data-settled")).toBe(true);
    expect(payouts.textContent).toContain(
      "7 of 8 confirmed by PayPal. 1 returned to the co-op and paid in cash.",
    );

    fireEvent.click(screen.getByTestId("W-PF-01.plate.computed.toggle"));
    const line = await screen.findByTestId("W-PF-01.line.M-014");
    expect(line.textContent).toContain("Consolacion Bacus");
    expect(line.textContent).toContain("m***@members.fairsplit.example");
    // The complete receiver stays in the export (C-23).
    expect(document.body.textContent).not.toContain("m014@members.fairsplit.example");
    expect(document.body.innerHTML).not.toContain(TOKEN);
    await expectNoAxeViolations(view.container);
  });

  it("builds the CSV and JSON export in the browser", async () => {
    const blobs: Blob[] = [];
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => {
        blobs.push(blob);
        return "blob:fairsplit";
      }),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    await openBrand();
    fireEvent.click(screen.getByTestId("W-BR-01.export.csv"));
    expect(screen.getByTestId("W-BR-01.export.saved").textContent).toBe(
      "Saved fairsplit-proof-2026A-r37.csv.",
    );
    fireEvent.click(screen.getByTestId("W-BR-01.export.json"));
    expect(click).toHaveBeenCalledTimes(2);
    const csv = await blobs[0]?.text();
    expect(csv?.split("\r\n")[0]).toContain("member_no,name,rail");
    expect(csv).toContain("m014@members.fairsplit.example");
    const json = JSON.parse((await blobs[1]?.text()) ?? "{}") as { kind: string; paypalRail: string };
    expect(json.kind).toBe("fairsplit.proof.brand-export");
    expect(json.paypalRail).toBe("simulated");
  });

  it("loading: print beds until the brand tier's bundle arrives", async () => {
    const held = gate();
    const world = withHandlers(createTestWorld(), [
      http.get(PROOF_READ, async () => {
        await held.opened;
      }),
    ]);
    const view = await renderConsole({ path: PATH, world });
    const root = await screen.findByTestId("W-BR-01");
    expect(root.dataset.state).toBe("loading");
    const loading = screen.getByTestId("W-BR-01.loading");
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(loading.querySelectorAll("[data-bed]").length).toBeGreaterThanOrEqual(2);
    await expectNoAxeViolations(view.container);

    held.release();
    await waitFor(() => expect(root.dataset.state).toBe("progress"));
    expect(screen.queryByTestId("W-BR-01.loading")).toBeNull();
  });

  it("mismatch: a record edited after signing fails Verify, and the proof and the export are withheld", async () => {
    const bundle = structuredClone(getSnapshot().proof);
    const line = bundle.lines.find((l) => l.memberNo === "M-014");
    if (!line) throw new Error("the seed has M-014");
    line.netCents += 1;
    line.canonical.netCents += 1;
    const world = withHandlers(createTestWorld(), [
      http.get(PROOF_READ, () => HttpResponse.json({ bundle, provenance: "seeded", redacted: false })),
    ]);
    const { view, root } = await openBrand({ world });
    expect(root.dataset.state).toBe("progress");
    expect(screen.getByTestId("W-BR-01.export.csv")).toBeTruthy();

    fireEvent.keyDown(screen.getByTestId("W-PF-01.verify.face"), { key: "Enter" });
    await waitFor(() => expect(root.dataset.state).toBe("mismatch"), { timeout: 10_000 });
    expect(screen.getByTestId("W-BR-01.header").dataset.state).toBe("mismatch");
    expect(screen.getByTestId("W-BR-01.export.withheld").textContent).toBe(
      "Proof withheld: the record doesn't match its signatures. Exports wait until it does.",
    );
    expect(screen.queryByTestId("W-BR-01.export.csv")).toBeNull();
    expect(screen.queryByTestId("W-BR-01.export.json")).toBeNull();
    expect(screen.getByTestId("W-PF-01.withheld").textContent).toContain("Plate 4");
    expect(screen.getByTestId("W-PF-01.figures.withheld")).toBeTruthy();
    await expectNoAxeViolations(view.container);
  });

  it("error: a refused link says so and points to the public Proof", async () => {
    const world = createTestWorld();
    world.failNext("proof", "UNAUTHENTICATED");
    const { view, root } = await openBrand({ world });
    expect(root.dataset.state).toBe("error");
    expect(screen.getByTestId("W-BR-01.error").textContent).toContain("This brand link isn't valid any more");
    expect(screen.getByTestId("W-BR-01.public").getAttribute("href")).toBe("/proof/2026A-r37");
    await expectNoAxeViolations(view.container);
  });

  it("error: a link that earns only the public tier (member IDs) did not grant the brand's view", async () => {
    const bundle = getSnapshot().proof;
    const world = withHandlers(createTestWorld(), [
      http.get(PROOF_READ, () => HttpResponse.json({ bundle, provenance: "seeded", redacted: true })),
    ]);
    const { root } = await openBrand({ world });
    expect(root.dataset.state).toBe("error");
    expect(screen.queryByTestId("W-BR-01.export.csv")).toBeNull();
  });

  it("unpaid: a judge's run before funding waits for payment, with nothing to export yet", async () => {
    const view = await renderConsole({ path: PATH });
    await view.startSession();
    const root = await screen.findByTestId("W-BR-01");
    await waitFor(() => expect(root.dataset.state).toBe("unpaid"), { timeout: 10_000 });
    expect(screen.getByTestId("W-BR-01.invoice").textContent).toContain(
      "Sent to Lantern Bay. Waiting for payment.",
    );
    expect((screen.getByTestId("W-BR-01.export.csv") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("W-PF-01.none")).toBeTruthy();
    await expectNoAxeViolations(view.container);

    act(() => {
      view.world.markPaid();
    });
    await waitFor(() => expect(root.dataset.state).toBe("progress"), { timeout: 10_000 });
    expect(screen.getByTestId("W-BR-01.payouts").textContent).toContain("The payout batch isn't posted yet.");
  });
});
