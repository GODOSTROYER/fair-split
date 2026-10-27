import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { envKills, isKilled, readFlags, setFlag } from "../src/flags.js";
import { verifyChain } from "../src/ledger.js";
import { ledgerEntries, runEvents } from "../src/schema/index.js";
import { fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { scopeOf } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb();
});
afterAll(async () => {
  await t?.close();
});

describe("kill switches (system_flags)", () => {
  it("are off by default and read fresh per workspace", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const f = await readFlags(t.app.db, ws.workspaceId, {});
    expect(f.kill_payouts).toMatchObject({ on: false, source: "default" });
    expect(await isKilled(t.app.db, ws.workspaceId, "kill_payouts", {})).toBe(false);
  });

  it("a flip writes the ledger and emits flag.changed in the same transaction; a no-op flip writes nothing", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const scope = scopeOf(ws.workspaceId);
    expect(
      await setFlag(t.app.db, scope, "kill_payouts", true, { reason: "pause", provenance: "live" }),
    ).toEqual({
      changed: true,
    });
    expect(await setFlag(t.app.db, scope, "kill_payouts", true, { provenance: "live" })).toEqual({
      changed: false,
    });
    const f = await readFlags(t.app.db, ws.workspaceId, {});
    expect(f.kill_payouts).toMatchObject({
      on: true,
      source: "workspace",
      setBy: "treasurer:analyn",
      reason: "pause",
    });
    expect(await isKilled(t.app.db, ws.workspaceId, "kill_payouts", {})).toBe(true);

    const entries = await t.app.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.workspaceId, ws.workspaceId))
      .orderBy(asc(ledgerEntries.seq));
    expect(entries.map((e) => e.kind)).toEqual(["flag.flipped"]);
    const events = await t.app.db.select().from(runEvents).where(eq(runEvents.workspaceId, ws.workspaceId));
    expect(events.map((e) => [e.type, e.payload])).toEqual([
      ["flag.changed", { flag: "kill_payouts", on: true, reason: "pause" }],
    ]);
    expect((await verifyChain(t.app.db, ws.workspaceId)).ok).toBe(true);
  });

  it("one judge's switch never stops another workspace", async () => {
    const a = await fixtureWorkspace(t.app.db, { kind: "judge" });
    const b = await fixtureWorkspace(t.app.db, { kind: "judge" });
    await setFlag(t.app.db, scopeOf(a.workspaceId), "kill_ai_live", true, { provenance: "live" });
    expect(await isKilled(t.app.db, a.workspaceId, "kill_ai_live", {})).toBe(true);
    expect(await isKilled(t.app.db, b.workspaceId, "kill_ai_live", {})).toBe(false);
  });

  it("FS_KILL forces switches on everywhere", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const env = { FS_KILL: "payouts, ai_live" };
    expect(await isKilled(t.app.db, ws.workspaceId, "kill_payouts", env)).toBe(true);
    expect(await isKilled(t.app.db, ws.workspaceId, "kill_paypal_live", env)).toBe(false);
    const f = await readFlags(t.app.db, ws.workspaceId, env);
    expect(f.kill_ai_live).toMatchObject({ on: true, source: "env" });
  });

  it("parses FS_KILL and the .env.example booleans", () => {
    expect([...envKills({ FS_KILL: "all" })].sort()).toEqual([
      "kill_ai_live",
      "kill_payouts",
      "kill_paypal_live",
    ]);
    expect([...envKills({ FS_KILL: "kill_paypal_live,bogus" })]).toEqual(["kill_paypal_live"]);
    expect([...envKills({ KILL_PAYOUTS: "true", KILL_AI_LIVE: "false" })]).toEqual(["kill_payouts"]);
    expect(envKills({}).size).toBe(0);
  });
});
