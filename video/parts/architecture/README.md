# Film part: the architecture (script v4, 0:30–0:44)

A standalone HyperFrames part for the 14-second architecture beat, in **daylight** (STYLE §1: the architecture stays
bright, so the film keeps one dark-to-bright turn). The diagram is restaged as four steps, one readable word each,
with the camera pushing from node to node: **Claude**, **Engine**, **Signed**, **PayPal**. Ink lines carry the
structure, the indigo trace (5 px, soft glow, light core, a travelling light at its head) carries the batch, and it
lands as one jade pulse on the PayPal node. The day field (ground, morning wash, three soft light shapes, leaf
shadows, 20% grain) is the film's own and drifts on the film clock, so the beat ends on the field the highlight reel
opens on. No third-party logos or artwork: "PayPal" is set in our own type on a dashed (simulated) node.

> Slips go to Claude, then a deterministic engine. Two keys sign one batch hash. An outbox makes each simulated
> PayPal call safe to retry.

## Per-second outline (beat time; film time is +30 s)

Word times are word-proportional across the speech window (30–41 s), as the captions are timed, and come from
`script.ts` at build time, so the build moves with F4's alignment.

| Beat s     | Film s | On the words           | Picture                                                                                                    |
| ---------- | ------ | ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| 0.0–0.4    | 30.0   | "Slips"                | Daylight. The slip disc lifts in close up (camera 1.9×): **Slips**.                                        |
| 0.4–1.3    | 30.4   | "go to"                | The handwriting runs to Claude as an ink wave that calms as it arrives.                                    |
| 1.2–1.9    | 31.2   | "Claude"               | **Claude** lands (scan icon); the tag **Demo: seed stand-in** while Claude is the subject. Step 1.         |
| 1.9–2.9    | 31.9   | "then a deterministic" | The indigo trace leaves Claude, its light at the head; the camera pushes to the engine.                    |
| 2.6–3.4    | 32.6   | "deterministic engine" | **Engine** lands (sum icon). Step 2.                                                                       |
| 3.1–3.9    | 33.1   | "engine. Two"          | 64 thin ink member lines fan out of the engine and converge on one ring.                                   |
| 3.4–4.6    | 33.4   | "Two keys"             | The camera pushes to the ring; two key discs land above it.                                                |
| 4.3–4.9    | 34.3   | "sign"                 | Each key signs with an indigo thread; two indigo pulses on the ring: **Signed**. Step 3.                   |
| 5.0–5.6    | 35.0   | "one batch hash"       | A # draws inside the ring.                                                                                 |
| 6.2–7.4    | 36.2   | "An outbox"            | The trace leaves the hash, the camera pushes on: **Outbox** lands (tray icon).                             |
| 7.4–8.2    | 37.4   | "makes each"           | An ink line draws out towards PayPal.                                                                      |
| 8.1–8.7    | 38.1   | "simulated PayPal"     | **PayPal** lands on a dashed node; the **Simulated PayPal sandbox** tag turns on (to the end). Step 4.     |
| 8.9–9.6    | 38.9   | "call"                 | The call leaves the outbox and is lost halfway: its light goes out and its trace fades.                    |
| 9.5–10.0   | 39.5   | "safe to"              | A retry loop draws over the outbox; its word becomes **Safe to retry**.                                    |
| 10.0–11.2  | 40.0   | "retry"                | The same call goes again and lands once: one jade pulse on the PayPal node, a jade end node stays.         |
| 10.6–12.55 | 40.6   | (silence)              | The camera pulls back to the whole line; **Signed**, **Engine**, **Claude** return as each fits the frame. |
| 12.55–14.0 | 42.55  | (silence)              | The overview holds with a 1.2% push to the cut.                                                            |

## The rules it keeps (video/proto/STYLE.md)

- **Words (§2):** node labels are 40 px at the overview (camera scale 1) and larger on every push, so at least 36 px
  at 1080p (13 px at 640 px wide). One step word is readable at a time; a passed step's word leaves with the camera,
  and the build fails if a frame shows more than four readable words.
- **Accent (§3):** indigo is the trace, Claude's reading and the officers' signatures; jade appears once, as the
  trace's final pulse on the PayPal node.
- **Camera (§5):** sine.inOut pushes with a small zoom-out dip mid-move, slow pushes (≤ 2%) between them, motion
  blur keyed to the camera's speed on a container of its own, depth of field while pushed in. The pushes are
  1.1–1.3 s, shorter than a window glide, because the narration names a node every 1.8 s; the build fails if any
  node moves more than 36 px in one frame.
- **Honesty (§7):** one standard tag at a time, bottom-right (right 64 px, top 968 px): "Demo: seed stand-in" while
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
