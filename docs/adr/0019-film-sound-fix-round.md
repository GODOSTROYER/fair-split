# ADR-0019: The film's sound, fix round after review v5 (rough cut v5-r1)

- **Status:** Accepted (owner's coordinator, 5 Nov 2026)
- **Date:** 5 Nov 2026 (IST)
- **Author:** WS-MEDIA (F4, the film's sound pass)
- **Amends:** ADR-0018 (the film's sound). Everything ADR-0018 decided stands except where this record says otherwise.
- **Touches:** `video/proto/index.html` (the night), `video/script.ts` (`NARRATION_AT`, the reading and limits lines,
  the payouts cut, `FILM.translationDisclosure`, `FILM.endCard`, `FILM.descriptionDisclosure`), `video/plan.mjs`
  (`OPENING`, `ACCENTS`, `CHIPS`, `BRACKETS`, `NARRATION_FIT`, `CLOSE`), `video/film-slots.js`, `video/film.css`,
  `video/check.mjs`, `video/parts/close` (the limits chip, the end retimed and its disclosure line),
  `video/audio/narration/`, `video/sfx-cues.json`, `video/tools/build-music-bed.mjs`, `video/tools/mix.mjs`

## Context

An independent review of rough cut v5 (research/film-1104/v5-review.json) scored it 8.0/10. The P1s:
- The opening's night solved the duplicate ("count it once.", the jade ring) while the voice was still listing the
  problem.
- The seven payout notes played while the payouts window glided away, and "sent." pulsed jade while the voice said
  "not yet paid".
- Nothing the viewer saw or heard said her Cebuano is machine-translated.
- Two phrases blurred by ear: the first "Analyn" (0.29 s), and "people and slips, a replayed" (a pause after "a").

Its P2s included the music pumping before "Try", a swell before her sentence, the climax ducked under the end line,
"on a simulated sandbox" swallowing "on", and the mono check measuring stereo.

## Decision

- **The night shows only the problem.** "count it once." and the person's indigo ring leave the opening. The night
  shows the duplicate, a fine with no rule ("−₱200" on another member's thread, "a fine, no rule."), "unseen." as
  both sink into the dark, the members fading, then the buyer's ring and invoice. Counting once is the day's.
- **Sent is not paid.** "sent." no longer flashes jade. The console holds until the cut to cash on "a member", and
  its seven items fill jade one by one on "Seven items confirm", with the seven payout notes on the fills.
- **Her language, one wording.** "Cebuano: machine-translated, pending native review" (`FILM.translationDisclosure`)
  appears on the Paminawa transcript, on the statement's voice in the last limit, on the end card, in the captions'
  bracket and in the description.
- **Voice.** 3 more requests (31 in all):
  - "Analyn types one stained digit by hand", with the name at full length;
  - the limits with full stops ("people and slips. A replayed stand-in.");
  - "on a simulated sandbox", with the "on" carried.

  A 0.4 s pause goes after "Members can't check it.". The problem line moves 0.6 s later to sit under the night's
  picture, the paper line starts once the bumper's words have gone, and the end starts 0.35 s later.
- **Mix.**
  - The music stops on the reel's night cut.
  - A gap under 1.25 s between lines holds the duck, so the bed does not pump before "Try" or before her sentence.
  - Aurora's climax lands on the name card after the last word, with the end line 18 dB over the bed.
  - The limiter ceiling drops to -4.6 dBFS, so the ITU mono fold-down peaks at or under -1 dBTP.
  - Mono is measured as a dual-mono fold-down.

## Consequences

- Rough cut v5-r1 measures:
  - -14.2 LUFS integrated, with the true peak at -4.3 dBTP;
  - the ITU mono fold-down peaks at -1.3 dBTP, and the dual-mono fold-down is 0.0 LU from stereo;
  - the bed sits 20 dB under every line (18 dB under the end line);
  - 15 of 15 narration fits to the picture hold.
- Two P2s are left:
  - Item 11, saying why PayPal in the architecture line, needs a new line, a retake and a rebuilt architecture part.
  - Item 14 belongs to the capture pass.
- ADR-0018's text is unchanged. This record lives beside it because `docs/adr` is append-only.
