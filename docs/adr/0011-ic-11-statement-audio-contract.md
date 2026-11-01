# ADR-0011: IC-11 statement audio is one clip per spoken sentence, matched by the hash of its exact text

- **Status:** Accepted (user, on merge)
- **Date:** 1 Nov 2026 (IST)
- **Author:** WS-API (work package AU1), with WS-CORE, WS-APP and WS-MEDIA
- **Touches:** register §9 (Audio), IC-11 (`media/audio/manifest.json`), S4.6 (manifest fields), M-MB-03
  (Paminawa), IC-08 (`GET /v1/media/audio/:lineId`: its answer changes shape, §2), IC-01 (`packages/contracts`:
  a new `media.ts`, additive), `packages/api-client` (`MEDIA_ROUTES`), `apps/mobile` (`audioPlan`, `payForm`),
  `tools/assemble-media.ts` (read, not changed), invariant I8 (nothing synthetic goes unlabelled)

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
both went per sentence.

fs-api serves `/media/*` from `STATIC_MEDIA_DIR` with immutable caching. On Render that is `apps/api/dist/media`
(render.yaml), the curated folder H1's `tools/assemble-media.ts` writes from an explicit allowlist; when the variable
is unset fs-api falls back to `media/public`, which nothing creates. `media/` itself is never served: it holds
prompts, eval labels, drafts and raw takes.

Of the spike's clips, only M-014's Cebuano greeting (`s1`, `596b9e42…`) still has the exact words
`renderStatement` speaks today. The Filipino and English greetings name "Nang Celing" where TEMPLATES_V1 uses
the registry's "Gng. Bacus" and "Mrs. Bacus", and all three pay sentences (`s5`) predate the final PAY template.

## Decision

### 1. One shape: a clip per spoken sentence

A clip, as fs-api serves it and every client reads it (`StatementAudioClip` in `@fairsplit/contracts`):

| Field        | Meaning                                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`        | Same-origin path `/media/audio/{memberNo}/{lang}/{name}.m4a` (`AUDIO_CLIP_URL_RE`). Nothing else is a valid clip URL, and clients check it too (§7).                              |
| `textSha256` | Lowercase hex SHA-256 of the UTF-8 bytes of the exact spoken sentence the clip reads (§3).                                                                                        |
| `label`      | The synthetic-voice label in the clip's language: "Sintetikong tingog (Gemini TTS)", "Sintetikong boses (Gemini TTS)", "Synthetic voice (Gemini TTS)" (`SYNTHETIC_VOICE_LABELS`). |
| `slot`       | The sentence's statement slot, `GREETING` … `AI_NOTE` (`AUDIO_SLOTS`, the order of fs-api's `STATEMENT_SLOTS`).                                                                   |
| `offsets`    | `[{ref, atMs}]`: where the voice starts saying each thing the sentence names, in ms of the clip's own media time (the playback rate does not change it). May be empty.            |
| `durationMs` | The clip's length.                                                                                                                                                                |

`ref` in an offset is either one of the sentence's mentions (`slip:0403`, `rule:R1`, as the plan lists them) or
`fact:{PLACEHOLDER}` for an amount or a name the sentence fills (`fact:NET_USD`, `fact:HONORIFIC_NAME`). Of the
offsets of an entry that parses (§5 rule 1), fs-api keeps one only when its ref is one the sentence has and
`0 ≤ atMs ≤ durationMs`, drops the others one by one, and sorts what is left by time. A malformed offset (a ref
outside that grammar, such as `fact:Honorific`, or a negative `at_ms`) is different: the entry does not parse, so
the sentence gets no clip at all. Offsets are optional: a clip with none still plays, and the app estimates a chip's
moment from the clip's length.

### 2. The route: `GET /v1/media/audio/:lineId?lang=`

Same readers as the statement (`readableStatement`). The answer is `StatementAudio`:
`{lineId, memberNo, lang, source, label, deviceLabel, sentences: [{slot, variant, mentions, textSha256, clip | null}]}`,
one entry per spoken sentence in reading order. `variant` is the template variant fs-api rendered for the sentence
(its template key is `{slot}.{variant}`; `AudioVariant`, `^[a-z_]+$`). PAY has fs-api's seven forms, `PAY.paypal`,
`PAY.paypal_usd`, `PAY.cash`, `PAY.cash_nodate`, `PAY.cash_usd`, `PAY.checking` and `PAY.excluded`
(`apps/api/src/statements/templates.ts`); the other slots have `default` and their own named forms (`HELP.noname`,
`CREDIT.written`, `CREDIT.plain`, `AI_NOTE.noname`, `AI_NOTE.checking`, and T1's `AI_NOTE.seeded`,
`AI_NOTE.seeded_noname`, `AI_NOTE.seeded_checking`). `mentions` are the slips and rules the sentence names, as
fs-api's plan lists them (`rule:R1` for a deduction, `slip:0403` for a credit or the sources). Together, `slot`,
`variant` and `mentions` say which sentence it is without its words (§6). `source` is `gemini` when every sentence
has a clip, `mixed` when some do and `device` when none do. `label` is the synthetic label unless `source` is
`device`; `deviceLabel` ("Tingog sa telepono", "Boses ng telepono", "Device voice") names the phone's voice for every
sentence without a clip. The old one-file answer (`url`, `durationMs`, `cues[]`) is retired: a breaking change to
this IC-08 route, whose only reader is the app's Paminawa. The labels come from fs-api's own tables, never from the
manifest, so a manifest cannot unlabel or mislabel a clip (I8).

### 3. How `textSha256` is computed

Over the sentence text exactly as fs-api's statement view renders it for that line and language:
`statementView(db, ctx).spoken[i].text`, which is `renderStatement(plan, templates).spoken[i].text` with the
line's committed template variants and, on seeded runs, T1's seeded AI_NOTE variant. The hash follows whatever
variant is rendered: a clip made from the product AI_NOTE does not match a seeded run's sentence, and the other
way round. No trimming, no Unicode normalisation, no joining of sentences.

There is one hash function: T1's `spokenTextSha256` (`apps/api/src/statements/render.ts`). The route matches with
it, and the producer writes `text_sha256` with it through `spokenScript(plan)` (AU2's export, §8), which gives each
spoken sentence with its hash; the route keeps no hash of its own. `ic11-golden.test.ts` serves manifest entries
written from `spokenScript` and checks that the route's hashes are the producer's. The producer never re-implements
the renderer.

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
- `file`: the path relative to the media root, the same in `media/` and in the served folder (§5);
- `duration_ms`, `text` (the exact spoken sentence) and `text_sha256` (its SHA-256 per §3);
- `synthetic: true`, `draft` (a draft is never served), `model`, `voice`, `created_at`;
- `offsets` (optional): `[{ref, at_ms}]` with the refs of §1.

An entry is identified by `(member_no, lang, slot, text_sha256)`: one member and language can have several texts
for one slot (Rhea's PayPal and no-date cash PAY, the `seeded` and `seeded_checking` AI notes), and the writer
keeps each.

A published clip's file is `audio/{member_no}/{lang}/s{NN}-{SLOT}-{hash12}.m4a`:
- `NN` is the slot's two-digit place in the statement's slot order (GREETING `01`, DELIVERY `02`, PREMIUM `03`,
  BONUS `04`, DEDUCTION `05`, CREDIT `06`, PAY `07`, SOURCES `08`, HELP `09`, AI_NOTE `10`);
- `hash12` is the first 12 hex digits of `text_sha256`;
- a retake adds `-t{K}` (`K` from 2): `audio/M-031/en/s07-PAY-c7578b9696a8-t2.m4a`.

Because `/media` is cached as immutable, a published name is never reused for other audio; the name follows from
the slot and the words, and a retake gets a new one. Main's assembly copies a member's clips only as
`audio/M-???/{ceb,fil,en}/s*.m4a` (and the drafts', §5), and its build fails when the manifest names a file its
allowlist does not serve, so a name must start with `s` (`GREETING-596b9e42811d.m4a` would fail the Render
build). The spike's `s1.m4a` and `s5.m4a` keep their names. Draft takes live under
`audio/drafts/{member_no}/{lang}/s….m4a` with `draft: true`. Every published name passes the route's file rule
(§5 rule 2) and the contract's URL pattern; the goldens' fixture clips are named this way, and the golden test
checks all three patterns.

### 5. Clips are served only from the curated folder, never a draft

fs-api reads the manifest only at `${STATIC_MEDIA_DIR}/audio/manifest.json` and serves `/media/*` from the same
folder: on Render `apps/api/dist/media`, which main's `tools/assemble-media.ts` writes (unset, `media/public`). It
serves a clip only when all of these hold:
1. the entry parses (a malformed field, a malformed offset among them, spoils the whole entry), `synthetic` is true
   and `draft` is false;
2. `file` matches `^audio/M-\d{3}/(ceb|fil|en)/[A-Za-z0-9_-]{1,64}\.m4a$` and names the entry's own member and
   language (so `audio/drafts/…`, `..` and every other file are refused, whatever `draft` says);
3. the file exists in the served folder;
4. `spokenTextSha256(text)` equals `text_sha256`;
5. `member_no`, `lang`, `slot` and `text_sha256` equal those of the rendered sentence.

Main's assembly copies `audio/manifest.json` and every file its allowlist matches to the same relative paths:
`audio/M-???/{ceb,fil,en}/s*.m4a` and also `audio/drafts/M-???/{ceb,fil,en}/s*.m4a`. So the draft clips are in the
served folder, reachable as static files by anyone who knows their path, but no answer ever names one: rule 1
refuses `draft: true` and rule 2 refuses any `audio/drafts/…` file even when it is not marked a draft
(`audio.test.ts`; `media.test.ts` publishes the spike as the assembly does and checks that no answer in any language
names a draft, though the draft Cebuano greeting has the statement's exact words). Nothing else under `media/audio/`
(`spike-s10.json`) is copied; of the rest of `media/`, only the allowlist's `photos/?.webp`, `slips/*.webp` and
`docs/*.webp` images are, and never its prompts, eval labels, masters or code.

### 6. A mismatch means no clip, never a near one

When no entry passes §5 for a sentence (its words changed, a template variant changed, the clip is a draft, the
file is missing), that sentence has `clip: null` and the phone's voice reads it, labelled `deviceLabel`. fs-api never
serves the nearest clip, an older take of other words, or a clip of another sentence or language.

The phone never compares a clip with its own rendering of a sentence (§3). It plays a clip only for the sentence
fs-api served it for:
1. **Pairing.** Each of the phone's sentences is paired with the served sentence of the same key, the n-th for its
   n-th sentence of that key (reading order among equals). The key is the slot and the form of the slot
   (`{slot}.{variant}`), plus, for the slots a line can have several of, what the sentence is about: a `DEDUCTION`
   by its rule (the template's `ref` against the served `rule:` mention), a `CREDIT` by its slip (`slip:` mention).
   A `CREDIT.plain` (a credit with no slip) has no key on either side and is read by the phone's voice; no planned
   member has one (M-018's is `CREDIT.written`).
   - The variant is in the key because two forms of one slot say different things. `PAY.paypal` sends US$64.45 to
     PayPal with a peso estimate; `PAY.cash` pays exact pesos at the bodega on the day the cash was received;
     `PAY.cash_nodate` says the same without a day. The product AI note says Claude read the slips twice, while
     T1's `AI_NOTE.seeded` says the readings are a labelled stand-in. A phone that showed one form and played the
     other's clip would speak words the screen contradicts.
   - The phone names its templates' forms as fs-api does (`templateVariant`: a PAY template's `variant`, `paypal`
     when it names none; any other template `default` unless it names another form), and it chooses its PAY form
     as fs-api's statement plan does (`payForm` in `apps/mobile/src/lib/statement.ts`, after
     `apps/api/src/statements/plan.ts`):
     - `checking` while the line is `COMPUTED`, `READY` or `HELD`; `excluded` for an `EXCLUDED` line;
     - on PayPal, `paypal` when the run records a rate, `paypal_usd` when it does not;
     - at the bodega (the line's rail is cash, or the capsule moved it there: `cash-due`, `cash-received`),
       `cash_usd` when the run records no rate; with a rate, `cash` once the clerk's cash receipt is recorded and
       `cash_nodate` until then. fs-api's `cashDay` is the receipt's day (`statements/facts.ts`), so fs-api speaks
       `PAY.cash_nodate` for a line whose cash is due, and `PAY.cash` names the receipt's day; the phone reads the
       receipt from the statement's history (`received`) and says that day too.
   - The phone shows its template of that form. When its templates lack the form (the demo's carry only `paypal`
     and `cash`), it shows the first it has of the rail's forms as a stand-in (`paypal`, `paypal_usd`; `cash`,
     `cash_nodate`, `cash_usd`), and a stand-in has no key, so the phone's voice reads it. It never plays a clip,
     not even fs-api's clip of the stand-in's own form: the demo's dated `PAY.cash` sentence standing in for
     `cash_nodate` shows the run's planned cash day, not a receipt's, and must not play a clip that names a day.
   - So two deductions never swap clips, whatever order either side lists them in, and no form of a slot borrows
     another form's clip. A phone sentence with no served partner, or a served sentence the phone does not have,
     gets no clip.
2. **The check.** The paired sentence's clip plays only if its `slot` and `textSha256` equal that served sentence's
   own `slot` and `textSha256` (a clip recorded for other words, even when an answer was put together wrongly, is
   never played), its URL passed the URL check (§7), and the phone can reach it.
3. Otherwise the phone's voice reads the sentence, labelled as such.

**Read together.** The statement and its audio answer are read for the same line (`withServedAudio` ignores another
line's answer), and they are read together: never the audio alone. Both are read again whenever either needs to be,
and whenever the capsule or the pay kind (`view.payKind`) changes on the phone, and the phone takes every fact a
clipped sentence shows (its amounts, the cash day, the slips) from that same fs-api read. A clip then never says an
amount or a day the screen does not. Until the new pair lands, pairing by form keeps a stale clip of another form
silent: the live item track can move a PayPal line to the bodega after fs-api spoke `PAY.paypal`, and the phone's
`PAY.cash_nodate` sentence (or its stand-in) then has no partner and is read by the phone's voice.

The app's S10 fallback, Filipino clips under Cebuano text with the label "Audio sa Filipino; teksto sa Cebuano", is
a separate, labelled choice the app makes: Cebuano sentences paired with the Filipino answer by the same keys. The
route never makes it.

**Cross-package tests** hold both sides to this. `apps/api/src/routes/media/ic11-golden.test.ts` renders, with
fs-api's renderer, the hero line M-014 in all three languages and the planned cash lines, Rhea (M-031, en) and
Merlyn (M-053, ceb), while their cash is due (`PAY.cash_nodate`) and once a receipt is recorded (`PAY.cash`). It
resolves each against a fixture manifest written from `spokenScript`, a clip of every sentence named per §4, and
keeps the answers as `ic11-m014.golden.json` and `ic11-cash.golden.json`. The goldens' `lineId` is the member's seed
UUID, not a line id. `media.test.ts` checks on Postgres that the real route serves the same answers: M-014's, and
M-031's and M-053's before and after the clerk's receipt is recorded. On the app's side,
`apps/mobile/src/lib/statement-audio.contract.test.ts` passes those answers through `withServedAudio` and
`audioPlan` with the app's own statements:
- M-014: every sentence the phone shows in the form fs-api spoke plays its clip; with the rail moved to cash, the
  PAY sentence gets the phone's voice and every other sentence keeps its clip; fs-api's hashes are not the hashes
  of the phone's words;
- M-031 and M-053: fs-api's `PAY.cash_nodate` clip plays under the phone's no-date sentence and never under its
  dated one; after a receipt, fs-api's `PAY.cash` clip plays under the dated sentence, which names the receipt's
  day, and never under the no-date one; with the demo's templates, the dated stand-in plays neither.

The golden test compares everything but the words' hashes and the part of each clip's name they give (slot,
variant, mentions, order, clips), so it fails when the sentences drift apart. A template change that keeps the
sentences needs no new golden. `FS_WRITE_IC11_GOLDEN=1` regenerates both goldens; a change of variant needs new
ones (T1's seeded AI note was one).

### 7. Where the shape lives

`packages/contracts/src/media.ts` defines `AUDIO_SLOTS`, `AUDIO_CLIP_URL_RE`, `AudioOffset`, `AudioMention`,
`AudioVariant`, `StatementAudioClip`, `StatementAudioSentence`, `StatementAudio`, `StatementAudioQuery` and the two
label tables. fs-api's route uses these schemas as its request and response. `@fairsplit/api-client` exposes the
route as `MEDIA_ROUTES` and `mediaRoutes(api).statementAudio`, and an fs-api test compares that table with the
mounted route as JSON Schema. The app imports the types only (`apps/mobile/src/_shims/contracts.ts`), so nothing
of zod reaches its bundle; it keeps a copy of `AUDIO_CLIP_URL_RE` there, which `contracts.parity.test.ts` holds to
the package's. `withServedAudio` drops a served clip whose URL fails that pattern or lies outside
`/media/audio/{the answer's memberNo}/{the answer's lang}/`, and resolves the rest against the API origin. The
manifest reader stays in fs-api (`apps/api/src/routes/media/audio.ts`); the writer stays in WS-MEDIA
(`media/src/tts/manifest.ts`), which gains `offsets`.

### 8. What AU2 produces

AU2 (`tools/export-statement-plans.ts`, `media/src/tts`) makes the clips this route serves:
1. **Export.** For each request (member, language, line state), the export gives every spoken sentence as fs-api
   renders it: `spokenScript(plan)`'s `slot`, `variant`, `text`, `mentions` and `textSha256`, plus the sentence's
   placeholders (`Object.keys(plan.sentences[i].facts)`, which `fact:` offsets may name) and the line's `lineId`.
   It never renders words itself, and its `textSha256` for M-014 equals the route's (the golden checks fs-api's
   half). Its facts are the seed's, as the goldens' are; the Postgres route test shows they give the route's words
   for M-014, M-031 and M-053.
2. **Which forms to synthesise.** Only the forms whose words are known in advance:
   - the PayPal lines at the seeded run's final state: `PAY.paypal`, with T1's `AI_NOTE.seeded` (every planned
     line is seeded or replayed; the product note is spoken only on a live run, which has no planned clips);
   - Rhea (M-031), one request with both PAY forms: `PAY.paypal` (before her item is returned) and
     `PAY.cash_nodate` (once her cash is due at the bodega); Merlyn (M-053): `PAY.cash_nodate`;
   - never `PAY.cash`: it names the receipt's day, which the hosted run learns only when the clerk records the
     cash, so a dated cash sentence is read by the phone's voice. A line still being checked (`PAY.checking` with
     `AI_NOTE.seeded_checking`, M-014 before the payout) has no planned request and is read by the phone's voice
     too.
3. **Entries.** Statement slots only; identity and file names per §4; drafts under `audio/drafts/` with
   `draft: true`. Offsets are clip-relative ms measured from the TTS tool's pause markers, with refs only from the
   sentence's mentions and `fact:{PLACEHOLDER}` for its placeholders, and the mention offsets rise in the order the
   sentence names them (the app fires slip chips in mention order; fs-api only sorts offsets by time and does not
   check that order). Each entry is validated with media's `AudioEntry` before it is written: one malformed offset
   would cost the sentence its clip (§1).

## Consequences

- **WS-API (AU1):** the route, its reader and the route tests: a real manifest entry (M-014's Cebuano greeting)
  is served with a matched hash, the spike's other sentences show the honest no-clip result, a fixture manifest
  serves matching clips with offsets, the cash lines' answers are the cash golden's before and after the receipt,
  and every mismatch in §5 and §6 yields no clip. It also keeps the goldens of §6 and regenerates them when a
  variant changes (`FS_WRITE_IC11_GOLDEN=1 vitest run src/routes/media/ic11-golden.test.ts` in `apps/api`, then
  `biome format --write` on both goldens, then the mobile tests without the turbo cache, whose hash does not
  include the goldens).
- **WS-CORE:** the new `media.ts` exports (additive to IC-01). `StatementSlot` in `domain.ts` (AI-8's older list
  without PAY and AI_NOTE) is unchanged; `AUDIO_SLOTS` is the plan's list.
- **WS-APP:** the clip type is the contract's. `dto.audio[lang]` is the route's per-sentence answer as served
  (`StatementAudioSentence[]`), not a list of clips. `audioPlan` pairs sentences by slot, form and what they name,
  and checks clips as §6 says; it never hashes the phone's own words. It reads `offsets` (`atMs`) instead of
  `mentions` (`offsetMs`). `payForm` chooses PAY's form as fs-api's plan does, and the PAY sentence names the
  receipt's day once there is one. `withServedAudio` puts the route's answer into `dto.audio[lang]` and drops a
  clip URL outside the contract's pattern.
  - **K1c (live mode):** call `GET /v1/media/audio/:lineId?lang=` with the same credential as the statement read,
    always together with that read and never alone, and put the answer into the statement with
    `withServedAudio(dto, answer, apiOrigin)`. Read both again whenever either is read, and whenever the capsule or
    `view.payKind` changes. Take every fact a clipped sentence shows from that same read: the amounts, the slips,
    and the receipt (the history's `received` entry, whose day is fs-api's `cashDay`; fs-api takes the UTC date of
    the receipt's `paidAt`, so take the day from fs-api's read rather than re-deriving it). A line whose cash is due
    plays fs-api's `PAY.cash_nodate` clip only with a `cash_nodate` template; after the receipt fs-api speaks
    `PAY.cash`, which has no planned clip (§8), so the phone's voice reads it. Never compute a `textSha256` on the
    phone, and never keep only the clips: the pairing needs every served sentence (`slot`, `variant`, `mentions`).
  - **K1d (demo fixtures):** `audio[lang]` in `buildDemoStatement` is fs-api's answer for the line in this shape,
    exported by AU2 from fs-api's renderer and the published manifest, and put in with `withServedAudio(dto,
    answer)` so the URL check applies; until those clips are published the demo reads the labelled device voice.
    The goldens are test-only: their clips are 32-byte fixtures, which would 404 and over-claim as demo data. The
    goldens' `lineId` (and the export's, unless it carries the demo DTO's) is the member's seed UUID:
    `withServedAudio` ignores an answer for another line, so K1d keys the demo statement to the answer's `lineId`.
    The demo templates must be TEMPLATES_V1's words, from AU2's export (the plan's K1d row), as well as fs-api's
    forms: today's `_shims/seed.ts` shows "Changed to pesos, about ₱4,028" where fs-api's clip says "In pesos that is
    about four thousand twenty-eight pesos, estimate, before PayPal's three percent fee to change it", "(R1, BR
    2026-04)" for "(R one, the Board's resolution)" and "Lantern Bay" for "Lantern Bay Chocolate Co.". It needs a
    template of every form it is to play: `PAY.paypal` for the PayPal lines, `PAY.cash_nodate` for Rhea's and
    Merlyn's due cash, and T1's seeded AI_NOTE forms with T1's words on a seeded run (the present AI note is the
    product form, `default`, "read twice by AI (Claude)", so it never plays a seeded clip). The `DEDUCTION` and
    `CREDIT` templates keep a `ref` equal to the rule or slip fs-api's sentence names. Once K1d lands, a test
    should check each clipped sentence's display text against fs-api's display text.
- **WS-MEDIA (AU2, AU3):** §8. Entries use statement slots, carry offsets, are identified as §4 says and get the
  names of §4; the spike entries are migrated (`s1` → `GREETING`, `s5` → `PAY`) with their files where they are.
- **WS-OPS (H1, on main):** `tools/assemble-media.ts` publishes the served folder of §5 unchanged by this ADR. It
  also copies the drafts' clips (`audio/drafts/M-???/{ceb,fil,en}/s*.m4a`), which the route never names but
  `/media` serves to anyone who guesses a path.
  Leaving drafts out of the copy is WS-OPS's call; it would also need the assembly's manifest check to skip draft
  entries, or the published manifest to leave them out.
- What gets worse: one sentence's mismatch (say, after a template fix) silently costs that sentence its clip. The
  answer says so per sentence (`clip: null`, `source: mixed`), and the plan's audio days regenerate from the frozen
  text. A line whose pay kind flips reads its PAY sentence with the phone's voice until the statement and audio are
  read again; a dated cash sentence is always read by the phone's voice; a seeded run's AI note does the same until
  the app shows the seeded form; a demo without a template of fs-api's PAY form reads its stand-in with the phone's
  voice. S4.6's single file per statement is not built.

## Alternatives considered

| Option                                          | Why not                                                                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| S4.6's one file per statement with cues         | The spike, the app and the plan's S1 audio rules are per sentence; one changed sentence would invalidate the whole file     |
| Match a clip by slot only                       | A changed template or variant would play stale words: the very error I8 and the hash exist to stop                          |
| Trust the manifest's label                      | A manifest could then unlabel a synthetic voice; the label is the server's, per language                                    |
| Serve the clip URL from `media/` directly       | Exposes prompts, eval labels and drafts; only the curated folder of §5 is served                                            |
| Keep the DTO in fs-api and copy it into the app | Two hand-kept copies drift, which is how the three shapes above came about                                                  |
| The phone re-hashes its own sentence            | Its renderer writes other words for the same facts (§3), so it would throw away most clips fs-api rightly served            |
| Pair sentences by reading position alone        | Two deductions listed in another order would swap clips and speak the wrong amount; the key names the rule or slip          |
| Pair PAY and AI_NOTE by slot alone              | One form's clip would play under another's words: PayPal pay under the cash sentence, the Claude claim on a seeded run      |
| Name the phone's PAY form by its rail           | fs-api renders seven PAY forms and speaks `cash_nodate` until a receipt: Rhea's and Merlyn's planned clips could never play |
| Let a stand-in PAY template pair by its variant | The demo's dated `cash` sentence would play fs-api's dated clip with a day the phone does not hold                          |
| A digest of each sentence's facts in the key    | The phone would re-derive fs-api's integer facts (peso estimate, rounding); reading both together needs none                |
| Clip files named `{SLOT}-{hash12}.m4a`          | Main's assembly serves only `s*.m4a` and fails the build on a manifest naming anything else                                 |
| A second hash helper in the route               | The route and the producer could hash differently; both use `spokenTextSha256`                                              |
| Drop only a malformed offset                    | A malformed entry is a producer bug the strict reader should surface; AU2 validates entries before writing (§8)             |
