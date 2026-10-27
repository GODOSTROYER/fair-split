/**
 * The persistence half of WS-PPMONEY's `PayoutsRepository` port (paypal-payouts README, "Downstream", IC-04): the
 * compare-and-sets only the database can make atomic, and the member lines `linesDigest` is recomputed from. The
 * port itself (receivers, the officer registry, batch and item rows, line moves, the proof ledger) is WS-API's
 * adapter; `@fairsplit/db` cannot import the port's types (dependency rule), so the adapter calls these:
 *
 *   loadPosting / loadRun  → memberLines = await r.lines.hashes(tx, runId)
 *   writeSubmitted         → first, for a primary batch: const res = await r.runs.beginPosting(tx, {…});
 *                            if (!res.ok) write nothing and return null
 *   voidApprovals          → await r.approvals.voidChecked(tx, {runId, nonces, reason: code, at, provenance})
 *
 * Both writes take the workspace lock, then the run row FOR UPDATE, before reading approvals: a concurrent
 * transition, void or post on the run waits for them, and so does any approval being inserted for the run (its
 * foreign key check takes a key-share lock on the run row). They then lock the approvals they read, so a void that
 * skips the run row and updates an approval directly is waited for too. A decision taken here is therefore still
 * true when it commits.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Provenance } from "../_shims/contracts.js";
import type { DbOrTx, Tx } from "../client.js";
import type { StoredRunEvent } from "../events.js";
import { appendLedger } from "../ledger.js";
import { approvals, memberLines, members, payRuns } from "../schema/index.js";
import type { WorkspaceScope } from "../scope.js";
import { withWorkspaceTx } from "../tx.js";
import {
  type Cause,
  DEFAULT_POLICY,
  type TransitionPolicy,
  transitionRun,
  VOID_REASON,
} from "./transitions.js";

type PayRun = typeof payRuns.$inferSelect;
type Approval = typeof approvals.$inferSelect;

/** One member line of a run as `linesDigest` reads it; `lineSha256` is null when the line has no stored hash. */
export interface MemberLineHash {
  memberNo: string;
  lineSha256: string | null;
}

/**
 * Every member line of the run, on and off rail (the cash lines too), as `{memberNo, lineSha256}` stored now, by
 * member number. A null hash is returned as null: the payouts service refuses it as an invalid batch.
 */
export async function memberLineHashes(
  db: DbOrTx,
  scope: WorkspaceScope,
  runId: string,
): Promise<MemberLineHash[]> {
  const rows = await db
    .select({ memberNo: members.memberNo, lineSha256: memberLines.lineSha256 })
    .from(memberLines)
    .innerJoin(
      members,
      and(eq(members.workspaceId, memberLines.workspaceId), eq(members.id, memberLines.memberId)),
    )
    .where(and(eq(memberLines.workspaceId, scope.workspaceId), eq(memberLines.runId, runId)));
  return rows.sort((a, b) => (a.memberNo < b.memberNo ? -1 : a.memberNo > b.memberNo ? 1 : 0));
}

/** The run's state, with its row locked until the transaction ends; null when the scope has no such run. */
async function lockRunState(tx: Tx, scope: WorkspaceScope, runId: string): Promise<string | null> {
  const [row] = await tx
    .select({ state: payRuns.state })
    .from(payRuns)
    .where(and(eq(payRuns.workspaceId, scope.workspaceId), eq(payRuns.id, runId)))
    .for("update");
  return row?.state ?? null;
}

export interface PostingStart {
  /** the run */
  id: string;
  /** the nonces of the approvals the post was checked under (approvals.nonce is UNIQUE) */
  approvalNonces: readonly string[];
  /** the batch digest every one of those approvals signed, written to the run (I4) */
  batchSha256: string;
  senderBatchId: string;
  cause: Cause;
  provenance: Provenance;
}

export type PostingStartResult =
  | { ok: true; row: PayRun; event: StoredRunEvent | null }
  | {
      ok: false;
      /** APPROVALS_STALE: a named approval is voided, unknown, another run's, or signed another digest */
      reason: "ILLEGAL" | "NOT_FOUND" | "STALE" | "APPROVALS_STALE";
      current: string | null;
    };

/**
 * APPROVED → POSTING (S3.6.4 step 5) as a compare-and-set on the run's state AND on the approvals the post was
 * checked under: only while the run is APPROVED and every named approval is a live (not voided) SIGNED approval of
 * this run that signed `batchSha256`. Otherwise it writes nothing. So an executor that read the run, stalled while a
 * check voided those approvals and both keys signed again, cannot post the old lines although the run is APPROVED
 * again. The named approvals stay locked until the transaction ends, so nothing voids them before the batch rows the
 * caller writes next to it commit.
 */
export async function beginPosting(
  db: DbOrTx,
  scope: WorkspaceScope,
  p: PostingStart,
  policy: TransitionPolicy = DEFAULT_POLICY,
): Promise<PostingStartResult> {
  if (!policy.run("APPROVED", "POSTING")) return { ok: false, reason: "ILLEGAL", current: "APPROVED" };
  const nonces = [...new Set(p.approvalNonces)];
  return withWorkspaceTx(db, scope, async (tx) => {
    const state = await lockRunState(tx, scope, p.id);
    if (state === null) return { ok: false, reason: "NOT_FOUND", current: null };
    if (state !== "APPROVED") return { ok: false, reason: "STALE", current: state };
    const named =
      nonces.length === 0
        ? []
        : await tx
            .select({ id: approvals.id })
            .from(approvals)
            .where(
              and(
                eq(approvals.workspaceId, scope.workspaceId),
                eq(approvals.runId, p.id),
                eq(approvals.decision, "SIGNED"),
                isNull(approvals.voidedAt),
                eq(approvals.batchSha256, p.batchSha256),
                inArray(approvals.nonce, nonces),
              ),
            )
            .for("share");
    if (nonces.length === 0 || named.length !== nonces.length) {
      return { ok: false, reason: "APPROVALS_STALE", current: state };
    }
    const res = await transitionRun(
      tx,
      scope,
      {
        id: p.id,
        from: "APPROVED",
        to: "POSTING",
        cause: p.cause,
        provenance: p.provenance,
        patch: { batchSha256: p.batchSha256, senderBatchId: p.senderBatchId },
      },
      policy,
    );
    // the run row is locked and APPROVED, and the policy allows the edge: nothing else can refuse it
    if (!res.ok) throw new Error(`runs.beginPosting: APPROVED → POSTING failed (${res.reason})`);
    return res;
  });
}

export interface CheckedApprovalVoid {
  runId: string;
  /** the nonces of the approvals the failed check read (approvals.nonce is UNIQUE) */
  nonces: readonly string[];
  /** a code such as DIGEST_MISMATCH or APPROVALS_MISSING (the port's `code`); never free text */
  reason: string;
  provenance: Provenance;
  /** when the check failed, stamped as voided_at and on the ledger entry; defaults to now */
  at?: Date;
}

export type CheckedApprovalVoidResult =
  | { ok: true; row: PayRun; event: StoredRunEvent | null; voided: Approval[] }
  | {
      ok: false;
      /** UNNAMED_APPROVAL: the run has a live approval the check never read (signed after it) */
      reason: "ILLEGAL" | "NOT_FOUND" | "STALE" | "UNNAMED_APPROVAL";
      current: string | null;
    };

/**
 * S3.6.4 step 3, a failed approval check: in ONE transaction, and only while the run is APPROVED and every live
 * approval of the run is one of `nonces`, voids those approvals (voided_at, the reason; one `approval.voided` ledger
 * entry) and moves the run APPROVED → IN_REVIEW, so both keys sign again what the database holds now. Otherwise it
 * writes nothing: a run another call moved to POSTING (its rows written under these approvals) or back to IN_REVIEW,
 * or one signed again since on approvals the check never read, stays as it is. It never voids an approval outside
 * the run's live set, whatever `nonces` names.
 */
export async function voidCheckedApprovals(
  db: DbOrTx,
  scope: WorkspaceScope,
  v: CheckedApprovalVoid,
  policy: TransitionPolicy = DEFAULT_POLICY,
): Promise<CheckedApprovalVoidResult> {
  if (!VOID_REASON.test(v.reason)) {
    throw new TypeError(
      "approvals.voidChecked: the reason is a code such as DIGEST_MISMATCH, never free text",
    );
  }
  if (!policy.run("APPROVED", "IN_REVIEW")) return { ok: false, reason: "ILLEGAL", current: "APPROVED" };
  const named = new Set(v.nonces);
  return withWorkspaceTx(db, scope, async (tx) => {
    const state = await lockRunState(tx, scope, v.runId);
    if (state === null) return { ok: false, reason: "NOT_FOUND", current: null };
    if (state !== "APPROVED") return { ok: false, reason: "STALE", current: state };
    const live = await tx
      .select({ id: approvals.id, nonce: approvals.nonce })
      .from(approvals)
      .where(
        and(
          eq(approvals.workspaceId, scope.workspaceId),
          eq(approvals.runId, v.runId),
          eq(approvals.decision, "SIGNED"),
          isNull(approvals.voidedAt),
        ),
      )
      .for("update");
    if (live.some((a) => a.nonce === null || !named.has(a.nonce))) {
      return { ok: false, reason: "UNNAMED_APPROVAL", current: state };
    }
    const voided =
      live.length === 0
        ? []
        : await tx
            .update(approvals)
            .set({ voidedAt: v.at ?? sql`now()`, voidReason: v.reason })
            .where(
              and(
                eq(approvals.workspaceId, scope.workspaceId),
                inArray(
                  approvals.id,
                  live.map((a) => a.id),
                ),
              ),
            )
            .returning();
    const res = await transitionRun(
      tx,
      scope,
      { id: v.runId, from: "APPROVED", to: "IN_REVIEW", cause: v.reason, provenance: v.provenance },
      policy,
    );
    // the run row is locked and APPROVED, and the policy allows the edge: nothing else can refuse it
    if (!res.ok) throw new Error(`approvals.voidChecked: APPROVED → IN_REVIEW failed (${res.reason})`);
    if (voided.length > 0) {
      await appendLedger(tx, scope, {
        kind: "approval.voided",
        runId: v.runId,
        payload: { runId: v.runId, approvalIds: voided.map((a) => a.id).sort(), reason: v.reason },
        ...(v.at ? { at: v.at } : {}),
      });
    }
    return { ok: true, row: res.row, event: res.event, voided };
  });
}
