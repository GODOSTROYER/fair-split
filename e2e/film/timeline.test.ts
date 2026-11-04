import assert from "node:assert/strict";
import { test } from "node:test";
import { beatReceipts, scriptBeatStarts, waitUntilBeat } from "./timeline.js";

test("film timing reads the editorial script's id/start fields and rejects duplicate beats", () => {
  assert.deepEqual(scriptBeatStarts('id: "funding", start: 20, end: 32'), [{ id: "funding", start: 20 }]);
  assert.throws(() => scriptBeatStarts('id: "funding", start: 20, id: "funding", start: 21'), /duplicate/i);
  assert.throws(() => scriptBeatStarts("not a film timeline"), /no film beats/i);
});

test("film receipts preserve the actual phase clock, including a late cold-open source", () => {
  const receipts = beatReceipts([
    { moment: "MM-S", phase: "funded", atMs: 20_432 },
    { moment: "MM-2", phase: "landed", atMs: 21_000 },
    { moment: "MM-2", phase: "done", atMs: 42_000 },
    { moment: "MM-1", phase: "done", atMs: 22_000 },
    { moment: "MM-1", phase: "pending", atMs: 84_000 },
    { moment: "MM-1", phase: "press", atMs: 84_100 },
    { moment: "MM-1", phase: "done", atMs: 86_123 },
    { moment: "MM-1", phase: "done", atMs: 87_000 },
    { moment: "MM-7", phase: "rest", atMs: 102_000 },
    { moment: "MM-7", phase: "tiled", atMs: 121_004 },
  ]);
  assert.equal(receipts.find((beat) => beat.id === "funding")?.landedAtMs, 20_432);
  assert.equal(receipts.find((beat) => beat.id === "reading")?.landedAtMs, 42_000);
  assert.equal(receipts.find((beat) => beat.id === "arrival")?.landedAtMs, 86_123);
  assert.equal(receipts.find((beat) => beat.id === "listening")?.landedAtMs, 121_004);
  assert.equal(receipts.find((beat) => beat.id === "architecture")?.landedAtMs, null);
});

test("film pacing uses script start times without inventing elapsed time", async () => {
  const delays: number[] = [];
  await waitUntilBeat(
    "funding",
    1_000,
    () => 15_000,
    async (ms) => {
      delays.push(ms);
    },
  );
  await waitUntilBeat(
    "funding",
    1_000,
    () => 25_000,
    async (ms) => {
      delays.push(ms);
    },
  );
  assert.deepEqual(delays, [6_000]);
});
