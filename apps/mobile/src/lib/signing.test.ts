import { randomBytes } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import type { ApiResult, ApprovalSubmission, CosignRequestDTO } from "../_shims/api-client";
import type { ApprovalPayload, BatchItem } from "../_shims/contracts";
import { linesDigest as digestLines, jcs } from "../_shims/domain";
import {
  batchItems,
  batchSha256,
  batchTotalCents,
  linesDigest,
  namedLines,
  people,
  rateCardSha256,
  runId,
  season,
  senderBatchId,
} from "../_shims/seed";
import { buildDemoCosign } from "../services/demo-fixtures";
import {
  approvalBytes,
  authFailure,
  batchMatchesItems,
  biometricClassFor,
  type CosignDeps,
  checkApprovalPayload,
  checkCosignRequest,
  cosign,
  createDemoVault,
  createSoftwareSigner,
  demoKeyId,
  deviceKeyId,
  type ExpectedBatch,
  enrolledLevel,
  type KeySignOutcome,
  payloadStale,
  personaSlug,
  recomputeBatch,
  secureStoreFailure,
  verifyApproval,
} from "./signing";

const rnd = (n: number) => new Uint8Array(randomBytes(n));
const NOW = new Date("2026-10-29T10:20:00+08:00");

const expected: ExpectedBatch = {
  runId,
  rateCardSha256,
  batchSha256,
  linesDigest,
  itemCount: batchItems.length,
  totalCents: batchTotalCents,
  role: "CHAIR",
};

function payload(over: Partial<ApprovalPayload> = {}): ApprovalPayload {
  return {
    v: 1,
    runId,
    seasonId: season.id,
    rateCardSha256,
    batchSha256,
    linesDigest,
    itemCount: batchItems.length,
    totalCents: batchTotalCents,
    currency: "USD",
    role: "CHAIR",
    approverId: people.chair.approverId,
    nonce: "n_01JB7Q3X9M2",
    exp: new Date(NOW.getTime() + 10 * 60_000).toISOString(),
    ...over,
  };
}

function request(over: Partial<CosignRequestDTO> = {}): CosignRequestDTO {
  return { ...buildDemoCosign({ now: NOW, treasurerSigned: true }), ...over };
}

function firstItem(): CosignRequestDTO["items"][number] {
  const [first] = request().items;
  if (!first) throw new Error("the fixture has eight items");
  return first;
}

describe("approval payload", () => {
  it("matches the register's figures: 8 items, US$368.39", () => {
    expect(batchItems).toHaveLength(8);
    expect(batchTotalCents).toBe(36839);
  });

  it("signs exactly the RFC 8785 bytes: keys sorted, no whitespace", () => {
    const text = new TextDecoder().decode(approvalBytes(payload()));
    expect(text).toBe(jcs(payload()));
    expect(text.startsWith('{"approverId":"board:ernesto","batchSha256":')).toBe(true);
    expect(text).not.toMatch(/\s/);
  });

  it("accepts the batch on screen", () => {
    expect(checkApprovalPayload(payload(), expected, NOW)).toMatchObject({ ok: true });
  });

  it.each([
    ["batchSha256", { batchSha256: "0".repeat(64) }],
    ["totalCents", { totalCents: 36840 }],
    ["itemCount", { itemCount: 9 }],
    ["rateCardSha256", { rateCardSha256: "f".repeat(64) }],
    ["runId", { runId: "run_other" }],
    ["linesDigest", { linesDigest: "e".repeat(64) }],
  ] as const)("inv.i4.payload-differs: refuses when %s differs from the screen", (_k, over) => {
    expect(checkApprovalPayload(payload(over), expected, NOW)).toEqual({ ok: false, problem: "mismatch" });
  });

  it("inv.i4.cash-lines-bound: moving one cent between cash and PayPal lines changes the lines digest", () => {
    const moved = namedLines.map((l) =>
      l.memberNo === "M-053"
        ? { ...l, netCents: l.netCents - 1 }
        : l.memberNo === "M-014"
          ? { ...l, netCents: l.netCents + 1 }
          : l,
    );
    const changed = digestLines(runId, moved);
    expect(changed).not.toBe(linesDigest);
    expect(digestLines(runId, [...namedLines].reverse())).toBe(linesDigest); // order-independent
    expect(checkApprovalPayload(payload({ linesDigest: changed }), expected, NOW)).toEqual({
      ok: false,
      problem: "mismatch",
    });
  });

  it("refuses the wrong role, an expired request and an exp more than 30 minutes out", () => {
    expect(checkApprovalPayload(payload({ role: "TREASURER" }), expected, NOW)).toEqual({
      ok: false,
      problem: "role",
    });
    expect(
      checkApprovalPayload(payload({ exp: new Date(NOW.getTime() - 1).toISOString() }), expected, NOW),
    ).toEqual({ ok: false, problem: "expired" });
    expect(
      checkApprovalPayload(
        payload({ exp: new Date(NOW.getTime() + 45 * 60_000).toISOString() }),
        expected,
        NOW,
      ),
    ).toEqual({ ok: false, problem: "too-far" });
  });

  it("refuses extra or missing fields rather than signing what it cannot read", () => {
    expect(checkApprovalPayload({ ...payload(), memo: "x" }, expected, NOW)).toEqual({
      ok: false,
      problem: "malformed",
    });
    const { nonce: _n, ...missing } = payload();
    expect(checkApprovalPayload(missing, expected, NOW)).toEqual({ ok: false, problem: "malformed" });
    // The register's pre-amendment payload (no linesDigest) is refused rather than signed without the cash lines.
    const { linesDigest: _l, ...preAmendment } = payload();
    expect(checkApprovalPayload(preAmendment, expected, NOW)).toEqual({ ok: false, problem: "malformed" });
    expect(checkApprovalPayload(null, expected, NOW)).toEqual({ ok: false, problem: "malformed" });
    expect(checkApprovalPayload([payload()], expected, NOW)).toEqual({ ok: false, problem: "malformed" });
    expect(checkApprovalPayload(payload({ totalCents: 368.39 }), expected, NOW)).toEqual({
      ok: false,
      problem: "malformed",
    });
  });

  it("calls a payload stale when less than two minutes are left for the fingerprint step", () => {
    expect(payloadStale(null, NOW)).toBe(true);
    expect(payloadStale(payload(), NOW)).toBe(false);
    expect(payloadStale(payload({ exp: new Date(NOW.getTime() + 90_000).toISOString() }), NOW)).toBe(true);
    expect(payloadStale(payload({ exp: "not a date" }), NOW)).toBe(true);
  });
});

describe("co-sign request, recomputed on the phone (I4)", () => {
  it("draws the seed request's seal from its own hash: 8 items, US$368.39", () => {
    const r = checkCosignRequest(request());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recomputed).toEqual({ batchSha256, itemCount: 8, totalCents: 36839 });
    expect(r.expected).toEqual(expected);
  });

  it("inv.i4.server-hash-refused: a claimed hash that is not the items' hash is refused, with the phone's own", () => {
    const r = checkCosignRequest(request({ batchSha256: "0".repeat(64) }));
    expect(r).toEqual({
      ok: false,
      problem: "hash",
      recomputed: { batchSha256, itemCount: 8, totalCents: 36839 },
    });
  });

  it("inv.i4.items-swapped: a receiver changed under the same claimed hash is caught", () => {
    const [first, ...rest] = request().items;
    if (!first) throw new Error("fixture");
    const r = checkCosignRequest(request({ items: [{ ...first, receiver: "else@else.invalid" }, ...rest] }));
    expect(r).toMatchObject({ ok: false, problem: "hash" });
  });

  it("checks the claimed count and total against the items", () => {
    expect(checkCosignRequest(request({ itemCount: 9 }))).toMatchObject({ ok: false, problem: "count" });
    expect(checkCosignRequest(request({ totalCents: 36840 }))).toMatchObject({ ok: false, problem: "total" });
  });

  it.each([
    ["no items", { items: [] }, "no-items"],
    ["a zero amount", { items: [{ ...firstItem(), amountCents: 0 }] }, "bad-item"],
    ["a fractional amount", { items: [{ ...firstItem(), amountCents: 64.45 }] }, "bad-item"],
    ["a missing receiver", { items: [{ ...firstItem(), receiver: "" }] }, "bad-item"],
    ["the same item twice", { items: [firstItem(), firstItem()] }, "duplicate-item"],
    ["a currency other than USD", { items: [{ ...firstItem(), currency: "EUR" as "USD" }] }, "currency"],
    ["a malformed rate card hash", { rateCardSha256: "7f3a" }, "malformed"],
    ["a null item", { items: [null as unknown as CosignRequestDTO["items"][number]] }, "bad-item"],
  ] as const)("refuses %s before anything is drawn as signable", (_name, over, problem) => {
    expect(checkCosignRequest(request(over as Partial<CosignRequestDTO>))).toMatchObject({
      ok: false,
      problem,
    });
  });

  const batch = { runId, senderBatchId, rateCardSha256, batchSha256, items: batchItems };

  it("recomputes the register §8 digest whatever order the items arrive in", () => {
    expect(batchMatchesItems(batch)).toBe(true);
    fc.assert(
      fc.property(fc.shuffledSubarray([...batchItems], { minLength: batchItems.length }), (items) => {
        expect(recomputeBatch({ ...batch, items })?.batchSha256).toBe(batchSha256);
      }),
      { numRuns: 60 },
    );
  });

  it("inv.i4.items-tampered: any one-cent change to any item changes the hash", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: batchItems.length - 1 }),
        fc.integer({ min: -50, max: 50 }).filter((d) => d !== 0),
        (index, delta) => {
          const items: BatchItem[] = batchItems.map((it, i) =>
            i === index ? { ...it, amountCents: it.amountCents + delta } : it,
          );
          expect(batchMatchesItems({ ...batch, items })).toBe(false);
        },
      ),
      { numRuns: 80 },
    );
  });
});

describe("keys", () => {
  it("names the enrolled level and the presence step it allows", () => {
    expect([0, 1, 2, 3].map(enrolledLevel)).toEqual(["none", "secret", "weak", "strong"]);
    expect(biometricClassFor("none", "android")).toBeNull();
    expect(biometricClassFor("strong", "android")).toBe("biometric-bound");
    expect(biometricClassFor("strong", "ios")).toBe("pin-gated"); // iOS does not prompt when a value is created
    expect(biometricClassFor("weak", "android")).toBe("pin-gated");
    expect(biometricClassFor("secret", "android")).toBe("pin-gated");
  });

  it("maps the OS prompt's outcomes to the screen's states", () => {
    expect(authFailure("user_cancel")).toBe("cancelled");
    expect(authFailure("system_cancel")).toBe("cancelled");
    expect(authFailure("passcode_not_set")).toBe("no-lock");
    expect(authFailure("not_enrolled")).toBe("no-lock");
    expect(authFailure("lockout")).toBe("locked-out");
    expect(authFailure("authentication_failed")).toBe("error");
    expect(secureStoreFailure(new Error("User canceled the authentication"))).toBe("cancelled");
    expect(secureStoreFailure(new Error("KeyPermanentlyInvalidatedException"))).toBe("invalidated");
    expect(secureStoreFailure(new Error("Too many attempts. Try again later."))).toBe("locked-out");
    expect(secureStoreFailure("boom")).toBe("error");
  });

  it("names the phone's key after the paired persona (register §8)", () => {
    expect(deviceKeyId("board:ernesto")).toBe(people.chair.keyId);
    expect(personaSlug("board:Ma. Theresa")).toBe("matheresa");
    expect(personaSlug(null)).toBe("ernesto");
    expect(deviceKeyId("board:../../etc")).toBe("fs-etc-a1");
  });
});

describe("demo key (C-13)", () => {
  it("inv.i8.demo-key-labelled: web keys are named fs-{persona}-demo-{6} and say so", async () => {
    expect(demoKeyId("board:ernesto", rnd)).toMatch(/^fs-ernesto-demo-[a-z2-9]{6}$/);
    const vault = createDemoVault(rnd, () => NOW);
    expect(vault.kind).toBe("demo");
    expect(await vault.presence()).toBe("none");
    const r = await vault.sign({
      persona: "board:ernesto",
      message: new Uint8Array([1]),
      prompt: "p",
      cancelLabel: "c",
    });
    expect(r.ok && r.key.keyId).toMatch(/^fs-ernesto-demo-[a-z2-9]{6}$/);
    expect(r.ok && r.key.biometricClass).toBe("none");
  });

  it("keeps one key per judge session and makes a fresh one for the next session", async () => {
    const vault = createDemoVault(rnd, () => NOW);
    const req = { persona: "board:ernesto", message: new Uint8Array([1, 2]), prompt: "p", cancelLabel: "c" };
    const a = await vault.sign({ ...req, sessionTag: "s1" });
    const b = await vault.sign({ ...req, sessionTag: "s1" });
    const c = await vault.sign({ ...req, sessionTag: "s2" });
    if (!a.ok || !b.ok || !c.ok) throw new Error("expected signatures");
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.key.keyId).toBe(a.key.keyId);
    expect(c.created).toBe(true);
    expect(c.key.publicKeyHex).not.toBe(a.key.publicKeyHex);
    await vault.forget();
    expect(await vault.current()).toBeNull();
  });
});

describe("cosign", () => {
  function deps(over: Partial<CosignDeps> = {}) {
    const vault = createDemoVault(rnd, () => NOW);
    const registered = new Set<string>();
    const d = {
      now: () => NOW,
      online: () => true,
      sign: vi.fn(
        (message: Uint8Array): Promise<KeySignOutcome> =>
          vault.sign({ persona: "board:ernesto", message, prompt: "p", cancelLabel: "c", sessionTag: "t" }),
      ),
      isRegistered: (id: string) => registered.has(id),
      register: vi.fn(async (k: { keyId: string }): Promise<ApiResult<{ ok: true }>> => {
        registered.add(k.keyId);
        return { ok: true, value: { ok: true } };
      }),
      submit: vi.fn(
        async (_b: ApprovalSubmission): Promise<ApiResult<{ accepted: true }>> => ({
          ok: true,
          value: { accepted: true },
        }),
      ),
      ...over,
    };
    return d;
  }

  it("signs with Ed25519, registers a new key once, and the server can verify the signature", async () => {
    const d = deps();
    const r = await cosign(payload(), expected, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toBe(true);
    expect(r.submission.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(verifyApproval(r.submission, r.key.publicKeyHex)).toBe(true);
    expect(d.register).toHaveBeenCalledOnce();
    const again = await cosign(payload({ nonce: "n_01JB7Q3X9M3" }), expected, d);
    expect(again.ok && again.created).toBe(false);
    expect(d.register).toHaveBeenCalledOnce();
    expect(d.submit).toHaveBeenCalledTimes(2);
  });

  it("inv.i4.signature-binds-payload: a signature does not verify for a changed payload", async () => {
    const r = await cosign(payload(), expected, deps());
    if (!r.ok) throw new Error("expected ok");
    const forged: ApprovalSubmission = {
      ...r.submission,
      payload: { ...r.submission.payload, totalCents: 1 },
    };
    expect(verifyApproval(forged, r.key.publicKeyHex)).toBe(false);
  });

  it("inv.i4.refuse-before-key: a mismatched payload never reaches the key or the server", async () => {
    const d = deps();
    const r = await cosign(payload({ batchSha256: "1".repeat(64) }), expected, d);
    expect(r).toEqual({ ok: false, state: "mismatch", detail: "mismatch" });
    expect(d.sign).not.toHaveBeenCalled();
    expect(d.submit).not.toHaveBeenCalled();
  });

  it("inv.i6.human-gate: nothing is registered or sent when the person cancels the fingerprint", async () => {
    const d = deps({
      sign: vi.fn(async (): Promise<KeySignOutcome> => ({ ok: false, reason: "cancelled" })),
    });
    const r = await cosign(payload(), expected, d);
    expect(r).toEqual({ ok: false, state: "cancelled", detail: "cancelled" });
    expect(d.register).not.toHaveBeenCalled();
    expect(d.submit).not.toHaveBeenCalled();
  });

  it("never asks for a fingerprint without a connection", async () => {
    const d = deps({ online: () => false });
    expect(await cosign(payload(), expected, d)).toEqual({ ok: false, state: "offline", detail: "offline" });
    expect(d.sign).not.toHaveBeenCalled();
  });

  it("drops the signature, never queues it, when the key cannot be registered", async () => {
    const d = deps({ register: vi.fn(async () => ({ ok: false as const, code: "NETWORK" as const })) });
    const r = await cosign(payload(), expected, d);
    expect(r).toEqual({ ok: false, state: "offline", detail: "register:NETWORK" });
    expect(d.submit).not.toHaveBeenCalled();
  });

  it("refreshes rather than signs an expired payload, and refuses an exp too far out", async () => {
    const d = deps();
    const old = payload({ exp: new Date(NOW.getTime() - 1000).toISOString() });
    expect(await cosign(old, expected, d)).toEqual({ ok: false, state: "stale", detail: "expired" });
    const far = payload({ exp: new Date(NOW.getTime() + 60 * 60_000).toISOString() });
    expect(await cosign(far, expected, d)).toEqual({ ok: false, state: "error", detail: "too-far" });
    expect(d.sign).not.toHaveBeenCalled();
  });

  it.each([
    ["DIGEST_MISMATCH", 409, "mismatch"],
    ["APPROVAL_EXPIRED", 409, "stale"],
    ["NONCE_REUSED", 409, "stale"],
    ["NETWORK", undefined, "offline"],
    ["RATE_LIMITED", 429, "error"],
  ] as const)("maps the server's %s to %s", async (code, status, state) => {
    const d = deps({ submit: vi.fn(async () => ({ ok: false as const, code, status })) });
    expect(await cosign(payload(), expected, d)).toEqual({ ok: false, state, detail: code });
  });

  it("signs with a device-style key too (the native vault's contract)", async () => {
    const signer = createSoftwareSigner({ keyId: people.chair.keyId, kind: "device", randomBytes: rnd });
    const meta = {
      keyId: signer.keyId,
      publicKeyHex: await signer.publicKeyHex(),
      biometricClass: "biometric-bound" as const,
      createdAt: NOW.toISOString(),
    };
    const d = deps({
      sign: vi.fn(async (m: Uint8Array): Promise<KeySignOutcome> => {
        const s = await signer.sign(m, "p");
        return s.ok
          ? { ok: true, key: meta, signatureHex: s.signatureHex, created: false }
          : { ok: false, reason: "error" };
      }),
      isRegistered: () => true,
    });
    const r = await cosign(payload(), expected, d);
    expect(r.ok && r.submission.keyId).toBe("fs-ernesto-a1");
    expect(r.ok && verifyApproval(r.submission, meta.publicKeyHex)).toBe(true);
    expect(d.register).not.toHaveBeenCalled();
  });
});
