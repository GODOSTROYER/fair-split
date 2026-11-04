# Film close (script v4, 143–175 s)

A standalone HyperFrames project for the last 32 seconds of the film, in the film's own motion language
([`video/proto/STYLE.md`](../../proto/STYLE.md)): daylight throughout, on the same field as the reel before it,
one camera that glides along one line, one keyword or figure per frame, one honesty tag at a time in the
bottom-right corner, and the film's one name card at the end. Rebuilt after rough-cut review v2 (items 1–3): the
night card, the dot grid, the sentence chips, footnotes and marquee, the indigo highlight pills, the bloom iris,
the cacao branch and the five-tag ledger are gone. Reworked after rough-cut review v3 (items 2, 3 and 5): the
limits sit on their objects instead of an empty field, the dead air at 154 s and 166.6 s is gone, and the two
close-ups make 38.45 and US$64.45 the only readable product text in their frames.

| Part       | File                           | Film time | Close time | Picture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------ | --------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| impressive | `compositions/impressive.html` | 143–154   | 0–11       | The run's daylight veil lifts (0–0.7 s); "5,000+" lifts in over "automated tests" (0.3 s); glide (2.35–4.4 s) to "3" over "kill switches"; glide (5.45–7.5 s) to the handwritten weigh-slip and its keyword "handwritten." (7.6 s). The camera pushes in about 2.5× on the Net row (7.95–9.6 s) while the slip's edges dissolve and the rest of it blurs, greys and fades into the field; the hand's indigo box closes round the handwritten 38.45 (9.1 s), 47 px tall, the one readable figure. No PayPal value, so no tag.                                                                                                                                                                                                                                                                                                                                                                                                            |
| limits     | `compositions/limits.html`     | 154–167   | 11–24      | A pull-out glide (10.45–12.45 s, the zoom cleared in its first 60%) carries the camera from the slip to the first limit; no empty field. Each limit is a day keyword beside the object it qualifies, with its one tag, glides of 1.3 s between: **simulated.** on the payout, the peso card's "Paid US$64.45" sharp and the rest of the sum blurred (12.2 s; Simulated PayPal sandbox from the frame the card appears, 11.0 s, until it has gone, 15.05 s) · **synthetic.** on the co-op's 64 dots gathering into a ring round "64" (14.85 s; Synthetic co-op) · **generated.** on three slip images resolving out of a blur (17.6 s; Generated slip images) · **replayed.** on the reading, "38.45 ✓ Read by Claude", lifting out of the slips while they go to the deep plane (19.3 s; Seed stand-in reading) · **synthesized.** on the statement's voice, an ink wave out of a play disc (22.25 s; Gemini TTS · machine-translated). |
| end        | `compositions/end.html`        | 167–175   | 24–32      | The glide into the overview carries the wave off (24–26.05 s): the slip, blurred out of reading, and the member's phone, blurred but for her US$64.45, on one line; sandbox tag on from 24.8 s. The hand's box, then the trace from the slip's 38.45 to her US$64.45 (26.4–26.85 s) and one jade pulse (26.85–27.55 s), US$64.45 the one legible product text in the frame. Veil (27.4 s), "Every peso, **traced**." (27.6–29.1 s), then the name: the opening's mark, "Fair Split", "co-op payroll" (28.95 s to the last frame), with the voices' tag "Synthetic voices · Gemini TTS" from 30.0 s.                                                                                                                                                                                                                                                                                                                                     |

## What it follows

- **One turn.** No night here: the film's one night-to-day turn is in the opening. The close starts on the reel's
  day field (`film-slots.js`: the same light shapes, wash, leaf shadows, drift on the film clock and grain), so the
  cut in at 143 s needs no dip; the camera adds a gentle parallax on top.
- **Glides, not resets** (§5): 2.05 s (1.3 s between the limits, travel cut to keep the peak), sine.inOut, a 0.3
  zoom-out dip at mid-move, centre travel ≤ 36 px a frame, directional motion blur keyed to the camera's speed on a
  container of its own; depth of field sharpens whatever reaches the centre. Holds push slowly (≤ 3%). One camera
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
  amounts can show (24.8 s until the veil hides them, 27.8 s) and with the first limit while the peso card is on
  screen (11.0–15.05 s). The slip keeps its printed
  SPECIMEN line. The long disclosures (Codex-made slip flats, the ten real readings of 1 Nov 2026, Cebuano and Filipino
  pending native review, the full voice line) are in the narration, the closed captions and the upload's description
  (`FILM.descriptionDisclosure`), not on screen. The end card carries the voices' tag (the decision register
  discloses the narration in the captions, the end card and the description).
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
