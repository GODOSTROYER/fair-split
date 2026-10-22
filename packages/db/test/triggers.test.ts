import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jcs, sha256Hex } from "../src/_shims/domain.js";
import { FairSplitDbError } from "../src/errors.js";
import { documents, rateCards, rateRules, slipRows } from "../src/schema/index.js";
import { FIXTURE_RATIFIED_AT, fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { dbError, sqlState } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb();
});
afterAll(async () => {
  await t?.close();
});

async function slipDoc(workspaceId: string, seasonId: string): Promise<string> {
  const [d] = await t.owner.db
    .insert(documents)
    .values({
      workspaceId,
      seasonId,
      kind: "slip_photo",
      sha256: sha256Hex(`${workspaceId}:${Math.random()}`),
      storage: "static",
      path: "photos/B.webp",
      byteSize: 1,
      mime: "image/webp",
      provenance: "seeded",
    })
    .returning({ id: documents.id });
  return d?.id ?? "";
}

function slip(
  ws: { workspaceId: string; seasonId: string },
  documentId: string,
  date: string,
  serial = "0403",
) {
  return {
    workspaceId: ws.workspaceId,
    seasonId: ws.seasonId,
    documentId,
    serial,
    rowNo: 1,
    slipDate: date,
    netG: 38_450n,
    state: "AUTO_ACCEPTED" as const,
    provenance: "seeded" as const,
  };
}

describe("inv.i2.rules-before-facts: a ratified rate card is bolted (MM-4)", () => {
  it("inv.i2.card-update: UPDATE of a ratified card raises RATE_CARD_RATIFIED citing the hash", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const e = await dbError(() =>
      t.app.db.update(rateCards).set({ code: "BR 2026-99" }).where(eq(rateCards.id, ws.rateCardId)),
    );
    expect(e).toBeInstanceOf(FairSplitDbError);
    expect(e.code).toBe("RATE_CARD_RATIFIED");
    expect(e.subject).toBe(ws.rateCardSha256);
    expect(e.httpStatus).toBe(409);
  });

  it("inv.i2.card-delete: DELETE of a ratified card is refused, even for the owner", async () => {
    const ws = await fixtureWorkspace(t.owner.db);
    const e = await dbError(() => t.owner.db.delete(rateCards).where(eq(rateCards.id, ws.rateCardId)));
    expect(e.code).toBe("RATE_CARD_RATIFIED");
  });

  it("inv.i2.no-new-deduction: adding a rule to a ratified card is refused with the card hash", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const e = await dbError(() =>
      t.app.db.insert(rateRules).values({
        workspaceId: ws.workspaceId,
        rateCardId: ws.rateCardId,
        ruleId: "R9",
        kind: "DEDUCTION",
        category: "other",
        basis: "FLAT_PER_SEASON",
        params: { flatCents: 1 },
        sourceQuote: "Iba pa (Other)",
        provenance: "live",
      }),
    );
    expect(e.code).toBe("RATE_CARD_RATIFIED");
    expect(e.subject).toBe(ws.rateCardSha256);
  });

  it("inv.i2.rules-frozen: updating or deleting an existing rule of a ratified card is refused", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    expect(
      (
        await dbError(() =>
          t.app.db.update(rateRules).set({ category: "x" }).where(eq(rateRules.rateCardId, ws.rateCardId)),
        )
      ).code,
    ).toBe("RATE_CARD_RATIFIED");
    expect(
      (await dbError(() => t.app.db.delete(rateRules).where(eq(rateRules.rateCardId, ws.rateCardId)))).code,
    ).toBe("RATE_CARD_RATIFIED");
  });

  it("a draft card can be edited and then ratified once; un-ratifying is refused", async () => {
    const ws = await fixtureWorkspace(t.app.db, { ratifiedAt: false });
    const card = { code: "BR TEST", rules: [{ ruleId: "R0" }, { ruleId: "R1" }] };
    await t.app.db
      .update(rateCards)
      .set({ canonicalJcs: jcs(card), sha256: sha256Hex(jcs(card)) })
      .where(eq(rateCards.id, ws.rateCardId));
    await t.app.db.update(rateCards).set({ ratifiedAt: new Date() }).where(eq(rateCards.id, ws.rateCardId));
    const e = await dbError(() =>
      t.app.db.update(rateCards).set({ ratifiedAt: null }).where(eq(rateCards.id, ws.rateCardId)),
    );
    expect(e.code).toBe("RATE_CARD_RATIFIED");
  });

  it("the stored hash must be the sha256 of the stored canonical JSON", async () => {
    const ws = await fixtureWorkspace(t.app.db, { ratifiedAt: false });
    expect(
      await sqlState(() =>
        t.app.db
          .update(rateCards)
          .set({ canonicalJcs: '{"tampered":true}' })
          .where(eq(rateCards.id, ws.rateCardId)),
      ),
    ).toBe("23514");
  });
});

describe("inv.i2.rules-before-facts: no slip row before (or dated before) ratification", () => {
  it("inv.i2.no-card: a slip row for a season without a ratified card is refused (FS422)", async () => {
    const ws = await fixtureWorkspace(t.app.db, { ratifiedAt: false });
    const doc = await slipDoc(ws.workspaceId, ws.seasonId);
    const e = await dbError(() => t.app.db.insert(slipRows).values(slip(ws, doc, "2026-04-02")));
    expect(e.code).toBe("RULES_BEFORE_FACTS");
    expect(e.httpStatus).toBe(422);
  });

  it("inv.i2.dated-before: a slip dated before the ratification day (co-op time zone) is refused", async () => {
    const ws = await fixtureWorkspace(t.app.db); // ratified 2026-03-14T02:00Z = 10:00 on 14 Mar in Manila
    const doc = await slipDoc(ws.workspaceId, ws.seasonId);
    const e = await dbError(() => t.app.db.insert(slipRows).values(slip(ws, doc, "2026-03-13")));
    expect(e.code).toBe("RULES_BEFORE_FACTS");
    expect(e.subject).toContain("2026-03-13");
    // the ratification day itself, and later days, are accepted
    await t.app.db.insert(slipRows).values(slip(ws, doc, "2026-03-14", "0301"));
    await t.app.db.insert(slipRows).values(slip(ws, doc, "2026-04-02", "0302"));
  });

  it("uses the season's zone, not the server's: 23:30 UTC on 13 Mar is already 14 Mar in Manila", async () => {
    const ws = await fixtureWorkspace(t.app.db, { ratifiedAt: new Date("2026-03-13T23:30:00Z") });
    const doc = await slipDoc(ws.workspaceId, ws.seasonId);
    expect((await dbError(() => t.app.db.insert(slipRows).values(slip(ws, doc, "2026-03-13")))).code).toBe(
      "RULES_BEFORE_FACTS",
    );
    await t.app.db.insert(slipRows).values(slip(ws, doc, "2026-03-14"));
  });

  it("inv.i2.redate: moving an accepted slip's date before ratification is refused", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const doc = await slipDoc(ws.workspaceId, ws.seasonId);
    const [row] = await t.app.db
      .insert(slipRows)
      .values(slip(ws, doc, "2026-04-02"))
      .returning();
    const e = await dbError(() =>
      t.app.db
        .update(slipRows)
        .set({ slipDate: "2026-03-01" })
        .where(eq(slipRows.id, row?.id ?? "")),
    );
    expect(e.code).toBe("RULES_BEFORE_FACTS");
    // other columns of the same row stay editable
    await t.app.db
      .update(slipRows)
      .set({ state: "CONFIRMED" })
      .where(eq(slipRows.id, row?.id ?? ""));
  });

  it("inv.i2.written-before: a card ratified in the future cannot have facts yet", async () => {
    const ws = await fixtureWorkspace(t.app.db, { ratifiedAt: new Date(Date.now() + 3_600_000) });
    const doc = await slipDoc(ws.workspaceId, ws.seasonId);
    expect((await dbError(() => t.app.db.insert(slipRows).values(slip(ws, doc, "2099-01-01")))).code).toBe(
      "RULES_BEFORE_FACTS",
    );
  });

  it("the fixture's ratification instant is what the cases above assume", () => {
    expect(FIXTURE_RATIFIED_AT.toISOString()).toBe("2026-03-14T02:00:00.000Z");
  });
});
