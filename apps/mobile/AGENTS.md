# apps/mobile: notes for coding agents

Read the repo's root `AGENTS.md` and `docs/spec/` first; the decision register wins every conflict. Three slices build
this app in parallel on a frozen shell: **read `SPLIT.md` before editing anything**, and edit only the paths your slice
owns.

## Expo changes every SDK; check the installed version, not memory

- `expo` is pinned to 58.0.20. Read the installed `.d.ts` files in `node_modules` or the versioned docs at
  `https://docs.expo.dev/versions/v58.0.0/` before using an Expo or React Native API.
- Dependencies are exact `catalog:` pins in `pnpm-workspace.yaml`, taken from `node_modules/expo/bundledNativeModules.json`
  for native modules; `corepack pnpm --filter @fairsplit/mobile check:expo` (`npx expo install --check`) must stay
  clean. Never run `npx expo install <pkg>` (it writes a range). Slices add no dependencies: everything they need is
  installed (`SPLIT.md`).
- The online check follows Expo's newest SDK 58 patches, so it can start failing with no change here (27 Oct 2026:
  seven pins one patch behind; 28 Oct: five more). Only the shell bumps them, in the catalog, between slice rounds; the
  lockfile change must be version bumps of Expo's own packages only (no new package names; `noxcturnal` is Expo's,
  under `@expo/metro-config`), and typecheck, tests and the web export rerun.
- `android/` and `ios/` are generated (Continuous Native Generation). Configure native behaviour in `app.config.ts`
  and config plugins only.

## Layout

- `src/app/`: routes only (register §4). `(member)/(tabs)` exists so Paminawa can be a modal over the tabs; the URLs
  are the register's (`/bayad`, `/paminawa`, …). Navigate with the typed hrefs in `services/session.ts`.
- `src/features/<slice>/`: a slice's screens, hooks, components and copy (`messages.ts`, read with `useT()` from
  `use-t.ts`).
- `src/ui/`: the shared kit (Slab, AmountDisplay, StatusChip, Print, overlays, chrome, moments, motion adapters).
- `src/services/`: session, connectivity, the IC-12 frame bridge, device voice, the demo server.
- `src/lib/`: pure logic with Vitest tests (no React Native imports).
- `src/platform/`: native/web adapters (`*.web.ts` for the judge frames).
- `src/_shims/`: temporary stand-ins for sibling packages (`contracts`, `domain`, `seed`, `seal`, `api-client`,
  `tokens`, `motion`, `moments`, `i18n`); their names match the register so the swap is an import change.

## Rules that bite here

- UI code holds no user-facing literals: copy lives in the slice's `messages.ts` (or `_shims/i18n.ts` for the shell),
  keyed `<screenId>.<key>`, in ceb, fil and en.
- Money comes from engine values through `format.*`; a model-written sentence with a digit is never rendered (I1).
- Item statuses only move forward (I5); the co-sign refuses a payload that is not the batch on screen (I4).
- Every simulated thing is labelled (I8): demo mode, the web demo key, sample slips, the phone's own voice.
- Timings come from `_shims/motion.ts` through `ui/motion.ts`; phases from `_shims/moments.ts` through `useMoment`.
- Run `typecheck`, `test`, Biome and `check:expo` before committing.
