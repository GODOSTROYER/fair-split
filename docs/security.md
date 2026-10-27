# Security: secrets and the leak playbook

The repository stays private until the submission window and is then made public (ADR-0002), so every commit is
written as if public. Secrets live only in the gitignored `.env`, Render env vars
(`fs-secrets`), GitHub environments (`sandbox-smoke`, `eval-live`) and EAS secrets. Clients read only
`VITE_PUBLIC_*` and `EXPO_PUBLIC_*`.

## Layers that stop a leak

| Layer                  | What it checks                                                                                             | Where                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `.gitignore`           | `.env*` (except `.env.example`), keystores, credential JSONs, Firebase files                               | Every commit                                      |
| `tools/guard-env.mjs`  | Any `.env` file; Anthropic, Google and PayPal secret patterns                                              | lefthook pre-commit; CI on changed files          |
| secretlint             | The recommended preset over the whole tree                                                                 | lefthook pre-commit; CI                           |
| gitleaks               | Push: the pushed commits. PR: the PR's commits. Nightly and manual run: all history reachable from the ref | CI `gitleaks` job (`gitleaks/gitleaks-action` v3) |
| Fixture scrubber       | Tokens → `REDACTED`, emails → `sb-<hash>@sandbox.fairsplit.invalid`                                        | `@fairsplit/test-kit`; CI re-checks every fixture |
| GitHub push protection | Known provider token formats                                                                               | On push (enable in repo settings)                 |

`--no-verify` is forbidden. A hook that blocks a commit is fixed, never bypassed.

## GitHub settings before the first secret

- Environments `sandbox-smoke` and `eval-live`: Settings → Environments → the environment → Deployment branches
  and tags → Selected branches and tags → `main` only. A manual run can start any branch's copy of a workflow, so
  the smoke job also refuses every ref but `main` itself (`.github/workflows/sandbox-smoke.yml`).
- The ownership gate (`.github/workflows/ownership.yml`) runs on `pull_request_target` with `contents: read`. It
  checks out `main` and only reads the PR's commits with git. Never add a step there that installs, builds or runs
  the PR's code: that code would run with the base repository's token (ADR-0006).

## Leak playbook

Follow the steps in this order. Rotating comes first because history rewriting does not un-leak anything:
the secret may already be in forks, clones, CI logs, caches or a scraper.

### 1. Rotate first (within minutes)

| Secret                                     | Rotate at                                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| PayPal REST app (`fs-dev`, `fs-judge`)     | developer.paypal.com → Apps & Credentials → the app → generate a new secret, then delete the old one |
| Anthropic API key                          | console.anthropic.com → API keys → disable and delete the key                                        |
| Gemini API key                             | Google AI Studio / Cloud console → the key → delete and recreate                                     |
| Render, Expo (`EXPO_TOKEN`), GitHub tokens | The provider's token settings → revoke                                                               |
| FCM service account                        | Google Cloud IAM → the service account → delete the key; re-upload via `eas credentials`             |

Then put the new value where it belongs (`.env`, Render `fs-secrets`, the GitHub environment, EAS) and confirm the
service is healthy (`/readyz`). Check the provider's usage logs for calls you did not make.

### 2. Remove it from history with `git filter-repo`

1. Tell every workstream to stop pushing. Note the commit that introduced the secret.
2. In a fresh mirror clone, write the leaked value(s) to a file outside the repo, one per line
   (`<value>==>REDACTED`), and run:

   ```sh
   git filter-repo --replace-text ../leaked.txt
   ```

   To drop a whole file instead: `git filter-repo --invert-paths --path <file>`.
3. Force-push every branch and tag, then ask each worktree owner to re-clone or hard-reset onto the new history.
4. Ask GitHub Support to purge cached views and pull-request refs if the secret appeared in a PR.
5. Delete the `leaked.txt` file.

### 3. Re-run gitleaks

Run gitleaks over the full history and confirm it is clean. A push or PR run of CI's `gitleaks` job does **not**
do this: on those triggers gitleaks-action scans only the pushed or PR commits. Use one of:
- GitHub → Actions → `ci` → **Run workflow** on `main` (workflow_dispatch: the action scans all history reachable
  from `main`), then on each rewritten `ws/*` branch; or wait for the nightly scheduled run (20:43 UTC, `main`).
- Locally, in the rewritten mirror: `gitleaks git --log-opts="--all" .` (every branch and tag).
  Re-run secretlint (`corepack pnpm secrets:scan`). If the secret showed in a film take or screenshot, re-shoot or
  blur it (risk R17).

### 4. Record it

Add a dated note to `docs/gates/` (or a new ADR if a process changes): what leaked, how long it was exposed, when
it was rotated, and which layer should have caught it.

## Reporting a vulnerability

See [`SECURITY.md`](../SECURITY.md).
