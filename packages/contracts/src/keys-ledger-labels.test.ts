// Key IDs (S3.8), the ledger payloads the Proof binds (S3.12), the approval error codes, and the
// label fallbacks: a missing officer name never leaves English filler in Cebuano or Filipino.
import { describe, expect, it } from "vitest";
import {
  API_COMMANDS,
  ApprovalPayload,
  DEVICE_KEY_ID_PATTERN,
  DEVICE_KEY_ID_PATTERN_BY_KIND,
  DeviceKey,
  DeviceKeyId,
  DeviceKeyKind,
  deviceKeyIdFitsKind,
  ERROR_HTTP_STATUS,
  HOLD_GATE_LABELS,
  HOLD_KIND_LABELS,
  HOLD_STATE_LABELS,
  INVOICE_STATUS_LABELS,
  isSeededKeyId,
  KEY_ID_PATTERN_BY_KIND,
  KEY_ID_PATTERNS,
  KeyId,
  keyIdFitsKind,
  LANGS,
  type LabelVars,
  LedgerKey,
  LedgerKeyId,
  LedgerPayloads,
  ledgerKeyIdFitsKind,
  MEMBER_LINE_LABELS,
  OfficerKey,
  PAYOUT_ITEM_STATUS_LABELS,
  PROOF_LEDGER_KINDS,
  PROVENANCE_LABELS,
  PublishedKeys,
  pickLabel,
  RAIL_LABELS,
  ROLE_NOUNS,
  RUN_STATE_LABELS,
  RUN_STRIP_LABELS,
  SAMPLE_KEY_KINDS,
  SeededKeyId,
  SignedApproval,
  SigningKeyKind,
  SnapshotOfficer,
  SubmitApprovalRequest,
  type Words,
} from "./index.js";

const H = (c: string) => c.repeat(64);

const payload = {
  v: 1,
  runId: "run-1",
  seasonId: "season-1",
  rateCardSha256: H("a"),
  batchSha256: H("b"),
  linesDigest: H("c"),
  itemCount: 8,
  totalCents: 36_839,
  currency: "USD",
  role: "chair",
  approverId: "board:ernesto",
  nonce: "nonce-0001",
  exp: "2026-10-29T02:40:31.000Z",
} as const;

describe("key IDs: device keys sign, seeded keys never do (S3.8)", () => {
  it("separates device keys (a, w, C-13 demo) from seeded keys (s) and ledger keys", () => {
    for (const id of [
      "fs-ernesto-a1",
      "fs-analyn-a2",
      "fs-analyn-w1",
      "fs-ernesto-w3",
      "fs-ernesto-a9999",
      "fs-ernesto-demo-abc123",
      "fs-analyn-demo-000000",
    ]) {
      expect(DeviceKeyId.safeParse(id).success, id).toBe(true);
      expect(KeyId.safeParse(id).success, id).toBe(true);
      expect(LedgerKeyId.safeParse(id).success, id).toBe(false);
      expect(isSeededKeyId(id), id).toBe(false);
    }
    for (const id of ["fs-ernesto-s1", "fs-analyn-s1"]) {
      expect(SeededKeyId.safeParse(id).success, id).toBe(true);
      expect(KeyId.safeParse(id).success, id).toBe(true);
      expect(DeviceKeyId.safeParse(id).success, id).toBe(false);
      expect(isSeededKeyId(id), id).toBe(true);
    }
    for (const id of ["fs-ledger-k1", "fs-ledger-k12", "fs-ledger-s1"]) {
      expect(LedgerKeyId.safeParse(id).success, id).toBe(true);
      // A ledger key ID is never an officer's: no approval can carry one.
      expect(KeyId.safeParse(id).success, id).toBe(false);
      expect(DeviceKeyId.safeParse(id).success, id).toBe(false);
    }
    expect(isSeededKeyId("fs-ledger-s1")).toBe(true);
    expect(isSeededKeyId("fs-ledger-k1")).toBe(false);
  });

  it("every key ID shape is anchored lowercase ASCII with bounded parts", () => {
    const P = KEY_ID_PATTERNS;
    expect(P.app.test("fs-ernesto-a1")).toBe(true);
    expect(P.web.test("fs-analyn-w1")).toBe(true);
    expect(P.demo.test("fs-ernesto-demo-a1b2c3")).toBe(true);
    expect(P.seeded.test("fs-analyn-s1")).toBe(true);
    expect(P.ledger.test("fs-ledger-k1")).toBe(true);
    expect(P.seededLedger.test("fs-ledger-s1")).toBe(true);
    for (const id of [
      "fs-ernesto-x1",
      "fs-Ernesto-a1",
      "ernesto-a1",
      "fs-ernesto-a",
      "fs-ernesto-a0",
      "fs-ernesto-a01",
      "fs-ernesto-a10000",
      `fs-${"a".repeat(25)}-a1`,
      "fs-ernesto-a1\n",
      " fs-ernesto-a1",
      "fs-ernesto-a1 ",
      "fs-\u0435rnesto-a1",
      "fs-ernesto-\uFF411",
      "fs-ernesto-demo-abc12",
      "fs-ernesto-demo-abc1234",
      "fs-ernesto-demo-ABC123",
      "fs-ernesto-demo-",
      "fs-ledger-a1",
      "fs-ledger-demo-abc123",
      "fs-demo-a1",
      "fs-demo-demo-abc123",
      "fs-ledger-k0",
      "fs-ledger-x1",
    ]) {
      expect(KeyId.safeParse(id).success, JSON.stringify(id)).toBe(false);
      expect(DeviceKeyId.safeParse(id).success, JSON.stringify(id)).toBe(false);
      expect(SeededKeyId.safeParse(id).success, JSON.stringify(id)).toBe(false);
      expect(LedgerKeyId.safeParse(id).success, JSON.stringify(id)).toBe(false);
    }
  });

  it("device_keys derives its CHECKs from here: one pattern string the database can use, one ID shape per kind", () => {
    // A plain string that is also a PostgreSQL ARE: `key_id ~ DEVICE_KEY_ID_PATTERN`.
    expect(typeof DEVICE_KEY_ID_PATTERN).toBe("string");
    const strings = [DEVICE_KEY_ID_PATTERN, ...Object.values(DEVICE_KEY_ID_PATTERN_BY_KIND)];
    for (const s of strings) {
      // Only syntax both engines read the same way: no class escapes, word boundaries, lookbehind or
      // inline flags, and anchored at both ends.
      expect(s, s).not.toMatch(/\\[dDwWsSbB]|\(\?<|\(\?[a-z]/);
      expect(s.startsWith("^") && s.endsWith("$"), s).toBe(true);
    }
    const db = new RegExp(DEVICE_KEY_ID_PATTERN);
    // The review's probe IDs: the old CHECK '^fs-[a-z0-9]+-[aw][0-9]+$' disagreed with DeviceKeyId on each.
    const probes: [string, boolean][] = [
      ["fs-ernesto-demo-abc123", true],
      ["fs-analyn-demo-000000", true],
      ["fs-ernesto-demo-a1b2c3", true],
      ["fs-analyn-w1", true],
      ["fs-ernesto-a1", true],
      ["fs-ernesto-a9999", true],
      ["fs-ledger-a1", false],
      ["fs-demo-w1", false],
      ["fs-ernesto-a0", false],
      ["fs-ernesto-a01", false],
      ["fs-x9-a1", false],
      ["fs-judge1-w1", false],
      ["fs-ernesto-a123456", false],
      ["fs-ernesto-a10000", false],
      [`fs-${"a".repeat(30)}-a1`, false],
      ["fs-ernesto-s1", false],
      ["fs-ledger-k1", false],
    ];
    for (const [id, ok] of probes) {
      expect(db.test(id), id).toBe(ok);
      expect(DeviceKeyId.safeParse(id).success, id).toBe(ok);
      // A device key ID fits exactly one kind; anything else fits none.
      const kinds = DeviceKeyKind.options.filter((k) => deviceKeyIdFitsKind(k, id));
      expect(kinds.length, id).toBe(ok ? 1 : 0);
      for (const k of DeviceKeyKind.options) {
        expect(new RegExp(DEVICE_KEY_ID_PATTERN_BY_KIND[k]).test(id), `${k} ${id}`).toBe(
          deviceKeyIdFitsKind(k, id),
        );
      }
    }
    expect(Object.keys(DEVICE_KEY_ID_PATTERN_BY_KIND).sort()).toEqual([...DeviceKeyKind.options].sort());
    // The treasurer's real WebCrypto key is `web`; a judge-session key is `web_demo` with a C-13 demo
    // ID, so it can never take the treasurer's ID.
    expect(deviceKeyIdFitsKind("web", "fs-analyn-w1")).toBe(true);
    expect(deviceKeyIdFitsKind("app", "fs-ernesto-a1")).toBe(true);
    expect(deviceKeyIdFitsKind("web_demo", "fs-ernesto-demo-a1b2c3")).toBe(true);
    for (const [kind, id] of [
      ["web_demo", "fs-analyn-w1"],
      ["app", "fs-analyn-w1"],
      ["web", "fs-ernesto-a1"],
      ["web", "fs-ernesto-demo-a1b2c3"],
      ["seeded", "fs-ernesto-s1"],
      ["server", "fs-ledger-k1"],
      ["toString", "fs-ernesto-a1"],
    ] as const) {
      expect(deviceKeyIdFitsKind(kind, id), `${kind} ${id}`).toBe(false);
    }
  });

  it("the API and device_keys refuse a seeded key; a signed approval may carry one", () => {
    const req = { role: "chair", signature: "c".repeat(128), payload };
    expect(SubmitApprovalRequest.safeParse({ ...req, keyId: "fs-ernesto-a1" }).success).toBe(true);
    expect(SubmitApprovalRequest.safeParse({ ...req, keyId: "fs-ernesto-s1" }).success).toBe(false);
    const key = {
      id: "0192d5a0-0000-7000-8000-000000000001",
      workspaceId: "0192d5a0-0000-7000-8000-000000000002",
      keyId: "fs-ernesto-s1",
      persona: "board:ernesto",
      publicKeyHex: H("d"),
      kind: "app",
      label: "Phone key",
      revokedAt: null,
    };
    expect(DeviceKey.safeParse(key).success).toBe(false);
    expect(DeviceKey.safeParse({ ...key, keyId: "fs-ernesto-a1" }).success).toBe(true);
    const signed = {
      role: "chair",
      keyId: "fs-ernesto-s1",
      publicKeyHex: H("d"),
      payload,
      signatureHex: "e".repeat(128),
    };
    expect(SignedApproval.safeParse(signed).success).toBe(true);
    const officer = {
      role: "CHAIR",
      name: "Ernesto P. Cabahug",
      shortName: "Ernesto",
      initials: "EC",
      persona: "board:ernesto",
      keyId: "fs-ernesto-a1",
    };
    expect(SnapshotOfficer.safeParse(officer).success).toBe(true);
    expect(SnapshotOfficer.safeParse({ ...officer, keyId: "fs-ernesto-s1" }).success).toBe(false);
  });

  it("inv.i6.lines-digest: the signed payload carries linesDigest, so both keys bind every member line", () => {
    // The approved plan amends register §8: JCS{v, runId, seasonId, rateCardSha256, batchSha256,
    // linesDigest, itemCount, totalCents, currency, role, approverId, nonce, exp}.
    expect(Object.keys(ApprovalPayload.shape).sort()).toEqual(
      [
        "approverId",
        "batchSha256",
        "currency",
        "exp",
        "itemCount",
        "linesDigest",
        "nonce",
        "rateCardSha256",
        "role",
        "runId",
        "seasonId",
        "totalCents",
        "v",
      ].sort(),
    );
    expect(ApprovalPayload.safeParse(payload).success).toBe(true);
    const { linesDigest: _dropped, ...withoutLines } = payload;
    expect(ApprovalPayload.safeParse(withoutLines).success).toBe(false);
    for (const bad of ["", H("C"), "c".repeat(63), H("g"), 42]) {
      expect(ApprovalPayload.safeParse({ ...payload, linesDigest: bad }).success, String(bad)).toBe(false);
    }
    const req = { role: "chair", keyId: "fs-ernesto-a1", signature: "c".repeat(128) };
    expect(SubmitApprovalRequest.safeParse({ ...req, payload: withoutLines }).success).toBe(false);
  });

  it("one source: each key ID schema accepts exactly the union of its KEY_ID_PATTERNS", () => {
    const P = KEY_ID_PATTERNS;
    // A combinatorial corpus around every shape: valid IDs, near misses, reserved personas, bounds.
    const prefixes = ["fs-", "fs", "FS-", "fx-", ""];
    const personas = ["ernesto", "analyn", "a", "x".repeat(24), "x".repeat(25), "ledger", "demo", "Ernesto"];
    const suffixes = [
      "a1",
      "w1",
      "s1",
      "k1",
      "a9999",
      "w10000",
      "a0",
      "s01",
      "demo-a1b2c3",
      "demo-ABC123",
      "demo-abc12",
      "demo-abc1234",
      "x1",
      "",
    ];
    const tails = ["", " ", "\n", "-", "1"];
    const corpus: string[] = [];
    for (const pre of prefixes)
      for (const who of personas)
        for (const suffix of suffixes) for (const tail of tails) corpus.push(`${pre}${who}-${suffix}${tail}`);
    expect(corpus.length).toBeGreaterThan(2000);
    const db = new RegExp(DEVICE_KEY_ID_PATTERN);
    let device = 0;
    for (const id of corpus) {
      const shapes = Object.values(P).filter((re) => re.test(id));
      // The shapes are disjoint: an ID has at most one.
      expect(shapes.length, JSON.stringify(id)).toBeLessThanOrEqual(1);
      const isDevice = P.app.test(id) || P.web.test(id) || P.demo.test(id);
      if (isDevice) device++;
      expect(DeviceKeyId.safeParse(id).success, JSON.stringify(id)).toBe(isDevice);
      expect(db.test(id), JSON.stringify(id)).toBe(isDevice);
      expect(KeyId.safeParse(id).success, JSON.stringify(id)).toBe(isDevice || P.seeded.test(id));
      expect(SeededKeyId.safeParse(id).success, JSON.stringify(id)).toBe(P.seeded.test(id));
      expect(LedgerKeyId.safeParse(id).success, JSON.stringify(id)).toBe(
        P.ledger.test(id) || P.seededLedger.test(id),
      );
      expect(isSeededKeyId(id), JSON.stringify(id)).toBe(P.seeded.test(id) || P.seededLedger.test(id));
    }
    expect(device).toBeGreaterThan(10);
    // The database pattern is assembled from the same parts as the shapes, not spelled out again.
    for (const kind of ["app", "web", "demo"] as const) {
      const body = P[kind].source.replace(/^\^fs-\(\?!\(\?:ledger\|demo\)-\)\[a-z\]\{1,24\}-/, "");
      expect(DEVICE_KEY_ID_PATTERN, kind).toContain(body.replace(/\$$/, ""));
    }
  });

  it("a key's kind fits its ID shape: device keys, published officer and ledger keys, key.registered", () => {
    const officer = {
      keyId: "fs-ernesto-a1",
      approverId: "board:ernesto",
      role: "chair",
      publicKeyHex: H("d"),
      kind: "app",
      revokedAt: null,
    };
    const device = {
      id: "0192d5a0-0000-7000-8000-000000000001",
      workspaceId: "0192d5a0-0000-7000-8000-000000000002",
      keyId: "fs-ernesto-a1",
      persona: "board:ernesto",
      publicKeyHex: H("d"),
      kind: "app",
      label: "Phone key",
      revokedAt: null,
    };
    const registered = LedgerPayloads["key.registered"];
    const fits: [string, string][] = [
      ["fs-ernesto-a1", "app"],
      ["fs-analyn-w1", "web"],
      ["fs-analyn-demo-a1b2c3", "web_demo"],
    ];
    const misfits: [string, string][] = [
      ["fs-analyn-a1", "web"],
      ["fs-analyn-w1", "app"],
      ["fs-analyn-w1", "web_demo"],
      ["fs-analyn-w2", "web_demo"],
      ["fs-analyn-demo-a1b2c3", "app"],
      ["fs-analyn-demo-a1b2c3", "web"],
      ["fs-ernesto-a1", "web_demo"],
    ];
    for (const [keyId, kind] of fits) {
      expect(keyIdFitsKind(kind, keyId), `${kind} ${keyId}`).toBe(true);
      expect(OfficerKey.safeParse({ ...officer, keyId, kind }).success, `${kind} ${keyId}`).toBe(true);
      expect(DeviceKey.safeParse({ ...device, keyId, kind }).success, `${kind} ${keyId}`).toBe(true);
      expect(registered.safeParse({ keyId, persona: "p", kind, publicKeyHex: H("d") }).success).toBe(true);
    }
    for (const [keyId, kind] of [...misfits, ["fs-analyn-s1", "app"], ["fs-analyn-w1", "seeded"]]) {
      expect(keyIdFitsKind(kind, keyId), `${kind} ${keyId}`).toBe(false);
      expect(OfficerKey.safeParse({ ...officer, keyId, kind }).success, `${kind} ${keyId}`).toBe(false);
      expect(DeviceKey.safeParse({ ...device, keyId, kind }).success, `${kind} ${keyId}`).toBe(false);
      expect(registered.safeParse({ keyId, persona: "p", kind, publicKeyHex: H("d") }).success).toBe(false);
    }
    // Seeded keys are officer keys of kind seeded only, never device keys.
    expect(OfficerKey.safeParse({ ...officer, keyId: "fs-ernesto-s1", kind: "seeded" }).success).toBe(true);
    expect(DeviceKey.safeParse({ ...device, keyId: "fs-ernesto-s1", kind: "seeded" }).success).toBe(false);
    // Ledger keys: server keys are fs-ledger-k{n}, seed-only ones fs-ledger-s{n}.
    const ledger = { keyId: "fs-ledger-k1", publicKeyHex: H("e"), kind: "server", revokedAt: null };
    expect(LedgerKey.safeParse(ledger).success).toBe(true);
    expect(LedgerKey.safeParse({ ...ledger, keyId: "fs-ledger-s1", kind: "seeded" }).success).toBe(true);
    expect(LedgerKey.safeParse({ ...ledger, keyId: "fs-ledger-s1" }).success).toBe(false);
    expect(LedgerKey.safeParse({ ...ledger, kind: "seeded" }).success).toBe(false);
    expect(ledgerKeyIdFitsKind("server", "fs-ledger-k2")).toBe(true);
    expect(ledgerKeyIdFitsKind("app", "fs-ledger-k2")).toBe(false);
    // A published key list with one misfit row is unreadable as a whole, so a verifier trusts nothing.
    const doc = { v: 1, officers: [officer], ledger: [ledger] };
    expect(PublishedKeys.safeParse(doc).success).toBe(true);
    expect(PublishedKeys.safeParse({ ...doc, officers: [{ ...officer, kind: "web" }] }).success).toBe(false);
    // The kinds named here are exactly the contracts' kinds.
    expect(Object.keys(KEY_ID_PATTERN_BY_KIND).sort()).toEqual([...SigningKeyKind.options].sort());
    for (const k of DeviceKeyKind.options) {
      expect(DEVICE_KEY_ID_PATTERN_BY_KIND[k]).toBe(KEY_ID_PATTERN_BY_KIND[k].source);
    }
    for (const [kind, id] of [
      ["toString", "fs-ernesto-a1"],
      ["constructor", "fs-ernesto-a1"],
      ["app", 42],
      [null, "fs-ernesto-a1"],
    ] as const) {
      expect(keyIdFitsKind(kind, id), `${String(kind)} ${String(id)}`).toBe(false);
    }
  });

  it("names identity mismatches with their own error codes", () => {
    expect(ERROR_HTTP_STATUS.KEY_NOT_REGISTERED).toBe(403);
    expect(ERROR_HTTP_STATUS.APPROVER_MISMATCH).toBe(403);
    expect(ERROR_HTTP_STATUS.SIGNERS_NOT_DISTINCT).toBe(403);
    expect(ERROR_HTTP_STATUS.SEASON_MISMATCH).toBe(409);
    expect(API_COMMANDS.submitApproval.errors).toEqual(
      expect.arrayContaining([
        "KEY_NOT_REGISTERED",
        "APPROVER_MISMATCH",
        "SIGNERS_NOT_DISTINCT",
        "SEASON_MISMATCH",
      ]),
    );
  });

  it("an officer key binds one key to one approver and one role; sample kinds are named", () => {
    const key = {
      keyId: "fs-ernesto-a1",
      approverId: "board:ernesto",
      role: "chair",
      publicKeyHex: H("d"),
      kind: "app",
      revokedAt: null,
    };
    expect(OfficerKey.safeParse(key).success).toBe(true);
    expect(OfficerKey.safeParse({ ...key, role: "secretary" }).success).toBe(false);
    expect(OfficerKey.safeParse({ ...key, extra: 1 }).success).toBe(false);
    expect([...SAMPLE_KEY_KINDS].sort()).toEqual(["seeded", "web_demo"]);
    expect(SigningKeyKind.options).toEqual(["app", "web", "web_demo", "seeded"]);
    expect(DeviceKeyKind.options).toEqual(["app", "web", "web_demo"]);
    expect(OfficerKey.safeParse({ ...key, keyId: "fs-analyn-w1", kind: "web" }).success).toBe(true);
    expect(OfficerKey.safeParse({ ...key, keyId: "fs-ernesto-demo-a1b2c3", kind: "web_demo" }).success).toBe(
      true,
    );
  });
});

describe("ledger payloads the Proof binds (S3.12)", () => {
  const samples: Record<(typeof PROOF_LEDGER_KINDS)[number], unknown> = {
    "key.registered": { keyId: "fs-ernesto-a1", persona: "board:ernesto", kind: "app", publicKeyHex: H("d") },
    "rate_card.ratified": {
      rateCardSha256: H("a"),
      resolutionNo: "BR 2026-04",
      ratifiedAt: "2026-03-14T08:00:00.000Z",
    },
    "invoice.funded": {
      runId: "run-1",
      invoiceNumber: "FS-2026A-r37",
      status: "MARKED_AS_PAID",
      amountCents: 433_350,
      dueCents: 0,
      reference: "rc:aaaaaaaaaaaaaaaa",
    },
    "rows.accepted": {
      documentId: "doc-B",
      photoId: "B",
      sha256: H("f"),
      serials: ["0425", "0426", "0427", "0428"],
      slipDates: ["2026-06-30", "2026-06-30", "2026-07-01", "2026-07-01"],
      provenance: "replay",
    },
    "lines.computed": {
      runId: "run-1",
      engine: "engine v1",
      rateCardSha256: H("a"),
      lineCount: 64,
      linesRootSha256: H("c"),
      premiumPoolCents: 288_750,
      bonusPoolCents: 138_600,
      netCents: 421_817,
      onRailNetCents: 36_839,
      balanced: true,
      overrides: 0,
    },
    "approval.signed": {
      runId: "run-1",
      role: "chair",
      keyId: "fs-ernesto-a1",
      approverId: "board:ernesto",
      batchSha256: H("b"),
      nonce: "nonce-0001",
    },
    "payout.submitting": {
      runId: "run-1",
      senderBatchId: "2026A-aaaaaaaa-r37",
      batchSha256: H("b"),
      itemCount: 8,
      totalCents: 36_839,
      note: "Fair Split 2026-A, batch bbbbbbbb",
    },
    "payout.cancel": { senderItemId: "r37-M-031", payoutItemId: "ITEM6", afterCancel: "cash" },
    "payout.item.replayed": {
      runId: "run-1",
      senderItemId: "r37-M-014",
      payoutItemId: "REPLAY-ITEM1",
      from: "SUBMITTED",
      status: "SUCCESS",
      provenance: "replay",
      source: "post_response",
    },
    "webhook.applied": {
      resource: "payout_item",
      eventId: "WH-1",
      eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      verified: "self",
      provenance: "live",
      senderItemId: "r37-M-014",
      payoutItemId: "ITEM1",
      status: "SUCCESS",
    },
  };

  it("parses one sample of every kind, and nothing extra", () => {
    expect(Object.keys(samples).sort()).toEqual([...PROOF_LEDGER_KINDS].sort());
    for (const kind of PROOF_LEDGER_KINDS) {
      const schema = LedgerPayloads[kind];
      const r = schema.safeParse(samples[kind]);
      expect(r.success, `${kind}: ${r.success ? "" : r.error.message}`).toBe(true);
      expect(schema.safeParse({ ...(samples[kind] as object), extra: 1 }).success, kind).toBe(false);
    }
  });

  it("lines.computed carries the run's override count, so Proof can hold R5's override co-sign", () => {
    const schema = LedgerPayloads["lines.computed"];
    const { overrides: _dropped, ...without } = samples["lines.computed"] as Record<string, unknown>;
    expect(schema.safeParse(without).success).toBe(false);
    for (const bad of [-1, 1.5, "1", null]) {
      expect(schema.safeParse({ ...without, overrides: bad }).success, String(bad)).toBe(false);
    }
    expect(schema.safeParse({ ...without, overrides: 2 }).success).toBe(true);
  });

  it("inv.i8.replay evidence cannot claim verification or omit its recorded provenance", () => {
    const schema = LedgerPayloads["payout.item.replayed"];
    const sample = samples["payout.item.replayed"] as Record<string, unknown>;
    expect(schema.safeParse(sample).success).toBe(true);
    expect(schema.safeParse({ ...sample, provenance: "simulated_rail" }).success).toBe(false);
    expect(schema.safeParse({ ...sample, verified: "self" }).success).toBe(false);
    expect(schema.safeParse({ ...sample, source: "unknown" }).success).toBe(false);
    const { provenance: _provenance, ...without } = sample;
    expect(schema.safeParse(without).success).toBe(false);
  });

  it("types webhook.applied by resource", () => {
    const schema = LedgerPayloads["webhook.applied"];
    expect(
      schema.safeParse({
        resource: "invoice",
        eventId: "WH-2",
        eventType: "INVOICING.INVOICE.PAID",
        verified: "self",
        provenance: "live",
        invoiceNumber: "FS-2026A-r37",
        status: "PAID",
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ ...(samples["webhook.applied"] as object), eventType: "PAYMENT.SALE.COMPLETED" })
        .success,
    ).toBe(false);
    expect(schema.safeParse({ ...(samples["webhook.applied"] as object), resource: "invoice" }).success).toBe(
      false,
    );
  });
});

const LABEL_MAPS: Record<string, Readonly<Record<string, Words>>> = {
  MEMBER_LINE_LABELS,
  RUN_STATE_LABELS,
  HOLD_KIND_LABELS,
  HOLD_GATE_LABELS,
  HOLD_STATE_LABELS,
  PAYOUT_ITEM_STATUS_LABELS,
  RUN_STRIP_LABELS,
  PROVENANCE_LABELS,
  INVOICE_STATUS_LABELS,
  RAIL_LABELS,
};
const VAR_SETS: LabelVars[] = [
  {},
  { treasurer: "Analyn" },
  { chair: "Ernesto" },
  { treasurer: "Analyn", chair: "Ernesto" },
];

describe("inv.i8.labels: every label, language and name combination renders as words (exhaustive)", () => {
  it("never leaves a slot, a raw state name, or English filler in Cebuano or Filipino", () => {
    let checked = 0;
    for (const [mapName, map] of Object.entries(LABEL_MAPS)) {
      for (const [key, words] of Object.entries(map)) {
        for (const lang of LANGS) {
          for (const vars of VAR_SETS) {
            const out = pickLabel(words, lang, vars);
            const where = `${mapName}.${key}/${lang}/${JSON.stringify(vars)}`;
            expect(out.length, where).toBeGreaterThan(0);
            expect(out, where).not.toMatch(/[{}]/);
            expect(/^[A-Z][A-Z_]+$/.test(out), where).toBe(false);
            if (lang !== "en") expect(out.toLowerCase(), where).not.toContain("the ");
            if (vars.treasurer && words[lang].includes("{treasurer}")) expect(out, where).toContain("Analyn");
            if (vars.chair && words[lang].includes("{chair}")) expect(out, where).toContain("Ernesto");
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it("puts a personal marker before every name slot, so the role-noun fallback stays grammatical", () => {
    const markers = { ceb: ["si", "ni", "kang"], fil: ["si", "ni", "kay"] } as const;
    for (const map of Object.values(LABEL_MAPS)) {
      for (const words of Object.values(map)) {
        for (const lang of ["ceb", "fil"] as const) {
          for (const m of words[lang].matchAll(/(\S+) \{(treasurer|chair)\}/g)) {
            expect(markers[lang], `${words[lang]}`).toContain(m[1]);
          }
          expect(words[lang], words[lang]).not.toMatch(/^\{/);
        }
      }
    }
  });

  it("uses each language's own role noun when a name is missing", () => {
    expect(pickLabel(RUN_STATE_LABELS.TREASURER_APPROVED, "en")).toBe("Approved by the treasurer");
    expect(pickLabel(RUN_STATE_LABELS.TREASURER_APPROVED, "ceb")).toBe("Giaprobahan sa tesorero");
    expect(pickLabel(RUN_STATE_LABELS.TREASURER_APPROVED, "fil")).toBe("Inaprubahan ng ingat-yaman");
    expect(pickLabel(RUN_STATE_LABELS.AWAITING_BOARD, "en")).toBe("Waiting for the Chair");
    expect(pickLabel(RUN_STATE_LABELS.AWAITING_BOARD, "ceb")).toBe("Naghulat sa Chair");
    expect(pickLabel(RUN_STATE_LABELS.AWAITING_BOARD, "fil")).toBe("Hinihintay ang Chair");
    expect(pickLabel(HOLD_STATE_LABELS.ASKED_CHAIR, "ceb")).toBe("Gipangutana ang Chair");
    expect(pickLabel(HOLD_STATE_LABELS.ASKED_CHAIR, "fil")).toBe("Tinanong ang Chair");
    expect(pickLabel(RUN_STATE_LABELS.AWAITING_BOARD, "fil", { chair: "Ernesto" })).toBe(
      "Hinihintay si Ernesto",
    );
    expect(ROLE_NOUNS.ceb.treasurer).toBe("tesorero");
  });
});
