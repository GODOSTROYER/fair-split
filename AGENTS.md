# AGENTS.md — rules for every coding agent working on Fair Split

Fair Split · co-op payroll is a PayPal AI Hackathon entry (deadline 2026-11-12 12:00 PST).
The source of truth is `docs/spec/`, read in this order of precedence:
1. `docs/spec/00-decision-register.md` (names, IDs, numbers, routes, states, workstreams, contracts, gates)
2. `docs/spec/01-design-direction.md` (art direction, tokens, motion, magic moments)
3. `docs/spec/02-architecture.md` (services, data model, PayPal integration, invariants I1–I8)
4. `docs/spec/S1…S5` (section specs). Where they conflict with 1–3, 1–3 win.

## Non-negotiables

- **Invariants I1–I8** (architecture §0): the model never writes a number into a line, invoice, payout or statement;
  rules are frozen before facts; money is conserved; the approved digest is the payout; state only moves forward;
  a human approves the irreversible step; effects go through the transactional outbox; nothing simulated is unlabelled.
- **Pins are exact.** Use `catalog:` versions from `pnpm-workspace.yaml`. Never bump a version without an ADR in `docs/adr/`.
  `paypal-*` packages use `catalog:zod3` (zod 3.25.76); everything else uses zod 4.
- **Excluded on purpose:** `ai` / `@ai-sdk/*`, Next.js, NativeWind, Rive, xstate, `@paypal/mcp`, TS 7, pnpm 12.
- **Dependency rule:** `contracts ← domain ← {seed, db} ← outbox ← {paypal-*, ai} ← {apps/api, apps/tasks}`.
  UI code imports only `contracts`, `api-client`, `tokens`, `motion`, `seal`, `i18n`, `ui-*`.
- **Ownership:** only edit paths your workstream owns (`docs/ownership.md`). Shared contracts change only via ADR.
- **Every change carries tests.** Name invariant tests `inv.iN.*`.

## Secrets (public repo)

- Secrets live only in `.env` (gitignored), Render env vars and EAS secrets. Never print, log, commit or paste them.
- Clients may read only `VITE_PUBLIC_*` / `EXPO_PUBLIC_*`. Mobile never calls PayPal, Claude or Gemini directly.
- Recorded fixtures are scrubbed (tokens → `REDACTED`, emails → sandbox aliases).
- The pre-commit hook runs secretlint + `tools/guard-env.mjs`; do not bypass it (`--no-verify` is forbidden).

## PayPal sandbox facts (verified)

- All sandbox accounts are Country = United States, USD only. Payouts: recipient_type EMAIL (PHONE unsupported in sandbox).
- No Payouts controller in `@paypal/paypal-server-sdk` and no payouts tool in `@paypal/agent-toolkit` 1.11.0: we own a typed tool.
- `verify-webhook-signature` returns FAILURE for simulated events; self-verify (CRC32 + RSA-SHA256) and use real events on the hero path.
- Sandbox throttle: 50 requests/min/IP (5-minute block). Our limiter allows 40/min across all services. Never poll.

## Windows dev

- Scripts are tsx/Node, never bash-only. Line endings LF (`.gitattributes`). `git config core.longpaths true` is set.
- Package manager: `corepack pnpm …` (pnpm 11.28.6). Node 24.

## Commands

- `corepack pnpm install` · `corepack pnpm typecheck` · `corepack pnpm test` · `corepack pnpm lint`
