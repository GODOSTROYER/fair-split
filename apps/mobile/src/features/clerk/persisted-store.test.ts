import { describe, expect, it } from "vitest";
import { type CaptureRecord, type Filer, type NewCapture, Outbox } from "../../lib/outbox";
import { uuidv7 } from "../../lib/uuidv7";
import { PersistedOutboxStore, type RecordSink, storeKey } from "./persisted-store";

const T0 = Date.parse("2026-10-27T01:00:00Z");
const JESSIE: Filer = { persona: "clerk:jessie", name: "Jessie Dela Cruz", pairing: "pairing-jessie-1" };

/** An in-memory stand-in for IndexedDB that can be told to refuse writes. */
function memorySink() {
  const rows = new Map<string, CaptureRecord>();
  let refuse = false;
  const sink: RecordSink = {
    async loadAll() {
      if (refuse) throw new Error("denied");
      return [...rows.values()].map((r) => structuredClone(r));
    },
    async put(rec) {
      if (refuse) throw new Error("quota");
      rows.set(rec.id, structuredClone(rec));
    },
    async remove(ids) {
      if (refuse) throw new Error("quota");
      for (const id of ids) rows.delete(id);
    },
  };
  return { sink, rows, refuse: (v: boolean) => (refuse = v) };
}

const page = (c: string): NewCapture => ({
  sha256: c.repeat(64),
  fileUri: `data:image/jpeg;base64,${c}`,
  thumbUri: null,
  mime: "image/jpeg",
  bytes: 10,
  width: 1600,
  height: 1200,
  station: "Purok 2 pickup",
  memberHint: null,
  source: "file",
});

function engine(sink: RecordSink, now: { t: number }, online: { v: boolean }) {
  const store = new PersistedOutboxStore(sink);
  let seq = 0;
  const outbox = new Outbox({
    store,
    uploader: async (_r, onProgress) => {
      onProgress(1);
      return { kind: "ok", documentId: "doc", duplicateOf: null, rowsRead: null, serial: null };
    },
    now: () => now.t,
    newId: () => uuidv7(now.t + seq++, (n) => new Uint8Array(n).fill(seq)),
    isOnline: () => online.v,
    filer: () => JESSIE,
  });
  return { store, outbox };
}

describe("the web outbox store", () => {
  it("survives a reload: every capture and its state come back from the sink", async () => {
    const m = memorySink();
    const now = { t: T0 };
    const online = { v: false };
    const a = engine(m.sink, now, online);
    await a.outbox.init();
    await a.outbox.add(page("a"));
    await a.outbox.add(page("b"));
    online.v = true;
    await a.outbox.sync();
    online.v = false;
    await a.outbox.add(page("c"));
    expect([...m.rows.values()].map((r) => r.state).sort()).toEqual(["queued", "uploaded", "uploaded"]);

    // The tab reloads: a new engine over the same sink.
    const b = engine(m.sink, now, online);
    await b.outbox.init();
    expect((await b.outbox.list()).map((r) => [r.sha256[0], r.state])).toEqual([
      ["c", "queued"],
      ["b", "uploaded"],
      ["a", "uploaded"],
    ]);
    expect((await b.outbox.add(page("a"))).outcome).toBe("duplicate-file");
    expect(b.store.durable).toBe(true);
  });

  it("writes back an upload a closed tab interrupted, and removes pruned captures from the sink", async () => {
    const m = memorySink();
    const now = { t: T0 };
    const a = engine(m.sink, now, { v: false });
    await a.outbox.init();
    const r = await a.outbox.add(page("a"));
    if (r.outcome !== "queued") throw new Error("expected queued");
    await a.store.transition(r.record.id, ["queued"], { state: "uploading", progress: 0.3 });
    expect(m.rows.get(r.record.id)?.state).toBe("uploading");

    const b = engine(m.sink, now, { v: true });
    await b.outbox.init();
    expect(m.rows.get(r.record.id)).toMatchObject({ state: "queued", progress: 0 });
    await b.outbox.sync();
    now.t += 40 * 24 * 3600_000;
    expect(await b.outbox.prune()).toBe(1);
    expect(m.rows.size).toBe(0);
  });

  it("writes a resend's new key and a removal through to the sink", async () => {
    const m = memorySink();
    const now = { t: T0 };
    const store = new PersistedOutboxStore(m.sink);
    let seq = 0;
    let answer: "reject" | "ok" = "reject";
    const outbox = new Outbox({
      store,
      uploader: async () =>
        answer === "reject"
          ? { kind: "reject", error: "UNAUTHENTICATED" }
          : { kind: "ok", documentId: "doc", duplicateOf: null, rowsRead: null, serial: null },
      now: () => now.t,
      newId: () => uuidv7(now.t + seq++, (n) => new Uint8Array(n).fill(seq)),
      isOnline: () => true,
      filer: () => JESSIE,
    });
    await outbox.init();
    const a = await outbox.add(page("a"));
    const b = await outbox.add(page("b"));
    if (a.outcome !== "queued" || b.outcome !== "queued") throw new Error("expected queued");
    await outbox.sync(); // both refused
    answer = "ok";
    now.t += 1000;
    await outbox.sendNow(a.record.id);
    expect(m.rows.has(a.record.id)).toBe(false);
    const [resent] = [...m.rows.values()].filter((r) => r.sha256 === "a".repeat(64));
    expect(resent).toMatchObject({ state: "uploaded" });
    expect(resent?.id).not.toBe(a.record.id);

    expect(await outbox.discard(b.record.id)).toBe(true);
    expect([...m.rows.values()].map((r) => r.sha256[0])).toEqual(["a"]);
  });

  it("keeps working in memory when the browser refuses storage, and says so", async () => {
    const m = memorySink();
    m.refuse(true);
    const a = engine(m.sink, { t: T0 }, { v: true });
    await a.outbox.init();
    expect((await a.outbox.add(page("a"))).outcome).toBe("queued");
    expect(await a.outbox.sync()).toMatchObject({ uploaded: 1 });
    expect(a.store.durable).toBe(false);
  });

  it("filer.migrated-web: a capture the previous build saved (no filer) comes back unknown and waits for a person", async () => {
    const m = memorySink();
    const now = { t: T0 };
    // What the previous build wrote to IndexedDB: a whole record, with no `filedBy` at all.
    const { filedBy: _none, ...old } = {
      id: "0190f0f0-0000-7000-8000-0000000000c1",
      kind: "slip",
      sha256: "a".repeat(64),
      fileUri: "data:image/jpeg;base64,a",
      thumbUri: null,
      mime: "image/jpeg",
      bytes: 10,
      width: 1600,
      height: 1200,
      station: "Purok 2 pickup",
      memberHint: null,
      source: "file",
      nadawat: null,
      filedBy: null,
      createdAt: T0,
      state: "failed",
      attempts: 1,
      nextAttemptAt: Number.MAX_SAFE_INTEGER,
      lastError: "UNAUTHENTICATED",
      progress: 0,
      documentId: null,
      duplicateOf: null,
      rowsRead: null,
      serial: null,
      uploadedAt: null,
    } satisfies CaptureRecord;
    m.rows.set(old.id, old as unknown as CaptureRecord);
    // So would a damaged filer: anything that is not a whole one is unknown.
    m.rows.set("0190f0f0-0000-7000-8000-0000000000c2", {
      ...old,
      id: "0190f0f0-0000-7000-8000-0000000000c2",
      sha256: "b".repeat(64),
      state: "queued",
      nextAttemptAt: T0,
      lastError: null,
      filedBy: { persona: 7 },
    } as unknown as CaptureRecord);
    let sent = 0;
    const outbox = new Outbox({
      store: new PersistedOutboxStore(m.sink),
      uploader: async () => {
        sent++;
        return { kind: "ok", documentId: "doc", duplicateOf: null, rowsRead: null, serial: null };
      },
      now: () => now.t,
      newId: () => uuidv7(now.t, (n) => new Uint8Array(n).fill(9)),
      isOnline: () => true,
      filer: () => JESSIE,
    });
    await outbox.init();
    expect((await outbox.list()).map((r) => r.filedBy)).toEqual([null, null]);
    await outbox.afterPairing();
    await outbox.sync();
    await outbox.sendAll();
    expect(sent).toBe(0);
    expect(await outbox.takeOver("0190f0f0-0000-7000-8000-0000000000c2", null)).toMatchObject({
      uploaded: 1,
    });
    expect(sent).toBe(1);
    expect(m.rows.get("0190f0f0-0000-7000-8000-0000000000c2")).toMatchObject({
      state: "uploaded",
      filedBy: JESSIE,
    });
  });

  it("keys each workspace's outbox apart, safely for a file name", () => {
    const k = storeKey("ws_demo_local");
    expect(k).toMatch(/^[0-9a-f]{16}$/);
    expect(storeKey("ws_demo_local")).toBe(k);
    expect(storeKey("ws_judge_7")).not.toBe(k);
  });
});
