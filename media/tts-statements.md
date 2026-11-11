# AU3 round 6: 93/101 verified clips; all 18 variants disposed

All people, payroll and audio are synthetic. PayPal-derived facts are **Simulated PayPal sandbox**.
Seeded readings are a **Seed stand-in, not a Claude recording**. The audit agent is paused;
nothing claims Claude drafted an invoice. Native pronunciation and naturalness review remains open.

## Result

Started **2026-11-11T08:11:42.173Z**, after the **11 November 2026 08:00 UTC** quota reset.
Finished **2026-11-11T08:32:43.629Z**. **10 clips added; 93/101 published and verified;
8 exact refusals**. Every one of the original 18 variants is either published or explicitly
refused in audio/statement-validation.json. Missing clips retain the labelled device voice.
M-014 Cebuano remains 9/9, and its API completion guard remains enabled.

| Planned request, original order | Verified/planned |
| ------------------------------- | ---------------: |
| M-014:ceb                       |              9/9 |
| M-014:fil                       |              8/9 |
| M-014:en                        |              8/9 |
| M-007:ceb                       |              9/9 |
| M-060:fil                       |              8/9 |
| M-018:ceb                       |             9/10 |
| M-039:en                        |              8/9 |
| M-022:ceb                       |              9/9 |
| M-002:ceb                       |              8/9 |
| M-031:en                        |             8/10 |
| M-053:ceb                       |              9/9 |

## Published this round

- M-018:ceb DEDUCTION.default: `audio/M-018/ceb/s05-DEDUCTION-ff4fa9e5ec2f.m4a`, CER **0.014**, gemini-2.5-flash.
- M-014:en BONUS.default: `audio/M-014/en/s04-BONUS-1ab5768d7f45.m4a`, CER **0**, gemini-2.5-flash.
- M-007:ceb GREETING.default: `audio/M-007/ceb/s01-GREETING-8754aa02c388.m4a`, CER **0.019**, gemini-2.5-flash.
- M-007:ceb PAY.paypal: `audio/M-007/ceb/s07-PAY-34f3c502c632.m4a`, CER **0.009**, gemini-2.5-flash.
- M-060:fil PAY.paypal: `audio/M-060/fil/s07-PAY-9567827aaede.m4a`, CER **0.022**, gemini-2.5-flash.
- M-018:ceb PAY.paypal: `audio/M-018/ceb/s07-PAY-8dd779afb9f9.m4a`, CER **0.005**, gemini-2.5-flash.
- M-022:ceb DELIVERY.default: `audio/M-022/ceb/s02-DELIVERY-f31db268d517.m4a`, CER **0.034**, gemini-2.5-flash.
- M-002:ceb DELIVERY.default: `audio/M-002/ceb/s02-DELIVERY-5149103b0a1f.m4a`, CER **0.038**, gemini-2.5-flash.
- M-031:en GREETING.default: `audio/M-031/en/s01-GREETING-5001953557bd.m4a`, CER **0**, gemini-2.5-flash.
- M-053:ceb DEDUCTION.default: `audio/M-053/ceb/s05-DEDUCTION-5a12cd17b7af.m4a`, CER **0.025**, gemini-2.5-flash.

## Request and take accounting

**70 physical requests**, including **1 interrupted reservation(s)**,
all retained in media/audio/.quota.json. No refunds, paid model, higher cap or external host.
All calls went through KeyPool; SDK retries were disabled and maxAttempts was one.

| Model                | Round-six counted requests | Eligible reservations left |
| -------------------- | -------------------------: | -------------------------: |
| gemini-3.8-flash-tts |                         17 |                        103 |
| gemini-3.8-flash     |                          7 |                        113 |
| gemini-3.6-flash     |                          9 |                        111 |
| gemini-2.5-flash     |                         37 |                         13 |

At least **six eligible requests per model** remain untouched for the film. The 2.5 totals exclude
the seven account/model pairs already refused with 404 in round five. Caps remain self-imposed,
unmeasured entitlement guesses. Highest-first ASR order is 3.8, 3.6, then 2.5; bounded outages,
transcripts and per-request key IDs (never key values) are retained in the report.

The cached M-018 Cebuano DEDUCTION Achird take was checked before new generation. Every physical
request is durably recorded before its client callback, including failures and interruptions;
take limits carry across voices and restarts. The three historical overruns (M-007 Cebuano PAY,
M-060 Filipino PAY and M-018 Cebuano PREMIUM) have at most **one** new take each; every other
variant has at most **two**. No further automatic generation is authorized by this completed round.
Before fresh speech, the runner checks that a non-open ASR model still has more than six eligible
reservations. One restart installed that preflight and an outer transport deadline; interrupted
provider outcome remains unknown, and its reservation stays counted.

CER remains **0.12**. Frozen text, numeric and initialism anchors, unique contiguous alignment,
measured timestamps, monotonicity, non-overlap and AAC-duration bounds are unchanged. No timestamp
was clamped or guessed. Each new published proof includes its exact independently transcribed words,
AAC hash, text hash and original request hash. All pre-existing manifest entries and bytes are preserved.

## Exact refusals

- **M-014:fil GREETING.default**: Invalid timestamp "pagsisikap." 4.708-5.478 s; previous end 4.708 s; AAC duration 5.28 s

- **M-014:en HELP.default**: Invalid timestamp "Bodega" 4.14-4.67 s; previous end 4.1 s; AAC duration 4.16 s

- **M-060:fil GREETING.default**: Failed unique contiguous exact-number/initialism anchor alignment: fact:HONORIFIC_NAME="G. Sumampao"

- **M-018:ceb PREMIUM.default**: Failed unique contiguous exact-number/initialism anchor alignment: fact:PAYER="Lantern Bay Chocolate Co."

- **M-039:en HELP.default**: Invalid timestamp "Bodega" 4.14-4.67 s; previous end 4.1 s; AAC duration 4.16 s

- **M-002:ceb GREETING.default**: Failed unique contiguous exact-number/initialism anchor alignment: fact:HONORIFIC_NAME="Nang Ciay"

- **M-031:en PAY.paypal**: Invalid timestamp "change" 18.73-19.01 s; previous end 18.6 s; AAC duration 19 s; Invalid timestamp "it." 19.11-19.29 s; previous end 19.01 s; AAC duration 19 s

- **M-031:en HELP.default**: Invalid timestamp "Bodega" 4.14-4.67 s; previous end 4.1 s; AAC duration 4.16 s

Full verbatim transcripts, words/times, CER, measured duration and failed anchor detail are in the
round-six report's attempts/refusalEvidence. Unvisited variants, if any, explicitly say they were not
attempted because of the exact bounded-run stop. Quality/service recovery time is unknown;
the next quota reset is **2026-11-12T08:00:00.000Z**, which guarantees neither service nor correct speech.

## Historical evidence and checks

Round five's validation receipt is preserved at audio/history/round5-validation.json; its tests retain
every original assertion against that historical receipt. The current report is round six. The new
receipt tests check all 18 dispositions, bounded physical requests, six-request headroom, preserved
baseline hashes and every new clip's strict measured alignment. Final verification results are recorded
in the builder report. Local caches and the quota ledger remain ignored; no WAV is published.

---

# Historical round 5: 83/101 verified clips; exact remaining refusals recorded

All people, payroll and audio are synthetic. PayPal-derived facts are **Simulated PayPal sandbox**.
Seeded readings are a **Seed stand-in, not a Claude recording**. The audit agent is paused;
nothing claims Claude drafted an invoice. Native pronunciation and naturalness review remains open.

## Result

Started **2026-11-10T18:44:29.414Z**, after the required 5 November 08:00 UTC reset.
Cloud work stopped **2026-11-10T19:06:15.172Z** on **quota_refused**. **83/101** planned variants
are independently verified and published, **24 added this round**. M-014 Cebuano remains 9/9;
its API completion guard stays enabled. Every missing sentence keeps the labelled device voice.

| Planned request, original order | Verified/planned |
| ------------------------------- | ---------------: |
| M-014:ceb                       |              9/9 |
| M-014:fil                       |              8/9 |
| M-014:en                        |              7/9 |
| M-007:ceb                       |              7/9 |
| M-060:fil                       |              7/9 |
| M-018:ceb                       |             7/10 |
| M-039:en                        |              8/9 |
| M-022:ceb                       |              8/9 |
| M-002:ceb                       |              7/9 |
| M-031:en                        |             7/10 |
| M-053:ceb                       |              8/9 |

All ten service-blocked variants were retried first, in their original order: seven published,
three received quality refusals. All other missing variants were then visited in plan order;
already verified Rhea PAY.cash_nodate was retained, and PAY.paypal remains refused. The first pass
published 17 clips. Two lexical fixes recovered five additional AI_NOTE clips cache-only with
**zero network requests and an unchanged quota ledger**. A studied quality continuation added two
Filipino clips, then stopped on the usable 2.5 accounts' cap. No WAV, unverified candidate,
changed frozen sentence, guessed timestamp or relaxed threshold is published.

## Diagnosis and verification policy

- Exact-token CBU canonicalizes to c b u, keeping the measured first-letter onset. The long rule-label
  anchor additionally requires the exact C B U sequence. Tests refuse C B V, C B X, CBV, CBX,
  a changed deduction and R two. CER remains **0.12**, with the exact number-word sequence gate intact.
- Only whole-token Annalyn canonicalizes to Analyn, an independent transcript's doubled-n spelling.
  Annalin, Ann Lynn, Annabelle and a changed amount remain refused. The source text and its hash stay frozen.
- Good-text/bad-timestamp AACs were independently transcribed again without new TTS. English BONUS
  still failed; its actual words/times and measured duration are retained in the validation file.
- Wrong takes received verbatim sentence requests on the approved voice shortlist. Missing ASR capacity
  stops generation. Original and refused caches remain intact under media/.cache/. No service restart or paid model.

## Stop and exact eligibility

Next usable-ASR quota eligibility: **11 November 2026, 08:00:00 UTC / 13:30:00 IST**.
That is a quota reset, not a promise of correct speech, account access or service recovery.
3.8 returned HTTP 503 UNAVAILABLE and HTTP 504 DEADLINE_EXCEEDED; 3.6 returned HTTP 503 UNAVAILABLE.
Their existing six-failure circuits stayed open during the continuation. The approved 2.5 fallback
served verification; seven account/model pairs returned 404 NOT_FOUND (no access for new users).
Five usable accounts then reached the self-imposed 10-per-key/model/day cap. No 429 occurred.

Exact final refusal: PoolExhaustedError: No Gemini key is ready for gemini-2.5-flash until 2026-11-11T08:00:00.000Z (2026-11-11 00:00 Pacific); 6 keys: 5 at the daily cap. Stopping rather than waiting more than 5 min; statements without a clip fall back to the labelled device voice.

| Model                | Counted reservations this Pacific day | Remaining eligible-account reservations |
| -------------------- | ------------------------------------: | --------------------------------------: |
| gemini-3.8-flash-tts |                                    42 |                                      78 |
| gemini-3.8-flash     |                                     6 |                                     114 |
| gemini-3.6-flash     |                                     9 |                                     111 |
| gemini-2.5-flash     |                                    57 |                                       0 |

Refusals, transient failures and interrupted reservations count; none was refunded. Caps are
self-imposed guesses, not measured Google entitlements. Higher models retain quota but their
service recovery time is **unknown**. All key IDs, model-specific refusals and next eligibility
times are in audio/statement-validation.json; no key value is stored in this handoff or evidence.

## Cumulative take-budget overruns

The cumulative audit found a mistake: the two passes used separate per-sentence counters.
The continuation allowed two Achird takes after an earlier fresh Sulafat retake for three sentences:
- M-007:ceb PAY: **3 fresh takes**, intended limit 2. None published.
- M-060:fil PAY: **3 fresh takes**, intended limit 2. None published.
- M-018:ceb PREMIUM: **3 fresh takes**, intended limit 2. None published.

All 42 fresh TTS request hashes are accounted for in takeBudgetAudit,
including these three extra requests and the final cached-only take awaiting ASR. Cloud work is stopped.
**Carry the cumulative take hashes across voices and process restarts; do not reset the per-sentence budget.**
The remaining requested bound was exceeded for these three variants; this is disclosed, not a claim of compliance.

## Every remaining variant

Each row's full transcript, exact AAC hash, ASR model, CER and failed anchor/timestamp detail is in
audio/statement-validation.json under planned[].sentences[].refusalEvidence / lastRefusal.
The next eligibility below is the usable-ASR quota reset; service and quality recovery remain unknown.
- **M-014:fil GREETING.default**: Invalid timestamp "pagsisikap." 4.998-5.698 s; previous end 4.648 s; AAC duration 5.24 s Next quota eligibility: 2026-11-11T08:00:00.000Z.

- **M-014:en BONUS.default**: Invalid timestamp "cents" 4.05-4.38 s; previous end 3.95 s; AAC duration 4.32 s Next quota eligibility: 2026-11-11T08:00:00.000Z.

- **M-014:en HELP.default**: Invalid timestamp "bodega" 4.14-4.62 s; previous end 3.85 s; AAC duration 4.2 s Next quota eligibility: 2026-11-11T08:00:00.000Z.

- **M-007:ceb GREETING.default**: Invalid timestamp "paghago." 4.091-4.671 s; previous end 3.901 s; AAC duration 4.64 s Next quota eligibility: 2026-11-11T08:00:00.000Z.

- **M-007:ceb PAY.paypal**: Failed unique contiguous exact-number/initialism anchor alignment: fact:FX_FEE="three porsiyento" Next quota eligibility: 2026-11-11T08:00:00.000Z.

- **M-060:fil GREETING.default**: Failed unique contiguous exact-number/initialism anchor alignment: fact:HONORIFIC_NAME="G. Sumampao" Next quota eligibility: 2026-11-11T08:00:00.000Z.

- **M-060:fil PAY.paypal**: Invalid timestamp "pagpapalit" 18.174-18.774 s; previous end 18.064 s; AAC duration 18.6 s Next quota eligibility: 2026-11-11T08:00:00.000Z.

- **M-018:ceb PREMIUM.default**: Failed unique contiguous exact-number/initialism anchor alignment: fact:PAYER="Lantern Bay Chocolate Co." Next quota eligibility: 2026-11-11T08:00:00.000Z.

- **M-018:ceb DEDUCTION.default**: PoolExhaustedError: No Gemini key is ready for gemini-2.5-flash until 2026-11-11T08:00:00.000Z (2026-11-11 00:00 Pacific); 6 keys: 5 at the daily cap. Stopping rather than waiting more than 5 min; statements without a clip fall back to the labelled device voice. Next quota eligibility: 2026-11-11T08:00:00.000Z.

- **M-018:ceb PAY.paypal**: Invalid timestamp "pag-ilis." 18.912-19.462 s; previous end 18.822 s; AAC duration 19.28 s Next quota eligibility: 2026-11-11T08:00:00.000Z.

- **M-039:en HELP.default**: Invalid timestamp "bodega" 4.14-4.62 s; previous end 3.85 s; AAC duration 4.2 s Next quota eligibility: 2026-11-11T08:00:00.000Z.

- **M-022:ceb DELIVERY.default**: Invalid timestamp "one" 8.512-8.792 s; previous end 8.282 s; AAC duration 8.56 s Next quota eligibility: 2026-11-11T08:00:00.000Z.

- **M-002:ceb GREETING.default**: Failed unique contiguous exact-number/initialism anchor alignment: fact:HONORIFIC_NAME="Nang Ciay" Next quota eligibility: 2026-11-11T08:00:00.000Z.

- **M-002:ceb DELIVERY.default**: Failed unique contiguous exact-number/initialism anchor alignment: fact:GRADE_SUMMARY="sixty kilos niini Grade one" Next quota eligibility: 2026-11-11T08:00:00.000Z.

- **M-031:en GREETING.default**: Invalid timestamp "hard" 4.19-4.47 s; previous end 3.97 s; AAC duration 4.28 s; Invalid timestamp "work." 4.57-4.88 s; previous end 4.47 s; AAC duration 4.28 s Next quota eligibility: 2026-11-11T08:00:00.000Z.

- **M-031:en PAY.paypal**: Invalid timestamp "it" 16.254-16.364 s; previous end 16.204 s; AAC duration 16.32 s Next quota eligibility: 2026-11-11T08:00:00.000Z.

- **M-031:en HELP.default**: Invalid timestamp "bodega" 4.14-4.62 s; previous end 3.85 s; AAC duration 4.2 s Next quota eligibility: 2026-11-11T08:00:00.000Z.

- **M-053:ceb DEDUCTION.default**: CER 0.494 exceeds 0.12 Next quota eligibility: 2026-11-11T08:00:00.000Z.

## Resume and checks

Keep ignored .env, media/.cache/tts/, media/.cache/tts-round5-independent/ and media/audio/.quota.json.
Use the retained frozen plans and cached takes first. Resume the remaining variants in plan order
after eligibility, honoring takeBudgetAudit across all passes. For the already-cached unverified
M-018 Cebuano DEDUCTION Achird take, verify it before spending any new TTS request.
Do not repeatedly restart against the same observed service outages. Keep the M-014 completion guard enabled.

Final checks: **388 media tests passed; 39 API media tests passed; 4 receipt tests passed**. Media typecheck, Biome and the dependency gate passed. Independent audit rechecked all 83 published AAC hashes, exact cached ASR, strict anchors and measured offsets; all 64 pre-existing manifest entries are unchanged. Scratch Postgres is stopped. Publication remains partial and pending native review.

---

# Historical round 4: M-014 Cebuano complete; 59/101 verified clips

All people, payroll and audio are synthetic. PayPal-derived facts are **Simulated PayPal sandbox**.
Seeded readings are a **Seed stand-in, not a Claude recording**; the audit agent remains paused.
Nothing claims Claude drafted an invoice. Native pronunciation and naturalness review remains open.

## Result at 2026-11-04T11:11:53.678Z

**M-014 Cebuano is 9/9. 59/101 planned variants are independently verified and published**
(30 added this round). The API full-completion test is enabled and passes. Missing clips retain
the labelled device voice. This is a partial release of the full plan, not 101-clip completion.
The 42 remaining variants are 32 quality refusals and 10 waiting on service.

| Planned request, original order | Verified/planned |
| ------------------------------- | ---------------: |
| M-014:ceb                       |              9/9 |
| M-014:fil                       |              5/9 |
| M-014:en                        |              6/9 |
| M-007:ceb                       |              7/9 |
| M-060:fil                       |              4/9 |
| M-018:ceb                       |             4/10 |
| M-039:en                        |              3/9 |
| M-022:ceb                       |              5/9 |
| M-002:ceb                       |              6/9 |
| M-031:en                        |             5/10 |
| M-053:ceb                       |              5/9 |

## PAY diagnosis and proof

The frozen NET_PHP anchor contains `gibanabana`; an independently transcribed, correctly spoken
marked take spells the same compound `gibana-bana`. Punctuation normalization split it into two tokens,
so the unchanged contiguous-anchor rule refused it. `normaliseForCer` now canonicalizes only that
explicit hyphenated spelling, before punctuation removal. It does not join arbitrary words or number
hyphens, translate fee wording, infer a number, or alter the frozen text.

Tests first reproduced that refusal. A nearest-neighbor negative also exposed an existing weakness:
the old CER gate could accept twenty-nine instead of twenty-eight inside a long amount anchor.
Alignment now additionally requires identical English number-word sequences within each anchor.
Wrong peso amounts, changed dollar cents and translated fee wording remain refused. CER stays **0.12**;
unique, contiguous, measured, monotonic, non-overlapping and in-bounds timestamp checks remain intact.

Published PAY: `audio/M-014/ceb/s07-PAY-951cf7877220.m4a`, **32 kbps mono AAC**, 22,070 ms.
Source: original cached marked PAY-only request, Vindemiatrix, normal STYLE_NOTE, TTS 3.8;
WAV cache `d9813392be76d9090d5bf03efb6707e233c9c23129e27ebd0e41d8856dab4dbb`, cut 0.06-22.13 s.
AAC SHA-256: `d04a5aea555d4d1c156809f066beb361cd4a0561b3814833dbc49859e9d7a966`.
Independent ASR: gemini-2.5-flash, CER **0.01**, method relative-silence-duration.
Measured onsets: NET_USD 4,607 ms; NET_PHP 10,977 ms; FX_FEE 18,497 ms.
The normal pipeline replayed this exact marked take from a scratch cache with network calls disabled;
the quota ledger hash stayed unchanged. Original WAVs, rejected AACs and transcripts remain intact.

Before recovering the marked take, the older three-voice helper generated three fresh verbatim PAY
retakes (Achird, Vindemiatrix, Gacrux), all refused. This was one request beyond the intended two;
all reservations remain counted. No further PAY generation ran after the hero was complete.

## Both quota windows and remaining work

The pre-reset plan stopped at 2026-11-04T07:12:59.006Z on `TTS request failed (no status):
Unable to make request: TypeError: fetch failed`. After the 08:00 UTC reset, the normal plan resumed;
it stopped at 2026-11-04T10:11:37.230Z on TTS HTTP 503 high demand. A bounded continuation then
retained one pool through the original request order, allowing later requests after transient service
refusals (at most six such failures). Highest-first ASR remained 3.8 -> 3.6 -> 2.5, with its existing
outage circuits, per-account exclusions, per-key caps and SDK retries off. No paid model or billing.

Final cloud outcome: **service_unavailable**, at **2026-11-04T11:09:35.113Z**.
Exact final refusal: AsrUnavailableError: ASR service unavailable after bounded backoff; stopped to preserve free quota. Cached takes retained. {"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}

Next quota reset: **5 November 2026, 08:00 UTC / 13:30 IST**. Quota was not exhausted; service and quality refusals remain.
Service or account-access recovery has **no known time**; a daily reset does not promise recovery or
correct speech. Quality failures need a new verified take or independent timestamp transcription,
not a lowered gate. `audio/statement-validation.json` lists each remaining sentence's reason and
next eligibility, every key/model reservation and account-specific access refusal.

| Pacific quota day | Model                | Counted reservations |
| ----------------- | -------------------- | -------------------: |
| 2026-11-03        | gemini-3.8-flash-tts |                    5 |
| 2026-11-03        | gemini-3.8-flash     |                    4 |
| 2026-11-03        | gemini-3.6-flash     |                    4 |
| 2026-11-03        | gemini-2.5-flash     |                    2 |
| 2026-11-04        | gemini-3.8-flash-tts |                   63 |
| 2026-11-04        | gemini-3.8-flash     |                    8 |
| 2026-11-04        | gemini-3.6-flash     |                  113 |
| 2026-11-04        | gemini-2.5-flash     |                   37 |

These remain self-imposed 10-per-key/model/day caps, not measured Google entitlements. Refusals and
transport failures count; none was refunded. Model-specific 404s exclude only that account/model pair.
The final cache-only pass added **0** clips with **zero network requests**
and an unchanged real quota ledger. Its time is separate from the cloud-stop time.

## Verification and resume

- Tests-first RED: enabled API completion test failed specifically on missing PAY; spelling regression
  failed on gibana-bana tokenization; wrong-amount regression failed before numeric sequence tightening.
- Media suite: **379 passed**, 33 files. API media suite: **39 passed**, five files, no skipped completion guard.
- Independent offline audit: all 59 AAC hashes, exact timed ASR caches, strict alignments and offsets match.
  The original 34 manifest entries are semantically unchanged; all added audio is 32 kbps mono AAC.
- Both package typechecks, Biome, dependency gate and per-scope ownership checks pass (builder report).
- No WAV committed, no frozen export or threshold changed, no dependency or ADR added.
- Keep ignored `.env`, `media/.cache/tts/` and `media/audio/.quota.json`; never print a key.

When service/account access and quota permit, resume in original plan order; exact verified clips skip:

```powershell
corepack pnpm --filter @fairsplit/media tts statements
```

Do not repeatedly restart against the same observed outages. The API completion guard must stay enabled.
Native review remains open. English BONUS and other good-text/bad-timestamp candidates can be independently
transcribed again from retained AAC bytes; do not stretch their timestamps or generate unnecessary speech.

---

# Historical round 3: partial publication, hero PAY still refused

All people, payroll and audio are synthetic. PayPal-derived facts are **Simulated PayPal sandbox**.
Seeded AI notes are a labelled stand-in for Claude; nothing claims a live Claude reading or a Claude-drafted invoice.
Cebuano and Filipino wording, pronunciation and naturalness remain pending native review.

## Result at 2026-11-01 08:57:33 UTC / 2026-11-01 14:27:33 IST

**M-014 Cebuano is 8/9; 29/101 planned variants are verified and published.** Round 3 added
28 variants beyond the original BONUS. PAY.paypal remains missing, text hash
`951cf7877220320908429ecf06d73f2726e849762964b5a51e1407fcc1361826`.
No frozen text, numeric fact, threshold, offset assertion or failed transcript was altered to obtain a pass.
Every missing clip keeps the labelled device voice. The enabled full API completion guard was run RED
specifically on PAY. Its baseline skip is unchanged in the API diff because all nine clips are not published.
The passing subset test checks eight real hero AAC files, curated assembly, labels and served byte hashes.

| Planned request, original order | Verified / planned |
| ------------------------------- | -----------------: |
| M-014:ceb                       |                8/9 |
| M-014:fil                       |                5/9 |
| M-014:en                        |                3/9 |
| M-007:ceb                       |                4/9 |
| M-060:fil                       |                1/9 |
| M-018:ceb                       |               2/10 |
| M-039:en                        |                0/9 |
| M-022:ceb                       |                2/9 |
| M-002:ceb                       |                2/9 |
| M-031:en                        |               0/10 |
| M-053:ceb                       |                2/9 |

## Verification and fallback

Default ASR order is **gemini-3.8-flash -> gemini-3.6-flash -> gemini-2.5-flash**. The current top model
remains first. Live models.list through the key-pool module was checked at 2026-11-01 07:22:26.500 UTC.
[Google pricing](https://ai.google.dev/gemini-api/docs/pricing) marks all three free of charge; the
[3.6 model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash) accepts audio, and the 2.5
pricing row includes audio input. 3.5 Flash was listed but has no current free pricing row; no entitlement
was inferred from inventory alone.
- Transient 408/500/502/503/504, UNAVAILABLE or overloaded replies try the next approved model.
  SDK retries remain off; every physical request goes through KeyPool and its real ledger.
- Six consecutive failures or six failures in eight calls open that model's circuit for the run;
  healthy lower models retain their own history. Backoff is bounded. Permanent input errors do not
  switch models. A model-specific account 404 excludes only that account/model pair and immediately
  tries the next eligible key. Other models, per-key caps, attempt budgets and scrubbing are preserved.
- The timestamp recogniser never sees the reference sentence. It asks for spoken number words.
  CER stays **0.12** with the same unique, contiguous, non-overlapping and in-bounds anchor checks.
  Every accepted exact AAC/text hash records its actual ASR model in `audio/statement-verification.json`.
- Original cached sentences were tried before new speech. A refused cached sentence can get one
  separately cached verbatim retake. A service error never authorises a new TTS take. Original WAVs
  and immutable published paths are retained. No WAV is committed.
- PAY was also tried with the approved Achird, Vindemiatrix and Gacrux voices after Sulafat failed.
  None passed. Refusals included translated fee words or differing tokenisation within a frozen anchor.
  The rejected AAC candidates and all generated takes remain in the ignored cache.

After the live 3.8 and 3.6 circuits opened, a continuation retained those observed outages and used
approved 2.5 ASR in plan order, without repeatedly probing the same outages on each process restart.
This operational choice is explicit in `statement-validation.json`; normal CLI defaults stay highest-first.
The continuation saved **18** verified variants, then stopped at **2026-11-01T08:49:53.883Z** on the usable 2.5 accounts'
self-imposed caps. A subsequent cache-only pass tried every planned sentence through the normal pipeline
with generation disabled. It recovered **11** clips from exact AAC transcription caches, including shared
HELP and seeded AI_NOTE text. **0 network requests; the real quota ledger SHA-256 stayed unchanged.**

## Exact blockers and eligibility

Observed errors are retained separately from quality refusals:
- 3.8: **504 DEADLINE_EXCEEDED**, `Deadline expired before operation could complete.` Also 503 UNAVAILABLE.
- 3.6: **503 UNAVAILABLE**, `This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.`
- Seven 2.5 accounts: **404 NOT_FOUND**, `This model models/gemini-2.5-flash is no longer available to new users.`
  Other accounts served 2.5 successfully, so a refusal is account/model-specific.
- Final stop: **PoolExhaustedError**; no ready 2.5 key until `2026-11-02T08:00:00.000Z`; five usable
  accounts at their self-imposed daily cap. No 429 occurred in round 3.

Fallback quota eligibility: **2 November 2026, 08:00:00 UTC / 13:30:00 IST**.
Higher ASR models retain quota but service recovery has **no known time**. A reset does not guarantee
account access, service availability or verification quality. Every unpublished planned sentence has
its reason and fallback reset in the validation file. Every key/model has `nextEligibleAt` or an explicit
unknown access-recovery reason. The original cloud-stop time and the later offline-recovery time are separate.

| Model                | Counted requests this Pacific day | Remaining eligible-account reservations |
| -------------------- | --------------------------------: | --------------------------------------: |
| gemini-3.8-flash-tts |                                38 |                                      82 |
| gemini-3.8-flash     |                                42 |                                      78 |
| gemini-3.6-flash     |                                27 |                                      93 |
| gemini-2.5-flash     |                                66 |                                       0 |

These are self-imposed **10 per key/model/day** caps, not measured Google entitlements. Counts include
refusals and interrupted reservations conservatively; none was refunded. Used totals include refused
accounts; remaining reservations exclude account/model pairs refused this run. Billing was never enabled.

## Resume and open work

Preserve `.env`, `media/.cache/tts/` and `media/audio/.quota.json` in this worktree. After eligibility and
service recovery, retry the hero first. No re-export, change to frozen text or new dependency is needed:

```powershell
corepack pnpm --filter @fairsplit/media tts statements --only M-014:ceb
corepack pnpm --filter @fairsplit/media tts statements
```

Enable the full-completion guard only after PAY passes independent verification and all nine hero clips
are published. Native review remains open. Default CLI readiness accepts all three approved provenance
models and skips exact already-verified clips. The API evidence allowlist matches those three models;
its regression still rejects CER 0.121 and an unapproved paid model.

## Round 3 checks

Tests-first RED receipts covered transient fallback, permanent refusal, ordered 2.5 fallback,
account-specific availability, cached quality retake, no new TTS during service failure, partial outages
and combined service errors. Media code suite: **377 tests passed**, 33 files. Enabled API full guard:
**1 failed, 2 passed**, specifically missing PAY. Final API media suite: **38 passed, 1 originally skipped**,
five files; scratch Postgres stopped. Both package typechecks, Biome and dependency gate passed.
Final post-publication media and per-scope ownership receipts are in the builder report.

---

## Previous handoff (historical)

All people, payroll facts and audio are synthetic. PayPal-derived facts are **Simulated PayPal sandbox**.
Seeded AI notes describe a stand-in for Claude; nothing claims a live reading or an invoice drafted by Claude.
Cebuano and Filipino wording and pronunciation remain pending native review.

## Resume result: 1 November 2026, 07:13:27.915 UTC / 12:43:27.915 IST

The clock was checked at **07:02:21 UTC**, after every key's recorded eligibility. The resume used
`tts statements --only M-014:ceb`. It stopped cleanly on **six consecutive transient ASR service
failures**, not spent quota: **0 successful ASRs, 0 new TTS requests, 0 new published clips**.
There was no 429 in this run. The existing BONUS remains the only verified hero clip, so **1/9 hero
clips and 1/101 planned sentence variants are published**. The remaining eight hero slots are GREETING,
DELIVERY, PREMIUM, DEDUCTION, PAY, SOURCES, HELP and AI_NOTE. All 100 unpublished variants are explicitly
`waiting_on_service` in `audio/statement-validation.json`, in the original plan order. The later members
were not sent to Gemini while the verification service was failing.

The full marked take and **all nine plain hero sentence retakes are still cached**. The resume checked
the cached GREETING and DELIVERY retakes before any full-take split or new TTS. Each exhausted three
ASR attempts, with 5 s then 15 s backoff. Actual requests remain counted, one per key on the first six
keys; none was refunded. The run now stops after six consecutive transient ASR failures across candidates,
and a successful response resets that streak. Already in-flight parallel full-take checks settle before
reporting, so six is the serial recovery bound, not a claim that parallel calls can never exceed it.
SDK retries remain off. Failed candidates never enter the final manifest.

The run loaded the CLI before the new service-outage reporting change. Its report classification was
corrected offline from its recorded `AsrUnavailableError`, retaining the original time, counts and clip
evidence; `classificationNote` records that correction. Future CLI runs report `service_unavailable`
and the ASR model directly. This is not a quota refusal or a completed audio release.

### Eligibility and remaining allowance at that stop

All twelve keys were eligible again by **07:13:27.915 UTC / 12:43:27.915 IST on 1 November**; none was
cooling or dropped. Service recovery has no known timestamp. Each key's `nextEligibleAt` and both models'
daily resets are recorded in the validation report. The next daily reset is **2 November 2026,
08:00:00 UTC / 13:30:00 IST** (the Pacific DST change makes this a 25-hour day).

| Key ID   | ASR used / remaining | TTS used / remaining |
| -------- | -------------------: | -------------------: |
| 545f0873 |                1 / 9 |               0 / 10 |
| 8e1e9260 |                1 / 9 |               0 / 10 |
| 517676af |                1 / 9 |               0 / 10 |
| fd587165 |                1 / 9 |               0 / 10 |
| 7db4615b |                1 / 9 |               0 / 10 |
| faf5bfce |                1 / 9 |               0 / 10 |
| 33c5ca33 |               0 / 10 |               0 / 10 |
| 9d872d9a |               0 / 10 |               0 / 10 |
| 0a246b54 |               0 / 10 |               0 / 10 |
| 663ea821 |               0 / 10 |               0 / 10 |
| 2d984c38 |               0 / 10 |               0 / 10 |
| faa4c5a0 |               0 / 10 |               0 / 10 |

These are the existing self-imposed caps, not measured Google entitlements: **114 ASR and 120 TTS
reservations remain**. Do not repeatedly restart the command against the same outage to drain them.
When service recovers, use the Resume commands below, hero first; no re-export or new TTS is needed to
retry its nine cached sentences. Enable the full-completion test only when all nine clips pass verification.

### Verification in this resume

- Regression tests ran RED before the cache/backoff, service-report and successful-recovery changes.
- Media suite: **366 tests passed**, 33 files. Tests use synthetic audio and stubbed clients offline.
- API media suite: **37 tests passed, 1 skipped**, 5 files, one scratch Postgres stopped afterward.
- The full-completion guard was temporarily enabled and ran RED on missing GREETING, before database
  startup. Its original skip and assertions are unchanged pending all nine clips; no API commit is needed.
- Both package typechecks, Biome on changed source/tests and the dependency gate passed.

## Earlier run, before the 07:00 UTC reset (historical)

## Published and verified

Only M-014 Cebuano BONUS is newly published: `audio/M-014/ceb/s04-BONUS-a9b70b336c44.m4a`.
It is 32 kbps mono AAC, 6,490 ms, labelled `Sintetikong tingog (Gemini TTS)`, with CER 0 against its own
independent AAC transcription. `audio/statement-verification.json` binds the exact AAC bytes and exported
text hash to that transcript, ASR model, threshold and measured offsets. The API subset acceptance test
checks its real seeded route response, curated assembly and served byte hash. The full nine-sentence
release acceptance test remains RED; AU3 is not done.

There are **9 exported sentence clips** for M-014 Cebuano, not 27: the old 27 boundaries separate
28 marked speech segments, including internal fact/mention starts. All eleven approved requests contain
101 sentence variants in total. One is newly verified/published; 100 remain waiting on the ASR pool.
`audio/statement-validation.json` records every planned sentence and every key/model reset.
Old S10 files remain historical evidence, not AU3 completion. The unverified matching historical Cebuano
greeting has been retired from playback into `audio/archive/manifest.json`; missing hero clips use the
labelled device voice. Historical drafts are labelled in `audio/drafts/manifest.json`, excluded from the
served final manifest. Immutable superseded files retain labels in the archive registry.

## What was tried, in order

1. Reused AU2's cached 93,760 ms WAV before making any new TTS request. Its original cache path is
   `.cache/tts/0d5c51b32a052eeb4721023c802b2f5359353c0a1aa85f7144cf10aacd9fb83b.wav`.
2. Tried strict silence detection, then relative RMS noise-floor detection with a 120 ms minimum gap and
   duration-weighted global gap selection. Each proposed sentence AAC received an independent transcription.
   The full take did not verify: text and/or anchor timing checks failed. BONUS alone passed all checks.
3. Tried full-take timestamp transcription and alignment before changing TTS granularity. Gemini repeatedly
   returned 503 UNAVAILABLE, with some 429 quota refusals. SDK retries were disabled; bounded transient
   retries each went through the KeyPool and its ledger.
4. Generated and cached nine plain sentence retakes through the pool. Repeated ASR 503s prevented keeping
   those retakes. No failed clip was published. They can be verified after reset without another TTS call.
5. Stopped on PoolExhaustedError. The ledger holds 104 ASR reservations (including interrupted requests,
   conservatively still counted) and 10 TTS reservations for this Pacific day: AU2's original take plus
   AU3's nine retakes. Ten keys hit the configured per-model daily cap; two cooled after daily 429s.
   The cap remains ADR-0014's self-imposed 10 per key, an unmeasured guess, not a claim about Google's
   actual free entitlement. No cap was raised and billing was not enabled.

## Exact next eligibility

The following are recorded eligibility times, not a guarantee that Google's busy model will recover.
All dates are 1 November 2026. Eleven keys reset at **07:00:00.000 UTC / 12:30:00.000 IST**;
`faf5bfce` stays cooled until **07:00:00.403 UTC / 12:30:00.403 IST**.

| Key ID (not a key value) | ASR used | Next eligibility UTC |
| ------------------------ | -------: | -------------------- |
| 545f0873                 |       10 | 07:00:00.000         |
| 8e1e9260                 |       10 | 07:00:00.000         |
| 517676af                 |       10 | 07:00:00.000         |
| fd587165                 |       10 | 07:00:00.000         |
| 7db4615b                 |       10 | 07:00:00.000         |
| faf5bfce                 |        2 | 07:00:00.403         |
| 33c5ca33                 |        2 | 07:00:00.000         |
| 9d872d9a                 |       10 | 07:00:00.000         |
| 0a246b54                 |       10 | 07:00:00.000         |
| 663ea821                 |       10 | 07:00:00.000         |
| 2d984c38                 |       10 | 07:00:00.000         |
| faa4c5a0                 |       10 | 07:00:00.000         |

## Resume

Keep the ignored cache and quota ledger in this worktree. No WAV is committed. Keys stay in the
worktree's ignored `.env`; only KeyPool loads them, and reports contain IDs only. After eligibility:

```powershell
corepack pnpm --filter @fairsplit/media tts statements --only M-014:ceb
```

Complete and verify that hero first. Then run the full plan; verified exact clips are skipped:

```powershell
corepack pnpm --filter @fairsplit/media tts statements
```

Order: M-014 ceb, fil, en; M-007 ceb; M-060 fil; M-018 ceb; M-039 en; M-022 ceb; M-002 ceb;
Rhea M-031 en with PAY.paypal and PAY.cash_nodate; Merlyn M-053 ceb. No dated PAY.cash clip is planned.
Do not export again unless API templates or the frozen seed change; hashes must continue to match
`statement-plans.json`. The export command is `corepack pnpm --filter @fairsplit/api exec tsx src/statements/export.cli.ts`.

## Verification policy and files

- TTS uses `gemini-3.8-flash-tts`; ASR uses `ASR_MODEL` (`gemini-3.8-flash`), through all twelve keys,
  each within its own recorded limits. No SDK retries, key values, paid requests or external hosts.
- A proposed cut is not proof. Every final AAC's own ASR must have normalised CER at most **0.12**.
  The recogniser never receives the expected sentence. Explicit leading-zero slip IDs and embedded R1
  spellings are normalised without inferring a missing zero. A bounded anchor spelling variation must
  also meet 0.12 and have a unique contiguous alignment on every optimal token path.
- Offsets come from recognised word timestamps on the final AAC. Ambiguous, missing, overlapping,
  non-finite or out-of-bounds anchors are refused. No duration/character-share offset is published.
- If the full take cannot be verified, each missing sentence gets its own request. Successful sentences
  are persisted before another sentence's quota error. Quality refusals continue to later planned requests;
  exhaustion stops cleanly and records every remaining sentence as waiting on quota.
- Clips stage only inside the ignored cache. Published names are ADR-0011's
  `audio/M-NNN/{lang}/sNN-SLOT-hash12[-tN].m4a`; existing paths are immutable.
- Final, draft and archive registries label every physical audio file exactly once. Only the final
  `audio/manifest.json` is used for playback. A historical exact-text entry without current evidence
  cannot suppress verification or count as newly published.
- Tests use synthetic PCM and stubbed clients offline. The real API release guard is
  `apps/api/src/routes/media/au3-published.test.ts`; its subset check can pass while its full nine-sentence
  completeness guard remains red. This distinction is intentional evidence of unfinished publication.
