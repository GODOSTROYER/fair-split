/**
 * M-BD-01 co-sign request, the pure half (S1.9, design D1). What the Chair is shown is computed here from the request,
 * the phone's own recomputation of the batch (I4) and what has happened since he opened it, so each `data-state` is
 * tested without a device:
 *
 *   loading → request | override → signed, or changed | expired | offline | sent-back | none | error
 *
 * "Changed" covers four refusals with one promise, "Nothing was signed": the server's hash is not the hash of the
 * items it sent; its member lines are not what their hashes cover, its lines digest is not theirs, or a payout is not
 * a PayPal line's net; the batch changed after he opened it; or the approval payload is not this batch (its own items
 * and lines do not give its digests, or it is not the batch he opened). Every digest is computed on the phone with
 * WS-CORE's functions (`lib/signing.ts`); the server's word is never taken for one.
 *
 * The same promise holds at the instant of signing (I4): `commitRefusal` is asked when the slab is released (or the
 * dialog confirmed), again after the payload arrives and again after the fingerprint step, and `payloadPlan` builds
 * the expected batch only while the request on screen is still the batch he opened. A batch that changes during the
 * hold, with the dialog open or while a stale payload is replaced is therefore never signed.
 */
import type { ApprovalPayloadDTO, CosignRequestDTO } from "../../_shims/api-client";
import type { Lang, ScreenStateOf } from "../../_shims/contracts";
import type { FeedbackEvent } from "../../_shims/motion";
import {
  checkApprovalPayload,
  checkCosignRequest,
  type ExpectedBatch,
  type PayloadCheck,
  payloadStale,
  type RequestCheck,
} from "../../lib/signing";

export type RequestStatus = ScreenStateOf<"M-BD-01">;

/** The batch the Chair opened: the hash his seal was drawn from, and the lines digest his phone computed with it. */
export interface OpenedBatch {
  batchSha256: string;
  linesDigest: string;
}

export function openedFrom(check: RequestCheck | null): OpenedBatch | null {
  return check?.ok
    ? { batchSha256: check.recomputed.batchSha256, linesDigest: check.expected.linesDigest }
    : null;
}

/** An expected batch (a payload's target) is the batch the Chair opened. */
export function matchesOpened(
  expected: Pick<ExpectedBatch, "batchSha256" | "linesDigest">,
  opened: OpenedBatch | null,
): boolean {
  return (
    !!opened && expected.batchSha256 === opened.batchSha256 && expected.linesDigest === opened.linesDigest
  );
}

/** The request on screen is still exactly the batch the Chair opened (I4). */
export function sameAsOpened(check: RequestCheck | null, opened: OpenedBatch | null): boolean {
  return !!check?.ok && matchesOpened(check.expected, opened);
}

export interface CosignSnapshot {
  /** The first fetch is still running. */
  loading: boolean;
  /** Why the last fetch failed when there is nothing to show. */
  loadError: "offline" | "none" | "error" | null;
  dto: CosignRequestDTO | null;
  check: RequestCheck | null;
  /** The approval payload matched this batch (true), did not (false), or has not been fetched (null). */
  payloadOk: boolean | null;
  /** The batch the phone computed when the Chair first opened this request (or opened it again to review). */
  opened: OpenedBatch | null;
  online: boolean;
  now: number;
  /** This phone sent it back to the treasurer. */
  sentBack: boolean;
  /** The Chair's key is in (the 201, or `approval.signed` CHAIR over SSE). */
  chairSigned: boolean;
}

export type ChangeReason = "hash" | "lines" | "changed" | "payload";

export function changeReason(s: CosignSnapshot): ChangeReason | null {
  if (s.check && !s.check.ok) {
    return s.check.problem === "lines" || s.check.problem === "unbalanced" ? "lines" : "hash";
  }
  if (s.check?.ok && s.opened && !sameAsOpened(s.check, s.opened)) return "changed";
  if (s.payloadOk === false) return "payload";
  return null;
}

export function requestExpired(dto: Pick<CosignRequestDTO, "state" | "expiresAt">, now: number): boolean {
  if (dto.state === "expired") return true;
  const at = Date.parse(dto.expiresAt);
  return !Number.isFinite(at) || at <= now;
}

export function requestStatus(s: CosignSnapshot): RequestStatus {
  if (s.sentBack) return "sent-back";
  if (s.chairSigned || s.dto?.state === "signed") return "signed";
  const dto = s.dto;
  if (!dto) {
    if (s.loadError === "offline") return "offline";
    if (s.loadError === "none") return "none";
    if (s.loadError === "error") return "error";
    return "loading";
  }
  if (dto.state === "declined") return "none";
  if (requestExpired(dto, s.now)) return "expired";
  if (changeReason(s)) return "changed";
  if (!s.online) return "offline";
  return dto.state === "override" ? "override" : "request";
}

/* ------------------------------------------------------------------ signing only what was opened (I4) */

/** Why the Chair's key may not be asked for right now: a changed batch, no connection, or nothing open to sign. */
export type CommitRefusal = "mismatch" | "offline" | "closed";

/**
 * The gate in front of the key: the request is open to him (request or override), it checks out, and it is still
 * exactly the batch he opened. Read from the latest state at the moment of the release, never from what the slab
 * was rendered with, because a release can arrive after the batch changed under a hold or an open dialog.
 */
export function commitRefusal(s: CosignSnapshot): CommitRefusal | null {
  const status = requestStatus(s);
  if (status === "changed") return "mismatch";
  if (status === "offline") return "offline";
  if (status !== "request" && status !== "override") return "closed";
  return sameAsOpened(s.check, s.opened) ? null : "mismatch";
}

export function canCommit(s: CosignSnapshot): boolean {
  return commitRefusal(s) === null;
}

/** What the phone remembers about the request between fetches: the half of the provider the gate reads. */
export interface RequestMemory {
  dto: CosignRequestDTO | null;
  check: RequestCheck | null;
  /** Set by the first good fetch, and again only when the Chair reviews a changed batch ("Review again"). */
  opened: OpenedBatch | null;
  /** The approval payload in hand, with the items and lines it came with: always for the opened batch. */
  payload: ApprovalPayloadDTO | null;
  /** The last payload checked was this batch (true), was not (false), or none was checked (null). */
  payloadOk: boolean | null;
}

export const EMPTY_MEMORY: RequestMemory = {
  dto: null,
  check: null,
  opened: null,
  payload: null,
  payloadOk: null,
};

/**
 * A fetched request. The first good one, or one fetched to review again (`adopt`), becomes the batch the Chair has
 * opened. Any batch other than the opened one drops the payload in hand, so no payload outlives the batch it was
 * checked against.
 */
export function rememberRequest(m: RequestMemory, dto: CosignRequestDTO, adopt: boolean): RequestMemory {
  const check = checkCosignRequest(dto);
  const opened = check.ok && (adopt || m.opened === null) ? openedFrom(check) : m.opened;
  const keep = !adopt && sameAsOpened(check, opened);
  return {
    dto,
    check,
    opened,
    payload: keep ? m.payload : null,
    payloadOk: keep ? m.payloadOk : null,
  };
}

/** The opened batch is signable and key 1 is in: fetch its payload ahead, so the fingerprint step starts at once. */
export function prefetchFor(m: RequestMemory): ExpectedBatch | null {
  if (!m.dto || !m.check?.ok || !sameAsOpened(m.check, m.opened)) return null;
  const signable = m.dto.state === "request" || m.dto.state === "override";
  return signable && m.dto.treasurerSigned ? m.check.expected : null;
}

/**
 * A payload checked against `expected`. It is kept only while `expected` is still the batch the Chair opened: one
 * that answers for a batch he has since stopped looking at is neither kept nor allowed to mark this one as changed.
 */
export function rememberPayload(
  m: RequestMemory,
  expected: ExpectedBatch,
  result: PayloadCheck,
): RequestMemory {
  if (!matchesOpened(expected, m.opened) || !sameAsOpened(m.check, m.opened)) return m;
  if (result.ok) return { ...m, payload: result.dto, payloadOk: true };
  // An expired payload is simply replaced next time; any other difference means it is not this batch.
  return result.problem === "expired" ? { ...m, payload: null } : { ...m, payload: null, payloadOk: false };
}

/** Its nonce was used or refused: the next signature fetches a fresh payload. */
export function forgetPayload(m: RequestMemory): RequestMemory {
  return { ...m, payload: null };
}

export type PayloadPlan =
  | { kind: "refuse" }
  | { kind: "cached"; approval: ApprovalPayloadDTO; expected: ExpectedBatch }
  | { kind: "fetch"; expected: ExpectedBatch };

/**
 * Which payload the next fingerprint step may use. The expected batch is built only while the request on screen is
 * the batch the Chair opened; the payload in hand is used only while it is that batch and has two minutes left;
 * anything else is fetched again and checked against the opened batch, never against whatever the server has now.
 */
export function payloadPlan(m: RequestMemory, now: Date): PayloadPlan {
  if (!m.check?.ok || !sameAsOpened(m.check, m.opened)) return { kind: "refuse" };
  const expected = m.check.expected;
  if (
    m.payload &&
    m.payloadOk &&
    !payloadStale(m.payload.payload, now) &&
    checkApprovalPayload(m.payload, expected, now).ok
  ) {
    return { kind: "cached", approval: m.payload, expected };
  }
  return { kind: "fetch", expected };
}

/** A payload ready for the fingerprint step, with the items and lines it was checked against, or why there is none. */
export type FreshPayload =
  | { ok: true; approval: ApprovalPayloadDTO; expected: ExpectedBatch }
  | { ok: false; reason: "offline" | "mismatch" | "error" };

/**
 * MM-5's mismatch on M-BD-01 (S2.9: "a clack, the Error haptic, and the canary message"): once, when the request
 * turns unsignable because its batch, its lines or its payload is not the batch the Chair opened.
 */
export function changedCue(before: RequestStatus | null, now: RequestStatus): FeedbackEvent | null {
  return now === "changed" && before !== "changed" ? "seal.mismatch" : null;
}

/* ------------------------------------------------------------------ resolved holds in his language */

/**
 * Where the console's summary of a resolved hold goes. fs-api sends it in English only (IC-08 `CosignHold.summary`),
 * with figures formatted for English; until it sends a localisable template, it is never set as the Chair's own
 * words: in English it is his line, otherwise a labelled English note, shown when he opens the hold (or always in a
 * judge frame that asked for English glosses).
 */
export function holdNote(
  lang: Lang,
  opts: { gloss: boolean; expanded: boolean },
): "line" | "note" | "hidden" {
  if (lang === "en") return "line";
  return opts.gloss || opts.expanded ? "note" : "hidden";
}

/** The two officers' keys on the seal: key 1 owns rings 0–2, key 2 rings 3–4. */
export function sealKeysFor(
  dto: Pick<CosignRequestDTO, "treasurerSigned"> | null,
  chairSigned: boolean,
): 0 | 1 | 2 {
  if (chairSigned) return 2;
  return dto?.treasurerSigned ? 1 : 0;
}

/** "Why you" in one line (design D1): the rate card's co-sign rule that applies, the batch rule first. */
export function whyKey(
  dto: Pick<CosignRequestDTO, "reason" | "totalCents" | "thresholdCents">,
): "M-BD-01.why.batch" | "M-BD-01.why.line" | "M-BD-01.why.override" {
  if (dto.reason === "override") return "M-BD-01.why.override";
  if (dto.reason === "batch-over-threshold" || dto.totalCents > dto.thresholdCents)
    return "M-BD-01.why.batch";
  return "M-BD-01.why.line";
}

/** A hash in rows of four groups of four ("7f3a 91c2 0b4e 55d1"), four rows for a sha256, to compare by eye. */
export function hashRows(hex: string, perRow = 4): string[] {
  const groups = hex.toLowerCase().match(/.{1,4}/g) ?? [];
  const rows: string[] = [];
  for (let i = 0; i < groups.length; i += perRow) rows.push(groups.slice(i, i + perRow).join(" "));
  return rows;
}

/** Presence is shown while it is fresh (≤1 Hz upstream; a minute of silence means the treasurer has left). */
export const PRESENCE_FRESH_MS = 60_000;

export interface Presence {
  persona: string;
  view: string;
  at: string;
}

/** The treasurer's live presence on the approval screen, or null once it is stale. */
export function treasurerPresence(p: Presence | null, now: number): Presence | null {
  if (!p?.persona.startsWith("treasurer:")) return null;
  const at = Date.parse(p.at);
  if (!Number.isFinite(at) || now - at > PRESENCE_FRESH_MS) return null;
  return p;
}

/** `member:M-014` from `r37-M-014`: the member number a batch item pays (register §8 `sender_item_id`). */
export function memberOf(item: { senderItemId: string; memberNo?: string }): string {
  if (item.memberNo) return item.memberNo;
  const m = /-(M-\d{3})$/.exec(item.senderItemId);
  return m?.[1] ?? item.senderItemId;
}

/** The presence view this phone reports for what the Chair is looking at (S1.9 "Opening a hold emits presence"). */
export function presenceView(runSlug: string, holdId: string | null): string {
  return holdId ? `cosign:${runSlug}:hold:${holdId}` : `cosign:${runSlug}`;
}

/**
 * Large text or a short window (S1.12: font scale 2.0, 200% zoom on the web): fixed footers would cover most of the
 * screen, so the thumb zone and the sign button move into the scroll.
 */
export function compactLayout(width: number, height: number, fontScale: number): boolean {
  return width < 320 || height < 560 || fontScale >= 1.5;
}

/**
 * Whose review a request's memory is (the batch opened, the payload fetched, I4 "the batch the Chair opened"): the
 * run and the officer paired (`identityKey`). The provider starts over for anyone else paired on this phone, or the
 * same name in another workspace; a new token for the same officer keeps what he opened.
 */
export function requestScope(runSlug: string, identity: string | null): string {
  return JSON.stringify([runSlug, identity]);
}
