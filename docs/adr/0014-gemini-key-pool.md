# ADR-0014: Gemini requests rotate over the user's keys, each within its own free-tier limits

- **Status:** Accepted (user, on merge)
- **Date:** 1 Nov 2026 (IST)
- **Author:** WS-MEDIA (work package TK1), with WS-QA's `.env.example` line
- **Touches:** register §9 Audio, "Quota" (`docs/spec/00-decision-register.md`, line 424); S5 secrets table, Gemini
  row (`docs/spec/S5-execution.md`, line 309); the U5 user task in the schedule ("confirm that only GEMINI_API_KEY
  is used, never GEMINI_API_KEYS_FALLBACK"); `media/src/tts/{keys,quota,cli,gemini,asr,plan,pipeline}.ts`;
  `media/audio/.quota.json` (gitignored); `.env.example`

## Context

- The register says: "**Quota.** Use one Google project and never rotate keys." The S5 secrets table says the same
  for Gemini ("One project and one key ... never rotated"), and the U5 user task asks the user to confirm that only
  `GEMINI_API_KEY` is used. `media/src/tts` followed this: one client from `GEMINI_API_KEY`, a ledger counting
  requests per model per Pacific day, requests paced 21 s apart, and a disclosure string "one Google project, one
  key (GEMINI_API_KEY), never rotated".
- Gemini runs only offline, on the dev machine, for the media package's TTS tool and its speech check. It is never
  deployed and never in CI. It runs on the free tier only; billing is never enabled or relied on.
- Measured on 22 Oct: 3 requests a minute per project for `gemini-3.8-flash-tts` (a 429 body). The free-tier daily
  limit is not published; until a person reads it in AI Studio, the ledger holds each model to a self-imposed 10 a
  day, labelled as a guess. At that cap one key covers the approved plan's 11 statement requests in 2 days, with
  nothing left for retakes, drafts or narration.
- The user holds 12 Gemini keys (7 new, 5 old): `GEMINI_API_KEY` plus 11 comma-separated values in
  `GEMINI_API_KEYS_FALLBACK`, in the gitignored repo-root `.env`. All 12 answered the free `models.list` call on
  1 Nov, and each lists `gemini-3.8-flash-tts` and `gemini-3.8-flash`.
- The user's decisions, verbatim:
  - 1 Nov: "it's allowed for this, do it use all 12 keys round robin"
  - earlier: "Always use the highest-end model. We have enough time to go along with the free limits and utilize
    them fully."

## Decision

1. **Key pool.** `media/src/tts/keys.ts` loads `GEMINI_API_KEY` and then every value of `GEMINI_API_KEYS_FALLBACK`
   (split on commas, trimmed, deduped, empties dropped), keeps them in memory in private fields, and names each key
   only by its id, the first 8 hex of its sha256. Each Gemini request (TTS finals, TTS drafts, the speech check)
   takes the next ready key in turn.
2. **Each key within its own free limits.** Google applies free-tier limits per project, so every limit is held
   per key: a minimum spacing of 21 s per key per model (3 a minute, measured, plus a margin) and a daily cap per
   key per model per Pacific day (the figure recorded with `tts set-limit`, or the self-imposed 10 until a person
   records one). The pool's capacity is the sum of the keys' own limits; no single key goes over its own. The SDK's
   retries stay off, so each request is counted once on the key that sent it.
3. **Failover.** A 429 or RESOURCE_EXHAUSTED cools that key for that model: for the retry delay the error gives (or
   60 s) on a per-minute limit, until the next Pacific midnight on a daily one; three 429s in a row on the same key
   count as daily. The request then moves to the next ready key. A 401, 403, PERMISSION_DENIED or API_KEY_INVALID
   drops that key for the run and reports its id. When every key is spaced, cooling, capped or dropped, the pool
   waits for the next ready key if that is at most 5 minutes away; otherwise it stops with a message naming the
   reset time, and statements without a clip fall back to the labelled device voice (register §9).
4. **Ledger.** `media/audio/.quota.json` (gitignored) keeps the per-model totals and adds counts per key id per
   model per Pacific day, each key's last request per model, and any cooling. Files from before the pool load
   unchanged; their requests are attributed once to `GEMINI_API_KEY`'s id, which sent them. The file holds key
   ids only.
5. **Keys never leave `.env`.** A key is read from `.env` into the process, handed to the `@google/genai` client,
   and sent to Google only in the `x-goog-api-key` header. It is never printed, logged, written to the ledger, put
   in a URL, an error message, a report or a test snapshot, or committed. Errors from the SDK are scrubbed (each
   known key becomes `key:<id>`; anything shaped like a Google key, any `key=` query value and any
   `x-goog-api-key` value is redacted) before they are logged, stored or rethrown. The offline tests plant fake
   keys and check every log line, error, the ledger file, the status output and the pool object for them.
6. **Status and check.** `tts quota` shows each key id's used and remaining requests per model and the pool
   total. `tts keys` runs the free `models.list` call for every key and prints ids and statuses; it sends no
   generation request.
7. **Models, highest-end free tier.** From https://ai.google.dev/gemini-api/docs/pricing (read 1 Nov 2026, page
   updated 30 Oct): TTS finals and drafts both use `gemini-3.8-flash-tts`, the highest-end TTS model that is "Free
   of charge" (`gemini-2.5-pro-preview-tts` is "Not available" on the free tier); the speech check uses
   `gemini-3.8-flash`, the highest-end free text model that takes audio input (`gemini-4-argon` and
   `gemini-3.1-pro-preview` are not free). Drafts and finals therefore share the same per-key daily caps, and
   `tts plan` computes days at the per-key limit times the number of keys.

## Consequences

- **Replaces** register §9's "Use one Google project and never rotate keys" and the S5 Gemini row's "never
  rotated" for the media TTS tool, and retires U5's "confirm that only GEMINI_API_KEY is used, never
  GEMINI_API_KEYS_FALLBACK". The spec files are not edited (only an ADR changes them); this ADR is the change.
  U5 keeps reading the free-tier daily limit in AI Studio and recording it with `tts set-limit`; the recorded
  figure caps each key.
- `media/src/tts` comments, disclosures and status strings say "the user's N Gemini keys, round robin, each
  within its own free-tier limits (user decision, 1 Nov; ADR-0014)". The committed `media/audio/spike-s10.json`
  still carries the 22 Oct run's one-key wording, which was true for that run; the next `tts spike` rewrites it.
- AU3's audio days draw on the pool's capacity: at the self-imposed cap, 12 keys allow 120 requests a day per model
  instead of 10; at 3 a minute per key, up to 36 a minute across the pool.
- Tests (offline, fake client, no network): `media/test/tts-keys.test.ts` covers rotation order across 12 keys,
  per-key spacing and daily caps, 429 cooling and move-on, 401/403 drop by id, wait-or-stop when every key is
  exhausted, the per-key ledger and the old file shape, dedupe, the model choice, the plan's capacity, and that no
  planted key appears in any output.
- **What gets worse, and what the user accepted.** Google applies limits per project, and Google's API terms
  restrict getting around usage limits, for example by spreading requests over several projects or keys. Using 12
  keys in rotation is such a use. The user stated it is allowed for this use and accepted the risk, which
  includes Google throttling or suspending the keys or their projects. If two keys belong to the same project they
  share that project's limits; the per-key caps then overstate the capacity, and the 429 failover holds the line.
  Billing stays off on every key.

## Alternatives considered

| Option                                   | Why not                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| One key, never rotated (the register)    | The user decided otherwise on 1 Nov; 10 a day (self-imposed) leaves no room for retakes or drafts |
| A paid tier for higher limits            | Free tier only: billing is never enabled or relied on                                             |
| A random key per request                 | Uneven use; round robin spreads requests evenly and keeps every key furthest from its limits      |
| Drafts on Flash-Lite TTS (separate caps) | "Always use the highest-end model": drafts move to the top free TTS model                         |
