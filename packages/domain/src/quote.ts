// C-09: the invoice is computed from the lot and the ratified card before any slip is read.
// Premium = shipped kg × premium rate; bonus = shipped Grade-1 kg × bonus rate; plus disbursement.
// The pool the engine splits is premium + bonus; the disbursement line covers PayPal fees.
import type { InvoiceQuote, Lot, RatifiedRateCard } from "@fairsplit/contracts";
import { jcsSha256 } from "./canon.js";
import { mulDivHalfUp } from "./money.js";

export const QUOTE_ITEM_NAMES = {
  PREMIUM: "Premium",
  BONUS: "Quality bonus",
  DISBURSEMENT: "Disbursement costs",
} as const;

export function quoteInvoice(card: RatifiedRateCard, lot: Lot): InvoiceQuote {
  const p = card.canonical.pricing;
  const premium = mulDivHalfUp(lot.shippedG, p.premiumCentsPerShippedKg, 1000);
  const bonus = mulDivHalfUp(lot.grade1ShippedG, p.bonusCentsPerShippedGrade1Kg, 1000);
  const disbursement = p.disbursementCents;
  return {
    currency: "USD",
    items: [
      { key: "PREMIUM", name: QUOTE_ITEM_NAMES.PREMIUM, quantity: "1", unitAmountCents: premium },
      { key: "BONUS", name: QUOTE_ITEM_NAMES.BONUS, quantity: "1", unitAmountCents: bonus },
      {
        key: "DISBURSEMENT",
        name: QUOTE_ITEM_NAMES.DISBURSEMENT,
        quantity: "1",
        unitAmountCents: disbursement,
      },
    ],
    totalCents: premium + bonus + disbursement,
    premiumPoolCents: premium,
    bonusPoolCents: bonus,
    poolCents: premium + bonus,
    disbursementCents: disbursement,
    lotCode: lot.lotCode,
    rateCardSha256: card.sha256,
  };
}

/** sha256 of the quote's JCS form (`pay_runs.quote_sha256`). */
export function quoteDigest(quote: InvoiceQuote): string {
  return jcsSha256(quote);
}
