# Console split: shell, wire, three slices

The console (`apps/console`, WS-CONSOLE) is built in four steps. The **shell** (this commit) registers every web
route, draws the Judge stage and its chrome in Tablea, and provides the data layer, the test kit and every
dependency. The **wire** step (done) merged `ws/api`, moved `src/data/` onto `@fairsplit/api-client` and its msw
mock, and created the three slice worktrees. **season**, **runs** and **proof** built their screens in parallel. The
**integrate** step (done) merged the three slices, then `main` (the final phase-1 packages) and `ws/api` (api-client
on main's contracts), and adapted the console: IC-02 `linesDigest` in the approval payload, judge demo keys
`fs-{persona}-demo-{6}` registered per session, MM-3 `pairs` and MM-5's arm-then-release from the revised S2.9.

Read first: `docs/spec/00-plan.md` (wins), `docs/spec/01-design-direction.md`, register §1–§5, S1.5–S1.12, S2 (all)
and `docs/adr/0002-simulated-paypal-sandbox-and-private-repo.md`.

## Ownership

| Slice  | Owns (and their tests)                                                                                                                                                                                                                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| season | `src/screens/{W-JG-01,W-TR-01,W-TR-02,W-TR-03,W-TR-04}/**`, `src/features/{judge,season,ratecard,reading,byhand}/**`                                                                                                                                                                                                       |
| runs   | `src/screens/{W-TR-05,W-TR-06,W-TR-07,W-TR-08,W-TR-09}/**`, `src/features/{split,holds,approve,fanout,print}/**`                                                                                                                                                                                                           |
| proof  | `src/screens/{W-PF-01,W-BR-01,W-OP-01,W-TR-10}/**`, `src/features/{proof,brand,ops,shortcuts,datamode}/**`                                                                                                                                                                                                                 |
| shared | everything else under `apps/console/**`: `package.json`, configs, `index.html`, `src/main.tsx`, `src/router.tsx`, `src/routes/**`, `src/routeTree.gen.ts`, `src/screens/contract.ts`, `src/stage/**`, `src/data/**`, `src/chrome/**`, `src/theme/**`, `src/lib/**`, `src/sound/**`, `src/test/**`, `SPLIT.md`, `README.md` |
| WS-DS  | `src/prototype/**` and the `/prototype` routes: never edit them                                                                                                                                                                                                                                                            |

**Shared is frozen** after the wire step. A slice never edits a shared file, `package.json` or the lockfile. Every
dependency is installed (below); a route the register lacks is a request to the orchestrator, not an edit. If a
slice needs a shared change, it reports it with the exact signature it needs and keeps a local version inside its
own `features/` folder until the shell takes it.

W-AU-01 (`/sign-in`) is final in the shell: real accounts are P2, and judges never log in.

## Routes (frozen) and the screen contract

Every route in `webRoutes` is registered and renders the component exported from `src/screens/<ID>/index.tsx`.
The props are in `src/screens/contract.ts`; `src/screens/contract.test.ts` fails if an export goes missing.

| Route                                     | Renders                                                                                                                                                                               | Surface |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `/` → `/judge`                            | redirect                                                                                                                                                                              | stage   |
| `/judge`                                  | W-JG-01 `Screen` (+ `StageExtras`, always mounted in the stage)                                                                                                                       | stage   |
| `/season/:seasonCode`                     | W-TR-01 `Screen({ seasonCode })`                                                                                                                                                      | stage   |
| `/season/:seasonCode/rate-card`           | W-TR-02 `Screen({ seasonCode })`                                                                                                                                                      | stage   |
| `/season/:seasonCode/reading?photo=B`     | W-TR-03 `Screen({ seasonCode, photo? })`                                                                                                                                              | stage   |
| `/season/:seasonCode/by-hand/:slipNo`     | W-TR-04 `Screen({ seasonCode, slipNo })`                                                                                                                                              | stage   |
| `/runs/:runSlug` → `/runs/:runSlug/split` | redirect                                                                                                                                                                              | stage   |
| `/runs/:runSlug/split?hold=&member=`      | W-TR-05 `Screen({ runSlug, hold?, member? })`, then W-TR-06 `Screen({ runSlug, holdId })` while `?hold=` is set, else W-TR-09 `Screen({ runSlug, memberNo })` while `?member=` is set | stage   |
| `/runs/:runSlug/approve`                  | W-TR-07 `Screen({ runSlug })`                                                                                                                                                         | stage   |
| `/runs/:runSlug/fanout`                   | W-TR-08 `Screen({ runSlug })`                                                                                                                                                         | stage   |
| `/runs/:runSlug/members/:memberNo/print`  | W-TR-09 `PrintScreen({ runSlug, memberNo })`                                                                                                                                          | Adlaw   |
| `/proof/:runSlug`                         | W-PF-01 `Screen({ runSlug })`                                                                                                                                                         | Adlaw   |
| `/b/:token`                               | W-BR-01 `Screen({ token })` (the signed brand link)                                                                                                                                   | Adlaw   |
| `/ops`                                    | W-OP-01 `Screen()`                                                                                                                                                                    | Tablea  |
| `/sign-in`                                | W-AU-01 (shell, final)                                                                                                                                                                | Tablea  |
| `/s/:token`                               | hands over to `/app/s/:token`                                                                                                                                                         | —       |
| `/prototype/**`                           | WS-DS                                                                                                                                                                                 | —       |
| `?` anywhere                              | W-TR-10 `ShortcutSheet({ open, onOpenChange })`, mounted at the root                                                                                                                  | —       |

Path params are checked against IC-01 (`SeasonLabel`, `RunSlug`, `SlipSerial`, `MemberNo`): a malformed path is a
404. Search params the routes declare are validated (`?photo=` A–L or P01–P54, `?hold=` a label or ID, `?member=`);
anything else is read with `useSearchParam(name)` from `src/lib/search-param.ts`, and the screen validates it.
Navigate with `webRoutes.*` and `<AppLink href>` (a real anchor) or TanStack's `useNavigate` with the route paths.

## What the shell gives you

### Data (`src/data/`): TanStack Query over `@fairsplit/api-client`

| API                                                 | Use                                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useCommand(name, options?)`                        | A command as a mutation: `resolve.mutate({ params: { holdId }, body: { resolution } })`                                                                |
| `useCommandQuery(name, input, options?)`            | A GET command as a query: `approvalPayload`, `proof`, `proofJson`, `proofExport`                                                                       |
| `useSnapshot()`                                     | The IC-03 season snapshot (members, slips, photos, rate card, figures, checkpoints, run)                                                               |
| `useRunView(runSlug)` + `useRunStream(runSlug)`     | The run's live `RunView`; the stream keeps it live (the stage already holds its run open)                                                              |
| `useStageRun()`                                     | `{ runSlug, view, inSession, snapshot }`: the stage's run (first view before the press)                                                                |
| `useRunEvents(runSlug, (event, { replay }) => …)`   | Raw events; start a moment only when `!replay`, with `event.id` as evidence                                                                            |
| `useJudgeSession()`                                 | `{ status, session, error, start(), reset(), dismissError() }`                                                                                         |
| `usePaypalRail()`                                   | `"simulator"` or `"sandbox"`: label every PayPal value with it (I8)                                                                                    |
| `useDescribeContext()`, `describeEvent(event, ctx)` | Run-log rows in three lanes (W-TR-08's log, the ribbon)                                                                                                |
| `run-view.ts` selectors                             | `openHolds`, `blockingHolds`, `holdCards`, `byHandHolds`, `itemCounts`, `atLeast`, `runStrip`, `livePresence`, `lineAmountState`, `invoiceAmountState` |
| `errors.ts`                                         | `CommandError<N>`, `errorView(e)`, `isApiClientError(e, ...codes)`, `asRateCardRatified(e)` (below)                                                    |
| `useAdapter().api`, `adapter.pending`               | The typed client, and the routes API_COMMANDS lacks (below)                                                                                            |
- **Failures** (`errors.ts`): `CommandError<N>` is api-client's `ApiClientError` (`.code` narrowed to the codes
  command N may answer, `.status`, `.requestId`, `.paypalDebugId`, `.notImplemented`), `NetworkError` or
  `ContractError`. `asRateCardRatified(e)` gives MM-4's card hash; `errorView(e)` and `requestIdOf(e)` feed
  `CommandNotice`; `ERROR_WORDS` holds the console's sentence per code.
- **The typed client** (`useAdapter().api`): `api.url("proofJson", { runSlug })` for links and downloads,
  `api.request({ path, schema })` for a route outside IC-01, `api.rail` for the last answer's `X-FS-Rail`.
- **Pending routes** (`adapter.pending`): `snapshot` (the seed), `frameToken` (`POST /v1/judge/sessions/:sid/frames`),
  `resetSession` (`.../reset`) and `paypalRail` (`GET /healthz`, falling back to the build's label).

State that moves arrives as `RunEvent`s and is reduced into the run's query data; mutations do not refetch. A
command's result is not the state: the event that follows it is. The reducer is forward-only (I5). The judge
session's run starts from `sessionView` (the INVOICED clone, S3.9) and replays its stream from the start; a cached
read under the same slug is dropped when a session starts or ends (the mock reuses r37's slug for the session).

A 501 (`error.notImplemented`, `isNotImplemented(e)`) means the API slice that owns the command has not landed yet:
`CommandNotice` says "This step isn't wired on the server yet". Build against the mock; never hide the 501.

### Stage (`src/stage/`)

| API                                                  | Use                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `useStage()` / `useOptionalStage()`                  | `{ layout, phone, raisePhone(p), lowerPhone(), selectPersona(p), director, next, autoplay, setAutoplay(s) }` |
| `usePrefocus(ref, screenId, when?)`                  | Focus your step's control when the run pill names it (S1.6)                                                  |
| `useNextStep()`                                      | The pill's step: `{ id, text, actor, screen, to, persona? }`                                                 |
| `stage.director`                                     | `claim(moment, ms)` for focal moments (≤1.6 s wait, else reduced); `space("item" \| "row")`                  |
| `stage.setAutoplay("autoplay" \| "paused" \| "off")` | "Play it for me" (season): the stage shows the state and its strip                                           |
| FrameBridge (`bridge.ts`)                            | IC-12, stage side; frames named `member`, `chair`, `clerk`; only the stage plays sound                       |

### Chrome (`src/chrome/`)

| Component                                                                   | Use                                                                                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `<ScreenRoot id state labelledBy? as?>`                                     | Every screen's root: `data-testid="{ID}"`, `data-state` typed to S1's names                                                    |
| `<StageDrawer label meta? onClose testId mode?>`                            | W-TR-06 and W-TR-09 render inside it: push or overlay per width, Esc closes                                                    |
| `<CommandNotice error testId onRetry? retryLabel?>`                         | Any failed command, in the console's words, red only when PayPal is the actor                                                  |
| `<PrintBed shape width? height? count? labels?>`                            | Loading: dashed beds at final size, never a shimmer                                                                            |
| `<DataTable caption columns rows testId>`, `<Mirrored visual table testId>` | Data mode (D): every chart hidden from AT and mirrored as a table                                                              |
| `<ChromePortal name>`                                                       | Fill a chrome slot: `pill.accessory` (Play it for me), `whatsReal.tryToBreak`, `stage.film`, `stage.overlay` (cursor, flights) |
| `<AppLink href>`                                                            | A real anchor that navigates in the SPA                                                                                        |
| `<Surface theme>`                                                           | Already applied by the routes (Adlaw for Proof and print)                                                                      |
| `copy.ts`                                                                   | Stage words; `whatsReal()`, `TRY_TO_BREAK`, `STAGE_NOTICE`                                                                     |

### Lib, sound, theme

| API                                            | Use                                                                                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `format` (`lib/format.ts`)                     | The only number formatter (domain's pure `format.*`): `money`, `kg`, `pesoEstimate`, `hashGroups`, `amountSpoken`… Never `Intl`         |
| `useMoment(id, { focal?, mode? })`             | The phase machine: `play(act, { eventId }, { skipFeedback?, feedbackIndex? })`, `enter(phase)`, `reset()`, `value(target)`, `rootProps` |
| `provenanceFooter(input)`                      | "Read by Claude (claude-opus-5-5)", "Computed by engine v1, rate card f2d7 026d", PayPal by rail                                        |
| `lib/focus.ts`                                 | Every focus move: `returnFocus(targets, { leaving? })` in the commit that removed what held focus (by stable key, then the screen's main control, revealed), `focusAndReveal(el)`, `useFocusAfterRemoval`, `<FocusReturn>` in a dialog's popup |
| `<Stamp stamp testId?>` (`chrome/Stamp.tsx`)   | A person's ink stamp (ui-web's look, `role="img"` named in full): use it, not ui-web's `InkStamp`                                      |
| `useShortcut(spec)`, `useShortcuts()`          | Register keys while mounted (`group`: General, Read, Review, Approve, Run; `scope` for J/K)                                             |
| `useDataMode()`                                | `{ on, set, toggle }`; `<html data-datamode>` mirrors it                                                                                |
| `useAnnounce()`                                | One polite live region, throttled to one summary per 5 s ("3 of 8 confirmed")                                                           |
| `lib/verify.ts` (import lazily)                | Proof's "Verify in your browser": domain's verify-core + `browserProofCrypto`                                                           |
| `lib/sha256.ts`                                | Synchronous SHA-256 (verify-core needs it sync)                                                                                         |
| `lib/keys.ts`                                  | `signingKeyKind(keyId)`, `isSampleKey(keyId)`: a key's kind from its ID shape (C-13: `-w1` web, `-a1` app, `-demo-{6}`, `-s1`)          |
| `lib/keystore.ts`                              | The treasurer's persisted `fs-analyn-w1` (kind web): made and registered from /ops; Judge Mode signs with a `web_demo` key              |
| `useSound()`, `playFromFrame()`, `duck()`      | Sound is the stage's; `feedback.play(event)` from ui-web is the only way to make a sound                                                |
| `theme/grid.ts` (import only from SplitAgGrid) | `gridTheme` (tokens' AG Grid theme), `GRID_DEFAULTS`, modules registered; keeps AG Grid in its lazy chunk                               |

## Rules every slice keeps

- **Material grammar.** Machines print (flat pencil, tweens, never a button); people press (slabs: at most two per
  screen, one d3); PayPal lands (jade flush, only on a verified item). Jade means money, canary a person's decision,
  red only a PayPal failure. Corners 0 or 2. Only paper casts a shadow. No gradients, glass, glows, eyebrows, pill
  badges, monospace or emoji. Tokens only (`var(--fs-*)`, the `fs-t-*` type classes); timings only from
  `@fairsplit/motion` (the `--fs-dur-*`, `--fs-ease-*` and spring `linear()` variables in CSS).
- **Motion is evidence.** State animates only on an SSE event, a 201/409 or a signature, passed to `play()` as
  `eventId`. Replayed history never animates. No timers, count-ups or confetti.
- **Hooks.** `data-testid="{screenId}.{element}"` (`tid(id, element)`), `data-state` on every stateful element,
  `data-moment` and `data-moment-phase` on every moment root (from `useMoment().rootProps`), `data-amount-state` on
  every amount (S2.2.1: pencil, you, ink, hollow, landed, attested).
- **Words.** Status words come from the contracts label maps, never a raw state. Sentence case, no exclamation
  marks, buttons name outcomes. Under the simulated rail nothing PayPal is "real", "live" or "verified".
- **Every state renders**: empty, loading (print beds), error (`CommandNotice`), held, approved, posting, paid,
  parked, cash due, with a reduced-motion variant that keeps every phase.
- **Accessibility**: WCAG 2.2 AA; axe clean on every state; hold slabs keep their dialog route; visualisations
  are `aria-hidden` and mirrored in `<Mirrored>` tables; focus is visible (pod ring). Every focus move goes through
  `lib/focus.ts`: never `el.focus()` directly, never from a timer, never to `<body>`; a control that the answer
  removes hands focus on with `useFocusAfterRemoval`, and a stable `data-testid` (or `data-focus-key`) lets a
  redrawn opener be found again.
- **Budgets** (S2.11): route JS ≤300 KB gz; Proof's initial JS ≤110 KB gz; AG Grid only in its own lazy chunk
  (`features/split/SplitAgGrid.tsx` with `theme/grid.ts`, loaded once the grid's container is measured; the static
  table prints the lines until then); Proof's verify code only through a dynamic import of `lib/verify.ts`. Measure
  with `pnpm --filter ./apps/console build && pnpm --filter ./apps/console budget` (exits 1 on a breach;
  `scripts/budget-core.mjs` is the measuring, tested in `test/budget.test.ts`). On 2026-10-28 the shared entry
  alone is about 300 KB gz (react-dom, motion, Base UI, i18next with its ICU parser, zod with contracts), so Proof
  (338 KB), the Judge stage (340 KB) and Split review (355 KB; AG Grid's lazy chunk 212 KB, inside its 300 KB) are
  over: trimming the entry is open work, and CI does not run the check yet.

## Tests

Vitest 5 + Testing Library + msw 3 + axe-core 4.13.0, no network, no live API. Import the kit from `src/test`:

```ts
import {
  renderConsole,
  createTestWorld,
  startMockServer,
  expectNoAxeViolations,
  tracedPhases,
  momentPhase,
  clearMomentTrace,
  setViewport,
  resizeTo,
} from "../../test/index.js";

const view = await renderConsole({
  path: "/runs/2026A-r37/split?hold=H1",
  motion: "reduced",
  viewport: { width: 1920 },
});
const session = await view.startSession(); // the first press (createJudgeSession)
act(() => {
  view.world.markPaid(); // drive the run as the people would: the world emits the events
  view.world.enterByHand("64.80");
});
await screen.findByTestId("W-TR-06"); // then assert data-state, phases, amount states
await expectNoAxeViolations(view.container);
```

- `createTestWorld(options?)` is api-client's mock of fs-api (`@fairsplit/api-client/msw`, see its README) at
  stage `invoiced` in `manual` pace, with the console's pending routes and a driver: `markPaid()`,
  `enterByHand(value?)`, `resolve(label, body?)` (H1 COUNT_ONCE, H2 REGISTER_PLOT, H3 RETURN_AS_CREDIT by default),
  `resolveAll()`, `sign(role)`, `cosign()`, `payCash(memberNo)`, `command(name, { params, body | query, as })`,
  `holdId(label)`, `fieldId()`, `lineId(memberNo)`, `eventsAfter(id)`. Driver steps settle the reading or fan-out
  they start; a command pressed in the UI leaves them queued until `act(() => view.world.settle())`. The world's
  own API is there too: `run`, `holds()`, `lines()`, `events()`, `failNext(command, code)` for hard-to-reach
  refusals (`KILL_SWITCH_ON`, `CIRCUIT_OPEN`, `PAYPAL_REJECTED`...), `advance(n)`, `reset(stage)`. Pass
  `{ stage: "review" | "approve" | "posted" | "settled" }` to open a screen mid-story.
- `renderConsole` runs the adapter over msw's handlers in memory (fast, no interception);
  `startMockServer(world)` + `createTestHttpAdapter()` run the same handlers over HTTP and SSE through msw/node
  (unhandled requests fail).
- Slab presses: `fireEvent.keyDown(getByTestId("{testId}.face"), { key: "Enter" })` (ui-web's Slab).
- Moments: assert `momentPhase(container, "MM-3")` and `tracedPhases("MM-3")` in `full` and `reduced`; phase names
  only from `@fairsplit/motion`. Use `vi.useFakeTimers()` to step through acts.
- Name invariant tests `inv.iN.*` (I1 to I8). Pure logic may stay in `*.test.ts`; components in `*.test.tsx`.
- Run: `corepack pnpm --filter @fairsplit/console test` and `typecheck`; `corepack pnpm exec biome check apps/console`.

## Dependencies (installed; slices add none)

React 19.3, TanStack Router 1.170.45 and Query 5.104.5, Base UI 1.9.0, Motion 14.0.0, AG Grid Community and
React 36.2.0, zod 4.6.7, eventsource-parser 4.1.2, @noble/curves 2.4.0, the `@fairsplit/*` packages (contracts,
domain, seed, tokens, motion, seal, ui-web, i18n, api-client); for tests Vitest 5.0.5, Testing Library (react
16.3.3, dom 10.4.2), jsdom 30.1.2, msw 3.0.3, axe-core 4.13.0, fast-check 4.10.2. No QR encoder and no `user-event`
exist in the catalog: draw the co-sign QR from an API-provided matrix or request a pin through the deps lane.

## Known gaps (reported to their owners)

- IC-12 FrameBridge is not in `@fairsplit/contracts` yet: `src/stage/bridge.ts` holds the schemas, matched to
  WS-APP's frame side, until WS-CORE adds them.
- IC-01 lacks `SCREENS[id].states` and `AMOUNT_STATE`: `lib/screens.ts` and `run-view.ts` carry S1's and S2's lists.
- API_COMMANDS lacks the season and run reads, the frame token, Reset and the PayPal mode: `adapter.pending`
  calls them (seed, `POST /v1/judge/sessions/:sid/frames`, `.../reset`, `GET /healthz`); the console's mock serves
  the three routes over api-client's world (`src/data/mock/pending.ts`) until WS-API ships them.
- api-client's mock has one session whose run reuses the showcase slug (r37; a real session gets its own runSeq),
  emits no `webhook.received` events (W-TR-08's repeated delivery cannot be shown from the mock yet), and serves no
  frame-token or Reset route (the console's mock does). Reported to WS-API.
- W-TR-07 reads the run's own lines (`GET /v1/runs/:runSlug/lines`, fs-api's LineList) together with the approval
  payload, shows their amounts and recomputes IC-02 `linesDigest` from them, never from the seed: a judge workspace
  mints its own deduction-mark IDs and a line hash covers them, so the seed's root is never the workspace's.
  api-client's mock serves neither the lines read nor workspace mark IDs; the console's mock does both
  (`src/data/mock/fidelity.ts`). Reported to WS-API.
- Renewing the console token has no resume-only path in fs-api. `SessionStore.renew()` sends `createJudgeSession`
  with the judge cookie alone; when the cookie's workspace has ended (a Reset in another tab, or it expired) fs-api
  mints a new workspace and run, and that renewal uses a slot of the 3-new-sessions-an-hour limit: under the same
  session ID after a Reset (the cookie outlives it), under a new session ID and cookie when the workspace expired
  (the cookie ended with it); when the cookie's session already has a live workspace (the other tab pressed
  again) it resumes that one and mints nothing. The console refuses the answer (another workspace or run ends the
  session; the stage returns to `/judge` and says why), but a new workspace may already have been created. Needed
  from WS-API: a renewal that only resumes, answering 401/410 for an ended workspace instead of recreating it, and
  never counting against the new-session limit. A Reset in another tab revokes the workspace's tokens, so this
  tab's next call carrying its token is answered 401 UNAUTHENTICATED: the console ends the session there and then
  (`onTokenRefused`), without a renewal.
- fs-api serves neither `GET /v1/ops/session` nor `GET /v1/ops/outbox`: /ops never names the operator in http mode,
  so the treasurer key's make and register stay off there (their sections say "not served yet"). The registration
  body is fs-api's `RegisterKeyRequest` (workspace, key, approver and a proof signed by the new key); the showcase
  workspace comes from `GET /v1/ops/overview`'s ledger heads (kind "showcase"), and nothing is sent while it names
  none. `GET /v1/credential` (whoami) could answer "who is reading" today. Reported to WS-API.
- fs-api answers `GET /v1/proof/:runSlug` 404 before it reads the credential (no run posted yet), so a 404 says
  nothing about a brand link: the console then asks `GET /v1/credential` with the link and shows the brand's
  header only for a `brand_link`. api-client's mock knows only the links it issued for that read, while the
  console's mock (`fidelity.ts`) accepts any `fsb_` bearer on the proof read (it checks no signature).
- The mock's proof read and export always serve the seed's showcase bundle (`snapshot.proof`, provenance
  "seeded"), even for the session's run: its approvals carry the seed's `linesDigest`, not the two this session
  signed (fs-api's export lists the session's own). Reported to WS-API.
- ui-web's `InkStamp` puts `aria-label` on an `<abbr>` (axe aria-prohibited-attr; some readers say only the
  initials). The console draws its own `<Stamp>` (same look, `role="img"` named in full) everywhere it can;
  ui-web's `HoldCard` still draws `InkStamp` for a decided hold's resolution stamp (W-TR-06), and the prototype's
  Primitives page shows ui-web's own. Reported to WS-DS.
- tokens' `fonts.css` declares the inline FS Stencil face with `font-display: swap`, so the Proof hero's lot mark
  painted a frame in the fallback face. The console declares the face again with `font-display: block`
  (`theme/surfaces.css`, 3.7 KB inlined twice in the CSS) and starts it loading at boot on Proof's paths.
  Needed from WS-DS: `font-display: block` for the inline mark face in tokens, then the console's copy goes.
- A focus return keeps its target in view for up to 1.5 s while the layout settles (the answer that moved focus
  often moves the layout a frame later), stopped by the person's own pointer, wheel, touch or key. The in-view
  check knows the console's sticky edges by name (the drawer's head, AG Grid 35's sticky header and pinned rows,
  `[data-sticky-edge]`); a new sticky edge needs that attribute.
- fs-api's console fallback (`apps/api/src/static.ts`, `app.get("*")`) answers 404 to a real brand link: it refuses
  any path with an extension, and a signed `fsb_<payload>.<sig>` token's dot reads as one
  (`path.extname("/b/fsb_x.y")` is `.y`), so `/b/:token` never gets the console's index.html. Its test covers only
  `/b/fsb_x` (`/s/:token` has its own route, which allows the dot). Needed from WS-API: serve index.html for
  `/b/:token` whatever the token holds. Proof's face script (`/face.js`, a classic same-origin script, so
  HTML_CSP's `script-src 'self'` allows it) is served as `text/javascript` with `public, max-age=300`; nothing
  else is needed from fs-api for it.
- ui-web lacks SplitFan, FundingArc, RunStrip, RunLog, SlipViewer, FlightLayer, TwinCompare, ByHandField,
  QRPairCard, VerifyPanel, PlotField, EvalWaffle, PrintStatement, Drawer and DigitSwap: build them in your
  `features/` folder on ui-web's primitives and tokens.
