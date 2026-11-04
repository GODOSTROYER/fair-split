# Fair Split film · rough cut v1

1920 × 1080, 30 fps, 170 seconds. The 12 scene compositions, 24 caption phrases,
chapters and all disclosures are generated from `script.ts`. F1's spoken lines and
times are unchanged. The selected reading is `stand-in`.

This is a **silent assembly draft**: every missing recording is a labelled capture
slot. Narration and the isolated member sentence arrive in F4. No music, product
sound, simulated UI screenshots, fabricated metrics or invented evidence is used.
Caption timing is proportional to the script's word count within each beat until
F4 supplies alignment; caption words are already exact, including the Cebuano line.

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
npx --yes hyperframes@0.8.157 preview video --background --port 4582
npx --yes hyperframes@0.8.157 render video --quality draft --fps 30 --workers 1 --output video/out/rough-cut-v1.mp4
```

Use an existing cached Chromium binary if that cache version is different. Never
run a browser download. Studio's timeline is editable; stop its server when done:
`npx --yes hyperframes@0.8.157 preview video --stop`.

## F3 capture handoff

`captures.json` is the complete slot manifest: stable ID and relative filename,
beat, absolute start/duration, source, screen/moment, terminal phase selector,
synthetic persona and capture requirements. E1's later film mode supplies console
recordings at 1920 × 1080; phone recordings must show a real human co-signing.
Phase selectors describe the target state, not a claim that current film mode exists.
1. Record the state and any transition described in the slot's `requirements`.
   Keep the script's replay/stand-in chips visible. Capture unasserted moments in
   reduced motion. Include funding's overcharge DENY, both holds in ink, matching
   digests, sent/confirmed distinction, cash reroute and duplicate resend.
2. Put the MP4 at exactly `video/captures/<slot-id>.mp4`. Captures and renders are
   ignored by `video/.gitignore`; do not add them to Git. The builder selects a
   video only when that file exists; otherwise it emits the visible placeholder.
3. Optionally set `mediaStart` (seconds) and `playbackRate` (1 or 12) in the manifest.
   Regeneration preserves those two values. A 12× capture gets `×12 real time`;
   unaccelerated placeholders carry no acceleration claim. Keep source coverage
   at least `mediaStart + duration × playbackRate`; never speed up human signing.
4. Rerun build/check, HyperFrames check and inspect every scene midpoint and cue
   boundary. The build keeps product sound muted. F4 must play only the matching
   IC-11 PREMIUM member sentence, alone at 120–132, and must align narration without
   changing F1's beat boundaries. Do not attach the full member audio under narration.

The overlay keeps `Simulated PayPal sandbox` on every scene and persona lower thirds
on capture slots. Capture originals must also keep that label **beside values**;
the film overlay does not license cropping away an in-product label. Funding's
invoice is a seed-written placeholder; statements are hand-written templates;
the audit agent remains paused. Cebuano carries the exact machine-translation label.
The opening disclosure holds for 0–9 seconds; the closing voice disclosure holds
through all of 154–170, including the end card at 162–170.

The architecture is an original SVG generated solely from F1's box/arrow data.
Fonts are copied byte-for-byte from repo assets; see `LICENSES.md`. No external
requests or dependencies are needed by the authored composition.

The duration-driven static compositions declare `data-no-timeline`; HyperFrames
owns clip visibility and media seeking. The rough cut needs no GSAP or CDN.
Run Biome on the committed paths, excluding ignored `out/` and `.hyperframes/`
tool artifacts. `build.mjs` formats its JSON with the repo's installed Biome.
