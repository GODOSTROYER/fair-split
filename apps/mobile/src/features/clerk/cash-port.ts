/**
 * Where the clerk's cash list comes from.
 * - Live: `GET /v1/clerk/cash-day` on fs-api (shim-defined until WS-API adds it to IC-08): the current run's cash
 *   lines for the bearer's workspace. The answer is validated field by field; a malformed line is dropped, never
 *   guessed at.
 * - Demo: the seed fixture's named cash members (Merlyn in cash from the start, Rhea after PayPal parked her
 *   item), plus Nang Celing when the demo has moved her line to the bodega. Cash day is today, as a judge clone
 *   shifts it (seed: "judge clones shift it"); every screen says "Demo data".
 *
 * Pure (tested in Node against msw).
 */
import type { ApiResult } from "../../_shims/api-client";
import { LINE_STATES, type LineState } from "../../_shims/contracts";
import { fx, namedMembers, people, runSlug } from "../../_shims/seed";
import { manilaDay } from "../../lib/outbox";
import type { DemoStage } from "../../services/demo-fixtures";
import type { CashDayDTO, CashLineDTO } from "./cash-day";

export const CASH_DAY_PATH = "/v1/clerk/cash-day";

export interface CashPort {
  readonly mode: "live" | "demo";
  load(): Promise<ApiResult<CashDayDTO>>;
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

/** Validates fs-api's answer; null when the envelope itself is unusable. */
export function parseCashDay(v: unknown): CashDayDTO | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!str(o.runSlug) || !str(o.cashDay) || Number.isNaN(Date.parse(o.cashDay))) return null;
  if (!str(o.phpPerUsd) || !/^\d+(\.\d{1,2})?$/.test(o.phpPerUsd)) return null;
  if (!Array.isArray(o.lines)) return null;
  const provenance = o.provenance === "seeded" || o.provenance === "replay" ? o.provenance : "live";
  return {
    runSlug: o.runSlug,
    cashDay: o.cashDay,
    phpPerUsd: o.phpPerUsd,
    provenance,
    lines: o.lines.map(parseLine).filter((l): l is CashLineDTO => l !== null),
  };
}

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
        return { ok: false, code: "NETWORK" };
      }
      if (res.status === 401 || res.status === 403)
        return { ok: false, code: "UNAUTHENTICATED", status: res.status };
      if (res.status === 429) return { ok: false, code: "RATE_LIMITED", status: 429 };
      if (!res.ok) return { ok: false, code: "NETWORK", status: res.status };
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return { ok: false, code: "NETWORK", status: res.status };
      }
      const dto = parseCashDay(body);
      return dto ? { ok: true, value: dto } : { ok: false, code: "NETWORK", status: res.status };
    },
  };
}

/** The demo's line ids follow the demo API's ("line_2026A_r37_M-014"). */
export function demoLineId(memberNo: string): string {
  return `line_${runSlug.replace("-", "_")}_${memberNo}`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 08:00 in Calinan on `now`'s day, as an ISO string with the +08:00 offset. */
export function cashDayToday(now: number): string {
  const d = new Date(manilaDay(now) * 86_400_000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T08:00:00+08:00`;
}

export interface DemoCashPort extends CashPort {
  /** The demo co-op records a receipt this phone filed (the live co-op does this itself). */
  record(lineId: string, at: number, by: string): void;
}

export function demoCashPort(opts: { now: () => number; stage: () => DemoStage | null }): DemoCashPort {
  const received = new Map<string, { at: number; by: string }>();
  const line = (memberNo: string, movedFromPayPal: boolean, preReceived: boolean): CashLineDTO | null => {
    const m = namedMembers.find((x) => x.memberNo === memberNo);
    if (!m) return null;
    const lineId = demoLineId(memberNo);
    const got = received.get(lineId);
    return {
      lineId,
      memberNo,
      name: m.name,
      cents: m.netCents,
      lineState: got || preReceived ? "OFF_RAIL_PAID" : "OFF_RAIL_DUE",
      movedFromPayPal,
      receivedAt: got ? new Date(got.at).toISOString() : null,
      receivedBy: got ? got.by : preReceived ? people.clerk.initials : null,
    };
  };
  return {
    mode: "demo",
    async load() {
      const stage = opts.stage();
      const lines = [
        line("M-053", false, false),
        line("M-031", true, false),
        // The demo's own storyline: the hero's item parks, the treasurer moves it to the bodega.
        stage === "cash-due" || stage === "cash-received"
          ? line("M-014", true, stage === "cash-received")
          : null,
      ].filter((l): l is CashLineDTO => l !== null);
      return {
        ok: true,
        value: {
          runSlug,
          cashDay: cashDayToday(opts.now()),
          phpPerUsd: fx.phpPerUsd,
          provenance: "seeded",
          lines,
        },
      };
    },
    record(lineId, at, by) {
      if (!received.has(lineId)) received.set(lineId, { at, by });
    },
  };
}
