# Fair Split design system (UI gate round 3)

The single source for every surface: the console and judge stage, Proof, and the phone app. It refines the
incumbent Hayag world (white and porcelain surfaces, blue-black ink, one job per colour, no brown); it does not
replace it. Console and phone are **Operate** surfaces (the task leads, the tool disappears into it); Proof is
**Read** (one 680 px column, the verdict first). Values live in `packages/tokens/src/tokens.ts`; this file says what
they are for. When this file and older specs disagree, this file wins for look and feel; figures, test IDs and
honesty meanings never change.

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

## 2. Colour: one job each

| Token                                      | Hayag                       | Job                                                                                                                                 | Never                                                  |
| ------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `ink` / `ink-2` / `ink-3`                  | #0B1220 / #3A4456 / #5A6476 | Text, checked facts / secondary / meta and icons                                                                                    | ink-3 on a statement                                   |
| `pencil`                                   | #4A5A73                     | The machine's figures before two keys sign                                                                                          | A fill                                                 |
| `ground` `plate` `plate-2`                 | #F3F5F8 #FFF #F7F8FA        | Page / panels / headers, hover, inspectors                                                                                          | Colour washes                                          |
| `rule` `rule-strong`                       | #E3E7EE #CBD2DC             | Row separators / chip and control outlines                                                                                          | A control's only edge below 3:1                        |
| `steel-line`                               | #7E8898                     | Dashed = simulated; input outlines; unsigned seal rings                                                                             | Anything real                                          |
| `pod` (indigo)                             | #4A2FD6                     | **Action and focus**: the one primary, the focus ring, caret, selection (`pod-wash`), signed seal rings, stamps                     | Money, the machine, decoration; ≤ 2 % of a viewport    |
| `jade` (+`jade-flush-border`, `jade-text`) | #14CC90                     | **Only money the simulated PayPal confirmed**: the paid pill and capsule, the paid dot, a confirmed thread or bar, one beat of halo | In flight, signed, a heading, a button, a check result |
| `canary` (amber)                           | #FFA41B                     | **A person must decide**: hold dot, H-tag, You cell ring, over-limit tick and needle, the run pill's dot                            | Text (fails contrast), a button, an error              |
| `red` (+`red-wash`)                        | #CF2A27                     | **Only PayPal saying no** (DENIED, FAILED, BLOCKED, unexpected RETURNED, ERRPYO)                                                    | Holds, cash, refusals by our own rules                 |
| `hatch`                                    | #A4AEBC                     | **Cash** at the bodega (or unavailable), always with the word                                                                       | Red, grey text                                         |
| copy-white/pink/yellow, `--fs-evidence-*`  |                             | Evidence paper only                                                                                                                 | Chrome                                                 |

No other hue appears. No wash, gradient, glow or coloured shadow on a product surface (Hayag's `--fs-wash` is
`none`). Contrast is CI-gated (`contrast.json`): UI text 4.5:1, statement text 7:1 (`statement-ink`), non-text 3:1.

## 3. Space, radius, elevation

- Space (4-based): 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48 · 64. 2 and 6 only inside parts ≤ 24 px tall. Panel padding
  20–32, card 16, icon-to-label 8, between sections 32, above a hero number 48. Tight inside groups, generous between.
- Radius: cell 6 (chips, keys), control 12 (buttons, inputs), card 16, panel 24 (stage panels, drawers, dialogs),
  pill 999 (status pills, tags, segmented controls). Evidence paper 0.
- Elevation is declared once: **a border or a shadow, never both.** `e1` (its ring is in the shadow) rests the bar,
  the run pill and cards; `e2` holds the stage's two panels, menus and tooltips; `e3` lifts drawers, sheets, dialogs
  and the toast; `paper` is evidence only. Flat parts take a 1 px `rule`/`rule-strong` border and no shadow.

## 4. Components (use these; do not rebuild them)

- **Buttons.** One primary per screen: `Slab` (indigo face, 48 px, radius 12, label 16/600, hugs its label; tone
  `jade` is the same indigo face). One secondary: `.fs-flat` (white, 1 px rule-strong, 40 px; `data-size="l"` 48).
  Inline actions: `.fs-link`. A "Try" or "Why" control is `.fs-flat` or `.fs-link`, never a third style.
- **Honesty marks.** `HonestyTag quiet` once, in the top bar. `MicroTag` (12 px dashed circle + "Sandbox", 12 px,
  ≤ 2 a screen) only beside a PayPal money value. Every other provenance is a 12 px `LegendGlyph` (`HONESTY.*`):
  its words are its tooltip and accessible name. `HonestyLegend` lives only in What's real. Screen tests call
  `tagBudget(root)` (≤ 3 tags, ≤ 2 micro).
- **Status pills.** `StatusChip` / `Chip`: 28 px, glyph and word, 1 px ring. Jade is the only filled pill
  (confirmed); `canary` an amber ring; `flight` neutral; `hatch` a hatch swatch; `red` PayPal's no. ≤ 1 pill a row,
  ≤ 3 kinds a screen. A checked fact gets no pill: ✓ glyph and the word in ink.
- **State dots.** `StateDot` 8 px: `pending` hollow ink-3, `waiting` hollow steel, `done` ink (signed, checked),
  `paid` jade, `held` amber, `failed` red. Colour lives in the dot; the word beside it says the state.
- **Numbers.** Money: `MoneyFigure` (`align="decimal"` in columns, `raisedPrefix` on heroes), `AmountDisplay`,
  `CurrencyFigure`. Counts and readings: `Numeral` (`size` hero/title/body, `tone` ink/dim, `decorative` when words
  beside it say it). One `hero` per screen.
- **Tables.** Header 14/520 ink-2 on plate-2, 36 px; rows 40 px with 1 px rule separators; numbers right-aligned
  tabular, IDs in `id`; no zebra; hide a column that is all zero; a footer total says what it totals. A held row:
  the amber dot and the H-tag in its status cell, never a coloured side bar.
- **Toast and Log.** `EventToast`: one, bottom left, 40 px pill on e3, the newest live event for `TIMING.toast`
  (3 s), never focus, never a live region. The whole timeline is the `LogSheet` behind the top bar's Log icon.
- **Seal.** `Seal` at `LAYOUT.console.seal` (180 px) on Approve and on the Chair's phone, `showHash` for the mono hash
  beneath. Unsigned rings: 1 px `--fs-unsigned`. Key 1 fills the inner half in indigo, key 2 the outer half. The
  phone draws the same state in the same colours.
- **Phone on the stage.** A 56 px rail (`LAYOUT.console.phoneRail`: phone glyph, a 32 px avatar per frame, the shown
  frame's dot) on steps where it does not change; it opens on the phone's beats (key 2, Bayad na, the traced peso)
  and on click. Frames stay loaded; until the app answers, a labelled preview of the run, never a skeleton. The
  console rail keeps its labels from 1280 px (the 1,470 laptop included). The app ends its scroll 12 px above the
  tab bar in a fade.
- **Drawers and dialogs.** Drawer 560 px from the right (push below 1600 px, overlay above), panel radius on the
  side facing the screen, e3, a sticky 56 px head (title + Close). Dialog 520 px, radius 24, e3, only for a decision that must
  interrupt (signing). Everything else is inline or a drawer.
- **Hero moments.** Fan-out: Rhea's path ends at her marker; cash is a 6 px hatched ribbon; "7/8" is a `Numeral`
  beside the seal. Refusals are titles ("Refused · <rule id>") with "Why" behind them. "Try to break it" is a list of
  rows, each with a Try button; a tried row reads "Refused · <rule id>" and the number it blocked.

## 5. States and focus

One ring: `:where(*):focus-visible` in ui-web, 2 px `pod`, 2 px offset, following the radius, keyboard only. No
feature declares its own ring or a box-shadow ring; a screen's pre-focus stays quiet until a key (`data-prefocused`).
Hover: plate-2 under ink. Disabled: ink-3, `aria-disabled` keeps focus. Loading: print beds at final size in a
solid hairline (no shimmer). Empty: one line that says what fills it. Error: what failed, why if known, the way
back. Selection: `pod-wash`; caret and native controls `pod`; scrollbars thin in `rule-strong`.

## 6. Copy

- Sentence case, no "!", no emoji, no title case, no tracked capitals. Headers are noun phrases without a full stop.
- One line of prose a panel (≤ 10 words, no semicolon); labels ≤ 3 words; data joined by " · ". Explanations live
  only in What's real, a row's expand, or a `title`/`aria-label`. Provenance once a screen, in the header's id line.
- Controls name their action ("Count it once", "Review cash handover"); errors name the problem and the recovery.
- Say each fact once, with one name: "2026-A" for the season, a labelled run id, "48 this run · 264 season",
  "8 · 56 planned" before settlement and "7 PayPal · 57 cash" after, "Proof 0/6" on six checks (`lib/display.ts`).
- State words never overclaim: "PayPal complete · cash due" until the cash is attested; never "Settled" or "Done"
  while cash is due; a replay never reads as paid. Copy only gets shorter.

## 7. Motion

150–250 ms for state changes (`TWEENS`), exponential ease-out (`EASE.out`), no ease-in, no page-load choreography.
Motion is evidence: a thread draws on a webhook, the seal engraves on a key, a pill floods jade on confirm, one beat
of halo. Money lands; it never counts up. Reduced motion keeps colour and opacity at 150 ms and drops travel.

## 8. Honesty system

Dashed lines mean **simulated**, and nothing else. Hatch means **cash**. Jade means **confirmed by the simulated
PayPal**. Every PayPal value carries the sandbox label (the top-bar indicator, a MicroTag, or the legend glyph's
name); seeded and replayed data carry their glyph with the pinned phrase ("Seed stand-in, not a Claude recording").
Nothing claims a live Claude reading on a seeded or replayed run.

## 9. The owner's reference reels

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
