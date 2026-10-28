import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jcs, sha256Hex } from "../src/_shims/domain.js";
import { FairSplitDbError } from "../src/errors.js";
import { documents, rateCards, rateRules, seasons, slipRows, workspaces } from "../src/schema/index.js";
import { openSeedWindow } from "../src/seeding.js";
import { FIXTURE_RATIFIED_AT, fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { caught, dbError, sqlState } from "./helpers.js";

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

/** A second season (2026B) in the fixture's workspace, so a second card can be inserted for it. */
async function secondSeason(ws: { workspaceId: string; coopId: string }): Promise<string> {
  const [season] = await t.app.db
    .insert(seasons)
    .values({
      workspaceId: ws.workspaceId,
      coopId: ws.coopId,
      code: "2026B",
      label: "2026-B",
      opensOn: "2026-09-01",
      closesOn: "2026-12-31",
      currency: "USD",
      cosignBatchCents: 100n,
      cosignLineCents: 10n,
      massBalanceTolBp: 100,
      kgPerTreeMaxG: 1000,
      autoAcceptBp: 9000,
      provenance: "live",
    })
    .returning({ id: seasons.id });
  return season?.id ?? "";
}

function cardFor(ws: { workspaceId: string }, seasonId: string, code: string) {
  const canonicalJcs = jcs({ code, rules: [{ ruleId: "R0", kind: "SHARE" }] });
  return { workspaceId: ws.workspaceId, seasonId, code, canonicalJcs, sha256: sha256Hex(canonicalJcs) };
}

const CLAIMED = new Date("2026-03-14T02:00:00.000Z");
/** within a few seconds of the database's clock, i.e. not the claimed instant */
const isNow = (d: Date | null | undefined) =>
  d instanceof Date && Math.abs(d.getTime() - Date.now()) < 10_000;

describe("inv.i2.no-backdated-ratification: the database's clock says when a card was ratified", () => {
  it("inv.i2.no-backdated-ratification: ratifying with a past instant stores now(), so earlier facts stay out", async () => {
    const ws = await fixtureWorkspace(t.app.db, { ratifiedAt: false });
    const [card] = await t.app.db
      .update(rateCards)
      .set({ ratifiedAt: CLAIMED })
      .where(eq(rateCards.id, ws.rateCardId))
      .returning();
    expect(isNow(card?.ratifiedAt)).toBe(true);
    // a slip dated after the claimed day but before the real ratification is refused
    const doc = await slipDoc(ws.workspaceId, ws.seasonId);
    const e = await dbError(() => t.app.db.insert(slipRows).values(slip(ws, doc, "2026-04-02")));
    expect(e.code).toBe("RULES_BEFORE_FACTS");
  });

  it("inv.i2.no-backdated-ratification: a card inserted already ratified is stamped now as well", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const seasonId = await secondSeason(ws);
    const [card] = await t.app.db
      .insert(rateCards)
      .values({ ...cardFor(ws, seasonId, "BR 2026-B"), ratifiedAt: CLAIMED, provenance: "live" })
      .returning();
    expect(isNow(card?.ratifiedAt)).toBe(true);
  });

  it("a seed window keeps a seeded snapshot's historical instant, for seeded rows, in its own transaction only", async () => {
    // fixtureWorkspace loads like seed.loadSnapshot: inside a seed window, so 14 Mar is kept
    const judge = await fixtureWorkspace(t.app.db, { kind: "judge" });
    const [kept] = await t.app.db.select().from(rateCards).where(eq(rateCards.id, judge.rateCardId));
    expect(kept?.ratifiedAt).toEqual(FIXTURE_RATIFIED_AT);
    // a window is opened per transaction: a draft left by an earlier one is stamped now
    const draft = await fixtureWorkspace(t.app.db, { kind: "judge", ratifiedAt: false });
    const [late] = await t.app.db
      .update(rateCards)
      .set({ ratifiedAt: CLAIMED })
      .where(eq(rateCards.id, draft.rateCardId))
      .returning();
    expect(isNow(late?.ratifiedAt)).toBe(true);
    // inside a window, a row that is not labelled seeded (I8) gets the clock too
    const fresh = await fixtureWorkspace(t.app.db, { kind: "showcase", ratifiedAt: false });
    const seasonId = await secondSeason(fresh);
    const [live] = await t.app.db.transaction(async (tx) => {
      await openSeedWindow(tx, fresh.workspaceId);
      return tx
        .insert(rateCards)
        .values({ ...cardFor(fresh, seasonId, "BR 2026-B"), ratifiedAt: CLAIMED, provenance: "live" })
        .returning();
    });
    expect(isNow(live?.ratifiedAt)).toBe(true);
  });

  it("a seed window opens only for a fresh showcase or judge workspace, and only inside a transaction", async () => {
    const [real] = await t.app.db.insert(workspaces).values({ kind: "real", name: "co-op" }).returning();
    const refusedReal = await dbError(() => t.app.db.transaction((tx) => openSeedWindow(tx, real?.id ?? "")));
    expect(refusedReal).toMatchObject({ code: "SEED_REFUSED" });
    // a workspace that already has a ratified card (and so may have facts) cannot be re-seeded
    const ratified = await fixtureWorkspace(t.app.db, { kind: "judge" });
    const refusedRatified = await dbError(() =>
      t.app.db.transaction((tx) => openSeedWindow(tx, ratified.workspaceId)),
    );
    expect(refusedRatified.code).toBe("SEED_REFUSED");
    // the pool is not a transaction (the type says so too): a window must end with the load that opened it
    const pool = t.app.db as unknown as Parameters<typeof openSeedWindow>[0];
    expect(await caught(() => openSeedWindow(pool, ratified.workspaceId))).toBeInstanceOf(TypeError);
    // the window itself is owner-only state
    expect(await sqlState(() => t.app.sql`select * from fs_private.seed_tickets`)).toBe("42501");
    expect(await sqlState(() => t.app.sql`select fs_seeding(${ratified.workspaceId})`)).toBe("42501");
  });
});
