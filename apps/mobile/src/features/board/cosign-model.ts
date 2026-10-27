/**
 * M-BD-01 co-sign request, the pure half (S1.9, design D1). What the Chair is shown is computed here from the request,
 * the phone's own recomputation of the batch (I4) and what has happened since he opened it, so each `data-state` is
 * tested without a device:
 *
 *   loading → request | override → signed, or changed | expired | offline | sent-back | none | error
 *
 * "Changed" covers three refusals with one promise, "Nothing was signed": the server's hash is not the hash of the
 * items it sent, the batch changed after he opened it, or the approval payload is not this batch.
 */
import type { CosignRequestDTO } from "../../_shims/api-client";
import type { ScreenStateOf } from "../../_shims/contracts";
import type { RequestCheck } from "../../lib/signing";

export type RequestStatus = ScreenStateOf<"M-BD-01">;

export interface CosignSnapshot {
  /** The first fetch is still running. */
  loading: boolean;
  /** Why the last fetch failed when there is nothing to show. */
  loadError: "offline" | "none" | "error" | null;
  dto: CosignRequestDTO | null;
  check: RequestCheck | null;
  /** The approval payload matched this batch (true), did not (false), or has not been fetched (null). */
  payloadOk: boolean | null;
  /** The batch hash the phone computed when the Chair first opened this request. */
  openedHash: string | null;
  online: boolean;
  now: number;
  /** This phone sent it back to the treasurer. */
  sentBack: boolean;
  /** The Chair's key is in (the 201, or `approval.signed` CHAIR over SSE). */
  chairSigned: boolean;
}

export type ChangeReason = "hash" | "changed" | "payload";

export function changeReason(s: CosignSnapshot): ChangeReason | null {
  if (s.check && !s.check.ok) return "hash";
  if (s.check?.ok && s.openedHash && s.check.recomputed.batchSha256 !== s.openedHash) return "changed";
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
