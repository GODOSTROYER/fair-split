# @fairsplit/paypal-toolkit

The only importer of `@paypal/agent-toolkit` (1.11.0, zod 3.25.76). Graft G1: tool JSON Schemas come
from the toolkit's `/openai` export; every execution, agent or deterministic, runs through the
toolkit's `PayPalAPI` (from `/mcp`) on **our** token. Nothing uses `handleToolCall`, `/ai-sdk` or `ai`.

```ts
const tk = createTk({ auth, limiter, onCall }); // IC-06 tk(method, args, requestId?)
const invoices = new Invoices({ tk, repo, businessEmail, ppMode }); // PP_BUSINESS_EMAIL, PP_MODE (ADR-0002)
await invoices.ensureForRun(run, { draft }); // create (adopt) → send (approved) → payable GET → AUTO_CANCEL
await invoices.recordPayment(run); // Judge Mode, labelled simulated_rail
await invoices.confirmFunding(run); // FUNDED only on PAID|MARKED_AS_PAID, 0.00 due
agentToolSchemas(); // the 4 Invoicing tools for AI-7
await runAgentToolkitTool({ run, invoices }, name, input, { treasurerApproval });
```

- **`tk()`** validates with the toolkit's zod, takes a token from the shared limiter (required; a
  `{ok:false}` decision throws `ToolkitLimitedError` and nothing is sent), builds a fresh `PayPalAPI` per
  call (the toolkit's own token never refreshes), recovers `paypal-debug-id` and the HTTP status through
  an interceptor on the toolkit's axios (scoped by AsyncLocalStorage), applies a 15 s timeout, and
  retries a 401 once after `auth.invalidate(staleToken)`. PayPal failures throw `ToolkitError`.
- **Allowlists.** Agent: `create_invoice`, `send_invoice`, `create_conditional_rules_for_invoice`,
  `get_invoice`. Server only: `record_payment_for_invoice`, `search_invoicing`, `delete_invoice`. Both
  sets are asserted against the installed package.
- **The chain** (the approved plan; S3 §S3.6.3), checkpointed step by step:
  1. `create_invoice` under `FS-{runSlug}`; on any failure, `search_invoicing` and adopt only an invoice
     deep-equal to the canonical body for the labels it carries (number, reference, the memo, total,
     invoicer, recipient, the three lines' amounts under three distinct valid labels, no descriptions or
     terms, no tip, partial payment, shipping, tax or discount, an adoptable status), else HALT.
  2. `send_invoice` with exactly `sendInvoiceArgs(invoiceId)` (`send_to_recipient: false`, no subject,
     note or extra recipient), only with a `TreasurerApproval` naming this invoice. An approval given for
     an invoice that exists is bound to it: `invoiceSendApproval({approverId, approvedAt, invoiceNumber,
     invoiceId})` adds `sendArgsSha256` (sha256 of the JCS of that exact send), and the id and the hash
     must both match. The agent's `send_invoice` (and `Invoices.send`) accept only a bound approval; the
     server chain may also hold one given before the invoice existed, naming `FS-{runSlug}` alone.
  3. A payable GET: SENT, UNPAID, SHARED or later. It stores the date PayPal gave the invoice. SCHEDULED is
     deleted and recreated once; a second SCHEDULED, or any other status, is `InvoiceNotPayableError`. An
     approval bound to the deleted invoice does not send its replacement: the chain stops at
     `PENDING_APPROVAL` with the new invoice's id until the treasurer approves that one.
  4. AUTO_CANCEL with SPECIFIC_DATE on PayPal's invoice date + 25 days (C-27), after PayPal's today
     (`ppDate`, America/Los_Angeles) and within 30 days, under `PayPal-Request-Id: cr-{invoiceId}`.

  `invoice_date`, `payment_term` and `payment_date` are never sent, so a send can never schedule the
  invoice and no UTC date lands on PayPal's tomorrow. There is no due date anywhere (I8).
- **Invoice fields** (register §8; the approved plan): `FS-{runSlug}`, `rc:{rateCardSha16}`, the memo as
  the note (exactly), the business e-mail as invoicer, the brand as the one recipient, and the IC-02
  quote's three USD lines (a 0.00 line stays). The quote must belong to the run's card and lot and agree
  with its own pools.
- **I1: the agent's only words are the three item labels** (the plan: "Item names: Claude's recorded
  labels"; S4.4 `canonicalInvoice(quote, labels)`). A label is 1–40 characters, a letter first, then
  letters, spaces and `,'()-` (S4.4 `checkLabels`, so no digit, link, e-mail or phone), the three are
  distinct, and none spells a number in English words ("Four thousand dollars"), which `checkLabels`
  alone lets through. `withItemLabels(plan, labels)` builds the arguments; every amount is the code's.
  The checkpoint keeps the labels, so a recreated invoice reads as the first did.
- **The agent's path.** `runAgentToolkitTool` is bound to one run and calls the same steps (`create`,
  `send`, `ensureRule`, `fetch`), never raw `tk()`. A draft is compared as the model wrote it (so a key the
  toolkit's zod would strip still counts) and must equal the code-built invoice but for the labels. Calls
  about any other invoice, approvals not bound to this invoice and this send, and other rule dates are
  refused before anything is sent. The rule PayPal receives is `autoCancelRuleArgs(invoiceId, date)`
  with the date PayPal gave the invoice plus 25 days, built from the checkpoint; the agent's rule
  arguments only have to agree with it. The agent never deletes an invoice: a SCHEDULED one is left for
  the server chain.
- **Labels (I8, ADR-0002).** `ppMode` is required: on the simulator every result and funding check is
  `simulated_rail`; on the sandbox a recorded payment (MARKED_AS_PAID) still is, and the rest is `live`.
- **IC-05** comes from `@fairsplit/paypal-core` (WS-PPCORE's `PayPalAuth`, of which `tk()` needs only
  `token` and `invalidate`, and its `PayPalLimiter`; purposes are `toolkit:{method}`). S3's `ppDate` lives
  in `src/dates.ts`, since paypal-core does not export it. Shims in `src/_shims/` still stand in for
  `domain` (WS-CORE's `InvoiceQuote`) and `contracts` until those merge; each says what replaces it.

Spike S2 results: `spikes/README.md`.
