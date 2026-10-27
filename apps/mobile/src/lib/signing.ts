/**
 * Board co-sign (M-BD-01/02, MM-5 "Two keys"), the pure half. The phone never takes the server's word for what it
 * signs: it recomputes `batchSha256`, the item count and the total from the items it shows (register §8, I4), draws
 * the seal from its own hash, refuses an approval payload that is not exactly that batch, and only then asks for the
 * fingerprint or device PIN. The key is Ed25519: `fs-ernesto-a1` (then `-a2`, `-a3` for each new key) in SecureStore
 * on the phone, an ephemeral `fs-ernesto-demo-{6}` key in a judge's browser (C-13). A signature is never stored or
 * queued: offline, or when the approval cannot be sent, it is dropped and the Chair signs again with a connection.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import type { ApiResult, ApprovalSubmission, CosignRequestDTO } from "../_shims/api-client";
import type { ApprovalPayload, ApprovalRole, BatchItem, DigestLine } from "../_shims/contracts";
import { APPROVAL_PAYLOAD_KEYS } from "../_shims/contracts";
import { batchDigest, linesDigest as digestLines, jcs } from "../_shims/domain";

const HEX64 = /^[0-9a-f]{64}$/;
/** The server refuses an `exp` more than 30 minutes ahead (S3.8); allow a minute of clock skew. */
export const MAX_EXP_AHEAD_MS = 30 * 60 * 1000 + 60 * 1000;
/** A payload that expires sooner than this is replaced before the fingerprint is asked for. */
export const PAYLOAD_FRESH_MS = 2 * 60 * 1000;

/* ------------------------------------------------------------------ what the phone computes itself (I4) */

export interface ExpectedBatch {
  runId: string;
  rateCardSha256: string;
  /** Recomputed on the phone from the items on screen, never copied from the server's claim. */
  batchSha256: string;
  /** Every member line, PayPal and cash (approved plan): a key binds the cash lines too. */
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

export type RequestProblem =
  | "malformed"
  | "no-items"
  | "bad-item"
  | "duplicate-item"
  | "currency"
  | "hash"
  | "count"
  | "total";

export type RequestCheck =
  | {
      ok: true;
      recomputed: RecomputedBatch;
      expected: ExpectedBatch;
      /**
       * True when the phone recomputed `linesDigest` from the member lines itself. IC-08's request does not carry
       * the lines yet (orchestrator), so today the cash lines are bound by the server's digest alone: the phone
       * checks that the payload carries the same value, but cannot show or recompute what it covers.
       */
      linesChecked: boolean;
    }
  | { ok: false; problem: RequestProblem; recomputed: RecomputedBatch | null };

/**
 * The co-sign request as the phone reads it. `lines` (every member line the signature binds, PayPal and cash) is not
 * in IC-08's DTO yet; when fs-api sends it, `checkCosignRequest` recomputes `linesDigest` from it with no other change.
 */
export type CosignRequestInput = CosignRequestDTO & { lines?: readonly DigestLine[] };

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

/** The batch as this phone sees it: register §8's digest over the items shown, their count and their sum. */
export function recomputeBatch(b: BatchInput): RecomputedBatch | null {
  if (!Array.isArray(b.items) || itemProblem(b.items) !== null) return null;
  const totalCents = b.items.reduce((s, i) => s + i.amountCents, 0);
  if (!Number.isSafeInteger(totalCents)) return null;
  return { batchSha256: batchDigest(b, b.items), itemCount: b.items.length, totalCents };
}

function isDigestLine(v: unknown): v is DigestLine {
  if (!v || typeof v !== "object") return false;
  const l = v as Partial<DigestLine>;
  return (
    typeof l.memberNo === "string" &&
    l.memberNo.length > 0 &&
    (l.rail === "PAYPAL" || l.rail === "CASH") &&
    isInt(l.netCents)
  );
}

/**
 * Checks a co-sign request before anything is drawn as signable: the items are well formed, and the hash, count and
 * total the server claims are the ones the phone computes. The seal on screen is drawn from `recomputed`. When the
 * request carries its member lines, the lines digest is recomputed too, and a difference is the same refusal as a
 * batch hash that is not the items' hash.
 */
export function checkCosignRequest(req: CosignRequestInput): RequestCheck {
  if (
    !req ||
    typeof req.runId !== "string" ||
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
  if (req.currency !== "USD") return { ok: false, problem: "currency", recomputed: null };
  const recomputed = recomputeBatch(req);
  if (!recomputed) return { ok: false, problem: "bad-item", recomputed: null };
  if (recomputed.batchSha256 !== req.batchSha256) return { ok: false, problem: "hash", recomputed };
  if (recomputed.itemCount !== req.itemCount) return { ok: false, problem: "count", recomputed };
  if (recomputed.totalCents !== req.totalCents) return { ok: false, problem: "total", recomputed };
  const lines: unknown = req.lines;
  if (lines !== undefined) {
    if (!Array.isArray(lines) || !lines.every(isDigestLine))
      return { ok: false, problem: "malformed", recomputed };
    if (digestLines(req.runId, lines) !== req.linesDigest) return { ok: false, problem: "hash", recomputed };
  }
  return {
    ok: true,
    recomputed,
    linesChecked: lines !== undefined,
    expected: {
      runId: req.runId,
      rateCardSha256: req.rateCardSha256,
      batchSha256: recomputed.batchSha256,
      linesDigest: req.linesDigest,
      itemCount: recomputed.itemCount,
      totalCents: recomputed.totalCents,
      role: "CHAIR",
    },
  };
}

/** Invariant I4 on the phone: the hash the Chair is asked to sign is the hash of the items he is shown. */
export function batchMatchesItems(b: BatchInput & { batchSha256: string }): boolean {
  return recomputeBatch(b)?.batchSha256 === b.batchSha256;
}

/* ------------------------------------------------------------------ the approval payload (register §8) */

export type PayloadProblem = "malformed" | "mismatch" | "role" | "expired" | "too-far";
export type PayloadCheck = { ok: true; payload: ApprovalPayload } | { ok: false; problem: PayloadProblem };

/** Validates the shape, then that it is exactly the batch on screen, then the time window. */
export function checkApprovalPayload(raw: unknown, expected: ExpectedBatch, now: Date): PayloadCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, problem: "malformed" };
  const p = raw as Record<string, unknown>;
  const keys = Object.keys(p).sort().join(",");
  if (keys !== [...APPROVAL_PAYLOAD_KEYS].sort().join(",")) return { ok: false, problem: "malformed" };
  if (
    p.v !== 1 ||
    typeof p.runId !== "string" ||
    typeof p.seasonId !== "string" ||
    typeof p.rateCardSha256 !== "string" ||
    !HEX64.test(p.rateCardSha256) ||
    typeof p.batchSha256 !== "string" ||
    !HEX64.test(p.batchSha256) ||
    typeof p.linesDigest !== "string" ||
    !HEX64.test(p.linesDigest) ||
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
    p.linesDigest !== expected.linesDigest ||
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

/** True when the payload in hand will expire before a person can finish the fingerprint step. */
export function payloadStale(p: Pick<ApprovalPayload, "exp"> | null, now: Date): boolean {
  if (!p) return true;
  const exp = Date.parse(p.exp);
  return !Number.isFinite(exp) || exp - now.getTime() < PAYLOAD_FRESH_MS;
}

/** The exact bytes that get signed: UTF-8 of the JCS form. */
export function approvalBytes(p: ApprovalPayload): Uint8Array {
  return utf8ToBytes(jcs(p));
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

/** `board:ernesto` → `ernesto`: lower-case letters and digits only, so key IDs stay in the registry's pattern. */
export function personaSlug(persona: string | null | undefined, fallback = "ernesto"): string {
  const name = (persona ?? "").split(":").pop() ?? "";
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return slug.length > 0 ? slug.slice(0, 24) : fallback;
}

/**
 * The phone's own key: `fs-{persona}-a{n}` (S3 "Keys"), where `n` is the key's generation on this phone. The first is
 * `fs-ernesto-a1` (register §8, C-13); a key made after the old one was invalidated is `-a2`, and so on, so a new
 * public key is never registered under an ID that already verified earlier signatures.
 */
export function deviceKeyId(persona: string | null | undefined, generation = 1): string {
  const n = Number.isSafeInteger(generation) && generation > 0 ? generation : 1;
  return `fs-${personaSlug(persona)}-a${n}`;
}

/** `fs-ernesto-a3` → `{ slug: "ernesto", generation: 3 }`; null for anything that is not a phone key. */
export function deviceKeyParts(
  keyId: string | null | undefined,
): { slug: string; generation: number } | null {
  const m = /^fs-([a-z0-9]{1,24})-a([1-9]\d{0,5})$/.exec(keyId ?? "");
  return m?.[1] && m[2] ? { slug: m[1], generation: Number(m[2]) } : null;
}

export type RandomBytes = (n: number) => Uint8Array;

const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** `fs-{persona}-demo-{6}` (C-13): a judge's browser key, always labelled "Demo key (this browser)". */
export function demoKeyId(persona: string | null | undefined, randomBytes: RandomBytes): string {
  const r = randomBytes(6);
  let s = "";
  for (const byte of r) s += ID_ALPHABET[byte % ID_ALPHABET.length];
  return `fs-${personaSlug(persona)}-demo-${s}`;
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
  message: Uint8Array;
  /** The OS prompt's title: "Pirmahi ang batch sa Season 2026-A". */
  prompt: string;
  /** The prompt's second line on Android: "8 ka bayad, US$368.39". */
  detail?: string;
  cancelLabel: string;
  /** Web only: the judge session the demo key belongs to. A new session gets a new key (C-13). */
  sessionTag?: string;
}

/**
 * Where the Chair's key lives: SecureStore behind the fingerprint or device PIN on the phone (`platform/key-vault`),
 * memory in a judge's browser (`createDemoVault`). One presence step and one signature per call; the key is made on
 * first use inside that same step, so a first signature never asks for the fingerprint twice.
 */
export interface KeyVault {
  readonly kind: "device" | "demo";
  current(): Promise<KeyMeta | null>;
  /**
   * The key ID the next signature for this persona will use: the key in hand, or the one it will make (`-a2` after
   * `-a1` was forgotten). Null where it cannot be known ahead (the demo key's random suffix).
   */
  upcomingKeyId(persona: string): Promise<string | null>;
  /** The presence step the next signature asks for, or null when the phone has no screen lock. */
  presence(): Promise<BiometricClass | null>;
  sign(req: VaultSignRequest): Promise<KeySignOutcome>;
  forget(): Promise<void>;
}

/** The judge's browser key (C-13): ephemeral, in memory only, one per judge session, labelled wherever it shows. */
export function createDemoVault(randomBytes: RandomBytes, now: () => Date = () => new Date()): KeyVault {
  let held: { tag: string; meta: KeyMeta; signer: Signer } | null = null;
  return {
    kind: "demo",
    async current() {
      return held?.meta ?? null;
    },
    async upcomingKeyId() {
      return null;
    },
    async presence() {
      return "none";
    },
    async sign(req) {
      const tag = req.sessionTag ?? "";
      let created = false;
      if (
        !held ||
        held.tag !== tag ||
        held.meta.keyId.split("-demo-")[0] !== `fs-${personaSlug(req.persona)}`
      ) {
        const keyId = demoKeyId(req.persona, randomBytes);
        const signer = createSoftwareSigner({ keyId, kind: "demo", randomBytes });
        held = {
          tag,
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
  async function readMeta(): Promise<KeyMeta | null> {
    const raw = await d.prefs.get(KEY_META);
    if (!raw) return null;
    try {
      const m = JSON.parse(raw) as Partial<KeyMeta>;
      if (
        typeof m.keyId !== "string" ||
        !deviceKeyParts(m.keyId) ||
        typeof m.publicKeyHex !== "string" ||
        typeof m.createdAt !== "string"
      ) {
        return null;
      }
      const cls = m.biometricClass === "biometric-bound" ? "biometric-bound" : "pin-gated";
      return { keyId: m.keyId, publicKeyHex: m.publicKeyHex, biometricClass: cls, createdAt: m.createdAt };
    } catch {
      return null;
    }
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

  async function keep(meta: KeyMeta): Promise<void> {
    await noteGeneration(meta.keyId);
    await d.prefs.set(KEY_META, JSON.stringify(meta));
  }

  return {
    kind: "device",

    current: readMeta,

    async upcomingKeyId(persona) {
      const slug = personaSlug(persona);
      const meta = await readMeta();
      if (meta && deviceKeyParts(meta.keyId)?.slug === slug) return meta.keyId;
      return deviceKeyId(persona, (await lastGeneration(slug, meta)) + 1);
    },

    presence: d.presence,

    async sign(req): Promise<KeySignOutcome> {
      const cls = await d.presence();
      if (!cls) return { ok: false, reason: "no-lock" };
      const slug = personaSlug(req.persona);
      let meta = await readMeta();
      // A phone re-paired to another officer never signs with the previous officer's key.
      if (meta && deviceKeyParts(meta.keyId)?.slug !== slug) {
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
      const keyId = deviceKeyId(req.persona, (await lastGeneration(slug, null)) + 1);
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
          await keep(fresh);
          return { ok: true, key: fresh, signatureHex, created: true };
        }
        const failed = await d.askPresence(req.prompt, req.detail, req.cancelLabel);
        if (failed) return { ok: false, reason: failed };
        await d.secrets.set(secretName(keyId), skHex, { bound: false, prompt: req.prompt });
        await keep(fresh);
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
   * Asked just before the presence step and again before anything leaves the phone: why this attempt must stop now
   * (the batch on screen changed, the request closed, the phone went offline), or null. The fingerprint prompt can
   * stay up for a while; a signature made while the batch changed underneath it is dropped, never sent (I4).
   */
  recheck?(): CosignFailure | null;
}

const offlineCode = (r: { code: string; status?: number }) => r.code === "NETWORK" && r.status === undefined;

/**
 * Check → presence and signature → register the key if new → submit. Nothing is signed unless the payload is
 * exactly the batch on screen, nothing asks for a fingerprint without a connection, and a signature that cannot be
 * delivered is dropped, never queued: the Chair signs again when the phone is back online.
 */
export async function cosign(
  payload: unknown,
  expected: ExpectedBatch,
  deps: CosignDeps,
): Promise<CosignResult> {
  if (!deps.online()) return { ok: false, state: "offline", detail: "offline" };
  const check = checkApprovalPayload(payload, expected, deps.now());
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
