# Contributing to Fair Split

Fair Split: co-op payroll is built for the PayPal AI Hackathon by one entrant working with Claude Code agents in
parallel workstreams. Outside contributions are welcome after the deadline (12 Nov 2026, 12:00 PST); until then,
issues are the best way to help.

## Ground rules

- Read [`AGENTS.md`](AGENTS.md) first. The specs in [`docs/spec/`](docs/spec/) are the source of truth, and the
  [decision register](docs/decision-register.md) wins every conflict.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Never commit a secret or a `.env` file. Recorded fixtures go through the scrubber in `@fairsplit/test-kit`.
  See [`docs/security.md`](docs/security.md).

## Set-up

Prerequisites: Node 24.19 or newer, Git, and corepack (bundled with Node 24).

```sh
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm deps:check
```

On Windows, use a local NTFS drive (never a mapped drive), enable long paths and run
`git config core.longpaths true` ([ADR 001](docs/adr/001-working-copy-on-local-z-drive.md)).

## Workstreams, branches and ownership

- One branch per workstream: `ws/<id>` (for example `ws/core`). Dependency-only changes go on `deps/<name>`.
- A PR touches only the paths its workstream owns in [`docs/ownership.md`](docs/ownership.md). CI checks this:

  ```sh
  node tools/check-ownership.mjs --branch ws/<id> --base origin/main
  ```

- CI runs the check on every PR with the **base** commit's checker and rules, and fails a branch that is not
  `ws/<id>` or `deps/<topic>`.
- `docs/spikes/`, `docs/gates/` and `docs/adr/` accept new files from anyone; existing files there are never edited.
- Frozen contracts (IC-01 to IC-11) change only through an ADR (`docs/adr/000-template.md`) that the user accepts.
  The user accepts an ADR by merging its PR, so an ADR is committed with status `Accepted (user, on merge)`;
  a rejected ADR is never merged.

## Code rules

- TypeScript 6 strict, ESM, `NodeNext` resolution: relative imports in `.ts` files end in `.js`.
- Exact versions only, from the `pnpm-workspace.yaml` catalogs; new pins must be at least 14 days old and recorded
  in [`docs/versions.md`](docs/versions.md). Only a `deps/<topic>` branch may touch `pnpm-lock.yaml`,
  `pnpm-workspace.yaml` and `docs/versions.md` (S5.2.3 rule 4); a workstream that needs a dependency asks for a deps PR.
- Excluded on purpose, and rejected by dependency-cruiser: `ai` / `@ai-sdk/*`, Next.js, NativeWind, Rive, xstate,
  `@paypal/mcp`. Every import must be declared in the importing package's own `package.json`; zod 3 is imported
  only from `packages/paypal-*`.
- The dependency rule (register §6) is enforced by dependency-cruiser:
  `contracts ← domain ← {seed, db} ← outbox ← {paypal-*, ai} ← {apps/api, apps/tasks}`; UI code imports only
  `contracts`, `api-client`, `tokens`, `motion`, `seal`, `i18n` and `ui-*`.
- Every change carries tests (Vitest). Invariant tests are named `inv.iN.*` (architecture §0).
- Money and kilo figures come from the seed snapshot, never from literals.

## Commits and pull requests

- Conventional commits (`feat(test-kit): …`, `fix(domain): …`, `docs: …`).
- The pre-commit hook runs secretlint, `tools/guard-env.mjs` and Biome. Fix with
  `corepack pnpm exec biome check --write <paths>`. Never use `--no-verify`.
- Fill in the PR template. PRs land by rebase-merge in the daily merge train (S5.2.4).
