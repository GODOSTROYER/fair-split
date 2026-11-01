// The brand view and its CSV export (C-23): names and masked receivers; names and
// plots only in the brand's own export; formula-looking text neutralised; read only by the brand (link or
// persona) and the co-op's officers, in the run's own workspace.
import type { ApiError } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { getFigures, getMembers, getRun } from "@fairsplit/seed";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BrandView, csvText } from "../../proof/brand.js";
import { loadShowcase, must, type ShowcaseWorld } from "../../proof/testing/world.js";
import { createTestApp, type TestApp } from "../../test/index.js";

let t: TestApp;
let w: ShowcaseWorld;
let link: string;

beforeAll(async () => {
  t = await createTestApp({ db: "postgres" });
  w = await loadShowcase(t.deps.db);
  link = t.credentials.brandLink({ workspaceId: w.workspaceId });
});
afterAll(async () => t.close());

describe("GET /v1/brand/:runSlug", () => {
  it("shows names, totals and masked receivers to the brand's link; never a full receiver", async () => {
    const r = await t.json<BrandView>(`/v1/brand/${w.runSlug}`, { as: t.credentials.bearer(link) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const v = r.body;
    const f = getFigures();
    expect(v.brand).toBe("Lantern Bay Chocolate Co.");
    expect(v.totals).toMatchObject({
      members: f.members,
      net: { cents: f.netCents },
      paypalMembers: f.endPaidMembers,
      paypal: { cents: f.endPaidCents },
      cashMembers: f.endCashMembers,
      cash: { cents: f.endCashCents },
    });
    expect(v.invoice).toMatchObject({
      invoiceNumber: `FS-${w.runSlug}`,
      statusWords: "Marked as paid in sandbox",
      payerViewUrl: null,
    });
    expect(v.proofReady).toBe(true);
    const m014 = must(v.members.find((m) => m.memberNo === "M-014"));
    const member = must(getMembers().find((m) => m.memberNo === "M-014"));
    expect(m014).toMatchObject({
      name: member.displayName,
      receiverMasked: member.receiverMasked,
      itemStatus: "SUCCESS",
    });
    const text = JSON.stringify(v);
    for (const it of getRun().items) expect(text).not.toContain(it.receiver);
    expect(v.exportPath).toBe(`/v1/brand/${w.runSlug}/export.csv`);
  });

  it("before posting it is the invoice (W-PF-02 unpaid): the payer view link, no Proof yet", async () => {
    const fx = await t.fixture({ withRun: true, runState: "INVOICED" });
    const runId = must(fx.runId);
    await t.deps.db.insert(schema.invoices).values({
      workspaceId: fx.workspaceId,
      runId,
      paypalInvoiceId: "INV2-TEST-UNPAID",
      invoiceNumber: "FS-UNPAID-TEST",
      status: "UNPAID",
      amountCents: 1000n,
      dueCents: 1000n,
      currency: "USD",
      payerViewUrl: "https://www.sandbox.paypal.com/invoice/p/#INV2-TEST-UNPAID",
      provenance: "simulated_rail",
    });
    const [run] = await t.deps.db
      .select({ slug: schema.payRuns.runSlug })
      .from(schema.payRuns)
      .where(eq(schema.payRuns.id, runId));
    const brand = t.credentials.brandLink({ workspaceId: fx.workspaceId });
    const r = await t.json<BrandView>(`/v1/brand/${must(run).slug}`, { as: t.credentials.bearer(brand) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({
      proofReady: false,
      invoice: {
        status: "UNPAID",
        statusWords: "Waiting for payment",
        payerViewUrl: "https://www.sandbox.paypal.com/invoice/p/#INV2-TEST-UNPAID",
      },
      members: [],
    });
    expect((await t.json(`/v1/proof/${must(run).slug}`)).status).toBe(404);
  });

  it("the brand persona, the treasurer and a judge read it in their own workspace", async () => {
    for (const [role, persona] of [
      ["brand", "dana"],
      ["treasurer", "analyn"],
    ] as const) {
      const tk = await t.credentials.frameToken({ workspaceId: w.workspaceId, role, persona });
      expect((await t.json(`/v1/brand/${w.runSlug}`, { as: t.credentials.bearer(tk) })).status, role).toBe(
        200,
      );
    }
    const judge = t.credentials.judgeCookie({ workspaceId: w.workspaceId });
    expect((await t.json(`/v1/brand/${w.runSlug}`, { as: t.credentials.judge(judge) })).status).toBe(200);
  });

  it("refuses: no credential 401, the clerk or a member link 403, another workspace's brand link 404", async () => {
    expect((await t.json<ApiError>(`/v1/brand/${w.runSlug}`)).status).toBe(401);
    const clerk = await t.credentials.frameToken({
      workspaceId: w.workspaceId,
      role: "clerk",
      persona: "jessie",
    });
    expect(
      (await t.json<ApiError>(`/v1/brand/${w.runSlug}`, { as: t.credentials.bearer(clerk) })).status,
    ).toBe(403);
    const member = t.credentials.memberLink({
      workspaceId: w.workspaceId,
      lineId: must(w.lineIds.get("M-014")),
    });
    expect(
      (await t.json<ApiError>(`/v1/brand/${w.runSlug}`, { as: t.credentials.bearer(member) })).status,
    ).toBe(403);
    const other = t.credentials.brandLink({ workspaceId: (await t.fixture()).workspaceId });
    const r = await t.json<ApiError>(`/v1/brand/${w.runSlug}`, { as: t.credentials.bearer(other) });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("NOT_FOUND");
  });

  it("compares workspaces as UUIDs, as the Proof's tiers do: a link naming its workspace in capitals still reads it", async () => {
    const upper = t.credentials.brandLink({ workspaceId: w.workspaceId.toUpperCase() });
    const view = await t.json<BrandView>(`/v1/brand/${w.runSlug}`, { as: t.credentials.bearer(upper) });
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    const csv = await t.request(`/v1/brand/${w.runSlug}/export.csv`, { as: t.credentials.bearer(upper) });
    expect(csv.status).toBe(200);
    const proof = await t.json(`/v1/proof/${w.runSlug}`, { as: t.credentials.bearer(upper) });
    expect(proof.headers.get("x-fs-proof-tier")).toBe("full");
  });
});

describe("GET /v1/brand/:runSlug/export.csv", () => {
  it("exports every line with names, masked receivers and hashes, UTF-8 with a BOM, as a download", async () => {
    const r = await t.request(`/v1/brand/${w.runSlug}/export.csv`, { as: t.credentials.bearer(link) });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(r.headers.get("content-disposition")).toBe(`attachment; filename="FS-${w.runSlug}.brand.csv"`);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    // (Response.text() drops the byte-order mark, as a UTF-8 decoder must)
    const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).slice(1);
    const rows = csv.trimEnd().split("\r\n");
    expect(rows[0]).toMatch(/^member_no,name,language,rail,provenance,/);
    expect(rows).toHaveLength(getFigures().members + 1);
    for (const it of getRun().items) expect(csv).not.toContain(it.receiver);
    const pacana = getMembers().find((m) => m.displayName.includes("ñ"));
    if (pacana) expect(csv).toContain(pacana.displayName);
    const m014 = must(rows.find((x) => x.startsWith('"M-014"')));
    expect(m014).toContain('"Simulated PayPal sandbox","seeded"');
    expect(m014).toContain(`"${must(getMembers().find((m) => m.memberNo === "M-014")).receiverMasked}"`);
    const cash = must(rows.find((x) => x.startsWith('"M-031"')));
    expect(cash).toContain('"cash","seeded"');
    expect(m014).toContain(
      `"${(must(getRun().items.find((i) => i.memberNo === "M-014")).amountCents / 100).toFixed(2)}"`,
    );
  });

  it("neutralises text a spreadsheet would run as a formula (CSV injection)", async () => {
    expect(csvText('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvText("+63 912")).toBe('"\'+63 912"');
    expect(csvText("Nang Celing")).toBe('"Nang Celing"');
    await must(t.pg)
      .owner.db.update(schema.members)
      .set({ displayName: "=cmd|' /C calc'!A0" })
      .where(and(eq(schema.members.workspaceId, w.workspaceId), eq(schema.members.memberNo, "M-001")));
    const csv = await (
      await t.request(`/v1/brand/${w.runSlug}/export.csv`, { as: t.credentials.bearer(link) })
    ).text();
    expect(csv).toContain(`"'=cmd|' /C calc'!A0"`);
    expect(csv).not.toMatch(/,"=cmd/);
  });

  it("the same readers only: 401 without a credential, 403 for a member link", async () => {
    expect((await t.request(`/v1/brand/${w.runSlug}/export.csv`)).status).toBe(401);
    const member = t.credentials.memberLink({
      workspaceId: w.workspaceId,
      lineId: must(w.lineIds.get("M-014")),
    });
    expect(
      (await t.request(`/v1/brand/${w.runSlug}/export.csv`, { as: t.credentials.bearer(member) })).status,
    ).toBe(403);
  });
});

describe("before the Proof exists the brand view is the invoice only (C-23)", () => {
  // Member lines, names, receivers and the CSV are the Proof's: they exist for the brand only once the batch is
  // posted (proofReady). Until then the view is the invoice (W-PF-02) and the export is refused.
  const BEFORE_PROOF = [
    "DRAFT",
    "QUOTED",
    "INVOICED",
    "FUNDED",
    "EXTRACTING",
    "COMPUTED",
    "IN_REVIEW",
    "TREASURER_APPROVED",
    "AWAITING_BOARD",
    "APPROVED",
    "CANCELLED",
    "HALTED",
  ] as const;

  /** A run in `runState` with two computed member lines (names and money), no batch. */
  async function runWithLines(runState: (typeof BEFORE_PROOF)[number]) {
    const fx = await t.fixture({ withRun: true, runState, members: 2 });
    const runId = must(fx.runId);
    for (const memberId of fx.memberIds) {
      await must(t.pg).owner.db.insert(schema.memberLines).values({
        workspaceId: fx.workspaceId,
        runId,
        memberId,
        state: "READY",
        rail: "ON",
        currency: "USD",
        verifiedG: 1000n,
        grade1G: 1000n,
        premiumCents: 3000n,
        bonusCents: 1500n,
        deductionsCents: 131n,
        creditsCents: 0n,
        netCents: 4369n,
        deductions: [],
        provenance: "seeded",
      });
    }
    const [run] = await t.deps.db
      .select({ slug: schema.payRuns.runSlug })
      .from(schema.payRuns)
      .where(eq(schema.payRuns.id, runId));
    return { workspaceId: fx.workspaceId, runSlug: must(run).slug };
  }

  for (const runState of BEFORE_PROOF) {
    it(`${runState}: no member, name or amount in the view, zero totals, and the CSV is refused`, async () => {
      const r = await runWithLines(runState);
      const brand = t.credentials.bearer(t.credentials.brandLink({ workspaceId: r.workspaceId }));
      const view = await t.json<BrandView>(`/v1/brand/${r.runSlug}`, { as: brand });
      expect(view.status, JSON.stringify(view.body)).toBe(200);
      expect(view.body).toMatchObject({
        runState,
        proofReady: false,
        members: [],
        totals: {
          members: 0,
          net: { cents: 0 },
          paypalMembers: 0,
          paypal: { cents: 0 },
          cashMembers: 0,
          cash: { cents: 0 },
        },
        hashes: { batchSha256: null, ledgerHead: null },
      });
      expect(JSON.stringify(view.body)).not.toContain("Fixture Member");
      const csv = await t.request(`/v1/brand/${r.runSlug}/export.csv`, { as: brand });
      expect(csv.status).toBe(404);
      const refused = (await csv.json()) as ApiError;
      expect(refused).toMatchObject({ code: "NOT_FOUND", details: { reason: "PROOF_NOT_READY", runState } });
    });
  }

  it("the same holds for the officers' brand view (treasurer) before posting", async () => {
    const r = await runWithLines("APPROVED");
    const tk = await t.credentials.frameToken({
      workspaceId: r.workspaceId,
      role: "treasurer",
      persona: "analyn",
    });
    const view = await t.json<BrandView>(`/v1/brand/${r.runSlug}`, { as: t.credentials.bearer(tk) });
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ proofReady: false, members: [], totals: { members: 0 } });
    const csv = await t.request(`/v1/brand/${r.runSlug}/export.csv`, { as: t.credentials.bearer(tk) });
    expect(csv.status).toBe(404);
  });
});
