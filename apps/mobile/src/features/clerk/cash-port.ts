/**
 * Where the clerk's cash list comes from.
 * - Live: `GET /v1/clerk/cash-day` on fs-api (shim-defined until WS-API adds it to IC-08): the current run's cash
 *   lines for the bearer's workspace. The answer is validated field by field; a malformed line is dropped, never
 *   guessed at. No list (no cash day on this run, or no such route yet: 404, 501) is not a failure: the screen
 *   simply has no cash plate.
 * - Demo: the seed fixture's cash members, following the demo's own story, which every stage frame reads from the
 *   same `DemoController` stage. Cash day is the seed's (30 Oct), the date the member's statement shows. Before both
 *   keys sign, Merlyn's line is still being checked; once the batch is approved she is due at the bodega; when the
 *   treasurer moves the parked items to cash (`cash-due`), Rhea and Nang Celing join her and the story's cash day
 *   opens. Every screen says "Demo data".
 *
 * Pure (tested in Node against msw).
 */
import { LINE_STATES, type LineState } from "../../_shims/contracts";
import { cashDayIso, fx, namedMembers, people, runSlug } from "../../_shims/seed";
import type { DemoStage } from "../../services/demo-fixtures";
import { type CashDayDTO, type CashLineDTO, isCashDayOpen } from "./cash-day";
import { DEMO_STATION } from "./clerk-site";

export const CASH_DAY_PATH = "/v1/clerk/cash-day";

/** Why the list could not be had; the screen words each (a pairing problem is not "try again"). */
export type CashLoadError = "NETWORK" | "SERVER" | "RATE_LIMITED" | "UNAUTHENTICATED" | "BAD_RESPONSE";

/**
 * The co-op refused this phone's pairing (401, 403): the list it gave a pairing it no longer accepts is neither shown
 * nor kept (nor attested from). Every other failure leaves an offline bodega its last list.
 */
export function dropsCashList(code: CashLoadError): boolean {
  return code === "UNAUTHENTICATED";
}

export type CashLoad =
  | { kind: "list"; day: CashDayDTO }
  /** The co-op has no cash list for this phone right now. */
  | { kind: "none" }
  | { kind: "error"; code: CashLoadError; status?: number };

export interface CashPort {
  readonly mode: "live" | "demo";
  load(): Promise<CashLoad>;
  /** Receipts can be filed: cash day has begun in Calinan (live), or the demo's story has reached the bodega. */
  isOpen(day: CashDayDTO, now: number): boolean;
}

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function parseLine(v: unknown): CashLineDTO | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!str(o.lineId) || !str(o.memberNo) || !str(o.name)) return null;
  if (typeof o.cents !== "number" || !Number.isInteger(o.cents) || o.cents < 0) return null;
  if (!str(o.lineState) || !(LINE_STATES as readonly string[]).includes(o.lineState)) return null;
  return {
    lineId: o.lineId,
    memberNo: o.memberNo,
    name: o.name,
    cents: o.cents,
    lineState: o.lineState as LineState,
    movedFromPayPal: o.movedFromPayPal === true,
    receivedAt: str(o.receivedAt) && !Number.isNaN(Date.parse(o.receivedAt)) ? o.receivedAt : null,
    receivedBy: str(o.receivedBy) ? o.receivedBy : null,
  };
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Validates fs-api's answer; null when the envelope itself is unusable. */
export function parseCashDay(v: unknown): CashDayDTO | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!str(o.runSlug) || !str(o.cashDay) || Number.isNaN(Date.parse(o.cashDay))) return null;
  if (!str(o.phpPerUsd) || !/^\d+(\.\d{1,2})?$/.test(o.phpPerUsd)) return null;
  if (!Array.isArray(o.lines)) return null;
  const provenance = o.provenance === "seeded" || o.provenance === "replay" ? o.provenance : "live";
  const treasurer =
    o.treasurer && typeof o.treasurer === "object"
      ? text((o.treasurer as Record<string, unknown>).first)
      : null;
  return {
    runSlug: o.runSlug,
    cashDay: o.cashDay,
    phpPerUsd: o.phpPerUsd,
    provenance,
    lines: o.lines.map(parseLine).filter((l): l is CashLineDTO => l !== null),
    station: text(o.station),
    treasurer: treasurer ? { first: treasurer } : null,
  };
}

/** Statuses that mean "no list here": nothing to pay on this run, or a server without the route yet. */
const NO_LIST = new Set([204, 404, 405, 410, 501]);

export function httpCashPort(opts: {
  origin: string;
  getBearer: () => string | null;
  fetch?: typeof fetch;
}): CashPort {
  const origin = opts.origin.replace(/\/+$/, "");
  return {
    mode: "live",
    async load() {
      const headers: Record<string, string> = { Accept: "application/json" };
      const bearer = opts.getBearer();
      if (bearer) headers.Authorization = `Bearer ${bearer}`;
      let res: Response;
      try {
        res = await (opts.fetch ?? globalThis.fetch)(`${origin}${CASH_DAY_PATH}`, { headers });
      } catch {
        return { kind: "error", code: "NETWORK" };
      }
      const status = res.status;
      if (NO_LIST.has(status)) return { kind: "none" };
      if (status === 401 || status === 403) return { kind: "error", code: "UNAUTHENTICATED", status };
      if (status === 429) return { kind: "error", code: "RATE_LIMITED", status };
      if (status >= 500) return { kind: "error", code: "SERVER", status };
      if (!res.ok) return { kind: "error", code: "BAD_RESPONSE", status };
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        // A captive portal's login page, or a proxy's: not the co-op's list.
        return { kind: "error", code: "BAD_RESPONSE", status };
      }
      const day = parseCashDay(body);
      return day ? { kind: "list", day } : { kind: "error", code: "BAD_RESPONSE", status };
    },
    isOpen: (day, now) => isCashDayOpen(day.cashDay, now),
  };
}

/** The demo's line ids follow the demo API's ("line_2026A_r37_M-014"). */
export function demoLineId(memberNo: string): string {
  return `line_${runSlug.replace("-", "_")}_${memberNo}`;
}

/** Where a cash line stands in the demo's story: still checked, due at the bodega, or already received. */
type DemoCash = "held" | "due" | "received";

/**
 * The demo's cash lines at each stage. Merlyn is paid in cash from the start; Rhea (C-07) and Nang Celing (the hero)
 * reach the bodega when the treasurer moves their parked PayPal items to cash.
 */
export function demoCashStory(
  stage: DemoStage | null,
): readonly { memberNo: string; movedFromPayPal: boolean; cash: DemoCash }[] {
  switch (stage ?? "checking") {
    case "checking":
      return [{ memberNo: "M-053", movedFromPayPal: false, cash: "held" }];
    case "sent":
    case "paid":
    case "unclaimed":
      return [{ memberNo: "M-053", movedFromPayPal: false, cash: "due" }];
    case "cash-due":
      return [
        { memberNo: "M-053", movedFromPayPal: false, cash: "due" },
        { memberNo: "M-031", movedFromPayPal: true, cash: "due" },
        { memberNo: "M-014", movedFromPayPal: true, cash: "due" },
      ];
    case "cash-received":
      return [
        { memberNo: "M-053", movedFromPayPal: false, cash: "due" },
        { memberNo: "M-031", movedFromPayPal: true, cash: "due" },
        { memberNo: "M-014", movedFromPayPal: true, cash: "received" },
      ];
  }
}

/** The demo story's cash day has come: the treasurer has moved the parked items to the bodega. */
export function demoCashOpen(stage: DemoStage | null): boolean {
  return stage === "cash-due" || stage === "cash-received";
}

const DEMO_LINE_STATE: Readonly<Record<DemoCash, LineState>> = {
  // Computed and frozen, waiting for both keys: "Gisusi pa".
  held: "READY",
  due: "OFF_RAIL_DUE",
  received: "OFF_RAIL_PAID",
};

export interface DemoCashPort extends CashPort {
  /** The demo co-op records a receipt this phone filed (the live co-op does this itself). */
  record(lineId: string, at: number, by: string): void;
}

export function demoCashPort(opts: { stage: () => DemoStage | null }): DemoCashPort {
  const received = new Map<string, { at: number; by: string }>();
  const line = (memberNo: string, movedFromPayPal: boolean, cash: DemoCash): CashLineDTO | null => {
    const m = namedMembers.find((x) => x.memberNo === memberNo);
    if (!m) return null;
    const lineId = demoLineId(memberNo);
    // A receipt this phone filed counts once the line is at the bodega, and keeps the clerk's own time and stamp.
    const got = cash === "held" ? undefined : received.get(lineId);
    return {
      lineId,
      memberNo,
      name: m.name,
      cents: m.netCents,
      lineState: got ? "OFF_RAIL_PAID" : DEMO_LINE_STATE[cash],
      movedFromPayPal,
      receivedAt: got ? new Date(got.at).toISOString() : null,
      receivedBy: got ? got.by : cash === "received" ? people.clerk.initials : null,
    };
  };
  return {
    mode: "demo",
    async load() {
      const lines = demoCashStory(opts.stage())
        .map((s) => line(s.memberNo, s.movedFromPayPal, s.cash))
        .filter((l): l is CashLineDTO => l !== null);
      return {
        kind: "list",
        day: {
          runSlug,
          cashDay: cashDayIso,
          phpPerUsd: fx.phpPerUsd,
          provenance: "seeded",
          lines,
          station: DEMO_STATION,
          treasurer: { first: people.treasurer.first },
        },
      };
    },
    isOpen: () => demoCashOpen(opts.stage()),
    record(lineId, at, by) {
      if (!received.has(lineId)) received.set(lineId, { at, by });
    },
  };
}
