# Film close (script v4, 143–175 s)

A standalone HyperFrames project for the last 32 seconds of the film, in the film's own motion language
([`video/proto/STYLE.md`](../../proto/STYLE.md)): daylight throughout, on the same field as the reel before it,
one camera that glides along one line, one keyword or figure per frame, one honesty tag at a time in the
bottom-right corner, and the film's one name card at the end. Rebuilt after rough-cut review v2 (items 1–3): the
night card, the dot grid, the sentence chips, footnotes and marquee, the indigo highlight pills, the bloom iris,
the cacao branch and the five-tag ledger are gone. Reworked after rough-cut review v3 (items 2, 3 and 5): the
limits sit on their objects instead of an empty field, the dead air at 154 s and 166.6 s is gone, and the two
close-ups make 38.45 and US$64.45 the only readable product text in their frames.

| Part       | File                           | Film time | Close time | Picture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | ------------------------------ | --------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| impressive | `compositions/impressive.html` | 143–154   | 0–11       | The run's daylight veil lifts (0–0.7 s); "5,000+" lifts in over "automated tests" (0.3 s) inside a ring of 100 steel ticks, fifty tests each, that ink runs round clockwise (0.9–2.3 s, on "five thousand automated tests"); glide (2.35–4.4 s) to "3" over "kill switches" and three switch glyphs (`kill_payouts`, `kill_paypal_live`, `kill_ai_live`) that settle round the click at 4.4 s; a one-second glide (5.45–6.5 s, 794 px; review v4 item 5) to the handwritten weigh-slip, the 3 fading with the move (5.85–6.2 s) and the slip fading in as it crosses the right edge (5.6–5.95 s); its keyword "handwritten." (7.6 s). The camera pushes in about 2.5× on the Net row (7.95–9.6 s) while the slip's edges dissolve and the rest of it blurs, greys and fades into the field; only the Net row stays sharp, and the hand's indigo box is drawn from 38.45's own top-left corner both ways at once (9.1–9.6 s), padded inside the row's rules (review v4 item 4), so 38.45 is the one readable figure. No PayPal value, so no tag. |
| limits     | `compositions/limits.html`     | 154–164   | 11–21      | Timed to the recorded voice (ADR-0018). A pull-out glide (10.45–12.45 s) carries the camera from the slip to the first limit. Four limits, each a day keyword beside its object with its one tag: **simulated.** on the payout, the peso card's "Paid US$64.45" sharp (12.55 s; Simulated PayPal sandbox 11.0–15.1 s) · **synthetic.** on the co-op's 64 dots gathering into a ring beside three slip images resolving out of a blur, people and slips on one station (16.2 s; Synthetic people and slips; review v4 item 3 merged "generated." in) · **replayed.** on the reading, "38.45 ✓ Read by Claude", lifting out of the slips after a short push (17.95 s; Seed stand-in reading) · **synthesized.** on the statement's voice, an ink wave out of a play disc (19.45 s; Synthetic voices · Gemini TTS), carrying the chip "Cebuano: machine-translated, pending native review" from 19.6 s (review v5 item 3).                                                                                                                         |
| end        | `compositions/end.html`        | 164–175   | 21–32      | The glide into the overview carries the wave off (21–23.05 s): the slip, blurred out of reading, and the member's phone, blurred but for her US$64.45, on one line; sandbox tag on from 21.8 s. The hand's box, then the trace from the slip's 38.45 to her US$64.45 as the voice says "traces" (24.35–24.8 s; its voice starts at 164.6 s, review v5 item 10) and one jade pulse (24.8–25.5 s). Veil (26.55 s), "Every peso, **traced**." (26.95–29.45 s, 2.5 s on screen), then the name: the opening's mark, "Fair Split", "co-op payroll" (29.6 s to the last frame), with the voices' tag "Synthetic voices · Gemini TTS", the music's credit and "Cebuano: machine-translated, pending native review" from 30.0 s. The statement's wave carries the same machine-translation chip off the frame in the first glide.                                                                                                                                                                                                                       |

## What it follows

- **One turn.** No night here: the film's one night-to-day turn is in the opening. The close starts on the reel's
  day field (`film-slots.js`: the same light shapes, wash, leaf shadows, drift on the film clock and grain), so the
  cut in at 143 s needs no dip; the camera adds a gentle parallax on top.
- **Glides, not resets** (§5): 2.05 s (1.05 s out of the 3 and 1.3 s between the limits, travel cut to keep the peak), sine.inOut, a 0.3
  zoom-out dip at mid-move, centre travel ≤ 36 px a frame, directional motion blur keyed to the camera's speed on a
  container of its own; depth of field sharpens whatever reaches the centre. Holds push slowly (≤ 3%). An object the camera carries across the frame's left or right edge fades with the move (`rig.js` `place`: its opacity falls as its inked width passes the 64 px margin, gone once 30% of it is past the line; review v4 item 7), so no glide shows a window cut off at full strength. One camera
  and one world (`rig.js` `CAM`, `WORLD`) drive all three compositions, so they meet without a seam; objects at a
  frame edge when a glide starts or ends fade with the move.
- **Readable or blurred** (§2): `rig.js` `focus` blurs, greys and fades an object's image and keeps a sharp copy in
  a soft ellipse round the one figure that matters (38.45 on the slip, "Paid US$64.45" on the peso card, US$64.45
  on the phone), so smaller text never tries to be read.
- **Words** (§2): figures in FS Sans condensed 800 with a quiet grey line; day keywords at one anchor (x 140,
  top 150), mask wipe in 0.75 s, out 0.32 s, fading over its first 0.16 s and last 0.12 s so no descender tip is left in the
  mask (the last limit's wipe ends two frames before the cut); the end line and the name as in the opening. At most four words on
  screen outside a window, keyword plus tag included.
- **Accents** (§3): indigo only for the hand's box round a handwritten figure, Claude's reading (38.45 on the
  reading card), the trace and "traced."; jade only for money that arrived (the peso card's paid figure, the trace's
  pulse on her pay) and the mark's dot. The figures, keywords, the 64 dots and the wave are ink.
- **Honesty** (§7): one standard tag at a time (dashed steel, 32 px in a 64 px pill, right 64 px, top 960 px, flask
  for PayPal only), no window enters x > 1335 and y > 960. "Simulated PayPal sandbox" is on while the phone's
  amounts can show (21.8 s until the veil hides them) and with the first limit while the peso card is on screen
  (11.0–15.1 s). The slip keeps its printed SPECIMEN line. Her statement's language is disclosed in one wording,
  "Cebuano: machine-translated, pending native review" (`FILM.translationDisclosure`, review v5 item 3): on the
  statement's voice in the last limit (a 40 px chip from 19.6 s that rides into the end's glide, about 39 px on
  screen under the camera), on the end card (38 px), in the captions' bracket over her sentence (one cue with her
  first words), on the Paminawa transcript in the listening beat (38 px), in the limits card's data, CREDITS.txt,
  LICENSES.md and the upload's description. The narration says "Gemini TTS voices"; the end card carries the voices' tag "Synthetic voices ·
  Gemini TTS". The provenance of the slip images (Codex-made hero flats, photos composed in code) and the ten real
  readings of 1 Nov 2026 are in `FILM.descriptionDisclosure` and the limits card's data, not spoken or on screen.
- Captions are a closed-caption track only: `close.vtt` (the cues of `video/captions.vtt` from 143 s, shifted by
  −143 s; written by `video/build.mjs`), muxed into `out/close.mp4` as a soft `mov_text` stream.

## Editing

`rig.js` (the camera, the day field, world objects with float, depth of field, motion blur, grain) and `rig.css`
(the shared look) are the one source for all three compositions: edit them, then run `node build.mjs`, which copies
them into each composition between its `rig:begin` / `style:begin` markers so every template stays self-contained.
Times in `rig.js` are close time (film − 143 s); each composition's own tweens are in its local time.

## Run

From this folder, with the cached Playwright Chromium (never download a browser):

```powershell
$env:npm_config_prefer_offline = 'true'
$env:HYPERFRAMES_NO_UPDATE_CHECK = '1'
$env:HYPERFRAMES_BROWSER_PATH = "$env:LOCALAPPDATA/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe"
$env:HYPERFRAMES_FFMPEG_PATH = 'C:/Users/user/AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe'
node build.mjs
npx --yes hyperframes@0.8.157 lint .
npx --yes hyperframes@0.8.157 snapshot . --describe false --at 1.2,3.4,7.4,8.8,9.9,11.4,12.8,15.6,18.3,20.3,23.2,24.6,26.85,28.4,31.95
npx --yes hyperframes@0.8.157 render . --fps 30 --workers 4 --output out/close-picture.mp4
ffmpeg -i out/close-picture.mp4 -i close.vtt -map 0:v -map 1:s -c:v copy -c:s mov_text -metadata:s:s:0 language=eng out/close.mp4
```

`out/` and `.hyperframes/` are git-ignored (`video/.gitignore`).

## Sources

- `assets/fonts/FSSans-VF.woff2`: copy of `video/assets/fonts/FSSans-VF.woff2` (Mona Sans, renamed FS Sans; SIL OFL 1.1, `assets/licences/OFL-MonaSans.txt`).
- `assets/vendor/gsap.min.js`: GSAP 3.15.0, from the HyperFrames 0.8.157 skill bundle (GreenSock standard no-charge licence, header kept). The only additions are two Biome suppression comments; the minified code is unchanged.
- `assets/slip-0403.jpg`, `assets/slip-0436.jpg`, `assets/slip-0458.jpg`, `assets/win-phone.png`, `assets/win-peso-quiet.png`, `assets/win-read.png`, `assets/dapple.png`: copies of the opening's `video/proto/assets` files (the synthetic slips cut from the Codex-made masters and composed photos, the member's statement, the quiet peso card and the reading card rendered from the Hayag mock by `proto/tools/render-mock.cjs`, the seeded leaf shadows from `proto/tools/make-dapple.py`; see `video/LICENSES.md`). The mock panels are replaced when F3's captures land.
- Everything else is drawn in code: the light fields, the hand's box, the 64 dots, the wave and its play disc, the trace and its pulse, the mark and the grain. No photos of people, no logos, no third-party artwork.
