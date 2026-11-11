// Season words @fairsplit/i18n does not carry yet (W-TR-01 and the Judge stage's first view), in the console's
// English: sentence case, no exclamation marks, buttons name outcomes, the co-op's own words. Figures, dates
// and hashes always arrive formatted (lib/format). Under the simulated rail nothing PayPal is "real", "live"
// or "verified" (ADR-0002, S1.11). These move into the catalog under W-TR-01.* and W-JG-01.* (WS-DS).

import type { PaypalRail } from "../../lib/env.js";

export const GATE_COPY = {
  loading: "Loading the season.",
  failed: "The season didn't load.",
  noSeason: (season: string) => `No Season ${season} here.`,
  oneSeason: "Bulawanon Kakaw keeps one season in this demo.",
  openSeason: (season: string) => `Open Season ${season}`,
} as const;

export const SEASON_COPY = {
  title: (season: string) => `Season ${season}`,
  /** The lot's facts under the co-op (round 4): data joined by " · ", the lot's code already beside the season. */
  lotFacts: (kg: string, buyer: string, sacks: number) => `${sacks} jute sacks · ${kg} · shipped to ${buyer}`,
  strip: "Run stages",
  stripDone: "done",
  stripNext: "next",
  stripNextWord: "Next",
  stripLater: "not yet",
  /** Paid's note on a run that settled on PayPal while cash is still due at the bodega (round 4). */
  stripCashDue: "Cash due",
  /** The last stage on a run that settled on replayed payout statuses: never "Paid". */
  stripReplayed: "Replayed",
  pool: "The pool",
  poolShare: (members: number) => `What ${members} members share`,
  premium: "Premium",
  premiumNote: "Never deducted, R0",
  /** The first view's premium lock, in words (round 5: no rule id where a person reads). */
  premiumNever: "Never deducted",
  bonus: "Quality bonus",
  disbursement: "Disbursement",
  disbursementNote: "Payout costs, never shared",
  invoice: (number: string) => `Invoice ${number}`,
  invoiceTotal: "Lantern Bay pays",
  draftBy: "Placeholder draft (seed-written)",
  draftNote: (_recorded: string) =>
    "Line labels: a placeholder written with the seed (no Claude recording in this build). Every amount is the engine's quote, checked by the live policy lattice before anything is sent.",
  invoiceLines: "Invoice lines (seeded sample)",
  invoiceLinesNote: (_recorded: string) =>
    "Written with the seed; Claude did not draft these lines. Every amount is the engine's quote.",
  memo: (note: string) => `Memo: ${note}`,
  autoCancel: (date: string) => `Auto-cancels ${date} if unpaid.`,
  sentBy: (name: string) => `Sent by ${name}`,
  funded: "Funded",
  waiting: "Waiting for payment",
  photoLabel: (id: string, serials: string, read: boolean) =>
    `Photo ${id}: slips ${serials}${read ? ", read" : ""}. Synthetic sample.`,
  evalTitle: "Reading eval",
  evalEmpty: "No eval report is served here.",
  evalCaption: (exact: string, baseline: string, unsafe: number, date: string) =>
    `40 labelled synthetic cases. Exact rows ${exact} against an OCR-only baseline of ${baseline}. Unsafe auto-accepts ${unsafe}. Run ${date}.`,
  evalCase: "Case",
  evalResult: "Result",
  next: "Next",
  arcCaption: "Funding: from the invoice to the pool",
} as const;

/** The season's S1 states, in words. */
export const SEASON_STATE_COPY = {
  unratified: "Ratify a rate card before the first slip.",
  drafted: "Check the seed-written sample invoice lines, then send the invoice to Lantern Bay.",
  "draft-refused":
    "The invoice draft didn't match the code's quote, so policy refused it (invoiceEqualsQuote). No invoice was sent.",
  waiting: "Sent to Lantern Bay. Waiting for payment.",
  unverified:
    "A payment notice arrived that we couldn't verify. Nothing starts until the simulated PayPal sandbox confirms.",
  fundedPaid: "Paid by Lantern Bay.",
  fundedMarked: "Marked as paid in the simulated PayPal sandbox.",
  autoCancelled: (date: string) => `Invoice auto-cancelled on ${date}. Send a new one.`,
  offline: (time: string | null) =>
    time
      ? `You're offline. Showing the last copy from ${time}. Actions are paused.`
      : "You're offline. Showing the last copy. Actions are paused.",
} as const;

/** Where a funded run's word came from (I8): a fresh GET of the invoice, on this rail. */
export function fundedSource(rail: PaypalRail): string {
  return rail === "simulator"
    ? "The payment was recorded, then the invoice read back as paid with nothing due."
    : "The payment was recorded on the untested PayPal sandbox rail, then the invoice read back as paid with nothing due.";
}

/** The first view's single action (W-JG-01), and what happens while it runs (UI gate round 2: one line each). */
export const FIRST_VIEW_COPY = {
  /**
   * The title row (round 5): a noun title with the season as its grey suffix, "Season 2026-A", and the run's state
   * as one chip on the same row: "Awaiting payment" until the invoice reads back paid, then "Funded", then the
   * settled run's words (`settledStatus`), never more than the run has done.
   */
  title: "Season",
  awaiting: "Awaiting payment",
  srConsequence: "starts the run, changes a line",
  starting: "Starting your run.",
  pending: "Recording the payment.",
  movedOn: "The invoice is paid. The run has moved on.",
  /** A settled run's status line: PayPal's part, then the cash still due (the pill's own words). */
  settledStatus: (replayed: boolean, cashDue: boolean) =>
    `${replayed ? "Payouts replayed" : "PayPal complete"}${cashDue ? " · cash due" : ""}`,
  openNext: "Next step",
  openCard: "Open the rate card",
  /** The rate card's row, the pool card's foot (round 5): its name, its hash and seal date, then "Open". */
  card: "Rate card",
  /** The chip's seal date, after its hash (the hash is an id, in the mono). */
  cardSealedOn: (date: string) => ` · sealed ${date}`,
  open: "Open",
  /** The pool's strip and the desk's head (W-JG-01). */
  pool: "Pool",
  members: (n: number) => `${n} members`,
  /** The pool's state before the simulated PayPal funds it, beside its hollow dot (round 4). */
  notFunded: "Not funded",
  /** The pool's amount, then its sum in words under it (round 5): "Invoice US$4,333.50 − costs US$60.00". */
  eqInvoice: "Invoice",
  eqCosts: "costs",
  eqSpoken: (invoice: string, costs: string) => `Invoice ${invoice} minus costs ${costs} equals the pool: `,
  /** The desk's counts with their scope (round 3): this run's photos and slips, then the season's slip images. */
  slipsMicro: (photos: number, counts: string) => `${photos} photos · ${counts}`,
  exhibit: "Claude's real readings of 10 hero slips",
  invoice: "Invoice",
  desk: "Slips",
  deskNote: (count: number, funded: boolean) =>
    funded
      ? `${count} photos composed in code, four synthetic slips each, in Jessie's blue block capitals. Each photo ticks once its rows land.`
      : `${count} photos composed in code, four synthetic slips each, in Jessie's blue block capitals.`,
} as const;
