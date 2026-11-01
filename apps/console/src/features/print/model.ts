// W-TR-09's model: one member's line as the treasurer reads it and as the 80 mm statement prints it. Every amount
// is the engine's (the split model's row on the computation the run's decisions match); the only arithmetic is
// presentation: the peso estimate for a PayPal line (floored at the run's rate, always labelled an estimate),
// exact pesos for a cash line (half-up to the centavo at the run's recorded rate, S1.11), and a GSM-7 count.

import type {
  Lang,
  MemberLineState,
  RunEvent,
  SeasonSnapshot,
  SnapshotMember,
  SnapshotSlip,
} from "@fairsplit/contracts";
import { translate } from "@fairsplit/i18n";
import type { MoneyView, StatementLineView } from "@fairsplit/ui-web";
import { atLeast, type RunView } from "../../data/run-view.js";
import { format } from "../../lib/format.js";
import { type SplitRow, splitRows } from "../split/model.js";
import { LINE } from "../split/shared/copy.js";

export type LineScreenState =
  | "held"
  | "ready"
  | "paid"
  | "cash-due"
  | "cash-received"
  | "parked"
  | "request-open";

const IN_FLIGHT: readonly MemberLineState[] = ["LOCKED", "SUBMITTED", "PAYPAL_PENDING", "REROUTED"];
const PARKED: readonly MemberLineState[] = ["UNCLAIMED", "PAYPAL_HELD", "NEEDS_ACTION"];

export function isCashLine(row: SplitRow): boolean {
  return row.rail === "CASH" || row.movedToCash;
}

/** S1.7's W-TR-09 states for a line. A cash line is due at the bodega once the batch is approved. */
export function lineScreenState(view: RunView, row: SplitRow): LineScreenState {
  if (row.status.kind !== "line") return "held";
  const s = row.state;
  if (s === "PAID") return "paid";
  if (s === "OFF_RAIL_PAID") return "cash-received";
  if (s === "OFF_RAIL_DUE" || s === "RETURNED") return "cash-due";
  if (PARKED.includes(s)) return "parked";
  if (s === "HELD") return "held";
  if (row.rail === "CASH" && atLeast(view, "APPROVED")) return "cash-due";
  if (IN_FLIGHT.includes(s)) return "ready";
  return "ready";
}

export function findRow(snapshot: SeasonSnapshot, view: RunView, memberNo: string): SplitRow | undefined {
  return splitRows(snapshot, view).find((r) => r.memberNo === memberNo);
}

const money = (cents: number): MoneyView => ({
  display: format.money(cents),
  spoken: format.amountSpoken(cents, "en"),
});

/** Exact pesos for cash at the run's recorded rate, half-up to the centavo: US$127.84 → ₱7,990.00. */
export function cashCentavos(cents: number, fx: { readonly num: number; readonly den: number }): number {
  const sign = cents < 0 ? -1 : 1;
  const abs = Math.abs(cents);
  return sign * Math.floor((abs * fx.num * 2 + fx.den) / (2 * fx.den));
}

/** "₱62.50": the run's rate per dollar, from its centavos-per-cent ratio. */
export function rateDisplay(fx: { readonly num: number; readonly den: number }): string {
  const centavosPerDollar = (fx.num * 100) / fx.den;
  return Number.isInteger(centavosPerDollar) ? format.money(centavosPerDollar, "PHP") : "";
}

/** "₱4,028": a PayPal line's whole-peso estimate (floored by the domain's rule), without its label. */
export function pesoWholeEstimate(cents: number, fx: { readonly num: number; readonly den: number }): string {
  return format.pesoWhole(format.pesoValueOf(cents, fx) * 100);
}

/** The ReceiptBar's line (console audience: kilos × the pool's per-kg rate, R0). */
export function receiptLine(snapshot: SeasonSnapshot, row: SplitRow): StatementLineView {
  const card = snapshot.rateCard.canonical.resolutionNo;
  const rate = (snapshot.figures.display.premiumRate ?? "").replace(/ a kg$/, "");
  const credits =
    row.creditsCents > 0 ? [{ id: "credit", name: LINE.creditName, amount: money(row.creditsCents) }] : [];
  return {
    memberNo: row.memberNo,
    kg: format.kg(row.verifiedG),
    rate,
    premiumRule: "R0",
    premium: money(row.premiumCents),
    bonus: money(row.bonusCents),
    deductions: row.deductions.map((d) => ({
      id: `${d.ruleId}-${d.category}`,
      name: d.category === "CBU" ? "CBU" : d.category === "LOAN" ? "Loan" : "Advance",
      rule: d.ruleId,
      card,
      amount: money(-d.amountCents),
    })),
    credits,
    net: money(row.netCents),
    ...(isCashLine(row) ? {} : { netPhp: pesoWholeEstimate(row.netCents, snapshot.fx.centavosPerCent) }),
  };
}

export interface LineSlip {
  readonly serial: string;
  readonly photoId: string;
  readonly kg: string;
  /** Photos A–L are the replay set (drawn here); P01–P54 were read earlier and show as archived tiles (OD-4). */
  readonly archived: boolean;
  readonly slip: SnapshotSlip;
}

export function lineSlips(snapshot: SeasonSnapshot, row: SplitRow): LineSlip[] {
  return row.slips
    .map((s) =>
      snapshot.slips.find((x) => x.serial === s.serial && x.copy === s.copy && x.memberNo === row.memberNo),
    )
    .filter((s): s is SnapshotSlip => s !== undefined)
    .map((slip) => ({
      serial: slip.serial,
      photoId: slip.photoId,
      kg: format.kg(slip.netG, 2),
      archived: !slip.replaySet,
      slip,
    }));
}

export interface HistoryRow {
  readonly id: string;
  readonly words: string;
  readonly detail: string | null;
  readonly at: string | null;
}

/** The line's own history: approvals, its holds, its PayPal item and its line states, oldest first. */
export function lineHistory(snapshot: SeasonSnapshot, view: RunView, memberNo: string): HistoryRow[] {
  const name = (who: string) =>
    snapshot.officers.find((o) => o.persona === who || o.initials === who)?.shortName ?? who;
  if (view.events.length === 0 && view.origin === "showcase") {
    const rows: HistoryRow[] = [];
    if (snapshot.run.approvals.length > 0)
      rows.push({ id: "seed-approved", words: LINE.approvedBy("AS", "EC"), detail: LINE.seeded, at: null });
    const item = snapshot.run.items.find((i) => i.memberNo === memberNo);
    const state = snapshot.run.lineStates[memberNo];
    if (item)
      rows.push({
        id: "seed-sent",
        words: translate("en", "console.status.SUBMITTED"),
        detail: LINE.seeded,
        at: null,
      });
    if (state)
      rows.push({
        id: "seed-state",
        words: translate("en", `console.status.${state}`),
        detail: LINE.seeded,
        at: null,
      });
    return rows;
  }
  const rows: HistoryRow[] = [];
  const holdsOfMember = new Set(
    Object.values(view.holds)
      .filter((h) => h.memberNo === memberNo)
      .map((h) => h.holdId),
  );
  for (const e of view.events) {
    const row = historyRow(e, memberNo, holdsOfMember, name);
    if (row) rows.push(row);
  }
  return rows;
}

function historyRow(
  e: RunEvent,
  memberNo: string,
  holds: ReadonlySet<string>,
  name: (who: string) => string,
): HistoryRow | null {
  switch (e.type) {
    case "line.state":
      if (e.payload.memberNo !== memberNo) return null;
      return { id: e.id, words: translate("en", `console.status.${e.payload.to}`), detail: null, at: e.at };
    case "item.updated":
      if (e.payload.memberNo !== memberNo) return null;
      return {
        id: e.id,
        words: translate("en", `console.status.${statusLine(e.payload.to)}`),
        detail:
          e.payload.source === "webhook"
            ? LINE.paypalNotice
            : e.payload.source === "cancel"
              ? LINE.ourCancel
              : null,
        at: e.at,
      };
    case "hold.raised":
      if (e.payload.memberNo !== memberNo) return null;
      return { id: e.id, words: LINE.holdRaised(e.payload.label), detail: null, at: e.at };
    case "hold.resolved":
      if (!holds.has(e.payload.holdId)) return null;
      return {
        id: e.id,
        words: LINE.holdResolved(e.payload.label, name(e.payload.resolvedBy)),
        detail: null,
        at: e.at,
      };
    case "approval.signed":
      return {
        id: e.id,
        words: LINE.signedBy(name(e.payload.role === "treasurer" ? "treasurer:analyn" : "board:ernesto")),
        detail: null,
        at: e.at,
      };
    default:
      return null;
  }
}

function statusLine(to: string): MemberLineState {
  switch (to) {
    case "SUCCESS":
      return "PAID";
    case "UNCLAIMED":
      return "UNCLAIMED";
    case "RETURNED":
      return "RETURNED";
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

// ------------------------------------------------------------------------------------------ SMS preview (GSM-7)

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED = "^{}\\[~]|€\f";

/** GSM-7 septets for a text, or null when a character needs UCS-2 (the preview then says so). */
export function gsm7Length(text: string): number | null {
  let n = 0;
  for (const ch of text) {
    if (GSM7_BASIC.includes(ch)) n += 1;
    else if (GSM7_EXTENDED.includes(ch)) n += 2;
    else return null;
  }
  return n;
}

export function smsSegments(septets: number): number {
  return septets <= 160 ? 1 : Math.ceil(septets / 153);
}

const SMS_STATUS: Readonly<Record<LineScreenState, MemberLineState>> = {
  held: "HELD",
  ready: "READY",
  paid: "PAID",
  "cash-due": "OFF_RAIL_DUE",
  "cash-received": "OFF_RAIL_PAID",
  parked: "UNCLAIMED",
  "request-open": "HELD",
};

/**
 * The SMS a member would get (S1.11: GSM-7, the peso written "P" because ₱ is not in GSM-7). Words come from the
 * catalog's status labels in the member's language; the frame around them is the preview's own.
 */
export function smsText(
  snapshot: SeasonSnapshot,
  member: SnapshotMember,
  row: SplitRow,
  state: LineScreenState,
  lang: Lang,
): string {
  const fx = snapshot.fx.centavosPerCent;
  const status = translate(lang, `status.${SMS_STATUS[state]}`);
  const cash = isCashLine(row);
  const amount = cash
    ? format.money(cashCentavos(row.netCents, fx), "PHP")
    : `${format.money(row.netCents)} (${format.pesoEstimate(row.netCents, fx, lang)})`;
  const slips = row.slips.map((s) => s.serial).join(",");
  const treasurer = snapshot.officers.find((o) => o.role === "TREASURER")?.shortName ?? "";
  const name = member.addressAs[lang];
  const text = LINE.sms[lang]({
    coop: snapshot.coop.shortName,
    name,
    status,
    amount,
    rail: cash ? "cash" : "paypal",
    slips,
    treasurer,
  });
  return text.replaceAll("₱", "P");
}
