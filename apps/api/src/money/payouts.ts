// Payouts v1 through WS-PPMONEY's `PayoutsService`, the only code that creates or cancels payouts (I6). This
// file is its persistence port over the database (`PayoutsRepository`) and its wiring: the shared PayPalHttp
// (limiter, PayPal-Request-Id, call log, debug ids), IC-02 `batchDigest` (I4), approvals verified against the
// `device_keys` registry (never the approval's own key), the kill switch read fresh before every POST, and
// the sandbox guards (C-21's US$400 cap, Judge Mode's 8 items, known receivers only).
//
// What the service does not do, this does, in the same transactions as its writes: APPROVED → POSTING with
// the batch and item rows written SUBMITTED and the lines LOCKED → SUBMITTED (`payout.submitting` in the
// ledger) before the POST; POSTED with items PENDING and lines PAYPAL_PENDING on the 201, and the first
// settle GET queued (+25 s in Judge Mode, +90 s otherwise); DENIED with lines NEEDS_ACTION on a synchronous 4xx.
import type {
  ApprovalPayload,
  HoldResolutionKind,
  PayoutBatchStatus,
  PayRunState,
  SignedApproval,
} from "@fairsplit/contracts";
import { ApprovalPayload as ApprovalPayloadSchema, TASKS } from "@fairsplit/contracts";
import { type Actor, schema, type Tx, type WorkspaceScope, withWorkspaceTx } from "@fairsplit/db";
import { approvalSignatureValid, batchDigest, expectedSigner, isOverride } from "@fairsplit/domain";
import { enqueue } from "@fairsplit/outbox";
import type { PayPalHttp as CoreHttp } from "@fairsplit/paypal-core";
import {
  type BatchOutcome,
  type CancelIntent,
  type PayoutItemRow,
  type PayoutsRepository,
  PayoutsService,
  type PayPalHttp,
  type PostingSnapshot,
} from "@fairsplit/paypal-payouts";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { officerRegistry } from "../approvals/registry.js";
import type { AppDeps } from "../lib/context.js";
import { toInt } from "../runs/codes.js";
import { ACTORS, factLedger, noteSha256, proofLedger } from "../runs/events.js";
import { readKill, unlockLines, voidLiveApprovals } from "../runs/flags.js";
import { canonicalOf, cardById, cosignRule, lockRun, seasonById } from "../runs/load.js";
import { cause, moveLine, moveRun } from "../runs/machine.js";
import { SETTLE_GET_DELAYS_MS } from "../webhooks/apply.js";
import { PayPalStepError } from "./errors.js";
import { applyItem } from "./items.js";
import { receiverDirectory } from "./receivers.js";

type Deps = Pick<AppDeps, "db" | "env" | "paypal" | "clock" | "logger">;

/** C-21: US$400 per batch on the sandbox rail. */
export const MAX_BATCH_TOTAL_CENTS = 40_000n;
/** Judge Mode posts at most 8 items. */
export const JUDGE_MAX_ITEMS = 8;

/** The payouts package's call purposes, in paypal-core's `CallPurpose` vocabulary (`paypal_calls.purpose`). */
const PURPOSES: Readonly<Record<string, Parameters<CoreHttp["request"]>[0]["purpose"]>> = {
  "payouts.create": "payouts.create",
  "payouts.get": "payouts.get",
  "payouts.getItem": "payouts.item.get",
  "payouts.cancelItem": "payouts.item.cancel",
  "payouts.item.get": "payouts.item.get",
  "payouts.item.cancel": "payouts.item.cancel",
};

/** paypal-core's PayPalHttp in the shape the payouts package declares (links always carry a method). */
export function payoutsHttp(core: CoreHttp): PayPalHttp {
  return {
    async request<T>(req: Parameters<PayPalHttp["request"]>[0]) {
      const purpose = PURPOSES[req.purpose] ?? "payouts.get";
      const r = await core.request<T>({ ...req, purpose });
      if (r.ok) return { ok: true, status: r.status, body: r.body, debugId: r.debugId, ms: r.ms };
      return {
        ok: false,
        status: r.status,
        name: r.name,
        message: r.message,
        details: r.details,
        links: r.links.map((l) => ({ href: l.href, rel: l.rel, method: l.method ?? "GET" })),
        debugId: r.debugId,
        retryable: r.retryable,
        ms: r.ms,
      };
    },
  };
}

function parsePayload(jcs: string | null): ApprovalPayload | null {
  if (!jcs) return null;
  try {
    const r = ApprovalPayloadSchema.safeParse(JSON.parse(jcs));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

const BATCH_STATUS: Readonly<Record<string, PayoutBatchStatus>> = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  SUCCESS: "SUCCESS",
  DENIED: "DENIED",
  CANCELED: "CANCELED",
  CANCELLED: "CANCELED",
};

/** The repository over the database, bound to one workspace. */
export function payoutsRepository(deps: Deps, scope: WorkspaceScope): PayoutsRepository {
  const ws = scope.workspaceId;
  const receivers = receiverDirectory(deps.env.paypal);
  const provenance = deps.paypal.provenance;
  const db = deps.db;

  const facts = async (runId: string) => {
    const [run] = await db
      .select()
      .from(schema.payRuns)
      .where(and(eq(schema.payRuns.workspaceId, ws), eq(schema.payRuns.id, runId)));
    if (!run) return null;
    const season = await seasonById(db, scope, run.seasonId);
    const card = await cardById(db, scope, run.rateCardId);
    return {
      run,
      facts: {
        runId: run.id,
        runSeq: run.runSeq,
        seasonCode: season.label,
        seasonId: run.seasonId,
        rateCardSha256: run.rateCardSha256,
        cosign: cosignRule(season, canonicalOf(card)),
      },
    };
  };

  return {
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
      const approvals: SignedApproval[] = [];
      for (const a of approvalRows) {
        const payload = parsePayload(a.payloadJcs);
        const key = registry.find((k) => k.keyId === a.keyId);
        if (!payload || !a.keyId || !a.signature || !key) continue;
        approvals.push({
          role: payload.role,
          keyId: a.keyId,
          publicKeyHex: key.publicKeyHex,
          payload,
          signatureHex: a.signature,
        });
      }
      const holds = await db
        .select({ kind: schema.holds.kind, state: schema.holds.state, resolution: schema.holds.resolution })
        .from(schema.holds)
        .where(and(eq(schema.holds.workspaceId, ws), eq(schema.holds.runId, runId)));
      const overrides = holds.filter((h) => {
        const r = h.resolution as { kind?: string } | null;
        return h.state === "RESOLVED" && !!r?.kind && isOverride(h.kind, r.kind as HoldResolutionKind);
      }).length;
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
      return {
        ...f.facts,
        lines: lines
          .map(({ line, memberNo }) => ({
            lineId: line.id,
            memberNo,
            receiver: receivers.receiverFor(memberNo) ?? "",
            amountCents: BigInt(toInt(line.netCents)),
            currency: "USD" as const,
          }))
          .filter((l) => l.receiver !== "" && l.amountCents > 0n),
        approvals,
        overrides,
        submitted: batch ? { at: batch.submittedAt.toISOString(), batchSha256: batch.batchSha256 } : null,
      };
    },

    async loadRun(runId) {
      return (await facts(runId))?.facts ?? null;
    },

    async writeSubmitted(batch) {
      await withWorkspaceTx(db, scope, async (tx) => {
        const [exists] = await tx
          .select({ id: schema.payoutBatches.id, batchSha256: schema.payoutBatches.batchSha256 })
          .from(schema.payoutBatches)
          .where(eq(schema.payoutBatches.senderBatchId, batch.senderBatchId));
        if (exists) {
          // The same batch again (a resumed post) is a no-op. Another batch under this id would be paid
          // under someone else's rows: refuse (a second item of one run re-routed as `-x{n}` collides).
          if (exists.batchSha256 === batch.batchSha256) return;
          throw new PayPalStepError(
            "INVALID_TRANSITION",
            `${batch.senderBatchId} already names another batch; nothing was sent.`,
            { transient: false },
          );
        }
        const run = await lockRun(tx, scope, batch.runId);
        const at = new Date(batch.at);
        if (batch.kind === "primary") {
          if (run.state !== "APPROVED") throw new Error(`run is ${run.state}, not APPROVED`);
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
        await tx
          .update(schema.payoutBatches)
          .set({
            paypalBatchId: posted.payoutBatchId,
            status: BATCH_STATUS[posted.batchStatus ?? ""] ?? "PENDING",
            adopted: posted.outcome === "adopted",
          })
          .where(eq(schema.payoutBatches.id, batch.id));
        const items = await tx
          .select()
          .from(schema.payoutItems)
          .where(and(eq(schema.payoutItems.workspaceId, ws), eq(schema.payoutItems.batchId, batch.id)));
        for (const item of items) {
          await applyItem(tx, scope, item, {
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

export interface ServiceOptions {
  sleep?: (ms: number) => Promise<void>;
}

/** The PayoutsService for one workspace, every guard wired. */
export async function payoutsServiceFor(
  deps: Deps,
  scope: WorkspaceScope,
  o: ServiceOptions = {},
): Promise<PayoutsService> {
  const receivers = receiverDirectory(deps.env.paypal);
  const [wsRow] = await deps.db
    .select({ kind: schema.workspaces.kind })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, scope.workspaceId));
  return new PayoutsService({
    http: payoutsHttp(deps.paypal.core.http),
    auth: { invalidate: () => deps.paypal.core.auth.invalidate() },
    repo: payoutsRepository(deps, scope),
    batchDigest: (run, items) =>
      batchDigest(
        run,
        items.map((i) => ({
          senderItemId: i.senderItemId,
          receiver: i.receiver,
          amountCents: Number(i.amountCents),
          currency: i.currency,
        })),
      ).batchSha256,
    async verifyApprovalSignature(approval) {
      const registry = await officerRegistry(deps.db, scope);
      const lookup = expectedSigner(registry, approval.role, approval.keyId, deps.clock.now());
      return (
        lookup.ok &&
        lookup.signer.approverId === approval.payload.approverId &&
        approvalSignatureValid(approval, lookup.signer.publicKeyHex)
      );
    },
    async killSwitch() {
      const k = await readKill(deps, scope.workspaceId);
      return k.killPayouts || k.killPaypalLive;
    },
    limits: {
      maxBatchTotalCents: MAX_BATCH_TOTAL_CENTS,
      maxItems: wsRow?.kind === "judge" ? JUDGE_MAX_ITEMS : 15_000,
      receiverAllowed: (r) => receivers.allowed(r),
    },
    ...(o.sleep ? { sleep: o.sleep } : {}),
    now: () => deps.clock.now(),
    priority: "live",
  });
}

/**
 * After a refusal before anything was sent (a digest that changed after signing, a missing approval):
 * void the approvals, unlock the lines and send the run back to IN_REVIEW (S3.6.4 step 3):
 * "The batch changed after it was signed. Nothing was sent."
 */
export async function sendBack(
  deps: Deps,
  scope: WorkspaceScope,
  runId: string,
  outcome: Extract<BatchOutcome, { kind: "refused" }>,
): Promise<PayRunState> {
  return withWorkspaceTx(deps.db, scope, async (tx: Tx) => {
    const run = await lockRun(tx, scope, runId);
    if (run.state !== "APPROVED") return run.state as PayRunState;
    const at = deps.clock.now();
    await voidLiveApprovals(tx, scope, run.id, at, `refused:${outcome.code}`);
    await unlockLines(tx, scope, run.id, "SEND_BACK");
    await factLedger(
      tx,
      scope,
      "payout.refused",
      {
        runId,
        code: outcome.code,
        senderBatchId: outcome.senderBatchId,
        reasonSha256: noteSha256(outcome.reason),
      },
      { runId, at, actor: ACTORS.outbox },
    );
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
  });
}

export type { CancelIntent };
export const cancelActor = (scope: WorkspaceScope): Actor => ({
  kind: scope.actor.kind === "human" ? "human" : "system",
  id: scope.actor.id,
  impersonatedBy: scope.actor.impersonatedBy ?? null,
});
