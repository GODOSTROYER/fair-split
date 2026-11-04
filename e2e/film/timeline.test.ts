import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BEAT_MOMENTS,
  beatReceipts,
  filmTimeline,
  readFilmScript,
  TAKE_MARKS,
  waitUntilBeat,
} from "./timeline.js";

interface ScriptShape {
  readonly beats: readonly { readonly id: string; readonly start: number }[];
  readonly CAPTURES: readonly {
    readonly id: string;
    readonly beat: string;
    readonly start: number;
    readonly state: string;
  }[];
}
// The same exported data video/build.mjs assembles the film from, imported directly here as an independent oracle.
const scriptUrl = new URL("../../video/script.ts", import.meta.url);
const script = (await import(scriptUrl.href)) as ScriptShape;

test("film timing reads the script's exported beats and capture slots, whatever their field order", () => {
  const film = filmTimeline(readFilmScript(scriptUrl));
  assert.deepEqual(
    film.beats,
    script.beats.map(({ id, start }) => ({ id, start })),
  );
  assert.deepEqual(
    film.slots,
    script.CAPTURES.map(({ id, start }) => ({ id, start })),
  );
  // Script v4 puts `part` between a beat's `id` and `start`: v3's source pattern found no beats in it at all.
  const v4 = {
    beats: [{ id: "funding", part: "deep-dive", start: 65, end: 73 }],
    CAPTURES: [{ id: "reading-byhand", beat: "reading", start: 76.5, duration: 6.5 }],
  };
  assert.deepEqual(filmTimeline(v4), {
    beats: [{ id: "funding", start: 65 }],
    slots: [{ id: "reading-byhand", start: 76.5 }],
  });
  assert.throws(() => filmTimeline({ CAPTURES: v4.CAPTURES }), /no film beats/i);
  assert.throws(() => filmTimeline({ beats: v4.beats }), /no film capture slots/i);
  assert.throws(() => filmTimeline({ ...v4, beats: [{ id: "funding", start: "1:05" }] }), /start/i);
  assert.throws(() => filmTimeline({ ...v4, beats: [...v4.beats, ...v4.beats] }), /duplicate/i);
  assert.throws(
    () => filmTimeline({ ...v4, CAPTURES: [{ id: "funding", beat: "funding", start: 65 }] }),
    /duplicate/i,
  );
  // A script that cannot be evaluated fails loudly instead of pacing to nothing.
  assert.throws(() => readFilmScript(new URL("./no-such-script.ts", scriptUrl)));
});

test("the E-01 take paces only to marks the script has, in film order", () => {
  const { beats, slots } = filmTimeline(script);
  const starts = TAKE_MARKS.map((id) => {
    const mark = [...beats, ...slots].find((entry) => entry.id === id);
    assert.ok(mark, `video/script.ts has no beat or capture slot ${id}`);
    return mark.start;
  });
  assert.deepEqual(
    starts,
    [...starts].sort((a, b) => a - b),
  );
});

test("each magic-moment beat is a script beat whose own capture slots record that moment", () => {
  for (const [beat, moment] of Object.entries(BEAT_MOMENTS)) {
    assert.ok(
      script.beats.some((entry) => entry.id === beat),
      `${beat} is not a beat of video/script.ts`,
    );
    assert.ok(
      script.CAPTURES.some((slot) => slot.beat === beat && slot.state.startsWith(`${moment} on `)),
      `${beat}: no capture slot records ${moment}`,
    );
  }
});

test("film receipts list every script beat and keep the actual phase clock", () => {
  const receipts = beatReceipts([
    { moment: "MM-S", phase: "funded", atMs: 65_432 },
    { moment: "MM-2", phase: "landed", atMs: 74_000 },
    { moment: "MM-2", phase: "done", atMs: 79_000 },
    // The seeded phone's paid view: no v4 beat cuts to MM-1.
    { moment: "MM-1", phase: "done", atMs: 80_000 },
    { moment: "MM-5", phase: "inked", atMs: 108_250 },
    { moment: "MM-7", phase: "rest", atMs: 129_000 },
    { moment: "MM-7", phase: "tiled", atMs: 133_004 },
  ]);
  assert.deepEqual(
    receipts.map((receipt) => receipt.id),
    script.beats.map((beat) => beat.id),
  );
  const receipt = (id: string) => receipts.find((entry) => entry.id === id);
  assert.deepEqual(receipt("funding"), {
    id: "funding",
    plannedStartMs: 65_000,
    moment: "MM-S",
    phase: "funded",
    landedAtMs: 65_432,
  });
  assert.equal(receipt("reading")?.landedAtMs, 79_000);
  assert.equal(receipt("signing")?.landedAtMs, 108_250);
  assert.equal(receipt("member")?.landedAtMs, 133_004);
  assert.deepEqual(receipt("count-once"), {
    id: "count-once",
    plannedStartMs: 83_000,
    moment: "MM-3",
    phase: null,
    landedAtMs: null,
  });
  assert.equal(receipt("architecture")?.moment, null);
  assert.equal(receipt("architecture")?.landedAtMs, null);
  assert.ok(receipts.every((entry) => entry.moment !== "MM-1"));
});

test("film pacing waits for v4's beat and in-beat cut times without inventing elapsed time", async () => {
  const delays: number[] = [];
  const record = async (ms: number) => {
    delays.push(ms);
  };
  await waitUntilBeat("funding", 1_000, () => 60_000, record);
  // A capture slot cutting in partway through its beat: slip 0462 entered by hand at 1:16.5.
  await waitUntilBeat("reading-byhand", 1_000, () => 70_000, record);
  await waitUntilBeat("funding", 1_000, () => 70_000, record);
  assert.deepEqual(delays, [6_000, 7_500]);
  await assert.rejects(
    waitUntilBeat("duplicate", 1_000, () => 0, record),
    /unknown film beat/i,
  );
});
