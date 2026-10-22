# Smoke fixtures (synthetic, code-drawn): never part of the eval set

These three images are drawn by `src/read/smoke/make-images.ts` (SVG rendered with sharp, the
"Ink Free" font standing in for handwriting). They exist only to smoke-test ClaudeGateway and the
slip readers before the Codex-generated S3 slips arrive. C-24: eval images come from Codex image_gen
only, so nothing here may be used as an eval case.

| File                           | What it exercises                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `smoke-1-clean.png`            | One clean white original (slip 0901), a hauling deduction                                                                     |
| `smoke-2-overwrite-smudge.png` | Pink duplicate (0902): grade G1 struck through and rewritten G2, a stained digit in Net, an unruled "Multa" line, a thumbmark |
| `smoke-3-two-slips-note.png`   | Two slips on a mat (0903, 0904) and a margin note addressed to an AI on 0903                                                  |
- `*.fixture.json`: the drawn rectangles (IC-11 shape, normalised 0–1); `*.truth.json`: what was drawn.
- `recordings/`: reads A and B, recorded live once with claude-opus-5-5 at effort low and scrubbed;
  `src/read/smoke/smoke.replay.test.ts` replays them through `extract()` with no network.
- `report.json`: the live run's latency, tokens, cost and box/value accuracy.

Regenerate the images with `corepack pnpm --filter @fairsplit/ai smoke:images`; re-run the reads with
`corepack pnpm --filter @fairsplit/ai smoke:live` (replays are free; a new image, prompt or schema
version records again, capped at US$1.50 a day in `packages/ai/.cache/`).
