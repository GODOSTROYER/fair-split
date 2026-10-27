import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { SCREEN_STATES } from "../../_shims/contracts";
import { type CaptureRecord, MANUAL_ONLY } from "../../lib/outbox";
import type { PairedSession } from "../../services/session";
import {
  canRemove,
  canSendNow,
  hintOf,
  metaOf,
  receiptAdviceOf,
  refusalOf,
  refusedSince,
  ringOf,
  sectionsOf,
  sendableCount,
  settledSince,
  statusOf,
  tallyOf,
  titleOf,
} from "./capture-view";
import { clerkSite, DEMO_STATION, sessionText } from "./clerk-site";
import { type ClerkKey, messages, t } from "./messages";
import { DARK_BYTES_PER_PIXEL, MIN_LONG_EDGE, qualityIssue } from "./quality";
import { nextSampleSerial, SAMPLE_SERIALS, sampleBySha, sampleNadawat, sampleSlip } from "./samples";
import { outboxScreenState, type ScanEvent, scanScreenState } from "./screen-state";

const NOW = Date.parse("2026-10-27T02:00:00Z"); // 10:00 in Calinan
let n = 0;

function rec(over: Partial<CaptureRecord> = {}): CaptureRecord {
  n++;
  return {
    id: `0190f0f0-0000-7000-8000-${String(n).padStart(12, "0")}`,
    kind: "slip",
    sha256: String(n % 10).repeat(64),
    fileUri: "file:///c.jpg",
    thumbUri: null,
    mime: "image/jpeg",
    bytes: 412_000,
    width: 1600,
    height: 1200,
    station: "Purok 2 pickup",
    memberHint: null,
    source: "scanner",
    nadawat: null,
    createdAt: NOW - 60_000,
    state: "queued",
    attempts: 0,
    nextAttemptAt: NOW - 60_000,
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

const known = (key: string) => key in messages;

describe("capture view", () => {
  it("draws a ring and words for every state, never by colour alone", () => {
    const cases: [Partial<CaptureRecord>, string, string][] = [
      [{ state: "queued" }, "waiting", "M-CL-02.queued"],
      [{ state: "uploading", progress: 0.456 }, "sending", "M-CL-02.uploading"],
      [{ state: "uploaded", uploadedAt: NOW }, "sent", "M-CL-02.uploaded"],
      [{ state: "read", rowsRead: 4 }, "read", "M-CL-02.read.other"],
      [{ state: "read", rowsRead: 1 }, "read", "M-CL-02.read.one"],
      [{ state: "failed", nextAttemptAt: NOW + 40_000 }, "retrying", "M-CL-02.retryIn"],
      [
        { state: "failed", nextAttemptAt: MANUAL_ONLY, lastError: "IDEMPOTENCY_KEY_REUSED" },
        "refused",
        "M-CL-02.refused",
      ],
    ];
    for (const [over, ring, key] of cases) {
      const r = rec(over);
      expect(ringOf(r)).toBe(ring);
      const s = statusOf(r, NOW, true, "Analyn");
      expect(s.key).toBe(key);
      expect(known(s.key)).toBe(true);
    }
    expect(statusOf(rec({ state: "uploading", progress: 0.456 }), NOW, true, "Analyn").args).toEqual({
      pct: 46,
    });
  });

  it("counts down the retry live, in seconds then minutes, and says when signal is the wait", () => {
    const r = rec({ state: "failed", nextAttemptAt: NOW + 40_000, lastError: "503" });
    expect(statusOf(r, NOW, true, "Analyn")).toMatchObject({ key: "M-CL-02.retryIn", args: { s: 40 } });
    expect(statusOf(r, NOW + 39_001, true, "Analyn")).toMatchObject({
      key: "M-CL-02.retryIn",
      args: { s: 1 },
    });
    expect(statusOf(r, NOW + 40_000, true, "Analyn").key).toBe("M-CL-02.retryNow");
    expect(
      statusOf(rec({ state: "failed", nextAttemptAt: NOW + 300_000 }), NOW, true, "Analyn"),
    ).toMatchObject({
      key: "M-CL-02.retryInMin",
      args: { m: 5 },
    });
    expect(statusOf(r, NOW, false, "Analyn").key).toBe("M-CL-02.retryOffline");
    expect(statusOf(rec({ state: "queued" }), NOW, false, null).key).toBe("M-CL-02.queuedOffline");
  });

  it("words each refusal so the clerk knows what to do, in canary, never red", () => {
    const why = (
      lastError: string,
      kind: CaptureRecord["kind"] = "slip",
      treasurer: string | null = "Analyn",
    ) => refusalOf(rec({ state: "failed", nextAttemptAt: MANUAL_ONLY, lastError, kind }), treasurer);
    expect(why("UNAUTHENTICATED").key).toBe("M-CL-02.refusedAuth");
    expect(why("FORBIDDEN").key).toBe("M-CL-02.refusedAuth");
    expect(why("FILE_MISSING").key).toBe("M-CL-02.refusedMissing");
    expect(why("FILE_MISSING", "nadawat").key).toBe("M-CL-02.refusedMissingReceipt");
    expect(why("TOO_LARGE").key).toBe("M-CL-02.refusedTooLarge");
    expect(why("TOO_LARGE", "nadawat").key).toBe("M-CL-02.refusedTooLargeReceipt");
    expect(why("JUDGE_SAMPLES_ONLY").key).toBe("M-CL-02.refusedSamplesOnly");
    expect(why("LINE_ALREADY_RECEIVED", "nadawat").key).toBe("M-CL-02.refusedReceived");
    expect(why("LINE_NOT_DUE", "nadawat")).toMatchObject({
      key: "M-CL-02.refusedLine",
      args: { treasurer: "Analyn" },
    });
    expect(why("LINE_NOT_DUE", "slip")).toMatchObject({
      key: "M-CL-02.refused",
      args: { code: "LINE_NOT_DUE", treasurer: "Analyn" },
    });
    for (const code of ["UNAUTHENTICATED", "FILE_MISSING", "422"]) expect(why(code).tone).toBe("canaryText");
    // Every refusal that names the treasurer has a twin for a co-op that has not named her.
    for (const key of ["M-CL-02.refusedLine", "M-CL-02.refused"]) expect(known(`${key}Anon`)).toBe(true);
  });

  it("never names a treasurer the co-op did not name", () => {
    const refused = (lastError: string, kind: CaptureRecord["kind"] = "slip") =>
      rec({ state: "failed", nextAttemptAt: MANUAL_ONLY, lastError, kind });
    expect(refusalOf(refused("422"), null)).toEqual({
      key: "M-CL-02.refusedAnon",
      args: { code: "422" },
      tone: "canaryText",
    });
    expect(refusalOf(refused("LINE_HELD", "nadawat"), null).key).toBe("M-CL-02.refusedLineAnon");
    expect(refusalOf(refused(""), null).args).toEqual({ code: "?" });
    expect(statusOf(refused("409"), NOW, true, null).key).toBe("M-CL-02.refusedAnon");
  });

  it("gives the receipt sheet advice under its own lead, never 'didn't accept' twice", () => {
    const receipt = (lastError: string) =>
      rec({ kind: "nadawat", state: "failed", nextAttemptAt: MANUAL_ONLY, lastError });
    expect(receiptAdviceOf(receipt("422"), "Analyn")).toEqual({
      key: "M-CL-01.nadawat.refusedTry",
      args: { code: "422", treasurer: "Analyn" },
      tone: "canaryText",
    });
    expect(receiptAdviceOf(receipt("422"), null).key).toBe("M-CL-01.nadawat.refusedTryAnon");
    expect(receiptAdviceOf(receipt("UNAUTHENTICATED"), null).key).toBe("M-CL-02.refusedAuth");
    expect(receiptAdviceOf(receipt("FILE_MISSING"), null).key).toBe("M-CL-02.refusedMissingReceipt");
    for (const k of ["M-CL-01.nadawat.refusedTry", "M-CL-01.nadawat.refusedTryAnon"]) {
      expect(t("en", k as ClerkKey, { code: "422", treasurer: "Analyn" })).not.toMatch(/accept/);
    }
  });

  it("titles a page by its serial once read, and a receipt by the member", () => {
    expect(titleOf(rec())).toEqual({ key: "M-CL-02.notRead" });
    expect(titleOf(rec({ serial: "0403" }))).toEqual({ key: "M-CL-02.serial", args: { serial: "0403" } });
    const receipt = rec({
      kind: "nadawat",
      nadawat: {
        lineId: "l",
        memberNo: "M-053",
        memberName: "Merlyn Ponce",
        cents: 12784,
        phpPerUsd: "62.50",
        attestedBy: "JD",
      },
    });
    expect(titleOf(receipt)).toEqual({ key: "M-CL-02.nadawat", args: { name: "Merlyn Ponce" } });
    expect(statusOf({ ...receipt, state: "uploaded", uploadedAt: NOW }, NOW, true, "Analyn").key).toBe(
      "M-CL-02.recorded",
    );
  });

  it("adds a second line only when it helps", () => {
    expect(hintOf(rec({ state: "failed", nextAttemptAt: NOW + 1, lastError: "NOT_OUR_SERVER" }))?.key).toBe(
      "M-CL-02.hintPortal",
    );
    expect(hintOf(rec({ state: "read", rowsRead: 4 }))).toMatchObject({
      key: "M-CL-02.readBy",
      tone: "pencil",
    });
    expect(hintOf(rec({ state: "uploaded", duplicateOf: "doc-1" }))?.key).toBe("M-CL-02.duplicateOf");
    expect(hintOf(rec({ state: "queued" }))).toBeNull();
    expect(metaOf(rec({ bytes: 412_000, createdAt: NOW }))).toEqual({ size: "412 KB", time: "10:00" });
  });

  it("offers Send now to a retry and to a refusal a resend can fix, never to one it cannot", () => {
    const refused = (lastError: string | null) =>
      rec({ state: "failed", nextAttemptAt: MANUAL_ONLY, lastError });
    expect(canSendNow(rec({ state: "failed", nextAttemptAt: NOW + 1, lastError: "503" }))).toBe(true);
    for (const code of ["UNAUTHENTICATED", "FORBIDDEN", "422", "IDEMPOTENCY_KEY_REUSED", null]) {
      expect(canSendNow(refused(code))).toBe(true);
    }
    for (const code of [
      "FILE_MISSING",
      "TOO_LARGE",
      "SAMPLES_ONLY",
      "JUDGE_SAMPLES_ONLY",
      "LINE_NOT_DUE",
      "LINE_HELD",
      "LINE_ALREADY_RECEIVED",
    ]) {
      expect(canSendNow(refused(code))).toBe(false);
    }
    for (const state of ["queued", "uploading", "uploaded", "read"] as const) {
      expect(canSendNow(rec({ state }))).toBe(false);
    }
  });

  it("offers removal only for a refusal, and counts what Send all would send", () => {
    const refusedFinal = rec({ state: "failed", nextAttemptAt: MANUAL_ONLY, lastError: "TOO_LARGE" });
    const refusedAuth = rec({ state: "failed", nextAttemptAt: MANUAL_ONLY, lastError: "UNAUTHENTICATED" });
    const retrying = rec({ state: "failed", nextAttemptAt: NOW + 1 });
    expect(canRemove(refusedFinal)).toBe(true);
    expect(canRemove(refusedAuth)).toBe(true);
    for (const r of [
      retrying,
      rec({ state: "queued" }),
      rec({ state: "uploaded" }),
      rec({ state: "read" }),
    ]) {
      expect(canRemove(r)).toBe(false);
    }
    expect(sendableCount([refusedFinal, refusedAuth, retrying, rec({ state: "queued" })])).toBe(2);
    expect(sendableCount([refusedFinal])).toBe(0); // "Ipadala tanan karon" is hidden
  });

  it("notices captures the co-op just refused, once", () => {
    const a = rec({ state: "uploading" });
    const b = rec({ state: "failed", nextAttemptAt: MANUAL_ONLY, lastError: "422" });
    const c = rec({ state: "uploading" });
    const next = [
      { ...a, state: "failed" as const, nextAttemptAt: MANUAL_ONLY, lastError: "LINE_NOT_DUE" },
      b, // was already refused
      { ...c, state: "failed" as const, nextAttemptAt: NOW + 20_000 }, // a retry, not a refusal
      rec({ state: "failed", nextAttemptAt: MANUAL_ONLY }), // new to the list
    ];
    expect(refusedSince([a, b, c], next).map((r) => r.id)).toEqual([a.id]);
  });
});

describe("the clerk's site: station, treasurer and stamp from data", () => {
  // Plain records: a persisted session may carry a malformed field (`station: 7`) that `PairedSession` itself forbids.
  const live = (over: Record<string, unknown> = {}): PairedSession =>
    ({
      kind: "device",
      bearer: "dev_token_for_tests",
      expiresAt: "2026-11-30T00:00:00Z",
      workspaceId: "ws_live",
      persona: "clerk:x",
      role: "clerk",
      memberNo: null,
      displayName: "Rosalie T. Ompoc",
      lang: null,
      pairedAt: "2026-10-27T00:00:00Z",
      ...over,
    }) as PairedSession;

  it("takes the pairing first, then the co-op's cash-day answer", () => {
    expect(
      clerkSite({
        session: live({ station: " Purok 4 pickup ", treasurerName: "Lorna" }),
        demo: false,
        day: { station: "Bodega", treasurer: { first: "Analyn" } },
      }),
    ).toEqual({ station: "Purok 4 pickup", treasurer: "Lorna", initials: "RO" });
    expect(
      clerkSite({ session: live(), demo: false, day: { station: "Bodega", treasurer: { first: "Analyn" } } }),
    ).toEqual({ station: "Bodega", treasurer: "Analyn", initials: "RO" });
  });

  it("never falls back to the seed on a live phone: no station chip, 'the treasurer', and no stamp without a name", () => {
    expect(clerkSite({ session: live({ displayName: "" }), demo: false, day: null })).toEqual({
      station: null,
      treasurer: null,
      initials: null,
    });
    expect(clerkSite({ session: null, demo: false, day: null }).initials).toBeNull();
    expect(sessionText(live({ station: 7 }), "station")).toBeNull();
    expect(sessionText(live({ treasurerName: "  " }), "treasurerName")).toBeNull();
  });

  it("uses the seed's people and the spec's station on demo data only", () => {
    expect(clerkSite({ session: live({ displayName: "" }), demo: true, day: null })).toEqual({
      station: DEMO_STATION,
      treasurer: "Analyn",
      initials: "JD",
    });
    // A demo session still prefers what it carries.
    expect(clerkSite({ session: live(), demo: true, day: null }).initials).toBe("RO");
  });
});

describe("tally and sections", () => {
  const yesterday = NOW - 24 * 3600_000;
  const records = [
    rec({ state: "read", createdAt: NOW - 50_000, rowsRead: 4 }),
    rec({ state: "queued", createdAt: NOW - 10_000 }),
    rec({ state: "uploading", createdAt: NOW - 20_000, progress: 0.5 }),
    rec({ state: "uploaded", createdAt: yesterday }),
    rec({ state: "failed", createdAt: NOW - 30_000, nextAttemptAt: MANUAL_ONLY }),
    rec({
      kind: "nadawat",
      state: "queued",
      createdAt: NOW - 5_000,
      nadawat: {
        lineId: "l",
        memberNo: "M-053",
        memberName: "M",
        cents: 1,
        phpPerUsd: "62.50",
        attestedBy: "JD",
      },
    }),
  ];

  it("draws today's slips oldest first, so the rings close left to right", () => {
    const t = tallyOf(records, NOW);
    expect(t.rings.map((r) => r.tone)).toEqual(["read", "refused", "sending", "waiting"]);
    expect(t.hidden).toBe(0);
    expect(t.counts).toMatchObject({ total: 4, onPhone: 3, sent: 1 });
    const many = tallyOf(
      Array.from({ length: 30 }, (_, i) => rec({ createdAt: NOW - (30 - i) * 1000 })),
      NOW,
      24,
    );
    expect(many.rings).toHaveLength(24);
    expect(many.hidden).toBe(6);
  });

  it("orders the outbox: what goes next first, then today's, then earlier", () => {
    const s = sectionsOf(records, NOW);
    expect(s.phone.map((r) => r.kind === "nadawat" || r.state)).toEqual([
      true,
      "failed",
      "uploading",
      "queued",
    ]);
    expect(s.today.map((r) => r.state)).toEqual(["read"]);
    expect(s.earlier.map((r) => r.createdAt)).toEqual([yesterday]);
  });

  it("notices only the captures that just reached the co-op", () => {
    const a = rec({ state: "uploading" });
    const b = rec({ state: "uploaded" });
    const next = [
      { ...a, state: "uploaded" as const },
      { ...b, state: "read" as const },
      rec({ state: "uploaded" }), // new, not a transition
    ];
    expect(settledSince([a, b], next).map((r) => r.id)).toEqual([a.id]);
  });
});

describe("screen states", () => {
  const states01 = SCREEN_STATES["M-CL-01"] as readonly string[];
  const states02 = SCREEN_STATES["M-CL-02"] as readonly string[];

  it("M-CL-01 follows one precedence and only uses IC-01's states", () => {
    const base = {
      online: true,
      busy: false,
      event: null as ScanEvent | null,
      records: [] as CaptureRecord[],
    };
    const cases: [Partial<typeof base>, string][] = [
      [{}, "ready"],
      [{ busy: true, online: false, event: "quality" }, "scanning"],
      [{ event: "duplicate-file", online: false }, "duplicate-file"],
      [{ event: "camera-denied" }, "camera-denied"],
      [{ event: "unavailable" }, "unavailable"],
      [{ online: false, records: [rec({ state: "uploading" })] }, "offline"],
      [{ records: [rec({ state: "failed" }), rec({ state: "uploading" })] }, "uploading"],
      [{ records: [rec({ state: "failed" }), rec({ state: "read" })] }, "failed"],
      [{ records: [rec({ state: "read" }), rec({ state: "uploaded" })] }, "read"],
      [{ records: [rec({ state: "uploaded" }), rec({ state: "read" })] }, "uploaded"],
      [{ records: [rec({ state: "queued" })] }, "ready"],
    ];
    for (const [over, want] of cases) {
      const got = scanScreenState({ ...base, ...over });
      expect(got).toBe(want);
      expect(states01).toContain(got);
    }
  });

  it("M-CL-02: empty, offline, syncing, online", () => {
    expect(outboxScreenState({ online: false, records: [] })).toBe("empty");
    expect(outboxScreenState({ online: false, records: [rec()] })).toBe("offline");
    expect(outboxScreenState({ online: true, records: [rec({ state: "uploading" })] })).toBe("syncing");
    expect(outboxScreenState({ online: true, records: [rec({ state: "read" })] })).toBe("online");
    for (const s of ["empty", "offline", "syncing", "online"]) expect(states02).toContain(s);
  });
});

describe("quality gate", () => {
  it("asks for a rescan of a dark or tiny JPEG, and judges nothing else", () => {
    const px = 1600 * 1200;
    expect(
      qualityIssue({
        mime: "image/jpeg",
        bytes: Math.floor(px * DARK_BYTES_PER_PIXEL) - 1,
        width: 1600,
        height: 1200,
      }),
    ).toBe("dark");
    expect(qualityIssue({ mime: "image/jpeg", bytes: 180_000, width: 1600, height: 1200 })).toBeNull();
    expect(qualityIssue({ mime: "image/jpeg", bytes: 90_000, width: MIN_LONG_EDGE - 1, height: 500 })).toBe(
      "small",
    );
    expect(qualityIssue({ mime: "image/svg+xml", bytes: 10, width: 420, height: 592 })).toBeNull();
    expect(qualityIssue({ mime: "image/jpeg", bytes: 10, width: null, height: null })).toBeNull();
  });
});

describe("sample slips", () => {
  it("are deterministic, distinct, hashed over their exact bytes, and labelled", () => {
    const seen = new Set<string>();
    for (const serial of SAMPLE_SERIALS) {
      const s = sampleSlip(serial);
      expect(s.sha256).toBe(bytesToHex(sha256(s.bytes)));
      expect(new TextDecoder().decode(s.bytes)).toBe(s.svg);
      expect(s.svg).toContain("Synthetic sample");
      expect(s.svg).toContain(`No. ${serial}`);
      expect(decodeURIComponent(s.dataUri.split(",")[1] ?? "")).toBe(s.svg);
      expect(sampleBySha(s.sha256)?.serial).toBe(serial);
      seen.add(s.sha256);
    }
    expect(seen.size).toBe(SAMPLE_SERIALS.length);
    expect(sampleSlip("0564")).toBe(sampleSlip("0564"));
    expect(sampleBySha("f".repeat(64))).toBeNull();
    expect(() => sampleSlip("0403")).toThrow();
  });

  it("are offered in turn, then the first again (which then reads as already sent)", () => {
    const sha = (serial: string) => ({ sha256: sampleSlip(serial).sha256 });
    expect(nextSampleSerial([])).toBe("0564");
    expect(nextSampleSerial([sha("0564")])).toBe("0565");
    expect(nextSampleSerial([sha("0564"), sha("0565")])).toBe("0566");
    expect(nextSampleSerial(SAMPLE_SERIALS.map(sha))).toBe("0564");
  });

  it("draw a labelled Nadawat photo for each cash line, with its exact pesos, different for every line", () => {
    const merlyn = sampleNadawat({ memberNo: "M-053", name: "Merlyn Ponce", cents: 12784 }, "62.50");
    const rhea = sampleNadawat({ memberNo: "M-031", name: "Rhea Jumawan", cents: 2665 }, "62.50");
    expect(merlyn.svg).toContain("Synthetic sample");
    expect(merlyn.svg).toContain("Nadawat");
    expect(merlyn.svg).toContain("₱7,990.00"); // register §2: exact at the run rate
    expect(merlyn.sha256).toBe(bytesToHex(sha256(merlyn.bytes)));
    expect(merlyn.key).toBe("nadawat-M-053");
    expect(rhea.sha256).not.toBe(merlyn.sha256);
    expect(sampleNadawat({ memberNo: "M-053", name: "Merlyn Ponce", cents: 12784 }, "62.50").sha256).toBe(
      merlyn.sha256,
    );
    expect(sampleBySha(merlyn.sha256)).toBeNull(); // never read back as a slip
  });

  it("belong to the next pay run: serials after Season 2026-A's 0301–0563", () => {
    for (const serial of SAMPLE_SERIALS) expect(Number(serial)).toBeGreaterThan(563);
  });

  it("carry plausible, derived kilos with net = gross − tare", () => {
    for (const serial of SAMPLE_SERIALS) {
      const s = sampleSlip(serial);
      expect(s.netGrams).toBeGreaterThanOrEqual(15_000);
      expect(s.netGrams).toBeLessThan(55_000);
      expect(s.netGrams % 10).toBe(0);
      expect(s.svg).toContain((s.netGrams / 1000).toFixed(2));
      expect(s.svg).toContain(((s.netGrams + s.tareGrams) / 1000).toFixed(2));
    }
  });
});
