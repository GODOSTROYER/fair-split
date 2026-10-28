// "Ipasusi pag-usab" (M-MB-01 Pangutana, RA 9520 Art. 43): a member asks the Mediation and Conciliation
// Committee to re-check their line, optionally naming a slip and adding a note. The request is a row in
// `review_requests` and an attributed ledger entry in the same transaction (S3.12: free text goes to the row,
// the chain keeps only the note's `noteSha256`), so a member's request can never silently disappear.
//
// The public Proof publishes the workspace's ledger, so `noteSha256` is a salted commitment, sha256(salt ‖ note)
// with a salt only this server can derive (../ledger/commitments.ts): no dictionary of short complaints opens it.
// The line's own readers get the salt with the request (`ReviewOpening`) and check the chain entry themselves.
//
// Who may ask: the member about their own line (paired phone or frame), a judge acting as the member, and the
// treasurer or clerk filing on a member's behalf at the bodega (recorded as themselves). The Chair and the brand
// receive requests; they do not file them. A read-only member link cannot act (the shell refuses it).
import { type ReviewRequestDTO, type Role, Sha256Hex, Uuid } from "@fairsplit/contracts";
import { appendLedger, type DbOrTx, schema, type WorkspaceScope, withWorkspaceTx } from "@fairsplit/db";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { ActingCredential } from "../credentials/verify/index.js";
import { type CommitmentSubject, commitText } from "../ledger/commitments.js";
import type { AppDeps } from "../lib/context.js";
import { problem } from "../lib/problem.js";
import { takeReviewRequest } from "../proof/limits.js";
import { loadStatementContext } from "./facts.js";

export const REVIEW_LEDGER_KIND = "review.requested";

/** Roles that may file a re-check request (a member only about their own line). */
export const REVIEW_ROLES: readonly Role[] = ["member", "judge", "treasurer", "clerk"];

const STATE_DTO = { OPEN: "open", ANSWERED: "answered", CLOSED: "closed" } as const;

export interface ReviewInput {
  lineId: string;
  slipSerial?: string | undefined;
  note?: string | undefined;
}

/**
 * How a line's reader checks a request's chain entry with plain sha256:
 * sha256(salt ‖ utf8(note)) = the `noteSha256` of entry `ledgerSeq`.
 */
export const ReviewOpening = z.strictObject({
  reviewRequestId: Uuid,
  /** The `review.requested` entry in the workspace's chain (the public Proof's ledger segment carries it). */
  ledgerSeq: z.int().positive().nullable(),
  /** The commitment the entry records; null when the request has no note. */
  noteSha256: Sha256Hex.nullable(),
  /** Opens this one commitment and nothing else. */
  saltHex: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
});
export type ReviewOpening = z.infer<typeof ReviewOpening>;

type Keys = Pick<AppDeps["credentials"], "keys">;

function noteSubject(workspaceId: string, reviewRequestId: string): CommitmentSubject {
  return { purpose: "review.note", workspaceId, subjectId: reviewRequestId };
}

/** Creates (or returns the identical open) request. Throws FORBIDDEN / NOT_FOUND / VALIDATION_FAILED. */
export async function createReviewRequest(
  db: DbOrTx,
  credential: ActingCredential,
  scope: WorkspaceScope,
  input: ReviewInput,
  deps: Pick<AppDeps, "rateLimits"> & { credentials: Keys },
): Promise<ReviewRequestDTO> {
  if (!REVIEW_ROLES.includes(credential.role)) {
    throw problem.forbidden(
      "Only the member (or the treasurer or clerk on their behalf) can ask for a re-check.",
    );
  }
  const ctx = await loadStatementContext(db, scope.workspaceId, input.lineId);
  if (!ctx) throw problem.notFound("No such line in this workspace.");
  if (credential.role === "member" && (credential.kind === "frame" || credential.kind === "device")) {
    if (!credential.memberId || credential.memberId.toLowerCase() !== ctx.memberId.toLowerCase()) {
      throw problem.forbidden("A member can ask for a re-check of their own line only.");
    }
  }
  const slipSerial = input.slipSerial ?? null;
  if (slipSerial !== null && !ctx.facts.slipSerials.includes(slipSerial)) {
    throw problem.validation("That slip is not one of this line's slips.", [
      { path: "body.slipSerial", message: `slip ${slipSerial} is not on this line`, code: "not_on_line" },
    ]);
  }
  const note = input.note?.trim() ?? "";

  // withWorkspaceTx takes the workspace lock before anything else, so this check-then-insert is serialised with
  // every other writer of the workspace: a second request (any Idempotency-Key) reads the first one's committed
  // row and returns it, never files beside it.
  return withWorkspaceTx(db, scope, async (tx) => {
    // The identical open request already exists: return it (a double tap files once).
    const open = await tx
      .select()
      .from(schema.reviewRequests)
      .where(
        and(
          eq(schema.reviewRequests.workspaceId, scope.workspaceId),
          eq(schema.reviewRequests.lineId, ctx.facts.lineId),
          eq(schema.reviewRequests.state, "OPEN"),
          eq(schema.reviewRequests.message, note),
        ),
      );
    const recorded = await requestedEntries(
      tx,
      scope.workspaceId,
      open.map((r) => r.id),
    );
    const same = open.find((r) => (recorded.get(r.id)?.slipSerial ?? null) === slipSerial);
    if (same) return toDto(same, ctx.facts.memberNo, slipSerial);
    takeReviewRequest(deps, scope.workspaceId, ctx.facts.lineId);

    const [row] = await tx
      .insert(schema.reviewRequests)
      .values({
        workspaceId: scope.workspaceId,
        lineId: ctx.facts.lineId,
        memberId: ctx.memberId,
        message: note,
        state: "OPEN",
        provenance: "live",
      })
      .returning();
    if (!row) throw problem.internal("The re-check request was not stored.");
    const noteSha256 = note
      ? commitText(deps.credentials.keys, noteSubject(scope.workspaceId, row.id), note).sha256
      : null;
    await appendLedger(tx, scope, {
      kind: REVIEW_LEDGER_KIND,
      runId: ctx.runId,
      payload: {
        reviewRequestId: row.id,
        runId: ctx.runId,
        lineId: ctx.facts.lineId,
        memberNo: ctx.facts.memberNo,
        slipSerial,
        noteSha256,
      },
    });
    return toDto(row, ctx.facts.memberNo, slipSerial);
  });
}

interface RecordedRequest {
  seq: number;
  slipSerial: string | null;
  noteSha256: string | null;
}

/** What the chain recorded for each review request (the table has no serial column; the entry has it). */
async function requestedEntries(
  db: DbOrTx,
  workspaceId: string,
  ids: readonly string[],
): Promise<Map<string, RecordedRequest>> {
  const out = new Map<string, RecordedRequest>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ seq: schema.ledgerEntries.seq, payload: schema.ledgerEntries.payload })
    .from(schema.ledgerEntries)
    .where(
      and(
        eq(schema.ledgerEntries.workspaceId, workspaceId),
        eq(schema.ledgerEntries.kind, REVIEW_LEDGER_KIND),
      ),
    );
  const wanted = new Set(ids);
  for (const r of rows) {
    const p = r.payload as { reviewRequestId?: unknown; slipSerial?: unknown; noteSha256?: unknown };
    if (typeof p.reviewRequestId === "string" && wanted.has(p.reviewRequestId)) {
      out.set(p.reviewRequestId, {
        seq: Number(r.seq),
        slipSerial: typeof p.slipSerial === "string" ? p.slipSerial : null,
        noteSha256: typeof p.noteSha256 === "string" ? p.noteSha256 : null,
      });
    }
  }
  return out;
}

/**
 * A line's re-check requests, oldest first, each with the opening of its chain entry. Only for readers of the
 * line (its member and the officers), who may read the notes anyway: the salt adds nothing they could not see.
 */
export async function listReviewRequests(
  db: DbOrTx,
  credentials: Keys,
  workspaceId: string,
  lineId: string,
  memberNo: string,
): Promise<{ reviewRequests: ReviewRequestDTO[]; openings: ReviewOpening[] }> {
  const rows = await db
    .select()
    .from(schema.reviewRequests)
    .where(and(eq(schema.reviewRequests.workspaceId, workspaceId), eq(schema.reviewRequests.lineId, lineId)))
    .orderBy(asc(schema.reviewRequests.createdAt));
  const recorded = await requestedEntries(
    db,
    workspaceId,
    rows.map((r) => r.id),
  );
  return {
    reviewRequests: rows.map((r) => toDto(r, memberNo, recorded.get(r.id)?.slipSerial ?? null)),
    openings: rows.map((r) => {
      const entry = recorded.get(r.id);
      const opened = r.message
        ? commitText(credentials.keys, noteSubject(workspaceId, r.id), r.message)
        : null;
      // offered only when it really opens the recorded commitment (a rotated key leaves it unopenable)
      const opens = opened !== null && entry?.noteSha256 === opened.sha256;
      return {
        reviewRequestId: r.id,
        ledgerSeq: entry?.seq ?? null,
        noteSha256: entry?.noteSha256 ?? null,
        saltHex: opens ? opened.saltHex : null,
      };
    }),
  };
}

type ReviewRow = typeof schema.reviewRequests.$inferSelect;

function toDto(row: ReviewRow, memberNo: string, slipSerial: string | null): ReviewRequestDTO {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    lineId: row.lineId,
    memberNo,
    slipSerial,
    note: row.message ? row.message : null,
    state: STATE_DTO[row.state as keyof typeof STATE_DTO] ?? "open",
    answer: row.answer ?? null,
    createdAt: row.createdAt.toISOString(),
    provenance: row.provenance as ReviewRequestDTO["provenance"],
  };
}
