import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { contentDigestHeader, type FairSplitApi } from "../../_shims/api-client";
import { MANUAL_ONLY, type NadawatMeta, type NewCapture, Outbox } from "../../lib/outbox";
import { MemoryOutboxStore } from "../../lib/outbox-stores";
import { uuidv7 } from "../../lib/uuidv7";
import { createUploader } from "../../platform/uploader.web";
import {
  cashReceiptPath,
  headerJson,
  headerLookup,
  interpretUpload,
  originOf,
  uploadRequest,
} from "./upload-protocol";

const ORIGIN = "https://fs-api.test";
const NOW = Date.parse("2026-10-30T01:00:00Z");
const none = () => null;

/* ------------------------------------------------------------------ reading answers */

describe("interpretUpload", () => {
  it("reads a 201 for a page, keeping only well-formed fields", () => {
    expect(
      interpretUpload(
        "slip",
        201,
        JSON.stringify({ documentId: "doc-1", exactDuplicateOf: null, rowsRead: 4, serial: "0403" }),
        none,
        NOW,
      ),
    ).toEqual({ kind: "ok", documentId: "doc-1", duplicateOf: null, rowsRead: 4, serial: "0403" });
    expect(
      interpretUpload("slip", 200, JSON.stringify({ documentId: "d", rowsRead: -2, serial: 403 }), none, NOW),
    ).toEqual({ kind: "ok", documentId: "d", duplicateOf: null, rowsRead: null, serial: null });
  });

  it("reads a 201 for a cash receipt", () => {
    expect(interpretUpload("nadawat", 201, JSON.stringify({ receiptId: "rc-9" }), none, NOW)).toEqual({
      kind: "ok",
      documentId: "rc-9",
      duplicateOf: null,
      rowsRead: null,
      serial: null,
    });
  });

  it("retries a captive portal or proxy instead of believing its 200", () => {
    expect(interpretUpload("slip", 200, "<html>Log in to Purok WiFi</html>", none, NOW)).toEqual({
      kind: "retry",
      error: "NOT_OUR_SERVER",
    });
    expect(interpretUpload("slip", 302, "", none, NOW)).toEqual({ kind: "retry", error: "NOT_OUR_SERVER" });
    expect(interpretUpload("slip", 201, JSON.stringify({ ok: true }), none, NOW)).toEqual({
      kind: "retry",
      error: "BAD_RESPONSE",
    });
  });

  it("retries transient answers with the server's Retry-After", () => {
    const after = headerLookup({ "Retry-After": "120" });
    expect(interpretUpload("slip", 429, "", after, NOW)).toEqual({
      kind: "retry",
      error: "429",
      retryAfterMs: 120_000,
    });
    for (const s of [408, 425, 500, 502, 503, 504, 599]) {
      expect(interpretUpload("slip", s, "", none, NOW)).toMatchObject({ kind: "retry", error: String(s) });
    }
    expect(interpretUpload("slip", 0, "", none, NOW)).toEqual({ kind: "retry", error: "NETWORK" });
  });

  it("parks a refusal with the co-op's own code, or a named one", () => {
    const reused = JSON.stringify({ error: { code: "IDEMPOTENCY_KEY_REUSED" } });
    expect(interpretUpload("slip", 422, reused, none, NOW)).toEqual({
      kind: "reject",
      error: "IDEMPOTENCY_KEY_REUSED",
    });
    expect(interpretUpload("slip", 401, "", none, NOW)).toEqual({ kind: "reject", error: "UNAUTHENTICATED" });
    expect(interpretUpload("slip", 403, "nope", none, NOW)).toEqual({ kind: "reject", error: "FORBIDDEN" });
    expect(interpretUpload("slip", 413, "", none, NOW)).toEqual({ kind: "reject", error: "TOO_LARGE" });
    expect(interpretUpload("nadawat", 409, "", none, NOW)).toEqual({ kind: "reject", error: "409" });
  });
});

describe("uploadRequest", () => {
  it("escapes every non-ASCII character in header JSON", () => {
    const h = headerJson({ name: "Teodoro Pacaña", peso: "₱7,990.00" });
    expect(h).toMatch(/^[\x20-\x7e]+$/);
    expect(JSON.parse(h)).toEqual({ name: "Teodoro Pacaña", peso: "₱7,990.00" });
  });

  it("derives the origin from the published capture URL", () => {
    expect(originOf(`${ORIGIN}/v1/captures`)).toBe(ORIGIN);
    expect(cashReceiptPath("line/1 2")).toBe("/v1/lines/line%2F1%202/cash-receipt");
  });
});

/* ------------------------------------------------------------------ the web uploader against msw */

interface Seen {
  path: string;
  key: string | null;
  digest: string | null;
  auth: string | null;
  type: string | null;
  meta: Record<string, unknown> | null;
  receipt: Record<string, unknown> | null;
  bodySha: string;
}

const seen: Seen[] = [];
let answer: (s: Seen) => Response = () =>
  HttpResponse.json(
    { documentId: "doc-77", exactDuplicateOf: null, rowsRead: null, serial: null },
    { status: 201 },
  );

async function record(request: Request, path: string): Promise<Seen> {
  const body = new Uint8Array(await request.arrayBuffer());
  const json = (h: string | null) => (h ? (JSON.parse(h) as Record<string, unknown>) : null);
  const s: Seen = {
    path,
    key: request.headers.get("idempotency-key"),
    digest: request.headers.get("content-digest"),
    auth: request.headers.get("authorization"),
    type: request.headers.get("content-type"),
    meta: json(request.headers.get("x-capture-meta")),
    receipt: json(request.headers.get("x-cash-receipt")),
    bodySha: bytesToHex(sha256(body)),
  };
  seen.push(s);
  return s;
}

const server = setupServer(
  http.post(`${ORIGIN}/v1/captures`, async ({ request }) => {
    const s = await record(request, "/v1/captures");
    // fs-api checks the digest against the bytes it received (RFC 9530), as the real one does.
    if (s.digest !== contentDigestHeader(s.bodySha)) return HttpResponse.json({}, { status: 400 });
    return answer(s);
  }),
  http.post(`${ORIGIN}/v1/lines/:lineId/cash-receipt`, async ({ request, params }) => {
    const s = await record(request, `/v1/lines/${String(params.lineId)}/cash-receipt`);
    if (s.digest !== contentDigestHeader(s.bodySha)) return HttpResponse.json({}, { status: 400 });
    return HttpResponse.json({ receiptId: "rc-1" }, { status: 201 });
  }),
  http.get(`${ORIGIN}/missing.jpg`, () => new HttpResponse(null, { status: 404 })),
);

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  seen.length = 0;
  answer = () =>
    HttpResponse.json(
      { documentId: "doc-77", exactDuplicateOf: null, rowsRead: null, serial: null },
      { status: 201 },
    );
});
afterAll(() => server.close());

const api = { mode: "live", captureUrl: () => `${ORIGIN}/v1/captures` } as unknown as FairSplitApi;

function jpeg(seed: number): { uri: string; sha: string; bytes: number } {
  const bytes = new Uint8Array(2048).map((_, i) => (i * 31 + seed) & 0xff);
  return {
    uri: `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`,
    sha: bytesToHex(sha256(bytes)),
    bytes: bytes.length,
  };
}

function capture(seed: number, over: Partial<NewCapture> = {}): NewCapture {
  const f = jpeg(seed);
  return {
    sha256: f.sha,
    fileUri: f.uri,
    thumbUri: null,
    mime: "image/jpeg",
    bytes: f.bytes,
    width: 1600,
    height: 1200,
    station: "Purok 2 pickup",
    memberHint: "M-014",
    source: "scanner",
    ...over,
  } as NewCapture;
}

function engine(now: { t: number }) {
  return new Outbox({
    store: new MemoryOutboxStore(),
    uploader: createUploader({ api, getBearer: () => "dev_token_for_tests", now: () => now.t }),
    now: () => now.t,
    newId: () => uuidv7(now.t, (n) => new Uint8Array(n).fill(7)),
    isOnline: () => true,
  });
}

describe("capture upload over HTTP (msw)", () => {
  it("inv.i7.capture-headers: Idempotency-Key and an RFC 9530 Content-Digest, the same on every retry", async () => {
    const now = { t: NOW };
    const outbox = engine(now);
    await outbox.init();
    const added = await outbox.add(capture(1));
    if (added.outcome !== "queued") throw new Error("expected queued");

    answer = () => new HttpResponse(null, { status: 503 });
    await outbox.sync();
    expect((await outbox.list())[0]).toMatchObject({ state: "failed", lastError: "503" });

    answer = () =>
      HttpResponse.json(
        { documentId: "doc-77", exactDuplicateOf: null, rowsRead: null, serial: null },
        { status: 201 },
      );
    now.t += 10_000;
    await outbox.sync();
    expect((await outbox.list())[0]).toMatchObject({ state: "uploaded", documentId: "doc-77" });

    expect(seen).toHaveLength(2);
    for (const s of seen) {
      expect(s).toMatchObject({
        path: "/v1/captures",
        key: added.record.id,
        digest: contentDigestHeader(added.record.sha256),
        auth: "Bearer dev_token_for_tests",
        type: "image/jpeg",
        bodySha: added.record.sha256,
      });
      expect(s.meta).toEqual({
        capturedAt: new Date(NOW).toISOString(),
        station: "Purok 2 pickup",
        memberHint: "M-014",
        bytes: 2048,
        source: "scanner",
      });
    }
  });

  it("files a cash receipt against its line, with the attestation and without the member's name", async () => {
    const outbox = engine({ t: NOW });
    await outbox.init();
    const meta: NadawatMeta = {
      lineId: "line_2026A_r37_M-053",
      memberNo: "M-053",
      memberName: "Merlyn Ponce",
      cents: 12784,
      phpPerUsd: "62.50",
      attestedBy: "JD",
    };
    const added = await outbox.add({ ...capture(2), kind: "nadawat", nadawat: meta, source: "camera" });
    if (added.outcome !== "queued") throw new Error("expected queued");
    await outbox.sync();
    expect((await outbox.list())[0]).toMatchObject({ state: "uploaded", documentId: "rc-1" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      path: "/v1/lines/line_2026A_r37_M-053/cash-receipt",
      key: added.record.id,
    });
    expect(seen[0]?.receipt).toEqual({
      attestedAt: new Date(NOW).toISOString(),
      memberNo: "M-053",
      cents: 12784,
      phpPerUsd: "62.50",
      attestedBy: "JD",
      station: "Purok 2 pickup",
      bytes: 2048,
    });
    expect(JSON.stringify(seen[0])).not.toContain("Merlyn");
  });

  it("waits as long as a 429's Retry-After asks", async () => {
    const now = { t: NOW };
    const outbox = engine(now);
    await outbox.init();
    await outbox.add(capture(3));
    answer = () => new HttpResponse(null, { status: 429, headers: { "Retry-After": "120" } });
    await outbox.sync();
    expect((await outbox.list())[0]).toMatchObject({ state: "failed", nextAttemptAt: NOW + 120_000 });
  });

  it("parks a 422 IDEMPOTENCY_KEY_REUSED instead of retrying forever", async () => {
    const outbox = engine({ t: NOW });
    await outbox.init();
    await outbox.add(capture(4));
    answer = () => HttpResponse.json({ error: { code: "IDEMPOTENCY_KEY_REUSED" } }, { status: 422 });
    expect(await outbox.sync()).toMatchObject({ rejected: 1 });
    expect((await outbox.list())[0]).toMatchObject({
      state: "failed",
      lastError: "IDEMPOTENCY_KEY_REUSED",
      nextAttemptAt: MANUAL_ONLY,
    });
  });

  it("does not believe a captive portal's 200", async () => {
    const outbox = engine({ t: NOW });
    await outbox.init();
    await outbox.add(capture(5));
    answer = () =>
      new HttpResponse("<html>Log in</html>", { status: 200, headers: { "Content-Type": "text/html" } });
    expect(await outbox.sync()).toMatchObject({ retrying: 1 });
    expect((await outbox.list())[0]).toMatchObject({ state: "failed", lastError: "NOT_OUR_SERVER" });
  });

  it("keeps a capture whose photo is gone, waiting for a person, instead of retrying it forever", async () => {
    const outbox = engine({ t: NOW });
    await outbox.init();
    await outbox.add(capture(6, { fileUri: `${ORIGIN}/missing.jpg` }));
    await outbox.sync();
    expect((await outbox.list())[0]).toMatchObject({
      state: "failed",
      lastError: "FILE_MISSING",
      nextAttemptAt: MANUAL_ONLY,
    });
    expect(seen).toHaveLength(0);
  });

  it("builds identical requests for the native and web paths", () => {
    const rec = {
      ...capture(7),
      kind: "slip" as const,
      nadawat: null,
      id: "0190f0f0-0000-7000-8000-000000000001",
      createdAt: NOW,
      state: "queued" as const,
      attempts: 0,
      nextAttemptAt: NOW,
      lastError: null,
      progress: 0,
      documentId: null,
      duplicateOf: null,
      rowsRead: null,
      serial: null,
      uploadedAt: null,
    };
    const req = uploadRequest(rec, `${ORIGIN}/`, null);
    expect(req.url).toBe(`${ORIGIN}/v1/captures`);
    expect(req.headers.Authorization).toBeUndefined();
    expect(Object.values(req.headers).every((v) => /^[\x20-\x7e]*$/.test(v))).toBe(true);
  });
});
