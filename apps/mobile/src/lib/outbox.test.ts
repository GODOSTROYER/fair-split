import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { nodeSqlite } from "../test/node-sqlite";
import { retryDelayMs } from "./backoff";
import {
  AUTH_REFUSALS,
  assertNewCapture,
  CAPTURE_STATE_RANK,
  type CaptureRecord,
  EXPIRED_TOKEN_REFUSALS,
  FINAL_REFUSALS,
  type Filer,
  filerOrNull,
  isFiledBy,
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

/** The clerk this phone is paired as in most tests. */
const JESSIE: Filer = { persona: "clerk:jessie", name: "Jessie Dela Cruz", pairing: "pairing-jessie-1" };
/** The same clerk, paired again (her token had expired): a new pairing, the same persona. */
const JESSIE_AGAIN: Filer = { ...JESSIE, pairing: "pairing-jessie-2" };
/** Another clerk of the same co-op, paired on the same phone. */
const MARIA: Filer = { persona: "clerk:maria", name: "Maria Santos", pairing: "pairing-maria-1" };

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
  /** Every upload: its key, bytes and attempt, who filed it, and who the phone was paired as when it went. */
  calls: { id: string; sha: string; attempt: number; filedBy: string | null; as: string | null }[];
  deleted: string[];
  changes: () => number;
  advance(ms: number): void;
  setOnline(v: boolean): void;
  /** The phone is paired as `f` from now on (null: not paired). */
  pairAs(f: Filer | null): void;
  now(): number;
}

function harness(
  store: OutboxStore,
  script: (UploadOutcome | ((rec: CaptureRecord) => Promise<UploadOutcome>))[] = [],
  opts: { progress?: number[]; filer?: Filer | null } = {},
): Harness {
  let now = T0;
  let online = true;
  let seq = 0;
  let changes = 0;
  let filer: Filer | null = opts.filer === undefined ? JESSIE : opts.filer;
  const calls: Harness["calls"] = [];
  const deleted: string[] = [];
  const uploader: Uploader = async (rec, onProgress) => {
    calls.push({
      id: rec.id,
      sha: rec.sha256,
      attempt: rec.attempts + 1,
      filedBy: rec.filedBy?.persona ?? null,
      as: filer?.persona ?? null,
    });
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
    filer: () => filer,
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
    pairAs: (f) => {
      filer = f;
    },
    now: () => now,
  };
}

/** A whole stored capture, as a store holds it (`over` sets anything, a missing filer included). */
function stored(over: Partial<CaptureRecord> & Pick<CaptureRecord, "id" | "sha256">): CaptureRecord {
  return {
    kind: "slip",
    fileUri: `file:///captures/${over.sha256.slice(0, 6)}.jpg`,
    thumbUri: null,
    mime: "image/jpeg",
    bytes: 412_000,
    width: 1600,
    height: 1200,
    station: "Purok 2 pickup",
    memberHint: null,
    source: "scanner",
    nadawat: null,
    filedBy: JESSIE,
    createdAt: T0,
    state: "queued",
    attempts: 0,
    nextAttemptAt: T0,
    lastError: null,
    progress: 0,
    documentId: null,
    duplicateOf: null,
    rowsRead: null,
    serial: null,
    uploadedAt: null,
    ...over,
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

  /* -------------------------------------------- the clerk who filed it (security review, ws/app SECURITY (1)) */

  it("filer.stamped: every capture keeps the clerk paired when it was filed, through the store", async () => {
    const h = harness(makeStore());
    await h.outbox.init();
    const a = queued(await h.outbox.add(page(SHA_A)));
    expect(a.filedBy).toEqual(JESSIE);
    expect((await h.store.get(a.id))?.filedBy).toEqual(JESSIE);
    h.pairAs(null);
    // Nobody paired: the capture is kept (never lost), but it is nobody's, so it waits for a person.
    const b = queued(await h.outbox.add(page(SHA_B)));
    expect(b.filedBy).toBeNull();
    expect(await h.outbox.sync()).toMatchObject({ attempted: 0 });
    expect(h.calls).toHaveLength(0);
  });

  it("filer.persona-mismatch: paired again as another clerk, nothing the first clerk filed goes out by itself", async () => {
    const h = harness(makeStore(), [
      { kind: "reject", error: "UNAUTHENTICATED" },
      { kind: "retry", error: "NETWORK" },
    ]);
    await h.outbox.init();
    await h.outbox.add(page(SHA_A)); // refused: Jessie's token had expired
    h.advance(10);
    await h.outbox.add(page(SHA_B)); // backing off after a network loss
    await h.outbox.sync();
    h.setOnline(false);
    h.advance(10);
    await h.outbox.add(page(SHA_C)); // never sent
    h.setOnline(true);
    expect(h.calls).toHaveLength(2);

    // Maria pairs this phone: re-pairing, timers, "Ipadala karon" and "Ipadala tanan" all leave Jessie's captures be.
    h.pairAs(MARIA);
    expect(await h.outbox.afterPairing()).toMatchObject({ attempted: 0 });
    // No wake-up is scheduled for Jessie's backing-off capture while Maria is paired.
    expect(nextWakeAt(await h.outbox.list(), h.now())).not.toBeNull();
    expect(nextWakeAt(await h.outbox.list(), h.now(), MARIA.persona)).toBeNull();
    h.advance(24 * 3600_000);
    expect(await h.outbox.sync()).toMatchObject({ attempted: 0 });
    await h.outbox.sendAll();
    for (const r of await h.outbox.list()) await h.outbox.sendNow(r.id);
    expect(h.calls).toHaveLength(2);
    const held = await h.outbox.list();
    expect(held.map((r) => r.filedBy?.persona)).toEqual([JESSIE.persona, JESSIE.persona, JESSIE.persona]);
    expect(held.find((r) => r.sha256 === SHA_A)).toMatchObject({
      lastError: "UNAUTHENTICATED",
      nextAttemptAt: MANUAL_ONLY,
    });
    expect(held.find((r) => r.sha256 === SHA_C)).toMatchObject({ state: "queued", attempts: 0 });

    // Maria's own captures go as usual, under her name.
    await h.outbox.add(page(SHA_D));
    await h.outbox.sync();
    expect(h.calls.at(-1)).toMatchObject({ sha: SHA_D, filedBy: MARIA.persona, as: MARIA.persona });

    // Jessie pairs again: what she filed goes by itself, under her own pairing (her refusal under a new key).
    h.pairAs(JESSIE_AGAIN);
    expect(await h.outbox.afterPairing()).toMatchObject({ attempted: 3, uploaded: 3 });
    expect(h.calls.slice(3).map((c) => c.sha)).toEqual([SHA_A, SHA_B, SHA_C]);
    // Every upload went out under the pairing of the clerk who filed it, never another's.
    for (const c of h.calls) expect(c.as).toBe(c.filedBy);
  });

  it("filer.forbidden: paired again as the same clerk, a FORBIDDEN refusal never goes by itself; her own act can", async () => {
    const h = harness(makeStore(), [{ kind: "reject", error: "FORBIDDEN" }]);
    await h.outbox.init();
    const rec = queued(await h.outbox.add(page(SHA_A)));
    await h.outbox.sync();
    h.pairAs(JESSIE_AGAIN);
    expect(await h.outbox.afterPairing()).toMatchObject({ attempted: 0 });
    expect(h.calls).toHaveLength(1);
    expect(await only(h)).toMatchObject({ id: rec.id, lastError: "FORBIDDEN", nextAttemptAt: MANUAL_ONLY });
    // "Ipadala karon" on her own capture (the row says she filed it): a person's act, as a new request.
    await h.outbox.sendNow(rec.id);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toMatchObject({ sha: SHA_A, as: JESSIE.persona });
    expect(h.calls[1]?.id).not.toBe(rec.id);
  });

  it("filer.expired-token: paired again as the same clerk, her expired-token refusals go by themselves, each under a new key", async () => {
    const h = harness(makeStore(), [
      { kind: "reject", error: "UNAUTHENTICATED" },
      { kind: "reject", error: "FRAME_TOKEN_EXPIRED" },
      { kind: "reject", error: "422" },
    ]);
    await h.outbox.init();
    for (const sha of [SHA_A, SHA_B, SHA_C]) {
      await h.outbox.add(page(sha));
      h.advance(10);
    }
    await h.outbox.sync();
    const refused = await h.outbox.list();
    expect(summarise(refused)).toMatchObject({ refused: 3 });
    h.pairAs(JESSIE_AGAIN);
    expect(await h.outbox.afterPairing()).toMatchObject({ attempted: 2, uploaded: 2 });
    const list = await h.outbox.list();
    expect(list.find((r) => r.sha256 === SHA_C)).toMatchObject({ lastError: "422" }); // waits for a person
    const sent = list.filter((r) => r.state === "uploaded");
    expect(sent.map((r) => r.sha256).sort()).toEqual([SHA_A, SHA_B]);
    // New requests (the old keys could only replay the refusal), still filed by her.
    for (const r of sent) {
      expect(refused.some((x) => x.id === r.id)).toBe(false);
      expect(r.filedBy).toEqual(JESSIE);
    }
    expect(h.calls.slice(3).every((c) => c.as === JESSIE.persona)).toBe(true);
  });

  it("filer.unknown: a capture kept from before the phone noted who filed it never goes by itself", async () => {
    const store = makeStore();
    // As the schema migration leaves them (see "sqlite schema"): no filer.
    await store.init();
    await store.insert(stored({ id: "0190f0f0-0000-7000-8000-0000000000a1", sha256: SHA_A, filedBy: null }));
    await store.insert(
      stored({
        id: "0190f0f0-0000-7000-8000-0000000000a2",
        sha256: SHA_B,
        filedBy: null,
        createdAt: T0 + 10,
        state: "failed",
        attempts: 1,
        nextAttemptAt: MANUAL_ONLY,
        lastError: "UNAUTHENTICATED",
      }),
    );
    const h = harness(store);
    await h.outbox.init();
    await h.outbox.afterPairing();
    h.advance(24 * 3600_000);
    await h.outbox.sync();
    await h.outbox.sendAll();
    for (const r of await h.outbox.list()) await h.outbox.sendNow(r.id);
    expect(h.calls).toHaveLength(0);
    expect(summarise(await h.outbox.list())).toMatchObject({ onPhone: 2, queued: 1, refused: 1 });

    // A person's act, after the screen said nobody knows who filed it: it goes as hers.
    expect(await h.outbox.takeOver("0190f0f0-0000-7000-8000-0000000000a1", MARIA.persona)).toBeNull();
    expect(await h.outbox.takeOver("0190f0f0-0000-7000-8000-0000000000a1", null)).toMatchObject({
      uploaded: 1,
    });
    expect(h.calls).toEqual([
      expect.objectContaining({ sha: SHA_A, filedBy: JESSIE.persona, as: JESSIE.persona }),
    ]);
    expect(await h.outbox.takeOver("0190f0f0-0000-7000-8000-0000000000a2", null)).toMatchObject({
      uploaded: 1,
    });
    expect(h.calls[1]).toMatchObject({ sha: SHA_B, as: JESSIE.persona });
    expect(h.calls[1]?.id).not.toBe("0190f0f0-0000-7000-8000-0000000000a2"); // a refusal goes as a new request
  });

  it("filer.take-over: another clerk's capture goes only by a person's act, after seeing who filed it", async () => {
    const h = harness(makeStore(), [
      { kind: "reject", error: "UNAUTHENTICATED" },
      { kind: "retry", error: "NETWORK" },
      ok(),
      { kind: "reject", error: "TOO_LARGE" },
    ]);
    await h.outbox.init();
    const refused = queued(await h.outbox.add(page(SHA_A)));
    h.advance(10);
    const sent = queued(await h.outbox.add(page(SHA_B)));
    await h.outbox.sync(); // A refused, B backing off
    h.advance(10);
    const tooLarge = queued(await h.outbox.add(page(SHA_C)));
    h.advance(retryDelayMs(1));
    await h.outbox.sync(); // B reaches the co-op, C is refused for good
    expect(h.calls.map((c) => c.sha)).toEqual([SHA_A, SHA_B, SHA_B, SHA_C]);
    const before = h.calls.length;

    h.pairAs(MARIA);
    // Not who the screen showed, not on the phone any more, already hers, or nothing a resend can fix: no change.
    expect(await h.outbox.takeOver(refused.id, "clerk:someone-else")).toBeNull();
    expect(await h.outbox.takeOver(sent.id, JESSIE.persona)).toBeNull(); // the co-op has it
    expect(await h.outbox.takeOver(tooLarge.id, JESSIE.persona)).toBeNull();
    expect(h.calls).toHaveLength(before);

    // A refusal goes as a new request, filed now by the clerk who sent it.
    expect(await h.outbox.takeOver(refused.id, JESSIE.persona)).toMatchObject({ uploaded: 1 });
    const taken = (await h.outbox.list()).find((r) => r.sha256 === SHA_A);
    expect(taken).toMatchObject({ state: "uploaded", filedBy: MARIA });
    expect(taken?.id).not.toBe(refused.id);
    expect(h.calls.at(-1)).toMatchObject({ sha: SHA_A, filedBy: MARIA.persona, as: MARIA.persona });
    expect(await h.outbox.takeOver(taken?.id ?? "", JESSIE.persona)).toBeNull();
  });

  it("filer.take-over-keeps-key: a capture still waiting keeps its Idempotency-Key when another clerk takes it", async () => {
    const h = harness(makeStore(), [{ kind: "retry", error: "NETWORK" }]);
    await h.outbox.init();
    const rec = queued(await h.outbox.add(page(SHA_A)));
    await h.outbox.sync(); // the answer was lost: the co-op may already have it from Jessie
    h.pairAs(MARIA);
    expect(await h.outbox.takeOver(rec.id, JESSIE.persona)).toMatchObject({ uploaded: 1 });
    // The same request: if Jessie's attempt reached the co-op, it answers with that filing (inv.i7).
    expect(h.calls.map((c) => c.id)).toEqual([rec.id, rec.id]);
    expect(h.calls[1]).toMatchObject({ as: MARIA.persona, attempt: 2 });
  });

  it("filer.held-upload: a capture the uploader holds back (paired again mid-pass) goes back exactly as it was", async () => {
    const h = harness(makeStore(), [{ kind: "retry", error: "NETWORK" }, { kind: "held" }]);
    await h.outbox.init();
    const rec = queued(await h.outbox.add(page(SHA_A)));
    await h.outbox.sync();
    const before = await only(h);
    expect(before).toMatchObject({ state: "failed", attempts: 1, lastError: "NETWORK" });
    h.advance(retryDelayMs(1));
    expect(await h.outbox.sync()).toMatchObject({ attempted: 0, uploaded: 0, retrying: 0, rejected: 0 });
    expect(await only(h)).toEqual(before);
    expect(h.calls.map((c) => c.id)).toEqual([rec.id, rec.id]);
  });

  it("filer.store-due: the store hands out only the named clerk's due captures, never an unknown filer's", async () => {
    const store = makeStore();
    await store.init();
    const ids = ["0190f0f0-0000-7000-8000-0000000000d1", "0190f0f0-0000-7000-8000-0000000000d2"];
    await store.insert(stored({ id: ids[0] as string, sha256: SHA_A, filedBy: JESSIE }));
    await store.insert(stored({ id: ids[1] as string, sha256: SHA_B, filedBy: MARIA, createdAt: T0 + 1 }));
    await store.insert(stored({ id: "0190f0f0-0000-7000-8000-0000000000d3", sha256: SHA_C, filedBy: null }));
    expect((await store.due(T0, 10, JESSIE.persona)).map((r) => r.id)).toEqual([ids[0]]);
    expect((await store.due(T0, 10, MARIA.persona)).map((r) => r.id)).toEqual([ids[1]]);
    expect(await store.due(T0, 10, "clerk:nobody")).toEqual([]);
    expect(await store.due(T0, 10, "")).toEqual([]);
    // A takeover moves a capture to the clerk who took it, and the filer survives the store whole.
    expect(await store.transition(ids[0] as string, ["queued"], { filedBy: MARIA })).toBe(true);
    expect((await store.due(T0, 10, MARIA.persona)).map((r) => r.id)).toEqual(ids);
    expect((await store.get(ids[0] as string))?.filedBy).toEqual(MARIA);
  });

  it("filer.store-guard: a store that ignores the filer never gets another clerk's capture to the uploader", async () => {
    const store = makeStore();
    const due = store.due.bind(store);
    store.due = (now, limit) => due(now, limit, JESSIE.persona); // a store that forgets to filter
    const h = harness(store);
    await h.outbox.init();
    await h.outbox.add(page(SHA_A));
    h.pairAs(MARIA);
    expect(await h.outbox.sync()).toMatchObject({ attempted: 0 });
    expect(h.calls).toHaveLength(0);
    expect((await only(h)).state).toBe("queued");
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

  it("only an expired token is fixed by pairing again; FORBIDDEN never is", () => {
    expect(EXPIRED_TOKEN_REFUSALS).toEqual(["UNAUTHENTICATED", "FRAME_TOKEN_EXPIRED"]);
    expect(EXPIRED_TOKEN_REFUSALS).not.toContain("FORBIDDEN");
    for (const code of EXPIRED_TOKEN_REFUSALS) expect(AUTH_REFUSALS).toContain(code);
    expect(AUTH_REFUSALS).toContain("FORBIDDEN");
  });
});

describe("filers", () => {
  it("match by persona: the same clerk paired again is the same filer; nobody and unknown match nothing", () => {
    expect(isFiledBy({ filedBy: JESSIE }, JESSIE_AGAIN.persona)).toBe(true);
    expect(isFiledBy({ filedBy: JESSIE }, MARIA.persona)).toBe(false);
    expect(isFiledBy({ filedBy: JESSIE }, null)).toBe(false);
    expect(isFiledBy({ filedBy: null }, JESSIE.persona)).toBe(false);
    expect(isFiledBy({ filedBy: null }, null)).toBe(false);
  });

  it("read back only when whole: anything else is an unknown filer", () => {
    expect(filerOrNull(JESSIE)).toEqual(JESSIE);
    expect(filerOrNull({ ...JESSIE, extra: 1 })).toEqual(JESSIE);
    for (const bad of [
      undefined,
      null,
      "clerk:jessie",
      {},
      { ...JESSIE, persona: "" },
      { ...JESSIE, name: 3 },
    ]) {
      expect(filerOrNull(bad)).toBeNull();
    }
    expect(filerOrNull({ persona: "clerk:jessie", name: "", pairing: "p" })).toEqual({
      persona: "clerk:jessie",
      name: "",
      pairing: "p",
    });
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

  it(`migrates the first build's table to version ${OUTBOX_SCHEMA_VERSION} without losing a capture`, async () => {
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
      filedBy: null, // nobody can say who filed it: it waits for a person
    });
    // Version 2 and 3 features work on the migrated table.
    expect((await h.outbox.add(page(SHA_A, { source: "library" }))).outcome).toBe("queued");
    expect((await h.outbox.add(receipt(SHA_B))).outcome).toBe("queued");
    await h.outbox.init(); // idempotent
    expect(await h.outbox.list()).toHaveLength(3);
    const [v] = await db.all<{ user_version: number }>("PRAGMA user_version", []);
    expect(v?.user_version).toBe(OUTBOX_SCHEMA_VERSION);
  });

  it("filer.migrated: a version 2 table keeps every capture, each with an unknown filer that waits for a person", async () => {
    const db = nodeSqlite();
    // Version 2 exactly as the second build created it (cash receipts, no filer).
    await db.exec(`CREATE TABLE captures (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL DEFAULT 'slip' CHECK (kind IN ('slip','nadawat')),
      sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
      file_uri TEXT NOT NULL, thumb_uri TEXT, mime TEXT NOT NULL, bytes INTEGER NOT NULL CHECK (bytes >= 0),
      width INTEGER, height INTEGER, station TEXT NOT NULL, member_hint TEXT,
      source TEXT NOT NULL CHECK (source IN ('scanner','camera','library','file','sample')),
      line_id TEXT, member_no TEXT, member_name TEXT, cents INTEGER, php_per_usd TEXT, attested_by TEXT,
      created_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('queued','uploading','uploaded','read','failed')),
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, last_error TEXT,
      progress REAL NOT NULL DEFAULT 0, document_id TEXT, duplicate_of TEXT, rows_read INTEGER, serial TEXT,
      uploaded_at INTEGER,
      CHECK (kind = 'slip' OR (line_id IS NOT NULL AND member_no IS NOT NULL AND cents IS NOT NULL
        AND php_per_usd IS NOT NULL AND attested_by IS NOT NULL)));
      CREATE INDEX captures_due ON captures (state, next_attempt_at);
      CREATE UNIQUE INDEX captures_nadawat_line ON captures (line_id) WHERE kind = 'nadawat';
      PRAGMA user_version = 2;`);
    const insert = `INSERT INTO captures (id, kind, sha256, file_uri, mime, bytes, station, source, line_id, member_no,
      member_name, cents, php_per_usd, attested_by, created_at, state, attempts, next_attempt_at, last_error)
      VALUES (?, ?, ?, 'file:///old.jpg', 'image/jpeg', 9, 'Purok 2 pickup', 'scanner', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    // A page refused when its clerk's token expired, and a cash receipt still waiting.
    await db.run(insert, [
      "0190f0f0-0000-7000-8000-0000000000b1",
      "slip",
      SHA_A,
      null,
      null,
      null,
      null,
      null,
      null,
      T0,
      "failed",
      1,
      MANUAL_ONLY,
      "UNAUTHENTICATED",
    ]);
    await db.run(insert, [
      "0190f0f0-0000-7000-8000-0000000000b2",
      "nadawat",
      SHA_B,
      MERLYN.lineId,
      MERLYN.memberNo,
      MERLYN.memberName,
      MERLYN.cents,
      MERLYN.phpPerUsd,
      MERLYN.attestedBy,
      T0 + 10,
      "queued",
      0,
      T0,
      null,
    ]);
    const store = new SqliteOutboxStore(db);
    const h = harness(store);
    await h.outbox.init();
    const [v] = await db.all<{ user_version: number }>("PRAGMA user_version", []);
    expect(v?.user_version).toBe(OUTBOX_SCHEMA_VERSION);
    const list = await h.outbox.list();
    expect(list).toHaveLength(2);
    expect(list.find((r) => r.sha256 === SHA_A)).toMatchObject({
      state: "failed",
      lastError: "UNAUTHENTICATED",
      filedBy: null,
    });
    expect(list.find((r) => r.sha256 === SHA_B)).toMatchObject({
      kind: "nadawat",
      nadawat: MERLYN,
      state: "queued",
      filedBy: null,
    });

    // Unknown is nobody: neither re-pairing, the queue, nor "Ipadala tanan" sends them.
    await h.outbox.afterPairing();
    await h.outbox.sync();
    await h.outbox.sendAll();
    expect(h.calls).toHaveLength(0);

    // A person takes them over after the screen said who filed them was not kept.
    expect(await h.outbox.takeOver("0190f0f0-0000-7000-8000-0000000000b2", null)).toMatchObject({
      uploaded: 1,
    });
    expect(h.calls[0]).toMatchObject({ sha: SHA_B, filedBy: JESSIE.persona, as: JESSIE.persona });
    expect((await h.store.findNadawat(MERLYN.lineId))?.filedBy).toEqual(JESSIE);
    await h.outbox.init(); // idempotent on the migrated table
    expect(await h.outbox.list()).toHaveLength(2);
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
  /** The phone is paired again (Jessie, Jessie with a new token, Maria, or nobody), then the outbox is told so. */
  | { op: "pairAs"; who: number }
  | { op: "takeOver"; pick: number }
  | { op: "discard"; pick: number }
  | { op: "read"; pick: number }
  | { op: "crash" };

const SHAS = Array.from({ length: 6 }, (_, i) => String.fromCharCode(97 + i).repeat(64));
const PAIRINGS: readonly (Filer | null)[] = [JESSIE, JESSIE_AGAIN, MARIA, null];

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant("add" as const), sha: fc.nat(5), nadawat: fc.boolean() }),
  fc.constant({ op: "sync" as const }),
  fc.record({ op: fc.constant("online" as const), v: fc.boolean() }),
  fc.record({ op: fc.constant("advance" as const), ms: fc.integer({ min: 0, max: 400_000 }) }),
  fc.record({ op: fc.constant("sendNow" as const), pick: fc.nat(10) }),
  fc.constant({ op: "sendAll" as const }),
  fc.record({ op: fc.constant("pairAs" as const), who: fc.nat(PAIRINGS.length - 1) }),
  fc.record({ op: fc.constant("takeOver" as const), pick: fc.nat(10) }),
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
  fc.constant({ kind: "reject" as const, error: "FORBIDDEN" }),
  fc.constant({ kind: "reject" as const, error: "TOO_LARGE" }),
  fc.constant({ kind: "held" as const }),
  fc.constant("throw" as const),
);

/**
 * Operations in which a refused capture may get a new key: a person's resend, re-pairing (only for the clerk who
 * filed it, and only after an expired token), a takeover, or filing it again.
 */
const REKEYING: ReadonlySet<Op["op"]> = new Set(["sendNow", "sendAll", "pairAs", "takeOver", "add"]);

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
          let filer: Filer | null = JESSIE;
          const script = [...outcomes];
          const uploadedOk = new Set<string>();
          const refusedWith = new Map<string, string>(); // id → the co-op's refusal code
          const keyOf = new Map<string, string>(); // sha → the id it is filed under now
          const retired = new Set<string>(); // keys a refusal used up: never sent again
          const bestRank = new Map<string, number>();
          /** Uploads that would have left under a pairing other than the filer's (asserted after each step). */
          const misattributed: string[] = [];

          /** A capture's key changes only when a person acts on a refusal that allows it (never by a timer). */
          const adopt = (sha: string, id: string) => {
            const prev = keyOf.get(sha);
            if (prev === id) return;
            if (prev !== undefined) {
              expect(REKEYING.has(op)).toBe(true);
              const code = refusedWith.get(prev);
              expect(code).toBeDefined();
              if (op !== "add") expect(isFinalRefusal(code ?? null)).toBe(false);
              if (op === "pairAs") expect(EXPIRED_TOKEN_REFUSALS).toContain(code);
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
              filer: () => filer,
              uploader: async (rec, onProgress) => {
                // The security property: nothing leaves under a pairing other than that of the clerk who filed it.
                if (!filer || rec.filedBy?.persona !== filer.persona) misattributed.push(rec.id);
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
              case "pairAs":
                filer = PAIRINGS[step.who] ?? null;
                await outbox.afterPairing();
                break;
              case "takeOver": {
                // The person confirms after the screen showed who filed it.
                const r = pick(step.pick);
                if (r) await outbox.takeOver(r.id, r.filedBy?.persona ?? null);
                break;
              }
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
            expect(misattributed).toEqual([]);
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
