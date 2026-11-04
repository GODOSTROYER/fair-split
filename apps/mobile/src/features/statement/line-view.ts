/**
 * What the statement shows for a line, as data (pure, tested in Node): the capsule's status word and tone, whether an
 * amount exists yet, its amount-grammar state, the hero figures (US$ or exact cash pesos), the line under the amount,
 * the one sentence that explains the state, and the history in the member's words. Screens render this and decide
 * nothing about money or status themselves.
 *
 * The phone re-adds every line it shows (I3, `lineConservation`): a line whose receipt does not add up to its net is
 * never presented as settled. Its amount stays hollow whatever PayPal or the clerk says, MM-1 does not fill it, and
 * the sentence under it says the figures are still being checked and who checks them.
 */
import type { CosignRequestDTO, StatementDTO, StatementHistoryEntry } from "../../_shims/api-client";
import {
  type AmountState,
  amountStateOf,
  type Lang,
  MEMBER_STATUS_WORDS,
  type MemberStatus,
} from "../../_shims/contracts";
import { format } from "../../_shims/domain";
import type { MessageArgs } from "../../_shims/i18n";
import type { MomentPhase } from "../../_shims/moments";
import { type HeroFigures, heroFigures, lineConservation, type PayKind, payKindOf } from "../../lib/figures";
import {
  CAPSULE_WORD,
  type CapsuleState,
  type ItemTrack,
  STATUS_TONE,
  type StatusTone,
} from "../../lib/item-status";
import { amountStateFor, lineApproved } from "../../lib/statement";
import { statementRail } from "./live";
import { type StatementKey, t } from "./messages";

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
  /**
   * The words on the plate before PayPal's press, "Gipadala na, naghulat sa PayPal": MM-1 keeps them until the label
   * crossfades at 400 ms. Null for every capsule MM-1 never presses.
   */
  sentWord: string | null;
  /** Checking and held lines have no amount yet (S1.9): the kilos, slips and expected date stand in. */
  showAmount: boolean;
  /** The receipt adds up to the net on this phone, to the cent (I3). False keeps the amount hollow. */
  conserved: boolean;
  /** MM-1 may fill the hero amount: the item is with PayPal or paid, and the line adds up. */
  fillsOnPress: boolean;
  amountState: AmountState;
  payKind: PayKind;
  hero: HeroFigures | null;
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
  // A fresh withholding decision outranks an item event retained from the earlier read.
  if (!dto.amounts) {
    if (dto.lineState === "HELD") capsule = "held-line";
    else if (dto.lineState === "EXCLUDED") capsule = "excluded";
    else if (dto.lineState === "READY" || dto.lineState === "COMPUTED") capsule = "checking";
  }
  const status = CAPSULE_WORD[capsule];
  const word = MEMBER_STATUS_WORDS[status][lang];
  const payKind = payKindOf(dto, capsule);
  const replayed = payKind === "paypal" && statementRail(dto, lang, track).kind === "replay";
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
  const showAmount = !!hero && capsule !== "checking" && capsule !== "held-line";
  const conserved = lineConservation(dto)?.ok ?? false;
  const inFlight = capsule === "sent" || capsule === "paid";

  let under: LineView["under"] = null;
  if (showAmount && hero) {
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
    // A receipt that does not add up outranks every other sentence: she is told it is being checked, and by whom.
    if (showAmount && !conserved) return { key: "M-MB-01.unbalanced", args: { name } };
    if (replayed) return { key: "M-MB-01.replayed" };
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

  const state = amountStateFor(capsule, lineApproved(dto));
  return {
    capsule,
    status,
    tone: replayed ? "neutral" : STATUS_TONE[status],
    word: replayed
      ? t(lang, "M-MB-01.replayStatus", { status: date ? `${word}, ${date}` : word })
      : date
        ? `${word}, ${date}`
        : word,
    sentWord: inFlight && !replayed ? MEMBER_STATUS_WORDS[CAPSULE_WORD.sent][lang] : null,
    showAmount,
    conserved,
    fillsOnPress: inFlight && conserved && !replayed,
    amountState: conserved && !replayed ? state : unsettled(state),
    payKind,
    hero,
    under,
    detail,
    sentAt: historyAt(dto, "sent"),
    paidAt,
  };
}

/**
 * The receipt's amounts in the amount grammar (S2.0 rule 3, S2.2.1). Its parts (the premium, the bonus, ruled
 * deductions, credits) are figures two officers approved: ink, or pencil while nobody has. The net is the money itself
 * and reads as the hero does: hollow while it is with PayPal or due at the bodega, landed once PayPal confirms it,
 * attested once the clerk records the cash, and never settled while the receipt does not add up (I3).
 */
export function receiptStates(view: Pick<LineView, "amountState">): { parts: AmountState; net: AmountState } {
  return { parts: view.amountState === "pencil" ? "pencil" : "ink", net: view.amountState };
}

/**
 * The board's Bayad tab shows the run it co-signs: every figure in pencil until both keys are in, then ink, as M-BD-01
 * draws the same figures (S2.2.1: a line turns ink once its run is APPROVED).
 */
export function runAmountState(run: Pick<CosignRequestDTO, "state">): AmountState {
  return amountStateOf("READY", { approved: run.state === "signed" });
}

/** The settled looks of the amount grammar (S2.2.1): PayPal confirmed it, or the clerk recorded the cash. */
const SETTLED: ReadonlySet<AmountState> = new Set<AmountState>(["landed", "attested"]);

/** A line that does not add up is never presented as settled: a landed or attested amount stays hollow (I3). */
function unsettled(state: AmountState): AmountState {
  return SETTLED.has(state) ? "hollow" : state;
}

/* ------------------------------------------------------------------ the capsule's words through MM-1 */

/** What the in-flight capsule's two layers say (design §7 M1). */
export interface CapsuleText {
  /** The plate before PayPal's press: its words, and the clock stopped at the press. Null once MM-1 is done. */
  before: { word: string; clock: string | null } | null;
  /** The jade face after the press: "Bayad na, 30 Okt". */
  after: string | null;
}

/** Where MM-1 is: its phase, and whether the label's crossfade has reached the end on screen (`swap` at 1). */
export interface CapsuleMoment {
  phase: MomentPhase<"MM-1">;
  swapped: boolean;
}

/**
 * The capsule's words through MM-1. PayPal's press, the flood and the fill play under the words she was reading,
 * "Gipadala na, naghulat sa PayPal 0:14" with the clock stopped where PayPal pressed it; the label crossfades to
 * "Bayad na, 30 Okt" at 400 ms. The old words leave the plate only when the moment is done and the crossfade has
 * really finished, so a late frame never leaves the plate blank.
 */
export function capsuleText(view: LineView, moment: CapsuleMoment, clock: string | null): CapsuleText {
  if (view.capsule === "sent") return { before: { word: view.word, clock }, after: null };
  if (view.capsule !== "paid") return { before: null, after: null };
  const gone = moment.phase === "done" && moment.swapped;
  return {
    before: gone || !view.sentWord ? null : { word: view.sentWord, clock },
    after: view.word,
  };
}

/** The capsule's clock, "0:14": from when the item went to PayPal until `nowMs` (null when either is unknown). */
export function elapsedClock(sinceMs: number | null, nowMs: number | null): string | null {
  return sinceMs === null || nowMs === null ? null : format.elapsed(nowMs - sinceMs);
}

/** An RFC 3339 time in epoch milliseconds, or null. */
export function msOf(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
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
  const replayed = statementRail(dto, "en", track).kind === "replay";
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
        replayed && (h.kind === "paid" || h.kind === "sent")
          ? { key: "M-MB-01.replayed" }
          : h.kind === "approved"
            ? { key: HISTORY_KEY.approved, args: { a: h.by?.[0] ?? "", b: h.by?.[1] ?? "" } }
            : { key: HISTORY_KEY[h.kind] },
      mark:
        replayed && h.kind === "paid"
          ? "pencil"
          : h.kind === "approved" || (h.kind === "received" && h.by?.length)
            ? "stamps"
            : HISTORY_MARK[h.kind],
    }));
}

/** The two officers whose keys closed the seal, from the approval in her history. */
export function sealSigners(dto: StatementDTO): readonly [string, string] | null {
  const by = dto.history.find((h) => h.kind === "approved")?.by;
  return by && by.length >= 2 && by[0] && by[1] ? [by[0], by[1]] : null;
}
