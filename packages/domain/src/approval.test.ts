import type { SignedApproval } from "@fairsplit/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TEST_RULES } from "./__fixtures__/world.js";
import {
  APPROVAL_MAX_TTL_MS,
  type ApprovalExpectation,
  approvalBytes,
  approvalJcs,
  approvalSignatureValid,
  buildApprovalPayload,
  checkApproval,
  type RegisteredKey,
  requiresChair,
} from "./approval.js";
import { sha256Hex } from "./canon.js";
import { ed25519FromSeed, ed25519Sign } from "./sig.js";

const RC = "a".repeat(64);
const BATCH = { batchSha256: "b".repeat(64), itemCount: 8, totalCents: 36_839 };
const NOW = new Date("2026-10-29T02:09:00.000Z");
const SEASON = "season-1";

const KEYS = {
  treasurer: ed25519FromSeed(sha256Hex("key treasurer")),
  chair: ed25519FromSeed(sha256Hex("key chair")),
  attacker: ed25519FromSeed(sha256Hex("someone else's key")),
};
const APPROVER = { treasurer: "treasurer:analyn", chair: "board:ernesto" } as const;
const KEY_ID = { treasurer: "fs-analyn-a1", chair: "fs-ernesto-a1" } as const;

function registered(role: "treasurer" | "chair" = "treasurer"): RegisteredKey {
  return { keyId: KEY_ID[role], publicKeyHex: KEYS[role].publicKeyHex, approverId: APPROVER[role], role };
}

interface SignOpts {
  role?: "treasurer" | "chair";
  nonce?: string;
  expMs?: number;
  key?: keyof typeof KEYS;
  keyId?: string;
  approverId?: string;
  seasonId?: string;
}

function signed(o: SignOpts = {}): SignedApproval {
  const role = o.role ?? "treasurer";
  const key = KEYS[o.key ?? role];
  const payload = buildApprovalPayload({
    runId: "run-1",
    seasonId: o.seasonId ?? SEASON,
    rateCardSha256: RC,
    batch: BATCH,
    role,
    approverId: o.approverId ?? APPROVER[role],
    nonce: o.nonce ?? "nonce-0001",
    exp: new Date(NOW.getTime() + (o.expMs ?? 20 * 60 * 1000)).toISOString(),
  });
  return {
    role,
    keyId: o.keyId ?? KEY_ID[role],
    publicKeyHex: key.publicKeyHex,
    payload,
    signatureHex: ed25519Sign(key.privateKey, approvalBytes(payload)),
  };
}

const expected = (over: Partial<ApprovalExpectation> = {}): ApprovalExpectation => ({
  runId: "run-1",
  seasonId: SEASON,
  rateCardSha256: RC,
  ...BATCH,
  role: "treasurer",
  registered: registered(),
  ...over,
});

describe("signed approval payload (register §8)", () => {
  it("carries exactly the register's fields, canonicalised", () => {
    const s = signed();
    expect(Object.keys(s.payload).sort()).toEqual(
      [
        "approverId",
        "batchSha256",
        "currency",
        "exp",
        "itemCount",
        "nonce",
        "rateCardSha256",
        "role",
        "runId",
        "seasonId",
        "totalCents",
        "v",
      ].sort(),
    );
    expect(approvalJcs(s.payload).startsWith('{"approverId":"treasurer:analyn","batchSha256"')).toBe(true);
    expect(approvalSignatureValid(s, KEYS.treasurer.publicKeyHex)).toBe(true);
    expect(approvalSignatureValid(s, KEYS.chair.publicKeyHex)).toBe(false);
  });

  it("accepts a valid approval and refuses mismatch, expiry, reuse and forgery", () => {
    const s = signed();
    expect(checkApproval(s, expected(), NOW)).toEqual({ ok: true });
    expect(checkApproval(s, expected({ batchSha256: "c".repeat(64) }), NOW)).toMatchObject({
      ok: false,
      code: "DIGEST_MISMATCH",
    });
    expect(checkApproval(s, expected({ totalCents: 36_840 }), NOW)).toMatchObject({
      code: "DIGEST_MISMATCH",
    });
    expect(checkApproval(s, expected({ runId: "run-2" }), NOW)).toMatchObject({ code: "DIGEST_MISMATCH" });
    expect(checkApproval(s, expected(), new Date(NOW.getTime() + 21 * 60 * 1000))).toMatchObject({
      code: "APPROVAL_EXPIRED",
    });
    expect(
      checkApproval(signed({ nonce: "nonce-0002", expMs: APPROVAL_MAX_TTL_MS + 1000 }), expected(), NOW),
    ).toMatchObject({ code: "APPROVAL_EXPIRED" });
    expect(checkApproval(s, expected(), NOW, new Set(["nonce-0001"]))).toMatchObject({
      code: "NONCE_REUSED",
    });
    const edited = { ...s, payload: { ...s.payload, nonce: "nonce-9999" } };
    expect(checkApproval(edited, expected(), NOW)).toMatchObject({ code: "SIGNATURE_INVALID" });
  });

  it("validates the payload shape", () => {
    expect(() =>
      buildApprovalPayload({
        runId: "r",
        seasonId: "s",
        rateCardSha256: "not-a-hash",
        batch: BATCH,
        role: "treasurer",
        approverId: "a",
        nonce: "nonce-0001",
        exp: NOW.toISOString(),
      }),
    ).toThrow();
  });
});

describe("inv.i6.human-gate", () => {
  it("refuses an approval signed with a foreign key, whatever key it presents", () => {
    // The attacker signs with their own key and presents its public key: the submitted key is ignored.
    const foreign = signed({ key: "attacker" });
    expect(checkApproval(foreign, expected(), NOW)).toMatchObject({ ok: false, code: "KEY_NOT_REGISTERED" });
    // Presenting the registered public key does not help: the signature is checked against it.
    const posing = { ...foreign, publicKeyHex: KEYS.treasurer.publicKeyHex };
    expect(checkApproval(posing, expected(), NOW)).toMatchObject({ ok: false, code: "SIGNATURE_INVALID" });
    // Another key ID than the registered one.
    expect(checkApproval(signed({ keyId: "fs-analyn-a2" }), expected(), NOW)).toMatchObject({
      code: "KEY_NOT_REGISTERED",
    });
    // The Chair's real key cannot stand in for the treasurer's.
    const chairKey = signed({ key: "chair", keyId: "fs-ernesto-a1" });
    expect(checkApproval(chairKey, expected(), NOW)).toMatchObject({ code: "KEY_NOT_REGISTERED" });
  });

  it("refuses a wrong approverId, a role the key may not sign for, and a wrong seasonId", () => {
    expect(checkApproval(signed({ approverId: "board:someone" }), expected(), NOW)).toMatchObject({
      ok: false,
      code: "APPROVER_MISMATCH",
    });
    const asChair = signed({
      role: "chair",
      key: "treasurer",
      keyId: "fs-analyn-a1",
      approverId: APPROVER.treasurer,
    });
    expect(checkApproval(asChair, expected({ role: "chair" }), NOW)).toMatchObject({
      code: "APPROVER_MISMATCH",
    });
    expect(checkApproval(signed({ seasonId: "season-2" }), expected(), NOW)).toMatchObject({
      ok: false,
      code: "SEASON_MISMATCH",
    });
  });

  it("refuses seeded keys and revoked keys", () => {
    const seededReg = { ...registered(), keyId: "fs-analyn-s1" };
    const seeded = signed({ keyId: "fs-analyn-s1" });
    expect(checkApproval(seeded, expected({ registered: seededReg }), NOW)).toMatchObject({
      code: "KEY_NOT_REGISTERED",
      reason: "Seeded sample keys never sign.",
    });
    const revoked = { ...registered(), revokedAt: "2026-10-29T02:00:00.000Z" };
    expect(checkApproval(signed(), expected({ registered: revoked }), NOW)).toMatchObject({
      code: "KEY_NOT_REGISTERED",
    });
    const later = { ...registered(), revokedAt: "2026-10-29T03:00:00.000Z" };
    expect(checkApproval(signed(), expected({ registered: later }), NOW)).toEqual({ ok: true });
  });

  it("property: only the registered key of the right approver, role and season ever passes", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<keyof typeof KEYS>("treasurer", "chair", "attacker"),
        fc.constantFrom("fs-analyn-a1", "fs-ernesto-a1", "fs-analyn-s1", "fs-analyn-w2"),
        fc.constantFrom(APPROVER.treasurer, APPROVER.chair, "board:someone"),
        fc.constantFrom(SEASON, "season-2"),
        (key, keyId, approverId, seasonId) => {
          const r = checkApproval(signed({ key, keyId, approverId, seasonId }), expected(), NOW);
          const honest =
            key === "treasurer" &&
            keyId === "fs-analyn-a1" &&
            approverId === APPROVER.treasurer &&
            seasonId === SEASON;
          expect(r.ok).toBe(honest);
        },
      ),
    );
  });

  const cosign = TEST_RULES.cosign;
  it("the Chair co-signs a batch over US$300, a line over US$150 and any override (R5)", () => {
    expect(
      requiresChair({ batchTotalCents: 36_839, lineAmountsCents: [6_445, 12_784], overrides: 0 }, cosign),
    ).toEqual({
      required: true,
      reasons: ["BATCH_OVER_THRESHOLD"],
    });
    expect(
      requiresChair({ batchTotalCents: 30_000, lineAmountsCents: [15_000], overrides: 0 }, cosign).required,
    ).toBe(false);
    expect(
      requiresChair({ batchTotalCents: 15_001, lineAmountsCents: [15_001], overrides: 0 }, cosign).reasons,
    ).toEqual(["LINE_OVER_THRESHOLD"]);
    expect(
      requiresChair({ batchTotalCents: 100, lineAmountsCents: [100], overrides: 1 }, cosign).reasons,
    ).toEqual(["OVERRIDE"]);
  });

  it("property: the treasurer alone is enough only below every threshold", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 40_000 }), { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 0, max: 3 }),
        (lines, overrides) => {
          const total = lines.reduce((s, x) => s + x, 0);
          const r = requiresChair({ batchTotalCents: total, lineAmountsCents: lines, overrides }, cosign);
          const expectChair = total > 30_000 || lines.some((l) => l > 15_000) || overrides > 0;
          expect(r.required).toBe(expectChair);
        },
      ),
    );
  });
});
