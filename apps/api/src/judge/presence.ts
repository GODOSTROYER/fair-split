// Presence (S3.7, MM-5's one label: "Ernesto, reviewing hold 2 on his phone"). Each viewer posts
// `{view, holdId?}` about every 10 s; the request is throttled to 1 Hz per credential, and it becomes a
// `presence` run event at most once per 5 s per persona, expiring after 25 s. A hold the workspace does not
// have is never echoed (no client text reaches other viewers except the short view name), and the event is
// attached to the hold's run (or the workspace's newest run), so the run stream on W-TR-07 sees it.
import { appendEvent, type Db, schema, withWorkspaceTx } from "@fairsplit/db";
import { and, desc, eq, or } from "drizzle-orm";
import { type ActingCredential, actorOf, scopeOf } from "../credentials/verify/index.js";
import type { AppDeps } from "../lib/context.js";
import { problem } from "../lib/problem.js";
import { RATE_RULES } from "../lib/rate-limit.js";
import { judgeRuntime, PRESENCE } from "./runtime.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A view is a screen id or a short route: printable, no control characters. */
const CONTROL = /\p{Cc}/u;

/** The per-credential key the 1 Hz throttle counts. */
export function presenceClientKey(cred: ActingCredential): string {
  return cred.kind === "judge_session" ? `judge:${cred.sessionId}` : `tok:${cred.tokenId}`;
}

/** Resolves a client's hold reference (an id or a display code such as H1) inside the workspace. */
async function resolveHold(
  db: Db,
  workspaceId: string,
  holdRef: string | undefined,
): Promise<{ id: string; runId: string } | null> {
  if (!holdRef || holdRef.length > 64) return null;
  const h = schema.holds;
  const byId = UUID.test(holdRef) ? eq(h.id, holdRef.toLowerCase()) : null;
  const [row] = await db
    .select({ id: h.id, runId: h.runId })
    .from(h)
    .where(and(eq(h.workspaceId, workspaceId), byId ? or(byId, eq(h.code, holdRef)) : eq(h.code, holdRef)))
    .orderBy(desc(h.createdAt))
    .limit(1);
  return row ?? null;
}

async function newestRunId(db: Db, workspaceId: string): Promise<string | null> {
  const r = schema.payRuns;
  const [row] = await db
    .select({ id: r.id })
    .from(r)
    .where(eq(r.workspaceId, workspaceId))
    .orderBy(desc(r.runSeq))
    .limit(1);
  return row?.id ?? null;
}

export interface PresenceOutcome {
  ok: true;
  /** Whether this beat became a `presence` event (false when coalesced inside the 5 s gap). */
  emitted: boolean;
}

/** `POST /v1/presence` (IC-01 presence). */
export async function recordPresence(
  deps: AppDeps,
  cred: ActingCredential,
  input: { view: string; holdId?: string | undefined },
): Promise<PresenceOutcome> {
  const limit = deps.rateLimits.take(RATE_RULES.presence, presenceClientKey(cred));
  if (!limit.ok) throw problem.rateLimited(limit.retryAfterMs, "Presence is at most once a second.");
  if (CONTROL.test(input.view)) {
    throw problem.validation("The view name has control characters.", [
      { path: "body.view", message: "control characters are not allowed", code: "invalid_string" },
    ]);
  }
  const now = deps.clock.now();
  const actor = actorOf(cred);
  const key = `${cred.workspaceId}|${actor.id}|${actor.impersonatedBy ?? ""}`;
  const hold = await resolveHold(deps.db, cred.workspaceId, input.holdId);
  const rt = judgeRuntime(deps);
  if (!rt.presence.shouldEmit(key, input.view, hold?.id ?? null, now.getTime())) {
    return { ok: true, emitted: false };
  }
  const runId = hold?.runId ?? (await newestRunId(deps.db, cred.workspaceId));
  const scope = scopeOf(cred);
  if (!scope) throw problem.forbidden();
  await withWorkspaceTx(deps.db, scope, (tx) =>
    appendEvent(tx, {
      workspaceId: cred.workspaceId,
      runId,
      type: "presence",
      actor,
      // presence is a fact about this server's viewers, not about PayPal or the seed
      provenance: "live",
      payload: {
        persona: cred.persona,
        view: input.view,
        holdId: hold?.id ?? null,
        expiresAt: new Date(now.getTime() + PRESENCE.ttlMs).toISOString(),
      },
    }),
  );
  return { ok: true, emitted: true };
}
