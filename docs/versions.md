# Pinned versions

Every version in the repo is exact. Packages come from the `pnpm-workspace.yaml` catalogs (`catalog:` and
`catalog:zod3`); GitHub Actions are pinned by full commit SHA. The rule (register §6, S5.2.3) is that a new
pin must be **at least 14 days old** when it is chosen. Only `deps/*` PRs change this file and the lockfile.

**Checked:** 22 Oct 2026, by WS-QA, with `npm view <pkg> time --json` (publish dates) and
`gh api repos/<owner>/<repo>/git/ref/tags/<tag>` (action SHAs). "Age" is days from publish to 22 Oct 2026.

## Toolchain

| Tool    | Version | Published   | Notes                                                                                 |
| ------- | ------- | ----------- | ------------------------------------------------------------------------------------- |
| Node.js | 24.19.0 | 03 Aug 2026 | `engines.node >=24.19`; CI pins `24.19.0`. Ships corepack 0.35.0                      |
| pnpm    | 11.28.6 | 15 Oct 2026 | `packageManager` field, run through corepack. **Under 14 days** (7 days) when checked |

## GitHub Actions

| Action                     | Tag    | Commit SHA                                 | Released    |
| -------------------------- | ------ | ------------------------------------------ | ----------- |
| `actions/checkout`         | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | 20 Jul 2026 |
| `actions/setup-node`       | v7.0.0 | `820762786026740c76f36085b0efc47a31fe5020` | 14 Jul 2026 |
| `actions/cache`            | v6.1.0 | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` | 26 Jun 2026 |
| `gitleaks/gitleaks-action` | v3.0.0 | `e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e` | 30 May 2026 |

`actions/setup-node` v7.1.0 (08 Oct 2026) was skipped: it was exactly 14 days old on the day of checking.

## Catalog packages

| Package                                        | Version  | Catalog        | Published  | 14 days old on 22 Oct? |
| ---------------------------------------------- | -------- | -------------- | ---------- | ---------------------- |
| `typescript`                                   | 6.0.3    | `catalog:`     | 2026-04-16 | yes                    |
| `@biomejs/biome`                               | 2.6.2    | `catalog:`     | 2026-10-21 | **no** (1 d)           |
| `tsx`                                          | 4.23.15  | `catalog:`     | 2026-09-20 | yes                    |
| `tsdown`                                       | 0.23.1   | `catalog:`     | 2026-10-10 | **no** (12 d)          |
| `turbo`                                        | 2.11.10  | `catalog:`     | 2026-10-20 | **no** (2 d)           |
| `vitest`                                       | 5.0.5    | `catalog:`     | 2026-10-15 | **no** (7 d)           |
| `@vitest/coverage-v8`                          | 5.0.5    | `catalog:`     | 2026-10-15 | **no** (7 d)           |
| `@playwright/test`                             | 1.64.1   | `catalog:`     | 2026-10-14 | **no** (8 d)           |
| `msw`                                          | 3.0.3    | `catalog:`     | 2026-10-10 | **no** (12 d)          |
| `fast-check`                                   | 4.10.2   | `catalog:`     | 2026-09-19 | yes                    |
| `@faker-js/faker`                              | 10.6.0   | `catalog:`     | 2026-08-14 | yes                    |
| `dependency-cruiser`                           | 18.7.0   | `catalog:`     | 2026-10-19 | **no** (3 d)           |
| `lefthook`                                     | 2.2.2    | `catalog:`     | 2026-10-13 | **no** (9 d)           |
| `secretlint`                                   | 13.0.7   | `catalog:`     | 2026-10-03 | yes                    |
| `@secretlint/secretlint-rule-preset-recommend` | 13.0.7   | `catalog:`     | 2026-10-03 | yes                    |
| `@types/node`                                  | 24.10.1  | `catalog:`     | 2025-11-11 | yes                    |
| `vite`                                         | 8.3.5    | `catalog:`     | 2026-10-21 | **no** (1 d)           |
| `@vitejs/plugin-react`                         | 6.1.2    | `catalog:`     | 2026-10-05 | yes                    |
| `react`                                        | 19.3.0   | `catalog:`     | 2026-09-09 | yes                    |
| `react-dom`                                    | 19.3.0   | `catalog:`     | 2026-09-09 | yes                    |
| `@tanstack/react-router`                       | 1.170.45 | `catalog:`     | 2026-10-16 | **no** (6 d)           |
| `@tanstack/router-plugin`                      | 1.168.47 | `catalog:`     | 2026-10-16 | **no** (6 d)           |
| `@tanstack/react-query`                        | 5.104.5  | `catalog:`     | 2026-10-19 | **no** (3 d)           |
| `tailwindcss`                                  | 4.3.3    | `catalog:`     | 2026-07-16 | yes                    |
| `@tailwindcss/vite`                            | 4.3.3    | `catalog:`     | 2026-07-16 | yes                    |
| `@base-ui/react`                               | 1.9.0    | `catalog:`     | 2026-10-09 | **no** (13 d)          |
| `motion`                                       | 14.0.0   | `catalog:`     | 2026-10-02 | yes                    |
| `ag-grid-community`                            | 36.2.0   | `catalog:`     | 2026-09-16 | yes                    |
| `ag-grid-react`                                | 36.2.0   | `catalog:`     | 2026-09-16 | yes                    |
| `hono`                                         | 4.13.13  | `catalog:`     | 2026-10-04 | yes                    |
| `@hono/node-server`                            | 2.1.5    | `catalog:`     | 2026-10-13 | **no** (9 d)           |
| `@hono/zod-openapi`                            | 1.6.3    | `catalog:`     | 2026-09-04 | yes                    |
| `drizzle-orm`                                  | 0.45.4   | `catalog:`     | 2026-10-08 | yes                    |
| `drizzle-kit`                                  | 0.31.11  | `catalog:`     | 2026-09-21 | yes                    |
| `postgres`                                     | 3.4.9    | `catalog:`     | 2026-04-05 | yes                    |
| `better-auth`                                  | 1.7.12   | `catalog:`     | 2026-10-20 | **no** (2 d)           |
| `@renderinc/sdk`                               | 1.3.0    | `catalog:`     | 2026-10-18 | **no** (4 d)           |
| `pino`                                         | 10.4.0   | `catalog:`     | 2026-10-02 | yes                    |
| `@t3-oss/env-core`                             | 0.13.11  | `catalog:`     | 2026-03-22 | yes                    |
| `@anthropic-ai/sdk`                            | 0.137.0  | `catalog:`     | 2026-10-20 | **no** (2 d)           |
| `sharp`                                        | 0.35.5   | `catalog:`     | 2026-09-27 | yes                    |
| `partial-json`                                 | 0.1.7    | `catalog:`     | 2024-05-14 | yes                    |
| `@google/genai`                                | 2.30.0   | `catalog:`     | 2026-10-15 | **no** (7 d)           |
| `@paypal/agent-toolkit`                        | 1.11.0   | `catalog:`     | 2026-09-01 | yes                    |
| `@paypal/paypal-server-sdk`                    | 2.5.0    | `catalog:`     | 2026-08-21 | yes                    |
| `zod`                                          | 4.6.7    | `catalog:`     | 2026-10-12 | **no** (10 d)          |
| `eventsource-parser`                           | 4.1.2    | `catalog:`     | 2026-10-12 | **no** (10 d)          |
| `canonicalize`                                 | 5.1.0    | `catalog:`     | 2026-09-18 | yes                    |
| `ts-pattern`                                   | 5.9.2    | `catalog:`     | 2026-10-14 | **no** (8 d)           |
| `i18next`                                      | 26.5.4   | `catalog:`     | 2026-10-21 | **no** (1 d)           |
| `react-i18next`                                | 17.1.0   | `catalog:`     | 2026-10-17 | **no** (5 d)           |
| `@noble/curves`                                | 2.4.0    | `catalog:`     | 2026-08-27 | yes                    |
| `yaml`                                         | 2.9.1    | `catalog:`     | 2026-09-11 | yes (41 d)             |
| `ajv`                                          | 8.20.0   | `catalog:`     | 2026-04-24 | yes (181 d)            |
| `zod`                                          | 3.25.76  | `catalog:zod3` | 2025-07-08 | yes                    |

### Pins under 14 days old

24 catalog pins (and pnpm itself) were younger than 14 days when this file was first checked. They were
chosen by the bootstrap scaffold before this check existed, and `pnpm-workspace.yaml` already lists
`@biomejs/biome` 2.6.2 and `i18next` 26.5.4 under `minimumReleaseAgeExclude`. Each one needs one of:
- kept by an ADR that names the reason (for example, a fix the code needs), or
- moved back to the newest release that is at least 14 days old, in one `deps/*` PR.

Until that decision lands, treat the table above as the record of what is installed, not as compliance.
The user decides; WS-QA opens the ADR.

## Added through deps PRs

Each row above that a `deps/*` PR added after the first check, with its consumer and why.

| Package                  | Version         | PR                                                      | Consumer                                | Why                                                                                      |
| ------------------------ | --------------- | ------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `yaml`                   | 2.9.1           | `deps/ops-pins` (22 Oct 2026)                           | `apps/tasks` (dev)                      | `tools/lib/blueprint.ts` parses `render.yaml` for the Blueprint lint (S3.13, S3.17)      |
| `ajv`                    | 8.20.0          | `deps/ops-pins` (22 Oct 2026)                           | `apps/tasks` (dev)                      | Validates `render.yaml` against Render's published Blueprint JSON Schema (draft 2020-12) |
| `i18next-icu`            | 2.5.0           | orchestrator merge (27 Oct 2026); published 06 Oct 2026 | `packages/i18n`                         | ICU plurals and selects for i18next (register §6 addition)                               |
| `intl-messageformat`     | 12.1.3          | orchestrator merge (27 Oct 2026); published 05 Oct 2026 | `packages/i18n`                         | ICU message parser that `i18next-icu` needs                                              |
| `@types/react`           | 19.3.0          | orchestrator merge (27 Oct 2026); published 09 Sep 2026 | `apps/console`, `packages/ui-web` (dev) | Types for React 19.3                                                                     |
| `@types/react-dom`       | 19.3.0          | orchestrator merge (27 Oct 2026); published 09 Sep 2026 | `apps/console`, `packages/ui-web` (dev) | Types for React DOM 19.3                                                                 |
| `@testing-library/react` | 16.3.3          | orchestrator merge (27 Oct 2026); published 27 Aug 2026 | `apps/console`, `packages/ui-web` (dev) | Component tests                                                                          |
| `@testing-library/dom`   | 10.4.2          | orchestrator merge (27 Oct 2026); published 13 Sep 2026 | `apps/console`, `packages/ui-web` (dev) | Peer of `@testing-library/react`                                                         |
| `jsdom`                  | 30.1.2          | orchestrator merge (27 Oct 2026); published 04 Oct 2026 | `apps/console`, `packages/ui-web` (dev) | DOM for Vitest component tests                                                           |
| `embedded-postgres`      | 17.10.0-beta.17 | orchestrator merge (27 Oct 2026); published 05 Jun 2026 | `packages/db`, `packages/outbox` (dev)  | Real Postgres in tests on Windows without Docker; production stays Postgres 18 on Render |
| `ajv-formats`            | 3.0.1           | orchestrator merge (27 Oct 2026); published 30 Mar 2024 | `packages/paypal-sim`                   | `format` keywords when validating against PayPal's OpenAPI schemas                       |
| `axe-core`               | 4.13.0          | orchestrator merge (28 Oct 2026); published 05 Aug 2026 | `apps/console` (dev)                    | Engine for the console's axe checks in Vitest; matches `@axe-core/playwright` 4.13.0     |

Publish dates checked on 22 Oct 2026 with `npm view <pkg> time --json`. `yaml` is an optional peer of
`vite`, so the lockfile also records it in the peer suffix of every importer's `vite`, `vitest` and `msw`
entries. That churn is why the lockfile changes only in `deps/*` PRs, merged one at a time and before the
workstream that consumes them.

## Expo SDK 58 set (WS-APP, orchestrator merge 28 Oct 2026)

`apps/mobile` pins. The plan excludes the Expo SDK 58 set from the 14-day release-age rule by exact version, so the
pins newer than 14 days below, and the Expo-internal packages in `minimumReleaseAgeExclude`, follow
`npx expo install --check` rather than the age rule. That includes `noxcturnal` 0.1.10, Expo's own package
(github.com/expo/noxcturnal), published 26 Oct 2026, which `@expo/metro-config` 58.0.18 requires.

| Package                                         | Version | Published  | Why                                                                                                                |
| ----------------------------------------------- | ------- | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| `expo`                                          | 58.0.20 | 2026-10-27 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-audio`                                    | 58.0.10 | 2026-10-21 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-background-task`                          | 58.0.11 | 2026-10-15 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-build-properties`                         | 58.0.11 | 2026-10-16 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-camera`                                   | 58.0.13 | 2026-10-27 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-constants`                                | 58.0.13 | 2026-10-21 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-crypto`                                   | 58.0.7  | 2026-10-16 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-dev-client`                               | 58.0.16 | 2026-10-27 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-device`                                   | 58.0.5  | 2026-10-01 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-file-system`                              | 58.0.12 | 2026-10-27 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-font`                                     | 58.0.10 | 2026-10-23 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-haptics`                                  | 58.0.7  | 2026-10-16 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-image`                                    | 58.0.17 | 2026-10-23 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-image-manipulator`                        | 58.0.15 | 2026-10-19 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-image-picker`                             | 58.0.10 | 2026-10-01 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-linking`                                  | 58.0.14 | 2026-10-21 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-local-authentication`                     | 58.0.2  | 2026-10-01 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-notifications`                            | 58.1.6  | 2026-10-21 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-router`                                   | 58.0.27 | 2026-10-27 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-secure-store`                             | 58.0.2  | 2026-10-01 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-speech`                                   | 58.0.3  | 2026-10-01 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-splash-screen`                            | 58.0.11 | 2026-10-21 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-sqlite`                                   | 58.0.14 | 2026-10-23 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-status-bar`                               | 58.0.4  | 2026-10-21 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-system-ui`                                | 58.0.6  | 2026-10-15 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `expo-task-manager`                             | 58.0.12 | 2026-10-15 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `react-native`                                  | 0.88.0  | 2026-10-15 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `react-native-gesture-handler`                  | 3.3.0   | 2026-09-11 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `react-native-reanimated`                       | 4.7.1   | 2026-10-02 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `react-native-safe-area-context`                | 5.10.1  | 2026-09-29 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `react-native-screens`                          | 4.30.0  | 2026-10-13 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `react-native-svg`                              | 15.16.0 | 2026-10-15 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `react-native-web`                              | 0.21.4  | 2026-10-08 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `react-native-worklets`                         | 0.13.0  | 2026-09-18 | Expo SDK 58 set: the exact version in expo 58.0.20's `bundledNativeModules.json`                                   |
| `@react-native-community/netinfo`               | 12.0.1  | 2026-02-14 | Offline state for the outbox and the statement's last copy                                                         |
| `@noble/hashes`                                 | 2.4.0   | 2026-08-27 | SHA-256 for the phone's own `batchSha256` and `linesDigest` recompute before co-sign (M-BD-01)                     |
| `@expo-google-fonts/mona-sans`                  | 0.4.1   | 2025-09-05 | Temporary fonts from the slice build; unused since the FS Sans and Atkinson Next native cuts (remove in a deps PR) |
| `@expo-google-fonts/atkinson-hyperlegible-next` | 0.4.1   | 2025-09-05 | Temporary fonts from the slice build; unused since the FS Sans and Atkinson Next native cuts (remove in a deps PR) |

## Planned additions (not installed yet)

Recorded here when installed, each exact and at least 14 days old:

| Package                                                | Planned version      | Source                               |
| ------------------------------------------------------ | -------------------- | ------------------------------------ |
| `@axe-core/playwright`                                 | 4.13.0               | S5 decision 9                        |
| `hyperframes`                                          | 0.8.157              | S5 decision 9                        |
| `ppu-paddle-ocr`                                       | 6.6.1                | Register §6 (eval OCR baseline only) |
| `expo-device`, `expo-image-manipulator`, `i18next-icu` | newest ≥ 14 days old | Register §6 additions                |
| gitleaks CLI (pre-commit hook)                         | to choose            | Architecture §17                     |
