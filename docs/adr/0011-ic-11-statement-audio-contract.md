# ADR-0011: IC-11 statement audio is one clip per spoken sentence, matched by the hash of its exact text

- **Status:** Accepted (user, on merge)
- **Date:** 1 Nov 2026 (IST)
- **Author:** WS-API (work package AU1), with WS-CORE, WS-APP and WS-MEDIA
- **Touches:** register §9 (Audio), IC-11 (`media/audio/manifest.json`), S4.6 (manifest fields), M-MB-03
  (Paminawa), `GET /v1/media/audio/:lineId`, `packages/contracts` (new `media.ts`), `packages/api-client`
  (`MEDIA_ROUTES`), `apps/mobile` (`audioPlan`), invariant I8 (nothing synthetic goes unlabelled)

## Context

Three shapes of the same audio disagreed on main (3d74dc6), so a statement never played a real clip:
1. `media/audio/manifest.json` (the S10 spike, written by `media/src/tts`) holds **one entry per sentence**: `slot`,
   `file`, `text`, `text_sha256`, `label`, `draft`, with no cues. Its slots are the spike's `s1` and `s5`.
2. fs-api's `GET /v1/media/audio/:lineId` (`apps/api/src/routes/media/index.ts`) expected S4.6's **one file per
   member and language** with a required `cues[]`. `safeParse` dropped every real entry, so the route always
   answered "device voice", and it built the URL as `/media/audio/${file}`, which doubles `audio/`.
3. The app (`apps/mobile/src/_shims/api-client.ts`, `lib/statement.ts`) expects **per-sentence** clips
   `{url, textSha256, label}` and reads an undeclared `mentions[{ref, offsetMs}]` when present.

The plan's audio section (S1 "Audio", register §9) is per sentence: one AAC clip per sentence, 32 kbps mono, with
pause markers around the things a sentence names so the TTS tool can record where each is said, and every clip
labelled "Sintetikong tingog" (ceb), "Sintetikong boses" (fil) or "Synthetic voice" (en), each with
"(Gemini TTS)". S4.6's one-file form (one request, one file, cues) was the later amendment; the spike and the app
both went per sentence. Separately, fs-api serves `/media/*` from `STATIC_MEDIA_DIR` (default `media/public`) with
immutable caching, and nothing creates `media/public` yet (H1 adds a curated assembly step). `media/` itself must
never be served: it holds prompts, eval labels, drafts and raw takes.

Of the spike's clips, only M-014's Cebuano greeting (`s1`, `596b9e42…`) still has the exact words
`renderStatement` speaks today. The Filipino and English greetings name "Nang Celing" where TEMPLATES_V1 uses
the registry's "Gng. Bacus" and "Mrs. Bacus", and all three pay sentences (`s5`) predate the final PAY template.

## Decision

### 1. One shape: a clip per spoken sentence

A clip, as fs-api serves it and every client reads it (`StatementAudioClip` in `@fairsplit/contracts`):

| Field        | Meaning                                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`        | Same-origin path `/media/audio/{memberNo}/{lang}/{name}.m4a`. Nothing else is a valid clip URL.                                                                                   |
| `textSha256` | Lowercase hex SHA-256 of the UTF-8 bytes of the exact spoken sentence the clip reads (§3).                                                                                        |
| `label`      | The synthetic-voice label in the clip's language: "Sintetikong tingog (Gemini TTS)", "Sintetikong boses (Gemini TTS)", "Synthetic voice (Gemini TTS)" (`SYNTHETIC_VOICE_LABELS`). |
| `slot`       | The sentence's statement slot, `GREETING` … `AI_NOTE` (`AUDIO_SLOTS`, the order of fs-api's `STATEMENT_SLOTS`).                                                                   |
| `offsets`    | `[{ref, atMs}]`: where the voice starts saying each thing the sentence names, in ms of the clip's own media time (the playback rate does not change it). May be empty.            |
| `durationMs` | The clip's length.                                                                                                                                                                |

`ref` in an offset is either one of the sentence's mentions (`slip:0403`, `rule:R1`, as the plan lists them) or
`fact:{PLACEHOLDER}` for an amount or a name the sentence fills (`fact:NET_USD`, `fact:HONORIFIC_NAME`). fs-api
keeps an offset only when its ref is one the sentence has and `0 ≤ atMs ≤ durationMs`, and sorts them by time.
Offsets are optional: a clip with none still plays, and the app estimates a chip's moment from the clip's length.

### 2. The route: `GET /v1/media/audio/:lineId?lang=`

Same readers as the statement (`readableStatement`). The answer is `StatementAudio`:
`{lineId, memberNo, lang, source, label, deviceLabel, sentences: [{slot, mentions, textSha256, clip | null}]}`, one
entry per spoken sentence in reading order. `mentions` are the slips and rules the sentence names, as fs-api's plan
lists them (`rule:R1` for a deduction, `slip:0403` for a credit or the sources); with `slot` they say which sentence
it is without its words (§6). `source` is `gemini` when every sentence has a clip, `mixed` when some do
and `device` when none do. `label` is the synthetic label unless `source` is `device`; `deviceLabel` ("Tingog sa
telepono", "Boses ng telepono", "Device voice") names the phone's voice for every sentence without a clip. The old
one-file answer (`url`, `durationMs`, `cues[]`) is retired. The labels come from fs-api's own tables, never from
the manifest, so a manifest cannot unlabel or mislabel a clip (I8).

### 3. How `textSha256` is computed

Over the sentence text exactly as fs-api's statement view renders it for that line and language:
`statementView(db, ctx).spoken[i].text`, which is `renderStatement(plan, templates).spoken[i].text` with the
line's committed template variants and, on seeded runs, T1's seeded AI_NOTE variant. The hash follows whatever
variant is rendered: a clip made from the product AI_NOTE does not match a seeded run's sentence, and the other
way round. No trimming, no Unicode normalisation, no joining of sentences. The producer (AU2's
`tools/export-statement-plans.ts`) exports these spoken texts from fs-api's renderer; it never re-implements it.

Only fs-api computes a `textSha256` from words. No client re-renders a sentence to check a hash: the app's own
renderer (`fillSentence` over `statementValues`) writes other words for the same facts ("resibo 0 4 0 3" where
fs-api says "resibo zero four zero three", "148.0 kilos" for "one hundred forty-eight kilos", "Lantern Bay" for
"Lantern Bay Chocolate Co."), so for most sentences its hash would never equal fs-api's and every clip would be
thrown away. To a client, `textSha256` is fs-api's name for the words of one sentence: it compares it only with
another hash fs-api gave (§6).

### 4. The manifest file

`media/audio/manifest.json` stays `{v: 1, synthetic: true, notice, entries: [...]}` (a bare array is no longer
read). fs-api reads these fields of an entry and ignores the producer's others (`style`, `codec`, `review`,
`request`):
- `member_no` (`M-NNN`), `lang`, `slot` (a statement slot; the spike's `s1` and `s5` become `GREETING` and `PAY`);
- `file`: the path relative to the media root, `audio/{member_no}/{lang}/{name}.m4a`, the same in `media/` and in
  `media/public/`;
- `duration_ms`, `text` (the exact spoken sentence) and `text_sha256` (its SHA-256 per §3);
- `synthetic: true`, `draft` (a draft is never served), `model`, `voice`, `created_at`;
- `offsets` (optional): `[{ref, at_ms}]` with the refs of §1.

Because `/media` is cached as immutable, a published file name is never reused for different audio: a retake or a
changed text gets a new `{name}` (AU2: the slot and the first 12 hex digits of `text_sha256`, plus a take suffix
on a retake).

### 5. Clips are served only from `media/public`

fs-api reads the manifest only at `${STATIC_MEDIA_DIR}/audio/manifest.json` (default `media/public`) and serves a
clip only when all of these hold:
1. the entry parses, `synthetic` is true and `draft` is false;
2. `file` matches the allowlist `^audio/M-\d{3}/(ceb|fil|en)/[A-Za-z0-9_-]{1,64}\.m4a$` and names the entry's own
   member and language (so `audio/drafts/…`, `..` and every other file under `media/` are refused);
3. the file exists in the static media directory;
4. `sha256(text)` equals `text_sha256`;
5. `member_no`, `lang`, `slot` and `text_sha256` equal those of the rendered sentence.

H1's assembly step copies `media/audio/manifest.json` and the files it lists that pass rule 2 and are not drafts to
`media/public/audio/` at the same relative paths, and nothing else from `media/audio/` (no `drafts/`, no
`spike-s10.json`). `media/` is never served wholesale.

### 6. A mismatch means no clip, never a near one

When no entry passes §5 for a sentence (its words changed, a template variant changed, the clip is a draft, the
file is missing), that sentence has `clip: null` and the phone's voice reads it, labelled `deviceLabel`. fs-api never
serves the nearest clip, an older take of other words, or a clip of another sentence or language.

The phone never compares a clip with its own rendering of a sentence (§3). It plays a clip only for the sentence
fs-api served it for:
1. **Pairing.** Each of the phone's sentences is paired with the served sentence of the same key, the n-th for its
   n-th sentence of that key (reading order among equals). The key is the slot, plus, for the slots a line can have
   several of, what the sentence is about: a `DEDUCTION` by its rule (the template's `ref` against the served
   `rule:` mention), a `CREDIT` by its slip (`slip:` mention). So two deductions never swap clips, whatever order
   either side lists them in. A phone sentence with no served partner, or a served sentence the phone does not
   have, gets no clip.
2. **The check.** The paired sentence's clip plays only if its `slot` and `textSha256` equal that served sentence's
   own `slot` and `textSha256` (a clip recorded for other words, even when an answer was put together wrongly, is
   never played), and the phone can reach its URL.
3. Otherwise the phone's voice reads the sentence, labelled as such.

The statement and its audio answer are read for the same line (`withServedAudio` ignores another line's answer) and
read again together when the line changes. (The app's S10 fallback, Filipino clips under Cebuano text with the label
"Audio sa Filipino; teksto sa Cebuano", is a separate, labelled choice the app makes: Cebuano sentences paired with
the Filipino answer by the same keys. The route never makes it.)

A cross-package test holds both sides to this. `apps/api/src/routes/media/ic11-golden.test.ts` renders M-014 with
fs-api's renderer in all three languages and resolves it against a fixture manifest with a clip for every sentence.
It keeps the result as `ic11-m014.golden.json`, and the media route test checks that the real route serves the same.
`apps/mobile/src/lib/statement-audio.contract.test.ts` passes that answer through `withServedAudio` and `audioPlan`
with the app's own M-014 statement and expects mode `synthetic` with every sentence clipped. It also checks that
fs-api's hashes are not the hashes of the phone's words. The golden test compares everything but the words' hashes
(slot, mentions, order, clips), so it fails when the sentences drift apart. A template change that keeps the
sentences needs no new golden; `FS_WRITE_IC11_GOLDEN=1` regenerates it.

### 7. Where the shape lives

`packages/contracts/src/media.ts` defines `AUDIO_SLOTS`, `AudioOffset`, `AudioMention`, `StatementAudioClip`,
`StatementAudioSentence`, `StatementAudio`, `StatementAudioQuery` and the two label tables. fs-api's route uses
these schemas as its request and response. `@fairsplit/api-client` exposes the route as `MEDIA_ROUTES` and
`mediaRoutes(api).statementAudio`, and an fs-api test compares that table with the mounted route as JSON Schema.
The app imports the types only (`apps/mobile/src/_shims/contracts.ts`), so nothing of zod reaches its bundle. The
manifest reader stays in fs-api (`apps/api/src/routes/media/audio.ts`); the writer stays in WS-MEDIA
(`media/src/tts/manifest.ts`), which gains `offsets`.

## Consequences

- **WS-API (AU1):** the route, its reader and the route tests: a real manifest entry (M-014's Cebuano greeting)
  is served with a matched hash, the spike's other sentences show the honest no-clip result, a fixture manifest
  serves matching clips with offsets, and every mismatch in §5 and §6 yields no clip. It also keeps the cross-package
  golden of §6.
- **WS-CORE:** the new `media.ts` exports. `StatementSlot` in `domain.ts` (AI-8's older list without PAY and
  AI_NOTE) is unchanged; `AUDIO_SLOTS` is the plan's list.
- **WS-APP:** the clip type is the contract's. `dto.audio[lang]` is the route's per-sentence answer as served
  (`StatementAudioSentence[]`), not a list of clips. `audioPlan` pairs sentences and checks clips as §6 says, and
  never hashes the phone's own words. It reads `offsets` (`atMs`) instead of `mentions` (`offsetMs`).
  `withServedAudio` puts the route's answer into `dto.audio[lang]`.
  - **K1c (live mode):** call `GET /v1/media/audio/:lineId?lang=` with the same credential as the statement read,
    and put the answer into the statement with `withServedAudio(dto, answer, apiOrigin)`. Read it again whenever
    the statement is read again. Never compute a `textSha256` on the phone, and never keep only the clips: the
    pairing needs every served sentence (`slot`, `mentions`).
  - **K1d (demo fixtures):** `audio[lang]` in `buildDemoStatement` must be fs-api's answer for the hero line in this
    shape, exported from fs-api's renderer and manifest (AU2's export, or `ic11-m014.golden.json` until real clips
    exist): sentences `{slot, mentions, textSha256, clip}` with fs-api's hashes and same-origin `/media/audio/…`
    URLs. It must never be hashes of the app's own sentences. The demo's `DEDUCTION` and `CREDIT` templates keep a
    `ref` equal to the rule or slip that fs-api's sentence names.
- **WS-MEDIA (AU2, AU3):** entries use statement slots, carry offsets and get unique file names (§4); the spike
  entries are migrated (`s1` → `GREETING`, `s5` → `PAY`) with their files where they are.
- **WS-OPS (H1):** the `media/public/audio/` assembly in §5.
- What gets worse: one sentence's mismatch (say, after a template fix) silently costs that sentence its clip. The
  answer says so per sentence (`clip: null`, `source: mixed`), and the plan's audio days regenerate from the frozen
  text. S4.6's single file per statement is not built.

## Alternatives considered

| Option                                          | Why not                                                                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| S4.6's one file per statement with cues         | The spike, the app and the plan's S1 audio rules are per sentence; one changed sentence would invalidate the whole file |
| Match a clip by slot only                       | A changed template or variant would play stale words: the very error I8 and the hash exist to stop                      |
| Trust the manifest's label                      | A manifest could then unlabel a synthetic voice; the label is the server's, per language                                |
| Serve the clip URL from `media/` directly       | Exposes prompts, eval labels and drafts; only the curated `media/public` is served                                      |
| Keep the DTO in fs-api and copy it into the app | Two hand-kept copies drift, which is how the three shapes above came about                                              |
| The phone re-hashes its own sentence            | Its renderer writes other words for the same facts (§3), so it would throw away most clips fs-api rightly served        |
| Pair sentences by reading position alone        | Two deductions listed in another order would swap clips and speak the wrong amount; the key names the rule or slip      |
