// The simulator-hosted invoice pay page (recipient_view_url). It is plainly labelled as a simulator,
// carries no PayPal branding and asks for no credentials: one button records a simulated PayPal payment.
import type { InvoiceRecord, Json, JsonObject } from "../state.js";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function obj(v: Json | undefined): JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
}

function text(v: Json | undefined): string {
  return typeof v === "string" ? v : "";
}

const STYLE = `
  :root { color-scheme: light dark; --bg: #f6f4ef; --fg: #1d1b16; --muted: #6b665c; --line: #d9d3c7; --card: #fffdf8; --accent: #1f6f5c; }
  @media (prefers-color-scheme: dark) { :root { --bg: #16140f; --fg: #f1ede4; --muted: #a39d90; --line: #3a362d; --card: #1f1c16; --accent: #5cc2a6; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px 48px; }
  .banner { border: 2px dashed var(--accent); border-radius: 10px; padding: 10px 14px; font-weight: 600; margin-bottom: 20px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px; }
  h1 { font-size: 1.3rem; margin: 0 0 4px; }
  .muted { color: var(--muted); font-size: 0.9rem; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  td { padding: 6px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
  td.amt { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .total td { font-weight: 700; border-bottom: none; }
  button { width: 100%; padding: 14px; border: 0; border-radius: 10px; background: var(--accent); color: #fff; font-size: 1rem; font-weight: 600; cursor: pointer; }
  .status { display: inline-block; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--line); font-size: 0.85rem; }
`;

/** Renders the pay page for an invoice. `payable` controls whether the pay button appears. */
export function renderPayPage(
  rec: InvoiceRecord,
  opts: { payable: boolean; message?: string; action: string },
): string {
  const inv = rec.invoice;
  const detail = obj(inv.detail);
  const invoicer = obj(inv.invoicer);
  const amount = obj(inv.amount);
  const due = obj(inv.due_amount);
  const currency = text(detail.currency_code) || "USD";
  const recipient = obj(
    obj((Array.isArray(inv.primary_recipients) ? inv.primary_recipients : [])[0]).billing_info,
  );
  const rows = (Array.isArray(inv.items) ? inv.items : [])
    .map((i) => {
      const it = obj(i);
      const unit = obj(it.unit_amount);
      return `<tr><td>${escapeHtml(text(it.name))} <span class="muted">× ${escapeHtml(text(it.quantity) || "1")}</span></td><td class="amt">${escapeHtml(currency)} ${escapeHtml(text(unit.value))}</td></tr>`;
    })
    .join("");
  const status = escapeHtml(text(inv.status));
  const button = opts.payable
    ? `<form method="post" action="${escapeHtml(opts.action)}"><button type="submit">Pay ${escapeHtml(currency)} ${escapeHtml(text(due.value))} (simulated)</button></form>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Simulated invoice ${escapeHtml(text(detail.invoice_number))}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <div class="banner" role="note">Simulated PayPal sandbox (Fair Split simulator). This is not PayPal and no money moves.</div>
  <div class="card">
    <h1>Invoice ${escapeHtml(text(detail.invoice_number))}</h1>
    <div class="muted">From ${escapeHtml(text(invoicer.business_name) || text(invoicer.email_address))} · to ${escapeHtml(text(recipient.business_name) || text(recipient.email_address))}</div>
    <p><span class="status" data-status="${status}">${status}</span></p>
    ${detail.note ? `<p>${escapeHtml(text(detail.note))}</p>` : ""}
    <table>
      ${rows}
      <tr class="total"><td>Total</td><td class="amt">${escapeHtml(currency)} ${escapeHtml(text(amount.value))}</td></tr>
      <tr><td>Amount due</td><td class="amt" data-due="${escapeHtml(text(due.value))}">${escapeHtml(currency)} ${escapeHtml(text(due.value))}</td></tr>
    </table>
    ${opts.message ? `<p role="status">${escapeHtml(opts.message)}</p>` : ""}
    ${button}
    <p class="muted">Invoice ID ${escapeHtml(rec.id)}</p>
  </div>
</main>
</body>
</html>`;
}
