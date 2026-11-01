// Additive member-frame projection. Every amount string is printed here, never calculated by the phone.
import { MemberLineState, PayoutItemStatus, Provenance } from "@fairsplit/contracts";
import { type DbOrTx, schema } from "@fairsplit/db";
import { format, mulDivHalfUp } from "@fairsplit/domain";
import { and, asc, desc, eq, inArray, type SQLWrapper, sql } from "drizzle-orm";
import { z } from "zod";
import type { StatementContext } from "./facts.js";
import { honorificOf } from "./facts.js";
import { payKindOf, type StatementLineFacts } from "./plan.js";
import { estimateText, pesoEstimateCentavos, pesoExactCentavos, renderFact } from "./render.js";

const Hero = z.object({
  kind: z.enum(["paypal", "cash"]),
  cents: z.int(),
  amount: z.string(),
  spoken: z.string(),
  estimate: z.string().nullable(),
  usd: z.string(),
  rate: z.string(),
});
const ReceiptRow = z.object({
  id: z.string(),
  kind: z.enum(["premium", "bonus", "deduction", "credit", "net"]),
  cents: z.int(),
  amount: z.string(),
  spoken: z.string(),
  ruleId: z.string().optional(),
  label: z.string().optional(),
  slip: z.string().optional(),
  writtenCentavos: z.int().optional(),
});
export const MobileStatement = z.object({
  lineId: z.uuid(),
  runId: z.uuid(),
  runSlug: z.string(),
  provenance: Provenance,
  coop: z.object({ name: z.string(), place: z.string() }),
  season: z.object({ id: z.uuid(), code: z.string() }),
  payer: z.object({ short: z.string() }),
  member: z.object({
    memberNo: z.string(),
    displayName: z.string(),
    nameByLang: z.object({ ceb: z.string(), fil: z.string(), en: z.string() }),
    lang: z.enum(["ceb", "fil", "en"]),
  }),
  treasurer: z.object({ first: z.string(), name: z.string(), initials: z.string() }),
  rail: z.enum(["PAYPAL", "CASH"]),
  lineState: MemberLineState,
  item: z
    .object({
      senderItemId: z.string(),
      status: PayoutItemStatus.exclude(["SUBMITTED"]),
      updatedAt: z.string(),
      verified: z.boolean(),
      provenance: Provenance,
    })
    .nullable(),
  kilos: z.object({ netGrams: z.int(), grade1Grams: z.int(), coopVerifiedGrams: z.int() }),
  amounts: z
    .object({
      premiumCents: z.int(),
      bonusCents: z.int(),
      netCents: z.int(),
      deductions: z.array(z.object({ ruleId: z.string(), label: z.string(), cents: z.int() })),
      credits: z.array(z.object({ slip: z.string(), writtenCentavos: z.int(), cents: z.int() })),
    })
    .nullable(),
  fx: z.object({ phpPerUsd: z.string() }),
  slips: z.array(
    z.object({
      serial: z.string(),
      netGrams: z.int(),
      deliveredOn: z.string(),
      cropUrl: z.string().nullable(),
    }),
  ),
  history: z.array(
    z.object({
      kind: z.enum(["approved", "sent", "paid", "unclaimed", "cash-due", "received", "held"]),
      at: z.string(),
      by: z.array(z.string()).optional(),
    }),
  ),
  rateCard: z.object({ id: z.uuid(), sha256: z.string(), ratifiedAt: z.string() }),
  batchSha256: z.string().nullable(),
  cashDay: z.string().nullable(),
  expectedDate: z.string().nullable(),
  spokenHashes: z.array(z.string()),
  formatted: z.object({
    hero: z.object({ paypal: Hero, cash: Hero }).nullable(),
    receiptRows: z.array(ReceiptRow),
    share: z.object({ kg: z.string(), coopKg: z.string(), grade1Kg: z.string(), allGrade1: z.boolean() }),
    conservation: z.object({ ok: z.boolean(), computedCents: z.int(), netCents: z.int() }).nullable(),
  }),
});
export type MobileStatement = z.infer<typeof MobileStatement>;

/** A stored status alone is insufficient evidence for the member's paid claim. */
export function settlementEvidence(payload: unknown, provenance: string): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  if ((provenance === "replay" || provenance === "seeded") && p.source === "replay") return true;
  // This event is persisted only after fs-api's webhook verifier accepts the delivery. The frozen payload
  // carries its source and event ID; it deliberately has no duplicate `verified` property.
  return (
    (provenance === "simulated_rail" || provenance === "replay") &&
    p.source === "webhook" &&
    typeof p.eventId === "string" &&
    p.eventId.length > 0
  );
}

export function mobileItemStatus(status: z.infer<typeof PayoutItemStatus> | undefined, verified: boolean) {
  return status === "SUBMITTED" || (status === "SUCCESS" && !verified) ? "PENDING" : status;
}

export function mobileFigures(
  f: StatementLineFacts,
  coopVerifiedGrams: number,
): MobileStatement["formatted"] {
  const share = {
    kg: format.kg(f.verifiedG),
    coopKg: format.kg(coopVerifiedGrams),
    grade1Kg: format.kg(f.grade1G),
    allGrade1: f.verifiedG === f.grade1G,
  };
  const pay = payKindOf(f);
  if (pay !== "cash" && pay !== "paypal") {
    return { hero: null, receiptRows: [], share, conservation: null };
  }
  const usd = format.money(f.netCents);
  const rate = f.fx ? format.money(mulDivHalfUp(100, f.fx.num, f.fx.den), "PHP") : "";
  const base = { cents: f.netCents, usd, rate };
  const plain = (cents: number) => format.amount(cents);
  const row = (id: string, kind: z.infer<typeof ReceiptRow>["kind"], cents: number) => ({
    id,
    kind,
    cents,
    amount: kind === "net" ? format.money(cents) : kind === "credit" ? `+${plain(cents)}` : plain(cents),
    spoken: format.amountSpoken(cents, f.lang),
  });
  const receiptRows: z.infer<typeof ReceiptRow>[] = [
    row("premium", "premium", f.premiumCents),
    row("bonus", "bonus", f.bonusCents),
    ...f.deductions.map((d) => ({
      ...row(`ded:${d.ruleId}`, "deduction", -d.amountCents),
      ruleId: d.ruleId,
      label: d.category,
    })),
    ...f.credits.map((c) => ({
      ...row(`credit:${c.serial ?? "unattributed"}`, "credit", c.amountCents),
      ...(c.serial ? { slip: c.serial } : {}),
      ...(c.phpCentavos !== null ? { writtenCentavos: c.phpCentavos } : {}),
    })),
    row("net", "net", f.netCents),
  ];
  const computedCents =
    f.premiumCents +
    f.bonusCents -
    f.deductions.reduce((sum, d) => sum + d.amountCents, 0) +
    f.credits.reduce((sum, c) => sum + c.amountCents, 0);
  const cashCentavos = f.fx ? pesoExactCentavos(f.netCents, f.fx) : null;
  return {
    hero: {
      paypal: {
        ...base,
        kind: "paypal",
        amount: usd,
        spoken: format.amountSpoken(f.netCents, f.lang, f.fx ?? undefined),
        estimate: f.fx ? estimateText(pesoEstimateCentavos(f.netCents, f.fx), f.lang) : null,
      },
      cash: {
        ...base,
        kind: "cash",
        amount: cashCentavos === null ? usd : format.money(cashCentavos, "PHP"),
        spoken:
          cashCentavos === null
            ? format.amountSpoken(f.netCents, f.lang)
            : `${renderFact({ k: "php", centavos: cashCentavos }, "spoken", f.lang)} cash`,
        estimate: null,
      },
    },
    receiptRows,
    share,
    conservation: { ok: computedCents === f.netCents, computedCents, netCents: f.netCents },
  };
}

export async function loadMobileStatement(
  db: DbOrTx,
  ctx: StatementContext,
  spokenHashes: string[] = [],
): Promise<MobileStatement> {
  const scoped = (table: { workspaceId: SQLWrapper }) => eq(table.workspaceId, ctx.workspaceId);
  const [member] = await db
    .select()
    .from(schema.members)
    .where(and(scoped(schema.members), eq(schema.members.id, ctx.memberId)))
    .limit(1);
  const [run] = await db
    .select()
    .from(schema.payRuns)
    .where(and(scoped(schema.payRuns), eq(schema.payRuns.id, ctx.runId)))
    .limit(1);
  if (!member || !run) throw new Error("statement metadata is absent");
  const [coop] = await db
    .select()
    .from(schema.coops)
    .where(and(scoped(schema.coops), eq(schema.coops.id, member.coopId)))
    .limit(1);
  const [card] = await db
    .select()
    .from(schema.rateCards)
    .where(and(scoped(schema.rateCards), eq(schema.rateCards.id, run.rateCardId)))
    .limit(1);
  const [item] = await db
    .select({
      senderItemId: schema.payoutItems.senderItemId,
      status: schema.payoutItems.status,
      updatedAt: schema.payoutItems.updatedAt,
      provenance: schema.payoutItems.provenance,
    })
    .from(schema.payoutItems)
    .where(and(scoped(schema.payoutItems), eq(schema.payoutItems.lineId, ctx.facts.lineId)))
    .orderBy(desc(schema.payoutItems.createdAt))
    .limit(1);
  const events = await db
    .select({
      type: schema.runEvents.type,
      payload: schema.runEvents.payload,
      at: schema.runEvents.at,
      provenance: schema.runEvents.provenance,
    })
    .from(schema.runEvents)
    .where(and(scoped(schema.runEvents), eq(schema.runEvents.runId, ctx.runId)))
    .orderBy(asc(schema.runEvents.id));
  const ownEvents = events.filter((e) => {
    const p = e.payload as Record<string, unknown>;
    return p.lineId === ctx.facts.lineId || (item && p.senderItemId === item.senderItemId);
  });
  const success = ownEvents
    .filter((e) => {
      const p = e.payload as Record<string, unknown>;
      return e.type === "item.updated" && p.to === "SUCCESS" && settlementEvidence(p, e.provenance);
    })
    .at(-1);
  const replay = ctx.provenance === "seeded" || ctx.provenance === "replay";
  const verified =
    !!success ||
    (replay && item !== undefined && (item.provenance === "seeded" || item.provenance === "replay"));
  const itemStatus = mobileItemStatus(item?.status, verified);
  const slips = await db
    .select({
      serial: schema.slipRows.serial,
      netGrams: schema.slipRows.netG,
      deliveredOn: schema.slipRows.slipDate,
    })
    .from(schema.slipRows)
    .where(
      and(
        scoped(schema.slipRows),
        eq(schema.slipRows.seasonId, run.seasonId),
        eq(schema.slipRows.memberId, ctx.memberId),
        inArray(schema.slipRows.state, ["AUTO_ACCEPTED", "CONFIRMED"]),
      ),
    )
    .orderBy(asc(schema.slipRows.serial));
  const [totals] = await db
    .select({ grams: sql<string>`coalesce(sum(${schema.memberLines.verifiedG}), 0)` })
    .from(schema.memberLines)
    .where(and(scoped(schema.memberLines), eq(schema.memberLines.runId, ctx.runId)));
  const coopVerifiedGrams = Number(totals?.grams ?? 0);
  const f = ctx.facts;
  const pay = payKindOf(f);
  const amountsVisible = pay === "cash" || pay === "paypal";
  const history: MobileStatement["history"] = [];
  for (const e of events) {
    const p = e.payload as Record<string, unknown>;
    if (e.type === "run.state" && p.to === "APPROVED")
      history.push({ kind: "approved", at: e.at.toISOString() });
  }
  for (const e of ownEvents) {
    const p = e.payload as Record<string, unknown>;
    if (e.type !== "item.updated") continue;
    if (p.to === "PENDING" || p.to === "SUBMITTED") history.push({ kind: "sent", at: e.at.toISOString() });
    if (p.to === "UNCLAIMED") history.push({ kind: "unclaimed", at: e.at.toISOString() });
  }
  if (itemStatus === "SUCCESS")
    history.push({ kind: "paid", at: success?.at.toISOString() ?? item?.updatedAt.toISOString() ?? "" });
  if (f.state === "OFF_RAIL_PAID" && f.cashDay) history.push({ kind: "received", at: f.cashDay });
  const first = f.treasurer ?? "Treasurer";
  const fx = f.fx ? format.amount(mulDivHalfUp(100, f.fx.num, f.fx.den)) : "";
  return MobileStatement.parse({
    lineId: f.lineId,
    runId: ctx.runId,
    runSlug: ctx.runSlug,
    provenance: ctx.provenance,
    coop: { name: coop?.name ?? f.coop, place: coop?.region ?? "" },
    season: { id: run.seasonId, code: run.seasonCode },
    payer: { short: f.payer },
    member: {
      memberNo: member.memberNo,
      displayName: member.displayName,
      lang: member.lang,
      nameByLang: {
        ceb: honorificOf(member.honorific, member.displayName, "ceb"),
        fil: honorificOf(member.honorific, member.displayName, "fil"),
        en: honorificOf(member.honorific, member.displayName, "en"),
      },
    },
    treasurer: { first, name: first, initials: "" },
    rail: ctx.rail,
    lineState: f.state === "PAID" && !verified ? "PAYPAL_PENDING" : f.state,
    item: item ? { ...item, status: itemStatus, updatedAt: item.updatedAt.toISOString(), verified } : null,
    kilos: { netGrams: f.verifiedG, grade1Grams: f.grade1G, coopVerifiedGrams },
    amounts: amountsVisible
      ? {
          premiumCents: f.premiumCents,
          bonusCents: f.bonusCents,
          netCents: f.netCents,
          deductions: f.deductions.map((d) => ({
            ruleId: d.ruleId,
            label: d.category,
            cents: d.amountCents,
          })),
          credits: f.credits.map((c) => ({
            slip: c.serial ?? "",
            writtenCentavos: c.phpCentavos ?? 0,
            cents: c.amountCents,
          })),
        }
      : null,
    fx: { phpPerUsd: fx },
    slips: slips
      .filter((s) => f.slipSerials.includes(s.serial) && s.deliveredOn !== null && s.netGrams !== null)
      .map((s) => ({ ...s, netGrams: Number(s.netGrams), cropUrl: null })),
    history,
    rateCard: {
      id: run.rateCardId,
      sha256: run.rateCardSha256,
      ratifiedAt: card?.ratifiedAt?.toISOString() ?? "",
    },
    batchSha256: run.batchSha256,
    cashDay: f.cashDay,
    expectedDate: null,
    spokenHashes,
    formatted: mobileFigures(f, coopVerifiedGrams),
  });
}
