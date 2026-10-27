/**
 * What the statement shows for a line, as data (pure, tested in Node): the capsule's status word and tone, whether an
 * amount exists yet, its amount-grammar state, the hero figures (US$ or exact cash pesos), the line under the amount,
 * the one sentence that explains the state, and the history in the member's words. Screens render this and decide
 * nothing about money or status themselves.
 */
import type { StatementDTO, StatementHistoryEntry } from "../../_shims/api-client";
import { type AmountState, type Lang, MEMBER_STATUS_WORDS, type MemberStatus } from "../../_shims/contracts";
import { format } from "../../_shims/domain";
import type { MessageArgs } from "../../_shims/i18n";
import { type HeroFigures, heroFigures, type PayKind, payKindOf } from "../../lib/figures";
import {
  CAPSULE_WORD,
  type CapsuleState,
  type ItemTrack,
  STATUS_TONE,
  type StatusTone,
} from "../../lib/item-status";
import { amountStateFor, lineApproved } from "../../lib/statement";
import type { StatementKey } from "./messages";

/** A message key with its arguments; the screen translates it in the member's language. */
export interface Copy {
  key: StatementKey;
  args?: MessageArgs;
}

export interface LineView {
  capsule: CapsuleState;
  status: MemberStatus;
  tone: StatusTone;
  /** The register's status word, dated where the date is known: "Bayad na, 30 Okt". */
  word: string;
  /** Checking and held lines have no amount yet (S1.9): the kilos, slips and expected date stand in. */
  showAmount: boolean;
  amountState: AmountState;
  payKind: PayKind;
  hero: HeroFigures;
  /** Under the amount: the PayPal peso estimate, or where and when the cash is and what it comes from. */
  under: { text: string } | Copy | null;
  /** The one sentence that says what is happening and who acts next. */
  detail: Copy | null;
  /** When the item went to PayPal (the capsule's elapsed clock starts here). */
  sentAt: string | null;
  paidAt: string | null;
}

function historyAt(dto: StatementDTO, kind: StatementHistoryEntry["kind"]): string | null {
  return dto.history.filter((h) => h.kind === kind).at(-1)?.at ?? null;
}

/** When PayPal confirmed it: the applied event's time, else the history's. */
export function paidAtOf(dto: StatementDTO, track: ItemTrack): string | null {
  const recorded = historyAt(dto, "paid");
  if (track.status === "SUCCESS") return track.updatedAt ?? recorded;
  return recorded;
}

export function lineView(dto: StatementDTO, capsule: CapsuleState, track: ItemTrack, lang: Lang): LineView {
  const status = CAPSULE_WORD[capsule];
  const word = MEMBER_STATUS_WORDS[status][lang];
  const payKind = payKindOf(dto, capsule);
  const hero = heroFigures(dto, lang, payKind);
  const name = dto.treasurer.first;
  const paidAt = paidAtOf(dto, track);
  const receivedAt = historyAt(dto, "received");
  const day = (iso: string | null) => (iso ? format.dayMonth(iso, lang) : null);

  const dated: Partial<Record<CapsuleState, string | null>> = {
    paid: day(paidAt),
    "cash-due": day(dto.cashDay),
    "cash-received": day(receivedAt ?? dto.cashDay),
  };
  const date = dated[capsule] ?? null;
  const showAmount = capsule !== "checking" && capsule !== "held-line";

  let under: LineView["under"] = null;
  if (showAmount) {
    if (payKind === "cash") {
      const args = { usd: hero.usd, rate: hero.rate, date: date ?? "" };
      under = !date
        ? { key: "M-MB-01.cashUndated", args }
        : { key: capsule === "cash-received" ? "M-MB-01.cashReceived" : "M-MB-01.cashDue", args };
    } else if (hero.estimate) {
      under = { text: hero.estimate };
    }
  }

  const detail = ((): Copy | null => {
    switch (capsule) {
      case "checking":
        return { key: "M-MB-01.checking" };
      case "held-line":
        return dto.expectedDate
          ? { key: "M-MB-01.heldDated", args: { name, date: format.date(dto.expectedDate, lang) } }
          : { key: "M-MB-01.held", args: { name } };
      case "sent":
        return { key: "M-MB-01.sent" };
      case "paid":
        return paidAt
          ? { key: "M-MB-01.paid", args: { date: format.date(paidAt, lang), time: format.time(paidAt) } }
          : null;
      case "cash-due":
        return dto.history.some((h) => h.kind === "unclaimed")
          ? { key: "M-MB-01.cashMoved", args: { name } }
          : null;
      case "cash-received":
        return null;
      case "unclaimed":
        return { key: "M-MB-01.unclaimed", args: { name } };
      case "returned":
        return { key: "M-MB-01.returned", args: { name } };
      case "paypal-held":
        return { key: "M-MB-01.paypalHeld", args: { name } };
      case "needs-action":
        return { key: "M-MB-01.needsAction", args: { name } };
      case "reversed":
        return { key: "M-MB-01.reversed", args: { name } };
      case "excluded":
        return { key: "M-MB-01.excluded" };
    }
  })();

  return {
    capsule,
    status,
    tone: STATUS_TONE[status],
    word: date ? `${word}, ${date}` : word,
    showAmount,
    amountState: amountStateFor(capsule, lineApproved(dto)),
    payKind,
    hero,
    under,
    detail,
    sentAt: historyAt(dto, "sent"),
    paidAt,
  };
}

/* ------------------------------------------------------------------ history */

export type HistoryMark = "stamps" | "jade" | "canary" | "hatch" | "pencil";

export interface HistoryRow {
  kind: StatementHistoryEntry["kind"];
  at: string;
  /** Initials stamped in ink beside a person's decision. */
  by: readonly string[];
  copy: Copy;
  /** How the row is marked: initials for people, jade only for PayPal's confirmation, hatch for cash. */
  mark: HistoryMark;
}

const HISTORY_KEY: Readonly<Record<StatementHistoryEntry["kind"], StatementKey>> = {
  approved: "M-MB-01.historyApproved",
  sent: "M-MB-01.historySent",
  paid: "M-MB-01.historyPaid",
  unclaimed: "M-MB-01.historyUnclaimed",
  "cash-due": "M-MB-01.historyCashDue",
  received: "M-MB-01.historyReceived",
  held: "M-MB-01.historyHeld",
};

const HISTORY_MARK: Readonly<Record<StatementHistoryEntry["kind"], HistoryMark>> = {
  approved: "stamps",
  sent: "pencil",
  paid: "jade",
  unclaimed: "canary",
  "cash-due": "hatch",
  received: "stamps",
  held: "canary",
};

/**
 * The order a line's history happens in. Statuses only move forward (I5), so this is also the causal order; a
 * clock that disagrees (two servers, a replayed event) never reorders the story.
 */
const HISTORY_ORDER: Readonly<Record<StatementHistoryEntry["kind"], number>> = {
  held: 0,
  approved: 1,
  sent: 2,
  unclaimed: 3,
  paid: 4,
  "cash-due": 5,
  received: 6,
};

/**
 * Her line's history in the order it happened, in her words. A PayPal confirmation that arrived by event before the
 * server's history caught up is shown too, at the event's time.
 */
export function historyRows(dto: StatementDTO, track: ItemTrack): HistoryRow[] {
  const entries: StatementHistoryEntry[] = [...dto.history];
  if (track.status === "SUCCESS" && track.updatedAt && !entries.some((h) => h.kind === "paid")) {
    entries.push({ kind: "paid", at: track.updatedAt });
  }
  const time = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? 0 : t;
  };
  return entries
    .map((h, i) => ({ h, i }))
    .sort(
      (a, b) => HISTORY_ORDER[a.h.kind] - HISTORY_ORDER[b.h.kind] || time(a.h.at) - time(b.h.at) || a.i - b.i,
    )
    .map(({ h }) => ({
      kind: h.kind,
      at: h.at,
      by: h.by ?? [],
      copy:
        h.kind === "approved"
          ? { key: HISTORY_KEY.approved, args: { a: h.by?.[0] ?? "", b: h.by?.[1] ?? "" } }
          : { key: HISTORY_KEY[h.kind] },
      mark:
        h.kind === "approved" || (h.kind === "received" && h.by?.length) ? "stamps" : HISTORY_MARK[h.kind],
    }));
}

/** The two officers whose keys closed the seal, from the approval in her history. */
export function sealSigners(dto: StatementDTO): readonly [string, string] | null {
  const by = dto.history.find((h) => h.kind === "approved")?.by;
  return by && by.length >= 2 && by[0] && by[1] ? [by[0], by[1]] : null;
}
