# Smoke fixtures (synthetic, code-drawn): never part of the eval set

These images are drawn by `src/read/smoke/make-images.ts` (SVG rendered with sharp, the "Ink Free"
font standing in for handwriting). They exist only to smoke-test ClaudeGateway and the AI-1 to AI-6
components against the live API before the Codex-generated S3 slips arrive. C-24: eval images come
from Codex image_gen only, so nothing here may be used as an eval case or seed data.

| File                           | What it exercises                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `smoke-1-clean.png`            | One clean white original (slip 0901), a hauling deduction                                                                     |
| `smoke-2-overwrite-smudge.png` | Pink duplicate (0902): grade G1 struck through and rewritten G2, a stained digit in Net, an unruled "Multa" line, a thumbmark |
| `smoke-3-two-slips-note.png`   | Two slips on a mat (0903, 0904) and a margin note addressed to an AI on 0903                                                  |
| `smoke-ratecard.png`           | A one-page stub of Schedule A (S4.3's R1, R2, R5 and the closed list) with a handwritten "R7" amendment and two signatures    |
- `*.fixture.json`: the drawn rectangles (IC-11 shape, normalised 0–1); `*.truth.json`: what was drawn;
  `smoke-ratecard.text.json`: the stub's text layer (S4.3 sidecar shape), the strings it was drawn from.
- `recordings/`: every answer, recorded live once and scrubbed. Reads A and B (claude-opus-5-5, effort
  low) on the three slip images; then, through the production pipeline, the AI-4 screen
  (claude-haiku-5-5) on smoke-2 and smoke-3 plus smoke-3's text-only re-screen, the AI-3 zoom
  (claude-opus-5-5, effort medium) on smoke-2's stained net weight, the AI-5 rate-card read
  (claude-opus-5-5, effort medium) of the stub page, and two AI-6 classifications (claude-sonnet-5-5,
  effort low). `src/read/smoke/smoke.replay.test.ts` replays all of them with no network.
- `report.json`: per call the stop reason, latency (and time to first text), input, output, thinking
  and cache tokens and cost; per document what the pipeline decided. Reads: `calls`, `images`.
  Components: `components`.

What the component run found (22 Oct 2026): every call ended `end_turn` with the model asked; the
zoom used 62 of its 1,500 output tokens (no thinking), so S4.1's `maxTokens` stands; the rate-card
read thought for 569 tokens, wrote 1,772 and passed every S4.3 check, with the amendment kept out of
the terms; structured outputs with an image work on claude-haiku-5-5 and the dynamic rule-id enum on
claude-sonnet-5-5. The first rate-card recording came back with an empty `replay_timeline` (the
gateway skipped recording deltas when no one watched the stream live); the gateway was fixed and the
call recorded again. The component calls cost US$0.11 in all, the discarded recording included.

Regenerate the rate-card stub with `corepack pnpm --filter @fairsplit/ai smoke:images --only ratecard`
(never redraw the slips: their sha256 keys the read recordings). `smoke:live` re-runs the reads and
`smoke:components` the components: replays are free, and a new image, prompt, schema or sanitiser
version records again, capped at US$1.50 a day in `packages/ai/.cache/`.
