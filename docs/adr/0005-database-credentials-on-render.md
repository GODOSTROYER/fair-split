# ADR-0005: Database credentials on Render: the owner URL only in fs-api, fs_app built at boot, fs-db private

- **Status:** Accepted (user, on merge)
- **Date:** 27 Oct 2026 (IST)
- **Author:** WS-OPS
- **Touches:** S3.14 (the Blueprint snippet's database lines), S3.4 (database roles), S3.13, register §7;
  `render.yaml`, `apps/tasks/src/db-env.ts`, `apps/tasks/src/app-role.ts`, `tools/lib/blueprint.ts`

## Context

- S3.4: migrations run as the owner in `preDeployCommand`; "the app and tasks swap the `fs_app` credentials
  into `DATABASE_URL`"; only `packages/db` migrate may use the owner URL; boot refuses a role that can UPDATE
  `ledger_entries`. Register §7: the app role cannot UPDATE or DELETE `run_events`, `ledger_entries` or
  `agent_sessions`.
- The S3.14 snippet gives both fs-api and fs-tasks `DATABASE_URL` from `fromDatabase … connectionString`, which
  is the owner's URL, plus `FS_APP_DB_PASSWORD`. Both services would then hold the owner's credentials.
- WS-DATA's migrate (`packages/db/src/cli/env.ts`) reads only `DATABASE_OWNER_URL` on Render, because there
  `DATABASE_URL` is fs_app's own login.
- On Render, a service's environment variables reach its build, `preDeployCommand` and `startCommand` alike. A
  Blueprint cannot scope a variable to `preDeployCommand`, so whichever service migrates also runs with the
  owner's URL in its environment.
- Deleting a variable from `process.env` does not erase it from the process's initial environment block, which
  Linux exposes as `/proc/<pid>/environ` to the same user.
- Render Postgres accepts external connections from any IP unless `ipAllowList` restricts them; "to block all
  external connections, set `ipAllowList` to an empty list" (render.com/docs/blueprint-spec). The
  `connectionString` that `fromDatabase` returns is the private-network URL.

## Decision

1. **Who holds what** (`render.yaml`; decisions 1 and 4 are enforced by `checkPolicy` in
   `tools/lib/blueprint.ts`, run by `tools/lint-render.ts` in CI and by `apps/tasks/test/render-blueprint.test.ts`):
   - fs-api: `DATABASE_OWNER_URL` (`fromDatabase connectionString`), read only by migrate in
     `preDeployCommand`, and `FS_APP_DB_PASSWORD` (`generateValue`), from which migrate creates fs_app's login.
   - fs-tasks: `FS_DB_HOST`, `FS_DB_PORT`, `FS_DB_NAME` (`fromDatabase` host, port, database) and
     `FS_APP_DB_PASSWORD` (`fromService` fs-api). Never the owner's user or password.
   - fs-cron: no database variable.
   - No service declares `DATABASE_URL`.
2. **Boot.** Each entry calls `useAppDatabaseUrl()` before anything reads `DATABASE_URL`. It builds fs_app's
   URL (fs-api from the owner URL's host, port and database; fs-tasks from the three parts), sets
   `DATABASE_URL`, deletes `DATABASE_OWNER_URL` and `FS_APP_DB_PASSWORD` from `process.env`, and refuses to
   start on a half-configured environment. `apps/tasks/src/db-env.ts` is the tested reference.
3. **Role check.** Before running a task, each entry refuses a role that can UPDATE `ledger_entries`
   (`BOOT_REFUSED`, `apps/tasks/src/app-role.ts`); fs-api also at boot and in `/readyz` (S3.4). Once
   `@fairsplit/db` merges, both use its `assertAppRole`.
4. **fs-db is private:** `ipAllowList: []`. Every service reaches it over the private network.

## Consequences

- **WS-API, a gate for the first fs-api deploy:** fs-api's entry must call `useAppDatabaseUrl()` (lifted into
  `packages/db` with WS-DATA) before anything reads `DATABASE_URL`, then the role check. Without it fs-api
  starts with no database URL: it fails closed, never as the owner.
- **WS-DATA:** keep migrate's `DATABASE_OWNER_URL` contract.
- **Spec:** this ADR replaces the `DATABASE_URL` lines of the S3.14 snippet with decision 1 (`docs/spec`
  changes only through an ADR). S3.4's text stands.
- **Operators:** `psql` runs from a Shell on fs-api. A tool that must reach fs-db from outside Render needs an
  allow-list entry, which is a new ADR.
- **S6 (live Blueprint run):** confirm that `fromDatabase` host and port resolve for Postgres, that the
  workflow reaches fs-db privately as fs_app (`opsDbPing`), and that an external connection is refused.
- **Residual risk, accepted:** the owner's URL stays readable in fs-api's initial environment, possibly in the
  Render process that launches the start command, and in the Dashboard. Code execution or an arbitrary file read in
  fs-api can recover it. With the empty allow list it works only from inside the private network, where it
  turns fs_app (append-only history) into the owner, who can rewrite history and disable triggers. The
  ledger's hash chain still makes such a rewrite evident (S3.4: "append-only for the app role,
  tamper-evident by hash chain").

## Alternatives considered

| Option                                                                                           | Why not                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S3.14 as written: `DATABASE_URL` = the owner's URL on fs-api and fs-tasks, swapped at boot       | Two services hold the owner's credentials, and on Render migrate refuses `DATABASE_URL`                                                                                                    |
| Migrate from a separate service or a one-off job that alone holds the owner's URL                | A Blueprint cannot declare a one-off job; another always-on service costs money and still holds the URL                                                                                    |
| A start wrapper that re-executes the server with a cleaned environment (Node's `process.execve`) | Hides the value from the server's own `/proc/self/environ` only, not from the Render process that launched it (unverifiable before S6); experimental in Node 24 and unavailable on Windows |
| Paste fs_app's URL into `DATABASE_URL` by hand after the first deploy                            | The first deploy runs without it, and the owner's URL still has to reach migrate through fs-api                                                                                            |
