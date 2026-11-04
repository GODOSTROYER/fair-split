// Tests that kill mutation-testing survivors (handoff T3) in the human gate (I6): every field the
// signature binds is compared on its own, the revocation and expiry edges, the role each approval
// claims twice (outside and inside the payload), the nonce store, the two-people check when a key
// is presented for one role and registered for the other, and each refusal's exact words.
import type { ApprovalRole, OfficerKey, SignedApproval } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { testCanonical } from "./__fixtures__/world.js";
import {
  type ApprovalExpectation,
  approvalBytes,
  buildApprovalPayload,
  checkApproval,
  checkApprovals,
  expectedSigner,
  linesDigest,
} from "./approval.js";
import { sha256Hex } from "./canon.js";
import { jcs } from "./jcs.js";
import { quotesInTextLayer } from "./ratecard.js";
import { ed25519FromSeed, ed25519Sign } from "./sig.js";

const RC = "a".repeat(64);
const BATCH = { batchSha256: "b".repeat(64), itemCount: 8, totalCents: 36_839 };
const LINES = "d".repeat(64);
const NOW = new Date("2026-10-29T02:09:00.000Z");
const SEASON = "season-1";
const NONE: ReadonlySet<string> = new Set();
const KEYS = {
  treasurer: ed25519FromSeed(sha256Hex("edge key treasurer")),
  chair: ed25519FromSeed(sha256Hex("edge key chair")),
};
const APPROVER = { treasurer: "treasurer:analyn", chair: "board:ernesto" } as const;
const KEY_ID = { treasurer: "fs-analyn-w1", chair: "fs-ernesto-a1" } as const;
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

function signed(
  role: ApprovalRole = "treasurer",
  o: { payloadRole?: ApprovalRole; keyId?: string; nonce?: string; expMs?: number } = {},
): SignedApproval {
  const payload = buildApprovalPayload({
    runId: "run-1",
    seasonId: SEASON,
    rateCardSha256: RC,
    batch: BATCH,
    linesDigest: LINES,
    role: o.payloadRole ?? role,
    approverId: APPROVER[role],
    nonce: o.nonce ?? `nonce-${role}-0001`,
    exp: new Date(NOW.getTime() + (o.expMs ?? 20 * 60_000)).toISOString(),
  });
  return {
    role,
    keyId: o.keyId ?? KEY_ID[role],
    publicKeyHex: KEYS[role].publicKeyHex,
    payload,
    signatureHex: ed25519Sign(KEYS[role].privateKey, approvalBytes(payload)),
  };
}

function expected(
  role: ApprovalRole = "treasurer",
  over: Partial<ApprovalExpectation> = {},
): ApprovalExpectation {
  const found = expectedSigner(REGISTRY, role, KEY_ID[role], NOW);
  if (!found.ok) throw new Error(found.reason);
  return {
    runId: "run-1",
    seasonId: SEASON,
    rateCardSha256: RC,
    ...BATCH,
    linesDigest: LINES,
    role,
    ...found.signer,
    ...over,
  };
}

describe("checkApproval binds every signed field on its own", () => {
  it("accepts the exact approval", () => {
    expect(checkApproval(signed(), expected(), NOW, NONE)).toEqual({ ok: true });
  });

  it.each([
    ["the rate card", { rateCardSha256: "c".repeat(64) }],
    ["the item count", { itemCount: 9 }],
    ["the total", { totalCents: 36_840 }],
    ["the run", { runId: "run-2" }],
    ["the batch digest", { batchSha256: "e".repeat(64) }],
  ])("refuses an approval of another %s as DIGEST_MISMATCH", (_label, over) => {
    expect(checkApproval(signed(), expected("treasurer", over), NOW, NONE)).toEqual({
      ok: false,
      code: "DIGEST_MISMATCH",
      reason: "The batch changed after it was signed. Nothing was sent.",
    });
  });

  it("refuses a payload in another currency", () => {
    const s = signed();
    const forged = { ...s, payload: { ...s.payload, currency: "EUR" as "USD" } };
    expect(checkApproval(forged, expected(), NOW, NONE)).toMatchObject({
      ok: false,
      code: "DIGEST_MISMATCH",
    });
  });

  it("refuses an approval whose outer role, or whose payload role, is not the expected one", () => {
    const refusal = {
      ok: false,
      code: "APPROVER_MISMATCH",
      reason: "This approval was signed for another role.",
    };
    const outer = { ...signed(), role: "chair" as const };
    expect(checkApproval(outer, expected(), NOW, NONE)).toEqual(refusal);
    const inner = signed("treasurer", { payloadRole: "chair" });
    expect(checkApproval(inner, expected(), NOW, NONE)).toEqual(refusal);
  });

  it("names a different approver and a different season", () => {
    expect(
      checkApproval(signed(), expected("treasurer", { approverId: "treasurer:other" }), NOW, NONE),
    ).toEqual({
      ok: false,
      code: "APPROVER_MISMATCH",
      reason: "This approval names a different approver.",
    });
    expect(checkApproval(signed(), expected("treasurer", { seasonId: "season-2" }), NOW, NONE)).toEqual({
      ok: false,
      code: "SEASON_MISMATCH",
      reason: "This approval was made for another season.",
    });
  });

  it("expires at exp itself, and names reuse and a bad signature", () => {
    const atExp = signed("treasurer", { expMs: 0 });
    expect(checkApproval(atExp, expected(), NOW, NONE)).toEqual({
      ok: false,
      code: "APPROVAL_EXPIRED",
      reason: "The co-sign request expired. Send again.",
    });
    expect(checkApproval(signed(), expected(), NOW, new Set(["nonce-treasurer-0001"]))).toEqual({
      ok: false,
      code: "NONCE_REUSED",
      reason: "This approval was already used.",
    });
    const s = signed();
    const flipped = (s.signatureHex[0] === "0" ? "1" : "0") + s.signatureHex.slice(1);
    const bad = { ...s, signatureHex: flipped };
    expect(checkApproval(bad, expected(), NOW, NONE)).toEqual({
      ok: false,
      code: "SIGNATURE_INVALID",
      reason: "The signature does not verify.",
    });
  });
});

describe("keys: seeded, malformed, revoked", () => {
  it("a seeded key presented is refused as such, even when the expected key is real", () => {
    const seeded = { ...signed(), keyId: "seed-analyn-1" };
    expect(checkApproval(seeded, expected(), NOW, NONE)).toMatchObject({
      code: "KEY_NOT_REGISTERED",
      reason: expect.stringMatching(/sample keys never sign|not a device key/i),
    });
  });

  it("a presented key ID that is not a device key is named, even when the expected one is", () => {
    const odd = { ...signed(), keyId: "not-a-key" };
    expect(checkApproval(odd, expected(), NOW, NONE)).toEqual({
      ok: false,
      code: "KEY_NOT_REGISTERED",
      reason: "Unknown signer: not-a-key is not a device key.",
    });
  });

  it("an expectation with no revocation field is not revoked; one revoked at this very moment is", () => {
    const { revokedAt: _gone, ...unset } = expected();
    expect(checkApproval(signed(), unset as ApprovalExpectation, NOW, NONE)).toEqual({ ok: true });
    expect(
      checkApproval(signed(), expected("treasurer", { revokedAt: NOW.toISOString() }), NOW, NONE),
    ).toEqual({
      ok: false,
      code: "KEY_NOT_REGISTERED",
      reason: `Unknown signer: ${KEY_ID.treasurer} was revoked.`,
    });
  });

  it("the registry names a revoked key and a key listed twice", () => {
    const revoked = REGISTRY.map((k) =>
      k.role === "treasurer" ? { ...k, revokedAt: NOW.toISOString() } : k,
    );
    expect(expectedSigner(revoked, "treasurer", KEY_ID.treasurer, NOW)).toEqual({
      ok: false,
      code: "KEY_NOT_REGISTERED",
      reason: `Unknown signer: ${KEY_ID.treasurer} was revoked.`,
    });
    const twice = [...REGISTRY, REGISTRY[0] as OfficerKey];
    expect(expectedSigner(twice, "treasurer", KEY_ID.treasurer, NOW)).toEqual({
      ok: false,
      code: "KEY_NOT_REGISTERED",
      reason: `Unknown signer: the key registry lists ${KEY_ID.treasurer} more than once.`,
    });
  });
});

describe("the nonce store is required", () => {
  it.each([
    ["null", null],
    ["an object without has()", {}],
  ])("checkApproval and checkApprovals throw on %s, before any refusal", (_label, store) => {
    expect(() => checkApproval(signed(), expected(), NOW, store as never)).toThrow(TypeError);
    // A set that would be refused at once (no treasurer) still throws first.
    expect(() =>
      checkApprovals(
        { approvals: [signed("chair")], expected: {}, chairRequired: false },
        NOW,
        store as never,
      ),
    ).toThrow("usedNonces is required: pass the run's spent approval nonces.");
  });
});

describe("checkApprovals: one approval per role, two people", () => {
  const both = { treasurer: expected("treasurer"), chair: expected("chair") };

  it("names each missing or repeated approval", () => {
    expect(
      checkApprovals({ approvals: [signed(), signed()], expected: both, chairRequired: false }, NOW, NONE),
    ).toEqual({
      ok: false,
      code: "SIGNERS_NOT_DISTINCT",
      reason: "One role signed twice.",
    });
    expect(
      checkApprovals({ approvals: [signed("chair")], expected: both, chairRequired: false }, NOW, NONE),
    ).toEqual({
      ok: false,
      code: "APPROVALS_MISSING",
      reason: "The treasurer's approval is missing.",
    });
    expect(checkApprovals({ approvals: [signed()], expected: both, chairRequired: true }, NOW, NONE)).toEqual(
      {
        ok: false,
        code: "APPROVALS_MISSING",
        reason: "The Chair's co-signature is missing.",
      },
    );
  });

  it("an expectation filed under the right role but made for another is no registered key", () => {
    expect(
      checkApprovals(
        { approvals: [signed()], expected: { treasurer: expected("chair") }, chairRequired: false },
        NOW,
        NONE,
      ),
    ).toEqual({
      ok: false,
      code: "KEY_NOT_REGISTERED",
      reason: "Unknown signer: no key is registered for the treasurer.",
    });
  });

  it("a key presented by the Chair that the registry holds for the treasurer is a second person's key", () => {
    // The Chair presents the treasurer's key ID; the treasurer presents another ID. Only one key ID is
    // shared between the two pairs, so the overlap is "some", not "every".
    const treasurer = signed("treasurer", { keyId: "fs-analyn-w2" });
    const chair = signed("chair", { keyId: KEY_ID.treasurer });
    expect(
      checkApprovals({ approvals: [treasurer, chair], expected: both, chairRequired: true }, NOW, NONE),
    ).toEqual({
      ok: false,
      code: "SIGNERS_NOT_DISTINCT",
      reason: "The treasurer and the Chair must be two people with two keys.",
    });
  });

  it("names a nonce the two approvals share", () => {
    const t = signed("treasurer", { nonce: "nonce-shared-01" });
    const c = signed("chair", { nonce: "nonce-shared-01" });
    expect(checkApprovals({ approvals: [t, c], expected: both, chairRequired: true }, NOW, NONE)).toEqual({
      ok: false,
      code: "NONCE_REUSED",
      reason: "Each approval needs its own nonce.",
    });
  });
});

describe("digests and text the gate relies on", () => {
  it("linesDigest names why it cannot be computed", () => {
    expect(() => linesDigest([])).toThrow("linesDigest needs the run's lines");
    const line = { memberNo: "M-001", lineSha256: "f".repeat(64) };
    expect(() => linesDigest([line, line])).toThrow("linesDigest needs one line per member");
  });

  it("jcs refuses what JSON cannot carry, by name", () => {
    expect(() => jcs(undefined)).toThrow("value is not JSON-serialisable");
  });

  it("ed25519FromSeed takes exactly 32 bytes of hex", () => {
    expect(() => ed25519FromSeed(`${sha256Hex("x")}00`)).toThrow("seed must be 32 bytes of hex");
    expect(() => ed25519FromSeed(`00${sha256Hex("x")}`)).toThrow("seed must be 32 bytes of hex");
  });

  it("quotesInTextLayer ignores curly or straight quote marks, runs of spaces and edge spaces only", () => {
    const card = testCanonical();
    const [term] = card.terms;
    if (!term) throw new Error("the test card has terms");
    const quote = term.source.quote;
    const plain = quote.replace(/[‘’“”'"]/g, "");
    expect(quotesInTextLayer({ ...card, terms: [term] }, `  ${plain.split(" ").join("   ")}  `)).toEqual([]);
    const curly = { ...term, source: { ...term.source, quote: `“${quote}”` } };
    expect(quotesInTextLayer({ ...card, terms: [curly] }, plain)).toEqual([]);
    const spaced = { ...term, source: { ...term.source, quote: ` ${quote.split(" ").join("  ")} ` } };
    expect(quotesInTextLayer({ ...card, terms: [spaced] }, plain)).toEqual([]);
    expect(quotesInTextLayer({ ...card, terms: [term] }, plain.replace(/ /g, ""))).toEqual([
      `${term.ruleId}/${term.pool}`,
    ]);
  });
});
