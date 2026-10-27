import { describe, expect, it } from "vitest";
import { capsuleFor } from "../../lib/item-status";
import { buildDemoStatement } from "../../services/demo-fixtures";
import { hapticAt, traceState, zoomLimit, zoomTransform } from "./mm7";
import { isPreviewLine, previewLine } from "./preview";
import {
  cleanNote,
  NOTE_MAX,
  parseReview,
  reviewPrefKey,
  reviewScreenState,
  serializeReview,
} from "./review";

describe("Ipasusi pag-usab: the request this phone remembers", () => {
  it("round-trips the record, never the note", () => {
    const r = { id: "rr_1", at: "2026-10-30T02:00:00Z", slip: "0403" };
    expect(parseReview(serializeReview(r))).toEqual(r);
    expect(serializeReview(r)).not.toContain("note");
    expect(reviewPrefKey("line_2026A_r37_M-014")).toBe("fs.review.line_2026A_r37_M-014");
  });

  it("treats anything malformed as no request", () => {
    expect(parseReview(null)).toBeNull();
    expect(parseReview("{")).toBeNull();
    expect(parseReview('{"id":"","at":"2026-10-30T02:00:00Z"}')).toBeNull();
    expect(parseReview('{"id":"x","at":"yesterday"}')).toBeNull();
    expect(parseReview('{"id":"x","at":"2026-10-30T02:00:00Z","slip":"../../etc"}')).toEqual({
      id: "x",
      at: "2026-10-30T02:00:00Z",
      slip: null,
    });
  });

  it("sends a short, trimmed note or none", () => {
    expect(cleanNote("   ")).toBeUndefined();
    expect(cleanNote("  Ang  kilo \n sa 0403  ")).toBe("Ang kilo sa 0403");
    expect(cleanNote("x".repeat(NOTE_MAX + 40))).toHaveLength(NOTE_MAX);
  });

  it("has a data-state for every phase (IC-01 M-MB-04)", () => {
    const base = { record: null, phase: "idle" as const, composing: false, online: true };
    expect(reviewScreenState(base)).toBe("none");
    expect(reviewScreenState({ ...base, composing: true })).toBe("composing");
    expect(reviewScreenState({ ...base, phase: "sending" })).toBe("sending");
    expect(reviewScreenState({ ...base, phase: "failed" })).toBe("failed");
    expect(reviewScreenState({ ...base, online: false })).toBe("offline");
    expect(reviewScreenState({ ...base, record: { id: "x", at: "2026-10-30T02:00:00Z", slip: null } })).toBe(
      "sent",
    );
  });
});

describe("MM-7 geometry and trace", () => {
  it("exposes closed, line and slip as the trace deepens (S1.9 data-trace)", () => {
    expect(traceState("rest")).toBe("closed");
    expect(traceState("framed")).toBe("line");
    expect(traceState("expanded")).toBe("line");
    expect(traceState("zooming")).toBe("slip");
    expect(traceState("tiled")).toBe("slip");
    expect(traceState("returning")).toBe("slip");
  });

  it("zooms at most 2.4x, and never past the source's pixels", () => {
    expect(zoomLimit(null)).toBe(2.4);
    expect(zoomLimit({ px: 720, fieldDp: 120, pixelRatio: 3 })).toBe(2);
    expect(zoomLimit({ px: 4000, fieldDp: 120, pixelRatio: 2 })).toBe(2.4);
    expect(zoomLimit({ px: 100, fieldDp: 120, pixelRatio: 3 })).toBe(1);
  });

  it("grows from the tapped chip into place", () => {
    const origin = { x: 80, y: 600 };
    const centre = { x: 200, y: 260 };
    expect(zoomTransform(0, origin, centre, 2.4)).toEqual({
      translateX: -120,
      translateY: 340,
      scale: 1 / 2.4,
    });
    expect(zoomTransform(1, origin, centre, 2.4)).toEqual({ translateX: -0, translateY: 0, scale: 1 });
    expect(hapticAt()).toBeCloseTo(2 / 3);
  });
});

describe("demo-only line previews", () => {
  const dto = buildDemoStatement({ stage: "sent", now: "2026-10-30T09:12:00+08:00" });
  const capsule = (line: string) => {
    const d = previewLine(dto, line);
    return capsuleFor({ lineState: d.lineState, rail: d.rail, itemStatus: d.item?.status ?? null });
  };
  it("reach the states the demo's PayPal path never does", () => {
    expect(capsule("PAYPAL_HELD")).toBe("paypal-held");
    expect(capsule("NEEDS_ACTION")).toBe("needs-action");
    expect(capsule("REVERSED")).toBe("reversed");
    expect(capsule("RETURNED")).toBe("returned");
    expect(capsule("EXCLUDED")).toBe("excluded");
    expect(capsule("HELD")).toBe("held-line");
  });
  it("leave anything else untouched", () => {
    expect(isPreviewLine("PAID")).toBe(false);
    expect(isPreviewLine("toString")).toBe(false);
    expect(previewLine(dto, null)).toBe(dto);
    expect(previewLine(dto, "toString")).toBe(dto);
  });
});
