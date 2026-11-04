import { payoutStatus } from "../../data/payout-replay.js";
// The showcase run (r37) has no event stream: it is the seed's end state. Its log is rebuilt from the snapshot
// and every row is labelled seeded, so nothing on screen claims a notice arrived that did not (I8).

import { INVOICE_STATUS_LABELS, pickLabel, type SeasonSnapshot } from "@fairsplit/contracts";
import { type DescribeContext, type LogRow, RESOLUTION_WORDS } from "../../data/describe.js";
import { format } from "../../lib/format.js";

const SEEDED = "seeded sample";

export function seededLog(snapshot: SeasonSnapshot, ctx: DescribeContext): LogRow[] {
  const run = snapshot.run;
  const rows: LogRow[] = [];
  const row = (r: Omit<LogRow, "provenance" | "duplicate">): void => {
    rows.push({ ...r, provenance: "seeded", duplicate: false });
  };
  row({
    id: "seed-invoice",
    lane: "PAYPAL",
    words: `Invoice ${run.invoice.invoiceNumber}: ${pickLabel(INVOICE_STATUS_LABELS[run.invoice.status], "en")}`,
    detail: `Invoicing v2, simulated rail, ${SEEDED}`,
    at: run.invoice.invoiceDate,
    type: "invoice.state",
  });
  const out = snapshot.checkpoints.resolved;
  row({
    id: "seed-lines",
    lane: "MACHINE",
    words: `${out.lines.length} lines computed${out.conservation.balanced ? ", balanced to the cent" : ""}`,
    detail: `Computed by engine v1, rate card ${format.hashGroups(snapshot.rateCard.sha256)}, ${SEEDED}`,
    at: run.recordedOn,
    type: "run.state",
  });
  for (const hold of [...snapshot.holds].sort((a, b) =>
    (a.resolvedAt ?? "").localeCompare(b.resolvedAt ?? ""),
  )) {
    if (!hold.resolvedWith || !hold.resolvedBy || hold.resolvedBy === "engine") continue;
    row({
      id: `seed-hold-${hold.key}`,
      lane: "PEOPLE",
      words: `${hold.label} resolved by ${ctx.personName(hold.resolvedBy)}`,
      detail: `${RESOLUTION_WORDS[hold.resolvedWith]}, ${SEEDED}`,
      at: hold.resolvedAt,
      type: "hold.resolved",
    });
  }
  for (const approval of run.approvals) {
    const who = ctx.personName(approval.role === "treasurer" ? "treasurer:analyn" : "board:ernesto");
    row({
      id: `seed-approval-${approval.role}`,
      lane: "PEOPLE",
      words: `${who} signed`,
      detail: `key ${approval.keyId}, batch ${format.hashGroups(approval.payload.batchSha256)}, ${SEEDED}`,
      at: null,
      type: "approval.signed",
    });
  }
  for (const item of run.items) {
    const name = ctx.memberName(item.memberNo);
    const ref = `item ${item.payoutItemId.slice(0, 3)}…`;
    if (item.status === "SUCCESS") {
      row({
        id: `seed-item-${item.memberNo}`,
        lane: "PAYPAL",
        words: `${payoutStatus({ itemStatus: item.status }).statusWord}: ${name} ${format.money(item.amountCents)}`,
        detail: `PAYMENT.PAYOUTS-ITEM.SUCCEEDED, ${ref}, ${SEEDED}`,
        at: null,
        type: "item.updated",
      });
    } else {
      row({
        id: `seed-item-${item.memberNo}`,
        lane: "PAYPAL",
        words: `${name}: returned to the co-op's simulated PayPal balance, then moved to cash`,
        detail: `PAYMENT.PAYOUTS-ITEM.CANCELED, ${ref}, our cancel, ${SEEDED}`,
        at: null,
        type: "item.updated",
      });
    }
  }
  return rows;
}
