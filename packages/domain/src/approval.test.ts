import type { SignedApproval } from "@fairsplit/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TEST_RULES } from "./__fixtures__/world.js";
import {
  APPROVAL_MAX_TTL_MS,
  approvalBytes,
  approvalJcs,
  approvalSignatureValid,
  buildApprovalPayload,
  checkApproval,
  requiresChair,
} from "./approval.js";
import { sha256Hex } from "./canon.js";
import { ed25519FromSeed, ed25519Sign } from "./sig.js";

const RC = "a".repeat(64);
const BATCH = { batchSha256: "b".repeat(64), itemCount: 8, totalCents: 36_839 };
const NOW = new Date("2026-10-29T02:09:00.000Z");

function signed(
  role: "treasurer" | "chair" = "treasurer",
  nonce = "nonce-0001",
  expMs = 20 * 60 * 1000,
): SignedApproval {
  const key = ed25519FromSeed(sha256Hex(`key ${role}`));
  const payload = buildApprovalPayload({
    runId: "run-1",
    seasonId: "season-1",
    rateCardSha256: RC,
    batch: BATCH,
    role,
    approverId: role === "treasurer" ? "treasurer:analyn" : "board:ernesto",
    nonce,
    exp: new Date(NOW.getTime() + expMs).toISOString(),
  });
  return {
    role,
    keyId: role === "treasurer" ? "fs-analyn-a1" : "fs-ernesto-a1",
    publicKeyHex: key.publicKeyHex,
    payload,
    signatureHex: ed25519Sign(key.privateKey, approvalBytes(payload)),
  };
}

const expected = { runId: "run-1", rateCardSha256: RC, ...BATCH, role: "treasurer" as const };

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
    expect(approvalSignatureValid(s)).toBe(true);
  });

  it("accepts a valid approval and refuses mismatch, expiry, reuse and forgery", () => {
    const s = signed();
    expect(checkApproval(s, expected, NOW)).toEqual({ ok: true });
    expect(checkApproval(s, { ...expected, batchSha256: "c".repeat(64) }, NOW)).toMatchObject({
      ok: false,
      code: "DIGEST_MISMATCH",
    });
    expect(checkApproval(s, { ...expected, totalCents: 36_840 }, NOW)).toMatchObject({
      code: "DIGEST_MISMATCH",
    });
    expect(checkApproval(s, { ...expected, role: "chair" }, NOW)).toMatchObject({ code: "DIGEST_MISMATCH" });
    expect(checkApproval(s, expected, new Date(NOW.getTime() + 21 * 60 * 1000))).toMatchObject({
      code: "APPROVAL_EXPIRED",
    });
    expect(
      checkApproval(signed("treasurer", "nonce-0002", APPROVAL_MAX_TTL_MS + 1000), expected, NOW),
    ).toMatchObject({
      code: "APPROVAL_EXPIRED",
    });
    expect(checkApproval(s, expected, NOW, new Set(["nonce-0001"]))).toMatchObject({ code: "NONCE_REUSED" });
    const forged = { ...s, payload: { ...s.payload, approverId: "board:someone" } };
    expect(checkApproval(forged, expected, NOW)).toMatchObject({ code: "SIGNATURE_INVALID" });
    const wrongKey = { ...s, publicKeyHex: signed("chair").publicKeyHex };
    expect(checkApproval(wrongKey, expected, NOW)).toMatchObject({ code: "SIGNATURE_INVALID" });
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
