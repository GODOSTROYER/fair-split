# Film close (script v4, 143–175 s)

A standalone HyperFrames project for the last 32 seconds of the film, in the film's own motion language
([`video/proto/STYLE.md`](../../proto/STYLE.md)): daylight throughout, on the same field as the reel before it,
one camera that glides along one line, one keyword or figure per frame, one honesty tag at a time in the
bottom-right corner, and the film's one name card at the end. Rebuilt after rough-cut review v2 (items 1–3): the
night card, the dot grid, the sentence chips, footnotes and marquee, the indigo highlight pills, the bloom iris,
the cacao branch and the five-tag ledger are gone.

| Part       | File                           | Film time | Close time | Picture                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------- | ------------------------------ | --------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| impressive | `compositions/impressive.html` | 143–154   | 0–11       | The run's daylight veil lifts (0–0.7 s); "5,000+" lifts in over "automated tests" (0.3 s); glide (2.35–4.4 s) to "3" over "kill switches"; glide (5.45–7.5 s) to the handwritten weigh-slip, keyword "handwritten." (7.75 s), and the hand's indigo box round its handwritten 38.45 (9.6 s). No PayPal value, so no tag.                                                                                                                                            |
| limits     | `compositions/limits.html`     | 154–167   | 11–24      | The camera glides on into the open field (10.65–12.7 s) and "the limits." settles, small and grey. Then one limit at a time while it is said, a keyword and its one tag: simulated. (Simulated PayPal sandbox) · synthetic. (Synthetic co-op) · generated. (Generated slip images) · replayed. (Seed stand-in reading) · synthesized. (Gemini TTS · machine-translated).                                                                                            |
| end        | `compositions/end.html`        | 167–175   | 24–32      | Glide into the overview: the slip and the member's phone on one line (24–26.05 s), sandbox tag on from 24.8 s. The hand's box, then the trace from the handwritten 38.45 to her US$64.45 (26.4–26.85 s) and one jade pulse (26.85–27.55 s). Veil (27.4 s), "Every peso, **traced**." (27.6–29.1 s), then the name: the opening's mark, "Fair Split", "co-op payroll" (28.95 s to the last frame), with the voices' tag "Synthetic voices · Gemini TTS" from 30.0 s. |

## What it follows

- **One turn.** No night here: the film's one night-to-day turn is in the opening. The close starts on the reel's
  day field (`film-slots.js`: the same light shapes, wash, leaf shadows, drift on the film clock and grain), so the
  cut in at 143 s needs no dip; the camera adds a gentle parallax on top.
- **Glides, not resets** (§5): 2.05 s, sine.inOut, a 0.3 zoom-out dip at mid-move, directional motion blur keyed
  to the camera's speed on a container of its own; depth of field sharpens whatever reaches the centre. Holds push
  slowly (≤ 2.5%). One camera function of close time drives all three compositions, so they meet without a seam.
- **Words** (§2): figures in FS Sans condensed 800 with a quiet grey line; day keywords at one anchor (x 140,
  top 150), mask wipe in 0.75 s, out 0.32 s; the end line and the name as in the opening. At most four words on
  screen outside a window, keyword plus tag included.
- **Accents** (§3): indigo only for the hand's box round a handwritten figure, the trace and "traced."; jade only
  for the trace's pulse on her pay and the mark's dot. The figures, keywords and limits carry no accent.
- **Honesty** (§7): one standard tag at a time (dashed steel, 28 px in a 56 px pill, right 64 px, top 968 px, flask
  for PayPal only), no window enters x > 1396 and y > 960. "Simulated PayPal sandbox" is on while the phone's
  amounts can show (24.8 s until the veil hides them, 27.8 s) and as the first limit. The slip keeps its printed
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
npx --yes hyperframes@0.8.157 snapshot . --describe false --at 1.2,3.4,4.8,8.6,10.3,12.0,13.6,17.5,22.8,24.9,27.05,28.4,31.95
npx --yes hyperframes@0.8.157 render . --fps 30 --workers 4 --output out/close-picture.mp4
ffmpeg -i out/close-picture.mp4 -i close.vtt -map 0:v -map 1:s -c:v copy -c:s mov_text -metadata:s:s:0 language=eng out/close.mp4
```

`out/` and `.hyperframes/` are git-ignored (`video/.gitignore`).

## Sources

- `assets/fonts/FSSans-VF.woff2`: copy of `video/assets/fonts/FSSans-VF.woff2` (Mona Sans, renamed FS Sans; SIL OFL 1.1, `assets/licences/OFL-MonaSans.txt`).
- `assets/vendor/gsap.min.js`: GSAP 3.15.0, from the HyperFrames 0.8.157 skill bundle (GreenSock standard no-charge licence, header kept). The only additions are two Biome suppression comments; the minified code is unchanged.
- `assets/slip-0403.jpg`, `assets/win-phone.png`, `assets/dapple.png`: copies of the opening's `video/proto/assets` files (the synthetic slip 0403 cut from the Codex-made masters, the member's statement rendered from the Hayag mock by `proto/tools/render-mock.cjs`, the seeded leaf shadows from `proto/tools/make-dapple.py`; see `video/LICENSES.md`).
- Everything else is drawn in code: the light fields, the hand's box, the trace and its pulse, the mark and the grain. No photos of people, no logos, no third-party artwork.
