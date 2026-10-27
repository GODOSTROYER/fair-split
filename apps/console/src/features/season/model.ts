// The season's read model (W-TR-01, and the Judge stage's first view W-JG-01), pure. Which S1 state the season
// is in, the run strip, the invoice Claude drafted and code checked, and the pool it funds. Every figure is the
// seed's or the run's (IC-03, I1): the invoice lines are the code's quote; Claude's part is only the labels.

import type { InvoiceStatus, SeasonSnapshot } from "@fairsplit/contracts";
import { atLeast, type RunStripStage, type RunView, runStrip } from "../../data/run-view.js";

export type SeasonScreenState =
  | "unratified"
  | "drafted"
  | "draft-refused"
  | "waiting"
  | "unverified"
  | "funded"
  | "auto-cancelled"
  | "offline";

/** Statuses a fresh GET may show for a funded invoice (S2.9 MM-S trigger). */
export const PAID_STATUSES: readonly InvoiceStatus[] = ["PAID", "MARKED_AS_PAID"];

export function isPaid(status: InvoiceStatus | null | undefined): boolean {
  return status !== null && status !== undefined && PAID_STATUSES.includes(status);
}

/** The card is ratified once the Secretary certified it and the Chair attested it (BR 2026-04). */
export function isRatified(snapshot: SeasonSnapshot): boolean {
  const acts = new Set(snapshot.rateCard.ratifications.map((r) => r.act));
  return acts.has("CERTIFIED") && acts.has("ATTESTED");
}

/** The run is funded: a fresh GET showed the invoice paid with nothing due (or the run moved past FUNDED). */
export function isFunded(view: RunView | undefined): boolean {
  if (!view) return false;
  return atLeast(view, "FUNDED") || (isPaid(view.invoice.status) && view.invoice.dueCents === 0);
}

/**
 * PayPal's INVOICE.PAID notice reached us but the invoice has not read back as paid: nothing starts until a
 * fresh GET confirms it (S1.7 `unverified`).
 */
export function hasUnverifiedNotice(view: RunView): boolean {
  const last = view.webhooks.last;
  return last !== null && last.eventType === "INVOICING.INVOICE.PAID" && !isFunded(view);
}

/** The latest policy verdict on Claude's invoice draft refused it (invoiceEqualsQuote). Shown only when real. */
export function draftRefused(view: RunView): boolean {
  for (let i = view.events.length - 1; i >= 0; i--) {
    const event = view.events[i];
    if (event?.type !== "policy.verdict") continue;
    if (!/invoice/i.test(event.payload.tool)) continue;
    return event.payload.verdict === "DENY";
  }
  return false;
}

export interface SeasonStateInput {
  readonly view: RunView | undefined;
  readonly snapshot: SeasonSnapshot;
  /** The browser is online. A stream reconnecting is the stage's banner, not this screen's state. */
  readonly online: boolean;
}

/** W-TR-01's `data-state` (S1.7), the most pressing first. */
export function seasonState({ view, snapshot, online }: SeasonStateInput): SeasonScreenState {
  if (!online) return "offline";
  if (!isRatified(snapshot)) return "unratified";
  if (!view) return "waiting";
  if (view.invoice.status === "CANCELLED") return "auto-cancelled";
  if (isFunded(view)) return "funded";
  if (draftRefused(view)) return "draft-refused";
  if (hasUnverifiedNotice(view)) return "unverified";
  if (view.state === "DRAFT" || view.state === "QUOTED" || view.invoice.status === "DRAFT") return "drafted";
  return "waiting";
}

export interface StripStage {
  readonly id: RunStripStage;
  readonly lit: boolean;
}

export const STRIP_ORDER: readonly RunStripStage[] = [
  "RATIFIED",
  "FUNDED",
  "READ",
  "CHECKED",
  "APPROVED",
  "PAID",
];

/** The six stages in their true sequence; each lights only when its condition holds (register §7). */
export function stripStages(view: RunView | undefined, snapshot: SeasonSnapshot): StripStage[] {
  const ratified = isRatified(snapshot);
  const lit = view
    ? runStrip(view, ratified)
    : { RATIFIED: ratified, FUNDED: false, READ: false, CHECKED: false, APPROVED: false, PAID: false };
  return STRIP_ORDER.map((id) => ({ id, lit: lit[id] }));
}

export interface InvoiceLine {
  readonly key: "PREMIUM" | "BONUS" | "DISBURSEMENT";
  /** Claude's recorded label: no digits, ever (I1). */
  readonly label: string;
  readonly cents: number;
}

/** The invoice as drafted: Claude chose the labels; every amount is the code's quote, to the cent. */
export function invoiceLines(snapshot: SeasonSnapshot): InvoiceLine[] {
  return snapshot.run.quote.items.map((item) => ({
    key: item.key,
    label: item.name,
    cents: item.unitAmountCents,
  }));
}

/** I1: a label the model wrote carries no digit (a digit in Claude's text fails validation upstream). */
export function labelHasNoDigits(label: string): boolean {
  return !/\d/.test(label);
}

export interface Pool {
  readonly premiumCents: number;
  readonly bonusCents: number;
  readonly disbursementCents: number;
  /** Premium plus bonus: what the members share. */
  readonly poolCents: number;
}

export function poolOf(snapshot: SeasonSnapshot): Pool {
  const q = snapshot.run.quote;
  return {
    premiumCents: q.premiumPoolCents,
    bonusCents: q.bonusPoolCents,
    disbursementCents: q.disbursementCents,
    poolCents: q.poolCents,
  };
}

/** The quote adds up: the three lines are the invoice, and premium plus bonus is the pool (I3). */
export function quoteBalances(snapshot: SeasonSnapshot): boolean {
  const q = snapshot.run.quote;
  const sum = q.items.reduce((s, i) => s + i.unitAmountCents, 0);
  return (
    sum === q.totalCents &&
    q.premiumPoolCents + q.bonusPoolCents === q.poolCents &&
    q.poolCents + q.disbursementCents === q.totalCents
  );
}

/** The run pill's step as a sentence for the season screen ("3 holds need you"). */
export function nextSentence(text: string): string {
  return text.replace(/^Next:\s*/, "").replace(/^\p{Ll}/u, (c) => c.toUpperCase());
}
