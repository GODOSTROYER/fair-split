# Fair Split app (`@fairsplit/mobile`)

Expo SDK 58 (React Native 0.88, React 19.3, Expo Router), Android first. The same code runs as the judge's phone
frames: the web export is served by fs-api at `/app` (register C-11). It is built as one shell and three slices in
parallel; `SPLIT.md` says who owns what and which shared APIs to use.

| Role   | Tabs (register §4)       | Screens                                                                          |
| ------ | ------------------------ | -------------------------------------------------------------------------------- |
| Member | Bayad, Resibo, Pangutana | M-MB-01 statement (MM-1, MM-7), M-MB-02 slips, M-MB-03 Paminawa (modal), M-MB-04 |
| Clerk  | Scan, Outbox             | M-CL-01 scanner + offline outbox (expo-sqlite, idempotency keys, NetInfo sync)   |
| Board  | Pirma, Bayad, Pangutana  | M-BD-01 co-sign request, M-BD-02 sign (Ed25519, SecureStore behind biometrics)   |

First run: `/onboarding/language`, `/onboarding/theme`, `/onboarding/pair`. Links: `/app/pair?t=…` (also `#t=` and
`fairsplit://pair?t=…`) pairs a phone; `/app/s/:token` opens one member line read-only. Judge stage frames receive
their token by IC-12 postMessage and skip the first run.

## Run

```bash
corepack pnpm install                         # from the repo root
corepack pnpm --filter @fairsplit/mobile web  # Expo web dev server
corepack pnpm --filter @fairsplit/mobile build      # web export → dist/, base path /app
corepack pnpm --filter @fairsplit/mobile serve:web  # serves dist at http://localhost:8087/app/
corepack pnpm --filter @fairsplit/mobile check:expo # npx expo install --check
corepack pnpm --filter @fairsplit/mobile typecheck
corepack pnpm --filter @fairsplit/mobile test       # Vitest: shell, outbox, signing, pairing, statement, statuses
corepack pnpm --filter @fairsplit/mobile smoke:web  # after build: walks every route in Chromium at 412×915
```

`smoke:web` starts its own server, opens every app route of register §4 (first run, the three roles, `/pair?t=`,
`/s/:token`) and fails on a missing screen root, an unsettled or wrong `data-state`, a page or console error, or a
focus ring on a screen's first focus; `--shots <dir>` saves screenshots. Playwright is not a dependency of the app:
it uses `playwright-core` when installed, or the folder in `PLAYWRIGHT_CORE`.

Demo links (no fs-api): `/app/?demo=member&stage=sent`, `?demo=board`, `?demo=clerk`; stages are `checking`, `sent`,
`paid`, `unclaimed`, `cash-due` and `cash-received`. Add `?motion=reduced` for the reduced-motion renderer and
`?fsTrace=1` to collect moment phases in `window.__fsMoments`.

Android: development builds only (the dev client, JDK 17, or EAS). Profiles in `eas.json`: `development` (dev client
APK), `preview` (internal APK for judges), `production` (app bundle), plus `e2e` and `ios-sim`. EAS reads `eas.json`
from this directory, so it lives here rather than at the repo root.

## Environment

| Variable                 | Meaning                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_ORIGIN` | fs-api origin, or `same-origin` when fs-api serves this export. Unset: **demo mode**. |
| `EXPO_WEB_BASE`          | Web base path; `build` sets `/app`. Never set for native builds.                      |
| `EXPO_PUBLIC_FS_GALLERY` | `1` in the development profile.                                                       |

Demo mode runs the whole API in memory from the fixture, labels every screen "Demo data", verifies co-signatures
with Ed25519 independently of the phone's own signing code, and offers labelled controls that simulate PayPal's item
events (MM-1).

The app never calls PayPal, Claude or Gemini, and reads only `EXPO_PUBLIC_*` variables.

## WS-CORE's packages, and the temporary shims

UI code may import only `contracts` of WS-CORE's packages (register §6), so the app takes the rest as guarded copies:
- `contracts.ts` re-exports @fairsplit/contracts' types (type-only: nothing of the package is bundled) and keeps the
  app-only names (screen states, amount grammar, status words, IC-12 types); `contracts.parity.test.ts` holds its
  runtime values and its approval-payload check to the package.
- `domain-core.ts` is @fairsplit/domain's digest code (`batchDigest`, `linesDigest`, JCS, line hashes) copied byte for
  byte; `domain-core.parity.test.ts` compares it with packages/domain and recomputes the seed's hashes.
- `seed-run.json` is the seed snapshot's run r37 (items and all 64 member lines), copied by `node scripts/seed-run.mjs`
  and checked by `scripts/seed-run.test.mjs`; rerun the script whenever WS-CORE regenerates the snapshot.

The other files under `src/_shims/` still stand in for their packages and mirror the register's names, so the swap is
an import change: `domain.ts` (IC-02 `format.*`, `fsm.item`; it re-exports `domain-core.ts`),
`seed.ts` (IC-03 fixture and the register's canonical figures), `api-client.ts` (IC-08), `tokens.native.ts` (IC-09),
`motion.ts` and `moments.ts` (IC-09 presets, IC-10 phases), `seal.ts` (`@fairsplit/seal`), `i18n.ts`
(`@fairsplit/i18n`, plus one catalog per slice), `fonts.ts` / `font-sources*.ts` (FS Sans cuts).
`src/platform/feedback.ts` stands in for `@fairsplit/motion` `feedback.play` (haptics, and the three native sounds
written by `scripts/make-sfx.mjs` from design §4's recipes), and `src/ui/` for the `@fairsplit/ui-native` primitives
and glyphs. `scripts/make-icons.mjs` draws the interim app icon (the hanging-scale dial).
