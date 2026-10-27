/**
 * The capture upload protocol (S3.10 "Capture: UUIDv7 + Content-Digest"): what each attempt sends and how each answer
 * is read. The native uploader (expo-file-system streams the file from disk) and the web one (XMLHttpRequest, for
 * progress) both build their requests here, so they send identical headers and agree on what is worth retrying.
 *
 * - A page goes to `POST /v1/captures` (register §4) with `X-Capture-Meta`.
 * - A cash receipt goes to `POST /v1/lines/:lineId/cash-receipt` with `X-Cash-Receipt` (shim-defined until WS-API
 *   adds it; S1.7 W-TR-09 cash day: "Photograph the Nadawat box", then the d2 "Mark received").
 * - A retry is the same request: the same Idempotency-Key and the same Content-Digest.
 *
 * Pure: no React Native, so Vitest runs it against msw.
 */
import { contentDigestHeader } from "../../_shims/api-client";
import { parseRetryAfter } from "../../lib/backoff";
import type { CaptureKind, CaptureRecord, UploadOutcome } from "../../lib/outbox";

export const CAPTURES_PATH = "/v1/captures";

/** fs-api's origin, from the one capture URL the API client publishes (`captureUrl()`). */
export function originOf(captureUrl: string): string {
  return captureUrl.endsWith(CAPTURES_PATH) ? captureUrl.slice(0, -CAPTURES_PATH.length) : captureUrl;
}

export function cashReceiptPath(lineId: string): string {
  return `/v1/lines/${encodeURIComponent(lineId)}/cash-receipt`;
}

export interface UploadRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
}

/** JSON for a header value with every non-ASCII character escaped, so a name like "Pacaña" never breaks a request. */
export function headerJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function uploadRequest(rec: CaptureRecord, origin: string, bearer: string | null): UploadRequest {
  const base = origin.replace(/\/+$/, "");
  const at = new Date(rec.createdAt).toISOString();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": rec.mime,
    "Idempotency-Key": rec.id,
    "Content-Digest": contentDigestHeader(rec.sha256),
  };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (rec.kind === "nadawat" && rec.nadawat) {
    const n = rec.nadawat;
    // Names stay off the wire: the co-op knows its members; the receipt binds the line, the amount and the stamp.
    headers["X-Cash-Receipt"] = headerJson({
      attestedAt: at,
      memberNo: n.memberNo,
      cents: n.cents,
      phpPerUsd: n.phpPerUsd,
      attestedBy: n.attestedBy,
      station: rec.station,
      bytes: rec.bytes,
    });
    return { url: `${base}${cashReceiptPath(n.lineId)}`, method: "POST", headers };
  }
  headers["X-Capture-Meta"] = headerJson({
    capturedAt: at,
    station: rec.station,
    memberHint: rec.memberHint,
    bytes: rec.bytes,
    source: rec.source,
  });
  return { url: `${base}${CAPTURES_PATH}`, method: "POST", headers };
}

export type HeaderLookup = (name: string) => string | null | undefined;

/** Case-insensitive lookup over a plain header record (expo-file-system's `UploadResult.headers`). */
export function headerLookup(headers: Readonly<Record<string, string>> | null | undefined): HeaderLookup {
  const map = new Map(Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return (name) => map.get(name.toLowerCase()) ?? null;
}

/** Transient by nature: worth the same request again, later. */
const RETRY_STATUSES = new Set([408, 425, 429]);

function parseJson(body: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(body);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

function errorCode(body: string): string | null {
  const v = parseJson(body);
  const e = v?.error;
  if (e && typeof e === "object") return str((e as Record<string, unknown>).code);
  return null;
}

/**
 * Reads one answer. `status` 0 means the request never got one (offline, DNS, a reset socket).
 * - 2xx with our JSON: done. 2xx or 3xx that is not our JSON is a captive portal or a proxy: try again later.
 * - 408, 425, 429, 5xx: try again later, honouring Retry-After.
 * - Any other 4xx: the co-op refused this request; only a person can send it again.
 */
export function interpretUpload(
  kind: CaptureKind,
  status: number,
  body: string,
  header: HeaderLookup,
  now: number,
): UploadOutcome {
  if (status === 0) return { kind: "retry", error: "NETWORK" };
  if (status >= 200 && status < 300) {
    const v = parseJson(body);
    if (!v) return { kind: "retry", error: "NOT_OUR_SERVER" };
    if (kind === "nadawat") {
      const id = str(v.receiptId) ?? str(v.documentId);
      if (!id) return { kind: "retry", error: "BAD_RESPONSE" };
      return { kind: "ok", documentId: id, duplicateOf: null, rowsRead: null, serial: null };
    }
    const documentId = str(v.documentId);
    if (!documentId) return { kind: "retry", error: "BAD_RESPONSE" };
    return {
      kind: "ok",
      documentId,
      duplicateOf: str(v.exactDuplicateOf),
      rowsRead: int(v.rowsRead),
      serial: str(v.serial),
    };
  }
  if (status >= 300 && status < 400) return { kind: "retry", error: "NOT_OUR_SERVER" };
  if (RETRY_STATUSES.has(status) || status >= 500) {
    return {
      kind: "retry",
      error: String(status),
      retryAfterMs: parseRetryAfter(header("retry-after"), now),
    };
  }
  const code =
    errorCode(body) ??
    (status === 401
      ? "UNAUTHENTICATED"
      : status === 403
        ? "FORBIDDEN"
        : status === 413
          ? "TOO_LARGE"
          : null) ??
    String(status);
  return { kind: "reject", error: code };
}

/** Codes the uploaders produce themselves, before or instead of an answer. */
export const LOCAL_ERROR = {
  /** The photo is no longer on the phone (never expected: captures live in the app's documents). */
  fileMissing: "FILE_MISSING",
  /** No progress for too long on a slow link: abandoned, and retried with the same key. */
  stalled: "STALLED",
  network: "NETWORK",
} as const;

/** How long an upload may go without progress before it is abandoned (and retried with the same key). */
export const STALL_MS = 45_000;
