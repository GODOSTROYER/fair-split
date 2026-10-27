# Contributing to Fair Split

Fair Split: co-op payroll is built for the PayPal AI Hackathon by one entrant working with Claude Code agents in
parallel workstreams. Outside contributions are welcome after the deadline (12 Nov 2026, 12:00 PST); until then,
issues are the best way to help.

## Ground rules

- Read [`AGENTS.md`](AGENTS.md) first. The specs in [`docs/spec/`](docs/spec/) are the source of truth, and the
  [decision register](docs/spec/00-decision-register.md) wins every conflict.
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
`git config core.longpaths true` ([ADR-0008](docs/adr/0008-working-copy-on-local-z-drive.md)).

## Workstreams, branches and ownership

- One branch per workstream: `ws/<id>` (for example `ws/core`). Dependency-only changes go on `deps/<name>`.
- A PR touches only the paths its workstream owns in [`docs/ownership.md`](docs/ownership.md). Check before you
  push:

  ```sh
  node tools/check-ownership.mjs --branch ws/<id> --base origin/main
  ```

- On GitHub, `.github/workflows/ownership.yml` judges every PR to `main` with **main's** checker and rules
  (`pull_request_target`), and fails a branch that is not `ws/<id>` or `deps/<topic>`. `ci.yml` runs no ownership
  check: on `pull_request` it is the PR's own copy.
- The gate's files are `docs/ownership.md`, `tools/check-ownership.mjs` and `.github/workflows/ownership.yml`. No
  branch, WS-QA's included, may delete, rename or retype them, and a change to one lands only after the merger
  approves that exact version (see Merging; [ADR-0006](docs/adr/0006-ownership-gate-runs-from-main.md)).
- `docs/spikes/`, `docs/gates/` and `docs/adr/` accept new files from anyone; existing files there are never edited.
- Frozen contracts (IC-01 to IC-11) change only through an ADR (`docs/adr/0000-template.md`) that the user accepts.
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
- Fill in the PR template. The orchestrator merges (below); there is no merge queue or daily train.

## Merging

The orchestrator merges each branch into `main` (plan amendment 2,
[ADR-0006](docs/adr/0006-ownership-gate-runs-from-main.md)). Before it merges `ws/<id>`, it runs **main's** checker,
never the branch's, against main's rules:

```sh
git show main:tools/check-ownership.mjs > "$TMPDIR/check-ownership.main.mjs"
node "$TMPDIR/check-ownership.main.mjs" --repo . --branch ws/<id> --base main --head ws/<id> --strict
```

The check judges what merging the branch into `main` would change (the branch's own diff, the merged tree from
`git merge-tree --write-tree`, and any conflicted paths). If the branch and `main` have more than one merge base,
it fails closed: the workstream merges `main`'s tip into its branch first, then the merger reruns it.

If the branch changes one of the gate's files, the check fails and prints a token. The merger reads that diff
(`git diff main...ws/<id> -- docs/ownership.md tools/check-ownership.mjs .github/workflows/ownership.yml`) and,
only if it is right, reruns the same command with `--approve-gate-change <token>`. The token covers exactly those
versions of the files, so any later edit needs a new review. Workstream agents never pass this flag.

Then the merger checks the merged result: `corepack pnpm typecheck`, `corepack pnpm test`,
`corepack pnpm deps:check` and `corepack pnpm exec biome ci .`.
