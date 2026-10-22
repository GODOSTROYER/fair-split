import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { contentDigestHeader, createHttpApi } from "../_shims/api-client";
import { nodeSqlite } from "../test/node-sqlite";
import { retryDelayMs } from "./backoff";
import {
  MANUAL_ONLY,
  type NewCapture,
  Outbox,
  type OutboxStore,
  summarise,
  type Uploader,
  type UploadOutcome,
} from "./outbox";
import { MemoryOutboxStore, SqliteOutboxStore } from "./outbox-stores";
import { UUIDV7_RE, uuidv7 } from "./uuidv7";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

function page(sha: string, over: Partial<NewCapture> = {}): NewCapture {
  return {
    sha256: sha,
    fileUri: `file:///captures/${sha.slice(0, 6)}.jpg`,
    thumbUri: null,
    mime: "image/jpeg",
    bytes: 412_000,
    width: 1600,
    height: 1200,
    station: "Purok 2 pickup",
    memberHint: null,
    source: "scanner",
    ...over,
  };
}

function harness(store: OutboxStore, outcomes: UploadOutcome[] = []) {
  let now = 1_761_120_000_000;
  let online = true;
  let seq = 0;
  const calls: { id: string; attempt: number }[] = [];
  const uploader: Uploader = async (rec, onProgress) => {
    calls.push({ id: rec.id, attempt: rec.attempts + 1 });
    onProgress(0.5);
    onProgress(1);
    return (
      outcomes.shift() ?? {
        kind: "ok",
        documentId: `doc-${rec.id}`,
        duplicateOf: null,
        rowsRead: null,
        serial: null,
      }
    );
  };
  const outbox = new Outbox({
    store,
    uploader,
    now: () => now,
    newId: () => uuidv7(now + seq++, (n) => new Uint8Array(n).fill(seq)),
    isOnline: () => online,
  });
  return {
    outbox,
    calls,
    advance: (ms: number) => {
      now += ms;
    },
    setOnline: (v: boolean) => {
      online = v;
    },
  };
}

const stores: [string, () => OutboxStore][] = [
  ["sqlite", () => new SqliteOutboxStore(nodeSqlite())],
  ["memory", () => new MemoryOutboxStore()],
];

describe.each(stores)("outbox on %s", (_name, makeStore) => {
  it("queues captures offline and uploads them in order once online", async () => {
    const h = harness(makeStore());
    await h.outbox.init();
    h.setOnline(false);
    await h.outbox.add(page(SHA_A));
    h.advance(1000);
    await h.outbox.add(page(SHA_B));
    h.advance(1000);
    await h.outbox.add(page(SHA_C));

    const offline = await h.outbox.sync();
    expect(offline).toMatchObject({ attempted: 0, skippedOffline: true });
    expect(summarise(await h.outbox.list())).toMatchObject({ total: 3, onPhone: 3, sent: 0 });

    h.setOnline(true);
    const report = await h.outbox.sync();
    expect(report).toMatchObject({ attempted: 3, uploaded: 3 });
    const list = await h.outbox.list();
    expect(list.map((r) => r.sha256)).toEqual([SHA_C, SHA_B, SHA_A]); // newest first
    expect(h.calls.map((c) => list.find((r) => r.id === c.id)?.sha256)).toEqual([SHA_A, SHA_B, SHA_C]); // oldest first
    expect(list.every((r) => r.state === "uploaded" && r.progress === 1 && r.documentId)).toBe(true);
  });

  it("inv.i7.capture-idempotency: a capture keeps one UUIDv7 Idempotency-Key across every retry", async () => {
    const h = harness(makeStore(), [
      { kind: "retry", error: "network" },
      { kind: "retry", error: "503" },
      { kind: "ok", documentId: "doc-1", duplicateOf: null, rowsRead: 4, serial: "0403" },
    ]);
    await h.outbox.init();
    const added = await h.outbox.add(page(SHA_A));
    if (added.outcome !== "queued") throw new Error("expected queued");
    expect(added.record.id).toMatch(UUIDV7_RE);

    await h.outbox.sync();
    let rec = (await h.outbox.list())[0];
    expect(rec).toMatchObject({ state: "failed", attempts: 1, lastError: "network" });
    // Not due yet: the backoff decides.
    await h.outbox.sync();
    expect(h.calls).toHaveLength(1);

    h.advance(retryDelayMs(1));
    await h.outbox.sync();
    rec = (await h.outbox.list())[0];
    expect(rec).toMatchObject({ state: "failed", attempts: 2 });
    expect(rec?.nextAttemptAt).toBeGreaterThan(0);

    h.advance(retryDelayMs(2));
    await h.outbox.sync();
    rec = (await h.outbox.list())[0];
    expect(rec).toMatchObject({
      state: "read",
      attempts: 3,
      rowsRead: 4,
      serial: "0403",
      documentId: "doc-1",
    });
    expect(new Set(h.calls.map((c) => c.id))).toEqual(new Set([added.record.id]));
  });

  it("inv.i7.same-file-twice: the same bytes are filed once and the second scan reports when it was sent", async () => {
    const h = harness(makeStore());
    await h.outbox.init();
    const first = await h.outbox.add(page(SHA_A));
    await h.outbox.sync();
    const second = await h.outbox.add(page(SHA_A, { fileUri: "file:///captures/again.jpg" }));
    expect(first.outcome).toBe("queued");
    expect(second.outcome).toBe("duplicate-file");
    if (second.outcome === "duplicate-file") {
      expect(second.existing.state).toBe("uploaded");
      expect(second.existing.uploadedAt).not.toBeNull();
    }
    expect(await h.outbox.list()).toHaveLength(1);
    expect(h.calls).toHaveLength(1);
  });

  it("inv.i7.single-flight: concurrent syncs never upload one capture twice", async () => {
    const h = harness(makeStore());
    await h.outbox.init();
    await h.outbox.add(page(SHA_A));
    await h.outbox.add(page(SHA_B));
    const [a, b, c] = await Promise.all([h.outbox.sync(), h.outbox.sync(), h.outbox.sync()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(h.calls.map((x) => x.id).sort()).toEqual([...new Set(h.calls.map((x) => x.id))].sort());
    expect(h.calls).toHaveLength(2);
  });

  it("parks a refused capture until a person sends it again", async () => {
    const h = harness(makeStore(), [{ kind: "reject", error: "IDEMPOTENCY_KEY_REUSED" }]);
    await h.outbox.init();
    const added = await h.outbox.add(page(SHA_A));
    await h.outbox.sync();
    let rec = (await h.outbox.list())[0];
    expect(rec).toMatchObject({ state: "failed", nextAttemptAt: MANUAL_ONLY });
    h.advance(24 * 3600_000);
    await h.outbox.sync();
    expect(h.calls).toHaveLength(1);

    if (added.outcome !== "queued") throw new Error("expected queued");
    await h.outbox.sendNow(added.record.id);
    rec = (await h.outbox.list())[0];
    expect(rec?.state).toBe("uploaded");
    expect(h.calls).toHaveLength(2);
  });

  it("requeues an upload interrupted by the app being killed", async () => {
    const store = makeStore();
    const h = harness(store);
    await h.outbox.init();
    const added = await h.outbox.add(page(SHA_A));
    if (added.outcome !== "queued") throw new Error("expected queued");
    await store.transition(added.record.id, ["queued"], { state: "uploading", progress: 0.4 });

    const h2 = harness(store);
    await h2.outbox.init();
    expect((await h2.outbox.list())[0]).toMatchObject({ state: "queued", progress: 0 });
    await h2.outbox.sync();
    expect(h2.calls[0]?.id).toBe(added.record.id);
  });

  it("marks a capture read when capture.synced arrives", async () => {
    const h = harness(makeStore());
    await h.outbox.init();
    const added = await h.outbox.add(page(SHA_A));
    await h.outbox.sync();
    if (added.outcome !== "queued") throw new Error("expected queued");
    expect(
      await h.outbox.markRead(added.record.id, { documentId: "doc-x", rowsRead: 4, serial: "0457" }),
    ).toBe(true);
    expect((await h.outbox.list())[0]).toMatchObject({ state: "read", rowsRead: 4, serial: "0457" });
  });
});

describe("sqlite schema", () => {
  it("refuses a second row with the same sha256 at the database level", async () => {
    const store = new SqliteOutboxStore(nodeSqlite());
    const h = harness(store);
    await h.outbox.init();
    const a = await h.outbox.add(page(SHA_A));
    if (a.outcome !== "queued") throw new Error("expected queued");
    expect(await store.insert({ ...a.record, id: "0190f0f0-0000-7000-8000-000000000000" })).toBe("duplicate");
  });
});

/* ------------------------------------------------------------------ the HTTP uploader, against msw */

const ORIGIN = "https://fs-api.test";
const seen: { idempotencyKey: string | null; digest: string | null; auth: string | null; bytes: number }[] =
  [];
let mode: "ok" | "unavailable" | "reused" = "ok";

const server = setupServer(
  http.post(`${ORIGIN}/v1/captures`, async ({ request }) => {
    const body = new Uint8Array(await request.arrayBuffer());
    seen.push({
      idempotencyKey: request.headers.get("idempotency-key"),
      digest: request.headers.get("content-digest"),
      auth: request.headers.get("authorization"),
      bytes: body.byteLength,
    });
    if (mode === "unavailable") return new HttpResponse(null, { status: 503 });
    if (mode === "reused") {
      return HttpResponse.json({ error: { code: "IDEMPOTENCY_KEY_REUSED" } }, { status: 422 });
    }
    return HttpResponse.json(
      { documentId: "doc-77", exactDuplicateOf: null, rowsRead: null, serial: null },
      { status: 201 },
    );
  }),
);

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  seen.length = 0;
  mode = "ok";
});
afterAll(() => server.close());

function httpUploader(): Uploader {
  const api = createHttpApi({ origin: ORIGIN, getBearer: () => "dev_token_for_tests" });
  return async (rec) => {
    const r = await api.uploadCapture(
      {
        id: rec.id,
        sha256Hex: rec.sha256,
        bytes: rec.bytes,
        mime: rec.mime,
        capturedAt: new Date(rec.createdAt).toISOString(),
        station: rec.station,
      },
      new Uint8Array(rec.bytes),
    );
    if (r.ok) return { kind: "ok", ...r.value, duplicateOf: r.value.exactDuplicateOf };
    if (r.code === "NETWORK" || (r.status ?? 500) >= 500 || r.status === 429)
      return { kind: "retry", error: r.code };
    return { kind: "reject", error: r.code };
  };
}

describe("capture upload over HTTP (msw)", () => {
  it("inv.i7.capture-headers: sends Idempotency-Key and an RFC 9530 Content-Digest, and retries with the same key", async () => {
    const store = new MemoryOutboxStore();
    let now = 1_761_120_000_000;
    const outbox = new Outbox({
      store,
      uploader: httpUploader(),
      now: () => now,
      newId: () => uuidv7(now, (n) => new Uint8Array(n).fill(7)),
      isOnline: () => true,
    });
    await outbox.init();
    const added = await outbox.add(page(SHA_A, { bytes: 2048 }));
    if (added.outcome !== "queued") throw new Error("expected queued");

    mode = "unavailable";
    await outbox.sync();
    expect((await outbox.list())[0]?.state).toBe("failed");

    mode = "ok";
    now += retryDelayMs(1);
    await outbox.sync();
    expect((await outbox.list())[0]).toMatchObject({ state: "uploaded", documentId: "doc-77" });

    expect(seen).toHaveLength(2);
    for (const s of seen) {
      expect(s.idempotencyKey).toBe(added.record.id);
      expect(s.digest).toBe(contentDigestHeader(SHA_A));
      expect(s.auth).toBe("Bearer dev_token_for_tests");
      expect(s.bytes).toBe(2048);
    }
  });

  it("parks a 422 IDEMPOTENCY_KEY_REUSED instead of retrying forever", async () => {
    mode = "reused";
    const outbox = new Outbox({
      store: new MemoryOutboxStore(),
      uploader: httpUploader(),
      now: () => 1,
      newId: () => uuidv7(1, (n) => new Uint8Array(n).fill(9)),
      isOnline: () => true,
    });
    await outbox.init();
    await outbox.add(page(SHA_B));
    const report = await outbox.sync();
    expect(report.rejected).toBe(1);
    expect((await outbox.list())[0]).toMatchObject({
      state: "failed",
      lastError: "IDEMPOTENCY_KEY_REUSED",
      nextAttemptAt: MANUAL_ONLY,
    });
  });
});

describe("uuidv7", () => {
  it("is time-ordered and carries version 7 and the RFC 9562 variant", () => {
    const a = uuidv7(1_761_120_000_000, (n) => new Uint8Array(n).fill(255));
    const b = uuidv7(1_761_120_000_001, (n) => new Uint8Array(n).fill(0));
    expect(a).toMatch(UUIDV7_RE);
    expect(b).toMatch(UUIDV7_RE);
    expect(a < b).toBe(true);
  });
});
