// POST /internal/cron/tick without a database: the hourly plan (lifted from apps/tasks/src/cron.ts, keyed with the
// real IC-01 TASKS), the constant-time CRON_SECRET check, and the refusals that must happen before any work. The
// no-database harness turns any database access into a 500, so a 401 or 404 here also proves nothing was read.
import { TASKS, TaskArgs, type TaskName } from "@fairsplit/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../../test/index.js";
import {
  CRON_TICK_PATH,
  configuredCronSecret,
  cronSecretMatches,
  hourSlot,
  MIN_CRON_SECRET_LENGTH,
  planCronTick,
  TICK_MIN_INTERVAL_MS,
  warmWindow,
} from "./cron.js";

const SECRET = ["cron", "unit", "test", "secret", "0001"].join("-");

describe("the hourly plan (planCronTick)", () => {
  it("every pass offers judgeReset{cron} keyed by the UTC hour, and warmCaches keyed by its 23-hour window", () => {
    const now = new Date("2026-11-01T10:07:00.000Z");
    const plan = planCronTick(now);
    expect(plan.map((j) => j.name)).toEqual(["judgeReset", "warmCaches"]);
    expect(plan[0]?.args).toEqual({ trigger: "cron", workspaceId: null, slot: "2026-11-01T10" });
    expect(plan[0]?.dedupeKey).toBe("reset:pool:2026-11-01T10");
    expect(plan[1]?.args).toEqual({ slot: `w${warmWindow(now)}` });
    expect(warmWindow(now)).toBe(Math.floor(Math.floor(now.getTime() / 3_600_000) / 23));
  });

  it("passes from 02:00 to 05:59 UTC also offer the nightly reconcile, once per UTC date", () => {
    for (const at of ["2026-11-01T02:07:00.000Z", "2026-11-01T05:59:59.999Z"]) {
      const plan = planCronTick(new Date(at));
      expect(
        plan.map((j) => j.name),
        at,
      ).toEqual(["judgeReset", "reconcile", "warmCaches"]);
      // the 48 hours the nightly pass covers end at the date's midnight (Transaction Search lags about 3 h)
      expect(plan[1]?.args).toEqual({ mode: "nightly", windowStart: "2026-10-30T00:00:00.000Z" });
      expect(plan[1]?.dedupeKey).toBe("reconcile:nightly:2026-10-30T00:00:00.000Z");
    }
    for (const at of ["2026-11-01T01:59:59.999Z", "2026-11-01T06:00:00.000Z", "2026-11-01T23:07:00.000Z"]) {
      expect(
        planCronTick(new Date(at)).map((j) => j.name),
        at,
      ).not.toContain("reconcile");
    }
  });

  it("every job's arguments are the contract's and its dedupe key is the contract's", () => {
    for (const at of ["2026-11-01T02:07:00.000Z", "2026-11-01T14:07:00.000Z"]) {
      for (const job of planCronTick(new Date(at))) {
        const name: TaskName = job.name;
        expect(TaskArgs[name].parse(job.args)).toEqual(job.args);
        expect(TASKS[name].dedupeKey(job.args as never)).toBe(job.dedupeKey);
      }
    }
  });

  it("refuses an invalid date and names hours as the plan keys them", () => {
    expect(() => planCronTick(new Date(Number.NaN))).toThrow(RangeError);
    expect(hourSlot(new Date("2026-11-01T00:59:59.999Z"))).toBe("2026-11-01T00");
    expect(TICK_MIN_INTERVAL_MS).toBe(30 * 60_000);
  });
});

describe("the CRON_SECRET check", () => {
  it("accepts exactly `Bearer <CRON_SECRET>`", () => {
    expect(cronSecretMatches(SECRET, `Bearer ${SECRET}`)).toBe(true);
    expect(cronSecretMatches(SECRET, `bearer ${SECRET}`)).toBe(true);
  });

  it("refuses a missing, malformed, shorter, longer or different secret", () => {
    for (const header of [
      undefined,
      "",
      "Bearer",
      "Bearer ",
      SECRET,
      `Basic ${SECRET}`,
      `Bearer ${SECRET.slice(0, -1)}`,
      `Bearer ${SECRET}x`,
      `Bearer ${SECRET.toUpperCase()}`,
      `Bearer  ${SECRET} extra`,
    ]) {
      expect(cronSecretMatches(SECRET, header), String(header)).toBe(false);
    }
  });

  it("an unset or short CRON_SECRET counts as not configured", () => {
    expect(configuredCronSecret(undefined)).toBeNull();
    expect(configuredCronSecret("x".repeat(MIN_CRON_SECRET_LENGTH - 1))).toBeNull();
    expect(configuredCronSecret(SECRET)).toBe(SECRET);
  });
});

describe(`POST ${CRON_TICK_PATH} before any work`, () => {
  let open: TestApp;
  let closed: TestApp;
  beforeAll(async () => {
    open = await createTestApp({ env: { CRON_SECRET: SECRET } });
    closed = await createTestApp();
  });
  afterAll(async () => {
    await open.close();
    await closed.close();
  });

  it("without CRON_SECRET the route is not there: the same 404 as any unknown path, never an open tick", async () => {
    const tick = await closed.json<Record<string, unknown>>(CRON_TICK_PATH, {
      method: "POST",
      body: {},
      headers: { authorization: `Bearer ${SECRET}` },
    });
    const unknown = await closed.json<Record<string, unknown>>("/internal/cron/none", {
      method: "POST",
      body: {},
    });
    expect(tick.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(tick.body.code).toBe(unknown.body.code);
    expect(String(tick.body.message)).toBe(`No route for POST ${CRON_TICK_PATH}`);
  });

  it("a missing or wrong secret answers 401 with no detail, and reads nothing", async () => {
    for (const headers of [
      {},
      { authorization: "Bearer wrong-secret-of-some-length" },
      { authorization: `Bearer ${SECRET}x` },
      { authorization: `Basic ${SECRET}` },
    ] as Record<string, string>[]) {
      const r = await open.json<Record<string, unknown>>(CRON_TICK_PATH, {
        method: "POST",
        body: {},
        headers,
      });
      expect(r.status, JSON.stringify(headers)).toBe(401);
      expect(r.body.code).toBe("UNAUTHENTICATED");
      expect(r.body.details).toBeUndefined();
      expect(r.headers.get("retry-after")).toBeNull();
      expect(JSON.stringify(r.body)).not.toContain(SECRET);
    }
  });

  it("a right secret goes on to the database (here: none, so the harness fails the request)", async () => {
    const r = await open.json(CRON_TICK_PATH, {
      method: "POST",
      body: {},
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(r.status).toBe(500);
  });

  it("is not in the public OpenAPI document", () => {
    expect(JSON.stringify(open.app.openapi())).not.toContain(CRON_TICK_PATH);
  });
});
