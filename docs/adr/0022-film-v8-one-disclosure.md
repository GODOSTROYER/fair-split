# ADR-0022: Film v8 replaces the earlier film script and discloses "simulated" once

- **Status:** Accepted (owner's decision of 11 Nov 2026); pending merger review
- **Date:** 13 Nov 2026 (IST)
- **Touches:** ADR-0002 (simulated PayPal sandbox), ADR-0018 and ADR-0019 (film sound), S5 decision 9 (the film
  tool), invariant I8, `video/script.ts`, `docs/devpost.md`, `README.md`
- **Consumers:** WS-MEDIA (the film), WS-QA (README, the Devpost text, E-19)

## Context

The earlier film script (`video/script.ts`) kept "Simulated PayPal sandbox" beside every PayPal-derived value on
screen, carried captions throughout and listed a long disclosure for the description. On 11 Nov 2026 the owner
asked for a rebuilt film: a motion-design product video with far less text on screen. That film is v8, which the
owner approved.

## Decision

1. **Film v8 is the film.** Its title is "Fair Split: audited co-op payroll on PayPal" and it runs 2:59. Its
   structure is: scenario, problem, solution and vision, working demo, before and now, under the hood, close. Its
   chapters are 00:00 A cacao co-op in Davao, 00:17 The problem, 00:38 Fair Split and the vision, 00:54 Working
   today, 01:42 Before and now, 01:52 Under the hood, 02:46 Where it stands. It replaces the earlier film script
   wherever the two differ.
2. **"Simulated" is disclosed once**, at the end of the film and in its description, by the owner's decision of
   11 Nov 2026: PayPal steps run on our own simulator of PayPal's APIs; no real money moved; the co-op, its people
   and slips are synthetic. The film does not repeat the label beside each PayPal value.
3. **The product UI keeps its own labels.** Every screen of the console, the app and Proof still shows "Simulated
   PayPal sandbox" wherever a PayPal value appears. Invariant I8 is unchanged for the product, the README and the
   Devpost text.
4. **Sound and captions.** Music is Scott Buckley's "Machina" and "Aurora" (CC BY 4.0, scottbuckley.com.au), as in
   ADR-0018. The narration is Gemini TTS. Captions are optional, not burned into the picture.
5. **Render.** The film is rendered with HyperFrames 0.9.33 from 2x stills of the product.

## Consequences

- The README describes film v8 and links this ADR. The YouTube URL stays a marked placeholder until the owner
  fills it.
- `docs/devpost.md` is generated from `video/script.ts` and is not edited by hand. Its "Synthetic content and
  disclosures" section still quotes the earlier script's longer description disclosure, which says more than the
  film's one sentence and stays true. WS-MEDIA updates `video/script.ts` to v8, and the text is then regenerated.
- `docs/versions.md` still records `hyperframes` 0.8.157. The pin record is the deps lane's to change; this ADR
  only records the version the film was rendered with.
- No PayPal behaviour changes. Everything PayPal in the film is the in-process simulator (ADR-0010). No live
  PayPal behaviour is claimed.
