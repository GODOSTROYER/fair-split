# Fair Split film · script v4, rough cut v5 (with sound)

1920 × 1080, 30 fps, 175 seconds (2:55), in the motion language of [`proto/STYLE.md`](proto/STYLE.md): almost no
text, one accent per frame, a visual metaphor per idea, night then day, calm floating product windows, a smooth
camera. Words, time and capture slots come from `script.ts` (17 beats in 3 parts, ADR-0017); `plan.mjs` places them
(which composition covers which beats, one keyword and one honesty tag per slot, the captions, the audio cues).
Every product recording is still a labelled capture slot. Rough cut v5 adds the sound (ADR-0018): Gemini TTS
narration in voice Charon, timed word by word from the recording, Scott Buckley's "Machina" into "Aurora" (CC BY
4.0, credited) and sparse CC0 sound effects; [`AUDIO-CUES.md`](AUDIO-CUES.md) is the sound sheet.

## The film, beat by beat

| Film time | Beat(s)      | Composition                                           | Picture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | ------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–14      | problem      | `compositions/opening.html` (from `proto/index.html`) | Night. Hairline, "64 farmers." (tag Synthetic co-op), "one shoebox of slips.", the slip's wave fans into 64 member threads, "one slip, twice." (the pink copy), "a fine, no rule." (−₱200 on another thread), "unseen." (the copy and the fine sink into the dark), the members' dots fade, then a jade ring: US$4,333.50, "one invoice." (tag Simulated PayPal sandbox).                                                                                                                                                                       |
| 14–30     | solution     | (same)                                                | The turn at 14.45: the ring becomes a portal into daylight, "traced.". "read." (Claude's reading of slip 0403), "checked." (the duplicate row, Count it once), "paid." (her statement in Cebuano), the trace slip → peso → phone, "Every peso, traced." (27.2), held, then a one-second glide off it (29.0–30.0) onto the architecture's Slips disc, waiting under the 92% veil (`plan.mjs` `SLIPS_UNDER_VEIL`). The trace frame (26.6) blurs every window but 38.45, the sum and US$64.45. No name card: the name shows once, on the end card. |
| 30–44     | architecture | `parts/architecture/compositions/architecture.html`   | Day. The Slips disc is on screen from the first frame (no lift-in), the beat lifts the opening's veil off it (30.0–30.7) and builds the line in four steps on their words, the camera pushing node to node: Claude, Engine, Signed, PayPal (tag "Seed stand-in reading" while Claude is the subject, then the sandbox tag from the PayPal node); the call is lost, retried and lands once (one jade pulse); the camera pulls back to the whole line (40.6–42.55), which dissolves into the field (43.4–44.0).                                   |
| 44–57     | highlights   | `compositions/highlights.html`                        | A focus pull on the first window, then one camera glides through six floating windows, each glide straddling the cut on the word that names it: balanced. · frozen. · signed. · checked. · heard. · refused. Sandbox tag throughout. "refused." is the reel's peak: a 1.65 s night insert that returns to day by a focus pull.                                                                                                                                                                                                                  |
| 57–65     | paper        | `compositions/paper.html`                             | Bumper "The deep dive." on a daylight veil over the camera's glide (57–58.65), then paper. (paper-photos, 57–61) · twice. (paper-carbon, 61–65). No PayPal value, no tag.                                                                                                                                                                                                                                                                                                                                                                       |
| 65–73     | funding      | `compositions/funding.html`                           | funded. (funding-console, a jade hit at 66.1). Sandbox tag on from 65.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 73–83     | reading      | `compositions/reading.html`                           | read. (reading-console, 73–76.5, tag "Real Claude reading · 1 Nov 2026", an indigo box at 74.1) · typed. (reading-byhand, 76.5–83, tag "Seed stand-in reading", an indigo box at 77.6).                                                                                                                                                                                                                                                                                                                                                         |
| 83–92     | count-once   | `compositions/count-once.html`                        | once. (count-console). Sandbox tag on again, through 143.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 92–102    | holds        | `compositions/holds.html`                             | held. (holds-console, 92–95.5) · locked. (rules-console, 95.5–102).                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 102–111   | signing      | `compositions/signing.html`                           | signed. (signing-console, 102–106) · co-signed. (signing-phone, a phone window, 106–109.5) · approved. (signing-approved, 109.5–111, held 1.45 s: the camera swings back out of the phone so the console rises in under the word).                                                                                                                                                                                                                                                                                                              |
| 111–121   | payouts      | `compositions/payouts.html`                           | sent. (payouts-console, 111–116, a jade hit at 111.6) · cash. (payouts-cash, 116–121).                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 121–129   | proof        | `compositions/proof.html`                             | re-checked. (proof-browser).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 129–134   | member       | `compositions/member.html`                            | traced. (member-phone, a phone window): her four slips trace into her net pay, one jade pulse at 131.2.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 134–143   | listening    | `compositions/listening.html`                         | heard. (listening-phone, a phone window); her sentence plays alone. The phone holds while it plays, then the camera glides off it under a daylight veil (141.9–143.0, 92% by 142.85) and rests on the field.                                                                                                                                                                                                                                                                                                                                    |
| 143–154   | impressive   | `parts/close/compositions/impressive.html`            | Day, on the reel's field: the close lifts the run's veil (143.0–143.7); "5,000+" over "automated tests", a glide to "3" over "kill switches", a glide to the handwritten weigh-slip, "handwritten." (150.6), then a push of about 2.5× on its Net row (150.95–152.6) while the rest blurs and greys, so the hand's indigo box round 38.45 (about 45 px tall) is the only readable text. No PayPal value, no tag.                                                                                                                                |
| 154–164   | limits       | `parts/close/compositions/limits.html`                | Day. A pull-out glide (153.45–155.45) carries the camera from the slip straight to the first limit; then one limit at a time while it is said, each keyword beside the object it qualifies, with its one tag: simulated. (155.2, the peso card's "Paid US$64.45") · synthetic. (157.85, the 64 dots gather into a ring) · generated. (160.6, three slip images sharpen) · replayed. (162.3, the reading card lifts out of the slips) · synthesized. (165.25, an ink wave from a play disc), which stays on into the glide to the overview.      |
| 164–175   | end          | `parts/close/compositions/end.html`                   | The slip and her phone on one line (sandbox tag on), both blurred out of reading but for her US$64.45, the trace from the handwritten 38.45 to her pay and one jade pulse (169.85), a veil, "Every peso, traced." (170.6), then the film's one name card (171.95) with the voices' tag to the last frame.                                                                                                                                                                                                                                       |

Script v4's boundaries are unchanged: each part's real length matches its beats (the opening 30 s, the
architecture 14 s, the close 32 s), and the build refuses a part whose own `data-duration` drifts from its beats.

## How it is put together

- **The opening** is generated from the prototype by `build.mjs` (`plan.mjs` `openingFromPrototype`): ids prefixed
  `op-`, images read from `proto/assets`, fonts from `film.css`. The prototype stays the reference implementation of
  STYLE.md; edit it and rebuild, never `compositions/opening.html` (`check.mjs` refuses a stale copy). Script v4's
  problem line is spoken over the night (0–14) and the solution line from "Fair Split:" at the turn to the name
  (14–30); the kinetic words are the prototype's.
- **The architecture and the close** are their own HyperFrames projects (`parts/architecture`, `parts/close`),
  mounted in place, so there is one source for each. `build.mjs` runs the architecture's build (it reads
  `script.ts` and copies its font) and writes the close's `close.vtt`.
- **Capture-slot beats** (the reel and the deep dive) are generated by `build.mjs` and driven by `film-slots.js`:
  a calm day field (the morning wash, three large light shapes, leaf shadows, grain) that drifts on the film's own
  clock so it runs on across cuts; one floating window per `captures.json` slot (a 1000 × 562.5 console or browser
  crop, or a 330 × 715 phone) with float, tilt and depth of field; one day keyword per slot (STYLE §2, wiped in
  and out); one honesty tag in the bottom-right corner, which no window enters. One camera runs over the whole
  capture run (`plan.mjs` `CAPTURE_RUN`): every window has a place in one world, and the camera holds beside each (its keyword at
  the film's one anchor, x 140, top 150), pushes in on a hold of 4 s or more and glides to the next across the beat
  cut; each beat composition also draws its neighbours' windows ("ghosts") for those glides, so the cuts have no
  seam. Placeholder accent beats (`plan.mjs` `ACCENTS`) mark where the indigo and jade moments land. The **sandbox tag**
  is on wherever a PayPal value can show (the reel, and 65–143 except the reading); the reading's two clips carry
  their own honesty labels instead, one tag at a time.
- **Joints** (`plan.mjs` `JOINTS`): no dips to navy (`SEAMS` is empty). The opening glides off its end line onto the
  empty daylight field (30), the reel opens on a focus pull (44), and the run ends under a daylight veil (143).
- No captions are burned in. **`captions.vtt`** is the closed-caption track (STYLE §8): word for word with every
  spoken line in `script.ts`, at most two lines of 42 characters, each cue 1–6 s, with one bracketed sound cue for
  the member's sentence. Timing is word-proportional within each beat (as every card, architecture step and reel
  cut is timed) to the recorded voice. `captions.json` is the same track as data.

## Honesty in this style

STYLE §7 replaces v1's disclosure rails and lower thirds with one dashed tag at a time. "Synthetic co-op" arrives
with the first people count (1.95 s) and "Simulated PayPal sandbox" with the first PayPal value (13.1 s), then stays
on through every product run; the reading's real-reading and stand-in labels take the tag's place over their own
clips; the architecture carries "Seed stand-in reading" while Claude is the subject, then the sandbox tag from the
PayPal node, which runs on into the reel; the close shows one limit at a time while it is said (154–164), each with
its one tag, and the end card's tag ("Synthetic voices · Gemini TTS") holds to the last frame. v1's opening rail
(`FILM.firstCaption`, 0–14 s) is no longer on screen: its four disclosures are in the tags, the limits, the end
card's tag and the upload's description (`FILM.descriptionDisclosure`). Review that change before delivery.

## Joints and seams (rough cut v4)

There is one turn, in the opening; everything after 15.8 s is day on one field. Where one side of a cut ends
under the daylight veil, the other opens under the same veil and lifts it: the architecture lifts the opening's
(30.0–30.7) off the Slips disc both sides draw at the cut, and the close lifts the run's (143.0–143.7). The architecture dissolves its diagram into the field
(43.4–44.0) and the reel's first window fades in with its focus pull, the sandbox tag running on across the cut.
Inside the run, a keyword's wipe out finishes two frames before its composition's cut and an accent leaves with
its keyword, because the next beat draws only its neighbours' windows. Check a cut with
`node video/contact.mjs <ffmpeg> video/out/rough-cut-v4.mp4 <out.png> 29.967,30,43.967,44,...` (both sides of each
cut); v4's sheet of every cut is `out/rough-cut-v4-seams.png`. Every part draws the same tag (`plan.mjs` `TAG`: 32 px
words in a 64 px pill, right 64, top 960) with one stand-in wording (`STAND_IN_TAG`), so a tag that runs on across
a cut (the sandbox tag at 44 s) does not change size.

## Dropping in the captures (F3)

`captures.json` is the complete slot manifest: stable id and file, beat, absolute start and duration, source,
`state`, `shows`, phase selector, persona, `keyword`, `window`, `tag`, the reel's `label` and narration `word`,
`evidence`, the design-1104 `reference` screenshot and the beat's `requirements`.
1. Record the state in `shows` and `requirements`; crop as `shows` says, to the window's aspect (16:9 for console
   and Proof, portrait for a phone). The film no longer lays sentences over a clip: every line in a slot's
   `evidence` (the beat's evidence lines, the clip's own overlay lines, the persona) must be legible in the capture
   itself, beside the value it describes, or is carried by the slot's `tag`. Keep the product's own
   replay/stand-in chips and its "Simulated PayPal sandbox" label beside values.
2. Put the MP4 at exactly `video/captures/<slot-id>.mp4` (git-ignored). The builder puts a muted `<video>` in the
   slot's window when the file exists, else the "capture pending: <slot-id>" plate. No layout changes are needed.
3. Optionally set `mediaStart` and `playbackRate` (1 or 12) in `captures.json`; regeneration keeps both. A 12×
   capture gets a "×12 real time" chip in its window. Never accelerate human signing (the check refuses it).
4. The reel (44–57) cuts each clip on the words that name its feature (held to 0.3 s by the check). The member's
   IC-11 PREMIUM sentence (8.44 s) plays alone in the listening beat (134–143); the narration is aligned without
   moving beat boundaries, and regenerates `captions.vtt` from its alignment.

## Build, check, render

From the worktree root with Node 24 (set `FS_BIOME` to a Biome binary if this checkout has no `node_modules`):

```bash
node video/build.mjs
node video/check.mjs
. video/proto/tools/env.sh           # offline HyperFrames 0.8.157, cached Chromium, WinGet ffmpeg
$HF lint video && $HF check video
$HF snapshot video --describe false --no-end --at 2.4,15,20.9,35,45.5,57.5,69,75,107,131,145,160,172
$HF render video --quality draft --fps 30 --workers 1 --output video/out/rough-cut-v5-picture.mp4
# the sound (ADR-0018): the music is fetched to a cache outside the repo, never committed
node video/tools/fetch-music.mjs ../media-cache/music            # sha256-pinned, Scott Buckley, CC BY 4.0
node video/tools/build-music-bed.mjs ../media-cache/music        # out/music-bed.wav: cuts and fades only
node video/tools/mix.mjs                                         # out/stems/*.wav, out/mix-v5.json
node video/tools/mix.mjs mux video/out/rough-cut-v5-picture.mp4 video/out/rough-cut-v5.mp4
cp video/captions.vtt video/out/rough-cut-v5.en.vtt
```

The narration is already in `audio/narration/` (`tools/narration.mjs encode` made it from the Gemini takes,
`align` timed its words from a local Whisper transcript); `tools/sfx-assets.mjs` copied the CC0 effects from the
kit and rendered the product's own sounds into `assets/sfx/`. `mix.mjs mux` masters to -14 LUFS with the true
peak at or under -1.5 dBTP, measured on the MP4 itself, and keeps the soft English caption track; the `.en.vtt`
sidecar is for the YouTube upload, and `CREDITS.txt` holds the description's credit lines. Render once at draft quality on a busy machine; the
delivery render is `--quality delivery --crf 14` (STYLE §10). `check.mjs` verifies the plan: segments tile the
film on their beats, each part is as long as its beats, the opening matches the prototype byte for byte, every
slot has its window, keyword and tag, R1's caption appears only as the exhibit clip's tag, windows stay out of the
tag corner, nothing is burned in, and `captions.vtt` spells every beat's `say` word for word inside its speech
window (and `close.vtt` is its slice). HyperFrames lint warns that `opening.html` is one large file: the night, the
day and the ring share one driver, as in the prototype.

Fonts are copied byte-for-byte from repo assets (`LICENSES.md`); GSAP 3.15.0 is the close part's vendored copy.
`out/`, `captures/` and `.hyperframes/` are git-ignored.
