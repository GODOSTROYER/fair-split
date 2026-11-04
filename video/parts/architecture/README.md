# Film part: the architecture (script v4, 0:30–0:44)

A standalone HyperFrames part for the 14-second architecture beat: an original line-and-node diagram in the
reference reel's language (one glowing node, thin threads, nodes that land with a small line icon and a one-to-three
word label) on the night film card (Gabii navy `#090D18`, ballpoint indigo `#9C8CFF` as the one accent). It builds on
the narration's words, then holds the whole diagram for 3.4 s. No third-party logos or artwork; "PayPal" is set in
our own type, on a dashed (simulated) node, with the "Simulated PayPal sandbox" tag.

> Slips go to Claude, then a deterministic engine. Two keys sign one batch hash. An outbox makes each simulated
> PayPal call safe to retry.

## Per-second outline (beat time; film time is +30 s)

Word times are word-proportional across the speech window (30–41 s), as the captions are timed, and come from
`script.ts` at build time, so the build moves with F4's alignment.

| Beat s    | Film s | On the words           | Picture                                                                                 |
| --------- | ------ | ---------------------- | --------------------------------------------------------------------------------------- |
| 0.0–0.5   | 30.0   | "Slips"                | Navy. One indigo node blooms; the slip icon draws in: **Slips 48**. Camera close (2×).  |
| 0.5–1.3   | 30.5   | "go to"                | A handwriting wave runs from the slip towards Claude, the glowing node riding its tip.  |
| 1.3–1.9   | 31.3   | "Claude"               | **Claude reads** lands (scan icon); the dashed tag **Demo: labelled stand-in** follows. |
| 1.9–2.7   | 31.9   | "then a"               | The line runs on clean now (Claude straightened the writing) to the engine.             |
| 2.6–3.1   | 32.6   | "deterministic engine" | **Deterministic engine** lands (Σ icon).                                                |
| 3.1–3.7   | 33.1   | "engine. Two"          | 64 thin member lines fan out of the engine and converge on one ring: **64 members**.    |
| 3.6–4.3   | 33.6   | "Two keys"             | Two keys land above the ring: **Treasurer**, **Chair**. Camera pulls back (1.13×).      |
| 4.4–5.0   | 34.4   | "sign"                 | Each key draws a thread into the ring; two indigo pulses, one per signature.            |
| 5.0–5.5   | 35.0   | "one batch hash"       | A # draws inside the ring: **One batch hash**.                                          |
| 6.3–7.1   | 36.3   | "An outbox"            | The glowing node leaves the hash for the outbox: **Outbox** lands (tray icon).          |
| 7.4–8.2   | 37.4   | "makes each"           | A thread draws out to PayPal behind a small white spark.                                |
| 8.2–8.8   | 38.2   | "simulated PayPal"     | **PayPal** lands on a dashed node; the dashed tag **Simulated PayPal sandbox** follows. |
| 8.9–9.5   | 38.9   | "call"                 | The call leaves the outbox and is lost mid-thread: the node fades and a gap opens.      |
| 9.5–10.1  | 39.5   | "safe to"              | A retry loop draws around the outbox: **Safe to retry**.                                |
| 10.0–10.6 | 40.0   | "retry"                | The same call goes again, closes the gap and lands once at PayPal (one pulse).          |
| 10.6–14.0 | 40.6   | (silence)              | The finished diagram holds, camera on the full frame with a 1.2 % drift.                |

## Build, check, render

From the worktree root (Node 24; HyperFrames 0.8.157 with the environment in `video/README.md`):

```powershell
node video/parts/architecture/build.mjs        # writes index.html, compositions/architecture.html, out/outline.json
npx --yes hyperframes@0.8.157 check video/parts/architecture
npx --yes hyperframes@0.8.157 render video/parts/architecture -o video/parts/architecture/out/architecture.mp4 --fps 30 --quality delivery
node video/parts/architecture/contact.mjs      # out/contact-sheet.jpg, one exact frame per half second
```

`build.mjs` fails if a step drifts off its word, the hold drops under 3 s, the camera has not framed the whole
diagram before the hold, the script's on-screen lines or the sandbox tag go missing, or an SVG element is animated
directly.

## How it moves

No GSAP and no vendored code. `build.mjs` compiles every tween into CSS keyframes sampled once per frame
(30 fps), which HyperFrames' CSS adapter seeks. That adapter seeks only HTML elements, offset by their clip's start,
so every SVG property (thread draws, dots, pulses, the gap) is a registered custom property animated on the HTML
wrapper `#arch-svgwrap` and read by the SVG through `var()`. The part renders the same at film second 30 as on its
own (checked by snapshot at 32, 35 and 40.2 s).

## In the film

The film mounts `compositions/architecture.html` in place at 30–44 s (composition id `architecture`, 14 s; see
`video/plan.mjs` SEGMENTS). `video/build.mjs` runs this part's build first, so the steps follow `script.ts`, and the
film dims the finished diagram to navy over its last 0.4 s before the highlight reel opens out of the night.
