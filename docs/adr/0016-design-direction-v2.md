# ADR-0016: Design direction v2, "Hayag" (owner request, 4 Nov 2026)

- **Status:** Accepted, at the owner's request
- **Date:** 4 Nov 2026 (IST)
- **Touches:** `docs/spec/01-design-direction.md` §2.1 to §2.5 and §3 (not edited; this ADR records the change),
  `packages/tokens`, `packages/ui-web`, `packages/motion`, `apps/console`, `apps/mobile`
- **Decision record:** `research/theme-1104/decision.md` (scores, grafts, every value); the final values are
  `research/theme-1104/final/tokens.json`, the look is `research/theme-1104/final/mock.png`

## Context

The owner asked for this change on 4 Nov 2026, in his own words:

> "Why does everything have a brown theme? Make it look fresh, elegant, modern, and amazing. It should be very
> visually good-looking, impressive, and easy to understand for any person. … I want it to look amazing, have
> amazing UI, good colors, and be vibrant, but still look professional and elegant."

The judges must understand the product in the first seconds of the film and the site. The v1 direction
(`docs/spec/01-design-direction.md` §2) was a dark cacao console (Tablea) and a warm daylight app (Adlaw), and it
banned purple, indigo, gradients, gradient text and glows.

Three designers proposed directions and three judges scored them, seven criteria each, 210 points in all
(decision.md §1):

| Direction                   | Total | Rank |
| --------------------------- | ----- | ---- |
| A. Hayag (daylight)         | 175   | 1    |
| B. Gabii (midnight vivid)   | 165   | 2    |
| C. Fresh Harvest (tropical) | 152   | 3    |

A came first with all three judges and won six of the seven criteria. Its weakness was the owner's own word,
"vibrant": every graft below answers it without breaking A's rules.

## Decision

Hayag, plus grafts from B and C, replaces the v1 palette where decision.md says so.
1. **The console moves from dark to light (spec §2.1; decision.md §5).** Every surface (the console, the judge
   stage, Proof, the app, the stage's phone frames) is the `adlaw` slot, shown as **Hayag (day)**. The `tablea`
   slot becomes **Gabii (night)**: the film's title, chapter and architecture cards and an opt-in night console,
   never on the judge path. `:root` in `theme.web.css` is now Hayag.
2. **The palette (spec §2.2; decision.md §4 and §6).** White and porcelain surfaces with a cool blue-black ink
   (`#0B1220`); no brown anywhere. One job per colour:
   - jade `#14CC90` is money only (raised: this control moves money; flush: the simulated PayPal confirmed it;
     a 1.5 px dashed jade outline: in flight);
   - marigold `#FFA41B` (the `canary` role) means a person must decide; never a button, never an error;
   - **indigo is now allowed for a person's hand**: ballpoint `#4A2FD6` (`pod`, the chalk slab) is the person's
     decision slab, stamps, the seal's linework, the focus ring, the dial needle and selection;
   - graphite pencil is the machine; ink is a checked fact ("Matches", the Proof pill, the Sample badge, "Check
     again"); red is only PayPal saying no; hatch plus the word is cash; dashed steel is "not real, or not yet".
   - **One morning wash** (`--fs-wash`), only behind the stage hero, the Proof hero, the member panel and film
     frames; never behind data, text or a control; never animated.
   - **The jade halo** (`jade-halo`, `--fs-shadow-halo`): the one earned glow, one beat on a "Bayad na" face
     after the simulated PayPal confirms.
   - **Film night glows**: the Gabii wash, on the film's night cards only.
   - **Marigold and ballpoint moved away from PayPal's colours** (decision.md §3 and §10): ballpoint is ΔE 13.6
     and 23.2° of hue from PayPal blue `#0070E0`; marigold is ΔE 7.4 from the button yellow `#FFC439`; jade is
     ΔE 20.6 from `#009CDE` (OKLab ×100). A token test holds all three at ΔE 7 or more.
   - Three roles are added: `rule-strong` (decorative outlines, never a control's only boundary), `pod-wash` (a
     person's selection) and `jade-halo`. Six contrast rules are added (washes, steel-line 3:1 for the honesty
     dash and input outlines, the marigold border on its wash, pod on pod-wash), plus a Hayag-only test that both
     slab lips reach 3:1 on plate. 242 pairs across both themes and the Proof and film overrides pass
     (decision.md §10).
3. **Figures (spec §2.3; decision.md §7).** Amounts use proportional lining figures (a plain zero and a plain
   one) and the "US$" prefix at half size, raised (`.fs-cur`; the accessible text keeps the whole string). The
   slashed zero (Mona's `tnum` `zero.tf`) stays only for hashes and grid columns that must align on the decimal.
   `TYPE_ROLES` replaces `figures: boolean` with `numerals: "proportional" | "tabular" | "hash"` and adds
   `display`, `lede` and `statement-status`. The native cuts should freeze `tnum` only into
   `FSSans-SemiCondMedium`; that rebuild needs the pinned font sources and is open (see Consequences).
4. **Shape and depth (spec §2.4; decision.md §8).** Radii add `cell` 6, `control` 10, `card` 14, `panel` 22 and
   `pill` to 0 and 2. The slab becomes a radius-14 face on a **bottom lip** (its `-right` shade, a 1 px
   `-bottom` under-edge, a soft drop in the face colour) that replaces the skewed parallelograms; the lip's depth
   is unchanged (d1 3, d2 5, d3 8: depth equals consequence) and the press moves the face straight down by it.
   The rule "evidence casts the only shadow" is relaxed to an elevation scale: `e1` (chips, tiles), `e2` (panels),
   `e3` (drawers, dialogs), with paper still the strongest shadow.
5. **Materials (spec §2.5; decision.md §8).** Noise is gone: `MATERIALS.noise.opacity` is 0 and the console's
   Tablea noise tile is removed. No glass and no gradient text.
6. **Motion (spec §3; decision.md §9).** `TWEENS.halo` (520 ms, ease out): "Jade halo, one beat after the
   simulated PayPal confirms". Reduced motion shows no halo growth (a still ring fades over 150 ms), no spring and
   no travel; the needle jumps.

The keys `tablea` and `adlaw` stay in code: they appear in more than 270 places (`data-theme`,
`data-ag-theme-mode`, the app's theme switch, the tests). Only their values and display names change. Renaming
the keys is a later, separate change.

## What stays

- One job per colour.
- Jade only on confirmation: money turns flush jade only when the simulated PayPal confirms it, so the first
  press ("Mark Lantern Bay's invoice paid", a person's slab) is indigo, not jade, and a signed jade slab waits as
  a dashed jade outline, not a flush face.
- Depth equals consequence (the lip keeps DEPTH).
- Status never relies on colour alone: a glyph, a word and, for holds, a filled tag (decide and failure text are
  only ΔE 2.7 apart under protanopia).
- Every simulated thing is labelled ("Simulated PayPal sandbox", "Seed stand-in, not a Claude recording"), now on
  the dashed steel honesty chip.

## Grafts and what was declined (decision.md §3)

- From B: the night film cards; the inline H1 row in the split grid (built as a one-line hold summary with "Open
  H1"; the drawer stays the only place to decide); MM-7's tap-a-peso drawn as the equation; proportional money;
  an indigo first press; the honest "What's real" wording; coloured top bars on the step tiles.
- From C: numbered story tiles with real figures (merged with A's five-step legend); Proof's "where every dollar
  went" bar; the pink "0457 ×2" chip; AS and EC stamps on Proof's signed-by line.
- Declined: a dark console and a dark Proof masthead (the owner asked for fresh); mint for "Matches" (a check
  result must never look like money); glass, noise, gradient keycaps, gradient text and the comet; blue machine
  figures; a "sky" role (ΔE 2.25 from PayPal's light blue); the pinwheel logo, mango and six or more hues; C's
  statement as drawn (it showed US$43.69 as paid; Nang Celing is paid US$64.45).

## Consequences

- `docs/spec/**` is not edited; where `01-design-direction.md` §2.1 to §2.5 and §3 disagree with this ADR, this
  ADR wins.
- Token tests change only where the direction intends it (the published ratios, the statement ratios, the radii,
  the numerals, the old brown, purple and canary-hue checks become v2's no-brown, indigo-for-a-hand and
  marigold-hue checks).
- Open: the native font cuts still freeze `tnum` into every Mona instance, so the app's web frames and the
  hollow amount face keep the slashed zero until `assets/fonts/build/cut_fonts.py` can run with its pinned
  sources (they are fetched over the network).
- The film's palette moves with the film rebuild package, not with this change.
