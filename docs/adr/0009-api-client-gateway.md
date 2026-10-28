# ADR-0009: `api-client` is the UI's gateway to `domain` and `seed`; fs-api shares its HTTP table

- **Status:** Accepted (user, on merge)
- **Date:** 28 Oct 2026 (IST)
- **Author:** Orchestrator (merge of ws/api and ws/console, under the user's delegated approval)
- **Touches:** register §6 (dependency rule), `.dependency-cruiser.cjs`, `packages/api-client` exports (WS-API),
  `apps/console` imports (WS-CONSOLE), `packages/test-kit/test/dependency-rules.test.mjs` (WS-QA)

## Context

Register §6 lets UI code import only `contracts`, `api-client`, `tokens`, `motion`, `seal`, `i18n` and `ui-*`, and
the plan says UI code formats cents "only through `api-client`". The first dependency-cruiser config counted
`packages/api-client` as UI code, so `api-client` itself could import only those packages, and no route existed by
which it could re-export `domain`'s formatter. The console's `lib/format.ts` and `lib/verify.ts` were written as
seams to switch to `api-client` "in the wiring step".

The ws/api and ws/console merges (28 Oct) failed `deps:check` with 28 violations:
- `api-client` re-exports `@fairsplit/domain/format` and `@fairsplit/domain/verify` (Proof's "Verify in your
  browser" runs the same verifier as the server), and its msw world is built from `@fairsplit/seed`.
- The console imported `domain` directly through those seams, and `seed` for the Judge first view's showcase
  snapshot (W-JG-01 makes no calls) and in 14 test files.
- `apps/api` imports `@fairsplit/api-client/http`, the IC-08 command table built from `contracts` that the server,
  the typed client and the msw handlers share, so they cannot drift. Its tests and its smoke CLI (`pnpm smoke`)
  drive fs-api through the typed client.

## Decision

1. `packages/api-client` may import the UI packages plus `domain` and `seed` (rule `layer-api-client`). Both are
   pure: `domain-is-pure` still forbids IO there, and `seed` depends only on `contracts` and `domain`.
2. UI apps and the other UI packages keep register §6's list exactly (rule `layer-ui`). They reach `domain` and
   `seed` only through `api-client`: `/format`, `/verify` and a new `/seed` entry (`getSnapshot`).
3. `apps/api` and `apps/tasks` runtime code may import one UI file, `packages/api-client/src/http.ts`
   (rule `layer-server-apps`). Their tests and the smoke CLI (`src/smoke/`) may also import the typed client, and
   nothing else outside the server packages (rule `layer-server-apps-tests`).

## Consequences

- WS-API adds `"./seed"` to `packages/api-client/package.json` with `src/seed.ts` re-exporting `getSnapshot`.
- WS-CONSOLE imports `format`, `verify` and the seeded snapshot from `api-client` entries only. App code loads
  `/seed` lazily, so the snapshot stays out of the first chunk.
- `packages/test-kit/test/dependency-rules.test.mjs` proves each allowance and its limit: `api-client` importing
  `db` fails; fs-api runtime importing the typed client fails, while its HTTP table passes; a smoke file importing
  a UI package other than `api-client` fails.
- What gets worse: `api-client` now carries `domain` and `seed` into UI bundles. That was already true through the
  console's seams; the console's chunk budgets (S2.11) still apply and are checked by its build.

## Alternatives considered

| Option                                          | Why not                                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Let UI apps import `domain` and `seed` directly | Contradicts register §6 and the plan's "formatting cents only through `api-client`"                |
| Move the HTTP table into `contracts`            | Sound, but moves a shared file during the merge; the narrow allowance keeps one copy with no drift |
| Copy the formatter and verifier into the UI     | Two implementations of money formatting and Proof verification could disagree                      |
