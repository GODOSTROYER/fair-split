import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { nodeSqlite } from "../test/node-sqlite";
import { retryDelayMs } from "./backoff";
import {
  AUTH_REFUSALS,
  assertNewCapture,
  CAPTURE_STATE_RANK,
  type CaptureRecord,
  FINAL_REFUSALS,
  isFinalRefusal,
  isRefused,
  isSameManilaDay,
  KEEP_SETTLED_MS,
  MANUAL_ONLY,
  manilaDay,
  type NadawatMeta,
  type NewCapture,
  nextWakeAt,
  Outbox,
  type OutboxStore,
  resendOf,
  summarise,
  type Uploader,
  type UploadOutcome,
} from "./outbox";
import { MemoryOutboxStore, OUTBOX_SCHEMA_VERSION, SqliteOutboxStore } from "./outbox-stores";
import { UUIDV7_RE, uuidv7 } from "./uuidv7";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const T0 = Date.parse("2026-10-27T01:00:00Z"); // 09:00 in Calinan

function page(sha: string, over: Partial<NewCapture> = {}): NewCapture {
  return {
    sha256: sha,
    fileUri: `file:///captures/${sha.slice(0, 6)}.jpg`,
    thumbUri: `file:///captures/${sha.slice(0, 6)}-thumb.jpg`,
    mime: "image/jpeg",
    bytes: 412_000,
    width: 1600,
    height: 1200,
    station: "Purok 2 pickup",
    memberHint: null,
    source: "scanner",
    ...over,
  } as NewCapture;
}

const MERLYN: NadawatMeta = {
  lineId: "line_2026A_r37_M-053",
  memberNo: "M-053",
  memberName: "Merlyn Ponce",
  cents: 12784,
  phpPerUsd: "62.50",
  attestedBy: "JD",
};

function receipt(sha: string, meta: NadawatMeta = MERLYN): NewCapture {
  return { ...page(sha), kind: "nadawat", nadawat: meta, source: "camera" };
}

const ok = (over: Partial<Extract<UploadOutcome, { kind: "ok" }>> = {}): UploadOutcome => ({
  kind: "ok",
  documentId: "doc",
  duplicateOf: null,
  rowsRead: null,
  serial: null,
  ...over,
});

interface Harness {
  outbox: Outbox;
  store: OutboxStore;
  calls: { id: string; sha: string; attempt: number }[];
  deleted: string[];
  changes: () => number;
  advance(ms: number): void;
  setOnline(v: boolean): void;
  now(): number;
}

function harness(
  store: OutboxStore,
  script: (UploadOutcome | ((rec: CaptureRecord) => Promise<UploadOutcome>))[] = [],
  opts: { progress?: number[] } = {},
): Harness {
  let now = T0;
  let online = true;
  let seq = 0;
  let changes = 0;
  const calls: Harness["calls"] = [];
  const deleted: string[] = [];
  const uploader: Uploader = async (rec, onProgress) => {
    calls.push({ id: rec.id, sha: rec.sha256, attempt: rec.attempts + 1 });
    for (const p of opts.progress ?? [0.5, 1]) onProgress(p);
    const next = script.shift();
    if (typeof next === "function") return next(rec);
    return next ?? ok({ documentId: `doc-${rec.id.slice(-4)}` });
  };
  const outbox = new Outbox({
    store,
    uploader,
    now: () => now,
    newId: () => uuidv7(now + seq++, (n) => new Uint8Array(n).fill(seq & 0xff)),
    isOnline: () => online,
    onChange: () => {
      changes++;
    },
    deleteFile: (uri) => {
      deleted.push(uri);
    },
  });
  return {
    outbox,
    store,
    calls,
    deleted,
    changes: () => changes,
    advance: (ms) => {
      now += ms;
    },
    setOnline: (v) => {
      online = v;
    },
    now: () => now,
  };
}

const stores: [string, () => OutboxStore][] = [
  ["sqlite", () => new SqliteOutboxStore(nodeSqlite())],
  ["memory", () => new MemoryOutboxStore()],
];

async function only(h: Harness): Promise<CaptureRecord> {
  const [r] = await h.outbox.list();
  if (!r) throw new Error("no capture");
  return r;
}

function queued(r: Awaited<ReturnType<Outbox["add"]>>): CaptureRecord {
  if (r.outcome !== "queued") throw new Error(`expected queued, got ${r.outcome}`);
  return r.record;
}

describe.each(stores)("outbox on %s", (_name, makeStore) => {
  it("files captures offline and uploads them oldest first once online", async () => {
    const h = harness(makeStore());
    await h.outbox.init();
    h.setOnline(false);
    for (const sha of [SHA_A, SHA_B, SHA_C]) {
      await h.outbox.add(page(sha));
      h.advance(1000);
    }
    const offline = await h.outbox.sync();
    expect(offline).toMatchObject({ attempted: 0, skippedOffline: true });
    expect(summarise(await h.outbox.list())).toMatchObject({ total: 3, onPhone: 3, queued: 3, sent: 0 });

    h.setOnline(true);
    expect(await h.outbox.sync()).toMatchObject({ attempted: 3, uploaded: 3, skippedOffline: false });
    const list = await h.outbox.list();
    expect(list.map((r) => r.sha256)).toEqual([SHA_C, SHA_B, SHA_A]); // newest first
    expect(h.calls.map((c) => c.sha)).toEqual([SHA_A, SHA_B, SHA_C]); // oldest first
    expect(list.every((r) => r.state === "uploaded" && r.progress === 1 && r.documentId)).toBe(true);
    expect(summarise(list)).toMatchObject({ onPhone: 0, sent: 3, uploaded: 3 });
  });

  it("inv.i7.capture-idempotency: one UUIDv7 Idempotency-Key across every retry", async () => {
    const h = harness(makeStore(), [
      { kind: "retry", error: "NETWORK" },
      { kind: "retry", error: "503" },
      ok({ documentId: "doc-1", rowsRead: 4, serial: "0403" }),
    ]);
    await h.outbox.init();
    const rec = queued(await h.outbox.add(page(SHA_A)));
    expect(rec.id).toMatch(UUIDV7_RE);

    await h.outbox.sync();
    expect(await only(h)).toMatchObject({ state: "failed", attempts: 1, lastError: "NETWORK" });
    await h.outbox.sync(); // not due yet: the backoff decides
    expect(h.calls).toHaveLength(1);

    h.advance(retryDelayMs(1));
    await h.outbox.sync();
    expect(await only(h)).toMatchObject({ state: "failed", attempts: 2, nextAttemptAt: h.now() + 20_000 });

    h.advance(retryDelayMs(2));
    await h.outbox.sync();
    expect(await only(h)).toMatchObject({
      state: "read",
      attempts: 3,
      rowsRead: 4,
      serial: "0403",
      documentId: "doc-1",
    });
    expect(new Set(h.calls.map((c) => c.id))).toEqual(new Set([rec.id]));
    expect(h.calls.map((c) => c.attempt)).toEqual([1, 2, 3]);
  });

  it("honours a server's Retry-After when it asks for longer than the backoff", async () => {
    const h = harness(makeStore(), [{ kind: "retry", error: "429", retryAfterMs: 90_000 }]);
    await h.outbox.init();
    await h.outbox.add(page(SHA_A));
    await h.outbox.sync();
    const r = await only(h);
    expect(r.nextAttemptAt).toBe(h.now() + 90_000);
    expect(nextWakeAt([r], h.now())).toBe(h.now() + 90_000);
  });

  it("stops the pass on a retry and moves on after a refusal", async () => {
    const h = harness(makeStore(), [
      { kind: "reject", error: "413" },
      ok(),
      { kind: "retry", error: "NETWORK" },
    ]);
    await h.outbox.init();
    for (const sha of [SHA_A, SHA_B, SHA_C, SHA_D]) {
      await h.outbox.add(page(sha));
      h.advance(10);
    }
    const report = await h.outbox.sync();
    expect(report).toMatchObject({ attempted: 3, uploaded: 1, rejected: 1, retrying: 1 });
    expect(h.calls.map((c) => c.sha)).toEqual([SHA_A, SHA_B, SHA_C]); // D waits for the next pass
    expect(summarise(await h.outbox.list())).toMatchObject({
      refused: 1,
      retrying: 1,
      queued: 1,
      uploaded: 1,
    });
  });

  it("treats an uploader that throws as a retry, never a lost capture", async () => {
    const h = harness(makeStore(), [
      async () => {
        throw new Error("socket closed");
      },
    ]);
    await h.outbox.init();
    await h.outbox.add(page(SHA_A));
    await h.outbox.sync();
    expect(await only(h)).toMatchObject({ state: "failed", lastError: "socket closed", attempts: 1 });
  });

  it("inv.i7.same-file-twice: the same bytes are filed once and the second scan says when", async () => {
    const h = harness(makeStore());
    await h.outbox.init();
    const first = await h.outbox.add(page(SHA_A));
    await h.outbox.sync();
    const second = await h.outbox.add(page(SHA_A, { fileUri: "file:///captures/again.jpg" }));
    expect(first.outcome).toBe("queued");
    expect(second.outcome).toBe("duplicate-file");
    if (second.outcome === "duplicate-file") {
      expect(second.existing.state).toBe("uploaded");
      expect(second.existing.uploadedAt).toBe(T0);
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
    expect(h.calls).toHaveLength(2);
    expect(new Set(h.calls.map((x) => x.id)).size).toBe(2);
  });

  it("a sync requested mid-run gets one more pass for captures filed meanwhile", async () => {
    let release: (() => void) | null = null;
    const h = harness(makeStore(), [
      () =>
        new Promise<UploadOutcome>((res) => {
          release = () => res(ok());
        }),
    ]);
    await h.outbox.init();
    await h.outbox.add(page(SHA_A));
    const run = h.outbox.sync();
    await new Promise((r) => setTimeout(r, 0));
    h.advance(5);
    await h.outbox.add(page(SHA_B));
    const again = h.outbox.sync();
    expect(again).toBe(run);
    (release as (() => void) | null)?.();
    expect(await run).toMatchObject({ attempted: 2, uploaded: 2 });
  });

  it("parks a refused capture until a person sends it again, under a new key", async () => {
    const h = harness(makeStore(), [{ kind: "reject", error: "IDEMPOTENCY_KEY_REUSED" }]);
    await h.outbox.init();
    const rec = queued(await h.outbox.add(page(SHA_A)));
    await h.outbox.sync();
    expect(await only(h)).toMatchObject({ state: "failed", nextAttemptAt: MANUAL_ONLY });
    expect(summarise(await h.outbox.list())).toMatchObject({ refused: 1, onPhone: 1 });
    expect(nextWakeAt(await h.outbox.list(), h.now())).toBeNull();
    h.advance(24 * 3600_000);
    await h.outbox.sync();
    expect(h.calls).toHaveLength(1);

    await h.outbox.sendNow(rec.id);
    const sent = await only(h);
    expect(sent).toMatchObject({ state: "uploaded", sha256: SHA_A, createdAt: rec.createdAt, attempts: 1 });
    expect(h.calls).toHaveLength(2);
    // fs-api would replay its stored refusal for the old key (S3.10): the resend is a new request.
    expect(h.calls[1]?.id).not.toBe(rec.id);
    expect(sent.id).toBe(h.calls[1]?.id);
    expect(sent.id).toMatch(UUIDV7_RE);
    expect(await h.store.get(rec.id)).toBeNull();
  });

  it("inv.i7.resend: a retry keeps its key; only a refusal a resend can fix gets a new one", async () => {
    const h = harness(makeStore(), [
      { kind: "retry", error: "503" },
      { kind: "reject", error: "UNAUTHENTICATED" },
      ok(),
    ]);
    await h.outbox.init();
    const rec = queued(await h.outbox.add(page(SHA_A)));
    await h.outbox.sync(); // 503: backing off
    await h.outbox.sendNow(rec.id); // the person does not wait for the timer: same request, same key
    expect(h.calls.map((c) => c.id)).toEqual([rec.id, rec.id]);
    const refused = await only(h);
    expect(refused).toMatchObject({ id: rec.id, lastError: "UNAUTHENTICATED", nextAttemptAt: MANUAL_ONLY });
    await h.outbox.sendNow(rec.id);
    expect(h.calls).toHaveLength(3);
    expect(h.calls[2]?.id).not.toBe(rec.id);
    expect(h.calls[2]?.attempt).toBe(1); // a new request starts its own count
    expect(await only(h)).toMatchObject({ state: "uploaded", id: h.calls[2]?.id });
  });

  it("never resends a refusal no resend can fix; the clerk files again or removes it", async () => {
    const codes = [...FINAL_REFUSALS, "LINE_NOT_DUE", "LINE_HELD"];
    const h = harness(
      makeStore(),
      codes.map((error) => ({ kind: "reject", error })),
    );
    await h.outbox.init();
    for (const [i] of codes.entries()) {
      await h.outbox.add(page(String.fromCharCode(97 + i).repeat(64)));
      h.advance(10);
    }
    await h.outbox.sync();
    expect(summarise(await h.outbox.list())).toMatchObject({ refused: codes.length });
    for (const r of await h.outbox.list()) await h.outbox.sendNow(r.id);
    await h.outbox.sendAll();
    await h.outbox.afterPairing();
    expect(h.calls).toHaveLength(codes.length); // not one of them went again
    expect(summarise(await h.outbox.list())).toMatchObject({ refused: codes.length });
  });

  it("sends everything waiting at once: refused and backing-off captures alike", async () => {
    const h = harness(makeStore(), [
      { kind: "reject", error: "UNAUTHENTICATED" },
      ok(),
      { kind: "retry", error: "NETWORK" },
    ]);
    await h.outbox.init();
    await h.outbox.add(page(SHA_A));
    h.advance(10);
    await h.outbox.add(page(SHA_B));
    await h.outbox.sync(); // A refused, B uploaded
    h.advance(10);
    await h.outbox.add(page(SHA_C));
    await h.outbox.sync(); // C backing off
    expect(summarise(await h.outbox.list())).toMatchObject({ refused: 1, retrying: 1, uploaded: 1 });
    const report = await h.outbox.sendAll();
    expect(report).toMatchObject({ uploaded: 2 });
    expect(summarise(await h.outbox.list())).toMatchObject({ onPhone: 0, uploaded: 3 });
  });

  it("sends what the old pairing had refused once the phone is paired again, and nothing else", async () => {
    const h = harness(makeStore(), [
      { kind: "reject", error: "UNAUTHENTICATED" },
      { kind: "reject", error: "422" },
      { kind: "reject", error: "FORBIDDEN" },
    ]);
    await h.outbox.init();
    for (const sha of [SHA_A, SHA_B, SHA_C]) {
      await h.outbox.add(page(sha));
      h.advance(10);
    }
    await h.outbox.sync();
    expect(summarise(await h.outbox.list())).toMatchObject({ refused: 3 });
    expect(await h.outbox.afterPairing()).toMatchObject({ attempted: 2, uploaded: 2 });
    const list = await h.outbox.list();
    expect(list.find((r) => r.sha256 === SHA_B)).toMatchObject({ lastError: "422" }); // waits for a person
    expect(
      list
        .filter((r) => r.state === "uploaded")
        .map((r) => r.sha256)
        .sort(),
    ).toEqual([SHA_A, SHA_C]);
  });

  it("removes a capture from the phone only while the co-op's refusal holds it", async () => {
    const h = harness(makeStore(), [{ kind: "reject", error: "TOO_LARGE" }, ok()]);
    await h.outbox.init();
    h.setOnline(false);
    const big = queued(await h.outbox.add(page(SHA_A)));
    h.advance(10);
    const fine = queued(await h.outbox.add(page(SHA_B)));
    expect(await h.outbox.discard(big.id)).toBe(false); // waiting on the phone: never removed this way
    h.setOnline(true);
    await h.outbox.sync(); // A refused, B at the co-op
    h.setOnline(false);
    h.advance(10);
    const waiting = queued(await h.outbox.add(page(SHA_C)));
    const before = h.changes();
    expect(await h.outbox.discard(fine.id)).toBe(false); // at the co-op
    expect(await h.outbox.discard(waiting.id)).toBe(false); // on its way
    expect(await h.outbox.discard(big.id)).toBe(true);
    expect(await h.outbox.discard(big.id)).toBe(false); // already gone
    expect(h.changes()).toBe(before + 1);
    expect((await h.outbox.list()).map((r) => r.id).sort()).toEqual([fine.id, waiting.id].sort());
    expect(h.deleted).toEqual([big.fileUri, big.thumbUri]);
    expect(summarise(await h.outbox.list())).toMatchObject({ refused: 0, onPhone: 1, uploaded: 1 });
  });

  it("files a refused page again over its own bytes, under a new id", async () => {
    const h = harness(makeStore(), [{ kind: "reject", error: "FILE_MISSING" }]);
    await h.outbox.init();
    const lost = queued(await h.outbox.add(page(SHA_A)));
    await h.outbox.sync();
    h.advance(1000);
    const again = await h.outbox.add(page(SHA_A, { fileUri: "file:///captures/picked-again.jpg" }));
    expect(again.outcome).toBe("queued");
    if (again.outcome !== "queued") return;
    expect(again.replaced?.id).toBe(lost.id);
    expect(again.record.id).not.toBe(lost.id);
    expect(await h.outbox.list()).toHaveLength(1);
    // A receipt is never filed over a refused page that happens to share its bytes.
    expect((await h.outbox.add(receipt(SHA_A))).outcome).toBe("duplicate-file");
  });

  it("sends everything waiting at once: refused and backing-off captures alike", async () => {
    const h = harness(makeStore(), [
      { kind: "reject", error: "UNAUTHENTICATED" },
      ok(),
      { kind: "retry", error: "NETWORK" },
    ]);
    await h.outbox.init();
    await h.outbox.add(page(SHA_A));
    h.advance(10);
    await h.outbox.add(page(SHA_B));
    await h.outbox.sync(); // A refused, B uploaded
    h.advance(10);
    await h.outbox.add(page(SHA_C));
    await h.outbox.sync(); // C backing off
    expect(summarise(await h.outbox.list())).toMatchObject({ refused: 1, retrying: 1, uploaded: 1 });
    const report = await h.outbox.sendAll();
    expect(report).toMatchObject({ uploaded: 2 });
    expect(summarise(await h.outbox.list())).toMatchObject({ onPhone: 0, uploaded: 3 });
  });

  it("requeues an upload interrupted by the app being killed", async () => {
    const store = makeStore();
    const h = harness(store);
    await h.outbox.init();
    const rec = queued(await h.outbox.add(page(SHA_A)));
    await store.transition(rec.id, ["queued"], { state: "uploading", progress: 0.4 });

    const h2 = harness(store);
    await h2.outbox.init();
    expect(await only(h2)).toMatchObject({ state: "queued", progress: 0 });
    await h2.outbox.sync();
    expect(h2.calls[0]?.id).toBe(rec.id);
  });

  it("marks a page read when capture.synced arrives, once", async () => {
    const h = harness(makeStore());
    await h.outbox.init();
    const rec = queued(await h.outbox.add(page(SHA_A)));
    await h.outbox.sync();
    const info = { documentId: "doc-x", rowsRead: 4, serial: "0457" };
    expect(await h.outbox.markRead(rec.id, info)).toBe(true);
    expect(await h.outbox.markRead(rec.id, info)).toBe(false); // redelivered: already applied
    expect(await h.outbox.markRead("0190f0f0-0000-7000-8000-000000000000", info)).toBe(false); // another phone's
    expect(await only(h)).toMatchObject({ state: "read", rowsRead: 4, serial: "0457" });
  });

  it("inv.i5.capture-forward: a read that beats the 201 stays read", async () => {
    let id = "";
    const h = harness(makeStore(), [
      async () => {
        // capture.synced lands while the 201 is still on its way.
        await h.outbox.markRead(id, { documentId: "doc-9", rowsRead: 3, serial: "0410" });
        return ok({ documentId: "doc-9", rowsRead: null });
      },
    ]);
    await h.outbox.init();
    id = queued(await h.outbox.add(page(SHA_A))).id;
    await h.outbox.sync();
    expect(await only(h)).toMatchObject({
      state: "read",
      rowsRead: 3,
      serial: "0410",
      attempts: 1,
      uploadedAt: T0,
      progress: 1,
    });
  });

  it("inv.i5.capture-forward: a retry outcome cannot pull a read capture back into the queue", async () => {
    let id = "";
    const h = harness(makeStore(), [
      async () => {
        await h.outbox.markRead(id, { documentId: "doc-9", rowsRead: 2 });
        return { kind: "retry", error: "NETWORK" };
      },
    ]);
    await h.outbox.init();
    id = queued(await h.outbox.add(page(SHA_A))).id;
    await h.outbox.sync();
    expect((await only(h)).state).toBe("read");
    h.advance(MANUAL_ONLY / 2);
    await h.outbox.sync();
    expect(h.calls).toHaveLength(1);
  });

  it("writes progress in order, clamped and never backwards, and none after the outcome", async () => {
    const seen: number[] = [];
    const store = makeStore();
    const h = harness(store, [], { progress: [0.05, 0.3, 0.2, 0.31, 0.75, 7, Number.NaN] });
    const original = store.transition.bind(store);
    store.transition = async (id, from, patch) => {
      if (patch.progress !== undefined && patch.state === undefined) seen.push(patch.progress);
      return original(id, from, patch);
    };
    await h.outbox.init();
    await h.outbox.add(page(SHA_A));
    await h.outbox.sync();
    expect(seen).toEqual([0.3, 0.75, 1]);
    expect(await only(h)).toMatchObject({ state: "uploaded", progress: 1 });
  });

  describe("cash receipts (Nadawat)", () => {
    it("files one receipt per member line, and says so the second time", async () => {
      const h = harness(makeStore());
      await h.outbox.init();
      const first = await h.outbox.add(receipt(SHA_A));
      const again = await h.outbox.add(receipt(SHA_B));
      expect(first.outcome).toBe("queued");
      expect(again.outcome).toBe("already-attested");
      if (first.outcome === "queued")
        expect(first.record).toMatchObject({ kind: "nadawat", nadawat: MERLYN });
      const other = await h.outbox.add(receipt(SHA_C, { ...MERLYN, lineId: "line_2026A_r37_M-031" }));
      expect(other.outcome).toBe("queued");
    });

    it("uploads receipts before pages, whatever their age", async () => {
      const h = harness(makeStore());
      await h.outbox.init();
      h.setOnline(false);
      await h.outbox.add(page(SHA_A));
      h.advance(1000);
      await h.outbox.add(page(SHA_B));
      h.advance(1000);
      await h.outbox.add(receipt(SHA_C));
      h.setOnline(true);
      await h.outbox.sync();
      expect(h.calls.map((c) => c.sha)).toEqual([SHA_C, SHA_A, SHA_B]);
    });

    it("a refused receipt never dead-ends the line: attesting it again files a new receipt", async () => {
      const h = harness(makeStore(), [{ kind: "reject", error: "AMOUNT_CHANGED" }]);
      await h.outbox.init();
      const first = queued(await h.outbox.add(receipt(SHA_A)));
      await h.outbox.sync();
      expect(await h.store.findNadawat(MERLYN.lineId)).toMatchObject({ id: first.id, state: "failed" });

      h.advance(60_000);
      const fresh = { ...MERLYN, cents: 12_800, phpPerUsd: "62.40" }; // the co-op's current figures
      const again = await h.outbox.add(receipt(SHA_B, fresh));
      expect(again.outcome).toBe("queued");
      if (again.outcome !== "queued") return;
      expect(again.record).toMatchObject({ state: "queued", nadawat: fresh, createdAt: h.now() });
      expect(again.record.id).not.toBe(first.id);
      expect(again.replaced).toMatchObject({ id: first.id, lastError: "AMOUNT_CHANGED" });
      expect(await h.outbox.list()).toHaveLength(1);
      expect(h.deleted).toEqual([first.fileUri, first.thumbUri]); // the refused photo goes with it

      await h.outbox.sync();
      expect(await only(h)).toMatchObject({ id: again.record.id, state: "uploaded", nadawat: fresh });
      expect(h.calls.map((c) => c.id)).toEqual([first.id, again.record.id]);
    });

    it("attesting again with the very same photo keeps its file", async () => {
      const h = harness(makeStore(), [{ kind: "reject", error: "UNAUTHENTICATED" }]);
      await h.outbox.init();
      const first = queued(await h.outbox.add(receipt(SHA_A)));
      await h.outbox.sync();
      const again = await h.outbox.add(receipt(SHA_A));
      expect(again).toMatchObject({ outcome: "queued", replaced: { id: first.id } });
      expect(h.deleted).toEqual([]);
    });

    it("a receipt on its way or recorded is never replaced", async () => {
      const h = harness(makeStore());
      await h.outbox.init();
      const first = queued(await h.outbox.add(receipt(SHA_A)));
      expect(await h.outbox.add(receipt(SHA_B))).toMatchObject({
        outcome: "already-attested",
        existing: { id: first.id },
      });
      await h.outbox.sync();
      expect(await h.outbox.add(receipt(SHA_C))).toMatchObject({ outcome: "already-attested" });
      // The same photo for another member is the same file, never a second receipt.
      expect(await h.outbox.add(receipt(SHA_A, { ...MERLYN, lineId: "line_2026A_r37_M-031" }))).toMatchObject(
        {
          outcome: "duplicate-file",
          existing: { id: first.id },
        },
      );
    });

    it("keeps the attestation through the store, and is never marked read", async () => {
      const h = harness(makeStore());
      await h.outbox.init();
      const rec = queued(await h.outbox.add(receipt(SHA_A)));
      await h.outbox.sync();
      expect(await h.store.findNadawat(MERLYN.lineId)).toMatchObject({ id: rec.id, nadawat: MERLYN });
      expect(await h.outbox.markRead(rec.id, { documentId: "x", rowsRead: 1 })).toBe(false);
      expect((await only(h)).state).toBe("uploaded");
    });
  });

  it("prunes settled captures after a month and deletes their files, but never an unsent one", async () => {
    const h = harness(makeStore());
    await h.outbox.init();
    await h.outbox.add(page(SHA_A));
    h.advance(10);
    await h.outbox.add(page(SHA_B));
    await h.outbox.sync(); // A and B reach the co-op
    h.setOnline(false);
    h.advance(10);
    await h.outbox.add(page(SHA_C)); // C waits on the phone, however long it takes
    h.advance(KEEP_SETTLED_MS + 1);
    expect(await h.outbox.prune()).toBe(2);
    expect((await h.outbox.list()).map((r) => r.sha256)).toEqual([SHA_C]);
    expect(h.deleted.sort()).toEqual(
      [`file:///captures/${SHA_A.slice(0, 6)}`, `file:///captures/${SHA_B.slice(0, 6)}`]
        .flatMap((p) => [`${p}.jpg`, `${p}-thumb.jpg`])
        .sort(),
    );
  });

  it("stops after dispose: no more syncing and no more change notifications", async () => {
    const h = harness(makeStore());
    await h.outbox.init();
    await h.outbox.add(page(SHA_A));
    const before = h.changes();
    h.outbox.dispose();
    expect(await h.outbox.sync()).toMatchObject({ attempted: 0 });
    expect(h.calls).toHaveLength(0);
    expect(h.changes()).toBe(before);
    expect((await only(h)).state).toBe("queued"); // still safe on the phone
  });
});

describe("assertNewCapture", () => {
  it("refuses captures the co-op could never verify", () => {
    expect(() => assertNewCapture(page("A".repeat(64)))).toThrow(/sha256/);
    expect(() => assertNewCapture(page(SHA_A, { bytes: -1 }))).toThrow(/bytes/);
    expect(() => assertNewCapture(page(SHA_A, { bytes: 1.5 }))).toThrow(/bytes/);
    expect(() => assertNewCapture(page(SHA_A, { fileUri: "" }))).toThrow(/file/);
    expect(() => assertNewCapture(page(SHA_A, { source: "fax" as never }))).toThrow(/source/);
    expect(() => assertNewCapture(receipt(SHA_A, { ...MERLYN, cents: 1.5 }))).toThrow(/cents/);
    expect(() => assertNewCapture(receipt(SHA_A, { ...MERLYN, phpPerUsd: "62.5.0" }))).toThrow(/rate/);
    expect(() => assertNewCapture(receipt(SHA_A, { ...MERLYN, lineId: "" }))).toThrow(/line/);
    expect(() => assertNewCapture(page(SHA_A))).not.toThrow();
    expect(() => assertNewCapture(receipt(SHA_A))).not.toThrow();
  });
});

describe("refusals", () => {
  const r = (state: CaptureRecord["state"], nextAttemptAt: number, lastError: string | null = null) => ({
    state,
    nextAttemptAt,
    lastError,
  });

  it("say what a resend can be: the same request, a new one, or none", () => {
    expect(resendOf(r("queued", T0))).toBe("same-key");
    expect(resendOf(r("failed", T0 + 1, "503"))).toBe("same-key");
    expect(resendOf(r("failed", MANUAL_ONLY, "UNAUTHENTICATED"))).toBe("new-key");
    expect(resendOf(r("failed", MANUAL_ONLY, "422"))).toBe("new-key");
    expect(resendOf(r("failed", MANUAL_ONLY, null))).toBe("new-key");
    for (const code of [...FINAL_REFUSALS, "LINE_NOT_DUE", "LINE_ALREADY_RECEIVED"]) {
      expect(resendOf(r("failed", MANUAL_ONLY, code))).toBe("none");
    }
    for (const state of ["uploading", "uploaded", "read"] as const)
      expect(resendOf(r(state, T0))).toBe("none");
  });

  it("are only ever the co-op's own answers, and pairing refusals are never final", () => {
    expect(isRefused(r("failed", MANUAL_ONLY))).toBe(true);
    expect(isRefused(r("failed", T0))).toBe(false);
    expect(isRefused(r("queued", MANUAL_ONLY))).toBe(false);
    expect(AUTH_REFUSALS.some(isFinalRefusal)).toBe(false);
    expect(isFinalRefusal(null)).toBe(false);
    expect(isFinalRefusal("LINE_HELD")).toBe(true);
  });
});

describe("summaries", () => {
  it("counts every state once, and onPhone is everything not yet at the co-op", () => {
    const base = { nextAttemptAt: 0 } as CaptureRecord;
    const recs = (
      [
        ["queued", 0],
        ["uploading", 0],
        ["failed", T0 + 1],
        ["failed", MANUAL_ONLY],
        ["uploaded", 0],
        ["read", 0],
      ] as const
    ).map(([state, nextAttemptAt]) => ({ ...base, state, nextAttemptAt }));
    expect(summarise(recs)).toEqual({
      total: 6,
      queued: 1,
      uploading: 1,
      retrying: 1,
      refused: 1,
      uploaded: 1,
      read: 1,
      onPhone: 4,
      sent: 2,
    });
    expect(nextWakeAt(recs, T0)).toBe(T0 + 1);
    expect(nextWakeAt(recs, T0 + 1)).toBeNull();
  });

  it("days are Calinan's (UTC+8), whatever the phone's zone", () => {
    const lateNightUtc = Date.parse("2026-10-27T15:59:00Z"); // 23:59 in Calinan
    const afterMidnight = Date.parse("2026-10-27T16:01:00Z"); // 00:01 the next day
    expect(isSameManilaDay(T0, lateNightUtc)).toBe(true);
    expect(isSameManilaDay(lateNightUtc, afterMidnight)).toBe(false);
    expect(manilaDay(afterMidnight) - manilaDay(T0)).toBe(1);
  });
});

/* ------------------------------------------------------------------ schema */

describe("sqlite schema", () => {
  it(`creates version ${OUTBOX_SCHEMA_VERSION} and refuses a second row with the same sha256`, async () => {
    const db = nodeSqlite();
    const store = new SqliteOutboxStore(db);
    const h = harness(store);
    await h.outbox.init();
    const [v] = await db.all<{ user_version: number }>("PRAGMA user_version", []);
    expect(v?.user_version).toBe(OUTBOX_SCHEMA_VERSION);
    const a = queued(await h.outbox.add(page(SHA_A)));
    expect(await store.insert({ ...a, id: "0190f0f0-0000-7000-8000-000000000000" })).toBe("duplicate");
  });

  it("refuses an unbound cash receipt and a second receipt for a line at the database level", async () => {
    const db = nodeSqlite();
    const store = new SqliteOutboxStore(db);
    const h = harness(store);
    await h.outbox.init();
    const r = queued(await h.outbox.add(receipt(SHA_A)));
    expect(await store.insert({ ...r, id: "0190f0f0-0000-7000-8000-000000000001", sha256: SHA_B })).toBe(
      "duplicate",
    );
    await expect(
      db.run(
        `INSERT INTO captures (id, kind, sha256, file_uri, mime, bytes, station, source, created_at, state,
         next_attempt_at) VALUES ('x', 'nadawat', ?, 'f', 'image/jpeg', 1, 's', 'camera', 0, 'queued', 0)`,
        [SHA_C],
      ),
    ).rejects.toThrow(/CHECK/);
  });

  it("migrates the first build's table to version 2 without losing a capture", async () => {
    const db = nodeSqlite();
    await db.exec(`CREATE TABLE captures (
      id TEXT PRIMARY KEY NOT NULL, sha256 TEXT NOT NULL UNIQUE, file_uri TEXT NOT NULL, thumb_uri TEXT,
      mime TEXT NOT NULL, bytes INTEGER NOT NULL, width INTEGER, height INTEGER, station TEXT NOT NULL,
      member_hint TEXT, source TEXT NOT NULL CHECK (source IN ('scanner','camera','sample')),
      created_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('queued','uploading','uploaded','read','failed')),
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, last_error TEXT,
      progress REAL NOT NULL DEFAULT 0, document_id TEXT, duplicate_of TEXT, rows_read INTEGER, serial TEXT,
      uploaded_at INTEGER);
      CREATE INDEX captures_due ON captures (state, next_attempt_at);`);
    await db.run(
      `INSERT INTO captures (id, sha256, file_uri, mime, bytes, station, source, created_at, state, attempts,
       next_attempt_at, last_error) VALUES (?, ?, 'file:///old.jpg', 'image/jpeg', 9, 'Purok 2 pickup', 'scanner',
       ?, 'uploading', 2, ?, '503')`,
      ["0190f0f0-0000-7000-8000-0000000000aa", SHA_D, T0, T0],
    );
    const store = new SqliteOutboxStore(db);
    const h = harness(store);
    await h.outbox.init();
    expect(await only(h)).toMatchObject({
      id: "0190f0f0-0000-7000-8000-0000000000aa",
      kind: "slip",
      nadawat: null,
      state: "queued", // the interrupted upload is back in the queue
      attempts: 2,
      lastError: "503",
    });
    // Version 2 features work on the migrated table.
    expect((await h.outbox.add(page(SHA_A, { source: "library" }))).outcome).toBe("queued");
    expect((await h.outbox.add(receipt(SHA_B))).outcome).toBe("queued");
    await h.outbox.init(); // idempotent
    expect(await h.outbox.list()).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------ property: never loses a capture */

type Op =
  | { op: "add"; sha: number; nadawat: boolean }
  | { op: "sync" }
  | { op: "online"; v: boolean }
  | { op: "advance"; ms: number }
  | { op: "sendNow"; pick: number }
  | { op: "sendAll" }
  | { op: "repaired" }
  | { op: "discard"; pick: number }
  | { op: "read"; pick: number }
  | { op: "crash" };

const SHAS = Array.from({ length: 6 }, (_, i) => String.fromCharCode(97 + i).repeat(64));

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant("add" as const), sha: fc.nat(5), nadawat: fc.boolean() }),
  fc.constant({ op: "sync" as const }),
  fc.record({ op: fc.constant("online" as const), v: fc.boolean() }),
  fc.record({ op: fc.constant("advance" as const), ms: fc.integer({ min: 0, max: 400_000 }) }),
  fc.record({ op: fc.constant("sendNow" as const), pick: fc.nat(10) }),
  fc.constant({ op: "sendAll" as const }),
  fc.constant({ op: "repaired" as const }),
  fc.record({ op: fc.constant("discard" as const), pick: fc.nat(10) }),
  fc.record({ op: fc.constant("read" as const), pick: fc.nat(10) }),
  fc.constant({ op: "crash" as const }),
);

const outcomeArb: fc.Arbitrary<UploadOutcome | "throw"> = fc.oneof(
  fc.constant(ok()),
  fc.constant(ok({ rowsRead: 2, serial: "0499" })),
  fc.constant({ kind: "retry" as const, error: "NETWORK" }),
  fc.constant({ kind: "retry" as const, error: "429", retryAfterMs: 120_000 }),
  fc.constant({ kind: "reject" as const, error: "422" }),
  fc.constant({ kind: "reject" as const, error: "UNAUTHENTICATED" }),
  fc.constant({ kind: "reject" as const, error: "TOO_LARGE" }),
  fc.constant("throw" as const),
);

/** Operations in which a person may give a refused capture a new key: a resend, re-pairing, or filing it again. */
const REKEYING: ReadonlySet<Op["op"]> = new Set(["sendNow", "sendAll", "repaired", "add"]);

describe.each(stores)("inv.i7.never-lost on %s (property)", (_name, makeStore) => {
  it("keeps every capture until the co-op has it or a person removes a refusal, one key per request", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(opArb, { minLength: 1, maxLength: 40 }),
        fc.array(outcomeArb, { maxLength: 60 }),
        async (ops, outcomes) => {
          const store = makeStore();
          let now = T0;
          let online = true;
          let seq = 0;
          let op: Op["op"] = "sync";
          const script = [...outcomes];
          const uploadedOk = new Set<string>();
          const refusedWith = new Map<string, string>(); // id → the co-op's refusal code
          const keyOf = new Map<string, string>(); // sha → the id it is filed under now
          const retired = new Set<string>(); // keys a refusal used up: never sent again
          const bestRank = new Map<string, number>();

          /** A capture's key changes only when a person acts on a refusal that allows it (never by a timer). */
          const adopt = (sha: string, id: string) => {
            const prev = keyOf.get(sha);
            if (prev === id) return;
            if (prev !== undefined) {
              expect(REKEYING.has(op)).toBe(true);
              const code = refusedWith.get(prev);
              expect(code).toBeDefined();
              if (op !== "add") expect(isFinalRefusal(code ?? null)).toBe(false);
              if (op === "repaired") expect(AUTH_REFUSALS).toContain(code);
              retired.add(prev);
            }
            keyOf.set(sha, id);
          };

          const make = () =>
            new Outbox({
              store,
              now: () => now,
              newId: () => uuidv7(now + seq++, (n) => new Uint8Array(n).fill(seq & 0xff)),
              isOnline: () => online,
              uploader: async (rec, onProgress) => {
                expect(uploadedOk.has(rec.id)).toBe(false); // never re-sent after the co-op said yes
                expect(retired.has(rec.id)).toBe(false); // a refused key is never sent again
                adopt(rec.sha256, rec.id); // otherwise the same Idempotency-Key, every retry
                onProgress(0.5);
                const o = script.shift() ?? ok();
                if (o === "throw") throw new Error("boom");
                if (o.kind === "ok") uploadedOk.add(rec.id);
                if (o.kind === "reject") refusedWith.set(rec.id, o.error);
                return o;
              },
            });
          let outbox = make();
          await outbox.init();
          for (const step of ops) {
            op = step.op;
            const records = await outbox.list();
            const pick = (i: number) => records[i % Math.max(1, records.length)];
            switch (step.op) {
              case "add": {
                const sha = SHAS[step.sha] as string;
                const r = await outbox.add(
                  step.nadawat
                    ? receipt(sha, { ...MERLYN, lineId: `line-${step.sha}` })
                    : page(sha, { source: "camera" }),
                );
                if (r.outcome === "queued") {
                  if (r.replaced) expect(isRefused(r.replaced)).toBe(true); // only a refusal is filed over
                  adopt(sha, r.record.id);
                }
                break;
              }
              case "sync":
                await outbox.sync();
                break;
              case "online":
                online = step.v;
                break;
              case "advance":
                now += step.ms;
                break;
              case "sendNow": {
                const r = pick(step.pick);
                if (r) await outbox.sendNow(r.id);
                break;
              }
              case "sendAll":
                await outbox.sendAll();
                break;
              case "repaired":
                await outbox.afterPairing();
                break;
              case "discard": {
                const r = pick(step.pick);
                if (r && (await outbox.discard(r.id))) {
                  expect(isRefused(r)).toBe(true); // only a refusal leaves the phone this way
                  keyOf.delete(r.sha256);
                }
                break;
              }
              case "read": {
                const r = pick(step.pick);
                if (r) await outbox.markRead(r.id, { documentId: "doc", rowsRead: 1 });
                break;
              }
              case "crash":
                outbox.dispose();
                outbox = make();
                await outbox.init({ keepSettledMs: Number.MAX_SAFE_INTEGER });
                break;
            }
            const after = await outbox.list();
            for (const r of after) adopt(r.sha256, r.id); // a re-key that has not been sent yet
            // Never lost, never duplicated: one row per filed sha, under its current key.
            expect(new Set(after.map((r) => r.sha256))).toEqual(new Set(keyOf.keys()));
            expect(after).toHaveLength(keyOf.size);
            for (const r of after) {
              expect(r.id).toBe(keyOf.get(r.sha256));
              expect(r.state).not.toBe("uploading"); // nothing left mid-flight between operations
              const best = bestRank.get(r.id) ?? 0;
              const rank = CAPTURE_STATE_RANK[r.state];
              if (best >= CAPTURE_STATE_RANK.uploaded) expect(rank).toBeGreaterThanOrEqual(best);
              bestRank.set(r.id, Math.max(best, rank));
            }
          }
        },
      ),
      { numRuns: 80 },
    );
  });
});
