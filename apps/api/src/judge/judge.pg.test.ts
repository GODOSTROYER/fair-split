// Judge slice on embedded Postgres: the world clone, the pool, sessions (start, resume, throttles, QUEUED),
// Reset, presence, the "Try to break it" controls, the judge code, demo keys and the judgeReset task.
import { createHash, sign as edSign, generateKeyPairSync } from "node:crypto";
import {
  ApiError,
  CreateJudgeSessionResponse,
  DeviceKeyId,
  LedgerPayloads,
  RunEvent,
  TASKS,
} from "@fairsplit/contracts";
import { asDbError, schema, verifyChain } from "@fairsplit/db";
import { jcs } from "@fairsplit/domain";
import { getMembers, getPhotos, getSlips, getSnapshot } from "@fairsplit/seed";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JUDGE_COOKIE } from "../credentials/verify/index.js";
import { hashedClientIp } from "../lib/client-ip.js";
import { createTestApp, type TestApp } from "../test/index.js";
import { demoKeyStatement } from "./keys.js";
import { claimPooledWorkspace, poolName, poolSize, purgeExpiredJudgeWorkspaces, refillPool } from "./pool.js";
import { recordBalanceReading } from "./quota.js";
import { runJudgeReset } from "./reset-task.js";
import { judgeRuntime, MAX_CONCURRENT_CLONES } from "./runtime.js";
import { tamperArmed } from "./tamper.js";
import { openingLedger } from "./world.js";

let t: TestApp;

beforeAll(async () => {
  // the app clock starts at the real time, so the database clock (purge, limiter) agrees with it
  t = await createTestApp({ db: "postgres", clock: new Date() });
});
afterAll(async () => t.close());
beforeEach(() => t.deps.rateLimits.reset());

function owner() {
  if (!t.pg) throw new Error("no database");
  return t.pg.owner.db;
}
function ownerSql() {
  if (!t.pg) throw new Error("no database");
  return t.pg.owner.sql;
}
type SessionBody = ReturnType<typeof CreateJudgeSessionResponse.parse>;

interface Started {
  status: number;
  body: SessionBody;
  cookie: string;
  setCookie: string;
}

function cookieFrom(setCookie: string | null): string {
  const m = /fs_js=([^;]+)/.exec(setCookie ?? "");
  if (!m?.[1]) throw new Error(`no fs_js cookie in ${setCookie}`);
  return m[1];
}

async function startSession(o: { cookie?: string; ip?: string } = {}): Promise<Started> {
  const headers: Record<string, string> = { "true-client-ip": o.ip ?? "203.0.113.7" };
  if (o.cookie) headers.cookie = `${JUDGE_COOKIE.name}=${o.cookie}`;
  const r = await t.json<SessionBody>("/v1/judge/sessions", { method: "POST", body: {}, headers });
  if (r.status !== 201 && r.status !== 200)
    throw new Error(`session start: ${r.status} ${JSON.stringify(r.body)}`);
  const setCookie = r.headers.get("set-cookie");
  return {
    status: r.status,
    body: CreateJudgeSessionResponse.parse(r.body),
    cookie: setCookie ? cookieFrom(setCookie) : (o.cookie ?? ""),
    setCookie: setCookie ?? "",
  };
}

const judge = (cookie: string) => t.credentials.judge(cookie);

async function drainPool(): Promise<void> {
  const now = t.clock.now();
  while ((await poolSize(t.deps.db)) > 0) {
    await t.deps.db.transaction((tx) => claimPooledWorkspace(tx, now, new Date(now.getTime() + 60_000)));
  }
}

describe("the judge world (a clone of the seed)", () => {
  it("clones the canonical season, ratified, with the seed's opening ledger", async () => {
    await refillPool(t.deps.db, 1);
    const [ws] = await t.deps.db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(and(eq(schema.workspaces.kind, "judge"), eq(schema.workspaces.name, poolName())))
      .limit(1);
    expect(ws).toBeDefined();
    const id = ws?.id as string;
    const count = async (table: string) => {
      const rows = (await t.deps.db.execute(
        sql`select count(*)::int as n from ${sql.identifier(table)} where workspace_id = ${id}`,
      )) as unknown as { n: number }[];
      return rows[0]?.n ?? -1;
    };
    const s = getSnapshot();
    expect(await count("members")).toBe(getMembers().length);
    expect(await count("documents")).toBe(getPhotos().length);
    expect(await count("slip_rows")).toBe(getSlips().filter((x) => !x.replaySet).length);
    expect(await count("plots")).toBe(s.members.flatMap((m) => m.plots).filter((p) => p.registered).length);
    expect(await count("rate_rules")).toBe(5);
    expect(await count("ratifications")).toBe(2);
    expect(await count("pay_runs")).toBe(0);
    expect(await count("memberships")).toBe(5);
    const [card] = await t.deps.db
      .select({ sha256: schema.rateCards.sha256, ratifiedAt: schema.rateCards.ratifiedAt })
      .from(schema.rateCards)
      .where(eq(schema.rateCards.workspaceId, id));
    expect(card?.sha256).toBe(s.rateCard.sha256);
    expect(card?.ratifiedAt?.toISOString()).toBe(s.rateCard.ratifiedAt);
    // the opening ledger: the seed's ratification and archived reads, hash-chained
    const chain = await verifyChain(t.deps.db, id);
    expect(chain).toMatchObject({ ok: true, count: openingLedger().length });
    const kinds = await t.deps.db
      .select({ kind: schema.ledgerEntries.kind, payload: schema.ledgerEntries.payload })
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.workspaceId, id))
      .orderBy(schema.ledgerEntries.seq);
    expect(kinds[1]?.kind).toBe("rate_card.ratified");
    expect(LedgerPayloads["rate_card.ratified"].parse(kinds[1]?.payload).rateCardSha256).toBe(
      s.rateCard.sha256,
    );
  });

  it("inv.i2.bolted: a cloned card refuses any change (409 RATE_CARD_RATIFIED from the trigger)", async () => {
    const [card] = await t.deps.db
      .select({ id: schema.rateCards.id })
      .from(schema.rateCards)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.rateCards.workspaceId))
      .where(eq(schema.workspaces.kind, "judge"))
      .limit(1);
    const err = await t.deps.db
      .update(schema.rateCards)
      .set({ code: "BR tampered" })
      .where(eq(schema.rateCards.id, card?.id as string))
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(asDbError(err)).toMatchObject({
      code: "RATE_CARD_RATIFIED",
      subject: getSnapshot().rateCard.sha256,
    });
  });

  it("claims a pooled workspace once: SKIP LOCKED never hands one workspace to two judges", async () => {
    await refillPool(t.deps.db, 2);
    const before = await poolSize(t.deps.db);
    expect(before).toBeGreaterThanOrEqual(2);
    const now = t.clock.now();
    const exp = new Date(now.getTime() + 60_000);
    const [a, b] = await Promise.all([
      t.deps.db.transaction((tx) => claimPooledWorkspace(tx, now, exp)),
      t.deps.db.transaction((tx) => claimPooledWorkspace(tx, now, exp)),
    ]);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    expect(await poolSize(t.deps.db)).toBe(before - 2);
  });

  it("claims in lock order (workspace lock, then row): a pooled workspace whose lock is held is skipped, never waited on", async () => {
    await refillPool(t.deps.db, 2);
    const w = schema.workspaces;
    const free = await t.deps.db
      .select({ id: w.id })
      .from(w)
      .where(and(eq(w.kind, "judge"), isNull(w.claimedAt), isNull(w.expiresAt), eq(w.name, poolName())))
      .orderBy(w.createdAt)
      .limit(2);
    expect(free).toHaveLength(2);
    // another transaction holds the oldest one's workspace lock (db/tx.ts: taken before any row lock)
    const holder = await ownerSql().reserve();
    await holder`select pg_advisory_lock(hashtextextended(${`fs:ws-log:${free[0]?.id}`}, 0))`;
    try {
      const now = t.clock.now();
      const claimed = await t.deps.db.transaction((tx) =>
        claimPooledWorkspace(tx, now, new Date(now.getTime() + 60_000)),
      );
      expect(claimed).toBe(free[1]?.id);
    } finally {
      await holder`select pg_advisory_unlock_all()`;
      holder.release();
    }
  });
});

describe("POST /v1/judge/sessions (createJudgeSession)", () => {
  it("inv.i7.outbox: starts a session: 201, the fs_js cookie, a console token, a fresh run and Claude's invoice turn enqueued in one transaction", async () => {
    const s = await startSession();
    expect(s.status).toBe(201);
    expect(s.setCookie).toMatch(/HttpOnly/i);
    expect(s.setCookie).toMatch(/SameSite=Lax/i);
    expect(s.setCookie).toMatch(/Path=\//);
    expect(s.body.runSlug).toMatch(/^2026A-r\d+$/);
    expect(s.body.consoleToken).toMatch(/^fst_/);
    // the console token acts as treasurer:analyn in the new workspace, impersonated by the session
    const who = await t.json<{ actor: string; impersonatedBy: string; workspaceId: string }>(
      "/v1/credential",
      {
        as: t.credentials.bearer(s.body.consoleToken),
      },
    );
    expect(who.status).toBe(200);
    expect(who.body).toMatchObject({
      actor: "treasurer:analyn",
      impersonatedBy: `judge_session:${s.body.sessionId}`,
      workspaceId: s.body.workspaceId,
    });
    const [run] = await t.deps.db
      .select({ state: schema.payRuns.state, provenance: schema.payRuns.provenance })
      .from(schema.payRuns)
      .where(eq(schema.payRuns.id, s.body.runId));
    expect(run?.state).toBe("DRAFT");
    // I8: in simulator mode with no simulator running, the run's PayPal steps replay, and the run says so
    expect(run?.provenance).toBe("replay");
    expect(s.body.queuePosition).toBeNull();
    // I7: the invoice turn is an outbox row written with the run
    const tasks = await t.deps.db
      .select({
        name: schema.taskOutbox.name,
        args: schema.taskOutbox.args,
        key: schema.taskOutbox.dedupeKey,
      })
      .from(schema.taskOutbox)
      .where(eq(schema.taskOutbox.workspaceId, s.body.workspaceId));
    const turn = { runId: s.body.runId, purpose: "DRAFT_INVOICE", holdId: null, turn: 0 } as const;
    expect(tasks).toEqual([{ name: "agentTurn", args: turn, key: TASKS.agentTurn.dedupeKey(turn) }]);
    // the session is in the workspace's ledger, and the cookie names it
    const entries = await t.deps.db
      .select({ kind: schema.ledgerEntries.kind, impersonatedBy: schema.ledgerEntries.impersonatedBy })
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, s.body.workspaceId),
          eq(schema.ledgerEntries.kind, "judge.session.started"),
        ),
      );
    expect(entries).toEqual([
      { kind: "judge.session.started", impersonatedBy: `judge_session:${s.body.sessionId}` },
    ]);
  });

  it("resumes the cookie's session: 200, same session, run and workspace, a fresh console token, no new task", async () => {
    const first = await startSession();
    const again = await startSession({ cookie: first.cookie });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({
      sessionId: first.body.sessionId,
      workspaceId: first.body.workspaceId,
      runId: first.body.runId,
      runSlug: first.body.runSlug,
    });
    expect(again.body.consoleToken).not.toBe(first.body.consoleToken);
    const tasks = await t.deps.db
      .select({ id: schema.taskOutbox.id })
      .from(schema.taskOutbox)
      .where(eq(schema.taskOutbox.workspaceId, first.body.workspaceId));
    expect(tasks).toHaveLength(1);
  });

  it("gives every run a fresh runSeq from the one global sequence", async () => {
    const a = await startSession({ ip: "203.0.113.20" });
    const b = await startSession({ ip: "203.0.113.21" });
    const seq = (slug: string) => Number(slug.split("-r")[1]);
    expect(seq(b.body.runSlug)).toBeGreaterThan(seq(a.body.runSlug));
    expect(a.body.workspaceId).not.toBe(b.body.workspaceId);
  });

  it("answers 429 RATE_LIMITED after three new sessions an hour from one cookie", async () => {
    let s = await startSession({ ip: "198.51.100.1" });
    const sid = s.body.sessionId;
    for (let i = 0; i < 2; i++) {
      await t.json(`/v1/judge/sessions/${sid}/reset`, { method: "POST", body: {}, as: judge(s.cookie) });
      s = await startSession({ cookie: s.cookie, ip: "198.51.100.1" });
      expect(s.status).toBe(201);
      expect(s.body.sessionId).toBe(sid); // the session id outlives a Reset
    }
    await t.json(`/v1/judge/sessions/${sid}/reset`, { method: "POST", body: {}, as: judge(s.cookie) });
    const r = await t.json<ApiError>("/v1/judge/sessions", {
      method: "POST",
      body: {},
      headers: { cookie: `${JUDGE_COOKIE.name}=${s.cookie}`, "true-client-ip": "198.51.100.1" },
    });
    expect(r.status).toBe(429);
    expect(ApiError.parse(r.body)).toMatchObject({ code: "RATE_LIMITED" });
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("answers 429 RATE_LIMITED after 30 new sessions an hour from one network (hashed IP)", async () => {
    // the throttle keys on the daily-salted HMAC of the address, never the address itself
    const key = hashedClientIp(t.deps.credentials.keys, "192.0.2.99", t.clock.now());
    for (let i = 0; i < 30; i++) {
      t.deps.rateLimits.take({ name: "judgeSessionPerIp", limit: 30, windowMs: 3_600_000 }, key);
    }
    const r = await t.json<ApiError>("/v1/judge/sessions", {
      method: "POST",
      body: {},
      headers: { "true-client-ip": "192.0.2.99" },
    });
    expect(r.status).toBe(429);
    expect(ApiError.parse(r.body).code).toBe("RATE_LIMITED");
  });

  it("answers 429 QUEUED (with Retry-After) when the pool is empty and clones are already in flight", async () => {
    // no refill in flight, drain the pool, then hold every on-demand clone slot
    const rt = judgeRuntime(t.deps);
    await rt.idle();
    await drainPool();
    for (let i = 0; i < MAX_CONCURRENT_CLONES; i++) expect(rt.tryEnterClone()).toBe(true);
    try {
      const r = await t.json<ApiError>("/v1/judge/sessions", {
        method: "POST",
        body: {},
        headers: { "true-client-ip": "203.0.113.50" },
      });
      expect(r.status).toBe(429);
      expect(ApiError.parse(r.body)).toMatchObject({
        code: "QUEUED",
        retryAfterMs: 3000,
        details: { reason: "PREPARING_WORKSPACE" },
      });
      expect(r.headers.get("retry-after")).toBe("3");
    } finally {
      for (let i = 0; i < MAX_CONCURRENT_CLONES; i++) rt.leaveClone();
    }
    // with a slot free, an empty pool clones on demand
    const s = await startSession({ ip: "203.0.113.51" });
    expect(s.status).toBe(201);
    await rt.idle();
  });

  it("never hands out a damaged pooled workspace: it is retired and a fresh one is cloned in the same transaction", async () => {
    await judgeRuntime(t.deps).idle();
    await drainPool();
    const [broken] = await ownerSql()<{ id: string }[]>`
      insert into workspaces (id, kind, name) values (fs_uuidv7(), 'judge', ${poolName()}) returning id`;
    const s = await startSession({ ip: "203.0.113.60" });
    expect(s.status).toBe(201);
    expect(s.body.workspaceId).not.toBe(broken?.id);
    const [row] = await ownerSql()<{ claimed_at: Date | null; expires_at: Date | null }[]>`
      select claimed_at, expires_at from workspaces where id = ${broken?.id ?? ""}`;
    expect(row?.claimed_at).toBeNull();
    expect(row?.expires_at).not.toBeNull(); // retired: the hourly purge removes it
    await judgeRuntime(t.deps).idle();
  });
});

describe("Reset", () => {
  it("inv.i5.forward: Reset ends the workspace now (compare-and-set), revokes its tokens and enqueues judgeReset{button}", async () => {
    const s = await startSession({ ip: "203.0.113.70" });
    const r = await t.json<{ reset: boolean; revokedTokens: number }>(
      `/v1/judge/sessions/${s.body.sessionId}/reset`,
      { method: "POST", body: {}, as: judge(s.cookie) },
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ reset: true, revokedTokens: 1 });
    // the console token and the cookie no longer act
    const after = await t.json<ApiError>("/v1/presence", {
      method: "POST",
      body: { view: "W-TR-05" },
      as: t.credentials.bearer(s.body.consoleToken),
    });
    expect(after.status).toBe(401);
    const again = await t.json<ApiError>(`/v1/judge/sessions/${s.body.sessionId}/reset`, {
      method: "POST",
      body: {},
      as: judge(s.cookie),
    });
    expect(again.status).toBe(401);
    expect(ApiError.parse(again.body).code).toBe("FRAME_TOKEN_EXPIRED");
    const tasks = (await t.deps.db.execute(sql`
      select args from task_outbox where name = 'judgeReset' and args->>'workspaceId' = ${s.body.workspaceId}`)) as unknown as {
      args: { trigger: string };
    }[];
    expect(tasks.map((x) => x.args.trigger)).toEqual(["button"]);
  });

  it("refuses another session's Reset (403) and a frame token's (403)", async () => {
    const a = await startSession({ ip: "203.0.113.71" });
    const b = await startSession({ ip: "203.0.113.72" });
    const r = await t.json<ApiError>(`/v1/judge/sessions/${b.body.sessionId}/reset`, {
      method: "POST",
      body: {},
      as: judge(a.cookie),
    });
    expect(r.status).toBe(403);
    const f = await t.json<ApiError>(`/v1/judge/sessions/${a.body.sessionId}/reset`, {
      method: "POST",
      body: {},
      as: t.credentials.bearer(a.body.consoleToken),
    });
    expect(f.status).toBe(403);
  });
});

describe("POST /v1/presence (presence)", () => {
  it("answers {ok:true}, emits one presence event per 5 s per persona, attached to the run", async () => {
    const s = await startSession({ ip: "203.0.113.80" });
    const as = t.credentials.bearer(s.body.consoleToken);
    const post = (view: string) =>
      t.json<{ ok: boolean }>("/v1/presence", { method: "POST", body: { view }, as });
    expect((await post("W-TR-07")).body).toEqual({ ok: true });
    t.clock.advance(1_100);
    expect((await post("W-TR-08")).status).toBe(200); // a change inside 5 s is coalesced
    t.clock.advance(5_000);
    expect((await post("W-TR-08")).status).toBe(200); // …and lands on the next beat
    const events = (await t.deps.db.execute(sql`
      select run_id, payload, actor_id, impersonated_by, provenance from run_events
       where workspace_id = ${s.body.workspaceId} and type = 'presence' order by id`)) as unknown as {
      run_id: string;
      payload: { persona: string; view: string; holdId: string | null; expiresAt: string };
      actor_id: string;
      impersonated_by: string;
      provenance: string;
    }[];
    expect(events.map((e) => e.payload.view)).toEqual(["W-TR-07", "W-TR-08"]);
    expect(events[0]).toMatchObject({
      run_id: s.body.runId,
      actor_id: "treasurer:analyn",
      impersonated_by: `judge_session:${s.body.sessionId}`,
      provenance: "live",
    });
    expect(events[0]?.payload.persona).toBe("analyn");
    expect(events[0]?.payload.holdId).toBeNull();
  });

  it("answers 429 RATE_LIMITED above 1 Hz per credential", async () => {
    const s = await startSession({ ip: "203.0.113.81" });
    const as = t.credentials.bearer(s.body.consoleToken);
    expect((await t.json("/v1/presence", { method: "POST", body: { view: "W-TR-05" }, as })).status).toBe(
      200,
    );
    const r = await t.json<ApiError>("/v1/presence", { method: "POST", body: { view: "W-TR-05" }, as });
    expect(r.status).toBe(429);
    expect(ApiError.parse(r.body)).toMatchObject({ code: "RATE_LIMITED" });
    expect(r.headers.get("retry-after")).toBe("1");
  });

  it("never echoes an unknown hold or control characters (400 VALIDATION_FAILED)", async () => {
    const s = await startSession({ ip: "203.0.113.82" });
    const as = t.credentials.bearer(s.body.consoleToken);
    t.clock.advance(6_000);
    await t.json("/v1/presence", { method: "POST", body: { view: "W-TR-06", holdId: "<img src=x>" }, as });
    const [e] = (await t.deps.db.execute(sql`
      select payload from run_events where workspace_id = ${s.body.workspaceId} and type = 'presence'`)) as unknown as {
      payload: { holdId: string | null };
    }[];
    expect(e?.payload.holdId).toBeNull();
    t.clock.advance(1_100);
    const bad = await t.json<ApiError>("/v1/presence", { method: "POST", body: { view: "W-TR\u0007" }, as });
    expect(bad.status).toBe(400);
    expect(ApiError.parse(bad.body).code).toBe("VALIDATION_FAILED");
  });
});

describe("Try to break it", () => {
  it("inv.i1.lattice: an overcharged draft is refused by the real lattice, labelled, with no model or PayPal call", async () => {
    const s = await startSession({ ip: "203.0.113.90" });
    const calls = await t.deps.db.select({ id: schema.paypalCalls.id }).from(schema.paypalCalls);
    for (const kind of ["amount", "offsetting", "recipient"] as const) {
      const r = await t.json<{
        verdict: string;
        decidedBy: string[];
        reasons: string[];
        label: string;
        simulated: boolean;
        paypalCalls: number;
        modelCalls: number;
      }>(`/v1/judge/sessions/${s.body.sessionId}/tamper`, {
        method: "POST",
        body: { kind },
        as: judge(s.cookie),
      });
      expect(r.status, kind).toBe(200);
      expect(r.body.verdict, kind).toBe("DENY");
      expect(r.body.simulated).toBe(true);
      expect(r.body.label).toMatch(/^Simulated tamper/);
      expect(r.body).toMatchObject({ paypalCalls: 0, modelCalls: 0 });
      const content = kind === "recipient" ? "recipientInBrandAllowlist" : "invoiceEqualsQuote";
      expect(r.body.decidedBy, kind).toContain(content);
    }
    // nothing reached PayPal
    expect(await t.deps.db.select({ id: schema.paypalCalls.id }).from(schema.paypalCalls)).toHaveLength(
      calls.length,
    );
    const verdicts = (await t.deps.db.execute(sql`
      select payload, provenance, actor_id from run_events
       where workspace_id = ${s.body.workspaceId} and type = 'policy.verdict' order by id`)) as unknown as {
      payload: { verdict: string; reasons: string[] };
      provenance: string;
      actor_id: string;
    }[];
    expect(verdicts).toHaveLength(3);
    for (const v of verdicts) {
      expect(v.payload.verdict).toBe("DENY");
      expect(v.payload.reasons[0]).toMatch(/^Simulated tamper/); // I8: the label travels with the event
      expect(v.actor_id).toBe("policy-lattice");
    }
    const ledger = await t.deps.db
      .select({ payload: schema.ledgerEntries.payload })
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, s.body.workspaceId),
          eq(schema.ledgerEntries.kind, "policy.verdict"),
        ),
      );
    expect(ledger.map((l) => (l.payload as { tamper: string }).tamper).sort()).toEqual([
      "amount",
      "offsetting",
      "recipient",
    ]);
    expect(await verifyChain(t.deps.db, s.body.workspaceId)).toMatchObject({ ok: true });
  });

  it("arms change_payout before the second key; after both keys it is 409 INVALID_TRANSITION", async () => {
    const s = await startSession({ ip: "203.0.113.91" });
    const arm = () =>
      t.json<{ armed: boolean } & ApiError>(`/v1/judge/sessions/${s.body.sessionId}/tamper`, {
        method: "POST",
        body: { kind: "change_payout" },
        as: judge(s.cookie),
      });
    const r = await arm();
    expect(r.status).toBe(200);
    expect(r.body.armed).toBe(true);
    expect((await arm()).status).toBe(200); // idempotent
    expect(await tamperArmed(t.deps.db, s.body.workspaceId, s.body.runId)).toBe(true);
    await ownerSql()`update pay_runs set state = 'APPROVED' where id = ${s.body.runId}`;
    const late = await t.json<ApiError>(`/v1/judge/sessions/${s.body.sessionId}/tamper`, {
      method: "POST",
      body: { kind: "change_payout" },
      as: judge(s.cookie),
    });
    expect(late.status).toBe(200); // already armed: the earlier arming stands
    const s2 = await startSession({ ip: "203.0.113.92" });
    await ownerSql()`update pay_runs set state = 'APPROVED' where id = ${s2.body.runId}`;
    const refused = await t.json<ApiError>(`/v1/judge/sessions/${s2.body.sessionId}/tamper`, {
      method: "POST",
      body: { kind: "change_payout" },
      as: judge(s2.cookie),
    });
    expect(refused.status).toBe(409);
    expect(ApiError.parse(refused.body).code).toBe("INVALID_TRANSITION");
  });

  it("refuses an unknown kind (400) and another session (403)", async () => {
    const a = await startSession({ ip: "203.0.113.94" });
    const b = await startSession({ ip: "203.0.113.95" });
    const bad = await t.json<ApiError>(`/v1/judge/sessions/${a.body.sessionId}/tamper`, {
      method: "POST",
      body: { kind: "everything" },
      as: judge(a.cookie),
    });
    expect(bad.status).toBe(400);
    const other = await t.json<ApiError>(`/v1/judge/sessions/${b.body.sessionId}/tamper`, {
      method: "POST",
      body: { kind: "amount" },
      as: judge(a.cookie),
    });
    expect(other.status).toBe(403);
  });
});

describe("the judge session view, the lane and the judge code", () => {
  it("inv.i8.labelled: GET /v1/judge/session shows the run, the labelled rail decision and the lane", async () => {
    const s = await startSession({ ip: "203.0.113.100" });
    const r = await t.json<{
      runSlug: string;
      runState: string;
      rail: {
        mode: string;
        reason: string;
        label: string;
        rail: string;
        quota: { balance: { source: string } };
      };
      lane: { position: number | null };
      tamper: { changePayoutArmed: boolean };
      sessionExpiresAt: string;
    }>("/v1/judge/session", { as: judge(s.cookie) });
    expect(r.status).toBe(200);
    expect(r.body.runSlug).toBe(s.body.runSlug);
    expect(r.body.runState).toBe("DRAFT");
    expect(r.body.rail).toMatchObject({
      mode: "replay",
      reason: "simulator_not_running",
      rail: "simulated",
      label: "Replay: the PayPal simulator is not running",
    });
    // no balance reading yet: the simulator's opening balance, labelled as such (the UI says "estimate")
    expect(r.body.rail.quota.balance.source).toBe("simulator_opening");
    expect(r.body.lane.position).toBeNull();
    expect(r.body.tamper.changePayoutArmed).toBe(false);
    expect(Date.parse(r.body.sessionExpiresAt) - t.clock.nowMs()).toBe(24 * 3_600_000);
    // a frame token minted by the session sees the same session
    const f = await t.json<{ sessionId: string }>("/v1/judge/session", {
      as: t.credentials.bearer(s.body.consoleToken),
    });
    expect(f.body.sessionId).toBe(s.body.sessionId);
    const pub = await t.json<{ rail: { mode: string } }>("/v1/judge/lane");
    expect(pub.status).toBe(200);
    expect(pub.body.rail.mode).toBe("replay");
  });

  it("GET /v1/judge/lane is throttled per network and serves its public view from a 2 s cache", async () => {
    const app = await createTestApp({ db: "postgres", clock: new Date() });
    try {
      type Lane = { rail: { quota: { balance: { source: string } } } };
      const ip = { "true-client-ip": "198.51.100.77" };
      const source = async () =>
        (await app.json<Lane>("/v1/judge/lane", { headers: ip })).body.rail.quota.balance.source;
      expect(await source()).toBe("simulator_opening");
      await recordBalanceReading(app.deps.db, {
        rail: "simulated",
        availableCents: 100_000_000,
        asOf: app.clock.now(),
        source: "searchBalances",
      });
      expect(await source()).toBe("simulator_opening"); // the same view, from the cache
      app.clock.advance(2_001);
      expect(await source()).toBe("reading");
      for (let i = 0; i < 57; i++) await app.json("/v1/judge/lane", { headers: ip });
      const limited = await app.json<ApiError>("/v1/judge/lane", { headers: ip });
      expect(limited.status).toBe(429);
      expect(ApiError.parse(limited.body).code).toBe("RATE_LIMITED");
      const elsewhere = await app.json("/v1/judge/lane", { headers: { "true-client-ip": "198.51.100.78" } });
      expect(elsewhere.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("unlocks the judge-code bucket with the right code only (403 otherwise, 429 when guessing)", async () => {
    const code = "lantern-bay-judges";
    const app = await createTestApp({
      db: "postgres",
      clock: new Date(),
      env: { JUDGE_CODE_SHA256: createHash("sha256").update(code).digest("hex") },
    });
    try {
      const r0 = await app.json<SessionBody>("/v1/judge/sessions", { method: "POST", body: {} });
      const cookie = cookieFrom(r0.headers.get("set-cookie"));
      const as = app.credentials.judge(cookie);
      const wrong = await app.json<ApiError>("/v1/judge/code", {
        method: "POST",
        body: { code: "nope" },
        as,
      });
      expect(wrong.status).toBe(403);
      const ok = await app.json<{ ok: boolean }>("/v1/judge/code", { method: "POST", body: { code }, as });
      expect(ok.body).toEqual({ ok: true, bucket: "judge_code" });
      const view = await app.json<{ rail: { quota: { coded: boolean } } }>("/v1/judge/session", { as });
      expect(view.body.rail.quota.coded).toBe(true);
      for (let i = 0; i < 3; i++)
        await app.json("/v1/judge/code", { method: "POST", body: { code: "x" }, as });
      const limited = await app.json<ApiError>("/v1/judge/code", { method: "POST", body: { code }, as });
      expect(limited.status).toBe(429);

      // the unlock belongs to the session, not its workspace: a Reset and the purge never drop it
      const s0 = CreateJudgeSessionResponse.parse(r0.body);
      await app.json(`/v1/judge/sessions/${s0.sessionId}/reset`, { method: "POST", body: {}, as });
      const ownerSql = app.pg?.owner.sql;
      if (!ownerSql) throw new Error("no database");
      await ownerSql`update workspaces set expires_at = now() - interval '1 minute' where id = ${s0.workspaceId}`;
      await app.deps.db.execute(sql`select fs_purge_workspace(${s0.workspaceId}::uuid)`);
      const r1 = await app.json<SessionBody>("/v1/judge/sessions", {
        method: "POST",
        body: {},
        headers: { cookie: `${JUDGE_COOKIE.name}=${cookie}` },
      });
      expect(r1.status).toBe(201);
      const s1 = CreateJudgeSessionResponse.parse(r1.body);
      expect(s1.sessionId).toBe(s0.sessionId);
      expect(s1.workspaceId).not.toBe(s0.workspaceId);
      const after = await app.json<{ rail: { quota: { coded: boolean } } }>("/v1/judge/session", {
        as: app.credentials.judge(cookieFrom(r1.headers.get("set-cookie"))),
      });
      expect(after.body.rail.quota.coded).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe("demo signing keys", () => {
  /** A frame token for `persona` in the session, and a browser key's signed registration as that signer. */
  async function frameFor(s: Started, persona: string) {
    const frame = await t.json<{ token: string }>(`/v1/judge/sessions/${s.body.sessionId}/frames`, {
      method: "POST",
      body: { persona },
      as: judge(s.cookie),
    });
    expect(frame.status).toBe(201);
    return t.credentials.bearer(frame.body.token);
  }
  function browserKey() {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const raw = publicKey.export({ format: "jwk" }).x as string;
    return { publicKeyHex: Buffer.from(raw, "base64url").toString("hex"), privateKey };
  }
  function registration(
    s: Started,
    approverId: string,
    key: ReturnType<typeof browserKey>,
  ): { publicKeyHex: string; signatureHex: string } {
    const statement = jcs(
      demoKeyStatement({ workspaceId: s.body.workspaceId, approverId, publicKeyHex: key.publicKeyHex }),
    );
    return {
      publicKeyHex: key.publicKeyHex,
      signatureHex: edSign(null, Buffer.from(statement), key.privateKey).toString("hex"),
    };
  }

  it("registers a frame's browser key as fs-{persona}-w{6 digits} with proof of possession and a key.registered entry", async () => {
    const s = await startSession({ ip: "203.0.113.110" });
    const as = await frameFor(s, "board:ernesto");
    const key = browserKey();
    const body = registration(s, "board:ernesto", key);
    const r = await t.json<{ keyId: string; approverId: string; kind: string; label: string }>(
      "/v1/judge/keys",
      {
        method: "POST",
        body,
        as,
      },
    );
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      approverId: "board:ernesto",
      kind: "web_demo",
      label: "Demo key (this browser only)",
    });
    // C-13: a demo key id is the persona plus six random digits, a valid DeviceKeyId that no real key
    // (fs-ernesto-a1, fs-analyn-w1: small numbers) can ever share, in keys.json or on Proof
    expect(r.body.keyId).toMatch(/^fs-ernesto-w[1-9]\d{5}$/);
    expect(DeviceKeyId.safeParse(r.body.keyId).success).toBe(true);
    const keyId = r.body.keyId;
    const again = await t.json<{ keyId: string }>("/v1/judge/keys", { method: "POST", body, as });
    expect(again.body.keyId).toBe(keyId); // the same key registered twice: idempotent
    const entry = await t.deps.db
      .select({ payload: schema.ledgerEntries.payload })
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, s.body.workspaceId),
          eq(schema.ledgerEntries.kind, "key.registered"),
        ),
      );
    expect(entry).toHaveLength(1);
    expect(LedgerPayloads["key.registered"].parse(entry[0]?.payload)).toMatchObject({
      keyId,
      persona: "board:ernesto",
      kind: "web_demo",
      publicKeyHex: key.publicKeyHex,
    });
    // a forged registration (signed by another key) is refused
    const forged = registration(s, "board:ernesto", { ...browserKey(), publicKeyHex: key.publicKeyHex });
    const bad = await t.json<ApiError>("/v1/judge/keys", { method: "POST", body: forged, as });
    expect(bad.status).toBe(400);
    // the judge cookie itself and a clerk cannot hold a signing key
    const cookieTry = await t.json<ApiError>("/v1/judge/keys", { method: "POST", body, as: judge(s.cookie) });
    expect(cookieTry.status).toBe(403);
  });

  it("one key, one signer: a browser key already signing as the Chair cannot also sign as the treasurer (403)", async () => {
    const s = await startSession({ ip: "203.0.113.111" });
    const chair = await frameFor(s, "board:ernesto");
    const treasurer = await frameFor(s, "treasurer:analyn");
    const key = browserKey();
    const first = await t.json<{ keyId: string }>("/v1/judge/keys", {
      method: "POST",
      body: registration(s, "board:ernesto", key),
      as: chair,
    });
    expect(first.status).toBe(201);
    // the second registration is properly signed for the treasurer: only the key's reuse is wrong
    const second = await t.json<ApiError>("/v1/judge/keys", {
      method: "POST",
      body: registration(s, "treasurer:analyn", key),
      as: treasurer,
    });
    expect(second.status).toBe(403);
    expect(ApiError.parse(second.body).code).toBe("FORBIDDEN");
    const rows = await t.deps.db
      .select({ keyId: schema.deviceKeys.keyId })
      .from(schema.deviceKeys)
      .where(eq(schema.deviceKeys.workspaceId, s.body.workspaceId));
    expect(rows.map((r) => r.keyId)).toEqual([first.body.keyId]);
    // the treasurer's own, distinct key is welcome
    const own = await t.json<{ keyId: string }>("/v1/judge/keys", {
      method: "POST",
      body: registration(s, "treasurer:analyn", browserKey()),
      as: treasurer,
    });
    expect(own.status).toBe(201);
    expect(own.body.keyId).toMatch(/^fs-analyn-w[1-9]\d{5}$/);
  });

  it("a real officer key (any workspace) is never registered again as a demo key", async () => {
    const s = await startSession({ ip: "203.0.113.112" });
    const treasurer = await frameFor(s, "treasurer:analyn");
    const key = browserKey();
    // the showcase treasurer's real key, registered from /ops
    const show = await t.fixture({ kind: "showcase" });
    await owner()
      .insert(schema.deviceKeys)
      .values({
        workspaceId: show.workspaceId,
        keyId: "fs-analyn-w1",
        persona: "analyn",
        publicKey: Buffer.from(key.publicKeyHex, "hex").toString("base64url"),
        kind: "app",
        platform: "web",
      });
    const r = await t.json<ApiError>("/v1/judge/keys", {
      method: "POST",
      body: registration(s, "treasurer:analyn", key),
      as: treasurer,
    });
    expect(r.status).toBe(403);
  });
});

describe("judgeReset (task)", () => {
  it("cron: enqueues cancels for judge items parked UNCLAIMED over 15 minutes, purges what is safe, refills the pool", async () => {
    const s = await startSession({ ip: "203.0.113.120" });
    const ws = s.body.workspaceId;
    const db = owner();
    const minutesAgo = (m: number) => new Date(t.clock.nowMs() - m * 60_000);
    const [batch] = await db
      .insert(schema.payoutBatches)
      .values({
        workspaceId: ws,
        runId: s.body.runId,
        senderBatchId: `2026A-test-${s.body.runSlug}`,
        requestId: "a".repeat(64),
        batchSha256: "b".repeat(64),
        kind: "primary",
        status: "SUCCESS",
        itemCount: 3,
        totalCents: 7995n,
        currency: "USD",
        provenance: "replay",
        submittedAt: new Date(t.clock.nowMs() - 2 * 86_400_000),
      })
      .returning({ id: schema.payoutBatches.id });
    /** An UNCLAIMED item: written `createdMin` ago, last touched `touchedMin` ago, UNCLAIMED since `parkedMin` ago. */
    async function parked(
      memberNo: string,
      payoutItemId: string,
      o: { createdMin: number; touchedMin: number; parkedMin?: number },
    ) {
      const [member] = await db
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(and(eq(schema.members.workspaceId, ws), eq(schema.members.memberNo, memberNo)));
      const [line] = await db
        .insert(schema.memberLines)
        .values({
          workspaceId: ws,
          runId: s.body.runId,
          memberId: member?.id as string,
          state: "UNCLAIMED",
          rail: "ON",
          currency: "USD",
          verifiedG: 1000n,
          grade1G: 0n,
          premiumCents: 2665n,
          bonusCents: 0n,
          deductionsCents: 0n,
          creditsCents: 0n,
          netCents: 2665n,
          deductions: [],
          provenance: "replay",
        })
        .returning({ id: schema.memberLines.id });
      const senderItemId = `${s.body.runSlug.split("-")[1]}-${memberNo}`;
      const [item] = await db
        .insert(schema.payoutItems)
        .values({
          workspaceId: ws,
          batchId: batch?.id as string,
          lineId: line?.id as string,
          senderItemId,
          payoutItemId,
          receiver: `${memberNo.toLowerCase()}@example.com`,
          amountCents: 2665n,
          currency: "USD",
          status: "UNCLAIMED",
          statusRank: 30,
          provenance: "replay",
          createdAt: minutesAgo(o.createdMin),
          // set at insert: the touch trigger rewrites updated_at on UPDATE (a webhook re-delivery does that)
          updatedAt: minutesAgo(o.touchedMin),
        })
        .returning({ id: schema.payoutItems.id });
      if (o.parkedMin !== undefined) {
        // the item.updated event the webhook wrote when the item became UNCLAIMED
        await db.insert(schema.runEvents).values({
          workspaceId: ws,
          runId: s.body.runId,
          lineId: line?.id as string,
          type: "item.updated",
          at: minutesAgo(o.parkedMin),
          actorKind: "paypal",
          actorId: "paypal",
          provenance: "replay",
          payload: {
            itemId: item?.id,
            senderItemId,
            memberNo,
            payoutItemId,
            from: "PENDING",
            to: "UNCLAIMED",
            rank: 30,
            source: "webhook",
            eventId: null,
          },
        });
      }
    }
    await parked("M-031", "TESTITEM0000001", { createdMin: 20, touchedMin: 20 });
    // a webhook re-delivery touched it a minute ago: it has still been parked for 20 minutes
    await parked("M-014", "TESTITEM0000002", { createdMin: 22, touchedMin: 1, parkedMin: 20 });
    // written half an hour ago, but UNCLAIMED only for 5 minutes: not yet
    await parked("M-002", "TESTITEM0000003", { createdMin: 30, touchedMin: 5, parkedMin: 5 });

    const report = await runJudgeReset(t.deps, { trigger: "cron", workspaceId: null, slot: "test-cron-1" });
    expect(report.trigger).toBe("cron");
    expect(report.cancelsEnqueued).toBe(2);
    const cancels = (await t.deps.db.execute(sql`
      select args, workspace_id, dedupe_key from task_outbox where name = 'cancelUnclaimed'
       order by dedupe_key`)) as unknown as {
      args: { payoutItemId: string; afterCancel: string };
      workspace_id: string;
      dedupe_key: string;
    }[];
    expect(cancels).toEqual(
      ["TESTITEM0000001", "TESTITEM0000002"].map((id) => ({
        args: { payoutItemId: id, afterCancel: "cash" },
        workspace_id: ws,
        dedupe_key: `cancel:${id}`,
      })),
    );
    // a second pass does not enqueue them again (dedupe key)
    const second = await runJudgeReset(t.deps, { trigger: "cron", workspaceId: null, slot: "test-cron-2" });
    expect(second.cancelsEnqueued).toBe(0);
    expect(await poolSize(t.deps.db)).toBeGreaterThanOrEqual(3);
    const [health] = (await t.deps.db.execute(sql`
      select summary from reconciliation_reports where kind = 'health' order by created_at desc limit 1`)) as unknown as {
      summary: { source: string };
    }[];
    expect(health?.summary.source).toBe("judgeReset");
  });

  it("purges an expired judge workspace, keeps one with money in flight, and never a showcase", async () => {
    const quiet = await startSession({ ip: "203.0.113.121" });
    await t.json(`/v1/judge/sessions/${quiet.body.sessionId}/reset`, {
      method: "POST",
      body: {},
      as: judge(quiet.cookie),
    });
    const busy = await startSession({ ip: "203.0.113.122" });
    await ownerSql()`update workspaces set expires_at = now() - interval '1 minute' where id = ${busy.body.workspaceId}`;
    // a POSTING run is money in flight: fs_purge_workspace refuses it
    await ownerSql()`
      update pay_runs set state = 'POSTING', batch_sha256 = ${"c".repeat(64)}, sender_batch_id = ${`2026A-busy-${busy.body.runSlug}`}
       where id = ${busy.body.runId}`;
    await ownerSql()`update workspaces set expires_at = now() - interval '1 minute' where id = ${quiet.body.workspaceId}`;
    const out = await purgeExpiredJudgeWorkspaces(t.deps.db, 50);
    expect(out.purged).toContain(quiet.body.workspaceId);
    expect(out.deferred).toContain(busy.body.workspaceId);
    const left = await t.deps.db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, quiet.body.workspaceId));
    expect(left).toHaveLength(0);
    // a showcase is never a purge candidate, expired or not
    const [show] = await ownerSql()<{ id: string }[]>`
      insert into workspaces (id, kind, name, expires_at) values (fs_uuidv7(), 'showcase', 'showcase', now() - interval '1 day')
      returning id`;
    const again = await purgeExpiredJudgeWorkspaces(t.deps.db, 50);
    expect([...again.purged, ...again.deferred]).not.toContain(show?.id);
  });

  it("button: cancels only that workspace's parked items (at most 2) and leaves purging to the hourly pass", async () => {
    const s = await startSession({ ip: "203.0.113.123" });
    const ws = s.body.workspaceId;
    const db = owner();
    const members = await db
      .select({ id: schema.members.id, no: schema.members.memberNo })
      .from(schema.members)
      .where(eq(schema.members.workspaceId, ws))
      .limit(3);
    const [batch] = await db
      .insert(schema.payoutBatches)
      .values({
        workspaceId: ws,
        runId: s.body.runId,
        senderBatchId: `2026A-button-${s.body.runSlug}`,
        requestId: "d".repeat(64),
        batchSha256: "e".repeat(64),
        kind: "primary",
        status: "SUCCESS",
        itemCount: 3,
        totalCents: 300n,
        currency: "USD",
        provenance: "replay",
        submittedAt: new Date(t.clock.nowMs() - 2 * 86_400_000),
      })
      .returning({ id: schema.payoutBatches.id });
    let i = 0;
    for (const m of members) {
      i++;
      const [line] = await db
        .insert(schema.memberLines)
        .values({
          workspaceId: ws,
          runId: s.body.runId,
          memberId: m.id,
          state: "UNCLAIMED",
          rail: "ON",
          currency: "USD",
          verifiedG: 10n,
          grade1G: 0n,
          premiumCents: 100n,
          bonusCents: 0n,
          deductionsCents: 0n,
          creditsCents: 0n,
          netCents: 100n,
          deductions: [],
          provenance: "replay",
        })
        .returning({ id: schema.memberLines.id });
      await db.insert(schema.payoutItems).values({
        workspaceId: ws,
        batchId: batch?.id as string,
        lineId: line?.id as string,
        senderItemId: `${s.body.runSlug.split("-")[1]}-${m.no}`,
        payoutItemId: `BUTTONITEM00000${i}`,
        receiver: `m${i}@example.com`,
        amountCents: 100n,
        currency: "USD",
        status: "UNCLAIMED",
        statusRank: 30,
        provenance: "replay",
      });
    }
    await t.json(`/v1/judge/sessions/${s.body.sessionId}/reset`, {
      method: "POST",
      body: {},
      as: judge(s.cookie),
    });
    // the task the Reset enqueued, run through the folder's registered handler
    const [row] = (await t.deps.db.execute(sql`
      select args from task_outbox where name = 'judgeReset' and args->>'workspaceId' = ${ws}`)) as unknown as {
      args: unknown;
    }[];
    const handler = t.app.registry.taskHandlers(t.deps).judgeReset;
    expect(handler).toBeTypeOf("function");
    const report = await runJudgeReset(t.deps, row?.args);
    expect(report).toMatchObject({ trigger: "button", cancelsEnqueued: 2, purged: 0 });
    const cancels = (await t.deps.db.execute(sql`
      select args from task_outbox where name = 'cancelUnclaimed' and workspace_id = ${ws}`)) as unknown as {
      args: { payoutItemId: string };
    }[];
    expect(cancels).toHaveLength(2);
    expect(cancels.every((c) => c.args.payoutItemId.startsWith("BUTTONITEM"))).toBe(true);
    const [still] = await t.deps.db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ws));
    expect(still?.id).toBe(ws);
  });
});

describe("boot", () => {
  it("retires pooled workspaces of another seed and refills the pool in the background", async () => {
    const [stale] = await ownerSql()<{ id: string }[]>`
      insert into workspaces (id, kind, name) values (fs_uuidv7(), 'judge', 'judge-pool seed:000000000000') returning id`;
    await t.app.registry.onBoot(t.deps);
    await judgeRuntime(t.deps).idle();
    const [row] = await ownerSql()<{ expires_at: Date | null }[]>`
      select expires_at from workspaces where id = ${stale?.id ?? ""}`;
    expect(row?.expires_at).not.toBeNull();
    expect(await poolSize(t.deps.db)).toBeGreaterThanOrEqual(3);
  });
});

describe("the human gate at this slice's boundary", () => {
  it("inv.i6.human-gate: every acting route refuses no credential (401) and a read-only link (403)", async () => {
    const s = await startSession({ ip: "203.0.113.130" });
    const sid = s.body.sessionId;
    const link = t.credentials.memberLink({ workspaceId: s.body.workspaceId, lineId: s.body.runId });
    const routes: [string, string, unknown][] = [
      ["POST", `/v1/judge/sessions/${sid}/reset`, {}],
      ["POST", `/v1/judge/sessions/${sid}/tamper`, { kind: "amount" }],
      ["POST", `/v1/judge/sessions/${sid}/frames`, { persona: "board:ernesto" }],
      ["POST", "/v1/judge/keys", { publicKeyHex: "a".repeat(64), signatureHex: "b".repeat(128) }],
      ["POST", "/v1/judge/code", { code: "x" }],
      ["GET", "/v1/judge/session", undefined],
      ["POST", "/v1/links/member", { lineId: s.body.runId }],
      ["POST", "/v1/links/member/revoke", { jti: "abcdefghij" }],
      ["POST", "/v1/pairing", { persona: "ernesto", role: "board" }],
      ["POST", "/v1/presence", { view: "W-TR-05" }],
    ];
    for (const [method, path, body] of routes) {
      const init = method === "POST" ? { method, body } : {};
      const none = await t.json<ApiError>(path, init);
      expect(none.status, `${method} ${path}`).toBe(401);
      expect(ApiError.parse(none.body).code).toBe("UNAUTHENTICATED");
      const ro = await t.json<ApiError>(path, { ...init, as: t.credentials.bearer(link) });
      expect(ro.status, `${method} ${path} with a member link`).toBe(403);
    }
  });
});

describe("presence on the run stream (MM-5)", () => {
  it("the Chair's frame beat reaches the console's run stream as an IC-01 presence event", async () => {
    const s = await startSession({ ip: "203.0.113.140" });
    const chair = await t.json<{ token: string }>(`/v1/judge/sessions/${s.body.sessionId}/frames`, {
      method: "POST",
      body: { persona: "board:ernesto" },
      as: judge(s.cookie),
    });
    // Resume from the last event id the console saw, as the client does: the stream replays anything the
    // live subscription could have missed, so this never races the subscription.
    const [last] = (await t.deps.db.execute(sql`
      select coalesce(max(id), 0)::bigint as id from run_events where workspace_id = ${s.body.workspaceId}`)) as unknown as {
      id: string;
    }[];
    const beat = await t.json("/v1/presence", {
      method: "POST",
      body: { view: "M-BD-01" },
      as: t.credentials.bearer(chair.body.token),
    });
    expect(beat.status).toBe(200);
    const { response, reader } = await t.sse(`/v1/runs/${s.body.runSlug}/events`, {
      as: t.credentials.bearer(s.body.consoleToken),
      headers: { "last-event-id": String(last?.id ?? 0) },
    });
    expect(response.status).toBe(200);
    const msg = await reader.next(10_000);
    expect(msg.event).toBe("presence");
    const event = RunEvent.parse(JSON.parse(msg.data));
    expect(event).toMatchObject({
      type: "presence",
      runId: s.body.runId,
      actor: { kind: "human", id: "board:ernesto", impersonatedBy: `judge_session:${s.body.sessionId}` },
      payload: { persona: "ernesto", view: "M-BD-01", holdId: null },
    });
    await reader.close();
  });
});
