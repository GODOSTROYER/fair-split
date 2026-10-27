// W-TR-08's model: the split fan (S2.7 SplitFan) and the run's honest state, as pure functions of the IC-03
// snapshot and the live RunView. Width is money: one linear scale, k = 400 / Σ net px per cent, so the eight
// PayPal threads and the hatched cash band share the bar they leave. A thread's look follows the item's actual
// PayPal status, never a test value: graphite to 70% when sent, jade only on a verified SUCCESS, a canary cap
// for UNCLAIMED (a decision, never red), red only for a PayPal failure, retracted once moved to cash.

import type { MemberLineState, PayoutItemStatus, SeasonSnapshot } from "@fairsplit/contracts";
import type { LogRow } from "../../data/describe.js";
import { atLeast, type RunItem, type RunView } from "../../data/run-view.js";
import { format } from "../../lib/format.js";
import { engineOutput, splitBasis } from "../split/model.js";

export const FAN = {
  width: 1400,
  height: 560,
  seal: { cx: 96, cy: 280, size: 128 },
  bar: { x0: 188, x1: 196, y0: 80, y1: 480 },
  stub: { x: 1120, y0: 30, step: 20, w: 20, h: 12 },
  band: { x0: 1100, x1: 1120, y0: 190 },
  /** A sent thread stops here until PayPal confirms it (design §1: "sent, not paid"). */
  sentAt: 0.7,
  /** Control points sit 45% of the run in from each end. */
  pull: 0.45,
  /** The parked or failed end cap. */
  cap: 6,
} as const;

export type ThreadTone = "unsent" | "sent" | "landed" | "parked" | "failed" | "moved";

export interface FanThread {
  readonly senderItemId: string;
  readonly memberNo: string;
  readonly name: string;
  readonly cents: number;
  readonly status: PayoutItemStatus | null;
  readonly tone: ThreadTone;
  /** How much of the path is drawn: 0, the 70% "sent" mark, or 1 once PayPal confirmed it. */
  readonly progress: number;
  readonly width: number;
  readonly d: string;
  /** Where the cap sits (the 70% point along the path). */
  readonly capAt: { readonly x: number; readonly y: number };
  readonly stubY: number;
  readonly index: number;
  readonly eventId: string | null;
  readonly at: string | null;
  readonly source: RunItem["source"] | null;
  readonly amountState: "pencil" | "hollow" | "landed";
}

export interface CashSlice {
  readonly memberNo: string;
  readonly name: string;
  readonly cents: number;
  readonly y: number;
  readonly h: number;
  readonly attested: boolean;
  /** A PayPal line re-routed to cash (Rhea): appended at the band's end, with its own label. */
  readonly moved: boolean;
}

export interface FanView {
  readonly k: number;
  readonly netCents: number;
  readonly threads: readonly FanThread[];
  readonly slices: readonly CashSlice[];
  readonly band: { readonly d: string; readonly top: number; readonly bottom: number; readonly end: number };
  readonly paypal: { readonly cents: number; readonly members: number; readonly share: string };
  readonly cash: { readonly cents: number; readonly members: number };
  readonly members: number;
  readonly sealHash: string;
}

const MOVED_LINE_STATES: readonly MemberLineState[] = [
  "RETURNED",
  "OFF_RAIL_DUE",
  "OFF_RAIL_PAID",
  "REROUTED",
];

export function threadTone(
  status: PayoutItemStatus | null,
  item: RunItem | undefined,
  lineState: MemberLineState | undefined,
): ThreadTone {
  if (status === null) return "unsent";
  switch (status) {
    case "SUBMITTED":
    case "PENDING":
      return "sent";
    case "SUCCESS":
      return "landed";
    case "UNCLAIMED":
    case "ONHOLD":
      return "parked";
    case "RETURNED":
      // RETURNED is ours only after our own cancel (register §7): the line moved to cash. Any other is a failure.
      return item?.source === "cancel" ||
        item?.source === "seed" ||
        (lineState && MOVED_LINE_STATES.includes(lineState))
        ? "moved"
        : "failed";
    case "FAILED":
    case "BLOCKED":
    case "REFUNDED":
    case "REVERSED":
      return "failed";
  }
}

export function progressOf(tone: ThreadTone): number {
  switch (tone) {
    case "unsent":
    case "moved":
      return 0;
    case "landed":
      return 1;
    default:
      return FAN.sentAt;
  }
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** The point at a fraction of a cubic's arc length (sampled; the fan's curves are gentle). */
export function pointAtLength(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  fraction: number,
  pull: number = FAN.pull,
): { x: number; y: number } {
  const dx = x1 - x0;
  const cx0 = x0 + pull * dx;
  const cx1 = x1 - pull * dx;
  const n = 64;
  const pts: { x: number; y: number; s: number }[] = [];
  let s = 0;
  let px = x0;
  let py = y0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = cubic(x0, cx0, cx1, x1, t);
    const y = cubic(y0, y0, y1, y1, t);
    s += Math.hypot(x - px, y - py);
    pts.push({ x, y, s });
    px = x;
    py = y;
  }
  const target = Math.max(0, Math.min(1, fraction)) * s;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) continue;
    if (b.s >= target) {
      const f = b.s === a.s ? 0 : (target - a.s) / (b.s - a.s);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  return { x: x1, y: y1 };
}

function curve(x0: number, y0: number, x1: number, y1: number): string {
  const dx = x1 - x0;
  const r = (n: number) => Math.round(n * 100) / 100;
  return `M${r(x0)} ${r(y0)}C${r(x0 + FAN.pull * dx)} ${r(y0)} ${r(x1 - FAN.pull * dx)} ${r(y1)} ${r(x1)} ${r(y1)}`;
}

/** The batch: the run's items once posted, else the seeded batch's members and amounts (not sent yet). */
function batchItems(snapshot: SeasonSnapshot, view: RunView) {
  const seeded = snapshot.run.items;
  return seeded.map((s) => {
    const live = Object.values(view.items).find((i) => i.memberNo === s.memberNo);
    return {
      memberNo: s.memberNo,
      senderItemId: live?.senderItemId ?? s.senderItemId,
      cents: s.amountCents,
      live,
    };
  });
}

export function fanView(snapshot: SeasonSnapshot, view: RunView): FanView {
  const output = engineOutput(snapshot, splitBasis(view));
  const names = new Map(snapshot.members.map((m) => [m.memberNo, m.displayName]));
  const netCents = output.conservation.netCents;
  const k = netCents > 0 ? (FAN.bar.y1 - FAN.bar.y0) / netCents : 0;
  const items = batchItems(snapshot, view).sort(
    (a, b) => b.cents - a.cents || a.memberNo.localeCompare(b.memberNo),
  );

  let y = FAN.bar.y0;
  const threads: FanThread[] = items.map((item, i) => {
    const width = Math.max(1, k * item.cents);
    const y0 = y + width / 2;
    y += width;
    const stubY = FAN.stub.y0 + FAN.stub.step * i;
    const y1 = stubY + FAN.stub.h / 2;
    const lineState = view.lines[item.memberNo]?.state;
    const status = item.live?.status ?? null;
    const tone = threadTone(status, item.live, lineState);
    return {
      senderItemId: item.senderItemId,
      memberNo: item.memberNo,
      name: names.get(item.memberNo) ?? item.memberNo,
      cents: item.cents,
      status,
      tone,
      progress: progressOf(tone),
      width,
      d: curve(FAN.bar.x1, y0, FAN.stub.x, y1),
      capAt: pointAtLength(FAN.bar.x1, y0, FAN.stub.x, y1, FAN.sentAt),
      stubY,
      index: i,
      eventId: item.live?.eventId ?? null,
      at: item.live?.at ?? null,
      source: item.live?.source ?? null,
      amountState: tone === "landed" ? "landed" : tone === "unsent" ? "pencil" : "hollow",
    };
  });

  const moved = threads.filter((t) => t.tone === "moved");
  const cashLines = output.lines
    .filter((l) => l.rail === "CASH" && l.state !== "EXCLUDED")
    .sort((a, b) => a.memberNo.localeCompare(b.memberNo));
  const sliceSource = [
    ...cashLines.map((l) => ({ memberNo: l.memberNo, cents: l.netCents, moved: false })),
    ...moved.map((t) => ({ memberNo: t.memberNo, cents: t.cents, moved: true })),
  ];
  let sy = FAN.band.y0;
  const slices: CashSlice[] = sliceSource.map((s) => {
    const h = k * s.cents;
    const slice = {
      memberNo: s.memberNo,
      name: names.get(s.memberNo) ?? s.memberNo,
      cents: s.cents,
      y: sy,
      h,
      attested: view.lines[s.memberNo]?.state === "OFF_RAIL_PAID",
      moved: s.moved,
    };
    sy += h;
    return slice;
  });

  const onRail = threads.filter((t) => t.tone !== "moved");
  const railWidth = onRail.reduce((s, t) => s + t.width, 0);
  const top = FAN.bar.y0 + railWidth;
  const bottom = FAN.bar.y1;
  const end = sy;
  const dx = FAN.band.x0 - FAN.bar.x1;
  const r = (n: number) => Math.round(n * 100) / 100;
  const band =
    `M${FAN.bar.x1} ${r(top)}` +
    `C${r(FAN.bar.x1 + FAN.pull * dx)} ${r(top)} ${r(FAN.band.x0 - FAN.pull * dx)} ${FAN.band.y0} ${FAN.band.x0} ${FAN.band.y0}` +
    `L${FAN.band.x0} ${r(end)}` +
    `C${r(FAN.band.x0 - FAN.pull * dx)} ${r(end)} ${r(FAN.bar.x1 + FAN.pull * dx)} ${bottom} ${FAN.bar.x1} ${bottom}Z`;

  const paypalCents = onRail.reduce((s, t) => s + t.cents, 0);
  const cashCents = slices.reduce((s, c) => s + c.cents, 0);
  return {
    k,
    netCents,
    threads,
    slices,
    band: { d: band, top, bottom, end },
    paypal: {
      cents: paypalCents,
      members: onRail.length,
      share: netCents > 0 ? format.shareOf(paypalCents, netCents) : "",
    },
    cash: { cents: cashCents, members: slices.length },
    members: output.lines.length,
    sealHash: snapshot.run.batchSha256,
  };
}

export type FanoutState = "waiting" | "parked" | "denied" | "done";

/** S1.7's W-TR-08 states. Before the batch posts, the screen waits for it (and says so). */
export function fanoutState(view: RunView, fan: FanView): FanoutState {
  if (view.state === "DENIED") return "denied";
  if (fan.threads.some((t) => t.tone === "parked" || t.tone === "failed")) return "parked";
  if (view.state === "SETTLED" || view.state === "CLOSED") return "done";
  return "waiting";
}

export function isPostedRun(view: RunView): boolean {
  return atLeast(view, "POSTING") || view.state === "DENIED";
}

export type Mm6Phase = "ready" | "sent" | "landing" | "parked" | "rerouted" | "settled" | "denied";

/** The phase MM-6 rests in for what the run shows (history and replays never animate). */
export function restingPhase(view: RunView, fan: FanView): Mm6Phase {
  if (view.state === "DENIED") return "denied";
  if (view.state === "SETTLED" || view.state === "CLOSED") return "settled";
  const tones = fan.threads.map((t) => t.tone);
  if (tones.includes("parked") || tones.includes("failed")) return "parked";
  if (tones.includes("moved")) return "rerouted";
  if (tones.includes("landed")) return "landing";
  if (tones.includes("sent")) return "sent";
  return "ready";
}

/** The parked line a person must decide on (Rhea), if any. */
export function parkedThread(fan: FanView): FanThread | null {
  return fan.threads.find((t) => t.tone === "parked") ?? null;
}

/** When the run was funded: the invoice's PAID or MARKED_AS_PAID event, or the run's FUNDED. */
export function fundedAt(view: RunView): string | null {
  for (const e of view.events) {
    if (e.type === "invoice.state" && (e.payload.to === "PAID" || e.payload.to === "MARKED_AS_PAID"))
      return e.at;
    if (e.type === "run.state" && e.payload.to === "FUNDED") return e.at;
  }
  return null;
}

/** When the batch posted: the run's POSTED (PayPal's 201), else POSTING. */
export function postedAt(view: RunView): string | null {
  let posting: string | null = null;
  for (const e of view.events) {
    if (e.type !== "run.state") continue;
    if (e.payload.to === "POSTED") return e.at;
    if (e.payload.to === "POSTING") posting = e.at;
  }
  return posting;
}

export interface LatencyDot {
  readonly memberNo: string;
  readonly name: string;
  readonly ms: number;
}

export interface Latency {
  readonly dots: readonly LatencyDot[];
  readonly p50: number | null;
  readonly max: number | null;
}

/** Funding to each confirmed payment, at the true receipt times (S1.6: dots show real times, never paced ones). */
export function latency(view: RunView, fan: FanView): Latency {
  const from = fundedAt(view);
  if (!from) return { dots: [], p50: null, max: null };
  const t0 = Date.parse(from);
  const dots = fan.threads
    .filter((t) => t.tone === "landed" && t.at !== null)
    .map((t) => ({ memberNo: t.memberNo, name: t.name, ms: Math.max(0, Date.parse(t.at ?? from) - t0) }))
    .sort((a, b) => a.ms - b.ms);
  if (dots.length === 0) return { dots, p50: null, max: null };
  const mid = Math.floor((dots.length - 1) / 2);
  const p50 =
    dots.length % 2 === 1
      ? (dots[mid]?.ms ?? 0)
      : Math.round(((dots[mid]?.ms ?? 0) + (dots[mid + 1]?.ms ?? 0)) / 2);
  return { dots, p50, max: dots[dots.length - 1]?.ms ?? null };
}

export type Lane = LogRow["lane"];
export const LANES: readonly Lane[] = ["MACHINE", "PEOPLE", "PAYPAL"];

/** Log rows by lane, newest first. */
export function byLane(rows: readonly LogRow[]): Readonly<Record<Lane, LogRow[]>> {
  const out: Record<Lane, LogRow[]> = { MACHINE: [], PEOPLE: [], PAYPAL: [] };
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row) out[row.lane].push(row);
  }
  return out;
}

/** The run's summary once every item is terminal: paid by PayPal, in cash, and what was kept for members. */
export function summaryFacts(snapshot: SeasonSnapshot, fan: FanView) {
  return {
    paid: fan.threads.filter((t) => t.tone === "landed").length,
    cash: fan.cash.members,
    kept: format.money(snapshot.figures.redirectedCents),
  };
}
