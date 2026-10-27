// Judge sessions (S3.9 lifecycle). The first view makes no calls; the first press starts a session:
//   1. reads the `fs_js` cookie: a live session RESUMES (200, a fresh console token, no new calls);
//   2. otherwise throttles session starts (3 an hour per cookie, 30 per hashed IP);
//   3. decides live or replay (kill switches, simulator, circuit, balance, quotas: never a block);
//   4. in ONE transaction: claims a pooled workspace (SKIP LOCKED) or clones one, creates the run (a fresh
//      runSeq from the global sequence), mints the console token (treasurer:analyn, 2 h), records the
//      session in the ledger and enqueues Claude's invoice turn through the outbox (I7);
//   5. sets the cookie, joins the live lane when live (`queuePosition`), and refills the pool behind it.
// Reset expires the workspace, revokes its tokens and enqueues `judgeReset{button}` (which cancels a parked
// UNCLAIMED item and purges when it is safe): the next press binds the same session id to a fresh workspace.
import { randomUUID } from "node:crypto";
import { TASKS } from "@fairsplit/contracts";
import { appendLedger, type DbOrTx, schema, type Tx, uuidv7, workspaceScope } from "@fairsplit/db";
import { enqueue } from "@fairsplit/outbox";
import { getSnapshot } from "@fairsplit/seed";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { readJudgeCookie, setJudgeCookie } from "../credentials/issue/judge-cookie.js";
import { CONSOLE_PERSONA, mintBearerToken, revokeWorkspaceTokens } from "../credentials/issue/tokens.js";
import type { JudgeSessionCredential } from "../credentials/verify/index.js";
import { clientIp, hashedClientIp } from "../lib/client-ip.js";
import type { AppContext, AppDeps } from "../lib/context.js";
import { ApiProblem, problem } from "../lib/problem.js";
import { RATE_RULES } from "../lib/rate-limit.js";
import { claimPooledWorkspace, cloneWorkspace, JUDGE_WORKSPACE_TTL_MS } from "./pool.js";
import { judgeRail, type RailDecision } from "./quota.js";
import { JUDGE_RATE_RULES, judgeRuntime } from "./runtime.js";

/** Readers of a not-yet-claimed workspace see only env-wide kill switches (no workspace flag rows exist). */
const NO_WORKSPACE = "00000000-0000-0000-0000-000000000000";

export interface WorkspaceRow {
  id: string;
  kind: string;
  claimedAt: Date | null;
  expiresAt: Date | null;
}

export interface RunRow {
  id: string;
  runSlug: string;
  state: string;
  version: number;
}

export async function workspaceRow(db: DbOrTx, workspaceId: string): Promise<WorkspaceRow | null> {
  const w = schema.workspaces;
  const [row] = await db
    .select({ id: w.id, kind: w.kind, claimedAt: w.claimedAt, expiresAt: w.expiresAt })
    .from(w)
    .where(eq(w.id, workspaceId))
    .limit(1);
  return row ?? null;
}

export function workspaceAlive(row: WorkspaceRow | null, now: Date): row is WorkspaceRow {
  return !!row && (row.expiresAt === null || row.expiresAt.getTime() > now.getTime());
}

/** The workspace's newest run (a judge workspace has one, plus any successor after a DENIED post). */
export async function latestRun(db: DbOrTx, workspaceId: string): Promise<RunRow | null> {
  const r = schema.payRuns;
  const [row] = await db
    .select({ id: r.id, runSlug: r.runSlug, state: r.state, version: r.version })
    .from(r)
    .where(eq(r.workspaceId, workspaceId))
    .orderBy(desc(r.runSeq))
    .limit(1);
  return row ?? null;
}

/** The season, lot and ratified card a new run in this workspace is built on (null when it has none). */
async function runBasis(tx: Tx, workspaceId: string) {
  const [row] = await tx
    .select({
      seasonId: schema.seasons.id,
      seasonCode: schema.seasons.code,
      currency: schema.seasons.currency,
      lotId: schema.lots.id,
      rateCardId: schema.rateCards.id,
      rateCardSha256: schema.rateCards.sha256,
    })
    .from(schema.seasons)
    .innerJoin(
      schema.rateCards,
      and(eq(schema.rateCards.workspaceId, workspaceId), eq(schema.rateCards.seasonId, schema.seasons.id)),
    )
    .innerJoin(
      schema.lots,
      and(eq(schema.lots.workspaceId, workspaceId), eq(schema.lots.seasonId, schema.seasons.id)),
    )
    .where(and(eq(schema.seasons.workspaceId, workspaceId), sql`${schema.rateCards.ratifiedAt} is not null`))
    .limit(1);
  return row ?? null;
}

export interface StartedSession {
  status: 200 | 201;
  body: {
    sessionId: string;
    workspaceId: string;
    runId: string;
    runSlug: string;
    consoleToken: string;
    expiresAt: string;
    queuePosition: number | null;
  };
  rail: RailDecision | null;
}

function sessionActor(sessionId: string) {
  return { kind: "human" as const, id: "judge", impersonatedBy: `judge_session:${sessionId}` };
}

/** `POST /v1/judge/sessions` (IC-01 createJudgeSession). */
export async function startJudgeSession(c: AppContext, deps: AppDeps): Promise<StartedSession> {
  const now = deps.clock.now();
  const rt = judgeRuntime(deps);
  const cookie = readJudgeCookie(c, deps);

  // 1. Resume: refreshes and new tabs continue the cookie's session with no new PayPal or model call.
  if (cookie.status === "ok") {
    const ws = await workspaceRow(deps.db, cookie.ws);
    if (ws?.kind === "judge" && workspaceAlive(ws, now)) {
      const resumed = await resumeSession(deps, { sessionId: cookie.sid, ws, now });
      if (resumed) return resumed;
    }
  }

  // 2. Throttle new sessions: per cookie (a session id outlives a Reset) and per hashed IP (loose bound).
  const sessionId = cookie.status === "ok" ? cookie.sid : randomUUID();
  const perCookie = deps.rateLimits.take(RATE_RULES.judgeSessionPerCookie, sessionId);
  if (!perCookie.ok) {
    throw problem.rateLimited(
      perCookie.retryAfterMs,
      "Three new sessions an hour per browser. Resume yours.",
    );
  }
  const ip = hashedClientIp(deps.credentials.keys, clientIp(c.req.raw.headers), now);
  const perIp = deps.rateLimits.take(RATE_RULES.judgeSessionPerIp, ip);
  if (!perIp.ok) throw problem.rateLimited(perIp.retryAfterMs, "Too many new sessions from this network.");

  // 3. Live or replay, from fresh flags and counts (over quota is a labelled replay, never a refusal).
  const rail = await judgeRail(deps, { workspaceId: NO_WORKSPACE, sessionId, step: "session" });
  const runProvenance = rail.mode === "live" ? deps.paypal.provenance : ("replay" as const);
  const expiresAt = new Date(now.getTime() + JUDGE_WORKSPACE_TTL_MS);

  // 4. One transaction: claim (or clone) the workspace, make the run, mint the console token, record, enqueue.
  let cloned = false;
  const started = await deps.db.transaction(async (tx) => {
    let workspaceId = await claimPooledWorkspace(tx, now, expiresAt);
    if (!workspaceId) {
      if (!rt.tryEnterClone()) {
        throw new ApiProblem("QUEUED", "Preparing a fresh workspace. You're next; try again in a moment.", {
          retryAfterMs: 3_000,
          details: { reason: "PREPARING_WORKSPACE" },
        });
      }
      try {
        workspaceId = await cloneWorkspace(tx, { claimedAt: now, expiresAt });
        cloned = true;
      } finally {
        rt.leaveClone();
      }
    }
    // lock order (db/tx.ts): the workspace lock before this workspace's rows and ledger
    await tx.execute(sqlLock(workspaceId));
    let basis = await runBasis(tx, workspaceId);
    if (!basis && !cloned) {
      // A damaged pooled workspace is retired (the hourly purge removes it), never handed to a judge.
      await tx
        .update(schema.workspaces)
        .set({ claimedAt: null, expiresAt: now })
        .where(eq(schema.workspaces.id, workspaceId));
      deps.logger.warn({ workspaceId }, "retired a pooled judge workspace without a ratified season");
      workspaceId = await cloneWorkspace(tx, { claimedAt: now, expiresAt });
      cloned = true;
      await tx.execute(sqlLock(workspaceId));
      basis = await runBasis(tx, workspaceId);
    }
    if (!basis) throw problem.internal("A fresh judge workspace could not be prepared.");
    const scope = workspaceScope({ workspaceId, actor: sessionActor(sessionId), via: "session" });
    const fx = getSnapshot().fx;
    const runId = uuidv7();
    const [run] = await tx
      .insert(schema.payRuns)
      .values({
        id: runId,
        workspaceId,
        seasonId: basis.seasonId,
        lotId: basis.lotId,
        rateCardId: basis.rateCardId,
        seasonCode: basis.seasonCode,
        currency: basis.currency,
        fxNum: BigInt(fx.centavosPerCent.num),
        fxDen: BigInt(fx.centavosPerCent.den),
        fxSource: `Seeded reference rate (${fx.display}), for display and peso ledger items only`,
        rateCardSha256: basis.rateCardSha256,
        provenance: runProvenance,
      })
      .returning({ id: schema.payRuns.id, runSlug: schema.payRuns.runSlug });
    if (!run) throw problem.internal("The run could not be created.");
    const consoleToken = await mintBearerToken(tx, {
      workspaceId,
      kind: "frame",
      ...CONSOLE_PERSONA,
      sessionId,
      now,
      workspaceExpiresAt: expiresAt,
    });
    await appendLedger(tx, scope, {
      kind: "judge.session.started",
      payload: {
        sessionId,
        runId,
        workspace: cloned ? "cloned" : "pooled",
        rail: rail.mode,
        ...(rail.reason ? { replayReason: rail.reason } : {}),
      },
      runId,
      at: now,
    });
    // Claude's invoice turn (S4: session start enqueues it). The recording replays through the live lattice;
    // the money steps it reaches ask `judgeRail` / the live lane before any PayPal call.
    const turn = { runId, purpose: "DRAFT_INVOICE" as const, holdId: null, turn: 0 };
    await enqueue(tx, "agentTurn", turn, TASKS.agentTurn.dedupeKey(turn), { workspaceId });
    return { workspaceId, runId, runSlug: run.runSlug, consoleToken };
  });

  setJudgeCookie(c, deps, { sessionId, workspaceId: started.workspaceId, now, expiresAt });
  const queuePosition =
    rail.mode === "live"
      ? rt.lane.join({ workspaceId: started.workspaceId, step: "invoice", sessionId })
      : null;
  rt.refillSoon();
  deps.logger.info(
    { sessionId, workspaceId: started.workspaceId, runSlug: started.runSlug, rail: rail.mode, cloned },
    "judge session started",
  );
  return {
    status: 201,
    body: {
      sessionId,
      workspaceId: started.workspaceId,
      runId: started.runId,
      runSlug: started.runSlug,
      consoleToken: started.consoleToken.token,
      expiresAt: started.consoleToken.expiresAt.toISOString(),
      queuePosition,
    },
    rail,
  };
}

async function resumeSession(
  deps: AppDeps,
  o: { sessionId: string; ws: WorkspaceRow; now: Date },
): Promise<StartedSession | null> {
  const run = await latestRun(deps.db, o.ws.id);
  if (!run) return null;
  const limit = deps.rateLimits.take(JUDGE_RATE_RULES.resume, o.sessionId);
  if (!limit.ok) throw problem.rateLimited(limit.retryAfterMs, "Too many console tokens for this session.");
  const token = await deps.db.transaction(async (tx) => {
    await tx.execute(sqlLock(o.ws.id));
    return mintBearerToken(tx, {
      workspaceId: o.ws.id,
      kind: "frame",
      ...CONSOLE_PERSONA,
      sessionId: o.sessionId,
      now: o.now,
      workspaceExpiresAt: o.ws.expiresAt,
    });
  });
  return {
    status: 200,
    body: {
      sessionId: o.sessionId,
      workspaceId: o.ws.id,
      runId: run.id,
      runSlug: run.runSlug,
      consoleToken: token.token,
      expiresAt: token.expiresAt.toISOString(),
      queuePosition: judgeRuntime(deps).lane.position(o.ws.id),
    },
    rail: null,
  };
}

function sqlLock(workspaceId: string) {
  return sql`select pg_advisory_xact_lock(hashtextextended(${`fs:ws-log:${workspaceId}`}, 0))`;
}

/** The judge cookie's session, required to match `:sid` (a judge acts only in their own session). */
export function requireOwnSession(
  credential: { kind: string; sessionId?: string | null } | null,
  sid: string,
): asserts credential is JudgeSessionCredential {
  if (credential?.kind !== "judge_session") {
    throw problem.forbidden("Only the judge stage that started this session can do this.");
  }
  if (credential.sessionId?.toLowerCase() !== sid.toLowerCase()) {
    throw problem.forbidden("This is another judge session.");
  }
}

export interface ResetOutcome {
  reset: true;
  sessionId: string;
  workspaceId: string;
  endedAt: string;
  revokedTokens: number;
}

/**
 * `POST /v1/judge/sessions/:sid/reset`: ends the workspace now (compare-and-set on its expiry), revokes every
 * token minted in it and enqueues `judgeReset{button}` in the same transaction (I7). The cookie keeps its
 * session id, so the next press is a fresh workspace under the same per-cookie quotas.
 */
export async function resetJudgeSession(
  deps: AppDeps,
  credential: JudgeSessionCredential,
): Promise<ResetOutcome> {
  const now = deps.clock.now();
  const ws = credential.workspaceId;
  const scope = workspaceScope({
    workspaceId: ws,
    actor: sessionActor(credential.sessionId),
    via: "session",
  });
  const revoked = await deps.db.transaction(async (tx) => {
    await tx.execute(sqlLock(ws));
    const w = schema.workspaces;
    const ended = await tx
      .update(w)
      .set({ expiresAt: now })
      .where(and(eq(w.id, ws), eq(w.kind, "judge"), or(isNull(w.expiresAt), gt(w.expiresAt, now))))
      .returning({ id: w.id });
    if (ended.length === 0) {
      throw problem.expired("This judge session has already ended. Start again.");
    }
    const n = await revokeWorkspaceTokens(tx, ws, now);
    await appendLedger(tx, scope, {
      kind: "judge.session.reset",
      payload: { sessionId: credential.sessionId, revokedTokens: n },
      at: now,
    });
    const args = { trigger: "button" as const, workspaceId: ws, slot: uuidv7() };
    // a system task (no workspace_id): the purge it may run deletes the workspace's own outbox rows
    await enqueue(tx, "judgeReset", args, TASKS.judgeReset.dedupeKey(args));
    return n;
  });
  const rt = judgeRuntime(deps);
  rt.lane.releaseWorkspace(ws);
  rt.presence.forgetWorkspace(ws);
  deps.logger.info({ sessionId: credential.sessionId, workspaceId: ws }, "judge session reset");
  return {
    reset: true,
    sessionId: credential.sessionId,
    workspaceId: ws,
    endedAt: now.toISOString(),
    revokedTokens: revoked,
  };
}
