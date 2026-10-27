# ADR 0003: AI replay identity of derived images, the rate-card term key, and the slip hash as corroboration

- **Status:** Accepted (user, on merge)
- **Date:** 22 Oct 2026 (IST)
- **Author:** WS-READ
- **Touches:** register §9 (ClaudeGateway replay key), S4.1 (`GatewayCall.inputSha`, ledger), S4 register deviation 13
  ("`imageSha` holds the sha256 of any input"), S4.2 (duplicate signal 3), S4.3 (term checks and the rate-card
  hash), IC-07 (`packages/ai`), WS-CORE (rate-card hash), WS-DATA (`llm_calls`)

## Context

1. **Replay keys of images.** S4.1 defines `inputSha` as "sha256 of the image bytes sent". Every image a model sees
   is derived by sharp 0.35.5 / libvips: resized, CLAHE-equalised (variant B), JPEG-encoded at q92, and for zooms
   cut, painted by `sanitizeForModel` and Lanczos-upscaled. libvips does not promise bit-identical output across
   operating systems, CPUs or builds, and the recordings are made on the Windows dev machine while `ci.yml` replays
   them on Ubuntu with no secrets (S4.8: a missing recording fails the run). Keyed on derived bytes, CI would miss
   every image recording.
2. **Rate-card term uniqueness.** S4.3 checks that "each (rule_id, pool) appears once", and WS-CORE hashes the
   ratified terms "sorted by rule_id, pool". But Schedule A prints several terms under one rule id in one pool: R5
   sets three co-sign thresholds (payout batch over US$300, member line over US$150, any override of a hold) and R6
   three tolerances (mass balance, kilos per tree, read confidence), all pool NONE. The AI-5 prompt asks for one term
   per threshold. Under (rule_id, pool) the board would see an uncleared "Check" on R5 and R6, and the hash order of
   their terms would follow the model's output order, so the same card could hash two ways. The live smoke read of a
   stub Schedule A (22 Oct) returned R5 as exactly these three terms.
3. **The slip hash on its own.** S4.2 lists dHash distance ≤8 as duplicate signal 3 by itself. A 64-bit dHash of a
   whole slip is dominated by the printed template: on the code-drawn smoke slips 3 of 6 pairs of _different_ slips
   scored ≤8 (0903 and 0904, two slips on one photo, scored 7), while a re-shoot of one slip can drift past 8. As a
   standalone signal it raises DUPLICATE_SLIP (BLOCKS_APPROVAL) on different slips; across 264 slips that floods
   holds and wrecks the duplicate-F1 bar.

## Decision

1. **The `inputSha` of an image call is a derivation identity:**
   `sha256(JCS({doc: sha256(uploaded file bytes), prep: PREP_V, ...op}))` (`read/prep.ts` `imageIdentity`), where
   `op` names everything that decides the bytes: variant and rotation for reads A and B; the transcription's
   sha256 and rotation for the AI-4 screen; for an AI-3 zoom the crop window, the sanitiser recipe
   `{v: SANITIZE_V, slip, hatch}`, the label and rotation; the page shas for AI-5. Text calls keep
   `sha256(JCS(input))`. `PREP_V` and `SANITIZE_V` are bumped whenever a step changes what it produces. The
   register's key is unchanged: `sha256{imageSha, variant, promptV, schemaV, model, effort}`, with this identity in
   the `imageSha` slot. The sha256 of the exact bytes sent is still kept, as `sent_sha`, on every ledger row and
   recording.
2. **A rate-card term is keyed by (rule_id, pool, basis).** "Appears once" uses that key (`ratecard/check.ts`
   `termKey`), and WS-CORE sorts the hashed terms by (rule_id, pool, basis), each compared as a string by UTF-16
   code units, so R5's and R6's terms hash in one order whatever order the model wrote them in.
3. **The slip hash only corroborates.** A pair is proposed on signal 1 (identical file), on signal 2 (one serial on
   two rows, copy colours recorded), or on signals 3 and 4 together (same member, date and payable kilos under
   different serials, with hashes within 8: a re-shoot whose serial was misread). The hash never pairs on its own and
   never pairs two slots of one document, which are two pieces of paper. It is taken only over a reviewed slip
   rectangle (C-10), never a model box.

## Consequences

- **WS-CORE:** the rate-card hash sorts terms by (rule_id, pool, basis). The duplicate rule consumes
  `duplicatePairs` as above; a re-shoot whose serial was read correctly still pairs on signal 2.
- **WS-DATA:** `llm_calls` carries `sent_sha` (nullable) beside `input_sha`; `cache_key` is unchanged.
- **WS-QA:** the S4.1 `inputSha` comment, S4.3's "(rule_id, pool)" lines and S4.2's signal 3 point to this ADR.
- **Tests:** `prep.test.ts` "keys on the document, not on the derived bytes"; the zoom's identity includes the
  sanitiser recipe (`calls.ts`); `ratecard.test.ts` (R5's three thresholds pass, true duplicates are flagged);
  `duplicates.test.ts` (template-identical slips with different ink stay clean, a re-encoded crop with a misread
  serial pairs, H1's white and pink pair, never two slots of one photo); the smoke replays run on the CI image.
- **Worse, and accepted:** two different uploads whose derived bytes happen to match do not share a recording
  (harmless). A re-shoot whose serial was misread _and_ whose payable kilos were also read differently is not paired
  by code; only the mass-balance and yield holds may still flag the extra kilos.

## Alternatives considered

| Option                                                        | Why not                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Key image calls on the bytes sent                             | CI on Ubuntu misses every recording made on Windows                                   |
| Pin libvips and assert byte-identical output                  | sharp does not promise it across platforms; brittle on every upgrade                  |
| Keep (rule_id, pool) and print R5/R6 as separate rule ids     | Schedule A's wording and labels are verbatim (S4.3) and already reviewed              |
| A 16×16 pHash of the handwriting region, tuned on the dev set | Needs reviewed handwriting rectangles and dev-set tuning; a later ADR may supersede 3 |
