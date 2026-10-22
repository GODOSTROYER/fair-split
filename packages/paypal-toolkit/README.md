# @fairsplit/paypal-toolkit

The only importer of `@paypal/agent-toolkit` (1.11.0, zod 3.25.76). Graft G1: tool JSON Schemas come
from the toolkit's `/openai` export; every execution, agent or deterministic, runs through the
toolkit's `PayPalAPI` (from `/mcp`) on **our** token. Nothing uses `handleToolCall`, `/ai-sdk` or `ai`.

```ts
const tk = createTk({ auth, limiter, onCall }); // IC-06 tk(method, args, requestId?)
const invoices = new Invoices({ tk, repo, businessEmail }); // PP_BUSINESS_EMAIL
await invoices.ensureForRun(run, { draft }); // create (adopt) → send (approved) → AUTO_CANCEL rule
await invoices.recordPayment(run); // Judge Mode, labelled simulated_rail
await invoices.confirmFunding(run); // FUNDED only on PAID|MARKED_AS_PAID, 0.00 due
agentToolSchemas(); // the 4 Invoicing tools for AI-7
await runAgentToolkitTool({ run, invoices }, name, input, { treasurerApproval });
```

- **`tk()`** validates with the toolkit's zod, takes a limiter token, builds a fresh `PayPalAPI` per
  call (the toolkit's own token never refreshes), recovers `paypal-debug-id` and the HTTP status
  through an interceptor on the toolkit's axios (scoped by AsyncLocalStorage), applies a 15 s
  timeout, and retries a 401 once after `auth.invalidate()`. Failures throw `ToolkitError`.
- **Allowlists.** Agent: `create_invoice`, `send_invoice`, `create_conditional_rules_for_invoice`,
  `get_invoice`. Server only: `record_payment_for_invoice`, `search_invoicing`. Both sets are asserted
  against the installed package.
- **One chain for the agent and the server.** `runAgentToolkitTool` is bound to one run and runs each
  call through that run's checkpointed `Invoices` steps (`create`, `send`, `ensureRule`, `fetch`), never
  through raw `tk()`: one idempotency key (`FS-{runSlug}`), one adoption rule, one checkpoint. Calls
  about any other invoice are refused before anything is sent.
- **Invoice fields** (register §8): `FS-{runSlug}`, `rc:{rateCardSha16}`, the memo note, the business
  e-mail as invoicer, the brand as the one recipient, three code-computed USD lines (Premium, Quality
  bonus, Disbursement costs), AUTO_CANCEL on the invoice date + 25 days (C-27). There is no due date:
  toolkit 1.11.0 cannot send a `payment_term`, so no Fair Split date is shown as one (I8). An agent
  draft must equal the code-built invoice; it may only close the memo with one phrase from
  `INVOICE_NOTE_CLOSINGS` (I1: no model-written numbers or free text reach the brand).
- **sendNeedsTreasurer.** A `TreasurerApproval` names the invoice it sends (`FS-{runSlug}`, and
  PayPal's id when known); `send_to_recipient` is always false and no agent note is sent.
- **Adoption.** On any create failure the chain searches by `invoice_number`, then adopts only after a
  fresh GET shows our number, reference, total, invoicer, recipient, lines, a readable date and an
  adoptable status (otherwise `InvoiceAdoptError`: HALT). An adopted invoice keeps PayPal's date.
- **Shims** in `src/_shims/` stand in for `@fairsplit/paypal-core`, `domain` and `contracts` until
  those merge; each says what replaces it.

Spike S2 results: `spikes/README.md`.
