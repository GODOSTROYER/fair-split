// W-TR-08's model: the split fan (S2.7 SplitFan, design §1 signature 6: one seal, 64 lines, eight PayPal threads
// and 56 dashed cash lines) and the run's honest state, as pure functions of the IC-03 snapshot and the live
// RunView. Width is money: one linear scale, k = 276 / Σ net px per cent, so every line leaves the bar as wide as
// its payment. A thread's look follows the item's actual PayPal status, never a test value: graphite to 70% when
// sent, jade only on a verified SUCCESS, a canary cap for UNCLAIMED (a decision, never red), red only for a
// PayPal failure, retracted once moved to cash, when its own dashed cash line leaves from the same slot.

import type { MemberLineState, PayoutItemStatus, SeasonSnapshot } from "@fairsplit/contracts";
import type { LogRow } from "../../data/describe.js";
import { currentPayoutItem, payoutStatus } from "../../data/payout-replay.js";
import { atLeast, type RunItem, type RunView } from "../../data/run-view.js";
import { format } from "../../lib/format.js";
import { engineOutput, splitBasis } from "../split/model.js";

export const FAN = {
  width: 1400,
  height: 560,
  seal: { cx: 96, cy: 248, size: 128 },
  /**
   * The run's net as one bar, 276 px for all of it: every line leaves it as wide as its money. The scale keeps the
   * 56 cash lines' column to under half the picture's height, so the eight PayPal threads still read first.
   */
  bar: { x0: 188, x1: 196, y0: 110, y1: 386 },
  /** Every line ends on this x: the eight PayPal stubs on top, the cash lines' end marks beneath them. */
  endX: 1040,
  /** The PayPal stubs, spread so each name and amount keeps its own row at the narrowest stage (892 px). */
  stub: { y0: 24, step: 28, w: 20, h: 12 },
  /** The cash lines end in one column from here, each as tall as its money, with a 20 px end mark. */
  cash: { y0: 268, w: 20 },
  /** Where the labels begin (they are HTML over the picture, so text keeps its type size at any width). */
  labelX: 1072,
  /** A cash line's dashed stroke is a third of its height: the air between neighbours makes 56 lines read as 56. */
  cashStroke: 0.36,
  /** A cash line's dash and gap along its length (pathLength 1; a line runs about 900 px: 9 px on, 11 px off). */
  dash: { on: 0.01, off: 0.012 },
  /** A sent thread stops here until PayPal confirms it (design §1: "sent, not paid"). */
  sentAt: 0.7,
  /** Control points sit 45% of the run in from each end. */
  pull: 0.45,
  /** The parked or failed end cap. */
  cap: 6,
} as const;

/** A cash line's dash pattern, as the SVG attribute takes it. */
export const CASH_DASHARRAY = `${FAN.dash.on} ${FAN.dash.off}`;
const DASH_PERIOD = FAN.dash.on + FAN.dash.off;
const GOLDEN = 0.618_033_988_75;

export type ThreadTone = "unsent" | "sent" | "landed" | "parked" | "failed" | "moved";

export interface FanThread {
  readonly senderItemId: string;
  readonly memberNo: string;
  readonly name: string;
  readonly cents: number;
  readonly status: PayoutItemStatus | null;
  readonly replayed: boolean;
  readonly statusWord: string;
  readonly tone: ThreadTone;
  /** How much of the path is drawn: 0, the 70% "sent" mark, or 1 once PayPal confirmed it. */
  readonly progress: number;
  readonly width: number;
  readonly d: string;
  /** Where the cap sits (the 70% point along the path). */
  readonly capAt: { readonly x: number; readonly y: number };
  /** Its slot's centre on the bar: a line moved to cash leaves from here too. */
  readonly barY: number;
  readonly stubY: number;
  readonly index: number;
  readonly eventId: string | null;
  readonly at: string | null;
  readonly source: RunItem["source"] | null;
  readonly amountState: AmountState;
}

export type AmountState = "pencil" | "ink" | "hollow" | "landed" | "attested";

/** One member paid in cash at the bodega: a dashed line from the bar to the cash column, drawn and still. */
export interface CashLine {
  readonly memberNo: string;
  readonly name: string;
  readonly cents: number;
  readonly d: string;
  /** Its money as height on the bar and in the cash column (k × cents). */
  readonly h: number;
  /** The dashed stroke's width: a share of its height, so the 56 read as 56. */
  readonly stroke: number;
  /** Where its dashes start (pathLength units): staggered by the golden ratio so no two neighbours line up. */
  readonly dashOffset: number;
  /** The top of its end mark in the cash column. */
  readonly endY: number;
  /** Cash handed over and attested at the bodega (OFF_RAIL_PAID): the end mark turns ink, never jade. */
  readonly attested: boolean;
  /** A PayPal line re-routed to cash (Rhea): it leaves from her thread's slot and ends on top of the column. */
  readonly moved: boolean;
  readonly index: number;
}

export interface FanView {
  readonly k: number;
  readonly netCents: number;
  readonly threads: readonly FanThread[];
  /** Every cash line, moved ones first (they end on top of the column, nearest the threads they left). */
  readonly cashLines: readonly CashLine[];
  readonly paypal: { readonly cents: number; readonly members: number; readonly share: string };
  readonly cash: {
    readonly cents: number;
    readonly members: number;
    /** The cash column's extent at the end x. */
    readonly top: number;
    readonly bottom: number;
    readonly amountState: AmountState;
  };
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
    const live = currentPayoutItem(view, s.memberNo);
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
  // S2.2.1: every line is ink once both keys approved it (a batch PayPal denied was approved first); before that
  // the engine's figures are pencil.
  const approved = atLeast(view, "APPROVED") || view.state === "DENIED";
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
    const presentation = payoutStatus({
      ...(status ? { itemStatus: status } : { state: lineState ?? "READY" }),
      view,
      memberNo: item.memberNo,
      senderItemId: item.senderItemId,
    });
    const tone = threadTone(status, item.live, lineState);
    // A current cash decision retracts the old thread, regardless of the source payout's provenance.
    const replayed = presentation.replayed && tone !== "moved";
    return {
      senderItemId: item.senderItemId,
      memberNo: item.memberNo,
      name: names.get(item.memberNo) ?? item.memberNo,
      cents: item.cents,
      status,
      replayed,
      statusWord:
        tone === "moved"
          ? payoutStatus({ state: lineState ?? "OFF_RAIL_DUE", paypal: false }).statusWord
          : presentation.statusWord,
      tone,
      progress: replayed ? FAN.sentAt : progressOf(tone),
      width,
      d: curve(FAN.bar.x1, y0, FAN.endX, y1),
      capAt: pointAtLength(FAN.bar.x1, y0, FAN.endX, y1, FAN.sentAt),
      barY: y0,
      stubY,
      index: i,
      eventId: item.live?.eventId ?? null,
      at: item.live?.at ?? null,
      source: item.live?.source ?? null,
      amountState: replayed
        ? "hollow"
        : tone === "landed"
          ? "landed"
          : tone === "unsent"
            ? approved
              ? "ink"
              : "pencil"
            : "hollow",
    };
  });

  // The cash lines leave the bar below the threads, in member order, and end in the same order in one column
  // under the stubs, so none crosses another. A line moved to cash leaves from its own thread's slot and ends on
  // top of the column, the nearest place to the stub it left.
  const railBottom = y;
  const moved = threads.filter((t) => t.tone === "moved");
  const onCash = output.lines
    .filter((l) => l.rail === "CASH" && l.state !== "EXCLUDED")
    .sort((a, b) => a.memberNo.localeCompare(b.memberNo));
  const sources = [
    ...moved.map((t) => ({ memberNo: t.memberNo, cents: t.cents, fromY: t.barY as number | null })),
    ...onCash.map((l) => ({ memberNo: l.memberNo, cents: l.netCents, fromY: null as number | null })),
  ];
  let barY = railBottom;
  let endY = FAN.cash.y0;
  const cashLines: CashLine[] = sources.map((s, index) => {
    const h = k * s.cents;
    let y0 = s.fromY;
    if (y0 === null) {
      y0 = barY + h / 2;
      barY += h;
    }
    const line: CashLine = {
      memberNo: s.memberNo,
      name: names.get(s.memberNo) ?? s.memberNo,
      cents: s.cents,
      d: curve(FAN.bar.x1, y0, FAN.endX, endY + h / 2),
      h,
      stroke: Math.max(1, Math.round(h * FAN.cashStroke * 100) / 100),
      dashOffset: Math.round(((index * GOLDEN) % 1) * DASH_PERIOD * 10_000) / 10_000,
      endY,
      attested: view.lines[s.memberNo]?.state === "OFF_RAIL_PAID",
      moved: s.fromY !== null,
      index,
    };
    endY += h;
    return line;
  });

  const onRail = threads.filter((t) => t.tone !== "moved");
  const paypalCents = onRail.reduce((s, t) => s + t.cents, 0);
  const cashCents = cashLines.reduce((s, c) => s + c.cents, 0);
  const allAttested = cashLines.length > 0 && cashLines.every((c) => c.attested);
  return {
    k,
    netCents,
    threads,
    cashLines,
    paypal: {
      cents: paypalCents,
      members: onRail.length,
      share: netCents > 0 ? format.shareOf(paypalCents, netCents) : "",
    },
    cash: {
      cents: cashCents,
      members: cashLines.length,
      top: FAN.cash.y0,
      bottom: endY,
      amountState: allAttested ? "attested" : approved ? "hollow" : "pencil",
    },
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

/**
 * The fan's one-line count (W-TR-08's share line): what PayPal was sent, what it confirmed, what waits on a person
 * or failed, and how many members are paid in cash. A line moved to cash still counts as sent by PayPal.
 */
export function shareCounts(fan: Pick<FanView, "threads" | "cash">): {
  readonly onRail: number;
  readonly sent: number;
  readonly confirmed: number;
  readonly parked: number;
  readonly failed: number;
  readonly cash: number;
} {
  const tones = fan.threads.map((t) => t.tone);
  return {
    onRail: tones.length,
    sent: tones.filter((t) => t !== "unsent").length,
    confirmed: tones.filter((t) => t === "landed").length,
    parked: tones.filter((t) => t === "parked").length,
    failed: tones.filter((t) => t === "failed").length,
    cash: fan.cash.members,
  };
}
