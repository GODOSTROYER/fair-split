// POST /internal/cron/tick on Postgres: a tick enqueues the hour's plan through the outbox in one transaction, at
// most one tick is taken per 30 minutes (decided in the database, so two fs-api processes cannot both take one),
// and the judgeReset pass it enqueues really runs from the outbox: the dispatcher claims the row and the judge
// folder's handler cancels, purges, refills the pool and drops expired webhook transmission ids. A job of the plan
// that no handler in this process would run is not enqueued (its row would only go dead): the tick skips it and
// labels it `no handler`, in the answer and in the tick record.
import { createDb, type Database, schema } from "@fairsplit/db";
import type { TaskHandlers } from "@fairsplit/outbox";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POOL_TARGET, poolSize } from "../../judge/pool.js";
import { createTestApp, type TestApp } from "../../test/index.js";
import judge from "../judge/index.js";
import type { AnyFolderModule } from "../registry.js";
import {
  CRON_TICK_PATH,
  hourSlot,
  planCronTick,
  SKIPPED_NO_HANDLER,
  TICK_MIN_INTERVAL_MS,
  takeCronTick,
} from "./cron.js";
import internal from "./index.js";

const SECRET = ["cron", "pg", "test", "secret", "0001"].join("-");
const MIN = 60_000;

interface TickBody {
  at: string;
  nextTickFrom: string;
  tasks: { task: string; dedupeKey: string; created: boolean }[];
  skipped: { task: string; dedupeKey: string; reason: string }[];
}

// reconcile and warmCaches are labelled no-ops registered elsewhere (J1); here they only stand in for them
const noOps: TaskHandlers = {
  reconcile: async () => {},
  warmCaches: async () => {},
};

/** Today's (UTC) 02:07, a nightly pass: its plan is judgeReset, reconcile and warmCaches. */
function nightlyPass(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 2, 7));
}

function tick(app: TestApp, authorization = `Bearer ${SECRET}`) {
  return app.json<TickBody & { code?: string; retryAfterMs?: number }>(CRON_TICK_PATH, {
    method: "POST",
    body: { at: new Date().toISOString() },
    headers: { authorization },
  });
}

async function outboxRows(app: TestApp, keys: readonly string[]) {
  if (keys.length === 0) return [];
  const ot = schema.taskOutbox;
  return app.deps.db
    .select({
      name: ot.name,
      dedupeKey: ot.dedupeKey,
      args: ot.args,
      workspaceId: ot.workspaceId,
      state: ot.state,
    })
    .from(ot)
    .where(inArray(ot.dedupeKey, [...keys]));
}

async function count(app: TestApp, query: ReturnType<typeof sql>): Promise<number> {
  const [row] = (await app.deps.db.execute(query)) as unknown as { n: number }[];
  return Number(row?.n ?? 0);
}

const outboxCount = (app: TestApp) => count(app, sql`select count(*)::int as n from task_outbox`);
const tickCount = (app: TestApp) =>
  count(
    app,
    sql`select count(*)::int as n from reconciliation_reports
         where kind = 'health' and workspace_id is null and summary->>'source' = 'cronTick'`,
  );

describe(`POST ${CRON_TICK_PATH} (Postgres)`, () => {
  let t: TestApp;
  beforeAll(async () => {
    // the outbox is wired (not started) with a handler for every job of the plan, so the tick skips none
    t = await createTestApp({
      db: "postgres",
      clock: new Date(),
      env: { CRON_SECRET: SECRET },
      taskHandlers: noOps,
    });
  });
  afterAll(async () => t.close());

  it("takes a tick: 202, the hour's plan enqueued as system tasks, and the tick recorded", async () => {
    const now = t.clock.now();
    const plan = planCronTick(now);
    const r = await tick(t);
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    expect(r.body.at).toBe(now.toISOString());
    expect(r.body.nextTickFrom).toBe(new Date(now.getTime() + TICK_MIN_INTERVAL_MS).toISOString());
    expect(r.body.tasks).toEqual(plan.map((j) => ({ task: j.name, dedupeKey: j.dedupeKey, created: true })));
    expect(r.body.tasks.map((x) => x.task)).toContain("judgeReset");
    expect(r.body.skipped).toEqual([]);

    const rows = await outboxRows(
      t,
      plan.map((j) => j.dedupeKey),
    );
    expect(rows).toHaveLength(plan.length);
    for (const job of plan) {
      expect(rows.find((x) => x.dedupeKey === job.dedupeKey)).toEqual({
        name: job.name,
        dedupeKey: job.dedupeKey,
        args: job.args,
        workspaceId: null,
        state: "queued",
      });
    }
    const [record] = await t.deps.db
      .select({
        windowEnd: schema.reconciliationReports.windowEnd,
        summary: schema.reconciliationReports.summary,
      })
      .from(schema.reconciliationReports)
      .where(
        and(
          eq(schema.reconciliationReports.kind, "health"),
          isNull(schema.reconciliationReports.workspaceId),
          sql`${schema.reconciliationReports.summary}->>'source' = 'cronTick'`,
        ),
      );
    expect(record?.windowEnd?.toISOString()).toBe(now.toISOString());
    expect(record?.summary).toMatchObject({
      source: "cronTick",
      tasks: plan.map((j) => ({ task: j.name, dedupeKey: j.dedupeKey, created: true })),
      skipped: [],
    });
  });

  it("refuses a second tick within 30 minutes: 429 with Retry-After, nothing enqueued or recorded", async () => {
    t.clock.advance(29 * MIN);
    const before = { outbox: await outboxCount(t), ticks: await tickCount(t) };
    const r = await tick(t);
    expect(r.status, JSON.stringify(r.body)).toBe(429);
    expect(r.body.code).toBe("RATE_LIMITED");
    expect(r.headers.get("retry-after")).toBe("60");
    expect(await outboxCount(t)).toBe(before.outbox);
    expect(await tickCount(t)).toBe(before.ticks);
    // not even the next hour's judgeReset slot, if 29 minutes crossed the hour
    expect(await outboxRows(t, [planCronTick(t.clock.now())[0]?.dedupeKey ?? "-"])).toHaveLength(
      hourSlot(t.clock.now()) === hourSlot(new Date(t.clock.nowMs() - 29 * MIN)) ? 1 : 0,
    );
  });

  it("takes the next tick 30 minutes after the last; a job already queued for its slot is not queued twice", async () => {
    t.clock.advance(1 * MIN);
    const plan = planCronTick(t.clock.now());
    const existing = new Set(
      (
        await outboxRows(
          t,
          plan.map((j) => j.dedupeKey),
        )
      ).map((x) => x.dedupeKey),
    );
    const before = await outboxCount(t);
    const r = await tick(t);
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    expect(r.body.tasks).toEqual(
      plan.map((j) => ({ task: j.name, dedupeKey: j.dedupeKey, created: !existing.has(j.dedupeKey) })),
    );
    expect(await outboxCount(t)).toBe(before + plan.filter((j) => !existing.has(j.dedupeKey)).length);
  });

  it("a wrong secret answers 401 and writes nothing, even when a tick is due", async () => {
    t.clock.advance(31 * MIN);
    const before = { outbox: await outboxCount(t), ticks: await tickCount(t) };
    for (const auth of ["", "Bearer not-the-cron-secret-at-all", `Bearer ${SECRET}0`]) {
      const r = await tick(t, auth);
      expect(r.status).toBe(401);
      expect(r.body.code).toBe("UNAUTHENTICATED");
    }
    expect(await outboxCount(t)).toBe(before.outbox);
    expect(await tickCount(t)).toBe(before.ticks);
  });

  it("two ticks at the same moment: exactly one is taken, the other is refused", async () => {
    const before = await tickCount(t);
    const results = await Promise.all([tick(t), tick(t), tick(t)]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 429, 429]);
    expect(await tickCount(t)).toBe(before + 1);
  });

  it("two fs-api processes (two connection pools) racing: exactly one takes the tick", async () => {
    if (!t.pg) throw new Error("no database");
    t.clock.advance(31 * MIN);
    const pools: Database[] = [
      createDb(t.pg.url, { role: "fs_app", max: 3, applicationName: "fs-api-a" }),
      createDb(t.pg.url, { role: "fs_app", max: 3, applicationName: "fs-api-b" }),
    ];
    try {
      const before = await tickCount(t);
      const now = t.clock.now();
      const outcomes = await Promise.all(
        [0, 1, 0, 1, 0, 1].map((i) => takeCronTick((pools[i] as Database).db, now, () => true)),
      );
      expect(outcomes.filter((o) => o.kind === "accepted")).toHaveLength(1);
      const refused = outcomes.filter((o) => o.kind === "refused");
      expect(refused).toHaveLength(5);
      for (const o of refused) if (o.kind === "refused") expect(o.retryAfterMs).toBe(TICK_MIN_INTERVAL_MS);
      expect(await tickCount(t)).toBe(before + 1);
    } finally {
      await Promise.all(pools.map((p) => p.close()));
    }
  });
});

describe("the judgeReset pass a tick enqueues runs from the outbox", () => {
  let t: TestApp;
  const ran: { task: string; args: unknown }[] = [];
  // reconcile and warmCaches stand in for J1's labelled no-ops; here they only record that they ran
  const stubs: TaskHandlers = {
    reconcile: async (args) => {
      ran.push({ task: "reconcile", args });
    },
    warmCaches: async (args) => {
      ran.push({ task: "warmCaches", args });
    },
  };
  beforeAll(async () => {
    t = await createTestApp({
      db: "postgres",
      clock: new Date(),
      env: { CRON_SECRET: SECRET },
      dispatcher: true,
      taskHandlers: stubs,
    });
  });
  afterAll(async () => t.close());

  it("the dispatcher runs judgeReset{cron}: pool refilled, health report written, expired transmission ids purged", async () => {
    const now = t.clock.now();
    const tw = schema.webhookTransmissions;
    await t.deps.db.insert(tw).values([
      { transmissionId: "cron-expired-0001", expiresAt: new Date(now.getTime() - MIN) },
      { transmissionId: "cron-live-0001", expiresAt: new Date(now.getTime() + 5 * MIN) },
    ]);
    const plan = planCronTick(now);
    const reset = plan.find((j) => j.name === "judgeReset");
    if (!reset) throw new Error("the plan has no judgeReset");

    const r = await tick(t);
    expect(r.status, JSON.stringify(r.body)).toBe(202);

    // every job of the tick finishes through the dispatcher (judgeReset by the judge folder's own handler)
    const keys = plan.map((j) => j.dedupeKey);
    const until = Date.now() + 90_000;
    let rows = await outboxRows(t, keys);
    while (Date.now() < until && !rows.every((x) => x.state === "done" || x.state === "dead")) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      rows = await outboxRows(t, keys);
    }
    expect(Object.fromEntries(rows.map((x) => [x.name, x.state]))).toEqual(
      Object.fromEntries(plan.map((j) => [j.name, "done"])),
    );

    const [health] = (await t.deps.db.execute(sql`
      select summary from reconciliation_reports
       where kind = 'health' and workspace_id is null and summary->>'source' = 'judgeReset'
       order by created_at desc limit 1`)) as unknown as { summary: Record<string, unknown> }[];
    expect(health?.summary).toMatchObject({
      source: "judgeReset",
      trigger: "cron",
      slot: hourSlot(now),
      transmissionsPurged: 1,
    });
    expect(await poolSize(t.deps.db)).toBeGreaterThanOrEqual(POOL_TARGET);
    const left = await t.deps.db.select({ id: tw.transmissionId }).from(tw);
    expect(left.map((x) => x.id)).toEqual(["cron-live-0001"]);

    expect(ran.map((x) => x.task).sort()).toEqual(
      plan
        .filter((j) => j.name !== "judgeReset")
        .map((j) => j.name)
        .sort(),
    );
  });
});

// Only the judge folder's judgeReset is registered here (whatever handlers other folders add), so the nightly pass's
// reconcile and warmCaches have no handler in this process. Before the fix their rows were claimed, failed with
// 'no handler registered' eight times and went dead.
describe("a job of the plan that no handler in this process would run", () => {
  let t: TestApp;
  const judgeResetOnly: AnyFolderModule = {
    ...judge,
    tasks: (deps) => ({ judgeReset: judge.tasks?.(deps).judgeReset }),
  };
  beforeAll(async () => {
    t = await createTestApp({
      db: "postgres",
      clock: nightlyPass(),
      env: { CRON_SECRET: SECRET },
      folders: [judgeResetOnly, internal],
      dispatcher: true,
    });
  });
  afterAll(async () => t.close());

  it("is skipped and labelled 'no handler' (answer and tick record), never enqueued, so no row goes dead", async () => {
    const now = t.clock.now();
    const plan = planCronTick(now);
    expect(plan.map((j) => j.name)).toEqual(["judgeReset", "reconcile", "warmCaches"]);
    const reset = plan.filter((j) => j.name === "judgeReset");
    const missing = plan.filter((j) => j.name !== "judgeReset");

    const r = await tick(t);
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    expect(r.body.tasks).toEqual(reset.map((j) => ({ task: j.name, dedupeKey: j.dedupeKey, created: true })));
    const skipped = missing.map((j) => ({
      task: j.name,
      dedupeKey: j.dedupeKey,
      reason: SKIPPED_NO_HANDLER,
    }));
    expect(r.body.skipped).toEqual(skipped);
    expect(SKIPPED_NO_HANDLER).toBe("no handler");

    const [record] = (await t.deps.db.execute(sql`
      select summary from reconciliation_reports
       where kind = 'health' and workspace_id is null and summary->>'source' = 'cronTick'`)) as unknown as {
      summary: Record<string, unknown>;
    }[];
    expect(record?.summary).toMatchObject({ source: "cronTick", skipped });

    const keys = reset.map((j) => j.dedupeKey);
    const until = Date.now() + 90_000;
    let rows = await outboxRows(t, keys);
    while (Date.now() < until && !rows.every((x) => x.state === "done" || x.state === "dead")) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      rows = await outboxRows(t, keys);
    }
    expect(rows.map((x) => [x.name, x.state])).toEqual([["judgeReset", "done"]]);
    expect(
      await outboxRows(
        t,
        missing.map((j) => j.dedupeKey),
      ),
    ).toEqual([]);
    const ot = schema.taskOutbox;
    expect(
      await t.deps.db
        .select({ name: ot.name })
        .from(ot)
        .where(inArray(ot.name, ["reconcile", "warmCaches"])),
    ).toEqual([]);
    expect(await count(t, sql`select count(*)::int as n from task_outbox where state = 'dead'`)).toBe(0);
  });
});

describe("a tick in a process that runs no outbox", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ db: "postgres", clock: nightlyPass(), env: { CRON_SECRET: SECRET } });
  });
  afterAll(async () => t.close());

  it("enqueues nothing and labels every job 'no handler': nothing here would run it", async () => {
    const plan = planCronTick(t.clock.now());
    const r = await tick(t);
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    expect(r.body.tasks).toEqual([]);
    expect(r.body.skipped).toEqual(
      plan.map((j) => ({ task: j.name, dedupeKey: j.dedupeKey, reason: SKIPPED_NO_HANDLER })),
    );
    expect(await outboxCount(t)).toBe(0);
    expect(await tickCount(t)).toBe(1);
  });
});
