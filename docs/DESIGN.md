# Fair Split design system (UI gate round 7)

The single source for every surface: the console and judge stage, Proof, and the phone app. It refines the
incumbent Hayag world (white and porcelain surfaces, blue-black ink, one job per colour, no brown); it does not
replace it. Console and phone are **Operate** surfaces (the task leads, the tool disappears into it); Proof is
**Read** (one 680 px column, the verdict first). Values live in `packages/tokens/src/tokens.ts`; this file says what
they are for. When this file and older specs disagree, this file wins for look and feel; figures, test IDs and
honesty meanings never change. It lives in `docs/` (main's ownership gate owns no root file).

## 1. Type: one family and one mono

- **FS Sans** (Mona Sans, self-hosted) sets every heading, label, body line, a member's statement and every number.
  Numbers are **tabular lining figures** everywhere (one money style; Mona's tabular zero carries a slash, as the
  phone's static cuts always had).
- **The mono** (the platform's own: Cascadia Mono on Windows, SF Mono, Roboto Mono, Menlo) sets hashes, IDs and
  timestamps, and nothing else: `--fs-font-mono`, role `id`. Never words, never money, never a costume.
- Gone: the dot-matrix numerals, the stencil, the condensed pixel display face, outline numerals, Atkinson.
- **One numeral face** (round 6). On the web every figure (a money hero, an amount, a grid figure, a count) is FS Sans
  at the text's own width (100) and 500, in tabular lining figures: no condensed cut, so a number never reads as a
  second face beside its label. The mono never sets money or a count.
- **Five steps.** Weight carries the rest: 430 reading, 520 labels, 600 titles and headings, 500 numerals.

| Role (class `fs-t-*`) | Web px / line | Weight, width, tracking | Phone sp / line          | Use                                                              |
| --------------------- | ------------- | ----------------------- | ------------------------ | ---------------------------------------------------------------- |
| `hero`                | 56 / 60       | 500, 100 %, −0.02 em    | 48 / 52 (scale cap 1.5×) | The one hero number a screen: a money hero or the one hero count |
| `title`               | 24 / 30       | 600, 100 %, −0.015 em   | 24 / 30                  | Screen, sheet and drawer titles; stage and Proof headlines       |
| `heading`             | 16 / 24       | 600                     | 17 / 24                  | A heading inside a screen or drawer                              |
| `body`                | 16 / 24       | 430                     | 17 / 24                  | Body text, the panel's one line, statement prose (16 px floor)   |
| `label`               | 14 / 20       | 520                     | 15 / 20, width 100       | Controls, column headers, status words, tab labels, links        |
| `id`                  | 12 / 16       | 400, mono               | 13 / 18, `monospace`     | Hashes, IDs, timestamps                                          |

Aliases keep working on these steps: `display` `title-1` `statement-lead` = title; `title-2` `statement-status` =
heading; `lede` `statement-body` = body; `caption` `micro` = 14/20 at 430 (secondary words, short data joined by
" · "); `figure` = 14/20 numerals at 500 (the text's width); `amount-hero` = hero; `amount-l` = 24/30 numerals; `slab` = 16/20
at 600 (button labels); `hash` `mark` = id; `stamp` = 12 px initials at 700. Floors: secondary text 13 px (it sits
at 14), ids 12, body and statement 16. Prose measure 45–75 ch; a table may run wider. `US$` on a hero is `.fs-cur`
(0.42 em, raised, ink-3). Proof reads the same roles in its FS Sans Proof subset.

**The phone at width 100** (round 5). Every phone label, tab label, section head and link is the `label` role at
width 100 and 520, the console's own cut; titles are 600 at width 100. The condensed figure cut (87.5/500) sets
numerals only (`figure`, `amount*`), as on the console. In the web frames both come from the console's variable FS
Sans (`LABEL_WEB`, `TITLE_WEB`); native sets labels in the width-100 Regular and titles in the 700 cut until WS-DS's
font build cuts the static 520 and 600.

**Ids never break mid-word** (round 4). An id, key or hash is `IdText` (ui-web): the mono on one line (`nowrap`),
cut in the middle when long ("fs-ernesto…mj2ng2", `truncateMiddle`), its whole value as title and accessible name.
It clips with `overflow: clip` (never `hidden`, which would drop its baseline off the line).

## 2. Colour: one job each

| Token                                      | Hayag                       | Job                                                                                                                                      | Never                                                  |
| ------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `ink` / `ink-2` / `ink-3`                  | #0B1220 / #3A4456 / #5A6476 | Text, checked facts / secondary / meta and icons                                                                                         | ink-3 on a statement                                   |
| `pencil`                                   | #4A5A73                     | The machine's figures before two keys sign                                                                                               | A fill                                                 |
| `ground` `plate` `plate-2`                 | #F3F5F8 #FFF #F7F8FA        | Page / panels / headers, hover, inspectors, the "Earlier" tile                                                                           | Colour washes                                          |
| `rule` `rule-strong`                       | #E3E7EE #CBD2DC             | Row separators / chip and control outlines                                                                                               | A control's only edge below 3:1                        |
| `steel-line`                               | #7E8898                     | Dashed = simulated; input outlines; unsigned seal rings                                                                                  | Anything real                                          |
| `pod` (indigo)                             | #4A2FD6                     | **Action and focus**: the one primary, the focus ring, caret, selection and the selected nav or tab (`pod-wash`), signed seal rings      | Money, the machine, a person's avatar, decoration      |
| `jade` (+`jade-flush-border`, `jade-text`) | #14CC90                     | **Only money the simulated PayPal confirmed**: the paid pill and capsule, the paid dot, a confirmed thread or bar, one beat of halo      | In flight, signed, a heading, a button, a check result |
| `canary` (the person's indigo, round 6)    | #4A2FD6                     | **A person must decide**: hold dot, the H-tag's outline, You cell ring, a parked thread, the "needs you" chips' ring, the run pill's dot | Amber (gone from Hayag), text, an error, the dial      |
| `red` (+`red-wash`)                        | #CF2A27                     | **Only PayPal saying no** (DENIED, FAILED, BLOCKED, unexpected RETURNED, ERRPYO)                                                         | Holds, cash, refusals by our own rules, a chip         |
| `hatch`                                    | #A4AEBC                     | **Cash** at the bodega (or unavailable), always with the word                                                                            | Red, grey text, a tile that is not cash                |
| copy-white/pink/yellow, `--fs-evidence-*`  |                             | Evidence paper only (the D swatch's pink)                                                                                                | Chrome, a chip about a slip                            |

**No amber anywhere on Hayag** (round 6, the owner's rule: no brown, no amber). What waits for a person wears the
person's own colour: indigo is "a person did this" (a signed seal ring, the primary) and "a person must do this" (a
held dot, a hold tag's outline, a parked thread, the "3 holds open" chip's ring), always with its word. The `canary`
tokens keep their names and resolve to the indigo; the machine's readings (the dial) stay ink. No other hue appears:
no blue chip, no red chip. No wash, gradient, glow or coloured shadow on a product surface
(Hayag's `--fs-wash` is `none`). Contrast is CI-gated (`contrast.json`): UI text 4.5:1, statement text 7:1
(`statement-ink`), non-text 3:1.

## 3. Space, grid, radius, elevation

- Space (4-based): 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48 · 64. 2 and 6 only inside parts ≤ 24 px tall. Panel padding
  20–32, card 16, icon-to-label 8, between sections 32, above a hero number 48. Tight inside groups, generous between.
- **One 12-column grid** (round 4, `LAYOUT.console.columns`/`gutter`). Every console screen's root takes
  `fsc-screen` (ScreenRoot `grid`): twelve columns, a 24 px gutter, filling the stage's screen panel. Its title row
  (`ScreenHead`: the title, its id line, at most a quiet control) comes first and its content starts 32 px under it
  (`headGap`), **top-aligned**: nothing is centred in a tall panel, no dead band sits above content, no block
  floats. Cards hug their content (`Cell` aligns to the start; `stretch` only when two cards must end level). A
  `Cell` spans `span` columns where the panel is ≥ 1,040 px (1,920), `spanMd` from 720 px (1,280 and 1,470), and the
  whole row below. The screen panel is the size container `fsc-screen`.
- **Scroll columns: nothing clipped at any width** (round 5). A table body, a log or a column that scrolls on its own
  is a `SnapScroll` (chrome/SnapScroll.tsx): with `row` it rests on whole rows (rows snap under the sticky head, and
  with `rows` or `fill` its height is the head, a whole number of rows and the foot, `wholeRowsHeight`); its edges
  fade 24 px (`LAYOUT.console.fade`) only where more lies beyond (above a sticky total, under a sticky head, at the
  foot), as a plate veil that never masks the focus ring; `fill` reaches down to the panel's foot and stops 32 px
  above it (`LAYOUT.console.end`); `end` keeps 32 px of room under the last line. A sticky head and foot mark
  themselves `data-snap-head` / `data-snap-foot`; a non-table row `data-snap-row`. A log shows `PEEK_ROWS` (4) rows and
  an "All N events" disclosure, and ends 32 px above its panel's foot (`.fsc-peek`); a column's last card the same
  (`.fsc-end`). No row or card ends half-hidden anywhere.
- **No dead bands at 1,920** (round 5). Cells fill the 12 columns with meaning: a second grid row before an empty
  band (Approve's recipients under the split bar), side-by-side evidence at equal height (`stretch`), a filmstrip
  under the table rather than under a photo.
- Radius: cell 6 (chips, keys), control 12 (buttons, inputs), card 16, panel 24 (stage panels, drawers, dialogs),
  pill 999 (status pills, tags, segmented controls). Evidence paper 0.
- Elevation is declared once: **a border or a shadow, never both.** `e1` (its ring is in the shadow) rests the bar,
  the run pill and cards; `e2` holds the stage's two panels, menus and tooltips; `e3` lifts drawers, sheets and
  dialogs; `paper` is evidence only. Flat parts take a 1 px `rule`/`rule-strong` border and no shadow.

## 4. Components (use these; do not rebuild them)

- **Top bar** (rounds 4 and 5): **six calm items at most, at all times.** "Fair Split" leads; the status area holds
  only the mock chip; the centre group is "● Next: …" with "Play it for me" and the chevron, whose menu holds the
  screens, the run log, sound, Reset (while there is a session) and Shortcuts; the right holds What's real, the Proof
  counter and the simulated indicator. No grey status segment repeating the page title: the run's state word is
  spoken with the pill, never shown. The bar is `LAYOUT.console.bar` (56 px). The pill's words always start "Next:"
  (`pillWords`) and are never underlined (hover is the plate-2 fill). At 1,280 and 1,470 What's real keeps its word
  and (round 6) the indicator keeps its whole name, "Simulated PayPal sandbox", at every width: the lockup drops
  "co-op payroll" for the room, and the disclosure is never shortened. The phone visit (390) has two icons: What's
  real and the overflow, which holds Proof, the laptop line, the link, the run log, sound and Reset.
- **Buttons.** One primary per screen: `Slab` (indigo face, 48 px, radius 12, label 16/600, **hugs its label**;
  tone `jade` is the same indigo face). One secondary: `.fs-flat` (white, 1 px rule-strong, 40 px; `data-size="l"`
  48). Inline actions: `.fs-link`. A "Try" or "Why" control is `.fs-flat` or `.fs-link`, never a third style. A hold
  slab's caption and its one link read "Hold to sign · Other ways to sign" (the dot drawn, never spoken).
- **Honesty marks: provenance once** (round 5). `HonestyTag quiet` once, in the top bar. `MicroTag` (12 px dashed
  circle + **"Simulated"**, 12 px, ≤ 2 a screen; its accessible name stays "Simulated PayPal sandbox") only beside a
  PayPal money value. Every other provenance is said **once a screen, in the title row's id line**: one phrase from
  `PROVENANCE` (chrome/copy.ts: "Synthetic co-op · seeded slips", "Synthetic co-op · seed stand-in readings",
  "Synthetic co-op · simulated PayPal"), its whole sentence its title and its hidden text. No inline `LegendGlyph`
  anywhere else: not after a heading, not on a log row (a seeded or replayed row says it in its title and to assistive
  technology), not in the pill, not on paper (`Paper` keeps "Synthetic sample" in its name and title), not in a phone
  frame's corner (inside the stage's frames the phone draws no corner glyphs; `QuietMarks` keeps their hooks and
  words). `HonestyLegend` lives only in What's real. Screen tests call `tagBudget(root)` (≤ 3 tags, ≤ 2 micro).
- **Title row** (round 5). Every screen's `ScreenHead`: a noun `title` with a grey `suffix` in the same heading
  ("Season 2026-A", ink-2), its state as one `StatusChip` in `status` on the same row ("Awaiting payment", "Funded",
  "PayPal complete · cash due"), then one id line: `meta`, the run id in the mono (one run id everywhere; the first
  view shows no invoice id until a session starts), and `provenance`. Never a sentence title with full stops.
  Proof's head is the same row in the same classes ("Proof 2026-A", the run's state chip, "Lantern Bay · lot ·
  Synthetic co-op", and, as Proof has no top bar, its one quiet indicator at the row's end); under the brand's own
  title ("Proof for Lantern Bay Chocolate Co.") it reads "Season 2026-A", so "Proof" is said once. The invoice's
  amount heads the money card it adds up to; a signer reads by name and role, the key behind "IDs".
- **Status pills.** `StatusChip` / `Chip`: 28 px on the console, **32 px on the phone** (`LAYOUT.app.statusChip`,
  the label step's 15/520), glyph and word, 1 px ring. Jade is the only filled pill (confirmed); `canary` an indigo
  ring; `flight` neutral; `hatch` a hatch swatch; `red` PayPal's no. ≤ 1 pill a row, ≤ 3 kinds a screen. The phone's
  "Bayad na" is this pill, never a 64 px slab. A checked fact gets no pill: ✓ glyph and the word in ink. No pill is a
  sentence with a full stop ("Blocks approval", never "Blocks approval. Changes kilos."; the catalog's `hold.gate.*`
  read "Blocks approval" and "Reserves this line").
- **One marker vocabulary** (round 5), on the console, Proof and the phone alike (ui-web `vocabulary.tsx`):
  - state: `StateDot` 8 px, round, 8 px from its word: `pending` hollow ink-3, `waiting` hollow steel, `done` ink
    (signed, checked), `paid` jade, `held` indigo (round 6: a person must decide), `failed` red. `size={12}` only beside a hero's word, on its baseline.
    Log lanes, fan-out ends, a held bullet, the phone's history rows: all 8 px dots. The Season pipeline strip uses
    state colours only (pending hollow, done ink, held indigo, paid jade).
  - a check that held: `CheckMark`, a 16 px line ✓ in ink and its word in ink. Never a filled disc.
  - a chain step: `StepNumber`, a 24 px circle in a 1 px ink-2 outline with an ink numeral. Never a filled disc.
  - squares only as a chart legend's key: `Swatch` (`paid` jade, `cash` hatch, `held` indigo, `planned` a steel dashed
    outline, `ink`), 8 px, 12 px beside a hero's word. Hatch only for cash; jade only for confirmed money.
- **Avatars** (round 4). A person's initials (`Avatar`, the `.fs-stamp` a decision carries, the phone's `InkStamp`,
  the stage rail's frame avatars): white, a 1 px ink-2 ring, ink initials, round. Indigo is for action only.
- **Receipt chips** (round 4). A slip a line was weighed on, as data: `ReceiptChip` (ui-web, and the phone's
  `ui/receipt-chip.tsx`): the serial in the id style at ink-3, the kilos in ink with tabular figures, flat on a 1 px
  rule, no shadow. The slip's own paper (red serial, ballpoint kilos) appears only as evidence (the zoom, a crop).
- **Numbers.** Money: `MoneyFigure` (`align="decimal"` in columns, `raisedPrefix` on heroes), `AmountDisplay`,
  `CurrencyFigure`. Counts and readings: `Numeral` (`size` hero/title/body, `tone` ink/dim, `decorative` when words
  beside it say it). One `hero` per screen.
- **Tables.** Header 14/520 ink-2 on plate-2, 36 px; rows 40 px with 1 px rule separators (48 px where a cell
  stacks two lines); numbers right-aligned tabular, IDs in `id`; no zebra; hide a column that is all zero; a footer
  total says what it totals. A held row: the held dot and the H-tag's outline in its status cell, never a coloured side bar.
  A duplicate badge before resolution is a 1 px rule-strong outline with ink text; after it, "0457 counted once" in
  neutral ink. Pink lives only on the D evidence swatch.
- **Toast and Log** (round 5). The toast folds into the Next pill (`usePillToast` → `RunPill toast`): for
  `TIMING.toast` (3 s) the pill shows the newest live event's words over "Next: …", a 150 ms crossfade each way
  (`TWEENS.swap`), then says "Next: …" again; the bar never grows a seventh item, and nothing ever covers a row. Its
  words come from the toast catalog (chrome/toast.ts), plain, with no "Notice:", no event code, no timestamp and no
  full stop: "PayPal accepted the batch", "Shrink 2.05% · over limit", "Refused · invoice must equal quote", "Paid
  Consolacion Bacus · US$64.45". Never "success" while a payment is parked or cash is due. The pill's mark is the jade
  dot only while it shows a payment the simulated PayPal confirmed. Never focus, never a live region (the pill's name
  stays "Next: …"). Times live only in the `LogSheet` behind the chevron menu's "Run log".
- **Seal.** `Seal` at `LAYOUT.console.seal` (180 px; 220 from 1,600 px wide and 280 on the 1,920 stage, round 6) on
  Approve and on the Chair's phone, `showHash` for the mono
  hash beneath; **140 px** on the Chair's co-sign card (`LAYOUT.app.cosignSeal`), so the card ends at least 16 px
  above its sticky button. Unsigned rings: 1 px `--fs-unsigned`. Key 1 fills the inner half in indigo, key 2 the
  outer half. The phone draws the same state in the same colours.
- **Phone on the stage.** A 56 px rail (`LAYOUT.console.phoneRail`: phone glyph, a 32 px avatar per frame with its
  role word under it, "Member", "Chair", "Clerk" at 13 px (round 5), the shown frame's dot) on steps where it does not
  change; the phone glyph's tooltip is "Open phone". It opens on the phone's beats (key 2, Bayad na, the traced peso)
  and on click. Frames stay loaded; until the app answers, a labelled preview of the run, never a skeleton. The
  console rail keeps its labels from 1280 px (the 1,470 laptop included).
- **Phone chrome** (round 4). The selected tab is the console nav's selected look: the pod wash under an ink icon
  and label (never a black slab). Phone titles are 600 like the console's (the 600 static cut, `FSSans-SemiBold` at
  width 100, comes from WS-DS's font build, `cut_fonts.py`; until it lands, titles use SemiExpBold). A screen fades
  24 px under the status inset once content is under it (`LAYOUT.app.fade`), and ends its scroll 12 px above the tab
  bar in a fade. A list passes `snapRows` to `Screen`: at rest a row never ends under the tab bar (whole row or none).
  Round 5: a revealed block starts `REVEAL_GAP` (32 px: the fade and 8) under the inset, never against it; every
  sticky footer pads its foot with `useFooterEnd()` (the inset and `LAYOUT.app.end`, 24 px), so the last line ends at
  least 24 px above the bezel. One language a line: no English inside a Cebuano line (a note goes behind a tooltip).
- **Drawers and dialogs** (rounds 4 and 5). Every drawer and sheet, What's real included, **starts under the top bar**
  (`--fsc-stage-top`): 560 px, standing in the stage's gutters at the panel radius, e3, a sticky 56 px head (the
  title and Close) on plate. Round 5: a drawer **hugs its content** (`StageDrawer hug`: it ends at its content's foot)
  or **pins its action to a sticky footer** (`footer`: the primary and at most one secondary, both 48 px, on plate
  over a 1 px rule), so no drawer shows an empty band. A compact success state (a resolved hold: the effect line,
  "Counted once", "Next hold" as the primary) passes `scrim={false}`: no blocking scrim, the screen stays live.
  Dialog 520 px, radius 24, e3, only for a decision that must interrupt (signing). Everything else is inline or a
  drawer.
- **Season first view** (round 5, W-JG-01). Title row "Season 2026-A" with the state chip ("Awaiting payment"
  neutral, "Funded" the MM-S mark that floods jade, "PayPal complete · cash due" on the hatch), the run id in the id
  line once a session starts, and "Synthetic co-op · seeded slips". Then the invoice (5 columns) beside the pool (7),
  ending level: the pool leads with its own amount so the one 1.5 px jade arc joins the two amounts; under it the sum
  in words and the premium and quality bonus; the rate card is the pool card's foot (a row over a rule, not a card).
  The slips are one 12-up strip of prints at most 72 px wide, their head ("Slips", the counts' scope, Claude's real
  readings) in the first 3 columns from 1,040 px. The pipeline is flat: five StateDots on one hairline track, each
  count ink on the title step, its unit the label role. What's real hugs its rows and marks only the simulated PayPal
  row (the dashed circle the screens carry); no hatch or square there.
- **The member's statement** (round 5): her whole pay in the first view (the peso estimate and her kilos on one line
  under the amount, then the receipt's premium, bonus and deduction above a compact Paminawa); the header line
  "M-014 · 2026-A"; Paminawa a 48 dp row whose voice reads "Sintetikong tingog" (the engine's name in the accessible
  name). On the receipt bar a deduction is an ink-2 outline on plate, never hatched (§10, decision 10).
- **Hero moments.** Fan-out (round 5: the single hero, nothing restates it): every line ends on a round marker, Rhea's
  path at hers; cash is a 6 px hatched ribbon; rows sit 44 units apart. Before the move to cash the count is `Numeral`
  "7/8" beside the seal with the run's one micro-tag; after it the hero reads **"7 PayPal  57 cash"** (each count, then
  its 12 px key on the word's baseline: the jade dot before "PayPal", the hatch swatch before "cash", 32 px apart, no
  "·") with "Review cash handover" as the screen's one primary Slab. Rhea's row keeps "US$26.65" in ink-3 behind the
  hatch swatch; "Kept for members US$21.14" is a caption on the cash row; no money bar or legend under the fan;
  "Funding to confirmation" is the dot strip and one line, "Median 15 s". "Try to break it" is a list of rows, each
  with a Try button; a tried row reads "Refused · invoice must equal quote" and the number it blocked.
- **Approve and Run title chips** (round 5). Approve's state is the keys signed ("0/2 signed", neutral, the seal
  glyph), or what stops the signing ("3 holds open" in the held indigo, "Reading", "PayPal declined" red, "Paused", "Sent back").
  Run's: "Not posted", "Confirming", "1 needs you" (the held indigo), "PayPal complete · cash due" (hatch), "Settled" only once
  the cash is attested, "Replayed", "PayPal declined". Approve's money bar plans the PayPal segment as a steel dashed
  outline on the steel face (jade only once the simulated PayPal confirms every payout), its legend keyed by `Swatch`;
  at 1,920 (a window 1,600 by 1,000 or more) the eight PayPal recipients sit under it, two columns reading down, the
  largest first, each a hollow 8 px dot until confirmed. Signers say where the key lives ("Key on this browser",
  "Sample key", "Key on the Chair's phone"); their key ids sit with the hashes behind "Fees ≈ US$2.00 · IDs".

## 5. States and focus

One ring: `:where(*):focus-visible` in ui-web, 2 px `pod`, 2 px offset, following the radius, keyboard only. No
feature declares its own ring or a box-shadow ring; a screen's pre-focus stays quiet until a key (`data-prefocused`).
Hover: plate-2 under ink. Disabled: ink-3, `aria-disabled` keeps focus. Loading: print beds at final size in a
solid hairline (no shimmer). Empty: one line that says what fills it. Error: what failed, why if known, the way
back. Selection: `pod-wash`; caret and native controls `pod`; scrollbars thin in `rule-strong`.

## 6. Copy: words for a farmer or a judge

- Sentence case, no "!", no emoji, no title case, no tracked capitals. Headers are noun phrases without a full stop.
- One line of prose a panel (≤ 10 words, no semicolon); labels ≤ 3 words; data joined by " · ". Explanations live
  only in What's real, a row's expand, or a `title`/`aria-label`. Provenance once a screen, in the header's id line.
- **Never a developer's word on screen** (round 4): no camelCase rule names (invoiceEqualsQuote), no tool names
  (create_invoice), no file names (keys.json). A refusal reads "Refused · invoice must equal quote"
  (`lib/plain.ts`: `refusalTitle`, `ruleWords`, `toolWords`); the rule's id sits in the id style only behind "Why",
  file names behind an IDs disclosure. Screen tests assert `developerWords(text)` is empty.
- **No ids for people** (round 5). A deduction chip reads "CBU −1.37" (`RuleChip`: the rule in its title and its
  accessible name, `ruleChipTitle`, "Rule R1 · CBU 5% of bonus"); the Chair's caption reads "Co-signs batches over
  US$300" (`chairCaption`), the treasurer's "Key on this browser" (`KEY_CAPTION`) with the key id behind an "IDs"
  disclosure (`IDS_LABEL`); the dial and the checklist share one term, "Shrink · limit 2.0%" (`shrinkLabel`); no
  "status check · time" text (lib/plain.ts).
- Controls name their action ("Count it once", "Review cash handover"); errors name the problem and the recovery.
- Say each fact once, with one name: "2026-A" for the season, a labelled run id, "48 this run · 264 season",
  "8 · 56 planned" before settlement and "7 PayPal · 57 cash" after, "Proof 0/6" on six checks (`lib/display.ts`).
  An effect is one line: "If counted once: +US$17.94 to 63 members · 2.05% → 1.62%".
- State words never overclaim: "PayPal complete · cash due" until the cash is attested; never "Settled", "Done" or
  "Paid" (the Season strip included) while cash is due; a replay never reads as paid. Copy only gets shorter.

## 7. Motion

150–250 ms for state changes (`TWEENS`), exponential ease-out (`EASE.out`), no ease-in, no page-load choreography.
Motion is evidence: a thread draws on a webhook, the seal engraves on a key, a pill floods jade on confirm, one beat
of halo. Money lands; it never counts up. Reduced motion keeps colour and opacity at 150 ms and drops travel.

## 8. Honesty system

Dashed lines mean **simulated**, and nothing else. Hatch means **cash**. Jade means **confirmed by the simulated
PayPal**. Every PayPal value carries the sandbox label (the top-bar indicator, a "Simulated" MicroTag, or the legend
glyph's name); seeded and replayed data are said once a screen, in the id line, with the pinned phrase ("Seed
stand-in, not a Claude recording") in its title (round 5). Nothing claims a live Claude reading on a seeded or replayed run: the reading room separates the
replayed stand-in reading of all 48 slips from Claude's real readings of the 10 hero slips (the 1 Nov exhibit), so
48/48 never reads as Claude's.

## 9. Round 4 decisions (the orchestrator's reconciliation of both round-3 reviews)

1. **Layout.** At 1920 every screen sits on one 12-column grid that fills the stage; content is top-aligned 32 px
   under the title row; nothing is vertically centred in a tall panel; no dead bands or floating blocks; cards hug
   their content. 1280 and 1470 keep working (§3).
2. **Nothing covers content or gets clipped.** The toast lives in the top bar's status area. Every drawer, What's
   real included, starts below the top bar. Phone screens get a 24 px top fade under the status inset as well as the
   bottom fade. Lists snap so a row never ends under the tab bar. The Chair co-sign card ends at least 16 px above
   its sticky button (seal 140 px there) (§4).
3. **Top bar: six items at most.** "● Next: …" with "Play it for me" is the one centre group; history, mute and reset
   live in the chevron menu; What's real, Proof and the simulated indicator stay on the right; no grey status segment
   repeating the page title (§4).
4. **Words for a farmer or a judge.** No camelCase rule names, tool names or file names on screen; refusals read
   "Refused · invoice must equal quote" with rule ids in the id style only behind "Why"; key ids never break
   mid-word (nowrap, middle-truncated); no sentence-with-full-stop pills (§1, §4, §6).
5. **Honesty wording.** The PayPal micro-tag reads "Simulated" (its accessible name stays "Simulated PayPal
   sandbox"). The settled run's hero reads "7 PayPal · 57 cash" with "Review cash handover" as its one primary; never
   "7/8" after the move to cash, and Rhea's cash line appears once. The Season strip never lights "Paid" while cash is
   due. The reading room separates the stand-in reading of 48 slips from Claude's 10 real hero readings (§4, §6, §8).
6. **One effect line in the H1 drawer**: "If counted once: +US$17.94 to 63 members · 2.05% → 1.62%"; no Engine row
   and no second dial in the drawer; the pill reads "Blocks approval". After resolution the table's 0457 ×2 badge
   becomes "0457 counted once" in neutral ink; before it, a 1 px rule-strong outline with ink text; pink only on the D
   evidence swatch (§4).
7. **Colour discipline.** Receipt chips flat (serial ink-3 id, kilos ink tabular, 1 px rule); no red or blue chips;
   the "Earlier" tile on a plate fill, not hatch; avatars white with a 1 px ink-2 ring and ink initials; the phone's
   confirmed status is the StatusChip at phone scale (32 px, 15/520); the phone's selected tab matches the console
   nav's selected style, and phone titles are 600 like the console's (§2, §4).
8. **Approve offers one way to sign**: one Slab "Approve 8 payouts" that hugs its label, "Hold to sign" under it; the
   other paths fold into one "Other ways to sign" link; the Chair co-sign block appears only after key 1 (§4).
9. **This file lives at `docs/DESIGN.md`**, every reference updated, and records decisions 1–8.

## 10. Round 5 decisions (the orchestrator's reconciliation of both round-4 reviews)

1. **Nothing clipped at any width.** The split-review body snaps to whole rows with a 24 px fade above the sticky
   total; the Run log shows 4 rows and "All N events", ending at least 32 px above the panel's foot; the rate card's
   resolution column scrolls on its own with a bottom fade and 32 px of room; the phone fades under the status inset
   and ends at least 24 px above the bezel. No row or card ends half-hidden (`SnapScroll`, §3, §4).
2. **No dead bands at 1,920.** By hand: the equation across all 12 columns, the slip crop and the logbook page side by
   side beneath it at equal height, "Review 3 holds" under the equation. Approve: a second row under the split bar
   lists the 8 PayPal recipients (name, amount, a hollow in-flight dot), the checklist card in the right columns.
   Reading room: the filmstrip and "Earlier" under the table, the photo the full left height. Drawers hug or pin (§3).
3. **Top bar: six calm items at all times.** The toast folds into the Next pill (3 s, a 150 ms crossfade) in plain
   words with no "Notice:" and no time; the pill always starts "Next:" and is never underlined; What's real keeps its
   word at 1,280 and 1,470; never "success" while a payment is parked or cash is due (§4).
4. **One marker vocabulary** on the console, Proof and the phone: 8 px StateDots, a 16 px line ✓ with a word, 24 px
   outlined step numbers, squares only as legend swatches, hatch only for cash, jade only for confirmed money. The
   Season pipeline strip uses state colours only, no indigo (§4).
5. **Provenance once.** The "Simulated" micro-tag stays beside PayPal money; each screen says one id-line phrase;
   every other inline legend glyph goes, the orphans and the phone's corner glyphs included (§4).
6. **No ids for people**: "CBU −1.37", "Co-signs batches over US$300", "Key on this browser" (the id behind "IDs"),
   "Shrink · limit 2.0%", no "status check · time" (§6).
7. **Titles.** A noun title with a grey suffix ("Season 2026-A") and the state in a StatusChip on the same row; one
   run id everywhere; the first view shows no invoice id until a session starts (§4).
8. **Truthful and decisive states.** "47 of 48 read · 1 needs a person" until 0462 is entered by hand, then "48 of
   48"; the resolved H1 drawer is a compact success state (the effect line, "Counted once", "Next hold" as the
   primary, no blocking scrim); the rate-card refusal leads with the refusal, the next-season proposal secondary, the
   board document collapsible.
9. **Run fan-out as the single hero.** No "By value" bar or legend; "Kept for members US$21.14" a caption on the cash
   row; "Funding to confirmation" a dot strip and one median line; the hero's 12 px jade dot and hatch swatch on the
   baseline before "PayPal" and "cash" with a 32 px gap; Rhea's row "US$26.65" in ink-3 with the hatch glyph.
10. **The phone in one language and one width**: labels at width 100 (520), titles 600, no condensed cut; no English
    inside a Cebuano line; "Sintetikong tingog" (TTS in its name); "M-014 · 2026-A"; two icons in the 390 header;
    the member's whole pay in the first viewport; one receipt-chip shape in the trace, its equation on one line; the
    stage rail's role words under the avatars and "Open phone" as the tooltip (§1, §4). On the phone that means:
    the peso estimate and her kilos share one line; Paminawa is a 48 dp circle in a 48 dp row (the voice's words
    without the provider, `voiceWords`; the provider stays in the spoken label); her slips appear once (the slip row
    steps aside while an opened line shows them, in the one tile shape); the equation is one line that scales down
    to fit; history rows lead with 8 px dots and say one day once, in the heading; a deduction's bar segment and key
    are an ink-2 outline (hatch is cash); the Chair's why line, presence line and hold kinds carry no English line
    (only a note that blocks him keeps its gloss); the demo key's note is behind its dashed mark at the caption's
    end, opened by a tap (`KeyNote`); no key id on the signed line; no glyph on the clerk's paper or the push card.
11. **Smaller items**: no lone vertical rule in the split table, a stable scrollbar gutter, numeric columns spread;
    the Approve bar's PayPal segment a steel dashed outline (planned) until confirmed (`Swatch planned`); the H1
    drawer's paired buttons both 48 px; the Season slips one 12-up strip of 72 px thumbnails, the funding arc joining
    the two amounts; the Cebuano and Tagalog alternate links say "Other ways to sign" ("Ubang paagi sa pagpirma",
    "Ibang paraan ng pagpirma").
12. **This file records decisions 1–11.**

**The review surface in round 5** (reading room, by hand, split review, the hold drawer, the rate card):
- **Split review.** AG Grid scrolls its own viewport (its header and pinned decisions a sticky head, the total a
  sticky foot), so `features/split/whole-rows.ts` sizes the grid's frame with `wholeRowsHeight` to whole 48 px lines
  down to 32 px above the panel's foot, never more lines than there are (a filter hugs its lines); lines snap under
  the head; the frame takes SnapScroll's 24 px fades. Deductions grows to 180 px at most and the number columns share
  the rest; Member is pinned at one width with no rule beside it; the scrollbar overlays the lines (`scrollbarWidth`
  0, a clear track), so lines, total and header end on one edge. A narrow grid (1,280) drops the hold notes' rows and
  keeps the arithmetic for screen readers, so filters, the check and "Columns" share one row. The title row's chip
  is the review's state ("3 holds open · 1 by hand" in the held indigo, then "PayPal complete · cash due" in hatch); the bench's
  third column is "Next" and the link, with the 8 px held dot. The id line is the run id ("2026-A · r37", its title
  the lines, the engine and the rate card's hash), then "seeded slips" or, once PayPal statuses show, "simulated
  PayPal". Held dots, the held filter and pending amounts are 8 px dots.
- **Hold drawer.** Every state hugs its content. The open H1 draws its two copies at 216 px; the pair is 48 px high,
  the secondary's caption under the pair. A decided hold is the compact success card (the result, the card renamed
  with the decider's stamp, "Evidence" behind a disclosure) with no blocking scrim, and "Next: hold H2" is the one
  primary (the Slab's face on a link) on the drawer's sticky footer. H3's closed list names its rules; "Allowed"
  carries the rule's id in its title.
- **Rate card.** The screen fills its panel and each column scrolls on its own (SnapScroll, 32 px under the last
  line). The title row: "Rate card 2026-A", "Ratified 14 Mar" (lock), the resolution as the id, "Hide resolution"
  at its end (folded, the schedule takes the row in two columns). Refused, the refusal leads its column, the clause
  that refuses it ("No other deductions") holds the band on the board's page and scrolls into view, and next
  season's proposal is a `.fs-flat` secondary.
- **By hand.** The title row's chip says "Needs a person" (the held indigo) or "Entered"; the owner's line, the field or the
  equation, and "Review 3 holds" (the one primary) span all twelve columns; the crop and the logbook strip sit side
  by side under it at one height (container units), each paper hugging its sheet. A panel under 1,040 px puts the
  decision in six columns and stacks the two witnesses in the other six.
- **Reading room.** The photo takes the room's full height; the filmstrip and "Earlier" sit under the table. The
  count is truthful (`replayProgress`: a slip counts read once nothing waits for a person): "47/48 · read · 1 needs a
  person" with the held dot until slip 0462 is entered, then "48/48 slips read this run"; the status sentence counts
  the same way. The chip: "Waits for payment", "Reading", "Needs a person" (the held indigo), "All read".

**Integration in round 5** (what the five surfaces needed once they met at 1,920 × 1,080, 1,470 × 956 and 1,280 × 800):
- **One run id everywhere**: Approve and Run read "2026-A · r37" in the id line, as Season, Reading room and Split
  review do.
- **No dead band at 1,920**, by giving the spare height to the content, never by centring a screen:
  - Season: on a tall window the slips and the pipeline stand 96 px apart (80 on the 1,470 laptop), and the pipeline
    strip grows 16 px; "planned" rides on the step's verb ("Pay · planned"), so the counts keep one line at 1,280.
  - Reading room: on a 1,920 window the filmstrip under the table becomes a contact sheet of two rows (seven a row,
    "Earlier" last); the laptops keep the one strip.
  - By hand: the crop's 1.85 : 1 fills the columns' width before the row's height, so on a tall window the papers
    share the height they cannot take above and below them.
  - Approve: the money bar, the eight recipients and Details are their own grid row (`.fsr-approve__money`, all
    twelve columns on the wide panel, seven on the laptops), and the decision card packs back beside the batch
    (`grid-auto-flow: row dense`); the reading order stays the batch, its money, then the decision.
  - Run: once no payment waits for a decision, the log and the latency dots stand 48 px under the fan and the log's
    four rows breathe at 12 px, still four rows and "All N events".
- **E-19 on the toast**: a confirmed payout notice reads "Payment confirmed" (never "PayPal confirmed" bare); the
  bar's simulated indicator and the jade mark carry the rail.
- **The member's statement**: the phone surface's version stands (the peso estimate and her kilos on one line, the
  receipt's terms in the first viewport); the stage surface's sum line under the amount and its second voice helper
  were the same change twice and were not taken.

## 11. Round 6 decisions (one builder's reconciliation of both round-5 reviews and film feedback v6)

1. **Never a blank page.** index.html carries a boot shell (the bar's name, "Loading season 2026-A" or "Loading the
   proof" beside a hollow dot, in literal Hayag values) and the router draws the same shell while a first loader
   waits (`chrome/BootShell.tsx`). Captures wait for the screen's title row, never a fixed time.
2. **Every width keeps the evidence.** The bar's indicator reads "Simulated PayPal sandbox" at 1,280, 1,470 and
   1,920. Approve lists its eight PayPal recipients before anyone signs at every width: under the decision card on
   the laptops (one column of 32 px rows), a row of their own under the money bar on the 1,920 stage (two columns of
   72 px rows). Split review at 1,280 keeps Premium, Bonus and Deductions in their columns (the compact set: the
   slip count steps aside) and the one sum beside the dial.
3. **Season first view.** The pool's amount is a hero on the invoice's step, so the jade arc joins two equal heroes;
   under it its micro-tag and the sum in words, then the pool's two parts drawn once as a bar in proportion (premium
   ink, quality bonus ink-3, pending grey until funded) with each amount under its segment. The pipeline is the
   second row; the slips end the screen as one 12-up strip a column wide each. No fixed spacers: on a tall window
   the two cards take the spare height (to 500 px) and spread their own parts. The spent press is a record, never a
   pill, and says whose money it is: "Lantern Bay's payment · recorded by Analyn · 18:58" (film U1). No link under
   it: the pill is the one route forward.
4. **No production wording where a judge reads.** The exhibit link reads "Claude's readings of 10 slips"; the reading
   room's id line "Synthetic co-op · replayed readings"; What's real says "Ten slip images were made with OpenAI's
   image model"; the last attack is "Change a payout after signing" and a Try that cannot be pressed says why
   ("Only before the Chair signs"). The composed photos' baked-in notes (a header, a line under each slip, a footer)
   are covered on the stage by strips in the desk's own tone (`.fsc-mat__veil`); the photo's accessible name and
   What's real keep what it is. The pinned honesty phrase stays in titles and for assistive technology.
5. **One numeral face** (§1): the text's width, 500, tabular; the mono only for ids, hashes and times.
6. **Split review says each thing once.** One next action (the pill; the held rows' own buttons), one money summary
   ("Pool − deductions = member net", each term its word over its figure, the balance check at its end; no Pool
   block, no "Next" column), one held marker (the held dot and the hold's tag as an outline, both the person's indigo; "Held" only for
   assistive technology). Net stops at 136 px, so no gap opens after Deductions. The dial is the machine's reading:
   ink inside the limit and over it, the word "Over limit" beside an ink dot (film U3). A hold's drawer never dims
   the screen: its scrim is clear and still closes it (film U6).
7. **Approve.** The seal is the hero at 280 px on the 1,920 stage (220 from 1,600 px wide, 180 below), the amount
   and the two signers centred against it; under the slab one line says whose key the press is ("Your key is the
   first of two · the Chair signs next"). On the Chair's phone the seal's card takes the height above the pinned
   slab, and the stepped-progress row is reserved so nothing moves during a hold (film U5).
8. **Run: one layout in every state.** A parked payout's primary ("Pay in cash at the bodega") stands under the hero
   count, where the settled run's "Review cash handover" does; its row under the fan is one line with "Re-send" as
   its one quiet button. **What's real** is a full-height side sheet: three lead rows (Real code, Simulated PayPal
   sandbox, Replayed: a name over one short line), then Synthetic and Not built, every row with the same 16 px slot.
   **Rate card**, refused: the attempt is one struck row, the schedule's list ends the column (no page number, the
   seal's card with the folded resolution), the pages stay at page 1's top when the banded clause is in view.
   **Reading room**: while a slip waits for a person its entry is the room's one primary beside the count. A water
   stain is a cool grey hatch and the printed form a cool neutral (film U2: `EVIDENCE.stain`, `EVIDENCE.form`); a
   recorded slip's photo shows its paper in colour on a grey ground (film U4).
9. **Proof.** "6 integrity checks passed" under the count; the money card says "7 confirmed on PayPal · 57 cash due"
   (E-19: never "PayPal confirmed" bare) and
   its cash row "Cash due at the bodega" until the clerk attests it, so a check result never reads as a payment.
10. **By hand** (1,920): the two witnesses lead and the sum stands beneath them across the row ("Gross − tare =
    net"), the screen's one primary at its end; the run id joins the id line.
11. **No amber** (the film's 2× captures). Held, parked and "needs a person" states have one treatment: the person's
    indigo as an 8 px dot, a 1 px outline or a fine thread, always beside the word (§2). The dial's zone past the
    limit is a neutral arc, ink once the reading is in it. H1's serial underline, H3's wash behind the MULTA line
    (14%), the H2 yield bar and Rhea's parked thread follow the token. The run pill never shows a dot without words
    (an event with nothing to say leaves "Next: …"); the Run's latency panel never says "No confirmations yet" on a
    settled run read back after a reload ("7 confirmed · timed only while the run is live"). On the phone the open
    slip's sheet is opaque and its sample mark sits in the paper's empty corner. Raised over the console below
    1,440 px, the phone's dock takes no row of its own, so the console keeps the stage's height under the scrim; on a
    fan under 1,040 px the cash row reads "57 members · cash" whole ("at the bodega" steps aside, never an ellipsis).
12. **This file records decisions 1–11.**

## 12. Round 7 decisions (one builder's reconciliation of both round-6 reviews)

Where a rule here differs from §3, §4 or §9–§11, this section wins.
1. **Nothing covers or cuts a key number.**
   - **Drawers push at every width.** From 1,280 px up (the 1,920 stage included) a drawer takes its 560 px from the
     screen instead of lying over it: the screen's container narrows and its content reflows (the split's sum stays
     whole, the lines take the compact or slim set). Every drawer is a **full-height sheet** (the frame of What's
     real), so no row shows under a rounded foot; a short state keeps its action right under its content and the
     plate runs on to the foot; a sheet that scrolls fades its last 24 px. Below 1,440 px the console rail folds to
     its glyphs while a drawer is open (`StageApi.noteDrawer`) and the screen's side padding drops to 24 px, so the
     slim set (Member, Net, Rail, Status) fits beside the sheet at 1,280.
   - **The phone below 1,440 px never opens on its own.** A beat (key 2, "Bayad na") turns the rail to that frame
     (its avatar, its status dot) and the console keeps every name and amount; the sheet opens only when the viewer
     asks (an avatar, the phone glyph, the pill's step, "Or sign in the Chair frame"). Open, it never dims the page
     (a clear backdrop still takes the press that closes it), its head ends with **Close**, its screen is as tall
     as the window gives (600 px at 1,280 × 800) and the sheet scrolls where that is too tall. A window narrowed
     under 1,440 px drops a raise it made while the phone had its column.
2. **1,280 and 1,470.** Split review's compact set (the 1,280 laptop) is Member (184 px, a whole name, never an
   ellipsis), Verified kg, Premium, Deductions, Credit, Net, Rail, Status; **Bonus waits behind "Columns"** (the total
   still sums it). The holds' evidence rows ("Slip 0457 ×2 · 4/4 fields match", "2.14 kg a tree") and their "Open
   H1/H2" stay at 1,280; only the slim and narrow sets (beside a drawer) give those rows to the lines. On the
   settled Run each count carries its own qualifier **under its word** ("● PayPal" over the "Simulated" tag, "▨
   cash" over "due 12 Nov"), so the cash's day never reads as PayPal's at any width.
3. **Run with a parked payout.** The primary names whose payment it acts on: **"Pay Rhea in cash at the bodega"**.
   The parked reason is the second line of her own fan row ("No PayPal account · returns in 30 days", then
   "Re-send" as a link); no card under the fan repeats her name and amount (`W-TR-08.parked` is that line). The
   seal stands 30 units higher (its top 180 down: 60 px under the primary at 1,920, 17 px at 1,280), the cash row 12
   lower. One rule for the jade dot in the log: every row that says the simulated PayPal confirmed money ("Paid …",
   "Payment confirmed"). While a parked payment waits, the pill keeps "Next: decide on Rhea's payment": no toast
   takes its place.
4. **Spacing.** Season's two cards are top-aligned on one rhythm (label, amount, its line, then the action or the
   record 24 px under it); each card's foot is pinned to its end and the row is capped at 440 px, so spare height
   collects above the foot's rule. By hand (1,920): the witnesses start 24 px under the title row, each paper as
   wide as its six columns (the logbook ends on the grid's edge), the sum, who entered it and the one primary 32 px
   under them; whose slip and why it needs a person are one line. What is left of a tall window is the panel's
   foot, never a band between parts. Proof is a 1,200 px sheet from 1,600 px wide. What's real: one row style for
   all five (the heading step over a caption) and, on a tall window, taller rows.
5. **Rate card, refused.** Once the refusal is printed the paper shows **the page that refuses it, alone, from its
   top edge**, the clause banded whole, with the card's seal under it (opening a rule shows every page again). The
   attempt stays readable in ink ("✕ Iba pa (Other) · ₱150 · Not added · locked by BR 2026-04", never struck
   through). Schedule A's rows carry no rule ids (R0–R6 are the document's own, on its page).
6. **Supporting text and markers.** Text that carries meaning is never ink-3 at 12 px: the id line, a member's id
   (13 px), the sum's words, a filter's count, a log row's lane and time are **ink-2**. Measured on the tokens
   (WCAG 2.x): ink 18.7:1 on plate (17.6 on plate-2), **ink-2 9.8:1 (9.2)**, ink-3 6.0:1 (5.6), pencil 7.0:1, the
   indigo 7.9:1, steel-line 3.6:1 (non-text). A divider between rows of data is the **row rule**
   (`--fsc-rule-row`, halfway from `rule` to `rule-strong`: 1.37:1 where `rule` is 1.24:1); the split table's frame
   is `rule-strong` (1.52:1). **Over the limit** is its own mark, a line warning glyph and the words in a 1 px ink
   outline, never a round dot; the rail's "next step is here" mark is a small pointer, so a round indigo dot means
   only "a person must decide" (a held row, the pill). **One id line**: the run id alone in the mono ("r2"), then
   the provenance phrase; the title's suffix says the season, so no row says "2026-A" twice.
7. **Honesty wording on the phone.** A phone screen is read on its own, with no top bar: the micro-tag beside the
   member's paid status reads the whole name, **"Simulated PayPal sandbox"** (`MicroTag full`; the accessible name
   is unchanged), one line under the status pill with the time, in every state; the Chair's sign screen and the
   board's payout list say it in full too. The Chair's request keeps the one word beside "8 ka bayad pinaagi sa
   PayPal" (the row has no room for more at 360 px, and a second line would push the seal card under the button on
   a 706 px phone).
8. **Smaller items.** The pool's hero before funding is ink-2 (9.8:1), never a disabled grey, and its bar the
   pending tone; Approve's planned PayPal segment is a steel face in its dashed outline at full strength; the
   phone's top fade is plain surface for its first 16 px (no ghost text) and its fees row is named ("Bayad sa
   padala" over its two rates); on a tall, quiet request the Chair's seal takes part of the height its card would
   leave empty (to 190 px, the card still ending clear of the button); a Try that cannot be pressed says "After key
   1, before the Chair".

## 13. The owner's reference reels

Taken: one spacing scale; colour only where it means something (semantic dots, matching chart lines); thin line
icons; a deliberate type ramp; tabular or mono numerals; factual headers instead of greetings; far fewer words;
motion that proves state. Not copied: the reels' dark canvases, inner glows, Geist, the dot-matrix hero number,
tracked-capital status pills ("GPS READY") and the film's kinetic type. Fair Split stays light, FS Sans, and its own.

## Appendix: the round-2 audit behind these rules (typeset.md)

- Authority: five numeral voices (`DotMatrix` in ui-web and `features/proof`, FS Stencil marks, `amount-hero`
  75/800, FS Sans proportional, tabular `fs-t-micro`), plus Atkinson for statements: `tokens.ts` `FONT_STACKS`.
- Hierarchy: 13 sizes (10, 12, 13, 14, 16, 18, 19, 20, 22, 26, 32, 40, 72; `TYPE_ROLES`); caption/label/hash all 13,
  too close to carry three jobs; body 14 under the 16 floor; `.fsc-stage .fs-t-display` and `.fs-t-stamp` overrides.
- Consistency: `micro` mixed ids and words (81 uses); money proportional in `.fs-money`, tabular in grids and on the
  phone; the dial needle, rail rule and seal mixed indigo with ink and jade (`.fs-dial__needle`, `.fsc-rail__item
  [aria-current]` 3 px rule, `.fs-seal > :nth-child(even)`).
- Delivery: `fonts.css` shipped Atkinson's 22 KB face; three files declared the focus ring (`styles.css`,
  `base.css`, ui-web) and `.fsc-menu__item` drew a second, box-shadow ring.
