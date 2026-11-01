# @fairsplit/eval

The labelled extraction eval (spec S4.8). It runs every labelled case through the production
pipeline (`extract()` for slips and logbook pages, `readRateCard()` for rate cards) and scores it
against the visible labels supplied for each image. R1 uses provisional agent-checked labels,
not labels reviewed by a person; its results must keep that qualification.

## R1 recorded hero-slip exhibit

[The honest report](report/R1.md) covers ten synthetic Codex-made hero flats read on 1 Nov 2026,
plus an unscored four-up exhibit. [R1.json](report/R1.json) includes every scored field, A/B/zoom
transcriptions, review routing, served models and recording keys. [R1-ledger.json](report/R1-ledger.json)
preserves the gateway ledger: one live pass, 38 accepted responses, US$0.971418 recorded token cost.
The A-only baseline ties the double read on this small provisional sample; no improvement is claimed.
Judge Mode continues to replay its labelled seed stand-in. The audit agent is paused.

Reproduce both R1 artifacts offline (kill flag on, replay only, zero live calls):

```sh
corepack pnpm --filter @fairsplit/eval exec tsx src/r1.ts
corepack pnpm --filter @fairsplit/eval exec vitest run src/r1.test.ts
```

The report explicitly excludes PP-OCRv5, the 40-case set and payroll-level injection guarantees.
The four-up has no truth label and contributes no scored rows. The generic report's recorded cost
covers scored cases only; R1's ledger total includes the four-up. PayPal was not called by R1;
the product rail is **Simulated PayPal sandbox**.

## Run

```sh
# Replay (default, CI): deterministic, no secrets, a missing recording fails the run.
corepack pnpm --filter @fairsplit/eval eval:replay

# Live: records what replay needs, capped per run (US$3 by default, --cap-usd to change).
corepack pnpm --filter @fairsplit/eval eval:live

# Options: --mode replay|live|batch --set test|dev --cap-usd N --media DIR --labels DIR
#          --recordings DIR --out DIR --registry FILE --allow-empty --no-zoom --no-screen --history
#          --unscored IMAGE (relative to media root; repeatable; excluded from scoring)
```

Exit code 0 means every bar is met: exact-row rate >= 0.85, zero unsafe auto-accepts, injection
catch rate 1.0, duplicate F1 >= 0.9, and no case errored. An empty set is never green (pass
`--allow-empty` to exit 0 anyway). `--mode batch` (Message Batches) is not built yet.

## Inputs and outputs

- Labels: `media/eval/labels/*.json`, one file per case, in the shape of `src/labels.ts`
  (a temporary shim of IC-11 until WS-MEDIA's review tool writes them). Per field: `value` (what was
  asked for), `visible` (what is written: the truth) and `expect` (`AUTO`, `HUMAN` or `EITHER`); per
  slip: `traps`, `duplicate_of` (`{case}#{slot}`) and `injection`.
- Recordings: `recordings/{cache_key}.json`, written by live runs (insert-if-absent, scrubbed).
  Format them with `corepack pnpm exec biome format --write packages/eval/recordings` before
  committing; the pre-commit hook checks JSON formatting.
- Report: `report/latest.json` (served to the in-product waffle through a read-only API route) and,
  for live runs, `report/history/`.

## Member registry

The validators check member numbers and names against a registry. `--registry FILE` takes the seed
snapshot's members (an array of `{member_no, name}`, or `{members: [...]}`). Without it the registry is
built from the labelled slips, which makes "not in the registry" stricter than production (a misread
number naming another of the 64 members would be auto-accepted there) and so flatters the
unsafe-auto-accept metric: such a report says `provisional`, with the reason, and the console prints it.
Pass the seed's members as soon as WS-CORE's seed snapshot lands.

## Deferred

- The OCR-only baseline (`src/baseline/ppocr.ts`): ppu-paddle-ocr 6.6.1 and onnxruntime-node must be
  pinned in `docs/versions.md` first; it lands with the labelled test set.
- NO_MATCH recall and the classifier traps (NO_RULE, RATE_MISMATCH, ruled deductions) need the test
  set's ratified terms; until then those cells report `pass: null` (not evaluated).
- "Recomputed lines equal label lines" for injection slips needs WS-CORE's `computeLines`; the
  harness checks that the slip is quarantined, its row is exact and no quarantined text survives as a
  deduction.
