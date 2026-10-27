import type { ApprovalRole, OfficerKey, SignedApproval } from "@fairsplit/contracts";
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
  checkApprovals,
  expectedSigner,
  linesDigest,
  requiresChair,
} from "./approval.js";
import { sha256Hex } from "./canon.js";
import { linesRootSha256 } from "./engine.js";
import { ed25519FromSeed, ed25519Sign } from "./sig.js";

const RC = "a".repeat(64);
const BATCH = { batchSha256: "b".repeat(64), itemCount: 8, totalCents: 36_839 };
/** The lines root over every member line, on and off rail, as the server recomputes it from the DB. */
const LINES = "d".repeat(64);
const NOW = new Date("2026-10-29T02:09:00.000Z");
const SEASON = "season-1";
const NONE: ReadonlySet<string> = new Set();

const KEYS = {
  treasurer: ed25519FromSeed(sha256Hex("key treasurer")),
  chair: ed25519FromSeed(sha256Hex("key chair")),
  attacker: ed25519FromSeed(sha256Hex("someone else's key")),
};
const APPROVER = { treasurer: "treasurer:analyn", chair: "board:ernesto" } as const;
/** S3.8: the treasurer's real key is the WebCrypto key fs-analyn-w1 (kind web); the Chair's is his app key. */
const KEY_ID = { treasurer: "fs-analyn-w1", chair: "fs-ernesto-a1" } as const;

/** The officer key registry as the server reads it from `device_keys` (never from the request). */
const REGISTRY: OfficerKey[] = [
  {
    keyId: KEY_ID.treasurer,
    approverId: APPROVER.treasurer,
    role: "treasurer",
    publicKeyHex: KEYS.treasurer.publicKeyHex,
    kind: "web",
    revokedAt: null,
  },
  {
    keyId: KEY_ID.chair,
    approverId: APPROVER.chair,
    role: "chair",
    publicKeyHex: KEYS.chair.publicKeyHex,
    kind: "app",
    revokedAt: null,
  },
];

interface SignOpts {
  role?: ApprovalRole;
  nonce?: string;
  expMs?: number;
  key?: keyof typeof KEYS;
  keyId?: string;
  approverId?: string;
  seasonId?: string;
  linesDigest?: string;
}

function signed(o: SignOpts = {}): SignedApproval {
  const role = o.role ?? "treasurer";
  const key = KEYS[o.key ?? role];
  const payload = buildApprovalPayload({
    runId: "run-1",
    seasonId: o.seasonId ?? SEASON,
    rateCardSha256: RC,
    batch: BATCH,
    linesDigest: o.linesDigest ?? LINES,
    role,
    approverId: o.approverId ?? APPROVER[role],
    nonce: o.nonce ?? `nonce-${role}-0001`,
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

/** The server's expectation for `role`: batch facts from the DB, the signer from the registry. */
function expected(
  role: ApprovalRole = "treasurer",
  over: Partial<ApprovalExpectation> = {},
  registry: readonly OfficerKey[] = REGISTRY,
): ApprovalExpectation {
  const signer = expectedSigner(registry, role, KEY_ID[role], NOW);
  if (!signer.ok) throw new Error(signer.reason);
  return {
    runId: "run-1",
    seasonId: SEASON,
    rateCardSha256: RC,
    ...BATCH,
    linesDigest: LINES,
    role,
    ...signer.signer,
    ...over,
  };
}

describe("signed approval payload (register §8 as amended by the approved plan)", () => {
  it("carries exactly the register's fields plus linesDigest, canonicalised", () => {
    const s = signed();
    expect(Object.keys(s.payload).sort()).toEqual(
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
    expect(approvalJcs(s.payload).startsWith('{"approverId":"treasurer:analyn","batchSha256"')).toBe(true);
    expect(approvalSignatureValid(s, KEYS.treasurer.publicKeyHex)).toBe(true);
    expect(approvalSignatureValid(s, KEYS.chair.publicKeyHex)).toBe(false);
  });

  it("accepts a valid approval and refuses a changed batch or a forged payload", () => {
    const s = signed();
    expect(checkApproval(s, expected(), NOW, NONE)).toEqual({ ok: true });
    expect(checkApproval(s, expected("treasurer", { batchSha256: "c".repeat(64) }), NOW, NONE)).toMatchObject(
      {
        ok: false,
        code: "DIGEST_MISMATCH",
      },
    );
    expect(checkApproval(s, expected("treasurer", { totalCents: 36_840 }), NOW, NONE)).toMatchObject({
      code: "DIGEST_MISMATCH",
    });
    expect(checkApproval(s, expected("treasurer", { runId: "run-2" }), NOW, NONE)).toMatchObject({
      code: "DIGEST_MISMATCH",
    });
    const edited = { ...s, payload: { ...s.payload, nonce: "nonce-9999" } };
    expect(checkApproval(edited, expected(), NOW, NONE)).toMatchObject({ code: "SIGNATURE_INVALID" });
  });

  it("validates the payload shape", () => {
    expect(() =>
      buildApprovalPayload({
        runId: "r",
        seasonId: "s",
        rateCardSha256: "not-a-hash",
        batch: BATCH,
        linesDigest: LINES,
        role: "treasurer",
        approverId: "a",
        nonce: "nonce-0001",
        exp: NOW.toISOString(),
      }),
    ).toThrow();
    const noLines = {
      runId: "r",
      seasonId: "s",
      rateCardSha256: RC,
      batch: BATCH,
      role: "treasurer",
      approverId: "a",
      nonce: "nonce-0001",
      exp: NOW.toISOString(),
    } as unknown as Parameters<typeof buildApprovalPayload>[0];
    expect(() => buildApprovalPayload(noLines)).toThrow();
    expect(() => buildApprovalPayload({ ...noLines, linesDigest: "not-a-hash" })).toThrow();
  });
});

describe("inv.i6.lines-digest: both keys bind every member line, the cash lines too", () => {
  const line = (memberNo: string, seed: string) => ({ memberNo, lineSha256: sha256Hex(seed) });
  const LINE_SET = [line("M-001", "paypal line"), line("M-002", "paypal line 2"), line("M-003", "cash line")];

  it("linesDigest is the lines root over every line (the root `lines.computed` carries), in any order", () => {
    expect(linesDigest(LINE_SET)).toBe(linesRootSha256(LINE_SET));
    expect(linesDigest([...LINE_SET].reverse())).toBe(linesDigest(LINE_SET));
    // A cash line (off the PayPal batch) changes the digest, so the signatures cover it.
    const cashCut = LINE_SET.map((l) =>
      l.memberNo === "M-003" ? line("M-003", "cash line, 1 cent less") : l,
    );
    expect(linesDigest(cashCut)).not.toBe(linesDigest(LINE_SET));
    expect(linesDigest(LINE_SET.slice(0, 2))).not.toBe(linesDigest(LINE_SET));
    expect(() => linesDigest([...LINE_SET, line("M-003", "a second line")])).toThrow(RangeError);
    expect(() => linesDigest([])).toThrow(RangeError);
  });

  it("an approval over other lines is refused as DIGEST_MISMATCH, before its signature is checked", () => {
    const s = signed();
    expect(checkApproval(s, expected(), NOW, NONE)).toEqual({ ok: true });
    // The server recomputes the lines from the database: one cash line changed after signing.
    const changed = expected("treasurer", { linesDigest: "e".repeat(64) });
    expect(checkApproval(s, changed, NOW, NONE)).toEqual({
      ok: false,
      code: "DIGEST_MISMATCH",
      reason: "A line changed after it was signed. Nothing was sent.",
    });
    // Same batch, other lines: the batch digest alone no longer authorises the payout.
    const otherLines = signed({ linesDigest: "e".repeat(64) });
    expect(checkApproval(otherLines, expected(), NOW, NONE)).toMatchObject({ code: "DIGEST_MISMATCH" });
    // Editing the payload's linesDigest to match breaks the signature.
    const forged = { ...otherLines, payload: { ...otherLines.payload, linesDigest: LINES } };
    expect(checkApproval(forged, expected(), NOW, NONE)).toMatchObject({ code: "SIGNATURE_INVALID" });
    // Both approvals are held to it.
    const pair = { treasurer: expected("treasurer"), chair: expected("chair") };
    const chairOverOtherLines = signed({ role: "chair", linesDigest: "e".repeat(64) });
    expect(
      checkApprovals(
        { approvals: [signed(), chairOverOtherLines], expected: pair, chairRequired: true },
        NOW,
        NONE,
      ),
    ).toMatchObject({ ok: false, code: "DIGEST_MISMATCH" });
  });
});

describe("inv.i6.registered-signer: approvals verify only against the registry's key for the role", () => {
  it("the expected signer comes from the registry for the role; the presented key only selects", () => {
    expect(expectedSigner(REGISTRY, "chair", KEY_ID.chair, NOW)).toEqual({
      ok: true,
      signer: {
        keyId: KEY_ID.chair,
        publicKeyHex: KEYS.chair.publicKeyHex,
        approverId: APPROVER.chair,
        revokedAt: null,
      },
    });
    const ambiguous = [
      ...REGISTRY,
      { ...(REGISTRY[1] as OfficerKey), publicKeyHex: KEYS.attacker.publicKeyHex },
    ];
    expect(expectedSigner(ambiguous, "chair", KEY_ID.chair, NOW)).toMatchObject({
      ok: false,
      code: "KEY_NOT_REGISTERED",
    });
  });

  it("an unregistered key is an unknown signer, refused before its signature is checked", () => {
    // The attacker signs with their own key and presents it: valid Ed25519, unknown signer.
    const foreign = signed({ key: "attacker" });
    const r = checkApproval(foreign, expected(), NOW, NONE);
    expect(r).toMatchObject({ ok: false, code: "KEY_NOT_REGISTERED" });
    expect(r.ok ? "" : r.reason).toMatch(/^Unknown signer/);
    // The identity check runs first: a garbage signature under an unknown key is still "unknown signer".
    const garbage = { ...foreign, signatureHex: "0".repeat(128) };
    expect(checkApproval(garbage, expected(), NOW, NONE)).toMatchObject({ code: "KEY_NOT_REGISTERED" });
    // A key ID the registry does not list has no expected signer at all.
    expect(expectedSigner(REGISTRY, "treasurer", "fs-analyn-a9", NOW)).toMatchObject({
      ok: false,
      code: "KEY_NOT_REGISTERED",
      reason: expect.stringMatching(/^Unknown signer/),
    });
    // Presenting the registered key ID and public key does not help: the registry's key verifies.
    const posing = { ...foreign, keyId: KEY_ID.treasurer, publicKeyHex: KEYS.treasurer.publicKeyHex };
    expect(checkApproval(posing, expected(), NOW, NONE)).toMatchObject({ code: "SIGNATURE_INVALID" });
    // A different key ID than the expected one.
    expect(checkApproval(signed({ keyId: "fs-analyn-a2" }), expected(), NOW, NONE)).toMatchObject({
      code: "KEY_NOT_REGISTERED",
    });
  });

  it("a registered key signing for the wrong role is refused", () => {
    // Analyn's real, registered key signs a Chair approval in her own name.
    const asChair = signed({
      role: "chair",
      key: "treasurer",
      keyId: KEY_ID.treasurer,
      approverId: APPROVER.treasurer,
    });
    expect(expectedSigner(REGISTRY, "chair", KEY_ID.treasurer, NOW)).toMatchObject({
      ok: false,
      code: "KEY_NOT_REGISTERED",
      reason: expect.stringMatching(/^Unknown signer/),
    });
    // Whatever the server expects for the Chair, her key is not it.
    const r = checkApproval(asChair, expected("chair"), NOW, NONE);
    expect(r).toMatchObject({ ok: false, code: "KEY_NOT_REGISTERED" });
    expect(r.ok ? "" : r.reason).toMatch(/^Unknown signer/);
    // The Chair's key under the Chair's ID, but naming the treasurer as approver.
    expect(
      checkApproval(signed({ role: "chair", approverId: APPROVER.treasurer }), expected("chair"), NOW, NONE),
    ).toMatchObject({
      code: "APPROVER_MISMATCH",
    });
    // A Chair approval presented where the treasurer's is expected.
    expect(checkApproval(signed({ role: "chair" }), expected("treasurer"), NOW, NONE)).toMatchObject({
      ok: false,
      code: "KEY_NOT_REGISTERED",
    });
  });

  it("refuses a wrong approverId and a wrong seasonId", () => {
    expect(checkApproval(signed({ approverId: "board:someone" }), expected(), NOW, NONE)).toMatchObject({
      ok: false,
      code: "APPROVER_MISMATCH",
    });
    expect(checkApproval(signed({ seasonId: "season-2" }), expected(), NOW, NONE)).toMatchObject({
      ok: false,
      code: "SEASON_MISMATCH",
    });
  });

  it("the same key or the same approver can never sign as both treasurer and Chair", () => {
    const pair = { treasurer: expected("treasurer"), chair: expected("chair") };
    const t = signed();
    const c = signed({ role: "chair" });
    expect(checkApprovals({ approvals: [t, c], expected: pair, chairRequired: true }, NOW, NONE)).toEqual({
      ok: true,
    });
    // One key registered for both roles (under two key IDs): the treasurer signs both approvals.
    const sameKeyRegistry = REGISTRY.map((k) =>
      k.role === "chair" ? { ...k, publicKeyHex: KEYS.treasurer.publicKeyHex } : k,
    );
    const sameKey = { treasurer: expected("treasurer"), chair: expected("chair", {}, sameKeyRegistry) };
    const cByTreasurerKey = signed({ role: "chair", key: "treasurer" });
    expect(checkApproval(cByTreasurerKey, sameKey.chair, NOW, NONE)).toEqual({ ok: true });
    expect(
      checkApprovals({ approvals: [t, cByTreasurerKey], expected: sameKey, chairRequired: true }, NOW, NONE),
    ).toMatchObject({ ok: false, code: "SIGNERS_NOT_DISTINCT" });
    // One person registered for both roles, with two keys.
    const samePersonRegistry = REGISTRY.map((k) =>
      k.role === "chair" ? { ...k, approverId: APPROVER.treasurer } : k,
    );
    const samePerson = { treasurer: expected("treasurer"), chair: expected("chair", {}, samePersonRegistry) };
    const cAsAnalyn = signed({ role: "chair", approverId: APPROVER.treasurer });
    expect(checkApproval(cAsAnalyn, samePerson.chair, NOW, NONE)).toEqual({ ok: true });
    expect(
      checkApprovals({ approvals: [t, cAsAnalyn], expected: samePerson, chairRequired: true }, NOW, NONE),
    ).toMatchObject({ ok: false, code: "SIGNERS_NOT_DISTINCT" });
    // One key ID for both roles.
    const sameId = { treasurer: pair.treasurer, chair: { ...pair.chair, keyId: KEY_ID.treasurer } };
    expect(
      checkApprovals(
        {
          approvals: [t, signed({ role: "chair", keyId: KEY_ID.treasurer })],
          expected: sameId,
          chairRequired: true,
        },
        NOW,
        NONE,
      ),
    ).toMatchObject({ ok: false, code: "SIGNERS_NOT_DISTINCT" });
    // The same role twice, and a missing co-signature.
    expect(
      checkApprovals(
        { approvals: [t, signed({ nonce: "nonce-other-01" })], expected: pair, chairRequired: false },
        NOW,
        NONE,
      ),
    ).toMatchObject({ ok: false, code: "SIGNERS_NOT_DISTINCT" });
    expect(checkApprovals({ approvals: [t], expected: pair, chairRequired: true }, NOW, NONE)).toMatchObject({
      ok: false,
      code: "APPROVALS_MISSING",
    });
    expect(checkApprovals({ approvals: [c], expected: pair, chairRequired: false }, NOW, NONE)).toMatchObject(
      {
        ok: false,
        code: "APPROVALS_MISSING",
      },
    );
    expect(checkApprovals({ approvals: [t], expected: pair, chairRequired: false }, NOW, NONE)).toEqual({
      ok: true,
    });
    // A Chair approval with no registered Chair key is an unknown signer.
    expect(
      checkApprovals(
        { approvals: [t, c], expected: { treasurer: pair.treasurer }, chairRequired: true },
        NOW,
        NONE,
      ),
    ).toMatchObject({ ok: false, code: "KEY_NOT_REGISTERED" });
  });

  it("a replayed nonce is refused, including one nonce shared by both approvals", () => {
    expect(checkApproval(signed(), expected(), NOW, new Set(["nonce-treasurer-0001"]))).toMatchObject({
      ok: false,
      code: "NONCE_REUSED",
    });
    const pair = { treasurer: expected("treasurer"), chair: expected("chair") };
    const shared = [
      signed({ nonce: "nonce-shared-01" }),
      signed({ role: "chair", nonce: "nonce-shared-01" }),
    ];
    expect(
      checkApprovals({ approvals: shared, expected: pair, chairRequired: true }, NOW, NONE),
    ).toMatchObject({
      ok: false,
      code: "NONCE_REUSED",
    });
    expect(
      checkApprovals(
        { approvals: [signed(), signed({ role: "chair" })], expected: pair, chairRequired: true },
        NOW,
        new Set(["nonce-chair-0001"]),
      ),
    ).toMatchObject({ ok: false, code: "NONCE_REUSED" });
  });

  it("an expired payload is refused, and so is one valid for more than 30 minutes", () => {
    expect(checkApproval(signed(), expected(), new Date(NOW.getTime() + 21 * 60 * 1000), NONE)).toMatchObject(
      {
        ok: false,
        code: "APPROVAL_EXPIRED",
      },
    );
    expect(checkApproval(signed({ expMs: -1 }), expected(), NOW, NONE)).toMatchObject({
      code: "APPROVAL_EXPIRED",
    });
    expect(checkApproval(signed({ expMs: APPROVAL_MAX_TTL_MS + 1000 }), expected(), NOW, NONE)).toMatchObject(
      {
        code: "APPROVAL_EXPIRED",
      },
    );
    expect(checkApproval(signed({ expMs: APPROVAL_MAX_TTL_MS }), expected(), NOW, NONE)).toEqual({
      ok: true,
    });
  });

  it("usedNonces is a required argument: calling without the run's nonce store throws", () => {
    const loose = checkApproval as unknown as (...args: unknown[]) => unknown;
    expect(() => loose(signed(), expected(), NOW)).toThrow(/usedNonces/);
    const looseSet = checkApprovals as unknown as (...args: unknown[]) => unknown;
    expect(() =>
      looseSet({ approvals: [signed()], expected: { treasurer: expected() }, chairRequired: false }, NOW),
    ).toThrow(/usedNonces/);
  });

  it("refuses seeded keys and revoked keys", () => {
    const seededRegistry: OfficerKey[] = [{ ...(REGISTRY[0] as OfficerKey), keyId: "fs-analyn-s1" }];
    expect(expectedSigner(seededRegistry, "treasurer", "fs-analyn-s1", NOW)).toMatchObject({
      ok: false,
      code: "KEY_NOT_REGISTERED",
      reason: "Seeded sample keys never sign.",
    });
    const seededKind: OfficerKey[] = [{ ...(REGISTRY[0] as OfficerKey), kind: "seeded" }];
    expect(expectedSigner(seededKind, "treasurer", KEY_ID.treasurer, NOW)).toMatchObject({
      ok: false,
      reason: "Seeded sample keys never sign.",
    });
    const seeded = signed({ keyId: "fs-analyn-s1" });
    expect(checkApproval(seeded, expected("treasurer", { keyId: "fs-analyn-s1" }), NOW, NONE)).toMatchObject({
      code: "KEY_NOT_REGISTERED",
      reason: "Seeded sample keys never sign.",
    });
    const revoked: OfficerKey[] = [{ ...(REGISTRY[0] as OfficerKey), revokedAt: "2026-10-29T02:00:00.000Z" }];
    expect(expectedSigner(revoked, "treasurer", KEY_ID.treasurer, NOW)).toMatchObject({
      ok: false,
      code: "KEY_NOT_REGISTERED",
    });
    expect(
      checkApproval(signed(), expected("treasurer", { revokedAt: "2026-10-29T02:00:00.000Z" }), NOW, NONE),
    ).toMatchObject({ code: "KEY_NOT_REGISTERED" });
    const later: OfficerKey[] = [{ ...(REGISTRY[0] as OfficerKey), revokedAt: "2026-10-29T03:00:00.000Z" }];
    expect(expectedSigner(later, "treasurer", KEY_ID.treasurer, NOW).ok).toBe(true);
    // A browser demo key registered for a judge session may sign (it is labelled; Proof reads "Sample").
    const demo: OfficerKey[] = [{ ...(REGISTRY[0] as OfficerKey), keyId: "fs-analyn-w7", kind: "web_demo" }];
    expect(expectedSigner(demo, "treasurer", "fs-analyn-w7", NOW).ok).toBe(true);
  });

  it("property: only the registry's key for the role, with its approver and season, ever passes", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<keyof typeof KEYS>("treasurer", "chair", "attacker"),
        fc.constantFrom("fs-analyn-w1", "fs-analyn-a1", "fs-ernesto-a1", "fs-analyn-s1", "fs-analyn-w2"),
        fc.constantFrom(APPROVER.treasurer, APPROVER.chair, "board:someone"),
        fc.constantFrom(SEASON, "season-2"),
        fc.constantFrom<ApprovalRole>("treasurer", "chair"),
        (key, keyId, approverId, seasonId, role) => {
          const r = checkApproval(
            signed({ role, key, keyId, approverId, seasonId }),
            expected("treasurer"),
            NOW,
            NONE,
          );
          const honest =
            role === "treasurer" &&
            key === "treasurer" &&
            keyId === KEY_ID.treasurer &&
            approverId === APPROVER.treasurer &&
            seasonId === SEASON;
          expect(r.ok).toBe(honest);
        },
      ),
    );
  });
});

describe("R5: who must co-sign", () => {
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
