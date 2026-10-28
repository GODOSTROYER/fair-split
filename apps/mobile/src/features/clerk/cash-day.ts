/**
 * Cash day at the bodega (plan: Jessie "attests cash with a Nadawat photo"; S1.7 W-TR-09 cash day): the cash list,
 * merged with the receipts this phone has filed, searched by name or member number, and gated to the day itself.
 *
 * - The clerk's own receipt counts as received at once: it is a person's act, and the row says where it lives
 *   ("Saved on this phone", "Sending", "Recorded by the co-op"). A refused receipt does not count.
 * - The co-op's "received" is final: nothing here moves a line back (I5).
 * - Pesos are never summed (register §2): the list counts people, never money.
 *
 * Pure (tested in Node).
 */
import type { LineState, MemberStatus, Provenance } from "../../_shims/contracts";
import { type CaptureRecord, MANUAL_ONLY, manilaDay } from "../../lib/outbox";

export interface CashLineDTO {
  lineId: string;
  memberNo: string;
  name: string;
  /** The line's net in US cents; the exact pesos come from `format.cashPesos(cents, phpPerUsd)` (I1). */
  cents: number;
  lineState: LineState;
  /** Parked on PayPal (UNCLAIMED), then moved to the bodega by the treasurer. */
  movedFromPayPal: boolean;
  receivedAt: string | null;
  /** Initials of whoever recorded it ("JD", or "AS" at the bodega laptop). */
  receivedBy: string | null;
}

export interface CashDayDTO {
  runSlug: string;
  /** The start of cash day (ISO); before it the receipt slab is hatched: "Available on cash day, 30 Okt." */
  cashDay: string;
  /** The run's recorded rate ("62.50"): cash pesos are exact at it, half-up to the centavo. */
  phpPerUsd: string;
  provenance: Provenance;
  lines: CashLineDTO[];
  /** The station this phone pays out at ("Purok 2 pickup"), when the co-op names one. */
  station: string | null;
  /** The co-op's treasurer as the clerk knows her ("Analyn"), for "See Treasurer Analyn". */
  treasurer: { first: string } | null;
}

/** due: hand it over; received: done; blocked: still being checked or moved to the next run (never hand over). */
export type CashStatus = "due" | "received" | "blocked";
/** Where this phone's receipt for the line is. */
export type LocalReceipt = "none" | "on-phone" | "sending" | "sent" | "refused";

export interface RosterEntry {
  line: CashLineDTO;
  status: CashStatus;
  local: LocalReceipt;
  receipt: CaptureRecord | null;
  receivedAt: number | null;
  receivedBy: string | null;
}

export function cashStatusOf(state: LineState): CashStatus {
  if (state === "OFF_RAIL_DUE") return "due";
  if (state === "OFF_RAIL_PAID") return "received";
  return "blocked";
}

/** The member's own status word for the row's chip (register §7): never a raw state name. */
export function memberStatusOf(e: RosterEntry): MemberStatus {
  if (e.status === "due") return "OFF_RAIL_DUE";
  if (e.status === "received") return "OFF_RAIL_PAID";
  return e.line.lineState === "EXCLUDED" ? "EXCLUDED" : "HELD";
}

export function localOf(r: CaptureRecord | null): LocalReceipt {
  if (!r) return "none";
  switch (r.state) {
    case "queued":
      return "on-phone";
    case "uploading":
      return "sending";
    case "uploaded":
    case "read":
      return "sent";
    case "failed":
      return r.nextAttemptAt === MANUAL_ONLY ? "refused" : "on-phone";
  }
}

const RANK: Readonly<Record<CashStatus, number>> = { due: 0, blocked: 1, received: 2 };

function memberNumber(no: string): number {
  const n = Number(no.replace(/\D/g, ""));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

export function mergeRoster(lines: readonly CashLineDTO[], records: readonly CaptureRecord[]): RosterEntry[] {
  const receipts = new Map<string, CaptureRecord>();
  for (const r of records) if (r.kind === "nadawat" && r.nadawat) receipts.set(r.nadawat.lineId, r);
  return lines
    .map((line): RosterEntry => {
      const receipt = receipts.get(line.lineId) ?? null;
      const local = localOf(receipt);
      const mine = receipt !== null && local !== "refused";
      const server = cashStatusOf(line.lineState);
      const status: CashStatus = server === "received" || mine ? "received" : server;
      const serverAt = line.receivedAt ? Date.parse(line.receivedAt) : Number.NaN;
      return {
        line,
        status,
        local,
        receipt,
        receivedAt: Number.isFinite(serverAt) ? serverAt : mine ? (receipt?.createdAt ?? null) : null,
        receivedBy: line.receivedBy ?? (mine ? (receipt?.nadawat?.attestedBy ?? null) : null),
      };
    })
    .sort(
      (a, b) =>
        RANK[a.status] - RANK[b.status] ||
        memberNumber(a.line.memberNo) - memberNumber(b.line.memberNo) ||
        (a.line.lineId < b.line.lineId ? -1 : 1),
    );
}

export function rosterCounts(entries: readonly RosterEntry[]) {
  let due = 0;
  let received = 0;
  let blocked = 0;
  for (const e of entries) {
    if (e.status === "due") due++;
    else if (e.status === "received") received++;
    else blocked++;
  }
  return { due, received, blocked, total: entries.length };
}

/** Cash day opens at the start of its day in Calinan (UTC+8), whatever the phone's zone. */
export function isCashDayOpen(cashDayIso: string, now: number): boolean {
  const at = Date.parse(cashDayIso);
  if (Number.isNaN(at)) return false;
  return manilaDay(now) >= manilaDay(at);
}

/** Lowercase, no diacritics, single spaces: "Pacaña" matches "pacana". */
export function normalise(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * A member matches by number ("53", "053", "M-053", "m53", or the first digits while typing) or by name (every
 * word typed starts a word of the name, in any order: "pon mer" finds Merlyn Ponce).
 */
export function matchesMember(line: Pick<CashLineDTO, "memberNo" | "name">, query: string): boolean {
  const q = normalise(query);
  if (!q) return true;
  const digits = q.replace(/^m\s*-?\s*/, "");
  if (/^\d+$/.test(digits)) {
    const no = line.memberNo.replace(/\D/g, "");
    const bare = (s: string) => s.replace(/^0+(?=\d)/, "");
    return no.startsWith(digits) || bare(no).startsWith(bare(digits));
  }
  const words = normalise(line.name).split(" ");
  return q.split(" ").every((t) => words.some((w) => w.startsWith(t)));
}

export function searchRoster(entries: readonly RosterEntry[], query: string): RosterEntry[] {
  return entries.filter((e) => matchesMember(e.line, query));
}

/**
 * "Jessie D. Dumaguing" → "JD": the ink stamp on every receipt this phone files. Null when the name has no letters:
 * a stamp is a person's mark, never a placeholder, so no receipt is filed without one.
 */
export function initialsOf(name: string): string | null {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return null;
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}
