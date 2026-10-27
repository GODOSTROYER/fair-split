import { describe, expect, it } from "vitest";
import type { ApiResult } from "../../_shims/api-client";
import { capsuleFor } from "../../lib/item-status";
import { UUIDV7_RE, uuidv7 } from "../../lib/uuidv7";
import { buildDemoStatement } from "../../services/demo-fixtures";
import { hapticAt, traceState, zoomLimit, zoomTransform } from "./mm7";
import { isPreviewLine, previewLine } from "./preview";
import {
  cleanNote,
  createReviewSender,
  NOTE_MAX,
  type PostReview,
  pangutanaScreenState,
  parsePendingReview,
  parseReview,
  pendingReviewPrefKey,
  pendingReviewStore,
  type ReviewBody,
  reviewBody,
  reviewDigest,
  reviewPrefKey,
  reviewScreenState,
  serializeReview,
} from "./review";

/** Who is paired (`identityKey`): the member, and the same line number in another workspace. */
const SCOPE = "a1b2c3d4e5f60718";
const OTHER = "0f1e2d3c4b5a6978";

describe("Ipasusi pag-usab: the request this phone remembers", () => {
  it("round-trips the record, never the note", () => {
    const r = { id: "rr_1", at: "2026-10-30T02:00:00Z", slip: "0403" };
    expect(parseReview(serializeReview(r))).toEqual(r);
    expect(serializeReview(r)).not.toContain("note");
    expect(reviewPrefKey(SCOPE, "line_2026A_r37_M-014")).toBe(`fs.review.${SCOPE}:line_2026A_r37_M-014`);
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

  it("Pangutana is none or offline while her line loads, after its read failed, and for an officer", () => {
    const base = { record: null, phase: "idle" as const, composing: true, online: true };
    expect(pangutanaScreenState({ ...base, read: "ready" })).toBe("composing");
    for (const read of ["none", "loading", "error"] as const) {
      expect(pangutanaScreenState({ ...base, read })).toBe("none");
      expect(pangutanaScreenState({ ...base, read, online: false })).toBe("offline");
    }
  });
});

describe("inv.i7.review-idempotency: each composed request is filed once", () => {
  const lineId = "line_2026A_r37_M-014";
  const ok = (id: string): ApiResult<{ id: string }> => ({ ok: true, value: { id } });
  const lost: ApiResult<{ id: string }> = { ok: false, code: "NETWORK" };

  /** A post that answers from a script and records the key each call carried. */
  function scripted(...answers: ApiResult<{ id: string }>[]) {
    const calls: { body: ReviewBody; key: string }[] = [];
    const post: PostReview = async (body, opts) => {
      calls.push({ body, key: opts.idempotencyKey });
      return answers.shift() ?? lost;
    };
    return { post, calls };
  }
  function memoryKv() {
    const m = new Map<string, string>();
    return {
      m,
      kv: {
        get: async (k: string) => m.get(k) ?? null,
        set: async (k: string, v: string) => {
          m.set(k, v);
        },
        del: async (k: string) => {
          m.delete(k);
        },
      },
    };
  }
  let n = 0;
  const mint = () => uuidv7(Date.parse("2026-10-30T02:00:00Z") + n++, (k) => new Uint8Array(k).fill(n));

  it("a retry reuses the key until the Committee's inbox accepts the request", async () => {
    const { kv } = memoryKv();
    const send = createReviewSender({ mint, store: pendingReviewStore(kv) });
    const { post, calls } = scripted(lost, lost, ok("rr_1"));
    const body = reviewBody(lineId, "0403", "Ang kilo sa 0403");
    expect(await send(body, post, SCOPE)).toMatchObject({ ok: false, code: "NETWORK" });
    expect(await send(body, post, SCOPE)).toMatchObject({ ok: false });
    const done = await send(body, post, SCOPE);
    expect(done).toMatchObject({ ok: true, id: "rr_1" });
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => c.key)).size).toBe(1);
    expect(calls[0]?.key).toMatch(UUIDV7_RE);
    expect(done?.key).toBe(calls[0]?.key);
    // Accepted: the next request is a new one.
    const next = scripted(ok("rr_2"));
    await send(reviewBody(lineId, null, ""), next.post, SCOPE);
    expect(next.calls[0]?.key).not.toBe(calls[0]?.key);
  });

  it("two commits in one frame send once", async () => {
    const { kv } = memoryKv();
    const send = createReviewSender({ mint, store: pendingReviewStore(kv) });
    const { post, calls } = scripted(ok("rr_1"));
    const body = reviewBody(lineId, null, "");
    const first = send(body, post, SCOPE);
    const second = send(body, post, SCOPE);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await first;
    expect(calls).toHaveLength(1);
    // Once it settles, the phone can send again.
    const third = send(body, scripted(ok("rr_2")).post, SCOPE);
    expect(third).not.toBeNull();
    await third;
  });

  it("a changed slip or note is a new request with a new key", async () => {
    const { kv } = memoryKv();
    const send = createReviewSender({ mint, store: pendingReviewStore(kv) });
    const { post, calls } = scripted(lost, lost, lost);
    await send(reviewBody(lineId, "0403", "Ang kilo"), post, SCOPE);
    await send(reviewBody(lineId, "0403", "  Ang   kilo "), post, SCOPE); // the same note as sent
    await send(reviewBody(lineId, "0419", "Ang kilo"), post, SCOPE);
    expect(calls[1]?.key).toBe(calls[0]?.key);
    expect(calls[2]?.key).not.toBe(calls[0]?.key);
  });

  it("the key survives a restart, as a key and a digest, never the note", async () => {
    const { m, kv } = memoryKv();
    const body = reviewBody(lineId, "0403", "Ang kilo sa 0403 kulang");
    const before = scripted(lost);
    await createReviewSender({ mint, store: pendingReviewStore(kv) })(body, before.post, SCOPE);
    const saved = m.get(pendingReviewPrefKey(SCOPE, lineId)) ?? "";
    expect(parsePendingReview(saved)).toEqual({ key: before.calls[0]?.key, digest: reviewDigest(body) });
    expect(saved).not.toContain("kulang");
    // A new sender (the app restarted) finds the same key for the same request, and forgets it once accepted.
    const after = scripted(ok("rr_1"));
    await createReviewSender({ mint, store: pendingReviewStore(kv) })(body, after.post, SCOPE);
    expect(after.calls[0]?.key).toBe(before.calls[0]?.key);
    expect(m.has(pendingReviewPrefKey(SCOPE, lineId))).toBe(false);
  });

  it("starts over when the server holds another body under the key, and fails safe when the post throws", async () => {
    const { kv } = memoryKv();
    const send = createReviewSender({ mint, store: pendingReviewStore(kv) });
    const body = reviewBody(lineId, null, "x");
    const reused = scripted({ ok: false, code: "IDEMPOTENCY_KEY_REUSED", status: 422 }, ok("rr_9"));
    expect(await send(body, reused.post, SCOPE)).toMatchObject({ ok: false, code: "IDEMPOTENCY_KEY_REUSED" });
    await send(body, reused.post, SCOPE);
    expect(reused.calls[1]?.key).not.toBe(reused.calls[0]?.key);
    const throws: PostReview = async () => {
      throw new Error("socket closed");
    };
    expect(await send(body, throws, SCOPE)).toMatchObject({ ok: false, code: "NETWORK" });
  });

  it("review.scoped: what one paired member composed is never sent, nor shown as sent, for anyone else", async () => {
    const { m, kv } = memoryKv();
    const send = createReviewSender({ mint, store: pendingReviewStore(kv) });
    const body = reviewBody(lineId, "0403", "Ang kilo");
    const first = scripted(lost);
    await send(body, first.post, SCOPE); // the answer was lost: her key waits, under her
    const other = scripted(lost);
    await send(body, other.post, OTHER); // the same line number, someone else paired
    expect(other.calls[0]?.key).not.toBe(first.calls[0]?.key);
    expect(m.has(pendingReviewPrefKey(SCOPE, lineId))).toBe(true);
    expect(m.has(pendingReviewPrefKey(OTHER, lineId))).toBe(true);
    expect(reviewPrefKey(SCOPE, lineId)).not.toBe(reviewPrefKey(OTHER, lineId));
    // Paired as her again: her request is still the same one, under its own key.
    const again = scripted(ok("rr_1"));
    await send(body, again.post, SCOPE);
    expect(again.calls[0]?.key).toBe(first.calls[0]?.key);
    // Keys never run into each other across scopes and lines.
    expect(pendingReviewPrefKey("a.b", "c")).not.toBe(pendingReviewPrefKey("a", "b.c"));
  });

  it("sends the body fs-api reads: the line, the slip if one was picked, the note as sent", () => {
    expect(reviewBody(lineId, null, "  ")).toEqual({ lineId });
    expect(reviewBody(lineId, "0403", " Kulang \n ang kilo ")).toEqual({
      lineId,
      slip: "0403",
      note: "Kulang ang kilo",
    });
    expect(reviewDigest(reviewBody(lineId, "0403", "a"))).toMatch(/^[0-9a-f]{64}$/);
    expect(parsePendingReview('{"key":"nope","digest":"00"}')).toBeNull();
    expect(parsePendingReview("{")).toBeNull();
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
