import { CreateJudgeSessionResponse } from "@fairsplit/contracts";
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
function start(app: TestApp, cookie?: string) {
  return app.json("/v1/judge/sessions", {
    method: "POST",
    body: {},
    headers: { "cf-connecting-ip": IP, ...(cookie ? { cookie: `fs_js=${cookie}` } : {}) },
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
