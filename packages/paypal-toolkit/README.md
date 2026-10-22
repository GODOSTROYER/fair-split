# @fairsplit/paypal-toolkit

The only importer of `@paypal/agent-toolkit` (1.11.0, zod 3.25.76). Graft G1: tool JSON Schemas come
from the toolkit's `/openai` export; every execution, agent or deterministic, runs through the
toolkit's `PayPalAPI` (from `/mcp`) on **our** token. Nothing uses `handleToolCall`, `/ai-sdk` or `ai`.

```ts
const tk = createTk({ auth, limiter, onCall }); // IC-06 tk(method, args, requestId?)
const invoices = new Invoices({ tk, repo, businessEmail }); // PP_BUSINESS_EMAIL
await invoices.ensureForRun(run, { draft }); // create (adopt) → send → AUTO_CANCEL rule
await invoices.recordPayment(run); // Judge Mode, labelled simulated_rail
await invoices.confirmFunding(run); // FUNDED only on PAID|MARKED_AS_PAID, 0.00 due
agentToolSchemas(); // the 4 Invoicing tools for AI-7
await runAgentToolkitTool(tk, name, input, { treasurerApproval });
```

- **`tk()`** validates with the toolkit's zod, takes a limiter token, builds a fresh `PayPalAPI` per
  call (the toolkit's own token never refreshes), recovers `paypal-debug-id` and the HTTP status
  through an interceptor on the toolkit's axios (scoped by AsyncLocalStorage), applies a 15 s
  timeout, and retries a 401 once after `auth.invalidate()`. Failures throw `ToolkitError`.
- **Allowlists.** Agent: `create_invoice`, `send_invoice` (treasurer approval; always
  `send_to_recipient: false`), `create_conditional_rules_for_invoice` (AUTO_CANCEL on a SPECIFIC_DATE
  only, request id `cr-{invoiceId}`), `get_invoice`. Server only: `record_payment_for_invoice`,
  `search_invoicing`. Both sets are asserted against the installed package.
- **Invoice fields** (register §8): `FS-{runSlug}`, `rc:{rateCardSha16}`, the memo note, the business
  e-mail as invoicer, three code-computed USD items, AUTO_CANCEL on the invoice date + 25 days (C-27).
  An agent draft may change wording only (`reconcileAgentDraft`, I1).
- **Shims** in `src/_shims/` stand in for `@fairsplit/paypal-core`, `domain` and `contracts` until
  those merge; each says what replaces it.

Spike S2 results: `spikes/README.md`.
