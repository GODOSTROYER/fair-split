import { asc, eq } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GENESIS_HASH, jcs, ledgerEntryHash, sha256Hex } from "../src/_shims/domain.js";
import { createDb } from "../src/client.js";
import { appendLedger, type LedgerEntry, ledgerHead, verifyChain, verifyEntries } from "../src/ledger.js";
import { ledgerEntries } from "../src/schema/index.js";
import { fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { dbError, scopeOf } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb({ max: 12 });
});
afterAll(async () => {
  await t?.close();
});

async function chain(workspaceId: string): Promise<LedgerEntry[]> {
  return (await t.app.db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.workspaceId, workspaceId))
    .orderBy(asc(ledgerEntries.seq))) as LedgerEntry[];
}

describe("ledger.append: one sha256 chain per workspace", () => {
  it("links from the 64-zero genesis, hashing prev ‖ JCS{seq, kind, actorKind, actorId, impersonatedBy, payload, at}", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const scope = scopeOf(ws.workspaceId);
    const at = new Date("2026-10-23T04:00:00.123Z");
    const first = await appendLedger(t.app.db, scope, {
      kind: "ratification",
      payload: { card: "BR 2026-04" },
      at,
    });
    expect(first.seq).toBe(1);
    expect(first.prevHash).toBe(GENESIS_HASH);
    const expected = sha256Hex(
      GENESIS_HASH +
        jcs({
          seq: 1,
          kind: "ratification",
          actorKind: "human",
          actorId: "treasurer:analyn",
          impersonatedBy: "judge_session:test",
          payload: { card: "BR 2026-04" },
          at: "2026-10-23T04:00:00.123Z",
        }),
    );
    expect(first.entryHash).toBe(expected);
    const second = await appendLedger(t.app.db, scope, { kind: "hold.raised", payload: { code: "H1" } });
    expect(second.seq).toBe(2);
    expect(second.prevHash).toBe(first.entryHash);
    expect(await ledgerHead(t.app.db, ws.workspaceId)).toEqual({ seq: 2, entryHash: second.entryHash });
    expect(await verifyChain(t.app.db, ws.workspaceId)).toEqual({
      ok: true,
      count: 2,
      head: { seq: 2, entryHash: second.entryHash },
    });
  });

  it("concurrent writers in one workspace never fork the chain", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const scope = scopeOf(ws.workspaceId);
    const pools = Array.from({ length: 6 }, () => createDb(t.url, { role: "fs_app", max: 2 }));
    try {
      await Promise.all(
        pools.flatMap((p, i) =>
          Array.from({ length: 5 }, (_, j) =>
            appendLedger(p.db, scope, { kind: "row.accepted", payload: { writer: i, n: j } }),
          ),
        ),
      );
    } finally {
      await Promise.all(pools.map((p) => p.close()));
    }
    const rows = await chain(ws.workspaceId);
    expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect((await verifyChain(t.app.db, ws.workspaceId)).ok).toBe(true);
  });

  it("separate workspaces keep separate chains", async () => {
    const a = await fixtureWorkspace(t.app.db);
    const b = await fixtureWorkspace(t.app.db);
    await appendLedger(t.app.db, scopeOf(a.workspaceId), { kind: "x", payload: {} });
    await appendLedger(t.app.db, scopeOf(b.workspaceId), { kind: "x", payload: {} });
    expect((await chain(a.workspaceId))[0]?.seq).toBe(1);
    expect((await chain(b.workspaceId))[0]?.seq).toBe(1);
  });

  it("the database refuses an entry that does not extend the head (LEDGER_FORK)", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const scope = scopeOf(ws.workspaceId);
    const first = await appendLedger(t.app.db, scope, { kind: "x", payload: {} });
    const forged = {
      workspaceId: ws.workspaceId,
      seq: 2,
      kind: "approval.signed",
      actorKind: "human" as const,
      actorId: "board:ernesto",
      payload: {},
      at: new Date(),
      prevHash: GENESIS_HASH, // should be first.entryHash
      entryHash: "1".repeat(64),
    };
    expect((await dbError(() => t.app.db.insert(ledgerEntries).values(forged))).code).toBe("LEDGER_FORK");
    expect(
      (
        await dbError(() =>
          t.app.db.insert(ledgerEntries).values({ ...forged, seq: 5, prevHash: first.entryHash }),
        )
      ).code,
    ).toBe("LEDGER_FORK");
  });

  it("verifyChain recomputes every hash: a payload edited behind the triggers' back is caught", async () => {
    const ws = await fixtureWorkspace(t.owner.db);
    const scope = scopeOf(ws.workspaceId);
    for (let i = 0; i < 4; i++)
      await appendLedger(t.owner.db, scope, { kind: "row.accepted", payload: { i } });
    // a superuser can disable user triggers; the hash chain still exposes the edit
    await t.owner.sql.begin(async (tx) => {
      await tx`alter table ledger_entries disable trigger user`;
      await tx`update ledger_entries set payload = '{"i": 99}' where workspace_id = ${ws.workspaceId} and seq = 3`;
      await tx`alter table ledger_entries enable trigger user`;
    });
    const verdict = await verifyChain(t.owner.db, ws.workspaceId);
    expect(verdict).toMatchObject({ ok: false, seq: 3, reason: "HASH_MISMATCH" });
  });

  it("money in payloads stays exact: bigint is stored as a decimal string and hashes identically", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const e = await appendLedger(t.app.db, scopeOf(ws.workspaceId), {
      kind: "payout.submitting",
      payload: { totalCents: 36_839n, items: 8 },
    });
    expect(e.payload).toEqual({ totalCents: "36839", items: 8 });
    expect((await verifyChain(t.app.db, ws.workspaceId)).ok).toBe(true);
  });

  it("property: any JSON payload survives jsonb storage with its hash intact", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const scope = scopeOf(ws.workspaceId);
    const json = fc
      .dictionary(fc.string(), fc.jsonValue({ maxDepth: 2 }))
      .filter((v) => !JSON.stringify(v).includes("\\u0000"));
    await fc.assert(
      fc.asyncProperty(json, async (payload) => {
        const e = await appendLedger(t.app.db, scope, { kind: "prop", payload });
        const [row] = (await t.app.db
          .select()
          .from(ledgerEntries)
          .where(eq(ledgerEntries.id, e.id))) as LedgerEntry[];
        if (!row) return false;
        const again = ledgerEntryHash(row.prevHash, {
          seq: row.seq,
          kind: row.kind,
          actorKind: row.actorKind,
          actorId: row.actorId,
          impersonatedBy: row.impersonatedBy,
          payload: row.payload,
          at: row.at.toISOString(),
        });
        return again === row.entryHash;
      }),
      { numRuns: 60 },
    );
    expect((await verifyChain(t.app.db, ws.workspaceId)).ok).toBe(true);
  });
});

describe("verifyEntries (pure)", () => {
  const rows = (() => {
    const out: LedgerEntry[] = [];
    let prev = GENESIS_HASH;
    for (let seq = 1; seq <= 5; seq++) {
      const e = {
        seq,
        kind: "k",
        actorKind: "engine",
        actorId: "engine",
        impersonatedBy: null,
        payload: { seq },
        at: new Date(Date.UTC(2026, 9, 23, 0, 0, seq)),
      };
      const entryHash = ledgerEntryHash(prev, { ...e, at: e.at.toISOString() });
      out.push({
        ...e,
        id: String(seq),
        workspaceId: "w",
        runId: null,
        prevHash: prev,
        entryHash,
      } as LedgerEntry);
      prev = entryHash;
    }
    return out;
  })();

  it("accepts an intact chain", () => {
    expect(verifyEntries(rows)).toMatchObject({ ok: true, count: 5 });
  });

  it("property: changing any one field of any one entry is detected", () => {
    const fields = [
      "seq",
      "kind",
      "actorKind",
      "actorId",
      "impersonatedBy",
      "payload",
      "at",
      "prevHash",
    ] as const;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4 }), fc.constantFrom(...fields), (i, field) => {
        const copy = rows.map((r) => ({ ...r }));
        const r = copy[i] as LedgerEntry;
        const mutated: Record<(typeof fields)[number], unknown> = {
          seq: r.seq + 10,
          kind: `${r.kind}!`,
          actorKind: "agent",
          actorId: `${r.actorId}!`,
          impersonatedBy: "judge_session:evil",
          payload: { seq: -1 },
          at: new Date(r.at.getTime() + 1),
          prevHash: "f".repeat(64),
        };
        (r as unknown as Record<string, unknown>)[field] = mutated[field];
        return verifyEntries(copy).ok === false;
      }),
    );
  });

  it("detects a deleted entry as a sequence gap", () => {
    const v = verifyEntries([rows[0], rows[1], rows[3], rows[4]] as LedgerEntry[]);
    expect(v).toMatchObject({ ok: false, reason: "SEQ_GAP", seq: 4 });
  });
});
