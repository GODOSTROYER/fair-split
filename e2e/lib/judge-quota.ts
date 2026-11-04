// Private-stack-only quota fixtures. These rows explicitly model other judges' reservations; no PayPal call is
// made. Only this fixture's exact row IDs are removed, even when a run or an assertion fails.
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { Api, type JudgeSession, waitForRun } from "./api.js";
import { expect, test } from "./fixtures.js";
import { bothKeys, officers, pressToReview, workTheReview } from "./judge-run.js";
import { quotaHourDelay } from "./quota-clock.js";
import { E2E_HOURLY_CAP } from "./quota-config.js";

/** Quota counts clock hours: never insert fillers that can expire in the middle of the assertion. */
async function waitForQuotaHour(sql: ReturnType<typeof postgres>): Promise<void> {
  const [clock] = await sql<{ now: string }[]>`select clock_timestamp()::text as now`;
  if (!clock) throw new Error("quota fixture could not read the database clock");
  const delay = quotaHourDelay(Date.parse(clock.now));
  if (delay === 0) return;
  test.setTimeout(test.info().timeout + delay);
  process.stdout.write(`[judge-quota] waiting ${Math.ceil(delay / 1_000)}s for a fresh clock hour\n`);
  // Small chunks keep the wait interruptible while the old hour's rows age out.
  for (let left = delay; left > 0; left -= 30_000)
    await new Promise((resolve) => setTimeout(resolve, Math.min(left, 30_000)));
}

export async function withFullHourlyQuota<T>(run: () => Promise<T>): Promise<T> {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("quota fixtures require the private test stack (E2E_DATABASE_URL)");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const ids: string[] = [];
  try {
    await waitForQuotaHour(sql);
    for (let i = 0; i < E2E_HOURLY_CAP; i++) {
      const id = randomUUID();
      await sql`
        insert into reconciliation_reports (id, kind, window_end, summary)
        values (${id}, 'balance', clock_timestamp(), ${sql.json({
          v: 1,
          entry: "judge_post",
          runId: randomUUID(),
          workspaceId: randomUUID(),
          sessionId: null,
          coded: true,
          amountCents: 0,
          rail: "simulated",
          e2eFixture: "hourly-quota-filler",
        })})`;
      ids.push(id);
    }
    return await run();
  } finally {
    try {
      for (const id of ids) await sql`delete from reconciliation_reports where id = ${id}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
}

/** Fill only the unused slots: the next real payout must take the hour's final live reservation. */
export async function withLastHourlySlot<T>(api: Api, run: () => Promise<T>): Promise<T> {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("quota fixtures require the private test stack (E2E_DATABASE_URL)");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const ids: string[] = [];
  try {
    await waitForQuotaHour(sql);
    const lane = await api.get("/v1/judge/lane");
    expect(lane.status).toBe(200);
    const { quota } = (lane.json as { rail: { quota: { hourlyCap: number; usedThisHour: number } } }).rail;
    expect(quota.hourlyCap).toBe(E2E_HOURLY_CAP);
    expect(quota.usedThisHour).toBeLessThan(E2E_HOURLY_CAP);
    for (let i = quota.usedThisHour; i < E2E_HOURLY_CAP - 1; i++) {
      const id = randomUUID();
      await sql`
        insert into reconciliation_reports (id, kind, window_end, summary)
        values (${id}, 'balance', clock_timestamp(), ${sql.json({
          v: 1,
          entry: "judge_post",
          runId: randomUUID(),
          workspaceId: randomUUID(),
          sessionId: null,
          coded: true,
          amountCents: 0,
          rail: "simulated",
          e2eFixture: "last-hourly-slot-filler",
        })})`;
      ids.push(id);
    }
    // The public lane peek has a two-second cache; money-moving decisions always read fresh quota facts.
    await expect
      .poll(async () => (await api.get("/v1/judge/lane")).json, { intervals: [2_100], timeout: 10_000 })
      .toMatchObject({
        rail: { mode: "live", reason: null, quota: { usedThisHour: E2E_HOURLY_CAP - 1 } },
      });
    return await run();
  } finally {
    try {
      for (const id of ids) await sql`delete from reconciliation_reports where id = ${id}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
}

/** Invoice funding is simulated and verified; the quota deliberately fills only before the payout POST. */
export async function withReplayedPayout<T>(
  origin: string,
  check: (api: Api, session: JudgeSession) => Promise<T>,
): Promise<T> {
  const api = new Api(origin);
  const { s, events, reviewed } = await pressToReview(api);
  try {
    expect(reviewed?.run.state).toBe("IN_REVIEW");
    await workTheReview(api, s);
    const keys = await officers(api, s);
    return await withFullHourlyQuota(async () => {
      const lane = await api.get("/v1/judge/lane");
      expect(lane.status).toBe(200);
      expect(lane.json).toMatchObject({ rail: { mode: "replay", reason: "hourly_cap" } });
      const approvals = await bothKeys(api, s, keys);
      expect(approvals.map((a) => a.status)).toEqual([201, 201]);
      const followUp = await waitForRun(
        api,
        s,
        (r) => ["NEEDS_FOLLOW_UP", "SETTLED"].includes(r.run.state),
        120_000,
      );
      // The run and invoice retain their simulator funding provenance; the payout's own items/events label replay.
      expect(followUp?.run.provenance).toBe("simulated_rail");
      expect(followUp?.invoice?.provenance).toBe("simulated_rail");
      if (followUp?.run.state === "NEEDS_FOLLOW_UP") {
        const lines = (await api.get(`/v1/runs/${s.runSlug}/lines`, s.asTreasurer)).json as {
          lines: { id: string; state: string }[];
        };
        const rhea = lines.lines.find((line) => line.state === "UNCLAIMED");
        expect(rhea, "recorded Rhea still needs an explicit move to cash").toBeDefined();
        if (rhea) {
          const paidCash = await api.post(`/v1/lines/${rhea.id}/pay-cash`, {}, s.asTreasurer);
          expect(paidCash.status).toBe(200);
        }
      }
      const settled = await waitForRun(api, s, (r) => r.run.state === "SETTLED", 60_000);
      expect(settled?.run.state).toBe("SETTLED");
      expect(
        await events.waitFor((e) => e.type === "item.updated" && e.provenance === "replay", 10_000),
      ).not.toBeNull();
      return check(api, s);
    });
  } finally {
    await events.stop();
    await api.post(`/v1/judge/sessions/${s.sessionId}/reset`, {}, s.asJudge);
  }
}
