/**
 * "Ipasusi pag-usab" (S1.9, M-MB-04): a member's request for a re-check, sent with her line, an optional slip and an
 * optional note to the Mediation and Conciliation Committee (RA 9520 Art. 43). Pure helpers, tested in Node: the
 * record kept on this phone so the request's status survives a restart, the sender that files each request once,
 * and the screen state.
 */
import type { ApiResult } from "../../_shims/api-client";
import type { ApiErrorCode, ScreenStateOf } from "../../_shims/contracts";
import { jcs, sha256Hex } from "../../_shims/domain";
import { UUIDV7_RE } from "../../lib/uuidv7";

/** What this phone remembers about the request it sent (never the note's text). */
export interface ReviewRecord {
  id: string;
  /** When the Committee's inbox accepted it (RFC 3339). */
  at: string;
  /** The slip it is about, or null for the whole line. */
  slip: string | null;
}

/** Notes are short: one or two sentences for the Committee. */
export const NOTE_MAX = 280;

/**
 * Where a request's record and pending key are kept: under who sent it (`scope`: `identityKey`, her workspace and
 * persona) and the line, so a phone paired to someone else, or to the same line number in another co-op or judge
 * workspace, never shows her request as sent nor reuses her key. Both parts are encoded, so no two run together.
 */
const reviewSlot = (scope: string, lineId: string) =>
  `${encodeURIComponent(scope)}:${encodeURIComponent(lineId)}`;

export const reviewPrefKey = (scope: string, lineId: string) => `fs.review.${reviewSlot(scope, lineId)}`;

export function parseReview(raw: string | null): ReviewRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ReviewRecord>;
    if (typeof v.id !== "string" || !v.id || typeof v.at !== "string" || Number.isNaN(Date.parse(v.at))) {
      return null;
    }
    const slip = typeof v.slip === "string" && /^\d{4}$/.test(v.slip) ? v.slip : null;
    return { id: v.id, at: v.at, slip };
  } catch {
    return null;
  }
}

export function serializeReview(r: ReviewRecord): string {
  return JSON.stringify({ id: r.id, at: r.at, slip: r.slip });
}

/** The note as sent: trimmed, at most `NOTE_MAX` characters, or nothing. */
export function cleanNote(note: string): string | undefined {
  const t = note.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  return t ? t : undefined;
}

export type ReviewPhase = "idle" | "sending" | "failed";

/** `data-state` of M-MB-04. */
export function reviewScreenState(o: {
  record: ReviewRecord | null;
  phase: ReviewPhase;
  composing: boolean;
  online: boolean;
}): ScreenStateOf<"M-MB-04"> {
  if (o.record) return "sent";
  if (o.phase === "sending") return "sending";
  if (o.phase === "failed") return "failed";
  if (!o.online) return "offline";
  return o.composing ? "composing" : "none";
}

/**
 * The member's line as Pangutana has it: `none` for an officer (the board's tab has no line), else the statement
 * read's status.
 */
export type LineRead = "none" | "loading" | "ready" | "error";

/**
 * `data-state` of the Pangutana tab. Without her line there is no re-check to compose, so the screen is `none`
 * (or `offline`) while the line loads or after its read failed; IC-01 lists no `loading` or `error` for M-MB-04
 * (requested from the shell), and the failed read shows its own block, `M-MB-04.error`.
 */
export function pangutanaScreenState(
  o: { read: LineRead } & Parameters<typeof reviewScreenState>[0],
): ScreenStateOf<"M-MB-04"> {
  if (o.read !== "ready") return o.online ? "none" : "offline";
  return reviewScreenState(o);
}

/* ------------------------------------------------------------------ sending it once */

/** `POST /v1/review-requests` (register §5): her line, the slip it is about, and her note. */
export interface ReviewBody {
  lineId: string;
  slip?: string;
  note?: string;
}

/** The request as composed: the whole line or one slip, and the note as sent (`cleanNote`), absent when empty. */
export function reviewBody(lineId: string, slip: string | null, note: string): ReviewBody {
  const body: ReviewBody = { lineId };
  if (slip) body.slip = slip;
  const cleaned = cleanNote(note);
  if (cleaned) body.note = cleaned;
  return body;
}

/** The request's fingerprint: sha256 of its JCS bytes, so this phone can tell a retry from a new request. */
export function reviewDigest(body: ReviewBody): string {
  return sha256Hex(jcs(body));
}

/**
 * `postReviewRequest` as the re-check calls it: the body, and its Idempotency-Key (architecture §6.7 "Client
 * mutations"; S3.10: the stored response comes back for the same key, and a different body under it is refused with
 * 422 IDEMPOTENCY_KEY_REUSED). The shell's IC-08 client takes the body only until it sends the header; a client
 * that ignores the second argument still has this type, so the key goes out as soon as the shell sends it.
 */
export type PostReview = (
  body: ReviewBody,
  opts: { idempotencyKey: string },
) => Promise<ApiResult<{ id: string }>>;

/** A composed request the Committee's inbox has not accepted yet: its key, and the digest of the body it is for. */
export interface PendingReview {
  key: string;
  digest: string;
}

export const pendingReviewPrefKey = (scope: string, lineId: string) =>
  `fs.review.pending.${reviewSlot(scope, lineId)}`;

const DIGEST_RE = /^[0-9a-f]{64}$/;

export function parsePendingReview(raw: string | null): PendingReview | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PendingReview>;
    if (typeof v.key !== "string" || !UUIDV7_RE.test(v.key)) return null;
    if (typeof v.digest !== "string" || !DIGEST_RE.test(v.digest)) return null;
    return { key: v.key, digest: v.digest };
  } catch {
    return null;
  }
}

export function serializePendingReview(p: PendingReview): string {
  return JSON.stringify({ key: p.key, digest: p.digest });
}

/**
 * Where pending keys survive a restart: this phone's preferences (the key and a digest, never the note), per sender
 * (`scope`) and line.
 */
export interface PendingReviewStore {
  get(scope: string, lineId: string): Promise<PendingReview | null>;
  set(scope: string, lineId: string, p: PendingReview): Promise<void>;
  del(scope: string, lineId: string): Promise<void>;
}

/** A pending-key store over a string key-value store (`prefs` on the phone, a Map in tests). */
export function pendingReviewStore(kv: {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}): PendingReviewStore {
  return {
    get: async (scope, lineId) => parsePendingReview(await kv.get(pendingReviewPrefKey(scope, lineId))),
    set: (scope, lineId, p) => kv.set(pendingReviewPrefKey(scope, lineId), serializePendingReview(p)),
    del: (scope, lineId) => kv.del(pendingReviewPrefKey(scope, lineId)),
  };
}

export type ReviewSendResult =
  | { ok: true; id: string; key: string }
  | { ok: false; key: string | null; code: ApiErrorCode };

/**
 * Files each "Ipasusi pag-usab" once. A key is minted for a composed request and kept, in memory and in the store,
 * until the Committee's inbox accepts that request: if the server filed it but the answer was lost, "Try again" is
 * the same request, never a second one. A changed slip or note is a new request with a new key (the server refuses
 * a different body under an old key). One send at a time on this phone, shared by the statement's sheet and the
 * Pangutana tab: a commit while another is in flight (two taps in one frame) sends nothing and returns null. Keys are
 * kept per sender (`scope`, the paired member's `identityKey`): one member's pending key never files another's.
 */
export function createReviewSender(deps: { mint: () => string; store: PendingReviewStore }) {
  const memory = new Map<string, PendingReview>();
  let inFlight = false;

  async function attempt(body: ReviewBody, post: PostReview, scope: string): Promise<ReviewSendResult> {
    let key: string | null = null;
    const slot = reviewSlot(scope, body.lineId);
    try {
      const digest = reviewDigest(body);
      const held = memory.get(slot) ?? (await deps.store.get(scope, body.lineId));
      const pending = held?.digest === digest ? held : { key: deps.mint(), digest };
      key = pending.key;
      memory.set(slot, pending);
      if (pending !== held) await deps.store.set(scope, body.lineId, pending);
      const r = await post(body, { idempotencyKey: pending.key });
      if (r.ok) {
        memory.delete(slot);
        await deps.store.del(scope, body.lineId);
        return { ok: true, id: r.value.id, key: pending.key };
      }
      if (r.code === "IDEMPOTENCY_KEY_REUSED") {
        // The server holds another body under this key: the next try is a new request.
        memory.delete(slot);
        await deps.store.del(scope, body.lineId);
      }
      return { ok: false, key, code: r.code };
    } catch {
      return { ok: false, key, code: "NETWORK" };
    }
  }

  return function send(body: ReviewBody, post: PostReview, scope: string): Promise<ReviewSendResult> | null {
    if (inFlight) return null;
    inFlight = true;
    return attempt(body, post, scope).finally(() => {
      inFlight = false;
    });
  };
}
