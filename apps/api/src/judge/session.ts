// Judge sessions (S3.9 lifecycle). The first view makes no calls; the first press starts a session:
//   1. reads the `fs_js` cookie: a live session RESUMES (200, a fresh console token, no new calls);
//   2. otherwise atomically reserves the browser, network and global start budgets (failed work refunds them);
//   3. decides live or replay (kill switches, simulator, circuit, balance, quotas: never a block);
//   4. in ONE transaction: claims a pooled workspace (SKIP LOCKED) or clones one, creates the run (a fresh
//      runSeq from the global sequence), mints the console token (treasurer:analyn, 2 h), records the
//      session in the ledger and enqueues Claude's invoice turn through the outbox (I7);
//   5. sets the cookie, joins the live lane when live (`queuePosition`), and refills the pool behind it.
// Reset expires the workspace, revokes its tokens and enqueues `judgeReset{button}` (which cancels a parked
// UNCLAIMED item and purges when it is safe): the next press binds the same session id to a fresh workspace.
// Renewing the console token (`/renew`) only ever resumes: an ended session is a 401, never a new workspace.
import { randomUUID } from "node:crypto";
import { TASKS } from "@fairsplit/contracts";
import { appendLedger, type DbOrTx, schema, type Tx, uuidv7, workspaceScope } from "@fairsplit/db";
import { enqueue } from "@fairsplit/outbox";
import { getSnapshot } from "@fairsplit/seed";
import { and, count, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { readJudgeCookie, setJudgeCookie } from "../credentials/issue/judge-cookie.js";
import { CONSOLE_PERSONA, mintBearerToken, revokeWorkspaceTokens } from "../credentials/issue/tokens.js";
import type { JudgeSessionCredential } from "../credentials/verify/index.js";
import { clientIpKey } from "../lib/client-ip.js";
import type { AppContext, AppDeps } from "../lib/context.js";
import { ApiProblem, problem } from "../lib/problem.js";
import { RATE_RULES, type RateRule } from "../lib/rate-limit.js";
import { claimCloned, claimPooledWorkspace, cloneWorkspace, workspaceInUse } from "./pool.js";
import { judgeRail, type RailDecision, replayDecision } from "./quota.js";
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

/** In use: unexpired, and (for a judge workspace) its session not ended by a Reset (pool.ts `workspaceInUse`). */
export function workspaceAlive(row: WorkspaceRow | null, now: Date): row is WorkspaceRow {
  return workspaceInUse(row, now);
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
  const ip = clientIpKey(c);
  const perIp = deps.rateLimits.peek(RATE_RULES.judgeSessionPerIp, ip);
  if (!perIp.ok) throw problem.rateLimited(perIp.retryAfterMs, "Too many new sessions from this network.");
  if (cookie.status === "ok") {
    const perCookie = deps.rateLimits.peek(RATE_RULES.judgeSessionPerCookie, sessionId);
    if (!perCookie.ok) {
      throw problem.rateLimited(
        perCookie.retryAfterMs,
        "Three new sessions an hour per browser. Resume yours.",
      );
    }
  }

  const startSlots: (readonly [RateRule, string])[] = [
    [RATE_RULES.judgeSessionPerIp, ip],
    [{ ...RATE_RULES.judgeSessionGlobal, limit: deps.env.judgeStartsPerMinute }, "all"],
    [RATE_RULES.judgeSessionPerNetworkDay, ip],
  ];
  if (cookie.status === "ok") startSlots.push([RATE_RULES.judgeSessionPerCookie, sessionId]);
  // Reserve synchronously before the first await: concurrent starts cannot all pass a peek.
  // A refused rule consumes nothing; a failed start below returns every reservation.
  const admission = deps.rateLimits.takeAll(startSlots);
  if (!admission.ok)
    throw problem.rateLimited(
      admission.retryAfterMs,
      "Judge sessions are busy. Try again shortly or view the public showcase Proof.",
    );

  try {
    // 3. Live or replay, from fresh flags and counts (over quota is a labelled replay, never a refusal).
    let rail = await judgeRail(deps, { workspaceId: NO_WORKSPACE, sessionId, step: "session" });

    // 4. One transaction: claim (or clone and claim) the workspace, make the run, mint the console token, record,
    //    enqueue. The claim's 24 h are the database's (WS-DATA's claimJudgeWorkspace); the cookie ends with it.
    let cloned = false;
    let joinedWorkspace: string | null = null;
    let queuePosition: number | null = null;
    const started = await deps.db
      .transaction(async (tx) => {
        // Serialize admission before any claim/clone, including concurrent processes sharing this database.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('fs:judge-admission',0))`);
        const w = schema.workspaces;
        const [claimed] = await tx
          .select({ n: count() })
          .from(w)
          .where(and(eq(w.kind, "judge"), isNotNull(w.claimedAt), gt(w.expiresAt, now)));
        if ((claimed?.n ?? 0) >= deps.env.judgeClaimedMax) {
          throw new ApiProblem(
            "QUEUED",
            "Judge workspaces are busy. Try again shortly or view the public showcase Proof.",
            { retryAfterMs: 60_000 },
          );
        }
        let claim = await claimPooledWorkspace(tx);
        if (!claim) {
          if (!rt.tryEnterClone()) {
            throw new ApiProblem(
              "QUEUED",
              "Preparing a fresh workspace. You're next; try again in a moment.",
              {
                retryAfterMs: 3_000,
                details: { reason: "PREPARING_WORKSPACE" },
              },
            );
          }
          try {
            claim = await claimCloned(tx, await cloneWorkspace(tx));
            cloned = true;
          } finally {
            rt.leaveClone();
          }
        }
        let workspaceId = claim.workspaceId;
        // lock order (db/tx.ts): the workspace lock before this workspace's rows and ledger
        await tx.execute(sqlLock(workspaceId));
        let basis = await runBasis(tx, workspaceId);
        if (!basis && !cloned) {
          // A damaged pooled workspace is retired: its claim is ended at once (never handed to a judge) and the
          // hourly purge removes it once its expiry passes (the database never moves an expiry earlier).
          await tx
            .update(schema.workspaces)
            .set({ claimedAt: null })
            .where(eq(schema.workspaces.id, workspaceId));
          deps.logger.warn({ workspaceId }, "retired a pooled judge workspace without a ratified season");
          claim = await claimCloned(tx, await cloneWorkspace(tx));
          workspaceId = claim.workspaceId;
          cloned = true;
          await tx.execute(sqlLock(workspaceId));
          basis = await runBasis(tx, workspaceId);
        }
        const expiresAt = claim.expiresAt;
        if (!basis) throw problem.internal("A fresh judge workspace could not be prepared.");
        if (rail.mode === "live") {
          // The existing test-only simulator quota knob also lets the local e2e crowd share one loopback network.
          // It is rejected off NODE_ENV=test/simulator or on Render by env.ts.
          const networkMax = deps.env.judgeHourlyMax ?? 2;
          if (rt.lane.networkDepth(ip) >= networkMax) {
            rail = replayDecision("lane_full", rail.rail, rail.quota);
          } else {
            // Check + reserve synchronously before yielding, so concurrent sessions cannot exceed the network cap.
            queuePosition = rt.lane.join({ workspaceId, step: "invoice", sessionId, networkKey: ip });
            if (queuePosition === null) rail = replayDecision("lane_full", rail.rail, rail.quota);
            else joinedWorkspace = workspaceId;
          }
        }
        const runProvenance = rail.mode === "live" ? deps.paypal.provenance : ("replay" as const);
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
        // every PayPal step it reaches asks money/rail.ts (a fresh `judgeRail`, the live lane) before any PayPal call,
        // and a session decided replay replays its run to the end, calling PayPal not once.
        const turn = { runId, purpose: "DRAFT_INVOICE" as const, holdId: null, turn: 0 };
        await enqueue(tx, "agentTurn", turn, TASKS.agentTurn.dedupeKey(turn), { workspaceId });
        return { workspaceId, runId, runSlug: run.runSlug, consoleToken, expiresAt };
      })
      .catch((error: unknown) => {
        if (joinedWorkspace) rt.lane.releaseWorkspace(joinedWorkspace);
        throw error;
      });

    setJudgeCookie(c, deps, {
      sessionId,
      workspaceId: started.workspaceId,
      now,
      expiresAt: started.expiresAt,
    });
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
  } catch (error) {
    for (const [rule, key] of startSlots) deps.rateLimits.refund(rule, key, admission.takenAtMs);
    throw error;
  }
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
    // A Reset takes the same lock: read the workspace again under it, so no token is minted (unrevoked) in a
    // session that a Reset in another tab ended a moment ago.
    const ws = await workspaceRow(tx, o.ws.id);
    if (ws?.kind !== "judge" || !workspaceAlive(ws, o.now)) return null;
    return mintBearerToken(tx, {
      workspaceId: ws.id,
      kind: "frame",
      ...CONSOLE_PERSONA,
      sessionId: o.sessionId,
      now: o.now,
      workspaceExpiresAt: ws.expiresAt,
    });
  });
  if (!token) return null;
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

/**
 * `POST /v1/judge/sessions/:sid/renew`: the console's token renewal, which only ever resumes. A live session gets
 * the resume answer of createJudgeSession (the same session, workspace and run, a fresh console token; no new
 * task, model or PayPal call). A session whose workspace has ended (a Reset in any tab, its 24 h expiry, the
 * purge) is 401 FRAME_TOKEN_EXPIRED, the answer the console already reads as "ended": nothing is minted and no
 * slot of the new-session limits is taken, because only the press (createJudgeSession) starts a session. The
 * shell refuses a cookie whose workspace has ended with the same answer before this runs; this checks again,
 * under the workspace lock.
 */
export async function renewJudgeSession(
  deps: AppDeps,
  credential: JudgeSessionCredential,
): Promise<StartedSession["body"]> {
  const now = deps.clock.now();
  const ws = await workspaceRow(deps.db, credential.workspaceId);
  const resumed =
    ws?.kind === "judge" && workspaceAlive(ws, now)
      ? await resumeSession(deps, { sessionId: credential.sessionId, ws, now })
      : null;
  if (!resumed) throw problem.expired("This judge session has ended. Press again to start a fresh one.");
  return resumed.body;
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
 * `POST /v1/judge/sessions/:sid/reset`: ends the session now (compare-and-set: its claim is cleared while it is
 * still in use), revokes every token minted in it and enqueues `judgeReset{button}` in the same transaction (I7).
 * The workspace keeps its 24-hour expiry (the database never moves one earlier); the hourly purge removes it once
 * that passes. The cookie keeps its session id, so the next press is a fresh workspace under the same per-cookie
 * quotas.
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
      .set({ claimedAt: null })
      .where(and(eq(w.id, ws), eq(w.kind, "judge"), isNotNull(w.claimedAt), gt(w.expiresAt, now)))
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
