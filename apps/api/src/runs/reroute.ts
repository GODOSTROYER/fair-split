// IC-01 `resend` (P1, S3.6.4 re-route): a parked or returned PayPal line paid again to a new receiver, as a
// one-item batch `{senderBatchId}-x{n}-{memberNo}` (ADR-0007) with item `r{runSeq}x{n}-{memberNo}` superseding
// the returned one. The ids are WS-PPMONEY's own builders, so the digest signed here is the one
// `PayoutsService.reroute` recomputes. Nothing moves without a person: the treasurer signs a fresh one-item
// payload, verified exactly like a batch approval (domain `expectedSigner` + `checkApprovals`: registry key of
// its kind, the credential's own key, THIS item's digest and every member line's `linesDigest`, unexpired,
// unused nonce, Ed25519). The new receiver must be a known sandbox account. An UNCLAIMED item is cancelled
// first (intent "reroute", never cash); the re-route then runs through `PayoutsService.reroute`, which
// re-checks all of it before the POST and refuses a second re-route of the same returned item (I3: a member is
// never paid twice).
import {
  ApprovalPayload as ApprovalPayloadSchema,
  type MemberLineState,
  type SignedApproval,
  TASKS,
} from "@fairsplit/contracts";
import {
  isUniqueViolation,
  memberLineHashes,
  schema,
  systemScope,
  type Tx,
  withWorkspaceTx,
} from "@fairsplit/db";
import {
  type ApprovalExpectation,
  approvalJcs,
  batchDigest,
  checkApprovals,
  expectedSigner,
  requiresChair,
} from "@fairsplit/domain";
import { enqueue, type TaskHandlers } from "@fairsplit/outbox";
import { parseSenderItemId, senderBatchId, senderItemId } from "@fairsplit/paypal-payouts";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { linesDigestOf } from "../approvals/batch.js";
import { officerRegistry } from "../approvals/registry.js";
import type { CommandHandler } from "../lib/command.js";
import type { AppDeps } from "../lib/context.js";
import { ApiProblem, problem } from "../lib/problem.js";
import { classifyPayPal, PayPalStepError } from "../money/errors.js";
import { payoutsServiceFor } from "../money/payouts.js";
import { receiverDirectory } from "../money/receivers.js";
import { allow, CAN, personaId } from "./access.js";
import { toInt } from "./codes.js";
import { lineDto } from "./dto.js";
import { ACTORS, factLedger } from "./events.js";
import { assertNotKilled } from "./flags.js";
import { canonicalOf, cardById, casGuard, cosignRule, lockRun, seasonById } from "./load.js";
import { enqueuePress, report, reportProblem, runNow, type TaskReport } from "./now.js";

interface RerouteNote {
  reroute: { lineId: string; n: number; receiver: string; payoutItemId: string };
}

function invalid(message: string, details?: Record<string, unknown>): ApiProblem {
  return new ApiProblem("INVALID_TRANSITION", message, details ? { details } : {});
}

/** A failed task as one of `resend`'s codes (pacing and outages are a 429 the client retries). */
function resendProblem(r: Extract<TaskReport, { ok: false }>): ApiProblem {
  if (r.code === "QUEUED" || r.code === "CIRCUIT_OPEN") {
    return new ApiProblem("RATE_LIMITED", r.message, { retryAfterMs: r.retryAfterMs ?? 30_000 });
  }
  return reportProblem(r);
}

export const resendHandler: CommandHandler<"resend"> = async (ctx) => {
  allow(ctx.credential, CAN.resend, "Re-routing a payout");
  const { deps, scope } = ctx;
  const { newReceiver, keyId, signature, payload } = ctx.input;
  const at = ctx.now();
  const receivers = receiverDirectory(deps.env.paypal);
  const plan = await casGuard(
    () =>
      withWorkspaceTx(deps.db, scope, async (tx: Tx) => {
        const [found] = await tx
          .select({ line: schema.memberLines, memberNo: schema.members.memberNo })
          .from(schema.memberLines)
          .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
          .where(
            and(
              eq(schema.memberLines.workspaceId, scope.workspaceId),
              eq(schema.memberLines.id, ctx.params.lineId),
            ),
          )
          .for("update");
        if (!found) throw problem.notFound("No such line in this workspace.");
        const { line, memberNo } = found;
        const state = line.state as MemberLineState;
        if (state !== "UNCLAIMED" && state !== "RETURNED") {
          throw invalid(`A ${state} line cannot be re-routed.`, { lineState: state });
        }
        await assertNotKilled(deps, scope.workspaceId, "kill_payouts", tx);
        const [item] = await tx
          .select()
          .from(schema.payoutItems)
          .where(
            and(
              eq(schema.payoutItems.workspaceId, scope.workspaceId),
              eq(schema.payoutItems.lineId, line.id),
              inArray(schema.payoutItems.status, ["UNCLAIMED", "RETURNED"]),
              isNotNull(schema.payoutItems.payoutItemId),
            ),
          )
          .orderBy(desc(schema.payoutItems.createdAt))
          .limit(1);
        if (!item?.payoutItemId) throw invalid("PayPal has not named this item yet.", { lineState: state });
        if (item.cancelIntent === "cash") throw invalid("This item was moved to cash.", { lineState: state });
        if (state === "RETURNED" && !item.cancelRequestedAt) {
          throw invalid("PayPal returned this item without our cancel; it needs follow-up first.", {
            lineState: state,
          });
        }
        if (!receivers.allowed(newReceiver)) {
          throw invalid("The new receiver is not a known sandbox account.", { reason: "RECEIVER_NOT_KNOWN" });
        }
        const run = await lockRun(tx, scope, line.runId);
        const season = await seasonById(tx, scope, run.seasonId);
        const parsed = parseSenderItemId(item.senderItemId);
        if (!parsed || parsed.memberNo !== memberNo) {
          throw invalid("The returned item does not carry one of our sender_item_ids.", { lineState: state });
        }
        const n = (parsed.rerouteNo ?? 0) + 1;
        // WS-PPMONEY's own ids (ADR-0007: the member is in the batch id), so the treasurer signs exactly the
        // batch PayoutsService.reroute rebuilds and hashes before the POST.
        const ids = { seasonCode: season.label, rateCardSha256: run.rateCardSha256, runSeq: run.runSeq };
        const sbid = senderBatchId({ ...ids, rerouteNo: n, memberNo });
        const sid = senderItemId({ runSeq: run.runSeq, memberNo, rerouteNo: n });
        // Rows under this id mean this re-route was already written: refuse before anything is cancelled.
        const [taken] = await tx
          .select({ id: schema.payoutBatches.id })
          .from(schema.payoutBatches)
          .where(eq(schema.payoutBatches.senderBatchId, sbid));
        if (taken)
          throw invalid(`${sbid} was already written for this item.`, {
            reason: "REROUTE_ID_TAKEN",
          });
        const amount = toInt(item.amountCents);
        const digest = batchDigest(
          { runId: run.id, senderBatchId: sbid, rateCardSha256: run.rateCardSha256 },
          [{ senderItemId: sid, receiver: newReceiver, amountCents: amount, currency: "USD" }],
        );
        // A re-route's approval binds every member line too (IC-02 `linesDigest`), as the service checks it.
        const lines = linesDigestOf(await memberLineHashes(tx, scope, run.id));
        if (!lines) throw invalid("A member line has no stored hash; nothing can be signed.");
        const card = await cardById(tx, scope, run.rateCardId);
        if (
          requiresChair(
            { batchTotalCents: amount, lineAmountsCents: [amount], overrides: 0 },
            cosignRule(season, canonicalOf(card)),
          ).required
        ) {
          throw invalid("This re-route is over the co-sign threshold and needs the Chair as well.");
        }
        // The treasurer's fresh one-item signature, checked like any approval.
        if (payload.role !== "treasurer")
          throw new ApiProblem("APPROVER_MISMATCH", "A re-route is signed by the treasurer.");
        const registry = await officerRegistry(tx, scope);
        const lookup = expectedSigner(registry, "treasurer", keyId, at);
        if (!lookup.ok) throw new ApiProblem("KEY_NOT_REGISTERED", lookup.reason);
        const officer = registry.find((k) => k.keyId === keyId);
        if (
          ctx.credential.role === "judge"
            ? officer?.kind !== "web_demo"
            : lookup.signer.approverId !== personaId(ctx.credential)
        ) {
          throw new ApiProblem("APPROVER_MISMATCH", `${keyId} is not your key to sign with.`);
        }
        const expected: ApprovalExpectation = {
          ...lookup.signer,
          runId: run.id,
          seasonId: run.seasonId,
          rateCardSha256: run.rateCardSha256,
          batchSha256: digest.batchSha256,
          linesDigest: lines,
          itemCount: 1,
          totalCents: amount,
          role: "treasurer",
        };
        const signed: SignedApproval = {
          role: "treasurer",
          keyId,
          publicKeyHex: lookup.signer.publicKeyHex,
          payload,
          signatureHex: signature,
        };
        const nonces = await tx
          .select({ nonce: schema.approvals.nonce })
          .from(schema.approvals)
          .where(and(eq(schema.approvals.workspaceId, scope.workspaceId), isNotNull(schema.approvals.nonce)));
        // The set PayoutsService.reroute will check (domain `checkApprovals`): the treasurer alone, under R5.
        const check = checkApprovals(
          { approvals: [signed], expected: { treasurer: expected }, chairRequired: false },
          at,
          new Set(nonces.map((x) => x.nonce as string)),
        );
        if (!check.ok) {
          const direct =
            check.code === "KEY_NOT_REGISTERED" ||
            check.code === "APPROVER_MISMATCH" ||
            check.code === "SIGNATURE_INVALID";
          throw new ApiProblem(direct ? check.code : "SIGNATURE_INVALID", check.reason, {
            details: { reason: check.code },
          });
        }
        const note: RerouteNote = {
          reroute: { lineId: line.id, n, receiver: newReceiver, payoutItemId: item.payoutItemId },
        };
        try {
          // Spent at once: the nonce joins the used-nonce store; the run's live approvals are untouched.
          await tx.insert(schema.approvals).values({
            workspaceId: scope.workspaceId,
            runId: run.id,
            role: "treasurer",
            decision: "SIGNED",
            approverId: lookup.signer.approverId,
            keyId,
            payloadJcs: approvalJcs(payload),
            signature,
            batchSha256: digest.batchSha256,
            nonce: payload.nonce,
            exp: new Date(payload.exp),
            reason: JSON.stringify(note),
            voidedAt: at,
            voidReason: "reroute",
            provenance: "live",
          });
        } catch (e) {
          if (isUniqueViolation(e))
            throw new ApiProblem("SIGNATURE_INVALID", "This approval was already used.", {
              details: { reason: "NONCE_REUSED" },
            });
          throw e;
        }
        await factLedger(
          tx,
          scope,
          "reroute.approved",
          {
            runId: run.id,
            lineId: line.id,
            senderBatchId: sbid,
            batchSha256: digest.batchSha256,
            keyId,
            nonce: payload.nonce,
          },
          {
            runId: run.id,
            at,
            actor: {
              kind: "human",
              id: lookup.signer.approverId,
              impersonatedBy: scope.actor.impersonatedBy ?? null,
            },
          },
        );
        let cancelId: string | null = null;
        if (state === "UNCLAIMED") {
          const args = { payoutItemId: item.payoutItemId, afterCancel: "reroute" as const };
          cancelId = await enqueuePress(tx, "cancelUnclaimed", args, TASKS.cancelUnclaimed.dedupeKey(args), {
            workspaceId: scope.workspaceId,
          });
        }
        const rargs = { lineId: line.id, n };
        const rerouteId = (
          await enqueue(tx, "reroute", rargs, TASKS.reroute.dedupeKey(rargs), {
            workspaceId: scope.workspaceId,
          })
        ).id;
        return { cancelId, rerouteId, senderBatchId: sbid };
      }),
    "INVALID_TRANSITION",
  );
  if (plan.cancelId) {
    const r = await runNow(deps, plan.cancelId);
    if (r && !r.ok) throw resendProblem(r);
  }
  const r = await runNow(deps, plan.rerouteId);
  if (r && !r.ok) throw resendProblem(r);
  const [after] = await deps.db
    .select({ line: schema.memberLines, memberNo: schema.members.memberNo })
    .from(schema.memberLines)
    .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
    .where(
      and(
        eq(schema.memberLines.workspaceId, scope.workspaceId),
        eq(schema.memberLines.id, ctx.params.lineId),
      ),
    );
  if (!after) throw problem.notFound("No such line in this workspace.");
  return { line: lineDto(after.line, after.memberNo), senderBatchId: plan.senderBatchId };
};

/** The reroute task {lineId, n}: RETURNED → REROUTED, then `PayoutsService.reroute` posts the one-item batch. */
export function rerouteTasks(deps: AppDeps): TaskHandlers {
  return {
    reroute: async (raw, ctx) => {
      const args = TASKS.reroute.args.parse(raw);
      try {
        if (!ctx.workspaceId) throw new Error("reroute needs its workspace");
        const scope = systemScope(ctx.workspaceId, ACTORS.outbox);
        const prepared = await withWorkspaceTx(deps.db, scope, async (tx) => {
          const approvals = await tx
            .select()
            .from(schema.approvals)
            .where(
              and(
                eq(schema.approvals.workspaceId, scope.workspaceId),
                eq(schema.approvals.voidReason, "reroute"),
              ),
            );
          const row = approvals.find((a) => {
            try {
              const note = JSON.parse(a.reason ?? "{}") as Partial<RerouteNote>;
              return note.reroute?.lineId === args.lineId && note.reroute.n === args.n;
            } catch {
              return false;
            }
          });
          if (!row?.payloadJcs || !row.keyId || !row.signature)
            throw new PayPalStepError("INVALID_TRANSITION", "No signed re-route for this line.", {
              transient: false,
            });
          const note = JSON.parse(row.reason ?? "{}") as RerouteNote;
          const payload = ApprovalPayloadSchema.parse(JSON.parse(row.payloadJcs));
          const registry = await officerRegistry(tx, scope);
          const key = registry.find((k) => k.keyId === row.keyId);
          if (!key)
            throw new PayPalStepError("INVALID_TRANSITION", "The re-route's key is no longer registered.", {
              transient: false,
            });
          const [found] = await tx
            .select({ line: schema.memberLines, memberNo: schema.members.memberNo })
            .from(schema.memberLines)
            .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
            .where(
              and(
                eq(schema.memberLines.workspaceId, scope.workspaceId),
                eq(schema.memberLines.id, args.lineId),
              ),
            )
            .for("update");
          if (found?.line.state !== "RETURNED") {
            throw new PayPalStepError("INVALID_TRANSITION", "Only a returned line can be re-routed.", {
              transient: false,
            });
          }
          const approval: SignedApproval = {
            role: "treasurer",
            keyId: row.keyId,
            publicKeyHex: key.publicKeyHex,
            payload,
            signatureHex: row.signature,
          };
          return { note, approval };
        });
        const service = await payoutsServiceFor(deps, scope);
        const outcome = await service.reroute({
          supersedesItemId: prepared.note.reroute.payoutItemId,
          rerouteNo: args.n,
          receiver: prepared.note.reroute.receiver,
          approvals: [prepared.approval],
        });
        if (outcome.kind === "unresolved") {
          throw new PayPalStepError("QUEUED", `The re-route POST is unresolved (${outcome.reason}).`, {
            transient: true,
            retryAfterMs: 30_000,
          });
        }
        if (outcome.kind === "refused") {
          throw new PayPalStepError(
            outcome.code === "KILL_SWITCH_ON"
              ? "KILL_SWITCH_ON"
              : outcome.code === "CIRCUIT_OPEN"
                ? "CIRCUIT_OPEN"
                : "INVALID_TRANSITION",
            outcome.reason,
            { transient: outcome.code === "CIRCUIT_OPEN" },
          );
        }
        if (outcome.kind === "rejected") {
          throw new PayPalStepError("PAYPAL_REJECTED", `PayPal refused the re-route (${outcome.name}).`, {
            transient: false,
            debugId: outcome.debugId,
          });
        }
        report(ctx.outboxId, { ok: true, detail: { senderBatchId: outcome.senderBatchId } });
      } catch (e) {
        const step = classifyPayPal(e, "the re-route");
        report(ctx.outboxId, {
          ok: false,
          code: step.code,
          message: step.message,
          debugId: step.opts.debugId ?? null,
          retryAfterMs: step.opts.retryAfterMs ?? null,
        });
        if (step.opts.transient) throw step;
      }
    },
  };
}
