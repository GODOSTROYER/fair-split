# E-01 film take

Run `corepack pnpm e2e:film` from the repository root. It opens headed Chromium at 1920×1080,
device scale 1, against the same private simulator stack and tears that stack down afterward.
Set `E2E_ORIGIN` to use a prepared origin without starting a local stack. No credentials are
required. Film takes consume a judge session; respect the capture window and quota plan.

The test imports `video/script.ts` (script v4) and reads the same exported `beats` and `CAPTURES`
that `video/build.mjs` assembles the film from. The take's clock is the film's: it waits until the
funding, reading, count-once, holds, signing, payouts, Proof and member beats, and until the capture
slots that cut in partway through a beat (`reading-byhand`, `rules-console`, `signing-phone`,
`payouts-cash`), before performing the corresponding real UI actions. The overview cards and the
highlight reel before 1:05 are not part of this take, so it idles on `/judge` until the funding beat.
`e2e/film/timeline.test.ts` fails if a mark the take paces to leaves the script or falls out of film order.
It uses the product's waits and their own labels without modifying time, state,
network responses or the rate card. A slow action keeps its actual time and can land late.
The separate DR-0 spec retains its real 60-second budget; this paced capture takes longer.
Editorial pacing waits carry a test-only `×1 real time` badge. The capture applies no acceleration
and never claims `×12`; any later edit that speeds a wait must label the edit's actual multiplier.

Both officers sign through explicitly named scripted human steps and the product's confirmation
dialogs, as in the ordinary browser test. The product's autoplay never supplies either signature.
The ink arrow is injected by the test; no cursor or capture code is shipped in the console.

The ignored `e2e/film-out/` folder contains `cursor.json` (viewport x/y, pressed state and
wall-clock offset in milliseconds) and `beats.json` (every script beat, its planned start,
moment, observed terminal phase and actual landing offset). Evidence also survives a failed
take: a null landing means the phase was never observed. Only the beats a magic moment carries
(funding MM-S, reading MM-2, count-once MM-3, holds MM-4, signing MM-5, payouts MM-6, member MM-7)
have a phase; the cards, paper, Proof, listening, limits and end beats keep null phase/landing
fields. Script v4 has no MM-1 cold-open, and no paid event is invented at any time. The recorder
refreshes its DOM observers after the live phone frames boot and before the keys without changing
any product phase.

Use the resulting headed window with F3's approved screen recording workflow. The test does not
start a recorder, play narration, create a final film or call external media services.

## The slots take (`FILM_TAKE=slots corepack pnpm e2e:film`)

`film/slots.spec.ts` records the film's capture slots from one real judge run on the same private stack, segment by
segment, with Chromium's screencast at 1920 × 1080 (`e2e/film-out/slots/`: JPEG frames, every action as a mark, every
visible test id's box around it). `video/tools/cut-captures.mjs` cuts each slot's clip out of it, and
`node video/tools/recapture.mjs` runs the take, the cut, the film's build, check, render and mix in one command.
Film mode shows no desktop pointer: the ink arrow is hidden, a press on a phone frame draws a touch dot held while the
finger holds, and the console's presses are marked by the film's own accents. Analyn types slip 0462's stained digit
from the keyboard and commits it with Enter. A 1 px keeper in the page's corner (outside every crop) damages the page
every other frame so the screencast records each change inside a phone frame. Nothing is accelerated or staged here;
a sped wait is labelled by the film with its real multiplier.
