import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalSubmission } from "../_shims/api-client";
import type { ApprovalPayload } from "../_shims/contracts";
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
import {
  approvalBytes,
  batchMatchesItems,
  checkApprovalPayload,
  cosign,
  createSoftwareSigner,
  demoKeyId,
  type ExpectedBatch,
  type Signer,
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
  });
});

describe("batch digest on the phone", () => {
  const batch = { runId, senderBatchId, rateCardSha256, batchSha256, items: batchItems };

  it("recomputes the register §8 digest from the items shown", () => {
    expect(batchMatchesItems(batch)).toBe(true);
    expect(batchMatchesItems({ ...batch, items: [...batchItems].reverse() })).toBe(true); // order-independent
  });

  it("inv.i4.items-tampered: one cent moved between members changes the hash", () => {
    const [first, second, ...rest] = batchItems;
    if (!first || !second) throw new Error("fixture");
    const tampered = [
      { ...first, amountCents: first.amountCents + 1 },
      { ...second, amountCents: second.amountCents - 1 },
      ...rest,
    ];
    expect(batchMatchesItems({ ...batch, items: tampered })).toBe(false);
    const swapped = [{ ...first, receiver: "someone@else.invalid" }, second, ...rest];
    expect(batchMatchesItems({ ...batch, items: swapped })).toBe(false);
  });
});

describe("co-sign", () => {
  function submitOk() {
    return vi.fn(async (_b: ApprovalSubmission) => ({
      ok: true as const,
      value: { accepted: true as const },
    }));
  }

  it("signs with Ed25519 and the server can verify the signature with the registered public key", async () => {
    const signer = createSoftwareSigner({ keyId: people.chair.keyId, kind: "device", randomBytes: rnd });
    const submit = submitOk();
    const r = await cosign(payload(), expected, "Pirmahi", { signer, now: () => NOW, submit });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.submission.keyId).toBe("fs-ernesto-a1");
    expect(r.submission.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(verifyApproval(r.submission, await signer.publicKeyHex())).toBe(true);
    expect(submit).toHaveBeenCalledOnce();
  });

  it("inv.i4.signature-binds-payload: a signature does not verify for a changed payload", async () => {
    const signer = createSoftwareSigner({ keyId: "k", kind: "device", randomBytes: rnd });
    const r = await cosign(payload(), expected, "p", { signer, now: () => NOW, submit: submitOk() });
    if (!r.ok) throw new Error("expected ok");
    const forged: ApprovalSubmission = {
      ...r.submission,
      payload: { ...r.submission.payload, totalCents: 1 },
    };
    expect(verifyApproval(forged, await signer.publicKeyHex())).toBe(false);
  });

  it("inv.i4.refuse-before-key: a mismatched payload never reaches the key or the server", async () => {
    const sign = vi.fn();
    const signer: Signer = { keyId: "k", kind: "device", publicKeyHex: async () => "", sign };
    const submit = submitOk();
    const r = await cosign(payload({ batchSha256: "1".repeat(64) }), expected, "p", {
      signer,
      now: () => NOW,
      submit,
    });
    expect(r).toEqual({ ok: false, state: "mismatch", detail: "mismatch" });
    expect(sign).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("inv.i6.human-gate: nothing is signed or sent when the person cancels the biometric step", async () => {
    const confirm = vi.fn(async () => false);
    const signer = createSoftwareSigner({ keyId: "k", kind: "device", randomBytes: rnd, confirm });
    const submit = submitOk();
    const r = await cosign(payload(), expected, "Kupti, dayon gamita ang inyong fingerprint.", {
      signer,
      now: () => NOW,
      submit,
    });
    expect(r).toEqual({ ok: false, state: "cancelled", detail: "cancelled" });
    expect(confirm).toHaveBeenCalledWith("Kupti, dayon gamita ang inyong fingerprint.");
    expect(submit).not.toHaveBeenCalled();
  });

  it("reports the server's DIGEST_MISMATCH as a mismatch (the batch changed after it was opened)", async () => {
    const signer = createSoftwareSigner({ keyId: "k", kind: "device", randomBytes: rnd });
    const r = await cosign(payload(), expected, "p", {
      signer,
      now: () => NOW,
      submit: async () => ({ ok: false, code: "DIGEST_MISMATCH", status: 409 }),
    });
    expect(r).toEqual({ ok: false, state: "mismatch", detail: "DIGEST_MISMATCH" });
  });
});

describe("demo key (C-13)", () => {
  it("inv.i8.demo-key-labelled: web keys are named fs-{persona}-demo-{6} and say so", () => {
    const id = demoKeyId("ernesto", rnd);
    expect(id).toMatch(/^fs-ernesto-demo-[a-z2-9]{6}$/);
    const signer = createSoftwareSigner({ keyId: id, kind: "demo", randomBytes: rnd });
    expect(signer.kind).toBe("demo");
  });

  it("generates a fresh key per session", async () => {
    const a = createSoftwareSigner({ keyId: "a", kind: "demo", randomBytes: rnd });
    const b = createSoftwareSigner({ keyId: "b", kind: "demo", randomBytes: rnd });
    expect(await a.publicKeyHex()).not.toBe(await b.publicKeyHex());
  });
});
