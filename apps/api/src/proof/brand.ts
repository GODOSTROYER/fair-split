// The brand view (W-BR-01 / W-PF-02, C-23): the Proof with names, masked receivers on screen, and a CSV export
// that is the only place names, full receivers and plot coordinates appear (shared with the brand under the
// data-sharing agreement, never published). Readable with the brand's link, or by the brand persona, the
// treasurer, the Chair or a judge acting in the run's own workspace.
import {
  INVOICE_STATUS_LABELS,
  KgDTO,
  MEMBER_LINE_LABELS,
  type MemberLineState,
  MoneyDTO,
  type PayoutItemStatus,
  PayoutItemStatus as PayoutItemStatusSchema,
  PayRunState,
  Provenance,
  Rail,
  RunSlug,
} from "@fairsplit/contracts";
import { type DbOrTx, schema } from "@fairsplit/db";
import { format, invoiceReference, minorToDecimal } from "@fairsplit/domain";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Credential } from "../credentials/verify/index.js";
import { problem } from "../lib/problem.js";
import {
  findRunBySlug,
  foldItemEvents,
  loadRunFacts,
  notReady,
  type ProofFacts,
  type ProofRun,
  proofReady,
  readSnapshot,
} from "./bundle.js";
import { FULL_TIER_ROLES, sameWorkspace } from "./tier.js";

export const BrandMember = z.strictObject({
  memberNo: z.string(),
  name: z.string(),
  lang: z.enum(["ceb", "fil", "en"]),
  rail: Rail,
  verified: KgDTO,
  net: MoneyDTO,
  state: z.string(),
  stateWords: z.string(),
  /** Masked on screen (C-23); complete only in the CSV export. */
  receiverMasked: z.string().nullable(),
  senderItemId: z.string().nullable(),
  payoutItemId: z.string().nullable(),
  itemStatus: PayoutItemStatusSchema.nullable(),
  lineSha256: z.string().nullable(),
});

export const BrandView = z.strictObject({
  runSlug: RunSlug,
  runState: PayRunState,
  provenance: Provenance,
  brand: z.string(),
  invoice: z.strictObject({
    invoiceNumber: z.string(),
    status: z.string(),
    statusWords: z.string(),
    amount: MoneyDTO,
    reference: z.string(),
    /**
     * W-PF-02 `unpaid`: PayPal's payer view of the invoice ("Pay invoice in PayPal"). The sandbox sends no
     * email, so this is the brand's way in. Null once paid (or before the invoice exists).
     */
    payerViewUrl: z.url().nullable(),
  }),
  /** True from the batch's POST on: the Proof (six plates) exists. Before that the view shows the invoice. */
  proofReady: z.boolean(),
  /** Zero until proofReady (C-23: no member figure leaves before the Proof exists). */
  totals: z.strictObject({
    members: z.int().nonnegative(),
    net: MoneyDTO,
    paypalMembers: z.int().nonnegative(),
    paypal: MoneyDTO,
    cashMembers: z.int().nonnegative(),
    cash: MoneyDTO,
  }),
  /** Empty until proofReady. */
  members: z.array(BrandMember),
  hashes: z.strictObject({
    rateCardSha256: z.string(),
    batchSha256: z.string().nullable(),
    ledgerHead: z.strictObject({ seq: z.int().nonnegative(), entryHash: z.string() }).nullable(),
  }),
  exportPath: z.string(),
});
export type BrandView = z.infer<typeof BrandView>;

/**
 * The run a brand reader may see, or a 401/403/404. A credential for another workspace sees nothing here. Any
 * state of the run: before its batch is posted the view is the invoice alone (W-PF-02 unpaid); its member lines,
 * names, receivers and the CSV export wait for the Proof (`proofReady`, decided in the read's own snapshot).
 */
export async function brandRun(
  db: DbOrTx,
  credential: Credential | null,
  credentialProblem: Error | null,
  runSlug: string,
  now: Date,
): Promise<ProofRun> {
  if (!credential) throw credentialProblem ?? problem.unauthenticated();
  const allowed =
    credential.kind === "brand_link" ||
    ((credential.kind === "frame" || credential.kind === "device" || credential.kind === "judge_session") &&
      FULL_TIER_ROLES.includes(credential.role));
  if (!allowed) throw problem.forbidden("The brand view is Lantern Bay's (and the co-op officers').");
  const run = await findRunBySlug(db, runSlug, now);
  if (!run || !sameWorkspace(run.workspaceId, credential.workspaceId)) {
    throw problem.notFound("No such pay run for this link.");
  }
  return run;
}

interface MemberRow {
  memberId: string;
  memberNo: string;
  name: string;
  lang: "ceb" | "fil" | "en";
  lineId: string;
  state: string;
  rail: "PAYPAL" | "CASH";
  verifiedG: number;
  grade1G: number;
  premiumCents: number;
  bonusCents: number;
  deductionsCents: number;
  creditsCents: number;
  netCents: number;
  lineSha256: string | null;
  slipSerials: string[];
  item: {
    senderItemId: string;
    payoutItemId: string | null;
    status: PayoutItemStatus;
    receiver: string;
    eventId: string | null;
  } | null;
  plots: { code: string; trees: number; areaHa: string | null; lat: string | null; lon: string | null }[];
}

/**
 * The run's facts and, once its Proof exists, one row per member line. Before that there are no rows at all
 * (C-23: names, amounts and receivers are the Proof's): the snapshot's own run decides, never the lookup that
 * preceded it, so a run posted in between is read whole or not at all.
 */
async function brandRows(
  db: DbOrTx,
  run: ProofRun,
): Promise<{ rows: MemberRow[]; facts: ProofFacts; ready: boolean }> {
  const facts = await loadRunFacts(db, run);
  if (!proofReady(facts.run)) return { rows: [], facts, ready: false };
  const ws = run.workspaceId;
  const ml = schema.memberLines;
  const lines = await db
    .select({
      lineId: ml.id,
      memberId: ml.memberId,
      memberNo: schema.members.memberNo,
      name: schema.members.displayName,
      lang: schema.members.lang,
      grade1G: ml.grade1G,
      verifiedG: ml.verifiedG,
      lineSha256: ml.lineSha256,
      trace: ml.trace,
    })
    .from(ml)
    .innerJoin(
      schema.members,
      and(eq(schema.members.workspaceId, ml.workspaceId), eq(schema.members.id, ml.memberId)),
    )
    .where(and(eq(ml.workspaceId, ws), eq(ml.runId, run.id)))
    .orderBy(asc(schema.members.memberNo));
  const items = await db
    .select({
      lineId: schema.payoutItems.lineId,
      senderItemId: schema.payoutItems.senderItemId,
      payoutItemId: schema.payoutItems.payoutItemId,
      status: schema.payoutItems.status,
      receiver: schema.payoutItems.receiver,
    })
    .from(schema.payoutItems)
    .where(
      and(
        eq(schema.payoutItems.workspaceId, ws),
        inArray(
          schema.payoutItems.lineId,
          lines.map((l) => l.lineId),
        ),
      ),
    );
  const folds = foldItemEvents(facts.ledger);
  const plots = await db
    .select({
      memberId: schema.plots.memberId,
      code: schema.plots.plotCode,
      trees: schema.plots.trees,
      areaHa: schema.plots.areaHa,
      lat: schema.plots.lat,
      lon: schema.plots.lon,
    })
    .from(schema.plots)
    .where(eq(schema.plots.workspaceId, ws));
  const factByLine = new Map(facts.lines.map((l) => [l.lineId, l]));
  const rows: MemberRow[] = lines.map((l) => {
    const f = factByLine.get(l.lineId);
    // the latest item of the line (a re-route supersedes the primary one)
    const its = items
      .filter((i) => i.lineId === l.lineId)
      .sort((a, b) => (a.senderItemId < b.senderItemId ? 1 : -1));
    const it = its[0];
    const trace = l.trace && typeof l.trace === "object" ? (l.trace as Record<string, unknown>) : null;
    const canonical =
      trace?.canonical && typeof trace.canonical === "object"
        ? (trace.canonical as Record<string, unknown>)
        : null;
    const serials = Array.isArray(canonical?.slipSerials) ? (canonical.slipSerials as string[]) : [];
    const fold = it ? folds.get(it.senderItemId) : undefined;
    return {
      memberId: l.memberId,
      memberNo: l.memberNo,
      name: l.name,
      lang: l.lang as MemberRow["lang"],
      lineId: l.lineId,
      state: f?.state ?? "COMPUTED",
      rail: f?.rail ?? "CASH",
      verifiedG: Number(l.verifiedG),
      grade1G: Number(l.grade1G),
      premiumCents: f?.premiumCents ?? 0,
      bonusCents: f?.bonusCents ?? 0,
      deductionsCents: f?.deductionsCents ?? 0,
      creditsCents: f?.creditsCents ?? 0,
      netCents: f?.netCents ?? 0,
      lineSha256: l.lineSha256,
      slipSerials: serials,
      item: it
        ? {
            senderItemId: it.senderItemId,
            payoutItemId: it.payoutItemId,
            status: it.status as PayoutItemStatus,
            receiver: it.receiver,
            eventId: fold && fold.status === it.status ? fold.lastEventId : null,
          }
        : null,
      plots: plots
        .filter((p) => p.memberId === l.memberId)
        .map((p) => ({ code: p.code, trees: p.trees, areaHa: p.areaHa, lat: p.lat, lon: p.lon })),
    };
  });
  return { rows, facts, ready: true };
}

/** The brand view, read from one snapshot. */
/** Invoice statuses in which the brand still has something to pay. */
const UNPAID = new Set(["SENT", "UNPAID", "PARTIALLY_PAID", "SCHEDULED"]);

/** Only an https link (or the sandbox simulator's http one) is ever handed out as the payer view. */
function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function brandView(db: DbOrTx, run: ProofRun): Promise<BrandView> {
  return readSnapshot(db, (tx) => readBrandView(tx, run));
}

async function readBrandView(db: DbOrTx, lookedUp: ProofRun): Promise<BrandView> {
  const { rows, facts, ready } = await brandRows(db, lookedUp);
  // the run as this snapshot read it: state, hashes and readiness from the same moment as the rows
  const run = facts.run;
  const [inv] = await db
    .select({
      invoiceNumber: schema.invoices.invoiceNumber,
      status: schema.invoices.status,
      amountCents: schema.invoices.amountCents,
      payerViewUrl: schema.invoices.payerViewUrl,
    })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.workspaceId, run.workspaceId), eq(schema.invoices.runId, run.id)))
    .limit(1);
  const [card] = await db
    .select({ canonicalJcs: schema.rateCards.canonicalJcs })
    .from(schema.rateCards)
    .where(and(eq(schema.rateCards.workspaceId, run.workspaceId), eq(schema.rateCards.id, run.rateCardId)))
    .limit(1);
  const buyer = card
    ? ((JSON.parse(card.canonicalJcs) as { pricing?: { buyer?: string } }).pricing?.buyer ?? "")
    : "";
  const paid = rows.filter((r) => r.item?.status === "SUCCESS");
  const cash = rows.filter(
    (r) => r.item?.status !== "SUCCESS" && ["OFF_RAIL_DUE", "OFF_RAIL_PAID"].includes(r.state),
  );
  const sum = (xs: MemberRow[]) => xs.reduce((s, r) => s + r.netCents, 0);
  const head = facts.ledger.at(-1);
  const status = (inv?.status ?? "DRAFT") as keyof typeof INVOICE_STATUS_LABELS;
  return {
    runSlug: run.runSlug,
    runState: run.state,
    provenance: facts.provenance,
    brand: buyer,
    invoice: {
      invoiceNumber: inv?.invoiceNumber ?? `FS-${run.runSlug}`,
      status,
      statusWords: INVOICE_STATUS_LABELS[status]?.en ?? status,
      amount: format.moneyDTO(Number(inv?.amountCents ?? 0)),
      reference: invoiceReference(run.rateCardSha256),
      payerViewUrl: UNPAID.has(status) && inv?.payerViewUrl ? safeUrl(inv.payerViewUrl) : null,
    },
    proofReady: ready,
    totals: {
      members: rows.length,
      net: format.moneyDTO(sum(rows)),
      paypalMembers: paid.length,
      paypal: format.moneyDTO(sum(paid)),
      cashMembers: cash.length,
      cash: format.moneyDTO(sum(cash)),
    },
    members: rows.map((r) => ({
      memberNo: r.memberNo,
      name: r.name,
      lang: r.lang,
      rail: r.rail,
      verified: format.kgDTO(r.verifiedG),
      net: format.moneyDTO(r.netCents),
      state: r.state,
      stateWords: MEMBER_LINE_LABELS[r.state as MemberLineState]?.console ?? r.state,
      receiverMasked: r.item ? format.maskEmail(r.item.receiver) : null,
      senderItemId: r.item?.senderItemId ?? null,
      payoutItemId: r.item?.payoutItemId ?? null,
      itemStatus: r.item?.status ?? null,
      lineSha256: r.lineSha256,
    })),
    hashes: {
      rateCardSha256: run.rateCardSha256,
      batchSha256: ready ? run.batchSha256 : null,
      ledgerHead: ready && head ? { seq: head.seq, entryHash: head.entryHash } : null,
    },
    exportPath: `/v1/brand/${run.runSlug}/export.csv`,
  };
}

const CSV_HEADER = [
  "member_no",
  "name",
  "language",
  "rail",
  "verified_kg",
  "grade1_kg",
  "premium_usd",
  "bonus_usd",
  "deductions_usd",
  "credits_usd",
  "net_usd",
  "line_state",
  "line_sha256",
  "slip_serials",
  "sender_item_id",
  "payout_item_id",
  "item_status",
  "receiver",
  "webhook_event_id",
  "plots",
] as const;

/** A text cell that a spreadsheet would read as a formula gets a leading apostrophe (CSV injection). */
export function csvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function csvNumber(value: string): string {
  return `"${value}"`;
}

/** The brand's CSV export: UTF-8 with a byte-order mark (names carry ñ), one row per member line. */
export function brandCsv(db: DbOrTx, run: ProofRun): Promise<string> {
  return readSnapshot(db, (tx) => readBrandCsv(tx, run));
}

async function readBrandCsv(db: DbOrTx, run: ProofRun): Promise<string> {
  const { rows, facts, ready } = await brandRows(db, run);
  if (!ready) notReady(facts.run);
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvText(r.memberNo),
        csvText(r.name),
        csvText(r.lang),
        csvText(r.rail),
        csvNumber(format.kgNumber(r.verifiedG, 1).replaceAll(",", "")),
        csvNumber(format.kgNumber(r.grade1G, 1).replaceAll(",", "")),
        csvNumber(minorToDecimal(r.premiumCents)),
        csvNumber(minorToDecimal(r.bonusCents)),
        csvNumber(minorToDecimal(r.deductionsCents)),
        csvNumber(minorToDecimal(r.creditsCents)),
        csvNumber(minorToDecimal(r.netCents)),
        csvText(r.state),
        csvText(r.lineSha256 ?? ""),
        csvText(r.slipSerials.join(" ")),
        csvText(r.item?.senderItemId ?? ""),
        csvText(r.item?.payoutItemId ?? ""),
        csvText(r.item?.status ?? ""),
        csvText(r.item?.receiver ?? ""),
        csvText(r.item?.eventId ?? ""),
        csvText(
          r.plots
            .map((p) => [p.code, String(p.trees), p.areaHa ?? "", p.lat ?? "", p.lon ?? ""].join(":"))
            .join(" | "),
        ),
      ].join(","),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
