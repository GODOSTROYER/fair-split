# Path ownership by workstream

Source: decision register §11, refined by S5.2.3 (root hygiene files go to WS-QA; `docs/spikes`, `docs/gates`
and `docs/adr` accept new files from anyone). CI reads the two tables below with `tools/check-ownership.mjs`,
so keep their shape: one row per workstream, paths in backticks, comma-separated.

Path syntax: `*` matches inside one segment, `**` matches any depth, `{a,b}` is a choice. A path with no glob
characters matches that file, or that directory and everything under it. In the **Except** column,
`*elsewhere*` means "every path another row owns".

## Workstreams

| WS         | Owned paths                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Except                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| WS-CORE    | `packages/contracts`, `packages/domain`, `packages/seed`                                                                                                                                                                                                                                                                                                                                                                                                              |                                                           |
| WS-DATA    | `packages/db`, `packages/outbox`                                                                                                                                                                                                                                                                                                                                                                                                                                      |                                                           |
| WS-PPCORE  | `packages/paypal-core`, `apps/api/src/webhooks/**`, `tools/setup-webhooks.ts`                                                                                                                                                                                                                                                                                                                                                                                         |                                                           |
| WS-PPMONEY | `packages/paypal-toolkit`, `packages/paypal-payouts`                                                                                                                                                                                                                                                                                                                                                                                                                  |                                                           |
| WS-READ    | `packages/ai/src/{gateway,read,ratecard,classify}/**`, `packages/eval`, `packages/ai/*`, `packages/ai/src/index.ts`                                                                                                                                                                                                                                                                                                                                                   |                                                           |
| WS-AGENT   | `packages/ai/src/{agent,explain}/**`, `packages/ai/*`, `packages/ai/src/index.ts`                                                                                                                                                                                                                                                                                                                                                                                     |                                                           |
| WS-API     | `apps/api/**`, `packages/api-client`                                                                                                                                                                                                                                                                                                                                                                                                                                  | `apps/api/src/webhooks/**`                                |
| WS-OPS     | `apps/tasks`, `render.yaml`, `tools/**`                                                                                                                                                                                                                                                                                                                                                                                                                               | `*elsewhere*`                                             |
| WS-DS      | `packages/tokens`, `packages/motion`, `packages/seal`, `packages/ui-web`, `packages/ui-native`, `packages/i18n`, `assets/**`, `apps/console/src/prototype/**`                                                                                                                                                                                                                                                                                                         |                                                           |
| WS-CONSOLE | `apps/console/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `apps/console/src/prototype/**`                           |
| WS-APP     | `apps/mobile/**`, `eas.json`                                                                                                                                                                                                                                                                                                                                                                                                                                          |                                                           |
| WS-QA      | `.github/**`, `packages/test-kit`, `e2e/**`, `postman/**`, `docs/**`, `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `LICENSE`, `AGENTS.md`, `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `biome.json`, `lefthook.yml`, `.dependency-cruiser.cjs`, `.gitattributes`, `.gitignore`, `.editorconfig`, `.env.example`, `.secretlintrc.json`, `.secretlintignore`, `tools/check-ownership.mjs`, `tools/guard-env.mjs` | `docs/spec/**`, `docs/versions.md`, `pnpm-workspace.yaml` |
| WS-MEDIA   | `media/**`, `video/**`, `tools/{tts,imagegen}.ts`                                                                                                                                                                                                                                                                                                                                                                                                                     |                                                           |
| WS-PPSIM   | `packages/paypal-sim`, `tools/paypal-sim.ts`                                                                                                                                                                                                                                                                                                                                                                                                                          |                                                           |

Notes:
- `packages/ai` top-level files (`package.json`, `tsconfig.json`) and `packages/ai/src/index.ts` are shared by
  WS-READ and WS-AGENT, because the register splits `packages/ai/src` between them and names no owner for the
  package shell.
- `docs/spec/**` is owned by no workstream: the specs change only through an ADR the user approves.

## Shared rules

| Rule        | Paths                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------- |
| append-only | `docs/spikes/**`, `docs/gates/**`, `docs/adr/**`                                               |
| deps-lane   | `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `docs/versions.md`, `package.json`, `**/package.json` |
- **append-only:** any workstream may add a new file; CI rejects edits, renames and deletions of existing files.
- **deps-lane:** a branch named `deps/<anything>` may touch only these paths (S5.2.3 rule 4).
- **deps-lane exclusivity (S5.2.3 rule 4):** `pnpm-lock.yaml`, `pnpm-workspace.yaml` and `docs/versions.md` belong to
  no workstream, so only a `deps/*` branch may touch them. A workstream that needs a new or bumped dependency asks for
  a deps PR; that PR adds the pin (at least 14 days old), records it in `docs/versions.md`, edits the consuming
  `package.json` and commits the lockfile. WS-QA is no exception: `main` already has these rules, so no PR to it is
  a bootstrap PR (see Branches).
- **gate files:** no branch, WS-QA's and the deps lane's included, may delete, rename or change the file type of
  `docs/ownership.md` or `tools/check-ownership.mjs`. Without them every later PR would fail closed, or, with both
  gone, the next WS-QA PR would be judged by its own rules. WS-QA edits them like any other file it owns.

## Branches

A branch `ws/<id>` is checked as `WS-<ID>` (for example `ws/ppcore` → WS-PPCORE). `deps/*` is the deps lane.
On a pull request any other branch name fails the check (`--strict`): every PR's paths are checked (register §11).
Only a push to `main` itself skips it, because what lands there was already checked as a PR.

A PR is judged by the rules on its **base**: CI runs the base commit's `tools/check-ownership.mjs` against the base
commit's `docs/ownership.md`. Editing your own row, or the checker, in a PR therefore has no effect on that PR; the
change applies to later PRs once the user merges it. The check fails closed: if the base has the file but it cannot
be read or parsed, or git reports any error other than "the file is not in that commit", the PR fails. It never
falls back to the PR's own copy.

CI runs the PR's own copy of the checker only when `git ls-tree` exits 0 with no output for
`tools/check-ownership.mjs` on the base (the PR that adds the checker, still judged by the base's rules); any other
git error fails the step. Bootstrap, where WS-QA's PR is judged by its own `docs/ownership.md` and may also touch the
deps-lane files (S5.2.3 rule 4), applies only when the base has neither `docs/ownership.md` nor
`tools/check-ownership.mjs`, which means a new repository. It cannot happen here: `main` has had the rules since
the table landed, and a base that has the checker but not the rules fails closed.
