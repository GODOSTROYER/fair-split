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
  lot: (lot: string, kg: string, buyer: string, sacks: number) =>
    `Lot ${lot}: ${sacks} jute sacks, ${kg}, shipped to ${buyer}.`,
  strip: "Run stages",
  stripDone: "done",
  stripNext: "next",
  stripNextWord: "Next",
  stripLater: "not yet",
  /** The last stage on a run that settled on replayed payout statuses: never "Paid". */
  stripReplayed: "Replayed",
  pool: "The pool",
  poolShare: (members: number) => `What ${members} members share`,
  premium: "Premium",
  premiumNote: "Never deducted, R0",
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
    "Written with the seed; Claude did not draft these lines in this build. Every amount is the engine's quote; policy checks it before anything is sent.",
  memo: (note: string) => `Memo: ${note}`,
  autoCancel: (date: string) => `Auto-cancels ${date} if unpaid.`,
  sentBy: (name: string) => `Sent by ${name}`,
  funded: "Funded",
  waiting: "Waiting for payment",
  photos: (count: number) => `The desk: ${count} photos to read`,
  photosNote: "Four synthetic slips a photo, composed in code. Open one in the reading room.",
  photoLabel: (id: string, serials: string, read: boolean) =>
    `Photo ${id}: slips ${serials}${read ? ", read" : ""}. Synthetic sample.`,
  evalTitle: "Reading eval",
  evalEmpty:
    "No payroll eval report is served here. The reading room separately shows the ten real hero-slip readings with provisional, agent-checked labels.",
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

/** The first view's single action (W-JG-01), and what happens while it runs. */
export const FIRST_VIEW_COPY = {
  lede: (members: number, buyer: string) =>
    `${members} members' cacao went to ${buyer} in one lot. One invoice funds every member's share; the slips on the desk decide who gets what.`,
  pressNote: (payer: string, amount: string, rail: PaypalRail) =>
    `${payer}, ${amount}. ${rail === "simulator" ? "Simulated PayPal sandbox" : "Untested PayPal sandbox rail"}. The run starts once the invoice reads as paid.`,
  srConsequence: "starts the run, changes a line",
  starting: "Starting your run.",
  pending: "Recording the payment, then reading the invoice back.",
  funded: "Funded. The slips decide each member's share.",
  movedOn: "The invoice is paid. The run has moved on.",
  openNext: "Go to the next step",
  rules: "The rules, bolted before the first slip",
  openCard: "Open the rate card",
  titleFunded: (season: string) => `Season ${season} is funded.`,
  desk: "The slips on the desk",
  synthetic: "Synthetic samples",
  deskNote: (count: number, funded: boolean) =>
    funded
      ? `${count} photos composed in code, four synthetic slips each, in Jessie's blue block capitals. Each photo ticks once its rows land.`
      : `${count} photos composed in code, four synthetic slips each, in Jessie's blue block capitals.`,
  stamp: (name: string) => `Pressed by ${name}`,
} as const;
