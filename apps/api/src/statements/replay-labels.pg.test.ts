import { ProofResponse } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrandView } from "../proof/brand.js";
import { loadShowcase, type ShowcaseWorld } from "../proof/testing/world.js";
import { createTestApp, type TestApp } from "../test/index.js";
import { loadStatementContext } from "./facts.js";
import type { PrintSlip } from "./print.js";
import { type StatementView, statementView } from "./view.js";

/** The replay word in each reader's language: ceb and fil machine-translated, chipped like every ceb and fil key. */
const REPLAY_WORD = {
  en: "Replayed (labelled): earlier simulated PayPal sandbox run",
  ceb: "Gi-replay (gilabelan): miaging simulated PayPal sandbox run",
  fil: "Ni-replay (may label): naunang simulated PayPal sandbox run",
} as const;

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
      expect(response.body.statusWords).toBe(REPLAY_WORD[lang]);
      expect(response.body.sms.text).toContain(REPLAY_WORD[lang]);
      if (lang !== "en") expect(response.body.sms.text).not.toMatch(/\b(?:Replayed|labelled|earlier)\b/);
      expect(response.body.sms.text).not.toMatch(/\bpaid\b|bayad na/i);
      expect(response.body.sms.fits).toBe(true);
      expect(response.body.plan).not.toHaveProperty("payout");
      const officer = await t.credentials.frameToken({ workspaceId: w.workspaceId, role: "treasurer" });
      const printed = await t.json<PrintSlip>(`/v1/print/${w.runSlug}/members/M-014?lang=${lang}`, {
        as: t.credentials.bearer(officer),
      });
      expect(printed.status).toBe(200);
      expect(printed.body.line.statusWords).toBe(response.body.statusWords);
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
    expect(view.statusWords).toMatch(/^Replayed \(labelled\)/);
    expect(view.sms.text).toContain("earlier simulated PayPal sandbox run");
  });

  it("inv.i8.reverse-envelope: this line's simulated item overrides a replay-started run", async () => {
    const where = and(
      eq(schema.payoutItems.workspaceId, w.workspaceId),
      eq(schema.payoutItems.lineId, lineId),
    );
    const stale = await loadStatementContext(t.deps.db, w.workspaceId, lineId, "en");
    if (!stale) throw new Error("missing stale context");
    expect(stale.provenance).toBe("replay");
    await t.deps.db
      .update(schema.payRuns)
      .set({ provenance: "replay" })
      .where(eq(schema.payRuns.id, w.runId));
    await t.deps.db.update(schema.payoutItems).set({ provenance: "simulated_rail" }).where(where);
    try {
      const raced = await statementView(t.deps.db, stale);
      expect(raced.provenance).toBe("simulated_rail");
      expect(raced.mobile.provenance).toBe("simulated_rail");
      expect(raced.statusWords).not.toMatch(/replay/i);
      expect(raced.sms.text).not.toMatch(/replay/i);
      const context = await loadStatementContext(t.deps.db, w.workspaceId, lineId, "en");
      expect(context?.provenance).toBe("simulated_rail");
      if (!context) throw new Error("missing context");
      const view = await statementView(t.deps.db, context);
      expect(view.provenance).toBe("simulated_rail");
      expect(view.mobile.provenance).toBe("simulated_rail");
      expect(view.statusWords).not.toMatch(/replay/i);
      expect(view.statusWords).toContain("simulated PayPal sandbox");
      expect(view.sms.text).not.toMatch(/replay/i);
    } finally {
      await t.deps.db
        .update(schema.payRuns)
        .set({ provenance: "simulated_rail" })
        .where(eq(schema.payRuns.id, w.runId));
      await t.deps.db.update(schema.payoutItems).set({ provenance: "replay" }).where(where);
    }
  });

  it.each(["replay", "simulated_rail"] as const)(
    "inv.i8.returned-outcome: %s stays distinct from the later cash decision on JSON, print and brand",
    async (provenance) => {
      const returnedApp = await createTestApp({ db: "postgres", taskHandlers: {} });
      try {
        const returnedWorld = await loadShowcase(returnedApp.deps.db, {
          lineStates: { "M-031": "RETURNED" },
        });
        const t = returnedApp;
        const w = returnedWorld;
        const returnedLineId = w.lineIds.get("M-031");
        if (!returnedLineId) throw new Error("missing returned line");
        const lineWhere = eq(schema.memberLines.id, returnedLineId);
        const itemWhere = and(
          eq(schema.payoutItems.workspaceId, w.workspaceId),
          eq(schema.payoutItems.lineId, returnedLineId),
        );
        // The cancel's RETURNED commits before the task's separate OFF_RAIL_DUE transaction.
        await t.deps.db.update(schema.payoutItems).set({ provenance }).where(itemWhere);
        const officer = await t.credentials.frameToken({ workspaceId: w.workspaceId, role: "treasurer" });
        const as = t.credentials.bearer(officer);
        for (const lang of ["en", "ceb", "fil"] as const) {
          const response = await t.json<StatementView>(`/v1/statements/${returnedLineId}?lang=${lang}`, {
            as,
          });
          expect(response.status).toBe(200);
          expect(response.body.mobile.item).toMatchObject({ status: "RETURNED", provenance });
          expect(response.body.statusWords).toMatch(
            provenance === "replay" ? REPLAY_WORD[lang] : /simulated PayPal sandbox/,
          );
          expect(response.body.sms.text).toMatch(
            provenance === "replay" ? REPLAY_WORD[lang] : /simulated PayPal sandbox/,
          );
          expect(response.body.sms.text).not.toMatch(/ready in cash|sent to your PayPal/i);
          const printed = await t.json<PrintSlip>(`/v1/print/${w.runSlug}/members/M-031?lang=${lang}`, {
            as,
          });
          expect(printed.status).toBe(200);
          expect(printed.body.line.statusWords).toBe(response.body.statusWords);
        }
        const brand = await t.json<BrandView>(`/v1/brand/${w.runSlug}`, { as });
        expect(brand.body.members.find((member) => member.memberNo === "M-031")?.stateWords).toMatch(
          provenance === "replay" ? /^Replayed \(labelled\)/ : /simulated PayPal sandbox/,
        );
        await t.deps.db
          .update(schema.memberLines)
          .set({ state: "OFF_RAIL_DUE", version: sql`${schema.memberLines.version} + 1` })
          .where(lineWhere);
        await t.deps.db.update(schema.payoutItems).set({ provenance: "replay" }).where(itemWhere);
        const cash = await t.json<StatementView>(`/v1/statements/${returnedLineId}?lang=en`, { as });
        expect(cash.body.statusWords).toBe("Ready at the bodega");
        expect(cash.body.sms.text).not.toMatch(/replay|PayPal/i);
      } finally {
        await returnedApp.close();
      }
    },
  );

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
      expect(view.body.members.find((member) => member.memberNo === "M-014")?.stateWords).toBe(
        "Replayed (labelled): earlier simulated PayPal sandbox run",
      );
      expect(view.body.members.find((member) => member.memberNo === "M-053")?.stateWords).not.toMatch(
        /replay|PayPal/i,
      );
      const csv = await t.request(`/v1/brand/${w.runSlug}/export.csv`, { as });
      expect(csv.status).toBe(200);
      const rows = (await csv.text()).trim().split(/\r?\n/).slice(1);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.split(",")[4]).toBe('"replay"');
    },
  );
});
