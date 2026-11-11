# Fair Split design system (UI gate round 4)

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
- **Five steps.** Weight carries the rest: 430 reading, 520 labels, 600 titles and headings, 500 numerals.

| Role (class `fs-t-*`) | Web px / line | Weight, width, tracking | Phone sp / line          | Use                                                              |
| --------------------- | ------------- | ----------------------- | ------------------------ | ---------------------------------------------------------------- |
| `hero`                | 56 / 60       | 500, 87.5 %, −0.02 em   | 48 / 52 (scale cap 1.5×) | The one hero number a screen: a money hero or the one hero count |
| `title`               | 24 / 30       | 600, 100 %, −0.015 em   | 24 / 30                  | Screen, sheet and drawer titles; stage and Proof headlines       |
| `heading`             | 16 / 24       | 600                     | 17 / 24                  | A heading inside a screen or drawer                              |
| `body`                | 16 / 24       | 430                     | 17 / 24                  | Body text, the panel's one line, statement prose (16 px floor)   |
| `label`               | 14 / 20       | 520                     | 15 / 20                  | Controls, column headers, status words                           |
| `id`                  | 12 / 16       | 400, mono               | 13 / 18, `monospace`     | Hashes, IDs, timestamps                                          |

Aliases keep working on these steps: `display` `title-1` `statement-lead` = title; `title-2` `statement-status` =
heading; `lede` `statement-body` = body; `caption` `micro` = 14/20 at 430 (secondary words, short data joined by
" · "); `figure` = 14/20 numerals at 87.5 %/500; `amount-hero` = hero; `amount-l` = 24/30 numerals; `slab` = 16/20
at 600 (button labels); `hash` `mark` = id; `stamp` = 12 px initials at 700. Floors: secondary text 13 px (it sits
at 14), ids 12, body and statement 16. Prose measure 45–75 ch; a table may run wider. `US$` on a hero is `.fs-cur`
(0.42 em, raised, ink-3). Proof reads the same roles in its FS Sans Proof subset.

**Ids never break mid-word** (round 4). An id, key or hash is `IdText` (ui-web): the mono on one line (`nowrap`),
cut in the middle when long ("fs-ernesto…mj2ng2", `truncateMiddle`), its whole value as title and accessible name.
It clips with `overflow: clip` (never `hidden`, which would drop its baseline off the line).

## 2. Colour: one job each

| Token                                      | Hayag                       | Job                                                                                                                                 | Never                                                  |
| ------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `ink` / `ink-2` / `ink-3`                  | #0B1220 / #3A4456 / #5A6476 | Text, checked facts / secondary / meta and icons                                                                                    | ink-3 on a statement                                   |
| `pencil`                                   | #4A5A73                     | The machine's figures before two keys sign                                                                                          | A fill                                                 |
| `ground` `plate` `plate-2`                 | #F3F5F8 #FFF #F7F8FA        | Page / panels / headers, hover, inspectors, the "Earlier" tile                                                                      | Colour washes                                          |
| `rule` `rule-strong`                       | #E3E7EE #CBD2DC             | Row separators / chip and control outlines                                                                                          | A control's only edge below 3:1                        |
| `steel-line`                               | #7E8898                     | Dashed = simulated; input outlines; unsigned seal rings                                                                             | Anything real                                          |
| `pod` (indigo)                             | #4A2FD6                     | **Action and focus**: the one primary, the focus ring, caret, selection and the selected nav or tab (`pod-wash`), signed seal rings | Money, the machine, a person's avatar, decoration      |
| `jade` (+`jade-flush-border`, `jade-text`) | #14CC90                     | **Only money the simulated PayPal confirmed**: the paid pill and capsule, the paid dot, a confirmed thread or bar, one beat of halo | In flight, signed, a heading, a button, a check result |
| `canary` (amber)                           | #FFA41B                     | **A person must decide**: hold dot, H-tag, You cell ring, over-limit tick and needle, the run pill's dot                            | Text (fails contrast), a button, an error              |
| `red` (+`red-wash`)                        | #CF2A27                     | **Only PayPal saying no** (DENIED, FAILED, BLOCKED, unexpected RETURNED, ERRPYO)                                                    | Holds, cash, refusals by our own rules, a chip         |
| `hatch`                                    | #A4AEBC                     | **Cash** at the bodega (or unavailable), always with the word                                                                       | Red, grey text, a tile that is not cash                |
| copy-white/pink/yellow, `--fs-evidence-*`  |                             | Evidence paper only (the D swatch's pink)                                                                                           | Chrome, a chip about a slip                            |

No other hue appears: no blue chip, no red chip. No wash, gradient, glow or coloured shadow on a product surface
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
- Radius: cell 6 (chips, keys), control 12 (buttons, inputs), card 16, panel 24 (stage panels, drawers, dialogs),
  pill 999 (status pills, tags, segmented controls). Evidence paper 0.
- Elevation is declared once: **a border or a shadow, never both.** `e1` (its ring is in the shadow) rests the bar,
  the run pill and cards; `e2` holds the stage's two panels, menus and tooltips; `e3` lifts drawers, sheets and
  dialogs; `paper` is evidence only. Flat parts take a 1 px `rule`/`rule-strong` border and no shadow.

## 4. Components (use these; do not rebuild them)

- **Top bar** (round 4): **six items at most.** "Fair Split" leads; the status area (the mock chip, and the one
  event toast) sits beside the centre group; the centre group is "● Next: …" with "Play it for me" and the chevron,
  whose menu holds the screens, the run log, sound, Reset (while there is a session) and Shortcuts; the right holds
  What's real, the Proof counter and the simulated indicator. No grey status segment repeating the page title: the
  run's state word is spoken with the pill, never shown. The bar is `LAYOUT.console.bar` (56 px).
- **Buttons.** One primary per screen: `Slab` (indigo face, 48 px, radius 12, label 16/600, **hugs its label**;
  tone `jade` is the same indigo face). One secondary: `.fs-flat` (white, 1 px rule-strong, 40 px; `data-size="l"`
  48). Inline actions: `.fs-link`. A "Try" or "Why" control is `.fs-flat` or `.fs-link`, never a third style. A hold
  slab's caption and its one link read "Hold to sign · Other ways to sign" (the dot drawn, never spoken).
- **Honesty marks.** `HonestyTag quiet` once, in the top bar. `MicroTag` (12 px dashed circle + **"Simulated"**,
  12 px, ≤ 2 a screen; its accessible name stays "Simulated PayPal sandbox") only beside a PayPal money value. Every
  other provenance is a 12 px `LegendGlyph` (`HONESTY.*`): its words are its tooltip and accessible name.
  `HonestyLegend` lives only in What's real. Screen tests call `tagBudget(root)` (≤ 3 tags, ≤ 2 micro).
- **Status pills.** `StatusChip` / `Chip`: 28 px on the console, **32 px on the phone** (`LAYOUT.app.statusChip`,
  the label step's 15/520), glyph and word, 1 px ring. Jade is the only filled pill (confirmed); `canary` an amber
  ring; `flight` neutral; `hatch` a hatch swatch; `red` PayPal's no. ≤ 1 pill a row, ≤ 3 kinds a screen. The phone's
  "Bayad na" is this pill, never a 64 px slab. A checked fact gets no pill: ✓ glyph and the word in ink. No pill is a
  sentence with a full stop ("Blocks approval", never "Blocks approval. Changes kilos."; the catalog's `hold.gate.*`
  read "Blocks approval" and "Reserves this line").
- **State dots.** `StateDot` 8 px: `pending` hollow ink-3, `waiting` hollow steel, `done` ink (signed, checked),
  `paid` jade, `held` amber, `failed` red. Colour lives in the dot; the word beside it says the state.
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
  total says what it totals. A held row: the amber dot and the H-tag in its status cell, never a coloured side bar.
  A duplicate badge before resolution is a 1 px rule-strong outline with ink text; after it, "0457 counted once" in
  neutral ink. Pink lives only on the D evidence swatch.
- **Toast and Log** (round 4). `EventToast`: one 40 px flat pill **in the top bar's status area** (never over the
  screen, so no row ever sits under it), the newest live event for `TIMING.toast` (3 s), never focus, never a live
  region. The whole timeline is the `LogSheet` behind the chevron menu's "Run log".
- **Seal.** `Seal` at `LAYOUT.console.seal` (180 px) on Approve and on the Chair's phone, `showHash` for the mono
  hash beneath; **140 px** on the Chair's co-sign card (`LAYOUT.app.cosignSeal`), so the card ends at least 16 px
  above its sticky button. Unsigned rings: 1 px `--fs-unsigned`. Key 1 fills the inner half in indigo, key 2 the
  outer half. The phone draws the same state in the same colours.
- **Phone on the stage.** A 56 px rail (`LAYOUT.console.phoneRail`: phone glyph, a 32 px avatar per frame, the
  shown frame's dot) on steps where it does not change; it opens on the phone's beats (key 2, Bayad na, the traced
  peso) and on click. Frames stay loaded; until the app answers, a labelled preview of the run, never a skeleton.
  The console rail keeps its labels from 1280 px (the 1,470 laptop included).
- **Phone chrome** (round 4). The selected tab is the console nav's selected look: the pod wash under an ink icon
  and label (never a black slab). Phone titles are 600 like the console's (the 600 static cut, `FSSans-SemiBold` at
  width 100, comes from WS-DS's font build, `cut_fonts.py`; until it lands, titles use SemiExpBold). A screen fades
  24 px under the status inset once content is under it (`LAYOUT.app.fade`), and ends its scroll 12 px above the tab
  bar in a fade. A list passes `snapRows` to `Screen`: at rest a row never ends under the tab bar (whole row or none).
- **Drawers and dialogs** (round 4). Every drawer and sheet, What's real included, **starts under the top bar**
  (`--fsc-stage-top`): 560 px, standing in the stage's gutters at the panel radius, e3, a sticky 56 px head (the
  title and Close) on plate. Dialog 520 px, radius 24, e3, only for a decision that must interrupt (signing).
  Everything else is inline or a drawer.
- **Hero moments.** Fan-out: Rhea's path ends at her marker; cash is a 6 px hatched ribbon. Before the move to cash
  the count is `Numeral` "7/8" beside the seal; after it the hero reads **"7 PayPal · 57 cash"** (a jade dot by 7,
  a hatch swatch by 57) with "Review cash handover" as the screen's one primary Slab, and Rhea's cash line appears
  once. "Try to break it" is a list of rows, each with a Try button; a tried row reads "Refused · invoice must equal
  quote" and the number it blocked.

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
glyph's name); seeded and replayed data carry their glyph with the pinned phrase ("Seed stand-in, not a Claude
recording"). Nothing claims a live Claude reading on a seeded or replayed run: the reading room separates the
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

## 10. The owner's reference reels

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
