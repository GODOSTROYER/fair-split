# @fairsplit/eval

The labelled extraction eval (spec S4.8). It runs every labelled case through the production
pipeline (`extract()` for slips and logbook pages, `readRateCard()` for rate cards) and scores it
against what a person checked is visibly written on the image (C-24).

## Run

```sh
# Replay (default, CI): deterministic, no secrets, a missing recording fails the run.
corepack pnpm --filter @fairsplit/eval eval:replay

# Live: records what replay needs, capped per run (US$3 by default, --cap-usd to change).
corepack pnpm --filter @fairsplit/eval eval:live

# Options: --mode replay|live|batch --set test|dev --cap-usd N --media DIR --labels DIR
#          --recordings DIR --out DIR --allow-empty --no-zoom --no-screen --history
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

## Deferred

- The OCR-only baseline (`src/baseline/ppocr.ts`): ppu-paddle-ocr 6.6.1 and onnxruntime-node must be
  pinned in `docs/versions.md` first; it lands with the labelled test set.
- NO_MATCH recall and the classifier traps (NO_RULE, RATE_MISMATCH, ruled deductions) need the test
  set's ratified terms; until then those cells report `pass: null` (not evaluated).
- "Recomputed lines equal label lines" for injection slips needs WS-CORE's `computeLines`; the
  harness checks that the slip is quarantined, its row is exact and no quarantined text survives as a
  deduction.
