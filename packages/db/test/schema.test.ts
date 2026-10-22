import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isUuidv7 } from "../src/ids/uuidv7.js";
import { ensureRunSeqFloor } from "../src/migrate.js";
import { holds, memberLines, payRuns, slipRows, workspaces } from "../src/schema/index.js";
import { fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { sqlState } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb();
});
afterAll(async () => {
  await t?.close();
});

/** Tables that are not workspace data: the tenancy root and Better Auth's own tables. */
const NO_WORKSPACE = new Set([
  "workspaces",
  "auth_user",
  "auth_session",
  "auth_account",
  "auth_verification",
]);
/** System-wide rows are allowed here (S3 deviation 4 plus cron tasks, system PayPal calls and health reports). */
const NULLABLE_WORKSPACE = new Set([
  "webhook_events",
  "paypal_calls",
  "task_outbox",
  "reconciliation_reports",
]);
/** Infrastructure bookkeeping without data provenance (I8 labels data rows). */
const NO_PROVENANCE = new Set([
  ...NO_WORKSPACE,
  "memberships",
  "frame_tokens",
  "pairing_tokens",
  "device_keys",
  "push_tokens",
  "paypal_calls",
  "reconciliation_reports",
  "task_outbox",
  "ledger_entries",
  "ledger_heads",
  "idempotency_keys",
  "system_flags",
]);

interface Col {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  character_maximum_length: number | null;
}

async function columns(): Promise<Col[]> {
  return t.owner.sql<Col[]>`
    select c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default, c.character_maximum_length
      from information_schema.columns c
      join information_schema.tables tb on tb.table_name = c.table_name and tb.table_schema = c.table_schema
     where c.table_schema = 'public' and tb.table_type = 'BASE TABLE'`;
}

describe("register §7 table conventions", () => {
  it("creates every table group of register §7", async () => {
    const names = new Set((await columns()).map((c) => c.table_name));
    const expected = [
      [
        "workspaces",
        "memberships",
        "frame_tokens",
        "pairing_tokens",
        "device_keys",
        "push_tokens",
        "auth_user",
      ],
      ["coops", "members", "plots", "seasons", "lots", "rate_cards", "rate_rules", "ratifications"],
      ["documents", "extraction_reads", "slip_rows", "slip_fields", "deduction_marks", "slip_anomalies"],
      [
        "pay_runs",
        "invoices",
        "member_lines",
        "holds",
        "approvals",
        "statements",
        "cash_receipts",
        "review_requests",
      ],
      ["payout_batches", "payout_items", "webhook_events", "paypal_calls", "reconciliation_reports"],
      ["task_outbox", "run_events", "ledger_entries", "ledger_heads", "agent_sessions", "llm_calls"],
      ["idempotency_keys", "system_flags"],
    ].flat();
    for (const n of expected) expect(names, n).toContain(n);
    expect(names).not.toContain("ga_resolutions"); // C-09
  });

  it("every workspace table has workspace_id, NOT NULL except the documented system-wide tables", async () => {
    const cols = await columns();
    const tables = [...new Set(cols.map((c) => c.table_name))].filter((n) => !NO_WORKSPACE.has(n));
    expect(tables.length).toBeGreaterThan(35);
    for (const tbl of tables) {
      const ws = cols.find((c) => c.table_name === tbl && c.column_name === "workspace_id");
      expect(ws, `${tbl}.workspace_id`).toBeDefined();
      expect(ws?.is_nullable, `${tbl}.workspace_id nullability`).toBe(
        NULLABLE_WORKSPACE.has(tbl) ? "YES" : "NO",
      );
    }
  });

  it("uuid primary keys default to fs_uuidv7(), which returns RFC 9562 v7 ids in time order", async () => {
    const ids = (await columns()).filter((c) => c.column_name === "id" && c.data_type === "uuid");
    expect(ids.length).toBeGreaterThan(35);
    for (const c of ids) expect(c.column_default, c.table_name).toBe("fs_uuidv7()");
    const rows = await t.owner.sql<
      { id: string }[]
    >`select fs_uuidv7()::text as id from generate_series(1, 50)`;
    for (const r of rows) expect(isUuidv7(r.id)).toBe(true);
    const [a] = await t.owner.sql<{ id: string }[]>`select fs_uuidv7()::text as id`;
    await new Promise((r) => setTimeout(r, 5));
    const [b] = await t.owner.sql<{ id: string }[]>`select fs_uuidv7()::text as id`;
    expect((a?.id ?? "") < (b?.id ?? "")).toBe(true);
  });

  it("money is bigint cents next to a char(3) currency", async () => {
    const cols = await columns();
    const money = cols.filter((c) => c.column_name.endsWith("_cents"));
    expect(money.length).toBeGreaterThan(15);
    for (const c of money) {
      expect(c.data_type, `${c.table_name}.${c.column_name}`).toBe("bigint");
      const cur = cols.find(
        (x) =>
          x.table_name === c.table_name &&
          (x.column_name === "currency" ||
            (c.column_name === "fee_cents" && x.column_name === "fee_currency")),
      );
      expect(cur?.data_type, `${c.table_name} currency`).toBe("character");
      expect(cur?.character_maximum_length).toBe(3);
    }
  });

  it("inv.i8.labels: data rows must say where they came from (provenance NOT NULL, no default)", async () => {
    const cols = await columns();
    const tables = [...new Set(cols.map((c) => c.table_name))].filter((n) => !NO_PROVENANCE.has(n));
    for (const tbl of tables) {
      const p = cols.find((c) => c.table_name === tbl && c.column_name === "provenance");
      expect(p, `${tbl}.provenance`).toBeDefined();
      expect(p?.is_nullable).toBe("NO");
      expect(p?.column_default).toBeNull();
    }
    const [ws] = await t.owner.db.insert(workspaces).values({ kind: "real", name: "i8" }).returning();
    expect(
      await sqlState(
        () => t.owner.sql`insert into coops (workspace_id, name, region) values (${ws?.id ?? ""}, 'x', 'y')`,
      ),
    ).toBe("23502");
    expect(
      await sqlState(
        () =>
          t.owner
            .sql`insert into coops (workspace_id, name, region, provenance) values (${ws?.id ?? ""}, 'x', 'y', 'made_up')`,
      ),
    ).toBe("23514");
  });
});

describe("jsonb through Drizzle and postgres.js", () => {
  it("stores objects as jsonb objects, not as double-encoded strings", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const [r] = await t.app.sql<{ k: string; v: unknown }[]>`
      select jsonb_typeof(params) as k, params->'centsPerKg' as v from rate_rules where workspace_id = ${ws.workspaceId}`;
    expect(r).toEqual({ k: "object", v: 1 });
  });
});

describe("pay_runs.run_seq", () => {
  it("comes from one global sequence across workspaces and generates the run slug", async () => {
    const a = await fixtureWorkspace(t.owner.db, { withRun: true, name: "a" });
    const b = await fixtureWorkspace(t.owner.db, { withRun: true, name: "b" });
    const [ra] = await t.owner.db
      .select()
      .from(payRuns)
      .where(eq(payRuns.id, a.runId ?? ""));
    const [rb] = await t.owner.db
      .select()
      .from(payRuns)
      .where(eq(payRuns.id, b.runId ?? ""));
    expect((rb?.runSeq ?? 0) - (ra?.runSeq ?? 0)).toBe(1);
    expect(ra?.runSlug).toBe(`2026A-r${ra?.runSeq}`);
  });

  it("ensureRunSeqFloor raises the floor for an environment and never lowers it", async () => {
    expect(await ensureRunSeqFloor(t.url, 100_000)).toBe(100_000);
    const ws = await fixtureWorkspace(t.owner.db, { withRun: true });
    const [r] = await t.owner.db
      .select()
      .from(payRuns)
      .where(eq(payRuns.id, ws.runId ?? ""));
    expect(r?.runSlug).toBe("2026A-r100000");
    expect(await ensureRunSeqFloor(t.url, 5)).toBe(100_001);
  });

  it("requires the batch digest and sender_batch_id from POSTING on", async () => {
    const ws = await fixtureWorkspace(t.owner.db, { withRun: true });
    const runId = ws.runId ?? "";
    expect(
      await sqlState(() => t.owner.db.update(payRuns).set({ state: "POSTING" }).where(eq(payRuns.id, runId))),
    ).toBe("23514");
    await t.owner.db
      .update(payRuns)
      .set({
        state: "POSTING",
        batchSha256: "a".repeat(64),
        senderBatchId: `2026A-aaaaaaaa-r${runId.slice(0, 4)}`,
      })
      .where(eq(payRuns.id, runId));
  });
});

describe("tenancy and money guards", () => {
  it("a row can never reference another workspace's row (composite foreign keys)", async () => {
    const a = await fixtureWorkspace(t.owner.db, { withRun: true });
    const b = await fixtureWorkspace(t.owner.db, { withRun: true });
    const err = await sqlState(() =>
      t.owner.db.insert(memberLines).values({
        workspaceId: a.workspaceId,
        runId: a.runId ?? "",
        memberId: b.memberIds[0] ?? "", // B's member in A's run
        rail: "ON",
        currency: "USD",
        verifiedG: 1000n,
        grade1G: 0n,
        premiumCents: 10n,
        bonusCents: 0n,
        deductionsCents: 0n,
        creditsCents: 0n,
        netCents: 10n,
        deductions: [],
        provenance: "seeded",
      }),
    );
    expect(err).toBe("23503");
  });

  it("inv.i3 at line grain: net = premium + bonus − deductions + credits, in integer cents", async () => {
    const a = await fixtureWorkspace(t.owner.db, { withRun: true });
    const line = {
      workspaceId: a.workspaceId,
      runId: a.runId ?? "",
      memberId: a.memberIds[0] ?? "",
      rail: "ON" as const,
      currency: "USD",
      verifiedG: 1000n,
      grade1G: 1000n,
      premiumCents: 4369n,
      bonusCents: 2185n,
      deductionsCents: 109n,
      creditsCents: 0n,
      deductions: [],
      provenance: "seeded" as const,
    };
    expect(await sqlState(() => t.owner.db.insert(memberLines).values({ ...line, netCents: 6446n }))).toBe(
      "23514",
    );
    const [ok] = await t.owner.db
      .insert(memberLines)
      .values({ ...line, netCents: 6445n })
      .returning();
    expect(ok?.netCents).toBe(6445n);
  });

  it("inv.i1 at rest: a hold's Claude line can carry words and placeholders but no digit", async () => {
    const a = await fixtureWorkspace(t.owner.db, { withRun: true });
    const base = {
      workspaceId: a.workspaceId,
      runId: a.runId ?? "",
      kind: "DUPLICATE_SLIP" as const,
      gate: "BLOCKS_APPROVAL" as const,
      raisedBy: "engine",
      provenance: "seeded" as const,
    };
    await t.owner.db
      .insert(holds)
      .values({ ...base, claudeLine: "Slip {{SERIAL}} appears twice; count it once." });
    expect(
      await sqlState(() =>
        t.owner.db.insert(holds).values({ ...base, claudeLine: "Slip 0457 appears twice." }),
      ),
    ).toBe("23514");
  });

  it("a slip row without a date is only allowed while a person still has to read it", async () => {
    const a = await fixtureWorkspace(t.owner.db);
    const [doc] = await t.owner.sql<{ id: string }[]>`
      insert into documents (workspace_id, kind, sha256, storage, path, byte_size, mime, provenance)
      values (${a.workspaceId}, 'slip_photo', ${"b".repeat(64)}, 'static', 'photos/A.webp', 1, 'image/webp', 'seeded')
      returning id`;
    const row = {
      workspaceId: a.workspaceId,
      seasonId: a.seasonId,
      documentId: doc?.id ?? "",
      serial: "0301",
      rowNo: 1,
      provenance: "seeded" as const,
    };
    expect(await sqlState(() => t.owner.db.insert(slipRows).values({ ...row, state: "AUTO_ACCEPTED" }))).toBe(
      "23514",
    );
    await t.owner.db.insert(slipRows).values({ ...row, state: "NEEDS_HUMAN" });
    const [n] = await t.owner.db.select({ n: sql<number>`count(*)::int` }).from(slipRows);
    expect(n?.n).toBe(1);
  });
});
