/**
 * Demo DTOs built from the seed fixture (src/_shims/seed.ts). Used when the app runs without fs-api
 * (`EXPO_PUBLIC_API_ORIGIN` unset) and by unit tests. Everything here is labelled "Demo data" in the UI (I8).
 */
import type {
  ApprovalPayloadDTO,
  CosignRequestDTO,
  StatementDTO,
  StatementHistoryEntry,
} from "../_shims/api-client";
import type { ApprovalPayload, ApprovalRole, ItemStatus, LineState } from "../_shims/contracts";
import { jcs } from "../_shims/domain";
import {
  batchItems,
  batchSha256,
  batchTotalCents,
  cashDayIso,
  coop,
  fx,
  heroLine,
  heroSlips,
  linesDigest,
  payer,
  people,
  rateCard,
  rateCardSha256,
  resolvedHolds,
  runId,
  runLines,
  runSlug,
  season,
  seasonId,
  senderBatchId,
  statementTemplates,
} from "../_shims/seed";

/**
 * The hero line's demo path: still checking → sent → PayPal confirms; or PayPal parks it (unclaimed), the treasurer
 * moves it to cash at the bodega, and the clerk records it received.
 */
export const DEMO_STAGES = ["checking", "sent", "paid", "unclaimed", "cash-due", "cash-received"] as const;
export type DemoStage = (typeof DEMO_STAGES)[number];

/** Key 2 lands a few minutes after the holds are resolved; demo times follow the clock so the history reads in order. */
const minutesBefore = (iso: string, m: number) => new Date(Date.parse(iso) - m * 60_000).toISOString();

const LINE_STATE: Readonly<Record<DemoStage, LineState>> = {
  checking: "READY",
  sent: "PAYPAL_PENDING",
  paid: "PAID",
  unclaimed: "UNCLAIMED",
  "cash-due": "OFF_RAIL_DUE",
  "cash-received": "OFF_RAIL_PAID",
};

const ITEM_STATUS: Readonly<Record<DemoStage, ItemStatus | null>> = {
  checking: null,
  sent: "PENDING",
  paid: "SUCCESS",
  unclaimed: "UNCLAIMED",
  "cash-due": "RETURNED",
  "cash-received": "RETURNED",
};

/**
 * The line's history at a demo stage. What happened after the send is timed back from `now`; the send keeps its own
 * time unless that would put it after PayPal's answer (a link that jumps straight to `cash-due` was "sent" just now,
 * but PayPal parked the item six minutes ago), in which case it moves back to that answer. So the history always reads
 * in order, and the approval stays two minutes before the send it belongs to.
 */
function demoHistory(stage: DemoStage, now: string, sentAt: string): StatementHistoryEntry[] {
  if (stage === "checking") return [];
  const after: StatementHistoryEntry[] = [];
  if (stage === "paid") after.push({ kind: "paid", at: now });
  if (stage === "unclaimed" || stage === "cash-due" || stage === "cash-received") {
    after.push({ kind: "unclaimed", at: stage === "unclaimed" ? now : minutesBefore(now, 6) });
  }
  if (stage === "cash-due" || stage === "cash-received") {
    after.push({
      kind: "cash-due",
      at: stage === "cash-due" ? now : minutesBefore(now, 3),
      by: [people.treasurer.initials],
    });
  }
  if (stage === "cash-received") after.push({ kind: "received", at: now, by: [people.clerk.initials] });
  const latest = after[0]?.at ?? now;
  const sent = Date.parse(sentAt) > Date.parse(latest) ? latest : sentAt;
  return [
    { kind: "approved", at: minutesBefore(sent, 2), by: [people.treasurer.initials, people.chair.initials] },
    { kind: "sent", at: sent },
    ...after,
  ];
}

export function buildDemoStatement(opts: { stage: DemoStage; now: string; sentAt?: string }): StatementDTO {
  const { stage, now } = opts;
  const itemStatus = ITEM_STATUS[stage];
  const history = demoHistory(stage, now, opts.sentAt ?? now);
  return {
    lineId: "line_2026A_r37_M-014",
    runId,
    runSlug,
    provenance: "seeded",
    coop: { name: coop.name, place: coop.place },
    season: { code: season.code, id: season.id },
    payer: { short: payer.short },
    member: {
      memberNo: heroLine.memberNo,
      displayName: heroLine.displayName,
      nameByLang: heroLine.nameByLang,
      lang: heroLine.lang,
    },
    treasurer: {
      first: people.treasurer.first,
      name: people.treasurer.name,
      initials: people.treasurer.initials,
    },
    rail: stage === "cash-due" || stage === "cash-received" ? "CASH" : heroLine.rail,
    lineState: LINE_STATE[stage],
    item: { senderItemId: heroLine.senderItemId, status: itemStatus, updatedAt: itemStatus ? now : null },
    kilos: {
      netGrams: heroLine.netGrams,
      grade1Grams: heroLine.grade1Grams,
      coopVerifiedGrams: coop.verifiedGrams,
    },
    amounts: {
      premiumCents: heroLine.premiumCents,
      bonusCents: heroLine.bonusCents,
      deductions: heroLine.deductions,
      credits: [],
      netCents: heroLine.netCents,
    },
    fx: { phpPerUsd: fx.phpPerUsd },
    slips: heroSlips.map((s) => ({
      serial: s.serial,
      netGrams: s.netGrams,
      deliveredOn: s.deliveredOn,
      cropUrl: null,
      provisional: s.provisional,
    })),
    history,
    rateCard: { id: rateCard.id, sha256: rateCardSha256, ratifiedAt: rateCard.ratifiedAt },
    batchSha256: stage === "checking" ? null : batchSha256,
    cashDay: cashDayIso,
    expectedDate: stage === "checking" ? cashDayIso : null,
    sentences: statementTemplates,
    audio: {},
  };
}

/** The co-sign request for the seed's run r37: its eight payouts and all 64 member lines (`seed-run.json`). */
export function buildDemoCosign(opts: { now: Date; treasurerSigned: boolean }): CosignRequestDTO {
  return {
    runId,
    runSlug,
    seasonId,
    seasonCode: season.code,
    state: "request",
    provenance: "seeded",
    totalCents: batchTotalCents,
    itemCount: batchItems.length,
    currency: "USD",
    thresholdCents: rateCard.cosign.batchOverCents,
    reason: "batch-over-threshold",
    rateCardSha256,
    senderBatchId,
    batchSha256,
    linesDigest,
    items: batchItems.map((i) => ({ ...i, memberNo: i.senderItemId.replace(/^r\d+-/, "") })),
    lines: runLines,
    holds: resolvedHolds,
    treasurerSigned: opts.treasurerSigned
      ? { keyId: people.treasurer.keyId, at: minutesBefore(opts.now.toISOString(), 3) }
      : null,
    presence: { persona: "treasurer:analyn", view: "approve", at: opts.now.toISOString() },
    expiresAt: new Date(opts.now.getTime() + 30 * 60_000).toISOString(),
  };
}

/**
 * The approval-payload answer fs-api gives for a co-sign request (shim-defined `ApprovalPayloadDTO`): the payload
 * signed for `role`, its JCS, and the items and lines it binds, all taken from `request` as it stands. The demo server
 * issues it; tests build one for any batch the console may be offering.
 */
export function buildDemoApproval(
  request: CosignRequestDTO,
  opts: { role: ApprovalRole; nonce: string; exp: string },
): ApprovalPayloadDTO {
  const payload: ApprovalPayload = {
    v: 1,
    runId: request.runId,
    seasonId: request.seasonId,
    rateCardSha256: request.rateCardSha256,
    batchSha256: request.batchSha256,
    linesDigest: request.linesDigest,
    itemCount: request.itemCount,
    totalCents: request.totalCents,
    currency: "USD",
    role: opts.role,
    approverId: opts.role === "chair" ? people.chair.approverId : people.treasurer.approverId,
    nonce: opts.nonce,
    exp: opts.exp,
  };
  return {
    payload,
    jcs: jcs(payload),
    senderBatchId: request.senderBatchId,
    items: request.items.map(({ senderItemId, receiver, amountCents, currency }) => ({
      senderItemId,
      receiver,
      amountCents,
      currency,
    })),
    lines: request.lines,
  };
}
