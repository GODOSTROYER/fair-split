// Payouts v1 through WS-PPMONEY's `PayoutsService`, the only code that creates or cancels payouts (I6). This
// file is its persistence port over the database (`PayoutsRepository`, the port's documented contract) and its
// wiring: paypal-core's PayPalHttp (limiter, PayPal-Request-Id, call log, debug ids), the officer key registry
// (`device_keys` joined with the officers' roles, read fresh for every check), the kill switch read fresh before
// every POST, and the sandbox guards (C-21's US$400 cap and 40 live batches a day, Judge Mode's 8 items, known
// receivers only, the estimated sandbox balance kept above the US$10,000 floor).
//
// The port's compare-and-sets, each in ONE transaction that takes the workspace lock, then the run row FOR
// UPDATE, then the approvals it reads (so a concurrent signature, void, transition or post on the run waits):
//   - writeSubmitted (primary): APPROVED → POSTING only while every approval the service checked
//     (`approvalNonces`) is a live SIGNED approval of the run over this very batch digest; otherwise it writes
//     nothing and returns null. Rows already under the sender_batch_id are never overwritten: their mark is
//     returned and the service posts only if it carries its own digest. A judge run labelled replayed is never
//     written live (I8: thrown as QUEUED; money/rail.ts `replayStep` labels under the same workspace lock).
//   - voidApprovals: only while the run is APPROVED and every live approval is one it names: those voided, the
//     lines unlocked, `payout.refused` recorded, APPROVED → IN_REVIEW; otherwise nothing is written.
//   - markPosted / markRejected: only the rows that carry the digest that was posted.
// loadPosting / loadRun return every member line `{memberNo, lineSha256}` (WS-DATA's `memberLineHashes`, on and
// off rail), from which the service recomputes `linesDigest`, and the run's spent nonces.
//
// Why not WS-DATA's `beginPosting` / `voidCheckedApprovals`: they make the same compare-and-sets (same locks, same
// conditions), but their transitions append `run.state` events in WS-DATA's shape ({id, from, to, cause,
// version}), which is not IC-01's strict `run.state` payload ({runId, from, to, cause: {code, ref}}): every SSE
// client and the smoke would reject them. These use the runs slice's `moveRun` (IC-01 events) instead; switch
// to WS-DATA's once its transitions emit IC-01 payloads (money/posting-cas.pg.test.ts pins the behaviour).
import {
  type ApprovalPayload,
  ApprovalPayload as ApprovalPayloadSchema,
  type OfficerKey,
  type PayoutBatchStatus,
  type PayRunState,
  type SignedApproval,
  TASKS,
} from "@fairsplit/contracts";
import {
  type Actor,
  memberLineHashes,
  schema,
  type Tx,
  type WorkspaceScope,
  withWorkspaceTx,
} from "@fairsplit/db";
import { enqueue } from "@fairsplit/outbox";
import {
  type BatchOutcome,
  type CancelIntent,
  type PayoutItemRow,
  type PayoutLimits,
  type PayoutRunFacts,
  type PayoutsRepository,
  PayoutsService,
  type PostingSnapshot,
  type RefusalCode,
  type SubmittedMark,
} from "@fairsplit/paypal-payouts";
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { runHolds } from "../approvals/batch.js";
import { officerRegistry } from "../approvals/registry.js";
import {
  countResumedSend,
  isJudgeWorkspace,
  JUDGE_QUOTA,
  latestBalanceReading,
  liveBatchesInLast24h,
  liveSpend,
  PAYOUT_SPEND_LOCK,
  recordBatchPosted,
} from "../judge/quota.js";
import type { AppDeps } from "../lib/context.js";
import { toInt } from "../runs/codes.js";
import { ACTORS, factLedger, noteSha256, proofLedger } from "../runs/events.js";
import { haltRun, readKill, unlockLines, voidLiveApprovals } from "../runs/flags.js";
import { canonicalOf, cardById, cosignRule, lockRun, seasonById } from "../runs/load.js";
import { cause, moveLine, moveRun, type RunRow } from "../runs/machine.js";
import { SETTLE_GET_DELAYS_MS } from "../webhooks/apply.js";
import { PayPalStepError } from "./errors.js";
import { applyItem } from "./items.js";
import { receiverDirectory } from "./receivers.js";

type Deps = Pick<AppDeps, "db" | "env" | "paypal" | "clock" | "logger">;

/** C-21: US$400 per batch on the sandbox rail. */
export const MAX_BATCH_TOTAL_CENTS = 40_000n;
/** Judge Mode posts at most 8 items. */
export const JUDGE_MAX_ITEMS = 8;
/** C-21: at most 40 live batches in any rolling 24 h (the judge lane's lower quotas sit above this ceiling). */
export const MAX_POSTS_PER_24H = JUDGE_QUOTA.dailyMax;
/** The plan's replay floor: a batch goes out only if the estimated sandbox balance stays at or above it. */
export const MIN_BALANCE_CENTS = BigInt(JUDGE_QUOTA.replayFloorCents);
/** `approvals.void_reason` of a re-route's approval: stored spent at once, it authorises only its own batch. */
export const REROUTE_VOID_REASON = "reroute";
/** A public key that matches no registry row: an approval whose key left the registry never verifies. */
const NO_KEY = "0".repeat(64);

function parsePayload(jcs: string | null): ApprovalPayload | null {
  if (!jcs) return null;
  try {
    const r = ApprovalPayloadSchema.safeParse(JSON.parse(jcs));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/**
 * A live approval row exactly as signed. The public key is the registry's for its key ID; a key that left the
 * registry gets one no row holds, so the service refuses it as an unknown signer and still names it in its
 * void (every live approval must be named for the void's compare-and-set).
 */
function storedApproval(
  row: typeof schema.approvals.$inferSelect,
  registry: readonly OfficerKey[],
): SignedApproval | null {
  const payload = parsePayload(row.payloadJcs);
  if (!payload || !row.keyId || !row.signature) return null;
  return {
    role: payload.role,
    keyId: row.keyId,
    publicKeyHex: registry.find((k) => k.keyId === row.keyId)?.publicKeyHex ?? NO_KEY,
    payload,
    signatureHex: row.signature,
  };
}

const BATCH_STATUS: Readonly<Record<string, PayoutBatchStatus>> = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  SUCCESS: "SUCCESS",
  DENIED: "DENIED",
  CANCELED: "CANCELED",
  CANCELLED: "CANCELED",
};

/** Rows under the sender_batch_id carry another digest: not the batch that was posted (HALT and alert). */
const notThisBatch = (senderBatchId: string) =>
  new PayPalStepError(
    "INVALID_TRANSITION",
    `The rows under ${senderBatchId} are not the batch that was posted; nothing was changed.`,
    { transient: false },
  );

/** `judge.step.replayed` (money/rail.ts): a judge run one of whose PayPal steps was replayed replays to the end. */
const STEP_REPLAYED = "judge.step.replayed";

/** Whether the run is labelled replayed (inside the caller's workspace-locked transaction). */
async function labelledReplayed(tx: Tx, workspaceId: string, runId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.ledgerEntries.id })
    .from(schema.ledgerEntries)
    .where(
      and(
        eq(schema.ledgerEntries.workspaceId, workspaceId),
        eq(schema.ledgerEntries.runId, runId),
        eq(schema.ledgerEntries.kind, STEP_REPLAYED),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** What a refused attempt checked, for the send-back that undoes only what it checked. */
export interface CheckedRefusal {
  runId: string;
  /** The nonces of the approvals the refused attempt checked (approvals.nonce is UNIQUE). */
  nonces: readonly string[];
  code: RefusalCode;
  reason: string;
  senderBatchId: string | null;
  at: Date;
}

/**
 * S3.6.4 step 3 as a compare-and-set (the port's `voidApprovals` contract): in ONE transaction, and only while
 * the run is APPROVED and every live approval of the run is one of `nonces`, void them, unlock the lines, record
 * `payout.refused` and move the run APPROVED → IN_REVIEW ("The batch changed after it was signed. Nothing was
 * sent."), so both keys sign again what the database holds now. Otherwise nothing is written: a run another
 * executor moved to POSTING (its rows written under these approvals) or back to IN_REVIEW, or one signed again
 * since on approvals this attempt never checked, is left as it is. Returns the new state, or null when nothing
 * was written.
 */
export async function sendBackChecked(
  deps: Pick<Deps, "db">,
  scope: WorkspaceScope,
  r: CheckedRefusal,
): Promise<PayRunState | null> {
  return withWorkspaceTx(deps.db, scope, async (tx: Tx) => {
    const run = await lockRun(tx, scope, r.runId);
    if (run.state !== "APPROVED") return null;
    const named = new Set(r.nonces);
    const live = await tx
      .select({ id: schema.approvals.id, nonce: schema.approvals.nonce })
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.workspaceId, scope.workspaceId),
          eq(schema.approvals.runId, r.runId),
          eq(schema.approvals.decision, "SIGNED"),
          isNull(schema.approvals.voidedAt),
        ),
      )
      .for("update");
    if (live.some((a) => a.nonce === null || !named.has(a.nonce))) return null;
    // Under the run lock with every live approval locked and named: voiding the live set voids exactly these.
    await voidLiveApprovals(tx, scope, run.id, r.at, `refused:${r.code}`);
    await unlockLines(tx, scope, run.id, "SEND_BACK");
    await recordRefusal(tx, scope, r);
    const moved = await moveRun(tx, scope, {
      id: run.id,
      from: "APPROVED",
      to: "IN_REVIEW",
      version: run.version,
      cause: cause("SEND_BACK", r.code),
      provenance: "live",
      actor: ACTORS.outbox,
    });
    return moved.state as PayRunState;
  });
}

/** `payout.refused` in the ledger: why nothing was sent (the reason as a hash, S3.12). */
async function recordRefusal(
  tx: Tx,
  scope: WorkspaceScope,
  r: Pick<CheckedRefusal, "runId" | "code" | "reason" | "senderBatchId" | "at">,
): Promise<void> {
  await factLedger(
    tx,
    scope,
    "payout.refused",
    {
      runId: r.runId,
      code: r.code,
      senderBatchId: r.senderBatchId,
      reasonSha256: noteSha256(r.reason),
    },
    { runId: r.runId, at: r.at, actor: ACTORS.outbox },
  );
}

/** The repository the service is wired with, plus what its last read handed to the service's check. */
export interface AppPayoutsRepository extends PayoutsRepository {
  /** The nonces of the approvals `loadPosting(runId)` last returned (what the service checked), or null. */
  checkedNonces(runId: string): readonly string[] | null;
}

/** The repository over the database, bound to one workspace. */
export function payoutsRepository(deps: Deps, scope: WorkspaceScope): AppPayoutsRepository {
  const ws = scope.workspaceId;
  const receivers = receiverDirectory(deps.env.paypal);
  const provenance = deps.paypal.provenance;
  const db = deps.db;
  const checked = new Map<string, string[]>();
  /**
   * I8, for two executors of one run that decided differently (money/rail.ts): rows are only ever resumed, written
   * over, marked posted or marked rejected on the rail they were written on. Checked where the rows are READ for the
   * service (`loadPosting`, the re-route's `findSupersedingItem`) and again at `writeSubmitted`, all before the
   * service's POST, and at the marks besides. On the replay rail, rows written live (another executor wrote them since
   * the rail was decided) wait to be posted live with the same ids: the step is re-queued and its next attempt resumes
   * them live. On a live rail, rows written as a replay are never POSTed (a real batch PayPal would hold, recorded as a
   * replay and counted by neither C-21 nor the spend): the live executor sends nothing, and the run's next attempt
   * replays to the end.
   */
  const refuseOtherRailRows = (rowProvenance: string, sbid: string) => {
    if ((provenance === "replay") === (rowProvenance === "replay")) return;
    throw new PayPalStepError(
      "QUEUED",
      provenance === "replay"
        ? `The batch ${sbid} is written live: it is posted live with the same ids, never replayed.`
        : `The batch ${sbid} is written as a replay: it is never posted live.`,
      { transient: true, retryAfterMs: 3_000 },
    );
  };

  const facts = async (runId: string): Promise<{ run: RunRow; facts: PayoutRunFacts } | null> => {
    const [run] = await db
      .select()
      .from(schema.payRuns)
      .where(and(eq(schema.payRuns.workspaceId, ws), eq(schema.payRuns.id, runId)));
    if (!run) return null;
    const season = await seasonById(db, scope, run.seasonId);
    const card = await cardById(db, scope, run.rateCardId);
    // Every member line, on and off rail (WS-DATA's read): a null hash is handed on as "", which the service
    // refuses as an invalid batch with nothing voided.
    const memberLines = (await memberLineHashes(db, scope, runId)).map((l) => ({
      memberNo: l.memberNo,
      lineSha256: l.lineSha256 ?? "",
    }));
    // Spent: every voided approval's nonce, except a re-route's, which is stored spent at once only to keep
    // the run's one-live-signature-per-role slot free; it authorises nothing but its own one-item batch, whose
    // ids PayPal dedupes and whose returned item UNIQUE supersedes_item_id lets be re-routed once.
    const spent = await db
      .select({ nonce: schema.approvals.nonce })
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.workspaceId, ws),
          eq(schema.approvals.runId, runId),
          isNotNull(schema.approvals.voidedAt),
          isNotNull(schema.approvals.nonce),
          or(isNull(schema.approvals.voidReason), ne(schema.approvals.voidReason, REROUTE_VOID_REASON)),
        ),
      );
    return {
      run,
      facts: {
        runId: run.id,
        runSeq: run.runSeq,
        seasonCode: season.label,
        seasonId: run.seasonId,
        rateCardSha256: run.rateCardSha256,
        cosign: cosignRule(season, canonicalOf(card)),
        memberLines,
        spentNonces: spent.map((s) => s.nonce as string),
      },
    };
  };

  return {
    checkedNonces: (runId) => checked.get(runId) ?? null,

    async loadPosting(runId): Promise<PostingSnapshot | null> {
      const f = await facts(runId);
      if (!f || (f.run.state !== "APPROVED" && f.run.state !== "POSTING")) return null;
      const lines = await db
        .select({ line: schema.memberLines, memberNo: schema.members.memberNo })
        .from(schema.memberLines)
        .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
        .where(
          and(
            eq(schema.memberLines.workspaceId, ws),
            eq(schema.memberLines.runId, runId),
            eq(schema.memberLines.rail, "ON"),
            inArray(schema.memberLines.state, ["LOCKED", "SUBMITTED"]),
          ),
        );
      const registry = await officerRegistry(db, scope);
      const approvalRows = await db
        .select()
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.workspaceId, ws),
            eq(schema.approvals.runId, runId),
            eq(schema.approvals.decision, "SIGNED"),
            isNull(schema.approvals.voidedAt),
          ),
        );
      const approvals = approvalRows
        .map((a) => storedApproval(a, registry))
        .filter((a): a is SignedApproval => a !== null);
      const holds = await db
        .select({ kind: schema.holds.kind, resolution: schema.holds.resolution })
        .from(schema.holds)
        .where(and(eq(schema.holds.workspaceId, ws), eq(schema.holds.runId, runId)));
      const [batch] = await db
        .select()
        .from(schema.payoutBatches)
        .where(
          and(
            eq(schema.payoutBatches.workspaceId, ws),
            eq(schema.payoutBatches.runId, runId),
            eq(schema.payoutBatches.kind, "primary"),
          ),
        );
      // I8: rows written on the other rail are never resumed on this one: refused before the service can POST them
      if (batch) refuseOtherRailRows(batch.provenance, batch.senderBatchId);
      checked.set(
        runId,
        approvals.map((a) => a.payload.nonce),
      );
      return {
        ...f.facts,
        // Every LOCKED (or SUBMITTED) on-rail line exactly as stored, never filtered: a line whose receiver
        // has since disappeared reaches the service's line check and refuses the batch by member number
        // (INVALID_BATCH), instead of silently shrinking the batch the officers signed (S3.6.4 step 4).
        lines: lines.map(({ line, memberNo }) => ({
          lineId: line.id,
          memberNo,
          receiver: receivers.receiverFor(memberNo) ?? "",
          amountCents: BigInt(toInt(line.netCents)),
          currency: "USD" as const,
        })),
        approvals,
        holds: runHolds(holds),
        submitted: batch ? { at: batch.submittedAt.toISOString(), batchSha256: batch.batchSha256 } : null,
      };
    },

    async loadRun(runId) {
      return (await facts(runId))?.facts ?? null;
    },

    async writeSubmitted(batch): Promise<SubmittedMark | null> {
      return withWorkspaceTx(db, scope, async (tx) => {
        const markOf = (row: { submittedAt: Date; batchSha256: string }): SubmittedMark => ({
          at: row.submittedAt.toISOString(),
          batchSha256: row.batchSha256,
        });
        // The rows under a sender_batch_id are the batch (I4 at the write): never overwritten or merged. A
        // resumed post finds its own; a re-route racing another of the same item finds the winner's digest.
        const stored = async () => {
          const [row] = await tx
            .select({
              submittedAt: schema.payoutBatches.submittedAt,
              batchSha256: schema.payoutBatches.batchSha256,
              provenance: schema.payoutBatches.provenance,
            })
            .from(schema.payoutBatches)
            .where(eq(schema.payoutBatches.senderBatchId, batch.senderBatchId));
          // I8: rows written on the other rail (live, or as a replay) are never resumed on this one
          if (row) refuseOtherRailRows(row.provenance, batch.senderBatchId);
          return row;
        };
        const before = await stored();
        if (before) return markOf(before);
        const run = await lockRun(tx, scope, batch.runId);
        // Taken under the run lock: another writer of these ids committed while this one waited for it.
        const raced = await stored();
        if (raced) return markOf(raced);
        if (
          batch.kind === "primary" &&
          provenance !== "replay" &&
          (await labelledReplayed(tx, ws, batch.runId))
        ) {
          // I8: a run labelled replayed (money/rail.ts `replayStep`, under this workspace lock) replays to the end. A
          // live executor that decided before the label never writes its rows: it waits, and its next attempt replays.
          throw new PayPalStepError(
            "QUEUED",
            `The run of ${batch.senderBatchId} replays: its batch is never written live.`,
            { transient: true, retryAfterMs: 3_000 },
          );
        }
        const at = new Date(batch.at);
        if (batch.kind === "reroute") {
          // I3 at the write: a re-route pays a line its own cancel RETURNED, and only while it still is (under the
          // workspace lock and the line's row lock, the same locks "Pay in cash" takes): a line moved to cash since
          // the task looked is never paid through PayPal as well. Nothing is written; the service refuses.
          for (const item of batch.items) {
            const [line] = await tx
              .select({ state: schema.memberLines.state })
              .from(schema.memberLines)
              .where(and(eq(schema.memberLines.workspaceId, ws), eq(schema.memberLines.id, item.lineId)))
              .for("update");
            if (line?.state !== "RETURNED") return null;
          }
        }
        if (batch.kind === "primary") {
          // APPROVED → POSTING (S3.6.4 step 5), compare-and-set on the run's state AND on the approvals the
          // service checked: each a live SIGNED approval of this run over this very digest. A check voided
          // them since (and both keys signed again), or the run moved on: nothing is written, nothing posted.
          const nonces = [...new Set(batch.approvalNonces)];
          if (run.state !== "APPROVED" || nonces.length === 0) return null;
          const named = await tx
            .select({ id: schema.approvals.id })
            .from(schema.approvals)
            .where(
              and(
                eq(schema.approvals.workspaceId, ws),
                eq(schema.approvals.runId, batch.runId),
                eq(schema.approvals.decision, "SIGNED"),
                isNull(schema.approvals.voidedAt),
                eq(schema.approvals.batchSha256, batch.batchSha256),
                inArray(schema.approvals.nonce, nonces),
              ),
            )
            .for("share");
          if (named.length !== nonces.length) return null;
          await moveRun(tx, scope, {
            id: run.id,
            from: "APPROVED",
            to: "POSTING",
            version: run.version,
            cause: cause("POST", batch.senderBatchId),
            provenance,
            actor: ACTORS.outbox,
            patch: { batchSha256: batch.batchSha256, senderBatchId: batch.senderBatchId },
          });
        }
        const [row] = await tx
          .insert(schema.payoutBatches)
          .values({
            workspaceId: ws,
            runId: batch.runId,
            senderBatchId: batch.senderBatchId,
            requestId: batch.requestId,
            batchSha256: batch.batchSha256,
            kind: batch.kind,
            status: "SUBMITTED",
            itemCount: batch.items.length,
            totalCents: batch.totalCents,
            currency: "USD",
            submittedAt: at,
            provenance,
          })
          .returning({ id: schema.payoutBatches.id });
        if (!row) throw new Error("payout batch insert returned no row");
        for (const item of batch.items) {
          let supersedes: string | null = null;
          if (item.supersedesItemId) {
            const [old] = await tx
              .select({ id: schema.payoutItems.id })
              .from(schema.payoutItems)
              .where(
                and(
                  eq(schema.payoutItems.workspaceId, ws),
                  eq(schema.payoutItems.payoutItemId, item.supersedesItemId),
                ),
              );
            supersedes = old?.id ?? null;
          }
          // UNIQUE supersedes_item_id: a second re-route of one returned item fails the whole write.
          await tx.insert(schema.payoutItems).values({
            workspaceId: ws,
            batchId: row.id,
            lineId: item.lineId,
            senderItemId: item.senderItemId,
            receiver: item.receiver,
            amountCents: item.amountCents,
            currency: "USD",
            status: "SUBMITTED",
            statusRank: 0,
            supersedesItemId: supersedes,
            provenance,
          });
          const [line] = await tx
            .select({ state: schema.memberLines.state, version: schema.memberLines.version })
            .from(schema.memberLines)
            .where(and(eq(schema.memberLines.workspaceId, ws), eq(schema.memberLines.id, item.lineId)));
          let from = line?.state;
          let version = line?.version ?? 0;
          if (line && from === "RETURNED" && batch.kind === "reroute") {
            // A re-route attempt starts here (fsm: RETURNED → REROUTED → SUBMITTED, attempt n + 1).
            const moved = await moveLine(tx, scope, {
              id: item.lineId,
              memberNo: item.memberNo,
              runId: batch.runId,
              from: "RETURNED",
              to: "REROUTED",
              version,
              cause: cause("REROUTE", item.supersedesItemId),
              provenance: "live",
              actor: ACTORS.outbox,
            });
            from = "REROUTED";
            version = moved.version;
          }
          if (line && (from === "LOCKED" || from === "REROUTED")) {
            await moveLine(tx, scope, {
              id: item.lineId,
              memberNo: item.memberNo,
              runId: batch.runId,
              from,
              to: "SUBMITTED",
              version,
              cause: cause("POST", item.senderItemId),
              provenance,
              actor: ACTORS.outbox,
            });
          }
        }
        if (batch.kind === "primary") {
          // Cash lines are due at the bodega once the batch goes out ("Andam sa bodega").
          const cash = await tx
            .select({
              id: schema.memberLines.id,
              version: schema.memberLines.version,
              memberNo: schema.members.memberNo,
            })
            .from(schema.memberLines)
            .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
            .where(
              and(
                eq(schema.memberLines.workspaceId, ws),
                eq(schema.memberLines.runId, batch.runId),
                eq(schema.memberLines.rail, "OFF"),
                eq(schema.memberLines.state, "READY"),
              ),
            );
          for (const l of cash) {
            await moveLine(tx, scope, {
              id: l.id,
              memberNo: l.memberNo,
              runId: batch.runId,
              from: "READY",
              to: "OFF_RAIL_DUE",
              version: l.version,
              cause: cause("CASH_DUE", batch.senderBatchId),
              provenance: "live",
              actor: ACTORS.outbox,
            });
          }
        }
        await proofLedger(
          tx,
          scope,
          "payout.submitting",
          {
            runId: batch.runId,
            senderBatchId: batch.senderBatchId,
            batchSha256: batch.batchSha256,
            itemCount: batch.items.length,
            totalCents: Number(batch.totalCents),
            note: batch.note,
          },
          { runId: batch.runId, at, actor: ACTORS.outbox },
        );
        return { at: at.toISOString(), batchSha256: batch.batchSha256 };
      });
    },

    async markPosted(posted) {
      await withWorkspaceTx(db, scope, async (tx) => {
        const [batch] = await tx
          .select()
          .from(schema.payoutBatches)
          .where(
            and(
              eq(schema.payoutBatches.workspaceId, ws),
              eq(schema.payoutBatches.senderBatchId, posted.senderBatchId),
            ),
          )
          .for("update");
        if (!batch) throw new Error(`no batch ${posted.senderBatchId}`);
        // I8: a replay id never lands on rows written live, nor a PayPal id on rows written as a replay
        refuseOtherRailRows(batch.provenance, posted.senderBatchId);
        // Compare-and-set on the digest posted: other rows under these ids are not this batch.
        if (batch.batchSha256 !== posted.batchSha256) throw notThisBatch(posted.senderBatchId);
        if (batch.paypalBatchId !== null) {
          // Idempotent once POSTED; PayPal naming another batch for the same rows is a HALT.
          if (batch.paypalBatchId === posted.payoutBatchId) return;
          throw notThisBatch(posted.senderBatchId);
        }
        await tx
          .update(schema.payoutBatches)
          .set({
            paypalBatchId: posted.payoutBatchId,
            status: BATCH_STATUS[posted.batchStatus ?? ""] ?? "PENDING",
            adopted: posted.outcome === "adopted",
          })
          .where(eq(schema.payoutBatches.id, batch.id));
        // when PayPal named it: the spend dates rows written before a balance reading by this POST (judge/quota.ts)
        if (provenance !== "replay") {
          await recordBatchPosted(tx, { batchId: batch.id, rail: deps.paypal.label, at: deps.clock.now() });
        }
        const items = await tx
          .select()
          .from(schema.payoutItems)
          .where(and(eq(schema.payoutItems.workspaceId, ws), eq(schema.payoutItems.batchId, batch.id)));
        for (const item of items) {
          await applyItem(tx, scope, item, {
            at: deps.clock.now(),
            status: "PENDING",
            source: "post_response",
            eventId: null,
            provenance,
            actor: ACTORS.paypalPost,
          });
        }
        const run = await lockRun(tx, scope, batch.runId);
        if (batch.kind === "primary" && run.state === "POSTING") {
          await moveRun(tx, scope, {
            id: run.id,
            from: "POSTING",
            to: "POSTED",
            version: run.version,
            cause: cause(posted.outcome === "adopted" ? "ADOPTED" : "ACCEPTED", posted.payoutBatchId),
            provenance,
            actor: ACTORS.paypalPost,
          });
        }
        const [wsRow] = await tx
          .select({ kind: schema.workspaces.kind })
          .from(schema.workspaces)
          .where(eq(schema.workspaces.id, ws));
        const delay = wsRow?.kind === "judge" ? SETTLE_GET_DELAYS_MS.judge : SETTLE_GET_DELAYS_MS.standard;
        const args = { batchId: batch.id, n: 1 };
        await enqueue(tx, "settleBatch", args, TASKS.settleBatch.dedupeKey(args), {
          workspaceId: ws,
          runAfter: new Date(deps.clock.now().getTime() + delay),
        });
      });
    },

    async markRejected(rejected) {
      await withWorkspaceTx(db, scope, async (tx) => {
        const [batch] = await tx
          .select()
          .from(schema.payoutBatches)
          .where(
            and(
              eq(schema.payoutBatches.workspaceId, ws),
              eq(schema.payoutBatches.senderBatchId, rejected.senderBatchId),
            ),
          )
          .for("update");
        if (!batch) return;
        refuseOtherRailRows(batch.provenance, rejected.senderBatchId);
        // Compare-and-set on the digest posted, as markPosted.
        if (batch.batchSha256 !== rejected.batchSha256) throw notThisBatch(rejected.senderBatchId);
        if (batch.status === "DENIED") return;
        await tx
          .update(schema.payoutBatches)
          .set({ status: "DENIED" })
          .where(eq(schema.payoutBatches.id, batch.id));
        const items = await tx
          .select({ lineId: schema.payoutItems.lineId, senderItemId: schema.payoutItems.senderItemId })
          .from(schema.payoutItems)
          .where(eq(schema.payoutItems.batchId, batch.id));
        for (const item of items) {
          const [line] = await tx
            .select({ line: schema.memberLines, memberNo: schema.members.memberNo })
            .from(schema.memberLines)
            .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
            .where(eq(schema.memberLines.id, item.lineId));
          if (line?.line.state === "SUBMITTED") {
            await moveLine(tx, scope, {
              id: line.line.id,
              memberNo: line.memberNo,
              runId: line.line.runId,
              from: "SUBMITTED",
              to: "NEEDS_ACTION",
              version: line.line.version,
              cause: cause("REJECTED", rejected.name),
              provenance,
              actor: ACTORS.paypalPost,
            });
          }
        }
        const run = await lockRun(tx, scope, batch.runId);
        if (batch.kind === "primary" && run.state === "POSTING") {
          await moveRun(tx, scope, {
            id: run.id,
            from: "POSTING",
            to: "DENIED",
            version: run.version,
            cause: cause("REJECTED", rejected.name),
            provenance,
            actor: ACTORS.paypalPost,
          });
        }
        await factLedger(
          tx,
          scope,
          "payout.rejected",
          {
            runId: batch.runId,
            senderBatchId: rejected.senderBatchId,
            status: rejected.status,
            name: rejected.name,
          },
          { runId: batch.runId, at: deps.clock.now(), actor: ACTORS.paypalPost },
        );
      });
    },

    async voidApprovals(v) {
      await sendBackChecked(deps, scope, {
        runId: v.runId,
        nonces: v.nonces,
        code: v.code,
        reason: v.reason,
        senderBatchId: null,
        at: new Date(v.at),
      });
    },

    async findItem(payoutItemId): Promise<PayoutItemRow | null> {
      const [row] = await db
        .select({
          item: schema.payoutItems,
          runId: schema.memberLines.runId,
          memberNo: schema.members.memberNo,
        })
        .from(schema.payoutItems)
        .innerJoin(schema.memberLines, eq(schema.memberLines.id, schema.payoutItems.lineId))
        .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
        .where(
          and(eq(schema.payoutItems.workspaceId, ws), eq(schema.payoutItems.payoutItemId, payoutItemId)),
        );
      if (!row?.item.payoutItemId) return null;
      return {
        payoutItemId: row.item.payoutItemId,
        senderItemId: row.item.senderItemId,
        runId: row.runId,
        lineId: row.item.lineId,
        memberNo: row.memberNo,
        receiver: row.item.receiver,
        amountCents: row.item.amountCents,
        status: row.item.status,
        cancelRequestedAt: row.item.cancelRequestedAt ? row.item.cancelRequestedAt.toISOString() : null,
        cancelIntent: row.item.cancelIntent,
      };
    },

    async findSupersedingItem(payoutItemId) {
      const [old] = await db
        .select({ id: schema.payoutItems.id })
        .from(schema.payoutItems)
        .where(
          and(eq(schema.payoutItems.workspaceId, ws), eq(schema.payoutItems.payoutItemId, payoutItemId)),
        );
      if (!old) return null;
      const [row] = await db
        .select({ item: schema.payoutItems, batch: schema.payoutBatches })
        .from(schema.payoutItems)
        .innerJoin(schema.payoutBatches, eq(schema.payoutBatches.id, schema.payoutItems.batchId))
        .where(and(eq(schema.payoutItems.workspaceId, ws), eq(schema.payoutItems.supersedesItemId, old.id)));
      if (!row) return null;
      // I8: a re-route written on the other rail is never resumed on this one (refused before any POST)
      refuseOtherRailRows(row.batch.provenance, row.batch.senderBatchId);
      return {
        senderBatchId: row.batch.senderBatchId,
        senderItemId: row.item.senderItemId,
        receiver: row.item.receiver,
        amountCents: row.item.amountCents,
        batchState: row.batch.paypalBatchId
          ? "POSTED"
          : row.batch.status === "DENIED"
            ? "REJECTED"
            : "SUBMITTED",
        submitted: { at: row.batch.submittedAt.toISOString(), batchSha256: row.batch.batchSha256 },
      };
    },

    async markCancelRequested(request) {
      await withWorkspaceTx(db, scope, async (tx) => {
        const [item] = await tx
          .select()
          .from(schema.payoutItems)
          .where(
            and(
              eq(schema.payoutItems.workspaceId, ws),
              eq(schema.payoutItems.payoutItemId, request.payoutItemId),
            ),
          )
          .for("update");
        if (!item || item.cancelRequestedAt) return;
        await tx
          .update(schema.payoutItems)
          .set({ cancelRequestedAt: new Date(request.requestedAt), cancelIntent: request.intent })
          .where(eq(schema.payoutItems.id, item.id));
        const [line] = await tx
          .select({ runId: schema.memberLines.runId })
          .from(schema.memberLines)
          .where(eq(schema.memberLines.id, item.lineId));
        await proofLedger(
          tx,
          scope,
          "payout.cancel",
          {
            senderItemId: item.senderItemId,
            payoutItemId: request.payoutItemId,
            afterCancel: request.intent,
          },
          {
            runId: line?.runId ?? null,
            at: new Date(request.requestedAt),
            actor: { kind: request.by.kind, id: request.by.id, impersonatedBy: request.by.impersonatedBy },
          },
        );
      });
    },

    async applyItemStatus(update) {
      await withWorkspaceTx(db, scope, async (tx) => {
        const [item] = await tx
          .select()
          .from(schema.payoutItems)
          .where(
            and(
              eq(schema.payoutItems.workspaceId, ws),
              eq(schema.payoutItems.payoutItemId, update.payoutItemId),
            ),
          )
          .for("update");
        if (!item) return;
        const status = update.transactionStatus.toUpperCase();
        const known = [
          "PENDING",
          "ONHOLD",
          "UNCLAIMED",
          "RETURNED",
          "FAILED",
          "BLOCKED",
          "SUCCESS",
          "REFUNDED",
          "REVERSED",
        ];
        if (!known.includes(status)) return;
        await applyItem(tx, scope, item, {
          at: deps.clock.now(),
          status: status as Parameters<typeof applyItem>[3]["status"],
          source: update.source === "cancel" ? "cancel" : "status_check",
          eventId: null,
          provenance,
          actor: ACTORS.paypalGet,
          transactionStatus: update.transactionStatus,
        });
      });
    },
  };
}

/**
 * C-21's count (judge/quota.ts `liveBatchesInLast24h`): the live batches on this rail, every workspace, each once,
 * written in the 24 h before `now` or sent since then: a judge primary batch from any live reservation of its run in
 * the window (a POST resumed later goes out under a fresh slot dated then), any batch from a `batch_sent` mark in it
 * (a re-route resumed later, `countResumedSend`).
 */
export async function postsInLast24h(deps: Pick<Deps, "db" | "paypal">, now: Date): Promise<number> {
  return liveBatchesInLast24h(deps.db, deps.paypal.provenance, now);
}

/** How long a written re-route that C-21 holds back waits before it asks again (a slot frees as the 24 h moves). */
const C21_RESUME_WAIT_MS = 15 * 60_000;

/**
 * C-21 at a written batch's resumed POST (judge/quota.ts `countResumedSend`, under the spend lock): goes out only
 * while the other live batches of the 24 h are fewer than 40, and is counted from this POST; otherwise thrown as
 * QUEUED (transient), so the task re-queues itself: never replayed, nothing sent.
 */
async function holdToC21(deps: Pick<Deps, "db" | "paypal" | "clock">, batchId: string, what: string) {
  const counted = await countResumedSend(deps.db, {
    provenance: deps.paypal.provenance,
    batchId,
    now: deps.clock.now(),
  });
  if (counted.ok) return;
  if ("busy" in counted) {
    throw new PayPalStepError(
      "QUEUED",
      `Another post is checking the daily cap; the written ${what} waits.`,
      {
        transient: true,
        retryAfterMs: 5_000,
      },
    );
  }
  throw new PayPalStepError(
    "QUEUED",
    `${counted.count} live batches in the last 24 h (C-21's cap is ${MAX_POSTS_PER_24H}): the written ${what} waits to be posted with the same ids.`,
    { transient: true, retryAfterMs: C21_RESUME_WAIT_MS },
  );
}

/**
 * C-21 at a re-route's resumed POST (the service checks C-21 only at a batch's first write): a re-route whose rows are
 * written on this rail and that PayPal has not named yet (its POST paced or unanswered) goes out more than a lane
 * lease after it was last counted only while the other live batches of the 24 h are fewer than 40, and is counted from
 * that POST (`holdToC21`). Otherwise it waits. Where C-21 binds: the sandbox rail, live.
 */
export async function guardResumedReroute(
  deps: Pick<Deps, "db" | "paypal" | "clock">,
  scope: WorkspaceScope,
  o: { lineId: string; supersedesItemId: string },
): Promise<void> {
  if (deps.paypal.mode !== "sandbox" || deps.paypal.provenance === "replay") return;
  const [written] = (await deps.db.execute(sql`
    select pb.id::text as id from payout_items newer
      join payout_items old on old.id = newer.supersedes_item_id and old.workspace_id = newer.workspace_id
      join payout_batches pb on pb.id = newer.batch_id and pb.workspace_id = newer.workspace_id
     where newer.workspace_id = ${scope.workspaceId} and newer.line_id = ${o.lineId}
       and old.payout_item_id = ${o.supersedesItemId}
       and pb.kind = 'reroute' and pb.provenance = ${deps.paypal.provenance}
       and pb.status = 'SUBMITTED' and pb.paypal_batch_id is null
     limit 1`)) as unknown as { id: string }[];
  if (!written) return;
  await holdToC21(deps, written.id, "re-route");
}

/**
 * C-21 at a resumed primary POST outside Judge Mode (a co-op's own batch, written and then stalled: PayPal's pacing,
 * an outage, a kill switch held for a day). The service checks C-21 only at a batch's first write, and no judge slot
 * counts this POST, so a written primary batch PayPal has not named yet goes out more than a lane lease after it was
 * last counted only while the other live batches of the 24 h are fewer than 40, and is counted from that POST
 * (`holdToC21`), as a re-route is. Otherwise it waits. A judge run's primary batch is counted through its run's fresh
 * slot instead (money/rail.ts, judge/quota.ts `reserveLivePost`). Where C-21 binds: the sandbox rail, live.
 */
export async function guardResumedPrimary(
  deps: Pick<Deps, "db" | "paypal" | "clock">,
  scope: WorkspaceScope,
  runId: string,
): Promise<void> {
  if (deps.paypal.mode !== "sandbox" || deps.paypal.provenance === "replay") return;
  if (await isJudgeWorkspace(deps.db, scope.workspaceId)) return;
  const [written] = (await deps.db.execute(sql`
    select pb.id::text as id from payout_batches pb
     where pb.workspace_id = ${scope.workspaceId} and pb.run_id = ${runId}
       and pb.kind = 'primary' and pb.provenance = ${deps.paypal.provenance}
       and pb.status = 'SUBMITTED' and pb.paypal_batch_id is null
     limit 1`)) as unknown as { id: string }[];
  if (!written) return;
  await holdToC21(deps, written.id, "batch");
}

/**
 * The estimated balance the service's hard guard reads (plan: "the latest searchBalances reading minus ledger
 * payouts since; otherwise S1's observed balance seeds it"): the latest reading on this rail, whatever its age,
 * minus every batch posted on this rail since; before any reading, register §8's opening US$100,000 minus every
 * batch ever posted on this rail. The judge lane's own estimate is stricter (a sandbox reading must be fresh, else
 * the run replays) and is decided before `executeApproved` is called. The hourly purge keeps every judge batch this
 * reads (written or named by PayPal at or after the latest reading, whatever its age: judge/quota.ts
 * `batchesStillCounted`), so a purged workspace never raises this estimate.
 */
export async function estimatedBalanceCents(deps: Pick<Deps, "db" | "paypal">): Promise<bigint> {
  const rail = deps.paypal.label;
  const reading = await latestBalanceReading(deps.db, rail);
  const spent = await liveSpend(deps.db, rail, reading?.asOf ?? null);
  return BigInt(reading ? reading.availableCents : JUDGE_QUOTA.simulatorOpeningCents) - BigInt(spent);
}

/**
 * The two guards that change by the hour (S3.6.4 step 4): C-21's live batches per rolling 24 h and the estimated
 * balance kept above the US$10,000 floor. They protect the one shared sandbox business account, so they bind on the
 * sandbox rail. The simulated rail sends nothing to PayPal: its batches are bounded by the per-batch guards
 * (US$400, Judge Mode's 8 items, known receivers) and by the judge lane's own quota, decided before the post;
 * there the daily ceiling never binds and the balance is the opening one (the simulator answers for its own).
 */
export function spendGuardsFor(
  deps: Pick<Deps, "db" | "paypal">,
): Pick<PayoutLimits, "maxPostsPer24h" | "postsInLast24h" | "balanceCents" | "minBalanceCents"> {
  // A replayed post (Judge Mode's replay rail) reaches no one and spends nothing: no live ceiling or floor binds it.
  if (deps.paypal.mode !== "sandbox" || deps.paypal.provenance === "replay") {
    return {
      maxPostsPer24h: Number.MAX_SAFE_INTEGER,
      postsInLast24h: (now) => postsInLast24h(deps, now),
      balanceCents: async () => BigInt(JUDGE_QUOTA.simulatorOpeningCents),
      minBalanceCents: 0n,
    };
  }
  return {
    maxPostsPer24h: MAX_POSTS_PER_24H,
    postsInLast24h: (now) => postsInLast24h(deps, now),
    balanceCents: () => estimatedBalanceCents(deps),
    minBalanceCents: MIN_BALANCE_CENTS,
  };
}

export interface ServiceOptions {
  sleep?: (ms: number) => Promise<void>;
  /** Tests: wraps the repository, e.g. to let another request move the run between two of its calls. */
  repo?: (base: AppPayoutsRepository) => PayoutsRepository;
}

/**
 * The one lock every live post's spend check and write hold, in every process (C-21, the balance floor). Lock order
 * (judge/quota.ts): the judge quota lock first when both are held; the service's spend guard holds only this one, and
 * waits for it holding no pooled connection (judge/quota.ts header, "POOL BOUND").
 */
export const SPEND_LOCK = PAYOUT_SPEND_LOCK;
/** How long a post waits for another's check-and-write before it re-queues itself. */
const SPEND_LOCK_WAIT_MS = 10_000;

/**
 * C-21's 40 live batches a day and the US$10,000 floor guard the one shared sandbox business account, so their
 * check and the write it allows must be one step across every workspace and process. The service serialises them
 * per instance only (`#exclusive`), and an instance serves one task; this lock spans the service's first guard
 * read (`postsInLast24h`) to the end of `writeSubmitted` (or to the end of the call when a guard refused), on a
 * reserved connection, so two posts at cap − 1 can never both pass on the same count.
 */
function spendLock(sql: AppDeps["sql"]) {
  let held: Awaited<ReturnType<AppDeps["sql"]["reserve"]>> | null = null;
  return {
    async acquire(): Promise<void> {
      if (held) return;
      const deadline = Date.now() + SPEND_LOCK_WAIT_MS;
      for (;;) {
        // a connection is reserved only for the try and kept only by the winner: waiters hold none of the pool
        const reserved = await sql.reserve();
        let locked = false;
        try {
          const [row] = await reserved<{ locked: boolean }[]>`
            select pg_try_advisory_lock(hashtextextended(${SPEND_LOCK}, 0)) as locked`;
          locked = row?.locked === true;
        } finally {
          if (!locked) reserved.release();
        }
        if (locked) {
          held = reserved;
          return;
        }
        if (Date.now() > deadline) {
          throw new PayPalStepError("QUEUED", "Another post is checking the daily cap; this one waits.", {
            transient: true,
            retryAfterMs: 5_000,
          });
        }
        await new Promise((r) => setTimeout(r, 25));
      }
    },
    async release(): Promise<void> {
      const reserved = held;
      held = null;
      if (!reserved) return;
      try {
        await reserved`select pg_advisory_unlock(hashtextextended(${SPEND_LOCK}, 0))`;
      } catch {
        await reserved`select pg_advisory_unlock_all()`.catch(() => undefined);
      } finally {
        reserved.release();
      }
    },
  };
}

/** The PayoutsService for one workspace, every guard wired. */
export async function payoutsServiceFor(
  deps: Deps & Partial<Pick<AppDeps, "sql">>,
  scope: WorkspaceScope,
  o: ServiceOptions = {},
): Promise<PayoutsService> {
  const receivers = receiverDirectory(deps.env.paypal);
  const [wsRow] = await deps.db
    .select({ kind: schema.workspaces.kind })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, scope.workspaceId));
  const base = payoutsRepository(deps, scope);
  const repo = o.repo ? o.repo(base) : base;
  const guards = spendGuardsFor(deps);
  // Only where the guards bind (the sandbox rail, live): a replay or the simulated rail spends nothing shared.
  const lock =
    deps.sql && deps.paypal.mode === "sandbox" && deps.paypal.provenance !== "replay"
      ? spendLock(deps.sql)
      : null;
  const service = new PayoutsService({
    http: deps.paypal.core.http,
    repo: lock
      ? {
          ...repo,
          async writeSubmitted(batch) {
            try {
              return await repo.writeSubmitted(batch);
            } finally {
              await lock.release();
            }
          },
        }
      : repo,
    // The registry is read fresh for every check; a database fault throws, so nothing is voided or sent.
    officerKeys: () => officerRegistry(deps.db, scope),
    async killSwitch() {
      const k = await readKill(deps, scope.workspaceId);
      // On Judge Mode's replay rail kill_paypal_live is the reason the step replays (S3.11: "labelled replay in
      // Judge Mode"); the co-op's own pause, kill_payouts, still refuses.
      if (deps.paypal.provenance === "replay") return k.killPayouts;
      return k.killPayouts || k.killPaypalLive;
    },
    limits: {
      maxBatchTotalCents: MAX_BATCH_TOTAL_CENTS,
      maxItems: wsRow?.kind === "judge" ? JUDGE_MAX_ITEMS : 15_000,
      receiverAllowed: (r) => receivers.allowed(r),
      ...guards,
      // the first guard read takes the cross-process spend lock (released after the write)
      postsInLast24h: async (now) => {
        await lock?.acquire();
        return guards.postsInLast24h(now);
      },
    },
    ...(o.sleep ? { sleep: o.sleep } : {}),
    now: () => deps.clock.now(),
    priority: "live",
  });
  if (!lock) return service;
  // a guard that refused never reaches the write: the call's end frees the lock
  const freeing =
    <A extends unknown[], R>(f: (...a: A) => Promise<R>) =>
    (...a: A) =>
      f(...a).finally(() => lock.release());
  return Object.assign(service, {
    executeApproved: freeing((runId: string) =>
      PayoutsService.prototype.executeApproved.call(service, runId),
    ),
    reroute: freeing((req: Parameters<PayoutsService["reroute"]>[0]) =>
      PayoutsService.prototype.reroute.call(service, req),
    ),
  });
}

/**
 * The kill switch refused the POST, read fresh before PayPal was called (S3.11). A switch flipped through
 * setFlag already HALTed the run; one that never went through it (FS_KILL forced by env, or kill_paypal_live,
 * which setFlag does not HALT for) must not leave the run APPROVED with LOCKED lines and live approvals and
 * nothing to post it later:
 *   - kill_payouts on (stored or forced): the run is HALTED, approvals voided, lines unlocked;
 *   - kill_paypal_live alone ("refusal in real mode"): sent back like any refusal before the POST, so signing
 *     again posts once the switch is off;
 *   - rows already written (POSTING, PayPal's answer unknown): never abandoned; thrown as transient, so the
 *     post task re-queues itself as a fresh attempt row (runs/now.ts `deferTask`) for as long as the switch is
 *     held, turning a switch off brings the waiting attempt forward (money/resume.ts), and it resumes with the
 *     same ids. A post that stopped anyway (an outage outlasting every attempt) is picked up by the catch-up.
 */
export async function refusedByKillSwitch(
  deps: Deps,
  scope: WorkspaceScope,
  runId: string,
  outcome: Extract<BatchOutcome, { kind: "refused" }>,
): Promise<PayRunState> {
  const state = await withWorkspaceTx(deps.db, scope, async (tx: Tx) => {
    const run = await lockRun(tx, scope, runId);
    if (run.state !== "APPROVED") return run.state as PayRunState;
    const kill = await readKill(deps, scope.workspaceId, tx);
    const at = deps.clock.now();
    const refusal = { runId: run.id, code: outcome.code, reason: outcome.reason, senderBatchId: null, at };
    if (!kill.killPayouts) {
      // The switch read happens before anything is loaded: every live approval of the run is sent back.
      await voidLiveApprovals(tx, scope, run.id, at, `refused:${outcome.code}`);
      await unlockLines(tx, scope, run.id, "SEND_BACK");
      await recordRefusal(tx, scope, refusal);
      const moved = await moveRun(tx, scope, {
        id: run.id,
        from: "APPROVED",
        to: "IN_REVIEW",
        version: run.version,
        cause: cause("SEND_BACK", outcome.code),
        provenance: "live",
        actor: ACTORS.outbox,
      });
      return moved.state as PayRunState;
    }
    await recordRefusal(tx, scope, refusal);
    return (await haltRun(tx, scope, run, at, "kill_payouts")).state as PayRunState;
  });
  if (state === "POSTING") {
    throw new PayPalStepError(
      "KILL_SWITCH_ON",
      "The batch is written but a kill switch is on; the POST resumes with the same ids once it is off.",
      { transient: true, retryAfterMs: 60_000 },
    );
  }
  return state;
}

export type { CancelIntent };
export const cancelActor = (scope: WorkspaceScope): Actor => ({
  kind: scope.actor.kind === "human" ? "human" : "system",
  id: scope.actor.id,
  impersonatedBy: scope.actor.impersonatedBy ?? null,
});
