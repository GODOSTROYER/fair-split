// The rate card (I2: rules are frozen before facts).
//
// IC-01 `addDeduction` is MM-4 "Bolted": the edit is really attempted against the database, and the SQL
// trigger refuses it (`FS409 RATE_CARD_RATIFIED:<sha256>`), so the 409 the slab shows cites the hash the
// database itself holds. The refusal is a recorded act (S3.12): a `rate_card.edit_refused` ledger entry with
// the card hash and the hash of what was typed. A draft card never takes a typed-in rule either: Schedule A
// changes only by reading the board resolution again (AI-5), so that attempt is rolled back and refused.
//
// Ratification (W-TR-02): the Secretary certifies and the Chair attests; the second signature bolts the card
// (`ratified_at`) and appends `rate_card.ratified` (Proof plate 2).
import {
  IsoDate,
  IsoDateTime,
  Provenance,
  RateCardCanonical,
  RateCardDTO,
  Sha256Hex,
  Uuid,
} from "@fairsplit/contracts";
import { asDbError, schema, type WorkspaceScope, withWorkspaceTx } from "@fairsplit/db";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { ActingCredential } from "../credentials/verify/index.js";
import { commitText } from "../ledger/commitments.js";
import type { CommandHandler } from "../lib/command.js";
import type { AppDeps } from "../lib/context.js";
import { ApiProblem, problem } from "../lib/problem.js";
import { allow, CAN, personaId } from "./access.js";
import { provenanceOf } from "./codes.js";
import { factLedger, proofLedger } from "./events.js";
import { type CardRow, canonicalOf, cardById, ratifiedCard, seasonById } from "./load.js";

/** The card's ratification date as the season reads it (Asia/Manila is UTC+8, no DST). */
export function ratifiedOn(card: CardRow): string {
  const canonical = canonicalOf(card);
  if (canonical) return canonical.ratifiedOn;
  const at = card.ratifiedAt ?? card.createdAt;
  return new Date(at.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

class DraftCardEdit extends Error {}

export const addDeductionHandler: CommandHandler<"addDeduction"> = async (ctx) => {
  const { deps, scope, input } = ctx;
  const card = await cardById(deps.db, scope, ctx.params.id);
  const at = ctx.now();
  try {
    await withWorkspaceTx(deps.db, scope, async (tx) => {
      await tx.insert(schema.rateRules).values({
        workspaceId: scope.workspaceId,
        rateCardId: card.id,
        ruleId: "R99",
        kind: "DEDUCTION",
        category: "typed_in",
        basis: "NONE",
        params: {},
        sourceQuote: input.label,
        provenance: "live",
      });
      // A draft card accepted the row: roll it back. Typed-in rules never enter Schedule A.
      throw new DraftCardEdit();
    });
  } catch (err) {
    const refused = asDbError(err);
    if (refused?.code === "RATE_CARD_RATIFIED") {
      await withWorkspaceTx(deps.db, scope, (tx) =>
        factLedger(
          tx,
          scope,
          "rate_card.edit_refused",
          {
            rateCardId: card.id,
            rateCardSha256: refused.subject,
            labelSha256: commitText(
              deps.credentials.keys,
              { purpose: "rate_card.edit_refused", workspaceId: scope.workspaceId, subjectId: card.id },
              input.label,
            ).sha256,
            amountSha256: commitText(
              deps.credentials.keys,
              { purpose: "rate_card.edit_refused", workspaceId: scope.workspaceId, subjectId: card.id },
              input.amountText,
            ).sha256,
          },
          { at },
        ),
      );
      throw problem.rateCardRatified(
        { hash: refused.subject, rateCard: card.code, ratifiedOn: ratifiedOn(card) },
        err,
      );
    }
    if (err instanceof DraftCardEdit) {
      throw problem.validation(
        "Schedule A is read from the board resolution, never typed in. Read the resolution again to change it.",
        [{ path: "params.id", message: "the card is a draft", code: "draft_card" }],
      );
    }
    throw err;
  }
  throw problem.internal("The rate card write neither committed nor failed.");
};

// ---------------------------------------------------------------- reads and ratification

export const RateCardView = z.strictObject({
  id: Uuid,
  workspaceId: Uuid,
  seasonId: Uuid,
  code: z.string(),
  sha256: Sha256Hex,
  rc8: z.string(),
  sha16: z.string(),
  /** Null when the stored card is not a canonical Schedule A (fixtures). */
  canonical: RateCardCanonical.nullable(),
  ratifiedAt: IsoDateTime.nullable(),
  ratifiedOn: IsoDate.nullable(),
  /** True once ratified: every edit is refused with 409 RATE_CARD_RATIFIED. */
  bolted: z.boolean(),
  ratifications: z.array(z.strictObject({ role: z.string(), approverId: z.string(), signedAt: IsoDateTime })),
  /** IC-01 RateCardDTO when the card is ratified and canonical. */
  ratified: RateCardDTO.nullable(),
  provenance: Provenance,
});
export type RateCardView = z.infer<typeof RateCardView>;

export async function rateCardView(deps: AppDeps, scope: WorkspaceScope, id: string): Promise<RateCardView> {
  const card = await cardById(deps.db, scope, id);
  const rows = await deps.db
    .select()
    .from(schema.ratifications)
    .where(
      and(eq(schema.ratifications.workspaceId, scope.workspaceId), eq(schema.ratifications.rateCardId, id)),
    )
    .orderBy(asc(schema.ratifications.signedAt));
  const ratified = await ratifiedCard(deps.db, scope, card);
  return {
    id: card.id,
    workspaceId: card.workspaceId,
    seasonId: card.seasonId,
    code: card.code,
    sha256: card.sha256,
    rc8: card.sha256.slice(0, 8),
    sha16: card.sha256.slice(0, 16),
    canonical: canonicalOf(card),
    ratifiedAt: card.ratifiedAt ? card.ratifiedAt.toISOString() : null,
    ratifiedOn: card.ratifiedAt ? ratifiedOn(card) : null,
    bolted: card.ratifiedAt !== null,
    ratifications: rows.map((r) => ({
      role: r.role,
      approverId: r.approverId,
      signedAt: r.signedAt.toISOString(),
    })),
    ratified: ratified
      ? {
          ...ratified,
          id: card.id,
          workspaceId: card.workspaceId,
          seasonId: card.seasonId,
          provenance: provenanceOf(card.provenance),
        }
      : null,
    provenance: provenanceOf(card.provenance),
  };
}

export const RatifyRequest = z.strictObject({ role: z.enum(["SECRETARY", "CHAIR"]) });

/** One board signature; the second (Secretary and Chair both signed) bolts the card. */
export async function ratify(
  deps: AppDeps,
  scope: WorkspaceScope,
  credential: ActingCredential,
  id: string,
  role: "SECRETARY" | "CHAIR",
  at: Date,
): Promise<RateCardView> {
  allow(credential, CAN.ratify, "Ratifying the rate card");
  const approverId = personaId(credential);
  await withWorkspaceTx(deps.db, scope, async (tx) => {
    const [card] = await tx
      .select()
      .from(schema.rateCards)
      .where(and(eq(schema.rateCards.workspaceId, scope.workspaceId), eq(schema.rateCards.id, id)))
      .for("update");
    if (!card) throw problem.notFound("No such rate card in this workspace.");
    if (card.ratifiedAt) {
      throw problem.rateCardRatified({
        hash: card.sha256,
        rateCard: card.code,
        ratifiedOn: ratifiedOn(card),
      });
    }
    const canonical = canonicalOf(card);
    if (!canonical) throw problem.validation("Only a canonical Schedule A can be ratified.");
    await seasonById(tx, scope, card.seasonId);
    const existing = await tx
      .select()
      .from(schema.ratifications)
      .where(
        and(eq(schema.ratifications.workspaceId, scope.workspaceId), eq(schema.ratifications.rateCardId, id)),
      );
    if (existing.some((r) => r.role === role || r.approverId === approverId)) {
      throw new ApiProblem("VERSION_CONFLICT", "This board member or role already signed the card.", {
        details: { role },
      });
    }
    await tx.insert(schema.ratifications).values({
      workspaceId: scope.workspaceId,
      rateCardId: id,
      approverId,
      role,
      signedAt: at,
      provenance: "live",
    });
    await factLedger(tx, scope, "rate_card.signed", { rateCardSha256: card.sha256, role }, { at });
    const roles = new Set([...existing.map((r) => r.role), role]);
    if (roles.has("SECRETARY") && roles.has("CHAIR")) {
      await tx
        .update(schema.rateCards)
        .set({ ratifiedAt: at })
        .where(and(eq(schema.rateCards.workspaceId, scope.workspaceId), eq(schema.rateCards.id, id)));
      await proofLedger(
        tx,
        scope,
        "rate_card.ratified",
        { rateCardSha256: card.sha256, resolutionNo: canonical.resolutionNo, ratifiedAt: at.toISOString() },
        { at },
      );
    }
  });
  return rateCardView(deps, scope, id);
}
