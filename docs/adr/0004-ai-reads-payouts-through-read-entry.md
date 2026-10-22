# ADR-0004: packages/ai reads payouts only through `@fairsplit/paypal-payouts/read`

- **Status:** Accepted (user, on merge)
- **Date:** 23 Oct 2026 (IST)
- **Author:** WS-QA
- **Touches:** register §6 (dependency rule), register §8 (Payouts v1 row), register §9 (AI-7), `.dependency-cruiser.cjs`,
  `packages/paypal-payouts` exports (WS-PPMONEY), `packages/ai` imports (WS-READ, WS-AGENT)

## Context

Register §6 puts `paypal-*` and `ai` in the same layer: `outbox ← {paypal-*, ai} ← {apps/api, apps/tasks}`. It does
not say whether `ai` may import a `paypal-*` package. Register §8 says `create_payout_batch` and
`cancel_unclaimed_payout_item` are "Server only, through `PayoutsService`", while `get_payout_batch` and
`get_payout_item` are "Agent (read only) and server". AI-7 has no tool that moves money, and S4 lists the two payout
reads as the agent's only payout tools (architecture §8: "The model sees only `get_payout_batch` and
`get_payout_item`").

The first dependency-cruiser config let `packages/ai` import all of `paypal-core`, `paypal-toolkit` and
`paypal-payouts`, so agent code could import `PayoutsService.executeApproved` and nothing would fail.

## Decision

1. Among the PayPal packages, `packages/ai` may import only:
   - `@fairsplit/paypal-toolkit` (its main entry: `agentToolSchemas`, `tk()`), and
   - `@fairsplit/paypal-payouts/read`, a read-only entry that exposes `get_payout_batch` and `get_payout_item` and
     nothing that writes.
2. `packages/ai` never imports `@fairsplit/paypal-core` or the main entry of `@fairsplit/paypal-payouts`.
3. dependency-cruiser enforces this: layer rule `layer-ai` drops `paypal-core`, and rule `ai-payouts-read-only` fails
   any import from `packages/ai/` into `packages/paypal-payouts/` that does not resolve to a file behind the
   `"./read"` export. Until that export exists, every such import fails.

## Consequences

- WS-PPMONEY adds `"./read": { "types": "./src/read.ts", "default": "./src/read.ts" }` to
  `packages/paypal-payouts/package.json`, with `src/read.ts` re-exporting only the two read tools. A test there
  asserts the module's export names (no `create`, `cancel` or `PayoutsService`).
- WS-AGENT imports payout reads from `@fairsplit/paypal-payouts/read` only.
- `apps/api` and `apps/tasks` still import the main entry, so `PayoutsService` stays server-only (I6: a human
  approves the irreversible step).
- Proven by `packages/test-kit/test/dependency-rules.test.mjs` (a planted `packages/ai` import of the main entry
  fails; the `/read` import passes).

## Alternatives considered

| Option                                     | Why not                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| Keep `ai → paypal-payouts` fully open      | Lets agent code reach `executeApproved`; contradicts register §8 and AI-7     |
| Forbid `ai → paypal-*` entirely            | The agent's invoice and payout reads (register §8) need the toolkit and reads |
| Inject read functions from `apps/api` only | Workable, but the register names the tools as the agent's; more wiring        |
