# Fair Split: the design direction

_Final decision, 22 Oct 2026. Design freezes on 6 Nov. Where this document and any of the four concepts disagree, this document wins. If a builder later runs the impeccable skill, treat this document as the pinned brief: it overrides any direction the skill rolls._

## 0. The decision

**Base concept: Timbang (neopop-bold).** Two of the three judges chose it as the base (the design director and the staff engineer). All three scored it highest on visual craft and delight. Its material grammar shows the governance model without any copy:
- Machine output is flat print and never gets a button.
- A human commit is a square slab, and its depth matches its consequence.
- The ratified rate card is bolted down and will not move.

A judge can read "the model never writes a payout; a person presses the irreversible step" from the screen alone.

**What we take from the other concepts**
- **From Carbon:**
  - The names pencil, ink and carbon for the three kinds of mark.
  - An append-only event log. Each event's actor is agent, engine, human or PayPal, so the log is both the run log and the attribution ledger.
  - Carbon-through: one item webhook updates the console, the member's phone and Proof within 100 ms.
  - Co-signing from the judge's own phone by scanning a QR code.
  - The triplicate pad colours (white original, pink duplicate, yellow copy) as the meaning of the evidence.
  - Verify in your browser.
  - The seal drawn in pure SVG.
  - The two-context Playwright spec, which also serves as the recorded video take.
- **From Tin-aw:**
  - The slip-to-row flight.
  - The twin check, where two copies of the same slip overlap and go black.
  - Honest arrival: amounts shown hollow until paid, payment threads drawn only to 70% when PayPal returns 201, and no count-ups.
  - The state grammar, with a reduced-motion version of every moment.
  - Proof as a light reading column.
  - The Judge stage layout.
  - Continuity kept inside a single screen.
- **From Sapa:**
  - On every hold card, a gate label that says whether the hold blocks the whole run or only reserves one line.
  - Data mode on the D key.
  - The honest split fan as the README hero image.
  - A single jade arc when INVOICING.INVOICE.PAID arrives.
  - Audio rendered one sentence at a time, with the slip chip rising when the voice names it.
  - The rule "motion is evidence".

**Conflicts, decided**

| Conflict          | Decision                                                                                                                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dark or light     | The console defaults to **Tablea**, a dark cacao-lacquer theme. Every phone surface defaults to **Adlaw**, a daylight theme, and members can choose Tablea on first run. Proof is light only. On each surface the non-default theme exists only as contrast-tested tokens; it gets no separate art direction. |
| The line          | Public tagline: "Claude writes in pencil. People sign in ink. PayPal makes it carbon." Rule for builders: machines print, people press, PayPal lands.                                                                                                                                                         |
| Presence          | One label during co-sign: "Ernesto, reviewing hold 2 on his phone". No cursors, cursor chat, ghost replay or log scrub. The co-signer is always a real person: either the judge on their own phone, or the judge driving the Chair's phone frame. It is never scripted.                                       |
| Number of moments | Seven. Each is caused by a real event or a ratified rule. Any moment that is not finished by 4 Nov ships as its reduced-motion version, which is still complete and truthful. Nothing ships half-polished.                                                                                                    |
| Slabs             | At most two per screen. Never on navigation, filters, grid rows or status displays.                                                                                                                                                                                                                           |
| Jade              | A raised jade surface means "this action will move money". A flush jade surface means "PayPal confirmed it". No path, thread or status turns jade before a verified item webhook arrives.                                                                                                                     |
| Resolved holds    | Shown flush in ink with the resolver's initials stamp. Never jade, because jade means money.                                                                                                                                                                                                                  |
| Hold count        | Three holds, one field entered by hand, and one season-level check.                                                                                                                                                                                                                                           |
| Names             | Fair Split. Surfaces: Console, Fair Split app, Proof. Themes: Tablea, Adlaw. Never use Timbang, Carbon, Sapa, Tin-aw, Pink Copy, Yellow Copy, Orihinal or Bodega Window in public.                                                                                                                            |
| Rendering         | SVG, CSS transforms and Reanimated only. No WebGL, Skia, backdrop blur or glass anywhere.                                                                                                                                                                                                                     |

**Gates**

| Date   | Must be done                                                                                |
| ------ | ------------------------------------------------------------------------------------------- |
| 24 Oct | Tokens, the five primitives, and a signed APK from EAS                                      |
| 29 Oct | The full loop, without the moments                                                          |
| 4 Nov  | All seven moments                                                                           |
| 6 Nov  | Design freeze. Then the TalkBack pass, the 200% text pass, and the recorded Playwright take |

### Seed data: the one source of truth

One generator in `seed/` produces every figure. Screens, mocks, the README and the video all read from it, and a conservation test checks the lines below to the cent. Hashes are always computed, never typed. This document uses `7f3a 91c2` as a stand-in for the rate-card hash prefix.

| Item           | Canonical value                                                                                                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Co-op          | Bulawanon Kakaw Growers MPC, Calinan, Davao City. 64 members. Synthetic.                                                                                                                                                                     |
| Payer          | Lantern Bay Chocolate Co., Oakland. Contact: Dana Whitfield-Santos, sourcing. Synthetic.                                                                                                                                                     |
| People         | Analyn R. Sumalinog, Treasurer (initials AS). Ernesto P. Cabahug, Chair (EC). Jessie D. Dumaguing, clerk (JD), who writes slips in blue ballpoint block capitals.                                                                            |
| Season and lot | Season 2026-A. Lot LB-PH-2026-03.                                                                                                                                                                                                            |
| Rate card      | BR 2026-04, ratified 14 Mar 2026 and hashed before the first slip. See the Schedule A breakdown below.                                                                                                                                       |
| Invoice        | US$4,333.50 in total, see the breakdown below.                                                                                                                                                                                               |
| Evidence       | 264 slips in 66 photos, 4 slips per photo. Judge Mode replays the reading of the last 12 photos (48 slips, which include every hero case). The other photos were read earlier in the season, and each has its own dated events.              |
| Verified kilos | 9,780.6 kg, of which 9,388.0 kg is Grade 1, after the duplicate slip is counted once. Mass balance is 2.05% if slip 0457 is counted twice and 1.62% if counted once.                                                                         |
| Holds          | Three holds and one field by hand, see the list below.                                                                                                                                                                                       |
| Redirected     | US$21.14 = US$17.94 (duplicate) + US$3.20 (multa returned as a credit the co-op pays).                                                                                                                                                       |
| Lines          | Gross lines total exactly US$4,273.50. The co-op retains US$58.53 in ruled deductions. Credits total US$3.20. Net is US$4,218.17: US$368.39 by PayPal to 8 members, US$3,849.78 in cash to 56.                                               |
| Batch          | 8 items, US$368.39. `sender_batch_id` is `2026A-{rc8}-r{runSeq}`. Rhea Jumawan's US$26.65 item is the labelled ERRPYO002 test case and gets re-routed to cash. End state: 7 members paid by PayPal (US$341.74) and 57 in cash (US$3,876.43). |
| Fees           | Sandbox: 8 × $0.25 = $2.00. In production to the Philippines: 2% = $7.37. Both fit inside the $60.00 disbursement line.                                                                                                                      |
| Hero line      | Nang Celing (Consolacion Bacus, M-014). Slips 0403, 0419, 0436 and 0467 total 148.0 kg, all Grade 1; slip 0403 is 38.45 kg. Premium 43.69 + bonus 21.85 − CBU 1.09 = **US$64.45**, about ₱4,028 at the ₱62.50 reference rate.                |
| Other lines    | Nong Dioning: US$80.65 with the duplicate, US$62.71 without. Merlyn Ponce: 300.0 kg (280.0 kg Grade 1), 88.57 + 41.34 − 2.07 = US$127.84, about ₱7,990, paid in cash.                                                                        |

**Schedule A rules (BR 2026-04)**
- R0: premium is paid by verified kilos and is never deducted.
- R1: CBU (capital build-up) is 5% of the bonus until the member has ₱5,000 paid up.
- R2: hauling is ₱1.50 per kg for purok pickups.
- R3: a loan can be deducted only with a signed Authority to Deduct, and only up to 50% of the bonus.
- R4: an advance can be deducted only with a voucher, and only up to 30% of the bonus.
- Co-sign: the Chair must co-sign any batch over US$300, any line over US$150, and any override.
- Mass-balance tolerance: ±2.0%.

**Invoice breakdown (US$4,333.50)**
- Premium: 9,625 kg × $0.30 = $2,887.50.
- Quality bonus: 9,240 kg of Grade 1 × $0.15 = $1,386.00.
- Disbursement costs: $60.00.

**Holds in the seed**
- **H1, duplicate:** slip 0457, Nong Dioning, 42.0 kg. Blocks approval.
- **H2, yield:** Merlyn Ponce (M-053), 300.0 kg from 140 trees = 2.14 kg per tree. Blocks approval.
- **H3, unruled deduction:** "Multa (absent GA) ₱200" on slip 0458, Nong Tidoy. Reserves his line only.
- **By hand:** slip 0462, Arnel Sumampao. Logbook page 14, line 7 reads 64.50 net.

## 1. Art direction and thesis

**Thesis (pin this on the wall).** Fair Split is a cacao co-op's pay run made physical. Paper is the only thing that glows: Jessie's slips, photographed on a desk the colour of a tablea disc, cast the product's only shadows. Everything a machine says is printed flat in graphite, both Claude's readings and the engine's figures, and none of it ever gets a button. Everything a person decides is pressed into a square slab whose depth matches its consequence, and it is stamped with their initials. The rules the Board ratified are bolted down and will not move for anyone, the treasurer included. Money never animates into existence. It lands only when PayPal says so, as a single jade press that appears on every copy at once: the console, the Chair's phone, the member's statement and the brand's proof. Claude writes in pencil. People sign in ink. PayPal makes it carbon.

**Seven signatures.** A screen that shows none of these is generic.
1. Paper glowing on tablea lacquer, and casting the product's only shadows.
2. Graphite print turning to ink when the two keys are turned, then to jade when PayPal lands.
3. Square slabs whose depth equals their consequence, and the bolted rate card with steel hatching and bolts.
4. The bodega's hanging-scale dial.
5. A guilloché seal grown from the batch hash and completed by two people.
6. The split fan: one seal, 64 lines, eight PayPal threads and 56 dashed cash lines.
7. Stencilled season and lot marks, as on the jute sacks.

**Emotional arc per persona**

| Persona                                             | Arrives feeling                                                | During                                                                                                          | Peak                                                                                                   | Leaves feeling                                                   |
| --------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Analyn, Treasurer (bonded and personally liable)    | Dread: a shoebox of slips and last year's arguments            | Relief as the paper prints itself. Watchful but never blamed, because holds say "still checking", never "error" | Her approval press bottoms out with a clunk, and the rules she cannot bend are the ones protecting her | Proud and covered: "I can show where every centavo went"         |
| Ernesto, Chair                                      | Interrupted in his plot by a notification                      | Understands within ten seconds what is asked, how much, and why him                                             | His thumb finishes the seal she started, and he can check by eye that the hash matches                 | A co-owner, not a rubber stamp. One clunk and he is back to work |
| Jessie, clerk                                       | Rushed at the scale, and afraid a hold means he will be blamed | Sees "3 saved on this phone" with no signal, and is never asked to retype                                       | The upload rings close when signal returns                                                             | Safe: his work arrived                                           |
| Nang Celing, member in her sixties who reads slowly | Wary, because deductions (kaltas) have surprised her before    | Greeted by name, in Cebuano, with audio first                                                                   | Her own slip 0403, in Jessie's handwriting, under her finger                                           | Certain and respected, and knows whom to ask                     |
| Dana, Lantern Bay                                   | Exposed: she has an EU claim she cannot evidence               | One link takes her from the invoice to every payment                                                            | Verify turns six checks to "Matches" in her own browser                                                | Able to make a careful claim ("benchmarked", never "certified")  |
| A judge                                             | Expects "another console"                                      | Sees real sandbox IDs on screen within ten seconds                                                              | Co-signs from their own phone and watches the payment land                                             | "That was real, and two people signed it"                        |

## 2. Design tokens

### 2.1 Where each surface is used, and therefore its theme

- **Console (dark).** Analyn sits for hours at a bodega office desk under a fluorescent tube, reading photographs of paper. A dark console makes the evidence the brightest thing on screen.
- **App (light).** Nang Celing reads on a budget Android phone on her porch or at the bodega counter, in daylight. The app is light, and statement text meets 7:1 contrast.
- **Proof (light only).** Dana and auditors read Proof on laptops or forward it as a link, so it is a light reading column.
- **Judge stage.** Judges see the dark console beside bright phone frames. That pairing is also the thumbnail.

### 2.2 Colour

**Strategy: restrained.** Neutral tones cover about 90% of every screen. Each of the four semantic hues has exactly one job and appears only when its state is true.

| Token                              | Tablea (dark)                                         | Adlaw (light)                                                                                          | Role and rule                                                                                                               |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| ground                             | #201712                                               | #EEEEEA                                                                                                | Page background. Tablea is the colour of a roasted cacao tablet, oklch(0.214 0.017 50): visibly brown, never neutral black. |
| plate                              | #2A1F18                                               | #FFFFFF                                                                                                | Content surfaces and the statement card.                                                                                    |
| plate-2                            | #33271F                                               | #F6F6F3                                                                                                | Inspectors, drawers and bolted faces.                                                                                       |
| rule                               | #4A392D                                               | #D8D4CD                                                                                                | 1 px separators.                                                                                                            |
| ink                                | #F4EDE4 (15.2:1)                                      | #1C1511 (18.0:1)                                                                                       | Body text, human decisions, and the chalk slab face.                                                                        |
| ink-2                              | #BDB1A4 (8.4:1)                                       | #4E453E (9.4:1)                                                                                        | Secondary text.                                                                                                             |
| ink-3                              | #8C8075 (4.6:1)                                       | #776D65 (5.1:1)                                                                                        | Metadata and icons only. Never used for statement copy.                                                                     |
| pencil                             | #A9B1B8 (8.1:1)                                       | #4C5761 (7.4:1)                                                                                        | Cool graphite for Claude's readings and the engine's figures.                                                               |
| jade                               | #2FD3A0 (9.2:1), with #201712 text on it              | Face #2FD3A0 with ink text (9.4:1); text colour #0A7553 (5.7:1); flush faces get a 1 px #0F6F53 border | Money. Raised: this will move money. Flush: PayPal confirmed it.                                                            |
| canary                             | #F2DA4E (12.5:1), with #201712 text on it             | Face #F2DA4E with ink (12.8:1); text colour #7F6200 (5.8:1); wash #FFF3BF                              | A person must decide ("Gisusi pa"). Never an error, never a button.                                                         |
| red                                | #FF5A47 (5.7:1); face #D63A2C with white text (4.7:1) | #BF2A1C (5.9:1); wash #FCE6E3                                                                          | Only for PayPal DENIED, FAILED, RETURNED, BLOCKED and ERRPYO codes.                                                         |
| pod                                | #FF8A2A                                               | #C85A00 (4.3:1)                                                                                        | The colour of a cacao pod. Used for the focus ring and the dial needle, nothing else.                                       |
| hatch                              | #5C4A3D lines on plate                                | #BFB7AE lines on white                                                                                 | Cash at the bodega, or unavailable. Always paired with a word.                                                              |
| steel                              | #7C8288 on #3B3F43                                    | #8A9096 on #D5D8DB                                                                                     | Edges of bolted items only.                                                                                                 |
| copy-white, copy-pink, copy-yellow | #FFFFFF, #F4C9D4, #F5E27A                             | Same                                                                                                   | Evidence tags and favicons only.                                                                                            |
| scrim                              | #100B08 at 64%                                        | #1C1511 at 40%                                                                                         | Behind drawers.                                                                                                             |

**Colour rules**
- Deduction chips use plate-2 with the rule ID written in text. They get no hues of their own.
- **PayPal-adjacent without imitating PayPal.** The word PayPal appears in our own type and is never a drawn or recoloured logo. We use none of PayPal's blues (#003087, #0070E0, #009CDE) and not its button yellow (#FFC439). Our canary sits at hue 99, away from PayPal's 84, and is never used on a button. The connection to PayPal shows in our vocabulary instead: PayPal event names under plain words, sandbox labels, and item IDs.
- **Never:** purple, indigo, gradients, gradient text, or glows.
- **Not by colour alone.** Every state carries a glyph and a word. Cash carries hatching and a word.

**Avoiding the generic AI look**
- Not cream with a serif and stamps.
- Not near-black with a neon accent. Our ground is visibly brown, and green appears only after PayPal confirms or on the single money slab.
- Not broadsheet hairlines.
- Not the SaaS card kit. Corners are 0 or 2, and the only shadow belongs to paper.
- No eyebrows, no monospace labels, no sparkles, no chat box.

### 2.3 Typography

All typefaces are licensed under SIL OFL 1.1, which allows web self-hosting and bundling in apps. Commit each family's OFL.txt to the repo.
- **Mona Sans** (variable: weight 200–900, width 75–125) is used for the UI and for every number.
  - Web: ship the variable WOFF2, subset to Latin and Latin Extended-A.
  - Native: React Native cannot drive font axes, so ship four static instances cut with fonttools, each with tabular figures and the slashed zero frozen in:
    - Condensed ExtraBold (width 75, weight 800)
    - SemiCondensed Medium (87.5, 500)
    - Regular (100, 400)
    - SemiExpanded Bold (112.5, 700)
  - If the licence declares a Reserved Font Name, rename the frozen instances (for example "FS Numerals").
- **Atkinson Hyperlegible Next**, Regular and Bold, is used only for the prose of member statements.
- **Big Shoulders Stencil** (weight 800) is used only for season and lot marks ("2026-A", "LB-PH-2026-03"), as on the stencilled sacks. Web only.
- **No monospace anywhere.** Platform controls keep Roboto or SF.
- **Day-1 check:** confirm that both Mona Sans and Atkinson Next include the peso sign (U+20B1, ₱) and a slashed-zero feature. If ₱ is missing, add a fallback face that covers only ₱ via `unicode-range` (a Noto Sans subset, OFL), and on native render ₱ as its own text span.

| Role           | Face and axes                   | Size / line height              | Use                             |
| -------------- | ------------------------------- | ------------------------------- | ------------------------------- |
| amount-hero    | Mona Sans, width 75, weight 800 | 72/72 (console); 48/52 sp (app) | Money being decided or received |
| amount-l       | width 75, weight 760            | 32/36                           | Inspector and drawer effects    |
| title-1        | width 100, weight 660           | 28/34                           | Screen titles                   |
| title-2        | width 100, weight 600           | 20/26                           | Drawer and section titles       |
| body           | width 100, weight 450           | 14/20                           | UI text                         |
| figure         | width 87.5, weight 500          | 14/20                           | Grid and list numbers           |
| label          | width 100, weight 560           | 13/16                           | Control labels                  |
| caption        | width 100, weight 450           | 12/16                           | Provenance footers and IDs      |
| hash           | width 75, weight 520            | 13/16, in groups of four        | Hashes and item IDs             |
| slab           | width 112.5, weight 700         | 17/20                           | Slab labels                     |
| statement-lead | Atkinson Next 400               | 22/30 sp                        | The greeting                    |
| statement-body | Atkinson Next 400 and 700       | 19/28 sp, never below 18        | Statement prose                 |
| mark           | Big Shoulders Stencil 800       | 20/20; 40/40 on Proof           | Season and lot marks            |

**Numerals.** Use tabular lining figures and the slashed zero wherever money, kilos or hashes appear. Money is always set in Mona Sans, even inside Atkinson prose, and amounts align on the decimal point. Use sentence case everywhere: no all-caps labels, tracked capitals, middle-dot metadata strings, arrows appended to buttons, or headlines with one accented word.

**Currency.** In sandbox, amounts read "US$64.45" with "mga ₱4,028 (gibanabana)" beneath. In production the peso figure becomes the primary amount and the estimate line disappears.

### 2.4 Spacing, layout, radii and depth

**Spacing** uses a 4-based scale: 2, 4, 8, 12, 16, 24, 32, 48, 64, 96.

**Layout**

| Surface | Grid and sizes                                                                                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Console | 12 columns with 24 px gutters. A flat 220 px navigation rail. Drawers 560 px wide. The Approve column is 640 px. Grid rows 40 px, headers 36 px.                        |
| App     | 16 dp side gutters on an 8 dp rhythm, with 24 dp between sections. Touch targets at least 48 dp; primary actions 56 dp; Paminawa (listen) and Pirmahi (sign) are 64 dp. |
| Proof   | One 680 px column with prose no wider than 72 characters, and 16 px gutters on phones.                                                                                  |

Everything is left-aligned except the Approve column and the Proof hero, which are centred.

**Radii**
- **0:** slabs, tiles, evidence, and the statement card (the statement is the member's white original copy).
- **2:** plates, chips and inputs.
- **Material 3 defaults:** native system containers (bottom sheets, dialogs, snackbars), because the platform owns structure.

**Depth** comes from value steps, not shadows: ground, then plate, then plate-2.
- Slab edges are 3 px for d1 (do something reversible), 5 px for d2 (decide something that changes a line), and 8 px plus a hold for d3 (move money or sign).
- Evidence casts the only shadow:
  - Tablea: `0 1px 1px rgb(0 0 0/.35), 0 12px 28px -10px rgb(0 0 0/.55)`
  - Adlaw: `0 1px 1px rgb(28 21 17/.10), 0 10px 24px -10px rgb(28 21 17/.22)`
- Drawers use plate-2 with a 1 px top highlight (#FFFFFF14) over the scrim. Menus use plate-2 with a 1 px rule.

### 2.5 Material recipes (there is no glass)

- **Slab**
  - Construction: a solid face with a 1 px inner top highlight. The right edge is a parallelogram d px wide, skewed 45° on the Y axis. The bottom edge is a parallelogram d px tall, skewed 45° on the X axis.
  - Edge colours:
    - Chalk face #F4EDE4: right edge #B9AFA4, bottom edge #8A8178.
    - Jade face #2FD3A0: right edge #1F9E78, bottom edge #12704F.
    - Adlaw ink face #1C1511: right edge #4A3F38, bottom edge #2B2420.
  - Pressing moves the face by (d, d) and the edges collapse.
  - An unavailable slab sinks flush with a hatched face, keeps its label, and shows a reason link beneath; it is never greyed out.
  - Focus: a 2 px pod-coloured ring at 2 px offset that travels with the face.
  - We rebuild NeoPOP's geometry ourselves from its Apache-2.0 parameters, in about 30 lines of CSS, and never import @cred/neopop or its palette.
- **Flush:** a surface with no edges.
  - Jade flush means PayPal confirmed it.
  - Ink flush with an initials stamp means a person resolved it.
  - Hatched flush means cash, or unavailable.
- **Bolted**
  - Construction: a plate-2 face, edges filled with a 45° steel hatch (1.5 px lines every 4 px), and two 4 px bolt heads on the face's top corners.
  - It has zero travel.
- **Print**
  - Flat text with no container. It is revealed by a linear clip wipe.
  - Claude's readings and the engine's figures appear in pencil until the two keys turn them to ink.
  - Every printed value carries a provenance footer, for example "Read by Claude (claude-opus-5-5)" or "Computed by engine v1, rate card 7f3a 91c2".
- **Hollow**
  - Amounts of 28 px or larger, once approved but not yet in the member's hands, are drawn as outlines: `-webkit-text-stroke: 1.25px` on web, and a react-native-svg text stroke on native.
  - Fields read with confidence below 0.85 show their value in pencil at 60% inside a cell outlined 1.5 px in canary, tagged "You".
- **Ink stamp**
  - An 18 px square filled with ink, with the person's initials in plate colour (Mona Sans width 112, weight 700, 10 px).
  - It appears on every human decision, and hovering or long-pressing shows the time.
- **Paper:** only photographed evidence counts as paper. It casts the only shadow and carries a "Synthetic sample" tag in the corner.
- **Hatch:** 45° lines, 1.5 px wide every 6 px, with at least 1.8:1 contrast against the field so it reads on video. Always shown with the word "Cash" or a reason.
- **Glass:** none anywhere. Not on iOS, and not faked on Android.

**Texture.** A static 128 px monochrome noise tile at 3% opacity sits on the Tablea ground in the web console only. There is no texture anywhere else, and none on native.

### 2.6 Iconography, illustration and imagery

**Icons**
- **System icons:** Material Symbols Sharp (Apache-2.0) at weight 500 and optical size 24, imported as SVGs. The same files feed web and react-native-svg.
- **Domain glyphs:** 14 custom glyphs drawn on the same 24 px grid with 2 px strokes, square caps, mitred joins and 45° chamfers that echo the slab edges:
  - sack, triplicate slip, duplicate, hanging scale, thumbmark
  - cut-test bean, seal, cash, bolt, pencil (Claude)
  - plot, rail, listen, logbook
- **State:** filled variants mark state.
- **Never:** sparkles, robots or emoji. Claude is represented by the word "Claude" and the pencil glyph.

**Imagery and illustration**
- The only photographs are evidence: synthetic slips on a bamboo mat, the BR 2026-04 pages, and logbook page 14. Each is tagged "Synthetic sample" in the corner and in its alt text.
- The only illustrations are the hash-derived seal and an abstract plot field: dots placed by a hash-seeded layout, with no basemap and no coordinates.
- Philippine context comes through content, never costume:
  - the triplicate copy colours
  - stencilled lot marks
  - the hanging-scale dial
  - Cebuano first, with the honorifics Nang, Nong and po
  - the words bodega, purok, kaltas and resibo
  - the peso always labelled as an estimate
- **Never:** jeepneys, banig, capiz, Baybayin, sunsets, farmer portraits, stock photos or illustrated people.

**Rules for the synthetic assets** (generated with the OpenAI image model through Codex CLI)
- All slips come from one printed template, filled in Jessie's blue ballpoint block capitals.
- The pink duplicate copy is fainter than the white original.
- Slip 0462 has one water stain.
- Slip 0458 carries the multa line.
- Every photo ships with a reviewed crop fixture that maps each field to a rectangle. Never assume a generated image matches the template pixel for pixel.

**App icon and favicons.** The app icon is the hanging-scale dial on tablea, with a pod-orange needle resting on the centre mark. The console favicon has a pink corner and the Proof favicon a yellow one; the copy colours appear in favicons only.

### 2.7 Delivery

**One package.** `@fairsplit/tokens` emits:
- CSS custom properties (`--fs-*`) for both themes via `[data-theme]`.
- The React Native theme object.
- AG Grid `themeQuartz.withParams` for both modes.
- Material 3 roles for Android system chrome. The M3 primary role is ink, not jade. Jade has no M3 role at all, so it can never leak into a navigation indicator.

**Contrast checks in CI.** The build fails if any declared text pair drops below its target:
- 4.5:1 for console text
- 7:1 for statement copy
- 3:1 for non-text elements

## 3. Motion system

The source of truth is physical parameters with mass m = 1, so Motion and Reanimated produce identical motion. The duration and bounce values are documentation, converted with k = (2π/d)² and c = 4π(1−b)/d. Motion receives `{type:'spring', stiffness, damping, mass:1}`. Reanimated 4 receives `withSpring(v, {stiffness, damping, mass:1})`. Both come from one shared `@fairsplit/motion` file.

| Preset  | Kind   | d / bounce                 | k     | c    | Damping ratio | Used for                                                                                                                                   |
| ------- | ------ | -------------------------- | ----- | ---- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| press   | tween  | 90 ms, curve (.23,1,.32,1) | –     | –    | –             | Slab face travel. Motion `{duration:.09, ease:[.23,1,.32,1]}`; Reanimated `withTiming(v,{duration:90, easing:Easing.bezier(.23,1,.32,1)})` |
| rebound | spring | 0.28 s / 0.35              | 503.6 | 29.2 | 0.65          | Release, or a hold let go too early                                                                                                        |
| land    | spring | 0.32 s / 0.30              | 385.5 | 27.5 | 0.70          | PayPal's press, the seal closing, chips                                                                                                    |
| settle  | spring | 0.50 s / 0.15              | 157.9 | 21.4 | 0.85          | A slab rising, layout changes, a card flipping                                                                                             |
| glide   | spring | 0.45 s / 0                 | 195.0 | 27.9 | 1.00          | Drawers, sheets, zoom, container transforms                                                                                                |
| needle  | spring | 0.90 s / 0.60              | 48.7  | 5.6  | 0.40          | The mass-balance needle only. It is the one spring allowed to bounce above 0.35, because a scale's needle has to swing.                    |

**Machine tweens** (no springs, no scaling, no depth)

| Tween   | Timing                       | Use                                                                                                   |
| ------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| print   | 180 ms linear                | Clip wipe, left to right                                                                              |
| band    | 220 ms, curve (.77,0,.175,1) | Reading band moving to a row                                                                          |
| flight  | 600 ms, curve (.23,1,.32,1)  | Along a quadratic curve with its control point offset −40 px                                          |
| thread  | 500 ms ease-out              | From 0 to 70% on the 201, staggered 40 ms. Completion takes 300 ms.                                   |
| engrave | 600 ms linear per ring       | Seal rings, staggered 120 ms                                                                          |
| arc     | 600 ms ease-out              | INVOICE.PAID arc                                                                                      |
| digit   | 150 ms                       | Only the digits that change slide 6 px and crossfade; values never count through intermediate numbers |
| flash   | 600 ms                       | Grid cell wash                                                                                        |
| drawer  | 420 ms in, 320 ms out        | Curve (.32,.72,0,1)                                                                                   |
| micro   | 100 to 200 ms                | Press feedback 100–120 ms, tooltips 150, popovers 200                                                 |

**Choreography rules**
1. Machines print, people press, PayPal lands. Machine output uses tweens only. People and PayPal use springs and depth.
2. Motion is evidence. Money moves on screen only in response to a real 201, a verified webhook or a signature, never on a timer. The pending ring stops animating after 60 s and shows elapsed time instead.
3. Your own actions are instant. Other people's actions and PayPal's are animated, so you notice them.
4. One focal motion per screen. Anything used more than 20 times a session (j and k, filters, tab switches) gets 0 ms or press feedback only.
5. Exits run 20% faster than entrances. No ease-in curves, no choreographed page loads, no count-ups, no confetti, and no ambient loops.
6. At most eight concurrent flights, or three on phones with 3 GB of RAM or less. Springs retarget when interrupted. Transitions are off while the theme switches.
7. Every speed-up in the video edit is labelled "×12 real time".

**Reduced motion** applies when the system preference is set: `prefers-reduced-motion` on web, iOS Reduce Motion, Android "Remove animations", or Reanimated `ReduceMotion.System`.
- Spatial travel is removed. Colour and opacity changes stay, at 150 ms.
- Slabs change colour without moving, and their edges fade over 120 ms.
- Hold-to-commit keeps a static stepped bar with a percentage, because it is a safety device.
- Each moment's specific substitute is listed in section 7.

**Low-end tier.** When `expo-device` reports totalMemory of 3 GB or less:
- At most three animations run at once.
- The seal appears complete with a 200 ms fade.
- No flights, and digits change instantly.
- Sound and haptics stay.

## 4. Sound and haptics

**Sound palette.** On web, sounds are synthesised with Web Audio. On native they are 48 kHz WAV files of 30 KB or less each, preloaded with expo-audio.

| Sound | Recipe                                                                                                                                    | Level    | Meaning                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| tick  | 12 ms of noise band-passed at 4 kHz                                                                                                       | −28 dBFS | A row printed, or a quarter of a hold                                          |
| plunk | Sine falling from 90 to 70 Hz over 60 ms, plus 30 ms of brown noise                                                                       | −14 dBFS | A person committing                                                            |
| clack | A dry 140 Hz burst of 40 ms, low-passed                                                                                                   | −18 dBFS | A refusal                                                                      |
| chime | E5 then G♯5, 90 ms apart, 5 ms attack, 180 ms decay                                                                                       | −16 dBFS | Money arriving on a member's phone                                             |
| scale | E major pentatonic: E5, F♯5, G♯5, B5, C♯6, E6, F♯6, G♯6. One note per verified item webhook, in order of arrival, at most four per second | −20 dBFS | Payouts landing on the console                                                 |
| root  | E4, played once                                                                                                                           | −18 dBFS | INVOICING.INVOICE.PAID, the season's root note. The payouts then climb from it |
| thud  | 70 Hz for 50 ms. Never musical                                                                                                            | −30 dBFS | A PayPal failure                                                               |

**Policies**
- On web, sound is off by default behind a visible toggle, remembered per viewer, and it never autoplays. The video turns it on.
- On native, sound respects the silent switch (`playsInSilentMode: false`).
- No product sound plays under narration or during Paminawa.
- Haptics only decorate; they never carry meaning. The web promises no haptics at all.

| Event                              | Sound                        | iOS (expo-haptics)         | Android (`performAndroidHapticsAsync`, with fallback) |
| ---------------------------------- | ---------------------------- | -------------------------- | ----------------------------------------------------- |
| Row printed (console)              | tick, at most one per 120 ms | –                          | –                                                     |
| Slip captured                      | –                            | impact Medium              | Confirm (API 30+), otherwise impact Medium            |
| d1 slab press / release            | –                            | impact Light / Light       | Virtual_Key / Virtual_Key_Release                     |
| d2 slab commit                     | plunk                        | impact Rigid               | Virtual_Key                                           |
| Duplicate found                    | two ticks, 90 ms apart       | Rigid twice                | Clock_Tick twice                                      |
| Each quarter of a hold             | tick                         | selection                  | Segment_Tick (API 34+), otherwise Clock_Tick          |
| Hold bottoms out                   | plunk                        | Heavy, then Success        | Confirm                                               |
| Refusal by a bolted item           | clack                        | notification Error         | Reject                                                |
| Seal completes on both screens     | plunk an octave lower        | Success                    | Confirm                                               |
| Item paid, on the member's phone   | chime                        | Success twice, 90 ms apart | Confirm twice                                         |
| Item paid, on the console run      | next note of the scale       | –                          | –                                                     |
| PayPal failure                     | thud                         | notification Warning       | Reject                                                |
| Seal mismatch on the Chair's phone | clack                        | Error                      | Reject                                                |
| Zoom commits at 1.6×               | –                            | impact Rigid               | Segment_Tick                                          |
| Duplicate webhook delivery         | silence (that is the point)  | –                          | –                                                     |

## 5. Component inventory

**Rules for agent-written code**
- One token package.
- Five primitives that everything else is built from.
- Every state exposes `data-testid` and `data-state`, and every moment exposes `data-moment-phase`.
- The hero take is a two-context Playwright spec (treasurer and Chair). It asserts that a tampered batch hash is refused before `POST /v1/payments/payouts`.

**Five primitives.** Each has one contract and two implementations.
1. **Slab**
   - Props: depth (d1, d2 or d3); tone (chalk or jade); `hold` (1600 or 1200 ms); `bolted`; `unavailableReason`.
   - Web: CSS face with two pseudo-element edges, animated with Motion.
   - Native: Reanimated with Gesture Handler 3, so travel and hold progress run on the UI thread.
   - Accessibility: hold slabs open a ConfirmDialog when a screen reader is on, on Enter, or through a visible "Can't hold? Approve another way" link.
2. **Print**
   - Props: value; provenance (claude or engine); confidence; state (pencil, hollow or ink).
3. **Seal**
   - Five hypotrochoid rings whose parameters (radii, offset, rotation, line count) come from the batch hash bytes.
   - The inner three rings belong to key 1 and the outer two to key 2. Lines are 0.75 px at 200 px size.
   - Pure SVG, from one function in `@fairsplit/seal`. That function feeds inline SVG on web, react-native-svg on native, and resvg PNGs for push notifications and print.
4. **ReceiptBar**
   - Reads in order: kilos × rate, premium (protected), bonus, ruled deductions as rule chips, credits, net.
   - Horizontal on wide layouts, stacked from 1.3× font scale.
   - Every segment can be tapped.
5. **HoldCard**
   - Contents: the engine line, Claude's line, evidence, the money effect, a gate chip, at most two actions, and a resolution stamp.

**Inventory**

| Component                                                             | Web (console, Proof, stage)           | Native (and Expo web frames) |
| --------------------------------------------------------------------- | ------------------------------------- | ---------------------------- |
| InkStamp, StatusChip, RuleChip, ConfidenceRing, DigitSwap             | Yes                                   | Yes                          |
| AmountDisplay (hero, hollow, peso estimate, full screen-reader label) | Yes                                   | Yes                          |
| MassBalanceDial                                                       | Split review header and the H1 drawer | –                            |
| SplitFan, FundingArc, RunStrip, RunPill, RailBar                      | Yes                                   | RailBar only                 |
| RunLog (three lanes), LogRibbon                                       | Yes                                   | A line-history list          |
| SlipViewer, TwinCompare, ByHandField                                  | Yes                                   | –                            |
| CropZoom                                                              | Proof (wheel or trackpad)             | Tap a peso                   |
| PaminawaPlayer                                                        | –                                     | Yes                          |
| SplitGrid (AG Grid Community with custom renderers)                   | Yes                                   | –                            |
| QRPairCard, PhoneFrame                                                | Stage                                 | Pairing scanner              |
| CommandMenu, ShortcutSheet, DataModeTable                             | Yes                                   | –                            |
| Drawer, ConfirmDialog, Snackbar, OfflineBar, EmptyState, Skeleton     | Yes                                   | Material 3 equivalents       |
| VerifyPanel, PlotField, EvalWaffle                                    | Proof and Season                      | –                            |
| PrintStatement (80 mm)                                                | Yes                                   | –                            |
| ThemePicker, LanguagePicker                                           | In the command menu                   | First run and settings       |

**Notes on the hero components**
- **Split Review grid**
  - Built on AG Grid Community, with `themeQuartz.withParams` for both modes: 40 px rows, wrapper radius 0, rule-coloured borders, Mona Sans, and a pod-coloured focus ring.
  - Custom renderers draw pencil and ink values, the kilos-per-tree bar, confidence rings, rule chips, the hatched rail cell, and the status cell.
  - Rows never contain slabs.
  - Cells flash jade only for changes driven by PayPal, and pencil only for engine recomputes.
- **Hold cards**
  - Two voices on each card. The engine line is a template, and every digit in it comes from code. Claude's line is in pencil and contains no digits; one with a digit fails validation and is regenerated.
  - The gate chip reads either "Blocks approval. Changes kilos." or "Reserves this line only. Never redistributed."
- **Approval control:** the only d3 jade slab on the console. A 1,600 ms hold in four ratchet steps, plus the dialog route.
- **Two-key approval**
  - The Approve column, the seal, two key slots, the presence label and the QR code.
  - Ed25519 signatures over the RFC 8785 canonical form of the batch.
  - The Payouts tool re-hashes the batch and refuses to send if it does not match.
- **Statement card**
  - The member's white original copy, with radius 0.
  - Money comes first, audio second, then the receipt.
- **Slip-reading viewer**
  - A filmstrip of photos, the active photo with zoom about the pointer, the reading band, and print beds where rows land.
  - Crop rectangles come from the reviewed fixtures, never from model bounding boxes.
- **Flow visualisation**
  - The split fan (64 paths, stroke width proportional to √amount, minimum 1.5 px), the funding arc, and the rail bar.
  - Each has a Data mode table.
- **Webhook and live timeline**
  - Three lanes: Machine (Claude and the engine), People, and PayPal.
  - Each row leads with plain words. The event name, IDs, source (webhook or status check) and signature result follow in caption type.
  - Statuses only move forward.
- **Proof page:** described in section 6.

## 6. Screen specs

### Judge stage (web, at /judge)

**J1 Stage**
- **Top bar:**
  - The notice: "Judge Mode. Real PayPal sandbox calls on US test accounts. Slip reading replays a recorded Claude run (29 Oct). People, slips and the co-op are synthetic."
  - Links for "What's real", Sound and Reset.
  - A live Proof counter chip.
- **Main area:** the console on the left, and a 420 px dock on the right.
  - The dock holds one live phone frame, which follows the role currently in play and has tabs for Member, Chair and Clerk.
  - The frame runs the Expo web export from the same origin, at /app.
  - At widths of 1920 px or more, all three frames show at once.
- **Bottom:** a ribbon showing the last three run-log events.
- **First view:**
  - "Season 2026-A is ready to pay."
  - The 12 photos lie on the lacquer as a contact sheet, glowing.
  - The bolted BR 2026-04 plate with its hash, and the invoice plate showing US$4,333.50 hollow.
  - One d2 slab: "Mark Lantern Bay's invoice paid (sandbox)". The member frame shows "Gisusi pa".
- **After that:** the Run pill names the next human step, and the slab for each step is pre-focused. The median time from a judge's first press to the batch post should be under 60 s.
- **States:**
  - Queued: "PayPal's sandbox is pacing us. You're next, about 40 s."
  - Resetting: "Starting a fresh run. About 10 s."
  - Sandbox balance low.
  - Each visitor is isolated by their own runSeq.
- **"What's real" sheet**
  - Real:
    - The invoice, created through the Agent Toolkit 1.11.0.
    - Record-payment, and the verified INVOICE.PAID webhook.
    - The typed Payouts POST and its item webhooks.
    - The ERRPYO002 failure, and a duplicate webhook delivery.
    - Ed25519 signatures.
  - Replayed: Claude's reading, with its recording date. A rate-limited "Read a slip live" button runs one slip for real.
  - Simulated: push banners, the biometric step (a labelled demo key), the scanner (sample slips), and SMS.

### Console (web, for the treasurer)

**C1 Season (home)**
- **Layout:**
  - The stencil mark "2026-A" with "Bulawanon Kakaw Growers MPC, Calinan".
  - A run strip of six stages in sequence (a true sequence): Ratified 14 Mar, Funded, Read, Checked, Approved, Paid.
  - The pool, labelled directly: premium US$2,887.50 (with a lock), bonus US$1,386.00, disbursement US$60.00.
  - The invoice plate:
    - "Drafted by Claude with the PayPal Agent Toolkit. Sent by Analyn."
    - Memo: "Season 2026-A, RC 7f3a 91c2, lot LB-PH-2026-03".
    - The auto-cancel date, 30 Nov.
  - The eval waffle: 40 cells, filled from the latest real eval run.
  - The next action, for example "3 holds need you".
- **Moment:** the INVOICE.PAID arc.
- **States:**
  - Before ratification: "Ratify a rate card before the first slip."
  - Waiting: "Sent to Lantern Bay. Waiting for payment."
  - Unverified: "A payment notice arrived that we couldn't verify. Nothing starts until PayPal confirms."
  - Funded: "Marked as paid in sandbox."
  - Auto-cancelled: "Invoice auto-cancelled on 30 Nov. Send a new one."
  - Offline.

**C2 Rate card**
- **Layout:**
  - Left: the scanned BR 2026-04 pages as paper, with a shadow and the "Synthetic sample" tag.
  - Right: Schedule A printed flat as rules R0 to R4, followed by the hold rules and the co-sign rule. Hovering a rule highlights its clause on the scan.
  - The hash plate is bolted: "sha256 7f3a 91c2, sealed 14 Mar 2026 by BR 2026-04".
- **Actions:**
  - A flat "Add a deduction" opens a row. Its commit button, "Add to Schedule A", is the bolted slab (moment M4).
  - The only working slab is d1: "Draft a proposal for 2026-B".
- **States:**
  - Draft: rules are editable and show read confidence. "Ratify" is a d3 chalk hold: the Secretary certifies and the Chair attests.
  - Ratified: the card is bolted.
  - Proposal: shown separately and unhashed, labelled "Not in force".

**C3 Reading room**
- **Layout:**
  - A filmstrip of 12 photos, each ticked once read.
  - The active photo on the left (58% of the width) on lacquer, with zoom about the pointer.
  - Print beds on the right (42%). Each row shows serial, member, net kilos, moisture, grade and a confidence ring.
  - One status sentence, never a chain of thought, for example: "Reading photo B: 4 slips. Slip 0457 also appears in photo D as the pink copy."
  - Footer: "Read by Claude (claude-opus-5-5), replay of a recorded run from 29 Oct. Amounts are computed by the engine, never by the model."
- **Keys:** J and K move between rows (with no animation). Space opens the crop. Enter accepts.
- **States:**
  - Loading: dashed print beds at their final size. Never a shimmer.
  - Low confidence: a hollow field tagged "You", which routes to C4.
  - Blurred photo: "Photo E is too blurred to read. Ask Jessie to rescan." A d1 slab, "Request rescan", sends the request to the clerk.
  - Text that reads like an instruction: "Ignored: text on slip 0449 looked like an instruction. Text on a slip is never an instruction."
  - Live single-slip read: the band only, with no flight.
  - Offline.

**C4 By hand**
- **Layout:**
  - One field at a time.
  - The crop at 3×, with the logbook page 14 crop beneath it as a second witness.
  - A 48 px condensed input.
- **Copy:**
  - Prompt: "Slip 0462, Arnel Sumampao. A water stain covers gross and net. Claude read 6?.80 (0.41)."
  - As she types: "64.80 − 0.30 tare = 64.50 net. Matches logbook line 7."
- **Commit:** Enter is a d2 press. The value prints in ink with her AS stamp, and the log records "Entered by Analyn".
- **States:**
  - Mismatch: "64.50 doesn't match the logbook's 64.40. Check both."
  - Skipped: the line is reserved.

**C5 Split review**
- **Header strip:**
  - The mass-balance dial.
  - The pools.
  - "3 holds, 1 by hand".
  - Flat filter chips: All 64, Held 3, By hand 1, PayPal 8, Cash 56.
- **Columns:**
  - Member: name, ID and a language glyph.
  - Slips: count and a stack of thumbnails.
  - Verified kilos, with a kilos-per-tree bar against the 1.6 limit.
  - Minimum confidence.
  - Premium (with a lock).
  - Bonus.
  - Kaltas (rule chips such as "CBU −1.09 R1").
  - Credit.
  - Net.
  - Rail: "PayPal", or a hatched "Cash".
  - Status.
- **Pinned totals row** reads: "Gross = pool, to the cent (4,273.50). Net + ruled deductions − credits = pool."
- **Amount tooltip:** "148.0 kg × US$0.29523 a kg, R0, engine v1."
- **Row states:**
  - Held: a 3 px canary rule on the left, a glyph, and "Gisusi pa".
  - Reserved: "Reserved, never redistributed."
  - Webhook changes flash the cell in a jade wash.
  - Enter opens the hold drawer (C6) or the member line (C9).
- **Screen states:**
  - Loading: skeleton rows.
  - Empty: "No lines yet. They appear once the slips are read."
  - Batch declined: a red banner, the only red on this screen.

**C6 Hold drawer (560 px)**

H1, duplicate slip

| Part          | Content                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine line   | "Slip 0457 is in two photos: the white original (B) and the pink duplicate (D). Counting both moves US$17.94 from 63 members to Nong Dioning and puts shrink at 2.05%, over the 2.0% limit." |
| Claude's line | "The second image is the office's pink copy of the same receipt."                                                                                                                            |
| Gate          | Blocks approval.                                                                                                                                                                             |
| Actions       | Slab: "Count it once". Flat: "These are two deliveries" (needs a reason and the Chair).                                                                                                      |

H2, implausible yield

| Part          | Content                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| Engine line   | "Merlyn Ponce: 300.0 kg from 140 registered trees is 2.14 kg a tree. The limit is 1.6."              |
| Claude's line | "Her deliveries suggest a second plot that isn't in the registry yet."                               |
| Gate          | Blocks approval.                                                                                     |
| Actions       | Slab: "Register a plot". The form takes P-053-B, 0.60 ha, 330 trees; the plot point is kept private. |
| Result        | "300.0 kg from 470 trees is 0.64 kg a tree. Inside the limit."                                       |

H3, deduction with no rule

| Part          | Content                                                                                                                                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine line   | "'Multa (absent GA) ₱200' on slip 0458 matches no Schedule A rule. It was netted from Nong Tidoy's cash at the bodega, so it returns as a US$3.20 correction credit paid by the co-op, not from Lantern Bay's pool. Hauling ₱91.20 (R2) stays." |
| Claude's line | "The clerk noted a fine for missing the general assembly."                                                                                                                                                                                      |
| Gate          | Reserves this line only. Never redistributed.                                                                                                                                                                                                   |
| Action        | Slab: "Return the ₱200 as a credit".                                                                                                                                                                                                            |

**Drawer states:**
- Open.
- Resolving: the slab is pressed.
- Resolved: flush ink with the AS stamp and the time.
- Asked the Chair: "Asked Ernesto".
- Conflict: "Ernesto is viewing this hold".

**C7 Approve**
- **Layout:** one centred 640 px column, with no cards. From top to bottom:
  - The seal at 200 px, with no rings yet.
  - "US$368.39" at 72 px condensed, in pencil.
  - "8 payouts by PayPal", with a hatched rail bar: "56 members, US$3,849.78, cash at the bodega on 30 Oct".
  - The fee line: "PayPal fees: sandbox $0.25 × 8 = $2.00. In production to the Philippines, 2% = $7.37. Both covered by Lantern Bay's $60.00 disbursement line."
  - A printed list of why it is safe: "3 holds resolved. 1 field entered by hand. Shrink 1.62%, inside 2.0%. 64 of 64 lines explained. Rate card unchanged since 14 Mar."
  - The d3 jade slab, 560 × 64 px: "Approve 8 payouts", with "Hold to approve" beneath.
  - Two key slots:
    - "Analyn R. Sumalinog, Treasurer"
    - "Ernesto P. Cabahug, Chairperson. Needed: batch over US$300 (Schedule A)."
  - Judge Mode adds a QR card: "Co-sign as Ernesto from your own phone. Uses a labelled demo key."
- **States:**
  - Blocked: the slab sits flush and hatched, with "Resolve 1 hold that changes kilos first" linking to the hold.
  - Ready: the slab rises.
  - Key 1 signed: the inner rings are engraved, with "Waiting for Ernesto" and the presence label.
  - Declined by the Chair: his reason, in his ink.
  - Expired: "The co-sign request expired. Send again."
  - Posting: "Posting batch 2026A-7f3a91c2-r37. The Payouts tool re-hashed the batch: it matches."
  - Hash mismatch: "The batch changed after it was signed. Nothing was sent."
  - Server error: "PayPal didn't answer. Retrying with the same request ID, so no one is paid twice. Attempt 2 of 5."
  - Batch denied (red): "PayPal declined the batch: the balance is too low. Nothing was sent. Top up and post again."
  - Kill switch: the slab is bolted, with "Payouts paused by the co-op."

**C8 Run**
- **Top half:** the split fan (moment M6).
- **Bottom half:**
  - The three-lane run log, newest first.
  - Latency dots from INVOICE.PAID to each SUCCEEDED, with the median (p50) and the maximum.
- **Example rows:**
  - "Paid Consolacion Bacus US$64.45", followed by "PAYMENT.PAYOUTS-ITEM.SUCCEEDED, item 5KX…, webhook, signature verified".
  - "Delivery repeated, already applied."
- **States:**
  - Waiting: "Posted 10:21:41. PayPal confirms each payment as it lands." An elapsed timer runs, and a 5 s reconcile poll names itself when it is the one that flips a row.
  - Failed item: a red end cap and a canary "Parked" chip. Actions: a d2 slab, "Pay in cash at the bodega", and a flat "Re-send after Rhea confirms her email".
  - Batch denied: "No money moved."
  - Done: "7 paid by PayPal. 57 in cash. US$21.14 returned to members. Invoice to last confirmation 3 min 12 s."

**C9 Member line and print**
- **Contents:** the ReceiptBar, the member's slips with crops, the line's event history, and an SMS preview labelled "Preview, not sent".
- **Print statement** produces an 80 mm statement (`@page 80mm`) for cash members, containing:
  - A large amount.
  - The seal in black.
  - A QR code linking to the audio.
  - A "Nadawat" (received) box for a signature or thumbmark, with a witness line.

**C10 Command menu and shortcuts**
- ⌘K lists every action with its shortcut, plus theme, language and sound.
- ? opens a shortcut sheet grouped by task.
- D switches to Data mode.

### Brand (web)

**B1 Proof, signed-in brand view**
- **Layout:** the same column as P1, plus a header strip with:
  - Invoice status: "Paid. Marked as paid in sandbox."
  - "Export proof (CSV and JSON with hashes)".
  - "Request the next audited pay run".
- **Data access:**
  - Member names are visible under the data-sharing agreement.
  - Plot coordinates appear only in the export.
- **States:**
  - Unpaid: "Pay invoice in PayPal" opens PayPal's own hosted invoice page.
  - In progress: "3 of 8 confirmed", updating live.
  - Mismatch: the proof is withheld.

### Public Proof (web, light only)

**P1 Proof**
- **Hero:**
  - "Lantern Bay paid US$4,333.50 for Season 2026-A. Here is where it went."
  - The seal at 320 px and the stencil lot mark.
  - "Verify in your browser" as a d1 slab.
- **The chain:** six plates on one rule, in a real sequence. Each expands in place to show IDs and hashes.
  1. Invoice paid.
  2. Rate card ratified.
  3. Slips read.
  4. Lines computed.
  5. Two keys.
  6. Payout items.
- **Metrics:**
  - Lines explained: 64 of 64.
  - Premium paid to members: 100%, with no deductions.
  - On PayPal: 7 of 64 members, 8.1% of value. The rest is shown hatched.
  - Holds caught: 3, and US$21.14 returned to members.
  - The eval waffle.
  - Time from invoice to last confirmation, live.
- **Plot field:** abstract dots sized by kilos, with the caption: "Positions are abstract. Plot coordinates are shared with Lantern Bay under the data-sharing agreement, never published."
- **Privacy:** member IDs only (for example M-014), never names. This is required by the Philippine Data Privacy Act (RA 10173).
- **Footers:**
  - "Bank reconciliation runs nightly and is about 9 hours behind."
  - "A sandbox prototype on a synthetic Davao cacao co-op. No real farmer was paid."
- **States:**
  - No run yet.
  - In progress: plate 6 reads "Waiting for PayPal".
  - Verified: each check shows an ink check mark and "Matches". Not jade, because jade means money.
  - Failed (red, naming the exact plate): "The batch hash doesn't match the signed batch. Proof withheld."

### Fair Split app (Expo, Android first; also the judge frames)

**A0 First run**
- **Language:** three large plates (Cebuano, Filipino, English). Each has a play button that speaks a sample sentence.
- **Theme:** "Unsa ang mas klaro nimo?" (Which is clearer for you?) shows the statement in Adlaw and Tablea as two plates to tap.
- **Role:** "Ask the treasurer for your QR". Scanning it binds the phone as member, clerk or board.
- **States:**
  - Camera denied: a 6-digit pairing code instead.
  - Expired QR.

**Navigation.** A Material 3 navigation bar with three destinations per role, drawn from our tokens:

| Role   | Tabs                                               |
| ------ | -------------------------------------------------- |
| Member | Bayad (pay), Resibo (slips), Pangutana (questions) |
| Clerk  | Scan, Outbox                                       |
| Board  | Pirma (sign), Bayad, Pangutana                     |

Predictive Back works everywhere, and the layout is edge-to-edge.

**M1 Bayad (the statement)**
- **Layout:** the statement card is the white original, square-cornered. From top to bottom:
  - The co-op name and season.
  - "Maayong adlaw, Nang Celing. Salamat sa inyong paghago." (Good day, Nang Celing. Thank you for your hard work.)
  - The amount at 48 sp, with "mga ₱4,028 (gibanabana)" beneath.
  - The status capsule.
  - Paminawa, a full-width d1 slab, 64 dp tall, which receives first focus.
  - The ReceiptBar: premium 43.69 "walay kaltas" (no deductions), bonus 21.85, CBU −1.09 (R1, BR 2026-04).
  - Slip chips: 0403, 0419, 0436, 0467.
  - History: approved by AS and EC, sent, paid.
  - Footer: a small seal with "Rate card 7f3a 91c2, giaprobahan sa Board" (approved by the Board).
  - "Naa moy pangutana? Adto kang Treasurer Analyn sa bodega." (Any questions? Go to Treasurer Analyn at the bodega.)
  - A flat "Ipasusi pag-usab" (ask for a re-check).
- **States:**
  - Gisusi pa (still checking): no amount yet; kilos, slips and the expected date are shown.
  - Approved and sent: the amount is hollow, with "Gipadala na, naghulat sa PayPal 0:14" (sent, waiting for PayPal) and an elapsed timer.
  - Paid: the amount is solid, and the capsule is jade flush: "Bayad na, 30 Okt" (paid).
  - Held line: "Gisusi pa ang usa ka linya" (one line is still being checked), with who decides and by when.
  - Cash: a hatched band, "Andam sa bodega, 30 Okt" (ready at the bodega). The amount stays hollow until it is received.
  - Received: "Nadawat" (received).
  - PayPal failed: "Wala madawat sa PayPal. Si Treasurer Analyn ang mohukom kung ibalhin sa cash." (Not received through PayPal. Treasurer Analyn will decide whether to move it to cash.)
  - Offline: the cached statement, with "Katapusang kopya" (last copy) and the time.

**M2 Resibo (slips)**
- **Layout:** her slips, each with a thumbnail and kilos. Tapping any figure on any screen runs M7 inside the current screen.
- **States:**
  - Loading: the crop loads at low resolution first.
  - Voucher: a typed document shows instead of a photo.
  - "Dili tugma?" (doesn't match?) starts a review request.

**M3 Paminawa (listen sheet)**
- **Layout:**
  - The transcript at 22 sp, with the current sentence underlined in ink.
  - Play and pause at 72 dp.
  - "Hinay" (slow) plays at 0.85×.
  - Language chips.
  - Lock-screen controls.
  - The label "Synthetic voice (Gemini TTS)".
- **Behaviour:** when the voice says "resibo 0403", that chip rises 8 dp (settle) and stays lit for 1.2 s.
- **States:**
  - Audio missing: device text-to-speech, labelled as such.
  - Hiligaynon: "Text only for now."
  - Offline: cached audio plays.

**M4 Pangutana (questions)**
- Who to ask, where, and when.
- "Ipasusi pag-usab" sends the line and slip to the Mediation and Conciliation Committee.
- The status of any open request.

**K1 Clerk: scan and outbox**
- **Layout:**
  - A Material 3 top app bar with a station chip ("Purok 2 pickup").
  - One floating action button, "Scan resibo". It opens the system document scanner behind our own component. If that API fails, it falls back to the camera with an edge guide.
  - The outbox: thumbnail, serial, member hint, file size and a progress ring per slip.
  - Rescan requests from the console appear as a banner.
- **States:**
  - Offline: "Walay signal. 3 ka resibo natipigan sa telepono." (No signal. 3 slips saved on this phone.)
  - Uploading.
  - Read: "4 rows read".
  - Quality gate: "Too dark. Scan again."
  - Same file sent twice: "Already sent at 09:12."
  - Failed: "Retrying in 40 s", with Send now.

**D1 Board: co-sign request**
- **Notification:** "Co-sign Season 2026-A: 8 payouts, US$368.39", with the seal rendered by resvg.
- **One scroll**, top to bottom:
  - The amount.
  - Why him: "The batch is over US$300."
  - The three resolved holds, one line each, with who resolved them.
  - The seal, to compare with the console.
  - "Analyn is on the approval screen".
  - "Ipabalik kang Analyn" (send back to Analyn), which needs a reason.
- **States:**
  - Expired.
  - Changed: "The batch changed after you opened it. Nothing was signed. Review again."
  - Offline: "Signing needs a connection." A signature is never queued.

**D2 Board: sign**
- **Layout:** a d3 jade slab, "Pirmahi" (sign), 64 dp tall, in the thumb zone, with "Hold, then use your fingerprint".
- **Flow:** hold for 1,200 ms, then the biometric prompt, then the Ed25519 signature.
- **Result:** "Signed. Key fs-ernesto-a1. The batch hash matches the console."
- **Web frames** say "Demo key".
- **States:**
  - No biometric: the device PIN is used.
  - Cancelled: the slab springs back and nothing is signed.
  - Mismatch: a clack and an error.

## 7. The magic moments

### Video beat sheet (2:50)

| Time | Beat                                                               |
| ---- | ------------------------------------------------------------------ |
| 0:00 | M1 Bayad na                                                        |
| 0:09 | Title, one persona, one cited figure                               |
| 0:20 | Funding: the Toolkit invoice, record-payment, the INVOICE.PAID arc |
| 0:32 | M2 Paper prints itself                                             |
| 0:44 | M3 The pink copy                                                   |
| 0:56 | H2 and H3 resolved                                                 |
| 1:04 | M4 Bolted                                                          |
| 1:10 | M5 Two keys                                                        |
| 1:24 | M6 Honest fan-out                                                  |
| 1:42 | Proof: Dana verifies                                               |
| 2:00 | M7 Tap a peso                                                      |
| 2:12 | Architecture map (see below)                                       |
| 2:34 | Limitations said aloud, and the live metrics                       |

**Narration**
- Keep it sparse: the Gemini TTS voice is disclosed in the captions.
- Product sound never plays under the voice.
- Captions run throughout.

**The architecture map (2:12)** names:
- Invoicing v2 through Agent Toolkit 1.11.0.
- Verified and deduplicated webhooks.
- The typed Payouts tool, with the URL of its PR.
- Claude, and the deterministic engine.
- Render and APIMatic.
- The test count.
- The prior art (Clause-to-Cash, Tributary, SarafuPay and harambee), with one sentence on how Fair Split differs.

**Done-definition for every moment:** a Playwright or Maestro assertion on its `data-moment-phase`, a reduced-motion version, and a recording from the real event.

### M1 Bayad na (cold open, 0:00–0:09)

**Trigger.** A real PAYMENT.PAYOUTS-ITEM.SUCCEEDED for M-014, verified and deduplicated, arrives over the run's WebSocket. A push notification wakes the app if it is backgrounded.

**Before it starts.** The amount is already hollow, and the capsule reads "Gipadala na, naghulat sa PayPal 0:14".

**Choreography**

| Time       | What happens                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| 0 ms       | The capsule takes PayPal's press: its 5 px inset closes to 0 (press, 90 ms).                            |
| 90 ms      | Jade floods the capsule from its bottom-right corner (scale 0 to 1, 140 ms ease-out).                   |
| 120 ms     | The hollow amount fills in as the solid layer fades in over 120 ms. No scaling, no counting.            |
| 180 ms     | The chime plays (E5, G♯5), with two haptic taps 90 ms apart (iOS Success twice; Android Confirm twice). |
| 400 ms     | The label crossfades to "Bayad na, 30 Okt" (200 ms).                                                    |
| 900 ms     | Paminawa pulses once with a 1 px ink ring (400 ms).                                                     |
| Video 0:05 | A thumb taps Paminawa. Cebuano audio starts 120 ms after release, captioned in English.                 |

The same message updates the console grid and the Proof counter within 100 ms; the video shows this at 1:24.

**Engineering.**
- Reanimated shared values drive the motion. The jade flood is a View scaled with `transformOrigin`.
- The hollow amount is react-native-svg outline text stacked over a React Native Text.
- One message type, `item.updated`, carries statuses that only move forward.

**Low-end fallback.** Jade fades in over 120 ms instead of flooding from the corner, and the amount fills instantly. Sound and haptics stay.

**Reduced motion.** Colour and label crossfade over 150 ms, with no inset travel.

### M2 Paper prints itself (0:32–0:44)

**Trigger.** Each extraction row event from the replayed recording of a real Claude run. The live single-slip path shows only the band.

**Choreography for each row**

| Time           | What happens                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| 0–220 ms       | The band (a 1 px chalk line over a 6% wash) slides to the row's printed line, using the reviewed fixture.         |
| 220–340 ms     | The crop lifts: the evidence shadow grows and the crop scales from 1 to 1.04, as a tween.                         |
| 340–940 ms     | The crop flies along a curve to its print bed.                                                                    |
| 640–940 ms     | The handwritten digits fade and blur from 0 to 2 px while the Mona Sans digits resolve from a 2 px blur to sharp. |
| 940–1,120 ms   | The row prints with a clip wipe, and a tick plays.                                                                |
| 1,120–1,360 ms | The confidence ring draws.                                                                                        |

**Pacing.** The next row starts 180 ms after the previous one lands. At most eight crops fly at once; later rows land without flying.

**Low confidence.** A field below 0.85 prints hollow with the "You" tag. At 0:42 Analyn enters slip 0462 by hand: a d2 press, a plunk, and her AS stamp.

**Engineering.**
- The flying element is a div whose background is the photo, positioned to the crop. No canvas.
- Fixture rectangles are mapped through the image's object-fit transform.
- The blur filter applies only to the two layers of digits.

**Fallback (also used for reduced motion).** No flight. A 2 px pencil outline appears on the crop, and a 1 px connector line to the row is shown for 600 ms. The band jumps instead of sliding.

### M3 The pink copy (0:44–0:56)

**Trigger.** The engine's duplicate check (same serial, same kilos) raised H1, and Analyn opens it.

**Choreography**

| Time         | What happens                                                                                                                                                                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–450 ms     | Photos B and D glide in side by side.                                                                                                                                                                                                                                                               |
| 450–900 ms   | The two 0457 crops lift and converge on the centre line. In the fixture these crops are already aligned, converted to greyscale and matched in levels. The top crop uses `mix-blend-mode: difference` over a black backing, so the overlap goes black. "Same slip. Serial and kilos match." prints. |
| 900–1,200 ms | A canary underline draws under both serials, with two ticks.                                                                                                                                                                                                                                        |

**Her decision.**

| Time     | What happens                                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On press | "Count it once": a d2 press with a plunk.                                                                                                                                          |
| +60 ms   | The needle swings from 2.05% to 1.62%, overshoots to about 1.51%, and settles. It ticks as it crosses 2.0.                                                                         |
| +200 ms  | Dioning's line changes from 80.65 to 62.71 with the digit tween. 63 rows gain cents in a downward wave (6 ms apart, capped at 380 ms). "Returned to 63 members: US$17.94." prints. |
| End      | The card resolves flush in ink with the AS stamp.                                                                                                                                  |

**Engineering.**
- CSS blending inside `isolation: isolate`.
- An SVG dial driven by the needle spring, with a tick fired when the value crosses the threshold.
- The digit tween runs inside AG Grid cell renderers.

**Fallback on weak laptops.** The crops start already overlapped.

**Reduced motion.**
- The crops crossfade into overlap over 200 ms.
- The needle cuts to its new value under a 200 ms crossfade.
- Digits change instantly with a 600 ms pencil-wash flash.

### M4 Bolted (1:04–1:10)

**Trigger.** On the rate card, Analyn types "Iba pa (Other) ₱150" and presses "Add to Schedule A". That button is bolted.

**Choreography**

| Time   | What happens                                                                      |
| ------ | --------------------------------------------------------------------------------- |
| 0 ms   | The slab does not travel. It shakes ±3 px in two 70 ms cycles, and a clack plays. |
| 120 ms | The refusal plate prints with a clip wipe (see the copy below).                   |

The refusal plate reads: "Closed list. BR 2026-04, Schedule A, allows only CBU, hauling, loans with an Authority to Deduct and advances with a voucher. A new deduction needs a new Board resolution for Season 2026-B. Rate card 7f3a 91c2." Its only slab is a d1: "Draft a proposal for 2026-B".

**Engineering.** The bolted button is the Slab primitive with travel set to 0 and CSS keyframes for the shake.

**Reduced motion.** No shake. The steel edges and bolts brighten for 200 ms, and the plate appears.

### M5 Two keys (1:10–1:24)

**Trigger.** The last hold that changes kilos is resolved, and the Approve slab rises (its edges grow from 0 to 8 px on the settle spring).

**Analyn's key (console)**

| Time                           | What happens                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| Hold begins (Space or pointer) | A linear clip fill starts inside the face and runs for 1,600 ms.                              |
| 400, 800, 1,200 ms             | The face sinks 2 px at each step (60 ms press), with a tick each time.                        |
| 1,600 ms                       | The face clunks flush and a plunk plays. The browser signs the canonical batch hash.          |
| After signing                  | The three inner seal rings engrave on the console and on Ernesto's screen, labelled "1 of 2". |
- **Early release:** the face springs back up (rebound), and "Hold until it clicks" appears once.
- **Presence:** "Ernesto, reviewing hold 2 on his phone" glides in.

**Ernesto's key (the judge's own phone via QR, or the Chair frame)**

| Time             | What happens                                                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hold begins      | A 1,200 ms hold, with a selection or Segment_Tick haptic at each quarter.                                                                                                                             |
| Bottom out       | Heavy, then Success. Then the biometric prompt (or the demo key on web), then the Ed25519 signature.                                                                                                  |
| Within 100 ms    | The two outer rings engrave on both screens. The seal lands (land spring, scaling from 1.03 to 1) with a plunk an octave lower. "Waiting for Ernesto" crossfades to "Approved by Analyn and Ernesto". |
| Behind the panel | The sheet inks: every pencil figure in the grid crossfades from graphite to ink over 240 ms.                                                                                                          |

**Engineering.**
- Signatures cover the RFC 8785 canonical form of the batch.
- The server refuses any mismatch before the POST.
- This is the two-context Playwright take.

**Low-end Chair phone.** The rings appear complete with a 200 ms fade. The ticks stay.

**Reduced motion.**
- A static stepped bar with a percentage replaces the face travel.
- The edges fade instead of moving.
- The rings fade in.

**Accessibility.** Enter, or a screen reader, opens the ConfirmDialog showing the amount and recipients, then asks for the key.

### M6 Honest fan-out (1:24–1:42; waits shown at ×12, labelled)

**Trigger.** The 201 from the typed Payouts POST, then each verified PAYOUTS-ITEM event.

**Choreography**

| Event                                | What happens                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On the 201                           | The 8 PayPal threads draw from 0 to 70% in graphite (500 ms, staggered 40 ms): sent, not confirmed. The 56 dashed cash lines are already drawn and stay still, labelled "56 members, cash at the bodega".                                                                                                                           |
| Each SUCCEEDED, after deduplication  | The thread completes from 70 to 100% (300 ms) and turns jade (200 ms). Its member stub takes PayPal's press (land spring, 3 px inset closing) and floods jade. The next note of the scale plays. The same message updates the console row, Nang Celing's frame (M1) and the Proof counter within 100 ms, and a latency dot appears. |
| Rhea's ERRPYO002 item                | Her thread stays at 70%. A 6 px red square end cap prints, a canary "Parked" chip appears, and a thud plays. Analyn presses "Pay in cash at the bodega" (d2): the thread retracts over 300 ms and a dashed cash line draws in its place, with a plunk.                                                                              |
| A duplicate delivery of a real event | One log row appears: "Delivery repeated, already applied." Nothing else moves, and nothing plays.                                                                                                                                                                                                                                   |
| End                                  | The run card prints its summary. There is no celebration.                                                                                                                                                                                                                                                                           |

Copy colour and UI text are driven by the item's actual `transaction_status`, never by the test value. Record on day 1 exactly which status ERRPYO002 produces.

**Engineering.**
- The fan is one SVG with 64 paths, using `pathLength=1` and dash offsets.
- Events come from the append-only log over a single WebSocket.
- Data mode renders the same information as a table.

**Reduced motion.**
- Threads appear already at 70%, and completion is an instant colour change.
- Stubs change colour without the inset press.

### M7 Tap a peso (2:00–2:12)

**Trigger.** Nang Celing taps "US$43.69" on her ReceiptBar.

**Choreography**

| Time          | What happens                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0–90 ms       | The figure lifts into a 1 px ink frame.                                                                                                                                                                      |
| 90–540 ms     | A container transform (glide) expands the line in place: "148.0 kg × US$0.2952 a kg (R0). Walay kaltas." Four slip chips appear.                                                                             |
| She taps 0403 | The view zooms about her tap point from 1× to 2.4× (glide), into the crop where "38.45" is written in Jessie's blue capitals. The statement dims to 20%. A Rigid haptic fires at 1.6×.                       |
| Then          | Crops 0419, 0436 and 0467 tile beneath, with their sum printed flat: "148.0 kg". Paminawa speaks: "Gikan kini sa inyong resibo 0403…" (This comes from your slip 0403…), and the chip lights as it is named. |
| Back          | Predictive Back plays the zoom in reverse.                                                                                                                                                                   |

**Engineering.**
- Everything happens in one screen, with no shared-element transitions and no Skia.
- expo-image shows the photo, and Reanimated maps the crop rectangle to the viewport.
- On Proof, the same zoom works with a wheel or trackpad.

**Low-end fallback and reduced motion.** A 200 ms crossfade goes straight to the crop at its final scale.

### Supporting beat: INVOICE.PAID (0:20–0:32)

When the verified webhook arrives:
- A single jade arc draws from the invoice plate to the pool (600 ms).
- The pool turns from hollow to solid.
- "Funded" lands as jade flush (land spring).
- E4 plays.

**Reduced motion.** Colour changes only.

## 8. Accessibility and localisation

**Standards**
- The console and Proof meet WCAG 2.2 AA. Statement copy meets 7:1 contrast.
- Token contrast is tested in CI, and axe runs inside Playwright.
- Every hold-to-commit has a dialog route, so no action depends on timing alone.
- Focus is a 2 px pod-coloured ring at 2 px offset. It moves with the slab face and is never hidden by a drawer.
- Every interactive state has a keyboard path: ⌘K, ?, J and K, Enter, holding Space, and D.

**Screen readers**
- Amounts are read as full phrases: "sixty-four dollars and forty-five cents, about four thousand twenty-eight pesos, estimate".
- Slabs announce their label, amount and consequence: "Approve 8 payouts, 368 dollars 39 cents, moves money, button".
- Live regions are polite and throttled to one summary every 5 s, for example "3 of 8 confirmed".
- Visualisations are hidden from screen readers and mirrored in Data mode tables.
- The AG Grid has proper row and column headers.
- Native views set accessibilityLabel, Role and State, and TalkBack labels follow the app's language.
- Colour never carries meaning alone: every state has a glyph and a word, and cash has hatching and a word.

**Large text**
- Web reflows at 200%.
- Native is tested at font scale 1.3 and 2.0 using adb.
  - Statements stack into one column, and the ReceiptBar becomes a list.
  - The hero amount is capped at `maxFontSizeMultiplier={1.5}` because it already starts at 48 sp. Everything else scales to 2.0.
  - Android 14's non-linear font scaling is respected.

**Low literacy and older members**
- Order of information: money first, audio second.
- The statement reduces to three facts: what you received, why, and from which slips.
- Paminawa is the largest control, and it gets first focus for members flagged as elderly or as signing with a thumbmark.
- Icons always come with words.
- Members see their own slip crops as the proof.
- The printed statement has a thumbmark box.

**Languages**
- Members default to Cebuano, with Filipino (Tagalog) and English one tap away on every member surface.
- The console is in English but uses the co-op's own words: resibo, kaltas, purok, bodega.
- Strings use ICU MessageFormat, with a 35% budget for text expansion.
- Dates are written like "30 Okt 2026", and numbers use en-PH formatting.
- Honorifics come from the member registry, never guessed: Nang or Nong in Cebuano; Gng. or G. with po in Filipino.
- A hold is always "Gisusi pa", "Sinusuri pa po" or "Still checking". Never "error", "fraud" or red.
- Every Cebuano and Filipino string is marked "machine-translated, pending native review" in i18n/REVIEW.md, and shows a chip in Judge Mode, until a native speaker signs it off before filming.

**Number safety**
- Amounts come only from templates.
- Any sentence the model writes that contains a digit is rejected and regenerated.
- Text-to-speech reads money from word templates, in the register the native reviewer approves. English numerals for money are common in Davao Bisaya.

**Audio**
- Generated with Gemini TTS on the free tier, pre-rendered for synthetic members only.
- One clip per sentence, so the highlight timing is exact.
- Encoded as 32 kbps mono AAC and cached for offline use.
- "Hinay" plays at 0.85×, and every clip is labelled as a synthetic voice.
- **Day-1 test:** Google lists Cebuano (ceb-PH) only as a Preview language for Gemini-TTS on Cloud, and we could not confirm it on the Gemini API.
  - If Cebuano fails, ship Filipino audio with Cebuano text and say so in the UI: "Audio sa Filipino; teksto sa Cebuano".
  - Hiligaynon, Waray and Bikol are text only, and the UI says so.

**SMS (preview only)**
- Messages stay within GSM-7: ñ is in the basic set, but ₱ is not, so the peso is written as "P".
- At most 160 characters per segment.

## 9. Performance budgets

| Surface                                  | Budget                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proof (public, mobile first)             | Largest contentful paint ≤ 1.8 s on a mid-range Android over Fast 4G. Initial JS ≤ 110 KB gzip. Verify chunk ≤ 45 KB gzip, loaded lazily. Fonts ≤ 80 KB. Layout shift ≤ 0.05. Interaction to next paint ≤ 150 ms.                                                                                                                     |
| Console                                  | Initial route JS ≤ 300 KB gzip. AG Grid chunk lazy-loaded, ≤ 300 KB gzip. Fonts ≤ 170 KB. J/K responsiveness ≤ 50 ms. 60 fps during moments on a 2020 laptop's integrated GPU, with ≤ 4 ms of main-thread work per frame. Photos 1,600 px WebP ≤ 250 KB; crops ≤ 40 KB.                                                               |
| Judge stage                              | Console interactive in ≤ 2.5 s. Phone frames load lazily after the console is idle, all three within 6 s on broadband. The server stays warm, with no free-tier spin-down from 1 to 15 Dec. ≤ 60 s of judge time from the first press to the batch POST.                                                                              |
| Android app (2 GB RAM, 720p, Android 10) | Cold start ≤ 2.5 s (Hermes, release build, R8). Animations use transforms only, holding 60 fps with p95 ≥ 55 fps measured with gfxinfo by 1 Nov. APK ≤ 35 MB per ABI, including armeabi-v7a. JS bundle ≤ 3 MB. Memory ≤ 180 MB. Statement JSON ≤ 8 KB. Audio ≤ 200 KB per statement. Crops 720 px WebP ≤ 90 KB. Season cache ≤ 15 MB. |
| Sound                                    | Web: synthesised, so 0 bytes. Native: WAV ≤ 30 KB each, preloaded.                                                                                                                                                                                                                                                                    |
| SVG                                      | Split fan: 64 paths. Seal: ≤ 5 paths of ≤ 2,000 points each. Seal PNG from resvg for push and print: ≤ 40 KB.                                                                                                                                                                                                                         |
| Builds                                   | Android builds run on EAS, which avoids Windows MAX_PATH failures. iOS appears only as a 5-second simulator clip from an EAS simulator build driven by Maestro on a GitHub macOS runner.                                                                                                                                              |

## 10. What we deliberately cut, and why

| Cut                                                                                                               | Why                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| The living map: WebGL/PixiJS streams, d3-geo river routing, particles, real geography                             | It was the least feasible concept and a single point of failure. Plot coordinates on a public page also raise a privacy problem under RA 10173. |
| Skia anywhere                                                                                                     | CanvasKit is several MB on web and adds weight to every native ABI. SVG and Reanimated cover the seal and the zoom.                             |
| Glass and blur (including iOS GlassView and Liquid Glass)                                                         | It is decoration, it fakes badly on Android, and it costs frames on cheap phones.                                                               |
| Cursors, cursor chat, ghost replay, follow mode, and scrubbing or rewinding the log                               | About two weeks of distributed state, and staged unless a second person joins. A real co-signer arriving by QR is stronger.                     |
| A separate brand console, and live attendance for the brand                                                       | It would be a half-built second product. Proof with a brand header covers the brand's actual job.                                               |
| AG Studio and its agent harness                                                                                   | Not on the critical path, and it raises an alarm for some judges. AG Grid Community, fully themed, carries the grid.                            |
| The "Ask about this pay run" box                                                                                  | It reads as a chatbot bolted on, which some judges treat as an automatic fail.                                                                  |
| The Bodega Window mode, Android 16 Live Updates, Pulsar haptic ramps, @expo/ui beta, NativeTabs                   | Too much scope for too little story. The 80 mm print covers cash members.                                                                       |
| Count-ups, confetti, the pointer sheen on slabs, ambient loops longer than 60 s, celebrations aimed at the member | Money arrives as a change of status, not a show.                                                                                                |
| Width-axis tricks and the dark-mode weight shift on native                                                        | React Native cannot drive font axes.                                                                                                            |
| Monospace, and Big Shoulders anywhere except lot marks                                                            | Generic labelling habits.                                                                                                                       |
| A second, fully art-directed theme on every surface                                                               | It doubles visual QA. The other theme only has to pass the token contrast tests.                                                                |
| Cross-screen shared-element transitions, and relying on React ViewTransition                                      | Still experimental. Continuity stays within one screen.                                                                                         |
| Sending real SMS or voice calls, and iPhone device builds                                                         | We show previews, and an iOS simulator clip.                                                                                                    |
| Scripted co-signers, and any replay without a label                                                               | Everything shown is real, replayed with a label, or simulated with a label.                                                                     |
| Public names Timbang, Carbon, Sapa, Tin-aw, Pink Copy                                                             | One product name and plain surface names. "Carbon" also collides with IBM's Carbon Design System.                                               |
| The HapticTrace overlay                                                                                           | Lowest priority. Only behind an environment flag, only in recordings, and labelled "shown for video".                                           |
