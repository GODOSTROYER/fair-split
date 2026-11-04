# Cloud task T6: Postman collection with tests (`cloud/postman`)

Status: **in progress** (skeleton pushed early; updated as the work lands).

Base: `origin/main` at `3e1ec11`. Workstream: WS-QA (`postman/**`, `README.md`, `docs/**`).

## Plan

1. OpenAPI document from `apps/api` (`corepack pnpm --filter @fairsplit/api openapi`, and `/v1/openapi.json` on
   the running stack).
2. A Postman v2.1 collection in `postman/`: the judge's 60-second loop, Proof verify, the labelled failure paths.
3. `pm.test` assertions on status codes, response schemas (from the OpenAPI document), idempotency and the
   simulated-sandbox label on every PayPal-derived value.
4. A localhost environment file and a Node runner (`npx --yes newman@6.2.3`).
5. A green newman run against a local keyless stack, summarised here.

## Environment notes so far

- The e2e stack's embedded Postgres refuses to run as root (`initdb: error: cannot be run as root`). This machine
  runs everything as root, so the cluster was started by hand as the unprivileged `postgres` user with the same
  embedded PG17 binaries and handed to the stack through `FS_TEST_DATABASE_URL` (the harness's documented
  external-cluster switch). No code was changed for this.
