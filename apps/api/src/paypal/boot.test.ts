// The in-process simulator's boot steps (paypal/boot.ts) on embedded Postgres against the real simulator: the previous
// process's judge sessions end (their PayPal objects died with the old simulator), and the simulated balance is read
// with searchBalances, so Judge Mode's quota counts from it (40 live posts a day) instead of the opening US$100,000
// (which allows 5, a public third of 1: nearly every session would replay).
import { CreateJudgeSessionResponse } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JUDGE_COOKIE } from "../credentials/verify/index.js";
import { refillPool } from "../judge/pool.js";
import { dailyLivePostCap, estimateBalance, JUDGE_QUOTA } from "../judge/quota.js";
import { createFakeClock, type TestApp } from "../test/index.js";
import { BALANCE_READING_EVERY_MS, endJudgeSessionsAtBoot, recordSimulatorBalance } from "./boot.js";
import { SIMULATED_BUSINESS_BALANCE_USD } from "./simulator.js";
import { startSimApp, startTestSimulator, type TestSimulator } from "./test/sim.js";

let s: TestSimulator;
let t: TestApp;

beforeAll(async () => {
  // the app clock starts at the real time, so the database clock (claims, expiries) agrees with it
  s = await startTestSimulator({ clock: createFakeClock(new Date()) });
  t = await startSimApp(s, { db: "postgres" });
});
afterAll(async () => {
  await t?.close();
  await s?.sim.stop();
});

async function startSession() {
  const r = await t.json<unknown>("/v1/judge/sessions", {
    method: "POST",
    body: {},
    headers: { "cf-connecting-ip": "203.0.113.9" },
  });
  expect([200, 201]).toContain(r.status);
  const cookie = /fs_js=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? "";
  return { body: CreateJudgeSessionResponse.parse(r.body), cookie };
}

describe("boot: the previous simulator's judge sessions end", () => {
  it("clears every claim, revokes the session's tokens and says why in the workspace's ledger; idempotent", async () => {
    await refillPool(t.deps.db, 1);
    const session = await startSession();
    const ws = session.body.workspaceId;
    const as = t.credentials.bearer(session.body.consoleToken);
    expect((await t.json(`/v1/runs/${session.body.runSlug}`, { as })).status).toBe(200);

    expect(await endJudgeSessionsAtBoot(t.deps)).toEqual([ws]);
    const [row] = await t.deps.db
      .select({ claimedAt: schema.workspaces.claimedAt, expiresAt: schema.workspaces.expiresAt })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ws));
    expect(row?.claimedAt).toBeNull();
    expect(row?.expiresAt).not.toBeNull(); // the hourly purge removes it once its 24 h expiry passes
    expect((await t.json(`/v1/runs/${session.body.runSlug}`, { as })).status).toBe(401);
    const judge = await t.json("/v1/judge/session", {
      headers: { cookie: `${JUDGE_COOKIE.name}=${session.cookie}` },
    });
    expect([401, 410]).toContain(judge.status);
    const [entry] = await t.deps.db
      .select({ payload: schema.ledgerEntries.payload, actorId: schema.ledgerEntries.actorId })
      .from(schema.ledgerEntries)
      .where(
        and(eq(schema.ledgerEntries.workspaceId, ws), eq(schema.ledgerEntries.kind, "judge.session.reset")),
      );
    expect(entry).toMatchObject({
      actorId: "system:paypal-sim-boot",
      payload: { sessionId: session.body.sessionId, trigger: "simulator_restarted" },
    });
    expect(await endJudgeSessionsAtBoot(t.deps)).toEqual([]);

    // the next press is a fresh workspace on this simulator
    await refillPool(t.deps.db, 1);
    const next = await startSession();
    expect(next.body.workspaceId).not.toBe(ws);
  });
});

describe("boot: the simulated balance is read (searchBalances) into the judge quota ledger", () => {
  it("records the simulator's raised opening, so the daily cap is 40, not the opening's 5", async () => {
    const now = t.clock.now();
    const before = await estimateBalance(t.deps.db, "simulated", now);
    expect(before.source).toBe("simulator_opening");
    expect(dailyLivePostCap(JUDGE_QUOTA.simulatorOpeningCents, "2026-11-01")).toBe(5);

    const cents = await recordSimulatorBalance(t.deps);
    expect(cents).toBe(Math.round(Number(SIMULATED_BUSINESS_BALANCE_USD) * 100));
    const after = await estimateBalance(t.deps.db, "simulated", now);
    expect(after).toMatchObject({ source: "reading", cents: cents - after.spentCents });
    expect(dailyLivePostCap(after.cents ?? 0, now.toISOString().slice(0, 10))).toBe(JUDGE_QUOTA.dailyMax);
    // read again well inside the reading's 26 h freshness
    expect(BALANCE_READING_EVERY_MS).toBeLessThan(JUDGE_QUOTA.readingMaxAgeMs);
  });
});
