import { randomUUID } from "node:crypto";
import { CreateJudgeSessionResponse } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { eq } from "drizzle-orm";
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

function start(app: TestApp, ip: string) {
  return app.json("/v1/judge/sessions", { method: "POST", body: {}, headers: { "cf-connecting-ip": ip } });
}

it("HD6 r5: 40 judges behind one IPv6 /64 each start once, with a 60-per-hour ceiling", async () => {
  t = await createTestApp({ db: "postgres", clock: new Date() });
  vi.spyOn(judgeRuntime(t.deps), "refillSoon").mockImplementation(() => {});
  for (let i = 1; i <= 40; i++) {
    const r = await start(t, `2001:db8::${i.toString(16)}`);
    expect(r.status, `start ${i}`).toBe(201);
  }
  const key = hashedClientIp(t.deps.credentials.keys, "2001:db8::1", t.clock.now());
  expect(t.deps.rateLimits.peek(RATE_RULES.judgeSessionPerIp, key)).toEqual({ ok: true, remaining: 20 });
  for (let i = 40; i < 60; i++)
    expect(t.deps.rateLimits.take(RATE_RULES.judgeSessionPerIp, key).ok).toBe(true);
  expect((await start(t, "2001:db8::ffff")).status).toBe(429);
}, 180_000);

it("HD6-6: a third live session from one network replays lane_full without joining", async () => {
  t = await createTestApp({ db: "postgres", clock: new Date() });
  const base = await quota.judgeRail(t.deps, {
    workspaceId: randomUUID(),
    sessionId: randomUUID(),
    step: "session",
  });
  vi.spyOn(quota, "judgeRail").mockResolvedValue({ ...base, mode: "live", reason: null });
  vi.spyOn(judgeRuntime(t.deps), "refillSoon").mockImplementation(() => {});
  let third: ReturnType<typeof CreateJudgeSessionResponse.parse> | undefined;
  for (let i = 0; i < 3; i++) {
    const r = await start(t, "203.0.113.222");
    expect(r.status).toBe(201);
    third = CreateJudgeSessionResponse.parse(r.body);
  }
  const [run] = await t.deps.db
    .select()
    .from(schema.payRuns)
    .where(eq(schema.payRuns.id, third?.runId ?? ""));
  expect(run?.provenance).toBe("replay");
  expect(judgeRuntime(t.deps).lane.view().depth).toBe(2);
  const entries = await t.deps.db
    .select()
    .from(schema.ledgerEntries)
    .where(eq(schema.ledgerEntries.workspaceId, third?.workspaceId ?? ""));
  expect(entries.at(-1)?.payload).toMatchObject({ rail: "replay", replayReason: "lane_full" });
}, 60_000);

it("HD6-5: a fourth claimed workspace is queued without cloning at the test cap of three", async () => {
  t = await createTestApp({ db: "postgres", clock: new Date(), env: { FS_TEST_JUDGE_CLAIMED_MAX: "3" } });
  vi.spyOn(judgeRuntime(t.deps), "refillSoon").mockImplementation(() => {});
  for (let i = 1; i <= 3; i++) expect((await start(t, `198.18.1.${i}`)).status).toBe(201);
  const before = await t.deps.db.select({ id: schema.workspaces.id }).from(schema.workspaces);
  const r = await start(t, "198.18.1.4");
  expect(r.body).toMatchObject({ code: "QUEUED", retryAfterMs: expect.any(Number) });
  const after = await t.deps.db.select({ id: schema.workspaces.id }).from(schema.workspaces);
  expect(after).toHaveLength(before.length);
}, 60_000);

it("HD6-5: global starts stay bounded across distinct networks", async () => {
  t = await createTestApp({
    db: "postgres",
    clock: new Date(),
    env: { FS_TEST_JUDGE_STARTS_PER_MINUTE: "3" },
  });
  vi.spyOn(judgeRuntime(t.deps), "refillSoon").mockImplementation(() => {});
  for (let i = 1; i <= 3; i++) expect((await start(t, `198.18.2.${i}`)).status).toBe(201);
  const r = await start(t, "198.18.2.4");
  expect(r.status).toBe(429);
  expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
}, 60_000);
