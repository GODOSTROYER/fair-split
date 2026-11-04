# Fair Split film · script v4 assembly (rough cut v2)

1920 × 1080, 30 fps, 175 seconds (2:55). A product video in three parts
(ADR-0017), all generated from `script.ts`: 17 scene compositions, the caption
phrases, chapters, capture slots and every disclosure. The selected reading is
`real-reading`: one tile of R1's hero-slip exhibit (slip 0403), captioned only
while that clip plays, then the run's own slip 0462 by hand under its seed
stand-in label.

| Part      | Time      | Beats                                                                                                                                                                                                                                                       |
| --------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview  | 0:00–0:57 | the problem (card), how Fair Split solves it (card), the architecture (animated original SVG, narrated 30–41 s, then held whole), a highlight reel of what is special on the site, each clip cut in on the words that name it                               |
| Deep dive | 0:57–2:34 | a bumper ("The deep dive: one season, step by step"), the paper and the pink carbon, funding, reading, count it once, holds and the frozen rate card, two keys, payouts and cash, Proof, the member's peso and her Cebuano sentence, why it holds up (card) |
| Close     | 2:34–2:55 | limits and disclosures (card), impact and the end card                                                                                                                                                                                                      |

This is a **silent assembly draft**: every missing recording is a labelled capture
slot. Narration and the isolated member sentence arrive in F4. No music, product
sound, simulated UI screenshots, fabricated metrics or invented evidence is used.
Caption timing, card lines, architecture steps and reel cuts are proportional to
the script's word count within each beat's speech window (`speech`, or the whole
beat) until F4 supplies alignment; caption words are already exact, including the
Cebuano line. Captions are split into near-equal phrases of at most 78 characters
that break at punctuation where they can. Colours belong to `film.css`; the
script carries none, so a new look restyles the film without touching its words.

Run from this worktree's root with Node 24 and the already installed dependencies:

```powershell
node video/build.mjs
node video/check.mjs
$env:npm_config_prefer_offline = 'true'
$env:npm_config_offline = 'true'
$env:HYPERFRAMES_NO_UPDATE_CHECK = '1'
$env:HYPERFRAMES_NO_AUTO_INSTALL = '1'
$env:DO_NOT_TRACK = '1'
$env:HYPERFRAMES_BROWSER_PATH = "$env:LOCALAPPDATA/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe"
$env:HYPERFRAMES_FFMPEG_PATH = 'C:/Users/user/AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe'
$env:HYPERFRAMES_FFPROBE_PATH = 'C:/Users/user/AppData/Local/Microsoft/WinGet/Links/ffprobe.exe'
npx --yes hyperframes@0.8.157 lint video
npx --yes hyperframes@0.8.157 check video
npx --yes hyperframes@0.8.157 snapshot video --describe false --no-end --at 7,27,42,45,150,165,172
npx --yes hyperframes@0.8.157 preview video --background --port 4582
npx --yes hyperframes@0.8.157 render video --quality draft --fps 30 --workers 1 --output video/out/rough-cut-v2.mp4
```

Use an existing cached Chromium binary if that cache version is different. Never
run a browser download. Pass `--describe false` to `snapshot` so no frame leaves
the machine. Studio's timeline is editable; stop its server when done:
`npx --yes hyperframes@0.8.157 preview video --stop`. HyperFrames lint warns that
the architecture and highlight scenes have dense tracks (six timed steps or clips
each); that is the animation, not an error. HyperFrames check's layout pass flags
placeholder text running under a reel label or a persona lower third; the
recorded captures replace those placeholders.

## Cards and the architecture

Card beats (`card` in `script.ts`) are original typography with no capture slot:
the problem, the solution, the architecture, why it holds up, the limits and the
end card. Each card line appears on the narration word it belongs to and stays to
the end of its beat. The architecture is drawn from `ARCHITECTURE`'s boxes and
arrows only, built up in its `reveal` order: each step is one full SVG layer, the
step's new boxes and arrows drawn heavier. The narration ends at 41 s, so the
finished ten-box diagram holds for 3.5 s before the highlight reel.
`assets/architecture.svg` is the whole diagram. No logos or third-party artwork.

A beat's `show` lines hold for the whole beat. A line that belongs to one clip is
that slot's `overlay` and appears and leaves with the clip: R1's caption "Claude's
real reading of this slip, recorded 1 Nov 2026" sits only over the exhibit clip
(the check refuses it anywhere else, and refuses a stand-in label over it), and the
run's "Seed stand-in, not a Claude recording" only over slip 0462 by hand. A part
with a `bumper` shows it for 1.5 s over its first beat.

## F3 capture handoff

`captures.json` is generated from the script's `CAPTURES` and is the complete slot
manifest: stable ID and relative filename, beat, absolute start/duration, source
(`console film mode`, `phone recording` or `Proof in the browser`), the moment or
screen (`state`), `shows` (the on-screen state to record), the terminal phase
selector, the synthetic persona, the highlight reel's on-screen `label` (five
words or fewer), the narration `word` a clip cuts in on, the clip's own evidence
`overlay`, the `reference` screenshot of that state on the real judge path
(research/design-1104, outside this repo; the check confirms each file exists when
that folder sits beside the checkout) and the beat's requirements. Phone
recordings must show a real human co-signing. Phase selectors describe the target
state, not a claim that current film mode exists. Three of the 22 slots have no
reference yet because design-1104 never recorded them: the exhibit tile
(`reading-console`), the Chair's physical phone (`signing-phone`) and the Paminawa
panel, M-MB-03 (`listening-phone`).
1. Record the state and any transition described in the slot's `shows` and
   `requirements`. Keep the script's replay/stand-in chips visible. Capture
   unasserted moments in reduced motion. The highlight reel (44–57) reuses the deep
   dive's states in clips of 1.8–3.3 s, each starting as the narration names its
   feature (the check holds every `word` cut to 0.3 s); crop as `shows` says.
2. Put the MP4 at exactly `video/captures/<slot-id>.mp4`. Captures and renders are
   ignored by `video/.gitignore`; do not add them to Git. The builder selects a
   video only when that file exists; otherwise it emits the visible placeholder.
3. Optionally set `mediaStart` (seconds) and `playbackRate` (1 or 12) in the manifest.
   Regeneration preserves those two values. A 12× capture gets `×12 real time`;
   unaccelerated placeholders carry no acceleration claim. Keep source coverage
   at least `mediaStart + duration × playbackRate`; never speed up human signing
   (the check refuses it for the signing beat and every MM-5 slot).
4. Rerun build/check, HyperFrames check and inspect every scene midpoint and cue
   boundary. The build keeps product sound muted. F4 must play only the matching
   IC-11 PREMIUM member sentence (8.44 s), alone in the listening beat at 134–143,
   and must align narration without changing F1's beat boundaries. Do not attach
   the full member audio under narration.

The overlay keeps `Simulated PayPal sandbox` on every scene and persona lower thirds
on deep-dive capture slots. Capture originals must also keep that label **beside
values**; the film overlay does not license cropping away an in-product label.
Funding's invoice is a seed-written placeholder; statements are hand-written
templates; the audit agent remains paused. Cebuano carries the exact
machine-translation label. The opening disclosure holds through the problem beat
(0–14 seconds); the closing voice disclosure holds through the end card (167–175),
and the limits card (154–167) shows every disclosure while the narration names the
simulated sandbox, the synthetic people, the stand-in reading and the voices.

Fonts are copied byte-for-byte from repo assets; see `LICENSES.md`. No external
requests or dependencies are needed by the authored composition. The
duration-driven static compositions declare `data-no-timeline`; HyperFrames owns
clip visibility and media seeking. The assembly needs no GSAP or CDN. Run Biome on
the committed paths, excluding ignored `out/` and `.hyperframes/` tool artifacts.
`build.mjs` formats its JSON with the repo's installed Biome.
