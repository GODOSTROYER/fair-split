/**
 * Rescan requests (design K1: "Rescan requests from the console appear as a banner"; S1.9: "Gihangyo ni Analyn nga
 * i-scan pag-usab ang photo E."). In the reading room the treasurer finds a photo too blurred to read and presses
 * "Request rescan"; fs-api tells the workspace's clerk phones with a `rescan.requested` run event, payload
 * `{ photo, captureId, requestedBy }` (shim-defined here until the orchestrator adds it to IC-01).
 *
 * A request stays until it is answered: a slip filed after the request reached this phone answers it, one slip per
 * request, oldest request first, so rescanning two photos clears two banners. If the answering slip is later removed
 * (the co-op refused it), the request is open again, because the co-op still lacks the page. Requests are kept on the
 * phone (the event stream does not replay what a closed app missed) for a week, then dropped as out of date.
 *
 * Pure (tested in Node).
 */
import type { CaptureRecord } from "../../lib/outbox";

export const RESCAN_EVENT = "rescan.requested";

export interface RescanRequest {
  /** The run event's id: a redelivered event is the same request. */
  id: string;
  /** The reading room's label for the photo ("E"). */
  photo: string;
  /** The capture the photo came from, when it was this phone's: its thumbnail shows in the banner. */
  captureId: string | null;
  /** Who asked, as the clerk knows her ("Analyn"); null reads "the treasurer". */
  requestedBy: string | null;
  /** When this phone received it, on the phone's own clock (the same clock that stamps the slips answering it). */
  at: number;
}

/** A request older than this is out of date (the run has moved on); it is dropped, never shown. */
export const RESCAN_KEEP_MS = 7 * 24 * 3600_000;
const MAX_KEPT = 20;
/** Photo labels are short ("E", "P12"); anything longer is not one. */
const MAX_LABEL = 12;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A display name: a plain string, or `{ first }`; a persona id ("treasurer:analyn") is not one. */
function requester(v: unknown): string | null {
  const name = v && typeof v === "object" ? text((v as Record<string, unknown>).first) : text(v);
  return name && !name.includes(":") ? name : null;
}

/** A run event that is a rescan request, read defensively; anything else (or malformed) is null. */
export function parseRescanEvent(
  e: { id?: unknown; type?: unknown; payload?: unknown },
  receivedAt: number,
): RescanRequest | null {
  if (e.type !== RESCAN_EVENT || typeof e.id !== "string" || !e.id) return null;
  if (!e.payload || typeof e.payload !== "object") return null;
  const p = e.payload as Record<string, unknown>;
  const photo = text(p.photo);
  if (!photo || photo.length > MAX_LABEL) return null;
  return {
    id: e.id,
    photo,
    captureId: text(p.captureId),
    requestedBy: requester(p.requestedBy),
    at: receivedAt,
  };
}

const byAt = (a: RescanRequest, b: RescanRequest) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const fresh = (now: number) => (q: RescanRequest) => now - q.at < RESCAN_KEEP_MS;

/** Adds a request (a redelivered one changes nothing), oldest first, dropping the out-of-date and the overflow. */
export function addRescan(list: readonly RescanRequest[], q: RescanRequest, now: number): RescanRequest[] {
  const all = list.some((x) => x.id === q.id) ? [...list] : [...list, q];
  return all.filter(fresh(now)).sort(byAt).slice(-MAX_KEPT);
}

/** The requests not yet answered by a slip filed after them, oldest first. */
export function openRescans(
  requests: readonly RescanRequest[],
  records: readonly CaptureRecord[],
  now: number,
): RescanRequest[] {
  const slips = records
    .filter((r) => r.kind === "slip")
    .map((r) => r.createdAt)
    .sort((a, b) => a - b);
  const open: RescanRequest[] = [];
  let i = 0;
  for (const q of requests.filter(fresh(now)).sort(byAt)) {
    while (i < slips.length && (slips[i] ?? 0) <= q.at) i++;
    if (i < slips.length)
      i++; // answered by the first slip filed after it
    else open.push(q);
  }
  return open;
}

/** Stored requests, validated one by one: a damaged entry is dropped, never guessed at. */
export function parseStoredRescans(raw: string | null, now: number): RescanRequest[] {
  if (!raw) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: RescanRequest[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const photo = text(o.photo);
    if (typeof o.id !== "string" || !o.id || !photo || typeof o.at !== "number" || !Number.isFinite(o.at))
      continue;
    out.push({ id: o.id, photo, captureId: text(o.captureId), requestedBy: text(o.requestedBy), at: o.at });
  }
  return out.filter(fresh(now)).sort(byAt).slice(-MAX_KEPT);
}
