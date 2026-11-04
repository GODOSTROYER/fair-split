import { schema } from "@fairsplit/db";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestApp, type TestApp } from "../test/index.js";
import { purgeExpiredJudgeWorkspaces } from "./pool.js";
import * as quota from "./quota.js";
import { runJudgeReset } from "./reset-task.js";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ db: "postgres", clock: new Date() });
});
afterAll(async () => {
  await t?.close();
});

async function expired(count: number) {
  if (!t.pg) throw new Error("Postgres required");
  return t.pg.owner.db
    .insert(schema.workspaces)
    .values(
      Array.from({ length: count }, (_, i) => ({
        kind: "judge" as const,
        name: `HD6-purge-${i}`,
        expiresAt: new Date(Date.now() - 60_000 + i),
      })),
    )
    .returning({ id: schema.workspaces.id });
}

describe("HD6-5a purge backlog", () => {
  it("one cron pass drains all 100 expired removable workspaces", async () => {
    const rows = await expired(100);
    const report = await runJudgeReset(t.deps, { trigger: "cron", workspaceId: null, slot: "HD6-backlog" });
    expect(report.purged).toBe(100);
    const remaining = await t.deps.db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(
        inArray(
          schema.workspaces.id,
          rows.map((row) => row.id),
        ),
      );
    expect(remaining).toHaveLength(0);
  }, 120_000);

  it("stops checking batch windows after enough removable candidates fill the pass", async () => {
    const rows = await expired(25);
    const countWindows = vi.spyOn(quota, "batchesStillCounted");
    try {
      const report = await purgeExpiredJudgeWorkspaces(
        t.deps.db,
        20,
        rows.map((row) => row.id),
      );
      expect(report.purged).toHaveLength(20);
      const unselected = new Set(rows.slice(20).map((row) => row.id));
      expect(countWindows.mock.calls.some((call) => unselected.has(call[1]))).toBe(false);
    } finally {
      countWindows.mockRestore();
    }
  });
});
