// Two keys (I6, MM-5). A person approves the irreversible step: the treasurer signs the batch, and the Chair
// co-signs when R5 asks for her (a batch over US$300, a line over US$150, any override).
//
//   approvalPayload  GET  the register §8 JCS payload for one role, built by code from the database batch,
//                         with a fresh server nonce and exp = now + 30 min. Refused (INVALID_TRANSITION,
//                         details.unpayable), like submitApproval, while a PayPal member has no receiver.
//   submitApproval   POST verifies, in the domain's order (`expectedSigner`, `checkApproval`): the key is the
//                         registered, unrevoked device key for the role (never a seeded or presented key);
//                         the credential holds that key (a judge signs only with a labelled demo key); the
//                         payload names that approver, role and season and the batch recomputed NOW; exp is
//                         ahead and within 30 minutes; the nonce was never used (used-nonce store: every
//                         approval row, voided ones included, plus UNIQUE(nonce)); the Ed25519 signature
//                         verifies against the registry key; the two signers are two people with two keys.
//                         Then, in one transaction: the approval row, `key.registered` (once per key) and
//                         `approval.signed` ledger entries, the IC-01 event, the run's move, and at APPROVED
//                         the lines LOCKED and the `postPayoutBatch` task (I7).
//   declineApproval  POST the Chair (or the treasurer withdrawing) sends the run back: live approvals voided,
//                         the reason kept as a note hash, run → IN_REVIEW.
import { randomBytes } from "node:crypto";
import {
  type ApprovalRole,
  type ErrorCode,
  type OfficerKey,
  type PayRunState,
  type SignedApproval,
  TASKS,
} from "@fairsplit/contracts";
import {
  type DbOrTx,
  isUniqueViolation,
  schema,
  type Tx,
  type WorkspaceScope,
  withWorkspaceTx,
} from "@fairsplit/db";
import {
  APPROVAL_MAX_TTL_MS,
  type ApprovalExpectation,
  approvalJcs,
  buildApprovalPayload,
  checkApproval,
  expectedSigner,
} from "@fairsplit/domain";
import { enqueue } from "@fairsplit/outbox";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { ActingCredential } from "../credentials/verify/index.js";
import { type CommandHandler, reply } from "../lib/command.js";
import type { AppDeps } from "../lib/context.js";
import { ApiProblem, problem } from "../lib/problem.js";
import { receiverDirectory } from "../money/receivers.js";
import { personaId } from "../runs/access.js";
import { dbApprovalRoleOf } from "../runs/codes.js";
import { approvalDto } from "../runs/dto.js";
import { emit, factLedger, noteSha256, proofLedger } from "../runs/events.js";
import { assertNotKilled, unlockLines, voidLiveApprovals } from "../runs/flags.js";
import { casGuard, invalidTransition, lockRun, runBySlug } from "../runs/load.js";
import { cause, moveLine, moveRun, type RunRow } from "../runs/machine.js";
import { type RunBatch, runBatch, SIGNABLE_IN } from "./batch.js";
import { officerFor, officerRegistry } from "./registry.js";

const ROLE_NOUN: Readonly<Record<ApprovalRole, string>> = { treasurer: "treasurer", chair: "Chair" };
/** Which credential roles may act for an approval role (the judge acts as either officer). */
const MAY_ACT: Readonly<Record<ApprovalRole, readonly string[]>> = {
  treasurer: ["treasurer", "judge"],
  chair: ["board", "judge"],
};

function refuse(code: ErrorCode, message: string, details?: Record<string, unknown>): ApiProblem {
  return new ApiProblem(code, message, details ? { details } : {});
}

function mayAct(credential: ActingCredential, role: ApprovalRole): void {
  if (!MAY_ACT[role].includes(credential.role)) {
    throw problem.forbidden(`Only the ${ROLE_NOUN[role]} can do that.`);
  }
}

function blockingProblem(batch: RunBatch): ApiProblem {
  const labels = batch.blocking.map((h) => h.code ?? h.kind);
  return refuse("BLOCKING_HOLDS_OPEN", `Approval waits for ${labels.join(", ")}.`, {
    holds: batch.blocking.map((h) => ({ id: h.id, label: h.code ?? h.kind })),
  });
}

/**
 * S3.6.4 step 4: a member PayPal cannot be told about is a visible refusal, never a silent omission. Signing
 * the batch without them would leave their line READY on-rail forever while the run settles (I3).
 */
function unpayableProblem(state: PayRunState, batch: RunBatch): ApiProblem {
  const who = batch.unpayable.join(", ");
  return refuse(
    "INVALID_TRANSITION",
    `No PayPal receiver is configured for ${who}: the batch would leave them unpaid. Nothing can be signed until the operator adds the address.`,
    { runState: state, unpayable: batch.unpayable },
  );
}

export function receiversOf(deps: Pick<AppDeps, "env">) {
  return receiverDirectory(deps.env.paypal);
}

// ---------------------------------------------------------------- approvalPayload

export const approvalPayloadHandler: CommandHandler<"approvalPayload"> = async (ctx) => {
  const { deps, scope } = ctx;
  const role = ctx.input.role;
  mayAct(ctx.credential, role);
  const run = await runBySlug(deps.db, scope, ctx.params.runSlug);
  const batch = await runBatch(deps.db, scope, run, receiversOf(deps));
  if (batch.blocking.length > 0) throw blockingProblem(batch);
  if (!SIGNABLE_IN[role].includes(run.state as PayRunState)) {
    throw invalidTransition(
      run.state as PayRunState,
      `The run is ${run.state}: nothing for the ${ROLE_NOUN[role]} to sign.`,
    );
  }
  if (batch.unpayable.length > 0) throw unpayableProblem(run.state as PayRunState, batch);
  if (!batch.digest) {
    throw invalidTransition(
      run.state as PayRunState,
      "No line is payable through PayPal: there is no batch to sign.",
    );
  }
  const approverId =
    ctx.credential.role === "judge" ? await officerFor(deps.db, scope, role) : personaId(ctx.credential);
  if (!approverId) throw problem.forbidden(`No ${ROLE_NOUN[role]} is registered in this workspace.`);
  const now = ctx.now();
  const payload = buildApprovalPayload({
    runId: run.id,
    seasonId: run.seasonId,
    rateCardSha256: run.rateCardSha256,
    batch: batch.digest,
    role,
    approverId,
    nonce: randomBytes(16).toString("hex"),
    exp: new Date(now.getTime() + APPROVAL_MAX_TTL_MS).toISOString(),
  });
  return { payload, jcs: approvalJcs(payload) };
};

// ---------------------------------------------------------------- submitApproval

/** Every nonce ever spent in this workspace: signed approvals, voided ones included (the used-nonce store). */
async function usedNonces(db: DbOrTx, scope: WorkspaceScope): Promise<Set<string>> {
  const rows = await db
    .select({ nonce: schema.approvals.nonce })
    .from(schema.approvals)
    .where(and(eq(schema.approvals.workspaceId, scope.workspaceId), isNotNull(schema.approvals.nonce)));
  return new Set(rows.map((r) => r.nonce as string));
}

/** `key.registered` before the key's first signature (Proof plate 5 takes public keys from the ledger only). */
async function ensureKeyInLedger(
  tx: DbOrTx,
  scope: WorkspaceScope,
  key: OfficerKey,
  at: Date,
): Promise<void> {
  const L = schema.ledgerEntries;
  const [seen] = await tx
    .select({ id: L.id })
    .from(L)
    .where(
      and(
        eq(L.workspaceId, scope.workspaceId),
        eq(L.kind, "key.registered"),
        sql`${L.payload}->>'keyId' = ${key.keyId}`,
      ),
    )
    .limit(1);
  if (seen) return;
  await proofLedger(
    tx,
    scope,
    "key.registered",
    { keyId: key.keyId, persona: key.approverId, kind: key.kind, publicKeyHex: key.publicKeyHex },
    { at, actor: { kind: "system", id: "system:keys", impersonatedBy: null } },
  );
}

/** Moves a freshly APPROVED run's lines (PayPal lines READY → LOCKED) and enqueues the POST (I7). */
async function approve(tx: Tx, scope: WorkspaceScope, run: RunRow, batch: RunBatch): Promise<void> {
  for (const item of batch.items) {
    const [line] = await tx
      .select({ state: schema.memberLines.state, version: schema.memberLines.version })
      .from(schema.memberLines)
      .where(
        and(eq(schema.memberLines.workspaceId, scope.workspaceId), eq(schema.memberLines.id, item.lineId)),
      );
    if (line?.state !== "READY") continue;
    await moveLine(tx, scope, {
      id: item.lineId,
      memberNo: item.memberNo,
      runId: run.id,
      from: "READY",
      to: "LOCKED",
      version: line.version,
      cause: cause("APPROVED", batch.digest?.batchSha256 ?? null),
      provenance: "live",
    });
  }
  const args = { runId: run.id, senderBatchId: batch.senderBatchId };
  // One POST per approval generation: a run sent back and approved again posts the newly signed batch.
  await enqueue(tx, "postPayoutBatch", args, `${TASKS.postPayoutBatch.dedupeKey(args)}:v${run.version}`, {
    workspaceId: scope.workspaceId,
  });
}

export const submitApprovalHandler: CommandHandler<"submitApproval"> = async (ctx) => {
  const { deps, scope } = ctx;
  const { role, keyId, signature, payload } = ctx.input;
  mayAct(ctx.credential, role);
  const at = ctx.now();
  return casGuard(
    () =>
      withWorkspaceTx(deps.db, scope, async (tx) => {
        const found = await runBySlug(tx, scope, ctx.params.runSlug);
        let run = await lockRun(tx, scope, found.id);
        await assertNotKilled(deps, scope.workspaceId, "kill_payouts", tx);
        const batch = await runBatch(tx, scope, run, receiversOf(deps));
        if (batch.blocking.length > 0) throw blockingProblem(batch);
        if (!SIGNABLE_IN[role].includes(run.state as PayRunState)) {
          throw invalidTransition(
            run.state as PayRunState,
            `The run is ${run.state}: the ${ROLE_NOUN[role]} cannot sign now.`,
          );
        }
        if (batch.unpayable.length > 0) throw unpayableProblem(run.state as PayRunState, batch);
        if (!batch.digest) throw invalidTransition(run.state as PayRunState, "There is no batch to sign.");

        // 1. The signer is the registry's key for this role (never a presented or seeded key).
        const registry = await officerRegistry(tx, scope);
        const lookup = expectedSigner(registry, role, keyId, at);
        if (!lookup.ok) throw refuse("KEY_NOT_REGISTERED", lookup.reason);
        const signer = lookup.signer;
        const officer = registry.find((k) => k.keyId === signer.keyId) as OfficerKey;
        // 2. The credential holds that key: a person signs only with their own; a judge only with a demo key.
        if (ctx.credential.role === "judge") {
          if (officer.kind !== "web_demo") {
            throw refuse(
              "APPROVER_MISMATCH",
              "In Judge Mode you sign with a labelled demo key, never an officer's own key.",
            );
          }
        } else if (signer.approverId !== personaId(ctx.credential)) {
          throw refuse("APPROVER_MISMATCH", `${keyId} belongs to someone else; sign with your own key.`);
        }
        // 3. Two people with two keys.
        const live = await tx
          .select()
          .from(schema.approvals)
          .where(
            and(
              eq(schema.approvals.workspaceId, scope.workspaceId),
              eq(schema.approvals.runId, run.id),
              eq(schema.approvals.decision, "SIGNED"),
              isNull(schema.approvals.voidedAt),
            ),
          );
        for (const other of live) {
          const sameRole = other.role === dbApprovalRoleOf(role);
          const otherKey = registry.find((k) => k.keyId === other.keyId);
          if (
            sameRole ||
            other.keyId === signer.keyId ||
            other.approverId === signer.approverId ||
            otherKey?.publicKeyHex === signer.publicKeyHex
          ) {
            throw refuse(
              "SIGNERS_NOT_DISTINCT",
              "The treasurer and the Chair must be two people with two keys.",
            );
          }
        }
        // 4. The payload signs exactly this batch, now; unexpired; unused nonce; a valid signature.
        const expected: ApprovalExpectation = {
          ...signer,
          runId: run.id,
          seasonId: run.seasonId,
          rateCardSha256: run.rateCardSha256,
          batchSha256: batch.digest.batchSha256,
          itemCount: batch.digest.itemCount,
          totalCents: batch.digest.totalCents,
          role,
        };
        const signed: SignedApproval = {
          role,
          keyId,
          publicKeyHex: signer.publicKeyHex,
          payload,
          signatureHex: signature,
        };
        const check = checkApproval(signed, expected, at, await usedNonces(tx, scope));
        if (!check.ok) {
          throw refuse(
            check.code === "APPROVALS_MISSING" ? "INVALID_TRANSITION" : check.code,
            check.reason,
            check.code === "DIGEST_MISMATCH"
              ? { expected: batch.digest.batchSha256, got: payload.batchSha256 }
              : undefined,
          );
        }

        // The record (I6, S3.12), in the transaction that moves the run.
        await ensureKeyInLedger(tx, scope, officer, at);
        let row: typeof schema.approvals.$inferSelect | undefined;
        try {
          [row] = await tx
            .insert(schema.approvals)
            .values({
              workspaceId: scope.workspaceId,
              runId: run.id,
              role: dbApprovalRoleOf(role),
              decision: "SIGNED",
              approverId: signer.approverId,
              keyId,
              payloadJcs: approvalJcs(payload),
              signature,
              batchSha256: batch.digest.batchSha256,
              nonce: payload.nonce,
              exp: new Date(payload.exp),
              provenance: "live",
            })
            .returning();
        } catch (e) {
          if (isUniqueViolation(e)) throw refuse("NONCE_REUSED", "This approval was already used.");
          throw e;
        }
        if (!row) throw problem.internal("The approval was not stored.");
        const signerActor = {
          kind: "human" as const,
          id: signer.approverId,
          impersonatedBy: scope.actor.impersonatedBy ?? null,
        };
        await proofLedger(
          tx,
          scope,
          "approval.signed",
          {
            runId: run.id,
            role,
            keyId,
            approverId: signer.approverId,
            batchSha256: batch.digest.batchSha256,
            nonce: payload.nonce,
          },
          { runId: run.id, at, actor: signerActor },
        );
        await emit(
          tx,
          scope,
          "approval.signed",
          { approvalId: row.id, role, keyId, batchSha256: batch.digest.batchSha256 },
          { runId: run.id, provenance: "live", actor: signerActor },
        );

        let needsChair = false;
        const patch = { batchSha256: batch.digest.batchSha256, senderBatchId: batch.senderBatchId };
        if (role === "treasurer") {
          run = await moveRun(tx, scope, {
            id: run.id,
            from: "IN_REVIEW",
            to: "TREASURER_APPROVED",
            version: run.version,
            cause: cause("TREASURER_SIGNED", row.id),
            provenance: "live",
            actor: signerActor,
          });
          if (batch.chair.required) {
            run = await moveRun(tx, scope, {
              id: run.id,
              from: "TREASURER_APPROVED",
              to: "AWAITING_BOARD",
              version: run.version,
              cause: cause("NEEDS_CHAIR", batch.chair.reasons.join(",")),
              provenance: "live",
            });
            needsChair = true;
          } else {
            run = await moveRun(tx, scope, {
              id: run.id,
              from: "TREASURER_APPROVED",
              to: "APPROVED",
              version: run.version,
              cause: cause("WITHIN_THRESHOLD"),
              provenance: "live",
              patch,
            });
            await approve(tx, scope, run, batch);
          }
        } else {
          run = await moveRun(tx, scope, {
            id: run.id,
            from: "AWAITING_BOARD",
            to: "APPROVED",
            version: run.version,
            cause: cause("CHAIR_SIGNED", row.id),
            provenance: "live",
            actor: signerActor,
            patch,
          });
          await approve(tx, scope, run, batch);
        }
        return reply(201, { approval: approvalDto(row), runState: run.state as PayRunState, needsChair });
      }),
    "INVALID_TRANSITION",
  );
};

// ---------------------------------------------------------------- declineApproval

const DECLINABLE: readonly PayRunState[] = ["TREASURER_APPROVED", "AWAITING_BOARD", "APPROVED"];

export const declineApprovalHandler: CommandHandler<"declineApproval"> = async (ctx) => {
  const { deps, scope } = ctx;
  const { role, reason, keyId } = ctx.input;
  mayAct(ctx.credential, role);
  const at = ctx.now();
  const by = personaId(ctx.credential);
  return casGuard(
    () =>
      withWorkspaceTx(deps.db, scope, async (tx) => {
        const found = await runBySlug(tx, scope, ctx.params.runSlug);
        const run = await lockRun(tx, scope, found.id);
        if (!DECLINABLE.includes(run.state as PayRunState)) {
          throw invalidTransition(run.state as PayRunState, `The run is ${run.state}: nothing to decline.`);
        }
        if (role === "chair" && run.state !== "AWAITING_BOARD") {
          throw invalidTransition(
            run.state as PayRunState,
            "The Chair declines a batch waiting for her co-signature.",
          );
        }
        await voidLiveApprovals(tx, scope, run.id, at, `declined:${role}`);
        await tx.insert(schema.approvals).values({
          workspaceId: scope.workspaceId,
          runId: run.id,
          role: dbApprovalRoleOf(role),
          decision: "DECLINED",
          approverId: by,
          keyId: keyId ?? null,
          reason,
          provenance: "live",
        });
        await factLedger(
          tx,
          scope,
          "approval.declined",
          { runId: run.id, role, reasonSha256: noteSha256(reason) },
          { runId: run.id, at },
        );
        await emit(
          tx,
          scope,
          "approval.declined",
          { role, reason, by },
          { runId: run.id, provenance: "live" },
        );
        await unlockLines(tx, scope, run.id, "SEND_BACK");
        const moved = await moveRun(tx, scope, {
          id: run.id,
          from: run.state as PayRunState,
          to: "IN_REVIEW",
          version: run.version,
          cause: cause("SEND_BACK", `declined:${role}`),
          provenance: "live",
        });
        return { runState: moved.state as PayRunState };
      }),
    "INVALID_TRANSITION",
  );
};

/** For the batch route and M-BD-01: the items the payload signs, so the app recomputes batchSha256 itself. */
export async function batchView(deps: AppDeps, scope: WorkspaceScope, runSlug: string) {
  const run = await runBySlug(deps.db, scope, runSlug);
  const batch = await runBatch(deps.db, scope, run, receiversOf(deps));
  return {
    runSlug: run.runSlug,
    runId: run.id,
    runState: run.state as PayRunState,
    senderBatchId: batch.senderBatchId,
    rateCardSha256: run.rateCardSha256,
    items: batch.items.map(({ senderItemId, receiver, amountCents, currency, memberNo }) => ({
      senderItemId,
      receiver,
      amountCents,
      currency,
      memberNo,
    })),
    itemCount: batch.digest?.itemCount ?? 0,
    totalCents: batch.digest?.totalCents ?? 0,
    batchSha256: batch.digest?.batchSha256 ?? null,
    chairRequired: batch.chair.required,
    chairReasons: batch.chair.reasons,
    blocking: batch.blocking.map((h) => ({ id: h.id, label: h.code ?? h.kind })),
    unpayable: batch.unpayable,
    rail: deps.paypal.label,
  };
}
