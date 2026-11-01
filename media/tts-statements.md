# AU3 statement audio handoff: incomplete, waiting on ASR service

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
