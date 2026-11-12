# Film part: the architecture (script v4, 0:30–0:44)

A standalone HyperFrames part for the 14-second architecture beat, in **daylight** (STYLE §1: the architecture stays
bright, so the film keeps one dark-to-bright turn). The diagram is restaged as five steps, one readable word each,
with the camera pushing from node to node: **Claude**, **Engine**, **Signed**, **Funded**, **PayPal**. Ink lines
carry the structure, and an ink trace (4 px, a soft steel glow, a light core, a travelling light at its head) carries the
batch and lands as one jade pulse on the PayPal node; indigo is kept for Claude's reading (its icon) and the two keys
(review v4 item 1). The day field (ground, morning wash, three soft light shapes, leaf
shadows, 20% grain) is the film's own and drifts on the film clock, so the beat ends on the field the highlight reel
opens on. No third-party logos or artwork: "PayPal" is set in our own type on a dashed (simulated) node.

> Slips go to Claude, then a deterministic engine; two keys sign. A PayPal invoice funds it; simulated PayPal Payouts
> pay members, safe to retry.

## Per-second outline (beat time; film time is +30 s)

Word times are the recorded narration's word starts (`script.ts` `words`, aligned offline; speech 30.1–40.9 s), read
at build time, so the build moves with the voice.

| Beat s     | Film s | On the words               | Picture                                                                                                                                                                                        |
| ---------- | ------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.0–0.4    | 30.0   | "Slips"                    | Daylight, under the opening's 92% veil, which lifts (0–0.7 s) off the slip disc the opening already drew under it, close up (camera 1.9×, no lift-in): **Slips**.                              |
| 0.5–0.7    | 30.5   | "go to"                    | The handwriting runs to Claude as an ink wave that calms as it arrives.                                                                                                                        |
| 0.6–1.5    | 30.6   | "Claude"                   | **Claude** lands (scan icon); the tag **Seed stand-in reading** while Claude is the subject. Step 1.                                                                                           |
| 1.6–1.9    | 31.6   | "then a deterministic"     | The ink trace leaves Claude, its light at the head; the camera pushes to the engine.                                                                                                           |
| 1.8–2.5    | 31.8   | "deterministic engine"     | **Engine** lands (sum icon). Step 2.                                                                                                                                                           |
| 2.5–3.2    | 32.5   | "engine"                   | 64 thin ink member lines fan out of the engine and converge on one ring.                                                                                                                       |
| 3.2–3.9    | 33.2   | "two keys"                 | The camera pushes to the ring; two key discs land above it.                                                                                                                                    |
| 3.9–4.3    | 33.9   | "sign"                     | Each key signs with an indigo thread; two indigo pulses on the ring: **Signed**. Step 3.                                                                                                       |
| 4.35–4.7   | 34.35  | "sign."                    | A # draws inside the ring: one batch hash.                                                                                                                                                     |
| 4.9–5.4    | 34.9   | "A PayPal invoice"         | The trace leaves the hash: the invoice rises (receipt icon).                                                                                                                                   |
| 5.9–6.9    | 35.9   | "funds it"                 | **Funded** lands on its word; an ink line draws out towards PayPal. Step 4.                                                                                                                    |
| 6.9–7.5    | 36.9   | "simulated PayPal Payouts" | The dashed (simulated) node lands on "simulated", **PayPal** on "PayPal Payouts"; the **Simulated PayPal sandbox** tag turns on (to the end). Step 5.                                          |
| 8.6–9.0    | 38.6   | "pay members"              | The call leaves for PayPal and is lost halfway: its light goes out and its trace fades.                                                                                                        |
| 9.8–10.2   | 39.8   | "safe to"                  | A retry loop draws over the invoice; its word becomes **Safe to retry**.                                                                                                                       |
| 10.2–10.5  | 40.2   | "retry"                    | The same call goes again and lands once: one jade pulse on the PayPal node, a jade end node stays.                                                                                             |
| 10.6–12.55 | 40.6   | (silence)                  | The camera pulls back to the whole line, icons only: **PayPal** and **Safe to retry** leave as it starts (review v4 item 8).                                                                   |
| 12.55–14.0 | 42.55  | (silence)                  | The overview holds with a 1.2% push; in the last 0.6 s the diagram dissolves into the field (blur and fade), so the reel's focus pull starts on the same empty field; the sandbox tag runs on. |

## The rules it keeps (video/proto/STYLE.md)

- **Words (§2):** node labels show only on the pushes (camera 1.6x and more, so 64 px and up at 1080p); the overview
  carries none (review v4 item 8: at camera scale 1 they read about 29 px tall, and Slips and the invoice had none). One step word is readable at a time; a passed step's word leaves with the camera,
  and the build fails if a frame shows more than four readable words.
- **Accent (§3):** indigo is Claude's reading (its icon) and the officers' signatures (the key threads and their two
  pulses); the data path is ink (review v4 item 1); jade appears once, as the trace's final pulse on the PayPal node.
- **Camera (§5):** sine.inOut pushes with a small zoom-out dip mid-move, slow pushes (≤ 2%) between them, motion
  blur keyed to the camera's speed on a container of its own, depth of field while pushed in. The pushes are
  1.1–1.3 s, shorter than a window glide, because the narration names a node every 1.8 s; the build fails if any
  node moves more than 36 px in one frame.
- **Honesty (§7):** one standard tag at a time, bottom-right (32 px words in a 64 px pill, right 64 px, top 960 px): "Seed stand-in reading" while
  Claude is the subject, then "Simulated PayPal sandbox" from the PayPal node's first frame to the end. The build
  fails if any node or label enters the tag corner.

## Build, check, render

From the worktree root (Node 24; HyperFrames 0.8.157 with the environment in `video/README.md`):

```powershell
node video/parts/architecture/build.mjs        # writes index.html, compositions/architecture.html, assets/, out/outline.json
npx --yes hyperframes@0.8.157 check video/parts/architecture
npx --yes hyperframes@0.8.157 render video/parts/architecture -o video/parts/architecture/out/architecture.mp4 --fps 30 --quality delivery
node video/parts/architecture/contact.mjs      # out/contact-sheet.jpg, one exact frame per half second
```

`build.mjs` fails if a step drifts off its word, the hold drops under 3 s, the camera does not end on the overview,
a frame shows more than four readable words or a label under 36 px, a node enters the tag corner or moves faster
than 36 px per frame, the sandbox tag starts after the PayPal node, the script's on-screen lines go missing, or an
SVG element is animated directly.

## How it moves

No GSAP and no vendored code. `build.mjs` compiles every tween into CSS keyframes sampled once per frame
(30 fps), which HyperFrames' CSS adapter seeks. That adapter seeks only HTML elements, offset by their clip's start,
so every SVG property (line draws, the trace) is a registered custom property animated on the HTML wrapper
`#arch-svgwrap` and read by the SVG through `var()`. The nodes, the travelling light, the pulses and the tags are
HTML. The grain is the film's first seeded tile (`assets/grain.png`, written by the build) at the film's seeded
offset each frame; the leaf shadows are `video/proto/assets/dapple.png`, copied in by the build.

## In the film

The film mounts `compositions/architecture.html` in place at 30–44 s (composition id `architecture`, 14 s; see
`video/plan.mjs` SEGMENTS). `video/build.mjs` runs this part's build first, so the steps follow `script.ts`. The part
is now day from its first frame to its last, so the film's seams around it (`seam-30`, `seam-44`, the reel's iris
intro, and `field: "night"` in `plan.mjs`) should become day-to-day joins (a focus pull or a glide) in the film build.
