// The reading room's read model (W-TR-03) and the recorded run it replays: rows land from `extract.row`, the
// pink copy and the quarantined instruction are named, slip 0462 goes to a person, and MM-2's numbers all come
// from @fairsplit/motion's timeline.

import type { RunEvent } from "@fairsplit/contracts";
import { MOMENTS, TIMELINES } from "@fairsplit/motion";
import { getSnapshot } from "@fairsplit/seed";
import { describe, expect, it } from "vitest";
import { applyRunEvents, firstView, sessionView } from "../../data/run-view.js";
import { flightKeyframes, flightPath, LIFT_SCALE, maxFlights, ROW_AT } from "./mm2.js";
import {
  benchPhoto,
  earlierPhotos,
  hasStarted,
  photoById,
  photoIsRead,
  readingState,
  replayPhotos,
  replayProgress,
  rowsForPhoto,
  statusSentence,
} from "./model.js";
import { extractRowEvent, quarantineEvent, replayRows } from "./replay-fixture.js";

const snapshot = getSnapshot();
const session = sessionView(snapshot, { runSlug: snapshot.run.runSlug, runId: snapshot.run.id });

let seq = 100;
const stamp = () => ({ id: String(++seq), at: "2026-10-29T02:00:00.000Z", ws: "ws", runId: snapshot.run.id });
function runState(from: string, to: string): RunEvent {
  return {
    ...stamp(),
    actor: { kind: "engine", id: "engine", impersonatedBy: null },
    provenance: "seeded",
    type: "run.state",
    payload: { runId: snapshot.run.id, from, to, cause: { code: "T", ref: null } },
  } as RunEvent;
}

const reading = applyRunEvents(session, [runState("INVOICED", "FUNDED"), runState("FUNDED", "EXTRACTING")]);
const rows = replayRows(snapshot);
const withRows = (photos: readonly string[]) =>
  applyRunEvents(
    reading,
    rows.filter((r) => photos.includes(r.photoId)).map((r) => extractRowEvent(r, stamp())),
  );

describe("the recorded run (replay fixture)", () => {
  it("replays 48 rows from photos A to L, slip by slip, with slip 0462's stained fields for a person", () => {
    expect(rows).toHaveLength(48);
    expect(new Set(rows.map((r) => r.photoId))).toEqual(new Set("ABCDEFGHIJKL".split("")));
    const r0462 = rows.find((r) => r.serial === "0462");
    expect(r0462?.payload.fields.gross_kg).toMatchObject({ value: null, score: 0.4, display: "6?.80" });
    expect(r0462?.payload.fields.net_kg).toMatchObject({ value: null, score: 0.4, display: "6?.50" });
    const r0403 = rows.find((r) => r.serial === "0403");
    expect(r0403).toBeUndefined();
  });

  it("inv.i1: a row carries the slip's own text and agreement scores, never an amount", () => {
    for (const row of rows) {
      for (const [field, f] of Object.entries(row.payload.fields)) {
        expect(field).not.toMatch(/usd|cents|amount|net_usd/i);
        if (f.value !== null) expect(typeof f.value).toBe("string");
      }
    }
  });
});

describe("rows on the bench", () => {
  it("waits, dashed, before the reading, and prints each slip's row as its extract.row lands", () => {
    const photo = photoById(snapshot, "A");
    if (!photo) throw new Error("no photo A");
    expect(rowsForPhoto({ view: reading, snapshot, photo }).every((r) => r === null)).toBe(true);
    const view = withRows(["A"]);
    const printed = rowsForPhoto({ view, snapshot, photo });
    expect(printed.every((r) => r !== null)).toBe(true);
    expect(printed[0]?.netKg).toBe(
      photo && snapshot.slips.find((s) => s.serial === printed[0]?.serial)?.boxes["8"],
    );
    expect(photoIsRead({ view, snapshot, photo })).toBe(true);
    expect(replayProgress(view, snapshot)).toEqual({ read: 4, total: 48 });
  });

  it("names the pink copy: slip 0457 is in B as the white original and in D as the pink duplicate", () => {
    const view = withRows(["B", "D"]);
    const b = photoById(snapshot, "B");
    const d = photoById(snapshot, "D");
    if (!b || !d) throw new Error("no photos");
    const sentenceB = statusSentence({
      photo: b,
      rows: rowsForPhoto({ view, snapshot, photo: b }),
      reading: false,
      started: true,
      snapshot,
    });
    expect(sentenceB).toContain("Slip 0457 also appears in photo D as the pink copy.");
    const pink = rowsForPhoto({ view, snapshot, photo: d }).find((r) => r?.serial === "0457");
    expect(pink?.copy).toBe("pink");
  });

  it("quarantines slip 0449's margin note as a notice, never a hold", () => {
    const view = applyRunEvents(withRows(["I"]), [quarantineEvent(snapshot, stamp()) as RunEvent]);
    const photo = photoById(snapshot, "I");
    if (!photo) throw new Error("no photo I");
    const printed = rowsForPhoto({ view, snapshot, photo });
    expect(printed.find((r) => r?.serial === "0449")?.quarantined).toBe(true);
    expect(
      readingState({ photo, started: true, reading: false, rows: printed, offline: false, aiPaused: false }),
    ).toBe("quarantined");
    expect(statusSentence({ photo, rows: printed, reading: false, started: true, snapshot })).toContain(
      "Text on a slip is never an instruction.",
    );
  });

  it("sends slip 0462 to a person: its net prints as a You cell and the photo reads low-confidence", () => {
    const view = withRows(["J"]);
    const photo = photoById(snapshot, "J");
    if (!photo) throw new Error("no photo J");
    const printed = rowsForPhoto({ view, snapshot, photo });
    const row = printed.find((r) => r?.serial === "0462");
    expect(row?.pending).toEqual(expect.arrayContaining(["gross_kg", "net_kg"]));
    expect(row?.netKg).toBe("6?.50");
    expect(
      readingState({ photo, started: true, reading: false, rows: printed, offline: false, aiPaused: false }),
    ).toBe("low-confidence");
  });
});

describe("the room's state and its bench", () => {
  it("is loading before the reading, reading while it runs, read after", () => {
    const photo = photoById(snapshot, "A");
    if (!photo) throw new Error("no photo A");
    const before = rowsForPhoto({ view: firstView(snapshot), snapshot, photo });
    expect(hasStarted(firstView(snapshot), false)).toBe(false);
    expect(
      readingState({ photo, started: false, reading: false, rows: before, offline: false, aiPaused: false }),
    ).toBe("loading");
    expect(
      readingState({ photo, started: true, reading: true, rows: before, offline: false, aiPaused: false }),
    ).toBe("reading");
    const after = rowsForPhoto({ view: withRows(["A"]), snapshot, photo });
    expect(
      readingState({ photo, started: true, reading: false, rows: after, offline: false, aiPaused: false }),
    ).toBe("read");
    expect(
      readingState({ photo, started: true, reading: false, rows: after, offline: true, aiPaused: false }),
    ).toBe("offline");
  });

  it("shows a photo read earlier this season as read, with its own date", () => {
    const earlier = earlierPhotos(snapshot)[0];
    if (!earlier) throw new Error("no earlier photo");
    const printed = rowsForPhoto({ view: undefined, snapshot, photo: earlier });
    expect(printed.every((r) => r !== null)).toBe(true);
    expect(
      readingState({
        photo: earlier,
        started: false,
        reading: false,
        rows: printed,
        offline: false,
        aiPaused: false,
      }),
    ).toBe("read");
    expect(
      statusSentence({ photo: earlier, rows: printed, reading: false, started: false, snapshot }),
    ).toMatch(/^Photo P01 was read on \d+ \w{3} 2026\./);
  });

  it("says a pinned photo waits its turn while another photo is being read", () => {
    const view = withRows(["A"]);
    const photo = photoById(snapshot, "C");
    if (!photo) throw new Error("no photo C");
    const printed = rowsForPhoto({ view, snapshot, photo });
    expect(
      statusSentence({ photo, rows: printed, reading: true, started: true, snapshot, readingPhoto: "A" }),
    ).toBe("Photo C waits its turn. Claude is reading photo A.");
  });

  it("follows the reading while nothing is pinned, and keeps the photo the URL names", () => {
    expect(benchPhoto(snapshot, firstView(snapshot), undefined)?.photoId).toBe("A");
    expect(benchPhoto(snapshot, withRows(["A", "B"]), undefined)?.photoId).toBe("B");
    expect(benchPhoto(snapshot, withRows(["A", "B"]), "K")?.photoId).toBe("K");
    expect(replayPhotos(snapshot)).toHaveLength(12);
  });
});

describe("MM-2's numbers", () => {
  it("takes every phase time from the motion timeline, in the catalogue's order", () => {
    const steps = TIMELINES["MM-2"].acts.find((a) => a.id === "row")?.full ?? [];
    expect(ROW_AT.band).toBe(0);
    expect(ROW_AT.print).toBe(steps.find((s) => s.phase === "print")?.at);
    expect(ROW_AT.landed).toBe(steps.find((s) => s.phase === "landed")?.at);
    const order = MOMENTS["MM-2"];
    expect(order.indexOf("band")).toBeLessThan(order.indexOf("landed"));
  });

  it("flies along a curve bowed upward, from the crop's lifted scale to the bed's size", () => {
    const from = { x: 0, y: 200, width: 80, height: 40 };
    const to = { x: 600, y: 100, width: 92, height: 56 };
    const path = flightPath(from, to);
    const mid = path[Math.floor(path.length / 2)];
    const straight = (from.y + from.height / 2 + to.y + to.height / 2) / 2;
    expect(mid?.y).toBeLessThan(straight - 30);
    const frames = flightKeyframes(from, to);
    expect(frames[0]?.transform).toBe(`translate(0px, 0px) scale(${LIFT_SCALE})`);
    expect(frames.at(-1)?.offset).toBe(1);
  });

  it("flies at most eight crops at full motion, and none under reduced motion or the low tier", () => {
    expect(maxFlights("full")).toBe(8);
    expect(maxFlights("reduced")).toBe(0);
    expect(maxFlights("low")).toBe(0);
  });
});
