// The reading room's read model (W-TR-03) and the recorded run it replays: rows land from `extract.row`, the
// pink copy and the quarantined instruction are named, slip 0462 goes to a person, and MM-2's numbers all come
// from @fairsplit/motion's timeline.

import { getSnapshot } from "@fairsplit/api-client/seed";
import type { RunEvent } from "@fairsplit/contracts";
import { MOMENTS, TIMELINES } from "@fairsplit/motion";
import { describe, expect, it } from "vitest";
import { applyRunEvents, firstView, sessionView } from "../../data/run-view.js";
import { illegibleRows, zoomAgreedRow } from "../../test/reading-fixtures.js";
import { flightKeyframes, flightPath, LIFT_SCALE, maxFlights, ROW_AT } from "./mm2.js";
import {
  benchPhoto,
  confirmHoldFor,
  confirmRow,
  earlierPhotos,
  hasStarted,
  photoById,
  photoForRow,
  photoIsBlurred,
  photoIsRead,
  readingState,
  replayPhotos,
  replayProgress,
  rowsForPhoto,
  statusSentence,
} from "./model.js";
import { recordedEvents, replayView } from "./replay.js";
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
  it("maps cloned row identities by serial and position, keeping the white and pink copies apart", () => {
    const cloned = rows.map((row) => ({
      ...row,
      payload: { ...row.payload, docId: `clone-${row.photoId}` },
    }));
    for (const row of cloned) expect(photoForRow(snapshot, row.payload)?.photoId).toBe(row.photoId);
    const view = applyRunEvents(
      reading,
      cloned.map((row) => extractRowEvent(row, stamp())),
    );
    for (const photo of replayPhotos(snapshot)) {
      const printed = rowsForPhoto({ snapshot, view, photo });
      expect(printed.every((row) => row?.source === "event")).toBe(true);
      expect(printed.find((row) => row?.serial === "0457")?.copy).toBe(
        photo.photoId === "B" ? "white" : photo.photoId === "D" ? "pink" : undefined,
      );
    }
    expect(benchPhoto(snapshot, view, undefined)?.photoId).toBe("L");
  });

  it("refuses conflicting known documents, unknown slips, wrong positions and ambiguous clone matches", () => {
    const first = rows[0];
    if (!first) throw new Error("no first replay row");
    const row = first.payload;
    expect(photoForRow(snapshot, { ...row, docId: "clone-A", serial: "missing" })).toBeUndefined();
    expect(photoForRow(snapshot, { ...row, docId: "clone-A", row: 9 })).toBeUndefined();
    expect(photoForRow(snapshot, { ...row, docId: "clone-A", row: 1 })).toBeUndefined();
    const other = photoById(snapshot, "B");
    if (!other) throw new Error("no photo B");
    expect(photoForRow(snapshot, { ...row, docId: other.documentId })).toBeUndefined();
    const firstPhoto = photoById(snapshot, "A");
    if (!firstPhoto) throw new Error("no photo A");
    const ambiguous = { ...snapshot, photos: [...snapshot.photos, { ...firstPhoto, photoId: "extra" }] };
    expect(photoForRow(ambiguous, { ...row, docId: "clone-A" })).toBeUndefined();
  });

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

describe("one tap for the zoom's read, and a rescan for a blurred photo (S1.7)", () => {
  const photoJ = photoById(snapshot, "J");
  const photoE = photoById(snapshot, "E");
  const lowConfidence = snapshot.holds.find((h) => h.kind === "LOW_CONFIDENCE" && h.serials.includes("0462"));
  const raised = (): RunEvent =>
    ({
      ...stamp(),
      actor: { kind: "engine", id: "engine", impersonatedBy: null },
      provenance: "seeded",
      type: "hold.raised",
      payload: {
        holdId: "hold-0462",
        label: "Slip 0462 by hand",
        key: lowConfidence?.key ?? "",
        kind: "LOW_CONFIDENCE",
        gate: "BLOCKS_APPROVAL",
        memberNo: "M-060",
        lineId: null,
      },
    }) as RunEvent;
  const confirmedEvent = (): RunEvent =>
    ({
      ...stamp(),
      actor: { kind: "human", id: "AS", impersonatedBy: null },
      provenance: "live",
      type: "hold.resolved",
      payload: {
        holdId: "hold-0462",
        label: "Slip 0462 by hand",
        state: "RESOLVED",
        resolution: "CONFIRM_AS_READ",
        resolvedBy: "AS",
      },
    }) as RunEvent;
  const zoomRead = () => {
    const rest = rows.filter((r) => r.photoId === "J" && r.serial !== "0462");
    return applyRunEvents(reading, [
      ...rest.map((r) => extractRowEvent(r, stamp())),
      extractRowEvent(zoomAgreedRow(snapshot), stamp()),
      raised(),
    ]);
  };

  it("confirm-one: the zoom's read agrees with one of the two readings, and waits for one tap", () => {
    if (!photoJ) throw new Error("no photo J");
    const printed = rowsForPhoto({ view: zoomRead(), snapshot, photo: photoJ });
    const row = printed.find((r) => r?.serial === "0462");
    expect(row?.zoomAgreed).toEqual({ field: "gross_kg", value: "64.80", display: "6?.80" });
    expect(row?.netKg).toBe("64.50");
    expect(confirmRow(printed)?.serial).toBe("0462");
    expect(
      readingState({
        photo: photoJ,
        started: true,
        reading: false,
        rows: printed,
        offline: false,
        aiPaused: false,
      }),
    ).toBe("confirm-one");
    expect(
      statusSentence({ photo: photoJ, rows: printed, reading: false, started: true, snapshot }),
    ).toContain("Slip 0462: the stand-in's zoom value agrees with one of its two readings.");
  });

  it("a hold that names only the member never takes the tap: it could be another of her slips", () => {
    if (!photoJ) throw new Error("no photo J");
    const rest = rows.filter((r) => r.photoId === "J" && r.serial !== "0462");
    const other = (): RunEvent =>
      ({
        ...stamp(),
        actor: { kind: "engine", id: "engine", impersonatedBy: null },
        provenance: "live",
        type: "hold.raised",
        payload: {
          holdId: "hold-other-slip",
          label: "Another slip of M-060",
          key: "LOW_CONFIDENCE:row-not-this-slip",
          kind: "LOW_CONFIDENCE",
          gate: "BLOCKS_APPROVAL",
          memberNo: "M-060",
          lineId: null,
        },
      }) as RunEvent;
    const view = applyRunEvents(reading, [
      ...rest.map((r) => extractRowEvent(r, stamp())),
      extractRowEvent(zoomAgreedRow(snapshot), stamp()),
      other(),
    ]);
    expect(confirmHoldFor(view, snapshot, "0462")).toBeUndefined();
    const printed = rowsForPhoto({ view, snapshot, photo: photoJ });
    expect(printed.find((r) => r?.serial === "0462")?.confirmed).toBeNull();
  });

  it("the tap is the person's: once the hold reads CONFIRM_AS_READ the value is ink with their stamp", () => {
    if (!photoJ) throw new Error("no photo J");
    const view = applyRunEvents(zoomRead(), [confirmedEvent()]);
    const printed = rowsForPhoto({ view, snapshot, photo: photoJ });
    const row = printed.find((r) => r?.serial === "0462");
    expect(row?.zoomAgreed).toBeNull();
    expect(row?.confirmed).toMatchObject({ by: "AS", value: "64.80" });
    expect(row?.pending).toEqual([]);
    expect(
      readingState({
        photo: photoJ,
        started: true,
        reading: false,
        rows: printed,
        offline: false,
        aiPaused: false,
      }),
    ).toBe("read");
  });

  it("a zoom that failed (row 7, 0.40) is not a tap: a person types it", () => {
    if (!photoJ) throw new Error("no photo J");
    const failed = zoomAgreedRow(snapshot);
    const fields = Object.fromEntries(
      Object.entries(failed.payload.fields).map(([k, f]) => [
        k,
        f.decidedBy === "zoom" ? { ...f, score: 0.4, value: null } : f,
      ]),
    );
    const view = applyRunEvents(reading, [
      extractRowEvent({ ...failed, payload: { ...failed.payload, fields } }, stamp()),
    ]);
    const row = rowsForPhoto({ view, snapshot, photo: photoJ }).find((r) => r?.serial === "0462");
    expect(row?.zoomAgreed).toBeNull();
    expect(row?.pending).toContain("gross_kg");
  });

  it("blurred: every slip of photo E came back illegible, so the clerk is asked to rescan", () => {
    if (!photoE) throw new Error("no photo E");
    const view = applyRunEvents(
      reading,
      illegibleRows(snapshot, "E").map((r) => extractRowEvent(r, stamp())),
    );
    const printed = rowsForPhoto({ view, snapshot, photo: photoE });
    expect(printed.every((r) => r?.illegible === true)).toBe(true);
    expect(photoIsBlurred(printed)).toBe(true);
    expect(
      readingState({
        photo: photoE,
        started: true,
        reading: false,
        rows: printed,
        offline: false,
        aiPaused: false,
      }),
    ).toBe("blurred");
    expect(statusSentence({ photo: photoE, rows: printed, reading: false, started: true, snapshot })).toBe(
      "Photo E is too blurred to read. Ask Jessie to rescan.",
    );
  });

  it("one illegible slip is not a blurred photo: it goes to a person like any doubtful field", () => {
    if (!photoE) throw new Error("no photo E");
    const [first] = illegibleRows(snapshot, "E");
    const rest = rows.filter((r) => r.photoId === "E").slice(1);
    if (!first) throw new Error("no rows in E");
    const view = applyRunEvents(
      reading,
      [first, ...rest].map((r) => extractRowEvent(r, stamp())),
    );
    const printed = rowsForPhoto({ view, snapshot, photo: photoE });
    expect(photoIsBlurred(printed)).toBe(false);
    expect(
      readingState({
        photo: photoE,
        started: true,
        reading: false,
        rows: printed,
        offline: false,
        aiPaused: false,
      }),
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
    ).toBe("Photo C waits its turn. The seed stand-in is playing photo A.");
  });

  it("follows the reading while nothing is pinned, and keeps the photo the URL names", () => {
    expect(benchPhoto(snapshot, firstView(snapshot), undefined)?.photoId).toBe("A");
    expect(benchPhoto(snapshot, withRows(["A", "B"]), undefined)?.photoId).toBe("B");
    expect(benchPhoto(snapshot, withRows(["A", "B"]), "K")?.photoId).toBe("K");
    expect(replayPhotos(snapshot)).toHaveLength(12);
  });
});

describe("the mock-only replay of the recording", () => {
  it("plays the 48 rows in order, slip 0449's quarantine right after its row, every event the seed's stand-in", () => {
    const events = recordedEvents(snapshot, "Rtest", () => "2026-10-29T02:00:00.000Z");
    const kinds = events.map((e) => e.type);
    expect(kinds.filter((k) => k === "extract.row")).toHaveLength(48);
    expect(kinds.filter((k) => k === "extract.quarantined")).toHaveLength(1);
    const q = kinds.indexOf("extract.quarantined");
    const before = events[q - 1];
    expect(before?.type === "extract.row" && before.payload.serial).toBe("0449");
    // Built from the seed, not a recording: labelled seeded, attributed to the seed, never to Claude.
    for (const e of events) {
      expect(e.provenance).toBe("seeded");
      expect(e.actor).toMatchObject({ kind: "system", id: "seed" });
    }
    const ids = events.map((e) => e.id);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shows only what it has replayed so far, reading while it runs and the run's own state after", () => {
    const live = applyRunEvents(session, [
      runState("INVOICED", "FUNDED"),
      runState("FUNDED", "EXTRACTING"),
      runState("EXTRACTING", "COMPUTED"),
    ]);
    const events = recordedEvents(snapshot, "Rtest", () => "2026-10-29T02:00:00.000Z");
    const running = replayView(live, events.slice(0, 4), true);
    expect(running.state).toBe("EXTRACTING");
    expect(running.rows).toHaveLength(4);
    const photo = photoById(snapshot, "B");
    if (!photo) throw new Error("no photo B");
    expect(rowsForPhoto({ view: running, snapshot, photo }).every((r) => r === null)).toBe(true);
    const done = replayView(live, events, false);
    expect(done.state).toBe("COMPUTED");
    expect(done.rows).toHaveLength(48);
    expect(done.quarantined).toHaveLength(1);
    expect(live.rows).toHaveLength(0);
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
