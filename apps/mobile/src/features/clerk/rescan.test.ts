import { describe, expect, it } from "vitest";
import type { CaptureRecord } from "../../lib/outbox";
import { t } from "./messages";
import {
  addRescan,
  openRescans,
  parseRescanEvent,
  parseStoredRescans,
  RESCAN_EVENT,
  RESCAN_KEEP_MS,
  type RescanRequest,
} from "./rescan";

const T0 = Date.parse("2026-10-29T02:00:00Z"); // 10:00 in Calinan

/** The event fs-api sends when the treasurer presses "Request rescan" (shim-defined until IC-01 lists it). */
function event(over: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) {
  return {
    id: "4101",
    ws: "ws_live",
    runId: "run_x",
    type: RESCAN_EVENT,
    at: "2026-10-29T01:59:58Z",
    actor: { kind: "human", id: "treasurer:analyn" },
    provenance: "live",
    payload: {
      photo: "E",
      captureId: "0190f0f0-0000-7000-8000-00000000000e",
      requestedBy: "Analyn",
      ...payload,
    },
    ...over,
  };
}

function request(id: string, at: number, photo = "E"): RescanRequest {
  return { id, photo, captureId: null, requestedBy: "Analyn", at };
}

let n = 0;
function slip(createdAt: number, kind: CaptureRecord["kind"] = "slip"): CaptureRecord {
  n++;
  return { id: `c${n}`, kind, createdAt } as CaptureRecord;
}

describe("rescan requests", () => {
  it("are read from the run event, and stamped with the time this phone heard them", () => {
    expect(parseRescanEvent(event(), T0)).toEqual({
      id: "4101",
      photo: "E",
      captureId: "0190f0f0-0000-7000-8000-00000000000e",
      requestedBy: "Analyn",
      at: T0,
    });
    // S1.9's own words for the banner.
    const q = parseRescanEvent(event(), T0);
    expect(q && t("ceb", "M-CL-01.rescanAsked", { name: q.requestedBy ?? "", photo: q.photo })).toBe(
      "Gihangyo ni Analyn nga i-scan pag-usab ang photo E.",
    );
  });

  it("take a name as the clerk knows it, never a persona id, and read 'the treasurer' without one", () => {
    expect(
      parseRescanEvent(event({}, { requestedBy: { first: "Analyn", initials: "AS" } }), T0)?.requestedBy,
    ).toBe("Analyn");
    expect(parseRescanEvent(event({}, { requestedBy: "treasurer:analyn" }), T0)?.requestedBy).toBeNull();
    expect(parseRescanEvent(event({}, { requestedBy: undefined }), T0)?.requestedBy).toBeNull();
    expect(parseRescanEvent(event({}, { captureId: "" }), T0)?.captureId).toBeNull();
  });

  it("ignore other events and anything malformed", () => {
    expect(parseRescanEvent(event({ type: "capture.synced" }), T0)).toBeNull();
    expect(parseRescanEvent(event({ id: "" }), T0)).toBeNull();
    expect(parseRescanEvent(event({ payload: null }), T0)).toBeNull();
    expect(parseRescanEvent(event({}, { photo: " " }), T0)).toBeNull();
    expect(parseRescanEvent(event({}, { photo: "a label far too long" }), T0)).toBeNull();
    expect(parseRescanEvent({}, T0)).toBeNull();
  });

  it("stay open until a slip filed after them is on the phone, one slip per request, oldest first", () => {
    const e = request("e", T0, "E");
    const f = request("f", T0 + 60_000, "F");
    const before = slip(T0 - 1);
    expect(openRescans([e, f], [before], T0 + 120_000)).toEqual([e, f]);
    // One new scan answers the older request; the other banner stays.
    expect(openRescans([f, e], [before, slip(T0 + 90_000)], T0 + 120_000)).toEqual([f]);
    expect(openRescans([e, f], [slip(T0 + 30_000), slip(T0 + 90_000)], T0 + 120_000)).toEqual([]);
    // A slip filed between the two requests answers only the first.
    expect(openRescans([e, f], [slip(T0 + 30_000)], T0 + 120_000)).toEqual([f]);
    // A cash receipt is not a rescan.
    expect(openRescans([e], [slip(T0 + 30_000, "nadawat")], T0 + 120_000)).toEqual([e]);
    // The answering slip removed from the phone (the co-op refused it): the co-op still lacks the page.
    expect(openRescans([e], [], T0 + 120_000)).toEqual([e]);
  });

  it("are kept once each, newest last, and dropped after a week", () => {
    const e = request("e", T0);
    let list = addRescan([], e, T0);
    list = addRescan(list, { ...e, at: T0 + 5 }, T0 + 5); // redelivered: the same request
    expect(list).toEqual([e]);
    list = addRescan(list, request("f", T0 + 10, "F"), T0 + 10);
    expect(list.map((q) => q.id)).toEqual(["e", "f"]);
    expect(addRescan(list, request("g", T0 + RESCAN_KEEP_MS), T0 + RESCAN_KEEP_MS).map((q) => q.id)).toEqual([
      "f",
      "g",
    ]);
    expect(openRescans([e], [], T0 + RESCAN_KEEP_MS)).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => request(`r${i}`, T0 + i));
    expect(many.reduce((all, q) => addRescan(all, q, T0 + 30), [] as RescanRequest[])).toHaveLength(20);
  });

  it("survive a restart, and a damaged store is read as what it can trust", () => {
    const e = { ...request("e", T0), captureId: "c-1" };
    const raw = JSON.stringify([e, { id: "x" }, null, { ...request("f", T0 + 1), at: "soon" }]);
    expect(parseStoredRescans(raw, T0 + 1000)).toEqual([e]);
    expect(parseStoredRescans("{not json", T0)).toEqual([]);
    expect(parseStoredRescans(JSON.stringify({ e }), T0)).toEqual([]);
    expect(parseStoredRescans(null, T0)).toEqual([]);
    expect(parseStoredRescans(JSON.stringify([e]), T0 + RESCAN_KEEP_MS)).toEqual([]);
  });
});
