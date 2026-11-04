# ADR-0017: The film is a product video, overview first, in 2:55 and 371 words

- **Status:** Accepted (user, on merge)
- **Date:** 4 Nov 2026 (IST)
- **Author:** WS-MEDIA (work package F1, script v4), with WS-QA's E-19 word cap
- **Touches:** S5.6.1 film budget (`docs/spec/S5-execution.md`, lines 449-456: target 2:50, 240 words, no beat
  shorter than 10 s); S5.6.2 beat sheet; register "Prior art", the film's sentence
  (`docs/spec/00-decision-register.md`, line 442); E-19 (`packages/test-kit/test/e19/script.ts` `MAX_WORDS`);
  `video/script.ts`, `video/build.mjs`, `video/check.mjs`, `video/captures.json`;
  `packages/test-kit/test/film-script.test.ts`

## Context

- On 4 Nov the owner asked for a product video: "The video also should start with: a problem description, how we
  solved it, the architecture explanation, everything ... Judges should be easily able to understand what we did
  first at the start of the video. They should see on the website what exactly is special and what other amazing
  things are fitted, like a matrix, etc. Then we start with the in-depth explanation of the whole thing: the
  problem first, then the solution, and then how impressive it is."
- Script v3 (F1, 170 s, 12 beats) opened on a silent phone shot, reached the architecture at 2:12 and named no
  feature list. Its budget came from S5.6.1: target 2:50, 240 words or fewer, 140 wpm or less per beat, no beat
  shorter than 10 s. An overview of the problem, the solution, the architecture and seven site features, followed
  by the full walk-through and the limits, does not fit 240 words: v4 needs 371.
- The contest asks for a video under 3 minutes, and gate G6 (S5, line 223) accepts 2:55 or less with a 2:50
  target. 2:55 leaves five seconds of margin.
- The prior-art re-scan of 4 Nov (research/prior-art-rescan-1104.md) retires the film's v3 line ("Similar
  projects protect a payer or contract. Fair Split protects the people being paid.") and the register's film
  sentence naming four projects: payee-facing receipts (Last Call, FairShift AI, MicroSplit AI) and a browser-checked
  proof (SarafuPay) now exist, and Neighborline has two signers on one hash. What still holds is the combination,
  and the narrow line "None we found starts from a handwritten weigh-slip".
- R1's real Claude readings of the ten hero slips (packages/eval/recordings, 1 Nov 2026) and C5d's exhibit of them
  in the reading room are on main. Judge runs still replay the labelled seed stand-in.

## Decision

1. **Structure.** Three parts, generated from `video/script.ts` (`PARTS`, `beats`):
   - **Overview, 0:00-0:57.** The problem (an original card: handwritten weigh-slips decide 64 farmers' pay; a
     duplicate pink copy or a fine no rule allows goes unseen; members cannot check their line; the buyer cannot
     prove its premium arrived). How Fair Split solves it, in one breath (a card of six steps). The architecture,
     an original SVG built up step by step as the narration names each part (`ARCHITECTURE.reveal`). A highlight
     reel from the real product: the split matrix (AG Grid) rebalancing with the mass-balance dial, the rate card
     refusing a change after ratification, two keys on one batch hash, Proof's six checks in the browser, the
     member's Cebuano audio and a peso tapped back to its slip, and Try to break it.
   - **Deep dive, 0:57-2:34.** The paper and the pink carbon; funding; reading (R1's exhibit, and the run's labelled
     stand-in); count it once; holds in ink and the refused deduction; two keys; payouts and the move to cash;
     Proof; the member's peso; the member's PREMIUM sentence, alone in its beat; why it holds up (a card).
   - **Close, 2:34-2:55.** Limits and disclosures (a card, spoken), impact, the end card.
2. **Budget.** At most 175 s (2:55). At most **371 spoken words** (the script's own need; the stand-in take has
   370): E-19's `MAX_WORDS` moves from 240 to 371 and no further. The pace limit is unchanged: 140 wpm or less in
   every beat (2.33 words a second, inside the owner's 2.6). A beat may be as short as 5 s, because each product
   step has its own line and picture; the pace limit, not the beat length, protects the narration.
3. **Pictures.** Every picture is an original card or diagram (typography and SVG drawn from the script's data) or
   a recording of the real product: the console in film mode, a phone, or Proof in the browser. The script owns
   the capture slots (`CAPTURES`: id, beat, start, duration, source, the on-screen state, the moment phase, the
   persona, the reel label and the design-1104 reference screenshot of that state); `build.mjs` writes them to
   `captures.json`. Card beats carry no capture slot; every other beat is covered end to end.
4. **Reading.** The film selects the `real-reading` variant: it cuts to one tile of R1's exhibit, captioned
   exactly "Claude's real reading of this slip, recorded 1 Nov 2026", and says "The run itself replays a labelled
   stand-in". The limits card and the end card repeat that judge runs use a seed stand-in.
5. **Prior art.** The film names no other project (S5.6.1: no rival product names) and claims only the
   combination. The "why it holds up" card reads "Prior art, re-scanned 4 Nov 2026: others share a part, not the
   combination" and "None we found starts from a handwritten weigh-slip." The film never says that no one reads
   handwriting, that similar projects protect a payer, or that Fair Split alone protects the people being paid.
   This supersedes the register's film sentence at line 442 for the film.
6. **Unchanged.** Only Analyn and Lantern Bay are named aloud (the Chair and a member without PayPal are roles;
   Nang Celing is a lower third). Disclosures sit on the first caption rail and the end card. Every PayPal-derived
   value is labelled "Simulated PayPal sandbox" (ADR-0002, ADR-0010). The member clip plays alone. Accelerated
   waits are labelled "×12 real time"; a person signing is never accelerated.
7. **The test count.** The film says "more than five thousand automated tests". The floor is measured, not
   estimated: at 2af75e6 `vitest list` collects 5,016 cases across the workspace packages and media, and
   Playwright lists 33 end-to-end tests; the merge trials' per-package pass counts are higher. S5.6.2 still applies:
   at lock the film may print CI's own count instead.

## Consequences

- WS-MEDIA: F2's rebuild in the new look (a separate change) uses the cards, the reveal steps,
  the reel labels and the 21 capture slots as generated; colours live only in `film.css`. F3 records the 21 slots
  (`captures.json` `shows` and `reference`). F4 aligns the narration to v4's beat boundaries without moving them and
  plays only the 8.44 s PREMIUM clip in the listening beat (134-143).
- WS-QA: `packages/test-kit/test/e19/script.ts` sets `MAX_WORDS = 371`; the E-19 planted over-budget script grows
  with the cap; `film-script.test.ts` asserts v4's parts, order, pace, disclosures, the reveal, the reel's features
  and the narrowed prior-art line.
- README and Devpost text (S1/S2) carry the same narrowed prior-art paragraph; the register's line 442 is left as
  written (docs/spec is not edited) and this ADR wins for the film.
- What gets worse: 55% more words and beats under 10 s make a denser film. The 140 wpm ceiling per beat holds, the
  average is about 127 wpm, and the listening and "why it holds up" beats slow down.

## Alternatives considered

| Option                                              | Why not                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Keep 240 words and cut the deep dive                | The owner asked for the overview and then the depth; 240 words cannot carry both              |
| A silent highlight reel with on-screen labels only  | Judges hear the explanation; the captions come from speech                                    |
| Run to 3:00                                         | The contest says under 3 minutes; 2:55 keeps a margin for encoding and title frames           |
| Name the nearest projects (Neighborline, Last Call) | S5.6.1 bans rival product names in the film; the README carries the dated comparison          |
| Keep the stand-in reading variant                   | R1 and its exhibit are on main; the film may show a real reading as long as it labels the run |
