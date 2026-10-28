// Scoped loaders: every read is filtered by the credential's workspace, so an id from a path can never reach
// another workspace's row (it simply looks absent: 404). Parsing of stored JSON (the ratified card's JCS) is
// done here once, with the contract schemas.
import {
  type Lot,
  type PayRunState,
  type RateCardCanonical,
  RateCardCanonical as RateCardCanonicalSchema,
  type RateCardRules,
  type RatifiedRateCard,
} from "@fairsplit/contracts";
import { type DbOrTx, schema, type WorkspaceScope } from "@fairsplit/db";
import { getSnapshot } from "@fairsplit/seed";
import { and, asc, eq } from "drizzle-orm";
import { ApiProblem, problem } from "../lib/problem.js";
import { toInt } from "./codes.js";
import { CasConflict, type RunRow } from "./machine.js";

export type SeasonRow = typeof schema.seasons.$inferSelect;
export type CardRow = typeof schema.rateCards.$inferSelect;
export type LotRow = typeof schema.lots.$inferSelect;
export type MemberRow = typeof schema.members.$inferSelect;
export type InvoiceRow = typeof schema.invoices.$inferSelect;

export async function runBySlug(db: DbOrTx, scope: WorkspaceScope, runSlug: string): Promise<RunRow> {
  const t = schema.payRuns;
  const [row] = await db
    .select()
    .from(t)
    .where(and(eq(t.workspaceId, scope.workspaceId), eq(t.runSlug, runSlug)))
    .limit(1);
  if (!row) throw problem.notFound("No such run in this workspace.");
  return row;
}

export async function runById(db: DbOrTx, scope: WorkspaceScope, id: string): Promise<RunRow> {
  const t = schema.payRuns;
  const [row] = await db
    .select()
    .from(t)
    .where(and(eq(t.workspaceId, scope.workspaceId), eq(t.id, id)))
    .limit(1);
  if (!row) throw problem.notFound("No such run in this workspace.");
  return row;
}

/** Locks the run row (FOR UPDATE) inside the caller's workspace transaction. */
export async function lockRun(tx: DbOrTx, scope: WorkspaceScope, id: string): Promise<RunRow> {
  const t = schema.payRuns;
  const [row] = await tx
    .select()
    .from(t)
    .where(and(eq(t.workspaceId, scope.workspaceId), eq(t.id, id)))
    .for("update");
  if (!row) throw problem.notFound("No such run in this workspace.");
  return row;
}

export async function seasonById(db: DbOrTx, scope: WorkspaceScope, id: string): Promise<SeasonRow> {
  const t = schema.seasons;
  const [row] = await db
    .select()
    .from(t)
    .where(and(eq(t.workspaceId, scope.workspaceId), eq(t.id, id)))
    .limit(1);
  if (!row) throw problem.notFound("No such season in this workspace.");
  return row;
}

export async function cardById(db: DbOrTx, scope: WorkspaceScope, id: string): Promise<CardRow> {
  const t = schema.rateCards;
  const [row] = await db
    .select()
    .from(t)
    .where(and(eq(t.workspaceId, scope.workspaceId), eq(t.id, id)))
    .limit(1);
  if (!row) throw problem.notFound("No such rate card in this workspace.");
  return row;
}

export async function lotById(db: DbOrTx, scope: WorkspaceScope, id: string | null): Promise<LotRow | null> {
  if (!id) return null;
  const t = schema.lots;
  const [row] = await db
    .select()
    .from(t)
    .where(and(eq(t.workspaceId, scope.workspaceId), eq(t.id, id)))
    .limit(1);
  return row ?? null;
}

export async function invoiceOfRun(
  db: DbOrTx,
  scope: WorkspaceScope,
  runId: string,
): Promise<InvoiceRow | null> {
  const t = schema.invoices;
  const [row] = await db
    .select()
    .from(t)
    .where(and(eq(t.workspaceId, scope.workspaceId), eq(t.runId, runId)))
    .limit(1);
  return row ?? null;
}

/** The ratified card's canonical form, parsed with the contract schema; null when the stored JCS is not one. */
export function canonicalOf(card: CardRow): RateCardCanonical | null {
  try {
    const parsed = RateCardCanonicalSchema.safeParse(JSON.parse(card.canonicalJcs));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** IC-02's RatifiedRateCard for a stored, ratified card (null for a draft or a non-canonical fixture). */
export async function ratifiedCard(
  db: DbOrTx,
  scope: WorkspaceScope,
  card: CardRow,
): Promise<RatifiedRateCard | null> {
  const canonical = canonicalOf(card);
  if (!canonical || !card.ratifiedAt) return null;
  const t = schema.ratifications;
  const rows = await db
    .select()
    .from(t)
    .where(and(eq(t.workspaceId, scope.workspaceId), eq(t.rateCardId, card.id)))
    .orderBy(asc(t.signedAt));
  const officers = getSnapshot().officers;
  return {
    canonical,
    sha256: card.sha256,
    rc8: card.sha256.slice(0, 8),
    sha16: card.sha256.slice(0, 16),
    ratifiedAt: card.ratifiedAt.toISOString(),
    ratifications: rows.map((r) => {
      const role = r.role.toUpperCase() === "CHAIR" ? ("CHAIR" as const) : ("SECRETARY" as const);
      return {
        role,
        name: officers.find((o) => o.persona === r.approverId)?.name ?? r.approverId,
        act: role === "CHAIR" ? ("ATTESTED" as const) : ("CERTIFIED" as const),
        at: r.signedAt.toISOString(),
      };
    }),
  };
}

/** R5 (who must co-sign): the ratified card's rule, else the season's stored thresholds (overrides always). */
export function cosignRule(season: SeasonRow, canonical: RateCardCanonical | null): RateCardRules["cosign"] {
  if (canonical) return canonical.rules.cosign;
  return {
    ruleId: "R5",
    batchOverCents: toInt(season.cosignBatchCents),
    lineOverCents: toInt(season.cosignLineCents),
    anyOverride: true,
  };
}

/** IC-02 `Lot` from the stored lot (the sack kind is a display word the schema does not store). */
export function lotOf(row: LotRow): Lot {
  const seedLot = getSnapshot().lot;
  return {
    lotCode: row.lotCode,
    shippedG: toInt(row.shippedG),
    grade1ShippedG: toInt(row.grade1ShippedG),
    sacks: row.sacks,
    sackKind: seedLot.lotCode === row.lotCode ? seedLot.sackKind : "sack",
    shippedOn: row.shippedOn ?? seedLot.shippedOn,
  };
}

/** A failed compare-and-set, as the API says it. */
export function conflictProblem(
  e: CasConflict,
  invalidCode: "INVALID_TRANSITION" | "VERSION_CONFLICT" = "VERSION_CONFLICT",
): ApiProblem {
  if (e.reason === "NOT_FOUND") return problem.notFound(`No such ${e.entity} in this workspace.`);
  if (e.reason === "ILLEGAL") {
    return new ApiProblem("INVALID_TRANSITION", "That state change is not allowed.", {
      details: { entity: e.entity, reason: e.message },
    });
  }
  return new ApiProblem(
    invalidCode,
    invalidCode === "VERSION_CONFLICT"
      ? "Someone changed this at the same moment. Reload and try again."
      : "That state change is not allowed now.",
    { details: { entity: e.entity, state: e.current?.state ?? null, version: e.current?.version ?? null } },
  );
}

/** Rethrows a CasConflict as the API problem; anything else unchanged. */
export async function casGuard<T>(
  fn: () => Promise<T>,
  invalidCode: "INVALID_TRANSITION" | "VERSION_CONFLICT" = "VERSION_CONFLICT",
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CasConflict) throw conflictProblem(e, invalidCode);
    throw e;
  }
}

export function invalidTransition(state: PayRunState, message: string): ApiProblem {
  return new ApiProblem("INVALID_TRANSITION", message, { details: { runState: state } });
}
