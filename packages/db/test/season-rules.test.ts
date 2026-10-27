/**
 * inv.i2.season-rules-frozen (review major, schema/coop.ts). Register §2: the ratified rate card carries the Chair's
 * co-sign thresholds (any batch over US$300, any line over US$150), the ±2.0% mass-balance tolerance, the yield limit
 * and auto-accept at 0.85, and the schema keeps them on `seasons`. Only rate_cards and rate_rules were bolted, so after
 * ratification a season UPDATE could raise the co-sign threshold until a large batch skipped AWAITING_BOARD, lower
 * auto-accept, or move `tz`, and with it the ratification day that fs_slip_rows_guard compares slip dates against.
 * Now (migrations/0008):
 *   1. the database refuses any change to a season's terms once its card is ratified, for every role
 *      (FS409 RATE_CARD_RATIFIED citing the card's hash); only the purge steps past it;
 *   2. `repos(scope).seasons.update` cannot write the terms at all (a compile error and GuardedColumnError);
 *      `seasons.setRules()` writes them while the card is a draft;
 *   3. a change and a ratification never interleave: whichever starts first, the other waits for it.
 */
import { eq, getTableColumns, sql } from "drizzle-orm";
import type { Sql, TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jcs, sha256Hex } from "../src/_shims/domain.js";
import { asDbError, FairSplitDbError } from "../src/errors.js";
import { GuardedColumnError, repos, type SeasonRuleColumn } from "../src/repos/index.js";
import { documents, rateCards, SEASON_RULE_COLUMNS, seasons, slipRows } from "../src/schema/index.js";
import { type FixtureWorkspace, fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { caught, dbError, scopeOf, sleep } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb({ max: 8 });
});
afterAll(async () => {
  await t?.close();
});

type SeasonInsert = typeof seasons.$inferInsert;

/**
 * A different value for every term (the fixture has USD, 2026-04-01…2026-08-31, Asia/Manila, 100/10 cents, 100 bp,
 * 1000 g, 9000 bp): what a "tweak" after ratification would write. The type requires one per SEASON_RULE_COLUMNS
 * member, so a new term cannot be added without a case here.
 */
const TWEAKS = {
  tz: "America/Los_Angeles",
  currency: "PHP",
  opensOn: "2026-03-01",
  closesOn: "2026-12-31",
  /** above any batch: AWAITING_BOARD would never be needed */
  cosignBatchCents: 100_000_000n,
  cosignLineCents: 100_000_000n,
  massBalanceTolBp: 10_000,
  kgPerTreeMaxG: 1_000_000,
  /** every read would be auto-accepted */
  autoAcceptBp: 0,
} satisfies { [K in SeasonRuleColumn]-?: NonNullable<SeasonInsert[K]> };

const COLUMNS = getTableColumns(seasons);
const sqlName = (c: SeasonRuleColumn) => COLUMNS[c].name;
const tweak = (c: SeasonRuleColumn) => ({ [c]: TWEAKS[c] }) as Partial<SeasonInsert>;

async function seasonRow(id: string) {
  const [row] = await t.owner.db.select().from(seasons).where(eq(seasons.id, id));
  if (!row) throw new Error(`season ${id} not found`);
  return row;
}

/** A second season (2026B) in the fixture's workspace, with no rate card yet. */
async function cardlessSeason(ws: FixtureWorkspace): Promise<string> {
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

function cardJcs(code: string) {
  const canonicalJcs = jcs({ code, rules: [{ ruleId: "R0", kind: "SHARE" }] });
  return { canonicalJcs, sha256: sha256Hex(canonicalJcs) };
}

async function slipDoc(ws: FixtureWorkspace): Promise<string> {
  const [d] = await t.owner.db
    .insert(documents)
    .values({
      workspaceId: ws.workspaceId,
      seasonId: ws.seasonId,
      kind: "slip_photo",
      sha256: sha256Hex(`${ws.workspaceId}:${Math.random()}`),
      storage: "static",
      path: "photos/B.webp",
      byteSize: 1,
      mime: "image/webp",
      provenance: "seeded",
    })
    .returning({ id: documents.id });
  return d?.id ?? "";
}

describe("inv.i2.season-rules-frozen: a ratified card freezes its season's terms", () => {
  it("inv.i2.season-rules-frozen: every term change is refused for fs_app and the owner, citing the card hash", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const before = await seasonRow(ws.seasonId);
    expect(Object.keys(TWEAKS).sort()).toEqual([...SEASON_RULE_COLUMNS].sort());
    for (const role of [t.app, t.owner]) {
      for (const col of SEASON_RULE_COLUMNS) {
        const e = await dbError(() =>
          role.db.update(seasons).set(tweak(col)).where(eq(seasons.id, ws.seasonId)),
        );
        expect(e).toBeInstanceOf(FairSplitDbError);
        expect(e.code).toBe("RATE_CARD_RATIFIED");
        expect(e.subject).toBe(ws.rateCardSha256);
        expect(e.httpStatus).toBe(409);
        expect(e.detail).toContain(sqlName(col));
      }
    }
    // all at once: the detail names each term
    const all = await dbError(() => t.app.db.update(seasons).set(TWEAKS).where(eq(seasons.id, ws.seasonId)));
    expect(all.code).toBe("RATE_CARD_RATIFIED");
    for (const col of SEASON_RULE_COLUMNS) expect(all.detail).toContain(sqlName(col));
    expect(await seasonRow(ws.seasonId)).toEqual(before);
  });

  it("inv.i2.season-rules-frozen: the zone cannot move, so the ratification day stays and backdated slips stay out", async () => {
    // ratified 2026-03-14T02:00Z: 10:00 on 14 Mar in Manila, but still 19:00 on 13 Mar in Los Angeles
    const ws = await fixtureWorkspace(t.app.db);
    const doc = await slipDoc(ws);
    const moved = await dbError(() =>
      t.app.db.update(seasons).set({ tz: "America/Los_Angeles" }).where(eq(seasons.id, ws.seasonId)),
    );
    expect(moved.code).toBe("RATE_CARD_RATIFIED");
    const slip = await dbError(() =>
      t.app.db.insert(slipRows).values({
        workspaceId: ws.workspaceId,
        seasonId: ws.seasonId,
        documentId: doc,
        serial: "0403",
        rowNo: 1,
        slipDate: "2026-03-13",
        netG: 38_450n,
        state: "AUTO_ACCEPTED",
        provenance: "seeded",
      }),
    );
    expect(slip.code).toBe("RULES_BEFORE_FACTS");
    expect(slip.subject).toContain("2026-03-14");
  });

  it("the label stays editable, and writing a term's current value again is not a change", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const before = await seasonRow(ws.seasonId);
    const unchanged = Object.fromEntries(
      SEASON_RULE_COLUMNS.map((c) => [c, before[c]]),
    ) as Partial<SeasonInsert>;
    const [row] = await t.app.db
      .update(seasons)
      .set({ ...unchanged, label: "2026-A main crop" })
      .where(eq(seasons.id, ws.seasonId))
      .returning();
    expect(row).toEqual({ ...before, label: "2026-A main crop" });
  });

  it("before ratification the terms are open: on a draft card's season, or one with no card yet", async () => {
    const ws = await fixtureWorkspace(t.app.db, { ratifiedAt: false });
    const [row] = await t.app.db
      .update(seasons)
      .set({ cosignBatchCents: 30_000n, autoAcceptBp: 8_500, tz: "Asia/Manila" })
      .where(eq(seasons.id, ws.seasonId))
      .returning();
    expect(row).toMatchObject({ cosignBatchCents: 30_000n, autoAcceptBp: 8_500 });
    const cardless = await cardlessSeason(ws);
    await t.app.db.update(seasons).set(TWEAKS).where(eq(seasons.id, cardless));
    expect(await seasonRow(cardless)).toMatchObject(TWEAKS);
    // the moment the card is ratified its season closes
    await t.app.db.update(rateCards).set({ ratifiedAt: new Date() }).where(eq(rateCards.id, ws.rateCardId));
    const e = await dbError(() =>
      t.app.db.update(seasons).set({ cosignBatchCents: 1n }).where(eq(seasons.id, ws.seasonId)),
    );
    expect(e).toMatchObject({ code: "RATE_CARD_RATIFIED", subject: ws.rateCardSha256 });
  });
});

describe("inv.i2.season-rules-frozen: only seasons.setRules() writes the terms, and only before ratification", () => {
  it("seasons.update refuses every term at runtime and in its type, and writes nothing", async () => {
    // a draft card: even then the generic update is not the way to change a term
    const ws = await fixtureWorkspace(t.app.db, { ratifiedAt: false });
    const r = repos(scopeOf(ws.workspaceId));
    const before = await seasonRow(ws.seasonId);
    const attempts: Array<() => Promise<unknown>> = [
      // @ts-expect-error the co-sign threshold is a term of the rate card
      () => r.seasons.update(t.app.db, ws.seasonId, { cosignBatchCents: 1n }),
      // @ts-expect-error so is auto-accept
      () => r.seasons.update(t.app.db, ws.seasonId, { autoAcceptBp: 0 }),
      // @ts-expect-error the zone decides the ratification day
      () => r.seasons.update(t.app.db, ws.seasonId, { tz: "America/Los_Angeles", label: "x" }),
    ];
    for (const attempt of attempts) {
      const e = await caught(attempt);
      expect(e).toBeInstanceOf(GuardedColumnError);
      expect((e as GuardedColumnError).message).toMatch(/seasons\.setRules\(\)/);
    }
    for (const col of SEASON_RULE_COLUMNS) {
      const e = await caught(() => r.seasons.update(t.app.db, ws.seasonId, tweak(col) as never));
      expect(e).toBeInstanceOf(GuardedColumnError);
      expect((e as GuardedColumnError).columns).toEqual([col]);
    }
    expect(await seasonRow(ws.seasonId)).toEqual(before);
    // every other column stays patchable
    expect((await r.seasons.update(t.app.db, ws.seasonId, { label: "2026-A main crop" }))?.label).toBe(
      "2026-A main crop",
    );
  });

  it("seasons.setRules writes the terms while the card is a draft and throws RATE_CARD_RATIFIED after", async () => {
    const ws = await fixtureWorkspace(t.app.db, { ratifiedAt: false });
    const r = repos(scopeOf(ws.workspaceId));
    const terms = {
      cosignBatchCents: 30_000n,
      cosignLineCents: 15_000n,
      massBalanceTolBp: 200,
      kgPerTreeMaxG: 1_600,
      autoAcceptBp: 8_500,
    };
    expect(await r.seasons.setRules(t.app.db, ws.seasonId, terms)).toMatchObject(terms);
    await t.app.db.update(rateCards).set({ ratifiedAt: new Date() }).where(eq(rateCards.id, ws.rateCardId));
    const e = await caught(() =>
      r.seasons.setRules(t.app.db, ws.seasonId, { cosignBatchCents: 100_000_000n }),
    );
    expect(e).toBeInstanceOf(FairSplitDbError);
    expect(e).toMatchObject({ code: "RATE_CARD_RATIFIED", subject: ws.rateCardSha256 });
    expect((e as FairSplitDbError).httpStatus).toBe(409);
    expect(await seasonRow(ws.seasonId)).toMatchObject(terms);
    // inside the caller's transaction the refusal surfaces the same way
    const inTx = await caught(() =>
      t.app.db.transaction((tx) => r.seasons.setRules(tx, ws.seasonId, { autoAcceptBp: 0 })),
    );
    expect(inTx).toMatchObject({ code: "RATE_CARD_RATIFIED" });
    // an empty patch only reads; a column that is not a term is not setRules' to write
    expect(await r.seasons.setRules(t.app.db, ws.seasonId, {})).toMatchObject(terms);
    expect(
      await caught(() => r.seasons.setRules(t.app.db, ws.seasonId, { label: "x" } as never)),
    ).toBeInstanceOf(TypeError);
  });

  it("seasons.setRules stays in its scope: another workspace's season is neither found nor written", async () => {
    const mine = await fixtureWorkspace(t.app.db, { ratifiedAt: false });
    const theirs = await fixtureWorkspace(t.app.db, { ratifiedAt: false });
    const r = repos(scopeOf(mine.workspaceId));
    expect(await r.seasons.setRules(t.app.db, theirs.seasonId, { autoAcceptBp: 0 })).toBeNull();
    expect(await r.seasons.setRules(t.app.db, theirs.seasonId, {})).toBeNull();
    expect((await seasonRow(theirs.seasonId)).autoAcceptBp).toBe(9000);
  });
});

describe("inv.i2.season-rules-frozen: only the purge steps past the guard", () => {
  it("the forgeable fs.purge setting opens nothing; the purge's own owner-only ticket does", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const forged = await dbError(() =>
      t.app.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('fs.purge', 'on', true)`);
        await tx.update(seasons).set({ cosignBatchCents: 1n }).where(eq(seasons.id, ws.seasonId));
      }),
    );
    expect(forged.code).toBe("RATE_CARD_RATIFIED");
    // fs_purge_workspace() writes this ticket for its own transaction; fs_app can neither read nor write it
    const [row] = await t.owner.db.transaction(async (tx) => {
      await tx.execute(
        sql`insert into fs_private.purge_tickets (workspace_id, txid) values (${ws.workspaceId}, txid_current())`,
      );
      return tx.update(seasons).set({ cosignBatchCents: 1n }).where(eq(seasons.id, ws.seasonId)).returning();
    });
    expect(row?.cosignBatchCents).toBe(1n);
  });

  it("fs_purge_workspace still purges an expired judge workspace whose season is frozen", async () => {
    const gone = await fixtureWorkspace(t.owner.db, {
      kind: "judge",
      expiresAt: new Date(Date.now() - 1000),
      withRun: true,
    });
    const [res] = await t.app.sql<{ ok: boolean }[]>`select fs_purge_workspace(${gone.workspaceId}) as ok`;
    expect(res?.ok).toBe(true);
    expect(await t.owner.db.select().from(seasons).where(eq(seasons.workspaceId, gone.workspaceId))).toEqual(
      [],
    );
  });
});

// ─── concurrency: two transactions on connections of their own ────────────────────────────────────────────

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const backendPid = async (tx: TransactionSql) =>
  (await tx<{ pid: number }[]>`select pg_backend_pid() as pid`)[0]?.pid ?? 0;

/** Runs `steps` in a transaction and keeps it open (its locks held) until `commit()`. */
async function holdOpen(db: Sql, steps: (tx: TransactionSql) => Promise<unknown>) {
  const gate = deferred<void>();
  const ready = deferred<number>();
  const done = db.begin(async (tx) => {
    const pid = await backendPid(tx);
    await steps(tx);
    ready.resolve(pid);
    await gate.promise;
  });
  done.catch((e: unknown) => ready.reject(e));
  const pid = await ready.promise;
  return {
    pid,
    commit: async () => {
      gate.resolve();
      await done;
    },
  };
}

type Outcome = { ok: true } | { ok: false; error: unknown };

/** Starts `statement` in a transaction of its own; `pid` resolves before the statement is sent. */
function start(db: Sql, statement: (tx: TransactionSql) => Promise<unknown>) {
  const pid = deferred<number>();
  const outcome: Promise<Outcome> = db
    .begin(async (tx) => {
      pid.resolve(await backendPid(tx));
      await statement(tx);
    })
    .then(
      () => ({ ok: true }) as const,
      (error: unknown) => ({ ok: false, error }) as const,
    );
  return { pid: pid.promise, outcome };
}

/** Resolves once backend `waiter` is blocked on a lock that backend `holder` holds. */
async function blockedBy(waiter: number, holder: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const [row] = await t.owner.sql<{ blocked: boolean }[]>`
      select ${holder}::int = any(pg_blocking_pids(${waiter}::int)) as blocked`;
    if (row?.blocked) return;
    if (Date.now() > deadline) throw new Error(`backend ${waiter} never waited for backend ${holder}`);
    await sleep(10);
  }
}

const refusal = (o: Outcome) => (o.ok ? null : asDbError(o.error));

describe("inv.i2.season-rules-frozen: a change and a ratification never interleave", () => {
  it("a ratification in flight makes a term change wait, and the change then finds the card ratified", async () => {
    const ws = await fixtureWorkspace(t.app.db, { ratifiedAt: false });
    const ratify = await holdOpen(
      t.app.sql,
      (tx) => tx`
      update rate_cards set ratified_at = now() where id = ${ws.rateCardId}`,
    );
    const change = start(
      t.app.sql,
      (tx) => tx`
      update seasons set cosign_batch_cents = 100000000 where id = ${ws.seasonId}`,
    );
    await blockedBy(await change.pid, ratify.pid);
    await ratify.commit();
    expect(refusal(await change.outcome)).toMatchObject({
      code: "RATE_CARD_RATIFIED",
      subject: ws.rateCardSha256,
    });
    expect((await seasonRow(ws.seasonId)).cosignBatchCents).toBe(100n);
  });

  it("a card inserted or moved here and ratified by an open transaction holds the season until it commits", async () => {
    const ways: Array<{
      name: string;
      ws: FixtureWorkspace;
      put: (tx: TransactionSql, season: string) => unknown;
    }> = [
      {
        name: "inserted already ratified",
        ws: await fixtureWorkspace(t.app.db),
        put: (tx, season) => {
          const c = cardJcs("BR 2026-B1");
          return tx`
              insert into rate_cards (workspace_id, season_id, code, canonical_jcs, sha256, ratified_at, provenance)
              select workspace_id, id, 'BR 2026-B1', ${c.canonicalJcs}, ${c.sha256}, now(), 'live'
                from seasons where id = ${season}`;
        },
      },
      {
        name: "inserted as a draft, then ratified",
        ws: await fixtureWorkspace(t.app.db),
        put: async (tx, season) => {
          const c = cardJcs("BR 2026-B2");
          await tx`
              insert into rate_cards (workspace_id, season_id, code, canonical_jcs, sha256, provenance)
              select workspace_id, id, 'BR 2026-B2', ${c.canonicalJcs}, ${c.sha256}, 'live'
                from seasons where id = ${season}`;
          return tx`update rate_cards set ratified_at = now() where season_id = ${season}`;
        },
      },
      {
        name: "a draft moved here from another season, then ratified",
        ws: await fixtureWorkspace(t.app.db, { ratifiedAt: false }),
        put: async (tx, season) => {
          await tx`update rate_cards set season_id = ${season}
                      where workspace_id = (select workspace_id from seasons where id = ${season})`;
          return tx`update rate_cards set ratified_at = now() where season_id = ${season}`;
        },
      },
    ];
    for (const way of ways) {
      const season = await cardlessSeason(way.ws);
      const put = await holdOpen(t.app.sql, (tx) => Promise.resolve(way.put(tx, season)));
      const change = start(t.app.sql, (tx) => tx`update seasons set auto_accept_bp = 0 where id = ${season}`);
      await blockedBy(await change.pid, put.pid);
      await put.commit();
      const [card] = await t.owner.db.select().from(rateCards).where(eq(rateCards.seasonId, season));
      expect(card?.ratifiedAt, way.name).toBeInstanceOf(Date);
      expect(refusal(await change.outcome), way.name).toMatchObject({
        code: "RATE_CARD_RATIFIED",
        subject: card?.sha256,
      });
      expect((await seasonRow(season)).autoAcceptBp, way.name).toBe(9000);
    }
  });

  it("a term change in flight makes the ratification wait; the card then ratifies the changed terms", async () => {
    // an existing draft card: the change holds it FOR SHARE, so the UPDATE that ratifies it waits
    const ws = await fixtureWorkspace(t.app.db, { ratifiedAt: false });
    const change = await holdOpen(
      t.app.sql,
      (tx) => tx`
      update seasons set cosign_batch_cents = 30000 where id = ${ws.seasonId}`,
    );
    const ratify = start(
      t.app.sql,
      (tx) => tx`update rate_cards set ratified_at = now() where id = ${ws.rateCardId}`,
    );
    await blockedBy(await ratify.pid, change.pid);
    await change.commit();
    expect(await ratify.outcome).toEqual({ ok: true });
    expect((await seasonRow(ws.seasonId)).cosignBatchCents).toBe(30_000n);
    // a season with no card yet: the change holds the season row, so a card inserted ratified waits for it
    const season = await cardlessSeason(ws);
    const change2 = await holdOpen(
      t.app.sql,
      (tx) => tx`update seasons set auto_accept_bp = 8500 where id = ${season}`,
    );
    const c = cardJcs("BR 2026-B");
    const insert = start(
      t.app.sql,
      (tx) => tx`
      insert into rate_cards (workspace_id, season_id, code, canonical_jcs, sha256, ratified_at, provenance)
      values (${ws.workspaceId}, ${season}, 'BR 2026-B', ${c.canonicalJcs}, ${c.sha256}, now(), 'live')`,
    );
    await blockedBy(await insert.pid, change2.pid);
    await change2.commit();
    expect(await insert.outcome).toEqual({ ok: true });
    expect((await seasonRow(season)).autoAcceptBp).toBe(8500);
    // and from here on, both seasons are closed
    for (const id of [ws.seasonId, season]) {
      const e = await dbError(() =>
        t.app.db.update(seasons).set({ autoAcceptBp: 1 }).where(eq(seasons.id, id)),
      );
      expect(e.code).toBe("RATE_CARD_RATIFIED");
    }
  });
});
