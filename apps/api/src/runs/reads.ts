// Reads for the console's run and season screens (W-TR-01…09). Every read is scoped by the credential's
// workspace and returns IC-01 DTOs (amounts in integer cents, provenance on every row, I8). The schemas here
// document the slice's extra routes in the OpenAPI document and are checked on every response.
import {
  ApprovalDTO,
  ApprovalPayload,
  HoldDTO,
  InvoiceStatus,
  IsoDate,
  IsoDateTime,
  LineCanonical,
  MemberLineDTO,
  PayRun,
  PayRunState,
  Provenance,
  RunSlug,
  RunStripStep,
  SeasonCode,
  SeasonLabel,
  Sha256Hex,
  SlipFieldDTO,
  SlipSerial,
  SystemFlagDTO,
  SystemFlagName,
  Uuid,
} from "@fairsplit/contracts";
import { type DbOrTx, schema, type WorkspaceScope } from "@fairsplit/db";
import { runMachine } from "@fairsplit/domain";
import { getSnapshot } from "@fairsplit/seed";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { AppDeps } from "../lib/context.js";
import { problem } from "../lib/problem.js";
import { iso, provenanceOf, toInt } from "./codes.js";
import { approvalDto, fieldDto, holdDto, lineWithCanonicalDto } from "./dto.js";
import { flagDto } from "./flags.js";
import { cardById, invoiceOfRun, runBySlug } from "./load.js";
import type { RunRow } from "./machine.js";

// ---------------------------------------------------------------- schemas

export const RunStrip = z.array(z.strictObject({ step: RunStripStep, done: z.boolean() }));

export const RunView = z.strictObject({
  run: PayRun,
  invoice: z
    .strictObject({
      invoiceNumber: z.string(),
      paypalInvoiceId: z.string().nullable(),
      status: InvoiceStatus.nullable(),
      amountCents: z.int().nonnegative(),
      dueCents: z.int().nonnegative().nullable(),
      sentAt: IsoDateTime.nullable(),
      autoCancelOn: IsoDate.nullable(),
      fundedAt: IsoDateTime.nullable(),
      payerViewUrl: z.string().nullable(),
      provenance: Provenance,
    })
    .nullable(),
  strip: RunStrip,
  holds: z.strictObject({
    open: z.int().nonnegative(),
    blocking: z.int().nonnegative(),
    total: z.int().nonnegative(),
  }),
  /** Line count per state: replayed lines use STATE_REPLAY and never inflate the live count. */
  lines: z.record(z.string(), z.int().nonnegative()),
  approvals: z.array(ApprovalDTO),
  /** I8: the PayPal rail this server runs on. */
  rail: z.enum(["simulated", "sandbox"]),
});

export const HoldList = z.strictObject({
  runSlug: RunSlug,
  runVersion: z.int().nonnegative(),
  holds: z.array(HoldDTO),
});
export const LineList = z.strictObject({
  runSlug: RunSlug,
  lines: z.array(MemberLineDTO.extend({ canonical: LineCanonical })),
});
export const ApprovalList = z.strictObject({ runSlug: RunSlug, approvals: z.array(ApprovalDTO) });
export const FlagList = z.strictObject({ flags: z.array(SystemFlagDTO) });

export const BatchView = z.strictObject({
  runSlug: RunSlug,
  runId: Uuid,
  runState: PayRunState,
  senderBatchId: z.string(),
  rateCardSha256: Sha256Hex,
  items: z.array(
    z.strictObject({
      senderItemId: z.string(),
      receiver: z.string(),
      amountCents: z.int().positive(),
      currency: z.literal("USD"),
      memberNo: z.string(),
    }),
  ),
  itemCount: z.int().nonnegative(),
  totalCents: z.int().nonnegative(),
  batchSha256: Sha256Hex.nullable(),
  /**
   * Every member line of the run, on and off rail (the cash lines too), as stored: M-BD-01 recomputes IC-02
   * `linesDigest` from these, the second digest both keys sign.
   */
  memberLines: z.array(z.strictObject({ memberNo: z.string(), lineSha256: Sha256Hex.nullable() })),
  /** IC-02 `linesDigest(memberLines)`; null when a line has no stored hash (nothing can be signed). */
  linesDigest: Sha256Hex.nullable(),
  chairRequired: z.boolean(),
  chairReasons: z.array(z.string()),
  blocking: z.array(z.strictObject({ id: Uuid, label: z.string() })),
  /** PayPal members with a payable line but no configured receiver: while any is listed, nothing can be signed. */
  unpayable: z.array(z.string()),
  rail: z.enum(["simulated", "sandbox"]),
});

export const SeasonView = z.strictObject({
  season: z.strictObject({
    id: Uuid,
    code: SeasonCode,
    label: SeasonLabel,
    opensOn: IsoDate,
    closesOn: IsoDate,
    cosignBatchCents: z.int().nonnegative(),
    cosignLineCents: z.int().nonnegative(),
    massBalanceTolBp: z.int().positive(),
    kgPerTreeMaxG: z.int().positive(),
    autoAcceptBp: z.int().positive(),
    provenance: Provenance,
  }),
  coop: z.strictObject({
    id: Uuid,
    name: z.string(),
    region: z.string(),
    commodity: z.string(),
    provenance: Provenance,
  }),
  lot: z
    .strictObject({
      id: Uuid,
      lotCode: z.string(),
      shippedG: z.int().nonnegative(),
      grade1ShippedG: z.int().nonnegative(),
      sacks: z.int().positive(),
      shippedOn: IsoDate.nullable(),
      provenance: Provenance,
    })
    .nullable(),
  rateCard: z
    .strictObject({
      id: Uuid,
      code: z.string(),
      sha256: Sha256Hex,
      ratifiedAt: IsoDateTime.nullable(),
      bolted: z.boolean(),
    })
    .nullable(),
  runs: z.array(
    z.strictObject({
      id: Uuid,
      runSlug: RunSlug,
      runSeq: z.int().positive(),
      state: PayRunState,
      version: z.int(),
    }),
  ),
  /** The run strip of the season's latest run (register §7). */
  strip: RunStrip,
  members: z.int().nonnegative(),
});

export const SlipView = z.strictObject({
  id: Uuid,
  documentId: Uuid,
  photoId: z.string().nullable(),
  serial: SlipSerial,
  rowNo: z.int().positive(),
  copy: z.string().nullable(),
  memberNo: z.string().nullable(),
  slipDate: IsoDate.nullable(),
  grossG: z.int().nullable(),
  tareG: z.int().nullable(),
  netG: z.int().nullable(),
  grade: z.string().nullable(),
  minConfidence: z.number().nullable(),
  state: z.enum(["AUTO_ACCEPTED", "NEEDS_HUMAN", "CONFIRMED", "REJECTED"]),
  fields: z.array(SlipFieldDTO),
  provenance: Provenance,
});
export const SlipList = z.strictObject({ season: SeasonLabel, slips: z.array(SlipView) });

export const SlipQuery = z.strictObject({
  photo: z
    .string()
    .regex(/^(?:[A-L]|P\d{2})$/)
    .optional(),
});
export const SeasonParam = z.string().regex(/^\d{4}-?[A-Z]$/);

export const RatifyBody = z.strictObject({ role: z.enum(["SECRETARY", "CHAIR"]) });
export const FlagQuery = z.strictObject({ flag: SystemFlagName.optional() });
export { ApprovalPayload };

// ---------------------------------------------------------------- helpers

export function strip(run: RunRow | null, ratified: boolean, blockingOpen: number) {
  const s = (run?.state ?? "DRAFT") as PayRunState;
  return [
    { step: "RATIFIED" as const, done: ratified },
    { step: "FUNDED" as const, done: run !== null && runMachine.isFundedOrLater(s) },
    { step: "READ" as const, done: run !== null && runMachine.isComputedOrLater(s) },
    { step: "CHECKED" as const, done: run !== null && runMachine.isComputedOrLater(s) && blockingOpen === 0 },
    { step: "APPROVED" as const, done: run !== null && runMachine.isApprovedOrLater(s) },
    { step: "PAID" as const, done: run !== null && runMachine.isSettledOrLater(s) },
  ];
}

export function payRunDto(run: RunRow): z.infer<typeof PayRun> {
  const fx = getSnapshot().fx.centavosPerCent;
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    seasonId: run.seasonId,
    runSeq: run.runSeq,
    runSlug: run.runSlug,
    state: run.state as PayRunState,
    version: run.version,
    fx:
      run.fxNum !== null && run.fxDen !== null ? { num: toInt(run.fxNum), den: toInt(run.fxDen) } : { ...fx },
    quoteSha256: run.quoteSha256,
    rateCardSha256: run.rateCardSha256,
    batchSha256: run.batchSha256,
    senderBatchId: run.senderBatchId,
    cashDay: null,
    provenance: provenanceOf(run.provenance),
  };
}

async function openHolds(db: DbOrTx, scope: WorkspaceScope, runId: string) {
  const rows = await db
    .select({ state: schema.holds.state, gate: schema.holds.gate })
    .from(schema.holds)
    .where(and(eq(schema.holds.workspaceId, scope.workspaceId), eq(schema.holds.runId, runId)));
  const open = rows.filter((h) => h.state === "OPEN" || h.state === "ASKED_CHAIR");
  return {
    open: open.length,
    blocking: open.filter((h) => h.gate === "BLOCKS_APPROVAL").length,
    total: rows.length,
  };
}

// ---------------------------------------------------------------- reads

export async function runView(
  deps: AppDeps,
  scope: WorkspaceScope,
  runSlug: string,
): Promise<z.infer<typeof RunView>> {
  const db = deps.db;
  const run = await runBySlug(db, scope, runSlug);
  const card = await cardById(db, scope, run.rateCardId);
  const holds = await openHolds(db, scope, run.id);
  const lines = await db
    .select({ state: schema.memberLines.state, provenance: schema.memberLines.provenance })
    .from(schema.memberLines)
    .where(and(eq(schema.memberLines.workspaceId, scope.workspaceId), eq(schema.memberLines.runId, run.id)));
  const counts: Record<string, number> = {};
  for (const l of lines) {
    const state = l.provenance === "replay" ? `${l.state}_REPLAY` : l.state;
    counts[state] = (counts[state] ?? 0) + 1;
  }
  const approvals = await db
    .select()
    .from(schema.approvals)
    .where(
      and(
        eq(schema.approvals.workspaceId, scope.workspaceId),
        eq(schema.approvals.runId, run.id),
        eq(schema.approvals.decision, "SIGNED"),
      ),
    )
    .orderBy(asc(schema.approvals.createdAt));
  const inv = await invoiceOfRun(db, scope, run.id);
  return {
    run: payRunDto(run),
    invoice: inv
      ? {
          invoiceNumber: inv.invoiceNumber,
          paypalInvoiceId: inv.paypalInvoiceId,
          status: inv.status === "NEW" ? null : (inv.status as z.infer<typeof InvoiceStatus>),
          amountCents: toInt(inv.amountCents),
          dueCents: inv.dueCents === null ? null : toInt(inv.dueCents),
          sentAt: inv.sentAt ? iso(inv.sentAt) : null,
          autoCancelOn: inv.autoCancelOn,
          fundedAt: inv.fundedAt ? iso(inv.fundedAt) : null,
          payerViewUrl: inv.payerViewUrl,
          provenance: provenanceOf(inv.provenance),
        }
      : null,
    strip: strip(run, card.ratifiedAt !== null, holds.blocking),
    holds,
    lines: counts,
    approvals: approvals.map(approvalDto),
    rail: deps.paypal.label,
  };
}

export async function holdList(
  deps: AppDeps,
  scope: WorkspaceScope,
  runSlug: string,
): Promise<z.infer<typeof HoldList>> {
  const run = await runBySlug(deps.db, scope, runSlug);
  const rows = await deps.db
    .select()
    .from(schema.holds)
    .where(and(eq(schema.holds.workspaceId, scope.workspaceId), eq(schema.holds.runId, run.id)))
    .orderBy(asc(schema.holds.createdAt));
  return { runSlug: run.runSlug, runVersion: run.version, holds: rows.map(holdDto) };
}

export async function lineList(
  deps: AppDeps,
  scope: WorkspaceScope,
  runSlug: string,
): Promise<z.infer<typeof LineList>> {
  const run = await runBySlug(deps.db, scope, runSlug);
  const rows = await deps.db
    .select({ line: schema.memberLines, memberNo: schema.members.memberNo })
    .from(schema.memberLines)
    .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
    .where(and(eq(schema.memberLines.workspaceId, scope.workspaceId), eq(schema.memberLines.runId, run.id)))
    .orderBy(asc(schema.members.memberNo));
  return {
    runSlug: run.runSlug,
    lines: rows.map((r) => lineWithCanonicalDto(r.line, r.memberNo, run.rateCardSha256)),
  };
}

export async function approvalList(
  deps: AppDeps,
  scope: WorkspaceScope,
  runSlug: string,
): Promise<z.infer<typeof ApprovalList>> {
  const run = await runBySlug(deps.db, scope, runSlug);
  const rows = await deps.db
    .select()
    .from(schema.approvals)
    .where(
      and(
        eq(schema.approvals.workspaceId, scope.workspaceId),
        eq(schema.approvals.runId, run.id),
        eq(schema.approvals.decision, "SIGNED"),
      ),
    )
    .orderBy(asc(schema.approvals.createdAt));
  return { runSlug: run.runSlug, approvals: rows.map(approvalDto) };
}

export async function flagList(deps: AppDeps, scope: WorkspaceScope): Promise<z.infer<typeof FlagList>> {
  const flags = await Promise.all(
    SystemFlagName.options.map((f) => flagDto(deps, deps.db, scope.workspaceId, f)),
  );
  return { flags };
}

async function seasonByParam(db: DbOrTx, scope: WorkspaceScope, param: string) {
  const code = param.replace("-", "");
  const [season] = await db
    .select()
    .from(schema.seasons)
    .where(and(eq(schema.seasons.workspaceId, scope.workspaceId), eq(schema.seasons.code, code)))
    .limit(1);
  if (!season) throw problem.notFound("No such season in this workspace.");
  return season;
}

export async function seasonView(
  deps: AppDeps,
  scope: WorkspaceScope,
  param: string,
): Promise<z.infer<typeof SeasonView>> {
  const db = deps.db;
  const season = await seasonByParam(db, scope, param);
  const [coop] = await db
    .select()
    .from(schema.coops)
    .where(and(eq(schema.coops.workspaceId, scope.workspaceId), eq(schema.coops.id, season.coopId)));
  if (!coop) throw problem.notFound("No such co-op in this workspace.");
  const [lot] = await db
    .select()
    .from(schema.lots)
    .where(and(eq(schema.lots.workspaceId, scope.workspaceId), eq(schema.lots.seasonId, season.id)))
    .limit(1);
  const [card] = await db
    .select()
    .from(schema.rateCards)
    .where(and(eq(schema.rateCards.workspaceId, scope.workspaceId), eq(schema.rateCards.seasonId, season.id)))
    .limit(1);
  const runs = await db
    .select()
    .from(schema.payRuns)
    .where(and(eq(schema.payRuns.workspaceId, scope.workspaceId), eq(schema.payRuns.seasonId, season.id)))
    .orderBy(desc(schema.payRuns.runSeq));
  const latest = runs[0] ?? null;
  const blocking = latest ? (await openHolds(db, scope, latest.id)).blocking : 0;
  const members = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(eq(schema.members.workspaceId, scope.workspaceId));
  return {
    season: {
      id: season.id,
      code: season.code,
      label: season.label,
      opensOn: season.opensOn,
      closesOn: season.closesOn,
      cosignBatchCents: toInt(season.cosignBatchCents),
      cosignLineCents: toInt(season.cosignLineCents),
      massBalanceTolBp: season.massBalanceTolBp,
      kgPerTreeMaxG: season.kgPerTreeMaxG,
      autoAcceptBp: season.autoAcceptBp,
      provenance: provenanceOf(season.provenance),
    },
    coop: {
      id: coop.id,
      name: coop.name,
      region: coop.region,
      commodity: coop.commodity,
      provenance: provenanceOf(coop.provenance),
    },
    lot: lot
      ? {
          id: lot.id,
          lotCode: lot.lotCode,
          shippedG: toInt(lot.shippedG),
          grade1ShippedG: toInt(lot.grade1ShippedG),
          sacks: lot.sacks,
          shippedOn: lot.shippedOn,
          provenance: provenanceOf(lot.provenance),
        }
      : null,
    rateCard: card
      ? {
          id: card.id,
          code: card.code,
          sha256: card.sha256,
          ratifiedAt: card.ratifiedAt ? iso(card.ratifiedAt) : null,
          bolted: card.ratifiedAt !== null,
        }
      : null,
    runs: runs.map((r) => ({
      id: r.id,
      runSlug: r.runSlug,
      runSeq: r.runSeq,
      state: r.state as PayRunState,
      version: r.version,
    })),
    strip: strip(latest, card?.ratifiedAt != null, blocking),
    members: members.length,
  };
}

export async function slipList(
  deps: AppDeps,
  scope: WorkspaceScope,
  param: string,
  o: { photo?: string; serial?: string },
): Promise<z.infer<typeof SlipList>> {
  const db = deps.db;
  const season = await seasonByParam(db, scope, param);
  const docs = o.photo
    ? await db
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(
          and(eq(schema.documents.workspaceId, scope.workspaceId), eq(schema.documents.photoCode, o.photo)),
        )
    : null;
  if (docs && docs.length === 0) return { season: season.label, slips: [] };
  const conditions = [
    eq(schema.slipRows.workspaceId, scope.workspaceId),
    eq(schema.slipRows.seasonId, season.id),
  ];
  if (docs)
    conditions.push(
      inArray(
        schema.slipRows.documentId,
        docs.map((d) => d.id),
      ),
    );
  if (o.serial) conditions.push(eq(schema.slipRows.serial, o.serial));
  const rows = await db
    .select({ row: schema.slipRows, memberNo: schema.members.memberNo, photoId: schema.documents.photoCode })
    .from(schema.slipRows)
    .leftJoin(schema.members, eq(schema.members.id, schema.slipRows.memberId))
    .leftJoin(schema.documents, eq(schema.documents.id, schema.slipRows.documentId))
    .where(and(...conditions))
    .orderBy(asc(schema.slipRows.serial), asc(schema.slipRows.rowNo))
    .limit(o.photo || o.serial ? 64 : 400);
  const ids = rows.map((r) => r.row.id);
  const fields = ids.length
    ? await db
        .select()
        .from(schema.slipFields)
        .where(
          and(
            eq(schema.slipFields.workspaceId, scope.workspaceId),
            inArray(schema.slipFields.slipRowId, ids),
          ),
        )
    : [];
  return {
    season: season.label,
    slips: rows.map(({ row, memberNo, photoId }) => ({
      id: row.id,
      documentId: row.documentId,
      photoId: photoId ?? null,
      serial: row.serial,
      rowNo: row.rowNo,
      copy: row.copyColor,
      memberNo: memberNo ?? null,
      slipDate: row.slipDate,
      grossG: row.grossG === null ? null : toInt(row.grossG),
      tareG: row.tareG === null ? null : toInt(row.tareG),
      netG: row.netG === null ? null : toInt(row.netG),
      grade: row.grade,
      minConfidence: row.minConfidence,
      state: row.state,
      fields: fields.filter((f) => f.slipRowId === row.id).map(fieldDto),
      provenance: provenanceOf(row.provenance),
    })),
  };
}
