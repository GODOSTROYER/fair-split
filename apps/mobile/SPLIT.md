# apps/mobile: one shell, three parallel slices

The app is built by three agents at once, each in its own worktree, on top of a frozen shell. The split is safe
because **no two agents ever edit the same file** and **no slice imports another slice's code**: everything that more
than one role needs lives in the shell. Merges are therefore conflict-free in any order; run `typecheck` and `test`
after each.

| Slice              | Worktree                              | Branch          |
| ------------------ | ------------------------------------- | --------------- |
| MEMBER             | `Z:/Projects/Paypal/fs-wt/app-member` | `ws/app-member` |
| CLERK              | `Z:/Projects/Paypal/fs-wt/app-clerk`  | `ws/app-clerk`  |
| BOARD + ONBOARDING | `Z:/Projects/Paypal/fs-wt/app-board`  | `ws/app-board`  |
| Shell (frozen)     | `Z:/Projects/Paypal/fs-wt/app`        | `ws/app`        |

All three branch from the shell's last commit on `ws/app`. Paths are under `apps/mobile/src/` unless they start with
`apps/`.

## 1. Who owns what

**MEMBER** owns `app/(member)/**`, `app/s/**`, `features/statement/**`, `lib/{statement,member-link}.ts` and their
tests, and `platform/speech.ts`.

**CLERK** owns `app/(clerk)/**`, `features/clerk/**`, `lib/{outbox,outbox-stores,backoff}.ts` and their tests,
`platform/{outbox-store,outbox-store.web,scanner,scanner.web,uploader,uploader.web,uploader-demo}.ts`, and the test
helper `test/node-sqlite.ts`.

**BOARD + ONBOARDING** owns `app/(board)/**`, `app/onboarding/**`, `app/pair.tsx`, `features/board/**`,
`features/onboarding/**`, `lib/{signing,pairing}.ts` and their tests, `platform/{key-vault,key-vault.web,push,push.web}.ts`
and `state/use-push.ts`.

**SHARED, frozen** (only the shell edits them, and only between slice rounds): `app/_layout.tsx`, `app/index.tsx`,
`ui/**`, `theme/**`, `_shims/**`, `services/**`, `state/app.tsx`, `types/**`,
`platform/{feedback,feedback.web,kv,kv.web,query,query.web,random,streaming-fetch,streaming-fetch.web}.ts`,
`lib/{item-status,uuidv7}.ts` and their tests, and `apps/mobile/{package.json,app.config.ts,eas.json,tsconfig.json,
vitest.config.mts,expo-env.d.ts,AGENTS.md,README.md,SPLIT.md}`, `apps/mobile/assets/**`, `apps/mobile/scripts/**`.
The root `pnpm-workspace.yaml` and `pnpm-lock.yaml` are frozen too: every dependency a slice needs is installed.

Each slice also owns its own copy (`features/<slice>/messages.ts`, `use-t.ts`, `messages.test.ts`).

### What moved from the first ownership list, and why

The first list was drawn by file name. Six pieces turned out to be used by more than one role, so they moved into
shared paths; leaving them in one slice would have let that slice change another's behaviour.

| Was (owner)                                                         | Now (shared)                                             | Used by                                                    |
| ------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| `lib/figures.ts` (MEMBER)                                           | `ui/figures.ts`                                          | `ui/sentence.tsx`, the statement and the co-sign prose     |
| `lib/hold.ts` (BOARD)                                               | `ui/hold.ts`                                             | `ui/slab.tsx` (every hold-to-commit control)               |
| `lib/frame-protocol.ts`, `platform/frame-bridge(.web).ts` (BOARD)   | `services/frame-protocol.ts`, `services/frame-bridge.ts` | all three stage frames, theme, feedback, moments, focus    |
| `platform/network.ts` (CLERK)                                       | `services/connectivity.ts`                               | member offline copy, "Signing needs a connection", outbox  |
| `PairedSession`, `sessionValid`, `homeRouteFor` in `lib/pairing.ts` | `services/session.ts`                                    | the shell state, the index redirect, demo sessions         |
| `pickLanguage`, `speakOnce` in `platform/speech.ts` (MEMBER)        | `services/voice.ts`                                      | Paminawa's device voice and the first-run language samples |

The clerk's outbox lifecycle also left the shell: it is `features/clerk/outbox-provider.tsx`, mounted by
`app/(clerk)/_layout.tsx`, read with `useOutbox()`.

### The only three seams

Code that crosses a boundary. The owner may change everything behind these names, but not the names or signatures.
1. `state/use-push.ts` (BOARD): `usePushRegistration(): PushRegistration | null`. The root layout calls it once.
2. MEMBER exports `BoardBayadScreen` from `features/statement/board-bayad-screen.tsx` and `PangutanaScreen` from
   `features/statement/pangutana-screen.tsx`; BOARD's `app/(board)/bayad.tsx` and `pangutana.tsx` re-export them
   (register §4: the board's Bayad and Pangutana tabs reuse the member screens).
3. `platform/key-vault.ts` (BOARD): `keyVault.forget(): Promise<void>`. The shell's `signOut()` calls it, so a signing
   key never outlives its pairing (added at the first integration, on BOARD's request).

### Changes the first integration made to the shell (27–28 Oct)

- Flags for the whole visit (`?demo= &stage= &line= &motion= &tier= &theme= &fsTrace=`) travel with every redirect:
  the index, the shared `/bayad` and `/pangutana` (member ↔ board) and the Pirma index (`carriedFlags`, `withFlags` in
  `services/session.ts`). The shell and the statement's `?line=` preview read them from the URL the app was opened
  with (`bootQuery`, `bootSearch` in `platform/query`), so `?motion=reduced` holds after a redirect and a reload keeps
  the demo.
- The index sends a board phone to its Pirma tab (`homeHref(role, null)`); it never guesses a run.
- `PairedSession` may carry `station` and `treasurerName` (kept by `parseSession`); `PairClaimResponse` may send them.
- `api.postReviewRequest(body, { idempotencyKey })` sends the `Idempotency-Key` header.
- `SCREEN_STATES["M-MB-04"]` gains `loading` and `error`.
- `Slab`: `onCommit` returns a `CommitOutcome`; `false` (or a rejection, or a throw) springs a hold slab back to rest
  with nothing committed. A slab that turns unavailable mid-hold disarms, closes its dialog and ignores the release
  (`guardUnavailable`, `settleUnavailable` in `ui/hold.ts`). The focus ring shows for keyboard focus only
  (`ui/focus-ring.ts`).
- `focusFirst` draws no focus ring around the landing block (browsers ringed the hero amount on load).
- `AmountDisplay` sets ₱ in the system font inside the SVG amount (`pesoRuns` in `ui/figures.ts`); `StatusChip` words
  wrap; `NavBar` reads a tab's `tabBarAccessibilityLabel`, and the clerk layout puts the Outbox badge there
  ("Outbox, 3 sa telepono").
- Demo data: each judge reset (`fs.reset`) is a fresh demo workspace; history times always read in order.
- `scripts/serve-web.mjs` serves `index.html` for every `/app/s/*` path, dots included (`scripts/web-routes.mjs`,
  tested); `scripts/smoke-web.mjs` walks every route of register §4 in the export.
- Expo pins follow `npx expo install --check` (expo 58.0.20 on 28 Oct); pnpm 11 recorded the patches younger than its
  release-age floor under `minimumReleaseAgeExclude`.

### Changes after WS-CORE merged (28 Oct)

- `_shims/contracts.ts` takes every type from @fairsplit/contracts (a type-only import: nothing of the package is
  bundled). Its runtime values (state lists, item ranks, key ID shapes, the payload's field set) are checked against the
  package's own by `contracts.parity.test.ts`. A runtime import would carry zod and every schema into each phone frame
  (+117 KB gzipped, measured) and needs a Metro rule for the package's `./x.js` specifiers, so the app does not make one.
- Approval roles are the package's, lowercase (`treasurer`, `chair`). `DeviceKeyKind` is `app | web | web_demo`:
  the Chair's phone key `fs-ernesto-a1` is `app`, a judge's `fs-{persona}-demo-{6}` is `web_demo`, the treasurer's
  `fs-analyn-w1` is `web`. Every key ID the phone makes has its kind's shape (`deviceKeyIdFitsKind`, `a1`…`a9999`).
- The digests are WS-CORE's code: `_shims/domain-core.ts` holds byte-for-byte copies of `batchCanonical`,
  `batchDigest`, `linesRootJcs`, `linesDigest`, `jcs`, `jcsSha256` and `parseSenderItemId` (@fairsplit/domain may not
  reach UI code, register §6, and hashes with node:crypto). `domain-core.parity.test.ts` compares each with
  packages/domain's source, checks `sha256Hex` (@noble/hashes) against node:crypto, and recomputes the seed's hashes.
- `linesDigest` is core's: sha256(JCS([{memberNo, lineSha256}] sorted)) over all 64 member lines, no longer the shim's
  (runId, rail, netCents). The demo co-sign is the seed's run r37 (`_shims/seed-run.json`, copied by
  `node scripts/seed-run.mjs`, checked by `scripts/seed-run.test.mjs`), so the phone's seal and hash are the console's.
- M-BD-01/02 recompute, before any key is touched: every line hash from its canonical, `linesDigest` from the lines,
  `batchSha256` from the items, the payouts against the PayPal lines (I3), and the approval payload from its own items
  and lines (`ApprovalPayloadDTO`). Any difference is "changed" (M-BD-01) or `mismatch` (M-BD-02): the clack, nothing
  signed. M-BD-01 also says what the signature binds besides the payouts ("all 64 member lines, 56 of them cash").
  Tests build other valid batches and tampered answers with `test/cosign-batches.ts` (BOARD's, test-only).
- The demo server answers with contracts' error codes (`KEY_NOT_REGISTERED`, `APPROVER_MISMATCH`,
  `SIGNATURE_INVALID`, `VALIDATION_FAILED`, …), registers a key only under its kind's ID shape and recomputes both
  digests from its record. `ApiErrorCode` is contracts' `ErrorCode` plus the app's `NETWORK` and pairing outcomes.

### Asked for, and left for the owning workstream

These need a contract or an endpoint the app does not own; the slices already work around each one.
- IC-01 (WS-CORE): a `rescan.requested` event `{photo, captureId, requestedBy}`. The clerk reads it on its own side.
- IC-08 (WS-API): `GET /v1/clerk/cash-day` and `POST /v1/lines/:lineId/cash-receipt`; until then they live in
  `features/clerk/cash-port.ts` (a 404 or 501 means "no cash list").
- WS-API: the open co-sign request (or its run slug in the pairing answer or the push), a localisable `CosignHold`
  summary, and the Chair's agreement to an override.
- WS-API: the approval-payload endpoint answers `ApprovalPayloadDTO` = IC-08's `{payload, jcs}` plus `senderBatchId`,
  `items` and `lines`, and `CosignRequestDTO` carries `lines`; a line is contracts' `ProofLine` narrowed to `memberNo`,
  `rail`, `netCents`, `canonical`, `lineSha256` (the Proof's own lines fit). The phone refuses to sign without them.
- WS-API: the statement's co-op Grade 1 total, the clerk per slip, mention offsets for audio clips, the Committee's
  reply, slip photos; whether to issue the dot-free member link (`body~sig`).

## 2. The shell's APIs

### State (`state/app.tsx`)

```ts
useApp(): {
  ready: boolean;
  lang: Lang; setLang(l: Lang): void;                     // ceb by default
  theme: ThemeName; setTheme(t: ThemeName): void;         // "adlaw" by default (one theme per surface)
  onboarded: boolean; completeOnboarding(): void;          // first run; the index sends !onboarded to /onboarding/language
  listenFirst: boolean | null; setListenFirst(v: boolean): void;  // S1.9 "Basahon o Paminawon una?"
  session: PairedSession | null; setSession(s: PairedSession | null): void; signOut(): void;
  api: FairSplitApi; demo: DemoController | null;          // demo when EXPO_PUBLIC_API_ORIGIN is unset
  online: boolean;
  lastSync: string | null; markSynced(): void;             // "Katapusang kopya, 10:21"
  frame: { inFrame: boolean; prefs: FramePrefs | null };   // judge stage frames (IC-12)
  gloss: boolean;                                          // English under Cebuano/Filipino sentences
}
```

The index redirect is `!onboarded → /onboarding/language`, `!session → /onboarding/pair`, else the role's home.
Onboarding decides its own steps and calls `completeOnboarding()`; frames and `?demo=member|board|clerk&stage=…` links
skip it.

### Services (`services/`)

- `session.ts`: `PairedSession`, `sessionValid(s, now)`, `parseSession(raw, now)`, `DEMO_BEARER`, `HREF` (typed hrefs for
  every route), `homeHref(role, runSlug)`, `pirmaHref(runSlug)`, `signHref(runSlug)`.
- `connectivity.ts`: `useOnline()`, `onConnectivity(cb) → unsubscribe`, `isOnlineState(netinfo)`.
- `frame-bridge.ts`: `inFrame`, `stage.moment(id, phase)`, `stage.feedback(event, index?)`, `stage.focus(screenId)`
  (the shell already forwards moments, feedback and focus; slices rarely call these directly).
- `voice.ts`: `pickVoiceLanguage(lang)`, `hasVoiceFor(lang)`, `speakOnce(text, language, rate?)`, `stopVoice()`.
- `demo-api.ts`: `createDemoApi`, `demoSession(role, now)`, `DemoController.advance(stage)` with `DEMO_STAGES`
  (`checking | sent | paid | unclaimed | cash-due | cash-received`); the demo server verifies co-signatures on its own.
- `build.ts`: `BUILD.version`, `BUILD.platform`, `apiOrigin()`.

### Contracts, domain, seed and the other shims (`_shims/`, named as the register names the packages)

- `contracts.ts` (IC-01): the package's types (`Lang`, `ApprovalPayload`, `ApprovalRole`, `BatchItem`,
  `DeviceKeyKind`, `HoldKind`, `LineCanonical`, `ProofLine`, `Rail`, …; `RunState`/`LineState`/`ItemStatus` are its
  `PayRunState`/`MemberLineState`/`PayoutItemStatus` without SUBMITTED), plus `LANGS`, `AppRole`, the state lists,
  `ITEM_STATUS_RANK`, `APPROVAL_ROLES`, `APPROVAL_PAYLOAD_KEYS`, `DEVICE_KEY_KINDS`, `KEY_ID_PATTERNS`,
  `deviceKeyIdFitsKind`, and the app-only `RunEvent` and payloads, `SCREEN`, `APP_ROUTES`, `SCREEN_STATES` +
  `ScreenStateOf<S>`, `SLAB_STATES`, `AMOUNT_STATES`, `AMOUNT_STATE`, `amountStateOf(line, {approved})`,
  `MEMBER_STATUS_WORDS`, `StatementTemplate`, `STATEMENT_SLOTS`, IC-12 types, `ApiErrorCode`.
- `domain.ts` (IC-02): `format.*` (`usd`, `usdPlain`, `peso`, `pesoEstimate`, `pesoSpoken`, `cashPesos`, `cashSpoken`,
  `amountSpoken`, `percentBp`, `kg`, `date`, `dayMonth`, `time`, `elapsed`, `hash`, `bytes`, `list`), `FEE_TABLE`,
  `fsm.item.apply`, and WS-CORE's digests from `domain-core.ts`: `batchDigest` (returns contracts' `BatchDigest`),
  `batchCanonical`, `linesDigest(lines)`, `linesRootJcs`, `approvalBytes`, `jcs`, `jcsBytes`, `jcsSha256`,
  `sha256Hex`, `parseSenderItemId`.
- `seed.ts` (IC-03 fixture): `coop`, `season`, `payer`, `fx`, `runSlug`, `runId` and `seasonId` (the seed's),
  `people` (with `keyKind`), `rateCard`, `rateCardSha256`, `senderBatchId`, `batchItems`, `batchSha256`,
  `batchTotalCents`, `runLines` (all 64), `linesDigest`, `heroLine`, `heroSlips`, `statementTemplates`,
  `resolvedHolds`, `cashDayIso`, `canonical` (every register §2 figure) and `namedMembers` (the nine named members).
- `motion.ts` (IC-09 presets): `SPRINGS`, `TWEENS`, `TIMELINE` (MM-1, MM-5, MM-7, pending ring, Paminawa chip),
  `HOLD_MS`, `ENGRAVE_STAGGER_MS`, `FEEDBACK_EVENTS`, `MAX_FLIGHTS`. `moments.ts` (IC-10): `MOMENTS`, `isPhase`.
- `seal.ts`: `seal(batchSha256, size)`, `sealStroke(size)`. `tokens.native.ts` (IC-09): `themes`, `space`, `radius`,
  `target`, `slabDepth`, `layer`, `m3(t)`. `i18n.ts`: `translate`, `translateIn`, `defineMessages`, `same`,
  `catalogProblems`. `api-client.ts` (IC-08): `FairSplitApi`, the DTOs, `subscribeSse` (SSE over `expo/fetch` with
  Last-Event-ID replay), `contentDigestHeader`.

### UI kit (`ui/`), theme and platform

- Text and copy: `Txt` (type roles, token colours, ₱ in the system font, scales to 2×, hero 1.5×), `useT()` (shell
  keys), `useMessages(catalog)`; `Sentence` + `figures()` (figures in the figure face inside prose).
- Chrome: `Screen<S>({ testID: S, state: ScreenStateOf<S>, … })` (demo label, safe areas, `fs.focus`), `TopBar`,
  `NavBar` (role tabs).
- Commit: `Slab` (`d1 | d2 | d3`, `hold`, `confirm: ConfirmSpec`, `onHoldState`, `committed`, `unavailableReason`;
  arm on hold, act on release inside, dialog route for Enter, virtual clicks, TalkBack and "Can't hold?"),
  `ConfirmDialog`, `Sheet`, `Snackbar` + `useSnackbar()`; the pure machine in `ui/hold.ts` (`holdReducer`,
  `mm5Phase`, `routeFor`, `quarterAt`).
- Money and machine output: `AmountDisplay({ text, srLabel, state, size, fill })` (the amount grammar, MM-1 via
  `fill`), `Print` (pencil/ink with a provenance footer), `SealView({ batchSha256, size, keys, engrave })`,
  `HashText`.
- Status and chips: `StatusChip`, `MemberStatusChip({ status, word })`, `RuleChip`, `Chip` (`role="radio"`), `Button`,
  `Banner`, `InkStamp`, `Hatch`, `Rule`, `SectionTitle`, `Wordmark`, `DemoLabel`, `MachineTranslatedNote`,
  `LanguagePicker`, `Glyph` (typed names).
- States: `OfflineBar({ lastCopyAt })`, `EmptyState`, `Skeleton`.
- Moments: `useMoment(id, initial)` → `{ phase, set, start(eventId, phase), rest, timers, rootProps }`,
  `MomentMarker`, `useTimers()`.
- Motion: `spring(name)`, `tween(name)`, `reducedFade()`, `ms(name)`, `TIMELINE`, `HOLD_MS`.
- Accessibility: `focusFirst(ref)`, `announce(text)`.
- Theme: `useFs()` → `{ t (tokens), name, motion: { reduced, low, screenReader } }`, `typeScale`.
- Platform: `feedback.play(event, { index })`, `feedback.narration(on)` (Paminawa owns the audio session),
  `feedback.preload()`; `prefs` and `secrets` key-value stores; `webQuery`; `randomBytes`; `streamingFetch`.
- `lib/item-status.ts`: `reduceItemEvent` (forward-only, duplicates silent), `capsuleFor`, `CAPSULE_WORD`,
  `amountIsSolid`, `STATUS_TONE`, `STATUS_GLYPH`, `PENDING_RING_MAX_MS`. `lib/uuidv7.ts`: `uuidv7`, `uuidv7Time`.

## 3. Conventions

- **Test hooks.** A screen root's `testID` is its register ID (`M-MB-01`); elements are `{screenId}.{element}`
  (`M-BD-02.slab`), sub-parts `{screenId}.{element}.{part}`. `data-state` comes from `SCREEN_STATES` through `<Screen>`;
  a state that is not listed does not compile, and adding one is a contract change for the orchestrator, not a local
  edit.
- **Moments.** Use `useMoment`; phases only from `MOMENTS`; `data-moment-phase` through `rootProps`; `start()` only
  for a real event id (SSE event, 201, signature). Every moment also has its reduced-motion path reaching the same
  phases.
- **Status words.** Members read IC-01's words (`MEMBER_STATUS_WORDS`, `CAPSULE_WORD`), never a raw state name. A hold
  is "Gisusi pa", never "error"; UNCLAIMED is canary ("Parked"), never red.
- **Money.** Every figure comes from a DTO through `format.*` (I1). PayPal pesos are floored estimates
  (`format.peso`, "about ₱4,028"); cash pesos are exact (`format.cashPesos`, "₱7,990.00"). Amount states come from
  `AMOUNT_STATE`/`amountStateOf`.
- **Copy.** No user-facing literals in components. Add keys to your slice's `messages.ts` (`<screenId>.<key>`, all
  three languages, the same `{placeholders}`), read them with `useT()` from `./use-t`; `messages.test.ts` must stay
  green. Show `MachineTranslatedNote` on member surfaces.
- **Motion.** No numeric literal inside `withTiming(` or `withSpring(`: use `spring()`, `tween()`, `reducedFade()` or
  a `TIMELINE` entry. Under `motion.reduced` nothing travels and colour or opacity changes over 150 ms; under
  `motion.low` at most three animations run. No count-ups, confetti or ambient loops.
- **Sound and haptics** only through `feedback.play`; they decorate, never inform.
- **Accessibility.** 48 dp targets (primary 56, Paminawa and Pirmahi 64), a role, label and state on every control,
  `focusFirst` for first focus, text up to 2×. Never branch on screen-reader detection on the web
  (`motion.screenReader` is native only); every hold has its dialog route.
- **Honesty (I8).** `<Screen>` shows the demo label; label demo keys, sample slips and the phone's own voice.
- **New shared-looking components go in your own `features/<slice>/` folder.** Do not edit a shared path, and do not
  import another slice's folder. If the shell needs a change, say so in your final report; the orchestrator decides
  and lands it in the shell between rounds.
- **Tests.** Vitest for pure logic (`src/**/*.test.ts`, Node, no React Native imports in the module under test);
  invariant tests are named `inv.iN.*`; `fast-check` is installed for property tests.

## 4. Commands (from `apps/mobile`, Git Bash, `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`)

```bash
corepack pnpm typecheck          # tsc; run `corepack pnpm build` once first so typed routes exist in .expo/types
corepack pnpm test               # Vitest
corepack pnpm exec biome check . # from the repo root: corepack pnpm exec biome check apps/mobile
corepack pnpm check:expo         # npx expo install --check
corepack pnpm build              # web export → dist/, base path /app
corepack pnpm serve:web          # http://localhost:8087/app/ (?demo=member|board|clerk&stage=…)
corepack pnpm smoke:web          # after build: every register §4 route in Chromium at 412×915 (--shots <dir>)
```

## 5. Spec decisions the slices inherit

- Routes are register §4's (the plan's resolution "Routes and IDs: register §4"), so M-MB-02 Resibo and M-MB-04
  Pangutana stay although S1 retired them.
- One theme per surface (approved plan): the app is Adlaw. `/onboarding/theme` must exist (register route); what it
  shows is BOARD + ONBOARDING's call.
- The signed payload carries `linesDigest`; the phone refuses a payload without it, and signs only a payload whose own
  items and lines give both digests with WS-CORE's functions (`inv.i4.*`).
- Member wording never shows a per-kg rate: "Your 148.0 kg of the co-op's 9,780.6 verified kilos" (S2.2.1).
