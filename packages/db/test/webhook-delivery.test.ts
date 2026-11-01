/** W1 / IC-04: a forward-only upgrade keeps old evidence while adding verified-delivery storage. */
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, inject, it } from "vitest";
import { createDb, type Database } from "../src/client.js";
import { appendEvent } from "../src/events.js";
import { MIGRATIONS_DIR, runMigrations } from "../src/migrate.js";
import { webhookEvents } from "../src/schema/index.js";
import { createTestDatabase, fixtureWorkspace } from "../src/testing/index.js";
import { sqlState, treasurer } from "./helpers.js";

const delivery = {
  id: "SIM-EVENT-W1",
  event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  resource: { payout_item_id: "SIM-ITEM-W1", transaction_status: "SUCCESS" },
};

async function assertHistoryPrivileges(app: Database): Promise<void> {
  for (const table of ["run_events", "ledger_entries"]) {
    expect(await sqlState(() => app.sql.unsafe(`update ${table} set workspace_id = workspace_id`))).toBe(
      "42501",
    );
    expect(await sqlState(() => app.sql.unsafe(`delete from ${table}`))).toBe("42501");
  }
}

/** The exact published migration prefix models an existing installation without rewriting its history. */
function legacyMigrations(): { folder: string; close(): void } {
  const scratch = path.resolve(MIGRATIONS_DIR, "../../../.codex-scratch");
  mkdirSync(scratch, { recursive: true });
  const folder = mkdtempSync(path.join(scratch, "w1-migrations-"));
  mkdirSync(path.join(folder, "meta"));
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8"));
  const deliveryAt = journal.entries.findIndex((entry: { tag: string }) =>
    entry.tag.endsWith("_webhook_delivery"),
  );
  if (deliveryAt < 0) throw new Error("W1 delivery migration is missing from the journal");
  journal.entries = journal.entries.slice(0, deliveryAt);
  writeFileSync(path.join(folder, "meta/_journal.json"), JSON.stringify(journal));
  for (const entry of journal.entries) {
    copyFileSync(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`));
  }
  return { folder, close: () => rmSync(folder, { recursive: true, force: true }) };
}

describe("W1 webhook delivery persistence", () => {
  it("keeps journal indices unique and timestamps increasing after the published migration prefix", () => {
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as {
      entries: { idx: number; when: number }[];
    };
    expect(new Set(journal.entries.map((entry) => entry.idx)).size).toBe(journal.entries.length);
    for (let i = 1; i < journal.entries.length; i++) {
      expect(journal.entries[i]?.when).toBeGreaterThan(journal.entries[i - 1]?.when as number);
    }
  });
  it("declares delivery as nullable JSONB without a default", () => {
    const column = getTableColumns(webhookEvents).delivery;
    expect(column?.getSQLType()).toBe("jsonb");
    expect(column?.notNull).toBe(false);
    expect(column?.hasDefault).toBe(false);
  });

  it("migrates a fresh database, round-trips delivery as fs_app, and keeps history privileges", async () => {
    const { adminUrl } = inject("fsPg");
    const test = await createTestDatabase(adminUrl, "template0", "w1fresh");
    let owner: Database | undefined;
    let app: Database | undefined;
    try {
      await runMigrations(test.url);
      owner = createDb(test.url);
      app = createDb(test.url, { role: "fs_app" });
      const [column] = await owner.sql`
        select data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'webhook_events' and column_name = 'delivery'`;
      expect(column).toEqual({ data_type: "jsonb", is_nullable: "YES", column_default: null });
      await app.db.insert(webhookEvents).values({
        paypalEventId: delivery.id,
        eventType: delivery.event_type,
        verified: "dev_mock",
        raw: "sha256:scrubbed-raw-delivery",
        delivery,
        status: "received",
        provenance: "seeded",
      });
      const [row] = await app.db.select().from(webhookEvents);
      expect(row?.delivery).toEqual(delivery);
      await assertHistoryPrivileges(app);
      await runMigrations(test.url);
      expect(await app.db.select().from(webhookEvents)).toHaveLength(1);
    } finally {
      await Promise.allSettled([app?.close(), owner?.close()]);
      await test.drop();
    }
  });

  it("rolls a seeded pre-W1 database forward, preserves NULL for historical deliveries and keeps grants", async () => {
    const { adminUrl } = inject("fsPg");
    const test = await createTestDatabase(adminUrl, "template0", "w1upgrade");
    const legacy = legacyMigrations();
    let owner: Database | undefined;
    let app: Database | undefined;
    try {
      await runMigrations(test.url, { migrationsFolder: legacy.folder });
      owner = createDb(test.url);
      app = createDb(test.url, { role: "fs_app" });
      const workspace = await fixtureWorkspace(owner.db, { withRun: true });
      await appendEvent(app.db, {
        workspaceId: workspace.workspaceId,
        runId: workspace.runId ?? undefined,
        type: "presence",
        actor: treasurer,
        provenance: "seeded",
        payload: { view: "split" },
      });
      const id = randomUUID();
      // Raw SQL deliberately targets the old schema, before the new column exists.
      await app.sql`
        insert into webhook_events (id, workspace_id, paypal_event_id, event_type, verified, raw, status, provenance)
        values (${id}, ${workspace.workspaceId}, 'SIM-HISTORICAL-W1', 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED',
          'dev_mock', 'sha256:preserved-evidence', 'applied', 'seeded')`;
      await runMigrations(test.url);
      await runMigrations(test.url);
      const [row] = await app.db.select().from(webhookEvents);
      expect(row).toMatchObject({
        id,
        workspaceId: workspace.workspaceId,
        paypalEventId: "SIM-HISTORICAL-W1",
        raw: "sha256:preserved-evidence",
        status: "applied",
        delivery: null,
      });
      const [counts] = await owner.sql`
        select (select count(*)::int from pay_runs) as runs,
               (select count(*)::int from run_events) as events,
               (select count(*)::int from webhook_events) as webhooks`;
      expect(counts).toEqual({ runs: 1, events: 1, webhooks: 1 });
      await assertHistoryPrivileges(app);
    } finally {
      await Promise.allSettled([app?.close(), owner?.close()]);
      await test.drop();
      legacy.close();
    }
  });
});
