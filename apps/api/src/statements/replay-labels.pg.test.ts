import { ProofResponse } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrandView } from "../proof/brand.js";
import { loadShowcase, type ShowcaseWorld } from "../proof/testing/world.js";
import { createTestApp, type TestApp } from "../test/index.js";
import { loadStatementContext } from "./facts.js";
import { type StatementView, statementView } from "./view.js";

describe("a simulator run whose payout replays", () => {
  let t: TestApp;
  let w: ShowcaseWorld;
  let lineId: string;

  beforeAll(async () => {
    t = await createTestApp({ db: "postgres", taskHandlers: {} });
    w = await loadShowcase(t.deps.db);
    lineId = w.lineIds.get("M-014") as string;
    await t.deps.db
      .update(schema.payRuns)
      .set({ provenance: "simulated_rail" })
      .where(eq(schema.payRuns.id, w.runId));
    await t.deps.db
      .update(schema.invoices)
      .set({ provenance: "simulated_rail" })
      .where(eq(schema.invoices.runId, w.runId));
    await t.deps.db
      .update(schema.payoutBatches)
      .set({ provenance: "simulated_rail" })
      .where(eq(schema.payoutBatches.id, w.batchId));
    await t.deps.db
      .update(schema.payoutItems)
      .set({ provenance: "replay" })
      .where(eq(schema.payoutItems.batchId, w.batchId));
  });
  afterAll(async () => t.close());

  it.each(["en", "ceb", "fil"] as const)(
    "inv.i8.member-replay: %s cold reads label the item's settled replay",
    async (lang) => {
      const link = t.credentials.memberLink({ workspaceId: w.workspaceId, lineId });
      const response = await t.json<StatementView>(`/v1/statements/${lineId}?lang=${lang}`, {
        as: t.credentials.bearer(link),
      });
      expect(response.status).toBe(200);
      expect(response.body.provenance).toBe("replay");
      expect(response.body.mobile.provenance).toBe("replay");
      expect(response.body.mobile.item).toMatchObject({
        status: "SUCCESS",
        provenance: "replay",
        verified: true,
      });
      expect(response.body.mobile.lineState).toBe("PAID");
      expect(response.body.mobile.history.some((event) => event.kind === "paid")).toBe(true);
      expect(response.body.reviewChip).toBe(
        lang === "en" ? null : "Machine-translated, pending native review",
      );
    },
  );

  it("inv.i8.line-provenance: a simulator item remains simulated when another member replays", async () => {
    const where = and(
      eq(schema.payoutItems.workspaceId, w.workspaceId),
      eq(schema.payoutItems.lineId, lineId),
    );
    await t.deps.db.update(schema.payoutItems).set({ provenance: "simulated_rail" }).where(where);
    try {
      const link = t.credentials.memberLink({ workspaceId: w.workspaceId, lineId });
      const response = await t.json<StatementView>(`/v1/statements/${lineId}?lang=en`, {
        as: t.credentials.bearer(link),
      });
      expect(response.body.provenance).toBe("simulated_rail");
      expect(response.body.mobile.provenance).toBe("simulated_rail");
      expect(response.body.mobile.item).toMatchObject({ status: "PENDING", verified: false });
    } finally {
      await t.deps.db.update(schema.payoutItems).set({ provenance: "replay" }).where(where);
    }
  });

  it("inv.i8.statement-read-race: a replay item arriving after context lookup labels the whole response", async () => {
    const where = and(
      eq(schema.payoutItems.workspaceId, w.workspaceId),
      eq(schema.payoutItems.lineId, lineId),
    );
    await t.deps.db.update(schema.payoutItems).set({ provenance: "simulated_rail" }).where(where);
    const context = await loadStatementContext(t.deps.db, w.workspaceId, lineId, "en");
    await t.deps.db.update(schema.payoutItems).set({ provenance: "replay" }).where(where);
    if (!context) throw new Error("missing statement context");
    expect(context.provenance).toBe("simulated_rail");
    // POST settled its replay while readableStatement's context was already in flight.
    const view = await statementView(t.deps.db, context);
    expect(view.mobile.item).toMatchObject({ status: "SUCCESS", provenance: "replay" });
    expect(view.mobile.provenance).toBe("replay");
    expect(view.provenance).toBe("replay");
  });

  it.each(["simulated_rail", "seeded"] as const)(
    "inv.i8.proof-export: %s envelope with replay payouts exports as replay",
    async (provenance) => {
      await t.deps.db.update(schema.payRuns).set({ provenance }).where(eq(schema.payRuns.id, w.runId));
      await t.deps.db.update(schema.invoices).set({ provenance }).where(eq(schema.invoices.runId, w.runId));
      const link = t.credentials.brandLink({ workspaceId: w.workspaceId });
      const as = t.credentials.bearer(link);
      const proof = await t.json<unknown>(`/v1/proof/${w.runSlug}`, { as });
      expect(proof.status).toBe(200);
      expect(ProofResponse.parse(proof.body).provenance).toBe("replay");
      const view = await t.json<BrandView>(`/v1/brand/${w.runSlug}`, { as });
      expect(view.status).toBe(200);
      expect(view.body.provenance).toBe("replay");
      const csv = await t.request(`/v1/brand/${w.runSlug}/export.csv`, { as });
      expect(csv.status).toBe(200);
      const rows = (await csv.text()).trim().split(/\r?\n/).slice(1);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.split(",")[4]).toBe('"replay"');
    },
  );
});
