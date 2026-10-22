## S2. Design System, Motion, Sound and Haptics

**Owner:** WS-DS (`packages/{tokens,motion,seal,ui-web,ui-native,i18n}`, `assets/**`, `apps/console/src/prototype/**`). If S5 folds lanes to fit capacity, the web half moves with WS-CONSOLE and ui-native moves with WS-APP. Paths, contracts and dates stay as written. **Consumers:** WS-CONSOLE, WS-APP, WS-QA, WS-MEDIA.

Facts were checked on 22 Oct 2026. Anything not checked is marked **UNVERIFIED**. Where the Design Direction does not change (palette roles, grids, type roles, choreography rules), this section cites it and does not repeat it.

### S2.0 Rules

1. **Machines print, people press, PayPal lands.** Output from Claude and the engine is flat pencil print, moved only by tweens, and never a button. A person's commit is a slab with a spring. A state PayPal has confirmed is jade flush on the `land` spring.
2. **Motion is evidence.** A state animation starts only on one of three triggers: an SSE `RunEvent`, an HTTP 201 or 409, or an accepted signature. Press feedback is local. The change a press causes waits for its event.
3. **One amount grammar.** Every amount carries `data-amount-state` (S2.2.1).
4. **No raw states; full test hooks.** `StatusChip` renders the `contracts` label maps. Every stateful element carries `data-testid` and `data-state`. Every moment root carries `data-moment` and `data-moment-phase`.
5. **Rendering.** SVG, CSS transforms and opacity, and Reanimated only. Packages that register §6 removes stay removed.
6. **Polish is concentrated.** Bespoke motion exists only on the hero path: W-JG-01, W-TR-01, W-TR-03, W-TR-04, W-TR-06, W-TR-07, W-TR-08, W-PF-01, M-MB-01 and M-BD-02. Every other screen uses stock primitives and stock transitions.
   - One focal motion per screen.
   - 0 ms for any action used 20 or more times a session.
   - Exits run 20% faster than entrances.
   - No ease-in, count-ups, confetti or ambient loops.
7. **Timings come only from `@fairsplit/motion`.** WS-QA's lint fails any numeric literal inside `transition=`, `animate(`, `withTiming(` or `withSpring(` in `apps/**`.
8. **Never branch on screen-reader detection on the web.** Under react-native-web, `AccessibilityInfo.isScreenReaderEnabled()` always resolves `true` ([source](https://github.com/necolas/react-native-web/blob/master/packages/react-native-web/src/exports/AccessibilityInfo/index.js)), and browsers offer no detection at all.

### S2.1 Packages, sharing and G0 scope

- **`@fairsplit/motion`:** pure data (`presets`, `timelines`, `moments`, `feedback-map`, `sound/recipes`). Subpath `/web` adds Motion and Web Audio; subpath `/native` adds Reanimated, expo-audio and expo-haptics.
- **`@fairsplit/tokens`:** `src/source.ts` is the only hand-edited file. The build writes `src/generated/`, which is committed. CI rebuilds it and fails on `git diff --exit-code`, so Vite and Metro never depend on build order.
- **`@fairsplit/seal`:** a pure `seal(batchSha256, size)`. apps/api renders the push PNG from it through sharp 0.35.5.
- **`@fairsplit/ui-web` and `@fairsplit/ui-native`:** identical prop types. ui-native also renders inside the Expo web export at `/app`.
- **`@fairsplit/i18n`:** ICU strings for the UI. Statement prose is S4's `StatementPlan`.
- **Formatting:** DTOs carry cents. The UI formats them with the pure `format` that `@fairsplit/api-client` re-exports from `domain` (S3.2), never with `Intl`.
- **Generated files:**
  - `tokens.css`: the `[data-theme]` sets, motion variables and a reduced-motion block.
  - `fonts.css` and `fonts-proof.css`.
  - `tailwind.css`: `@theme{--*:initial;--spacing:.25rem;…}`, which leaves Tailwind layout-only ([Tailwind](https://tailwindcss.com/docs/theme)).
  - `tokens.native.ts`: theme objects, plus `fontMetrics` from `assets/fonts/metrics.json`.
  - `ag-grid.ts`: at the subpath `@fairsplit/tokens/ag-grid`; only the console imports it.
  - `m3.ts`: primary ink, surface ground, containers plate and plate-2, outline rule, error red. Jade and canary get no role.
  - `glyphs.ts` and `contrast.json`.

**One theme per surface.** The console is Tablea (`<html data-theme="tablea">`, `data-ag-theme-mode="fs-tablea"`). The app, Proof and the stage's phone frames are Adlaw. Nothing switches theme at runtime, so there are no theme pickers and no transition-suppression code. Both token sets still pass the contrast test.

**G0 (24 Oct) ships only these:**
- tokens and the contrast test;
- Slab, with hold-to-commit and ConfirmDialog, on both platforms;
- Print, Seal, StatusChip and AmountDisplay;
- `feedback`;
- six glyphs: pencil, cash, bolt, seal, listen, duplicate.

ReceiptBar, HoldCard and SplitFan follow on 25 Oct. The other eight glyphs land by G2.

### S2.2 Colour

The Design Direction's palette and roles (§2.2) stand. Running its own contrast rule over every surface each token can sit on forced these changes:

| Token               | Tablea                | Adlaw                                           | Why                                                                                           |
| ------------------- | --------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| ink-3               | **#9C9085**           | **#6F665E**                                     | Old values were 4.18:1 on plate (Tablea) and 4.34:1 on ground (Adlaw). Now ≥4.65:1            |
| hatch               | **#624E41**           | **#B7B0A7**                                     | Old values fell to 1.70–1.72:1 on one surface. Now ≥1.85:1                                    |
| pencil-faint (new)  | **#909498** (80% mix) | **#5E6871** (90% mix)                           | Replaces "pencil at 60%" (3.58:1) with an opaque mix of pencil over plate. ≥4.74:1            |
| canary-border (new) | –                     | **#7F6200**                                     | Canary on white is only 1.41:1, so canary faces get a 1 px border, as jade flush already does |
| hollow-fill (new)   | **#ADA59D** (≥5.96:1) | **#6B6764** (4.82:1 on ground, 5.60:1 on plate) | Ink mixed 65% over plate. Fills money in flight on member surfaces                            |

| `--fs-` token                                              | Tablea                               | Adlaw                                   |
| ---------------------------------------------------------- | ------------------------------------ | --------------------------------------- |
| ground, plate, plate-2, rule                               | #201712 #2A1F18 #33271F #4A392D      | #EEEEEA #FFFFFF #F6F6F3 #D8D4CD         |
| ink, ink-2, ink-3, hollow-fill                             | #F4EDE4 #BDB1A4 #9C9085 #ADA59D      | #1C1511 #4E453E #6F665E #6B6764         |
| pencil, pencil-faint                                       | #A9B1B8 #909498                      | #4C5761 #5E6871                         |
| jade, on-jade, jade-text, jade-flush-border                | #2FD3A0 #201712 #2FD3A0 –            | #2FD3A0 #1C1511 #0A7553 #0F6F53         |
| canary, on-canary, canary-text, canary-wash, canary-border | #F2DA4E #201712 #F2DA4E mix 12% –    | #F2DA4E #1C1511 #7F6200 #FFF3BF #7F6200 |
| red, red-face, on-red-face, red-wash                       | #FF5A47 #D63A2C #FFFFFF mix 14%      | #BF2A1C #BF2A1C #FFFFFF #FCE6E3         |
| pod; hatch; steel-line, steel-face                         | #FF8A2A; #624E41; #7C8288 #3B3F43    | #C85A00; #B7B0A7; #8A9096 #D5D8DB       |
| copy-white/pink/yellow; scrim                              | #FFFFFF #F4C9D4 #F5E27A; #100B08@64% | same; #1C1511@40%                       |
| jade-wash, pencil-wash (grid flash)                        | mix 18%, 12%                         | mix 16%, 10%                            |
- **"Mix n%":** blend the token over plate in sRGB and emit opaque hex. AG Grid needs opaque colours ([AG Grid](https://www.ag-grid.com/javascript-data-grid/theming-colors/)).
- **Member-facing text** is always ink or ink-2. Statement copy then measures 7.64:1 in Tablea and 9.36:1 in Adlaw.

**CI gate** (`packages/tokens/test/contrast.test.ts`):

| Pairs                                                                                                                         | Minimum |
| ----------------------------------------------------------------------------------------------------------------------------- | ------- |
| Console text (ink, ink-2, ink-3, pencil, pencil-faint, jade-text, canary-text, red) on ground, plate and plate-2, both themes | 4.5:1   |
| Statement copy                                                                                                                | 7.0:1   |
| hollow-fill on every surface                                                                                                  | 4.5:1   |
| Faces and slab labels                                                                                                         | 4.5:1   |
| Pod everywhere; flush and canary borders against plate                                                                        | 3.0:1   |
| Hatch everywhere                                                                                                              | 1.8:1   |

#### S2.2.1 The amount grammar (IC-09)

`contracts` ships the state map next to its label maps, as `AMOUNT_STATE`. Primitives render it and expose it as `data-amount-state`.

| `data-amount-state` | Means                                                       | Large (≥28 px)                                                                                                 | Inline (<28 px)                                              |
| ------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `pencil`            | Read by Claude or computed by the engine; nobody has signed | Solid pencil                                                                                                   | Pencil                                                       |
| `you`               | A person must enter or confirm it (never hollow)            | –                                                                                                              | Pencil-faint value in a 1.5 px canary cell, with a "You" tag |
| `ink`               | A person entered or approved it                             | Solid ink with the initials stamp(s)                                                                           | Ink; the stamp sits on the field or row                      |
| `hollow`            | Money in flight: invoice unpaid, payout sent, or cash due   | Console and invoice: transparent fill, 1.25 px ink stroke. Member surfaces: hollow-fill with a 2 px ink stroke | Ink-2 with a 1.5 px dashed underline                         |
| `landed`            | PayPal confirmed it                                         | Solid ink; its capsule or chip is jade flush                                                                   | Ink; the row's StatusChip is jade flush                      |
| `attested`          | Cash was handed over and the clerk attested it              | Solid ink with the JD stamp                                                                                    | Ink with the JD stamp                                        |

**State map**

| Amount state | Applies to                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `pencil`     | Lines that are COMPUTED, READY or HELD before the run is APPROVED                                                                |
| `you`        | Fields below 0.85, or awaiting entry by hand                                                                                     |
| `ink`        | Fields a person entered, and every line once the run is APPROVED                                                                 |
| `hollow`     | SUBMITTED, PAYPAL_PENDING, UNCLAIMED, PAYPAL_HELD, NEEDS_ACTION, RETURNED, REROUTED, OFF_RAIL_DUE, and the invoice before FUNDED |
| `landed`     | PAID, and the invoice once FUNDED                                                                                                |
| `attested`   | OFF_RAIL_PAID                                                                                                                    |
- **Edge cases:**
  - REVERSED stays `hollow` and gets a red chip.
  - EXCLUDED stays `pencil` with "Reserved, never redistributed".
  - When approvals are voided, `ink` returns to `pencil`.
- **Machine text is pencil too.** The HoldCard's engine line and Claude's line differ only by the pencil glyph and the word "Claude".

**Member hollow is tinted.** A 1.25 px outline on condensed weight-800 numerals is too faint for Nang Celing in daylight.
- **Member surfaces:** hollow-fill plus a 2 px ink stroke. Every pixel of the glyph clears 4.5:1, yet the amount still reads clearly lighter than landed ink (L* 44 against 7).
- **Console and invoice plate:** keep the pure outline.
- **Fallback:** if the G1 readers' check fails, member hollow becomes solid ink with a 2 px hatched underline.

**Native hero amount: one SVG text.** AmountDisplay draws fill and stroke in a single react-native-svg `<Text>`, so the two cannot drift apart at font scale 1.3 or 2.0.
- **Font:** `MonaSansCondensed-ExtraBold` with `fontFeatureSettings="'tnum' 1, 'ss08' 1"`.
- **Size:** `48 × min(PixelRatio.getFontScale(), 1.5)`.
- **Width:** from `onLayout` on an invisible RN `Text` of the same size with `allowFontScaling={false}`.
- **Baseline:** from `fontMetrics.heroCut`.
- **Accessibility:** the wrapper carries `accessibilityLabel={format.spoken(cents, lang)}` and hides both children.
- **MM-1** animates `fill` through `animatedProps`.
- react-native-svg applies `fontFeatureSettings` on Android ([source](https://github.com/software-mansion/react-native-svg/blob/main/android/src/main/java/com/horcrux/svg/TSpanView.java)). iOS is **UNVERIFIED** (iOS is P2).

**Member wording.** Members never see a per-kg rate.
- ReceiptBar (`audience="member"`) and MM-7 say "Your 148.0 kg of the co-op's 9,780.6 verified kilos" for the premium. Check: 2,887.50 × 148.0 / 9,780.6 = 43.69.
- They say "148.0 kg of 9,388.0 kg Grade 1" for the bonus. Check: 1,386.00 × 148.0 / 9,388.0 = 21.85.
- Console tooltips keep the rate: "US$0.29523 a kg, R0, engine v1".

**Tests**
- Every amount primitive renders every state on both platforms, asserting `data-amount-state`, fill and stroke.
- Playwright follows M-014 through pencil → ink → hollow → landed across MM-5, MM-6 and MM-1.

### S2.3 Typography

**Facts** (read from the upstream files on 22 Oct)
- **Mona Sans** has `tnum` and `ss01–ss10`, but no ₱ (U+20B1) and no `zero` feature. Its distinct zero is **ss08**, "tabular zero with straight bar" ([Mona Sans](https://github.com/github/mona-sans)). So use `"tnum" 1,"ss08" 1`.
- **Atkinson Hyperlegible Next** has `tnum` and no ₱. **Noto Sans** has ₱. Spike S8 has therefore failed on ₱, and its fallback applies now.
- **Licences.** Mona Sans reserves the name "Mona", both upstream and on Google Fonts ([OFL.txt](https://github.com/google/fonts/blob/main/ofl/monasans/OFL.txt)). Atkinson Next, Big Shoulders and Noto reserve no names. OFL-FAQ 2.2 and 2.6–2.8 treat format conversion and subsetting as modification ([OFL-FAQ](https://openfontlicense.org/ofl-faq/)). So any Mona subset must be renamed, while unmodified upstream files keep their names.

**Native and `/app` use upstream files, unmodified.** There is no instancing, overlap removal, feature freezing or ₱ graft.
- **Mona Sans v2.0.27 statics:**
  - `MonaSansCondensed-ExtraBold`: amounts.
  - `MonaSansSemiCondensed-Medium`: figure, hash.
  - `MonaSans-Regular`: body, caption, label.
  - `MonaSansSemiExpanded-Bold`: slab, titles, stamp.
- **Atkinson Next:** `-Regular` and `-Bold`.
- **Formats:** TTF on Android (Mona totals 571 KB). The web export uses the matching upstream WOFF2 files (244 KB).
- **Features:** `fontVariant: ['tabular-nums', 'stylistic-eight']`. RN 0.88 maps these to `tnum` and `ss08` on Android and iOS ([0.88-stable](https://github.com/react/react-native/blob/0.88-stable/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/views/text/ReactTypefaceUtils.kt)). The [docs](https://reactnative.dev/docs/text-style-props) still list only five values.
- **₱:** a nested `<Text>` in the system font.
- **File names:** expo-font takes the family name from the file name on Android and from the font itself on iOS ([Expo](https://docs.expo.dev/develop/user-interface/fonts/)). At G0, confirm each file name equals its PostScript name. If not, rename the file; that does not modify the font.

**The web uses small subsets.** The smallest unmodified upstream variable WOFF2 with a width axis is 308 KB, over both font budgets. `assets/fonts/build/cut_fonts.py` makes the subsets below.
- **Tools:** fonttools 4.66.1 and brotli 1.2.0.
- **Sources:** pinned by SHA in `fonts.lock.json`. Outputs are committed.
- **Metrics:** the script also writes `assets/fonts/metrics.json` (unitsPerEm, ascender and descender of the native hero cut).

| File                         | Source and recipe                                                                     | Size   | Use                           |
| ---------------------------- | ------------------------------------------------------------------------------------- | ------ | ----------------------------- |
| `FSSans-VF.woff2`            | GF Mona Sans 2.001 `[wdth,wght]`: Basic Latin, Latin-1, Latin Extended-A, punctuation | 108 KB | Console, stage                |
| `FSSans-Proof.woff2`         | Same; Latin-1 only; wdth 75–100, wght 400–800                                         | 66 KB  | Proof                         |
| `FSNumeralsHollow.woff2`     | Upstream static `MonaSansCondensed-ExtraBold`: `0-9 $ . , − U S`                      | ~4 KB  | Hollow amounts on the console |
| `FSSansPeso.woff2`           | Noto Sans, U+20B1 only, declared as "FS Sans" through `unicode-range`                 | 2 KB   | All web                       |
| `FSStencil.woff2`            | Big Shoulders Stencil 800 at opsz 72: `0-9 A-Z -`                                     | 4 KB   | Season and lot marks          |
| Atkinson Next `[wght]` WOFF2 | Upstream, unmodified                                                                  | 48 KB  | Lazy-loaded for C9 print only |

**Subsetting rules**
- **Flags.** Every subset runs `pyftsubset … --layout-features+=tnum,ss08,case --name-IDs='*' --name-legacy --name-languages='*'`. Without `--name-IDs='*'`, fontTools keeps only name IDs 0–6 and drops licence records 13 and 14 ([fontTools](https://fonttools.readthedocs.io/en/latest/subset/index.html)).
- **Renaming.** Mona-derived outputs replace "Mona Sans" and "MonaSans" with "FS Sans" and "FSSans" in name IDs 1, 3, 4, 6, 16, 17 and 25.
- **Hollow face.** It comes from a static, because variable fonts keep overlapping contours and a stroke draws those overlaps as lines inside the glyphs ([fontTools #1518](https://github.com/fonttools/fonttools/pull/1518)). If the G1 render of "4", "8" and "$" still shows inner lines, add `removeOverlaps` to that job.

**Families and roles**
- `--fs-font-ui:"FS Sans",system-ui,sans-serif`
- `--fs-font-statement:"Atkinson Hyperlegible Next","FS Sans",sans-serif`
- `--fs-font-mark:"FS Stencil"`
- Roles and sizes follow Design Direction §2.3, with these changes:
  - the native hero amount caps at 1.5× font scale;
  - Proof clamps slab labels to width 100;
  - money is always set in Mona Sans (FS Sans on the web) with `tnum` and `ss08`.

**Licences**
- `assets/fonts/test_fonts.py` runs in CI. It asserts that:
  - every shipped font carries name IDs 0, 13 and 14;
  - no renamed cut keeps "Mona" in name IDs 1, 3, 4, 6, 16 or 25;
  - unmodified files match their lockfile hashes.
- `assets/fonts/LICENSES.txt` holds each family's `OFL.txt`. It is served at `/fonts/LICENSES.txt`, bundled in the APK, and shown by `LicensesScreen` under Settings › Licenses.
- Material Symbols keep their Apache-2.0 `LICENSE`.
- WS-QA keeps the root `LICENSE` pure MIT, and generates the `NOTICE` file and a `/licenses` page from `pnpm licenses list --json`.

### S2.4 Space, layout, depth

Design Direction §2.4 applies unchanged: the space scale, grids, radii 0 and 2, depth by value steps, and the paper shadow on evidence only. Native passes the shadow to RN `boxShadow`, which needs the New Architecture ([RN](https://reactnative.dev/docs/view-style-props)).

| Layer    | z   |
| -------- | --- |
| Sticky   | 10  |
| Dock     | 20  |
| Scrim    | 29  |
| Drawer   | 30  |
| Popover  | 40  |
| Snackbar | 50  |
| Dialog   | 60  |
| Flight   | 70  |

### S2.5 Materials (no glass)

**Slab.** The geometry is rebuilt from the parameters of CRED's NeoPOP (Apache-2.0, [neopop-web](https://github.com/CRED-CLUB/neopop-web)). No code or palette is imported. The credit goes in `packages/ui-web/README.md` and, through WS-QA, in the README's design notes.
- **Face:** travels `t ∈ [0,d]` as `translate(t,t)`, where d is 3, 5 or 8 px.
- **Right edge:** box `[W,W+d]×[0,H]`, origin top-left, transform `translate(t,t) skewY(45deg) scaleX((d−t)/d)`.
- **Bottom edge:** box `[0,W]×[H,H+d]`, transform `translate(t,t) skewX(45deg) scaleY((d−t)/d)`.
- Each edge stays anchored to its far wall and vanishes at `t=d`.

```tsx
// ui-web: build the strings ourselves; Motion's own transform order (translate→scale→skew) is wrong here
const edgeR = useTransform(t, (v) => `translate(${v}px,${v}px) skewY(45deg) scaleX(${1 - v / d})`);
const edgeB = useTransform(t, (v) => `translate(${v}px,${v}px) skewX(45deg) scaleY(${1 - v / d})`);
// press: animate(t, d, tween('press'))   release: animate(t, 0, spring('rebound'))
```

**Native slab:** `[{translateX:t},{translateY:t},{skewY:'45deg'},{scaleX:(d−t)/d}]` with `transformOrigin:'left top'`. RN does not document the order in which the array is applied ([RN](https://reactnative.dev/docs/transforms)). So the G1 gallery screenshots t = 0, 50% and 100%. This stays **UNVERIFIED** until then.

| Tone                    | Face    | Right edge | Bottom edge | Label   |
| ----------------------- | ------- | ---------- | ----------- | ------- |
| chalk (Tablea)          | #F4EDE4 | #B9AFA4    | #8A8178     | #201712 |
| chalk (Adlaw, ink face) | #1C1511 | #4A3F38    | #2B2420     | #FFFFFF |
| jade                    | #2FD3A0 | #1F9E78    | #12704F     | on-jade |

**Slab details**
- **Highlight:** a 1 px top highlight of `rgb(255 255 255/.18)`.
- **Focus:** a 2 px pod ring at a 2 px offset, drawn on the face.
- **Unavailable:** flush, with a hatched face, an ink-2 label and a focusable reason link beneath. Never greyed out.
- **Pointer events:** a slab never toggles `pointer-events` while pressed, because Chromium answers that with `pointercancel` ([dockview](https://github.com/mathuo/dockview/commit/747ead475c67225794c6201eefb564f9165a6940)).

**Other materials**
- **Bolted:**
  - zero travel and a plate-2 face;
  - edges filled with `repeating-linear-gradient(-45deg,var(--fs-steel-line) 0 1.5px,var(--fs-steel-face) 1.5px 4px)`;
  - two 4 px bolt heads, 6 px in from the top corners.
- **Print:**
  - no container;
  - revealed by a 180 ms linear `clip-path` wipe (on native, a plate-coloured cover slides right);
  - a caption footer such as "Read by Claude (claude-opus-5-5)" or "Computed by engine v1, rate card 7f3a 91c2".
- **Ink stamp:** an 18 px ink square with the initials in plate colour at 10 px.
- **Paper:** evidence only. It carries the paper shadow, a "Synthetic sample" chip, and the same words in the alt text.
- **Hatch:**
  - Web: `repeating-linear-gradient(-45deg,var(--fs-hatch) 0 1.5px,transparent 1.5px 6px)`.
  - Native: `hatchPath(w,h)`, because react-native-svg `Pattern` x/y work only on iOS ([Reanimated SVG](https://docs.swmansion.com/react-native-reanimated/docs/guides/animating-svg/)).
- **Noise (P2, the first thing cut):**
  - a committed 128 px 1-bit PNG at 3% opacity on the Tablea ground;
  - removed under `data-rec="1"`.

### S2.6 Icons and glyphs

**Material Symbols**
- Style: Sharp, weight 500, optical size 24.
- Copied as SVG from `google/material-design-icons`: `symbols/web/<n>/materialsymbolssharp/<n>_wght500_24px.svg` and `…fill1_24px.svg`. Their licence and source commit come with them.
- Do not use `@material-symbols/svg-500`: its icons are optical size 48, and it unpacks to 19 MB.

**Domain glyphs**
- The fourteen glyphs of Design Direction §2.6.
- Drawn on a 24 px grid: 2 px strokes, square caps, mitre joins, 45° chamfers, and `-fill` variants for state.
- Rendered by `<Glyph name size>` in `currentColor`.

### S2.7 Components

```ts
type AmountState = "pencil" | "you" | "ink" | "hollow" | "landed" | "attested";
interface SlabProps {
  label: string;
  depth: "d1" | "d2" | "d3";
  tone: "chalk" | "jade";
  hold?: 1600 | 1200;
  bolted?: boolean;
  unavailableReason?: string;
  srLabel: string;
  confirm?: ConfirmSpec;
  onCommit(): Promise<void>;
  testId: string;
}
interface ConfirmSpec {
  title: string;
  cents: number;
  recipients: { name: string; cents: number }[];
  signLabel: string;
}
interface PrintProps {
  value: string;
  provenance: "claude" | "engine" | "person";
  state: AmountState;
  confidence?: number;
  footer?: string;
}
interface AmountDisplayProps {
  cents: number;
  state: AmountState;
  size: "hero" | "l" | "figure";
  surface: "console" | "member";
}
interface SealProps {
  batchSha256: string;
  size: number;
  keys: 0 | 1 | 2;
  engrave?: boolean;
  showHash?: boolean;
}
interface ReceiptBarProps {
  line: StatementLineDTO;
  audience: "member" | "console";
  onSegment(id: SegmentId, rect: Rect): void;
}
interface HoldCardProps {
  hold: HoldDTO;
  gate: "BLOCKS_APPROVAL" | "RESERVES_LINE";
  actions: [SlabAction] | [SlabAction, FlatAction];
  resolution?: StampDTO;
}
```

**Slab states.** `data-state` is one of rest, pressed, holding, armed, committed, unavailable, bolted or refusing. Hold slabs also set `data-hold-progress` to 0, 25, 50, 75 or 100.
- d1 and d2 slabs are `<button>` elements on web and Pressables on native. They complete on release and work with keyboards and screen readers as they are.
- `HoldSlab` is code-split, so Proof never loads react-aria.

**Hold-to-commit: arm on hold, act on release inside.** WCAG 2.5.2 asks that a long press complete "when the finger is lifted inside that element" ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html)).
- **Arming.** Reaching the hold time arms the slab: a clunk, a plunk, and the label "Release to sign".
- **Acting.** Releasing inside the slab acts.
- **Disarming.** Leaving the slab, blur, `pointercancel`, scrolling or a hidden page disarms it, and nothing is signed.

**Who gets the dialog.** NVDA and JAWS in browse mode swallow Space and Enter and send a synthesized click instead ([NVDA #14084](https://github.com/nvaccess/nvda/issues/14084)). So the route is chosen per event, never by detection:
- A pointer, touch, pen or Space hold drives the slab.
- Enter, a virtual click, or the always-visible "Can't hold? Approve another way" link opens ConfirmDialog. That is a Base UI AlertDialog on web and an M3 dialog on native. It shows the amount, every recipient, and the seal at 96 px with its hash in groups of four.

**Web (`HoldSlab` in ui-web)** uses `usePress` from **`react-aria` 3.53.0** (released 8 Oct). Its source shows that it:
- calls `onPressEnd`, then calls `onPress` synchronously, but only when the release is over the target;
- marks screen-reader and `element.click()` activations as `pointerType 'virtual'`;
- carries the key that was pressed;
- blocks text selection during the press;
- cancels on scroll;
- fires the click that mobile browsers skip after a long press ([source](https://github.com/adobe/react-spectrum/blob/main/packages/react-aria/src/interactions/usePress.ts)).

```tsx
let acted = false;
const { pressProps } = usePress({
  shouldCancelOnPointerExit: true,
  onPressStart: (e) => {
    acted = false;
    if (e.pointerType !== "virtual" && e.key !== "Enter") hold.start();
  },
  onPressEnd: () =>
    queueMicrotask(() => {
      if (!acted) hold.cancel();
    }), // exit or cancel: no onPress follows
  onPress: (e) => {
    acted = true;
    if (e.pointerType === "virtual" || e.key === "Enter") return openConfirm();
    hold.armed() ? onCommit() : hold.cancel();
  },
}); // the signature happens here, on release
// hold.start animates progress 0→1 linearly over `hold` ms, fires quarters, arms at 1; window blur and visibilitychange cancel
```

The web slab also needs:
- CSS `touch-action:none; user-select:none; -webkit-touch-callout:none`;
- a label set to `display:block`, because Android Chrome's long-press gesture fires `pointercancel` over inline text even under `user-select:none` ([dockview](https://github.com/mathuo/dockview/commit/747ead475c67225794c6201eefb564f9165a6940));
- a prevented `contextmenu`.

These rules are unlayered, so they beat react-aria's layered `touch-action` default.

**Native and `/app` (`HoldSlab` in ui-native)** use Gesture Handler 3. Its callbacks are worklets, and a long press cancels when the finger leaves the view ([RNGH](https://docs.swmansion.com/react-native-gesture-handler/docs/gestures/use-long-press-gesture/)). `scheduleOnRN` replaces `runOnJS` ([migration](https://docs.swmansion.com/react-native-reanimated/docs/guides/migration-from-3.x/)).

```tsx
const g = useLongPressGesture({
  minDuration: hold,
  maxDistance: 24,
  onBegin: () => {
    progress.value = withTiming(1, { duration: hold, easing: Easing.linear });
  },
  onActivate: () => {
    travel.value = withTiming(d, tween("press60"));
    scheduleOnRN(arm);
  },
  onDeactivate: (e) => {
    scheduleOnRN(e.canceled ? disarm : actOnRelease);
  }, // native: biometric → Ed25519; web: demo key
  onFinalize: (e) => {
    if (e.canceled) {
      cancelAnimation(progress);
      progress.value = withTiming(0, tween("retract200"));
      travel.value = withSpring(0, spring("rebound"));
    }
  },
});
useAnimatedReaction(
  () => Math.floor(progress.value * 4),
  (q, p) => {
    if (p !== null && q > p && q < 4) {
      travel.value = withTiming(2 * q, tween("press60"));
      scheduleOnRN(feedback.play, "hold.quarter");
    }
  },
);
// <GestureDetector gesture={g} enableContextMenu={false}>
```

- **Web export.** RNGH's web delegate already sets `user-select`, `touch-action` and `-webkit-touch-callout` to none ([GestureDetector](https://docs.swmansion.com/react-native-gesture-handler/docs/gestures/gesture-detector/)).
- **Screen readers.** Only when `Platform.OS !== 'web'` does `AccessibilityInfo.isScreenReaderEnabled()` (plus the `screenReaderChanged` event) swap in a Pressable that opens the dialog. The web export never checks and relies on its visible link.
- **Reduced motion** keeps the hold as a stepped bar with a percentage.

**Tests** (written by WS-QA by 24 Oct)
- On every hold slab, `dispatchEvent('click')` (detail 0) opens the dialog and starts no hold.
- Enter opens the dialog.
- A 1,700 ms mouse hold released outside the slab sends no approval POST and ends `disarmed`.
- A 1,700 ms Space hold sends exactly one POST.
- The Chair frame, driven by real pointer events, reaches `hold-2 → armed-2 → signed-2` and never shows the dialog.

**Seal** (`@fairsplit/seal`). All parameters come from the 32 hash bytes `b`.
- **Bands:** ring i (0–4) sits in band [22,38], [40,56], [58,72], [76,86] or [88,98], in units of size/200.
- **Key ownership:** rings 0–2 belong to key 1; rings 3–4 to key 2.
- **Ring parameters:**
  - Lobes: `N = 10 + b[i] % 11`.
  - Turns: `M = 2 + b[5+i] % 4`, stepped within 2–5 until gcd(N,M) = 1.
  - Pen: `p = (N−M)(0.45 + 0.20·b[15+i]/255)`.
- **Curve:** the hypotrochoid `x=(N−M)cos t + p cos((N−M)t/M)`, `y=(N−M)sin t − p sin((N−M)t/M)`, for t ∈ [0, 2πM], sampled at 40N points.
- **Placement:** the polar radius is remapped linearly into the band, then the ring is rotated by `2π·b[10+i]/256/N`.
- **Output:** each ring returns `{d, length, owner}`. `length` is needed because react-native-svg has no `pathLength` ([#1738](https://github.com/software-mansion/react-native-svg/issues/1738)).
- Unsigned bands draw as 1 px rule circles.

**Why these ranges.** A 22 Oct simulation (1 px stroke, 200 px seal) measured how much of each band the ink covers:

| Ranges | Lobes | Turns | Pen       | Coverage                                                          |
| ------ | ----- | ----- | --------- | ----------------------------------------------------------------- |
| Old    | 12–48 | 2–8   | 0.35–0.85 | 40% median, 66% at the 95th percentile, which reads as grey moiré |
| New    | 10–20 | 2–5   | 0.45–0.65 | 14–36%                                                            |

`seal.density.test.ts` asserts 12–40% coverage per band over 2,000 seeded hashes.

**Stroke and size**
- **Stroke:** `max(1 device px, 0.75·size/200)`.
- **Below 96 px:** a two-ring variant measured at 18–41% coverage at 64 px.
  - Key 1's ring sits in [30,62], using ring 0's bytes.
  - Key 2's ring sits in [70,98], using ring 3's bytes.
  - N is 6–12 and M is 2–3.
- **Print:** five rings at 48 mm, with 0.25 mm strokes for 203 dpi.
- **Push PNG:** ≤40 KB at 512 px.

**A recognizer, not a check.**
- The phone recomputes `batchSha256` from the items it shows.
- The seal and the first 16 hex digits, in groups of four, let a person cross-check against the console.
- Copy: "The seal and hash match the console."

**SplitFan** (MM-6 and the README hero). It is one SVG, `viewBox 0 0 1400 560`, drawn on one linear scale, `k = 400 / totalNetCents` px per cent. Width is money.
- **Source:** the 128 px seal at (96, 280), and a bar at x 188–196, y 80–480, for the run's net total (US$4,218.17).
- **Threads:**
  - stacked at the top of the bar, largest net first;
  - each `max(1, k·cents)` wide: Nang Celing 6.1 px down to Rhea 2.5 px, 34.9 px together;
  - drawn as `M x0 y0 C x0+.45Δx y0, x1−.45Δx y1, x1 y1` to a 20×12 stub at x 1120, y = 30 + 20i, with `pathLength=1`.
- **Cash band:**
  - one hatched ribbon with a 1 px rule edge, running from the rest of the bar (365.1 px, 10.4 times the threads) to x 1100–1120, y 190–555;
  - it ends in 56 slices, each `k·cents` tall, separated by 1 px plate hairlines;
  - labelled once: "56 members, cash at the bodega on 30 Oct: US$3,849.78".
- **Live label:** "On PayPal: {pct} of value ({n} of 64 members)", computed from the cents on each rail. It reads 8.7% (8 of 64) when the batch is sent and 8.1% (7 of 64) after Rhea's re-route, matching Proof.
- **Re-route:**
  - the thread retracts;
  - the band grows by that width on `settle`;
  - a slice "Rhea Jumawan, moved to cash" appends.
- **Attestation:**
  - each OFF_RAIL_PAID turns its slice from hatch to ink;
  - the band label gains "Received: n of 57" with a JD stamp.
- **Never jade.** Data mode shows the same rows as a plain table.

**Other hero components**
- **HoldCard:**
  - Both voices print in pencil (S2.2.1). Claude's line comes after the pencil glyph and the word "Claude", and contains no digits.
  - Evidence shows as paper, followed by the money effect.
  - Gate chip: "Blocks approval. Changes kilos." or "Reserves this line only. Never redistributed."
  - Actions: one d2 slab and at most one flat action.
  - Resolved: flush ink with the stamp and the time.
  - `data-state`: open, resolving, resolved, asked-chair or conflict.
- **ReceiptBar:**
  - Order: kilos × rate (console) or share wording (member) → premium (lock, "walay kaltas") → bonus → RuleChips ("CBU −1.09 R1") → credits → net.
  - Horizontal at ≥360 dp and font scale below 1.3; otherwise a list.
  - Every segment reports its rect for MM-7.
- **DigitSwap:** diffs formatted strings and never shows intermediate values.
- **MassBalanceDial:** a 240° arc over 0–4.0%, with 2.0% at 12 o'clock. Ticks every 0.5%, hatched above 2.0%, pod needle.
- **PaminawaPlayer:**
  - One clip per sentence, from `media/audio/manifest.json`.
  - Reads `mentions` (for example `slip:0403`) from the shared `StatementPlan` type in `contracts`.
  - The current sentence is underlined in 2 px ink; the named chip lifts 8 dp (`settle`) for 1.2 s.
  - "Hinay" calls `setPlaybackRate(0.85)`.
  - Lock-screen controls need `interruptionMode:'doNotMix'` ([expo-audio](https://docs.expo.dev/versions/latest/sdk/audio/)).
- **CropZoom:**
  - Zooms about (px, py) with origin 0,0: `tx = px(1−s)`, `ty = py(1−s)`.
  - Rectangles come from the reviewed fixtures, never from model boxes.
  - On press-in of a slip chip, or on Proof's first wheel event, it fetches `media/tiles/{photo}/{slip}.webp` and crossfades it in at `zoomed`.
  - Tiles are ≤60 KB, cut by WS-MEDIA from the largest master. This is an IC-11 addition.
  - Zoom stops where source pixels run out: `sMax = min(2.4, tileSourcePx / (fieldWidthDp · PixelRatio.get()))`.
- **Wordmark:** "Fair Split" always appears with "co-op payroll", as on the register's title card. Renaming is the user's call.

**Inventory**

| Where          | Components                                                                                                                                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Both platforms | InkStamp, StatusChip, RuleChip, ConfidenceRing, DigitSwap, AmountDisplay, ReceiptBar, HoldCard, Slab, Print, Seal, RailBar, CropZoom, Drawer, ConfirmDialog, Snackbar, OfflineBar, EmptyState, Skeleton, LanguagePicker, Wordmark                                                  |
| ui-web only    | MassBalanceDial, SplitFan, FundingArc, RunStrip, RunPill, RunLog, LogRibbon, SlipViewer, FlightLayer, TwinCompare, ByHandField, SplitGrid renderers, QRPairCard, PhoneFrame, ShortcutSheet, DataModeTable (a plain HTML table), VerifyPanel, PlotField, EvalWaffle, PrintStatement |
| ui-native only | PaminawaPlayer, LineHistory, LicensesScreen                                                                                                                                                                                                                                        |
| Cut            | CommandMenu, ThemePicker                                                                                                                                                                                                                                                           |

**SplitGrid** runs on AG Grid Community 36.2.0. Every parameter below was checked against its type definitions ([parameters](https://www.ag-grid.com/javascript-data-grid/theming-parameters/)).

```ts
export const fsGridTheme = themeQuartz.withParams(
  {
    fontFamily: '"FS Sans",system-ui',
    fontSize: 14,
    dataFontSize: 14,
    headerFontSize: 13,
    headerFontWeight: 560,
    rowHeight: 40,
    headerHeight: 36,
    spacing: 4,
    cellHorizontalPadding: 12,
    wrapperBorderRadius: 0,
    borderRadius: 2,
    backgroundColor: "var(--fs-plate)",
    foregroundColor: "var(--fs-ink)",
    headerBackgroundColor: "var(--fs-plate-2)",
    chromeBackgroundColor: "var(--fs-plate-2)",
    borderColor: "var(--fs-rule)",
    accentColor: "var(--fs-ink)",
    rowHoverColor: "transparent",
    selectedRowBackgroundColor: "var(--fs-plate-2)",
    rangeSelectionBorderColor: "var(--fs-pod)",
    focusShadow: "0 0 0 2px var(--fs-pod)",
    headerCellHoverBackgroundColor: "transparent",
    headerCellBackgroundTransitionDuration: "0s",
    valueChangeValueHighlightBackgroundColor: "var(--fs-flash)",
    browserColorScheme: "dark",
  },
  "fs-tablea",
);
```

- **Grid options:** `animateRows:false`, `cellFlashDuration:150`, `cellFadeDuration:450` ([flashing](https://www.ag-grid.com/javascript-data-grid/change-cell-renderers/)).
- **Flashing:** `enableCellChangeFlash` on Net, Rail and Status only. `cellClassRules` set `--fs-flash` to jade-wash when the cause is `paypal` and to pencil-wash when it is `engine`.
- **Rows:** held rows get a 3 px canary rule on the left. Totals use `pinnedBottomRowData`.
- **Renderers** set `data-amount-state`.
- **Never:** slabs in rows, or jade as the accent.

### S2.8 Motion system

**Spring presets** (`presets.ts`)
- Mass is 1, k = (2π/d)², and c = 4π(1−b)/d.
- A unit test asserts the table below and ζ = 1−b.
- "Settles" is the time to stay within 0.1% of the target; tests use it as their timeout.

| Preset        | d / bounce          | k     | c    | ζ    | Settles | Use                                 |
| ------------- | ------------------- | ----- | ---- | ---- | ------- | ----------------------------------- |
| press (tween) | 90 ms (.23,1,.32,1) | –     | –    | –    | 90 ms   | Slab travel; ratchet steps of 60 ms |
| rebound       | 0.28 / 0.35         | 503.6 | 29.2 | 0.65 | 492 ms  | Release, early release, disarm      |
| land          | 0.32 / 0.30         | 385.5 | 27.5 | 0.70 | 527 ms  | PayPal press, seal, chips           |
| settle        | 0.50 / 0.15         | 157.9 | 21.4 | 0.85 | 707 ms  | Slab rise, layout, the fan band     |
| glide         | 0.45 / 0            | 195.0 | 27.9 | 1.00 | 661 ms  | Sheets, zoom, container transforms  |
| needle        | 0.90 / 0.60         | 48.7  | 5.6  | 0.40 | 2.5 s   | Dial only                           |

```ts
// @fairsplit/motion/web (Motion)
export const spring = (n: SpringName, unit: "px" | "unitless" = "px") =>
  ({
    type: "spring",
    stiffness: K[n],
    damping: C[n],
    mass: 1,
    restDelta: unit === "px" ? 0.1 : 0.001,
    restSpeed: 1,
  }) as const;
// @fairsplit/motion/native (Reanimated 4)
export const spring = (n: SpringName) => ({ stiffness: K[n], damping: C[n], mass: 1 }); // never add duration/dampingRatio
export const tween = (n: TweenName) => ({ duration: MS[n], easing: Easing.bezier(...BEZ[n]) });
```

**Reanimated traps** ([withSpring](https://docs.swmansion.com/react-native-reanimated/docs/animations/withSpring/), [accessibility](https://docs.swmansion.com/react-native-reanimated/docs/guides/accessibility/))
- The default mass is 4, so always pass `mass:1`.
- `duration` or `dampingRatio` override stiffness and damping.
- Under `ReduceMotion.System`, animations jump straight to the end. The 150 ms reduced-motion fades therefore pass `ReduceMotion.Never`.
- `useReducedMotion()` reads once, at launch, so `useMotionPrefs()` also listens for `reduceMotionChanged`.

**Motion pin: `motion@14.0.0`** (released 2 Oct)
- It is the only 14.x release at least 14 days old today. 14.1.0 qualifies at 19:38 UTC on 23 Oct; do not switch after the first install.
- Later releases fix velocity hand-off for hardware-accelerated springs ([changelog](https://github.com/motiondivision/motion/blob/main/CHANGELOG.md)). On 14.0.0, transforms therefore use JS-driven springs, and opacity and colour use tweens.
- The root sets `<MotionConfig reducedMotion="user">`.
- Test builds set `MotionGlobalConfig.skipAnimations = true`.
- Proof loads `LazyMotion` only in the Verify chunk.

**Tweens** (`--fs-dur-*` and `--fs-ease-*`)
- Values are those of Design Direction §3.
- The drawer animates through Base UI's `[data-starting-style]` ([Base UI](https://base-ui.com/react/handbook/animation)).
- Springs also ship as CSS `linear()` easings.

**Mechanisms**
- **`useMoment(id)`** owns each phase machine. It:
  - is typed against `MOMENTS`, so an unknown phase fails to compile;
  - writes `data-moment-phase`;
  - appends `{m, phase, t}` to `window.__fsMoments` (in test builds, or with `?fsTrace=1`);
  - will not start without an event that carries an `eventId`.
- **`FlightScheduler.acquire()`** allows at most 8 concurrent flights.
- **"Gipadala na" ring:** animates for at most 60 s, then shows elapsed time only.
- **Retargeting:** animations target the same value, so velocity carries over. A newer event replaces the target; events never queue.

**Reduced motion is also the low tier**
- **Detection:**
  - web: `prefers-reduced-motion`;
  - iOS: Reduce Motion;
  - Android: "Remove animations", read as `transition_animation_scale == 0` ([RN](https://github.com/facebook/react-native/commit/8b11970adb7d09bc9a4be78cfaee04cb7e084177)).
- **Effect:** the phases stay identical. There is no spatial travel, colour and opacity change over 150 ms, and holds become a stepped bar with a percentage.
- **Low tier:** on native, `Device.totalMemory ≤ 3.3e9` selects the same renderer. There is no third renderer, no web heuristic and no 2 GB gate.
- Sound and haptics stay in every mode.

### S2.9 Magic moments (IC-10)

`packages/motion/moments.ts` is the only source of phase names. S1.9's phase column is generated from it. It freezes on 27 Oct at 18:00. The full and reduced renderers emit the same phases.

```ts
export const MOMENTS = {
  "MM-1": ["pending", "press", "flood", "fill", "label", "invite", "done"],
  "MM-2": [
    "idle",
    "band",
    "lift",
    "flight",
    "resolve",
    "print",
    "ring",
    "landed",
    "by-hand",
    "entered",
    "done",
  ],
  "MM-3": ["closed", "glide-in", "converge", "pairs", "ready", "pressed", "needle", "wave", "resolved"],
  "MM-4": ["idle", "refuse", "plate", "done"],
  "MM-5": [
    "blocked",
    "rising",
    "ready",
    "hold-1",
    "armed-1",
    "confirm-1",
    "signed-1",
    "waiting-2",
    "hold-2",
    "armed-2",
    "confirm-2",
    "signed-2",
    "sealed",
    "inked",
    "released-early",
    "disarmed",
    "declined",
    "expired",
    "mismatch",
  ],
  "MM-6": ["ready", "sent", "landing", "parked", "rerouted", "settled", "denied"],
  "MM-7": ["rest", "framed", "expanded", "zooming", "zoomed", "tiled", "returning"],
  "BEAT-PAID": ["waiting", "arc", "funded"],
} as const;
```

**Phase markers**
- **Web:** `<section data-moment="MM-5" data-moment-phase="…">`.
- **Native:**
  - `testID="moment-MM-5"` plus `dataSet`, which renders as `data-moment-phase` in the web export ([RNW](https://necolas.github.io/react-native-web/docs/view/));
  - a 1×1 `collapsable={false}` marker named `moment-MM-5-phase-<phase>`, for Maestro.

**Priority**
- **Full choreography:** MM-1, MM-2, MM-3, MM-5, MM-6 and BEAT-PAID.
- **MM-4:** its full form is simply the bolted Slab's `refusing` state.
- **MM-7:** built reduced-first. Its zoom ships only if WS-APP is ahead at G4 and the tile cap allows at least 1.6×.

**Who builds what**
- WS-CONSOLE: MM-2, MM-3, MM-4, MM-6, BEAT-PAID, and the console side of MM-5.
- WS-APP: MM-1, MM-7, and the phone side of MM-5.
- Every number lives in `timelines.ts`. Times are in ms from the trigger.

**MM-1 Bayad na (M-MB-01)**
- **Trigger:** SSE `item.updated` taking M-014 to SUCCESS (rank 60). If opened from a push, it plays only if the screen opens within 120 s of the event.
- **Starting state:** the amount is `hollow` (tinted), and the capsule reads "Gipadala na, naghulat sa PayPal 0:14" with a 5 px inset.

| t   | Change                                                         | Motion; sound and haptic                                | Phase                   |
| --- | -------------------------------------------------------------- | ------------------------------------------------------- | ----------------------- |
| 0   | Capsule inset 5 → 0                                            | press                                                   | press                   |
| 90  | A jade view scales 0 → 1 from `transformOrigin:'right bottom'` | 140 ease-out                                            | flood                   |
| 120 | Fill hollow-fill → ink, stroke 2 → 0; state `landed`           | 120 linear                                              | fill                    |
| 180 | –                                                              | Chime; iOS Success ×2 / Android Confirm ×2, 90 ms apart | –                       |
| 400 | Label → "Bayad na, 30 Okt"                                     | crossfade 200                                           | label                   |
| 900 | One 1 px ink ring pulses on Paminawa                           | 400                                                     | invite → done (at 1300) |
- **Reduced motion:** colour and label crossfade over 150 ms.
- **Assertion:** `done` within 3 s of the event.

**MM-2 Paper prints itself (W-TR-03)**
- **Trigger:** each replayed `extract.row`. Row starts are at least 180 ms apart, with at most 8 flights.
- **Live single-slip read:** shows only the band.

| t         | Change                                                                                                   | Motion; sound                       | Phase         |
| --------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------- |
| 0–220     | The band (1 px chalk over a 6% wash) moves to the fixture line                                           | band                                | band          |
| 220–340   | The crop lifts: shadow grows, scale 1 → 1.04                                                             | 120 ease-out                        | lift          |
| 340–940   | The crop (a div with the photo as background, in FlightLayer) flies to its bed                           | flight                              | flight        |
| 640–940   | Handwriting blurs 0 → 2 px while FS Sans digits sharpen from 2 px. Blur applies to those two layers only | linear                              | resolve       |
| 940–1120  | The row prints in `pencil`                                                                               | print; tick, at most one per 120 ms | print         |
| 1120–1360 | The confidence ring draws                                                                                | 240 ease-out                        | ring → landed |
- **Low confidence:** fields below 0.85 print as `you` cells, never hollow.
- **By hand at 0:42:** slip 0462's field goes `you` → `ink` with the AS stamp, on a d2 press with a plunk (`by-hand` → `entered`).
- **Reduced motion:** no flight; a 2 px pencil outline and a 1 px connector show for 600 ms; the band jumps instead of sliding.

**MM-3 The pink copy (W-TR-06 and the dial)**
- **Trigger:** Analyn opens H1.
- **Why no overlay:** photos B and D are separate generations and will not line up pixel for pixel. The evidence is therefore matching fields, not an overlay.

| t        | Change                                                                                                                                                                                      | Motion; sound                  | Phase         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------- |
| 0–450    | Photos B and D glide in                                                                                                                                                                     | glide                          | glide-in      |
| 450–900  | The two 0457 crops converge, stacked on the fixture field grid                                                                                                                              | 450 ease-out                   | converge      |
| 900–1380 | Serial, date, member and net kg light in turn, 120 ms apart. Each gets a canary outline on both cells and a canary connector drawn in 150 ms. Then "4 of 4 fields match. Same slip." prints | 150 each; a tick per pair      | pairs → ready |
| press    | "Count it once" (d2)                                                                                                                                                                        | press; plunk                   | pressed       |
| +60      | Needle 2.05% → 1.62%, overshooting to 1.51%                                                                                                                                                 | needle; tick when crossing 2.0 | needle        |
| +200     | Dioning 80.65 → 62.71 (DigitSwap). 63 rows gain cents 6 ms apart, at most 380 ms in all. "Returned to 63 members: US$17.94." prints                                                         | digit, print                   | wave          |
| end      | The card goes flush ink with the AS stamp                                                                                                                                                   | 120                            | resolved      |
- **Honest count:** the count comes from the DTO's compared fields, so a mismatch would read "3 of 4".
- **Difference blend:** returns only if it passes a G1 test on the real assets.
- **Reduced motion:** 200 ms crossfades; digits change instantly with a 600 ms pencil-wash.

**MM-4 Bolted (W-TR-02)**
- **Trigger:** a press on the bolted "Add to Schedule A".
- **At 0 ms (`refuse`):**
  - no travel;
  - a ±3 px shake in two 70 ms cycles (keyframes 0, +3, −3, 0, +3, −3, 0; linear);
  - a clack, with iOS Error / Android Reject.
- **At max(120 ms, arrival of the 409) (`plate` → `done`):** the 409 is `RATE_CARD_RATIFIED` and cites the hash. The refusal plate prints with its single d1 slab, "Draft a proposal for 2026-B".
- **Reduced motion:** no shake; the steel edges and bolts brighten for 200 ms.

**MM-5 Two keys (W-TR-07 and M-BD-02).** Signatures happen on release (S2.7).

| Trigger or t                                             | Change                                                                                                                                | Motion; sound and haptic                                               | Phase                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------- |
| `hold.resolved` (last BLOCKS_APPROVAL hold)              | Approve slab edges grow 0 → 8 px                                                                                                      | settle                                                                 | rising → ready        |
| Console hold starts                                      | Fill `scaleX` 0 → 1 (on-jade at 14%); the face sinks 2 px at 400, 800 and 1200                                                        | linear 1600; press 60 with a tick at each step                         | hold-1                |
| Release or exit before 1600                              | Face springs up, fill retracts, "Hold until it clicks" shows once                                                                     | rebound / 200                                                          | released-early        |
| 1600                                                     | Face clunks flush; label "Release to sign"                                                                                            | press 60; plunk                                                        | armed-1               |
| Release inside                                           | The browser signs. If the pointer exits, the window blurs or the press is cancelled instead, the face rebounds: "Nothing was signed." | – / rebound                                                            | armed-1 / disarmed    |
| Enter, virtual click, the link, or TalkBack on the phone | ConfirmDialog opens; "Sign" signs (the phone asks for the biometric first)                                                            | drawer                                                                 | confirm-1 / confirm-2 |
| `approval.signed` TREASURER                              | Rings 0–2 engrave on both screens; "1 of 2"; the presence label glides in                                                             | engrave                                                                | signed-1 → waiting-2  |
| Phone hold (1200)                                        | Quarter steps at 300, 600 and 900                                                                                                     | linear; iOS selection / Android Segment_Tick (Clock_Tick below API 34) | hold-2                |
| Phone 1200                                               | Bottom-out; label "Release to sign"                                                                                                   | press 60; plunk; iOS Heavy / Android Long_Press                        | armed-2               |
| Release inside                                           | Native: biometric, then Ed25519. Web export: the labelled demo key                                                                    | –                                                                      | armed-2               |
| `approval.signed` CHAIR                                  | Rings 3–4 engrave on both screens                                                                                                     | engrave                                                                | signed-2              |
| +720                                                     | Seal 1.03 → 1; "Approved by Analyn and Ernesto"                                                                                       | land, 200; low plunk; phone Success / Confirm                          | sealed                |
| +960                                                     | Grid amounts go `pencil` → `ink`                                                                                                      | 240 colour                                                             | inked                 |
- **Mismatch:** a clack, the Error haptic, and the canary message "The batch changed after you opened it. Nothing was signed. Review again."
- **Reduced motion:** a stepped bar with a percentage; edges and rings fade.
- **Assertions:**
  - Both contexts reach `sealed` within 150 ms of each other in CI (target 100 ms).
  - `armed-1` happens at 1600 ± 50 ms.
  - No approval POST happens before a release inside.
  - A tampered hash gives `mismatch` and no POST.

**MM-6 Honest fan-out (W-TR-08)**
- **Trigger:** the 201, then each rank-forward `item.updated`.
- Colour follows the item's actual `transaction_status`.

| Event                                                    | Change                                                                                                                                                                                                            | Motion; sound                                         | Phase    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------- |
| 201                                                      | 8 graphite threads draw 0 → 70%. The cash band is already drawn. Label: "On PayPal: 8.7% of value (8 of 64 members)"                                                                                              | thread                                                | sent     |
| SUCCESS                                                  | Thread runs 70 → 100%, then turns jade. The stub inset closes 3 → 0 with a jade flood, and a latency dot appears. The same event moves the grid row to `landed` and updates the M-014 frame and the Proof counter | 300 + 200, land; next scale note (at most 4 a second) | landing  |
| UNCLAIMED (Rhea) or ONHOLD                               | Thread holds at 70%; a 6 px canary end cap; "Parked"                                                                                                                                                              | print; thud                                           | parked   |
| FAILED, BLOCKED, or an unexpected RETURNED               | A 6 px red end cap                                                                                                                                                                                                | print; thud                                           | parked   |
| "Pay in cash at the bodega" (d2) → our cancel → RETURNED | Thread retracts. The band grows by Rhea's width, a slice "Rhea Jumawan, moved to cash" appends, and the label reads 8.1% (7 of 64)                                                                                | 300, settle; plunk                                    | rerouted |
| Duplicate delivery                                       | One log row: "Delivery repeated, already applied."                                                                                                                                                                | print; silence                                        | –        |
| All items terminal                                       | The run card's summary prints                                                                                                                                                                                     | print                                                 | settled  |
- **Reduced motion:** threads appear at 70%; completion is an instant colour change; no inset press.

**MM-7 Tap a peso (M-MB-01; wheel zoom on W-PF-01)**
- **Reduced form (the default):**
  1. Tapping US$43.69 frames it in 90 ms.
  2. The line expands to "Your 148.0 kg of the co-op's 9,780.6 verified kilos. No deductions." with four slip chips.
  3. Tapping 0403 crossfades (200 ms) to its crop at the largest scale the source allows.
  4. Slips 0419, 0436 and 0467 tile beneath, with "148.0 kg" printed, while the Paminawa sentence plays.
- **Full form, if allowed:**
  - zoom about the tap point to `min(2.4, sMax)` on `glide`, with the statement dimmed to 20%;
  - a Rigid / Segment_Tick haptic two-thirds of the way in;
  - the tile crossfades in at `zoomed`;
  - the other slips tile 60 ms apart.
- **Back gesture:** Back plays the zoom in reverse rather than scrubbing, because RN's `OnBackPressedCallback` fires on completion ([RN #55211](https://github.com/react/react-native/pull/55211)). Gesture progress is **UNVERIFIED** for RN 0.88.
- **Proof wheel:** `s' = clamp(s·e^(−0.0015Δy), 1, sMax)`.

**BEAT-PAID (W-TR-01)**
- **Trigger:** a fresh GET shows PAID or MARKED_AS_PAID.
- **Sequence:**
  1. The arc draws (`arc`).
  2. The pool goes `hollow` → `landed` over 150 ms.
  3. "Funded" closes its 3 px inset to jade flush on `land`, and E4 plays (`funded`).
- **Reduced motion:** colour only.
- H2 and H3 resolve as flush ink stamps, with no moment.

### S2.10 Sound and haptics

`feedback.play(event, { index? })` is the only way UI makes sound or haptics. Native plays only the sounds marked with a star.

| Event                           | Sound                        | iOS                     | Android (fallback below API 30 / 34) |
| ------------------------------- | ---------------------------- | ----------------------- | ------------------------------------ |
| row.printed                     | tick, at most one per 120 ms | –                       | –                                    |
| slip.captured                   | –                            | impact Medium           | Confirm (impact Medium)              |
| slab.d1.press / .release        | –                            | Light / Light           | Virtual_Key / Virtual_Key_Release    |
| slab.d2.commit                  | plunk*                       | Rigid                   | Virtual_Key                          |
| duplicate.found                 | 2 ticks, 90 ms apart         | Rigid ×2                | Clock_Tick ×2                        |
| hold.quarter                    | tick                         | selection               | Segment_Tick (Clock_Tick)            |
| hold.bottom (armed)             | plunk*                       | Heavy                   | Long_Press                           |
| bolted.refuse, seal.mismatch    | clack*                       | notification Error      | Reject (notification Error)          |
| seal.complete                   | low plunk (plunk* on native) | Success                 | Confirm (impact Heavy)               |
| item.paid.member                | chime*                       | Success ×2, 90 ms apart | Confirm ×2                           |
| item.paid.console, invoice.paid | scale[i], root               | –                       | –                                    |
| paypal.failure                  | thud                         | notification Warning    | Reject                               |
| zoom.commit                     | –                            | Rigid                   | Segment_Tick                         |
| webhook.duplicate               | silence                      | –                       | –                                    |

**Haptics constraints**
- Confirm and Reject need API 30; Segment_Tick needs API 34 ([Android](https://developer.android.com/reference/android/view/HapticFeedbackConstants)). The Android 10 target therefore uses the fallbacks.
- `performAndroidHapticsAsync` needs no VIBRATE permission.
- iOS haptics are silent in Low Power Mode ([expo-haptics](https://docs.expo.dev/versions/latest/sdk/haptics/)).

**Recipes**
- `sound/recipes.ts` renders the sounds of Design Direction §4 as 48 kHz mono buffers, using seeded noise.
- Scale notes: E5, F♯5 739.99, G♯5, B5 987.77, C♯6 1108.73, E6 1318.51, F♯6 1479.98 and G♯6 1661.22 Hz. The root is E4 at 329.63 Hz.
- Small-speaker partials are added: the 3rd partial at −14 dB on plunk and thud, and the 2× partial on chime and root. Phone and laptop speakers reproduce little below about 150 Hz.
- **Web:** renders the sounds on first enable. The `AudioContext` is created inside the toggle's click handler, and output has a −1 dBFS ceiling.
- **Native:** ships three committed 16-bit WAVs (chime, plunk, clack), written once by `assets/sfx/build.ts`. There are no parity tests.

**Policies**
- **Web:**
  - Sound is off by default, behind a visible toggle in the stage bar and the console header.
  - The choice is remembered in `localStorage['fs.sound']`, inside try/catch. Sound never autoplays.
  - Phone frames post `{v:1, type:'fs-feedback', event, index?}` to the parent. The parent plays it only if `e.origin === location.origin` and `e.source` is one of its own frames. This message is proposed for IC-12 FrameBridge, together with `?motion=full|reduced` for tests.
- **Native:**
  - Sound is on, with `setAudioModeAsync({playsInSilentMode:false, interruptionMode:'mixWithOthers'})`.
  - While Paminawa plays, the mode switches to `{playsInSilentMode:true, interruptionMode:'doNotMix', shouldPlayInBackground:true}`, and product sound is ducked.
- **Always:**
  - No product sound under narration.
  - No haptics promised on the web.
  - HapticTrace (P2) appears only under `EXPO_PUBLIC_FS_HAPTIC_TRACE=1`, labelled "shown for video".

### S2.11 Performance budgets

| Surface             | Budget                                                                                                                                                                          | Measured by                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proof W-PF-01       | LCP ≤1.8 s; initial JS ≤110 KB gz; Verify chunk ≤45 KB, lazy; fonts ≤80 KB (66 + 2 + 4); CLS ≤0.05; INP ≤150 ms                                                                 | Every PR: Playwright under CDP Fast 4G ([DevTools](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/core/sdk/NetworkManager.ts)) and 4× CPU throttling |
| Console             | Route JS ≤300 KB gz; AG Grid chunk lazy, ≤300 KB; fonts ≤170 KB (108 + 4 + 2 + 4, with Atkinson's 48 lazy); J/K ≤50 ms; moments at 60 fps with ≤4 ms main-thread work per frame | Bundle script; no Long Animation Frame over 50 ms during moments                                                                                                              |
| Stage W-JG-01       | Interactive ≤2.5 s; frames after idle ≤6 s; `/app` fonts ≤300 KB; median first press → POST ≤60 s                                                                               | Playwright (G2)                                                                                                                                                               |
| Android, film phone | Cold start ≤2.5 s (release, R8); moments p95 ≥55 fps; APK ≤35 MB per ABI; JS ≤3 MB; RAM ≤180 MB; audio ≤200 KB per statement                                                    | `am start -W`; `dumpsys gfxinfo <pkg> reset`, the Maestro flow, then a p95 frame ≤18.2 ms (G3)                                                                                |
| Assets              | Crops ≤40 KB (90 KB in the app); tiles ≤60 KB; WAVs ≤30 KB; seal ≤5 paths of ≤800 points                                                                                        | Scripts and unit tests                                                                                                                                                        |

### S2.12 Verifying visual quality

**Until G5: functional checks only**
- The token gate.
- Seal determinism and density.
- Font names and licences.
- Amount-state renders.
- The hold tests.
- Phase assertions for every moment, in full and reduced modes:
  - read from `data-moment-phase` and `__fsMoments` under Playwright's `page.clock` ([clock](https://playwright.dev/docs/clock));
  - and from Maestro 2.11 flows that wait on the phase markers.
- Reduced-motion runs follow `adb shell settings put global transition_animation_scale 0`, plus the window and animator scales.
- Runs at font scale 1.3 and 2.0 save screenshots for people to read.

**`/prototype`**
- Every primitive × state × `motion=full|reduced`.
- The token sheet.
- Static compositions on seed data: W-JG-01, W-TR-05, W-TR-06 (with H1), W-TR-07 (ready, and with key 1 signed), M-MB-01 (sent, and paid) and W-PF-01.
- Moment poses from `poseAt(moment, t)`, so `/prototype/moments/MM-5?t=1600` renders any frame.
- `/prototype/seal-sheet`: 300 seeded hashes at 64, 200 and 320 px, plus a 1-bit 203-dpi render at 48 mm.

**G1 critique (26 Oct, done by 14:00).** A fresh claude-opus-5-5 subagent gets only `prototype/critique/RUBRIC.md` and these captures:
- the hero path at 1470×956 (the MacBook Air default) and at 1920×1080;
- phone frames at 360×800 and 390×844;
- three frames per moment, taken from a 1080p H.264 re-encode at 8 Mb/s.

Each screen passes or fails on six tests:
1. **Squint:** under a 12 px blur, the focal element is the single highest-contrast region.
2. **First view:** from the still alone, the subagent can say what this is, what to do next, and what is real money.
3. **Template:** anything a stock shadcn/Tailwind template would produce is replaced or justified. That includes shadowed rounded cards, icons in circles, a centred hero over three cards, eyebrows, gradients and pill badges.
4. **Video:** hatch, 13 px captions and 1 px rules survive the re-encode without banding.
5. **Grammar:** every `data-amount-state` matches S2.2.1, and jade appears only where money is raised or landed.
6. **Signature:** at least one of the seven signatures is on screen.

Failures are fixed before sign-off. Results go to `critique/2026-10-26.md`.

**G1, the user (about 45 minutes)**
- Sign off the token sheet, the primitives, and the MM-5 and MM-1 studies, with the critique open.
- Flag any ugly draws on the seal sheet.
- Show M-MB-01 (sent, and paid) on the film phone, outdoors, to three readers over 55. Each reads the amount aloud and says whether it has arrived. Two wrong answers trigger the hollow fallback.

**After G5: pixel baselines**
- `toHaveScreenshot` with `animations:'disabled'`, `caret:'hide'`, masks over clocks and IDs, and `maxDiffPixelRatio:0.001`.
- One Chromium project at 1470×956, covering the gallery and the hero-path rest states.
- Baselines come only from `mcr.microsoft.com/playwright:v1.64.1-noble` in CI ([snapshots](https://playwright.dev/docs/test-snapshots)).

**Devices**

| Device                                                    | Used for                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| The film phone                                            | G3, scrcpy recordings, haptics                                                        |
| Any 2–3 GB Android, if one is available                   | One reduced-tier run (no gate)                                                        |
| A borrowed iPhone in Safari, or a real-device cloud trial | One QR co-sign through `signed-2` plus a VoiceOver smoke; about 15 minutes, before G4 |
| AVD API 34 / AVD API 36 with Google Play                  | Maestro / push and scanner                                                            |
| The dev laptop with Chrome, Firefox and NVDA              | The NVDA pass, about 30 minutes, at G5                                                |
| Playwright WebKit and Firefox                             | Proof smoke tests                                                                     |
| EAS iOS simulator                                         | The P2 clip                                                                           |

**Accessibility claim**
- Say "Designed to WCAG 2.2 AA; axe on every `/prototype` state; NVDA and TalkBack passes on 6 Nov". Never say "meets".
- The README lists the known gaps:
  - moments are hidden from assistive technology and mirrored in Data mode;
  - holds rely on the dialog route for screen-reader users;
  - Cebuano and Filipino strings are machine-translated, pending review.

### S2.13 Schedule

| Date          | Deliverable                                                                |
| ------------- | -------------------------------------------------------------------------- |
| 22 Oct        | `source.ts`, contrast test, fonts pinned                                   |
| 23 Oct        | Tokens; Slab with hold semantics and tests; Print; AmountDisplay           |
| 24 Oct (G0)   | The G0 set                                                                 |
| 25 Oct        | `/prototype`, seal sheet, ReceiptBar, HoldCard, SplitFan                   |
| 26 Oct (G1)   | Critique by 14:00; sign-off by 18:00                                       |
| 27 Oct, 18:00 | `moments.ts` and `timelines.ts` frozen                                     |
| 1 Nov (G3)    | Film-phone performance gate                                                |
| 4 Nov (G4)    | Moments asserted; iPhone run; MM-7 full or reduced decided                 |
| 6 Nov (G5)    | Freeze; NVDA, TalkBack, 200% text and axe passes; pixel baselines recorded |

### Open checks (UNVERIFIED)

| Check                                                                                       | Settled at       |
| ------------------------------------------------------------------------------------------- | ---------------- |
| RN transform-array order for the slab edges                                                 | G1               |
| Upstream statics: merged contours, and file names equal to PostScript names                 | G0               |
| react-native-svg `fontFeatureSettings` on iOS                                               | P2               |
| The system-font ₱ on the film phone                                                         | G1               |
| The largest Codex master for slip 0403, which sets MM-7's zoom cap                          | WS-MEDIA, 29 Oct |
| Native sound latency ≤80 ms after the haptic, and a clean audio-mode switch around Paminawa | G1               |
| Safari composing the `unicode-range` ₱ face with `font-stretch`                             | G4               |
| Back-gesture progress in RN 0.88                                                            | S7               |

### Register deviations

1. **Truncated register.** My copy starts at the end of §5's MM-2 row. W-TR numbers follow the C1–C10 order (W-TR-02 = C2 … W-TR-08 = C8). Placement of MM-1 and MM-2 follows the Design Direction.
2. **Moments.**
   - MM-1 arrives over SSE (IC-08), not a WebSocket.
   - MM-6 colour follows the actual status, so Rhea's UNCLAIMED is a canary "Parked", not red.
   - MM-2 row starts are at least 180 ms apart; otherwise 48 rows would take about 54 s.
   - The INVOICE.PAID beat gets the phase ID `BEAT-PAID`.
   - MM-5 adds `armed-1/2`, `confirm-1/2` and `disarmed`, and signs on release.
   - MM-3's `underline` phase becomes `pairs`.
3. **Colour and grammar.**
   - ink-3 and hatch change in both themes.
   - pencil-faint, canary-border and hollow-fill are new.
   - Hollow means money in flight only.
   - Low-confidence fields are You cells, not hollow.
   - Engine lines are pencil.
   - Member hollow is tinted.
4. **Type.**
   - ₱ comes from a Noto subset on web and a system-font span on native. S8's fallback applies now.
   - ss08 is the slashed zero.
   - Native and `/app` use unmodified upstream statics. Only the Mona-derived web subsets are renamed "FS Sans".
5. **SplitFan.** One linear-width cash band replaces 56 dashed lines and √ widths.
6. **Scope.**
   - Bespoke motion appears only on the hero path.
   - W-TR-10's command menu and theme switch are cut, as is M-ON-01's theme picker, so phones are Adlaw only.
   - Data mode is plain tables.
   - MM-7 is built reduced-first.
7. **G3.** The reduced renderer doubles as the low tier, and the fps gate runs on the film phone, not on S7's 2 GB device.
8. **Dependencies and sound.**
   - `react-aria` 3.53.0 joins ui-web; it is not on the Add list.
   - The seal PNG uses the pinned sharp, not resvg.
   - Motion is pinned to `motion@14.0.0` under the 14-day rule.
   - Native ships three WAVs, and the low sounds gain partials.

### Review resolutions

1. **Blocker, hold keyed to screen-reader detection:** fixed in S2.7.
   - Routing is per event, on react-aria `usePress`, with touch-safe CSS.
   - No screen-reader detection on the web; `AccessibilityInfo` is native-only.
   - The slab signs on release.
   - Five tests, plus a real-iPhone co-sign before G4.
   - Locked into Slab for G0.
2. **SplitFan inverts the money:** fixed in S2.7.
   - One linear scale; the hatched cash band is 10.4× the threads.
   - A live "On PayPal" share, going from 8.7% to 8.1%.
   - Ink and JD stamps on attestation; never jade.
3. **Polish spread too thin (ALL):** applied in S2.
   - The hero path is named, and bespoke motion appears only there.
   - The G1 critique rubric is written down.
   - CommandMenu and ThemePicker are cut.
   - The W-PF-02 and M-CK-02 cuts belong to S1.
4. **Colliding grammar:** fixed in S2.2.1.
   - One table, `AMOUNT_STATE`, `data-amount-state`, and tests.
   - MM-2 and W-TR-03 use You cells.
   - S1.1 should change to "sent amounts stay hollow".
5. **Member legibility:** fixed.
   - Tinted hollow at ≥4.82:1.
   - One native SVG text sized from `getFontScale()`.
   - Share wording instead of per-kg rates.
   - A readers-over-55 check with a fallback.
6. **Image-quality reveals:** fixed.
   - MM-3 shows matching field pairs; the blend is gated on G1.
   - MM-7 and Proof fetch tiles and cap zoom at source resolution. An IC-11 addition is requested.
7. **Seal and NeoPOP:** fixed.
   - Ranges are set from a coverage simulation, with a density test.
   - Minimum 1-device-px stroke, a two-ring variant below 96 px, and a print size.
   - A contact sheet at G1, recognizer copy, and the NeoPOP credit.
8. **Capacity (ALL):** applied in S2.
   - G0 is trimmed and the lane-fold note added.
   - Added human time is named: about 1.5 h.
   - Lanes, usage and merge queue belong to S5.
9. **Contracts disagree (ALL):** applied in S2.
   - MOMENTS is canonical and typed into `useMoment`.
   - DTOs carry cents, formatted by api-client.
   - PaminawaPlayer reads `StatementPlan.mentions`.
   - Frame messages are proposed for IC-12.
   - The member link and the treasurer key belong to S3.
10. **WS-DS overload:** mostly accepted.
    - Accepted: upstream fonts on native; Web Audio plus three WAVs; reduced motion as the low tier; MM-4 through the primitive; MM-7 reduced-first; pixel baselines after G5 in one Chromium project.
    - Kept: three small renamed web subsets, because the smallest unmodified file is 308 KB; and the one-line memory check, because expo-device is on the register's Add list.
11. **Differentiation (ALL):** not in S2; no component carries prior-art copy.
12. **Name reads as bill splitting (ALL, minor):** the Wordmark always carries "co-op payroll"; renaming is the user's call.
13. **Licence name records (minor):** fixed.
    - Subsetting runs with `--name-IDs='*'`.
    - A name test runs in CI.
    - Licences are served and bundled; the root LICENSE stays MIT.
14. **2.5.2, captions and WCAG claim (minor):**
    - Sign-on-release is fixed.
    - Captions belong to WS-MEDIA.
    - The claim is reworded and the known gaps are listed (S2.12).
