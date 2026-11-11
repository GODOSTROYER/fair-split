import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/client.js";
import {
  appendLedger,
  appendLedgerBatch,
  type LedgerAppend,
  type LedgerEntry,
  ledgerHead,
  verifyChain,
} from "../src/ledger.js";
import { ledgerEntries } from "../src/schema/index.js";
import { fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { scopeOf } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb({ max: 8 });
});
afterAll(async () => t?.close());

const at = new Date("2026-11-11T02:00:00.123Z");
const headEntry: LedgerAppend = { kind: "opening", payload: { start: true }, at };
const entries: [LedgerAppend, LedgerAppend] = [
  { kind: "first", payload: { cents: 15n, date: at, missing: undefined }, at },
  {
    kind: "second",
    payload: { nested: [true, null, { text: "é🙂" }] },
    actor: { kind: "system", id: "engine", impersonatedBy: "judge_session:batch" },
    at: new Date(at.getTime() + 1),
  },
];

async function chain(workspaceId: string) {
  return t.app.db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.workspaceId, workspaceId))
    .orderBy(asc(ledgerEntries.seq));
}

describe("atomic ordered ledger batches", () => {
  it.each([false, true])(
    "matches sequential hashes and serialized rows with existing head=%s",
    async (existing) => {
      const [sequential, batched] = await Promise.all([
        fixtureWorkspace(t.app.db),
        fixtureWorkspace(t.app.db),
      ]);
      const a = scopeOf(sequential.workspaceId);
      const b = scopeOf(batched.workspaceId);
      if (existing) {
        await appendLedger(t.app.db, a, headEntry);
        await appendLedger(t.app.db, b, headEntry);
      }
      const expected: LedgerEntry[] = [];
      for (const entry of entries) expected.push(await appendLedger(t.app.db, a, entry));
      const actual = await appendLedgerBatch(t.app.db, b, entries);
      const content = (row: LedgerEntry) => {
        const { id: _id, workspaceId: _workspaceId, ...rest } = row;
        return JSON.stringify(rest);
      };
      expect(actual.map(content)).toEqual(expected.map(content));
      expect(await ledgerHead(t.app.db, b.workspaceId)).toEqual(await ledgerHead(t.app.db, a.workspaceId));
      expect((await verifyChain(t.app.db, b.workspaceId)).ok).toBe(true);
    },
  );

  it("validates the complete batch before insertion even when an existing transaction catches the error", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const scope = scopeOf(ws.workspaceId);
    await appendLedger(t.app.db, scope, headEntry);
    const before = await chain(ws.workspaceId);
    const head = await ledgerHead(t.app.db, ws.workspaceId);
    await t.app.db.transaction(async (tx) => {
      await expect(
        appendLedgerBatch(tx, scope, [entries[0], { kind: "invalid", payload: { n: Number.NaN } }]),
      ).rejects.toThrow(TypeError);
      expect(await ledgerHead(tx, ws.workspaceId)).toEqual(head);
    });
    expect(await chain(ws.workspaceId)).toEqual(before);
  });

  it("rolls back every inserted row and the trigger head when a later row violates a database constraint", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const scope = scopeOf(ws.workspaceId);
    await appendLedger(t.app.db, scope, headEntry);
    const before = await chain(ws.workspaceId);
    const head = await ledgerHead(t.app.db, ws.workspaceId);
    await expect(
      appendLedgerBatch(t.app.db, scope, [
        entries[0],
        { ...entries[1], runId: "00000000-0000-7000-8000-000000000000" },
      ]),
    ).rejects.toThrow();
    expect(await chain(ws.workspaceId)).toEqual(before);
    expect(await ledgerHead(t.app.db, ws.workspaceId)).toEqual(head);
  });

  it("serializes concurrent batches and single appends without forks or interleaving a batch", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const scope = scopeOf(ws.workspaceId);
    const other = createDb(t.url, { role: "fs_app", max: 3 });
    try {
      await Promise.all([
        appendLedgerBatch(t.app.db, scope, entries),
        appendLedgerBatch(other.db, scope, entries),
        appendLedger(other.db, scope, headEntry),
      ]);
    } finally {
      await other.close();
    }
    const rows = await chain(ws.workspaceId);
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5]);
    const first = rows.flatMap((row, i) => (row.kind === "first" ? [i] : []));
    expect(first).toHaveLength(2);
    for (const i of first) expect(rows[i + 1]?.kind).toBe("second");
    expect((await verifyChain(t.app.db, ws.workspaceId)).ok).toBe(true);
  });

  it("an empty batch leaves the chain and head untouched", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const before = await ledgerHead(t.app.db, ws.workspaceId);
    expect(await appendLedgerBatch(t.app.db, scopeOf(ws.workspaceId), [])).toEqual([]);
    expect(await ledgerHead(t.app.db, ws.workspaceId)).toEqual(before);
    expect(await chain(ws.workspaceId)).toEqual([]);
  });
});
