// "Ipasusi pag-usab" (M-MB-01 Pangutana, RA 9520 Art. 43): a member asks the Mediation and Conciliation
// Committee to re-check their line, optionally naming a slip and adding a note. The request is a row in
// `review_requests` and an attributed ledger entry in the same transaction (S3.12: free text goes to the row,
// the chain keeps only the note's sha256), so a member's request can never silently disappear.
//
// Who may ask: the member about their own line (paired phone or frame), a judge acting as the member, and the
// treasurer or clerk filing on a member's behalf at the bodega (recorded as themselves). The Chair and the brand
// receive requests; they do not file them. A read-only member link cannot act (the shell refuses it).
import { createHash } from "node:crypto";
import type { ReviewRequestDTO, Role } from "@fairsplit/contracts";
import { appendLedger, type DbOrTx, schema, type WorkspaceScope, withWorkspaceTx } from "@fairsplit/db";
import { and, asc, eq } from "drizzle-orm";
import type { ActingCredential } from "../credentials/verify/index.js";
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

export function noteSha256(note: string): string {
  return createHash("sha256").update(note, "utf8").digest("hex");
}

/** Creates (or returns the identical open) request. Throws FORBIDDEN / NOT_FOUND / VALIDATION_FAILED. */
export async function createReviewRequest(
  db: DbOrTx,
  credential: ActingCredential,
  scope: WorkspaceScope,
  input: ReviewInput,
  limits?: Pick<AppDeps, "rateLimits">,
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
  const noteHash = note ? noteSha256(note) : null;

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
    const serials = await requestedSerials(
      tx,
      scope.workspaceId,
      open.map((r) => r.id),
    );
    const same = open.find((r) => (serials.get(r.id) ?? null) === slipSerial);
    if (same) return toDto(same, ctx.facts.memberNo, slipSerial);
    if (limits) takeReviewRequest(limits, scope.workspaceId, ctx.facts.lineId);

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
    await appendLedger(tx, scope, {
      kind: REVIEW_LEDGER_KIND,
      runId: ctx.runId,
      payload: {
        reviewRequestId: row.id,
        runId: ctx.runId,
        lineId: ctx.facts.lineId,
        memberNo: ctx.facts.memberNo,
        slipSerial,
        noteSha256: noteHash,
      },
    });
    return toDto(row, ctx.facts.memberNo, slipSerial);
  });
}

/** Slip serials of review requests, from their ledger entries (the table has no serial column). */
async function requestedSerials(
  db: DbOrTx,
  workspaceId: string,
  ids: readonly string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ payload: schema.ledgerEntries.payload })
    .from(schema.ledgerEntries)
    .where(
      and(
        eq(schema.ledgerEntries.workspaceId, workspaceId),
        eq(schema.ledgerEntries.kind, REVIEW_LEDGER_KIND),
      ),
    );
  const wanted = new Set(ids);
  for (const r of rows) {
    const p = r.payload as { reviewRequestId?: unknown; slipSerial?: unknown };
    if (typeof p.reviewRequestId === "string" && wanted.has(p.reviewRequestId)) {
      out.set(p.reviewRequestId, typeof p.slipSerial === "string" ? p.slipSerial : null);
    }
  }
  return out;
}

/** A line's re-check requests, oldest first. */
export async function listReviewRequests(
  db: DbOrTx,
  workspaceId: string,
  lineId: string,
  memberNo: string,
): Promise<ReviewRequestDTO[]> {
  const rows = await db
    .select()
    .from(schema.reviewRequests)
    .where(and(eq(schema.reviewRequests.workspaceId, workspaceId), eq(schema.reviewRequests.lineId, lineId)))
    .orderBy(asc(schema.reviewRequests.createdAt));
  const serials = await requestedSerials(
    db,
    workspaceId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toDto(r, memberNo, serials.get(r.id) ?? null));
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
