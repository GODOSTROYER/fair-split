/**
 * TEMPORARY SHIM: replace with @fairsplit/domain (and its contracts) after WS-CORE merges.
 *
 * The result of IC-02 `quoteInvoice(card, lot)`, with the names and shapes of WS-CORE's draft
 * (`InvoiceQuote` in packages/contracts/src/domain.ts on ws/core, not yet frozen), written as plain
 * types because this package is zod 3. The invoice is computed from the lot and the ratified card
 * before any slip is read (register C-09), in integer US cents (numbers, as JCS has no bigint), with
 * three lines in this order (register §2): premium, quality bonus, disbursement costs. This package
 * only formats these figures; it never computes or adjusts them.
 */

export type QuoteItemKey = "PREMIUM" | "BONUS" | "DISBURSEMENT";

export interface InvoiceQuoteItem {
  key: QuoteItemKey;
  /** The line's label (register §8: ≤ 40 characters, letters, spaces and ,'()-, no digits). */
  name: string;
  quantity: "1";
  unitAmountCents: number;
}

export interface InvoiceQuote {
  currency: "USD";
  items: readonly InvoiceQuoteItem[];
  totalCents: number;
  premiumPoolCents: number;
  bonusPoolCents: number;
  poolCents: number;
  disbursementCents: number;
  lotCode: string;
  rateCardSha256: string;
}
