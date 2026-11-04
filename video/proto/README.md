# Fair Split opening: motion prototype (30 s)

A prototype of the film's first 30 seconds in the owner's reference style
(`research/refs-1104/video-reference.md`): a motion-design product pitch with almost no
text, one accent per frame, a visual metaphor per idea, black then bright, calm floating
product windows and a smooth camera. It covers the opening only: script v4's problem and a
solution teaser (`video/script.ts`, beats `problem` and `solution`). The film project in
`video/` is untouched; this is its own HyperFrames project.

1920 × 1080, 30 fps, silent. Render: `out/opening.mp4` (git-ignored), contact sheet
`out/contact.png`.

## What each second shows

| Time      | Picture                                                                                                                                                                                | Words on screen                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 0.0–1.4   | Night navy. A hairline draws across the frame; a cursor tick blinks twice.                                                                                                             | none                                               |
| 1.4–3.2   | "64" counts up in indigo; blurred slip fragments drift in the dark.                                                                                                                    | 64 farmers. · tag Synthetic co-op                  |
| 3.2–4.9   | The fragments keep drifting.                                                                                                                                                           | one shoebox of slips.                              |
| 4.9–6.2   | The fragments fly into one glowing slip (0457, white original). A line leaves it as a sound wave.                                                                                      | none                                               |
| 6.2–7.6   | The wave settles into one line that splits into 64 threads, each ending in a member dot.                                                                                               | none                                               |
| 7.6–9.6   | The pink carbon slides out from behind the white slip; the other 63 threads dim, one member's thread doubles in pink and flickers, with a ghost dot.                                   | one pink copy.                                     |
| 9.7–11.3  | The pink thread retracts into its ghost, the ghost merges into the real dot, the thread turns indigo and an indigo ring (a person's hand) holds on the dot.                            | count it once.                                     |
| 11.3–13.0 | All threads retract into their dots; the 64 dots gather into a ring where they stand, turn jade and glide, turning, to the centre.                                                     | none                                               |
| 12.8–14.4 | A jade ring draws through them around a black disc holding the buyer's invoice.                                                                                                        | US$4,333.50 · tag Simulated PayPal sandbox         |
| 14.4–15.8 | The turn: the disc fills with daylight and opens out to the whole frame (Hayag morning light).                                                                                         | none                                               |
| 15.3–16.7 | Daylight, a faint dot grid.                                                                                                                                                            | traced. (small, grey)                              |
| 16.5–19.0 | Window 1, slip 0403 (Consolacion Bacus, M-014). An indigo box draws round the handwritten 38.45, a line runs to Claude's reading card.                                                 | read.                                              |
| 19.0–20.5 | The camera glides (zooming out mid-move) down to window 2.                                                                                                                             | none                                               |
| 20.5–21.9 | Split review: the dial (2.05% to 1.62%) and the row "Slip 0457 is here twice"; the indigo "Count it once" slab pulses.                                                                 | checked. · tag Simulated PayPal sandbox            |
| 21.9–23.3 | The camera glides up to window 3.                                                                                                                                                      | tag                                                |
| 23.3–24.8 | Nang Celing's phone: "Bayad na", US$64.45; its jade pill pulses. The "Tap a peso" card floats beside it.                                                                               | paid. · tag                                        |
| 24.8–26.7 | The camera pulls back; the windows settle; one indigo trace draws from Claude's reading to the peso card's slip chip (0403, 38.45 kg), then from its US$64.45 to the phone's US$64.45. | tag                                                |
| 26.9–28.4 | The windows blur to a ghost under a daylight veil (no PayPal value stays legible, so the tag goes).                                                                                    | Every peso, traced. ("traced." indigo, underlined) |
| 28.5–30.0 | The mark builds (jade dot, then its three threads draw), then the name.                                                                                                                | Fair Split · co-op payroll                         |

Outside the windows there are never more than four words on screen.

## Visual language

- Colour: Hayag day and Gabii night tokens from `research/theme-1104/final/tokens.json`
  (`decision.md` §4–§8). Each colour keeps its one job: indigo `#4A2FD6` / `#9C8CFF` is a
  person's hand (64 people, "once.", the reading box, "traced."), pink is the carbon
  copy, jade `#14CC90` / `#3DE6AE` is money (the ring, "Bayad na", the mark's dot). The
  night frames use the Gabii film-card glows; the day frames use the "morning light" wash.
- Type: FS Sans (Mona Sans VF) wide 112.5 for words, condensed 75 / 800 for the amount
  with "US$" half size and raised; proportional lining figures.
- Honesty: one designed dashed-steel tag, "Simulated PayPal sandbox", whenever a PayPal
  value is on screen (the invoice ring, the split review, the phone, the overview), and
  "Synthetic co-op" once, with "64 farmers.". The slips carry their own "SPECIMEN ·
  SYNTHETIC DEMO PAD" line and the reading card its "Synthetic sample" tag. No logos;
  "PayPal" appears only as text.
- Motion: one paused GSAP timeline plus one deterministic driver (`draw(t)`) that computes
  the threads (canvas), the fragments, the camera with parallax (dot grid at 0.55) and the
  windows' float, tilt and depth-of-field blur from the time alone. Seeded PRNG only.

## Sources and placeholders

- `assets/slip-*.jpg`: paper cut from the synthetic slip masters in `media/masters`
  (Codex-made, synthetic) by `tools/crop-slips.py`.
- `assets/win-*.png`: single panels rendered at 2× / 3× from the Hayag target mock
  (`research/theme-1104/final/mock.html`) by `tools/render-mock.cjs`. **They are a design
  mock, not captures of the running product.** Replace them with F3's recordings of the
  re-skinned console (same names, same sizes) when those exist; the camera and the trace
  coordinates in `index.html` (`WINS`, `#trace`, `#hl`) assume these sizes.
  `win-chair-phone.png` (two keys) and `win-proof.png` (Proof's six checks) are rendered
  but not yet placed: they are the spare windows for "signed." and "proven." beats.
- Fonts: copies of `assets/fonts/web` with their OFL licences in `assets/fonts/`.

## Sound (not in this prototype)

- **Music bed:** one track from 0.0 s. Near silence (a low pad) under the hairline and
  the first words; a pulse from the slip's sound wave (5.5 s); tension under the pink
  flicker (7.6–9.6 s); a release on "count it once." (9.7 s); the drop on the turn to
  daylight (14.5–15.8 s); calm, wide second half; resolve on the name (28.5 s).
- **Narration (optional, Gemini TTS):** the visuals carry the story without it. If used,
  script v4's `problem` line sits over 1.4–14.4 s and a shortened `solution` line over
  16.5–26.7 s, ducked under the bed, with a closed-caption track instead of burned-in text.

## Rebuild and render

From the worktree root (Node 24, Python with numpy and opencv):

```bash
python video/proto/tools/crop-slips.py
node video/proto/tools/render-mock.cjs        # uses an installed Playwright + cached Chromium
```

GSAP is loaded from `assets/vendor/gsap.min.js`, which is git-ignored: copy
`dist/gsap.min.js` from any installed `gsap` 3.15.0 package (`npm pack gsap@3.15.0`, or a
local `node_modules/gsap`). HyperFrames 0.8.157, offline, with the cached headless
Chromium (no browser download):

```bash
export npm_config_prefer_offline=true HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_NO_AUTO_INSTALL=1 DO_NOT_TRACK=1
export HYPERFRAMES_BROWSER_PATH="$LOCALAPPDATA/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe"
export HYPERFRAMES_FFMPEG_PATH=C:/Users/user/AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe
export HYPERFRAMES_FFPROBE_PATH=C:/Users/user/AppData/Local/Microsoft/WinGet/Links/ffprobe.exe
cd video/proto
npx --yes hyperframes@0.8.157 lint .
npx --yes hyperframes@0.8.157 snapshot . --describe false --at 2.4,8.9,13.9,18.4,26.8,29.8
npx --yes hyperframes@0.8.157 render . --quality high --fps 30 --workers 4 --output out/opening.mp4
bash tools/contact.sh "$HYPERFRAMES_FFMPEG_PATH"
```

Lint reports 0 errors and 5 warnings: the composition is one file (night, day and ring
layers share one driver), and slip 0403 is used twice (a fragment and window 1).

## Next

- Swap the mock panels for F3 captures of the re-skinned product; keep their sizes.
- Add the "signed." beat (two keys on one hash, `win-chair-phone.png`) and let the trace
  end on Proof ("proven.", `win-proof.png`) before the end line.
- Score it: a music bed cut to the beats above, then optional narration with captions.
- Fast camera glides (19.0–20.5 s, 21.9–23.3 s) would gain from a light motion blur.
- Split the night, day and ring layers into sub-compositions for Studio editing.
