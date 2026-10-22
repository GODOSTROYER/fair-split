import { describe, expect, it, vi } from "vitest";
import { readBlueprint } from "../../../tools/lib/blueprint.js";
import {
  CRON_SCHEDULE,
  type CronJob,
  type CronSink,
  hourIndex,
  hourSlot,
  main,
  NIGHTLY_UTC_HOUR,
  NIGHTLY_WINDOW_HOURS,
  parseCronArgs,
  planCronRun,
  runCron,
  WARM_EVERY_HOURS,
  warmWindow,
} from "../src/cron.js";
import { silentLogger } from "../src/log.js";
import { captureLogger } from "./helpers.js";

const at = (iso: string) => new Date(iso);
function memorySink(): CronSink & { rows: Map<string, CronJob>; createdAt: Map<string, number> } {
  const rows = new Map<string, CronJob>();
  const createdAt = new Map<string, number>();
  let hour = 0;
  return {
    rows,
    createdAt,
    async enqueue(job) {
      const created = !rows.has(job.dedupeKey);
      if (created) {
        rows.set(job.dedupeKey, job);
        createdAt.set(job.dedupeKey, hour);
      }
      return { id: `ob-${[...rows.keys()].indexOf(job.dedupeKey)}`, created };
    },
    set hourIndex(h: number) {
      hour = h;
    },
  } as CronSink & { rows: Map<string, CronJob>; createdAt: Map<string, number> };
}

/** Run every hourly pass from `startIso` for `hours`, skipping the passes in `missed`. */
async function simulate(startIso: string, hours: number, missed: ReadonlySet<number> = new Set()) {
  const sink = memorySink();
  const start = at(startIso).getTime();
  for (let i = 0; i < hours; i++) {
    if (missed.has(i)) continue;
    (sink as unknown as { hourIndex: number }).hourIndex = i;
    await runCron(new Date(start + i * 3_600_000), sink, silentLogger());
  }
  const createdHours = (prefix: string) =>
    [...sink.createdAt.entries()].filter(([k]) => k.startsWith(prefix)).map(([, h]) => h);
  return { sink, createdHours };
}

const gaps = (hours: number[]) => hours.slice(1).map((h, i) => h - (hours[i] as number));

describe("cron schedule", () => {
  it("runs hourly at minute 7, and render.yaml agrees", () => {
    expect(CRON_SCHEDULE).toBe("7 * * * *");
    const cron = readBlueprint().services?.find((s) => s.name === "fs-cron");
    expect(cron?.schedule).toBe(CRON_SCHEDULE);
    expect(cron?.startCommand).toBe("node apps/tasks/dist/cron.js");
  });

  it("every pass enqueues judgeReset then reconcile{catchup}", () => {
    const jobs = planCronRun(at("2026-10-23T05:07:00Z"));
    expect(jobs.slice(0, 2)).toEqual([
      {
        name: "judgeReset",
        args: { trigger: "cron", slot: "2026-10-23T05" },
        dedupeKey: "judgeReset:cron:2026-10-23T05",
      },
      {
        name: "reconcile",
        args: { mode: "catchup", slot: "2026-10-23T05" },
        dedupeKey: "reconcile:catchup:2026-10-23T05",
      },
    ]);
  });

  it("offers reconcile{nightly} on every pass from 02:00 to 05:59 UTC, keyed by date", () => {
    for (let h = 0; h < 24; h++) {
      const now = at(`2026-10-24T${String(h).padStart(2, "0")}:07:00Z`);
      const nightly = planCronRun(now).filter((j) => j.name === "reconcile" && j.args.mode === "nightly");
      const inWindow = h >= NIGHTLY_UTC_HOUR && h < NIGHTLY_UTC_HOUR + NIGHTLY_WINDOW_HOURS;
      expect(nightly, `hour ${h}`).toHaveLength(inWindow ? 1 : 0);
    }
    const [nightly] = planCronRun(at("2026-10-24T04:07:00Z")).filter((j) => j.args.mode === "nightly");
    expect(nightly).toEqual({
      name: "reconcile",
      args: { mode: "nightly", date: "2026-10-24" },
      dedupeKey: "reconcile:nightly:2026-10-24",
    });
  });

  it("offers warmCaches on every pass, keyed by its 23-hour window", () => {
    const now = at("2026-10-23T05:07:00Z");
    const warm = planCronRun(now).filter((j) => j.name === "warmCaches");
    expect(warm).toEqual([
      { name: "warmCaches", args: { window: warmWindow(now) }, dedupeKey: `warmCaches:w${warmWindow(now)}` },
    ]);
    expect(warmWindow(now)).toBe(Math.floor(hourIndex(now) / WARM_EVERY_HOURS));
    expect(WARM_EVERY_HOURS).toBeLessThan(24);
  });

  it("with every pass succeeding, warmCaches runs exactly every 23 h and nightly once a day at 02:07", async () => {
    const { createdHours } = await simulate("2026-10-22T00:07:00Z", 24 * 60);
    const warm = createdHours("warmCaches:");
    expect(warm.length).toBeGreaterThan(60);
    expect(new Set(gaps(warm.slice(1)))).toEqual(new Set([WARM_EVERY_HOURS]));
    const nightly = createdHours("reconcile:nightly:");
    expect(nightly).toHaveLength(60);
    for (const h of nightly) expect(h % 24).toBe(NIGHTLY_UTC_HOUR);
  });

  it("a missed or failed pass is made up by the next one, not a window or a day later", async () => {
    const start = "2026-10-22T00:07:00Z";
    const { createdHours: clean } = await simulate(start, 24 * 10);
    const warmHours = clean("warmCaches:");
    // Miss the pass that would warm, and the 02:07 and 03:07 nightly passes on day 3.
    const missed = new Set([warmHours[2] as number, 2 * 24 + 2, 2 * 24 + 3]);
    const { createdHours } = await simulate(start, 24 * 10, missed);
    const warm = createdHours("warmCaches:");
    expect(warm[2]).toBe((warmHours[2] as number) + 1);
    expect(Math.max(...gaps(warm))).toBeLessThanOrEqual(WARM_EVERY_HOURS + 1);
    expect(createdHours("reconcile:nightly:")).toContain(2 * 24 + 4);
  });

  it("covers the Judge window through 15 Dec with hourly resets and daily nightly passes", async () => {
    const start = at("2026-10-30T12:07:00Z").getTime();
    const end = at("2026-12-15T23:07:00Z").getTime();
    const hours = (end - start) / 3_600_000 + 1;
    const { createdHours } = await simulate("2026-10-30T12:07:00Z", hours);
    expect(createdHours("judgeReset:")).toHaveLength(hours);
    expect(createdHours("reconcile:nightly:")).toHaveLength(46); // 31 Oct .. 15 Dec
    expect(createdHours("warmCaches:").length).toBeGreaterThanOrEqual(Math.floor(hours / WARM_EVERY_HOURS));
  });

  it("hourly keys are unique per hour; nightly and warm keys repeat until their slot ends", () => {
    const a = planCronRun(at("2026-10-23T05:07:00Z"));
    const b = planCronRun(at("2026-10-23T05:59:59Z"));
    expect(b).toEqual(a);
    const hourly = new Set<string>();
    for (let i = 0; i < 24 * 30; i++) {
      for (const j of planCronRun(new Date(at("2026-11-01T00:07:00Z").getTime() + i * 3_600_000))) {
        if (j.name === "warmCaches" || j.args.mode === "nightly") continue;
        expect(hourly.has(j.dedupeKey)).toBe(false);
        hourly.add(j.dedupeKey);
      }
    }
    const night = (iso: string) => planCronRun(at(iso)).find((j) => j.args.mode === "nightly")?.dedupeKey;
    expect(night("2026-11-02T02:07:00Z")).toBe(night("2026-11-02T05:07:00Z"));
    expect(night("2026-11-02T02:07:00Z")).not.toBe(night("2026-11-03T02:07:00Z"));
  });

  it("arguments are small JSON scalars (the outbox stores them; Workflows sees only ids)", () => {
    for (const job of planCronRun(at("2026-11-02T02:07:00Z"))) {
      for (const v of Object.values(job.args)) expect(["string", "number"]).toContain(typeof v);
      expect(JSON.stringify(job).length).toBeLessThan(200);
    }
  });

  it("hourSlot is the UTC hour", () => {
    expect(hourSlot(at("2026-10-23T23:59:59.999Z"))).toBe("2026-10-23T23");
    expect(hourSlot(at("2026-10-24T05:37:00+05:30"))).toBe("2026-10-24T00");
  });

  it("rejects an invalid date", () => {
    expect(() => planCronRun(new Date("nope"))).toThrow();
  });
});

describe("runCron", () => {
  it("enqueues every planned job, and a re-run of the same hour creates nothing new", async () => {
    const sink = memorySink();
    const now = at("2026-10-24T02:07:00Z");
    const first = await runCron(now, sink, silentLogger());
    expect(first.every((r) => r.ok && r.created)).toBe(true);
    const again = await runCron(now, sink, silentLogger());
    expect(again.every((r) => r.ok && r.created === false)).toBe(true);
    expect(sink.rows.size).toBe(first.length);
  });

  it("keeps going when one enqueue fails, and reports it", async () => {
    const sink: CronSink = {
      enqueue: vi.fn(async (job: CronJob) => {
        if (job.name === "judgeReset") throw new Error("lock timeout");
        return { id: "ob-1", created: true };
      }),
    };
    const { logger, lines } = captureLogger();
    const results = await runCron(at("2026-10-23T05:07:00Z"), sink, logger);
    expect(results.map((r) => r.ok)).toEqual([false, true, true, true]);
    expect(results[0]?.error).toBe("lock timeout");
    expect(lines.some((l) => l.msg === "cron.enqueue failed" && l.task === "judgeReset")).toBe(true);
  });
});

describe("cron main", () => {
  it("--plan prints the plan and exits 0 without a sink", async () => {
    const { logger, lines } = captureLogger();
    await expect(main(["--plan", "--at=2026-10-24T02:07:00Z"], { logger, sink: undefined })).resolves.toBe(0);
    expect(lines.filter((l) => l.msg === "cron.plan").map((l) => l.task)).toEqual([
      "judgeReset",
      "reconcile",
      "reconcile",
      "warmCaches",
    ]);
  });

  it("exits 1 when no outbox is wired, so the Render cron run shows as failed", async () => {
    await expect(main([], { logger: silentLogger(), sink: undefined })).resolves.toBe(1);
  });

  it("exits 0 when every job is enqueued, 1 when any fails", async () => {
    const now = () => at("2026-10-23T05:07:00Z");
    await expect(main([], { logger: silentLogger(), sink: memorySink(), now })).resolves.toBe(0);
    const failing: CronSink = { enqueue: async () => Promise.reject(new Error("down")) };
    await expect(main([], { logger: silentLogger(), sink: failing, now })).resolves.toBe(1);
  });

  it("parses arguments strictly", () => {
    expect(parseCronArgs(["--dry-run"])).toEqual({ plan: true });
    expect(parseCronArgs(["--at=2026-10-23T05:07:00Z"]).at?.toISOString()).toBe("2026-10-23T05:07:00.000Z");
    expect(() => parseCronArgs(["--at=yesterday"])).toThrow();
    expect(() => parseCronArgs(["--force"])).toThrow();
  });
});
