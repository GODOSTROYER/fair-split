// SSE routes (S3.7, IC-08). The two IC-01 streams plus the line stream S3.7 names:
//   GET /v1/runs/:runSlug/events      runEvents       a run reader; the run must be in its workspace
//   GET /v1/workspaces/:ws/events     workspaceEvents a run reader; :ws must be the credential's workspace
//   GET /v1/lines/:lineId/events      (S3.7)          a run reader in the line's workspace, a member token for its
//                                                     own member's line, or that line's member link
// Run readers are the acting treasurer, board, clerk and judge (`STREAM_READERS`, the same roles as the runs
// slice's `CAN.readRuns`): these streams carry member-level events (line.state, item.updated, hold.*, extract.*),
// so a brand or member token, which reads no run, streams none of them. The role is checked before any lookup.
// The public Proof stream (aggregate counters only) is the Proof slice's: it calls `deps.sse.open()` with
// `publicCaps(c)` and its own projection.
import { API_COMMANDS, type Role } from "@fairsplit/contracts";
import { type Db, schema } from "@fairsplit/db";
import { and, eq } from "drizzle-orm";
import type { Credential } from "../credentials/verify/index.js";
import { clientIp, hashedClientIp } from "../lib/client-ip.js";
import { commandSpec, type Mounter, toHonoPath } from "../lib/command.js";
import type { AppContext } from "../lib/context.js";
import { problem } from "../lib/problem.js";
import { requireActing, requireCredential, requireRole } from "../middleware/credential.js";
import { documentRoute } from "../openapi.js";
import { parseLastEventId } from "./envelope.js";
import type { SseLimits } from "./hub.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who may stream a run, a workspace or any line of it (mirrors the runs slice's `CAN.readRuns`). */
export const STREAM_READERS: readonly Role[] = ["treasurer", "board", "clerk", "judge"];
const RUN_SLUG = /^\d{4}[A-Z]-r\d+$/;

/** Stream caps for a credential: 2 per credential, and the judge session's 8 shared by all its tokens. */
export function capsFor(cred: Credential, limits: Readonly<SseLimits>): { key: string; limit: number }[] {
  switch (cred.kind) {
    case "frame":
    case "device":
      return [
        { key: `tok:${cred.tokenId}`, limit: limits.perCredential },
        ...(cred.sessionId ? [{ key: `judge:${cred.sessionId}`, limit: limits.perJudgeSession }] : []),
      ];
    case "judge_session":
      return [{ key: `judge:${cred.sessionId}`, limit: limits.perJudgeSession }];
    case "member_link":
    case "brand_link":
      return [{ key: `link:${cred.jti}`, limit: limits.perCredential }];
    case "operator":
      return [{ key: "operator", limit: limits.perJudgeSession }];
  }
}

/** Caps for an anonymous public stream: 3 per hashed IP. */
export function publicCaps(c: AppContext): { key: string; limit: number }[] {
  const deps = c.get("deps");
  const ip = hashedClientIp(deps.credentials.keys, clientIp(c.req.raw.headers), deps.clock.now());
  return [{ key: `ip:${ip}`, limit: deps.sse.limits.publicPerIp }];
}

export async function findRunId(db: Db, workspaceId: string, runSlug: string): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.payRuns.id })
    .from(schema.payRuns)
    .where(and(eq(schema.payRuns.workspaceId, workspaceId), eq(schema.payRuns.runSlug, runSlug)))
    .limit(1);
  return row?.id ?? null;
}

/** True when the line is in the workspace (and, when `memberId` is given, is that member's line). */
export async function lineExists(
  db: Db,
  workspaceId: string,
  lineId: string,
  memberId?: string,
): Promise<boolean> {
  const ml = schema.memberLines;
  const [row] = await db
    .select({ id: ml.id })
    .from(ml)
    .where(
      and(
        eq(ml.workspaceId, workspaceId),
        eq(ml.id, lineId),
        ...(memberId === undefined ? [] : [eq(ml.memberId, memberId)]),
      ),
    )
    .limit(1);
  return !!row;
}

function lastEventId(c: AppContext): number | undefined {
  return parseLastEventId(c.req.header("last-event-id"), c.req.query("lastEventId"));
}

export function mountSseRoutes(m: Mounter): void {
  m.app.get(toHonoPath(API_COMMANDS.runEvents.path), async (c) => {
    const ctx = c as AppContext;
    const cred = await requireActing(ctx);
    requireRole(cred, STREAM_READERS);
    const runSlug = c.req.param("runSlug") ?? "";
    if (!RUN_SLUG.test(runSlug)) throw problem.notFound("No such run.");
    const deps = ctx.get("deps");
    const runId = await findRunId(deps.db, cred.workspaceId, runSlug);
    if (!runId) throw problem.notFound("No such run in this workspace.");
    return deps.sse.open(ctx, {
      scope: { workspaceId: cred.workspaceId, runId },
      caps: capsFor(cred, deps.sse.limits),
      lastEventId: lastEventId(ctx),
      label: "run",
    });
  });
  documentRoute(m.app, m.catalog, commandSpec("runEvents"));

  m.app.get(toHonoPath(API_COMMANDS.workspaceEvents.path), async (c) => {
    const ctx = c as AppContext;
    const cred = await requireActing(ctx);
    requireRole(cred, STREAM_READERS);
    const ws = (c.req.param("ws") ?? "").toLowerCase();
    // The workspace comes from the credential; another workspace's id looks absent.
    if (!UUID.test(ws) || ws !== cred.workspaceId.toLowerCase()) throw problem.notFound("No such workspace.");
    const deps = ctx.get("deps");
    return deps.sse.open(ctx, {
      scope: { workspaceId: cred.workspaceId },
      caps: capsFor(cred, deps.sse.limits),
      lastEventId: lastEventId(ctx),
      label: "workspace",
    });
  });
  documentRoute(m.app, m.catalog, commandSpec("workspaceEvents"));

  const linePath = "/v1/lines/:lineId/events";
  m.app.get(linePath, async (c) => {
    const ctx = c as AppContext;
    const cred = await requireCredential(ctx, ["frame", "device", "judge_session", "member_link"] as const);
    const lineId = (c.req.param("lineId") ?? "").toLowerCase();
    if (!UUID.test(lineId)) throw problem.notFound("No such line.");
    const deps = ctx.get("deps");
    if (cred.kind === "member_link") {
      if (cred.lineId.toLowerCase() !== lineId) throw problem.notFound("No such line.");
    } else if (cred.role === "member") {
      // a member's own token (the app): its own member's line only; another line looks absent
      if (!cred.memberId || !(await lineExists(deps.db, cred.workspaceId, lineId, cred.memberId))) {
        throw problem.notFound("No such line.");
      }
    } else {
      requireRole(cred, STREAM_READERS);
      if (!(await lineExists(deps.db, cred.workspaceId, lineId))) {
        throw problem.notFound("No such line in this workspace.");
      }
    }
    return deps.sse.open(ctx, {
      scope: { workspaceId: cred.workspaceId, lineId },
      caps: capsFor(cred, deps.sse.limits),
      lastEventId: lastEventId(ctx),
      label: "line",
    });
  });
  documentRoute(m.app, m.catalog, {
    name: "lineEvents",
    method: "GET",
    path: linePath,
    auth: "frame_or_session",
    request: null,
    response: null,
    success: [200],
    errors: ["NOT_FOUND", "UNAUTHENTICATED", "FRAME_TOKEN_EXPIRED", "FORBIDDEN", "RATE_LIMITED"],
    headers: ["Last-Event-ID"],
    tag: "events",
    sse: true,
    summary: "lineEvents",
    description:
      "S3.7 line stream (one member's line): a run reader (treasurer, board, clerk, judge) in the line's workspace, a member token for its own line, or that line's member link (`fsm_…`). Server-sent IC-01 RunEvent envelopes.",
    contract: false,
  });
}
