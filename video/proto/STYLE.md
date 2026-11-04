# Fair Split film: motion language

Rules for building the whole film (script v4, `video/script.ts`) in the style of the opening prototype
(`video/proto/`, `out/opening.mp4`). The prototype is the reference implementation: when a rule here and the
prototype disagree, fix whichever is wrong and keep them in step. Source of the style: the owner's reference
(`research/refs-1104/video-reference.md`): a motion-design product pitch, almost no text, one accent per frame,
a visual metaphor per idea, black then bright, calm floating product windows, a smooth camera.

Canvas 1920 × 1080, 30 fps. Every pixel is computed from the time alone (one paused GSAP timeline plus one
`draw(t)` driver; seeded PRNG only), so any frame can be rendered on its own.

## 1. The arc: dark, then bright

- **Night is the problem.** Gabii navy `#090D18`, the film-card glows (indigo from the top, jade from the
  lower left), fine grain. Night frames show what goes wrong: the shoebox, the duplicate, an unruled fine, the
  member who can't check her line. Pace: fast, sparse, one idea every 1.5 to 2 s.
- **Day is Fair Split.** Hayag ground `#F3F5F8`, the morning wash (jade top left, indigo top centre), two or
  three very large soft light shapes and out-of-focus leaf shadows (`assets/dapple.png`, at most 10% ink),
  all drifting with parallax. Pace: calm, spacious, 1.4 to 2.5 s per beat plus 2 s glides.
- **One turn per act.** The night ends in a metaphor that closes (threads → dots → a ring around one figure),
  and the ring becomes the portal into the day. Later acts (architecture, highlights, deep dive) stay bright;
  a failure case may dip into a short night insert (≤ 3 s) and must come back through a focus pull, never a
  hard cut. The film has one: the reel's "refused." (55.1–56.8 s, `plan.mjs` `ACCENTS` kind `night`). On
  "Try to break it" the lights go out on the reel's own cut (Gabii navy and its glows over the field, every
  earlier window off), the word lands in night ink over the one lit window, the tag turns to its night form,
  and the day comes back by a focus pull (blur to 16 px, the night lifting under it, sharp again two frames
  before the bumper). It is the middle's one peak; do not add a second night.
- **No dot grids, no new hues.** Depth comes from light, blur and parallax, not from a design-tool canvas.

## 2. Words on screen

| Role            | Face and size                                                                 | Words           | Place                                                                 | In / out                                                                                       |
| --------------- | ----------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Night line      | FS Sans wide 112.5%, 690, 136 px, -0.028em                                    | ≤ 4             | centred                                                               | per word: blur 14 → 0, y 46 → 0, 0.7 s expo.out, stagger 0.08–0.1 s; out 0.3 s power2.in       |
| Night beat word | same, 92 px                                                                   | ≤ 3             | lower left (x 150, top 742), in empty space, never on the bottom edge | same                                                                                           |
| Day keyword     | FS Sans wide 112.5%, 700, 176 px, -0.035em, ink                               | 1 word + period | one anchor for the film: x 140, top 150, beside its window            | mask wipe up, 0.75 s expo.out; out 0.32 s power3.in; faded over the first 0.16 s / last 0.12 s |
| Quiet word      | 46 px (40 px inside a disc), 560, grey                                        | 1–2             | centred                                                               | blur and scale settle, 0.9 s                                                                   |
| Figure          | FS Sans condensed 75%, 800, 112 px; "US$" at 0.5 em, raised to the cap height | 1 figure        | inside its ring, ≤ 70% of the disc width                              | blur 12 → 0, 0.7 s expo.out                                                                    |
| End line        | 118 px, 690                                                                   | ≤ 3             | centred                                                               | per word, accent word underlined                                                               |
| Name            | 150 px, 720, with the mark                                                    | 2 + 2 grey      | centred, once: on the end card                                        | mark builds, then the name                                                                     |
- **At most four words on screen** outside product windows, and one accent word among them.
- **One keyword anchor.** Every day keyword in the film, landscape or phone beat, sits at x 140, top 150 (its
  container; the glyphs start at x 150), shrinking only when a long word would run into its window. Never
  mid-left, never nearer the top edge.
- **Product text counts only when it is readable**: at least 36 px at 1080p (12 px at 640 px wide). Text that
  is smaller is either scaled up (crop tighter, frame closer) or blurred and greyed out of reading. A window
  shows at most about eight readable words.
- No paragraphs, no sentences in windows (render crops without them: `tools/render-mock.cjs` hides
  `.slip-h`, the peso card's "Tap a peso" line, the duplicate row's explanation), no burned-in captions.
- Proportional lining figures everywhere; no `<br>` in text.

## 3. The accent rule

One accent per frame, and each colour keeps one job:
- **Indigo** `#4A2FD6` (day) / `#9C8CFF` (night): a person's hand or Claude's reading: "64", "once.", the box
  round a handwritten figure, the "Count it once" button, the trace, "traced.".
- **Pink** `#F7B6CA`: the carbon copy. Night only, and only for the duplicate.
- **Jade** `#14CC90` / `#3DE6AE`: money that arrived: the ring, "Bayad na", the trace's final pulse, the mark's dot.

Paper, the pale pink of a carbon slip thumbnail, ink and greys are materials, not accents. Product crops come
in a **quiet** variant (no chip lit, no underline, stickers in the neutral tag style, the slip photo at 50%
saturation) and the film lights one element at the moment it matters (the peso card's chip and underline light
only when the trace reaches them). The one allowed pair is the trace frame: an indigo path that lands as a
jade pulse (the hand delivers the money).
- **Accent beats in the capture run** (`plan.mjs` `ACCENTS`, drawn inside their window so they float with it): a
  jade hit on money that arrived ("funded.", "sent."), an indigo box round what Claude read or a person typed
  ("read.", "typed.", "re-checked."), an indigo button pulse for a person's key ("once.", "signed.",
  "co-signed."), the trace with its jade pulse ("traced.": four slips into her net pay) and an ink sound-wave echo
  ("heard."). Each fires as its keyword lands; the boxes mark where the captured element must sit.

## 4. Product windows

- **Source:** single panels cut from the product (today the Hayag mock via `tools/render-mock.cjs`, later F3's
  captures of the re-skinned console, same names and sizes). One window carries one idea.
- **Size:** the hero window takes 40–60% of the frame width with generous margins; when the readable part
  is small, crop to it and lift it out (the duplicate row lifts out of the split review), with the rest of the
  panel on a deep plane behind it: parallax 0.7, scale 0.85, greyscale, blur 9 px, 50% opacity.
- **Float:** bob ±5–6 px on a 5.6 s period, rotateY ±4–6° on 8 s, rotateX 1.5–2.5°, rotate ≤ 1.5°,
  perspective 2200 px, a soft long shadow. Phases differ per window so nothing moves in lockstep.
- **Depth of field:** blur grows with the window's distance from the frame centre (none within 220 px of it,
  up to 10 px), scaled down when the camera is pulled back. The focused window is always sharp.
- **Entrances:** lift (scale 0.55 → 1, y 70 → 0, blur 14 → 0, 0.75 s expo.out) or rise (y 30–40, blur 10 → 0,
  0.7 s power3.out). Windows that have left the frame are switched off so none lingers at an edge; one still at
  the frame's edge when its glide starts or ends fades with the move (0.35 s). In the capture run the camera
  brings every window in (§5): never blur a window out to an empty field and focus the next in at the same spot.
- **Overview:** at the end of a run the windows settle (float, tilt and blur go to zero over 1.1 s) on one
  gentle left-to-right line at a common scale, in the order the data flows (slip → peso card → phone). Drop
  windows that are not on the line. At that scale most product text is under 36 px, so a **quiet layer** (a
  copy of each window, blurred and greyed, with feathered holes) leaves only the figures the trace proves
  readable: the slip's boxed 38.45, Claude's 38.45, the peso card's sum and the phone's US$64.45.
- **The trace:** a 5 px indigo line with a soft glow and a thin light core, drawn at 0.45 s per segment with a
  travelling light at its head, small white nodes at each end, routed around text (never across it), ending in
  one jade pulse on the amount it proves.

## 5. Camera and transitions

- **Glides** between windows: 2.0–2.1 s, sine.inOut, with a 0.28–0.32 zoom-out dip at mid-move; peak travel
  ≤ 36 px per frame, measured at the frame centre (the dip adds a drift towards the centre at the edges). Directional motion blur keyed to the camera's speed (sigma = 0.2 × the frame's travel,
  at most 10 px across, 6 px down), on a container of its own.
- **Holds:** the camera never stops dead: a slow push (≤ 2% over a beat) or a drift.
- **The capture run (44–143 s) is one shot** (`plan.mjs` `CAPTURE_RUN`, `film-slots.js`): every window has a
  place in one world on one daylight field, and one camera on the film's clock holds beside each window (its
  keyword at the anchor), pushes in on a hold of 4 s or more (window centred at 1.16×), and glides to the next.
  A glide straddles the beat cut (each beat also draws its neighbours' windows, so the cut has no seam). Where
  clips are short (the reel's 1.8–2.3 s, "approved.") the glide is 0.7 × the shorter clip and its travel is cut
  to keep the peak; the deep dive's first glide runs under the bumper's veil. The field (light shapes, leaf
  shadows) moves in parallax with the camera.
- **The keyword box stays clear.** While a keyword shows, no window enters its box (x 146 to the word's end,
  y 150 to 150 + its size); `plan.mjs` checks every frame of the run and refuses a collision. The camera climbs
  40 px a glide, so the window it leaves sinks below the box rather than rising into it; a phone's keyword is
  gone before the glide carries the tall phone into it; out of the Chair's phone into the 1.5 s "approved."
  the camera swings back (left and down, `SWING_BACK`), so the phone leaves to the right and the console rises
  in under the word. A keyword's wipe fades over its first 0.16 s and its last 0.12 s, so no lone glyph tip or
  period shows at the mask's edge.
- **Joints with the parts:** no dip to navy, no crossfade between day and night. The opening holds its end line,
  then glides off it in one second (29.0–30.0) onto the architecture's Slips disc, already waiting under the
  92% veil (`plan.mjs` `SLIPS_UNDER_VEIL`: centre 684.5, 593.2, the architecture's first camera pose at 1.9×, no
  label), so the veil never lifts on an empty field; the reel opens with a focus pull on its first window
  (44.0–44.8); the run holds the last phone while her sentence plays, glides off it in its last second
  (141.9–143.0) under a daylight veil (92% by 142.85, the phone going with it) and rests on the field at 143.0.
  Each part starts and ends on that field, and where one side ends under the veil the other opens under the
  same veil and lifts it (0.7 s): the architecture lifts the opening's (30.0–30.7, its Slips node fully built
  from its first frame) and the close lifts the run's (143.0–143.7). The architecture ends by dissolving its diagram into the field
  (blur and fade, 43.4–44.0), so the reel's first window fades in with its focus pull, and the sandbox tag runs
  on across the cut. The two sides of a joint draw the same pixels at the cut (checked frame by frame).
- **Night camera:** a slow drift in (≤ 4%), and a push of about 1.25× towards the detail in question (the
  doubled thread) during its beat, easing back as it resolves; back to rest before the next metaphor.
- **The turn:** the ring's disc becomes a portal (0.4 s iris to the ring's radius), already showing the morning
  field and the first window out of focus, then opens to the frame (0.8 s expo.inOut) while the ring scales out.
- **Focus pulls** (blur 12–18 px → 0, 0.75 s) instead of cuts inside an act; a daylight **veil** (0.4 s to 92%
  plus an 18 px blur) before an end line.
- Metaphors carry the transitions: the wave becomes threads, threads retract into dots, dots glide to the
  centre and gather into a ring (0.4 s), the night wave returns as the sound of the member's statement.

## 6. Timings

| Unit                         | Duration                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------ |
| Night idea                   | 1.5–2 s                                                                        |
| Day beat (keyword on screen) | 1.4–2.4 s, keyword held ≥ 1.2 s                                                |
| Glide                        | 2.0–2.1 s (in the reel and around 1.5 s clips: 0.7 × the shorter clip)         |
| Word in / out                | 0.7 s / 0.3 s                                                                  |
| Keyword wipe in / out        | 0.75 s / 0.32 s                                                                |
| Pulse (button, pill)         | 0.8 s, twice, 0.1 s apart                                                      |
| Shimmer, glow pulses         | ≤ 1.4 Hz, never below 70% (no flashes above 3 Hz)                              |
| Overview settle              | 1.1 s                                                                          |
| Trace                        | 0.45 s per segment, jade pulse 0.7 s                                           |
| End line                     | ≥ 1.15 s on screen, then the camera carries it out; name 1.5 s (end card only) |

The opening is 30 s: night 0–14.4 s, the turn 14.45–15.8 s, day 15.3–30 s, ending on "Every peso, traced."
(on screen 27.2–29.95) and a one-second glide onto the architecture's Slips disc under the veil (29.0–30.0),
never on the name (see the README's outline).

## 7. The honesty tag

- **One component:** dashed steel border 2 px, 32 px text in a 64 px pill (about 11 px at 640 px wide; a 30 px
  icon, 14 px gap), white at 90% on day, navy at 72% on night, flask icon for PayPal. Never a sentence, never a
  badge cluster. Every part draws the same pill, so a tag that runs on across a cut (the sandbox tag at 44 s)
  does not change size.
- **"Simulated PayPal sandbox"** is on screen from the same frame that any PayPal value starts to appear (an
  amount, a payout, a rail) until the frame where none is legible (a veil ≥ 92% or the window gone). In a
  product run it stays on across the beats rather than following the keywords.
- **Where:** day: the bottom-right corner (right 64 px, top 960 px, its bottom 56 px off the edge). Lay out every
  shot and every glide so no window enters x > 1335 and y > 960 (`plan.mjs` `TAG`). Night: centred under the
  figure it labels.
- **One tag at a time:** hide a window's own sandbox chip in the crop when the frame tag is on. A tag comes in
  over 0.4 s from its start and leaves over 0.3 s (front-loaded) by its end, so where tags hand over at a cut
  (57, 73, 76.5, 83, 143 s) the old one is all but gone on the last frame and none pops off half-lit.
- **"Synthetic co-op"** once, with the first people count. Synthetic slips keep their printed SPECIMEN line;
  Claude's reading card keeps a "Synthetic sample" tag (same component) while it is the subject. The opening's
  card (17–18.6 s) is R1's recorded reading of slip 0403 (`packages/eval/report/R1.md`, 1 Nov 2026: Consolacion
  Bacus, M-014, net 38.45 kg), drawn in the product's style from the same synthetic master; so the first
  stand-in disclosure stays with the run's own replay.
- **The reading's labels are tags, not sentences:** "Real Claude reading · 1 Nov 2026" over the recorded
  exhibit, "Seed stand-in reading" over the run's replay. The full lines stay legible inside the captures.
- **One wording for the stand-in:** "Seed stand-in reading", word for word, wherever the film discloses it (the
  architecture's Claude node, the run's replay at 76.5–83 s, the close's "replayed."; `plan.mjs`
  `STAND_IN_TAG`). No "Demo:" prefix, no shorter form.
- No real farmers, real money or live PayPal claims; no third-party logos; "PayPal" appears only as text.

## 8. Captions

- Captions are a **closed-caption track** (WebVTT sidecar next to the MP4, e.g. `out/opening.en.vtt`, plus the
  YouTube upload's caption file), never burned into the picture. On screen there are only the kinetic words.
- Word for word with the narration, ≤ 2 lines of ≤ 42 characters, each cue 1–6 s, timed to the voice.
- Bracketed cues only when the sound carries meaning, e.g. `[Her statement plays in Cebuano]`.
- When there is no narration (as in this prototype), the track carries the on-screen words and the meaningful
  sounds so a screen reader or a muted viewer gets the same story.

## 9. Music and narration

- **Music bed from 0.0 s, the film's clock.** Near silence (a low pad) under the hairline and the first words; a
  pulse that starts with the slip's sound wave (5.5 s); tension under the doubled thread (7.6–9.6 s); release
  on "count it once." (9.7 s); the drop on the turn to daylight (14.5–15.8 s); calm and wide under the
  product run, with soft hits on the keywords (16.6, 20.2, 23.25 s) and on the trace's jade pulse (26.6 s);
  the end line opens out (27.2 s) and the bed runs on through the glide into the architecture: the film resolves
  once, on the end card. Glides ride the bed, they are not hits.
- **Narration is optional per beat**: the picture must explain the product without it. When used (Gemini TTS),
  the `problem` line sits over 1.4–14.4 s; the `solution` line opens with "Fair Split:" on the swell (14.45–15.8,
  the one word allowed over the turn: the narrator names the product as the day opens, now that the opening has
  no name card) and ends before the end line (27.2 s). Ducked music under the voice (18–22 dB, and out under the member's own sentence), never over
  a bumper's words, and the closed captions follow it word for word. Rough cut v5 (ADR-0018) records each line in Gemini TTS
  (Charon), aligns its words offline and places the clip (`script.ts` `NARRATION_AT`); `plan.mjs` `NARRATION_FIT`
  says where each line must sit in the picture ("Fair Split:" on the turn, the solution line ending before the end
  line, "Try to break it" on the reel's night cut), and the build refuses a miss.
- Sound design follows the metaphors: the slip's wave, the member's statement playing (23.8 s), the pulse.

## 10. Grain and delivery

- Grain over everything: an overlay noise canvas re-seeded every frame (deterministic), 34% at night, 20% by
  day. It dithers the night gradients, which must also use smooth multi-stop falloffs (no hard stop or kink).
- Render at CRF 14 or better so the darks survive a re-encode; check a night frame and a glow at full size.

## 11. Frame checklist

1. One idea, one metaphor, one accent.
2. ≤ 4 words outside windows; every readable window word ≥ 36 px; nothing smaller tries to be read.
3. The PayPal tag is on whenever a PayPal value is legible, and only one tag is on.
4. Nothing important within 64 px of the frame edge; the tag corner is clear; the keyword is at its anchor.
5. The camera is moving (drift, push or glide) and the windows float.
6. No flash above 3 Hz; no glow that bands.
