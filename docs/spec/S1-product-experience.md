## S1. Product and Experience

_Precedence: Decision Register, then Design Direction, then Final Architecture (all 22 Oct). Figures come from the seed snapshot (`packages/seed/snapshot/season-2026A.json`, IC-03); UI renders them from data, never types them. `7f3a 91c2` stands in for the computed rate-card hash prefix, `r37` for the run sequence. Every Cebuano (ceb) and Filipino (fil) string is machine-translated, pending native review (OD-2), until signed off in `i18n/REVIEW.md`._

### S1.1 Product narrative

Fair Split is co-op payroll. A fair-trade brand pays one small PayPal invoice for an audited pay run. Claude reads the season's handwritten weigh-slips and the Board's rate card into typed rows and rules. A deterministic engine computes every member's line and holds what it cannot justify. The treasurer resolves holds and approves, and the Chair co-signs above US$300. Our typed Payouts tool posts the batch, verified item webhooks flip each statement to paid, members read or hear why their number is their number, and the brand verifies the chain in its own browser.

**Hero season (synthetic).** Bulawanon Kakaw Growers MPC (Calinan, Davao City, 64 members) shipped lot LB-PH-2026-03, 9,625 kg of dried cacao, to Lantern Bay Chocolate Co. (Oakland). The lot price goes by wire, off-PayPal. Invoice FS-2026A-r37 funds only the premium (9,625 kg × US$0.30 = 2,887.50), the quality bonus (9,240 kg Grade 1 × US$0.15 = 1,386.00) and disbursement (60.00): US$4,333.50.

**Why each side cares.**
- _Brand:_ cocoa falls under the EUDR from 30 Dec 2026 for medium and large operators [S1-1], and from 27 Sep 2026 the EU bans sustainability labels backed by neither a certification scheme nor a public authority [S1-2]. Dana needs evidence for a careful claim: "benchmarked", never "certified".
- _Treasurer:_ a bonded officer (RA 9520 Art. 56) [S1-3] splitting one payment across 64 people from paper. The rules she cannot bend are the rules nobody can bend against her.
- _Members:_ 50% of Filipino adults held a formal financial account in 2025 (BSP CFIS, adults 15+) [S1-4]; functional literacy in Davao Region is 66.7% (PSA FLEMMS 2024) [S1-5]. So statements lead with money, then audio, then the clerk's own handwriting, and cash members share the statement. Davao grows about seven of every ten kilos of Philippine cacao (PSA: 71.2%, Q2 2023) [S1-6].

**The line.** Public: "Claude writes in pencil. People sign in ink. PayPal makes it carbon." Builder rule: machines print, people press, PayPal lands. Title card: "Fair Split: co-op payroll". Prior-art sentence (Proof footer, README, film): "Clause-to-Cash, Tributary, SarafuPay and harambee split money people already agreed on. Fair Split turns paper into ratified rules and rows, binds the treasurer to a hashed rate card, and proves each payment on the member's phone and the brand's Proof."

**Three truths the screen shows without words.** The model never writes a number into a payout: machine output is flat pencil print with a provenance footer and never gets a button. Rules are bolted before facts: BR 2026-04 was hashed on 14 Mar 2026, and an edit gets 409 `RATE_CARD_RATIFIED` citing the hash. Money lands only when PayPal says so: approved amounts stay hollow, and jade appears only after a verified item webhook.

### S1.2 Personas

| Persona (hypothetical, synthetic data)                                        | Surface                                  | Must be able to                                                                       | Must never feel                              |
| ----------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Analyn R. Sumalinog (AS)**, Treasurer, bonded                               | Console, office laptop, hours a day      | Defend the run: 64 of 64 lines explained                                              | Blamed, or rushed into the irreversible step |
| **Ernesto P. Cabahug (EC)**, Chairperson                                      | App (board), budget Android, in his plot | Co-sign batches over US$300, lines over US$150 and overrides; compare the seal by eye | A rubber stamp                               |
| **Jessie D. Dumaguing (JD)**, clerk                                           | App (clerk), low-end Android, outdoors   | Photograph and upload every slip, signal or not                                       | Blamed for a hold; asked to retype           |
| **Nang Celing** (Consolacion Bacus, M-014), in her sixties, reads slowly, ceb | App (member), daylight                   | Know what she got, why, and from which slips; see "38.45" in Jessie's capitals        | Surprised by kaltas; talked down to          |
| **Rhea Jumawan** (M-031), en                                                  | App (member)                             | Get paid although her address has no PayPal account                                   | That the money vanished                      |
| **Merlyn Ponce** (M-053), cash                                                | 80 mm print                              | Collect US$127.84 (about ₱7,990) and thumbmark "Nadawat"                              | Accused over a big harvest                   |
| **Dana Whitfield-Santos**, sourcing, Lantern Bay                              | Proof, laptop                            | See six checks read "Matches" in her own browser                                      | Exposed by a claim she cannot evidence       |
| **A judge**                                                                   | `/judge` and own phone                   | See real sandbox IDs within 10 s, co-sign from their phone, reset                     | That it is staged                            |

### S1.3 End-to-end flows

**Real season.**
1. _Ratify, 14 Mar 2026 (W-TR-02)._ AI-5 reads BR 2026-04 into Schedule A (R0–R4), each rule quoting a clause found in the text layer. The Secretary certifies and the Chair attests. The card is hashed, and triggers block edits and any slip dated before `ratified_at`.
2. _Capture, 2 Apr–31 Aug (M-CK-01, M-CK-02)._ Jessie scans; the outbox uploads when signal returns; AI-1 to AI-4 read each capture; fields under 0.85 queue for W-TR-04.
3. _Invoice (W-TR-01)._ Code quotes. Claude (AI-7) drafts through Agent Toolkit 1.11.0 behind the policy lattice. Analyn sends (`sendNeedsTreasurer`), and the AUTO_CANCEL rule is set.
4. _Funding (W-PF-02)._ Dana pays on PayPal's hosted invoice page. A verified INVOICING.INVOICE.PAID, plus a fresh GET showing PAID with 0.00 due, makes the run FUNDED.
5. _Review, keys, settlement:_ W-TR-03 to W-TR-06; W-TR-07 with M-BD-01 and M-BD-02; W-TR-08 with M-MB-01.
6. _Cash day, 30 Oct (W-TR-09, M-CK-03)._ Analyn prints 80 mm statements; members sign or thumbmark; Jessie's attestation makes each line OFF_RAIL_PAID. The run is CLOSED when every line is terminal. Dana verifies and exports (W-PF-02).

**Judge Mode** (target: median time from first press to batch POST under 60 s).

| Step | Judge                                              | System                                                                                                                                                                   | On screen                                                  |
| ---- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 0    | Opens `/judge`                                     | Clones the showcase with a new `runSeq`; creates FS-2026A-r{n} from the recorded Claude draft, sends it under the seeded treasurer approval (labelled), sets AUTO_CANCEL | "Season 2026-A is ready to pay."; Member frame "Gisusi pa" |
| 1    | "Mark Lantern Bay's invoice paid (sandbox)"        | `recordPayment` (simulated rail); verified INVOICE.PAID; GET shows MARKED_AS_PAID, 0.00 due; FUNDED                                                                      | Jade arc, E4                                               |
| 2    | Watches; types 64.80, Enter                        | Replays `extract.row`; slip 0462 goes to W-TR-04                                                                                                                         | MM-2, AS stamp                                             |
| 3    | Resolves H1, H2, H3                                | Recompute; MASS_BALANCE clears at 1.62%                                                                                                                                  | MM-3, ink stamps                                           |
| 4    | Holds Space 1.6 s on "Approve 8 payouts"           | Key 1 (demo key)                                                                                                                                                         | Inner rings, QR card                                       |
| 5    | Co-signs by QR on own phone, or in the Chair frame | Key 2, APPROVED, re-hash, POST                                                                                                                                           | MM-5                                                       |
| 6    | "Pay in cash at the bodega" when Rhea parks        | Item webhooks, one cancel, one resend                                                                                                                                    | MM-6; MM-1 in the Member frame                             |
| 7    | Opens Proof, presses Verify; taps a peso           | Browser checks                                                                                                                                                           | Six "Matches"; MM-7                                        |
| 8    | Reset                                              | `judgeReset`                                                                                                                                                             | "Starting a fresh run. About 10 s."                        |

**Exception paths** (each has a state in the screen specs below):
- UNCLAIMED items and adopted or duplicate deliveries: W-TR-08.
- Send-back, voided approvals, hash mismatch, retries, DENIED and kill switches: W-TR-07 and M-BD-01.
- 429 circuit: W-JG-01.
- Unverifiable webhook and auto-cancel: W-TR-01.
- Clerk offline: M-CK-01.
- Member re-check: M-MB-02, M-MB-04 and W-TR-09.

### S1.4 Screen register and conventions

| ID            | Name                                       | Route                                                        |
| ------------- | ------------------------------------------ | ------------------------------------------------------------ |
| W-JG-01       | Judge stage                                | `/judge`                                                     |
| W-JG-02       | What's real (sheet)                        | `/judge`                                                     |
| W-TR-01       | Season                                     | `/console`                                                   |
| W-TR-02       | Rate card                                  | `/console/rate-card`                                         |
| W-TR-03       | Reading room                               | `/console/runs/:runSlug/reading`                             |
| W-TR-04       | By hand                                    | `/console/runs/:runSlug/by-hand/:fieldId`                    |
| W-TR-05       | Split review                               | `/console/runs/:runSlug/split`                               |
| W-TR-06       | Hold drawer                                | `/console/runs/:runSlug/split?hold=:holdId`                  |
| W-TR-07       | Approve                                    | `/console/runs/:runSlug/approve`                             |
| W-TR-08       | Run                                        | `/console/runs/:runSlug/run`                                 |
| W-TR-09       | Member line and print                      | `/console/runs/:runSlug/members/:memberNo`                   |
| W-TR-10       | Command menu and shortcuts                 | overlay                                                      |
| W-PF-01       | Proof (public)                             | `/p/:runId`                                                  |
| W-PF-02       | Proof, brand header                        | `/p/:runId` with a brand session                             |
| M-ON-01       | First run and pairing                      | `/app/pair`                                                  |
| M-MB-01 to 04 | Bayad, Resibo, Paminawa (sheet), Pangutana | `/app/member`, `/app/member/slips`, sheet, `/app/member/ask` |
| M-CK-01 to 03 | Scan, Outbox, Cash day                     | `/app/clerk`, `/app/clerk/outbox`, `/app/clerk/cash`         |
| M-BD-01, 02   | Co-sign request, Sign (sheet)              | `/app/board/runs/:runId`, sheet                              |

`runSlug` is `2026A-r37`. `/s/:token` is the signed member link; it opens M-MB-01 read-only.

**Conventions.**
- Screen roots carry `data-testid="<ID>"` and `data-state` (the state names below). Controls carry `data-testid="<ID>/<control>"`; moments carry `data-moment-phase` (S1.9).
- Copy lives in `@fairsplit/i18n` as ICU messages keyed `<ID>.<key>`. Amounts, kilos, dates and hashes arrive as arguments formatted by `format.*` (IC-02). UI code holds no user-facing literals.
- Printed values carry provenance footers: "Read by Claude (claude-opus-5-5)", "Computed by engine v1, rate card 7f3a 91c2", "Entered by Analyn", "PayPal, webhook, signature verified".
- Run screens subscribe once (`api-client.subscribe('run:<runId>')`), and SSE replays from `Last-Event-ID`. While disconnected the screen shows "Reconnecting. Showing changes up to 10:21:41." and polls every 5 s.
- A screen has at most two slabs, at most one of them d3. Slabs never go on navigation, filters, grid rows or status. Raw state names never render (S1.10).
- Dates come from data. PAID dates come from the item event; the cash day and auto-cancel date come from the run (showcase 30 Oct and 30 Nov 2026; judge clones shift both relative to the clone date).

### S1.5 Judge stage

**W-JG-01 Judge stage** (`/judge`, no login, rate-limited per IP).
- _Top bar:_ "Judge Mode. Real PayPal sandbox calls on US test accounts. Slip reading replays a recorded Claude run (29 Oct). People, slips and the co-op are synthetic." Links: "What's real", "Sound" (off by default, remembered per viewer) and "Reset". A live chip, "Proof: 5 of 8 confirmed", opens W-PF-01.
- _Main:_ the console on the left; on the right, a 420 px dock with one phone frame and tabs Member, Chair, Clerk (all three show at once at 1920 px or wider).
  - Frames run the Expo web export from `/app` with frame tokens: Nang Celing on M-MB-01 (ceb, Adlaw), Ernesto on M-BD-01, Jessie on M-CK-01.
  - Frame caption: "The app's web build, live. Native-only parts are labelled."
  - Ceb and fil surfaces carry one chip: "Machine-translated, pending native review".
  - The rail footer reads "Acting as Analyn R. Sumalinog, Treasurer (Judge Mode)".
- _First view:_ "Season 2026-A is ready to pay."; the 12 photos as a glowing contact sheet; the bolted BR 2026-04 plate; the invoice plate with US$4,333.50 hollow; one d2 slab; a ribbon of the last three run-log rows.
- _Run pill, in order:_
  1. "Next: mark the invoice paid (sandbox)"
  2. "Reading 12 photos. Replay of the 29 Oct run."
  3. "Next: enter slip 0462 by hand"
  4. "Next: 3 holds need you"
  5. "Next: approve 8 payouts"
  6. "Next: Ernesto co-signs. Use the Chair frame or your phone."
  7. "PayPal is confirming payments"
  8. "Next: decide on Rhea's payment"
  9. "Done. Open Proof."

  The next step's slab is pre-focused.
- _States:_
  - `queued`: "PayPal's sandbox is pacing us. You're next, about 40 s."
  - `resetting`: "Starting a fresh run. About 10 s."
  - `circuit`: "PayPal's sandbox asked us to slow down. For 6 minutes, PayPal steps replay the last live run, labelled."
  - `balance-low`: "The sandbox balance is low. Payouts pause until it's topped up; everything else works."
  - `ai-off`: "Live slip reading is off. The recorded run still plays."
  - `paypal-off`: "Live PayPal calls are off. PayPal steps replay the last live run, labelled."
  - `start-failed`: "We couldn't start a run.", with "Try again" and the request ID.

**W-JG-02 What's real** (sheet).
- _Real:_ the Toolkit invoice, its send and its AUTO_CANCEL rule; record-payment with its verified INVOICING.INVOICE.PAID (MARKED_AS_PAID, a simulated rail); the typed Payouts POST and verified item webhooks; Rhea's UNCLAIMED, our cancel, RETURNED; one real resent duplicate; one postback verification; two Ed25519 signatures.
- _Replayed:_ Claude's reading, recorded 29 Oct ("Read a slip live" runs one slip for real).
- _Simulated:_ push banners in the frames, the biometric step (a labelled demo key), the scanner (sample slips), SMS.
- _Seeded:_ the judge workspace's invoice-send approval, the 54 earlier photos (dated), cash receipts.
- _Synthetic:_ people, co-op, brand, slips (OpenAI's image model via Codex CLI), voice (Gemini TTS).

### S1.6 Treasurer console

Shell: a flat 220 px rail (Season, Rate card, Reading room, Split review, Approve, Run), the Run pill top centre, Ctrl+K (Cmd+K on macOS) anywhere, and D for Data mode.

**W-TR-01 Season.**
- _Content:_ stencil "2026-A" with "Bulawanon Kakaw Growers MPC, Calinan". RunStrip: Ratified 14 Mar, Funded, Read, Checked, Approved, Paid, each lit per register §7. Pools: "Premium US$2,887.50" (lock, "never deducted, R0"), "Quality bonus US$1,386.00", "Disbursement US$60.00".
- _Invoice plate:_ "Invoice FS-2026A-r37, US$4,333.50", three lines, memo "Season 2026-A, RC 7f3a 91c2, lot LB-PH-2026-03", "Drafted by Claude with the PayPal Agent Toolkit. Sent by Analyn.", "Auto-cancels 30 Nov 2026 if unpaid." The amount is hollow until FUNDED; the INVOICE.PAID arc lands here.
- _Eval waffle:_ 40 cells from `eval/report/latest.json`. Ink marks an exact row, a canary outline a case routed to a person, red an unsafe auto-accept. Caption: "40 labelled synthetic cases. Exact rows {exact} against an OCR-only baseline of {baseline}. Unsafe auto-accepts {unsafe}. Run {date}."
- _Next action:_ one linked sentence ("3 holds need you", "1 re-check request from M-014").
- _Events:_ `invoice.state`, `run.state`, `webhook.received`, `policy.verdict`, `hold.raised`.
- _States:_
  - `unratified`: "Ratify a rate card before the first slip."
  - `drafted`: the plate in pencil, with the d2 slab "Send to Lantern Bay".
  - `draft-refused` (shown only when it really happens): "Claude's draft didn't match the code's quote, so policy refused it (invoiceEqualsQuote). Claude is drafting again."
  - `waiting`: "Sent to Lantern Bay. Waiting for payment."
  - `unverified`: "A payment notice arrived that we couldn't verify. Nothing starts until PayPal confirms."
  - `funded`: "Paid by Lantern Bay." or "Marked as paid in sandbox."
  - `auto-cancelled`: "Invoice auto-cancelled on 30 Nov. Send a new one."
  - `offline`: "You're offline. Showing the last copy from 10:21. Actions are paused."

**W-TR-02 Rate card.**
- _Content:_ on the left, the BR 2026-04 pages as paper ("Synthetic sample"). On the right, Schedule A printed flat:
  - R0 "Premium is paid by verified kilos and is never deducted."
  - R1 "CBU: 5% of the bonus until ₱5,000 is paid up."
  - R2 "Hauling: ₱1.50 a kg for purok pickups."
  - R3 "Loan: only with a signed Authority to Deduct, up to 50% of the bonus."
  - R4 "Advance: only with a voucher, up to 30% of the bonus."

  Then the hold rules (1.6 kg a tree, mass balance ±2.0%, confidence 0.85) and the co-sign rule (batch over US$300, line over US$150, any override). Hovering a rule highlights its clause on the scan. Footer: "Read by Claude (claude-opus-5-5). Quote found on page 2."
- _Bolted plate:_ "sha256 7f3a 91c2, sealed 14 Mar 2026 by BR 2026-04".
- _Actions:_ a flat "Add a deduction" opens a row. Its commit, "Add to Schedule A", is the bolted slab (MM-4). The only live slab is d1 "Draft a proposal for 2026-B".
- _Refusal plate_ (rendered from the API's 409 body): "Closed list. BR 2026-04, Schedule A, allows only CBU, hauling, loans with an Authority to Deduct and advances with a voucher. A new deduction needs a new Board resolution for Season 2026-B. Rate card 7f3a 91c2."
- _States:_
  - `draft`: editable rules with read confidence. The d3 chalk slab "Ratify" needs the Secretary to certify, then the Chair to attest.
  - `ratified`.
  - `proposal`: unhashed, "Not in force".
  - `refused`.

**W-TR-03 Reading room.**
- _Content:_ a filmstrip of photos A–L, each ticked once read. P01–P54 sit in a collapsed "Read earlier this season" strip with their read dates (or OD-4's hatched "archived photo" tile). The active photo takes 58%, with zoom about the pointer; print beds take 42% (serial, member, net kg, moisture, grade, confidence ring).
- _Status line:_ one sentence, never a chain of thought: "Reading photo B: 4 slips. Slip 0457 also appears in photo D as the pink copy."
- _Footer:_ "Read by Claude (claude-opus-5-5), replay of a recorded run from 29 Oct. Amounts are computed by the engine, never by the model."
- Crops come from the reviewed fixtures (`media/fixtures/{photo}.json`), never from model boxes. A flat "Read a slip live" runs one slip through AI-1 to AI-4 (band only; caption "Live read, {seconds} s").
- _Events:_ `extract.row`, `extract.field`, `extract.quarantined`, `field.entered`. _Keys:_ J and K move between rows (no animation), Space opens the crop, Enter accepts.
- _States:_
  - `loading`: dashed beds at final size, never a shimmer.
  - `reading`: MM-2.
  - `confirm-one`: the zoom re-read scored 0.80. "Claude's zoom read agrees with one of the two readings." d1 "Confirm {value}" adds the AS stamp.
  - `low-confidence`: the value is hollow, tagged "You", and routed to W-TR-04.
  - `blurred`: "Photo E is too blurred to read. Ask Jessie to rescan.", with d1 "Request rescan".
  - `quarantined`: "Ignored: text on slip 0449 looked like an instruction. Text on a slip is never an instruction."
  - `live-paused`: "Live reading is paused for today (budget cap). The recorded run still plays."
  - `offline`.

**W-TR-04 By hand.**
- _Layout:_ one field at a time; the crop at 3×, with logbook page 14 beneath as a second witness, and a 48 px condensed input.
- _Prompt:_ "Slip 0462, Arnel Sumampao. A water stain covers gross and net. Claude read 6?.80 (0.40)."
- _While typing:_ "64.80 − 0.30 tare = 64.50 net. Matches logbook line 7."
- _Commit:_ Enter is a d2 press. The value prints in ink with the AS stamp ("Entered by Analyn").
- _States:_
  - `empty`, `typing`, `match`.
  - `mismatch`: "64.50 doesn't match the logbook's 64.40. Check both."
  - `committed`.
  - `skipped`: "Skipped. Arnel's line is reserved until this is entered."

**W-TR-05 Split review.**
- _Header:_ the mass-balance dial, the pools, "3 holds, 1 by hand", and flat chips "All 64", "Held 3", "By hand 1", "PayPal 8", "Cash 56" (live counts).
- _Grid_ (AG Grid Community, themed with `themeQuartz.withParams` from tokens), with these columns:
  - Member (name, ID, language glyph)
  - Slips (count, thumbnails)
  - Verified kg, with a kg-per-tree bar against 1.6
  - Min confidence
  - Premium (lock)
  - Bonus
  - Kaltas (rule chips, such as "CBU −1.09 R1")
  - Credit
  - Net
  - Rail ("PayPal", or hatched "Cash")
  - Status (S1.10)
- _Pinned totals:_ "Gross = pool, to the cent (4,273.50). Net + ruled deductions − credits = pool." _Tooltip:_ "148.0 kg × US$0.29523 a kg, R0, engine v1."
- _Rows:_ held rows get a 3 px canary rule, a glyph and "Gisusi pa". Reserved rows read "Reserved, never redistributed." Cells changed by PayPal wash jade; cells changed by an engine recompute wash pencil. Enter opens W-TR-06 or W-TR-09.
- _States:_
  - `loading`: skeleton rows.
  - `empty`: "No lines yet. They appear once the slips are read."
  - `ready`.
  - `declined`: a red banner, the only red on this screen.

**W-TR-06 Hold drawer** (560 px; the gate chip is always visible).

|                                   | H1 duplicate (Nong Dioning, slip 0457, 42.0 kg)                                                                                                                                              | H2 yield (Merlyn Ponce, M-053)                                                                                                                        | H3 no rule (Nong Tidoy, slip 0458)                                                                                                                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine line                       | "Slip 0457 is in two photos: the white original (B) and the pink duplicate (D). Counting both moves US$17.94 from 63 members to Nong Dioning and puts shrink at 2.05%, over the 2.0% limit." | "Merlyn Ponce: 300.0 kg from 140 registered trees is 2.14 kg a tree. The limit is 1.6."                                                               | "'Multa (absent GA) ₱200' on slip 0458 matches no Schedule A rule. It was netted from Nong Tidoy's cash at the bodega, so it returns as a US$3.20 correction credit paid by the co-op, not from Lantern Bay's pool. Hauling ₱91.20 (R2) stays." |
| Claude's line (pencil, no digits) | "The second image is the office's pink copy of the same receipt."                                                                                                                            | "Her deliveries suggest a second plot that isn't in the registry yet."                                                                                | "The clerk noted a fine for missing the general assembly."                                                                                                                                                                                      |
| Gate                              | Blocks approval. Changes kilos.                                                                                                                                                              | Blocks approval. Changes kilos.                                                                                                                       | Reserves this line only. Never redistributed.                                                                                                                                                                                                   |
| Actions                           | d2 "Count it once"; flat "These are two deliveries" (needs a reason, then the Chair)                                                                                                         | d2 "Register a plot" (P-053-B, 0.60 ha, 330 trees; the plot point stays private), then "300.0 kg from 470 trees is 0.64 kg a tree. Inside the limit." | d2 "Return the ₱200 as a credit"                                                                                                                                                                                                                |

If AI-7 proposed an action, a pencil caption "Suggested by Claude" marks it.

_States:_
- `open`, `resolving`.
- `resolved`: flush ink, AS stamp and time.
- `asked-chair`: "Asked Ernesto".
- `conflict`: "Ernesto is viewing this hold".

**W-TR-07 Approve** (one centred 640 px column, no cards).
- _Top to bottom:_
  1. The seal (200 px, no rings).
  2. "US$368.39" (72 px, pencil).
  3. "8 payouts by PayPal", over a hatched rail bar: "56 members, US$3,849.78, cash at the bodega on 30 Oct".
  4. "PayPal fees: sandbox $0.25 × 8 = $2.00. In production to the Philippines, 2% = $7.37. Both covered by Lantern Bay's $60.00 disbursement line."
  5. Printed: "3 holds resolved. 1 field entered by hand. Shrink 1.62%, inside 2.0%. 64 of 64 lines explained. Rate card unchanged since 14 Mar."
  6. The d3 jade slab (560 × 64) "Approve 8 payouts", captioned "Hold to approve", with the link "Can't hold? Approve another way".
  7. Key slots: "Analyn R. Sumalinog, Treasurer" and "Ernesto P. Cabahug, Chairperson. Needed: batch over US$300 (Schedule A)."

  In Judge Mode both key slots read "Demo key", and a QR card says "Co-sign as Ernesto from your own phone. Uses a labelled demo key."
- _States:_
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
- _Layout:_ the split fan (MM-6) on top. Below it, the three-lane log (Machine, People, PayPal), newest first, and latency dots from INVOICE.PAID to each SUCCEEDED, with p50 and maximum.
- _Log rows_ lead with plain words, with detail in caption type underneath. Example: "Paid Consolacion Bacus US$64.45" over "PAYMENT.PAYOUTS-ITEM.SUCCEEDED, item 5KX…, webhook, signature verified".
  - One row per live run carries the postback badge "PayPal: SUCCESS".
  - A duplicate delivery logs "Delivery repeated, already applied."
  - An adopted batch logs "PayPal already had this batch. Adopted it; nothing was sent twice."
- _Rhea:_ "Rhea Jumawan's address has no PayPal account, so PayPal parked US$26.65 as unclaimed. It returns to the co-op by itself after 30 days, or you can decide now." [S1-18]
  - d2 "Pay in cash at the bodega": cancel, RETURNED, cash due. The row then reads "Returned to the co-op's PayPal balance. Cash at the bodega on 30 Oct."
  - flat "Re-send after Rhea confirms her email": a new one-item batch `…-x1`, approved with the treasurer's hold.
- _States:_
  - `waiting`: "Posted 10:21:41. PayPal confirms each payment as it lands.", with an elapsed timer. A reconcile GET that flips a row says "Confirmed by a status check".
  - `parked`.
  - `denied`: "No money moved."
  - `done`: "7 paid by PayPal. 57 in cash. US$21.14 returned to members. Invoice to last confirmation 3 min 12 s."

**W-TR-09 Member line and print.**
- _Content:_ the ReceiptBar; slips with crops; the line history ("Approved by AS and EC", "Sent", "Paid 30 Oct"); the statement in the member's language, with a language switch; an SMS preview labelled "Preview, not sent", with its GSM-7 count; open re-check requests.
- _Actions:_ d1 "Pair a phone" shows a single-use QR, valid for 10 minutes, plus a 6-digit code.
- _Print statement_ (`@page { size: 80mm auto }`): big amount, black seal, QR to the member link with audio, rate-card hash, slip numbers, a "Nadawat" box for a signature or thumbmark, and a witness line.
- _States:_ `held`, `ready`, `paid`, `cash-due`, `cash-received`, `parked`, `request-open`.

**W-TR-10 Command menu and shortcuts.**
- Ctrl+K lists every action with its shortcut, plus Theme (Tablea, Adlaw), Sound and Data mode.
- "?" opens the shortcuts, grouped by task (Read, Review, Approve, Run).
- D swaps the dial, fan, arc and waffle for tables and shows the seal as its hash. It is ignored while typing.

### S1.7 Proof

**W-PF-01 Proof** (`/p/:runId`, public, light only, one 680 px column).
- _Hero:_ if the invoice is PAID: "Lantern Bay paid US$4,333.50 for Season 2026-A. Here is where it went." If MARKED_AS_PAID: "Lantern Bay's US$4,333.50 invoice for Season 2026-A was marked paid in sandbox. Here is where it went." Below: the seal at 320 px, the stencil "LB-PH-2026-03", and d1 "Verify in your browser".
- _Chain:_ six plates on one rule, each expanding in place:
  1. Invoice: FS-2026A-r37, status, reference `rc:7f3a91c2…`.
  2. Rate card: hash, ratified 14 Mar 2026, first slip 2 Apr.
  3. Slips: 264 in 66 photos, with photo hashes.
  4. Lines: 64 line hashes and the conservation check.
  5. Two keys: `fs-analyn-a1`, `fs-ernesto-a1`, batch hash.
  6. Payout items: `sender_item_id` (for example `r37-M-014`), `payout_item_id`, webhook event IDs.
- _Verify:_ six checks turn from "Checking" to an ink check and "Matches":
  1. The invoice reference carries the card hash.
  2. The card re-hashes to the published value.
  3. The photo hashes match.
  4. The line hashes recompute and sum to the pool.
  5. Both signatures verify over the batch hash.
  6. The items match the signed batch.
- _Metrics:_
  - "Lines explained: 64 of 64".
  - "Premium paid to members: 100%, no deductions".
  - "On PayPal: 7 of 64 members, 8.1% of value". This counts PAID lines, so it climbs as items land; the rest is hatched "Cash at the bodega".
  - "Holds caught: 3. US$21.14 returned to members."
  - The eval waffle.
  - "Invoice to last confirmation: 3 min 12 s".
- _Plot field:_ dots sized by kilos, captioned "Positions are abstract. Plot coordinates are shared with Lantern Bay under the data-sharing agreement, never published." Members appear by ID only, never by name (RA 10173) [S1-7].
- _Footers:_
  - "Reconciliation with PayPal's Transaction Search runs nightly; new transactions can take up to 3 hours to appear there." [S1-8]
  - "A sandbox prototype on a synthetic Davao cacao co-op. No real farmer was paid."
  - The prior-art sentence.
- _States:_
  - `none`: "No pay run yet for this season."
  - `progress`: plate 6 reads "Waiting for PayPal. 3 of 8 confirmed."
  - `verified`.
  - `failed` (red, naming the plate): "The batch hash doesn't match the signed batch. Proof withheld."

**W-PF-02 Proof, brand header** (same route, shown with a brand session; cut-order item 5).
- _Header strip:_ "Invoice: paid" or "Invoice: marked as paid in sandbox"; "Export proof (CSV and JSON with hashes)", built in the browser; and d1 "Request the next audited pay run", which copies a prefilled request (nothing leaves the sandbox).
- _Data:_ member names show under the data-sharing agreement; plot coordinates appear only in the export.
- _States:_
  - `unpaid`: d2 "Pay invoice in PayPal" opens `recipient_view_url`, PayPal's hosted page.
  - `progress`.
  - `mismatch`: proof withheld.

### S1.8 Fair Split app

The app uses a Material 3 navigation bar built from our tokens (M3 recommends three to five destinations [S1-9]), edge-to-edge layout, and predictive back (`android.predictiveBackGestureEnabled`, UNVERIFIED on SDK 58's stack).
- _Member:_ Bayad, Resibo, Pangutana (fil: Bayad, Resibo, Tanong; en: Pay, Slips, Questions).
- _Clerk:_ Scan, Outbox, Cash.
- _Board:_ Pirma (Sign), Bayad, Pangutana. The board's Bayad shows Ernesto's own statement if the registry lists him as a member; otherwise it shows the run summary and a Proof link.

**M-ON-01 First run.**
- _Language:_ plates "Cebuano", "Filipino", "English", each with a play button ("Maayong adlaw.", "Magandang araw po.", "Good day."), and a disabled row "Hiligaynon, Waray, Bikol: wala pa (not yet)".
- _Theme:_ "Unsa ang mas klaro nimo?" over the statement in Adlaw and in Tablea.
- _Pairing:_ "Pangayo sa treasurer sa inyong QR." The QR binds device, role and workspace.
- _States:_
  - `camera-denied`: a 6-digit code.
  - `expired`: "Nag-expire na kini nga code. Pangayo og bag-o sa treasurer."
  - `paired`.

  Judge frames skip this screen.

**M-MB-01 Bayad (statement).** The white original copy, radius 0. Top to bottom:
1. Co-op and season.
2. "Maayong adlaw, Nang Celing. Salamat sa inyong paghago."
3. "US$64.45" (48 sp) over "mga ₱4,028 (gibanabana)".
4. The status capsule.
5. Paminawa: a full-width 64 dp d1 slab that takes first focus.
6. ReceiptBar: "Premium 43.69, walay kaltas", "Bonus 21.85", "CBU −1.09 (R1, BR 2026-04)".
7. Slip chips 0403, 0419, 0436, 0467.
8. History: "Giaprobahan ni AS ug EC", "Gipadala", "Bayad na".
9. Footer seal: "Rate card 7f3a 91c2, giaprobahan sa Board".
10. "Naa moy pangutana? Adto kang Treasurer Analyn sa bodega."
11. Flat "Ipasusi pag-usab".

MM-1 and MM-7 play here.

_States:_
- `checking`: "Gisusi pa". No amount; kilos, slips and the expected date.
- `held-line`: "Gisusi pa ang usa ka linya. Si Treasurer Analyn ang mohukom.", with a date.
- `sent` (hollow amount): "Gipadala na, naghulat sa PayPal 0:14". The ring stops after 60 s.
- `paid` (jade flush): "Bayad na, 30 Okt".
- `cash-due` (hatched, hollow amount): "Andam sa bodega, 30 Okt".
- `cash-received`: "Nadawat".
- `unclaimed`: "Wala madawat sa PayPal. Si Treasurer Analyn ang mohukom kung ibalhin sa cash."
- `paypal-held`: "Gipugngan sa PayPal samtang gisusi."
- `needs-action`: "Wala molampos sa PayPal. Si Treasurer Analyn ang motabang."
- `reversed`: "Gibawi ang bayad. Gisusi ni Treasurer Analyn."
- `offline`: "Katapusang kopya, 10:21".

**M-MB-02 Resibo.**
- _Content:_ her slips, each a 720 px WebP crop (low resolution first) with serial, date and net kg. Vouchers show as typed documents. "Dili tugma?" opens a re-check.
- _States:_ `loading`, `list`, `voucher`, `offline`.

**M-MB-03 Paminawa.**
- _Content:_ the transcript at 22 sp with the current sentence underlined; play/pause at 72 dp; "Hinay" plays at 0.85× (`setPlaybackRate`); language chips; lock-screen controls (`setActiveForLockScreen`, which needs `interruptionMode: 'doNotMix'`) [S1-10]; the label "Sintetikong tingog (Gemini TTS)".
- When the voice says "resibo 0403", that chip rises 8 dp for 1.2 s.
- _States:_
  - `playing`, `paused`.
  - `device-voice`: "Tingog sa telepono", used when a clip is missing.
  - `filipino-audio`: "Audio sa Filipino; teksto sa Cebuano", used if spike S10 fails.
  - `offline`.

**M-MB-04 Pangutana.**
- _Content:_ "Treasurer Analyn R. Sumalinog, opisina sa bodega", and the member's right to see records: "Aduna moy katungod nga motan-aw sa mga rekord sa co-op." (RA 9520 Art. 83).
- _Action:_ "Ipasusi pag-usab" sends the line, the slip and an optional note to the Mediation and Conciliation Committee (Art. 43) [S1-3].
- _States:_
  - `none`.
  - `sent`: "Nadawat sa Komite."
  - `answered`: the committee's reply in ink, initialled.

**M-CK-01 Scan.**
- _Layout:_ a top app bar with the station chip "Purok 2 pickup", and one FAB, "Scan resibo".
- _Capture:_ the FAB calls `CameraView.scanDocumentAsync()` (ML Kit on Android; returns `null` on cancel or when unavailable) [S1-11], falling back to the camera with an edge guide. Pages are copied out of the cache, resized to 1,600 px, hashed and queued.
- _Rescan requests_ arrive as a banner: "Gihangyo ni Analyn nga i-scan pag-usab ang photo E."
- _States:_
  - `ready`.
  - `offline`: "Walay signal. 3 ka resibo natipigan sa telepono."
  - `quality`: "Ngitngit kaayo. I-scan pag-usab."
  - `duplicate-file`: "Napadala na sa 09:12."
  - `scanner-unavailable`.

  In Judge Mode the screen offers sample slips and files captures for the next pay run.

**M-CK-02 Outbox.**
- _Content:_ per capture, a thumbnail, the serial once read, the member hint, the file size and a progress ring.
- _States:_
  - `queued`, `uploading`, `uploaded`.
  - `read`: "4 ka linya nabasa".
  - `failed`: "Mosulay pag-usab sa 40 s", with "Ipadala karon".

**M-CK-03 Cash day.**
- _Content:_ off-rail members at this station, with hollow amounts. Scanning a printed statement's QR jumps to that member.
- _Action:_ after a signature or thumbmark, d2 "Markahi nga nadawat" records Jessie's attestation (OFF_RAIL_DUE to OFF_RAIL_PAID).
- _States:_
  - `due`.
  - `received`: the JD stamp.
  - `offline`: attestations queue.

**M-BD-01 Co-sign request.**
- _Push_ (cuttable; the frames show a labelled banner instead): "Co-sign Season 2026-A: 8 payouts, US$368.39", with the seal.
- _One scroll, top to bottom:_
  1. The amount.
  2. Why him: "Ang batch milapas sa US$300."
  3. The three resolved holds, with resolver initials.
  4. The seal and the batch hash in groups of four, to compare with the console.
  5. "Analyn is on the approval screen".
  6. Flat "Ipabalik kang Analyn" (needs a reason).
- Opening a hold emits `presence`.
- _States:_
  - `request`.
  - `override`: H1's two-deliveries request, with Analyn's reason; d2 "Uyon ko", flat "Dili".
  - `expired`.
  - `changed`: "The batch changed after you opened it. Nothing was signed. Review again."
  - `offline`: "Kinahanglan og signal aron makapirma. Dili kini ipadala sa ulahi."

**M-BD-02 Sign.**
- _Slab:_ d3 jade "Pirmahi", 64 dp, in the thumb zone, captioned "Kupti, dayon gamita ang inyong fingerprint."
- _Sequence:_ hold 1,200 ms, then the biometric or device PIN, then an Ed25519 signature over the JCS payload with `fs-ernesto-a1`.
- _Result:_ "Napirmahan. Key fs-ernesto-a1. Parehas ang batch hash sa console." Web frames say "Demo key".
- _States:_
  - `ready`, `holding`, `biometric`, `signed`.
  - `cancelled`: the slab springs back; nothing is signed.
  - `mismatch` (with the clack): "Lahi ang batch hash. Walay napirmahan."

### S1.9 Magic moments in product terms

The phase names below are the `data-moment-phase` values in `packages/motion/moments.ts` (IC-10). Numbers are milliseconds from the trigger; the full choreography is in design §7. Assertions wait for the last phase, and each reduced-motion version must reach the same final `data-state`.

| MM                       | Screen                         | Real trigger                                                                                                                  | What it proves to the viewer                                            | Phases                                                                                                                                     | Reduced motion                                      |
| ------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| MM-1 Bayad na            | M-MB-01                        | Verified, deduplicated PAYMENT.PAYOUTS-ITEM.SUCCEEDED for M-014, as `item.updated` over SSE (push if the app is backgrounded) | PayPal, not the app, says she is paid, and every copy changes at once   | `armed`, `press` 0, `flood` 90, `fill` 120, `chime` 180, `label` 400, `invite` 900, `rest`                                                 | 150 ms colour and label crossfade                   |
| MM-2 Paper prints itself | W-TR-03, W-TR-04               | `extract.row` from the recorded real run; `field.entered`                                                                     | Claude reads in pencil; doubt becomes the treasurer's ink               | Per row: `band` 0, `lift` 220, `flight` 340, `resolve` 640, `print` 940, `ring` 1120, `landed` 1360. By hand: `hollow`, `typed`, `stamped` | No flight; crop outline and a 600 ms connector      |
| MM-3 The pink copy       | W-TR-06, dial                  | H1 opened, then "Count it once"                                                                                               | The duplicate cost 63 neighbours; counting it once pays them back       | `glide` 0, `converge` 450, `underline` 900, `await`, `commit`, `needle` +60, `wave` +200, `stamped`                                        | Crossfade into overlap; the needle cuts             |
| MM-4 Bolted              | W-TR-02                        | 409 `RATE_CARD_RATIFIED` citing the hash                                                                                      | Not even the treasurer can add a deduction mid-season                   | `refuse` 0, `plate` 120, `rest`                                                                                                            | Steel edges brighten for 200 ms                     |
| MM-5 Two keys            | W-TR-07, M-BD-02               | Last blocking hold resolved; two `approval.signed` events                                                                     | Two named people bound this exact batch                                 | `rise`, `hold-1`, `key-1`, `presence`, `hold-2`, `biometric`, `key-2`, `sealed`, `inked`                                                   | Stepped bar with percentage; rings fade             |
| MM-6 Honest fan-out      | W-TR-08                        | The 201, verified item events, Rhea's UNCLAIMED, one resent duplicate                                                         | Sent is not paid; cash members share the page; a repeat changes nothing | `posted`, `landing`, `parked`, `to-cash`, `duplicate`, `settled`                                                                           | Threads start at 70%; completion is a colour change |
| MM-7 Tap a peso          | M-MB-01; wheel zoom on W-PF-01 | Nang Celing taps US$43.69                                                                                                     | Every peso traces to a pencil mark she recognises                       | `lift` 0, `expand` 90, `zoom`, `tile`, `speak`, `back`                                                                                     | 200 ms crossfade to the crop                        |

The INVOICE.PAID beat on W-TR-01 runs `arc` 0, `pool` 600, `funded`, `root`. In MM-6, Rhea's thread holds at 70% with a canary end cap and "Parked", and never turns red: UNCLAIMED is a decision for a person, not a failure.

### S1.10 Microcopy and tone

**Voices.**
- The engine prints templates whose digits come from code.
- Claude writes in pencil with no digits, observing and never accusing (see W-TR-06).
- People write in ink, under an initials stamp.
- PayPal rows lead with plain words.
- Members hear a warm, short voice that uses their registry honorific, leads with money, and names a person and a place for help.

**Rules.**
- Sentence case. No exclamation marks, emoji, eyebrows, all caps, middle-dot strings or arrows on buttons.
- Buttons name the outcome ("Approve 8 payouts", "Count it once").
- Every state has a glyph and a word. A hold is never an error.
- Red copy names PayPal as the actor.
- The peso is always "about … (estimate)".
- The console keeps the co-op's words: resibo, kaltas, purok, bodega, CBU, multa.
- A CI word list (WS-QA) blocks: "EUDR-compliant"; "certified"; Fairtrade or Rainforest Alliance marks; "live" for sandbox; "instant" GCash or peso pay; "AI calculates"; "verified" on simulated events; "paid via checkout" after record-payment; "merged" for PR #107; "error" or "fraud" in member copy.

**Status words.** The register §7 words are fixed; the rest are new.

| State                             | ceb                                          | fil                                                  | en (member)                                     | Console                                                        |
| --------------------------------- | -------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| COMPUTED, READY                   | Gisusi pa                                    | Sinusuri pa po                                       | Still checking                                  | Ready                                                          |
| HELD                              | Gisusi pa                                    | Sinusuri pa po                                       | Still checking                                  | Gisusi pa; RESERVES_LINE adds "Reserved, never redistributed." |
| EXCLUDED                          | Ibalhin sa sunod nga bayad                   | Ililipat po sa susunod na bayad                      | Moved to the next pay run                       | Excluded, carried over                                         |
| LOCKED, SUBMITTED, PAYPAL_PENDING | Gipadala na, naghulat sa PayPal              | Naipadala na po, hinihintay ang PayPal               | Sent, waiting for PayPal                        | Sent                                                           |
| PAID                              | Bayad na                                     | Bayad na po                                          | Paid                                            | Paid                                                           |
| OFF_RAIL_DUE                      | Andam sa bodega                              | Handa na po sa bodega                                | Ready at the bodega                             | Cash due                                                       |
| OFF_RAIL_PAID                     | Nadawat                                      | Natanggap na po                                      | Received                                        | Cash received                                                  |
| UNCLAIMED                         | Wala madawat sa PayPal                       | Hindi po natanggap sa PayPal                         | Not received through PayPal                     | Parked                                                         |
| RETURNED; REROUTED                | Gibalik sa co-op; Gipadala pag-usab          | Ibinalik po sa co-op; Ipinadala pong muli            | Returned to the co-op; Sent again               | Returned; Re-routed                                            |
| PAYPAL_HELD; NEEDS_ACTION         | Gipugngan sa PayPal; Wala molampos sa PayPal | Hinahawakan po ng PayPal; Hindi po natuloy sa PayPal | PayPal is holding it; PayPal didn't complete it | Held by PayPal; Needs action                                   |
| REVERSED                          | Gibawi                                       | Binawi po                                            | Reversed                                        | Reversed                                                       |

_Run pill words:_

| State              | Words                 | State           | Words                |
| ------------------ | --------------------- | --------------- | -------------------- |
| DRAFT              | "Draft"               | POSTING         | "Posting to PayPal"  |
| QUOTED             | "Quoted"              | POSTED          | "Posted"             |
| INVOICED           | "Sent to Lantern Bay" | SETTLING        | "PayPal confirming"  |
| FUNDED             | "Funded"              | NEEDS_FOLLOW_UP | "Needs a decision"   |
| EXTRACTING         | "Reading slips"       | SETTLED         | "Settled"            |
| COMPUTED           | "Lines computed"      | CLOSED          | "Closed"             |
| IN_REVIEW          | "In review"           | CANCELLED       | "Cancelled"          |
| TREASURER_APPROVED | "Approved by Analyn"  | DENIED          | "Declined by PayPal" |
| AWAITING_BOARD     | "Waiting for Ernesto" | HALTED          | "Paused"             |
| APPROVED           | "Approved"            |                 |                      |

_Hold words:_ DUPLICATE_SLIP "Same slip twice"; IMPLAUSIBLE_YIELD "More than the plot can grow"; NO_RULE "Deduction with no rule"; RATE_MISMATCH "Rate differs from the card"; SUSPECTED_INJECTION "Text that reads like an instruction"; LOW_CONFIDENCE "By hand"; MASS_BALANCE "Mass balance"; ASKED_CHAIR "Asked Ernesto".

**Statement reference copy.** This is AI-8's target: words and placeholders, no digits, one sentence per audio clip. It is frozen on 1 Nov for native review.

|     | ceb                                                                                | fil                                                                                | en                                                                              |
| --- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| s1  | Maayong adlaw, {{NAME}}. Salamat sa inyong paghago.                                | Magandang araw po, {{NAME}}. Salamat po sa inyong pagsisikap.                      | Good day, {{NAME}}. Thank you for your hard work.                               |
| s2  | Nagdala mo og {{NET_KG}} nga uga nga cacao, tanan {{GRADE}}.                       | Nagdala po kayo ng {{NET_KG}} na tuyong cacao, lahat {{GRADE}}.                    | You delivered {{NET_KG}} of dried cacao, all {{GRADE}}.                         |
| s3  | Premium gikan sa {{PAYER}}: {{PREMIUM}}, walay kaltas.                             | Premium mula sa {{PAYER}}: {{PREMIUM}}, walang kaltas.                             | Premium from {{PAYER}}: {{PREMIUM}}, no deductions allowed.                     |
| s4  | Bonus sa kalidad: {{BONUS}}, gikaltasan og {{CBU}} para sa CBU ({{RULE}}, {{BR}}). | Bonus sa kalidad: {{BONUS}}, binawasan ng {{CBU}} para sa CBU ({{RULE}}, {{BR}}).  | Quality bonus: {{BONUS}}, less {{CBU}} for capital build-up ({{RULE}}, {{BR}}). |
| s5  | Ang inyong bayad karong season: {{NET}}, mga {{NET_PHP}}, pinaagi sa PayPal.       | Ang inyong bayad ngayong season: {{NET}}, humigit-kumulang {{NET_PHP}}, sa PayPal. | Your pay this season: {{NET}}, about {{NET_PHP}}, by PayPal.                    |
| s6  | Gikan kini sa inyong resibo {{SLIPS}}.                                             | Galing po ito sa inyong mga resibo {{SLIPS}}.                                      | It comes from your slips {{SLIPS}}.                                             |
| s7  | Naa moy pangutana? Adto kang Treasurer {{TREASURER}} sa bodega.                    | May tanong po kayo? Lumapit po kay Treasurer {{TREASURER}} sa bodega.              | Questions? See Treasurer {{TREASURER}} at the bodega.                           |

For cash lines, s5 ends with "cash sa bodega" (ceb), "cash sa bodega po" (fil) or "in cash at the bodega" (en).

Nong Tidoy's credit line:
- ceb: "Ang {{CREDIT_PHP}} nga 'Multa' sa resibo {{SLIP}} wala sa rate card nga giaprobahan sa Board, mao nga gibalik kini kaninyo."
- fil: "Ang {{CREDIT_PHP}} na 'Multa' sa resibo {{SLIP}} ay wala po sa rate card na inaprubahan ng Board, kaya ibinalik po namin ito."
- en: "The {{CREDIT_PHP}} 'Multa' on slip {{SLIP}} is not on the rate card the Board approved, so it has been returned to you."

SMS preview (139 GSM-7 characters): "Bulawanon Kakaw: Nang Celing, bayad na ang US$64.45 (mga P4,028) sa inyong PayPal. Resibo 0403,0419,0436,0467. Pangutana: Treasurer Analyn."

**Formats.** These come from deterministic `format.*`, never from `Intl`.
- Money: "US$64.45".
- Peso estimate: "mga ₱4,028 (gibanabana)" (ceb), "humigit-kumulang ₱4,028 (tantiya)" (fil), "about ₱4,028 (estimate)" (en), at the run's reference rate (₱62.50).
- Kilos and rates: "148.0 kg"; "US$0.29523 a kg"; percentages "1.62%".
- Identifiers: hashes in groups of four ("7f3a 91c2"); members "M-014"; slips "0403".
- Dates: "30 Okt 2026" in ceb and fil (months Ene, Peb, Mar, Abr, May, Hun, Hul, Ago, Set, Okt, Nob, Dis); "30 Oct 2026" in en.
- Times: console "10:21:41"; elapsed "0:14" and "3 min 12 s".

### S1.11 Accessibility

- **Bar.** WCAG 2.2 AA on the console, Proof and the web export [S1-12]. Statement copy at 7:1 contrast and non-text at 3:1, both checked on the tokens in CI. Axe runs in Playwright on every state above. TalkBack, 200% text and axe passes are due by G5 (6 Nov).
- **WCAG 2.2 specifics.**
  - 2.4.11: drawers never cover the focused element.
  - 2.5.7: crop zoom and pan get "+"/"−" buttons and arrow keys.
  - 2.5.8: console targets are at least 24 × 24 CSS px; app targets 48 dp, primary actions 56 dp, Paminawa and Pirmahi 64 dp.
  - 3.2.6: Pangutana is always the last destination.
  - 3.3.7: by-hand entry never asks for re-entry.
  - 3.3.8: pairing by QR or a pasteable code; signing by biometric or device PIN.
- **Hold to commit.** Every hold slab has a ConfirmDialog route, opened when a screen reader is on, by Enter, or by "Can't hold? Approve another way". It states the amount, recipients and consequence before asking for the key. With reduced motion, a stepped bar shows a percentage.
- **Screen readers.**
  - `format.amountSpoken(cents, lang)` produces full phrases: "sixty-four dollars and forty-five cents, about four thousand twenty-eight pesos, estimate". Ceb and fil keep English number words, pending native review.
  - Slabs announce label, amount and consequence: "Approve 8 payouts, 368 dollars 39 cents, moves money, button".
  - Live regions are polite and throttled to one summary every 5 s ("3 of 8 confirmed"), using `accessibilityLiveRegion="polite"` on Android [S1-13].
  - Visualisations are hidden from screen readers and mirrored in Data mode tables.
- **Language of parts.** Web marks spans with `lang="ceb"` and `lang="fil"`. React Native's `accessibilityLanguage` is iOS-only [S1-13], so on Android TalkBack reads ceb and fil with the device voice. Paminawa stays the primary audio path, and the README says so.
- **Large text.**
  - Web reflows at 200%.
  - Android is tested at font scale 1.3 and 2.0 (`adb shell settings put system font_scale 2.0`). Android 14 scales text non-linearly up to 200% [S1-14], so sp sizes text only, never padding.
  - From 1.3×, statements stack and the ReceiptBar becomes a list. The hero amount sets `maxFontSizeMultiplier={1.5}`.
- **Motion and feedback.**
  - System reduced-motion settings switch every moment to its reduced version. Devices with 3 GB of RAM or less get the low-end tier.
  - Haptics only decorate (`performAndroidHapticsAsync` with Confirm, Reject, Segment_Tick [S1-19]).
  - Web sound is off by default and silent under narration and Paminawa.
  - Members flagged as elderly or as signing with a thumbmark get Paminawa as first focus.

### S1.12 Localisation

- **Strings.** ICU MessageFormat through i18next 26.5.4, react-i18next 17.1.0 and i18next-icu (pinned on install). CI renders every key at 135% of the English length, plus a pseudo-locale. Members default to their registry language and can switch on every member surface. The console is in English, using the co-op's words.
- **Plurals.** CLDR gives fil and ceb one shared cardinal rule, and en one/other [S1-15]. Hermes and older Android ICU may lack `ceb` data (UNVERIFIED), so `@fairsplit/i18n` registers its own plural function. Most ceb and fil nouns do not inflect ("3 ka resibo").
- **Honorifics** come from the registry and are never guessed: Nang or Nong (ceb); Gng. or G. with "po" (fil); Mrs. or Mr. (en).
- **Audio.** Gemini 3.8 Flash TTS lists Cebuano and Filipino but not Hiligaynon, Waray or Bikol [S1-16]. Free-tier quality and quota are spike S10. Audio is one clip per sentence, AAC 32 kbps mono, with money read from word templates. It is labelled "Sintetikong tingog", "Sintetikong boses" or "Synthetic voice" (Gemini TTS).
- **SMS.** GSM-7 only. ñ and Ñ are in the basic set and ₱ is not [S1-17], so the peso is written "P". Other characters outside GSM-7 are transliterated, or the text is regenerated. Maximum 160 characters.
- **Review.** `i18n/REVIEW.md` tracks every ceb and fil key. Until a native speaker signs off (decision due 5 Nov), Judge Mode shows "Machine-translated, pending native review". Every photo carries "Synthetic sample", in its alt text too.

### Sources

- [S1-1] https://trade.ec.europa.eu/access-to-markets/en/news/delay-until-december-2026-and-other-developments-implementation-eudr-regulation
- [S1-2] https://eur-lex.europa.eu/eli/dir/2024/825/oj
- [S1-3] https://lawphil.net/statutes/repacts/ra2009/ra_9520_2009.html
- [S1-4] https://www.gmanetwork.com/news/money/economy/984131/bsp-filipino-account-ownership-down-to-50-in-2025-household-access-up-to-85/story/
- [S1-5] https://rsso11.psa.gov.ph/content/every-10-davaoenos-aged-10-64-years-old-9-have-basic-literacy-while-6-out-9-have-functional
- [S1-6] https://psa.gov.ph/major-non-food-industrial-crops/cacao
- [S1-7] https://privacy.gov.ph/data-privacy-act/
- [S1-8] https://developer.paypal.com/docs/api/transaction-search/v1/
- [S1-9] https://developer.android.com/develop/ui/compose/components/navigation-bar
- [S1-10] https://docs.expo.dev/versions/v58.0.0/sdk/audio/
- [S1-11] https://docs.expo.dev/versions/v58.0.0/sdk/camera/
- [S1-12] https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- [S1-13] https://reactnative.dev/docs/accessibility
- [S1-14] https://developer.android.com/about/versions/14/features
- [S1-15] https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html
- [S1-16] https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts
- [S1-17] https://en.wikipedia.org/wiki/GSM_03.38
- [S1-18] https://developer.paypal.com/payouts/payment-processing
- [S1-19] https://docs.expo.dev/versions/v58.0.0/sdk/haptics/
- [S1-20] https://context.ph/2026/05/22/majority-of-filipino-adults-now-have-financial-accounts-bsp/

### Register deviations

1. **Some screen IDs and all routes are inferred.** My copy of the register started partway through §5 and did not include its screen table.
   - From the register: W-JG-01, W-TR-01/02/05/06/07/08, W-PF-01, M-MB-01 and M-BD-02.
   - Mine, mapped one-to-one to design §6: every other ID, and every route.
   - Where IC-01's frozen constants differ, IC-01 wins.
2. **M-CK-03 Cash day is new.** The clerk's attestation (OFF_RAIL_DUE to OFF_RAIL_PAID) had no screen. Adding it also gives the clerk the three destinations M3 recommends as a minimum.
3. **Payout details follow the register over the design.**
   - Rhea's item is UNCLAIMED, not ERRPYO002 (§8, MM-6). It shows a canary "Parked" and never turns red.
   - The retry copy reads "Attempt 2 of 4", not "of 5", because the register allows three retries.
   - Live updates use SSE, not WebSocket, and the app is served at `/app`, not `/m`.
4. **Judge invoices are sent under a seeded, labelled treasurer approval** at session start. §8 lists the send among the session-start calls, and `sendNeedsTreasurer` requires an approval.
5. **The Proof footer says Transaction Search can lag by up to 3 hours** (PayPal docs). The design's "about 9 hours" is how long the API scope takes to propagate, not the data lag.
6. **Slip 0449's instruction-like text is quarantined without a hold**, so the seed keeps three holds. A SUSPECTED_INJECTION hold fires only when quarantined text overlaps a field rectangle. WS-CORE to confirm.
7. **Slip 0462's read shows "(0.40)"**, not the design's 0.41, because §9 agreement scores are discrete.
8. **Other inferred details:**
   - Analyn's key ID is `fs-analyn-a1`.
   - Judge clones need a cash-day field and a relative AUTO_CANCEL date; no column in §7 names them.
   - The brand's "Request the next audited pay run" copies to the clipboard, so it needs no new table or event.
   - Hiligaynon, Waray and Bikol appear only as a disabled row.
9. **Copy and figures:**
   - The public tagline follows the design. CoTreasury and Supplora already use "PayPal moves the money".
   - Davao functional literacy is 66.7%, not the digest's 70.8%.
   - The title card's "half" is BSP's 2025 survey (adults 15+). A BSP-commissioned SWS survey found 58% account ownership in Q1 2026 [S1-20], so the card must name the 2025 survey.
