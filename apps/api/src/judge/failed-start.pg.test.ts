import { CreateJudgeSessionResponse } from "@fairsplit/contracts";
import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { hashedClientIp } from "../lib/client-ip.js";
import { RATE_RULES } from "../lib/rate-limit.js";
import { createTestApp, type TestApp } from "../test/index.js";
import * as quota from "./quota.js";
import { judgeRuntime } from "./runtime.js";

let t: TestApp | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  if (t) {
    await judgeRuntime(t.deps).idle();
    await t.close();
    t = undefined;
  }
});

const IP = "198.18.13.1";
function start(app: TestApp, cookie?: string, ip = IP) {
  return app.json("/v1/judge/sessions", {
    method: "POST",
    body: {},
    headers: { "cf-connecting-ip": ip, ...(cookie ? { cookie: `fs_js=${cookie}` } : {}) },
  });
}

function budget(app: TestApp, sid: string) {
  const ip = hashedClientIp(app.deps.credentials.keys, IP, app.clock.now());
  return [
    app.deps.rateLimits.peek(RATE_RULES.judgeSessionPerIp, ip),
    app.deps.rateLimits.peek(RATE_RULES.judgeSessionPerCookie, sid),
    app.deps.rateLimits.peek(
      { ...RATE_RULES.judgeSessionGlobal, limit: app.deps.env.judgeStartsPerMinute },
      "all",
    ),
    app.deps.rateLimits.peek(RATE_RULES.judgeSessionPerNetworkDay, ip),
  ];
}

it("HD6-5: the daily network refusal explains the long wait and offers resuming", async () => {
  t = await createTestApp();
  const ip = hashedClientIp(t.deps.credentials.keys, IP, t.clock.now());
  for (let i = 0; i < RATE_RULES.judgeSessionPerNetworkDay.limit; i++) {
    t.deps.rateLimits.take(RATE_RULES.judgeSessionPerNetworkDay, ip);
  }
  const response = await start(t);
  expect(response.status).toBe(429);
  expect(response.body).toMatchObject({
    code: "RATE_LIMITED",
    retryAfterMs: RATE_RULES.judgeSessionPerNetworkDay.windowMs,
    message:
      "This network's daily new-session limit is reached. Resume an existing session or view the public showcase Proof.",
  });
});

it("HD6-13: three QUEUED starts after Reset spend no browser or network slots and the next start succeeds", async () => {
  t = await createTestApp({ db: "postgres", clock: new Date() });
  const rt = judgeRuntime(t.deps);
  vi.spyOn(rt, "refillSoon").mockImplementation(() => {});
  const first = await start(t);
  expect(first.status).toBe(201);
  const session = CreateJudgeSessionResponse.parse(first.body);
  const cookie = /fs_js=([^;]+)/.exec(first.headers.get("set-cookie") ?? "")?.[1];
  if (!cookie) throw new Error("judge cookie");
  const reset = await t.json(`/v1/judge/sessions/${session.sessionId}/reset`, {
    method: "POST",
    body: {},
    as: t.credentials.judge(cookie),
  });
  expect(reset.status).toBe(200);
  const before = budget(t, session.sessionId);
  const clones = vi.spyOn(rt, "tryEnterClone").mockReturnValue(false);
  for (let i = 0; i < 3; i++) {
    const r = await start(t, cookie);
    expect(r.body).toMatchObject({ code: "QUEUED" });
  }
  expect(budget(t, session.sessionId)).toEqual(before);
  expect(t.deps.rateLimits.peek(RATE_RULES.judgeSessionAttempts, "all")).toEqual({
    ok: true,
    remaining: RATE_RULES.judgeSessionAttempts.limit - 4,
  });
  clones.mockRestore();
  expect((await start(t, cookie)).status).toBe(201);
}, 120_000);

it("HD6-13: a failed rail decision refunds every reserved start rule", async () => {
  t = await createTestApp({ db: "postgres", clock: new Date() });
  vi.spyOn(judgeRuntime(t.deps), "refillSoon").mockImplementation(() => {});
  const before = budget(t, "unused-session");
  vi.spyOn(quota, "judgeRail").mockRejectedValueOnce(new Error("synthetic rail failure"));
  expect((await start(t)).status).toBe(500);
  expect(budget(t, "unused-session")).toEqual(before);
  expect(t.deps.rateLimits.peek(RATE_RULES.judgeSessionAttempts, "all")).toEqual({
    ok: true,
    remaining: RATE_RULES.judgeSessionAttempts.limit - 1,
  });
}, 120_000);

it("HD6 r5: 40 claimed-cap QUEUED presses spend no network, daily or global start slots", async () => {
  t = await createTestApp({ db: "postgres", clock: new Date(), env: { FS_TEST_JUDGE_CLAIMED_MAX: "3" } });
  vi.spyOn(judgeRuntime(t.deps), "refillSoon").mockImplementation(() => {});
  for (let i = 0; i < 3; i++) expect((await start(t)).status).toBe(201);
  const before = budget(t, "unused-session");
  for (let i = 0; i < 40; i++) expect((await start(t)).body).toMatchObject({ code: "QUEUED" });
  expect(budget(t, "unused-session")).toEqual(before);
  // A non-start still spends the separate expensive-work guard, which protects the shared database.
  expect(t.deps.rateLimits.peek(RATE_RULES.judgeSessionAttempts, "all")).toEqual({
    ok: true,
    remaining: RATE_RULES.judgeSessionAttempts.limit - 43,
  });
}, 120_000);

it("HD6-5: an admission burst queues without pinning the database pool and refunds start slots", async () => {
  t = await createTestApp({ db: "postgres", clock: new Date() });
  const app = t;
  if (!app.pg) throw new Error("Postgres required");
  const pg = app.pg;
  const rt = judgeRuntime(app.deps);
  vi.spyOn(rt, "refillSoon").mockImplementation(() => {});
  // Keep the pool empty and avoid materializing workspaces when exercising the old blocking path.
  vi.spyOn(rt, "tryEnterClone").mockReturnValue(false);
  const before = budget(app, "unused-session");
  const lock = await pg.owner.sql.reserve();
  const pending: ReturnType<typeof start>[] = [];
  let settled = 0;
  let healthy = false;
  let elapsedMs = Number.POSITIVE_INFINITY;
  let health: Promise<unknown> | undefined;
  try {
    await lock`begin`;
    // Another process can hold this while it clones an empty-pool workspace.
    await lock`select pg_advisory_xact_lock(hashtextextended('fs:judge-admission',0))`;
    for (let i = 0; i < app.deps.env.database.poolMax + 1; i++) {
      pending.push(start(app).finally(() => settled++));
    }
    await expect
      .poll(async () => {
        const [row] = await pg.owner.sql<{ waiting: number }[]>`
          select count(*)::int as waiting from pg_stat_activity
           where datname = current_database() and application_name = 'fs-test-app'
             and wait_event = 'advisory'`;
        // openTestDb's pool has six connections. Under the broken implementation they all block;
        // under try-lock admission every request finishes while the other process still owns the lock.
        return settled === pending.length || (row?.waiting ?? 0) >= 6;
      })
      .toBe(true);
    const began = performance.now();
    health = app.deps.db.execute(sql`select 1`).then(() => {
      elapsedMs = performance.now() - began;
      healthy = true;
    });
    await Promise.race([health, new Promise((resolve) => setTimeout(resolve, 1_000))]);
    expect(healthy, "select 1 must complete while the admission lock is held").toBe(true);
    expect(elapsedMs).toBeLessThan(1_000);
    expect(settled).toBe(pending.length);
  } finally {
    await lock`commit`;
    lock.release();
    await Promise.all(pending);
    await health;
  }
  for (const response of await Promise.all(pending)) {
    expect(response.body).toMatchObject({
      code: "QUEUED",
      retryAfterMs: 500,
      details: { reason: "PREPARING_WORKSPACE" },
    });
  }
  expect(budget(app, "unused-session")).toEqual(before);
  expect(app.deps.rateLimits.peek(RATE_RULES.judgeSessionAttempts, "all")).toEqual({
    ok: true,
    remaining: RATE_RULES.judgeSessionAttempts.limit,
  });
}, 120_000);

it("HD6 R2: 150 lock refusals cannot exhaust another network's attempts", async () => {
  t = await createTestApp({ db: "postgres", clock: new Date() });
  const app = t;
  if (!app.pg) throw new Error("Postgres required");
  vi.spyOn(judgeRuntime(app.deps), "refillSoon").mockImplementation(() => {});
  const rail = vi.spyOn(quota, "judgeRail");
  const lock = await app.pg.owner.sql.reserve();
  try {
    await lock`begin`;
    await lock`select pg_advisory_xact_lock(hashtextextended('fs:judge-admission',0))`;
    for (let i = 0; i < 150; i++) {
      expect((await start(app)).body).toMatchObject({ code: "QUEUED" });
    }
  } finally {
    await lock`commit`;
    lock.release();
  }
  expect(rail).toHaveBeenCalledTimes(150);
  expect((await start(app, undefined, "198.18.14.1")).status).toBe(201);
}, 120_000);

it("HD6-13: pending starts reserve browser slots atomically before any asynchronous work", async () => {
  t = await createTestApp({ db: "postgres", clock: new Date() });
  const app = t;
  const rt = judgeRuntime(app.deps);
  vi.spyOn(rt, "refillSoon").mockImplementation(() => {});
  const first = await start(app);
  const session = CreateJudgeSessionResponse.parse(first.body);
  const cookie = /fs_js=([^;]+)/.exec(first.headers.get("set-cookie") ?? "")?.[1];
  if (!cookie) throw new Error("judge cookie");
  await app.json(`/v1/judge/sessions/${session.sessionId}/reset`, {
    method: "POST",
    body: {},
    as: app.credentials.judge(cookie),
  });
  const before = budget(app, session.sessionId);
  vi.spyOn(rt, "tryEnterClone").mockReturnValue(false);
  const original = quota.judgeRail;
  let entered = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(quota, "judgeRail").mockImplementation(async (...args) => {
    entered++;
    await gate;
    return original(...args);
  });
  const browserBudget = before[1];
  if (!browserBudget?.ok) throw new Error("expected available browser slots");
  const available = browserBudget.remaining;
  const pending = Array.from({ length: available }, () => start(app, cookie));
  try {
    await expect.poll(() => entered).toBe(available);
    expect((await start(app, cookie)).status).toBe(429);
  } finally {
    release();
  }
  for (const response of await Promise.all(pending)) expect(response.body).toMatchObject({ code: "QUEUED" });
  expect(budget(app, session.sessionId)).toEqual(before);
}, 120_000);
