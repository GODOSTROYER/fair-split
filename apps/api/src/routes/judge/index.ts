// src/routes/judge: owned by the JUDGE slice (apps/api/SPLIT.md).
// Judge sessions (cookie 24 h, pooled workspace clone, a fresh runSeq, Reset), the live-or-replay decision
// and the single-flight live lane, the labelled "Try to break it" controls, the judge code, demo signing
// keys, presence (1 Hz, an event at most every 5 s) and the `judgeReset` task.
// IC-01 commands here: createJudgeSession, presence.
import { createHash, timingSafeEqual } from "node:crypto";
import type { PayRunState } from "@fairsplit/contracts";
import { appendLedger, withWorkspaceTx, workspaceScope } from "@fairsplit/db";
import { sql } from "drizzle-orm";
import { readJudgeCookie } from "../../credentials/issue/judge-cookie.js";
import { refuseReplayOfSecret } from "../../credentials/issue/secrets.js";
import type { JudgeSessionCredential } from "../../credentials/verify/index.js";
import { DemoKeyRequest, DemoKeyResponse, registerDemoKey } from "../../judge/keys.js";
import { retireStalePool } from "../../judge/pool.js";
import { recordPresence } from "../../judge/presence.js";
import { judgeRail, type RailDecision, recordJudgeCode } from "../../judge/quota.js";
import { runJudgeReset } from "../../judge/reset-task.js";
import { JUDGE_RATE_RULES, judgeRuntime } from "../../judge/runtime.js";
import {
  JudgeCodeRequest,
  JudgeCodeResponse,
  JudgeSessionStatus,
  PublicLaneView,
  ResetResponse,
  TamperRequest,
  TamperResponse,
} from "../../judge/schemas.js";
import {
  latestRun,
  requireOwnSession,
  resetJudgeSession,
  startJudgeSession,
  workspaceRow,
} from "../../judge/session.js";
import { armChangePayout, tamperArmed, tamperDraft } from "../../judge/tamper.js";
import { clientIp, hashedClientIp } from "../../lib/client-ip.js";
import { reply } from "../../lib/command.js";
import { problem } from "../../lib/problem.js";
import { defineRouteFolder } from "../../lib/slice.js";

const NO_WORKSPACE = "00000000-0000-0000-0000-000000000000";

function railView(r: RailDecision) {
  return { mode: r.mode, reason: r.reason, label: r.label, rail: r.rail, quota: r.quota };
}

/** The judge session a credential belongs to: the cookie itself, or a token a session minted. */
function sessionIdOf(cred: { kind: string; sessionId?: string | null }): string | null {
  return cred.kind === "judge_session" || cred.kind === "frame" || cred.kind === "device"
    ? (cred.sessionId ?? null)
    : null;
}

export default defineRouteFolder({
  folder: "judge",
  commands: {
    createJudgeSession: async (ctx) => {
      // the answer carries a console token: never stored for an Idempotency-Key replay (resume is the retry)
      refuseReplayOfSecret(ctx.header);
      const started = await startJudgeSession(ctx.c, ctx.deps);
      return reply(started.status, started.body);
    },
    presence: async (ctx) => {
      await recordPresence(ctx.deps, ctx.credential, ctx.input);
      return { ok: true as const };
    },
  },
  routes: (r) => {
    r.route(
      {
        method: "GET",
        path: "/v1/judge/session",
        auth: "frame_or_session",
        name: "session",
        summary: "The judge session: its run, live-or-replay decision, lane position and armed tamper",
        response: JudgeSessionStatus,
      },
      async (ctx) => {
        const sessionId = sessionIdOf(ctx.credential);
        if (!sessionId) throw problem.forbidden("This credential does not belong to a judge session.");
        const ws = await workspaceRow(ctx.deps.db, ctx.credential.workspaceId);
        if (ws?.kind !== "judge" || !ws.expiresAt) throw problem.notFound("No judge session here.");
        const run = await latestRun(ctx.deps.db, ws.id);
        const rail = await judgeRail(ctx.deps, { workspaceId: ws.id, sessionId, step: "session" });
        const lane = judgeRuntime(ctx.deps).lane;
        const position = lane.position(ws.id);
        const view = lane.view();
        return {
          sessionId,
          workspaceId: ws.id,
          runId: run?.id ?? null,
          runSlug: run?.runSlug ?? null,
          runState: (run?.state as PayRunState | undefined) ?? null,
          sessionExpiresAt: ws.expiresAt.toISOString(),
          rail: railView(rail),
          lane: {
            position,
            etaMs: position === null ? null : lane.etaMs(position),
            depth: view.depth,
            holderStep: view.holder?.step ?? null,
          },
          tamper: { changePayoutArmed: run ? await tamperArmed(ctx.deps.db, ws.id, run.id) : false },
        };
      },
    );

    r.route(
      {
        method: "GET",
        path: "/v1/judge/lane",
        auth: "public",
        name: "lane",
        summary: "The live lane and today's live-payout quota (\"What's real\")",
        description:
          "Public and unauthenticated, so it is throttled per hashed IP and served from a 2 s cache; the decisions that move money never read this view.",
        response: PublicLaneView,
        errors: ["RATE_LIMITED"],
      },
      async (ctx) => {
        const deps = ctx.deps;
        const ip = hashedClientIp(deps.credentials.keys, clientIp(ctx.c.req.raw.headers), ctx.now());
        const limit = deps.rateLimits.take(JUDGE_RATE_RULES.publicLane, ip);
        if (!limit.ok) throw problem.rateLimited(limit.retryAfterMs);
        const cookie = readJudgeCookie(ctx.c, deps);
        const sid = cookie.status === "ok" ? cookie.sid : null;
        const ws =
          ctx.credential && ctx.credential.kind !== "operator" ? ctx.credential.workspaceId : NO_WORKSPACE;
        const rt = judgeRuntime(deps);
        return rt.cachedView(`lane|${ws}|${sid ?? ""}`, deps.clock.nowMs(), async () => {
          const rail = await judgeRail(deps, { workspaceId: ws, sessionId: sid, step: "session" });
          const view = rt.lane.view();
          return { lane: { depth: view.depth, holderStep: view.holder?.step ?? null }, rail: railView(rail) };
        });
      },
    );

    r.route(
      {
        method: "POST",
        path: "/v1/judge/sessions/:sid/reset",
        auth: "frame_or_session",
        name: "reset",
        summary: "Reset: end this workspace now; the next press starts a fresh one",
        description:
          "Ends the workspace (compare-and-set), revokes every token minted in it and enqueues judgeReset{button}, which cancels a parked UNCLAIMED item (at most 2 PayPal calls) and purges the workspace once that is safe. The judge cookie keeps its session id.",
        response: ResetResponse,
        errors: ["FRAME_TOKEN_EXPIRED"],
      },
      async (ctx) => {
        requireOwnSession(ctx.credential, ctx.params.sid);
        return resetJudgeSession(ctx.deps, ctx.credential as JudgeSessionCredential);
      },
    );

    r.route(
      {
        method: "POST",
        path: "/v1/judge/sessions/:sid/tamper",
        auth: "frame_or_session",
        name: "tamper",
        summary: "Try to break it (simulated, labelled): tamper with the draft or arm a 1-cent payout change",
        description:
          "amount | offsetting | recipient: the server mutates the code-built canonical invoice and runs the real policy lattice (no model or PayPal call). change_payout: armed before the second key; the run's post re-hashes the batch and refuses (I4).",
        request: TamperRequest,
        response: TamperResponse,
        errors: ["INVALID_TRANSITION", "RATE_LIMITED"],
      },
      async (ctx) => {
        requireOwnSession(ctx.credential, ctx.params.sid);
        const cred = ctx.credential as JudgeSessionCredential;
        const limit = ctx.deps.rateLimits.take(JUDGE_RATE_RULES.tamper, cred.sessionId);
        if (!limit.ok) throw problem.rateLimited(limit.retryAfterMs);
        const kind = ctx.input.kind;
        return kind === "change_payout" ? armChangePayout(ctx.deps, cred) : tamperDraft(ctx.deps, cred, kind);
      },
    );

    r.route(
      {
        method: "POST",
        path: "/v1/judge/code",
        auth: "frame_or_session",
        name: "code",
        summary: "Unlock the judge-code bucket of live runs for this session",
        request: JudgeCodeRequest,
        response: JudgeCodeResponse,
        errors: ["RATE_LIMITED"],
      },
      async (ctx) => {
        const cred = ctx.credential;
        if (cred.kind !== "judge_session")
          throw problem.forbidden("Enter the judge code on the judge stage.");
        const deps = ctx.deps;
        const ip = hashedClientIp(deps.credentials.keys, clientIp(ctx.c.req.raw.headers), ctx.now());
        const limit = deps.rateLimits.take(JUDGE_RATE_RULES.judgeCodePerIp, ip);
        if (!limit.ok) throw problem.rateLimited(limit.retryAfterMs);
        const want = deps.env.secrets.judgeCodeSha256;
        if (!want) throw problem.forbidden("No judge code is configured on this server.");
        const got = createHash("sha256").update(ctx.input.code.trim(), "utf8").digest();
        if (!timingSafeEqual(got, Buffer.from(want, "hex"))) {
          throw problem.forbidden("That judge code is not valid.");
        }
        // The unlock lives in the judge quota ledger (system rows), so it follows the session across Resets
        // and the purge of its workspaces; the workspace's own ledger attributes the moment it was entered.
        const scope = workspaceScope({
          workspaceId: cred.workspaceId,
          actor: { kind: "human", id: "judge", impersonatedBy: `judge_session:${cred.sessionId}` },
          via: "session",
        });
        await withWorkspaceTx(deps.db, scope, async (tx) => {
          if (!(await recordJudgeCode(tx, { sessionId: cred.sessionId, at: ctx.now() }))) return;
          await appendLedger(tx, scope, {
            kind: "judge.code.accepted",
            payload: { sessionId: cred.sessionId },
            at: ctx.now(),
          });
        });
        return { ok: true as const, bucket: "judge_code" as const };
      },
    );

    r.route(
      {
        method: "POST",
        path: "/v1/judge/keys",
        auth: "frame_or_session",
        name: "registerDemoKey",
        summary:
          "Register this frame's browser demo signing key (fs-{persona}-w{6 random digits}, labelled Demo key; one key, one signer)",
        request: DemoKeyRequest,
        response: DemoKeyResponse,
        success: [201],
        errors: ["RATE_LIMITED"],
      },
      async (ctx) => {
        const cred = ctx.credential;
        const key = cred.kind === "judge_session" ? `judge:${cred.sessionId}` : `tok:${cred.tokenId}`;
        const limit = ctx.deps.rateLimits.take(JUDGE_RATE_RULES.keys, key);
        if (!limit.ok) throw problem.rateLimited(limit.retryAfterMs);
        return reply(201, await registerDemoKey(ctx.deps, cred, ctx.input));
      },
    );
  },
  tasks: (deps) => ({
    judgeReset: async (args, task) => {
      await runJudgeReset(deps, args, task);
    },
  }),
  onBoot: async (deps) => {
    const rt = judgeRuntime(deps);
    await retireStalePool(deps.db);
    rt.refillSoon();
    const [seq] = (await deps.db.execute(sql`
      select case when is_called then last_value + 1 else last_value end as next from fs_run_seq`)) as unknown as {
      next: string | number;
    }[];
    if (Number(seq?.next ?? 0) < 1_000_000) {
      deps.logger.warn(
        { next: Number(seq?.next ?? 0) },
        "fs_run_seq is inside the seeded range (1-999,999): set FS_RUN_SEQ_FLOOR to this database's live block",
      );
    }
  },
});
