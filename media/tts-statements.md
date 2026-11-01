# AU2 statement audio handoff

All people, payroll facts and audio are synthetic. PayPal-derived facts are **Simulated PayPal sandbox**.
The exported AI note identifies seeded readings as a stand-in for Claude; it does not claim a live reading.
Cebuano and Filipino wording and pronunciation still need native review.

Regenerate the exact renderer export, using disposable embedded Postgres databases inside `.codex-scratch/`:

```powershell
corepack pnpm --filter @fairsplit/api exec tsx src/statements/export.cli.ts
corepack pnpm --filter @fairsplit/media tts statements --dry-run
```

`statement-plans.json` has all eleven requests in approved order. Its `lineId` is the stable seed member UUID
for K1d's demo DTO; an API database has its own member-line IDs. Each sentence includes its unchanged API
`text`, `textSha256`, `slot`, `variant`, `mentions`, `displayText`, and exact spoken placeholder/mention spans
(`start` is a UTF-16 character index). Only fs-api renders these words and numbers. The export verifies that
showcase and judge-kind terminal seed snapshots give byte-identical output; it is not an export of the judge's
initial checking state. A checking line has no planned clips.

Rhea's single request includes `PAY.paypal` and `PAY.cash_nodate`, as ADR-0011 §8 specifies. There is no dated
`PAY.cash`: the receipt day is unknown until recorded and that sentence uses labelled device voice.

Generate the hero request once:

```powershell
corepack pnpm --filter @fairsplit/media tts statements --only M-014:ceb
```

AU2's 1 Nov validation returned 93,760 ms of audio from one generation request, but the splitter refused it:
17 detected interior pauses for 27 expected boundaries. This was **not a quota refusal**. No clips from this
take were published. `audio/statement-validation.json` records the result and ignored cached WAV path; the
cache is still in the AU2 worktree. AU3 must resolve the marker alignment or make a reviewed retake before
the hero statement can play completely. Merely lowering the silence threshold until its count matches
does not establish which words the boundaries mark. The reported daily reset is quota context, not a
promise that waiting will fix this split.

Each command below needs **one logical generation request** on `gemini-3.8-flash-tts`, through TK1's pool.
There are **ten remaining requests** after a successful M-014 Cebuano generation. If that validation was
refused, M-014 Cebuano remains too: eleven total. The command stops after the first physical failure,
records a scrubbed report and reset times in `audio/statement-validation.json`, and does not fail over on
that invocation. No automatic quota retries or per-sentence regeneration requests occur. An ambiguous split
also stops; the raw WAV stays cached for local diagnosis, without publishing clips.

```powershell
corepack pnpm --filter @fairsplit/media tts statements --only M-014:fil
corepack pnpm --filter @fairsplit/media tts statements --only M-014:en
corepack pnpm --filter @fairsplit/media tts statements --only M-007:ceb
corepack pnpm --filter @fairsplit/media tts statements --only M-060:fil
corepack pnpm --filter @fairsplit/media tts statements --only M-018:ceb
corepack pnpm --filter @fairsplit/media tts statements --only M-039:en
corepack pnpm --filter @fairsplit/media tts statements --only M-022:ceb
corepack pnpm --filter @fairsplit/media tts statements --only M-002:ceb
corepack pnpm --filter @fairsplit/media tts statements --only M-031:en
corepack pnpm --filter @fairsplit/media tts statements --only M-053:ceb
```

Existing exact clips are skipped; the exact marked request WAV is cached, so a local re-split uses no quota.
Key values never enter commands or reports. The ledger holds key IDs only and enforces each key's free-tier
limits. The daily reset timestamp is reported in UTC; do not infer a quota reset from an arbitrary retry delay.

Pause markers delimit sentences and the exact onsets of their named facts and mentions. `ffmpeg` silence
detection and `planCuts` must identify every marked segment before any manifest is published. Each sentence
keeps its internal pauses; offsets name detected speech onsets relative to its AAC clip, in mention order.
Clips are mono 32 kbps AAC, named `audio/M-NNN/{lang}/s{NN}-{SLOT}-{hash12}.m4a`. An existing filename is
immutable: a fresh take gets `-t2`, `-t3`, etc. The final manifest preserves multiple texts for a slot.

`--draft` writes clips and a separate `audio/drafts/manifest.json`; those entries never enter the served
`audio/manifest.json`. Both drafts and finals use the same model and share its quota. Do not replace the
historical spike clips or claim them as AU2 recordings.

Publish using the existing curated media assembly. fs-api only returns a clip whose exact sentence hash,
member, language, slot, synthetic label, non-draft status and existing curated file match ADR-0011. A mismatch
uses labelled device voice. K1d should load the exported words and variants with the served audio response;
the test goldens contain dummy files and are not playable demo media.
