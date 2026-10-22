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
  parseCronArgs,
  planCronRun,
  runCron,
  WARM_EVERY_HOURS,
} from "../src/cron.js";
import { silentLogger } from "../src/log.js";
import { captureLogger } from "./helpers.js";

const at = (iso: string) => new Date(iso);
const names = (jobs: CronJob[]) => jobs.map((j) => j.name);
/** First hour index at or after 2026-10-23T00Z that is a warmCaches hour. */
const firstWarmAfter = (iso: string) => {
  let h = hourIndex(at(iso));
  while (h % WARM_EVERY_HOURS !== 0) h++;
  return new Date(h * 3_600_000 + 7 * 60_000);
};

function memorySink(): CronSink & { rows: Map<string, CronJob> } {
  const rows = new Map<string, CronJob>();
  return {
    rows,
    async enqueue(job) {
      const created = !rows.has(job.dedupeKey);
      if (created) rows.set(job.dedupeKey, job);
      return { id: `ob-${[...rows.keys()].indexOf(job.dedupeKey)}`, created };
    },
  };
}

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

  it("adds reconcile{nightly} only in the 02:00 UTC hour", () => {
    for (let h = 0; h < 24; h++) {
      const now = at(`2026-10-24T${String(h).padStart(2, "0")}:07:00Z`);
      const nightly = planCronRun(now).filter((j) => j.name === "reconcile" && j.args.mode === "nightly");
      expect(nightly).toHaveLength(h === NIGHTLY_UTC_HOUR ? 1 : 0);
    }
    const [nightly] = planCronRun(at("2026-10-24T02:07:00Z")).filter((j) => j.args.mode === "nightly");
    expect(nightly).toEqual({
      name: "reconcile",
      args: { mode: "nightly", date: "2026-10-24" },
      dedupeKey: "reconcile:nightly:2026-10-24",
    });
  });

  it("schedules warmCaches exactly every 23 hours, so grammars never pass their 24 h expiry", () => {
    const start = at("2026-10-22T00:07:00Z").getTime();
    const warmHours: number[] = [];
    for (let i = 0; i < 24 * 60; i++) {
      const now = new Date(start + i * 3_600_000);
      if (names(planCronRun(now)).includes("warmCaches")) warmHours.push(i);
    }
    expect(warmHours.length).toBeGreaterThan(60);
    const gaps = warmHours.slice(1).map((h, i) => h - (warmHours[i] as number));
    expect(new Set(gaps)).toEqual(new Set([WARM_EVERY_HOURS]));
    expect(WARM_EVERY_HOURS).toBeLessThan(24);
  });

  it("covers the Judge window through 15 Dec with hourly resets and daily nightly passes", () => {
    const start = at("2026-10-30T12:07:00Z").getTime();
    const end = at("2026-12-15T23:07:00Z").getTime();
    const counts = { judgeReset: 0, nightly: 0, warm: 0 };
    for (let t = start; t <= end; t += 3_600_000) {
      for (const j of planCronRun(new Date(t))) {
        if (j.name === "judgeReset") counts.judgeReset++;
        if (j.args.mode === "nightly") counts.nightly++;
        if (j.name === "warmCaches") counts.warm++;
      }
    }
    const hours = (end - start) / 3_600_000 + 1;
    expect(counts.judgeReset).toBe(hours);
    expect(counts.nightly).toBe(46); // 31 Oct .. 15 Dec
    expect(counts.warm).toBeGreaterThanOrEqual(Math.floor(hours / WARM_EVERY_HOURS));
  });

  it("dedupe keys are stable within an hour and unique across hours", () => {
    const a = planCronRun(at("2026-10-23T05:07:00Z")).map((j) => j.dedupeKey);
    const b = planCronRun(at("2026-10-23T05:59:59Z")).map((j) => j.dedupeKey);
    const c = planCronRun(at("2026-10-23T06:07:00Z")).map((j) => j.dedupeKey);
    expect(b).toEqual(a);
    expect(c.filter((k) => a.includes(k))).toEqual([]);
    const all = new Set<string>();
    for (let i = 0; i < 24 * 30; i++) {
      for (const k of planCronRun(new Date(at("2026-11-01T00:07:00Z").getTime() + i * 3_600_000)).map(
        (j) => j.dedupeKey,
      )) {
        expect(all.has(k)).toBe(false);
        all.add(k);
      }
    }
  });

  it("arguments are small JSON scalars (the outbox stores them; Workflows sees only ids)", () => {
    const now = firstWarmAfter("2026-11-02T02:00:00Z");
    for (const job of [...planCronRun(now), ...planCronRun(at("2026-11-02T02:07:00Z"))]) {
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
    expect(results.map((r) => r.ok)).toEqual([false, true]);
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
