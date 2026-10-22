/**
 * TEMPORARY SHIM: replace with @fairsplit/domain after WS-CORE merges.
 *
 * The result of IC-02 `quoteInvoice(card, lot)`. The invoice is computed from the lot before any
 * slip is read (register C-09), in integer US cents, with three components (register §2):
 * premium, quality bonus and disbursement. This package only formats these figures; it never
 * computes or adjusts them.
 */
export interface InvoiceQuote {
  currency: "USD";
  premiumCents: bigint;
  bonusCents: bigint;
  disbursementCents: bigint;
  totalCents: bigint;
}
