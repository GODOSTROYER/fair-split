# Film close (script v4, 143–175 s)

A standalone HyperFrames project for the last 32 seconds of the film, built to the owner's motion
reference (`research/refs-1104/video-reference.md`): kinetic 2–4 word type, one accent per frame,
black first then bright, calm light fields, no burned-in captions. Palette: Hayag (light) and the
Gabii night film card, from `research/theme-1104/decision.md`.

| Part       | File                           | Film time | Local | Outline                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------ | --------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| impressive | `compositions/impressive.html` | 143–154   | 0–11  | Night card. 5,016 dots (one per Vitest case) light up behind "5,000+ automated **tests**"; "3 **kill** switches" flip off (payouts · simulated PayPal calls · slip reading), "every replay [labelled]"; scattered arcs: "Others we found share parts."; one kinetic line the camera rides, "None we found starts from a handwritten **weigh-slip**", pulls back, then blooms into daylight. |
| limits     | `compositions/limits.html`     | 154–167   | 0–13  | Daylight. "the limits." small and grey, then one disclosure at a time: **Simulated** PayPal. / **Synthetic** people. / **Generated** slips. / A **labelled** stand-in. / **Synthetic** voices. Each carries its exact script v4 sentence in a dashed honesty tag, then files itself as a chip in the top ledger.                                                                            |
| end        | `compositions/end.html`        | 167–175   | 0–8   | The brightest frame. A pencil thread runs slip → members ✓ → buyer ✓, steps back, then "Every peso, **traced**." with a hand-drawn underline, then "Fair Split" / "Audited co-op payroll on PayPal". A code-drawn cacao branch draws itself; the ledger (with the Gemini TTS voice disclosure) holds to the last frame.                                                                     |

The "Simulated PayPal sandbox" tag is on screen in every frame (top left, the ledger's first chip).
Captions are a closed-caption track only: `close.vtt` (the cues of `video/captions.vtt` from 143 s, shifted by
−143 s; written by `video/build.mjs`), muxed into `out/close.mp4` as a soft `mov_text` stream. The film mounts
these three compositions in place at 143, 154 and 167 s.

## Run

From this folder, with the cached Playwright Chromium (never download a browser):

```powershell
$env:npm_config_prefer_offline = 'true'
$env:HYPERFRAMES_NO_UPDATE_CHECK = '1'
$env:HYPERFRAMES_BROWSER_PATH = "$env:LOCALAPPDATA/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe"
$env:HYPERFRAMES_FFMPEG_PATH = 'C:/Users/user/AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe'
npx --yes hyperframes@0.8.157 check .
npx --yes hyperframes@0.8.157 snapshot . --describe false --at 1.6,4.6,6.6,10.3,12.6,20,23,27.9,31.9
npx --yes hyperframes@0.8.157 render . --fps 30 --workers 4 --output out/close-picture.mp4
ffmpeg -i out/close-picture.mp4 -i close.vtt -map 0:v -map 1:s -c:v copy -c:s mov_text -metadata:s:s:0 language=eng out/close.mp4
```

`out/` and `.hyperframes/` are git-ignored (`video/.gitignore`).

## Sources

- `assets/fonts/FSSans-VF.woff2`: copy of `video/assets/fonts/FSSans-VF.woff2` (Mona Sans, renamed FS Sans; SIL OFL 1.1, `assets/licences/OFL-MonaSans.txt`).
- `assets/vendor/gsap.min.js`: GSAP 3.15.0, from the HyperFrames 0.8.157 skill bundle (GreenSock standard no-charge licence, header kept). The only additions are two Biome suppression comments; the minified code is unchanged.
- Everything else is drawn in code: dot field, switches, arcs, slip glyph, icons, cacao branch, light fields and grain. No photos, logos or third-party artwork.
