/**
 * Demo DTOs built from the seed fixture (src/_shims/seed.ts). Used when the app runs without fs-api
 * (`EXPO_PUBLIC_API_ORIGIN` unset) and by unit tests. Everything here is labelled "Demo data" in the UI (I8).
 */
import type { CosignRequestDTO, StatementDTO, StatementHistoryEntry } from "../_shims/api-client";
import type { ItemStatus, LineState } from "../_shims/contracts";
import {
  batchItems,
  batchSha256,
  batchTotalCents,
  cashDayIso,
  coop,
  fx,
  heroLine,
  heroSlips,
  payer,
  people,
  rateCard,
  rateCardSha256,
  resolvedHolds,
  runId,
  runSlug,
  season,
  senderBatchId,
  statementSentences,
} from "../_shims/seed";

export type DemoStage = "checking" | "sent" | "paid" | "unclaimed";

const APPROVED_AT = "2026-10-29T10:24:00+08:00";

export function buildDemoStatement(opts: { stage: DemoStage; now: string; sentAt?: string }): StatementDTO {
  const { stage, now } = opts;
  const sentAt = opts.sentAt ?? now;
  const lineState: LineState =
    stage === "checking"
      ? "READY"
      : stage === "sent"
        ? "PAYPAL_PENDING"
        : stage === "paid"
          ? "PAID"
          : "UNCLAIMED";
  const itemStatus: ItemStatus | null =
    stage === "sent" ? "PENDING" : stage === "paid" ? "SUCCESS" : stage === "unclaimed" ? "UNCLAIMED" : null;
  const history: StatementHistoryEntry[] = [];
  if (stage !== "checking") {
    history.push({
      kind: "approved",
      at: APPROVED_AT,
      by: [people.treasurer.initials, people.chair.initials],
    });
    history.push({ kind: "sent", at: sentAt });
  }
  if (stage === "paid") history.push({ kind: "paid", at: now });
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
      audioFirst: heroLine.audioFirst,
    },
    treasurer: {
      first: people.treasurer.first,
      name: people.treasurer.name,
      initials: people.treasurer.initials,
    },
    rail: heroLine.rail,
    lineState,
    item: { senderItemId: heroLine.senderItemId, status: itemStatus, updatedAt: itemStatus ? now : null },
    kilos: { netGrams: heroLine.netGrams, grade1Grams: heroLine.grade1Grams },
    amounts: {
      premiumCents: heroLine.premiumCents,
      bonusCents: heroLine.bonusCents,
      deductions: heroLine.deductions,
      creditsCents: heroLine.creditsCents,
      netCents: heroLine.netCents,
    },
    premiumRatePerKg: heroLine.premiumRatePerKg,
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
    sentences: statementSentences,
    audio: null,
  };
}

export function buildDemoCosign(opts: { now: Date; treasurerSigned: boolean }): CosignRequestDTO {
  return {
    runId,
    runSlug,
    seasonId: season.id,
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
    items: batchItems.map((i) => ({ ...i, memberNo: i.senderItemId.replace(/^r\d+-/, "") })),
    holds: resolvedHolds,
    treasurerSigned: opts.treasurerSigned ? { keyId: people.treasurer.keyId, at: APPROVED_AT } : null,
    presence: { persona: "treasurer:analyn", view: "approve", at: opts.now.toISOString() },
    expiresAt: new Date(opts.now.getTime() + 30 * 60_000).toISOString(),
  };
}
