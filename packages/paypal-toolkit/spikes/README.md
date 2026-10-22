# Spike S2 (schema half): measured 22 Oct 2026

Register §12, S2: "The toolkit's `/openai` schemas are accepted on claude-opus-5-5. Then: create, send,
AUTO_CANCEL rule, get, record payment, verified INVOICE.PAID."

**Verdict for the schema half: GREEN.** Graft G1 stands as planned; no fallback is needed.

| Probe (`spikes/s2-openai-schemas.ts --live`)                                                                                  | Result                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `count_tokens` with the four `/openai` schemas as `input_schema` (draft-07, `$schema` and `additionalProperties: false` kept) | Accepted; 5,962 input tokens                                                                                                                   |
| "Look up invoice INV2-…"                                                                                                      | `stop_reason: tool_use`, one `get_invoice` call, input valid under the toolkit's own zod; 2.1 s                                                |
| "Create this invoice" with the code-built values                                                                              | One `create_invoice` call, valid under the toolkit's zod, and `reconcileAgentDraft` finds it equal to the code-built invoice (I1 holds); 5.1 s |
| Payout read tools (`../../paypal-payouts/spikes/s2-payout-read-schemas.ts --live`)                                            | Accepted; 1,167 input tokens; one `get_payout_item` call, valid under the vendored PR #107 schema; 1.5 s                                       |

Re-run 22 Oct 2026 after the I1 rule was tightened (the note may only close the memo with one phrase from
a closed list; item names are the code's): Opus 5.5 chose "Thank you.", kept the code's item names,
and the draft reconciles; 5.3 s, US$0.0629.

Rule changed again on 23 Oct to the approved plan and S4.4: the note is the memo exactly, and the agent
chooses the three item labels (letters, spaces and `,'()-`, distinct, no number words). Re-run with a prompt
that asks for labels: Opus 5.5 labelled the lines "Premium", "Quality bonus" and "Disbursement costs", kept
every other value, and the draft reconciles; 5.2 s, US$0.0609.

Spend: US$0.0614 + US$0.0061 + US$0.0629 + US$0.0609 at US$4 / US$20 per MTok, effort `low`, no sampling parameters,
no forced `tool_choice`. Server-side fallbacks were left off on purpose, so the result is Opus 5.5's own.

**Still open (needs the S1 sandbox credentials, not yet in `.env`):** the PayPal half: create → send
(`send_to_recipient: false`) → AUTO_CANCEL rule after send → GET → record payment → verified
INVOICE.PAID; whether PayPal accepts the rule after send (if not, set `ruleBeforeSend: true`); the
payment term PayPal applies when `create_invoice` sends none (the toolkit has no `payment_term`
field); whether the axios interceptor sees `paypal-debug-id` on real sandbox responses (it does
under msw). Spike S4 (Payouts: 201, UNCLAIMED → cancel → RETURNED, ERRPYO005/ERRPYO002) also waits for S1.

Results append to `.cache/spikes/*.jsonl` (gitignored); without `--live` the scripts print the last run.
