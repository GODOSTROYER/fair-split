// The toast's catalog (UI gate round 5): what the Next pill says for 3 s when a live event lands, in plain words. No
// "Notice:", no event code, no timestamp (times live only in the Run log), never a full stop; never "success" while a
// payment is parked or cash is due. "PayPal accepted the batch", "Shrink 2.05% · over limit", "Refused · invoice must
// equal quote", "Paid Consolacion Bacus · US$64.45". The row's own words are the fallback, made plain.

import type { RunEvent } from "@fairsplit/contracts";
import type { LogRow } from "../data/describe.js";

/** PayPal's notices, by what they mean for the run. A batch PayPal took is "accepted", never a "success". */
const NOTICE_TOAST: Readonly<Record<string, string>> = {
  "INVOICING.INVOICE.PAID": "Invoice paid",
  "PAYMENT.PAYOUTSBATCH.SUCCESS": "PayPal accepted the batch",
  "PAYMENT.PAYOUTSBATCH.PROCESSING": "PayPal is processing the batch",
  "PAYMENT.PAYOUTSBATCH.DENIED": "PayPal declined the batch",
  // E-19: the pill never says "PayPal confirmed" bare; the bar's simulated indicator and the jade mark carry the rail.
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": "Payment confirmed",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": "A payment is parked · needs a decision",
  "PAYMENT.PAYOUTS-ITEM.CANCELED": "Payment cancelled",
  "PAYMENT.PAYOUTS-ITEM.RETURNED": "Payment returned",
  "PAYMENT.PAYOUTS-ITEM.FAILED": "Payment failed",
};

/** "shrink 2.05%, over 2.0%" → "Shrink 2.05% · over limit"; inside the limit, "within limit". */
export function shrinkToast(words: string): string | null {
  const m = /shrink ([\d.]+%), (over|inside) /i.exec(words);
  if (!m) return null;
  return `Shrink ${m[1]} · ${m[2]?.toLowerCase() === "over" ? "over limit" : "within limit"}`;
}

/** A sentence's full stop and a bracketed rail note go; the words stay. */
function plain(words: string): string {
  return words
    .replace(/\s*\((?:simulated|Simulated) PayPal sandbox\)/g, "")
    .replace(/\.\s*$/, "")
    .trim();
}

/** The pill's words for a live event's row. */
export function toastWords(row: LogRow, event?: RunEvent): string {
  if (event?.type === "webhook.received") {
    if (event.payload.duplicate) return "Repeat notice · already applied";
    const words = NOTICE_TOAST[event.payload.eventType];
    if (words) return words;
  }
  const notice = /^PayPal notice: ([A-Z0-9_.-]+)$/.exec(row.words);
  if (notice?.[1]) return NOTICE_TOAST[notice[1]] ?? "PayPal sent a notice";
  if (event?.type === "hold.raised" || event?.type === "hold.resolved") {
    const shrink = shrinkToast(row.words);
    if (shrink) return shrink;
  }
  // Round 6: a slip's reading is said without the member's id ("Reading slip 0428"): the pill is not a log line.
  const read = /^Read slip (\d+)\b/.exec(row.words);
  if (read?.[1]) return `Reading slip ${read[1]}`;
  if (event?.type === "item.updated" && !/^Replayed/.test(row.words)) {
    const p = event.payload;
    const paid = /^Paid (.+?) (US\$[\d,]+\.\d{2})/.exec(plain(row.words));
    if (p.to === "SUCCESS" && paid) return `Paid ${paid[1]} · ${paid[2]}`;
    if (p.to === "UNCLAIMED") return `${row.words.split("'s address")[0]} · parked`;
  }
  return plain(row.words);
}
