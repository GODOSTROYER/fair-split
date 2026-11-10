# Fair Split opening: motion prototype (30 s)

A prototype of the film's first 30 seconds in the owner's reference style
(`research/refs-1104/video-reference.md`): a motion-design product pitch with almost no
text, one accent per frame, a visual metaphor per idea, black then bright, calm floating
product windows and a smooth camera. It covers the opening only: script v4's problem and a
solution teaser (`video/script.ts`, beats `problem` and `solution`). The film project in
`video/` is untouched; this is its own HyperFrames project. The rules it follows, written so
a builder can apply them to the whole film, are in [`STYLE.md`](STYLE.md).

1920 × 1080, 30 fps, silent. Render: `out/opening.mp4` (git-ignored), contact sheet
`out/contact.png` (16 frames, one per beat).

## What each second shows

| Time        | Picture                                                                                                                                                                                                                                                          | Words on screen                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 0.0–1.3     | Night navy. A hairline draws across the frame, then collapses into a blinking cursor tick.                                                                                                                                                                       | none                                                               |
| 1.3–3.2     | "64" counts up in indigo. 24 slip fragments drift on three depth planes: two near ones sharp (the handwriting readable) at opposite corners, many soft ones behind.                                                                                              | 64 farmers. · tag Synthetic co-op                                  |
| 3.2–4.9     | The fragments keep drifting, with parallax and a slow turn.                                                                                                                                                                                                      | one shoebox of slips.                                              |
| 4.5–6.2     | The fragments fly into one glowing slip (0457, white original). A line leaves it as a sound wave.                                                                                                                                                                | none                                                               |
| 6.2–7.6     | The wave settles into one line that splits into 64 threads, each ending in a member dot. The camera drifts in.                                                                                                                                                   | none                                                               |
| 7.05–8.2    | The pink carbon slides out from behind the white slip. The camera pushes about 1.25× towards one member's thread; the other 63 dim to about 15%; her thread doubles in pink (steady, a slow shimmer) and ends in a ghost dot.                                    | one slip, twice. ("twice." pink, lower left)                       |
| 8.35–11.3   | A fine no rule allows: "−₱200" lands on another member's thread (8.35 s). Then "unseen." (10.0 s): the pink copy, its thread and the fine sink to a quarter in the dark while the camera eases back. Nothing is counted once before the turn (review v5 item 1). | a fine, no rule. · then unseen.                                    |
| 11.3–12.6   | The threads retract into their dots and the 64 dots fade where they are, as the voice says members cannot check their pay.                                                                                                                                       | none                                                               |
| 12.8–14.4   | A jade ring (radius 360) draws through them around a black disc holding the buyer's invoice.                                                                                                                                                                     | US$4,333.50 · one invoice. · tag Simulated PayPal sandbox          |
| 14.45–15.8  | The turn: the disc becomes a portal showing the morning field and the first window out of focus, then opens out to the whole frame.                                                                                                                              | none                                                               |
| 15.3–16.4   | Daylight: large soft light shapes and leaf shadows drift; the slip behind is still a blur.                                                                                                                                                                       | traced. (small, grey)                                              |
| 16.2–18.5   | Focus pull to slip 0403 (Consolacion Bacus, M-014). An indigo box draws round the handwritten 38.45; Claude's reading rises beside it (R1's recorded reading of this slip, 1 Nov 2026), large ("Read by Claude" at 37 px); a line joins the two.                 | read. · tag Synthetic sample (on the reading)                      |
| 18.55–20.65 | The camera glides (2.1 s, zooming out mid-move, with motion blur) to the split review, which stays deep and grey.                                                                                                                                                | tag Simulated PayPal sandbox, bottom right, from 19.0 s to 27.55 s |
| 20.2–21.6   | The one duplicate row lifts out of the table, sharp: the B and D slips, "Slip 0457 is here twice." (42 px), the indigo "Count it once" button pulses twice.                                                                                                      | checked. · tag                                                     |
| 21.75–23.75 | The camera glides (2.0 s) to the phone; the review fades out.                                                                                                                                                                                                    | tag                                                                |
| 23.2–24.7   | Nang Celing's phone, alone. A faint echo of the night's sound wave flows into the play button; her statement plays in Cebuano (pause icon, the waveform moves); the jade "Bayad na" pulses.                                                                      | paid. · tag                                                        |
| 24.8–25.9   | The pull-back: the phone settles right, the slip with Claude's reading settles left, the peso card rises between them, all on one line at one scale; a blurred, greyed copy over each leaves only 38.45, the sum and US$64.45 readable.                          | tag                                                                |
| 25.75–27.3  | The trace: a glowing indigo line with a travelling light leaves the 38.45, swings under into the peso card's slip chip (0403 lights, 43.69 underlined), then runs from the card's US$64.45 to the phone's and ends in one jade pulse.                            | tag                                                                |
| 26.95–29.0  | A daylight veil turns the windows to a ghost (92% by 27.35 s, so no PayPal value is legible when the tag goes, 27.35–27.55 s).                                                                                                                                   | Every peso, traced. ("traced." indigo, underlined)                 |
| 29.0–30.0   | The camera glides off the end line in one second (950 px with the zoom-out dip and motion blur) onto the architecture's Slips disc, waiting under the veil: the cut. No name card here; the name shows once, on the end card.                                    | Every peso, traced. (fades as it is carried out)                   |

Outside the windows there are never more than four words on screen.

## Visual language

- Colour: Hayag day and Gabii night tokens from `research/theme-1104/final/tokens.json`
  (`decision.md` §4–§8). Each colour keeps its one job: indigo `#4A2FD6` / `#9C8CFF` is a
  person's hand or Claude's reading (64 people, "once.", the reading box, the button, the
  trace, "traced."), pink is the carbon copy, jade `#14CC90` / `#3DE6AE` is money (the
  ring, "Bayad na", the trace's last pulse, the mark's dot). Product crops are rendered
  "quiet" (no chip lit, no underline, the yellow sticker replaced by the neutral tag, the
  slip photo at 50% saturation) and the film lights one thing at a time.
- Backdrops: night uses the Gabii glows with smooth multi-stop falloffs and a grain canvas
  re-seeded every frame (no banding); day uses the morning wash, three very large light
  shapes and out-of-focus leaf shadows (`assets/dapple.png`), all with parallax. No grid.
- Type: FS Sans (Mona Sans VF) wide 112.5 for words, condensed 75 / 800 for the amount
  with "US$" half size and raised to the cap height; proportional lining figures.
- Honesty: one designed dashed-steel tag (32 px words, 64 px pill). "Simulated PayPal
  sandbox" starts on the same frame as the invoice amount and stays on through the whole
  product run (19.0–27.55 s) in a corner no window crosses; the phone crop hides its own
  sandbox chip so only one tag shows. "Synthetic co-op" once, with "64 farmers.". The slips
  carry their own "SPECIMEN · SYNTHETIC DEMO PAD" line and Claude's reading a "Synthetic
  sample" tag. No logos; "PayPal" appears only as text.
- Motion: one paused GSAP timeline plus one deterministic driver (`draw(t)`) that computes
  the fragments, the threads (canvas), both cameras, the windows' float, tilt, depth-of-field
  and motion blur, the waveform, the trace and the grain from the time alone. Seeded PRNG only.

## Sources and placeholders

- `assets/slip-*.jpg`: paper cut from the synthetic slip masters in `media/masters`
  (Codex-made, synthetic) by `tools/crop-slips.py`.
- `assets/win-*.png`: single panels rendered from the Hayag target mock
  (`research/theme-1104/final/mock.html`) by `tools/render-mock.cjs`, which also restyles
  them for the film (no sentences, quiet chips, the duplicate row stacked so it can be large)
  and writes the anchor boxes the film uses to `tools/win-geometry.json`. **They are a design
  mock, not captures of the running product.** Replace them with F3's recordings of the
  re-skinned console (same names, same sizes); `WINS` and the anchor points in `index.html`
  assume these sizes. `win-read.png` (Claude's reading), `win-catch.png` (the duplicate row),
  `win-phone.png` (the member's statement), `win-peso-quiet.png` / `win-peso-lit.png` (tap a
  peso) and `win-split.png` (the review, as the deep background) are placed;
  `win-chair-phone.png` (two keys) and `win-proof.png` (Proof's six checks) are the spare
  windows for the "signed." and "proven." beats.
- `assets/dapple.png`: soft leaf shadows made by `tools/make-dapple.py` (seeded).
- Fonts: copies of `assets/fonts/web` with their OFL licences in `assets/fonts/`.

## Sound (not in this prototype)

- **Music bed:** one track from 0.0 s. Near silence (a low pad) under the hairline and
  the first words; a pulse from the slip's sound wave (5.5 s); tension under the doubled
  thread (7.05–9.1 s); the fine (8.35 s) and "unseen." (10.0 s); the drop on the turn to
  daylight (14.5–15.8 s); calm, wide second half with soft hits on the keywords and on the
  jade pulse (26.6 s); the end line opens out (27.2 s) and the bed runs on through the glide into the
  architecture (the film resolves once, on its end card).
- **Narration (optional, Gemini TTS):** the visuals carry the story without it. If used,
  script v4's `problem` line sits over 1.4–14.4 s and the `solution` line from "Fair Split:" on the
  swell (14.45 s) to before the end line (27.2 s; see `video/AUDIO-CUES.md`, "Fit to the picture"), ducked under the bed, with a closed-caption track instead of burned-in text
  (STYLE.md §8–§9).

## Rebuild and render

From the worktree root (Node 24, Python with numpy and opencv):

```bash
python video/proto/tools/crop-slips.py
python video/proto/tools/make-dapple.py
node video/proto/tools/render-mock.cjs        # uses an installed Playwright + cached Chromium
```

GSAP is loaded from `assets/vendor/gsap.min.js`, which is git-ignored: copy
`dist/gsap.min.js` from any installed `gsap` 3.15.0 package (`npm pack gsap@3.15.0`, or a
local `node_modules/gsap`). HyperFrames 0.8.157, offline, with the cached headless
Chromium (no browser download); `tools/env.sh` sets the environment:

```bash
cd video/proto
. tools/env.sh
$HF check .
$HF snapshot . --describe false --at 2.4,8.9,13.9,18.3,20.9,24.2,26.5,29.8
$HF render . --quality high --crf 14 --fps 30 --workers 4 --output out/opening.mp4
bash tools/contact.sh "$HYPERFRAMES_FFMPEG_PATH"
```

`check` passes (lint 0 errors and 4 warnings: the composition is one file, as the night,
day and ring layers share one driver; layout and contrast clean). CRF 14 keeps the grain
that dithers the night gradients.

## Next

- Swap the mock panels for F3 captures of the re-skinned product; keep their sizes.
- Add the "signed." beat (two keys on one hash, `win-chair-phone.png`) and let the trace
  end on Proof ("proven.", `win-proof.png`) before the end line.
- Score it: a music bed cut to the beats above, then optional narration with captions.
- Split the night, day and ring layers into sub-compositions for Studio editing.
