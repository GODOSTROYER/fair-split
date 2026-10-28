// IC-01 `resend` (P1, S3.6.4 re-route): a parked or returned PayPal line paid again to a new receiver, as a
// one-item batch `{senderBatchId}-x{n}-{memberNo}` (ADR-0007) with item `r{runSeq}x{n}-{memberNo}` superseding
// the returned one. The ids are WS-PPMONEY's own builders, so the digest signed here is the one
// `PayoutsService.reroute` recomputes. Nothing moves without a person: the treasurer signs a fresh one-item
// payload, verified exactly like a batch approval (domain `expectedSigner` + `checkApprovals`: registry key of
// its kind, the credential's own key, THIS item's digest and every member line's `linesDigest`, unexpired,
// unused nonce, Ed25519). The new receiver must be a known sandbox account. An UNCLAIMED item is cancelled
// first (intent "reroute", never cash); the re-route then runs through `PayoutsService.reroute`, which
// re-checks all of it before the POST and refuses a second re-route of the same returned item (I3: a member is
// never paid twice). Every signed re-route gets its own task row, keyed by its approval (`rerouteKey`), so a
// press is never answered by an earlier press's finished row; the row runs only once its cancel has landed (it
// waits while the cancel is on its way), sends nothing once a newer re-route of the line was signed, and
// re-queues itself through PayPal's pacing (`deferTask`). A line returned for a re-route that wrote nothing and
// waits for nothing can still be paid in cash (runs/paypal.ts `rerouteStillPending`).
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
  type WorkspaceScope,
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
import {
  type PayoutsService,
  parseSenderItemId,
  senderBatchId,
  senderItemId,
} from "@fairsplit/paypal-payouts";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { linesDigestOf } from "../approvals/batch.js";
import { officerRegistry } from "../approvals/registry.js";
import type { CommandHandler } from "../lib/command.js";
import type { AppDeps } from "../lib/context.js";
import { ApiProblem, problem } from "../lib/problem.js";
import { classifyPayPal, PayPalStepError, type StepCode } from "../money/errors.js";
import { guardResumedReroute, payoutsServiceFor, REROUTE_VOID_REASON } from "../money/payouts.js";
import { LaneQueued, notReplayable, railForItem } from "../money/rail.js";
import { receiverDirectory } from "../money/receivers.js";
import { allow, CAN, personaId } from "./access.js";
import { toInt } from "./codes.js";
import { lineDto } from "./dto.js";
import { ACTORS, factLedger } from "./events.js";
import { assertNotKilled } from "./flags.js";
import { canonicalOf, cardById, casGuard, cosignRule, lockRun, seasonById } from "./load.js";
import {
  attemptsOf,
  deferDelayMs,
  deferTask,
  enqueuePress,
  pressKeyOf,
  report,
  reportProblem,
  runNow,
  type TaskReport,
} from "./now.js";

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
        let approvalId: string;
        try {
          // Spent at once: the nonce joins the used-nonce store; the run's live approvals are untouched.
          const [stored] = await tx
            .insert(schema.approvals)
            .values({
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
            })
            .returning({ id: schema.approvals.id });
          if (!stored) throw new Error("the re-route approval was not stored");
          approvalId = stored.id;
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
        // One task row per signed re-route, named by its approval: an earlier press's row (finished, refused or still
        // waiting) never answers this press, and this press's row carries exactly the approval it was signed with.
        const rargs = { lineId: line.id, n };
        const rerouteId = (
          await enqueue(tx, "reroute", rargs, rerouteKey(rargs, approvalId), {
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

/** `reroute:{lineId}:x{n}:a{approvalId}`: the task row of one signed re-route (its approval names it). */
export function rerouteKey(args: { lineId: string; n: number }, approvalId: string): string {
  return `${TASKS.reroute.dedupeKey(args)}:a${approvalId}`;
}

const APPROVAL_IN_KEY = /:a([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The approval a re-route row was enqueued for; null for a row keyed before rows carried it. */
export function approvalIdOfKey(dedupeKey: string): string | null {
  const m = APPROVAL_IN_KEY.exec(pressKeyOf(dedupeKey));
  return m?.[1] ? m[1].toLowerCase() : null;
}

type Prepared =
  | { go: true; note: RerouteNote; approval: SignedApproval }
  /** Nothing is sent: `wait` re-queues the row (its cancel is still on its way), otherwise it finishes. */
  | { go: false; wait: boolean; code: StepCode; message: string; retryAfterMs?: number };

const noteOf = (row: { reason: string | null }): Partial<RerouteNote> => {
  try {
    return JSON.parse(row.reason ?? "{}") as Partial<RerouteNote>;
  } catch {
    return {};
  }
};

/**
 * What a re-route row may do now, read in one transaction under the workspace lock:
 *   - its own approval (named in its key; a legacy row takes the newest signed one for the line and n);
 *   - superseded: the line's newest `reroute.approved` is another approval, so a later press is the treasurer's
 *     word and this one sends nothing (an old press can never pay the old receiver after a new one was signed);
 *   - the line RETURNED by our cancel: go. Still UNCLAIMED while its cancel is on its way (requested for a re-route,
 *     or a cancel row still waiting): wait. Otherwise the cancel never landed: finish, nothing sent.
 *   - SUBMITTED with this re-route's rows written but not yet named by PayPal (a paced or unanswered POST): go,
 *     and the service resumes the same ids.
 */
async function prepareReroute(
  deps: AppDeps,
  scope: WorkspaceScope,
  args: { lineId: string; n: number },
  outboxId: string,
): Promise<Prepared> {
  return withWorkspaceTx(deps.db, scope, async (tx) => {
    const t = schema.taskOutbox;
    const [me] = await tx.select({ key: t.dedupeKey }).from(t).where(eq(t.id, outboxId));
    const approvalId = me ? approvalIdOfKey(me.key) : null;
    const candidates = await tx
      .select()
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.workspaceId, scope.workspaceId),
          eq(schema.approvals.voidReason, REROUTE_VOID_REASON),
          ...(approvalId ? [eq(schema.approvals.id, approvalId)] : []),
        ),
      )
      .orderBy(desc(schema.approvals.createdAt), desc(schema.approvals.id));
    const row = candidates.find((a) => {
      const n = noteOf(a).reroute;
      return n?.lineId === args.lineId && n.n === args.n;
    });
    const none = (message: string): Prepared => ({
      go: false,
      wait: false,
      code: "INVALID_TRANSITION",
      message,
    });
    if (!row?.payloadJcs || !row.keyId || !row.signature || !row.nonce) {
      return none("No signed re-route for this line.");
    }
    const note = noteOf(row) as RerouteNote;
    const [newest] = (await tx.execute(sql`
      select payload->>'nonce' as nonce from ledger_entries
       where workspace_id = ${scope.workspaceId} and kind = 'reroute.approved'
         and payload->>'lineId' = ${args.lineId}
       order by seq desc limit 1`)) as unknown as { nonce: string | null }[];
    if (newest?.nonce && newest.nonce !== row.nonce) {
      return none("A newer re-route of this line was signed; this one sends nothing.");
    }
    const payload = ApprovalPayloadSchema.parse(JSON.parse(row.payloadJcs));
    const registry = await officerRegistry(tx, scope);
    const key = registry.find((k) => k.keyId === row.keyId);
    if (!key) return none("The re-route's key is no longer registered.");
    const [found] = await tx
      .select({ state: schema.memberLines.state })
      .from(schema.memberLines)
      .where(
        and(eq(schema.memberLines.workspaceId, scope.workspaceId), eq(schema.memberLines.id, args.lineId)),
      )
      .for("update");
    const state = found?.state as MemberLineState | undefined;
    if (state === "UNCLAIMED") {
      const [item] = await tx
        .select()
        .from(schema.payoutItems)
        .where(
          and(
            eq(schema.payoutItems.workspaceId, scope.workspaceId),
            eq(schema.payoutItems.payoutItemId, note.reroute.payoutItemId),
          ),
        );
      const [cancel] = await tx
        .select({ runAfter: t.runAfter })
        .from(t)
        .where(
          and(
            eq(t.workspaceId, scope.workspaceId),
            eq(t.name, "cancelUnclaimed"),
            inArray(t.state, ["queued", "dispatched", "running"]),
            sql`${t.args}->>'payoutItemId' = ${note.reroute.payoutItemId}`,
          ),
        )
        .orderBy(desc(t.runAfter))
        .limit(1);
      const requested =
        item?.status === "UNCLAIMED" && item.cancelIntent === "reroute" && item.cancelRequestedAt !== null;
      if (cancel || requested) {
        return {
          go: false,
          wait: true,
          code: "QUEUED",
          message: "The parked item's cancel is still on its way; the re-route waits for it.",
          retryAfterMs: cancel ? Math.max(5_000, cancel.runAfter.getTime() - Date.now() + 5_000) : 30_000,
        };
      }
      return none("The parked item's cancel did not land; nothing was re-routed.");
    }
    if (state === "SUBMITTED") {
      // This re-route's rows are written and PayPal has not named its batch (the POST was paced or unanswered):
      // resume it with the same ids. The service posts only if the written rows are exactly this approval's.
      const [unposted] = (await tx.execute(sql`
        select pb.id from payout_items newer
          join payout_items old on old.id = newer.supersedes_item_id and old.workspace_id = newer.workspace_id
          join payout_batches pb on pb.id = newer.batch_id and pb.workspace_id = newer.workspace_id
         where newer.workspace_id = ${scope.workspaceId} and newer.line_id = ${args.lineId}
           and old.payout_item_id = ${note.reroute.payoutItemId}
           and pb.status = 'SUBMITTED' and pb.paypal_batch_id is null
         limit 1`)) as unknown as { id: string }[];
      if (!unposted) return none("This line's re-route is already with PayPal.");
    } else if (state !== "RETURNED") {
      return none("Only a returned line can be re-routed.");
    }
    return {
      go: true,
      note,
      approval: {
        role: "treasurer",
        keyId: row.keyId,
        publicKeyHex: key.publicKeyHex,
        payload,
        signatureHex: row.signature,
      },
    };
  });
}

/**
 * The reroute task {lineId, n}, one row per signed re-route: RETURNED → REROUTED, then `PayoutsService.reroute`
 * posts the one-item batch. PayPal's pacing, an unanswered POST or a cancel still on its way re-queue the row as a
 * fresh attempt that honours the wait (`deferTask`), so a re-route is never abandoned to the outbox's two-minute
 * retry budget; a refusal (a kill switch before the write, a guard, a newer press) finishes it with nothing sent.
 */
export function rerouteTasks(deps: AppDeps): TaskHandlers {
  return {
    reroute: async (raw, ctx) => {
      const args = TASKS.reroute.args.parse(raw);
      const wait = async (step: PayPalStepError): Promise<boolean> => {
        const attempts = await attemptsOf(deps.db, ctx.outboxId);
        const next = await deferTask(deps.db, ctx, raw, deferDelayMs(step.opts.retryAfterMs, attempts));
        if (!next) return false;
        report(ctx.outboxId, {
          ok: false,
          code: step.code,
          message: step.message,
          debugId: step.opts.debugId ?? null,
          retryAfterMs: Math.max(1_000, next.runAfter.getTime() - Date.now()),
        });
        return true;
      };
      try {
        if (!ctx.workspaceId) throw new Error("reroute needs its workspace");
        const scope = systemScope(ctx.workspaceId, ACTORS.outbox);
        const prepared = await prepareReroute(deps, scope, args, ctx.outboxId);
        if (!prepared.go) {
          throw new PayPalStepError(prepared.code, prepared.message, {
            transient: prepared.wait,
            ...(prepared.retryAfterMs ? { retryAfterMs: prepared.retryAfterMs } : {}),
          });
        }
        // A replayed item is re-routed on the replay rail; a live one through the judge lane, never replayed.
        const [returned] = await deps.db
          .select({ provenance: schema.payoutItems.provenance, runId: schema.memberLines.runId })
          .from(schema.payoutItems)
          .innerJoin(schema.memberLines, eq(schema.memberLines.id, schema.payoutItems.lineId))
          .where(
            and(
              eq(schema.payoutItems.workspaceId, scope.workspaceId),
              eq(schema.payoutItems.payoutItemId, prepared.note.reroute.payoutItemId),
            ),
          );
        const rail = returned
          ? await railForItem(deps, {
              workspaceId: scope.workspaceId,
              runId: returned.runId,
              step: "resend",
              itemProvenance: returned.provenance,
            })
          : ({ kind: "live", deps, end: async () => undefined } as const);
        if (rail.kind === "queued") throw new LaneQueued(rail);
        if (rail.kind === "refused") throw notReplayable(rail.decision);
        let outcome: Awaited<ReturnType<PayoutsService["reroute"]>>;
        try {
          // rows written and resumed later: C-21 again at this POST, which it is then counted from (D7)
          await guardResumedReroute(rail.deps, scope, {
            lineId: args.lineId,
            supersedesItemId: prepared.note.reroute.payoutItemId,
          });
          const service = await payoutsServiceFor(rail.deps, scope);
          outcome = await service.reroute({
            supersedesItemId: prepared.note.reroute.payoutItemId,
            rerouteNo: args.n,
            receiver: prepared.note.reroute.receiver,
            approvals: [prepared.approval],
          });
        } finally {
          if (rail.kind === "live") await rail.end();
        }
        if (outcome.kind === "unresolved") {
          throw new PayPalStepError("QUEUED", `The re-route POST is unresolved (${outcome.reason}).`, {
            transient: true,
            retryAfterMs: 30_000,
            debugId: outcome.debugId,
          });
        }
        if (outcome.kind === "refused") {
          const code = outcome.code;
          const paced = code === "CIRCUIT_OPEN" || code === "QUEUED";
          throw new PayPalStepError(
            code === "KILL_SWITCH_ON" || code === "CIRCUIT_OPEN" || code === "QUEUED"
              ? code
              : "INVALID_TRANSITION",
            outcome.reason,
            paced
              ? { transient: true, retryAfterMs: outcome.code === "CIRCUIT_OPEN" ? 6 * 60_000 : 30_000 }
              : { transient: false },
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
        if (step.opts.transient && (await wait(step))) return;
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
