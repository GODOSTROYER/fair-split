/**
 * Board co-sign (M-BD-01/02, MM-5 "Two keys"), the pure half. The phone never takes the server's word for what it
 * signs. With WS-CORE's own digest functions (`_shims/domain-core.ts`) it recomputes `batchSha256` from the items,
 * `linesDigest` from every member line (register §8 as amended, I4). Every /lines canonical preimage is
 * rehashed and cross-checked with /batch before its displayed rail or amount is trusted. It
 * checks that each payout is exactly one PayPal line's net (I3), draws the seal from its own hash, and refuses an
 * approval payload whose own items and lines do not give its digests, or that is not exactly the batch the Chair
 * opened. Only then does it ask for the fingerprint or device PIN. The key is Ed25519: `fs-ernesto-a1` (then `-a2`,
 * `-a3` for each new key) in SecureStore on the phone, an ephemeral `fs-ernesto-demo-{6}` key in a judge's browser
 * (C-13). A signature is never stored or queued: offline, or when the approval cannot be sent, it is dropped and the
 * Chair signs again with a connection.
 *
 * A key belongs to the pairing it was made under (`pairingId`): a phone paired again, as anyone (the same officer, or
 * the same name in another co-op or judge workspace), never signs with the earlier pairing's key. The vault forgets
 * it and makes the next one inside the same presence step, and a key is registered again for each pairing.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type {
  ApiResult,
  ApprovalPayloadDTO,
  ApprovalSubmission,
  CosignLine,
  CosignRequestDTO,
} from "../_shims/api-client";
import type { ApprovalPayload, ApprovalRole, BatchItem, DeviceKeyKind } from "../_shims/contracts";
import { APPROVAL_PAYLOAD_KEYS, APPROVAL_ROLES, KEY_ID_PATTERNS } from "../_shims/contracts";
import { approvalBytes, batchDigest, jcs, jcsSha256, linesDigest, parseSenderItemId } from "../_shims/domain";

export { approvalBytes } from "../_shims/domain";

const HEX64 = /^[0-9a-f]{64}$/;
const MEMBER_NO = /^M-\d{3}$/;
/** The server refuses an `exp` more than 30 minutes ahead (S3.8); allow a minute of clock skew. */
export const MAX_EXP_AHEAD_MS = 30 * 60 * 1000 + 60 * 1000;
/** A payload that expires sooner than this is replaced before the fingerprint is asked for. */
export const PAYLOAD_FRESH_MS = 2 * 60 * 1000;

/* ------------------------------------------------------------------ what the phone computes itself (I4) */

export interface ExpectedBatch {
  runId: string;
  seasonId: string;
  rateCardSha256: string;
  /** Recomputed on the phone from the items on screen, never copied from the server's claim. */
  batchSha256: string;
  /** Recomputed on the phone from every member line, PayPal and cash (approved plan): a key binds the cash lines. */
  linesDigest: string;
  itemCount: number;
  totalCents: number;
  role: ApprovalRole;
}

export interface RecomputedBatch {
  batchSha256: string;
  itemCount: number;
  totalCents: number;
}

/** The member lines a signature binds, as the phone counted them from lines whose hashes it recomputed. */
export interface LinesSummary {
  count: number;
  paypal: { count: number; cents: number };
  cash: { count: number; cents: number };
}

export type RequestProblem =
  | "malformed"
  | "no-items"
  | "bad-item"
  | "duplicate-item"
  | "currency"
  | "hash"
  | "count"
  | "total"
  /** A member line is not the content its hash covers, two lines name one member, or `linesDigest` is not theirs. */
  | "lines"
  /** A payout that is not exactly one PayPal line's net (I3: the batch pays what the lines say, no more). */
  | "unbalanced";

export type RequestCheck =
  | { ok: true; recomputed: RecomputedBatch; lines: LinesSummary; expected: ExpectedBatch }
  | { ok: false; problem: RequestProblem; recomputed: RecomputedBatch | null };

/** The run and items the digest covers (register §8). */
export interface BatchInput {
  runId: string;
  senderBatchId: string;
  rateCardSha256: string;
  items: readonly BatchItem[];
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v);
}

function itemProblem(items: readonly BatchItem[]): RequestProblem | null {
  if (items.length === 0) return "no-items";
  const seen = new Set<string>();
  for (const i of items as readonly unknown[]) {
    if (!i || typeof i !== "object") return "bad-item";
    const it = i as Partial<BatchItem>;
    if (
      typeof it.senderItemId !== "string" ||
      !it.senderItemId ||
      typeof it.receiver !== "string" ||
      !it.receiver ||
      !isInt(it.amountCents) ||
      it.amountCents <= 0
    ) {
      return "bad-item";
    }
    if (it.currency !== "USD") return "currency";
    if (seen.has(it.senderItemId)) return "duplicate-item";
    seen.add(it.senderItemId);
  }
  return null;
}

/** The batch as this phone sees it: WS-CORE's `batchDigest` over the items shown, their count and their sum. */
export function recomputeBatch(b: BatchInput): RecomputedBatch | null {
  if (!Array.isArray(b.items) || itemProblem(b.items) !== null) return null;
  try {
    const d = batchDigest(b, b.items);
    if (!Number.isSafeInteger(d.totalCents)) return null;
    return { batchSha256: d.batchSha256, itemCount: d.itemCount, totalCents: d.totalCents };
  } catch {
    return null;
  }
}

function isLine(v: unknown): v is CosignLine {
  if (!v || typeof v !== "object") return false;
  const l = v as Partial<CosignLine>;
  return (
    typeof l.memberNo === "string" &&
    MEMBER_NO.test(l.memberNo) &&
    (l.rail === "PAYPAL" || l.rail === "CASH") &&
    isInt(l.netCents) &&
    typeof l.lineSha256 === "string" &&
    HEX64.test(l.lineSha256) &&
    !!l.canonical &&
    typeof l.canonical === "object" &&
    !Array.isArray(l.canonical) &&
    (l.source !== "fs-api-lines" || l.batchLineSha256 === l.lineSha256)
  );
}

export type LinesCheck =
  | { ok: true; linesDigest: string; summary: LinesSummary }
  | { ok: false; problem: "malformed" | "lines" };

/**
 * Every member line the signature binds, checked on the phone: each line hash is sha256(JCS(canonical)) (WS-CORE's
 * `lineSha256`, the hash Proof plate 4 recomputes); each canonical names this line's member, rail and net and the
 * run's rate card; then `linesDigest` over all of them, with WS-CORE's function (one line per member, at least one).
 */
export function checkLines(lines: unknown, rateCardSha256: string): LinesCheck {
  if (!Array.isArray(lines) || lines.length === 0 || !lines.every(isLine)) {
    return { ok: false, problem: "malformed" };
  }
  const summary: LinesSummary = { count: 0, paypal: { count: 0, cents: 0 }, cash: { count: 0, cents: 0 } };
  for (const l of lines) {
    const c = l.canonical as unknown as Record<string, unknown>;
    let hash: string;
    try {
      hash = jcsSha256(l.canonical);
    } catch {
      return { ok: false, problem: "lines" };
    }
    if (
      hash !== l.lineSha256 ||
      c.memberNo !== l.memberNo ||
      c.rail !== l.rail ||
      c.netCents !== l.netCents ||
      c.rateCardSha256 !== rateCardSha256
    ) {
      return { ok: false, problem: "lines" };
    }
    const rail = l.rail === "PAYPAL" ? summary.paypal : summary.cash;
    rail.count++;
    rail.cents += l.netCents;
    summary.count++;
  }
  if (!Number.isSafeInteger(summary.paypal.cents) || !Number.isSafeInteger(summary.cash.cents)) {
    return { ok: false, problem: "malformed" };
  }
  try {
    return { ok: true, linesDigest: linesDigest(lines), summary };
  } catch {
    return { ok: false, problem: "lines" };
  }
}

/**
 * I3 on the phone: every payout is exactly one PayPal line's net, and no member is paid twice. A line the batch does
 * not pay (cash, or a PayPal line that is reserved) is bound by `linesDigest` alone.
 */
export function itemsMatchLines(items: readonly BatchItem[], lines: readonly CosignLine[]): boolean {
  const byMember = new Map(lines.map((l) => [l.memberNo, l]));
  const paid = new Set<string>();
  for (const it of items) {
    const memberNo = parseSenderItemId(it.senderItemId)?.memberNo;
    if (!memberNo || paid.has(memberNo)) return false;
    paid.add(memberNo);
    const line = byMember.get(memberNo);
    if (line?.rail !== "PAYPAL" || line.netCents !== it.amountCents) return false;
  }
  return true;
}

/**
 * Checks a co-sign request before anything is drawn as signable: the items are well formed and each names the member
 * its `sender_item_id` pays; the hash, count and total the server claims are the ones the phone computes; every
 * member line is the content its hash covers, and the lines digest the server claims is the one the phone computes
 * from them; and the payouts are exactly the PayPal lines' nets. The seal on screen is drawn from `recomputed`.
 */
export function checkCosignRequest(req: CosignRequestDTO): RequestCheck {
  if (
    !req ||
    typeof req.runId !== "string" ||
    typeof req.seasonId !== "string" ||
    typeof req.senderBatchId !== "string" ||
    typeof req.rateCardSha256 !== "string" ||
    !HEX64.test(req.rateCardSha256) ||
    typeof req.linesDigest !== "string" ||
    !HEX64.test(req.linesDigest) ||
    !isInt(req.itemCount) ||
    !isInt(req.totalCents) ||
    !Array.isArray(req.items)
  ) {
    return { ok: false, problem: "malformed", recomputed: null };
  }
  const problem = itemProblem(req.items);
  if (problem) return { ok: false, problem, recomputed: null };
  // The member number printed beside a payout must be the member its sender_item_id pays (register §8).
  if (req.items.some((i) => parseSenderItemId(i.senderItemId)?.memberNo !== i.memberNo)) {
    return { ok: false, problem: "bad-item", recomputed: null };
  }
  if (req.currency !== "USD") return { ok: false, problem: "currency", recomputed: null };
  const recomputed = recomputeBatch(req);
  if (!recomputed) return { ok: false, problem: "bad-item", recomputed: null };
  if (recomputed.batchSha256 !== req.batchSha256) return { ok: false, problem: "hash", recomputed };
  if (recomputed.itemCount !== req.itemCount) return { ok: false, problem: "count", recomputed };
  if (recomputed.totalCents !== req.totalCents) return { ok: false, problem: "total", recomputed };
  const lines = checkLines(req.lines, req.rateCardSha256);
  if (!lines.ok) return { ok: false, problem: lines.problem, recomputed };
  if (lines.linesDigest !== req.linesDigest) return { ok: false, problem: "lines", recomputed };
  if (!itemsMatchLines(req.items, req.lines)) return { ok: false, problem: "unbalanced", recomputed };
  return {
    ok: true,
    recomputed,
    lines: lines.summary,
    expected: {
      runId: req.runId,
      seasonId: req.seasonId,
      rateCardSha256: req.rateCardSha256,
      batchSha256: recomputed.batchSha256,
      linesDigest: lines.linesDigest,
      itemCount: recomputed.itemCount,
      totalCents: recomputed.totalCents,
      role: "chair",
    },
  };
}

/** Invariant I4 on the phone: the hash the Chair is asked to sign is the hash of the items he is shown. */
export function batchMatchesItems(b: BatchInput & { batchSha256: string }): boolean {
  return recomputeBatch(b)?.batchSha256 === b.batchSha256;
}

/* ------------------------------------------------------------------ the approval payload (register §8) */

export type PayloadProblem = "malformed" | "mismatch" | "role" | "expired" | "too-far";
export type PayloadCheck =
  | { ok: true; payload: ApprovalPayload; dto: ApprovalPayloadDTO }
  | { ok: false; problem: PayloadProblem };

const SORTED_PAYLOAD_KEYS = [...APPROVAL_PAYLOAD_KEYS].sort().join(",");

/**
 * contracts `IsoDateTime` (zod 4.6's `z.iso.datetime()`): a real calendar date, then a time with seconds (RFC 3339
 * needs them beside a `Z`) and any fraction, in UTC. `contracts.parity.test.ts` holds it to the package's schema.
 */
const ISO_DATE =
  "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))";
export const ISO_DATETIME = new RegExp(
  `^${ISO_DATE}T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$`,
);

const isPositiveInt = (v: unknown): v is number => isInt(v) && v > 0;
const isHex64 = (v: unknown): v is string => typeof v === "string" && HEX64.test(v);
const isRole = (v: unknown): v is ApprovalRole => (APPROVAL_ROLES as readonly unknown[]).includes(v);

/**
 * The payload's shape, exactly as contracts' `ApprovalPayload` (a strict object) accepts it and nothing more:
 * `contracts.parity.test.ts` checks that this phone never takes a payload the package would refuse.
 */
export function approvalPayloadShape(raw: unknown): ApprovalPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (Object.keys(p).sort().join(",") !== SORTED_PAYLOAD_KEYS) return null;
  const ok =
    p.v === 1 &&
    typeof p.runId === "string" &&
    typeof p.seasonId === "string" &&
    isHex64(p.rateCardSha256) &&
    isHex64(p.batchSha256) &&
    isHex64(p.linesDigest) &&
    isPositiveInt(p.itemCount) &&
    isPositiveInt(p.totalCents) &&
    p.currency === "USD" &&
    isRole(p.role) &&
    typeof p.approverId === "string" &&
    typeof p.nonce === "string" &&
    p.nonce.length >= 8 &&
    typeof p.exp === "string" &&
    ISO_DATETIME.test(p.exp) &&
    !Number.isNaN(Date.parse(p.exp));
  return ok ? (p as unknown as ApprovalPayload) : null;
}

/**
 * The approval payload, checked before any key is touched (register §8, I4). First what it claims, recomputed from
 * what came with it: the JCS the server will verify is exactly the payload's; `batchSha256`, the count and the total
 * are WS-CORE's `batchDigest` of its items; `linesDigest` is WS-CORE's `linesDigest` of its lines, each line hash
 * recomputed from its content; the payouts are exactly the PayPal lines. Then that it is the batch the Chair opened,
 * for his role, inside its time window. Any difference is a mismatch: nothing is signed.
 */
export function checkApprovalPayload(
  raw: unknown,
  expected: ExpectedBatch & { approverId?: string },
  now: Date,
): PayloadCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, problem: "malformed" };
  const dto = raw as Partial<Record<keyof ApprovalPayloadDTO, unknown>>;
  const payload = approvalPayloadShape(dto.payload);
  if (
    !payload ||
    typeof dto.jcs !== "string" ||
    typeof dto.senderBatchId !== "string" ||
    !Array.isArray(dto.items) ||
    !Array.isArray(dto.lines)
  ) {
    return { ok: false, problem: "malformed" };
  }
  const items = dto.items as readonly BatchItem[];
  const mismatch = { ok: false, problem: "mismatch" } as const;
  if (dto.jcs !== jcs(payload)) return mismatch;
  const batch = recomputeBatch({
    runId: payload.runId,
    senderBatchId: dto.senderBatchId,
    rateCardSha256: payload.rateCardSha256,
    items,
  });
  if (
    !batch ||
    batch.batchSha256 !== payload.batchSha256 ||
    batch.itemCount !== payload.itemCount ||
    batch.totalCents !== payload.totalCents
  ) {
    return mismatch;
  }
  const lines = checkLines(dto.lines, payload.rateCardSha256);
  if (!lines.ok || lines.linesDigest !== payload.linesDigest) return mismatch;
  if (!itemsMatchLines(items, dto.lines as readonly CosignLine[])) return mismatch;
  if (
    payload.runId !== expected.runId ||
    payload.seasonId !== expected.seasonId ||
    (expected.approverId !== undefined && payload.approverId !== expected.approverId) ||
    payload.batchSha256 !== expected.batchSha256 ||
    payload.linesDigest !== expected.linesDigest ||
    payload.rateCardSha256 !== expected.rateCardSha256 ||
    payload.itemCount !== expected.itemCount ||
    payload.totalCents !== expected.totalCents
  ) {
    return mismatch;
  }
  if (payload.role !== expected.role) return { ok: false, problem: "role" };
  const exp = Date.parse(payload.exp);
  if (exp <= now.getTime()) return { ok: false, problem: "expired" };
  if (exp - now.getTime() > MAX_EXP_AHEAD_MS) return { ok: false, problem: "too-far" };
  return { ok: true, payload, dto: raw as ApprovalPayloadDTO };
}

/** True when the payload in hand will expire before a person can finish the fingerprint step. */
export function payloadStale(p: Pick<ApprovalPayload, "exp"> | null, now: Date): boolean {
  if (!p) return true;
  const exp = Date.parse(p.exp);
  return !Number.isFinite(exp) || exp - now.getTime() < PAYLOAD_FRESH_MS;
}

export function verifyApproval(sub: ApprovalSubmission, publicKeyHex: string): boolean {
  try {
    return ed25519.verify(hexToBytes(sub.signature), approvalBytes(sub.payload), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ keys */

/**
 * - "biometric-bound": the key itself needs a strong fingerprint to be read (SecureStore `requireAuthentication`);
 * - "pin-gated": the fingerprint or the device PIN is asked for before the key is read ("No biometric: the device PIN
 *   is used", design D2);
 * - "none": the web demo key, where the hold on the slab is the presence step.
 */
export type BiometricClass = "biometric-bound" | "pin-gated" | "none";

export interface KeyMeta {
  keyId: string;
  publicKeyHex: string;
  biometricClass: BiometricClass;
  createdAt: string;
}

export type KeyFailure = "cancelled" | "no-lock" | "invalidated" | "locked-out" | "error";

export type KeySignOutcome =
  | { ok: true; key: KeyMeta; signatureHex: string; created: boolean }
  | { ok: false; reason: KeyFailure };

/** What the phone has enrolled, reduced from expo-local-authentication's `SecurityLevel`. */
export type EnrolledLevel = "none" | "secret" | "weak" | "strong";

/** expo-local-authentication's `SecurityLevel` (0 none, 1 secret, 2 weak, 3 strong) as a word. */
export function enrolledLevel(level: number): EnrolledLevel {
  if (level >= 3) return "strong";
  if (level === 2) return "weak";
  if (level === 1) return "secret";
  return "none";
}

/** A phone with no screen lock cannot hold a co-sign key (null); a strong fingerprint binds the key on Android. */
export function biometricClassFor(level: EnrolledLevel, os: string): BiometricClass | null {
  if (level === "none") return null;
  return level === "strong" && os === "android" ? "biometric-bound" : "pin-gated";
}

/** expo-local-authentication's error codes, as the screen's outcomes. */
export function authFailure(code: string): KeyFailure {
  switch (code) {
    case "user_cancel":
    case "system_cancel":
    case "app_cancel":
    case "user_fallback":
      return "cancelled";
    case "not_enrolled":
    case "passcode_not_set":
    case "not_available":
      return "no-lock";
    case "lockout":
      return "locked-out";
    default:
      return "error";
  }
}

/** SecureStore's thrown errors (the OS prompt inside `requireAuthentication`), as the screen's outcomes. */
export function secureStoreFailure(e: unknown): KeyFailure {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  if (/cancel/i.test(msg)) return "cancelled";
  if (/lockout|too many/i.test(msg)) return "locked-out";
  if (/invalidat|KeyPermanentlyInvalidated|decrypt/i.test(msg)) return "invalidated";
  return "error";
}

/** Persona words a key ID never carries: they mark the server's ledger keys and the judges' demo keys. */
const RESERVED_PERSONAS: ReadonlySet<string> = new Set(["ledger", "demo"]);

/**
 * `board:ernesto` → `ernesto`: 1-24 lower-case letters, never `ledger` or `demo`, so every key ID this phone makes
 * has its kind's shape (contracts `KEY_ID_PATTERNS`); anything else falls back to the Chair's name.
 */
export function personaSlug(persona: string | null | undefined, fallback = "ernesto"): string {
  const name = (persona ?? "").split(":").pop() ?? "";
  const slug = name
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .slice(0, 24);
  return slug.length > 0 && !RESERVED_PERSONAS.has(slug) ? slug : fallback;
}

/** The last key generation a key ID can carry: `a{n}` with n from 1 to 9999 (contracts `KEY_ID_PATTERNS.app`). */
export const MAX_KEY_GENERATION = 9999;

/**
 * The phone's own key: `fs-{persona}-a{n}` (S3 "Keys", kind `app`), where `n` is the key's generation on this
 * phone. The first is `fs-ernesto-a1` (register §8, C-13); a key made after the old one was invalidated is `-a2`, and
 * so on, so a new public key is never registered under an ID that already verified earlier signatures. Past
 * `-a9999` there is no ID left to take, and no key is made.
 */
export function deviceKeyId(persona: string | null | undefined, generation = 1): string {
  const n = Number.isSafeInteger(generation) && generation > 0 ? generation : 1;
  if (n > MAX_KEY_GENERATION) throw new RangeError("No key ID is left for a new key on this phone");
  return `fs-${personaSlug(persona)}-a${n}`;
}

/** `fs-ernesto-a3` → `{ slug: "ernesto", generation: 3 }`; null for anything that is not an app key's ID. */
export function deviceKeyParts(
  keyId: string | null | undefined,
): { slug: string; generation: number } | null {
  if (!keyId || !KEY_ID_PATTERNS.app.test(keyId)) return null;
  const m = /^fs-([a-z]{1,24})-a([1-9][0-9]{0,3})$/.exec(keyId);
  return m?.[1] && m[2] ? { slug: m[1], generation: Number(m[2]) } : null;
}

export type RandomBytes = (n: number) => Uint8Array;

const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** `fs-{persona}-demo-{6}` (C-13, kind `web_demo`): a judge's browser key, labelled "Demo key (this browser)". */
export function demoKeyId(persona: string | null | undefined, randomBytes: RandomBytes): string {
  const r = randomBytes(6);
  let s = "";
  for (const byte of r) s += ID_ALPHABET[byte % ID_ALPHABET.length];
  return `fs-${personaSlug(persona)}-demo-${s}`;
}

/** The kind a vault's key is registered as (S3 `device_keys.kind`): the phone's is `app`, a judge's `web_demo`. */
export function deviceKeyKindOf(vault: "device" | "demo"): DeviceKeyKind {
  return vault === "demo" ? "web_demo" : "app";
}

export type SignOutcome =
  | { ok: true; signatureHex: string }
  | { ok: false; reason: "cancelled" | "unavailable" | "invalidated" | "error" };

/** A software Ed25519 key: the web demo key (memory only, never persisted) and the tests' stand-in. */
export interface Signer {
  readonly keyId: string;
  readonly kind: "device" | "demo";
  publicKeyHex(): Promise<string>;
  sign(message: Uint8Array, prompt: string): Promise<SignOutcome>;
}

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

/* ------------------------------------------------------------------ key vaults */

export interface VaultSignRequest {
  /** The paired persona (`board:ernesto`); the key is named after it. */
  persona: string;
  /**
   * The pairing this signature is made under (`pairingId`; a judge's session on the web). The key in hand signs only
   * for the pairing it was made under: for any other (the phone paired again, even as the same officer, or a key kept
   * from before keys were bound) it is forgotten first and the next key is made, in the same presence step.
   */
  pairing: string;
  message: Uint8Array;
  /** The OS prompt's title: "Pirmahi ang batch sa Season 2026-A". */
  prompt: string;
  /** The prompt's second line on Android: "8 ka bayad, US$368.39". */
  detail?: string;
  cancelLabel: string;
}

/**
 * Where the Chair's key lives: SecureStore behind the fingerprint or device PIN on the phone (`platform/key-vault`),
 * memory in a judge's browser (`createDemoVault`). One presence step and one signature per call; the key is made on
 * first use inside that same step, so a first signature never asks for the fingerprint twice.
 */
export interface KeyVault {
  readonly kind: "device" | "demo";
  /** The key this pairing signs with, or null: none yet, or the key in hand belongs to another pairing. */
  current(pairing: string): Promise<KeyMeta | null>;
  /**
   * The key ID the next signature for this persona and pairing will use: the key in hand, or the one it will make
   * (`-a2` after `-a1` was forgotten, or belonged to another pairing). Null where it cannot be known ahead (the demo
   * key's random suffix).
   */
  upcomingKeyId(persona: string, pairing: string): Promise<string | null>;
  /** The presence step the next signature asks for, or null when the phone has no screen lock. */
  presence(): Promise<BiometricClass | null>;
  sign(req: VaultSignRequest): Promise<KeySignOutcome>;
  forget(): Promise<void>;
}

/** The judge's browser key (C-13): ephemeral, in memory only, one per judge session, labelled wherever it shows. */
export function createDemoVault(randomBytes: RandomBytes, now: () => Date = () => new Date()): KeyVault {
  let held: { pairing: string; meta: KeyMeta; signer: Signer } | null = null;
  return {
    kind: "demo",
    async current(pairing) {
      return held && held.pairing === pairing ? held.meta : null;
    },
    async upcomingKeyId() {
      return null;
    },
    async presence() {
      return "none";
    },
    async sign(req) {
      let created = false;
      if (
        !held ||
        held.pairing !== req.pairing ||
        held.meta.keyId.split("-demo-")[0] !== `fs-${personaSlug(req.persona)}`
      ) {
        const keyId = demoKeyId(req.persona, randomBytes);
        const signer = createSoftwareSigner({ keyId, kind: "demo", randomBytes });
        held = {
          pairing: req.pairing,
          signer,
          meta: {
            keyId,
            publicKeyHex: await signer.publicKeyHex(),
            biometricClass: "none",
            createdAt: now().toISOString(),
          },
        };
        created = true;
      }
      const r = await held.signer.sign(req.message, req.prompt);
      if (!r.ok) return { ok: false, reason: "error" };
      return { ok: true, key: held.meta, signatureHex: r.signatureHex, created };
    },
    async forget() {
      held = null;
    },
  };
}

/** Plain preferences: a key's public half, its class and the generation count. Never the secret. */
export interface PrefsStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

/** Where the secret half lives (SecureStore). A `bound` secret is readable only through the OS fingerprint prompt. */
export interface SecretStore {
  get(name: string, opts: { bound: boolean; prompt: string }): Promise<string | null>;
  set(name: string, value: string, opts: { bound: boolean; prompt: string }): Promise<void>;
  del(name: string): Promise<void>;
}

export interface DeviceVaultDeps {
  prefs: PrefsStore;
  secrets: SecretStore;
  /** The presence step the phone allows now (`biometricClassFor` what is enrolled), or null without a screen lock. */
  presence(): Promise<BiometricClass | null>;
  /** The fingerprint-or-PIN prompt of a pin-gated key: null when the person passed it. */
  askPresence(prompt: string, detail: string | undefined, cancelLabel: string): Promise<KeyFailure | null>;
  randomBytes: RandomBytes;
  now(): Date;
}

const KEY_META = "fs.boardKey.meta";
/** SecureStore names allow letters, digits, `.`, `-` and `_`: key IDs already fit. */
const secretName = (keyId: string) => `fs.boardKey.sk.${keyId}`;
/** The last key generation made on this phone for a persona: it outlives the key, so no key ID is ever reused. */
const generationName = (slug: string) => `fs.boardKey.gen.${slug}`;

function signWith(skHex: string, message: Uint8Array): string {
  const sk = hexToBytes(skHex);
  try {
    return bytesToHex(ed25519.sign(message, sk));
  } finally {
    sk.fill(0);
  }
}

/**
 * The Chair's key on the phone (architecture §9, S3.8, C-13), with the stores and the OS prompts injected so the
 * rules are tested in Node. One presence step per signature:
 * - "biometric-bound": the secret is stored behind the OS fingerprint prompt, so the prompt guards every read; a new
 *   key is made, signs, and is stored behind that same prompt, so a first signature asks once;
 * - "pin-gated": the fingerprint or device PIN is asked for, then the secret is read.
 * Each new key takes the next generation (`fs-ernesto-a1`, then `-a2` after fingerprints changed and the old key was
 * forgotten), so a new public key is always registered as a new key, and every earlier signature still verifies
 * against the key it was made with.
 */
export function createDeviceVault(d: DeviceVaultDeps): KeyVault {
  /** The key in hand and the pairing it was made under (null: kept by a build from before keys were bound). */
  async function readHeld(): Promise<{ meta: KeyMeta; pairing: string | null } | null> {
    const raw = await d.prefs.get(KEY_META);
    if (!raw) return null;
    try {
      const m = JSON.parse(raw) as Partial<KeyMeta> & { pairing?: unknown };
      if (
        typeof m.keyId !== "string" ||
        !deviceKeyParts(m.keyId) ||
        typeof m.publicKeyHex !== "string" ||
        typeof m.createdAt !== "string"
      ) {
        return null;
      }
      const cls = m.biometricClass === "biometric-bound" ? "biometric-bound" : "pin-gated";
      return {
        meta: { keyId: m.keyId, publicKeyHex: m.publicKeyHex, biometricClass: cls, createdAt: m.createdAt },
        pairing: typeof m.pairing === "string" && m.pairing ? m.pairing : null,
      };
    } catch {
      return null;
    }
  }

  async function readMeta(): Promise<KeyMeta | null> {
    return (await readHeld())?.meta ?? null;
  }

  async function lastGeneration(slug: string, meta: KeyMeta | null): Promise<number> {
    const raw = await d.prefs.get(generationName(slug));
    const stored = raw === null ? 0 : Number(raw);
    const held = deviceKeyParts(meta?.keyId);
    return Math.max(
      Number.isSafeInteger(stored) && stored > 0 ? stored : 0,
      held?.slug === slug ? held.generation : 0,
    );
  }

  async function noteGeneration(keyId: string): Promise<void> {
    const parts = deviceKeyParts(keyId);
    if (!parts) return;
    if ((await lastGeneration(parts.slug, null)) < parts.generation) {
      await d.prefs.set(generationName(parts.slug), String(parts.generation));
    }
  }

  async function forgetKey(meta: KeyMeta | null): Promise<void> {
    if (meta) {
      await noteGeneration(meta.keyId);
      await d.secrets.del(secretName(meta.keyId)).catch(() => {});
    }
    await d.prefs.del(KEY_META);
  }

  async function keep(meta: KeyMeta, pairing: string): Promise<void> {
    await noteGeneration(meta.keyId);
    await d.prefs.set(KEY_META, JSON.stringify({ ...meta, pairing }));
  }

  return {
    kind: "device",

    async current(pairing) {
      const held = await readHeld();
      return held && held.pairing === pairing ? held.meta : null;
    },

    async upcomingKeyId(persona, pairing) {
      const slug = personaSlug(persona);
      const held = await readHeld();
      const meta = held?.meta ?? null;
      if (meta && held?.pairing === pairing && deviceKeyParts(meta.keyId)?.slug === slug) return meta.keyId;
      const next = (await lastGeneration(slug, meta)) + 1;
      return next > MAX_KEY_GENERATION ? null : deviceKeyId(persona, next);
    },

    presence: d.presence,

    async sign(req): Promise<KeySignOutcome> {
      const cls = await d.presence();
      if (!cls) return { ok: false, reason: "no-lock" };
      const slug = personaSlug(req.persona);
      const held = await readHeld();
      let meta = held?.meta ?? null;
      // A key belongs to the pairing it was made under: a phone paired again (to another officer, or to the same one,
      // or the same name in another co-op), or a key kept from before keys were bound, never signs with it.
      if (meta && (held?.pairing !== req.pairing || deviceKeyParts(meta.keyId)?.slug !== slug)) {
        await forgetKey(meta);
        meta = null;
      }

      if (meta) {
        let skHex: string | null;
        try {
          if (meta.biometricClass === "biometric-bound") {
            skHex = await d.secrets.get(secretName(meta.keyId), { bound: true, prompt: req.prompt });
          } else {
            const failed = await d.askPresence(req.prompt, req.detail, req.cancelLabel);
            if (failed) return { ok: false, reason: failed };
            skHex = await d.secrets.get(secretName(meta.keyId), { bound: false, prompt: req.prompt });
          }
        } catch (e) {
          return { ok: false, reason: secureStoreFailure(e) };
        }
        // Null means the system invalidated the key (fingerprints changed) or the store was cleared.
        if (!skHex) return { ok: false, reason: "invalidated" };
        return { ok: true, key: meta, signatureHex: signWith(skHex, req.message), created: false };
      }

      // A new key, made inside the one presence step: the generation after every key this phone made for him.
      const generation = (await lastGeneration(slug, null)) + 1;
      if (generation > MAX_KEY_GENERATION) return { ok: false, reason: "error" };
      const keyId = deviceKeyId(req.persona, generation);
      const sk = d.randomBytes(32);
      const skHex = bytesToHex(sk);
      const fresh: KeyMeta = {
        keyId,
        publicKeyHex: bytesToHex(ed25519.getPublicKey(sk)),
        biometricClass: cls,
        createdAt: d.now().toISOString(),
      };
      try {
        if (cls === "biometric-bound") {
          // Android asks for the fingerprint to store a bound key: that prompt is this signature's presence step.
          const signatureHex = bytesToHex(ed25519.sign(req.message, sk));
          await d.secrets.set(secretName(keyId), skHex, { bound: true, prompt: req.prompt });
          await keep(fresh, req.pairing);
          return { ok: true, key: fresh, signatureHex, created: true };
        }
        const failed = await d.askPresence(req.prompt, req.detail, req.cancelLabel);
        if (failed) return { ok: false, reason: failed };
        await d.secrets.set(secretName(keyId), skHex, { bound: false, prompt: req.prompt });
        await keep(fresh, req.pairing);
        return {
          ok: true,
          key: fresh,
          signatureHex: bytesToHex(ed25519.sign(req.message, sk)),
          created: true,
        };
      } catch (e) {
        return { ok: false, reason: secureStoreFailure(e) };
      } finally {
        sk.fill(0);
      }
    },

    async forget() {
      await forgetKey(await readMeta());
    },
  };
}

/**
 * Which keys this app session has handed to the server, per pairing: registration is idempotent, but a key made
 * under one pairing is never assumed registered under the next (each pairing registers its own key).
 */
export function createKeyRegistry() {
  const done = new Set<string>();
  const slot = (pairing: string, keyId: string) => JSON.stringify([pairing, keyId]);
  return {
    has: (pairing: string, keyId: string) => done.has(slot(pairing, keyId)),
    add: (pairing: string, keyId: string) => {
      done.add(slot(pairing, keyId));
    },
  };
}

/* ------------------------------------------------------------------ the whole step */

/**
 * Why nothing was sent. `stale` is a payload the server will no longer take (its nonce was used or its `exp`
 * passed): the request itself may still be open, so the phone fetches a fresh payload and the Chair holds again.
 */
export type CosignFailure =
  | "offline"
  | "mismatch"
  | "stale"
  | "cancelled"
  | "no-lock"
  | "invalidated"
  | "locked-out"
  | "error";

export type CosignResult =
  | { ok: true; submission: ApprovalSubmission; key: KeyMeta; created: boolean }
  | { ok: false; state: CosignFailure; detail: string };

export interface CosignDeps {
  now(): Date;
  /** NetInfo's answer; signing never starts without a connection. */
  online(): boolean;
  /** One presence step (fingerprint, device PIN, or the web hold) and one Ed25519 signature. */
  sign(message: Uint8Array): Promise<KeySignOutcome>;
  /** True when this key's public half is already on the server for this session. */
  isRegistered(keyId: string): boolean;
  register(key: KeyMeta): Promise<ApiResult<{ ok: true }>>;
  submit(body: ApprovalSubmission): Promise<ApiResult<{ accepted: true }>>;
  /**
   * Asked just before the presence step, again before anything leaves the phone, and once more before the approval
   * leaves after a key registration: why this attempt must stop now (the batch on screen changed, the request closed,
   * the phone went offline or was paired again), or null. The fingerprint prompt can stay up for a while; a signature
   * made while the batch changed underneath it is dropped, never sent (I4).
   */
  recheck?(): CosignFailure | null;
}

const offlineCode = (r: { code: string; status?: number }) => r.code === "NETWORK" && r.status === undefined;

/**
 * Check → presence and signature → register the key if new → submit. `approval` is the approval-payload answer
 * (`ApprovalPayloadDTO`): nothing is signed unless its own items and lines give the digests it carries and it is
 * exactly the batch on screen, nothing asks for a fingerprint without a connection, and a signature that cannot be
 * delivered is dropped, never queued: the Chair signs again when the phone is back online.
 */
export async function cosign(
  approval: unknown,
  expected: ExpectedBatch & { approverId: string },
  deps: CosignDeps,
): Promise<CosignResult> {
  if (!deps.online()) return { ok: false, state: "offline", detail: "offline" };
  if (!expected.approverId) return { ok: false, state: "mismatch", detail: "approver" };
  const check = checkApprovalPayload(approval, expected, deps.now());
  if (!check.ok) {
    const state: CosignFailure =
      check.problem === "expired" ? "stale" : check.problem === "too-far" ? "error" : "mismatch";
    return { ok: false, state, detail: check.problem };
  }
  const before = deps.recheck?.() ?? null;
  if (before) return { ok: false, state: before, detail: "recheck" };
  const signed = await deps.sign(approvalBytes(check.payload));
  if (!signed.ok) return { ok: false, state: signed.reason, detail: signed.reason };
  const after = deps.recheck?.() ?? null;
  if (after) return { ok: false, state: after, detail: "recheck" };
  if (signed.created || !deps.isRegistered(signed.key.keyId)) {
    const reg = await deps.register(signed.key);
    if (!reg.ok)
      return { ok: false, state: offlineCode(reg) ? "offline" : "error", detail: `register:${reg.code}` };
    // The registration took a round trip: ask once more before the approval itself leaves.
    const registered = deps.recheck?.() ?? null;
    if (registered) return { ok: false, state: registered, detail: "recheck" };
  }
  const submission: ApprovalSubmission = {
    role: check.payload.role,
    keyId: signed.key.keyId,
    payload: check.payload,
    signature: signed.signatureHex,
  };
  const r = await deps.submit(submission);
  if (!r.ok) {
    if (r.code === "DIGEST_MISMATCH") return { ok: false, state: "mismatch", detail: r.code };
    if (r.code === "APPROVAL_EXPIRED" || r.code === "NONCE_REUSED") {
      return { ok: false, state: "stale", detail: r.code };
    }
    return { ok: false, state: offlineCode(r) ? "offline" : "error", detail: r.code };
  }
  return { ok: true, submission, key: signed.key, created: signed.created };
}
