import { randomBytes } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import type {
  ApiResult,
  ApprovalPayloadDTO,
  ApprovalSubmission,
  CosignRequestDTO,
} from "../_shims/api-client";
import type { ApprovalPayload, BatchItem } from "../_shims/contracts";
import { deviceKeyIdFitsKind } from "../_shims/contracts";
import { batchDigest, linesDigest as digestLines, jcs } from "../_shims/domain";
import {
  batchItems,
  batchSha256,
  batchTotalCents,
  linesDigest,
  people,
  rateCardSha256,
  runId,
  runLines,
  seasonId,
  senderBatchId,
} from "../_shims/seed";
import { buildDemoApproval, buildDemoCosign } from "../services/demo-fixtures";
import {
  forgedCashLine,
  movedCashCent,
  movedCent,
  relined,
  tamperedApproval,
  withLines,
} from "../test/cosign-batches";
import {
  approvalBytes,
  approvalPayloadShape,
  authFailure,
  type BiometricClass,
  batchMatchesItems,
  biometricClassFor,
  type CosignDeps,
  checkApprovalPayload,
  checkCosignRequest,
  checkLines,
  cosign,
  createDemoVault,
  createDeviceVault,
  createKeyRegistry,
  createSoftwareSigner,
  type DeviceVaultDeps,
  demoKeyId,
  deviceKeyId,
  deviceKeyKindOf,
  deviceKeyParts,
  type ExpectedBatch,
  enrolledLevel,
  itemsMatchLines,
  type KeyFailure,
  type KeySignOutcome,
  MAX_KEY_GENERATION,
  payloadStale,
  personaSlug,
  recomputeBatch,
  secureStoreFailure,
  verifyApproval,
} from "./signing";

const rnd = (n: number) => new Uint8Array(randomBytes(n));
const NOW = new Date("2026-10-29T10:20:00+08:00");
/** Two pairings of this phone (`pairingId`): the Chair's, and the next one (paired again, by anyone). */
const P1 = "pairing-ernesto-1";
const P2 = "pairing-ernesto-2";

const expected: ExpectedBatch & { approverId: string } = {
  runId,
  seasonId,
  approverId: people.chair.approverId,
  rateCardSha256,
  batchSha256,
  linesDigest,
  itemCount: batchItems.length,
  totalCents: batchTotalCents,
  role: "chair",
};

function payload(over: Partial<ApprovalPayload> = {}): ApprovalPayload {
  return {
    v: 1,
    runId,
    seasonId,
    rateCardSha256,
    batchSha256,
    linesDigest,
    itemCount: batchItems.length,
    totalCents: batchTotalCents,
    currency: "USD",
    role: "chair",
    approverId: people.chair.approverId,
    nonce: "n_01JB7Q3X9M2",
    exp: new Date(NOW.getTime() + 10 * 60_000).toISOString(),
    ...over,
  };
}

/** The approval-payload answer for the seed batch: the payload, its JCS, and the items and lines it binds. */
function approval(
  over: Partial<ApprovalPayload> = {},
  dto: Partial<ApprovalPayloadDTO> = {},
): ApprovalPayloadDTO {
  const p = payload(over);
  return { payload: p, jcs: jcs(p), senderBatchId, items: batchItems, lines: runLines, ...dto };
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
  it.each([{ approverId: "board:someone-else" }, { seasonId: "other-season" }])(
    "inv.i6.payload-identity: refuses %j before any key is touched",
    async (change) => {
      const sign = vi.fn();
      const register = vi.fn();
      const submit = vi.fn();
      const result = await cosign(approval(change), expected, {
        now: () => NOW,
        online: () => true,
        sign,
        register,
        submit,
        isRegistered: () => false,
      });
      expect(result).toMatchObject({ ok: false, state: "mismatch" });
      expect(sign).not.toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
    },
  );
  it("matches the register's figures: 8 items, US$368.39, and binds all 64 member lines", () => {
    expect(batchItems).toHaveLength(8);
    expect(batchTotalCents).toBe(36839);
    expect(runLines).toHaveLength(64);
  });

  it("signs exactly the RFC 8785 bytes: keys sorted, no whitespace", () => {
    const text = new TextDecoder().decode(approvalBytes(payload()));
    expect(text).toBe(jcs(payload()));
    expect(text.startsWith('{"approverId":"board:ernesto","batchSha256":')).toBe(true);
    expect(text).not.toMatch(/\s/);
  });

  it("accepts the batch on screen, with the items and lines it binds", () => {
    const r = checkApprovalPayload(approval(), expected, NOW);
    expect(r).toMatchObject({ ok: true, payload: payload() });
    expect(r.ok && r.dto.lines).toHaveLength(64);
  });

  it.each([
    ["batchSha256", { batchSha256: "0".repeat(64) }],
    ["totalCents", { totalCents: 36840 }],
    ["itemCount", { itemCount: 9 }],
    ["rateCardSha256", { rateCardSha256: "f".repeat(64) }],
    ["runId", { runId: "run_other" }],
    ["linesDigest", { linesDigest: "e".repeat(64) }],
  ] as const)(
    "inv.i4.payload-recomputed: refuses a payload whose %s is not what its own items and lines give",
    (_k, over) => {
      expect(checkApprovalPayload(approval(over), expected, NOW)).toEqual({ ok: false, problem: "mismatch" });
    },
  );

  it.each(["items", "lines", "jcs", "senderBatchId"] as const)(
    "inv.i4.payload-recomputed: refuses an answer whose %s were changed under the same payload",
    (part) => {
      expect(checkApprovalPayload(tamperedApproval(approval(), part), expected, NOW)).toEqual({
        ok: false,
        problem: "mismatch",
      });
    },
  );

  it("inv.i4.payload-recomputed: refuses an answer that drops a member line or pays a cash line", () => {
    expect(checkApprovalPayload(approval({}, { lines: runLines.slice(1) }), expected, NOW)).toEqual({
      ok: false,
      problem: "mismatch",
    });
    const cash = runLines.find((l) => l.rail === "CASH");
    if (!cash) throw new Error("the run has cash lines");
    const items: BatchItem[] = [
      ...batchItems,
      {
        senderItemId: `r37-${cash.memberNo}`,
        receiver: "cash@x.invalid",
        amountCents: cash.netCents,
        currency: "USD",
      },
    ];
    const d = batchDigest({ runId, senderBatchId, rateCardSha256 }, items);
    const paysCash = approval(
      { batchSha256: d.batchSha256, itemCount: d.itemCount, totalCents: d.totalCents },
      { items },
    );
    expect(checkApprovalPayload(paysCash, expected, NOW)).toEqual({ ok: false, problem: "mismatch" });
  });

  it("inv.i4.payload-differs: refuses a payload that checks out but is not the batch the Chair opened", () => {
    const other = movedCent(request());
    const answer = buildDemoApproval(other, { role: "chair", nonce: "n_01JB7Q3X9M2", exp: payload().exp });
    // Internally sound: its own items and lines give its digests …
    const opened = checkCosignRequest(other);
    expect(opened.ok && checkApprovalPayload(answer, opened.expected, NOW).ok).toBe(true);
    // … but not the batch on screen.
    expect(checkApprovalPayload(answer, expected, NOW)).toEqual({ ok: false, problem: "mismatch" });
  });

  it("inv.i4.cash-lines-bound: one cent moved between two cash lines is another lines digest, refused", () => {
    const other = movedCashCent(request());
    expect(other.batchSha256).toBe(batchSha256); // the same eight payouts …
    expect(other.linesDigest).not.toBe(linesDigest); // … but not the same member lines
    expect(digestLines([...runLines].reverse())).toBe(linesDigest); // order-independent
    const answer = buildDemoApproval(other, { role: "chair", nonce: "n_01JB7Q3X9M2", exp: payload().exp });
    expect(checkApprovalPayload(answer, expected, NOW)).toEqual({ ok: false, problem: "mismatch" });
  });

  it("refuses the wrong role, an expired request and an exp more than 30 minutes out", () => {
    expect(checkApprovalPayload(approval({ role: "treasurer" }), expected, NOW)).toEqual({
      ok: false,
      problem: "role",
    });
    expect(
      checkApprovalPayload(approval({ exp: new Date(NOW.getTime() - 1).toISOString() }), expected, NOW),
    ).toEqual({ ok: false, problem: "expired" });
    expect(
      checkApprovalPayload(
        approval({ exp: new Date(NOW.getTime() + 45 * 60_000).toISOString() }),
        expected,
        NOW,
      ),
    ).toEqual({ ok: false, problem: "too-far" });
  });

  it("refuses extra or missing fields rather than signing what it cannot read", () => {
    const bad = (p: unknown) => checkApprovalPayload({ ...approval(), payload: p }, expected, NOW);
    expect(bad({ ...payload(), memo: "x" })).toEqual({ ok: false, problem: "malformed" });
    const { nonce: _n, ...missing } = payload();
    expect(bad(missing)).toEqual({ ok: false, problem: "malformed" });
    // The register's pre-amendment payload (no linesDigest) is refused rather than signed without the cash lines.
    const { linesDigest: _l, ...preAmendment } = payload();
    expect(bad(preAmendment)).toEqual({ ok: false, problem: "malformed" });
    expect(bad({ ...payload(), totalCents: 368.39 })).toEqual({ ok: false, problem: "malformed" });
    // The roles are the package's, lowercase: "CHAIR" is not a role.
    expect(bad({ ...payload(), role: "CHAIR" })).toEqual({ ok: false, problem: "malformed" });
    // contracts `IsoDateTime` is UTC with a Z: an offset time is not one.
    expect(bad({ ...payload(), exp: "2026-10-29T10:30:00+08:00" })).toEqual({
      ok: false,
      problem: "malformed",
    });
    expect(checkApprovalPayload(null, expected, NOW)).toEqual({ ok: false, problem: "malformed" });
    expect(checkApprovalPayload([approval()], expected, NOW)).toEqual({ ok: false, problem: "malformed" });
    // A bare payload, without the items and lines to recompute it from, is never signed.
    expect(checkApprovalPayload(payload(), expected, NOW)).toEqual({ ok: false, problem: "malformed" });
    for (const part of ["jcs", "senderBatchId", "items", "lines"] as const) {
      const { [part]: _gone, ...rest } = approval();
      expect(checkApprovalPayload(rest, expected, NOW), part).toEqual({ ok: false, problem: "malformed" });
    }
  });

  it("reads the payload's shape as contracts' strict ApprovalPayload does", () => {
    expect(approvalPayloadShape(payload())).toEqual(payload());
    expect(approvalPayloadShape({ ...payload(), itemCount: 0 })).toBeNull();
    expect(approvalPayloadShape({ ...payload(), nonce: "short" })).toBeNull();
    expect(approvalPayloadShape({ ...payload(), exp: "2026-02-30T10:00:00Z" })).toBeNull();
    // RFC 3339 needs seconds beside a Z (zod 4.6's `z.iso.datetime()`).
    expect(approvalPayloadShape({ ...payload(), exp: "2026-10-29T10:30Z" })).toBeNull();
    expect(approvalPayloadShape({ ...payload(), exp: "2026-10-29T10:30:00.123456Z" })).not.toBeNull();
  });

  it("calls a payload stale when less than two minutes are left for the fingerprint step", () => {
    expect(payloadStale(null, NOW)).toBe(true);
    expect(payloadStale(payload(), NOW)).toBe(false);
    expect(payloadStale(payload({ exp: new Date(NOW.getTime() + 90_000).toISOString() }), NOW)).toBe(true);
    expect(payloadStale(payload({ exp: "not a date" }), NOW)).toBe(true);
  });
});

describe("member lines, recomputed on the phone (approved plan: both keys bind every line)", () => {
  it("counts the 64 lines it re-hashed: 8 on PayPal (the batch) and 56 in cash, US$3,849.78", () => {
    expect(checkLines(runLines, rateCardSha256)).toEqual({
      ok: true,
      linesDigest,
      summary: { count: 64, paypal: { count: 8, cents: 36839 }, cash: { count: 56, cents: 384978 } },
    });
  });

  it("inv.i4.line-hash: a line is refused unless its hash is its content's and its content is this line", () => {
    expect(checkLines(forgedCashLine(runLines), rateCardSha256)).toEqual({ ok: false, problem: "lines" });
    const [first, ...rest] = runLines;
    if (!first) throw new Error("the run has lines");
    const elsewhere = { ...first, memberNo: "M-099" };
    expect(checkLines([elsewhere, ...rest], rateCardSha256)).toEqual({ ok: false, problem: "lines" });
    const railSwap = { ...first, rail: first.rail === "CASH" ? ("PAYPAL" as const) : ("CASH" as const) };
    expect(checkLines([railSwap, ...rest], rateCardSha256)).toEqual({ ok: false, problem: "lines" });
    expect(checkLines(runLines, "f".repeat(64))).toEqual({ ok: false, problem: "lines" });
    expect(checkLines([first, first, ...rest], rateCardSha256)).toEqual({ ok: false, problem: "lines" });
  });

  it("refuses lines it cannot read", () => {
    const [first] = runLines;
    if (!first) throw new Error("the run has lines");
    expect(checkLines(undefined, rateCardSha256)).toEqual({ ok: false, problem: "malformed" });
    expect(checkLines([], rateCardSha256)).toEqual({ ok: false, problem: "malformed" });
    expect(checkLines([{ ...first, rail: "GCASH" }], rateCardSha256)).toEqual({
      ok: false,
      problem: "malformed",
    });
    expect(checkLines([{ ...first, netCents: 1.5 }], rateCardSha256)).toEqual({
      ok: false,
      problem: "malformed",
    });
    expect(checkLines([{ ...first, canonical: null }], rateCardSha256)).toEqual({
      ok: false,
      problem: "malformed",
    });
  });

  it("inv.i3.payouts-are-paypal-lines: every payout is exactly one PayPal line's net, no member twice", () => {
    expect(itemsMatchLines(batchItems, runLines)).toBe(true);
    const [first, ...rest] = batchItems;
    if (!first) throw new Error("the batch has items");
    expect(itemsMatchLines([{ ...first, amountCents: first.amountCents + 1 }, ...rest], runLines)).toBe(
      false,
    );
    expect(itemsMatchLines([...batchItems, { ...first, senderItemId: "r37x1-M-002" }], runLines)).toBe(false);
    expect(itemsMatchLines([{ ...first, senderItemId: "payout-1" }, ...rest], runLines)).toBe(false);
    const cash = runLines.find((l) => l.rail === "CASH");
    if (!cash) throw new Error("the run has cash lines");
    const toCash = { ...first, senderItemId: `r37-${cash.memberNo}`, amountCents: cash.netCents };
    expect(itemsMatchLines([toCash, ...rest], runLines)).toBe(false);
    // A re-route pays the same line under its own sender_item_id.
    expect(itemsMatchLines([{ ...first, senderItemId: "r37x2-M-002" }, ...rest], runLines)).toBe(true);
  });
});

describe("co-sign request, recomputed on the phone (I4)", () => {
  it("draws the seed request's seal from its own hash and counts the lines it binds", () => {
    const r = checkCosignRequest(request());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recomputed).toEqual({ batchSha256, itemCount: 8, totalCents: 36839 });
    const { approverId: _, ...batch } = expected;
    expect(r.expected).toEqual(batch);
    expect(r.lines).toEqual({
      count: 64,
      paypal: { count: 8, cents: 36839 },
      cash: { count: 56, cents: 384978 },
    });
  });

  it("inv.i4.lines-required: a request without its member lines is never signable", () => {
    const { lines: _l, ...bare } = request();
    expect(checkCosignRequest(bare as CosignRequestDTO)).toMatchObject({ ok: false, problem: "malformed" });
  });

  it("inv.i4.lines-recomputed: the claimed lines digest must be the phone's own, over lines it re-hashed", () => {
    expect(checkCosignRequest(request({ linesDigest: "e".repeat(64) }))).toMatchObject({
      ok: false,
      problem: "lines",
    });
    expect(checkCosignRequest(request({ lines: [...runLines].reverse() }))).toMatchObject({ ok: true });
    // One cent moved between two cash lines, re-hashed honestly, under the old claimed digest.
    const moved = movedCashCent(request());
    expect(checkCosignRequest({ ...moved, linesDigest })).toMatchObject({ ok: false, problem: "lines" });
    expect(checkCosignRequest(moved)).toMatchObject({
      ok: true,
      expected: { linesDigest: moved.linesDigest },
    });
    // A line changed under its old hash, a line dropped, a line for one member twice.
    expect(checkCosignRequest(withLines(request(), forgedCashLine(runLines)))).toMatchObject({
      ok: false,
      problem: "lines",
    });
    expect(checkCosignRequest(request({ lines: runLines.slice(1) }))).toMatchObject({
      ok: false,
      problem: "lines",
    });
    const bad = [{ memberNo: "M-014", rail: "GCASH", netCents: 1 }] as unknown as typeof runLines;
    expect(checkCosignRequest(request({ lines: bad }))).toMatchObject({ ok: false, problem: "malformed" });
  });

  it("inv.i3.unbalanced: a payout that is not its PayPal line's net is refused, even under honest hashes", () => {
    const req = request();
    const [line] = req.lines.filter((l) => l.memberNo === req.items[0]?.memberNo);
    if (!line) throw new Error("the first payout has a line");
    // The PayPal line gains a cent and is re-hashed honestly; the payout does not.
    const lines = req.lines.map((l) => (l === line ? relined(l, 1) : l));
    expect(checkCosignRequest(withLines(req, lines))).toMatchObject({ ok: false, problem: "unbalanced" });
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

  it("refuses a payout labelled with another member than the one it pays", () => {
    const [first, ...rest] = request().items;
    if (!first) throw new Error("fixture");
    const r = checkCosignRequest(request({ items: [{ ...first, memberNo: "M-099" }, ...rest] }));
    expect(r).toMatchObject({ ok: false, problem: "bad-item" });
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

  it("numbers each new key on the phone: fs-{persona}-a{n} (S3 Keys)", () => {
    expect(deviceKeyId("board:ernesto", 2)).toBe("fs-ernesto-a2");
    expect(deviceKeyId("board:ernesto", 0)).toBe("fs-ernesto-a1");
    expect(deviceKeyId("board:ernesto", 1.5)).toBe("fs-ernesto-a1");
    expect(deviceKeyParts("fs-ernesto-a12")).toEqual({ slug: "ernesto", generation: 12 });
    expect(deviceKeyParts("fs-ernesto-demo-abc234")).toBeNull();
    expect(deviceKeyParts("fs-ernesto-a0")).toBeNull();
    expect(deviceKeyParts(null)).toBeNull();
  });

  it("the Chair's key is kind app and the treasurer's kind web (register §8, the approved plan)", () => {
    expect(people.chair).toMatchObject({ keyId: "fs-ernesto-a1", keyKind: "app" });
    expect(deviceKeyIdFitsKind(people.chair.keyKind, people.chair.keyId)).toBe(true);
    expect(people.treasurer).toMatchObject({ keyId: "fs-analyn-w1", keyKind: "web" });
    expect(deviceKeyIdFitsKind(people.treasurer.keyKind, people.treasurer.keyId)).toBe(true);
    expect(deviceKeyKindOf("device")).toBe("app");
    expect(deviceKeyKindOf("demo")).toBe("web_demo");
  });

  it("inv.i8.key-id-shapes: every key ID the phone makes has its kind's shape (contracts KEY_ID_PATTERNS)", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 40 }),
        fc.integer({ min: 1, max: MAX_KEY_GENERATION }),
        (name, generation) => {
          const persona = `board:${name}`;
          expect(deviceKeyIdFitsKind("app", deviceKeyId(persona, generation))).toBe(true);
          expect(deviceKeyIdFitsKind("web_demo", demoKeyId(persona, rnd))).toBe(true);
          // A demo key never takes an app key's shape, and an app key never a demo key's.
          expect(deviceKeyIdFitsKind("web_demo", deviceKeyId(persona, generation))).toBe(false);
          expect(deviceKeyIdFitsKind("app", demoKeyId(persona, rnd))).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
    // Letters only, never a ledger or demo persona: those words mark the server's ledger keys and the judges' keys.
    expect(personaSlug("board:ernesto2")).toBe("ernesto");
    expect(personaSlug("board:demo")).toBe("ernesto");
    expect(personaSlug("board:ledger")).toBe("ernesto");
    expect(personaSlug(`board:${"x".repeat(30)}`)).toBe("x".repeat(24));
  });

  it("stops at a9999: past it no key ID is left, so no key is made", () => {
    expect(deviceKeyId("board:ernesto", MAX_KEY_GENERATION)).toBe("fs-ernesto-a9999");
    expect(() => deviceKeyId("board:ernesto", MAX_KEY_GENERATION + 1)).toThrow(RangeError);
    expect(deviceKeyParts("fs-ernesto-a9999")).toEqual({ slug: "ernesto", generation: 9999 });
    expect(deviceKeyParts("fs-ernesto-a10000")).toBeNull();
    expect(deviceKeyParts("fs-demo-a1")).toBeNull();
  });
});

describe("the phone's key vault", () => {
  function memory() {
    const map = new Map<string, string>();
    return {
      map,
      get: async (k: string) => map.get(k) ?? null,
      set: async (k: string, v: string) => {
        map.set(k, v);
      },
      del: async (k: string) => {
        map.delete(k);
      },
    };
  }

  function phone(cls: BiometricClass | null = "pin-gated") {
    const prefs = memory();
    const store = memory();
    const deps = {
      prefs,
      secrets: {
        get: vi.fn((name: string, _o: { bound: boolean; prompt: string }) => store.get(name)),
        set: vi.fn((name: string, value: string, _o: { bound: boolean; prompt: string }) =>
          store.set(name, value),
        ),
        del: (name: string) => store.del(name),
      },
      presence: async () => cls,
      askPresence: vi.fn(async (): Promise<KeyFailure | null> => null),
      randomBytes: rnd,
      now: () => NOW,
    } satisfies DeviceVaultDeps;
    return { vault: createDeviceVault(deps), deps, prefs, store };
  }

  const req = (persona = "board:ernesto", pairing = P1) => ({
    persona,
    pairing,
    message: approvalBytes(payload()),
    prompt: "Pirmahi",
    cancelLabel: "Kanselahon",
  });

  it("makes fs-ernesto-a1 inside the first presence step, then signs with it", async () => {
    const { vault, deps } = phone();
    expect(await vault.upcomingKeyId("board:ernesto", P1)).toBe("fs-ernesto-a1");
    const first = await vault.sign(req());
    if (!first.ok) throw new Error(first.reason);
    expect(first).toMatchObject({
      created: true,
      key: { keyId: "fs-ernesto-a1", biometricClass: "pin-gated" },
    });
    const again = await vault.sign(req());
    if (!again.ok) throw new Error(again.reason);
    expect(again.created).toBe(false);
    expect(again.key).toEqual(first.key);
    expect(deps.askPresence).toHaveBeenCalledTimes(2); // one presence step per signature
    expect(await vault.current(P1)).toEqual(first.key);
  });

  it("inv.i4.new-key-new-id: after forget() the next key is fs-ernesto-a2, registered as a new key", async () => {
    const { vault, store } = phone();
    const registry = new Map<string, string>();
    const deps = (v: typeof vault): CosignDeps => ({
      now: () => NOW,
      online: () => true,
      sign: (message) => v.sign({ ...req(), message }),
      isRegistered: (id) => registry.has(id),
      register: async (k) => {
        // A registry that never lets a key ID change its public key, as fs-api must.
        if (registry.has(k.keyId) && registry.get(k.keyId) !== k.publicKeyHex) {
          return { ok: false, code: "UNAUTHENTICATED", status: 409 };
        }
        registry.set(k.keyId, k.publicKeyHex);
        return { ok: true, value: { ok: true } };
      },
      submit: async () => ({ ok: true, value: { accepted: true } }),
    });
    const before = await cosign(approval(), expected, deps(vault));
    if (!before.ok) throw new Error(before.detail);
    expect(before.key.keyId).toBe("fs-ernesto-a1");

    // Fingerprints changed: Android drops the bound secret, and the Chair taps "Make a new key".
    store.map.clear();
    const lost = await vault.sign(req());
    expect(lost).toEqual({ ok: false, reason: "invalidated" });
    await vault.forget();
    expect(await vault.current(P1)).toBeNull();
    expect(await vault.upcomingKeyId("board:ernesto", P1)).toBe("fs-ernesto-a2");

    const after = await cosign(approval({ nonce: "n_01JB7Q3X9M3" }), expected, deps(vault));
    if (!after.ok) throw new Error(after.detail);
    expect(after.key.keyId).toBe("fs-ernesto-a2");
    expect(after.created).toBe(true);
    expect(after.key.publicKeyHex).not.toBe(before.key.publicKeyHex);
    // Both keys stay in the registry, so the earlier signature still verifies against the key that made it.
    expect(registry.get("fs-ernesto-a1")).toBe(before.key.publicKeyHex);
    expect(registry.get("fs-ernesto-a2")).toBe(after.key.publicKeyHex);
    expect(verifyApproval(before.submission, registry.get(before.submission.keyId) ?? "")).toBe(true);
    expect(verifyApproval(after.submission, registry.get(after.submission.keyId) ?? "")).toBe(true);

    // And the next one after that is -a3: the generation outlives every key it named.
    await vault.forget();
    expect(await vault.upcomingKeyId("board:ernesto", P1)).toBe("fs-ernesto-a3");
  });

  it("does not use up a key ID when the first presence step is cancelled", async () => {
    const { vault, deps, store } = phone();
    deps.askPresence.mockResolvedValueOnce("cancelled");
    expect(await vault.sign(req())).toEqual({ ok: false, reason: "cancelled" });
    expect(store.map.size).toBe(0);
    expect(await vault.current(P1)).toBeNull();
    const r = await vault.sign(req());
    expect(r.ok && r.key.keyId).toBe("fs-ernesto-a1");
  });

  it("binds the key to the fingerprint on strong Android biometrics, and maps the OS prompt's refusals", async () => {
    const { vault, deps } = phone("biometric-bound");
    const r = await vault.sign(req());
    expect(r.ok && r.key.biometricClass).toBe("biometric-bound");
    expect(deps.secrets.set).toHaveBeenCalledWith("fs.boardKey.sk.fs-ernesto-a1", expect.any(String), {
      bound: true,
      prompt: "Pirmahi",
    });
    expect(deps.askPresence).not.toHaveBeenCalled(); // the OS prompt guarding the secret is the presence step
    deps.secrets.get.mockRejectedValueOnce(new Error("User canceled the authentication"));
    expect(await vault.sign(req())).toEqual({ ok: false, reason: "cancelled" });
    deps.secrets.get.mockRejectedValueOnce(new Error("KeyPermanentlyInvalidatedException"));
    expect(await vault.sign(req())).toEqual({ ok: false, reason: "invalidated" });
  });

  it("refuses without a screen lock, and never signs for one officer with another's key", async () => {
    expect(await phone(null).vault.sign(req())).toEqual({ ok: false, reason: "no-lock" });
    const { vault } = phone();
    const ernesto = await vault.sign(req());
    const theresa = await vault.sign(req("board:Ma. Theresa"));
    if (!ernesto.ok || !theresa.ok) throw new Error("expected both keys");
    expect(ernesto.key.keyId).toBe("fs-ernesto-a1");
    expect(theresa.key.keyId).toBe("fs-matheresa-a1");
    expect(theresa.key.publicKeyHex).not.toBe(ernesto.key.publicKeyHex);
    // Ernesto's next key on this phone is still a new ID, never his old one with a new public key.
    expect(await vault.upcomingKeyId("board:ernesto", P1)).toBe("fs-ernesto-a2");
  });

  it("keys.pairing-bound: paired again, even as the same officer, the phone never signs with the earlier pairing's key", async () => {
    const { vault, deps, store } = phone();
    const first = await vault.sign(req("board:ernesto", P1));
    if (!first.ok) throw new Error(first.reason);
    expect(first.key.keyId).toBe("fs-ernesto-a1");
    // The phone is paired again (a new pairing of the same Chair, or of the same name in another co-op).
    expect(await vault.current(P2)).toBeNull();
    expect(await vault.upcomingKeyId("board:ernesto", P2)).toBe("fs-ernesto-a2");
    const next = await vault.sign(req("board:ernesto", P2));
    if (!next.ok) throw new Error(next.reason);
    expect(next).toMatchObject({ created: true, key: { keyId: "fs-ernesto-a2" } });
    expect(next.key.publicKeyHex).not.toBe(first.key.publicKeyHex);
    expect(deps.askPresence).toHaveBeenCalledTimes(2); // one presence step each, the new key made inside it
    // The earlier pairing's secret is gone from SecureStore, and its key is nobody's now.
    expect(store.map.has("fs.boardKey.sk.fs-ernesto-a1")).toBe(false);
    expect(await vault.current(P1)).toBeNull();
    expect(await vault.current(P2)).toEqual(next.key);
  });

  it("keys.unbound-legacy: a key an earlier build kept without its pairing is never used: the next is made", async () => {
    const { vault, prefs, store } = phone();
    const old = await vault.sign(req());
    if (!old.ok) throw new Error(old.reason);
    // What the earlier build stored: the key's public half and class, no pairing.
    const raw = await prefs.get("fs.boardKey.meta");
    const { pairing: _bound, ...unbound } = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    expect(_bound).toBe(P1);
    await prefs.set("fs.boardKey.meta", JSON.stringify(unbound));
    expect(await vault.current(P1)).toBeNull();
    const r = await vault.sign(req());
    expect(r).toMatchObject({ ok: true, created: true, key: { keyId: "fs-ernesto-a2" } });
    expect(store.map.has("fs.boardKey.sk.fs-ernesto-a1")).toBe(false);
  });

  it("makes no key past fs-ernesto-a9999, rather than reuse an ID or make one outside the registry's shape", async () => {
    const { vault, prefs, store } = phone();
    await prefs.set("fs.boardKey.gen.ernesto", String(MAX_KEY_GENERATION));
    expect(await vault.upcomingKeyId("board:ernesto", P1)).toBeNull();
    expect(await vault.sign(req())).toEqual({ ok: false, reason: "error" });
    expect(store.map.size).toBe(0);
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
      pairing: P1,
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
    const a = await vault.sign({ ...req, pairing: "s1" });
    const b = await vault.sign({ ...req, pairing: "s1" });
    const c = await vault.sign({ ...req, pairing: "s2" });
    if (!a.ok || !b.ok || !c.ok) throw new Error("expected signatures");
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.key.keyId).toBe(a.key.keyId);
    expect(c.created).toBe(true);
    expect(c.key.publicKeyHex).not.toBe(a.key.publicKeyHex);
    // keys.pairing-bound (demo): the key in hand answers only for its own judge session.
    expect(await vault.current("s1")).toBeNull();
    expect(await vault.current("s2")).toEqual(c.key);
    await vault.forget();
    expect(await vault.current("s2")).toBeNull();
  });
});

describe("key registrations (security review: a key is handed to the server per pairing)", () => {
  it("keys.registered-per-pairing: a key registered under one pairing is registered again under the next", () => {
    const registry = createKeyRegistry();
    expect(registry.has(P1, "fs-ernesto-a1")).toBe(false);
    registry.add(P1, "fs-ernesto-a1");
    expect(registry.has(P1, "fs-ernesto-a1")).toBe(true);
    expect(registry.has(P2, "fs-ernesto-a1")).toBe(false);
    expect(registry.has(P1, "fs-ernesto-a2")).toBe(false);
    // No two (pairing, key) pairs run into each other.
    registry.add("a", "b|c");
    expect(registry.has("a|b", "c")).toBe(false);
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
          vault.sign({ persona: "board:ernesto", pairing: "t", message, prompt: "p", cancelLabel: "c" }),
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
    const r = await cosign(approval(), expected, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toBe(true);
    expect(r.submission.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(verifyApproval(r.submission, r.key.publicKeyHex)).toBe(true);
    expect(d.register).toHaveBeenCalledOnce();
    const again = await cosign(approval({ nonce: "n_01JB7Q3X9M3" }), expected, d);
    expect(again.ok && again.created).toBe(false);
    expect(d.register).toHaveBeenCalledOnce();
    expect(d.submit).toHaveBeenCalledTimes(2);
  });

  it("inv.i4.signature-binds-payload: a signature does not verify for a changed payload", async () => {
    const r = await cosign(approval(), expected, deps());
    if (!r.ok) throw new Error("expected ok");
    const forged: ApprovalSubmission = {
      ...r.submission,
      payload: { ...r.submission.payload, totalCents: 1 },
    };
    expect(verifyApproval(forged, r.key.publicKeyHex)).toBe(false);
  });

  it("inv.i4.refuse-before-key: a mismatched payload never reaches the key or the server", async () => {
    const d = deps();
    const r = await cosign(approval({ batchSha256: "1".repeat(64) }), expected, d);
    expect(r).toEqual({ ok: false, state: "mismatch", detail: "mismatch" });
    expect(d.sign).not.toHaveBeenCalled();
    expect(d.submit).not.toHaveBeenCalled();
  });

  it.each(["items", "lines", "jcs", "senderBatchId"] as const)(
    "inv.i4.recompute-before-key: an answer whose %s do not give its digests is never signed",
    async (part) => {
      const d = deps();
      const r = await cosign(tamperedApproval(approval(), part), expected, d);
      expect(r).toEqual({ ok: false, state: "mismatch", detail: "mismatch" });
      expect(d.sign).not.toHaveBeenCalled();
      expect(d.register).not.toHaveBeenCalled();
      expect(d.submit).not.toHaveBeenCalled();
    },
  );

  it("inv.i4.signs-what-it-recomputed: the signed bytes are the payload whose digests the phone recomputed", async () => {
    const d = deps();
    const r = await cosign(approval(), expected, d);
    if (!r.ok) throw new Error(r.detail);
    expect(d.sign).toHaveBeenCalledWith(approvalBytes(payload()));
    expect(r.submission).toMatchObject({ role: "chair", payload: { batchSha256, linesDigest } });
  });

  it("inv.i6.human-gate: nothing is registered or sent when the person cancels the fingerprint", async () => {
    const d = deps({
      sign: vi.fn(async (): Promise<KeySignOutcome> => ({ ok: false, reason: "cancelled" })),
    });
    const r = await cosign(approval(), expected, d);
    expect(r).toEqual({ ok: false, state: "cancelled", detail: "cancelled" });
    expect(d.register).not.toHaveBeenCalled();
    expect(d.submit).not.toHaveBeenCalled();
  });

  it("never asks for a fingerprint without a connection", async () => {
    const d = deps({ online: () => false });
    expect(await cosign(approval(), expected, d)).toEqual({ ok: false, state: "offline", detail: "offline" });
    expect(d.sign).not.toHaveBeenCalled();
  });

  it("inv.i4.recheck: asks again before the fingerprint and before anything is sent", async () => {
    const early = deps({ recheck: () => "mismatch" });
    expect(await cosign(approval(), expected, early)).toEqual({
      ok: false,
      state: "mismatch",
      detail: "recheck",
    });
    expect(early.sign).not.toHaveBeenCalled();

    let changed = false;
    const vault = createDemoVault(rnd, () => NOW);
    const late = deps({
      recheck: () => (changed ? "mismatch" : null),
      sign: vi.fn(async (message: Uint8Array): Promise<KeySignOutcome> => {
        changed = true; // the batch changed while the prompt was up
        return vault.sign({ persona: "board:ernesto", pairing: "t", message, prompt: "p", cancelLabel: "c" });
      }),
    });
    expect(await cosign(approval(), expected, late)).toEqual({
      ok: false,
      state: "mismatch",
      detail: "recheck",
    });
    expect(late.sign).toHaveBeenCalledOnce();
    expect(late.register).not.toHaveBeenCalled();
    expect(late.submit).not.toHaveBeenCalled();
  });

  it("drops the signature, never queues it, when the key cannot be registered", async () => {
    const d = deps({ register: vi.fn(async () => ({ ok: false as const, code: "NETWORK" as const })) });
    const r = await cosign(approval(), expected, d);
    expect(r).toEqual({ ok: false, state: "offline", detail: "register:NETWORK" });
    expect(d.submit).not.toHaveBeenCalled();
  });

  it("refreshes rather than signs an expired payload, and refuses an exp too far out", async () => {
    const d = deps();
    const old = approval({ exp: new Date(NOW.getTime() - 1000).toISOString() });
    expect(await cosign(old, expected, d)).toEqual({ ok: false, state: "stale", detail: "expired" });
    const far = approval({ exp: new Date(NOW.getTime() + 60 * 60_000).toISOString() });
    expect(await cosign(far, expected, d)).toEqual({ ok: false, state: "error", detail: "too-far" });
    expect(d.sign).not.toHaveBeenCalled();
  });

  it.each([
    ["DIGEST_MISMATCH", 409, "mismatch"],
    ["APPROVAL_EXPIRED", 422, "stale"],
    ["NONCE_REUSED", 409, "stale"],
    ["NETWORK", undefined, "offline"],
    ["RATE_LIMITED", 429, "error"],
    ["KEY_NOT_REGISTERED", 403, "error"],
    ["SIGNATURE_INVALID", 422, "error"],
  ] as const)("maps the server's %s to %s", async (code, status, state) => {
    const d = deps({ submit: vi.fn(async () => ({ ok: false as const, code, status })) });
    expect(await cosign(approval(), expected, d)).toEqual({ ok: false, state, detail: code });
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
    const r = await cosign(approval(), expected, d);
    expect(r.ok && r.submission.keyId).toBe("fs-ernesto-a1");
    expect(r.ok && verifyApproval(r.submission, meta.publicKeyHex)).toBe(true);
    expect(d.register).not.toHaveBeenCalled();
  });
});
