// What the phone's frames need from the judge folder (K1b), on embedded Postgres:
//   - run lookup: a frame or a paired phone of a judge session reads its own session's run (GET /v1/judge/session),
//     and never another workspace's;
//   - resume-only renewal (POST /v1/judge/sessions/:sid/renew): a fresh console token for a live session; for an
//     ended one (Reset, expiry, purge) a 401 FRAME_TOKEN_EXPIRED that mints no workspace and takes no slot of the
//     three-new-sessions-an-hour limit.
import { ApiError, ClaimPairingResponse, CreateJudgeSessionResponse } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { JUDGE_COOKIE } from "../../credentials/verify/index.js";
import { purgeExpiredJudgeWorkspaces } from "../../judge/pool.js";
import { judgeRuntime } from "../../judge/runtime.js";
import { RATE_RULES } from "../../lib/rate-limit.js";
import { createTestApp, setWorkspaceExpiry, type TestApp } from "../../test/index.js";

type SessionBody = ReturnType<typeof CreateJudgeSessionResponse.parse>;

interface Started {
  body: SessionBody;
  cookie: string;
}

let t: TestApp;

beforeAll(async () => {
  // the app clock starts at the real time, so the database clock (claims, expiry, purge) agrees with it
  t = await createTestApp({ db: "postgres", clock: new Date() });
});
afterAll(async () => {
  await judgeRuntime(t.deps).idle();
  await t.close();
});
beforeEach(() => t.deps.rateLimits.reset());
afterEach(() => vi.restoreAllMocks());

function ownerSql() {
  if (!t.pg) throw new Error("no database");
  return t.pg.owner.sql;
}

let ipSeq = 0;
async function startSession(cookie?: string): Promise<Started> {
  ipSeq++;
  const headers: Record<string, string> = { "cf-connecting-ip": `203.0.113.${200 + ipSeq}` };
  if (cookie) headers.cookie = `${JUDGE_COOKIE.name}=${cookie}`;
  const r = await t.json<SessionBody>("/v1/judge/sessions", { method: "POST", body: {}, headers });
  expect([200, 201], JSON.stringify(r.body)).toContain(r.status);
  const m = /fs_js=([^;]+)/.exec(r.headers.get("set-cookie") ?? "");
  return { body: CreateJudgeSessionResponse.parse(r.body), cookie: m?.[1] ?? cookie ?? "" };
}

const judge = (s: Started) => t.credentials.judge(s.cookie);
const bearer = (token: string) => t.credentials.bearer(token);

async function frame(s: Started, persona: string): Promise<string> {
  const r = await t.json<{ token: string }>(`/v1/judge/sessions/${s.body.sessionId}/frames`, {
    method: "POST",
    body: { persona },
    as: judge(s),
  });
  expect(r.status, persona).toBe(201);
  return r.body.token;
}

/** A phone paired by the console (QR token): its device token. */
async function pairedPhone(s: Started): Promise<string> {
  const p = await t.json<{ url: string }>("/v1/pairing", {
    method: "POST",
    body: { persona: "ernesto", role: "board" },
    as: bearer(s.body.consoleToken),
  });
  expect(p.status).toBe(201);
  const token = p.body.url.split("#t=")[1] as string;
  const r = await t.json("/v1/pairing/claim", { method: "POST", body: { token } });
  expect(r.status).toBe(200);
  return ClaimPairingResponse.parse(r.body).token;
}

interface SessionView {
  sessionId: string;
  workspaceId: string;
  runId: string | null;
  runSlug: string | null;
  runState: string | null;
}

const sessionView = (token: string) =>
  t.json<SessionView & ApiError>("/v1/judge/session", { as: bearer(token) });

async function reset(s: Started): Promise<void> {
  const r = await t.json(`/v1/judge/sessions/${s.body.sessionId}/reset`, {
    method: "POST",
    body: {},
    as: judge(s),
  });
  expect(r.status).toBe(200);
}

type Auth = ReturnType<typeof judge>;
const renew = (sid: string, as: Auth | undefined, headers?: Record<string, string>) =>
  t.json<SessionBody & ApiError>(`/v1/judge/sessions/${sid}/renew`, {
    method: "POST",
    body: {},
    ...(as ? { as } : {}),
    ...(headers ? { headers } : {}),
  });

/** What a new session would leave behind: claimed judge workspaces, runs and session-start ledger entries. */
async function footprint() {
  const [row] = await ownerSql()<{ claimed: number; runs: number; started: number }[]>`
    select (select count(*)::int from workspaces where kind = 'judge' and claimed_at is not null) as claimed,
           (select count(*)::int from pay_runs) as runs,
           (select count(*)::int from ledger_entries where kind = 'judge.session.started') as started`;
  return row;
}

/** The names of every rate rule taken while `fn` runs. */
async function rulesTaken(fn: () => Promise<void>): Promise<string[]> {
  const taken: string[] = [];
  const take = t.deps.rateLimits.take.bind(t.deps.rateLimits);
  vi.spyOn(t.deps.rateLimits, "take").mockImplementation((rule, key) => {
    taken.push(rule.name);
    return take(rule, key);
  });
  await fn();
  vi.restoreAllMocks();
  return taken;
}

const NEW_SESSION_RULES: readonly string[] = [
  RATE_RULES.judgeSessionPerCookie.name,
  RATE_RULES.judgeSessionPerIp.name,
];

describe("run lookup: a frame of a judge session reads its own session's run", () => {
  it("the Chair's frame, a member's frame and a paired phone each read their session's runSlug, never another's", async () => {
    const a = await startSession();
    const b = await startSession();
    expect(a.body.workspaceId).not.toBe(b.body.workspaceId);
    const aTokens = {
      chair: await frame(a, "board:ernesto"),
      member: await frame(a, "member:M-014"),
      phone: await pairedPhone(a),
    };
    for (const [who, token] of Object.entries(aTokens)) {
      const r = await sessionView(token);
      expect(r.status, who).toBe(200);
      expect(r.body, who).toMatchObject({
        sessionId: a.body.sessionId,
        workspaceId: a.body.workspaceId,
        runId: a.body.runId,
        runSlug: a.body.runSlug,
      });
      expect(r.body.runState, who).not.toBeNull();
    }
    const bChair = await sessionView(await frame(b, "board:ernesto"));
    expect(bChair.status).toBe(200);
    expect(bChair.body).toMatchObject({ sessionId: b.body.sessionId, runSlug: b.body.runSlug });
    expect(bChair.body.runSlug).not.toBe(a.body.runSlug);

    // A's Chair reads A's run, and B's run does not exist for it (404, never B's data)
    const own = await t.json(`/v1/runs/${a.body.runSlug}/approvals`, { as: bearer(aTokens.chair) });
    expect(own.status).toBe(200);
    const foreign = await t.json<ApiError>(`/v1/runs/${b.body.runSlug}/approvals`, {
      as: bearer(aTokens.chair),
    });
    expect(foreign.status).toBe(404);
    expect(JSON.stringify(foreign.body)).not.toContain(b.body.workspaceId);

    // after A's Reset its frames and its phone read nothing, and still never B's run
    await reset(a);
    for (const [who, token] of Object.entries(aTokens)) {
      const r = await sessionView(token);
      expect(r.status, who).toBe(401);
      expect(JSON.stringify(r.body), who).not.toContain(b.body.runSlug);
    }
  });
});

describe("POST /v1/judge/sessions/:sid/renew (resume-only renewal)", () => {
  it("renews a live session: 200, the same session, workspace and run, a fresh console token, nothing new", async () => {
    const s = await startSession();
    const before = await footprint();
    let r: Awaited<ReturnType<typeof renew>> | undefined;
    const taken = await rulesTaken(async () => {
      r = await renew(s.body.sessionId, judge(s));
    });
    expect(r?.status, JSON.stringify(r?.body)).toBe(200);
    const body = CreateJudgeSessionResponse.parse(r?.body);
    expect(body).toMatchObject({
      sessionId: s.body.sessionId,
      workspaceId: s.body.workspaceId,
      runId: s.body.runId,
      runSlug: s.body.runSlug,
    });
    expect(body.consoleToken).not.toBe(s.body.consoleToken);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(t.clock.nowMs());
    // the fresh token acts in the same session; the cookie is left as it is
    expect((await sessionView(body.consoleToken)).body.sessionId).toBe(s.body.sessionId);
    expect(r?.headers.get("set-cookie")).toBeNull();
    // no new workspace, run, session start or task, and no new-session slot
    expect(await footprint()).toEqual(before);
    const tasks = await t.deps.db
      .select({ id: schema.taskOutbox.id })
      .from(schema.taskOutbox)
      .where(eq(schema.taskOutbox.workspaceId, s.body.workspaceId));
    expect(tasks).toHaveLength(1);
    expect(taken.filter((n) => NEW_SESSION_RULES.includes(n))).toEqual([]);
  });

  it("an ended session (Reset, expiry, purge) answers 401 FRAME_TOKEN_EXPIRED and never mints a workspace or takes a slot", async () => {
    const ends: Record<string, (s: Started) => Promise<void>> = {
      reset,
      expiry: (s) => setWorkspaceExpiry(ownerSql(), s.body.workspaceId, new Date(Date.now() - 60_000)),
      purge: async (s) => {
        await reset(s);
        await setWorkspaceExpiry(ownerSql(), s.body.workspaceId, new Date(Date.now() - 60_000));
        const out = await purgeExpiredJudgeWorkspaces(t.deps.db, 50, [s.body.workspaceId]);
        expect(out.purged).toEqual([s.body.workspaceId]);
      },
    };
    for (const [how, end] of Object.entries(ends)) {
      t.deps.rateLimits.reset();
      const s = await startSession(); // takes one slot of the cookie's three
      await end(s);
      const before = await footprint();
      const taken = await rulesTaken(async () => {
        // more renewals than the cookie has new-session slots: none of them may spend one
        for (let i = 0; i < 4; i++) {
          const r = await renew(s.body.sessionId, judge(s));
          expect(r.status, `${how} #${i}`).toBe(401);
          expect(ApiError.parse(r.body).code, how).toBe("FRAME_TOKEN_EXPIRED");
          expect(r.headers.get("set-cookie"), how).toBeNull();
        }
      });
      expect(await footprint(), how).toEqual(before);
      expect(
        taken.filter((n) => NEW_SESSION_RULES.includes(n)),
        how,
      ).toEqual([]);
      // the cookie's bucket still holds the two slots the first press left
      const slot = t.deps.rateLimits.take(RATE_RULES.judgeSessionPerCookie, s.body.sessionId);
      expect(slot, how).toEqual({ ok: true, remaining: 1 });
      t.deps.rateLimits.reset();
      // and the press, not the renewal, still starts a fresh workspace under the same session id
      const next = await startSession(s.cookie);
      expect(next.body.sessionId, how).toBe(s.body.sessionId);
      expect(next.body.workspaceId, how).not.toBe(s.body.workspaceId);
    }
  });

  it("only the judge stage of that session renews: 403 for another session or a token, 401 with no credential", async () => {
    const a = await startSession();
    const b = await startSession();
    const other = await renew(b.body.sessionId, judge(a));
    expect(other.status).toBe(403);
    expect(ApiError.parse(other.body).code).toBe("FORBIDDEN");
    // a console token, a Chair frame and a paired phone never mint a console token
    for (const token of [a.body.consoleToken, await frame(a, "board:ernesto"), await pairedPhone(a)]) {
      const r = await renew(a.body.sessionId, bearer(token));
      expect(r.status).toBe(403);
    }
    const none = await renew(a.body.sessionId, undefined);
    expect(none.status).toBe(401);
    expect(ApiError.parse(none.body).code).toBe("UNAUTHENTICATED");
    // the answer carries a secret: never stored for an Idempotency-Key replay
    const keyed = await renew(a.body.sessionId, judge(a), { "idempotency-key": "k1b-renew-0001" });
    expect(keyed.status).toBe(400);
    // nothing above minted a workspace for either session
    const ws = (
      await ownerSql()<{ n: number }[]>`
      select count(*)::int as n from workspaces where id in (${a.body.workspaceId}, ${b.body.workspaceId})`
    )[0];
    expect(ws?.n).toBe(2);
    const [{ n } = { n: -1 }] = (await t.deps.db.execute(sql`
      select count(*)::int as n from pay_runs where workspace_id in (${a.body.workspaceId}, ${b.body.workspaceId})`)) as unknown as {
      n: number;
    }[];
    expect(n).toBe(2);
  });
});
