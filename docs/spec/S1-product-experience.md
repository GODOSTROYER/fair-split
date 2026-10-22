## S1. Product and Experience

_Precedence: Decision Register, then Design Direction, then Final Architecture (all 22 Oct). Every figure comes from the seed snapshot (`packages/seed/snapshot/season-2026A.json`, IC-03). Screens render figures from data and never hard-code them. `7f3a 91c2` stands for the rate-card hash prefix and `r37` for the run sequence. All Cebuano (ceb) and Filipino (fil) strings are machine translations until a native reviewer signs them off (S1.13)._

### S1.1 Product narrative

Fair Split is co-op payroll. A brand that buys a co-op's cacao pays one PayPal invoice for an audited pay run. Claude reads the season's handwritten weigh-slips and the Board's rate card into typed rows and rules. A deterministic engine then computes every member's line and holds any line it cannot justify. The treasurer resolves the holds and approves, and the Chair co-signs any batch over US$300. Our typed Payouts tool posts the batch, and verified item webhooks flip each statement to paid. Members can read or hear why their number is their number. The brand re-verifies every line, PayPal or cash, in its own browser.

**Hero season (synthetic).** Bulawanon Kakaw Growers MPC (Calinan, Davao City, 64 members) shipped lot LB-PH-2026-03 (9,625 kg of dried cacao) to Lantern Bay Chocolate Co. (Oakland). The lot price is paid by wire. Invoice FS-2026A-r37, US$4,333.50, has three lines:
- "Member premium, Season 2026-A": 9,625 kg × US$0.30 = US$2,887.50
- "Quality bonus, Grade 1": 9,240 kg × US$0.15 = US$1,386.00
- "Co-op disbursement cost (PayPal fees)": US$60.00

**Who pays, and why PayPal.** The brand pays. The co-op is the merchant of record and the payout sender, using its own PayPal account. Fair Split is software and never holds, pools or converts funds. Fair Split bills its per-run audit fee to the brand on a separate invoice (the price is decided in OD-10). PayPal lists the Philippines as "send, receive, and withdraw in local currency" for Payouts [S1-6]. Verified Philippine accounts can move a PayPal balance into GCash, with a ₱500 minimum and a 1% GCash fee since 7 Mar 2026 [S1-7][S1-8].

**Why each side cares.**
- _Brand._ Buyers' evidence rules now reach down to each member.
  - Fairtrade's cocoa standard requires co-ops in Côte d'Ivoire and Ghana to tell members their amounts before payment, give receipts and reconcile each season (4.3.4), and to record payments digitally (4.3.5). From 1 Oct 2026 they must also pay at least 40% of the Premium in cash (4.6.2). No actor may deduct from the Premium [S1-1][S1-2].
  - The voluntary Fairer Futures Standard (v1.0, 15 Oct 2026) sends 100% of the living-income differential to members with no cost deductions (3.2.1). It must be paid by auditable mobile payment by October 2027 (3.2.2) [S1-3].
  - None of this binds a Philippine co-op. It shows where buyers are heading, and rule R0 mirrors it.
  - Lantern Bay also sells in the EU through a distributor. Unproven sustainability claims are banned there from 27 Sep 2026 [S1-4], so Dana may say "benchmarked to", never "certified".
- _Market._ The Philippines had 20,752 co-ops in 2023, of which 2,616 are agricultural and 774 are agrarian-reform co-ops (CDA data) [S1-5].
- _Treasurer._ She is bonded (RA 9520 Art. 56) [S1-9]. The rules she cannot bend are the same rules nobody can bend against her.
- _Members._ Statements lead with money, then audio, then the clerk's own handwriting, for three reasons:
  - Half of Filipino adults had a formal account in 2025 (BSP CFIS, age 15+) [S1-10].
  - Functional literacy in Davao Region is 66.7% (PSA FLEMMS 2024) [S1-11].
  - Davao grows 71.2% of Philippine cacao (PSA, Q2 2023) [S1-12].

**Line and name.**
- The public line: "Claude writes in pencil. People sign in ink. Only PayPal says paid."
- The rule for builders: machines print, people press, PayPal lands.
- The name always carries its qualifier, "Fair Split: co-op payroll", on the title card, top bar, Proof, Devpost and YouTube. devpost.com/software/fair-split is already a Stripe expense splitter [S1-18].
- The thumbnail has three panels: a handwritten slip, its audited line, and "Bayad na".

**How it differs.** These are the nearest similar projects, checked 22 Oct:
- Supplora Pay: Claude reads supplier invoices and holds a duplicate and an injected lookalike; one Payouts batch goes out after the owner approves [S1-13].
- Clause-to-Cash: cited contract terms become a Guard [S1-14].
- Tributary: deal terms are hashed and statements are checked against its engine [S1-15].
- SarafuPay: group collections in WhatsApp [S1-16].
- harambee: holds for group trips [S1-17].

The contrast sentence goes in the README, Devpost and the film, never on Proof: "Supplora Pay, Clause-to-Cash and Tributary protect the payer or a contract's parties. Fair Split protects 64 farmers who have had no way to check their own pay, and lets the brand that funded them verify every line, PayPal or cash." The slip-0449 injection stays an eval case, not a marketing beat.

**Three truths the screen shows without words.**
- The model never writes a number into a payout. Machine output is flat pencil print with a provenance footer and never gets a button.
- Rules are fixed before any facts arrive. BR 2026-04 was hashed on 14 Mar 2026, and any edit gets 409 `RATE_CARD_RATIFIED` citing the hash.
- Money lands only when PayPal says so. Approved amounts stay hollow, and jade appears only after a verified item webhook.

### S1.2 Personas

| Persona (hypothetical, synthetic)               | Surface                                    | Must be able to                                                                            | Must never feel                              |
| ----------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------- |
| **Analyn R. Sumalinog (AS)**, Treasurer         | Console                                    | Defend the run: 64 of 64 lines explained                                                   | Blamed, or rushed into the irreversible step |
| **Ernesto P. Cabahug (EC)**, Chairperson        | App (board)                                | Co-sign batches over US$300, lines over US$150, and overrides; compare the seal by eye     | Like a rubber stamp                          |
| **Jessie D. Dumaguing (JD)**, clerk             | App (clerk); the bodega laptop on cash day | Send every slip; attest cash with a photo of the "Nadawat" box                             | Blamed for a hold                            |
| **Nang Celing** (Consolacion Bacus, M-014), ceb | App (member)                               | Know what she got, why, and from which slips; choose to listen first                       | Surprised by kaltas, PayPal's included       |
| **Rhea Jumawan** (M-031), en                    | App (member)                               | Get paid even though her address has no PayPal account                                     | That the money vanished                      |
| **Merlyn Ponce** (M-053), paid in cash          | 80 mm print                                | Collect exactly ₱7,990.00; sign or thumbmark "Nadawat"                                     | Accused over a big harvest                   |
| **Dana Whitfield-Santos**, Lantern Bay          | Proof                                      | See six checks read "Matches" in her own browser                                           | Exposed by a claim she cannot evidence       |
| **A judge**                                     | `/judge` at 1470 × 956, or a phone         | Understand it in 3 s; see sandbox IDs within 10 s; co-sign; reset; or use "Play it for me" | That it is staged                            |

### S1.3 Scope

**Hero path.** Only these screens get bespoke motion, the S1.10 moments and the critique gate:
- W-JG-01
- W-TR-01, W-TR-02 (MM-4 only), W-TR-03, W-TR-04
- W-TR-05 (the dial and cell washes only), W-TR-06, W-TR-07, W-TR-08
- W-PF-01
- M-MB-01, M-BD-02

Every other screen uses the five primitives with preset transitions. Data mode is plain tables.

**Cut, and what replaces each item:**
- The Ctrl+K command menu and the theme switch. The console uses Tablea only.
- Everything on W-PF-02 except the invoice status, the pay link and export.
- M-ON-01's language and theme pickers. The member's language comes from the registry, with a switch on the statement.
- M-MB-02 and M-MB-04 as separate screens. Slips open from MM-7, and "who to ask" and re-check sit on M-MB-01.
- M-CK-02, the offline queue and background sync (cut-order item 4).
- M-CK-03. Cash attestation moves to W-TR-09.
- Push, FCM and Firebase (cut-order item 3, applied now). Phone frames show a labelled banner instead.
- Lock-screen controls, predictive back and the navigation bar.

**Gated P1.** The native document scanner (`CameraView.scanDocumentAsync`, already covered by spike S7) [S1-33] ships only if it is done by 1 Nov. P0 capture uses sample slips.

**Critique gate (25 Oct, before G1).** A design-critique subagent scores the G1 compositions, and the user signs off after the fixes. The rubric:
1. Under a 16 px blur, the primary action and the money figure dominate.
2. Crops at 1470 × 956 and from a 1080p video frame show nothing clipped, no sideways scroll and no text under 12 px.
3. A first-time viewer can say within 3 s what the product does and what to press.
4. Nothing on screen would fit a SaaS template.
5. Every number has provenance, every simulated thing has a label, and every reduced-motion version reaches the same `data-state`.

### S1.4 End-to-end flows

**Real season.**
1. _Ratify, 14 Mar (W-TR-02)._ AI-5 quotes each clause of BR 2026-04. The Secretary certifies, the Chair attests, and the card is hashed.
2. _Capture, 2 Apr–31 Aug (M-CK-01)._ AI-1 to AI-4 read the slips. Fields with confidence under 0.85 go to W-TR-04.
3. _Invoice (W-TR-01)._ Code computes the quote. Claude (AI-7) drafts the invoice through Agent Toolkit 1.11.0 behind the policy lattice. Analyn sends it (`sendNeedsTreasurer`), and AUTO_CANCEL is set.
4. _Funding (W-PF-02)._ Dana pays on PayPal's hosted page. A verified INVOICING.INVOICE.PAID plus a fresh GET (PAID, 0.00 due) makes the run FUNDED.
5. _Review, keys and settlement._ Review and keys run through W-TR-03 to W-TR-07 and M-BD-01/02. Settlement runs through W-TR-08 and M-MB-01.
6. _Cash day, 30 Oct (W-TR-09)._ The run closes when every line is terminal.

**Judge Mode.** Target: the median time from the judge's first press to the batch POST is 60 s or less. It is measured at G2 and G4 in two ways: by a Playwright "cold judge" that reads only the run pill and presses the pre-focused control, and by one person who has never seen the app.

| Step | Judge                                                                                         | System                                                                                                                                                                      | On screen                                                     |
| ---- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 0    | Opens `/judge`                                                                                | Clones the showcase with a new `runSeq`; creates FS-2026A-r{n} from the recorded Claude draft and sends it under the seeded treasurer approval (labelled); sets AUTO_CANCEL | "Season 2026-A is ready to pay."; the phone shows "Gisusi pa" |
| 1    | Presses "Mark Lantern Bay's invoice paid (sandbox)"                                           | `recordPayment`, then GET returns MARKED_AS_PAID with 0.00 due, so the run is FUNDED; INVOICE.PAID is logged when it arrives                                                | BEAT-PAID                                                     |
| 2    | Watches (12 s at most); types the hidden digit or presses "Use logbook line 7"; presses Enter | Replays `extract.row`; slip 0462 routes to W-TR-04                                                                                                                          | MM-2, AS stamp                                                |
| 3    | Resolves H1, H2 and H3                                                                        | Recomputes; shrink 1.62%                                                                                                                                                    | MM-3                                                          |
| 4    | Holds Space for 1.6 s on "Approve 8 payouts"                                                  | Key 1 (demo key)                                                                                                                                                            | Inner rings, QR card                                          |
| 5    | Co-signs in the Chair frame or by QR                                                          | Key 2; APPROVED; re-hash; POST                                                                                                                                              | MM-5                                                          |
| 6    | Opens Proof while waiting; presses "Pay in cash at the bodega" for Rhea                       | Item webhooks, one cancel, one resend                                                                                                                                       | MM-6; MM-1 on the phone                                       |
| 7    | Presses Verify on Proof; taps a peso on the phone                                             | Checks run in the browser                                                                                                                                                   | Six "Matches"; MM-7                                           |
| 8    | Presses Reset                                                                                 | `judgeReset`                                                                                                                                                                | "Starting a fresh run. About 10 s."                           |

"Play it for me" performs steps 1–3, 6 and 7, and stops before both keys.

### S1.5 Screen register and conventions

| ID      | Name                           | Route                                       |
| ------- | ------------------------------ | ------------------------------------------- |
| W-JG-01 | Judge stage                    | `/judge`                                    |
| W-JG-02 | What's real (sheet)            | `/judge`                                    |
| W-TR-01 | Season                         | `/console`                                  |
| W-TR-02 | Rate card                      | `/console/rate-card`                        |
| W-TR-03 | Reading room                   | `/console/runs/:runSlug/reading`            |
| W-TR-04 | By hand                        | `/console/runs/:runSlug/by-hand/:fieldId`   |
| W-TR-05 | Split review                   | `/console/runs/:runSlug/split`              |
| W-TR-06 | Hold drawer                    | `/console/runs/:runSlug/split?hold=:holdId` |
| W-TR-07 | Approve                        | `/console/runs/:runSlug/approve`            |
| W-TR-08 | Run                            | `/console/runs/:runSlug/run`                |
| W-TR-09 | Member line, print and cash    | `/console/runs/:runSlug/members/:memberNo`  |
| W-TR-10 | Shortcuts and settings (sheet) | overlay                                     |
| W-PF-01 | Proof (public)                 | `/p/:runId`                                 |
| W-PF-02 | Proof, brand header            | `/p/:runId` (brand session)                 |
| M-ON-01 | Pairing                        | `/app/pair`                                 |
| M-MB-01 | Bayad (statement)              | `/app/member`, `/app/s`                     |
| M-MB-03 | Paminawa (sheet)               | sheet                                       |
| M-CK-01 | Scan                           | `/app/clerk`                                |
| M-BD-01 | Co-sign request                | `/app/board/runs/:runId`                    |
| M-BD-02 | Sign (sheet)                   | sheet                                       |

Retired: M-MB-02, M-MB-04, M-CK-02 and M-CK-03. `runSlug` is `2026A-r37`.

**Conventions.**
- Screen roots carry `data-testid="<ID>"` and `data-state`, using the state names in this section, which IC-01 exports as `SCREENS[id].states`. Controls carry `data-testid="<ID>/<control>"`. A WS-QA spec-lint fails the build on any `data-state`, `data-moment-phase`, placeholder or route literal in `apps/**` that the contracts do not list.
- Copy is ICU in `@fairsplit/i18n`, keyed `<ID>.<key>`, with no user-facing literals in UI code.
- DTOs carry integer cents with a currency, weights in grams and ISO dates. The UI formats them with the pure `format.*` functions that `api-client` re-exports from domain, never with `Intl`.
- Provenance footers:
  - "Read by Claude (claude-opus-5-5)"
  - "Computed by engine v1, rate card 7f3a 91c2"
  - "Entered by Analyn"
  - "PayPal, webhook, signature verified"
- Run screens subscribe once (`api-client.subscribe('run:<runId>')`) and replay SSE from `Last-Event-ID`. While disconnected they show "Reconnecting. Showing changes up to 10:21:41." and poll every 5 s.
- A screen has at most two slabs, and at most one of them is d3. Navigation, filters, grid rows and status never get slabs. Raw state names never render.
- Judge clones shift run dates relative to the clone date: cash day is +8 days and auto-cancel is +30 days (the showcase uses 30 Oct and 30 Nov 2026). Season dates do not move.
- **Signed member link.**
  - The printed QR encodes `https://{origin}/s#t={token}`. `/s` answers with a 302 to `/app/s`, and the browser keeps the fragment.
  - M-MB-01 exchanges the token at `POST /v1/statement-links/exchange` for a 2-hour session scoped to that one line, then removes the token from browser history.
  - Each token carries a `jti`, rotates when the statement is reprinted, and expires 14 days after cash day.
  - Every route sends `Referrer-Policy: no-referrer`.

**Contract requests.**
- IC-01 (WS-CORE): `SCREENS`, `StatementPlan` and the label maps.
- IC-02 (WS-CORE): `FEE_TABLE`, with a source and date for each rate; `format.landedEstimate`, `format.cashPesos`, `format.ratePerKg` (console only) and `format.amountSpoken`.
- IC-08 (WS-API): the statement-link exchange.
- IC-10 (WS-DS): phase names taken from S2.9, with generated docs.
- New IC-12 FrameBridge (WS-API, WS-CONSOLE and WS-APP). It is same-origin only and uses 2-hour tokens.
  - Stage to frame: `fs.persona` (token, persona, theme, tier, sound, reduced motion), `fs.raise`, `fs.lower`, `fs.autoplay`.
  - Frame to stage: `fs.ready`, `fs.moment` (start and end), `fs.requestFocus`, `fs.feedback`. The stage plays all sound.

### S1.6 Judge stage

**W-JG-01 Judge stage** (`/judge`; no login; rate-limited per IP).
- _Top bar._ "A cacao co-op pays 64 farmers from one brand invoice. Every PayPal call here is real sandbox." After it come "What's real", "Sound", "Reset" and the Proof chip ("Proof: 5 of 8 confirmed").
  - Under the stage: "Synthetic co-op, people and slips. Slip reading replays a recorded Claude run (29 Oct)."
  - Cebuano and Filipino surfaces show "Machine-translated, pending native review" while any visible string is unreviewed.
- _Run pill._ It sits top centre and replaces the rail in Judge Mode. Its menu lists the six console screens and "Shortcuts". The control for the step it names is pre-focused. Its texts, in order:
  1. "Next: mark the invoice paid (sandbox)"
  2. "Reading 12 photos. Replay of the 29 Oct run, sped up ×{n}." (the "sped up" clause is dropped at ×1)
  3. "Next: one digit on slip 0462 is under a water stain"
  4. "Next: 3 holds need you"
  5. "Next: approve 8 payouts"
  6. "Next: Ernesto co-signs. Use the Chair frame or your phone."
  7. "PayPal is confirming payments. Meanwhile, open Proof and watch it fill."
  8. "Next: decide on Rhea's payment"
  9. "Done. Open Proof."
- _"Play it for me"_ (a flat control on the pill). Every 4 s or so it performs the step the pill names, with a visible cursor, under an "Autoplay" chip.
  - It stops before both keys: "Your turn: hold to approve" and "Your turn: co-sign as Ernesto".
  - Any input from the judge pauses it ("Paused. You're driving.").
  - The log records these actions as "Judge as Treasurer, autoplay".
- _Sound._ Off by default. The first deliberate press shows a one-time chip, "Sound on? Payments play a chord.", with "Turn on" and "No thanks". The choice is remembered per viewer.
- _First view._ "Season 2026-A is ready to pay." It shows:
  - the 12 photos as a paper contact sheet with the evidence shadow (no glow);
  - the bolted BR 2026-04 plate;
  - the invoice plate, with US$4,333.50 hollow;
  - one d2 slab;
  - the last three log rows.

_Layout._ Playwright takes snapshots at 390 × 844, 1280 × 800, 1470 × 956, 1536 × 864, 1920 × 1080 and 2560 × 1440.

| Width (px)                 | Phone                                                                                                                             | Drawers                                       | Split grid                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Under 1024 (`phone-visit`) | Nang Celing's statement from the showcase run, the film, and "Open on a laptop for the full stage" (copies the link)              | —                                             | —                                                                                                                          |
| 1024–1599                  | A 64 px tab at bottom right ("Nang Celing: Gisusi pa"). It rises to 360 px over a scrim for its persona's moment, or when clicked | Push the content aside; full width below 1280 | Five columns (Member, Verified kg, Kaltas, Net, Status) when the container is under 1,180 px, with an "All columns" toggle |
| 1600–1679                  | The same tab                                                                                                                      | Overlay, 560 px                               | Set by container width                                                                                                     |
| 1680 and wider             | Docked at the right, 360 px wide, under a 56% ground scrim (inert) until it is the focus                                          | Overlay                                       | Eleven columns                                                                                                             |

There is a single phone, with Member, Chair and Clerk tabs. It runs the Expo web export from `/app` with frame tokens:
- Nang Celing on M-MB-01, in ceb with the Adlaw theme;
- Ernesto on M-BD-01;
- Jessie on M-CK-01.

Its caption reads "The app's web build, running here. Native-only parts are labelled."

_Stage director_ (WS-DS builds it into `@fairsplit/motion`):
- One focal moment plays at a time across the console, the phone and the Proof chip.
- `data-state` changes as soon as an event is applied; only the motion waits. A moment that would wait more than 1.6 s plays its reduced version instead.
- Item landings are at least 250 ms apart, so the payment scale plays no more than four notes a second. MM-2 rows are at least 180 ms apart.
- When M-014's thread lands, the phone rises and MM-1 starts 250 ms later. A co-sign request raises the Chair tab.
- Log rows and latency dots always show the true receipt times.

_States:_
- `queued`: "PayPal's sandbox is pacing us. You're next, about 40 s."
- `resetting`: "Starting a fresh run. About 10 s."
- `circuit`: the top bar reads "PayPal asked us to slow down. For 6 minutes, PayPal steps replay the last real run, labelled."
- `balance-low`: "The sandbox balance is low. Payouts pause until it's topped up; everything else works."
- `ai-off`: "Live slip reading is off. The recorded run still plays."
- `paypal-off`: "Real PayPal calls are off. PayPal steps replay the last real run, labelled."
- `start-failed`: "We couldn't start a run.", with "Try again" and the request ID.
- `autoplay`, `paused` and `phone-visit`.

**W-JG-02 What's real** (sheet).
- _Real:_
  - the Toolkit invoice, its send and its AUTO_CANCEL rule;
  - record-payment and its verified INVOICING.INVOICE.PAID (MARKED_AS_PAID, a simulated payment rail);
  - the typed Payouts POST and the verified item webhooks;
  - Rhea's UNCLAIMED, our cancel, and RETURNED;
  - one resent duplicate and one postback verification;
  - PayPal's reported fees.
- _Replayed:_ Claude's reading, recorded 29 Oct. "Read a slip live" reads one slip for real.
- _Simulated:_ the push banners, the biometric step (a demo key made in your browser for this session), the scanner (sample slips) and SMS.
- _Seeded:_ the invoice-send approval, the 54 earlier photos (dated) and the showcase cash receipts.
- _Synthetic:_ the people, co-op, brand, slips (OpenAI's image model via Codex CLI) and voice (Gemini TTS).
- _Accounts:_ nine US sandbox accounts.
  - One business account is the co-op: the invoicer and the payout sender.
  - Seven personal accounts are the seven PayPal members who end up paid, one each, so Proof shows seven distinct receivers.
  - One personal account is Lantern Bay. It is used only for a hosted-page payment; Judge Mode marks the invoice paid instead.
  - Rhea's address has no account, on purpose: that is what produces UNCLAIMED.
- _Merchant of record:_ the sentence from S1.1.
- _Not built:_ production partner onboarding (third-party permissions for Invoicing and Payouts, which PayPal must grant), real SMS, push, and offline capture.

### S1.7 Treasurer console

Shell: a flat 220 px rail (Season, Rate card, Reading room, Split review, Approve, Run), the Run pill, and D for Data mode. The rail's footer shows "Acting as Analyn R. Sumalinog, Treasurer (Judge Mode)" and "Shortcuts". The theme is Tablea only. Outside Judge Mode the console needs a window at least 1280 px wide; narrower windows show "The console needs a window at least 1280 px wide."

**W-TR-01 Season.**
- The stencil "2026-A" with "Bulawanon Kakaw Growers MPC, Calinan".
- RunStrip: Ratified 14 Mar, Funded, Read, Checked, Approved, Paid, each lit as register §7 defines.
- Pools: "Premium US$2,887.50" (with a lock and "never deducted, R0"), "Quality bonus US$1,386.00", "Disbursement US$60.00".
- Invoice plate: "Invoice FS-2026A-r37, US$4,333.50" and its three lines, with:
  - the note "Season 2026-A, RC 7f3a 91c2, lot LB-PH-2026-03";
  - "Drafted by Claude with the PayPal Agent Toolkit. Sent by Analyn.";
  - "Auto-cancels 30 Nov 2026 if unpaid."
  - The amount stays hollow until FUNDED, and BEAT-PAID lands here.
- Eval waffle: 40 cells from `eval/report/latest.json`. Ink marks an exact row, a canary outline a case routed to a person, and red an unsafe auto-accept. Caption: "40 labelled synthetic cases. Exact rows {exact} against an OCR-only baseline of {baseline}. Unsafe auto-accepts {unsafe}. Run {date}."
- Next action: one linked sentence, such as "3 holds need you" or "1 re-check request from M-014".
- _States:_
  - `unratified`: "Ratify a rate card before the first slip."
  - `drafted`: the plate in pencil, with the d2 slab "Send to Lantern Bay".
  - `draft-refused`, shown only when it really happens: "Claude's draft didn't match the code's quote, so policy refused it (invoiceEqualsQuote). Claude is drafting again."
  - `waiting`: "Sent to Lantern Bay. Waiting for payment."
  - `unverified`: "A payment notice arrived that we couldn't verify. Nothing starts until PayPal confirms."
  - `funded`: "Paid by Lantern Bay." or "Marked as paid in sandbox."
  - `auto-cancelled`: "Invoice auto-cancelled on 30 Nov. Send a new one."
  - `offline`: "You're offline. Showing the last copy from 10:21. Actions are paused."

**W-TR-02 Rate card.**
- On the left, the BR 2026-04 pages shown as paper ("Synthetic sample").
- On the right, printed flat:
  - R0: "Premium is paid by verified kilos and is never deducted."
  - R1: "CBU: 5% of the bonus until ₱5,000 is paid up."
  - R2: "Hauling: ₱1.50 a kg for purok pickups."
  - R3: "Loan: only with a signed Authority to Deduct, up to 50% of the bonus."
  - R4: "Advance: only with a voucher, up to 30% of the bonus."
  - The hold rules: 1.6 kg a tree, mass balance ±2.0%, confidence 0.85.
  - The co-sign rule: a batch over US$300, a line over US$150, or any override.
- Hovering a rule highlights its clause on the scan. The footer reads "Read by Claude (claude-opus-5-5). Quote found on page 2."
- The bolted plate reads "sha256 7f3a 91c2, sealed 14 Mar 2026 by BR 2026-04".
- A flat "Add a deduction" opens a row. Its commit button, "Add to Schedule A", is the bolted slab (MM-4). The only live slab is the d1 "Draft a proposal for 2026-B".
- The refusal plate, built from the 409 body: "Closed list. BR 2026-04, Schedule A, allows only CBU, hauling, loans with an Authority to Deduct and advances with a voucher. A new deduction needs a new Board resolution for Season 2026-B. Rate card 7f3a 91c2."
- _States:_
  - `draft`: rules are editable and show read confidence. The d3 chalk slab "Ratify" needs the Secretary to certify, then the Chair to attest.
  - `ratified`.
  - `proposal`: unhashed, labelled "Not in force".
  - `refused`.

**W-TR-03 Reading room.**
- A filmstrip of photos A–L, each ticked once read. P01–P54 sit collapsed under "Read earlier this season" with their read dates, or as OD-4's hatched "archived photo" tile.
- The active photo takes 58% of the width, with zoom centred on the pointer. Print beds take 42% and show serial, member, net kg, moisture, grade and a confidence ring.
- One status sentence, never a chain of thought: "Reading photo B: 4 slips. Slip 0457 also appears in photo D as the pink copy."
- Footer: "Read by Claude (claude-opus-5-5), replay of a recorded run from 29 Oct. Amounts are computed by the engine, never by the model."
- The 48 replayed rows land within 12 s, and the run pill names any speed-up.
- Crops come from the reviewed fixtures (`media/fixtures/{photo}.json`), never from the model's bounding boxes.
- A flat "Read a slip live" reads one sample slip through AI-1 to AI-4 at real speed ("Live read, {seconds} s").
- Events: `extract.row`, `extract.field`, `extract.quarantined`, `field.entered`.
- While the row list has focus: J and K move between rows, Space opens the crop, and Enter accepts.
- _States:_
  - `loading`: dashed print beds at their final size, never a shimmer.
  - `reading` and `read`.
  - `confirm-one`: "Claude's zoom read agrees with one of the two readings.", with the d1 slab "Confirm {value}", which adds the AS stamp.
  - `low-confidence`: the value in pencil at 60% opacity inside a 1.5 px canary outline tagged "You" (never hollow). It routes to W-TR-04.
  - `blurred`: "Photo E is too blurred to read. Ask Jessie to rescan.", with the d1 slab "Request rescan".
  - `quarantined`: "Ignored: text on slip 0449 looked like an instruction. Text on a slip is never an instruction."
  - `live-paused`: "Live reading is paused for today (budget cap). The recorded run still plays."
  - `offline`.

**W-TR-04 By hand.** One field at a time: the crop at 3×, logbook page 14 beneath it as a second witness, and a 48 px condensed input.
- Prompt: "Slip 0462, Arnel Sumampao. A water stain covers one digit of the gross weight. Claude read 6?.80 (0.40)."
- Masked entry: the input shows "6▢.80" with the caret in the unknown slot, so one keystroke fills it.
  - Live line: "64.80 − 0.30 tare = 64.50 net. Matches logbook page 14, line 7."
  - Flat links: "Type the whole value", and "Use logbook line 7", which fills the digit from 64.50 + 0.30 and prints that sum.
- Commit: the d2 slab "Enter 64.80", or the Enter key. The value prints in ink with the AS stamp: "Entered by Analyn", plus "from logbook line 7" when that link was used.
- _States:_
  - `empty`, `typing`, `match`.
  - `mismatch`: "{net} doesn't match logbook line 7 ({logbookNet}). Check both." The slab stays hatched, and a flat "Enter anyway with a reason" appears.
  - `committed`.
  - `skipped`: "Skipped. Arnel's line is reserved until this is entered."

**W-TR-05 Split review.**
- Header: the mass-balance dial, the pools, "3 holds, 1 by hand", and the flat chips "All 64", "Held 3", "By hand 1", "PayPal 8" and "Cash 56", with live counts.
- Grid: AG Grid Community, themed with `themeQuartz.withParams` from the design tokens. It has eleven columns; narrow containers show five (see the W-JG-01 table):
  - Member (name, ID, language glyph)
  - Slips (count, thumbnails)
  - Verified kg, with a kg-per-tree bar against the 1.6 limit
  - Min confidence
  - Premium (with a lock)
  - Bonus
  - Kaltas (rule chips such as "CBU −1.09 R1")
  - Credit
  - Net
  - Rail ("PayPal", or a hatched "Cash")
  - Status
- Pinned totals: "Gross = pool, to the cent (4,273.50). Net + ruled deductions − credits = pool."
- The tooltip is the only place a per-kg pool rate appears: "148.0 kg × US$0.29523 a kg, R0, engine v1."
- Held rows get a 3 px canary rule, a glyph and "Gisusi pa". Reserved rows read "Reserved, never redistributed." Cells changed by PayPal wash jade; cells changed by an engine recompute wash pencil. Enter opens W-TR-06 or W-TR-09.
- _States:_
  - `loading`: skeleton rows.
  - `empty`: "No lines yet. They appear once the slips are read."
  - `ready`.
  - `declined`: a red banner, the only red on this screen.

**W-TR-06 Hold drawer** (560 px; the gate chip is always visible).

|                                   | H1 duplicate (Nong Dioning, slip 0457, 42.0 kg)                                                                                                                                              | H2 yield (Merlyn Ponce, M-053)                                                                                                                                    | H3 no rule (Nong Tidoy, slip 0458)                                                                                                                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine line                       | "Slip 0457 is in two photos: the white original (B) and the pink duplicate (D). Counting both moves US$17.94 from 63 members to Nong Dioning and puts shrink at 2.05%, over the 2.0% limit." | "Merlyn Ponce: 300.0 kg from 140 registered trees is 2.14 kg a tree. The limit is 1.6."                                                                           | "'Multa (absent GA) ₱200' on slip 0458 matches no Schedule A rule. It was netted from Nong Tidoy's cash at the bodega, so it returns as a US$3.20 correction credit paid by the co-op, not from Lantern Bay's pool. Hauling ₱91.20 (R2) stays." |
| Claude's line (pencil, no digits) | "The second image is the office's pink copy of the same receipt."                                                                                                                            | "Her deliveries suggest a second plot that isn't in the registry yet."                                                                                            | "The clerk noted a fine for missing the general assembly."                                                                                                                                                                                      |
| Gate                              | Blocks approval. Changes kilos.                                                                                                                                                              | Blocks approval. Changes kilos.                                                                                                                                   | Reserves this line only. Never redistributed.                                                                                                                                                                                                   |
| Actions                           | d2 "Count it once"; flat "These are two deliveries" (needs a reason, then the Chair)                                                                                                         | d2 "Register a plot" (P-053-B, 0.60 ha, 330 trees; the plot point stays private), which then shows "300.0 kg from 470 trees is 0.64 kg a tree. Inside the limit." | d2 "Return the ₱200 as a credit"                                                                                                                                                                                                                |

A pencil caption, "Suggested by Claude", marks any action AI-7 proposed.

_States:_
- `open`, `resolving`.
- `resolved`: flush ink, with the AS stamp and the time.
- `asked-chair`: "Asked Ernesto".
- `conflict`: "Ernesto is viewing this hold".

**W-TR-07 Approve** (one centred 640 px column, no cards). From top to bottom:
1. The seal (200 px, no rings yet), "US$368.39" (72 px, in pencil), and "8 payouts by PayPal" over a hatched rail bar: "56 members, US$3,849.78, cash at the bodega on 30 Oct".
2. Fees.
   - "PayPal fees, estimate: US$7.37 (2% per payment, as PayPal's sandbox charged on run r36). PayPal reports each actual fee after posting. Paid from the US$60.00 co-op disbursement line."
   - "Live fees follow the sending account's country: a Philippine co-op pays PayPal PH's domestic rate, 2% per payment, capped at ₱50." [S1-19]
   - The estimate's rate comes from the last real run, or from spike S4 before the first one.
3. Printed: "3 holds resolved. 1 field entered by hand. Shrink 1.62%, inside 2.0%. 64 of 64 lines explained. Rate card unchanged since 14 Mar."
4. The d3 jade slab (560 × 64) "Approve 8 payouts", captioned "Hold to approve", with the link "Can't hold? Approve another way".
5. Key slots: "Analyn R. Sumalinog, Treasurer, key fs-analyn-w1" and "Ernesto P. Cabahug, Chairperson. Needed: batch over US$300 (Schedule A)."
   - In Judge Mode both slots read "Demo key", and a QR card says "Co-sign as Ernesto from your own phone. Uses a demo key made in your phone's browser."

_States:_
- `blocked`: the slab is flush and hatched, with "Resolve 1 hold that changes kilos first" linking to the hold.
- `ready`: the slab rises.
- `key1`: the inner rings, "Waiting for Ernesto", and the presence label "Ernesto, reviewing hold 2 on his phone".
- `declined`: his reason, in his ink; the run goes back to review.
- `expired`: "The co-sign request expired. Send again."
- `approved`: "Approved by Analyn and Ernesto".
- `posting`: "Posting batch 2026A-7f3a91c2-r37. The Payouts tool re-hashed the batch: it matches."
- `mismatch`: "The batch changed after it was signed. Nothing was sent."
- `retrying`: "PayPal didn't answer. Retrying with the same request ID, so no one is paid twice. Attempt 2 of 4."
- `denied` (red): "PayPal declined the batch: the balance is too low. Nothing was sent. Top up and post again."
- `killed`: the slab is bolted, with "Payouts paused by the co-op."

**W-TR-08 Run.**
- The split fan (MM-6) sits on top. Below it:
  - the three-lane log (Machine, People, PayPal), newest first;
  - latency dots from funding to each SUCCEEDED, with p50 and maximum;
  - "PayPal reported fees so far: US${fees} ({n} of 8 payments)", summed from `payout_item_fee`.
- Log rows lead with plain words, with detail beneath in caption type. Examples:
  - "Paid Consolacion Bacus US$64.45" over "PAYMENT.PAYOUTS-ITEM.SUCCEEDED, item 5KX…, webhook, signature verified".
  - One row per real run carries the postback badge "PayPal: SUCCESS".
  - A duplicate delivery logs "Delivery repeated, already applied."
  - An adopted batch logs "PayPal already had this batch. Adopted it; nothing was sent twice."
- Rhea: "Rhea Jumawan's address has no PayPal account, so PayPal parked US$26.65 as unclaimed. It returns to the co-op by itself after 30 days, or you can decide now." [S1-20] The choices:
  - d2 "Pay in cash at the bodega": cancel, RETURNED, cash due. The row then reads "Returned to the co-op's PayPal balance. Cash at the bodega on 30 Oct."
  - Flat "Re-send after Rhea confirms her email": a new one-item batch `…-x1`, signed with the treasurer's key.
  - Flat "Wait: Rhea can join PayPal and claim it within 30 days." Whether this works in the sandbox is UNVERIFIED; spike S4 tests it.
- _States:_
  - `waiting`: "Posted 10:21:41. PayPal confirms each payment as it lands.", with an elapsed timer. A reconcile GET that flips a row says "Confirmed by a status check".
  - `parked`.
  - `denied`: "No money moved."
  - `done`: "7 paid by PayPal. 57 in cash. US$21.14 kept for members. PayPal fees US${fees}."

**W-TR-09 Member line, print and cash.**
- Content:
  - the ReceiptBar, and the member's slips with crops;
  - the line history ("Approved by AS and EC", "Sent", "Paid 30 Oct");
  - the statement in the member's language, with a language switch;
  - an SMS preview labelled "Preview, not sent", with its GSM-7 character count;
  - any open re-check requests.
- Actions: d1 "Pair a phone" (a single-use QR valid for 10 minutes, plus a 6-digit code) and flat "Print statement".
- The print (`@page { size: 80mm auto }`) carries:
  - exact pesos for cash lines ("₱7,990.00", "From US$127.84 at ₱62.50 to the dollar");
  - the seal in black and a QR to the signed member link;
  - the rate-card hash and the slip numbers;
  - a "Nadawat" box for a signature or thumbmark, and a witness line.
- Cash day (treasurer or clerk role):
  1. The member signs or thumbmarks the "Nadawat" box.
  2. "Photograph the Nadawat box". The co-op keeps the image; Proof shows only its hash.
  3. The d2 slab "Mark received" records the signed-in person's stamp, moving the line from OFF_RAIL_DUE to OFF_RAIL_PAID.
  - The record never says whether the mark is a signature or a thumbmark.
  - Before cash day the slab is hatched: "Available on cash day, 30 Oct."
- _States:_ `held`, `ready`, `paid`, `cash-due`, `cash-received`, `parked`, `request-open`.

**W-TR-10 Shortcuts and settings** (a sheet, opened with "?" or "Shortcuts").
- Shortcuts grouped by task: Read, Review, Approve, Run.
- Three toggles: "Single-key shortcuts" (D, ?, J and K), "Sound" and "Data mode".
- Data mode swaps the dial, fan, arc and waffle for plain tables, and shows the seal as its hash.

### S1.8 Proof

**W-PF-01 Proof** (`/p/:runId`; public, light theme, one 680 px column). Members appear by ID only, never by name, per RA 10173 [S1-23].
- _Hero._
  - If the invoice is PAID: "Lantern Bay paid US$4,333.50 for Season 2026-A. Here is where it went."
  - If it is MARKED_AS_PAID: "Lantern Bay's US$4,333.50 invoice for Season 2026-A was marked paid in sandbox. Here is where it went."
  - Below: the seal at 320 px, the stencil "LB-PH-2026-03", and the d1 slab "Verify in your browser".
- _Chain:_ six plates that expand in place.
  1. Invoice: FS-2026A-r37, its status, and the reference `rc:7f3a91c2…`.
  2. Rate card: its hash, ratified 14 Mar 2026, first slip 2 Apr.
  3. Slips: 264 in 66 photos, with the photo hashes.
  4. Lines and cash receipts: 64 line hashes, the conservation check, and each cash receipt's attestation and image hash.
  5. Two keys: `fs-analyn-w1` and `fs-ernesto-a1` (or "Demo key"), and the batch hash.
  6. Payout items: `sender_item_id` (for example `r37-M-014`), `payout_item_id`, and the webhook event IDs.
- _Verify:_ six checks turn from "Checking" to an ink check and "Matches":
  1. The invoice reference carries the card hash.
  2. The card re-hashes to the published value.
  3. The photo hashes match.
  4. The line hashes recompute and sum to the pool, and each cash receipt matches its line.
  5. Both signatures verify over the batch hash.
  6. The items match the signed batch.
- _Metrics, in this order:_
  1. "Lines explained: 64 of 64".
  2. "Premium allocated to members: US$2,887.50, 100%, no deductions (R0). Computed by the engine and hashed."
  3. Paid, in three tiers:
     - "Verified by PayPal: 7 members, US$341.74" (jade flush);
     - "Cash, attested at the bodega: {n} of 57, receipt on file" (ink; seeded receipts say "seeded");
     - "Due: {m} members, US${due}" (hatched).
  4. "Holds caught: 3. Kept for members: US$21.14 (a duplicate slip counted once, a fine returned)."
  5. "7 members on PayPal this season, 57 in cash at the bodega", over a hatched bar.
  6. The eval waffle.
  7. A technical row: "Invoice to last confirmation: 3 min 12 s".
- _Fees_ (expandable). Only fees PayPal has reported are stated as fact:
  - "Invoice: marked as paid in sandbox, so PayPal charged no fee." For a PAID invoice, this line shows the reported fee, or "Pending reconciliation".
  - "Payouts: PayPal reported US${fees} for {n} payments." At 2%, that is US$7.37.
  - "From the US$60.00 co-op disbursement line. Unused: US${rest}, still in the co-op's PayPal balance."
  - "In production a Philippine co-op pays PayPal PH's fees: receiving 4.40% + US$0.30, payouts 2% capped at ₱50 each, conversion 3.0%." [S1-19]
- _Plot field:_ dots sized by kilos, captioned "Positions are abstract. Plot coordinates are shared with Lantern Bay under the data-sharing agreement, never published."
- _Footers:_
  - "Reconciliation with PayPal's Transaction Search runs nightly; new transactions can take up to 3 hours to appear there." [S1-21]
  - The merchant-of-record sentence.
  - "A sandbox prototype on a synthetic Davao cacao co-op. No real farmer was paid."
  - No prior art.
- _States:_
  - `none`: "No pay run yet for this season."
  - `progress`: plate 6 reads "Waiting for PayPal. 3 of 8 confirmed."
  - `verified`.
  - `failed` (red, naming the plate): "The batch hash doesn't match the signed batch. Proof withheld."

**W-PF-02 Proof, brand header** (cut-order item 5).
- A strip that reads "Invoice: paid" or "Invoice: marked as paid in sandbox".
- In `unpaid`, the d2 slab "Pay invoice in PayPal" opens `recipient_view_url`. The sandbox sends no email, so this is Dana's way in. If W-PF-02 is cut, W-TR-01's invoice plate carries the same link.
- "Export proof (CSV and JSON with hashes)" is built in the browser. It is the only place member names and plot coordinates appear.
- _States:_ `unpaid`, `progress`, and `mismatch` (proof withheld).

### S1.9 Fair Split app

Each role has one home screen plus sheets, laid out edge-to-edge within the safe areas, with no navigation bar. The board home is M-BD-01. It adds "Akong bayad" ("my pay") if the registry lists Ernesto as a member.

**M-ON-01 Pairing.**
- "Pangayo sa treasurer sa inyong QR." ("Ask the treasurer for your QR.") Scanning the QR binds the device, role and workspace.
- `camera-denied` offers the 6-digit code instead. `expired` shows "Nag-expire na kini nga code. Pangayo og bag-o sa treasurer."
- Members then answer one question, "Unsa ang una ninyong gusto: basahon o paminawon?" ("Read or listen first?"), by picking one of two plates with sample audio: "Basahon" or "Paminawon una".
  - The choice is stored on the device and can be changed from the statement menu.
  - It is never inferred from age or literacy.
- Judge frames skip this screen.

**M-MB-01 Bayad (statement).** Styled as the white original copy, with radius 0. From top to bottom:
1. The co-op and season, then "Maayong adlaw, Nang Celing. Salamat sa inyong paghago."
2. The amount block, which takes first accessibility focus (native `setAccessibilityFocus`; DOM focus on web).
   - PayPal line: "US$64.45" (48 sp) over "mga ₱3,907 human sa 3% sa PayPal (gibanabana)" ("about ₱3,907 after PayPal's 3% conversion, estimate").
   - Cash line: "₱7,990.00" over "Cash sa bodega, 30 Okt. Gikan sa US$127.84 sa ₱62.50 matag dolyar." This is exact, because the rate is recorded on the run.
3. The status capsule, then Paminawa: a full-width 64 dp d1 slab, which takes second focus. If the member chose "Paminawon una", reading starts when the statement opens, but never while TalkBack is running.
4. The ReceiptBar: "Premium 43.69, walay kaltas", "Bonus 21.85", "CBU −1.09 (R1, BR 2026-04)".
   - PayPal lines add a dotted segment after the net: "PayPal: 3% kung ilisan sa peso. GCash: 1% kung ibalhin. Dili kini kaltas sa co-op." ("PayPal takes 3% to change it to pesos; GCash takes 1% to move it there. Not a co-op deduction.")
   - The rates come from `FEE_TABLE` [S1-19][S1-8].
5. The slip chips (0403, 0419, 0436, 0467) and the history ("Giaprobahan ni AS ug EC", "Gipadala", "Bayad na").
6. A footer with the seal, "Rate card 7f3a 91c2, giaprobahan sa Board" and the AI_NOTE sentence.
7. The Pangutana block, always last:
   - "Naa moy pangutana? Adto kang Treasurer Analyn sa bodega."
   - "Aduna moy katungod nga motan-aw sa mga rekord sa co-op." (RA 9520 Art. 83) [S1-9]
   - The flat "Ipasusi pag-usab" opens a sheet that sends the line, a slip and an optional note to the Mediation and Conciliation Committee (Art. 43).

MM-1 and MM-7 play on this screen. MM-7 expands to kilos and shares, never a per-kg rate: "148.0 kg, tanan Grade 1. Premium US$43.69, walay kaltas (R0)." It sets `data-trace` to `closed`, `line` or `slip`.

_States_ (Cebuano copy; an English gloss in brackets where the S1.11 table doesn't cover it):
- `checking`: "Gisusi pa". No amount; it shows the kilos, slips and the expected date.
- `held-line`: "Gisusi pa ang usa ka linya. Si Treasurer Analyn ang mohukom." [one line is still being checked; Analyn decides], with a date.
- `sent`: a hollow amount and "Gipadala na, naghulat sa PayPal 0:14". The ring stops animating after 60 s.
- `paid`: jade flush, "Bayad na, 30 Okt".
- `cash-due`: hatched with a hollow amount, "Andam sa bodega, 30 Okt".
- `cash-received`: "Nadawat".
- `unclaimed`: "Wala madawat sa PayPal. Si Treasurer Analyn ang mohukom kung ibalhin sa cash." [Analyn decides whether to move it to cash]
- `paypal-held`: "Gipugngan sa PayPal samtang gisusi."
- `needs-action`: "Wala molampos sa PayPal. Si Treasurer Analyn ang motabang." [Analyn will help]
- `reversed`: "Gibawi ang bayad. Gisusi ni Treasurer Analyn."
- `request-sent`: "Nadawat sa Komite."
- `request-answered`: the committee's reply in ink, initialled.
- `offline`: "Katapusang kopya, 10:21".

**M-MB-03 Paminawa** (sheet).
- The transcript at 22 sp, with the current sentence underlined.
- Play and pause at 72 dp. "Hinay" plays at 0.85× (`setPlaybackRate`) [S1-32].
- Language chips, and the label "Sintetikong tingog (Gemini TTS)".
- When a sentence names a slip, that slip's chip rises 8 dp for 1.2 s at the offset recorded in the audio manifest.
- _States:_
  - `playing`, `paused`.
  - `device-voice`: "Tingog sa telepono", used when a clip is missing.
  - `filipino-audio`: "Audio sa Filipino; teksto sa Cebuano", used if spike S10 fails.
  - `offline`.

**M-CK-01 Scan** (clerk).
- A top bar with the station chip "Purok 2 pickup", and one floating action button, "Scan resibo".
- P0: the button offers sample slips, on native and web.
- P1: the button calls `CameraView.scanDocumentAsync()` [S1-33].
  - The call returns `null` on cancel or when the scanner is unavailable; the app then falls back to sample slips.
  - Pages are resized to 1,600 px, hashed and uploaded at once, with retries while the app is open.
- Today's captures are listed inline: thumbnail, serial (once read), member hint and status.
- Rescan requests arrive as a banner: "Gihangyo ni Analyn nga i-scan pag-usab ang photo E."
- _States:_
  - `ready`, `uploading`, `uploaded`.
  - `read`: "4 ka linya nabasa".
  - `failed`: "Mosulay pag-usab sa 40 s", with "Ipadala karon".
  - `quality`: "Ngitngit kaayo. I-scan pag-usab."
  - `duplicate-file`: "Napadala na sa 09:12."
  - `offline`: "Walay signal. I-scan pag-usab inig balik sa signal."

**M-BD-01 Co-sign request.** The phone frames show a labelled "Simulated push" banner. The screen is one scroll, top to bottom:
- the amount;
- why him: "Ang batch milapas sa US$300.";
- the three resolved holds, with the resolver's initials;
- the seal and the batch hash in groups of four, to compare with the console;
- "Naa si Analyn sa approval screen.";
- the flat "Ipabalik kang Analyn" (send it back to Analyn), which needs a reason.

Opening a hold emits `presence`.

_States:_
- `none`: "Walay pirmahan karon."
- `request`.
- `override`: H1's two-deliveries request with Analyn's reason, with the d2 slab "Uyon ko" and the flat "Dili".
- `expired`.
- `changed`: "Nausab ang batch human nimo giablihan. Walay napirmahan. Susiha pag-usab."
- `offline`: "Kinahanglan og signal aron makapirma. Dili kini ipadala sa ulahi." A signature is never queued.

**M-BD-02 Sign** (sheet).
- The d3 jade slab "Pirmahi", 64 dp, in the thumb zone, captioned "Kupti, dayon gamita ang inyong fingerprint."
- Flow: hold for 1,200 ms, then the biometric prompt or device PIN, then an Ed25519 signature over the JCS payload with `fs-ernesto-a1`.
- The link "Dili makakupti? Pirmahi sa laing paagi" opens the ConfirmDialog.
- Result: "Napirmahan. Key fs-ernesto-a1. Parehas ang batch hash sa console." The phone frames say "Demo key".
- _States:_
  - `ready`, `holding`, `biometric`, `signed`.
  - `cancelled`: the slab springs back and nothing is signed.
  - `mismatch`: the clack sound and "Lahi ang batch hash. Walay napirmahan."

### S1.10 Magic moments in product terms

Phase names (`data-moment-phase`) belong to `packages/motion/moments.ts` and `timelines.ts` (S2.9, IC-10, frozen 27 Oct). S1 lists none of them.
- `tools/gen-moment-docs.ts` generates `docs/moments.md` from those files, and a CI docs check fails if the two drift apart.
- Tests wait for a moment's final phase and for the screen's S1 `data-state`.
- Reduced-motion versions reach the same `data-state`.

| Moment                   | Screen                                                | Real trigger                                                                     | What it proves                                                          | `data-state`                                      |
| ------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| MM-1 Bayad na            | M-MB-01                                               | Verified, deduplicated PAYMENT.PAYOUTS-ITEM.SUCCEEDED for M-014 (`item.updated`) | PayPal, not the app, says she is paid                                   | `sent` → `paid`                                   |
| MM-2 Paper prints itself | W-TR-03, W-TR-04                                      | `extract.row` from the recorded real run; `field.entered`                        | Claude reads in pencil; doubt becomes the treasurer's ink               | `reading` → `read`; `typing` → `committed`        |
| MM-3 The pink copy       | W-TR-06, and the dial on W-TR-05                      | H1 opened, then "Count it once"                                                  | Counting the duplicate once pays 63 neighbours back                     | `open` → `resolved`                               |
| MM-4 Bolted              | W-TR-02                                               | 409 `RATE_CARD_RATIFIED`                                                         | Not even the treasurer can add a deduction mid-season                   | `ratified` → `refused`                            |
| MM-5 Two keys            | W-TR-07, M-BD-02                                      | Last blocking hold resolved; two `approval.signed` events                        | Two named people bound this exact batch                                 | `ready` → `key1` → `approved`; `ready` → `signed` |
| MM-6 Honest fan-out      | W-TR-08                                               | The 201, verified item events, Rhea's UNCLAIMED, one resent duplicate            | Sent is not paid; cash members share the page; a repeat changes nothing | `waiting` → `parked` → `done`                     |
| MM-7 Tap a peso          | M-MB-01 (the wheel zoom on Proof is cut-order item 6) | Nang Celing taps US$43.69                                                        | Every peso traces to a pencil mark she recognises                       | `data-trace`: `closed` → `line` → `slip`          |
| BEAT-PAID                | W-TR-01                                               | The run reaches FUNDED                                                           | The money is in before any work starts                                  | `waiting` → `funded`                              |

Rhea's thread holds at 70% with a canary end cap and "Parked", and never turns red: UNCLAIMED is a decision for a person, not a failure.

Settled drifts:
- Nothing glows. Paper has only the evidence shadow.
- The "You" cell is pencil inside a canary outline, never hollow.
- Per-kg pool rates appear only in the console tooltip.

### S1.11 Microcopy and tone

**Voices.**
- The engine prints templates whose digits come from code.
- Claude writes in pencil, with no digits, observing and never accusing.
- People write in ink, under an initials stamp.
- PayPal rows lead with plain words.
- Members hear a warm, short voice that uses their honorific from the registry, leads with money, and names a person and a place for help.

**Rules.**
- Sentence case. No exclamation marks, emoji, eyebrows, all caps, middle-dot strings or arrows on buttons.
- Buttons name the outcome ("Approve 8 payouts").
- Every state has a glyph and a word. A hold is never an error. Red copy names PayPal as the actor.
- A peso figure is either "about … (estimate)" or exact cash at the run's recorded rate.
- The console keeps the co-op's own words: resibo, kaltas, purok, bodega, CBU, multa.
- A CI word list (WS-QA) blocks:
  - "EUDR-compliant", "certified", and Fairtrade or Rainforest Alliance marks;
  - "carbon" in public copy;
  - "live" for sandbox PayPal activity;
  - "instant" for GCash or peso pay;
  - "AI calculates";
  - "verified" on simulated events;
  - "paid via checkout" after record-payment;
  - "merged" for PR #107;
  - "no fees";
  - "error" or "fraud" in member copy.

**Status words.** The register §7 words are fixed; the rest are new.

| State                             | ceb                                          | fil                                                  | en (member)                                     | Console                                                                                             |
| --------------------------------- | -------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| COMPUTED, READY, HELD             | Gisusi pa                                    | Sinusuri pa po                                       | Still checking                                  | Ready. HELD shows "Gisusi pa", plus "Reserved, never redistributed." when the gate is RESERVES_LINE |
| EXCLUDED                          | Ibalhin sa sunod nga bayad                   | Ililipat po sa susunod na bayad                      | Moved to the next pay run                       | Excluded, carried over                                                                              |
| LOCKED, SUBMITTED, PAYPAL_PENDING | Gipadala na, naghulat sa PayPal              | Naipadala na po, hinihintay ang PayPal               | Sent, waiting for PayPal                        | Sent                                                                                                |
| PAID                              | Bayad na                                     | Bayad na po                                          | Paid                                            | Paid                                                                                                |
| OFF_RAIL_DUE                      | Andam sa bodega                              | Handa na po sa bodega                                | Ready at the bodega                             | Cash due                                                                                            |
| OFF_RAIL_PAID                     | Nadawat                                      | Natanggap na po                                      | Received                                        | Cash received                                                                                       |
| UNCLAIMED                         | Wala madawat sa PayPal                       | Hindi po natanggap sa PayPal                         | Not received through PayPal                     | Parked                                                                                              |
| RETURNED; REROUTED                | Gibalik sa co-op; Gipadala pag-usab          | Ibinalik po sa co-op; Ipinadala pong muli            | Returned to the co-op; Sent again               | Returned; Re-routed                                                                                 |
| PAYPAL_HELD; NEEDS_ACTION         | Gipugngan sa PayPal; Wala molampos sa PayPal | Hinahawakan po ng PayPal; Hindi po natuloy sa PayPal | PayPal is holding it; PayPal didn't complete it | Held by PayPal; Needs action                                                                        |
| REVERSED                          | Gibawi                                       | Binawi po                                            | Reversed                                        | Reversed                                                                                            |

_Run pill words:_

| State              | Words               | State           | Words              |
| ------------------ | ------------------- | --------------- | ------------------ |
| DRAFT              | Draft               | POSTED          | Posted             |
| QUOTED             | Quoted              | SETTLING        | PayPal confirming  |
| INVOICED           | Sent to Lantern Bay | NEEDS_FOLLOW_UP | Needs a decision   |
| FUNDED             | Funded              | SETTLED         | Settled            |
| EXTRACTING         | Reading slips       | CLOSED          | Closed             |
| COMPUTED           | Lines computed      | CANCELLED       | Cancelled          |
| IN_REVIEW          | In review           | DENIED          | Declined by PayPal |
| TREASURER_APPROVED | Approved by Analyn  | HALTED          | Paused             |
| AWAITING_BOARD     | Waiting for Ernesto | APPROVED        | Approved           |
| POSTING            | Posting to PayPal   |                 |                    |

_Hold words:_ DUPLICATE_SLIP "Same slip twice"; IMPLAUSIBLE_YIELD "More than the plot can grow"; NO_RULE "Deduction with no rule"; RATE_MISMATCH "Rate differs from the card"; SUSPECTED_INJECTION "Text that reads like an instruction"; LOW_CONFIDENCE "By hand"; MASS_BALANCE "Mass balance"; ASKED_CHAIR "Asked Ernesto".

**Statement plan.** One IC-01 type serves the templates, AI-8, the audio manifest and PaminawaPlayer: `StatementPlan { lineId, lang, sentences: { id, slot, text, placeholders[], mentions: { ref: 'slip:0403', placeholder }[] }[] }`.
- Slots, in order: GREETING, DELIVERY, PREMIUM, BONUS, DEDUCTION (zero or more), CREDIT (zero or one), PAY, SOURCES, HELP, AI_NOTE.
- Placeholders: HONORIFIC_NAME, KG_TOTAL, GRADE_SUMMARY, PAYER, PREMIUM_USD, BONUS_USD, DEDUCTION_USD, RULE_LABEL, RULE, BR, CREDIT_USD, WRITTEN_PHP, SLIP, NET_USD, NET_PHP, FX_FEE, CASH_DATE, SLIPS, TREASURER.
- The names follow S4.5 wherever S4.5 defines them; WS-CORE publishes the final enum.
- The templates below are frozen for native review (S1.13). S4 decides when an AI-8 variant may replace one; a variant must keep the same slot and placeholder set.

| Slot         | ceb                                                                                                                                          | fil                                                                                                                                                               | en                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| GREETING     | Maayong adlaw, {{HONORIFIC_NAME}}. Salamat sa inyong paghago.                                                                                | Magandang araw po, {{HONORIFIC_NAME}}. Salamat po sa inyong pagsisikap.                                                                                           | Good day, {{HONORIFIC_NAME}}. Thank you for your hard work.                                                                         |
| DELIVERY     | Nagdala mo og {{KG_TOTAL}} nga uga nga cacao, {{GRADE_SUMMARY}}.                                                                             | Nagdala po kayo ng {{KG_TOTAL}} na tuyong cacao, {{GRADE_SUMMARY}}.                                                                                               | You delivered {{KG_TOTAL}} of dried cacao, {{GRADE_SUMMARY}}.                                                                       |
| PREMIUM      | Premium gikan sa {{PAYER}}: {{PREMIUM_USD}}, walay kaltas.                                                                                   | Premium mula sa {{PAYER}}: {{PREMIUM_USD}}, walang kaltas.                                                                                                        | Premium from {{PAYER}}: {{PREMIUM_USD}}, with no deductions.                                                                        |
| BONUS        | Bonus sa kalidad: {{BONUS_USD}}.                                                                                                             | Bonus sa kalidad: {{BONUS_USD}}.                                                                                                                                  | Quality bonus: {{BONUS_USD}}.                                                                                                       |
| DEDUCTION    | Gikaltasan og {{DEDUCTION_USD}} para sa {{RULE_LABEL}} ({{RULE}}, {{BR}}).                                                                   | Binawasan po ng {{DEDUCTION_USD}} para sa {{RULE_LABEL}} ({{RULE}}, {{BR}}).                                                                                      | Less {{DEDUCTION_USD}} for {{RULE_LABEL}} ({{RULE}}, {{BR}}).                                                                       |
| CREDIT       | Ang {{WRITTEN_PHP}} nga kaltas sa resibo {{SLIP}} wala sa rate card nga giaprobahan sa Board, mao nga gibalik kini kaninyo: {{CREDIT_USD}}.  | Ang {{WRITTEN_PHP}} na bawas sa resibo {{SLIP}} ay wala po sa rate card na inaprubahan ng Board, kaya ibinabalik po namin ito: {{CREDIT_USD}}.                    | The {{WRITTEN_PHP}} deduction on slip {{SLIP}} is not on the rate card the Board approved, so it comes back to you: {{CREDIT_USD}}. |
| PAY (PayPal) | Ang inyong bayad karong season: {{NET_USD}}, sa inyong PayPal. Kung ilisan sa peso, mga {{NET_PHP}} human sa {{FX_FEE}} nga bayad sa PayPal. | Ang inyong bayad ngayong season: {{NET_USD}}, sa inyong PayPal. Kapag pinalitan sa piso, humigit-kumulang {{NET_PHP}} matapos ang {{FX_FEE}} na singil ng PayPal. | Your pay this season: {{NET_USD}}, to your PayPal. Changed to pesos, about {{NET_PHP}} after PayPal's {{FX_FEE}} fee.               |
| PAY (cash)   | Ang inyong bayad karong season: {{NET_PHP}}, cash sa bodega sa {{CASH_DATE}}.                                                                | Ang inyong bayad ngayong season: {{NET_PHP}}, cash sa bodega sa {{CASH_DATE}}.                                                                                    | Your pay this season: {{NET_PHP}}, in cash at the bodega on {{CASH_DATE}}.                                                          |
| SOURCES      | Gikan kini sa inyong resibo {{SLIPS}}.                                                                                                       | Galing po ito sa inyong mga resibo {{SLIPS}}.                                                                                                                     | It comes from your slips {{SLIPS}}.                                                                                                 |
| HELP         | Naa moy pangutana? Adto kang Treasurer {{TREASURER}} sa bodega.                                                                              | May tanong po kayo? Lumapit po kay Treasurer {{TREASURER}} sa bodega.                                                                                             | Questions? See Treasurer {{TREASURER}} at the bodega.                                                                               |
| AI_NOTE      | Ang inyong mga resibo gibasa sa AI (Claude) ug gisusi ni Treasurer {{TREASURER}}.                                                            | Ang inyong mga resibo ay binasa ng AI (Claude) at sinuri ni Treasurer {{TREASURER}}.                                                                              | Your slips were read by AI (Claude) and checked by Treasurer {{TREASURER}}.                                                         |

The credit sentence carries both the pesos written on the slip and the dollars returned, so both placeholders exist in every section that uses it.

AI_NOTE follows Anthropic's 2026 Usage Policy, in force from 12 Nov 2026. It requires telling people when AI was involved in recommendations about their finances or livelihood [S1-22]. Transcription that feeds a fixed formula may fall under the policy's exclusions, but every statement discloses anyway.

SMS preview (GSM-7, 154 characters): "Bulawanon Kakaw: Nang Celing, bayad na ang US$64.45 sa PayPal (mga P3,907 human sa 3% sa PayPal). Resibo 0403,0419,0436,0467. Pangutana: Treasurer Analyn."

**Formats** (deterministic `format.*`):
- Money: "US$64.45".
- Cash: "₱7,990.00", exact at the run's recorded rate.
- PayPal peso estimate: whole pesos after the `FEE_TABLE` conversion spread. In ceb "mga ₱3,907 … (gibanabana)", in fil "humigit-kumulang ₱3,907 … (tantiya)", in en "about ₱3,907 … (estimate)".
- Kilos and percentages: "148.0 kg", "1.62%".
- Fee rules: "2% per payment", "4.40% + US$0.30".
- Per-kg pool rates: "US$0.29523 a kg", console only.
- Identifiers: hashes in groups of four ("7f3a 91c2"); members "M-014"; slips "0403".
- Dates: "30 Okt 2026" in ceb and fil (months Ene, Peb, Mar, Abr, May, Hun, Hul, Ago, Set, Okt, Nob, Dis); "30 Oct 2026" in en.
- Times: "10:21:41"; elapsed "0:14" and "3 min 12 s".

### S1.12 Accessibility

- **Bar.**
  - WCAG 2.2 AA on the console, Proof and the web export [S1-24].
  - Statement copy at 7:1 contrast and non-text elements at 3:1, both checked on the tokens in CI.
  - Axe runs in Playwright on every state in this section.
  - TalkBack, 200% text and axe passes are due by G5 (6 Nov).
- **WCAG specifics.**
  - 2.1.4: D, ?, J and K can be turned off in W-TR-10. J and K act only while the row list has focus, and D is ignored in text fields [S1-25].
  - 2.4.11: drawers never cover the focused element. Below 1600 px they push content aside instead.
  - 2.5.7: crop zoom and pan have "+"/"−" buttons and arrow keys.
  - 2.5.8: console targets are at least 24 × 24 CSS px. App targets are 48 dp, primary actions 56 dp, and Paminawa and Pirmahi 64 dp.
  - 3.2.6: the Pangutana block is always last.
  - 3.3.7 and 3.3.8: no step asks for re-entry; pairing works by QR or code, and signing by biometric or device PIN.
- **Hold to commit.**
  - Every hold slab has a ConfirmDialog route, opened by its "another way" link, by Enter, or automatically when a native screen reader is on.
  - The dialog states the amount, recipients and consequence before asking for the key.
  - On web, the app never branches on `AccessibilityInfo.isScreenReaderEnabled`, because react-native-web always resolves it to true [S1-27].
  - With reduced motion, the hold shows a stepped bar with a percentage.
- **Screen readers.**
  - On M-MB-01 the amount, with its spoken phrase, takes first focus, and Paminawa second.
  - `format.amountSpoken` produces "sixty-four dollars and forty-five cents, about three thousand nine hundred seven pesos after PayPal's fee, estimate", or for cash "seven thousand nine hundred ninety pesos, cash". Cebuano and Filipino keep English number words until review.
  - Slabs announce label, amount and consequence: "Approve 8 payouts, 368 dollars 39 cents, moves money, button".
  - One `announce()` helper uses `AccessibilityInfo.announceForAccessibility` on native and a polite `aria-live` region on web, where react-native-web's announce and focus calls do nothing [S1-27].
  - Announcements are throttled to one summary every 5 s ("3 of 8 confirmed"). Android views use `accessibilityLiveRegion="polite"` [S1-26].
  - Visualisations are hidden from screen readers and mirrored in the Data mode tables.
- **Language of parts.** Web marks spans with `lang="ceb"` and `lang="fil"`. React Native's `accessibilityLanguage` is iOS-only [S1-26], so on Android TalkBack reads ceb and fil with the device voice. Paminawa stays the primary audio path, and the README says so.
- **Large text.**
  - Web reflows at 200%.
  - Android is tested at font scale 1.3 and 2.0. Android 14 scales text non-linearly up to 200% [S1-28], so sp units size text only, never padding.
  - From 1.3×, statements stack into one column and the ReceiptBar becomes a list. The hero amount sets `maxFontSizeMultiplier={1.5}`.
- **Motion and feedback.**
  - The system reduced-motion setting switches every moment to its reduced version. Devices with 3 GB of RAM or less get the low-end tier.
  - Haptics only decorate and never carry meaning (`performAndroidHapticsAsync` with Confirm, Reject and Segment_Tick) [S1-34].
  - Web sound is off by default and stays silent under narration and Paminawa.
- **No inferred traits.** Listening first is the member's own choice. Nothing stores age, literacy, or whether a receipt mark is a signature or a thumbmark.

### S1.13 Localisation and review

- **Strings.** ICU MessageFormat through i18next 26.5.4, react-i18next 17.1.0 and i18next-icu, each pinned on install.
  - CI renders every key at 135% of its English length and in a pseudo-locale.
  - Members default to their registry language and can switch it on every member surface.
  - The console is in English but keeps the co-op's own words.
- **Plurals.** CLDR gives fil and ceb one shared cardinal rule, and en the one/other pair [S1-29]. Hermes and older Android ICU may lack `ceb` data (UNVERIFIED), so `@fairsplit/i18n` registers its own plural function. Most ceb and fil nouns do not inflect ("3 ka resibo").
- **Honorifics** come from the registry and are never guessed: Nang or Nong in ceb; Gng. or G. with "po" in fil; Mrs. or Mr. in en.
- **Audio.**
  - Gemini 3.8 Flash TTS lists Cebuano and Filipino, but not Hiligaynon, Waray or Bikol [S1-30]. Its quality and quota are tested in spike S10.
  - One clip per sentence, AAC at 32 kbps mono, with money read from word templates.
  - Pause markers around slip numbers let `tools/tts.ts` record the offset of each mention.
  - Clips are labelled "Sintetikong tingog" (ceb), "Sintetikong boses" (fil) or "Synthetic voice" (en), each with "(Gemini TTS)".
- **SMS.** GSM-7 only. ñ and Ñ are in the basic set but ₱ is not [S1-31], so the peso is written "P". Messages are 160 characters at most.
- **Native review (OD-2, moved earlier).**
  - Book a paid native Cebuano and Filipino reviewer by 26 Oct. This is the user's call, since it costs money. The scope is the roughly 90 member-facing keys: the S1.11 tables and the M-* screen copy.
  - Sign-off is due 31 Oct, recorded per key in `i18n/REVIEW.md`.
  - Texts freeze on 1 Nov (G3), and audio is generated on 3–4 Nov from the reviewed text.
  - The "pending native review" chip disappears only for keys that have been reviewed.
  - If no reviewer is booked by 30 Oct, the film does not open on Cebuano audio.
  - Every photo carries "Synthetic sample", in its alt text too.

### Sources

- [S1-1] https://www.fairtrade.net/content/dam/fairtrade/fairtrade-international/standards-spo-cocoa/Cocoa_SPO_EN.pdf
- [S1-2] https://www.fairtrade.net/content/dam/fairtrade/fairtrade-international/standards-spo-cocoa/Cocoa-Explanatory-Note_EN.pdf
- [S1-3] https://www.fairtrade.net/content/dam/fairtrade/fairtrade-international/standards-documents-as-of-14-11/fairer-futures-standard_EN.pdf
- [S1-4] https://eur-lex.europa.eu/eli/dir/2024/825/oj
- [S1-5] https://www.pna.gov.ph/articles/1245956
- [S1-6] https://developer.paypal.com/payouts/supported-features
- [S1-7] https://www.paypal.com/ph/cshelp/article/what-is-the-gcash-withdrawal-service-help1390
- [S1-8] https://help.gcash.com/hc/en-us/articles/360017595774-Cash-in-fees
- [S1-9] https://lawphil.net/statutes/repacts/ra2009/ra_9520_2009.html
- [S1-10] https://www.gmanetwork.com/news/money/economy/984131/bsp-filipino-account-ownership-down-to-50-in-2025-household-access-up-to-85/story/
- [S1-11] https://rsso11.psa.gov.ph/content/every-10-davaoenos-aged-10-64-years-old-9-have-basic-literacy-while-6-out-9-have-functional
- [S1-12] https://psa.gov.ph/major-non-food-industrial-crops/cacao
- [S1-13] https://devpost.com/software/supplora-pay
- [S1-14] https://devpost.com/software/clause-to-cash-contracts-that-collect
- [S1-15] https://devpost.com/software/tributary-executable-revenue-share-infrastructure
- [S1-16] https://devpost.com/software/sarafupay
- [S1-17] https://github.com/Jeremiah-Sakuda/harambee
- [S1-18] https://devpost.com/software/fair-split
- [S1-19] https://www.paypal.com/ph/business/paypal-business-fees (updated 28 Sep 2026)
- [S1-20] https://developer.paypal.com/payouts/payment-processing
- [S1-21] https://developer.paypal.com/docs/api/transaction-search/v1/
- [S1-22] https://www.anthropic.com/news/2026-usage-policy-update
- [S1-23] https://privacy.gov.ph/data-privacy-act/
- [S1-24] https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- [S1-25] https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html
- [S1-26] https://reactnative.dev/docs/accessibility
- [S1-27] https://github.com/necolas/react-native-web/blob/master/packages/react-native-web/src/exports/AccessibilityInfo/index.js
- [S1-28] https://developer.android.com/about/versions/14/features
- [S1-29] https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html
- [S1-30] https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts
- [S1-31] https://en.wikipedia.org/wiki/GSM_03.38
- [S1-32] https://docs.expo.dev/versions/v58.0.0/sdk/audio/
- [S1-33] https://docs.expo.dev/versions/v58.0.0/sdk/camera/
- [S1-34] https://docs.expo.dev/versions/v58.0.0/sdk/haptics/

### Register deviations

1. **IDs and routes.** Some are inferred, because my copy of the register began partway through §5. Where they differ, IC-01 wins. M-MB-02, M-MB-04, M-CK-02 and M-CK-03 are retired; W-TR-10 is now a sheet; the app has no navigation bar.
2. **WS-APP scope.** Register §11 lists the offline outbox and push for G2. Here, cut-order items 3 and 4 are applied now, the scanner is a gated P1, and cash attestation moves to W-TR-09.
3. **Payouts copy.**
   - Rhea's item is UNCLAIMED, not ERRPYO002.
   - The retry copy reads "Attempt 2 of 4", because the register allows three retries.
   - Live updates use SSE, not WebSocket.
   - The app is served at `/app`, not `/m`.
4. **Judge funding.**
   - FUNDED comes from the GET that runs right after record-payment (§8: "Record payment, then GET the invoice"). The webhook is logged when it arrives, and BEAT-PAID fires on FUNDED.
   - Judge invoices are sent under a seeded, labelled treasurer approval.
5. **Keys.** `fs-analyn-w1` is a persisted browser key. In Judge Mode, keys are made in the signer's browser for the session. The register names only `fs-ernesto-a1`.
6. **Fees.**
   - The design's lines "$0.25 × 8" and "2% = $7.37, both covered" are replaced by an estimate plus the fees PayPal reports. The US$60 line is renamed.
   - The seed stays at US$4,333.50. At PayPal PH rates, receiving this invoice alone would cost US$190.97 (4.40% + US$0.30), so WS-CORE should size the production disbursement line from `FEE_TABLE` (OD-10).
7. **Pesos.** Cash lines show exact pesos; PayPal lines show an estimate after PayPal's conversion fee. Design §2.3 showed "mga ₱4,028 (gibanabana)" instead.
8. **Proof.**
   - "Allocated" plus three "Paid" tiers replace "Premium paid to members: 100%".
   - Plate 4 adds cash receipts.
   - "8.1% of value" is dropped and latency moves to a technical row.
   - The footer no longer names prior art.
9. **Stage.** The run pill replaces the rail, and there is one phone at every width (design §6 had three frames at 1920 px and wider). The contact sheet does not glow.
10. **Tagline** (design §0). "Only PayPal says paid" replaces "PayPal makes it carbon".
11. **Prior art** (§10). The film line "They split money people already agreed on…" misdescribes SarafuPay and harambee and leaves out Supplora Pay. The contrast sentence in S1.1 is offered to the film and README owners.
12. **OD-2.** The reviewer is booked by 26 Oct and signs off by 31 Oct; the register's date was 5 Nov.
13. **Member link.** It uses a fragment token with a `jti`, and expires 14 days after cash day. The architecture had 30-day tokens in the URL path.
14. **Smaller inferences.**
    - Slip 0449 is quarantined without raising a hold (WS-CORE to confirm).
    - Slip 0462 reads "(0.40)".
    - Judge clone dates are +8 days (cash day) and +30 days (auto-cancel).
    - Davao functional literacy is 66.7%, not 70.8%.
    - The title card names BSP's 2025 survey.

### Review resolutions

- **PayPal engineer, W-TR-07 fee line (minor): fixed.** The pre-POST figure is labelled an estimate, from spike S4 or the last real run. W-TR-08 and Proof show only the summed `payout_item_fee`. The production line now names the PH domestic rate.
- **Design director, moment phase drift (blocker): fixed.**
  - S1 lists no phase names; `moments.ts` and `timelines.ts` are the only source.
  - The docs are generated and checked in CI, and S1 owns only `data-state`.
  - The glow, "You" cell and rate-format drifts are settled.
- **Design director, laptop widths and collisions (blocker): fixed.**
  - Added a breakpoint table and six snapshot sizes.
  - The pill replaces the rail. One phone docks at 1680 px and wider.
  - Drawers push content below 1600 px, and the grid shows five columns when narrow.
  - Added a stage director (landings 250 ms apart, true timestamps) and a one-time sound chip.
- **Design director, overclaims (major): fixed.** Proof splits "Allocated" from three "Paid" tiers, and plate 4 covers cash receipts. PayPal members see an estimate after PayPal's conversion fee, plus a ReceiptBar segment that names PayPal. Cash members see exact pesos.
- **Design director, polish spread too thin (major, ALL): fixed for S1.** Named the hero path, added a critique rubric before G1, listed the stock screens, and applied the cuts.
- **Design director, step 2, autoplay and the wait (major): fixed.** Step 2 is a masked one-digit entry, "Play it for me" was added, and the waiting pill points the judge to Proof.
- **Design director, accessibility gaps (minor): fixed.** Added a WCAG 2.1.4 toggle and focus-scoped keys. The amount takes first focus. "Paminawon una" is the member's own choice. Web uses `aria-live`, and the code avoids react-native-web's always-true screen-reader check.
- **Design director, "carbon" (minor): fixed.** New public line, and "carbon" is blocked in public copy. Trimming the 2:12 narration is the film owner's job.
- **Delivery lead, capacity (blocker, ALL): partly.** S1 drops four app screens and the command menu. Lanes, budget and merge queue belong to S5.
- **Delivery lead, contracts disagree (major, ALL): fixed on S1's side.**
  - Phase names come from S2.9.
  - One `StatementPlan` uses the S4.5 names.
  - The UI formats cents with `api-client`'s `format`.
  - `/s` answers with a 302 to `/app/s`.
  - Analyn's key is `fs-analyn-w1`.
  - The IC-12 messages are defined.
  - The spec-lint is requested from WS-QA.
- **Delivery lead, native scope (major): adopted, with one exception.** The scanner stays as a gated P1: spike S7 already tests it, it is about half a day of work, and it is dropped if not done by 1 Nov.
- **Delivery lead, step 2 and the cold-judge test (minor): fixed.** Added "Use logbook line 7", autoplay with a visible cursor, and the 60 s target measured by a cold-judge Playwright test and a first-time person.
- **Delivery lead, fee contradiction (minor): fixed,** the same way as the PayPal engineer's fee item.
- **Devpost veteran, differentiation (blocker, ALL): fixed for S1.**
  - Each similar project gets an accurate one-line description.
  - The suggested contrast sentence is used.
  - Prior art is gone from Proof, and the injection is no longer a marketing beat.
  - The film text, the README table size and the re-scan list go to their owners.
- **Devpost veteran, brand motive (major): fixed.**
  - Added Fairtrade requirements 4.3.4, 4.3.5 and 4.6.2, and Fairer Futures 3.2.1 and 3.2.2.
  - The EU link now runs through Lantern Bay's distributor.
  - Added the co-op counts, who pays and why PayPal.
  - Reordered the Proof metrics.
  - Added a "wait for Rhea to claim it" option (UNVERIFIED in the sandbox).
- **Devpost veteran, fee math (major): partly.** Fees now come from PayPal's reports and the PH fee table, including the fact that production fees exceed US$60. "Covered by Lantern Bay" is not claimed. Resizing the seed invoice is for WS-CORE and OD-10.
- **Devpost veteran, review timing (major): adopted** as an OD-2 change. Paying a reviewer is the user's call.
- **Devpost veteran, first words, autoplay and phone width (minor): fixed.** The top bar leads with the story; the disclaimers move to a caption and What's real. Added autoplay, a `phone-visit` layout below 1024 px, and a 390 px snapshot.
- **Devpost veteran, name (minor, ALL): partly.** Added the qualifier rule and the three-panel thumbnail. I recommend keeping the name; renaming is the user's call.
- **Security reviewer, money-movement framing (minor): fixed.**
  - Added the merchant-of-record sentence and the PH domestic fee line.
  - Renamed the US$60 line.
  - Fair Split's audit fee goes on a separate invoice.
  - Partner onboarding is listed as not built.
- **Security reviewer, member data (minor): fixed.**
  - Member links use a fragment token with a `jti`, rotation on reprint and a 14-day expiry, and every route sends no-referrer.
  - Nothing infers personal traits.
  - AI_NOTE is in every statement and its audio.
- **User's question ("you need actual 9 accounts?"): yes.** Nine US sandbox accounts (W-JG-02): one business account for the co-op, seven for the PayPal members, and one for the brand.
  - Only the brand's account is optional; it is needed for spike S5 and a filmed hosted-page payment.
  - The eight personal accounts can be created from one Bulk Account Upload CSV.
- **Length: over target.** The section is about 9,000 words, against the 7,500 target. The reviewers' additions (breakpoints, fees, the statement plan and the critique gate) account for the extra length. The cuts in S1.3 remove more build work than these additions add.
