# Fair Split film v7: the build contract

For SCENES A, B and C, CAPTURE and SOUND. The look and every shot are in `research/film-1111/storyboard.md`; the words
are in `research/film-1111/script.md`. This file says how the parts plug together. Run every command from
`video/film2/` in PowerShell.

## 1. What is fixed

- Canvas: 1920 × 1080 CSS px, 179 s. The final render is 3840 × 2160 (device scale 2), so one CSS px is two output px.
- `timing.json` holds the seven windows (below, as of the retime to 179 s). A section file's root
  `data-duration` is its window's length; `node tools/sync.mjs` fails if it is not.
- The render is 4K, so a 2× still may never be shown larger than its own CSS size; anything a viewer must read uses
  the capture agent's high-scale crops (`<still id>.<crop name>`, section 4).
- **Run `node tools/sync.mjs` before every preview, frame export or lint.** It reads `timing.json`,
  `audio/words.json` and `stills/stills.json` as they are now and rewrites `film-data.js` and `index.html`'s mounts
  and narration slots, so a new narration fit or a new still reaches your section with no edit by anyone.
  `tools/frames.mjs` and `tools/section.mjs` run it for you; the Studio preview does not. While it prints "stale
  until SOUND re-fits it" for your section, your word times are not final.

| id  | composition id    | file                                | film seconds |
| --- | ----------------- | ----------------------------------- | ------------ |
| s1  | `s1-scenario`     | `compositions/s1-scenario.html`     | 0–17         |
| s2  | `s2-problem`      | `compositions/s2-problem.html`      | 17–38        |
| s3  | `s3-solution`     | `compositions/s3-solution.html`     | 38–53.6      |
| s4  | `s4-demo`         | `compositions/s4-demo.html`         | 53.6–102     |
| s5  | `s5-compare`      | `compositions/s5-compare.html`      | 102–112      |
| s6  | `s6-architecture` | `compositions/s6-architecture.html` | 112–166      |
| s7  | `s7-close`        | `compositions/s7-close.html`        | 166–179      |
- `index.html` (LEAD) mounts the seven sections and the audio. `film.css` (LEAD) is the visual system. `film.js`
  (LEAD) is `window.FILM`. Ask LEAD for a new token or helper; do not edit these, and do not add your own copy.
- Cuts between sections are hard cuts on the one ground `#F7F8FB`. Where the storyboard says one section's last frame
  is the next one's first (1 → 2, 3 → 4), both files draw that frame themselves.

## 2. A section file

Copy the shape of `compositions/_template.html`. The rules that break silently if ignored:
1. Everything lives inside one `<template>`: `<style>`, the root `<div>`, `<script>`. The file's `<head>` is dropped.
2. The root is `<div id="root" data-composition-id="<composition id>" data-width="1920" data-height="1080"
   data-duration="<section seconds>">`, styled by `#root { position:absolute; inset:0; overflow:hidden;
   background:#f7f8fb }`. Never style the root by a class.
3. Every other id and class starts with your section id (`s4-…`): all seven sections share one page.
4. One paused GSAP timeline, registered last: `window.__timelines["<composition id>"] = tl;`. Timeline time 0 is the
   section's own start. The section holds its last frame until its window ends.
5. Link nothing. `film.css`, GSAP (`gsap`) and `FILM` are already on the page. No CDN, no fetch, no `Date`, no
   unseeded `Math.random`, no `repeat: -1`.
6. Animate with `tl.fromTo()` (both ends stated), never `from()`. Never set a CSS `transform` on an element you also
   tween with `x`, `y` or `scale`. Do not tween `visibility` or `display`.
7. Use the tokens and utilities in `film.css`: `--ground --ink --muted --hairline --card --indigo --jade --jade-ink
   --pink --red-pen`, `.t-head-l/.t-head/.t-head-s` (150/120/96), `.t-sub-l/.t-sub/.t-sub-s` (56/48/40), `.t-label`
   (34), `.t-small` (28), `.t-mono` (24, real technical names only), `.money` (jade text), `.window`, `.ul`,
   `.step`. FS Sans and tabular figures are inherited; write `font-family: var(--font-sans)` or `var(--font-mono)`,
   never a family name.

Section 4's step label (markup in `film.css`): `<div class="step"><span class="step-n">2</span><span
class="step-w">Read</span><span class="step-dots"><i class="on"></i><i class="on"></i><i></i>…eight…</span></div>`.

## 3. Narration word times: `audio/words.json` (SOUND writes it; it is measured, not estimated)

```json
{
  "version": 1, "unit": "film seconds", "duration": 179, "measured": true,
  "sections": {
    "s4": {
      "start": 53.6, "end": 102,          // the clip plays from the section's start; clip time 0 = film `start`
      "clip": "narration/s4.m4a",         // relative to audio/
      "speech": [54.1, 100.84],           // first word's start, last word's end
      "text": "The buyer pays one PayPal invoice. …",
      "lines": { "4a": { "start": 54.1, "end": 56.11, "text": "The buyer pays one PayPal invoice." } },
      "words": [ { "w": "The", "start": 54.1, "end": 54.17, "line": "4a" } ]
    }
  },
  "marks": { "fairSplit": { "start": 38.45, "end": 39.02 }, "fairSplitFinal": { "start": 170, "end": 170.52 },
             "everyPesoTraced": { "start": 171.22, "end": 172.77 } }
}
```

Every time is in film seconds. `w` keeps its punctuation. `lines` exist for s4 (`4a`–`4h`) and s6 (`simple`, `stages`, `first`, `second`, `third`, `fourth`, `under`).
Never read the JSON yourself and never hard-code a time. Use `FILM`:

| Call                                                                 | Gives                                                                                                                 |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `FILM.at("s2", "carbon copy")`                                       | seconds from the section's start to that word or run of words: a timeline position. Case and punctuation are ignored. |
| `FILM.at("s2", "one", 2, -0.1)`                                      | the second "one", 0.1 s early                                                                                         |
| `FILM.atEnd("s1", "harvest")`                                        | the same, at the word's end                                                                                           |
| `FILM.line("4c")`                                                    | `{ start, end, text, localStart, localEnd }`; use `localStart` in your timeline                                       |
| `FILM.mark("fairSplit", "s3")`                                       | a music hit: `{ start, end, localStart, localEnd }`                                                                   |
| `FILM.word("s1", "Davao")`, `FILM.words("s1")`, `FILM.section("s1")` | raw film-second records                                                                                               |

A word that is not spoken throws at load, so a typo fails loudly. SOUND rewrites `words.json` whenever the narration
is re-fitted: run `node tools/sync.mjs` before each preview and your section picks the new times up by itself,
because you only ever asked for words, never for seconds.

## 4. Product stills: `stills/` and `stills/stills.json` (CAPTURE writes both)

What a scene sees is a flat map of stills. A full frame and each element crop is a still of its own:

```json
{
  "p07-read-0403": {                    // a full frame: CAPTURE's still id
    "file": "p07-read-0403.png",        // in stills/, PNG only
    "state": "7",                       // the product-states.md number
    "kind": "full",
    "width": 1920, "height": 1080,      // this image's size in CSS px
    "scale": 2,                         // device scale: the PNG is width*scale by height*scale pixels
    "boxes": {                          // named elements (the product's test ids), CSS px from THIS image's top-left
      "W-TR-03.read-a": { "x": 700, "y": 220, "w": 420, "h": 96 }
    },
    "flags": [ { "text": "Sample", "box": { "x": 1700, "y": 20, "w": 80, "h": 24 } } ]   // disclosure words left inside
  },
  "p07-read-0403.slip": {               // one element of it: "<still id>.<crop name>"
    "file": "p07-read-0403.slip@4x.png",
    "kind": "crop",
    "width": 540, "height": 720,        // the crop's size in CSS px
    "scale": 4,                         // the highest scale CAPTURE shot it at
    "boxes": { "W-TR-03.net": { "x": 310, "y": 402, "w": 120, "h": 40 } },   // the full frame's boxes that lie inside it
    "cropOf": "p07-read-0403", "origin": { "x": 96, "y": 180 }              // where it sits in the full frame
  }
}
```

On disk CAPTURE may write either this flat map under `"stills"` (boxes as `{x,y,w,h}` or `{x,y,width,height}`), or
the manifest `e2e/film/stills-kit.ts` already writes: `stills[]` of `{ id, state, file, css {width,height},
deviceScale, px, boxes { testId: {x,y,width,height} }, crops[] { name, file, box, deviceScale, px, hi? { file,
deviceScale, px } }, flags[] }`. `tools/stills-shape.mjs` turns the second into the first: every crop becomes
`<id>.<name>` and uses its `hi` copy when there is one. Rules for CAPTURE either way: CSS px, unrounded, measured
from the image's own top-left; the PNG's pixel size must equal CSS size × scale (within 2 px);
`node tools/sync.mjs --check` verifies every file, size and box. Hide the disclosure chips, the cursor and any corner
mark before the shot, and list under `flags` any disclosure word that is still inside an image.

The film renders at 3840 × 2160, so a still may be shown at up to `scale / 2` times its CSS size: a 2× full frame at
no more than its own 1920 px width, a 4× crop at up to twice its CSS size. Scenes should use the 4× crops for
anything a viewer must read.

```powershell
node tools/sync.mjs --list      # every still id, its size and scale, how wide it may be shown, and its box names
```
For SCENES: never write `<img src="stills/…">` by hand. Use the helper, which refuses a still above its native pixels:

```js
// in the markup: <div id="s4-read" class="window" style="left:980px; top:240px"></div>
const shot = FILM.mountStill("#s4-read", "p07-read-0403.slip", { width: 760 });
//   box: show only that named box of the still (omit for the whole still); pad: CSS px kept around the box;
//   width: the window's width on the canvas; maxScale: the largest GSAP scale you will tween the window to.
//   Returns { k, rect(name) }. k is the display scale; the limit is FILM.still(id).maxK = scale / 2.
FILM.outline(tl, "#s4-read", shot.rect("W-TR-03.net"), FILM.at("s4", "twice")); // 3 px indigo, radius 10, 0.3 s
```

`FILM.outline(tl, parent, {x,y,w,h}, position)` works on any positioned element, not only stills. An underline is
`<div class="ul">` with a `scaleX` tween from 0. Two stills change by a cut or a crossfade of two `.window`s; never
animate a product number by hand. If a still you need is missing, tell the director; do not draw a stand-in.

## 5. Check your work

```powershell
node tools/lint.mjs compositions/s4-demo.html     # the forbidden list, below; must print 0 error(s)
npx hyperframes lint                               # HyperFrames' own structure lint; must print 0 errors
node tools/frames.mjs 60.2 63 71.5                 # exact frames at film seconds -> out/frames/at-60.2s.png (1920x1080)
node tools/frames.mjs 60.2 63 --2x                 # the same at the final 3840x2160 pixels -> out/frames-2x/
node tools/frames.mjs s4 8 --out out/frames-b      # eight frames spread over a section, into your own folder
node tools/section.mjs s4                          # your section alone with its narration -> out/preview/s4.mp4
node tools/section.mjs s4 --from 20 --to 32        # and a cut of it -> out/preview/s4-20-32.mp4
```

Look at the PNGs: read every word at 100 %, and check the `--2x` frame for soft edges. Use your own `--out` folder
so agents do not overwrite each other's frames. For the live editor: `npx hyperframes preview --background --port
<3041 A | 3042 B | 3043 C>`, then open `http://localhost:<port>/#project/film2` and scrub to your window.

## 6. Forbidden (the last cut was rejected for these; `tools/lint.mjs` fails on them)

1. Blur of any kind: `blur(`, `backdrop-filter`, any `filter:` (CSS or GSAP), `drop-shadow(`, SVG `<filter>`,
   `text-shadow`, depth of field, grain, vignette, glow.
2. Any shadow other than the window's: `box-shadow: var(--shadow-window)` (`0 8px 30px rgba(14,21,37,0.08)`) or weaker.
3. Scrims, veils, dimming: no translucent dark colour, no `mix-blend-mode`, no gradient, no full-frame layer in any
   colour but the ground, no element named scrim, veil, overlay, backdrop, vignette, grain or bloom. To point at
   something, outline or underline it; everything else keeps its full brightness.
4. A second ground or a night section. The ground is `#F7F8FB` in every section.
5. A still above its native pixels, a still not listed in `stills.json`, and any raster or video that is not a
   still: type, icons, the map, slips in sections 1–3 and the diagram are live HTML or SVG.
6. A corner chip, watermark, tag, browser chrome or cursor.
7. The words Simulated, Synthetic, Sample, Replayed or sandbox anywhere in sections 1–6. They appear once, in s7.
8. Brown, amber, tan or cream. Jade for anything but money that has arrived. More than six words on screen outside
   the architecture.
9. Drift: `repeat: -1`, `yoyo`, floating, tilting, 3D, parallax. A move takes 0.5–0.9 s, ease-out
   (`FILM.ease`, `FILM.move`), then the frame holds still.
10. Burned-in captions (the film ships `audio/captions.vtt` as a subtitle track).

## 7. Shared drawn objects: `assets/objects/` (SCENES A owns it)

The film's shared drawn objects live in `assets/objects/`: the weigh-slip, the 64 farmers, the payment token, the
buyer mark, the box of slips, the notebook, and the wordmark with its slip underline. Scene builder A owns that
folder. Other builders import from it and never redraw those objects; ask A for a variant you need.

How to import: `index.html` (and `tools/section.mjs`) loads `assets/objects/objects.js` before any section. It
defines `window.FSO`; every builder function returns one positioned element that you append and then tween with
your own timeline. The functions and their options are in `assets/objects/README.md` (A keeps it current). Objects
are inline HTML and SVG: an SVG loaded through `<img>` cannot use FS Sans, and a raster is forbidden.
`tools/lint.mjs` checks that folder too.
## 8. Audio the root mounts (SOUND)

`audio/narration/s1.m4a … s7.m4a` (one per section, clip time 0 = the section's start), `audio/music-bed.wav` and
`audio/sfx.wav` (each the film's length, from film 0). They give the Studio preview and the one-section drafts their sound. The
film's own sound is SOUND's final mix, `audio/mix.wav`, laid under the picture at assembly.

## 9. Assembly (LEAD)

```powershell
node tools/sync.mjs; node tools/lint.mjs; npx hyperframes lint
npx hyperframes render --resolution 4k --fps 30 --quality delivery --crf 12 --output out/fair-split-film-v8-picture.mp4
node tools/finish.mjs      # out/fair-split-film-v8.mp4 (+ .en.vtt, -1080p.mp4): the mix as AAC 320 kb/s, captions as a soft track, off by default
node tools/verify.mjs --sheet <contact sheet.png>   # the finished file: streams, loudness, ground luma per section, blank runs, a frame every 5 s
```
