# apps/mobile: notes for coding agents

Read the repo's root `AGENTS.md` and `docs/spec/` first; the decision register wins every conflict.

## Expo changes every SDK; check the installed version, not memory

- `expo` is pinned to 58.0.17. Read the installed `.d.ts` files in `node_modules` or the versioned docs at
  `https://docs.expo.dev/versions/v58.0.0/` before using an Expo or React Native API.
- Dependencies are exact `catalog:` pins in `pnpm-workspace.yaml`. For a native module, take the exact version from
  `node_modules/expo/bundledNativeModules.json`, add it to the catalog, then run `corepack pnpm install` and
  `corepack pnpm --filter @fairsplit/mobile check:expo`. Do not run `npx expo install <pkg>` (it would write a range).
- `android/` and `ios/` are generated (Continuous Native Generation). Configure native behaviour in `app.config.ts`
  and config plugins only.

## Layout

- `src/app/`: routes only (register §4). `(member)/(tabs)` exists so Paminawa can be a modal over the tabs; the URLs
  are the register's (`/bayad`, `/paminawa`, …).
- `src/lib/`: pure logic with Vitest tests (no React Native imports).
- `src/platform/`: native/web adapters (`*.web.ts` for the judge frames).
- `src/_shims/`: temporary stand-ins for sibling packages; keep their names identical to the register.

## Rules that bite here

- UI code holds no user-facing literals: copy lives in `src/_shims/i18n.ts` keyed by screen ID.
- Money comes from engine values through `format.*`; a model-written sentence with a digit is never rendered (I1).
- Item statuses only move forward (I5); the co-sign refuses a payload that is not the batch on screen (I4).
- Every simulated thing is labelled (I8): demo mode, the web demo key, sample slips, the phone's own voice.
- Run `typecheck`, `test`, Biome and `check:expo` before committing.
