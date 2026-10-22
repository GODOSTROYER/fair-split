## S2. Design System, Motion, Sound and Haptics

**Owner:** WS-DS (`packages/{tokens,motion,seal,ui-web,ui-native,i18n}`, `assets/**`, `apps/console/src/prototype/**`).
**Consumers:** WS-CONSOLE (W-JG-01, W-TR-01…10, W-PF-01), WS-APP (M-MB-_, M-BD-_), WS-QA (gates), WS-MEDIA (capture).

This section turns IC-09, IC-10 and the Design Direction into something buildable. Facts were checked on 22 Oct 2026. Anything not checked is marked **UNVERIFIED**.

### S2.0 Rules

1. **Machines print, people press, PayPal lands.**
   - Claude and engine output: flat print, tweens, no depth, no button.
   - A human commit: a slab and a spring.
   - A PayPal-confirmed state: jade flush, using the `land` spring.
2. **Motion is evidence.**
   - A state animation starts only on one of three triggers: an SSE `RunEvent`, an HTTP response (201 or 409), or an accepted signature.
   - Press feedback is local and instant. The state change it causes waits for its event.
3. **Never show a raw state.** `StatusChip` renders the `contracts` label maps, which hold the register's status words.
4. **Test hooks.** Every stateful element has `data-testid` and `data-state`. Every moment root has `data-moment` and `data-moment-phase`.
5. **Rendering.** SVG, CSS transforms and opacity, and Reanimated only. The packages register §6 removes stay removed: no Skia, Lottie, blur, glass, NumberFlow or lucide.
6. **Restraint.**
   - One focal motion per screen.
   - Actions used 20 or more times a session get 0 ms.
   - Exits run 20% faster than entrances.
   - No ease-in, count-ups, confetti or ambient loops.
7. **Timings come only from `@fairsplit/motion`.** WS-QA's lint step fails any numeric literal inside `transition=`, `animate(`, `withTiming(` or `withSpring(` in `apps/**`.

### S2.1 Packages and how tokens are shared

**Packages**
- **`@fairsplit/motion`**
  - Pure data: `presets.ts`, `timelines.ts`, `moments.ts`, `feedback-map.ts` and `sound/recipes.ts`.
  - Subpath `/web`: Motion and Web Audio.
  - Subpath `/native`: Reanimated, expo-audio and expo-haptics.
- **`@fairsplit/tokens`**
  - `src/source.ts` is the only hand-edited file.
  - `pnpm --filter @fairsplit/tokens build` writes `src/generated/`, which is committed, and the build reads `@fairsplit/motion/presets` for its motion variables.
  - CI rebuilds and fails on `git diff --exit-code`. Vite and Metro therefore never depend on build order.
- **`@fairsplit/seal`:** pure TS `seal(batchSha256, size)`, used by ui-* and by apps/api for push PNGs.
- **`@fairsplit/ui-web` and `@fairsplit/ui-native`:** identical prop types. ui-native also renders inside the Expo web export at `/app`.

| Generated file                 | Purpose                                                                                                                                                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens.css`                   | `:root,[data-theme="tablea"]{--fs-*}`, `[data-theme="adlaw"]{…}`, the motion variables, and a `prefers-reduced-motion` block                                                                                                                                                            |
| `fonts.css`, `fonts-proof.css` | `@font-face` rules (S2.3)                                                                                                                                                                                                                                                               |
| `tailwind.css`                 | `@theme{--*:initial;--spacing:.25rem;--breakpoint-md:48rem;--breakpoint-lg:80rem;--breakpoint-xl:120rem}`. Resetting every namespace removes the colour, font, shadow and radius utilities, so Tailwind is layout-only by construction ([Tailwind](https://tailwindcss.com/docs/theme)) |
| `tokens.native.ts`             | `tablea` and `adlaw` objects (hex, numbers, font names) for `FsThemeProvider` and `useFs()`                                                                                                                                                                                             |
| `ag-grid.ts`                   | `fsGridTheme`, under the subpath `@fairsplit/tokens/ag-grid`. Only the console imports it, so Metro never sees AG Grid                                                                                                                                                                  |
| `m3.ts`                        | Material 3 roles, listed below                                                                                                                                                                                                                                                          |
| `glyphs.ts`                    | Icon path data                                                                                                                                                                                                                                                                          |
| `contrast.json`                | Every declared colour pair with its ratio, shown on `/prototype/tokens`                                                                                                                                                                                                                 |

`m3.ts` maps the Material 3 roles as follows. Jade and canary have no role.

| M3 role              | Token   |
| -------------------- | ------- |
| primary              | ink     |
| onPrimary            | plate   |
| surface              | ground  |
| surfaceContainer     | plate   |
| surfaceContainerHigh | plate-2 |
| onSurfaceVariant     | ink-2   |
| outline              | rule    |
| secondaryContainer   | plate-2 |
| error                | red     |

**Themes**
- The console sets `<html data-theme="tablea">`.
- Proof hard-codes `adlaw`.
- Stage frames receive `?theme=&tier=`.
- `data-ag-theme-mode` mirrors the theme as `fs-tablea` or `fs-adlaw`.
- A theme switch runs inside `withoutTransitions()`: inject `*{transition:none!important}`, force a reflow, and remove the rule on the next frame.
- Native defaults to Adlaw. First run (A0) offers Tablea.

### S2.2 Colour

The Design Direction's palette stands. Running its own contrast rule (WCAG 2.x, over every surface each token can sit on) forced these corrections:
- **ink-3**
  - Tablea #8C8075 → **#9C9085**. The old value was 4.18:1 on plate and 3.76:1 on plate-2; the new one is ≥4.65:1.
  - Adlaw #776D65 → **#6F665E**. The old value was 4.34:1 on ground; the new one is ≥4.83:1.
- **hatch**
  - Tablea → **#624E41**; Adlaw → **#B7B0A7**.
  - The old values fell to 1.72:1 and 1.70:1 on one surface each; the new ones are ≥1.85:1 on all.
- **pencil-faint** (new)
  - It replaces "pencil at 60%", which measures 3.58:1.
  - It is an opaque mix of pencil over plate: 80% in Tablea (**#909498**) and 90% in Adlaw (**#5E6871**). Both are ≥4.74:1 on every surface.
- **canary-border** (new, Adlaw #7F6200)
  - A canary face on white is only 1.41:1, so canary faces get a 1 px border, as jade flush already does.

| `--fs-` token                                              | Tablea                               | Adlaw                                   |
| ---------------------------------------------------------- | ------------------------------------ | --------------------------------------- |
| ground, plate, plate-2, rule                               | #201712 #2A1F18 #33271F #4A392D      | #EEEEEA #FFFFFF #F6F6F3 #D8D4CD         |
| ink, ink-2, ink-3                                          | #F4EDE4 #BDB1A4 #9C9085              | #1C1511 #4E453E #6F665E                 |
| pencil, pencil-faint                                       | #A9B1B8 #909498                      | #4C5761 #5E6871                         |
| jade, on-jade, jade-text, jade-flush-border                | #2FD3A0 #201712 #2FD3A0 –            | #2FD3A0 #1C1511 #0A7553 #0F6F53         |
| canary, on-canary, canary-text, canary-wash, canary-border | #F2DA4E #201712 #F2DA4E mix 12% –    | #F2DA4E #1C1511 #7F6200 #FFF3BF #7F6200 |
| red, red-face, on-red-face, red-wash                       | #FF5A47 #D63A2C #FFFFFF mix 14%      | #BF2A1C #BF2A1C #FFFFFF #FCE6E3         |
| pod; hatch; steel-line, steel-face                         | #FF8A2A; #624E41; #7C8288 #3B3F43    | #C85A00; #B7B0A7; #8A9096 #D5D8DB       |
| copy-white/pink/yellow; scrim                              | #FFFFFF #F4C9D4 #F5E27A; #100B08@64% | same; #1C1511@40%                       |
| jade-wash, pencil-wash (grid flash)                        | mix 18%, 12%                         | mix 16%, 10%                            |

**"mix n%"** means: blend the token over `plate` in sRGB, round each channel, and emit opaque hex. AG Grid needs opaque backgrounds ([AG Grid](https://www.ag-grid.com/javascript-data-grid/theming-colors/)).

**Roles follow the design**
- **Jade:** raised means "this will move money"; flush means "PayPal confirmed it".
- **Canary:** a person must decide.
- **Red:**
  - the PayPal statuses DENIED, FAILED and BLOCKED;
  - an unexpected RETURNED;
  - ERRPYO codes;
  - the Proof hash failure.
- **Pod:** the focus ring and the needle only.

**Placement rules**
- Member-facing text is always ink or ink-2. Statement copy then measures 7.64:1 (Tablea) and 9.36:1 (Adlaw).
- On member surfaces, hues appear only as faces, washes, rules, glyphs and edges.
- No PayPal blues or #FFC439, no drawn logo, no purple, no gradients, no glows.

**CI gate:** `packages/tokens/test/contrast.test.ts` checks these minimums.

| Pairs                                                                                                                                    | Minimum |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Console text: ink, ink-2, ink-3, pencil, pencil-faint, jade-text, canary-text and red, each on ground, plate and plate-2, in both themes | 4.5:1   |
| Statement copy: ink and ink-2 on plate                                                                                                   | 7.0:1   |
| Faces: on-jade/jade, on-canary/canary, on-red-face/red-face, slab labels                                                                 | 4.5:1   |
| Non-text: pod on every surface; the flush and canary borders against plate                                                               | 3.0:1   |
| Hatch on every surface                                                                                                                   | 1.8:1   |

### S2.3 Typography

**Verified on 22 Oct** by reading the upstream font files with fontTools:
- **Mona Sans** (both the 2.027 variable font and the Google Fonts 2.001 `[wdth,wght]` build):
  - It has **no ₱ (U+20B1)**.
  - It has `tnum` and `ss01–ss10`, but **no `zero` feature**. Its distinct zero is **ss08**, "tabular zero with straight bar" ([Mona Sans](https://github.com/github/mona-sans)).
  - So use `font-feature-settings:"tnum" 1,"ss08" 1`. The `slashed-zero` keyword does nothing.
- **Atkinson Hyperlegible Next 2.001** (`wght 200–800`): has `tnum`, **no ₱**.
- **Noto Sans VF** (`wght 100–900, wdth 62.5–100`): has ₱. A ₱-only WOFF2 is 2,080 B.

Spike S8 has therefore already failed on ₱, and the register's fallback applies now. The Noto ₱ joins the "FS Sans" family through `unicode-range`, so no component changes.

**Licences**
- Mona Sans reserves the names "Mona" and "Mona Sans", and OFL-FAQ 2.6 treats subsetting as modification ([OFL-FAQ](https://openfontlicense.org/ofl-faq/)). Every Mona-derived file is therefore named **FS Sans**.
- Atkinson, Big Shoulders and Noto reserve no names.
- Commit each OFL.txt. Files carrying the grafted ₱ list both copyrights.

**Build:** `assets/fonts/build/cut_fonts.py`
- Tools: fonttools 4.66.1, brotli 1.2.0 and skia-pathops 0.9.2.
- Sources are pinned by SHA in `fonts.lock.json`, and the outputs are committed.
- Sizes below were measured on 22 Oct by subsetting in memory.

| File                     | Recipe                                                                                                                                                                                                                                         | Size   | Use                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------- |
| `FSSans-VF.woff2`        | GF Mona Sans 2.001 `[wdth,wght]`. Basic Latin, Latin-1, Latin Extended-A and typographic punctuation. Features kern, tnum, ss08, case, locl, ccmp, mark, mkmk                                                                                  | 108 KB | Console, stage               |
| `FSSans-Proof.woff2`     | Latin-1 only; axes limited to wdth 75–100 and wght 400–800                                                                                                                                                                                     | 66 KB  | Proof                        |
| `FSSansPeso.woff2`       | Noto, U+20B1 only, declared as "FS Sans" with `unicode-range:U+20B1;font-weight:200 900;font-stretch:62.5% 100%`                                                                                                                               | 2 KB   | Web                          |
| `FSNumeralsHollow.woff2` | Static instance at 75/800 via `instancer --remove-overlaps`; tnum and ss08 frozen in; glyphs `0-9 $ ₱ . , − U S`                                                                                                                               | 4 KB   | Hollow amounts               |
| `FSStencil.woff2`        | Big Shoulders Stencil 800 at opsz 72; glyphs `0-9 A-Z -`                                                                                                                                                                                       | 4 KB   | Season and lot marks         |
| `AtkinsonNext-VF.woff2`  | Latin-1 and Latin Extended-A; wght 400–700                                                                                                                                                                                                     | 37 KB  | Lazy-loaded for C9 and print |
| Native TTFs              | Static instances with overlaps removed. tnum and ss08 are frozen into the cmap (a 30-line remap of those single substitutions). The Noto ₱ is grafted in and scaled by cap height (729/714). File name = PostScript name = name IDs 1, 4 and 6 | –      | expo-font plugin             |

**Why a separate hollow cut.** Variable fonts keep their overlapping contours, and a text stroke draws those overlaps as lines inside the glyphs. Static instances should merge contours instead ([fontTools #1518](https://github.com/fonttools/fonttools/pull/1518)).

**Why the file and font names match.** The expo-font plugin takes the family name from the file name on Android and from the font itself on iOS ([Expo fonts](https://docs.expo.dev/develop/user-interface/fonts/)).

**CSS families**
- `--fs-font-ui:"FS Sans",system-ui,sans-serif`
- `--fs-font-statement:"Atkinson Hyperlegible Next","FS Sans",sans-serif`
- `--fs-font-mark:"FS Stencil"`
- Main face: `@font-face{font-family:"FS Sans";src:url(./fonts/FSSans-VF.woff2) format("woff2");font-weight:200 900;font-stretch:75% 125%;font-display:swap}`

**Native cuts.** SDK 58's `fontVariationSettings` is deliberately unused.

| Cut                              | Width / weight | Roles                 |
| -------------------------------- | -------------- | --------------------- |
| `FSSans-CondXBold`               | 75 / 800       | amount-hero, amount-l |
| `FSSans-SemiCondMedium`          | 87.5 / 500     | figure, hash          |
| `FSSans-Regular`                 | 100 / 400      | body, caption, label  |
| `FSSans-SemiExpBold`             | 112.5 / 700    | slab, titles, stamp   |
| `AtkinsonNext-Regular` / `-Bold` | –              | statements            |

| Web role                       | Stretch / weight                    | Size / line                                                   |
| ------------------------------ | ----------------------------------- | ------------------------------------------------------------- |
| amount-hero                    | 75% / 800                           | 72/72; in the app 48/52 sp with `maxFontSizeMultiplier={1.5}` |
| amount-l                       | 75% / 760                           | 32/36                                                         |
| title-1, title-2               | 100% / 660, 600                     | 28/34, 20/26                                                  |
| body, figure, label, caption   | 100/450, 87.5/500, 100/560, 100/450 | 14/20, 14/20, 13/16, 12/16                                    |
| hash                           | 75% / 520, in groups of four        | 13/16                                                         |
| slab                           | 112.5% / 700 (Proof clamps to 100%) | 17/20                                                         |
| statement-lead, statement-body | Atkinson 400; 400 and 700           | 22/30 sp; 19/28 sp, never below 18                            |
| mark                           | FS Stencil 800                      | 20/20; 40/40 on Proof                                         |

**Money**
- Money is always set in FS Sans with tnum and ss08, including inside Atkinson prose.
- Hollow amounts on web use "FS Numerals Hollow" with `color:transparent;-webkit-text-stroke:1.25px var(--fs-ink)`.
- On native, a hollow amount is a react-native-svg `<Text fill="none" stroke strokeWidth={1.25}>` layered over a transparent RN `<Text>`. The RN text carries the layout and the accessibility label.

### S2.4 Space, layout, radii, depth, layers

**Space scale:** `2 4 8 12 16 24 32 48 64 96`.

**Layout**

| Surface | Values                                                                                        |
| ------- | --------------------------------------------------------------------------------------------- |
| Console | 12 columns with 24 px gutters; rail 220; drawer 560; Approve column 640; rows 40; headers 36  |
| App     | 16 dp gutters; 8 dp rhythm; targets ≥48 dp; primary actions 56 dp; Paminawa and Pirmahi 64 dp |
| Proof   | 680 px column; at most 72 characters per line; 16 px gutters on phones                        |

**Radii**
- 0: slabs, tiles, evidence, the statement card.
- 2: plates, chips, inputs.
- Native dialogs, sheets and snackbars keep their M3 shapes.

**Depth and shadows**
- Depth comes from value steps. Slab edges are 3 px (d1), 5 px (d2) and 8 px (d3).
- Only evidence casts a shadow (`--fs-shadow-paper`):
  - Tablea: `0 1px 1px rgb(0 0 0/.35),0 12px 28px -10px rgb(0 0 0/.55)`
  - Adlaw: `0 1px 1px rgb(28 21 17/.10),0 10px 24px -10px rgb(28 21 17/.22)`
- Native passes the same string to RN `boxShadow`, which requires the New Architecture ([RN](https://reactnative.dev/docs/view-style-props)).

**Layers (z-index)**

| Layer        | z   |
| ------------ | --- |
| Sticky       | 10  |
| Dock         | 20  |
| Scrim        | 29  |
| Drawer       | 30  |
| Popover      | 40  |
| Snackbar     | 50  |
| Dialog       | 60  |
| Flight layer | 70  |

### S2.5 Materials (no glass)

**Slab geometry.** All slab motion is transform-only.
- The face travels `t ∈ [0,d]` as `translate(t,t)`.
- Right edge: box `[W,W+d]×[0,H]`, origin top-left, transform `translate(t,t) skewY(45deg) scaleX((d−t)/d)`.
- Bottom edge: box `[0,W]×[H,H+d]`, transform `translate(t,t) skewX(45deg) scaleY((d−t)/d)`.
- Each edge stays anchored to its far wall and collapses exactly at `t=d`.

```tsx
// ui-web — build the strings ourselves: Motion's own transform order (translate→scale→skew) is wrong here
const t = useMotionValue(0);
const edgeR = useTransform(t, (v) => `translate(${v}px,${v}px) skewY(45deg) scaleX(${1 - v / d})`);
const edgeB = useTransform(t, (v) => `translate(${v}px,${v}px) skewX(45deg) scaleY(${1 - v / d})`);
// press: animate(t, d, tween('press'))   release: animate(t, 0, spring('rebound'))
```

**Native slab:** `[{translateX:t},{translateY:t},{skewY:'45deg'},{scaleX:(d−t)/d}]` with `transformOrigin:'left top'`. RN documents skew and origin but not the order in which the array is applied ([RN](https://reactnative.dev/docs/transforms)). The G1 gallery therefore screenshots t = 0, 50% and 100%. This stays **UNVERIFIED** until then.

**Faces, edges and labels**

| Tone                    | Face    | Right edge | Bottom edge | Label   |
| ----------------------- | ------- | ---------- | ----------- | ------- |
| chalk (Tablea)          | #F4EDE4 | #B9AFA4    | #8A8178     | #201712 |
| chalk (Adlaw, ink face) | #1C1511 | #4A3F38    | #2B2420     | #FFFFFF |
| jade                    | #2FD3A0 | #1F9E78    | #12704F     | on-jade |

**Slab details**
- **Inner top highlight:** 1 px of `rgb(255 255 255/.18)`.
- **Focus:** a 2 px pod ring at a 2 px offset, drawn on the face.
- **Unavailable:**
  - The slab sits flush (`t=d`) with a hatched face and an ink-2 label.
  - A focusable reason link sits beneath it.
  - Never greyed out.
- **Reduced motion:** no travel. The colour shifts and the edges fade over 120 ms.

**Other materials**
- **Bolted:**
  - Zero travel and a plate-2 face.
  - Edges filled with `repeating-linear-gradient(-45deg,var(--fs-steel-line) 0 1.5px,var(--fs-steel-face) 1.5px 4px)`.
  - Two 4 px bolt heads, 6 px in from the top corners.
- **Print:**
  - No container. Reveal is a 180 ms linear wipe:
    - web: `clip-path:inset(0 100% 0 0)` → `inset(0)`;
    - native: a plate-coloured cover translates right; off flat plates, a 150 ms fade instead.
  - States: pencil, hollow, ink.
  - A footer in caption type and ink-3: "Read by Claude (claude-opus-5-5)" or "Computed by engine v1, rate card 7f3a 91c2".
- **You cell:** the value in pencil-faint inside a 1.5 px canary outline, with a "You" tag.
- **Ink stamp:**
  - An 18 px ink square with the initials in plate colour (FS Sans 112.5/700 at 10 px).
  - The time shows on hover or long-press.
- **Paper:**
  - Evidence only, with the paper shadow.
  - A "Synthetic sample" chip sits 8 px inside the top-right corner, and the same words go in the alt text.
- **Hatch:**
  - Web: `repeating-linear-gradient(-45deg,var(--fs-hatch) 0 1.5px,transparent 1.5px 6px)`.
  - Native: `hatchPath(w,h)` returns one path of 45° segments every 6 px. react-native-svg `Pattern` x/y are iOS-only ([Reanimated SVG](https://docs.swmansion.com/react-native-reanimated/docs/guides/animating-svg/)).
- **Noise** (console, Tablea only):
  - A seeded 128 px 1-bit tile (`assets/textures/build-noise.ts`, about 2–3 KB) on a fixed layer at 3% opacity.
  - Removed under `data-rec="1"`, because noise turns to compression mush on YouTube.

### S2.6 Icons and glyphs

**Material Symbols**
- Style: Sharp, weight 500, optical size 24.
- Copied as SVG from `google/material-design-icons`, Apache-2.0:
  - `symbols/web/<n>/materialsymbolssharp/<n>_wght500_24px.svg`
  - `…fill1_24px.svg`
- Destination: `assets/icons/material/`, with the LICENSE and the source commit.
- Do not use `@material-symbols/svg-500`. Its SVGs are optical size 48, and the package unpacks to 19 MB.
- Starting set: close, check, arrow_back, expand_more/less, search, settings, volume_up/off, restart_alt, help, open_in_new, filter_list, qr_code_2, content_copy, schedule, wifi_off, play_arrow, pause, translate, contrast, fingerprint, lock, visibility, keyboard, print.

**Domain glyphs (14)**
- sack, triplicate-slip, duplicate, hanging-scale, thumbmark, cut-test-bean, seal, cash, bolt, pencil, plot, rail, listen, logbook.
- Drawn on a 24 px grid: 2 px stroke, square caps, mitre joins, 45° chamfers.
- A `-fill` variant marks state.
- Rendered with `<Glyph name size>` in `currentColor`.
- Claude is shown as the word plus the pencil glyph. Never sparkles, robots or emoji.

### S2.7 Components

```ts
interface SlabProps {
  label: string;
  depth: "d1" | "d2" | "d3";
  tone: "chalk" | "jade";
  hold?: 1600 | 1200;
  bolted?: boolean;
  unavailableReason?: string;
  srLabel: string;
  onCommit(): void;
  testId: string;
}
interface PrintProps {
  value: string;
  provenance: "claude" | "engine";
  confidence?: number;
  state: "pencil" | "hollow" | "ink";
  footer?: string;
  reveal?: boolean;
}
interface SealProps {
  batchSha256: string;
  size: number;
  keys: 0 | 1 | 2;
  engrave?: boolean;
}
interface ReceiptBarProps {
  line: StatementLineDTO;
  onSegment(id: SegmentId, rect: Rect): void;
}
interface HoldCardProps {
  hold: HoldDTO;
  gate: "BLOCKS_APPROVAL" | "RESERVES_LINE";
  actions: [SlabAction] | [SlabAction, FlatAction];
  resolution?: StampDTO;
}
```

**Slab states.** `data-state` is one of rest, pressed, holding, committed, unavailable, bolted, refusing. Hold slabs also set `data-hold-progress` to 0, 25, 50, 75 or 100.

**Hold alternative.** ConfirmDialog (Base UI AlertDialog on web, an M3 dialog on native) shows the amount and the recipients. It opens on any of:
- the Enter key;
- an active screen reader;
- the visible "Can't hold? Approve another way" link.

**Formatting.** UI cannot import `domain`. DTOs therefore carry `display` and `spoken` strings, made server-side by `format.*`. AmountDisplay and DigitSwap only diff strings.

**Web hold**
- **Start:** `pointerdown` with `setPointerCapture`, or a Space `keydown` (repeats ignored). Either runs `animate(progress, 1, {duration:1.6, ease:'linear', onComplete: commit})`.
- **Quarter steps:** fired from `progress.on('change')`.
- **Cancel:** `pointerup`, `pointercancel`, `keyup`, `blur` or a visibility change.

**Native hold.** Uses the Gesture Handler 3 hooks, whose callbacks are worklets ([RNGH](https://docs.swmansion.com/react-native-gesture-handler/docs/gestures/use-long-press-gesture/)). `runOnJS` is deprecated in favour of `scheduleOnRN` ([migration](https://docs.swmansion.com/react-native-reanimated/docs/guides/migration-from-3.x/)).

```tsx
const g = useLongPressGesture({
  minDuration: hold,
  maxDistance: 24,
  onBegin: () => {
    progress.value = withTiming(1, { duration: hold, easing: Easing.linear });
  },
  onActivate: () => {
    travel.value = withTiming(d, tween("press60"));
    scheduleOnRN(onBottomOut);
  },
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
```

**Seal** (`@fairsplit/seal`, snapshot-tested). All parameters come from the 32 hash bytes `b`.
- **Bands:** ring i (0–4) lives in band [22,38], [40,56], [58,72], [76,86] or [88,98], in units of size/200.
- **Key ownership:** rings 0–2 belong to key 1; rings 3–4 to key 2.
- **Ring parameters:**
  - Lobes: `N = 12 + b[i] % 37`.
  - Turns: `M = 2 + b[5+i] % 7`, stepped within 2–8 until gcd(N,M) = 1.
  - Pen: `p = (N−M)(0.35 + 0.5·b[15+i]/255)`.
- **Curve:** a hypotrochoid with R = N and r = M:
  - `x=(R−r)cos t + p cos((R−r)t/r)`
  - `y=(R−r)sin t − p sin((R−r)t/r)`
  - for t ∈ [0, 2πM].
- **Placement:**
  - The polar radius is remapped linearly from [R−r−p, R−r+p] into the band.
  - The ring is rotated by `2π·b[10+i]/256/N`.
  - `min(2000, 24N)` samples at 0.01 precision.
- **Output:** each ring returns `{d, length, owner}`. `length` is needed because react-native-svg has no `pathLength` ([#1738](https://github.com/software-mansion/react-native-svg/issues/1738)).
- **Stroke:** `max(0.5, 0.75·size/200)` px in ink. Unsigned bands draw as 1 px `rule` circles.
- **PNG:** push and print use the same SVG, rendered through the pinned sharp 0.35.5. It is ≤40 KB at 512 px.

**Inventory**, per design §5, by package:
- **Both ui-web and ui-native:**
  - InkStamp, StatusChip, RuleChip, ConfidenceRing, DigitSwap, AmountDisplay.
  - ReceiptBar, HoldCard, Slab, Print, Seal, RailBar.
  - CropZoom (tap on M-MB-01, wheel on W-PF-01).
  - Drawer, ConfirmDialog, Snackbar, OfflineBar, EmptyState, Skeleton (Base UI on web, M3-styled on native).
  - Theme and language pickers.
- **ui-web only:**
  - MassBalanceDial, SplitFan, FundingArc, RunStrip, RunPill, RunLog, LogRibbon.
  - SlipViewer, FlightLayer, TwinCompare, ByHandField.
  - SplitGrid renderers, QRPairCard, PhoneFrame, CommandMenu, ShortcutSheet, DataModeTable.
  - VerifyPanel, PlotField, EvalWaffle, PrintStatement.
- **ui-native only:** PaminawaPlayer, LineHistory.

**SplitGrid** on AG Grid Community 36.2.0. Every parameter below was checked against the 36.2.0 type definitions (core and the `ag-stack` shared params; [parameters](https://www.ag-grid.com/javascript-data-grid/theming-parameters/)).

```ts
const p = {
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
};
export const fsGridTheme = themeQuartz
  .withParams({ ...p, browserColorScheme: "dark" }, "fs-tablea")
  .withParams({ ...p, browserColorScheme: "light" }, "fs-adlaw");
```

**SplitGrid behaviour**
- **Grid options:** `animateRows:false`, `cellFlashDuration:150`, `cellFadeDuration:450` ([flashing](https://www.ag-grid.com/javascript-data-grid/change-cell-renderers/)).
- **Flashing:** `enableCellChangeFlash` only on Net, Rail and Status.
- **Flash colour:** `cellClassRules` choose it from `row.lastChange.cause`:
  - `fs-cause-paypal` sets `--fs-flash:var(--fs-jade-wash)`;
  - engine changes use the pencil-wash.
- **Held rows:** a 3 px canary rule on the left.
- **Totals:** `pinnedBottomRowData`.
- **Never:** slabs in rows, or jade as the accent.

**Hero component details**
- **HoldCard**
  - Engine line: ink; its digits come from templates.
  - Claude's line: pencil, after the pencil glyph and the word "Claude", with no digits.
  - Evidence shown as paper, followed by the money effect.
  - Gate chip: "Blocks approval. Changes kilos." or "Reserves this line only. Never redistributed."
  - Actions: at most one d2 slab and one flat action.
  - Resolved: flush ink, the initials stamp and the time.
  - `data-state`: open, resolving, resolved, asked-chair or conflict.
- **ReceiptBar**
  - Order: kilos × rate → premium (lock, "walay kaltas") → bonus → RuleChips ("CBU −1.09 R1") → credits → net.
  - Horizontal at ≥360 dp and font scale below 1.3; otherwise a list.
  - Every segment is pressable and reports its rect for MM-7.
- **DigitSwap**
  - Diffs right-aligned display strings; only the changed characters move.
  - Out: −6 px over 120 ms. In: from +6 px over 150 ms. The direction flips for decreases.
  - Never shows intermediate values.
- **MassBalanceDial**
  - A 240° SVG arc covering 0–4.0% at 60° per percentage point, so the 2.0% limit sits at 12 o'clock.
  - Ticks every 0.5%; hatched above 2.0%.
  - Pod needle; the value is set in figure type.
- **SplitFan**
  - One 1200×520 SVG, with the seal at (130,260) and 64 stubs at x 1120, 7.75 px apart.
  - Path: `M x0 y0 C x0+.45Δx y0, x1−.45Δx y1, x1 y1`.
  - Width: `max(1.5, 0.053·√cents)`, i.e. Merlyn 6.0 px, Nang Celing 4.3, Rhea 2.7.
  - 8 threads with `pathLength=1`; 56 cash lines dashed `4 3` in hatch, labelled.
- **PaminawaPlayer**
  - One clip per sentence, from `media/audio/manifest.json`.
  - The current sentence is underlined with a 2 px ink line.
  - When a sentence's `mentions` include `slip:0403`, that chip lifts 8 dp (settle) for 1.2 s.
  - "Hinay" calls `setPlaybackRate(0.85)`.
  - Lock-screen controls need `interruptionMode:'doNotMix'` ([expo-audio](https://docs.expo.dev/versions/latest/sdk/audio/)).
- **CropZoom**
  - Zooms about (px, py) with origin 0,0: `tx = px(1−s)`, `ty = py(1−s)`.
  - Rectangles come from the reviewed fixtures, through the contain-fit transform. Never from model boxes.

### S2.8 Motion system

**Spring presets** (`presets.ts`)
- Mass is 1, k = (2π/d)² and c = 4π(1−b)/d.
- A unit test asserts the table below and ζ = 1−b.
- "Settles" is the time to stay within 0.1% of the target; tests use it as their timeout.

| Preset        | d / bounce          | k     | c    | ζ    | Settles                | Use                                |
| ------------- | ------------------- | ----- | ---- | ---- | ---------------------- | ---------------------------------- |
| press (tween) | 90 ms (.23,1,.32,1) | –     | –    | –    | 90 ms                  | Slab travel; ratchet steps 60 ms   |
| rebound       | 0.28 / 0.35         | 503.6 | 29.2 | 0.65 | 492 ms                 | Release, early release             |
| land          | 0.32 / 0.30         | 385.5 | 27.5 | 0.70 | 527 ms                 | PayPal press, seal, chips          |
| settle        | 0.50 / 0.15         | 157.9 | 21.4 | 0.85 | 707 ms                 | Slab rise, layout, flips           |
| glide         | 0.45 / 0            | 195.0 | 27.9 | 1.00 | 661 ms                 | Sheets, zoom, container transforms |
| needle        | 0.90 / 0.60         | 48.7  | 5.6  | 0.40 | 2.5 s (0.5° at 1.44 s) | Dial only                          |

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
- Under `ReduceMotion.System`, springs and timings jump straight to the end. The 150 ms reduced-motion fades therefore pass `ReduceMotion.Never`.
- `useReducedMotion()` is read once, at launch. `useMotionPrefs()` therefore also listens for `reduceMotionChanged`.

**Motion pin: `motion@14.0.0`** (released 2 Oct).
- It is the only 14.x release at least 14 days old on 22 Oct. 14.1.0 qualifies at 19:38 UTC on 23 Oct; do not switch after the first install.
- 14.1.1 fixes velocity hand-off for hardware-accelerated springs, and 14.2.0 accelerates x/y/scale ([changelog](https://github.com/motiondivision/motion/blob/main/CHANGELOG.md)). On 14.0.0 we therefore use springs for transforms (JS-driven and retargetable) and tweens for opacity and colour.
- The root `<MotionConfig reducedMotion="user">` is a safety net ([MotionConfig](https://motion.dev/docs/react-motion-config)).
- Test builds set `MotionGlobalConfig.skipAnimations = true`.
- Proof loads `LazyMotion` + `m` only in the Verify chunk and uses CSS everywhere else.

**Tweens** (exposed as `--fs-dur-*` and `--fs-ease-*`)

| Tween   | Timing and curve                                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| print   | 180 ms, linear                                                                                                                                                  |
| band    | 220 ms, (.77,0,.175,1)                                                                                                                                          |
| flight  | 600 ms, (.23,1,.32,1), on a quadratic path with the control point 40 px up                                                                                      |
| thread  | 500 ms ease-out, staggered 40 ms; completion 300 ms                                                                                                             |
| engrave | 600 ms linear per ring, staggered 120 ms                                                                                                                        |
| arc     | 600 ms, ease-out                                                                                                                                                |
| digit   | 150 ms in, 120 ms out                                                                                                                                           |
| flash   | 150 ms flash plus 450 ms fade                                                                                                                                   |
| drawer  | 420 ms in, 320 ms out, (.32,.72,0,1), through Base UI `[data-starting-style]` / `[data-ending-style]` ([Base UI](https://base-ui.com/react/handbook/animation)) |
| micro   | 100–200 ms                                                                                                                                                      |

Springs are also emitted as CSS `linear()` easings (`--fs-spring-<name>`, 48 samples over the settle time), with a `cubic-bezier(.23,1,.32,1)` fallback.

**Mechanisms**
- **`useMoment(id)`** owns each phase machine. It:
  - writes `data-moment-phase`;
  - appends `{m, phase, t}` to `window.__fsMoments` (in test builds, or with `?fsTrace=1`);
  - will not start without an event that carries an `eventId`.
- **`FlightScheduler.acquire()`** allows at most 8 concurrent flights (3 on the low tier). A refused row lands without flying.
- **"Gipadala na" ring:** animates for at most 60 s, then shows elapsed time only.
- **Retargeting:** animations target the same MotionValue or shared value, so velocity carries over. A newer event replaces the target; events are never queued.

**Reduced motion**
- **Detection:**
  - web: `prefers-reduced-motion`;
  - iOS: Reduce Motion;
  - Android: "Remove animations", which RN reads as `transition_animation_scale == 0` ([RN](https://github.com/facebook/react-native/commit/8b11970adb7d09bc9a4be78cfaee04cb7e084177)).
- **Effect:** the phases stay the same; only the renderer changes. No spatial travel, colour and opacity changes over 150 ms, and hold-to-commit becomes a stepped bar with a percentage.

**Low tier** (`motionTier()`)
- **Native:** low when `Device.totalMemory ≤ 3.3e9` bytes ([expo-device](https://docs.expo.dev/versions/latest/sdk/device/)). This targets nominal 2–3 GB phones; it is **UNVERIFIED** on real 3 GB and 4 GB devices until S7.
- **Web:** low when `deviceMemory ≤ 4 && hardwareConcurrency ≤ 4`, or when the 90th-percentile rAF interval exceeds 20 ms over the first 60 idle frames.
- **On the low tier:**
  - at most 3 concurrent animations;
  - seals fade in complete over 200 ms;
  - no flights;
  - digits change instantly.
- Sound and haptics stay.

### S2.9 Magic moments (IC-10)

`packages/motion/moments.ts` freezes on 27 Oct at 18:00. The full, low and reduced renderers all emit the same phases.

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
  "MM-3": ["closed", "glide-in", "converge", "underline", "ready", "pressed", "needle", "wave", "resolved"],
  "MM-4": ["idle", "refuse", "plate", "done"],
  "MM-5": [
    "blocked",
    "rising",
    "ready",
    "hold-1",
    "signed-1",
    "waiting-2",
    "hold-2",
    "signed-2",
    "sealed",
    "inked",
    "released-early",
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
- Web root: `<section data-moment="MM-5" data-moment-phase="…">`.
- Native root: `testID="moment-MM-5"` plus `dataSet`, which renders as `data-moment-phase` in the web export ([RNW](https://necolas.github.io/react-native-web/docs/view/)).
- For Maestro: a 1×1 `collapsable={false}` marker named `moment-MM-5-phase-<phase>`.

**Who builds what**
- WS-CONSOLE: MM-2, MM-3, MM-4, the console side of MM-5, MM-6, BEAT-PAID, and the Proof zoom.
- WS-APP: MM-1, the phone side of MM-5, and MM-7.
- Both import `timelines.ts`, which holds every number below. Times are in ms from the trigger.

**MM-1 Bayad na (M-MB-01)**
- **Trigger:** SSE `item.updated` taking M-014 to SUCCESS (rank 60).
- **If opened from a push:** play only if the screen becomes visible within 120 s of the event. Otherwise show the end state.
- **Starting state:** the amount is hollow, and the capsule reads "Gipadala na, naghulat sa PayPal 0:14" with a 5 px inset.

| t   | Change                                                       | Motion        | Sound and haptic                                        | Phase                   |
| --- | ------------------------------------------------------------ | ------------- | ------------------------------------------------------- | ----------------------- |
| 0   | Capsule inset 5 → 0                                          | press         | –                                                       | press                   |
| 90  | Jade view scales 0 → 1 from `transformOrigin:'right bottom'` | 140 ease-out  | –                                                       | flood                   |
| 120 | Solid amount fades in over the hollow SVG                    | 120 linear    | –                                                       | fill                    |
| 180 | –                                                            | –             | Chime; iOS Success ×2 / Android Confirm ×2, 90 ms apart |                         |
| 400 | Label → "Bayad na, 30 Okt"                                   | crossfade 200 | –                                                       | label                   |
| 900 | One 1 px ink ring pulses on Paminawa                         | 400           | –                                                       | invite → done (at 1300) |
- **Low tier:** jade fades in over 120 ms; the amount fills instantly.
- **Reduced motion:** colour and label crossfade over 150 ms.
- **Assertion:** `done` within 3 s of the event.

**MM-2 Paper prints itself (W-TR-03, the reading room)**
- **Trigger:** each replayed `extract.row`. Row starts are at least 180 ms apart, with at most 8 flights.
- **Live single-slip read:** shows only the band.

| t         | Change                                                                     | Motion       | Sound                       | Phase         |
| --------- | -------------------------------------------------------------------------- | ------------ | --------------------------- | ------------- |
| 0–220     | Band (1 px chalk over a 6% wash) moves to the fixture line                 | band         | –                           | band          |
| 220–340   | Crop lifts: shadow grows, scale 1 → 1.04                                   | 120 ease-out | –                           | lift          |
| 340–940   | Crop (a div with the photo as background, in FlightLayer) flies to its bed | flight       | –                           | flight        |
| 640–940   | Handwriting blurs 0 → 2 px and fades; FS Sans digits sharpen in from 2 px  | linear       | –                           | resolve       |
| 940–1120  | Row prints                                                                 | print        | Tick (at most 1 per 120 ms) | print         |
| 1120–1360 | Confidence ring draws                                                      | 240 ease-out | –                           | ring → landed |
- **Low confidence:** fields below 0.85 print hollow with a "You" tag.
- **By hand at 0:42:** slip 0462 is entered by hand. A d2 press with a plunk, then the value in ink with the AS stamp (`by-hand` → `entered`).
- **Low tier and reduced motion:**
  - No flight.
  - A 2 px pencil outline and a 1 px connector show for 600 ms.
  - The band jumps instead of sliding.
- Blur applies only to the two digit layers.

**MM-3 The pink copy (W-TR-06 and the dial)**
- **Trigger:** Analyn opens H1.

| t        | Change                                                                                                                                                                                               | Motion       | Sound                | Phase             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------- | ----------------- |
| 0–450    | Photos B and D glide in                                                                                                                                                                              | glide        | –                    | glide-in          |
| 450–900  | The two 0457 crops (fixture-aligned, grey, level-matched) converge. The top crop uses `mix-blend-mode:difference` over black inside `isolation:isolate`. "Same slip. Serial and kilos match." prints | 450 ease-out | –                    | converge          |
| 900–1200 | Canary underline draws under both serials                                                                                                                                                            | 300 ease-out | 2 ticks, 90 ms apart | underline → ready |
| press    | "Count it once" (d2)                                                                                                                                                                                 | press        | Plunk                | pressed           |
| +60      | Needle 2.05% → 1.62%, overshooting to 1.51% (25% overshoot at ζ 0.4)                                                                                                                                 | needle       | Tick on crossing 2.0 | needle            |
| +200     | Dioning 80.65 → 62.71 (DigitSwap). 63 rows gain cents, 6 ms apart (≤380 ms total). "Returned to 63 members: US$17.94." prints                                                                        | digit, print | –                    | wave              |
| end      | Card goes flush ink with the AS stamp                                                                                                                                                                | 120          | –                    | resolved          |
- **Low tier:** the crops start already overlapped.
- **Reduced motion:** 200 ms crossfades for the overlap and the needle; digits change instantly with a 600 ms pencil-wash.

**MM-4 Bolted (W-TR-02)**
- **Trigger:** a press on the bolted "Add to Schedule A".
- **At 0 ms (`refuse`):**
  - No travel.
  - A ±3 px shake in two 70 ms cycles (keyframes 0, +3, −3, 0, +3, −3, 0; linear).
  - A clack, with iOS Error / Android Reject.
- **At max(120 ms, arrival of the 409) (`plate` → `done`):**
  - The 409 is `RATE_CARD_RATIFIED` and cites the hash.
  - The refusal plate prints, with its single d1 slab "Draft a proposal for 2026-B".
- **Reduced motion:** no shake. The steel edges and bolts brighten for 200 ms.

**MM-5 Two keys (W-TR-07 and M-BD-02)**

| Trigger or t                                | Change                                                                    | Motion        | Sound and haptic                                                      | Phase                |
| ------------------------------------------- | ------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------- | -------------------- |
| `hold.resolved` (last BLOCKS_APPROVAL hold) | Approve slab edges grow 0 → 8 px                                          | settle        | –                                                                     | rising → ready       |
| Console hold starts                         | Fill layer `scaleX` 0 → 1 (on-jade at 14%)                                | linear 1600   | –                                                                     | hold-1               |
| 400, 800, 1200                              | Face sinks 2 px per step                                                  | press 60      | Tick                                                                  | hold-1               |
| Release before 1600                         | Face springs up, fill retracts, "Hold until it clicks" shows once         | rebound / 200 | –                                                                     | released-early       |
| 1600                                        | Face clunks flush; the browser signs                                      | press 60      | Plunk                                                                 | hold-1               |
| `approval.signed` TREASURER                 | Rings 0–2 engrave on both screens; "1 of 2"; the presence label glides in | engrave       | –                                                                     | signed-1 → waiting-2 |
| Phone hold (1200)                           | Quarter steps at 300, 600, 900                                            | linear        | Tick; iOS selection / Android Segment_Tick (API 34+), else Clock_Tick | hold-2               |
| Phone 1200                                  | Bottom-out → biometric → Ed25519                                          | press 60      | Plunk; iOS Heavy then Success at +110 / Android Confirm               | hold-2               |
| `approval.signed` CHAIR                     | Rings 3–4 engrave on both screens                                         | engrave       | –                                                                     | signed-2             |
| +720                                        | Seal 1.03 → 1; "Approved by Analyn and Ernesto"                           | land; 200     | Low plunk; phone Success / Confirm                                    | sealed               |
| +960                                        | Pencil figures in the grid turn to ink (`[data-inked]`)                   | 240 colour    | –                                                                     | inked                |
- **Mismatch:** a clack, the Error haptic, and the canary message "The batch changed after you opened it. Nothing was signed. Review again."
- **Low-tier phone:** the rings fade in over 200 ms.
- **Reduced motion:** a stepped bar with a percentage; the edges fade.
- **Assertions:**
  - Both contexts reach `sealed` within 150 ms of each other in CI (target 100 ms).
  - Commit happens at 1600 ± 50 ms.
  - A tampered hash gives `mismatch` and no POST.

**MM-6 Honest fan-out (W-TR-08)**
- **Trigger:** the 201, then each rank-forward `item.updated`.
- Colour follows the item's actual `transaction_status`.

| Event                                                    | Change                                                                                                                                                                                   | Motion          | Sound                                  | Phase    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------- | -------- |
| 201                                                      | 8 graphite threads draw 0 → 70%. The 56 dashed cash lines are already drawn and labelled                                                                                                 | thread          | –                                      | sent     |
| SUCCESS                                                  | Thread runs 70 → 100%, then turns jade. The stub inset closes 3 → 0 with a jade flood. A latency dot appears. The same event updates the grid row, the M-014 frame and the Proof counter | 300 + 200; land | Next scale note (at most 4 per second) | landing  |
| UNCLAIMED (Rhea) or ONHOLD                               | Thread stays at 70%; a 6 px **canary** square end cap; "Parked"                                                                                                                          | print           | Thud                                   | parked   |
| FAILED, BLOCKED, or an unexpected RETURNED               | A 6 px **red** end cap                                                                                                                                                                   | print           | Thud                                   | parked   |
| "Pay in cash at the bodega" (d2) → our cancel → RETURNED | Thread retracts; a dashed cash line draws in its place (mask path)                                                                                                                       | 300 each        | Plunk                                  | rerouted |
| Duplicate delivery                                       | One log row: "Delivery repeated, already applied."                                                                                                                                       | print           | Silence                                | –        |
| All items terminal                                       | The run card's summary prints                                                                                                                                                            | print           | –                                      | settled  |
- **Reduced motion:** threads appear at 70%; completion is an instant colour change; no inset press.

**MM-7 Tap a peso (M-MB-01; wheel zoom on W-PF-01)**

| t           | Change                                                                                                                                                    | Motion               | Haptic                                | Phase            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------- | ---------------- |
| 0–90        | The figure lifts into a 1 px ink frame                                                                                                                    | press                | –                                     | framed           |
| 90–540      | The line expands to "148.0 kg × US$0.2952 a kg (R0). Walay kaltas." with 4 chips, via `LinearTransition.springify().stiffness(195).damping(27.9).mass(1)` | glide                | –                                     | expanded         |
| Tap on 0403 | Zoom about the tap point, 1 → 2.4×; the statement dims to 20%                                                                                             | glide                | Rigid / Segment_Tick on crossing 1.6× | zooming → zoomed |
| Settled     | Slips 0419, 0436 and 0467 tile beneath; "148.0 kg" prints; the Paminawa sentence plays and its chip lights                                                | settle, staggered 60 | –                                     | tiled            |
| Back        | The zoom reverses                                                                                                                                         | glide                | –                                     | returning → rest |
- **Back gesture:** React Native routes back through an `OnBackPressedCallback` that fires when the gesture completes ([RN #55211](https://github.com/react/react-native/pull/55211)). Gesture progress is not exposed to JS (**UNVERIFIED** for RN 0.88). So Back plays the reverse; it does not scrub.
- **Low tier and reduced motion:** a 200 ms crossfade straight to the final crop.
- **Proof wheel:** `s' = clamp(s·e^(−0.0015Δy), 1, 4)`.

**BEAT-PAID (W-TR-01)**
- **Trigger:** a fresh GET shows PAID or MARKED_AS_PAID.
- **Sequence:**
  1. The arc draws (`arc`).
  2. The pool turns solid over 150 ms.
  3. "Funded" closes its 3 px inset to jade flush (`land`), and E4 plays (`funded`).
- **Reduced motion:** colour only.
- H2 and H3 resolve as flush ink stamps, with no moment.

### S2.10 Sound and haptics

```ts
type FeedbackEvent =
  | "row.printed"
  | "slip.captured"
  | "slab.d1.press"
  | "slab.d1.release"
  | "slab.d2.commit"
  | "duplicate.found"
  | "hold.quarter"
  | "hold.bottom"
  | "bolted.refuse"
  | "seal.complete"
  | "item.paid.member"
  | "item.paid.console"
  | "invoice.paid"
  | "paypal.failure"
  | "seal.mismatch"
  | "zoom.commit"
  | "webhook.duplicate";
feedback.play("item.paid.console", { index: 3 }); // 4th scale note; the only way UI makes sound or haptics
feedback.setSound(on);
feedback.duck("narration" | "paminawa", on);
```

| Event                           | Sound                      | iOS                     | Android (fallback below API 30 / 34) |
| ------------------------------- | -------------------------- | ----------------------- | ------------------------------------ |
| row.printed                     | Tick, at most 1 per 120 ms | –                       | –                                    |
| slip.captured                   | –                          | impact Medium           | Confirm (impact Medium)              |
| slab.d1 press / release         | –                          | Light / Light           | Virtual_Key / Virtual_Key_Release    |
| slab.d2.commit                  | Plunk                      | Rigid                   | Virtual_Key                          |
| duplicate.found                 | 2 ticks, 90 ms apart       | Rigid ×2                | Clock_Tick ×2                        |
| hold.quarter                    | Tick                       | selection               | Segment_Tick (Clock_Tick)            |
| hold.bottom                     | Plunk                      | Heavy, Success at +110  | Confirm (impact Heavy)               |
| bolted.refuse, seal.mismatch    | Clack                      | notification Error      | Reject (notification Error)          |
| seal.complete                   | Low plunk                  | Success                 | Confirm                              |
| item.paid.member                | Chime                      | Success ×2, 90 ms apart | Confirm ×2                           |
| item.paid.console, invoice.paid | scale[i], root             | –                       | –                                    |
| paypal.failure                  | Thud                       | notification Warning    | Reject                               |
| zoom.commit                     | –                          | Rigid                   | Segment_Tick                         |
| webhook.duplicate               | Silence                    | –                       | –                                    |

**Haptics on old Android and iOS.** Confirm and Reject need API 30, and Segment_Tick needs API 34 ([Android](https://developer.android.com/reference/android/view/HapticFeedbackConstants)). The Android 10 target therefore uses the fallbacks. `performAndroidHapticsAsync` needs no VIBRATE permission. iOS haptics are silent in Low Power Mode ([expo-haptics](https://docs.expo.dev/versions/latest/sdk/haptics/)).

**One DSP source.** `sound/recipes.ts` renders each sound to a 48 kHz mono `Float32Array`, with noise from a seeded mulberry32. Web and native are therefore bit-identical.
- **Web:**
  - All sounds (about 2.6 s of audio in total) are rendered on first enable.
  - They play through `AudioBufferSource → Gain → DynamicsCompressor`, with a −1 dBFS ceiling.
  - The `AudioContext` is created inside the toggle's click handler.
- **Native:**
  - `assets/sfx/build.ts` writes committed 16-bit WAVs. A test re-renders them and compares sha256.
  - expo-audio preloads one player per sound, and two for the tick.

| Sound      | Recipe (peak)                                                                                                                                | Length / WAV     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| tick       | White noise, band-pass at 4 kHz (Q 2), 0.5 ms attack, −60 dB at 12 ms (−28 dBFS)                                                             | 12 ms / 1.2 KB   |
| plunk      | Sine 90 → 70 Hz, exponential over 60 ms, plus the 3rd partial at −14 dB, plus 30 ms of brown noise low-passed at 800 Hz at −10 dB (−14 dBFS) | 70 ms / 6.8 KB   |
| plunk-low  | Pitched parts halved; partial at 4×                                                                                                          | 70 ms / 6.8 KB   |
| clack      | 140 Hz odd-harmonic burst, low-passed at 1.2 kHz, 40 ms, plus a 5 ms click (−18 dBFS)                                                        | 45 ms / 4.4 KB   |
| chime      | E5 659.26 Hz, then G♯5 830.61 Hz at +90 ms. Sine plus 2× partial at −18 dB; 5 ms attack, 180 ms decay (−16 dBFS)                             | 275 ms / 26.4 KB |
| scale[0–7] | E5, F♯5 739.99, G♯5, B5 987.77, C♯6 1108.73, E6 1318.51, F♯6 1479.98, G♯6 1661.22 Hz; 220 ms decay (−20 dBFS)                                | web only         |
| root       | E4 329.63 Hz plus 2× partial at −12 dB, 300 ms (−18 dBFS)                                                                                    | web only         |
| thud       | 70 Hz for 50 ms plus the 3rd partial at −14 dB (−30 dBFS)                                                                                    | 50 ms / 4.8 KB   |

The partials keep the low sounds audible on phone and laptop speakers, which reproduce little below about 150 Hz.

**Policies**
- **Web:**
  - Sound is off by default, behind a visible toggle (stage bar and ⌘K).
  - The choice is remembered in `localStorage['fs.sound']`, inside try/catch. Sound never autoplays.
  - Stage phone frames send `postMessage({type:'fs-feedback', event})` to the same-origin parent, which plays the sound. That gives one toggle, one mixer, and no iframe autoplay problem.
- **Native:**
  - Sound is on by default, with `setAudioModeAsync({playsInSilentMode:false, interruptionMode:'mixWithOthers'})`. Expo documents that this also silences Android in silent and vibrate modes.
  - While Paminawa plays, the mode switches to `{playsInSilentMode:true, interruptionMode:'doNotMix', shouldPlayInBackground:true}` and `duck('paminawa')` applies.
  - Settings has a "Tunog" (sound) toggle.
- **Silence:** no product sound under narration or Paminawa. The web promises no haptics.
- **Latency:** target ≤80 ms from haptic to sound on the 2 GB phone (**UNVERIFIED**). If it is missed, drop the native ticks.
- **HapticTrace (P2):** only under `EXPO_PUBLIC_FS_HAPTIC_TRACE=1`, labelled "shown for video".

### S2.11 Performance budgets

| Surface                          | Budget                                                                                                                                                                                | Measured by                                                                                                                                                                                                                                           | Gate          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Proof W-PF-01                    | LCP ≤1.8 s; initial JS ≤110 KB gz; Verify chunk ≤45 KB, lazy; fonts ≤80 KB (plan: 66 + 2 + 4 + 4); CLS ≤0.05; INP ≤150 ms                                                             | Playwright with CDP Fast 4G (165 ms RTT, 1,012,500 B/s down, 168,750 B/s up, [DevTools](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/core/sdk/NetworkManager.ts)) and 4× CPU throttling; gzip sizes from the Vite manifest | Every PR      |
| Console                          | Route JS ≤300 KB gz; AG Grid chunk lazy, ≤300 KB; fonts ≤170 KB (plan: 108 + 2 + 4 + 4, with Atkinson's 37 lazy); J/K ≤50 ms; moments at 60 fps with ≤4 ms main-thread work per frame | Bundle script; Long Animation Frames (none over 50 ms during moments); a DevTools recording on the reference laptop                                                                                                                                   | CI smoke + G4 |
| Stage W-JG-01                    | Interactive ≤2.5 s; phone frames after idle, ≤6 s; median first press → POST ≤60 s                                                                                                    | Playwright                                                                                                                                                                                                                                            | G2            |
| Android (2 GB, 720p, Android 10) | Cold start ≤2.5 s (release, R8); moments p95 ≥55 fps; APK ≤35 MB per ABI; JS ≤3 MB; RAM ≤180 MB; audio ≤200 KB per statement                                                          | `dumpsys gfxinfo <pkg> reset`, then the Maestro moment flow, then the 95th percentile ≤18.2 ms; `am start -W` for cold start                                                                                                                          | G3 (1 Nov)    |
| Assets                           | Photos ≤250 KB; crops ≤40 KB (90 KB in the app); WAVs ≤30 KB; fan ≤64 paths; seal ≤5 paths of ≤2,000 points                                                                           | Scripts and unit tests                                                                                                                                                                                                                                | CI            |

### S2.12 Verifying visual quality

1. **CI token gate:** contrast, freshness of the generated files, and the preset maths.
2. **`/prototype`** (WS-DS):
   - every primitive × state × theme × `motion=full|reduced|low`;
   - the token sheet, from `contrast.json`;
   - static compositions on seed data: W-JG-01, W-TR-05 and W-TR-06 (H1), W-TR-07 (ready, and with key 1 signed), M-MB-01 (sent, and paid), and W-PF-01;
   - moment poses. `poseAt(moment, t)` evaluates `timelines.ts` with the closed-form spring solution, so `/prototype/moments/MM-5?t=1600` renders any frame statically. These poses are the G1 motion studies for MM-5 and MM-1.
3. **Web regression** (WS-QA, Playwright 1.64.1):
   - `toHaveScreenshot` on the gallery and on the rest states of W-JG-01, W-TR-01/05/06/07/08 and W-PF-01.
   - Options: `animations:'disabled'`, `caret:'hide'`, masks over clocks and IDs, `maxDiffPixelRatio:0.001`.
   - Projects: Chromium at 1440 (Tablea) and 1920 (stage); WebKit at 390 and Firefox at 1280 (Proof). Each also runs with `reducedMotion:'reduce'` ([TestOptions](https://playwright.dev/docs/api/class-testoptions)).
   - Baselines come only from Linux CI in `mcr.microsoft.com/playwright:v1.64.1-noble`, because rendering differs by OS ([snapshots](https://playwright.dev/docs/test-snapshots)).
4. **Motion assertions:**
   - Each moment's phase sequence and durations are checked from `data-moment-phase` and `__fsMoments`, in full and reduced modes.
   - `page.clock` fakes rAF and `performance` ([clock](https://playwright.dev/docs/clock)).
5. **Native** (Maestro 2.11):
   - A dev-only gallery route (`EXPO_PUBLIC_FS_GALLERY=1`, stripped from release builds).
   - `assertScreenshot` with `cropOn` per primitive, at `thresholdPercentage: 98`, on the API 34 AVD ([Maestro](https://docs.maestro.dev/reference/commands-available/assertscreenshot)).
   - Moment flows wait on the phase markers.
   - The reduced-motion flow runs after `adb shell settings put global transition_animation_scale 0` (plus the window and animator scales).
   - Font scales 1.3 and 2.0 are set via `settings put system font_scale`.
6. **Device matrix:**

| Device                                                        | Used for                                      |
| ------------------------------------------------------------- | --------------------------------------------- |
| 2 GB, 720p, Android 10–11 phone                               | The gfxinfo gate, the low tier, sound latency |
| 4–6 GB, Android 14 phone                                      | Hero recordings (scrcpy), haptics             |
| AVD API 36 with Google Play                                   | Push, scanner                                 |
| AVD API 34                                                    | Maestro                                       |
| 2020 integrated-GPU laptop, Chrome, at 1440×900 and 1920×1080 | Console, stage, film                          |
| WebKit and Firefox at 390 and 1280                            | Proof                                         |
| EAS iOS simulator on a macOS runner                           | The 5 s clip (P2)                             |
7. **Human gates:**
   - **G1 (26 Oct):** the user signs off the token sheet, every primitive state, and the MM-5 and MM-1 studies.
   - **G4 (4 Nov):** each moment has an assertion, a reduced-motion version and a recording of the real event.
   - **G5 (6 Nov):** TalkBack, 200% text and axe, plus a capture check: hatch legible at 1080p, no noise under `data-rec`, and 60 fps capture.

**WS-DS schedule**

| Date          | Deliverable                                                   |
| ------------- | ------------------------------------------------------------- |
| 22 Oct        | ₱ fallback, `source.ts`, contrast test                        |
| 23 Oct        | Fonts cut; tokens generated; Slab and Print on both platforms |
| 24 Oct (G0)   | Tokens, the five primitives, seal, `feedback`, glyphs         |
| 25 Oct        | `/prototype`                                                  |
| 27 Oct, 18:00 | `moments.ts` and `timelines.ts` frozen                        |
| 1 Nov (G3)    | Primitives at p95 ≥55 fps on the 2 GB phone                   |
| 4 Nov (G4)    | All seven moments asserted, or shipped in reduced form        |
| 6 Nov         | Freeze                                                        |

### Open checks (UNVERIFIED)

| Check                                                               | Settled at      |
| ------------------------------------------------------------------- | --------------- |
| RN transform-array order for the slab edges                         | G1 screenshot   |
| The `Device.totalMemory` threshold on real 3 GB and 4 GB phones     | S7              |
| Native sound effect latency                                         | G1              |
| Legibility of the ss08 zero at 13 px                                | G1              |
| Safari composing the `unicode-range` ₱ face with `font-stretch`     | WebKit snapshot |
| No audible glitch when `setAudioModeAsync` switches around Paminawa | G1              |
| Back-gesture progress in RN 0.88                                    | S7              |

### Register deviations

1. **Truncated register.** My copy of the register begins at the end of the MM-2 row in §5, so §§1–4 and rows MM-1 and MM-2 were not visible to me. For those I followed the Design Direction: MM-1 on M-MB-01, and MM-2 in the reading room. W-TR-03, -04, -09 and -10 are inferred from the C1–C10 order (W-TR-02 = C2 … W-TR-08 = C8).
2. **MM-6 colours.** Per the register, Rhea's item goes UNCLAIMED (an address with no account), not ERRPYO002. Under the design's rule that colour follows the actual status, UNCLAIMED gets a canary cap and "Parked". Red stays for FAILED, BLOCKED and unexpected RETURNED. A RETURNED caused by our own cancel shows no red.
3. **MM-1 transport.** MM-1 arrives over SSE (IC-08), not the WebSocket named in the design text.
4. **Colour tokens.** The design's own contrast minimums forced changes:
   - ink-3 and hatch change in both themes;
   - pencil-faint is new, replacing 60% opacity: #909498 in Tablea, #5E6871 in Adlaw;
   - canary-border is new.
5. **₱ fallback.** S8's fail branch applies now. On native, the Noto ₱ is grafted into the static cuts; a separate span remains the fallback.
6. **Typography.**
   - "Slashed zero" is implemented as Mona Sans ss08, because there is no `zero` feature.
   - Mona-derived files are renamed FS Sans, because of the Reserved Font Name.
   - Proof clamps slab labels to width 100 to stay within 80 KB of fonts.
7. **Seal PNG renderer.** The seal PNG uses sharp, which is already pinned. resvg is not on the register's Add list.
8. **MM-2 pacing.** I spaced row starts at least 180 ms apart. Read literally ("after the previous one lands"), 48 rows would take about 54 s and break the 60 s judge budget.
9. **Low-sound partials.** The plunk, low plunk, thud and root sounds gain small-speaker partials.
10. **Motion pin.** Motion is pinned to `motion@14.0.0` under the 14-day rule.
11. **Supporting beat ID.** The supporting INVOICE.PAID beat gets the phase ID `BEAT-PAID`; the register gives it no ID.
