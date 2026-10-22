# Fair Split: decision register v1

Adopted 22 Oct 2026. Every section writer, subagent and workstream must follow it.

**Precedence:** user constraints, then this register, then the design direction (22 Oct), then the final architecture, then the research lenses. Anything in the design direction or the architecture that this register does not contradict still stands.

**Changes:** only through an ADR PR (`docs/adr/NNN-title.md`) that the user approves. WS-QA commits this text as `docs/decision-register.md` on day 1.

**Times:** all IST. The deadline is 12 Nov 12:00 PST, which is 13 Nov 01:30 IST.

## 1. Identity

| Item                          | Decision                                                                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                          | **Fair Split**. The first mention always adds "co-op payroll". Lockup: "Fair Split: co-op payroll"                                                                                              |
| Devpost name                  | Fair Split: audited co-op payroll on PayPal                                                                                                                                                     |
| Tagline (public)              | Claude writes in pencil. People sign in ink. PayPal makes it carbon.                                                                                                                            |
| Sub-line (Proof hero, README) | Every peso, traced to the pencil mark.                                                                                                                                                          |
| Pitch (191 chars)             | Payroll for co-ops: Claude reads handwritten weigh-slips, a deterministic engine audits every line, the treasurer and chair approve, PayPal Payouts pays each member, and the brand gets proof. |
| Engineering invariant         | The model reads paper; code computes; people approve; PayPal executes.                                                                                                                          |
| Builder motion rule           | Machines print, people press, PayPal lands.                                                                                                                                                     |
| Retired                       | "…PayPal moves the money" (CoTreasury and Supplora already use it), "5 months to 4 minutes", Kenya as the hero, "certified", "EUDR-compliant", "merged"                                         |
| Surfaces                      | Console (treasurer web, includes the Judge stage); Fair Split app (Expo: Android build plus web frames); Proof (public web)                                                                     |
| Themes                        | Tablea, dark (Console default). Adlaw, light (app default, and the only theme on Proof)                                                                                                         |
| Never used in public          | Timbang, Carbon, Sapa, Tin-aw, Pink Copy, Yellow Copy, Orihinal, Bodega Window                                                                                                                  |
| Repo                          | `fair-split`, MIT, public from the first commit, topic `paypal-ai-hackathon`. Working copy at `C:\fs\fair-split`, never on a mapped drive                                                       |

## 2. Canonical world (all synthetic)

`packages/seed` generates every figure. Screens, mocks, the README and the film read its snapshot, and `canonical.test.ts` checks every value below to the cent. Hashes are always computed, never typed; `7f3a 91c2` is only a stand-in for this document.

| Item           | Value                                                                                                                                                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Co-op          | Bulawanon Kakaw Growers MPC, Calinan, Davao City. 64 members (26 women). Dried fermented cacao. One bodega and two purok pickups                                                                                                                                                                                            |
| Officers       | Treasurer Analyn R. Sumalinog (AS, hero user). Chair Ernesto P. Cabahug (EC, co-signer). Secretary Ma. Theresa L. Gumapac (certifies the rate card). Clerk Jessie D. Dumaguing (JD), who writes every slip in blue ballpoint block capitals                                                                                 |
| Payer          | Lantern Bay Chocolate Co., Oakland. Dana Whitfield-Santos, Sourcing Director                                                                                                                                                                                                                                                |
| Season and lot | Season 2026-A (ID code `2026A`), 1 Apr–31 Aug. Lot LB-PH-2026-03: 154 jute sacks, 9,625 kg (9,240 kg Grade 1), shipped 18 Sep                                                                                                                                                                                               |
| Rate card      | BR 2026-04, ratified 14 Mar, before slip 0301. It cites the GA approval in its text. Schedule A rules R0–R4 as in design §0. The Chair co-signs any batch over US$300, any line over US$150 and any override. Mass-balance tolerance ±2.0%. Yield limit 1.6 kg per registered tree. Auto-accept at confidence 0.85 or above |
| Prices         | Premium US$0.30 per shipped kg. Bonus US$0.15 per shipped Grade-1 kg. The base price (₱185/kg, paid in cash at delivery) and the lot price (paid by wire) stay off PayPal and are never invoiced. Hauling ₱1.50/kg (R2)                                                                                                     |
| Exchange rate  | For display only: ₱62.50 per US$, fixed for each run. A peso figure is always labelled as an estimate                                                                                                                                                                                                                       |
| Invoice        | US$4,333.50 = 2,887.50 premium + 1,386.00 bonus + 60.00 disbursement (about ₱270,844)                                                                                                                                                                                                                                       |
| Evidence       | 264 slip images in 66 photos, 4 per photo: serials 0301–0563 plus one pink duplicate copy. The Judge replay set is photos A–L: 48 slips, including every hero case, all legible. The letters are IDs, not dates. Photos P01–P54 carry the earlier read events, each with its own date                                       |
| Kilos          | 9,780.6 kg verified (9,388.0 kg Grade 1). Shrink is 1.62%, or 2.05% if slip 0457 is counted twice                                                                                                                                                                                                                           |
| Lines          | Gross 4,273.50 = the pool. Ruled deductions retained by the co-op: 58.53. Credits paid by the co-op: 3.20. Net 4,218.17 = 368.39 by PayPal (8 members) + 3,849.78 in cash (56 members)                                                                                                                                      |
| Redirected     | US$21.14 = 17.94 (duplicate slip) + 3.20 (multa returned)                                                                                                                                                                                                                                                                   |
| Batch          | 8 items, US$368.39. End state: 7 members paid by PayPal (US$341.74) and 57 in cash (US$3,876.43). Proof shows "7 of 64 members, 8.1% of value"                                                                                                                                                                              |
| Fees           | Published US rate: 8 × US$0.25 = US$2.00. In production to the Philippines: 2% = US$7.37. Both fit inside the US$60.00 disbursement line                                                                                                                                                                                    |

| ID    | Member (language)                     | Rail              | kg (Grade 1)  | Net US$                          | Role in the demo                                                             |
| ----- | ------------------------------------- | ----------------- | ------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| M-014 | Consolacion "Nang Celing" Bacus (ceb) | PayPal            | 148.0 (148.0) | 64.45, about ₱4,028              | Hero line: 43.69 + 21.85 − CBU 1.09. Slips 0403 (38.45 kg), 0419, 0436, 0467 |
| M-007 | Dionisio "Nong Dioning" Lapinig (ceb) | PayPal            | 144.0         | 62.71 (80.65 with the duplicate) | H1                                                                           |
| M-060 | Arnel Sumampao (fil)                  | PayPal            | 128.5         | 55.96                            | Field 0462 entered by hand; logbook page 14, line 7 reads 64.50              |
| M-018 | Teodoro "Nong Tidoy" Pacaña (ceb)     | PayPal            | 120.4         | 55.63                            | H3: ₱200 multa returned as +3.20. Hauling ₱91.20 stays                       |
| M-039 | Jonathan Ripalda (en)                 | PayPal            | 88.0          | 38.32                            | —                                                                            |
| M-022 | Pedro "Nong Pedring" Ompad (ceb)      | PayPal            | 96.5 (80.0)   | 34.40                            | Loan −5.90 at the 50% cap; ₱31.25 carried to next season                     |
| M-002 | Florencia "Nang Ciay" Ybañez (ceb)    | PayPal            | 74.0 (60.0)   | 30.27                            | Signs with a thumbmark; audio first                                          |
| M-031 | Rhea Jumawan (en)                     | PayPal, then cash | 61.2          | 26.65                            | The unclaimed case (see C-07)                                                |
| M-053 | Merlyn Ponce (ceb)                    | Cash              | 300.0 (280.0) | 127.84, about ₱7,990             | H2: 140 trees, so she registers plot P-053-B (0.60 ha, 330 trees)            |

**Arithmetic**
- Everything is computed in integer US cents.
- Pool shares use largest-remainder rounding; ties go to the lower member number.
- Deductions round half-up per component, and caps round down.
- The generator adjusts the 55 background members until these exact lines come out.
- Peso figures are never summed.

**Seed holds, exactly these five items**
- H1, duplicate slip 0457: blocks approval.
- H2, implausible yield for M-053: blocks approval.
- H3, the unruled multa on slip 0458: reserves M-018's line only.
- Field 0462, entered by hand: blocks approval.
- One season-level check: the mass-balance dial.

Slip 0449 has an instruction written in its margin. It is quarantined and shown as a notice; it is not a hold.

## 3. Conflicts decided

Where the design direction and the architecture disagree, the decision column is final.

| ID   | Conflicting position                                                 | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-01 | Architecture G10/W11: ube violet, Inter, JetBrains Mono, Lottie, R3F | Design §2 applies in full: Tablea/Adlaw themes; jade means money, canary means a person must decide, red is only for PayPal failures; Mona Sans, Atkinson Hyperlegible Next, Big Shoulders Stencil (lot marks only). No purple, monospace, glass, Skia or WebGL                                                                                                                                                                                                            |
| C-02 | Four architecture moments and a 212-dot constellation                | Design's seven moments (§5). The two-reader agreement shows as MM-2's confidence ring plus the footer "Read twice by Claude". The constellation becomes the 64-path split fan                                                                                                                                                                                                                                                                                              |
| C-03 | 212 members, 16 photos                                               | 64 members, 66 photos, replay set A–L                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| C-04 | Lead line and a lockup with a middle dot                             | §1 applies: the design tagline leads; no middle dot in the lockup                                                                                                                                                                                                                                                                                                                                                                                                          |
| C-05 | Design says "WebSocket"                                              | SSE from `run_events` with Last-Event-ID replay. One forward-only `item.updated` event feeds every surface                                                                                                                                                                                                                                                                                                                                                                 |
| C-06 | Judge Mode replays everything (architecture)                         | All Claude output (reading, agent drafts, statements) replays by default, labelled with its recording date. PayPal calls run live by default on the replayed inputs, through the live policy lattice, in a single-flight lane with a visible queue. PayPal replay is used, labelled, only while the 429 circuit is open or `kill_paypal_live` is on                                                                                                                        |
| C-07 | Design: Rhea's item is ERRPYO002 inside the batch                    | Not possible: an ERRPYO test value rejects the whole POST. Rhea's receiver is instead an email address with no PayPal account, which gives a real UNCLAIMED. It shows as a canary "Parked" chip (no red, no thud). "Pay in cash at the bodega" cancels the item; the RETURNED status is drawn as the thread retracting, and the line moves to cash. ERRPYO005 runs as a separate 1-item batch in tests and in the What's real sheet. S4 also records how ERRPYO002 behaves |
| C-08 | Batch ID `fs:{season}:{nonce}:{digest8}`                             | Design's format (§8), built on a global runSeq. The batch digest goes in the batch note. Invariant I4 is unchanged                                                                                                                                                                                                                                                                                                                                                         |
| C-09 | A GA envelope in PHP with an exchange-rate pass                      | US cents end to end. The invoice is computed from the lot before any slip is read. PHP is display only. The GA approval is cited inside BR 2026-04, so there is one hash and no `ga_resolutions` table                                                                                                                                                                                                                                                                     |
| C-10 | Crops cut from the template grid                                     | Reviewed crop fixtures per photo are the only source of crops. Model bounding boxes feed only the eval and the live reading band                                                                                                                                                                                                                                                                                                                                           |
| C-11 | Expo web export at `/m`                                              | `/app`                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| C-12 | AG Studio gated until 1 Nov                                          | Cut now, together with its proxy, licence key and kill flag                                                                                                                                                                                                                                                                                                                                                                                                                |
| C-13 | A server-held demo key for web frames                                | The browser makes an ephemeral Ed25519 key for each judge session (`fs-ernesto-demo-{6}`), labelled "Demo key (this browser)". On native, keys live in SecureStore behind biometrics                                                                                                                                                                                                                                                                                       |
| C-14 | The film pays on PayPal's hosted invoice page                        | The film uses record-payment, labelled, exactly as Judge Mode does. The S5 hosted-page run (status PAID) goes in the README as evidence                                                                                                                                                                                                                                                                                                                                    |
| C-15 | Yield limit = plot hectares × p95 yield                              | Verified kg per registered tree must not exceed 1.6                                                                                                                                                                                                                                                                                                                                                                                                                        |
| C-16 | Injected text raises a hold                                          | In the seed it only produces a quarantine notice                                                                                                                                                                                                                                                                                                                                                                                                                           |
| C-17 | Skipping the by-hand field reserves the line                         | Unentered kilos block approval. Copy: "Skipped. Approval waits for slip 0462."                                                                                                                                                                                                                                                                                                                                                                                             |
| C-18 | Uniwind on native                                                    | React Native StyleSheet with `tokens.native.ts`. Tailwind 4 on web only                                                                                                                                                                                                                                                                                                                                                                                                    |
| C-19 | resvg renders the seal image                                         | sharp renders the seal PNG (40 KB or less)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| C-20 | `@fs/*`, `packages/tasks`, a top-level `seed/`                       | `@fairsplit/*`, `packages/outbox`, `packages/seed`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| C-21 | Batch capped at US$120                                               | Capped at US$400. At most 40 live runs a day. Alert when the sandbox balance falls below US$10k                                                                                                                                                                                                                                                                                                                                                                            |
| C-22 | Number formatting with `Intl`                                        | A deterministic formatter in `domain`                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| C-23 | Masked emails on the public Proof                                    | Public Proof shows member IDs only. The brand view adds names and masked emails                                                                                                                                                                                                                                                                                                                                                                                            |
| C-24 | A programmatic generator for eval images                             | Codex image_gen only (user constraint). A label is what is visibly written on the image, checked by a person                                                                                                                                                                                                                                                                                                                                                               |
| C-25 | Slip 0419 overwritten by clerk RB                                    | Every slip is in Jessie's hand. Overwrites, blur and rotation appear only in the eval set                                                                                                                                                                                                                                                                                                                                                                                  |
| C-26 | Replay at the recorded pace                                          | The 48 rows are compressed to 20 s or less, labelled "Replay of the {date} run, ×k"                                                                                                                                                                                                                                                                                                                                                                                        |
| C-27 | Auto-cancel on 30 Nov                                                | Invoice date + 25 days (the film take shows 30 Nov)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| C-28 | The fee line stated as fact                                          | W-TR-07 shows published rates, labelled as such. W-TR-08 shows the `payout_item_fee` PayPal reports                                                                                                                                                                                                                                                                                                                                                                        |
| C-29 | The agent's DENY as its own film beat                                | One recorded `policy.verdict` DENY row appears in the log ribbon during MM-S                                                                                                                                                                                                                                                                                                                                                                                               |
| C-30 | "The co-signer is never scripted" vs a Playwright take               | The film take is the Playwright treasurer context plus the user signing as Ernesto on a physical Android phone. The spec's Chair context runs in CI only                                                                                                                                                                                                                                                                                                                   |

## 4. Surfaces, screens, routes

These IDs are canonical; the design document's IDs are aliases.
- Test hooks: `data-testid="{screenId}.{element}"`, `data-state` and `data-moment-phase`.
- `runSlug` = `2026A-r{runSeq}`.

**Web (one Vite SPA, served from the same origin as the API)**

| ID      | Design alias | Screen                             | Route                                                                         |
| ------- | ------------ | ---------------------------------- | ----------------------------------------------------------------------------- |
| W-JG-01 | J1           | Judge stage                        | `/judge`                                                                      |
| W-AU-01 | —            | Sign in (real accounts)            | `/sign-in`                                                                    |
| W-TR-01 | C1           | Season                             | `/season/:seasonCode` (e.g. `/season/2026-A`)                                 |
| W-TR-02 | C2           | Rate card                          | `/season/:seasonCode/rate-card`                                               |
| W-TR-03 | C3           | Reading room                       | `/season/:seasonCode/reading?photo=B`                                         |
| W-TR-04 | C4           | By hand                            | `/season/:seasonCode/by-hand/:slipNo`                                         |
| W-TR-05 | C5           | Split review                       | `/runs/:runSlug/split`                                                        |
| W-TR-06 | C6           | Hold drawer                        | `/runs/:runSlug/split?hold=H1`                                                |
| W-TR-07 | C7           | Approve                            | `/runs/:runSlug/approve`                                                      |
| W-TR-08 | C8           | Run: fan-out and log               | `/runs/:runSlug/fanout`                                                       |
| W-TR-09 | C9           | Member line; 80 mm print           | `/runs/:runSlug/split?member=M-014`; `/runs/:runSlug/members/:memberNo/print` |
| W-TR-10 | C10          | Command menu, shortcuts, Data mode | Global: ⌘K, ?, D                                                              |
| W-PF-01 | P1           | Proof (public)                     | `/proof/:runSlug`                                                             |
| W-BR-01 | B1           | Proof with the brand header        | Same route, when signed in as the brand                                       |
| W-OP-01 | —            | Ops (read-only for judges)         | `/ops`                                                                        |
| W-DP-01 | —            | Design prototype (gate G1)         | `/prototype`; unlinked after G5                                               |

**Fair Split app (Expo Router; Android first, web export at `/app`)**

| ID      | Design alias | Screen                              | Route                                                           |
| ------- | ------------ | ----------------------------------- | --------------------------------------------------------------- |
| M-ON-01 | A0           | First run: language, theme, pairing | `/onboarding/language`, `/onboarding/theme`, `/onboarding/pair` |
| M-MB-01 | M1           | Bayad (statement)                   | `/(member)/bayad`                                               |
| M-MB-02 | M2           | Resibo (slips)                      | `/(member)/resibo`                                              |
| M-MB-03 | M3           | Paminawa (listen) sheet             | `/(member)/paminawa` (modal)                                    |
| M-MB-04 | M4           | Pangutana (questions)               | `/(member)/pangutana`                                           |
| M-CL-01 | K1           | Scan and outbox                     | `/(clerk)/scan`, `/(clerk)/outbox`                              |
| M-BD-01 | D1           | Co-sign request                     | `/(board)/pirma/[runSlug]`                                      |
| M-BD-02 | D2           | Sign                                | `/(board)/pirma/[runSlug]/sign`                                 |

**App navigation**
- Tabs by role:
  - Member: Bayad, Resibo, Pangutana.
  - Clerk: Scan, Outbox.
  - Board: Pirma, Bayad, Pangutana. The Bayad and Pangutana tabs reuse the member screens.
- Web entry points:
  - `/app/pair?t=` is the pairing QR (single use, 10 minutes).
  - `/s/:token` redirects to `/app/s/:token`. This is the member's link: Ed25519-signed, valid 30 days.
- The deep-link scheme is `fairsplit://`.
- iOS appears only as a 5-second simulator clip (P2).

**API commands (fs-api)**
- `/v1/*` is typed RPC, with the spec at `/openapi.json` and Scalar at `/docs`.
- PayPal webhooks arrive at `/webhooks/paypal`.
- Health checks: `/healthz` and `/readyz`.

```
POST /v1/judge/sessions                     clone seed workspace, mint frame tokens
POST /v1/runs/:runSlug/mark-paid            record_payment (labelled simulated rail)
POST /v1/holds/:holdId/resolve              POST /v1/fields/:fieldId/enter
POST /v1/rate-cards/:id/deductions          → 409 RATE_CARD_RATIFIED {hash}   (MM-4)
POST /v1/runs/:runSlug/approvals[/decline]  {role, keyId, signature, payload}
POST /v1/lines/:lineId/pay-cash | /resend   POST /v1/captures (Idempotency-Key, Content-Digest)
POST /v1/pairing, /v1/pairing/claim, /v1/presence (≤1 Hz), /v1/review-requests, /v1/flags
GET  /v1/runs/:runSlug/events (SSE)         GET /v1/workspaces/:ws/events (SSE)
GET  /v1/proof/:runSlug[.json|/export]
```

## 5. Magic moments and the film (2:50)

| ID   | Moment                             | Real trigger                                                               | Screens                                                           | Film time                                      |
| ---- | ---------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| MM-1 | Bayad na                           | Verified PAYOUTS-ITEM.SUCCEEDED for M-014                                  | M-MB-01, plus the console row and the Proof counter within 100 ms | 0:00–0:09                                      |
| MM-S | INVOICE.PAID arc (supporting beat) | Verified INVOICING.INVOICE.PAID, then a GET of the invoice                 | W-TR-01, W-JG-01                                                  | 0:20–0:32                                      |
| MM-2 | Paper prints itself                | `extract.row` events replayed from a real recorded run                     | W-TR-03                                                           | 0:32–0:44 (field 0462 entered by hand at 0:42) |
| MM-3 | The pink copy                      | H1 opened, then "Count it once" pressed                                    | W-TR-06, mass-balance dial                                        | 0:44–0:56                                      |
| MM-4 | Bolted                             | 409 `RATE_CARD_RATIFIED` citing the hash                                   | W-TR-02                                                           | 1:04–1:10                                      |
| MM-5 | Two keys                           | Last blocking hold resolved; two Ed25519 signatures                        | W-TR-07, M-BD-02                                                  | 1:10–1:24                                      |
| MM-6 | Honest fan-out                     | The 201, then verified item events, Rhea's UNCLAIMED, one resent duplicate | W-TR-08                                                           | 1:24–1:42                                      |
| MM-7 | Tap a peso                         | Nang Celing taps US$43.69                                                  | M-MB-01 (wheel zoom on W-PF-01)                                   | 2:00–2:12                                      |

**Beats between the moments**
- 0:09: title card "Fair Split: co-op payroll". Persona: Analyn. One cited figure: "Half of Filipino adults have no formal financial account (BSP, 2025)".
- 0:56: H2 and H3 resolved (flush ink stamps, no moment).
- 1:42: Dana verifies on Proof.
- 2:12: architecture map. It names Invoicing v2 via Agent Toolkit 1.11.0, the verified deduplicated webhooks, the typed Payouts tool with the PR #107 link, Claude and the engine, Render, APIMatic, the test count, and the prior art.
- 2:34: limitations said aloud, plus the live metrics.
- 2:50: end.

**Rules for every moment**
- A moment is done when it has:
  - a Playwright or Maestro assertion on `data-moment-phase`;
  - a reduced-motion version;
  - a recording from the real event.
- Anything not done by 4 Nov ships as its reduced-motion version.
- Waits are sped up and labelled "×12 real time".
- Narration is Gemini TTS, disclosed in the captions, the end card and the description.
- No product sound plays under the voice. Captions run throughout.

## 6. Monorepo and stack

```
apps/api       @fairsplit/api      Hono: /v1, SSE, /webhooks/paypal, auth, outbox dispatcher; serves console + /app
apps/console   @fairsplit/console  Vite SPA: Judge stage, Console, Proof, /ops, /prototype
apps/mobile    @fairsplit/mobile   Expo SDK 58 (member, clerk, board); web export → /app
apps/tasks     @fairsplit/tasks    Render Workflows entry + cron.ts
packages/      contracts domain seed db outbox paypal-core paypal-toolkit paypal-payouts ai eval
               api-client tokens motion seal ui-web ui-native i18n test-kit      (@fairsplit/<dir>)
media/ video/ e2e/ tools/ docs/ postman/ assets/{fonts,glyphs}/ render.yaml eas.json AGENTS.md
```

**Dependency rule** (checked by dependency-cruiser)
- `contracts ← domain ← {seed, db} ← outbox ← {paypal-*, ai} ← {apps/api, apps/tasks}`.
- UI code imports only `contracts`, `api-client`, `tokens`, `motion`, `seal`, `i18n` and `ui-*`.
- zod 3.25.76 is used only inside `paypal-*`; zod 4.6.7 everywhere else.

**Render services**
- `fs-api`: web, paid, always on.
- `fs-tasks`: workflow.
- `fs-cron`: hourly at :07.
- `fs-db`: paid Postgres.
- All in one region. Plan names are checked in spike S6.

**Changes to the architecture's pinned stack**
- **Remove:** `three`, `@react-three/*`, `lottie-react-native`, `@lottiefiles/dotlottie-react`, `@shopify/react-native-skia`, `expo-blur`, `expo-glass-effect`, `uniwind`, `lucide-react(-native)`, `recharts`, `@number-flow/react`, the shadcn CLI, `cn`, `tw-animate-css`, `sonner`, `react-native-pulsar`, `expo-widgets`, `ag-studio*`.
- **Keep:** `@base-ui/react` 1.9.0 (headless, accessible primitives) and Tailwind 4.3.3 (web layout only).
- **Add:** `expo-device`, `expo-image-manipulator`, `i18next-icu`. Pin each to an exact version on first install, choose releases at least 14 days old, and record them in `docs/versions.md`.
- **ppu-paddle-ocr 6.6.1:** used only as the eval's OCR baseline.
- **motion:** the newest 14.x release that is at least 14 days old, not 14.5.0.

## 7. Data and states

**Table conventions**
- Every table has `workspace_id`.
- Money is `bigint` cents plus `char(3)`. IDs are UUIDv7.
- `pay_runs.run_seq` comes from one global sequence that is never reset.
- Triggers block edits to a ratified card, and block `slip_rows` dated before `ratified_at`.
- The app's database role cannot UPDATE or DELETE `run_events`, `ledger_entries` or `agent_sessions`.

| Group           | Tables                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity        | `workspaces` (showcase, judge, real), Better Auth tables, `memberships`, `frame_tokens`, `pairing_tokens`, `device_keys`, `push_tokens`                                               |
| Co-op and rules | `coops`, `members`, `plots`, `seasons`, `lots`, `rate_cards`, `rate_rules`, `ratifications`                                                                                           |
| Evidence        | `documents`, `extraction_reads`, `slip_rows`, `slip_fields`, `deduction_marks`, `slip_anomalies`                                                                                      |
| Runs            | `pay_runs`, `invoices`, `member_lines`, `holds`, `approvals`, `statements`, `cash_receipts`, `review_requests`                                                                        |
| PayPal mirror   | `payout_batches`, `payout_items`, `webhook_events`, `paypal_calls` (also the rate-limiter window), `reconciliation_reports`                                                           |
| Infrastructure  | `task_outbox`, `run_events`, `ledger_entries`, `ledger_heads`, `agent_sessions`, `llm_calls`, `idempotency_keys`, `system_flags` (`kill_payouts`, `kill_paypal_live`, `kill_ai_live`) |

**Pay run**
- States: `DRAFT → QUOTED → INVOICED → FUNDED → EXTRACTING → COMPUTED → IN_REVIEW → TREASURER_APPROVED → (AWAITING_BOARD) → APPROVED → POSTING → POSTED → SETTLING → (NEEDS_FOLLOW_UP) → SETTLED → CLOSED`.
- Exit states: `CANCELLED`, `DENIED`, `HALTED`.
- The guards, and the rule that editing a line voids approvals, are as in architecture §4.

**Member line**
- `COMPUTED → READY | HELD`
- `HELD → READY | EXCLUDED`
- `READY → OFF_RAIL_DUE → OFF_RAIL_PAID`
- `READY → LOCKED → SUBMITTED → PAYPAL_PENDING → PAID | UNCLAIMED | PAYPAL_HELD | NEEDS_ACTION | REVERSED`
- `UNCLAIMED → RETURNED → OFF_RAIL_DUE | REROUTED → SUBMITTED`

**Holds**
- Kinds:
  - `DUPLICATE_SLIP`, `IMPLAUSIBLE_YIELD`, `NO_RULE`, `RATE_MISMATCH`, `SUSPECTED_INJECTION`.
  - `LOW_CONFIDENCE`, which the UI shows as "By hand".
  - `MASS_BALANCE`, which the UI shows as the dial.
- Gate: `BLOCKS_APPROVAL` or `RESERVES_LINE`.
- States: `OPEN`, `ASKED_CHAIR`, `RESOLVED`, `EXCLUDED`.

**Payout item ranks**
- PENDING 10, ONHOLD 20, UNCLAIMED 30, RETURNED 40, FAILED and BLOCKED 50, SUCCESS 60, REFUNDED and REVERSED 70.
- Event names map to statuses: SUCCEEDED→SUCCESS, HELD→ONHOLD, CANCELED→RETURNED.
- A status is applied only if its rank is higher than the current one.
- RETURNED is accepted only after our own cancel.

**Run strip (W-TR-01)**
- Ratified: the rate card is ratified.
- Funded: FUNDED or later.
- Read: COMPUTED or later.
- Checked: no blocking hold is open.
- Approved: APPROVED or later.
- Paid: SETTLED or later.

**Status words** (a raw state name is never shown)

| State          | Member copy (ceb / fil / en)                      | Console copy |
| -------------- | ------------------------------------------------- | ------------ |
| HELD           | "Gisusi pa" / "Sinusuri pa po" / "Still checking" | —            |
| PAYPAL_PENDING | "Gipadala na, naghulat sa PayPal"                 | —            |
| PAID           | "Bayad na"                                        | —            |
| OFF_RAIL_DUE   | "Andam sa bodega"                                 | —            |
| OFF_RAIL_PAID  | "Nadawat"                                         | —            |
| UNCLAIMED      | "Wala madawat sa PayPal"                          | "Parked"     |

## 8. PayPal contract

**Sandbox accounts (spike S1, done by the user)**
- Every account is created with Country = United States, and every amount is in USD.
- One business account plays the co-op. It is both the invoicer and the payout sender, with a US$100,000 balance (or the maximum the form allows). `invoicer_email_address` is this account's email.
- Personal accounts:
  - seven on-rail members;
  - one Lantern Bay payer.
- Rhea's address belongs to no PayPal account.
- REST apps:
  - `fs-dev` (behind a Cloudflare tunnel);
  - `fs-judge` (on Render).
  - Both have Transaction Search ticked.
- Webhooks are registered per app by `tools/setup-webhooks.ts`.

| Surface                                           | Calls                                                                                                                                                                                                                                | Who may call                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| OAuth                                             | `POST /v1/oauth2/token`: one shared token cache, refreshed 5 minutes before expiry, scope checked at boot                                                                                                                            | Server                                |
| Invoicing v2, through Agent Toolkit 1.11.0 `tk()` | `create_invoice`; `send_invoice` with send_to_recipient false (needs Analyn's approval); `create_conditional_rules_for_invoice` (AUTO_CANCEL with SPECIFIC_DATE, request ID `cr-{invoiceId}`); `get_invoice`                         | Agent and server                      |
|                                                   | `record_payment_for_invoice`; the invoice search (to adopt a duplicate number)                                                                                                                                                       | Server only                           |
| Payouts v1, our typed tool with PR #107's names   | `create_payout_batch` (`POST /v1/payments/payouts`); `cancel_unclaimed_payout_item` (`POST /v1/payments/payouts-item/{id}/cancel`)                                                                                                   | Server only, through `PayoutsService` |
|                                                   | `get_payout_batch` (`GET …/payouts/{id}`); `get_payout_item` (`GET …/payouts-item/{id}`)                                                                                                                                             | Agent (read only) and server          |
| Webhooks v1                                       | List, create, patch; `webhooks-lookup`; `verify-webhook-signature` (once per live run, for the on-screen badge); `webhooks-events?start_time=` (catch-up); `webhooks-events/{id}/resend` (once per live run, for the duplicate beat) | Server                                |
| Transaction Search                                | `TransactionSearchController` from `@paypal/paypal-server-sdk` 2.5.0, run nightly and labelled as lagging                                                                                                                            | Server                                |

**Webhook events subscribed**
- `INVOICING.INVOICE.{PAID,CANCELLED,UPDATED,REFUNDED}`
- `PAYMENT.PAYOUTSBATCH.{PROCESSING,SUCCESS,DENIED}`
- `PAYMENT.PAYOUTS-ITEM.{SUCCEEDED,UNCLAIMED,FAILED,RETURNED,CANCELED,BLOCKED,HELD,REFUNDED}`

`generateQRC` is dropped from the allowlist, because no screen shows an invoice QR.

| Field             | Format                                                                                                                               | Example                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| invoice_number    | `FS-{runSlug}`                                                                                                                       | `FS-2026A-r37`            |
| reference / note  | `rc:{rateCardSha16}` / "Season 2026-A, RC 7f3a 91c2, lot LB-PH-2026-03" (the design's "memo")                                        | —                         |
| sender_batch_id   | `{season}-{rc8}-r{runSeq}`; a re-route adds `-x{n}`                                                                                  | `2026A-7f3a91c2-r37`      |
| Batch note        | "Fair Split 2026-A, batch {digest8}"                                                                                                 | —                         |
| sender_item_id    | `r{runSeq}-{memberNo}`; a re-route uses `r{runSeq}x{n}-{memberNo}`                                                                   | `r37-M-014`               |
| PayPal-Request-Id | sha256(sender_batch_id)                                                                                                              | —                         |
| batchSha256       | sha256 of JCS{runId, senderBatchId, rateCardSha256, items sorted by senderItemId: [{senderItemId, receiver, amountCents, currency}]} | The seal is grown from it |
| Signed payload    | JCS{v, runId, seasonId, rateCardSha256, batchSha256, itemCount, totalCents, currency, role, approverId, nonce, exp}                  | Key ID `fs-ernesto-a1`    |

**Rules**
- **Funding.** A run becomes FUNDED only when a fresh GET shows PAID or MARKED_AS_PAID with 0.00 due. If no webhook arrives, a GET after 60 s is the fallback.
- **Posting.** Batch and item rows are written as SUBMITTED before the POST.
  - On a 5xx or a timeout, retry three times with the same ID.
  - On a 400 "already exists", adopt the original batch through its HATEOAS link.
- **Webhooks.**
  - Every webhook is verified by us: CRC32 of the raw body, RSA-SHA256, and a cert host on the allowlist.
  - Each is stored with `ON CONFLICT (paypal_event_id) DO NOTHING`, and we return 200 immediately.
  - Any non-success status is checked with a fresh GET before it changes state.
- **Rate limits.**
  - A Postgres limiter allows 40 calls a minute across all services.
  - A 429 opens a 6-minute circuit, during which PayPal steps fall back to labelled replay.
  - We never poll.
- **Cost of a live Judge run: about 11 calls.**
  - At session start: invoice create, send, rule.
  - Record payment, then GET the invoice.
  - POST the batch.
  - GET Rhea's item, then cancel it.
  - GET the batch after PAYOUTSBATCH.SUCCESS.
  - One resend, and one postback verify.
- **Upstream (the user posts by 5 Nov):**
  - sandbox evidence on PR #107 (UNCLAIMED, cancel, RETURNED, with the webhook mapping);
  - a small PR fixing the toolkit's token expiry, with a jest test;
  - an issue about the ai@4 temperature incompatibility.
  - Never write "merged".

## 9. AI components

| ID    | Component                                                                | Model                                                     | Effort                    | Output                                                                                                        | Gate                                                                                                                          |
| ----- | ------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| AI-1  | Slip read A                                                              | claude-opus-5-5                                           | low                       | `Extraction` schema: bounding box first, no amount or instruction fields                                      | `stop_reason` must be end_turn; otherwise a person handles it                                                                 |
| AI-2  | Slip read B (greyscale + CLAHE image, a prompt that reads tokens first)  | claude-opus-5-5                                           | low                       | Same schema                                                                                                   | Agreement scored in code: 0.97 / 0.88 / 0.60 when overwritten / 0.40 triggers a zoom / 0.80 / 0. Auto-accept at 0.85 or above |
| AI-3  | Zoom re-read                                                             | claude-opus-5-5                                           | medium                    | One field and a tighter box                                                                                   | At 0.80, one tap from a person confirms it                                                                                    |
| AI-4  | Injection screen                                                         | claude-haiku-5-5                                          | —                         | `{injection_suspected}`; a refusal counts as suspected                                                        | Text is quarantined                                                                                                           |
| AI-5  | Rate-card reader                                                         | claude-opus-5-5                                           | medium                    | Rules with verbatim quotes                                                                                    | Each quote must appear in the text layer; values are re-parsed; the board ratifies                                            |
| AI-6  | Deduction classifier                                                     | claude-sonnet-5-5                                         | low                       | A ratified rule ID or NO_MATCH                                                                                | NO_MATCH, or an amount that doesn't match the rule, raises a hold                                                             |
| AI-7  | Audit agent                                                              | claude-opus-5-5                                           | medium, adaptive thinking | Drafts the invoice, investigates holds, `propose_resolution`, `request_payout_batch` (only opens an approval) | Policy lattice; it has no tool that moves money                                                                               |
| AI-8  | Explainer: member statements, "Claude's line" on hold cards, SMS preview | claude-opus-5-5                                           | low                       | Words plus `{{PLACEHOLDERS}}`                                                                                 | Any digit, a wrong set of placeholders, or an SMS over 160 GSM-7 characters means it is regenerated                           |
| AI-9  | Language check                                                           | claude-haiku-5-5                                          | —                         | Language ID                                                                                                   | A mismatch means it is regenerated                                                                                            |
| AI-10 | Voice (offline, `tools/tts.ts`)                                          | gemini-3.8-flash-tts; drafts on gemini-3.8-flash-lite-tts | —                         | One clip per sentence, AAC 32 kbps mono                                                                       | Labelled as a synthetic voice                                                                                                 |
| AI-11 | Images (offline)                                                         | OpenAI's image model through the user's Codex CLI         | —                         | One image per `codex exec`, and the output file is checked each time                                          | Labels and crop fixtures checked by a person                                                                                  |

claude-fable-5-1 has no role.

**ClaudeGateway** is the only way any code reaches Claude.
- **Replay cache key:** sha256 of {imageSha, variant, promptV, schemaV, model, effort}.
- **Controls:** a daily spend cap and the `kill_ai_live` flag.
- **Logging:** it records `model_served`.
- **Request rules:**
  - always sets effort;
  - never sends sampling parameters, `budget_tokens`, disabled thinking or a forced `tool_choice`.

**Policy lattice.** The verdict is the maximum over all policies, so adding a policy can only make it stricter. The policies are:
- `killSwitch`, `sandboxOnly`, `allowlist`, `phaseGate`, `budgetCap`;
- `invoiceEqualsQuote`, `invoicerIsBusinessEmail`, `recipientInBrandAllowlist`, `referenceCarriesHash`, `dueWithin30Days`;
- `sendNeedsTreasurer`.

**Eval**
- 40 labelled cases, all generated with Codex, using the mix in architecture §14.
- Baseline: an OCR-only pipeline (PP-OCRv5).
- Pass bars:
  - exact-row rate 0.85 or higher;
  - zero unsafe auto-accepts;
  - injection catch rate 1.0;
  - duplicate F1 0.9 or higher.
- Replay runs on every PR; a live run happens nightly under a US$3 cap.
- The in-product waffle (40 cells) reads `eval/report/latest.json`.

**Audio**
- **Request plan.** One TTS request per member and language, with pause markers, split into sentence clips on the dev machine.
- **Order:**
  1. M-014 in all three languages.
  2. Each other PayPal hero member in their own language.
  3. Everything else.
- **Quota.** Use one Google project and never rotate keys.
- **Fallback.** If a clip is missing, the app uses device text-to-speech and labels it.

## 10. Prize targets

| Slot                             | Target                                                                  | What must be on screen                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Grand prize                      | Aim for 1st; 2nd or 3rd is the realistic stretch                        | Spare days go to Technological Implementation (tie-break #1)                                                                                     |
| Honorable, named on Devpost      | Most Impactful                                                          | MM-1 cold open, the BSP figure, the PayPal-vs-cash metric, Cebuano audio, Proof                                                                  |
| Honorable fallbacks, never named | Best Use of PayPal + AI; Best Demo Delivery                             | —                                                                                                                                                |
| Primary sponsor                  | APIMatic                                                                | Context Plugin installed; Transaction Search through the server SDK; `docs/apimatic-context-plugin.md` with at least 3 dated fixes; a screenshot |
| Also entered                     | AG Grid                                                                 | Community grid themed from our tokens, custom cell renderers, cells flashing on webhooks; a README section; a 10–15 s video segment              |
| Render                           | Blueprint and Workflows; enter its prize only per OD-6                  | —                                                                                                                                                |
| Shipped, no prize                | A Postman collection with tests                                         | —                                                                                                                                                |
| Not targeted                     | Bryntum, Channel3, Elastic, Best Use of Agentic Commerce, Most Creative | —                                                                                                                                                |

**Prior art**
- **README table, ten entries:** Supplora Pay, TipPool, PayFlow, Solar Co-op, CoTreasury, Routewell, 555 Buku, Clause-to-Cash, Tributary, SarafuPay/harambee.
- **The film names four:** Clause-to-Cash, Tributary, SarafuPay and harambee. It follows with: "They split money people already agreed on. Fair Split turns paper into ratified rules and rows, binds the treasurer to a hashed rate card, and proves each payment on the member's phone and the brand's Proof."

**Devpost page**
- **Opening.** The first 300 characters name:
  - Invoicing v2 through Agent Toolkit 1.11.0, Payouts v1 and Webhooks;
  - the three Claude model IDs.
- **Tags.** Use `vite`, never `nextjs` or `ag-studio`.
- **AI tools listed:**
  - claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5;
  - Claude Code;
  - OpenAI's image model through Codex CLI;
  - Gemini 3.8 Flash TTS;
  - the APIMatic Context Plugin;
  - the PayPal AI-Toolkit plugin.

## 11. Workstreams and interface contracts

| WS         | Owned paths                                                                                         | Ready at G2 (29 Oct)                                                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WS-CORE    | `packages/{contracts,domain,seed}`                                                                  | Contracts frozen 24 Oct. Engine, state machines, policy lattice, digests, formatter, `verifyChain`. Seed passes `canonical.test.ts`. Property tests for I1–I8 |
| WS-DATA    | `packages/{db,outbox}`                                                                              | Schema and triggers, ledger chain, outbox with the inline executor, rate limiter, LISTEN bus                                                                  |
| WS-PPCORE  | `packages/paypal-core`, `apps/api/src/webhooks/**`, `tools/setup-webhooks.ts`                       | Token cache, PayPalHttp, webhook self-verification, webhook route, catch-up                                                                                   |
| WS-PPMONEY | `packages/{paypal-toolkit,paypal-payouts}`                                                          | Invoice chain with adopt; PayoutsService with adopt, cancel and re-route; allowlist contract test                                                             |
| WS-READ    | `packages/ai/src/{gateway,read,ratecard,classify}/**`, `packages/eval`                              | Reads A and B, agreement score, zoom, injection screen, replay cache, eval                                                                                    |
| WS-AGENT   | `packages/ai/src/{agent,explain}/**`                                                                | Tool runner behind the lattice; statements with placeholders; hold lines                                                                                      |
| WS-API     | `apps/api/**` except webhooks, `packages/api-client`                                                | Routes, SSE, auth, frame and pairing tokens, Judge workspace clone, live lane, presence                                                                       |
| WS-OPS     | `apps/tasks`, `render.yaml`, `tools/**` (except paths owned elsewhere)                              | Workflows executor, `judgeReset`, `reconcile`, `warmCaches`, health checks                                                                                    |
| WS-DS      | `packages/{tokens,motion,seal,ui-web,ui-native,i18n}`, `assets/**`, `apps/console/src/prototype/**` | Tokens with contrast checks in CI, the five primitives on web and native, seal, sound and haptics, glyphs, prototype                                          |
| WS-CONSOLE | `apps/console/**` except the prototype                                                              | Judge stage, W-TR-01 to W-TR-10, Proof, /ops                                                                                                                  |
| WS-APP     | `apps/mobile/**`, `eas.json`                                                                        | Pairing, member statement with audio, clerk capture with offline outbox, board co-sign, push, APK                                                             |
| WS-QA      | `.github/**`, `packages/test-kit`, `e2e/**`, `postman/**`, `docs/**`, README and repo hygiene files | CI green, msw handlers, two-context spec, Maestro flows, ownership check, README skeleton                                                                     |
| WS-MEDIA   | `media/**`, `video/**`, `tools/{tts,imagegen}.ts`                                                   | Photos A–L with reviewed fixtures, BR 2026-04 pages, logbook page 14, eval images. Audio by 5 Nov; film from 7 Nov                                            |

**Interface contracts (IC)**
- **IC-01 Contracts** (WS-CORE to everyone; frozen 24 Oct at 18:00).
  - zod 4 DTOs, error codes, en/ceb/fil label maps, screen-ID and route constants.
  - `RunEvent` types:
    - run and line: `run.state`, `line.state`, `item.updated`;
    - holds and fields: `hold.raised`, `hold.resolved`, `field.entered`;
    - reading: `extract.row`, `extract.field`, `extract.quarantined`;
    - approvals and presence: `approval.signed`, `approval.declined`, `presence`;
    - PayPal and invoices: `webhook.received`, `invoice.state`;
    - agent and system: `policy.verdict`, `agent.delta`, `capture.synced`, `flag.changed`.
  - `TaskName` registry, each entry giving its arguments and idempotency key:
    - PayPal: `ensureInvoice`, `recordPayment`, `processWebhook`, `postPayoutBatch`, `settleBatch`, `cancelUnclaimed`, `reroute`;
    - AI and engine: `extract`, `readRateCard`, `computeRun`, `explain`, `agentTurn`;
    - system: `pushNotify`, `reconcile`, `judgeReset`, `warmCaches`.
- **IC-02 Domain:** `quoteInvoice(card, lot)`, `computeLines(...) → {lines, holds, conservation}`, `agreement(a, b, zoom?)`, `batchDigest(run, items)`, `fsm.run|line|item`, `decide(call, ctx)`, `verifyChain(proof)`, `format.*`.
- **IC-03 Seed:** `packages/seed/snapshot/season-2026A.json`. No one hard-codes a figure.
- **IC-04 Persistence:** scoped repositories; `enqueue(tx, name, args, dedupeKey)`; `appendEvent(tx, event)` (notifies on commit); `ledger.append`; `limiter.take`; `bus.subscribe`; the executor `run(name, ids)` (inline, workflow or worker).
- **IC-05 PayPal core:** `PayPalAuth.token()`; `PayPalHttp.request()` returning a result union that includes `debugId`; `verifyPayPal(raw, headers, webhookId)` returning `self`, `postback`, `dev_mock` or false; `toItemStatus()`.
- **IC-06 Money:** `tk(method, args, requestId?)`, `agentToolSchemas()`, `Invoices.ensureForRun` and `Invoices.recordPayment`, `PayoutsService.executeApproved`, `.cancelUnclaimed`, `.reroute`.
- **IC-07 AI:** `ClaudeGateway.call`, the `Extraction` schema, `extract`, `readRateCard`, `classifyDeduction`, `explain(lineId, lang) → {sentences[{id, text, placeholders}]}`, `narrateHold`, `agentTurn`.
- **IC-08 HTTP and realtime:** OpenAPI generated from the contracts; SSE with Last-Event-ID; `api-client.subscribe(scope, onEvent)` plus TanStack Query hooks; 2-hour bearer frame tokens.
- **IC-09 Design system:**
  - `--fs-*` variables under `[data-theme]`, plus `tokens.native.ts`.
  - AG Grid `themeQuartz.withParams`.
  - Material 3 roles: primary is ink, and jade has no role.
  - Primitives: `Slab`, `Print`, `Seal`, `ReceiptBar`, `HoldCard`, with the props in design §5.
  - Motion presets, `feedback.play(event)` and the glyph set.
- **IC-10 Moments:** `packages/motion/moments.ts` lists each moment's phases. Frozen 27 Oct.
- **IC-11 Media:**
  - `media/photos/{A..L,P01..P54}.webp`, 1,600 px.
  - `media/fixtures/{photo}.json`: slip number, copy colour, and a rectangle for each field.
  - `media/eval/` images, with `labels/*.json`.
  - `media/audio/manifest.json`.

**How workstreams operate**
- One worktree and one branch per workstream.
- A PR touches only its owned paths; CI checks this against `docs/ownership.md`.
- Every PR carries tests.
- UI workstreams build against the seed snapshot and msw mocks from day 2.
- The user merges daily.

**Steps only the user can do**
- Spikes S1 and S5.
- Every secret and credential: Render, Anthropic, Gemini, EAS, Firebase/FCM.
- The G1 sign-off.
- Checking image labels.
- Posting upstream.
- YouTube and Devpost.

## 12. Spikes, milestones and gates

| Spike (memo #)          | Owner                           | Must pass by 24 Oct                                                                                                                                                          | If it fails                                                                                  |
| ----------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| S1 Sandbox (1)          | User                            | Accounts and apps as in §8; webhooks registered                                                                                                                              | Recreate the account; never use an India-country account                                     |
| S2 Invoice chain (2, 4) | WS-PPMONEY                      | The toolkit's `/openai` schemas are accepted on claude-opus-5-5. Then: create, send, AUTO_CANCEL rule, get, record payment, verified INVOICE.PAID                            | No event: a 60 s GET becomes the trigger. Schemas rejected: convert the `/mcp` zod schemas   |
| S3 Extraction (5)       | WS-READ, with the user's labels | 10 hero slips: exact-row rate 0.85 or higher, zero unsafe accepts; at least 95% of box centres fall inside the true box                                                      | Poor boxes: add PP-OCR snapping. Rows below 0.70 after a day of prompting: G0 kill rule      |
| S4 Payouts (3)          | WS-PPMONEY                      | 201, then a verified SUCCEEDED. An address with no account gives UNCLAIMED, then cancel, then RETURNED. ERRPYO005 is rejected synchronously. ERRPYO002's behaviour is logged | A 403 that survives a fresh account: G0 kill rule. No UNCLAIMED: use a labelled recorded run |
| S5 Hosted-page payment  | User, with WS-PPCORE            | The payer pays `recipient_view_url`; the PAID webhook arrives; postback verify returns SUCCESS                                                                               | Rely on the 60 s GET                                                                         |
| S6 Render               | WS-OPS                          | Blueprint deploys; `startTask` p50 is 10 s or less                                                                                                                           | Set `executor=worker`                                                                        |
| S7 Expo SDK 58          | WS-APP                          | Dev build works. `scanDocumentAsync` works. SSE works over `expo/fetch`. The web export serves at `/app`. The slab runs at 60 fps on a 2 GB device. The EAS APK is signed    | By 25 Oct: SDK 57 plus a scanner plugin; serve `/app` from a separate static site            |
| S8 Type                 | WS-DS                           | Both Mona Sans and Atkinson Next have ₱ and a slashed zero; four static native cuts work                                                                                     | A Noto subset that covers only ₱                                                             |
| S9 Auth                 | WS-API                          | Better Auth generates its Drizzle schema                                                                                                                                     | Write the auth schema by hand                                                                |
| S10 Voice               | WS-MEDIA                        | Gemini TTS speaks Cebuano on the free tier; quota measured                                                                                                                   | Filipino audio with Cebuano text, labelled                                                   |
| S11 Backup (6)          | WS-PPMONEY                      | ShiftPay's Vault AUTHORIZE, 2 hours                                                                                                                                          | Run it only if S3 is below 0.80 on 23 Oct                                                    |

**G0 pass:** S1–S4 are green, and the memo's end-to-end checkpoint passes: invoice, verified PAID, payout, verified SUCCEEDED.

**G0 kill rules**
- A 403 that survives a fresh account stops both products. File an MTS ticket; the user decides.
- An exact-row rate below 0.70 after a day of prompting switches the build to ShiftPay, if S11 passed. If S11 did not pass, the user chooses between a Fair Split that puts human entry first, or stopping.

| Date       | Milestone                                                                                                                                                                                                                                              | Gate   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Thu 22 Oct | Register adopted; repo and CI skeleton; S1 starts; contracts drafted; 10 hero slips and the BR 2026-04 pages generated                                                                                                                                 | —      |
| Fri 23 Oct | S2–S10 run; the user checks the 10 slip labels                                                                                                                                                                                                         | —      |
| Sat 24 Oct | Spike verdicts. Contracts, task registry, event catalogue and seed snapshot frozen at 18:00. Tokens, five primitives, signed APK                                                                                                                       | **G0** |
| Sun 25 Oct | Prototype delivered on `/prototype` and the APK (contents below)                                                                                                                                                                                       | —      |
| Mon 26 Oct | The user signs off the prototype by 18:00. One revision round closes Tue 27 Oct at 18:00. Until sign-off, UI workstreams build only routes, data and states, on the primitives                                                                         | **G1** |
| Thu 29 Oct | Minimum lovable demo (MLD): the hosted loop works end to end, without the moments. Judge Mode posts the 8-item batch, Rhea's item parks, and Reset works. The APK pairs by QR. The real Claude run for replay is recorded. A 2-minute rough cut exists | **G2** |
| Fri 30 Oct | Release APK smoke test (R8); a 24-hour Judge soak with hourly resets begins                                                                                                                                                                            | —      |
| Sun 1 Nov  | The 40-case eval is green against the OCR baseline; Android p95 is 55 fps or higher; statement texts are frozen for native review; 100+ tests                                                                                                          | **G3** |
| Wed 4 Nov  | All seven moments have assertions; any unfinished moment ships in its reduced-motion version                                                                                                                                                           | **G4** |
| Thu 5 Nov  | Devpost draft submitted (for the eligibility pre-check); upstream posts made; deadline for the pilot quote and native review; audio done                                                                                                               | —      |
| Fri 6 Nov  | Design and feature freeze; TalkBack, 200% text and axe passes; film takes recorded                                                                                                                                                                     | **G5** |
| 7–8 Nov    | HyperFrames assembly; final narration; mix to −14 LUFS                                                                                                                                                                                                 | —      |
| Mon 9 Nov  | YouTube video public, with captions and chapters; the Devpost embed checked while logged out                                                                                                                                                           | **G6** |
| Tue 10 Nov | README: sandbox IDs, real vs simulated, prior art. Devpost final                                                                                                                                                                                       | Buffer |
| Wed 11 Nov | Verify from a clean clone; submit                                                                                                                                                                                                                      | **G7** |
| Thu 12 Nov | Buffer only; deadline 12:00 PST                                                                                                                                                                                                                        | —      |
| 1–15 Dec   | Deploy freeze; hourly checks of health, sandbox balance and webhook registration                                                                                                                                                                       | —      |

**G1 prototype contents (Sun 25 Oct)**
- A token sheet in both themes, with the contrast results.
- The five primitives in every state, including reduced motion.
- Static compositions on seed data:
  - W-JG-01;
  - W-TR-05 and W-TR-06 (H1);
  - W-TR-07 (ready, and with key 1 signed);
  - M-MB-01 (sent, and paid);
  - W-PF-01.
- Motion studies of MM-5 and MM-1.

**Other schedule rules**
- **Competitor re-scans:** WS-QA re-scans on 26 Oct, 2 Nov and 9 Nov.
- **Cut order if G2 or G4 slips**, first to last:
  1. iOS clip.
  2. HapticTrace.
  3. Native push (the frames keep their labelled banner).
  4. Clerk background sync.
  5. Brand header.
  6. Wheel zoom on Proof.
- **Never cut:**
  - the PayPal chain;
  - the holds and the by-hand field;
  - two keys with the I4 refusal;
  - the statement with audio;
  - Proof verify;
  - Judge reset;
  - the tests.

## 13. Open decisions

If the user is silent by the date, the default applies.

| ID    | Question                                                                 | Default                                                                                         | Decide by |
| ----- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | --------- |
| OD-1  | A real pilot voice                                                       | None. Label the persona "hypothetical, synthetic data"                                          | 5 Nov     |
| OD-2  | A native Cebuano and Filipino reviewer                                   | Ship with "machine-translated, pending native review" chips, visible on camera too              | 5 Nov     |
| OD-3  | Slips written with a real pen, or programmatically generated eval images | No. All images come from Codex and are disclosed                                                | 29 Oct    |
| OD-4  | Codex quota runs short for photos P01–P54                                | Show a hatched "archived photo" tile with the read date                                         | 31 Oct    |
| OD-5  | A short line in the film in the user's own voice                         | No                                                                                              | 5 Nov     |
| OD-6  | Enter Render's credits prize                                             | Only if the organizers confirm the higher-value award wins                                      | 5 Nov     |
| OD-7  | Join the Apple Developer Program                                         | No. iOS appears only as a 5 s simulator clip (P2)                                               | —         |
| OD-8  | Custom domain                                                            | No. One `onrender.com` origin                                                                   | 29 Oct    |
| OD-9  | Move to @anthropic-ai/sdk 1.0.0                                          | No; stay on 0.137.0                                                                             | —         |
| OD-10 | Who pays for Fair Split                                                  | In production, the brand pays a per-run audit fee. Mentioned only in the README's "What's next" | 5 Nov     |
| OD-11 | Email domain for the unclaimed receiver                                  | Whatever S4 shows works                                                                         | 24 Oct    |

Sources read: `Z:\Projects\Paypal\research\round2\memo.md`, `Z:\Projects\Paypal\research\round2\facts-readable.txt`, `Z:\Projects\Paypal\research\round2\judge-model.json`, `Z:\Projects\Paypal\research\round2\candidates.json`, `Z:\Projects\Paypal\research\deep-summaries.md`.
