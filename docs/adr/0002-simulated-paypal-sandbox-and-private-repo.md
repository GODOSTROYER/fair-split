# ADR-0002: Contract-faithful PayPal sandbox simulator, and a private repo until submission

Date: 2026-10-23 · Status: accepted (user decision)

## Context

- The developer is in India and reports that they cannot create the US PayPal accounts the plan's spike S1 assumed.
  Without sandbox REST credentials, no call can reach `api-m.sandbox.paypal.com`.
- The user wants the repository private until submission so the idea and code are not copied early.

## Decision

1. **PayPal rail modes.** `PP_MODE=simulator` (default until credentials exist) and `PP_MODE=sandbox`.
   - `packages/paypal-sim` is a contract-faithful simulator of the PayPal REST subset Fair Split uses: OAuth2 token,
     Invoicing v2 (create, send, get, search, record payment, conditional rules, delete), Payouts v1 (create batch,
     get batch, get item, cancel unclaimed), Webhooks v1 (webhooks CRUD, verify-webhook-signature, webhooks-events
     list and resend), and the Transaction Search and balance reads used for reconciliation.
   - Every request and response is validated against PayPal's published OpenAPI specifications
     (github.com/paypal/paypal-rest-api-specifications); errors use PayPal's documented shapes, `debug_id`, HATEOAS links,
     the documented ERRPYO test values, UNCLAIMED for receivers without an account, the 50 requests/min/IP throttle,
     and realistic asynchronous status timing.
   - Webhooks are delivered to our real endpoint, signed exactly like PayPal's (RSA-SHA256 over
     `transmissionId|timestamp|webhookId|crc32(body)`) with a simulator CA whose cert URL is allow-listed **only** in
     simulator mode.
   - The real `@paypal/agent-toolkit` 1.11.0 and `@paypal/paypal-server-sdk` 2.5.0 code paths stay unchanged: in
     simulator mode their HTTP traffic to the sandbox host is routed to the simulator, so switching to the real
     sandbox is one environment variable.
2. **Honesty.** Every PayPal-derived value carries provenance `simulated_rail` (invariant I8). The UI, Proof, README,
   Devpost text and film say "Simulated PayPal sandbox (contract-tested against PayPal's OpenAPI specs)". The plan's
   claims about real sandbox objects, `debug_id`s, postback SUCCESS and the S5 hosted-page run apply only if real
   credentials become available.
3. **Repository visibility.** Private until the submission window (target 10-11 Nov), then made public with an MIT
   licence visible in the About box, as the rules require. This amends the register's "public from the first commit".

## Consequences and risks

- **Stage-1 risk:** the rules ask for an application that "integrates the PayPal developer platform (using the free
  sandbox environment)". A simulated rail may be judged weaker on Technological Implementation and could be
  challenged at Stage 1. Mitigation: the integration code is the real PayPal SDK/Agent Toolkit code, validated against
  PayPal's own specs; one switch moves to the real sandbox. **Recommended:** create sandbox credentials through
  developer.paypal.com before submission if at all possible (sandbox test accounts are fictitious and are created
  from the developer dashboard; they are not real US PayPal accounts).
- GitHub push protection and secret scanning are limited on free private repos, so the local lefthook guards and the
  gitleaks CI job are the primary controls until the repo is public.
