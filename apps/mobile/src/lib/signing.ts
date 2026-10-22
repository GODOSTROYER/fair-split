/**
 * Board co-sign (M-BD-02, MM-5). The phone checks the server's approval payload against the batch it shows,
 * refuses on any difference before it asks for a fingerprint, and only then signs the RFC 8785 bytes with
 * Ed25519 (register §8: key `fs-ernesto-a1`; web frames use an ephemeral `fs-ernesto-demo-{6}` key, C-13).
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import type { ApiResult, ApprovalSubmission } from "../_shims/api-client";
import type { ApprovalPayload, ApprovalRole, BatchItem } from "../_shims/contracts";
import { batchDigest, jcs } from "../_shims/domain";

const HEX64 = /^[0-9a-f]{64}$/;
/** The server refuses an `exp` more than 30 minutes ahead (S3.8); allow a minute of clock skew. */
export const MAX_EXP_AHEAD_MS = 30 * 60 * 1000 + 60 * 1000;

export interface ExpectedBatch {
  runId: string;
  rateCardSha256: string;
  batchSha256: string;
  itemCount: number;
  totalCents: number;
  role: ApprovalRole;
}

export type PayloadProblem = "malformed" | "mismatch" | "role" | "expired" | "too-far";
export type PayloadCheck = { ok: true; payload: ApprovalPayload } | { ok: false; problem: PayloadProblem };

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v);
}

/** Validates the shape, then that it is exactly the batch on screen, then the time window. */
export function checkApprovalPayload(raw: unknown, expected: ExpectedBatch, now: Date): PayloadCheck {
  if (!raw || typeof raw !== "object") return { ok: false, problem: "malformed" };
  const p = raw as Record<string, unknown>;
  const keys = Object.keys(p).sort().join(",");
  const want = [
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
  ].join(",");
  if (keys !== want) return { ok: false, problem: "malformed" };
  if (
    p.v !== 1 ||
    typeof p.runId !== "string" ||
    typeof p.seasonId !== "string" ||
    typeof p.rateCardSha256 !== "string" ||
    !HEX64.test(p.rateCardSha256) ||
    typeof p.batchSha256 !== "string" ||
    !HEX64.test(p.batchSha256) ||
    !isInt(p.itemCount) ||
    !isInt(p.totalCents) ||
    p.currency !== "USD" ||
    (p.role !== "TREASURER" && p.role !== "CHAIR") ||
    typeof p.approverId !== "string" ||
    typeof p.nonce !== "string" ||
    p.nonce.length < 8 ||
    typeof p.exp !== "string" ||
    Number.isNaN(Date.parse(p.exp))
  ) {
    return { ok: false, problem: "malformed" };
  }
  if (
    p.runId !== expected.runId ||
    p.batchSha256 !== expected.batchSha256 ||
    p.rateCardSha256 !== expected.rateCardSha256 ||
    p.itemCount !== expected.itemCount ||
    p.totalCents !== expected.totalCents
  ) {
    return { ok: false, problem: "mismatch" };
  }
  if (p.role !== expected.role) return { ok: false, problem: "role" };
  const exp = Date.parse(p.exp);
  if (exp <= now.getTime()) return { ok: false, problem: "expired" };
  if (exp - now.getTime() > MAX_EXP_AHEAD_MS) return { ok: false, problem: "too-far" };
  return { ok: true, payload: p as unknown as ApprovalPayload };
}

/** The exact bytes that get signed: UTF-8 of the JCS form. */
export function approvalBytes(p: ApprovalPayload): Uint8Array {
  return utf8ToBytes(jcs(p));
}

/** Invariant I4 on the phone: the hash the Chair is asked to sign is the hash of the items he is shown. */
export function batchMatchesItems(b: {
  runId: string;
  senderBatchId: string;
  rateCardSha256: string;
  batchSha256: string;
  items: readonly BatchItem[];
}): boolean {
  return batchDigest(b, b.items) === b.batchSha256;
}

/* ------------------------------------------------------------------ signers */

export type SignOutcome =
  | { ok: true; signatureHex: string }
  | { ok: false; reason: "cancelled" | "unavailable" | "invalidated" | "error" };

/** A key that signs only after the person is present (biometric or device PIN on native; the hold on web). */
export interface Signer {
  readonly keyId: string;
  /** "device": SecureStore + biometrics. "demo": an ephemeral browser key, always labelled as such (I8). */
  readonly kind: "device" | "demo";
  publicKeyHex(): Promise<string>;
  sign(message: Uint8Array, prompt: string): Promise<SignOutcome>;
}

export type RandomBytes = (n: number) => Uint8Array;

const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** `fs-{persona}-demo-{6}` (C-13). */
export function demoKeyId(persona: string, randomBytes: RandomBytes): string {
  const r = randomBytes(6);
  let s = "";
  for (const byte of r) s += ID_ALPHABET[byte % ID_ALPHABET.length];
  return `fs-${persona}-demo-${s}`;
}

/** Software Ed25519. Used for the web demo key (memory only, never persisted) and in tests. */
export function createSoftwareSigner(opts: {
  keyId: string;
  kind: "device" | "demo";
  randomBytes: RandomBytes;
  secretKey?: Uint8Array;
  /** Stands in for the person being present; the web hold slab is the presence step. */
  confirm?: (prompt: string) => Promise<boolean>;
}): Signer {
  const sk = opts.secretKey ?? opts.randomBytes(32);
  if (sk.length !== 32) throw new RangeError("Ed25519 secret keys are 32 bytes");
  const pk = bytesToHex(ed25519.getPublicKey(sk));
  return {
    keyId: opts.keyId,
    kind: opts.kind,
    publicKeyHex: async () => pk,
    async sign(message, prompt) {
      if (opts.confirm && !(await opts.confirm(prompt))) return { ok: false, reason: "cancelled" };
      return { ok: true, signatureHex: bytesToHex(ed25519.sign(message, sk)) };
    },
  };
}

export function verifyApproval(sub: ApprovalSubmission, publicKeyHex: string): boolean {
  try {
    return ed25519.verify(hexToBytes(sub.signature), approvalBytes(sub.payload), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ the whole step */

export type CosignResult =
  | { ok: true; submission: ApprovalSubmission }
  | { ok: false; state: "mismatch" | "expired" | "cancelled" | "error"; detail: string };

export interface CosignDeps {
  signer: Signer;
  now: () => Date;
  submit: (body: ApprovalSubmission) => Promise<ApiResult<{ accepted: true }>>;
}

/**
 * Check → sign → submit. Nothing is signed unless the payload is exactly the batch on screen, and a signature is
 * never queued for later: offline means "Signing needs a connection".
 */
export async function cosign(
  payload: unknown,
  expected: ExpectedBatch,
  prompt: string,
  deps: CosignDeps,
): Promise<CosignResult> {
  const check = checkApprovalPayload(payload, expected, deps.now());
  if (!check.ok) {
    const state = check.problem === "expired" || check.problem === "too-far" ? "expired" : "mismatch";
    return { ok: false, state, detail: check.problem };
  }
  const signed = await deps.signer.sign(approvalBytes(check.payload), prompt);
  if (!signed.ok) {
    return { ok: false, state: signed.reason === "cancelled" ? "cancelled" : "error", detail: signed.reason };
  }
  const submission: ApprovalSubmission = {
    role: check.payload.role,
    keyId: deps.signer.keyId,
    payload: check.payload,
    signature: signed.signatureHex,
  };
  const r = await deps.submit(submission);
  if (!r.ok) {
    if (r.code === "DIGEST_MISMATCH") return { ok: false, state: "mismatch", detail: r.code };
    if (r.code === "APPROVAL_EXPIRED") return { ok: false, state: "expired", detail: r.code };
    return { ok: false, state: "error", detail: r.code };
  }
  return { ok: true, submission };
}
