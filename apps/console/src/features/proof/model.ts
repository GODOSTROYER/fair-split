// Proof's read model (W-PF-01, S1.8): pure functions over the IC-01 Proof bundle, the item statuses the page
// knows (the bundle's, or a judge session's live run) and the line states, so every figure Proof prints is
// computed from served data and never typed. Money is conserved across the paid tiers (I3, tested by name), and
// statuses only climb (I5).

import {
  type HoldKind,
  type LedgerEntry,
  LedgerPayloads,
  type MemberLineState,
  PAYOUT_ITEM_RANK,
  type PayoutItemStatus,
  type ProofBundle,
  type ProofItem,
  type ProofLine,
} from "@fairsplit/contracts";

/** What the public tier puts where a payout receiver was (C-23): never an address, never a mask of one. */
export const WITHHELD_RECEIVER = "withheld";

// ------------------------------------------------------------------------------------------------ progress

/** The batch's items by status group, the shape the API's public Proof stream moves forward. */
export interface ProgressCounts {
  readonly total: number;
  /** SUBMITTED or PENDING: sent, not yet paid. */
  readonly sent: number;
  readonly confirmed: number;
  readonly held: number;
  /** UNCLAIMED: parked for a person's decision, never a failure. */
  readonly parked: number;
  readonly returned: number;
  readonly failed: number;
  readonly reversed: number;
}

export const NO_ITEMS: ProgressCounts = {
  total: 0,
  sent: 0,
  confirmed: 0,
  held: 0,
  parked: 0,
  returned: 0,
  failed: 0,
  reversed: 0,
};

export function countItems(statuses: Iterable<PayoutItemStatus>): ProgressCounts {
  const c = { ...NO_ITEMS };
  for (const s of statuses) {
    c.total++;
    if (s === "SUBMITTED" || s === "PENDING") c.sent++;
    else if (s === "SUCCESS") c.confirmed++;
    else if (s === "ONHOLD") c.held++;
    else if (s === "UNCLAIMED") c.parked++;
    else if (s === "RETURNED") c.returned++;
    else if (s === "FAILED" || s === "BLOCKED") c.failed++;
    else c.reversed++;
  }
  return c;
}

/** Items PayPal has not finished with: sent, held by PayPal, or parked for a person. */
export function inFlight(c: ProgressCounts): number {
  return c.sent + c.held + c.parked;
}

/** Items in a final status. */
export function finalCount(c: ProgressCounts): number {
  return c.confirmed + c.returned + c.failed + c.reversed;
}

export function isSettled(c: ProgressCounts): boolean {
  return c.total > 0 && inFlight(c) === 0;
}

/**
 * Forward-only (I5): a newer picture of the same batch replaces the current one only when nothing in it moved
 * backwards. A replayed or reordered message can never take "4 of 8 confirmed" back to 3.
 */
export function advanceProgress(current: ProgressCounts | null, next: ProgressCounts): ProgressCounts {
  if (!current || current.total === 0) return next;
  if (next.total !== current.total) return next.total > current.total ? next : current;
  if (next.confirmed < current.confirmed || finalCount(next) < finalCount(current)) return current;
  return next;
}

// ------------------------------------------------------------------------------------------------ items

export type ItemSource = "bundle" | "webhook" | "status_check" | "post_response" | "cancel" | "seed";

/** One item's status as a live run knows it (a judge session's own run, over its SSE stream). */
export interface LiveItem {
  readonly status: PayoutItemStatus;
  readonly payoutItemId: string | null;
  readonly eventId: string | null;
  readonly source: ItemSource;
  readonly at: string | null;
}

export interface ProofItemView {
  readonly senderItemId: string;
  readonly memberNo: string | null;
  readonly amountCents: number;
  /** The receiver as served: an address in the full tier, `withheld` in the public tier. */
  readonly receiver: string;
  readonly withheld: boolean;
  readonly status: PayoutItemStatus;
  readonly payoutItemId: string | null;
  readonly eventId: string | null;
  readonly source: ItemSource;
  readonly at: string | null;
}

/** "r37-M-014" (and a re-route's "r37x1-M-031") → "M-014". */
export function memberOfItem(senderItemId: string): string | null {
  return /^r\d+(?:x\d+)?-(M-\d{3})$/.exec(senderItemId)?.[1] ?? null;
}

/** True when the bundle came in the public tier: every receiver withheld (C-23). */
export function receiversWithheld(bundle: Pick<ProofBundle, "batch">): boolean {
  return bundle.batch.items.some((i) => i.receiver === WITHHELD_RECEIVER);
}

function viewOf(item: ProofItem): ProofItemView {
  return {
    senderItemId: item.senderItemId,
    memberNo: memberOfItem(item.senderItemId),
    amountCents: item.amountCents,
    receiver: item.receiver,
    withheld: item.receiver === WITHHELD_RECEIVER,
    status: item.status,
    payoutItemId: item.payoutItemId,
    eventId: item.eventId,
    source: "bundle",
    at: null,
  };
}

/**
 * The bundle's items with what a live run knows laid over them. A live status applies only if it outranks the
 * bundle's (I5), so a stale stream never takes a paid item back to sent.
 */
export function mergeItems(
  items: readonly ProofItem[],
  live: ReadonlyMap<string, LiveItem> = new Map(),
): ProofItemView[] {
  return items.map((item) => {
    const base = viewOf(item);
    const known = live.get(item.senderItemId);
    if (!known || PAYOUT_ITEM_RANK[known.status] <= PAYOUT_ITEM_RANK[item.status]) return base;
    return {
      ...base,
      status: known.status,
      payoutItemId: known.payoutItemId ?? item.payoutItemId,
      eventId: known.eventId,
      source: known.source,
      at: known.at,
    };
  });
}

/**
 * A live run's items as the only truth (a judge session's own run): IDs and amounts from the bundle, statuses
 * from the run. Items the run has not reached stay SUBMITTED, so nothing reads paid before PayPal says so.
 */
export function liveItems(items: readonly ProofItem[], live: ReadonlyMap<string, LiveItem>): ProofItemView[] {
  return items.map((item) => {
    const known = live.get(item.senderItemId);
    return {
      ...viewOf(item),
      status: known?.status ?? "SUBMITTED",
      payoutItemId: known?.payoutItemId ?? null,
      eventId: known?.eventId ?? null,
      source: known?.source ?? "bundle",
      at: known?.at ?? null,
    };
  });
}

// ------------------------------------------------------------------------------------------------ lines and tiers

export type LineStates = Readonly<Record<string, MemberLineState | undefined>>;

/** Lines that are reserved, carried over, never redistributed (the server's rule). */
const RESERVED_STATES: readonly MemberLineState[] = ["HELD", "EXCLUDED", "COMPUTED", "READY"];

/** Cash at the bodega: the line was always cash, or its PayPal item came back and moved to cash. */
const CASH_STATES: readonly MemberLineState[] = ["OFF_RAIL_DUE", "OFF_RAIL_PAID"];

export interface Tier {
  readonly members: number;
  readonly cents: number;
}

export interface PaidTiers {
  /** SUCCESS resting on a PayPal event (a verified notice, or a fresh status check). */
  readonly paypal: Tier;
  /** Cash handed over and attested by the clerk (a receipt on file), out of every cash line. */
  readonly attested: Tier & { readonly ofMembers: number };
  /** Payable, not yet in a member's hands: cash due at the bodega, or a PayPal item still on its way. */
  readonly due: Tier & { readonly cash: Tier; readonly paypal: Tier };
  /** Held or excluded: reserved for that member, carried over, never redistributed. */
  readonly reserved: Tier;
  /** Σ net of every line: the tiers add up to exactly this (I3). */
  readonly netCents: number;
}

/** Where each member's line stands for Proof: exactly one tier. */
export type LineTier = "paypal" | "attested" | "due-cash" | "due-paypal" | "reserved";

/** Members PayPal confirmed: a SUCCESS that rests on an event (a notice, or a fresh status check). */
export function paidMembers(items: readonly ProofItemView[]): ReadonlySet<string> {
  const paid = new Set<string>();
  for (const i of items) {
    if (i.status !== "SUCCESS" || i.memberNo === null) continue;
    if (i.eventId !== null || i.source === "status_check") paid.add(i.memberNo);
  }
  return paid;
}

/** The bundle's items by member (a re-route keeps the newest item for its member). */
export function itemsByMember(items: readonly ProofItemView[]): ReadonlyMap<string, ProofItemView> {
  const map = new Map<string, ProofItemView>();
  for (const item of items) if (item.memberNo) map.set(item.memberNo, item);
  return map;
}

/** The line state Proof shows for a member: the run's own, else what its item implies, else its rail's start. */
export function lineStateOf(
  line: Pick<ProofLine, "memberNo" | "rail">,
  item: ProofItemView | undefined,
  states: LineStates,
): MemberLineState {
  const known = states[line.memberNo];
  if (known) return known;
  if (!item) return line.rail === "CASH" ? "OFF_RAIL_DUE" : "SUBMITTED";
  switch (item.status) {
    case "SUCCESS":
      return item.eventId !== null || item.source === "status_check" ? "PAID" : "PAYPAL_PENDING";
    case "UNCLAIMED":
      return "UNCLAIMED";
    case "RETURNED":
      return "OFF_RAIL_DUE";
    case "ONHOLD":
      return "PAYPAL_HELD";
    case "FAILED":
    case "BLOCKED":
      return "NEEDS_ACTION";
    case "REFUNDED":
    case "REVERSED":
      return "REVERSED";
    default:
      return "PAYPAL_PENDING";
  }
}

export function lineTier(
  line: Pick<ProofLine, "memberNo" | "rail">,
  item: ProofItemView | undefined,
  paid: ReadonlySet<string>,
  states: LineStates,
): LineTier {
  const state = lineStateOf(line, item, states);
  if (state === "OFF_RAIL_PAID") return "attested";
  if (paid.has(line.memberNo) || state === "PAID") return "paypal";
  if (RESERVED_STATES.includes(state)) return "reserved";
  if (CASH_STATES.includes(state) || line.rail === "CASH") return "due-cash";
  return "due-paypal";
}

/** Partitions every line into exactly one tier, by its net (I3: the tiers sum to Σ net). */
export function paidTiers(
  lines: readonly Pick<ProofLine, "memberNo" | "netCents" | "rail">[],
  items: readonly ProofItemView[],
  states: LineStates,
): PaidTiers {
  const paid = paidMembers(items);
  const byMember = itemsByMember(items);
  const acc: Record<LineTier, { members: number; cents: number }> = {
    paypal: { members: 0, cents: 0 },
    attested: { members: 0, cents: 0 },
    "due-cash": { members: 0, cents: 0 },
    "due-paypal": { members: 0, cents: 0 },
    reserved: { members: 0, cents: 0 },
  };
  let net = 0;
  for (const line of lines) {
    const tier = acc[lineTier(line, byMember.get(line.memberNo), paid, states)];
    tier.members++;
    tier.cents += line.netCents;
    net += line.netCents;
  }
  const cash = acc["due-cash"];
  const onTheirWay = acc["due-paypal"];
  return {
    paypal: acc.paypal,
    attested: { ...acc.attested, ofMembers: acc.attested.members + cash.members },
    due: {
      members: cash.members + onTheirWay.members,
      cents: cash.cents + onTheirWay.cents,
      cash,
      paypal: onTheirWay,
    },
    reserved: acc.reserved,
    netCents: net,
  };
}

export type AmountState = "pencil" | "you" | "ink" | "hollow" | "landed" | "attested";

/** S2.2.1's grammar for a line's net on Proof (the run is approved, so nothing here is pencil but a hold). */
export function amountStateOf(state: MemberLineState): AmountState {
  switch (state) {
    case "PAID":
      return "landed";
    case "OFF_RAIL_PAID":
      return "attested";
    case "HELD":
    case "EXCLUDED":
    case "COMPUTED":
    case "READY":
      return "pencil";
    case "LOCKED":
      return "ink";
    default:
      return "hollow";
  }
}

// ------------------------------------------------------------------------------------------------ figures

export interface PremiumAllocation {
  readonly poolCents: number;
  readonly allocatedCents: number;
  /** Basis points of the pool allocated to members (10000 = 100%). */
  readonly allocatedBp: number;
  /** R0: premium is never deducted, so this is always 0 for a bundle that verifies. */
  readonly deductedFromPremiumCents: number;
}

export function premiumAllocation(bundle: Pick<ProofBundle, "pools" | "lines">): PremiumAllocation {
  const pool = bundle.pools.premiumPoolCents;
  const allocated = bundle.lines.reduce((s, l) => s + l.premiumCents, 0);
  // Deductions apply to the bonus (R1, R3, R4); a line whose deductions exceed its bonus would reach premium.
  const intoPremium = bundle.lines.reduce((s, l) => s + Math.max(0, l.deductionsCents - l.bonusCents), 0);
  return {
    poolCents: pool,
    allocatedCents: allocated,
    allocatedBp: pool > 0 ? Math.round((allocated * 10_000) / pool) : 0,
    deductedFromPremiumCents: intoPremium,
  };
}

/** A line is explained when it carries its hash and the slips it comes from. */
export function explainedLines(lines: readonly ProofLine[]): number {
  return lines.filter((l) => /^[0-9a-f]{64}$/.test(l.lineSha256) && l.canonical.slipSerials.length > 0)
    .length;
}

/** Holds that caught a problem in the paper (the by-hand field and the dial are checks, not catches). */
export const CAUGHT_KINDS: readonly HoldKind[] = [
  "DUPLICATE_SLIP",
  "IMPLAUSIBLE_YIELD",
  "NO_RULE",
  "RATE_MISMATCH",
  "SUSPECTED_INJECTION",
];

export function holdsCaught(holds: readonly { readonly kind: HoldKind }[]): number {
  return holds.filter((h) => CAUGHT_KINDS.includes(h.kind)).length;
}

export interface RailSplit {
  /** Lines paid through PayPal: confirmed, or still on their way (a returned item has moved to cash). */
  readonly paypalMembers: number;
  readonly paypalCents: number;
  /** Lines paid in cash at the bodega, due or attested. */
  readonly cashMembers: number;
  readonly cashCents: number;
  /** PayPal's share of the value paid out, in basis points of Σ net. */
  readonly paypalValueBp: number;
}

/**
 * PayPal against cash, by where each line is being paid: 8 of 64 (8.7% of value) while the batch is out, 7 of 64
 * (8.1%) once Rhea's unclaimed item moves to cash. The split fan's label reads the same (S2.7).
 */
export function railSplit(tiers: PaidTiers): RailSplit {
  const paypalMembers = tiers.paypal.members + tiers.due.paypal.members;
  const paypalCents = tiers.paypal.cents + tiers.due.paypal.cents;
  return {
    paypalMembers,
    paypalCents,
    cashMembers: tiers.attested.members + tiers.due.cash.members,
    cashCents: tiers.attested.cents + tiers.due.cash.cents,
    paypalValueBp: tiers.netCents > 0 ? Math.round((paypalCents * 10_000) / tiers.netCents) : 0,
  };
}

// ------------------------------------------------------------------------------------------------ the ledger

export interface KeyRegistration {
  readonly keyId: string;
  readonly persona: string;
  readonly kind: string;
  readonly seq: number;
  readonly at: string;
}

export interface LedgerFacts {
  readonly entries: number;
  readonly fundedAt: string | null;
  readonly ratifiedAt: string | null;
  /** `rows.accepted` entries: one per slip photo. */
  readonly photosAccepted: number;
  /** Slips across those photos. */
  readonly slipsAccepted: number;
  readonly keys: readonly KeyRegistration[];
  readonly computed: {
    readonly balanced: boolean;
    readonly lineCount: number;
    readonly netCents: number;
    readonly onRailNetCents: number;
    readonly linesRootSha256: string;
  } | null;
  readonly submitting: {
    readonly at: string;
    readonly itemCount: number;
    readonly totalCents: number;
  } | null;
  /** The last verified item notice the chain records. */
  readonly lastItemEventAt: string | null;
  readonly itemEvents: number;
  readonly cancels: number;
}

/** What the hash chain itself records, read through the contract's payload shapes (others attest nothing). */
export function ledgerFacts(ledger: readonly LedgerEntry[]): LedgerFacts {
  let fundedAt: string | null = null;
  let ratifiedAt: string | null = null;
  let photos = 0;
  let slips = 0;
  const keys: KeyRegistration[] = [];
  let computed: LedgerFacts["computed"] = null;
  let submitting: LedgerFacts["submitting"] = null;
  let lastItemEventAt: string | null = null;
  let itemEvents = 0;
  let cancels = 0;
  for (const e of ledger) {
    switch (e.kind) {
      case "invoice.funded":
        if (LedgerPayloads["invoice.funded"].safeParse(e.payload).success) fundedAt = e.at;
        break;
      case "rate_card.ratified": {
        const p = LedgerPayloads["rate_card.ratified"].safeParse(e.payload);
        if (p.success) ratifiedAt = p.data.ratifiedAt;
        break;
      }
      case "rows.accepted": {
        const p = LedgerPayloads["rows.accepted"].safeParse(e.payload);
        if (p.success) {
          photos++;
          slips += p.data.serials.length;
        }
        break;
      }
      case "key.registered": {
        const p = LedgerPayloads["key.registered"].safeParse(e.payload);
        if (p.success) {
          keys.push({
            keyId: p.data.keyId,
            persona: p.data.persona,
            kind: p.data.kind,
            seq: e.seq,
            at: e.at,
          });
        }
        break;
      }
      case "lines.computed": {
        const p = LedgerPayloads["lines.computed"].safeParse(e.payload);
        if (p.success) {
          computed = {
            balanced: p.data.balanced,
            lineCount: p.data.lineCount,
            netCents: p.data.netCents,
            onRailNetCents: p.data.onRailNetCents,
            linesRootSha256: p.data.linesRootSha256,
          };
        }
        break;
      }
      case "payout.submitting": {
        const p = LedgerPayloads["payout.submitting"].safeParse(e.payload);
        if (p.success) submitting = { at: e.at, itemCount: p.data.itemCount, totalCents: p.data.totalCents };
        break;
      }
      case "payout.cancel":
        if (LedgerPayloads["payout.cancel"].safeParse(e.payload).success) cancels++;
        break;
      case "webhook.applied": {
        const p = LedgerPayloads["webhook.applied"].safeParse(e.payload);
        if (p.success && p.data.resource === "payout_item") {
          itemEvents++;
          if (lastItemEventAt === null || Date.parse(e.at) > Date.parse(lastItemEventAt))
            lastItemEventAt = e.at;
        }
        break;
      }
    }
  }
  return {
    entries: ledger.length,
    fundedAt,
    ratifiedAt,
    photosAccepted: photos,
    slipsAccepted: slips,
    keys,
    computed,
    submitting,
    lastItemEventAt,
    itemEvents,
    cancels,
  };
}

/** Invoice funded to the last verified item notice, from the chain's own timestamps (null until both exist). */
export function invoiceToLastConfirmationMs(
  facts: Pick<LedgerFacts, "fundedAt" | "lastItemEventAt">,
): number | null {
  if (!facts.fundedAt || !facts.lastItemEventAt) return null;
  const ms = Date.parse(facts.lastItemEventAt) - Date.parse(facts.fundedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

// ------------------------------------------------------------------------------------------------ the plot field

export interface PlotDot {
  readonly memberNo: string;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly grams: number;
}

/** FNV-1a, for an abstract, stable layout (not a security hash). */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Abstract dots, one per member, sized by verified kilos (area ∝ kilos) and placed by a hash-seeded jitter inside
 * a grid of cells, so none overlap. There is no basemap and no coordinate: positions mean nothing (C-23).
 */
export function plotField(
  lines: readonly Pick<ProofLine, "memberNo" | "canonical">[],
  width: number,
  height: number,
): PlotDot[] {
  if (lines.length === 0) return [];
  const cols = Math.ceil(Math.sqrt((lines.length * width) / height));
  const rows = Math.ceil(lines.length / cols);
  const cellW = width / cols;
  const cellH = height / rows;
  const maxGrams = Math.max(1, ...lines.map((l) => l.canonical.verifiedG));
  const rMax = Math.min(cellW, cellH) * 0.42;
  const sorted = [...lines].sort((a, b) => fnv1a(a.memberNo) - fnv1a(b.memberNo));
  return sorted.map((l, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const h = fnv1a(`${l.memberNo}:plot`);
    const r = Math.max(2, rMax * Math.sqrt(l.canonical.verifiedG / maxGrams));
    const slackX = Math.max(0, cellW / 2 - r);
    const slackY = Math.max(0, cellH / 2 - r);
    const jx = (((h & 0xffff) / 0xffff) * 2 - 1) * slackX;
    const jy = ((((h >>> 16) & 0xffff) / 0xffff) * 2 - 1) * slackY;
    return {
      memberNo: l.memberNo,
      x: Math.round((col * cellW + cellW / 2 + jx) * 10) / 10,
      y: Math.round((row * cellH + cellH / 2 + jy) * 10) / 10,
      r: Math.round(r * 10) / 10,
      grams: l.canonical.verifiedG,
    };
  });
}
