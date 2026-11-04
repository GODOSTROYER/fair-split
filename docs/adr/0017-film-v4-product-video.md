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
   - **Overview, 0:00-0:57.** The problem (an original card, opening "Picture a co-op paying sixty-four cacao
     farmers from handwritten weigh-slips" under the kicker "A synthetic cacao co-op"; a duplicate or a fine no
     rule allows goes unseen; members cannot check their pay; the buyer cannot prove its premium arrived). How
     Fair Split solves it, in one breath (a card of six steps). The architecture, an original SVG of ten boxes
     built up step by step as the narration names each part (`ARCHITECTURE.reveal`), narrated in 30-41 s so the
     finished diagram then holds for 3.5 s. A highlight reel from the real product, each clip cutting in on the
     words that name it: the split matrix rebalancing with the mass-balance dial, the rate card refusing edits,
     two keys and then the simulated PayPal fan-out, Proof's six checks in the browser, a peso tapped back to its
     slips with the Cebuano audio control, and Try to break it.
   - **Deep dive, 0:57-2:34.** Opens on a 1.5 s bumper ("The deep dive: one season, step by step"). The paper and
     the pink carbon; funding; reading (R1's exhibit, and the run's labelled stand-in); count it once; holds
     decided by a person and the refused deduction; two keys; payouts and the move to cash; Proof; the member's
     peso; the member's PREMIUM sentence, alone in its beat; why it holds up (a card).
   - **Close, 2:34-2:55.** Limits and disclosures (a card, spoken), impact, the end card.
2. **Budget.** At most 175 s (2:55). At most **371 spoken words** (the first draft's need): E-19's `MAX_WORDS`
   moves from 240 to 371 and no further. After the review round the script says 368 (the stand-in take 366), which
   leaves a small margin under the cap. The pace limit is unchanged: 140 wpm or less in every beat (2.33 words a
   second, inside the owner's 2.6), and also inside a beat's speech window when it speaks in only part of its time
   (`speech`). A beat may be as short as 5 s, because each product step has its own line and picture; the pace
   limit, not the beat length, protects the narration.
3. **Pictures.** Every picture is an original card or diagram (typography and SVG drawn from the script's data) or
   a recording of the real product: the console in film mode, a phone, or Proof in the browser. The script owns
   the capture slots (`CAPTURES`: id, beat, start, duration, source, the on-screen state, the moment phase, the
   persona, the reel label, the narration words a clip cuts in on, the clip's own evidence lines and the
   design-1104 reference screenshot of that state); `build.mjs` writes them to `captures.json`. Card beats carry no
   capture slot; every other beat is covered end to end. The film shows only the images the run has: photos A–L
   (12 photos, 48 slips) composed in code, never a count of slip images or of manifest-only photos, and the limits
   card says the slip images are Codex-made hero flats and code-composed photos.
4. **Reading.** The film selects the `real-reading` variant: it cuts to the 'Slip 0403, M-014' tile of R1's
   exhibit, captioned exactly "Claude's real reading of this slip, recorded 1 Nov 2026" only while that clip
   plays, and says "The run itself replays a labelled stand-in" as it cuts to the run's slip 0462 by hand, which
   carries "Seed stand-in, not a Claude recording". The first caption rail, the solution card, the limits card and
   the end card repeat that demo runs use a seed stand-in.
5. **Prior art.** The film names no other project (S5.6.1: no rival product names) and claims only the
   combination, scoped to what the 4 Nov scan found: the narration says "Others we found share parts; none starts
   from a handwritten weigh-slip", and the "why it holds up" card reads "None we found starts from a handwritten
   weigh-slip." over "Others we found share parts, not the combination · 4 Nov scan". The film never says that no
   one reads handwriting, that similar projects protect a payer, or that Fair Split alone protects the people being
   paid. This supersedes the register's film sentence at line 442 for the film.
6. **Unchanged.** Only Analyn and Lantern Bay are named aloud (the Chair and a member without PayPal are roles;
   Nang Celing is a lower third). Disclosures sit on the first caption rail and the end card. Every PayPal-derived
   value is labelled "Simulated PayPal sandbox" (ADR-0002, ADR-0010). The member clip plays alone. Accelerated
   waits are labelled "×12 real time"; a person signing is never accelerated.
7. **The test count.** The film says "more than five thousand automated tests". The floor is measured, not
   estimated: at 2af75e6 `vitest list` collects 5,016 cases across the workspace packages and media; the merge
   trials' per-package pass counts are higher. Playwright lists 33 end-to-end tests, but some are fixme or skip, so
   the film names Playwright specs without a count. S5.6.2 still applies: at lock the film may print CI's own
   passed count instead.
8. **The co-sign rule.** The Chair co-signs only over rule R5's limits (a batch over US$300.00, a line over
   US$150.00, or any override), so the film says "Two officers sign large batches", the solution card gives the
   whole rule, and the diagram's keys box says "over the co-sign limits".

## Consequences

- WS-MEDIA: F2's rebuild in the new look (a separate change) uses the cards, the reveal steps,
  the reel labels and the 22 capture slots as generated; colours live only in `film.css`. F3 records the 22 slots
  (`captures.json` `shows` and `reference`); three have no design-1104 reference yet (the exhibit tile, the Chair's
  physical phone, the Paminawa panel M-MB-03). F4 aligns the narration to v4's beat boundaries without moving them
  and plays only the 8.44 s PREMIUM clip in the listening beat (134-143); when it does, the reel cuts and the
  holds cut move with the aligned words (`check.mjs` holds each `word` cut to 0.3 s).
- WS-QA: `packages/test-kit/test/e19/script.ts` sets `MAX_WORDS = 371`; the E-19 planted over-budget script grows
  with the cap; `film-script.test.ts` asserts v4's parts, order, pace, disclosures, the reveal and its hold, the
  reel's features and cuts, the timed reading labels, the co-sign rule, the images shown and the narrowed
  prior-art line. `docs/devpost.md` quotes the script's description disclosure and is regenerated with it.
- README and Devpost text (S1/S2) carry the same narrowed prior-art paragraph; the register's line 442 is left as
  written (docs/spec is not edited) and this ADR wins for the film.
- What gets worse: 53% more words and beats under 10 s make a denser film. The 140 wpm ceiling per beat holds, the
  average is about 126 wpm, and the listening and "why it holds up" beats slow down.

## Alternatives considered

| Option                                              | Why not                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Keep 240 words and cut the deep dive                | The owner asked for the overview and then the depth; 240 words cannot carry both              |
| A silent highlight reel with on-screen labels only  | Judges hear the explanation; the captions come from speech                                    |
| Run to 3:00                                         | The contest says under 3 minutes; 2:55 keeps a margin for encoding and title frames           |
| Name the nearest projects (Neighborline, Last Call) | S5.6.1 bans rival product names in the film; the README carries the dated comparison          |
| Keep the stand-in reading variant                   | R1 and its exhibit are on main; the film may show a real reading as long as it labels the run |
