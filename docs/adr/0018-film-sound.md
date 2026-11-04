# ADR-0018: The film's sound: Charon narration, Scott Buckley's music, CC0 effects

- **Status:** Accepted (owner, 5 Nov 2026)
- **Date:** 5 Nov 2026 (IST)
- **Author:** WS-MEDIA (F4, the film's sound pass)
- **Touches:** `video/script.ts` (lines, `NARRATION_AT`, word times, the limits and end beats, `FILM.capture`,
  `FILM.endCard`, `FILM.voiceDisclosure`, `FILM.musicCredit`); `video/plan.mjs`, `video/build.mjs`,
  `video/check.mjs`; `video/parts/close` (limits and end retimed); `video/tools/` (narration, fetch-music,
  build-music-bed, sfx-assets, mix, cue-sheet); `video/audio/narration/`; `video/assets/sfx/`;
  `video/sfx-cues.json`; `video/LICENSES.md`, `video/CREDITS.txt`; `packages/test-kit/test/film-script.test.ts`
  (beat boundaries, word times). Amends ADR-0017's "No music; mute product sound under narration".

## Context

- Rough cut v4 scored 7.5/10 and was silent; its review (research/film-1104/review-v4.md) asked for the limits in
  about 9 s (item 3), one voice wording, the end line held 2 s or more (item 6), the listening hold sized to the
  real clip (item 9), and caption cue 4 on the turn (item 10).
- On 5 Nov the owner chose the sound: "chose as per you, yes ok to download / generate music as needed, also use
  sound effects" (the Barty-Bart motion-graphics sound-effects kit). Of the 4 Nov auditions, Charon (Gemini TTS,
  "Informative") is the narrator; Scott Buckley's "Machina" into "Aurora" (research/music-1104.md, candidate 1,
  CC BY 4.0) is the music.
- `video/script.ts` v4 said "No music; mute product sound under narration", and every line was timed
  word-proportionally until a voice was recorded.

## Decision

1. **Narration.** Gemini TTS (gemini-3.8-flash-tts, free tier), voice Charon, one request per narrated beat
   through `media/src/tts` (`KeyPool`, `synthesize()`), every request on the shared ledger: 28 requests in all
   (16 first takes, 12 retakes of lines read over 140 wpm or misheard). Clips at -16 LUFS, true peak -1.5 dBTP or
   lower, 48 kHz mono AAC (`video/audio/narration/`, `manifest.json`). A sentence pause may be lengthened or
   tightened by inserting or cutting silence inside it (`takes.json`); the voice itself is never retimed.
2. **Words where the voice says them.** A local transcriber (Whisper small, offline) aligns each clip to the
   script's own words; `script.ts` places each clip (`NARRATION_AT`) and derives every speech window and word time
   from the alignment, so the captions, the card lines, the architecture's steps and the reel's cuts land on the
   words as they are said. `plan.mjs` `NARRATION_FIT` lists where each line must sit in the picture; the build
   refuses a miss.
3. **Fewer words.** The solution line is AUDIO-CUES' 29-word line; the problem, paper, reading, holds, signing,
   proof, member and limits lines are shorter (331 spoken words, from 367). Every line is at or under 140 wpm in
   its own speech window. The claims "over five thousand automated tests" and "three kill switches" were checked
   against main (4,898 test declarations plus 65 end-to-end and 238 table-driven tests; the kill switches
   `kill_payouts`, `kill_paypal_live`, `kill_ai_live` in `apps/api/src/runs/flags.ts`).
4. **The limits in 10 s.** Four limits, each on its object: simulated., synthetic. (the co-op's people and the slip
   images on one station: "generated." is merged in), replayed., synthesized. The end gains the 3 s: limits
   154-164 s, end 164-175 s, the end line on screen 2.5 s. One voice wording everywhere: "Synthetic voices ·
   Gemini TTS".
5. **Music.** "Machina" under the black opening, "Aurora"'s build arriving on the turn, bright to the deep dive,
   its calm tail under the deep dive, out completely under the member's own sentence, back low after it, and its
   climax as the final lift on the end line. Cuts, fades and one level per piece only (CC BY 4.0: no
   re-orchestration). The tracks stay outside the repo (`tools/fetch-music.mjs`, sha256-pinned); the exact credit
   lines are in `video/LICENSES.md` and `video/CREDITS.txt` (for the YouTube description, where the artist's
   Content ID looks for them) and a short credit is on the end card.
6. **Sound effects.** 32 cues, one real sound each, keyed to timeline events (`sfx-cues.json`, `plan.mjs`
   `eventTime`): CC0 files from the kit (never Mixkit), and Fair Split's own product sounds for product moments
   (the duplicate's double tick, the plunk of a person's key, the clack of the bolted rate card, the root note of
   the paid invoice, one pentatonic note per confirmed payout, the chime of money on her phone). None plays during
   the member's sentence.
7. **Mix.** `video/tools/mix.mjs`: the bed ducks under each line (0.25 s before it, 0.6 s release) and crossfades
   to a copy carved in the voice's band, 20 dB under the voice line by line; effects about 24 dB under the voice;
   the master at -14 LUFS integrated with the true peak at or under -1.5 dBTP, measured on the exported MP4.
   HyperFrames' own carve needs `@hyperframes/core` installed in the project, a dependency this repo does not take.

## Consequences

- The film can no longer drift from its voice: re-recording a line means re-running `tools/narration.mjs` and the
  build; a cue, a caption or a cut that misses its words fails the build or the check.
- The music cannot be committed; anyone rebuilding the mix fetches it first (no account or form is needed).
- The listening beat stays 9 s: her sentence's speech is 8.0 s (134.36-142.33 s), and the camera leaves as it ends.
- Nobody has listened yet: research/film-1104/v5-audio.md lists five timestamps to check on headphones.
