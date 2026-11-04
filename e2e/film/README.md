# E-01 film take

Run `corepack pnpm e2e:film` from the repository root. It opens headed Chromium at 1920×1080,
device scale 1, against the same private simulator stack and tears that stack down afterward.
Set `E2E_ORIGIN` to use a prepared origin without starting a local stack. No credentials are
required. Film takes consume a judge session; respect the capture window and quota plan.

The test reads the start times from `video/script.ts`. It waits until the funding, reading,
duplicate, rules, signing, payouts, Proof and listening beats before performing the corresponding
real UI actions. It uses the product's waits and their own labels without modifying time, state,
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
take: a null landing means the phase was never observed. Title, Proof and architecture/limits
beats have no magic moment and keep null phase/landing fields. The MM-1 arrival is an editorial
cold-open; its capture source lands after the payout in the real run, and its actual offset is
preserved so an editor can cut it to the opening. No paid event is invented at time zero.
An arrival receipt requires a real observed `press` before its `done`; an already-paid demo
frame cannot satisfy it. The recorder refreshes its DOM observers after the live phone frames
boot and before the keys without changing any product phase.

Use the resulting headed window with F3's approved screen recording workflow. The test does not
start a recorder, play narration, create a final film or call external media services.
