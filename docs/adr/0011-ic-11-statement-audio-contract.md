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
`{lineId, memberNo, lang, source, label, deviceLabel, sentences: [{slot, textSha256, clip | null}]}`, one entry
per spoken sentence in reading order. `source` is `gemini` when every sentence has a clip, `mixed` when some do
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
serves the nearest clip, an older take of other words, or a clip of another sentence or language. The app checks
again before it plays: a clip whose `textSha256` is not the hash of the phone's own spoken sentence, or whose slot
differs, is not played. (The app's S10 fallback, Filipino clips under Cebuano text with the label "Audio sa
Filipino; teksto sa Cebuano", is a separate, labelled choice the app makes; the route never makes it.)

### 7. Where the shape lives

`packages/contracts/src/media.ts` defines `AUDIO_SLOTS`, `AudioOffset`, `StatementAudioClip`,
`StatementAudioSentence`, `StatementAudio`, `StatementAudioQuery` and the two label tables. fs-api's route uses
these schemas as its request and response. `@fairsplit/api-client` exposes the route as `MEDIA_ROUTES` and
`mediaRoutes(api).statementAudio`, and an fs-api test compares that table with the mounted route as JSON Schema.
The app imports the types only (`apps/mobile/src/_shims/contracts.ts`), so nothing of zod reaches its bundle. The
manifest reader stays in fs-api (`apps/api/src/routes/media/audio.ts`); the writer stays in WS-MEDIA
(`media/src/tts/manifest.ts`), which gains `offsets`.

## Consequences

- **WS-API (AU1):** the route, its reader and the route tests: a real manifest entry (M-014's Cebuano greeting)
  is served with a matched hash, the spike's other sentences show the honest no-clip result, a fixture manifest
  serves matching clips with offsets, and every mismatch in §5 and §6 yields no clip.
- **WS-CORE:** the new `media.ts` exports. `StatementSlot` in `domain.ts` (AI-8's older list without PAY and
  AI_NOTE) is unchanged; `AUDIO_SLOTS` is the plan's list.
- **WS-APP:** the clip type is the contract's; `audioPlan` reads `offsets` (`atMs`) instead of `mentions`
  (`offsetMs`) and also matches the slot; `withServedAudio` turns the route's answer into `dto.audio[lang]`. K1c
  calls the route in live mode; K1d puts real clips (same-origin `/media/audio/…` URLs) in the demo fixtures.
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
