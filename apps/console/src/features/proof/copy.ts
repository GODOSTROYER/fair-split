// Proof's words (S1.8, S1.11). Keys the i18n catalog already has (`W-PF-01.*`) come from it; the rest live here
// until WS-DS adds them to @fairsplit/i18n (reported). Sentence case, no exclamation marks, buttons name outcomes.
// Under the simulated rail (ADR-0002) nothing PayPal is called real, live or verified, and every PayPal figure
// says which rail it came from (I8).

import {
  INVOICE_STATUS_LABELS,
  type InvoiceStatus,
  type PlateName,
  PROOF_STATUS_LABELS,
  PROVENANCE_LABELS,
  type Provenance,
  pickLabel,
} from "@fairsplit/contracts";
import { type MessageKey, translate, type Values } from "@fairsplit/i18n";
import type { PaypalRail } from "../../lib/env.js";
import type { Verdict } from "./verify.js";

/** The console's language is English (CONSOLE_LANG); Proof reads in it too. */
export function t(key: MessageKey, values?: Values): string {
  return translate("en", key, values);
}

/** The progress counts the hero's live line reads (a subset of the page's ProgressCounts). */
export interface ProgressFacts {
  readonly total: number;
  readonly confirmed: number;
  readonly parked: number;
  readonly returned: number;
}

function railWhere(rail: PaypalRail): string {
  return rail === "simulator" ? "in the simulated sandbox" : "on the configured PayPal rail (not simulated)";
}

/** " 1 moved to cash." and " 1 parked for a decision.": the items PayPal did not pay, said plainly. */
function parkedWords(p: ProgressFacts): string {
  const moved = p.returned > 0 ? ` ${p.returned} moved to cash.` : "";
  const parked = p.parked > 0 ? ` ${p.parked} parked for a decision.` : "";
  return `${moved}${parked}`;
}

/** Splits a catalog sentence around one value, so the value can carry its own amount state. */
export function around(key: MessageKey, slot: string, values: Values): readonly [string, string] {
  const marker = "⁣";
  const text = t(key, { ...values, [slot]: marker });
  const at = text.indexOf(marker);
  return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at + marker.length)];
}

export const PLATE_TITLE: Readonly<Record<PlateName, MessageKey>> = {
  paid: "W-PF-01.plate.invoice",
  ratified: "W-PF-01.plate.rateCard",
  read: "W-PF-01.plate.slips",
  computed: "W-PF-01.plate.lines",
  twoKeys: "W-PF-01.plate.keys",
  payoutItems: "W-PF-01.plate.items",
};

/** What each plate's check recomputes, in the order S1.8 lists them. */
export const PLATE_CHECK: Readonly<Record<PlateName, MessageKey>> = {
  paid: "W-PF-01.check.reference",
  ratified: "W-PF-01.check.card",
  read: "W-PF-01.check.photos",
  computed: "W-PF-01.check.lines",
  twoKeys: "W-PF-01.check.signatures",
  payoutItems: "W-PF-01.check.items",
};

export function invoiceWords(status: InvoiceStatus): string {
  return pickLabel(INVOICE_STATUS_LABELS[status], "en");
}

/** ADR-0002's label for the simulator: every PayPal figure on Proof carries one of these (I8). */
export function railName(rail: PaypalRail): string {
  return rail === "simulator"
    ? "Simulated PayPal sandbox, contract-tested against PayPal's OpenAPI specs"
    : "PayPal sandbox (not simulated)";
}

/** The short form, for chips and table cells. */
export function railShort(rail: PaypalRail): string {
  return rail === "simulator" ? "Simulated PayPal sandbox" : "PayPal sandbox (not simulated)";
}

export function provenanceWords(provenance: Provenance): string {
  return pickLabel(PROVENANCE_LABELS[provenance], "en");
}

/** "Verified", "Sample", "Does not match": the contracts' words; a partial check has its own. */
export function verdictWord(verdict: Verdict): string {
  if (verdict === "replay") return "five of six match; one replayed, labelled";
  if (verdict === "partial") return "Five of six checked here";
  return pickLabel(PROOF_STATUS_LABELS[verdict], "en");
}

const NUMBER_WORDS = ["None", "One", "Two", "Three", "Four", "Five", "Six"] as const;

export const VERIFY_COPY = {
  slab: () => t("W-PF-01.verify"),
  again: "Check again",
  srLabel:
    "Verify in your browser: recompute the hash chain, its signed checkpoint and six checks on this device",
  idle: "Runs here, in this browser, against the keys Fair Split publishes. Nothing is sent anywhere.",
  stale: "The record moved on since your last check. Check again to cover it.",
  checking: "Checking the hash chain, its signed checkpoint and the six plates.",
  matches: (n: number) => `${NUMBER_WORDS[n] ?? String(n)} of six match.`,
  checkedAt: (time: string) => `Checked in this browser at ${time}, Davao time.`,
  sample: (keys: readonly string[]) =>
    `Signed with sample keys (${keys.join(", ")}), so it reads Sample, never Verified.`,
  partial:
    "Five of six match here. Plate 6 recomputes the batch hash over the payout receivers, which the public Proof withholds. The brand's view checks it in full.",
  keysPublished: "Keys: /.well-known/fairsplit-keys.json, fetched apart from this record.",
  keysSeed: "Keys: the seed's published sample keys, because this mock API serves no keys document.",
  keysFailed: "The published keys didn't load, so nothing was checked.",
  anchorsLead: (rail: PaypalRail) =>
    rail === "simulator"
      ? "Simulated PayPal sandbox identifiers (no PayPal dashboard):"
      : "Match it on the configured PayPal rail (not simulated):",
  checkState: {
    idle: "Not checked yet",
    checking: () => t("W-PF-01.checking"),
    matches: () => t("W-PF-01.matches"),
    server: "Matches, checked by Fair Split's server",
    withheld: "Needs the full record",
    differs: "Does not match",
    replay: "Replayed, labelled",
  },
  serverNote:
    "Receivers are withheld from the public Proof, so Fair Split's server ran this check over the full record.",
  withheldNote:
    "The batch hash covers each payout's receiver, and the public Proof withholds receivers (RA 10173). The brand's view checks this plate in the browser.",
} as const;

export const FAILURE_PLACE: Readonly<Record<"chain" | "checkpoint", string>> = {
  chain: "The record's hash chain",
  checkpoint: "The signed ledger checkpoint",
};

export const STATE_COPY = {
  /** Where the progress line's counts come from (S1.11: never "live" for sandbox or simulated PayPal activity). */
  sourceSession: "From this run's own notice stream.",
  sourcePublic: "From the public notice stream.",
  none: "No pay run yet for this season.",
  notPosted: "This run's Proof is published once both keys are signed and the batch is posted to PayPal.",
  noneHint: "A Proof appears for a run once its payout batch is posted.",
  showcase: "Open the season's Proof",
  progress: (confirmed: number, total: number) =>
    `Simulated PayPal sandbox: waiting, ${confirmed} of ${total} confirmed.`,
  settled: (confirmed: number, total: number) =>
    `${confirmed} of ${total} confirmed by PayPal (simulated sandbox).`,
  /** Items PayPal returned: their cash is due until the clerk attests it (paid only then). */
  returned: (returned: number, cashPaid: number) =>
    cashPaid >= returned
      ? `${returned} returned to the co-op and paid in cash`
      : cashPaid > 0
        ? `${returned} returned to the co-op: ${cashPaid} paid in cash, ${returned - cashPaid} due at the bodega`
        : `${returned} returned to the co-op, cash due at the bodega`,
  /** The hero's live line while PayPal is still confirming: counts only, and the rail it ran on (I8). */
  liveProgress: (p: ProgressFacts, rail: PaypalRail) =>
    `Waiting for PayPal: ${p.confirmed} of ${p.total} PayPal payouts confirmed ${railWhere(rail)}.${parkedWords(p)}`,
  /** The hero's live line once PayPal has finished: "7 of 8 PayPal payouts confirmed in the simulated sandbox." */
  liveSettled: (p: ProgressFacts, rail: PaypalRail) =>
    `${p.confirmed} of ${p.total} PayPal payouts confirmed ${railWhere(rail)}.${parkedWords(p)}`,
  withheldTitle: "Proof withheld",
  withheldFigures: "The figures stay withheld until the record matches again.",
  loadFailed: "Proof didn't load.",
} as const;

export const FIGURE_COPY = {
  heading: "Where the money went",
  explained: () => t("W-PF-01.metric.explained"),
  explainedValue: (count: number, total: number) => t("W-PF-01.metric.explainedValue", { count, total }),
  explainedNote: "Each line carries its hash and the slips it comes from.",
  premium: "Premium allocated to members",
  premiumNote: "No deductions (R0). Computed by the engine and hashed.",
  premiumBreach: (amount: string) => `${amount} reached premium, which R0 forbids.`,
  paid: "Paid, in three tiers",
  tierPaypal: (rail: PaypalRail) =>
    rail === "simulator"
      ? "Confirmed by PayPal (simulated sandbox)"
      : "Configured PayPal rail (not simulated)",
  tierAttested: "Cash, attested at the bodega",
  tierDue: "Due",
  tierReserved: "Reserved, carried over",
  members: (n: number) => `${n} ${n === 1 ? "member" : "members"}`,
  attestedOf: (n: number, of: number) => `${n} of ${of}`,
  attestedNote: "Each receipt is signed or thumbmarked at the bodega, with a witness.",
  dueNote: (cash: number, paypal: number) =>
    paypal > 0
      ? `${cash} in cash at the bodega, ${paypal} still with PayPal.`
      : `${cash} in cash at the bodega.`,
  holds: () => t("W-PF-01.metric.holds"),
  holdsValue: (count: number) => `${count} caught`,
  holdsKept: (amount: string) => `${amount} kept for members`,
  holdsNote: (duplicate: string, credit: string) =>
    `A duplicate slip counted once (${duplicate}) and a fine no rule allows, returned (${credit}).`,
  holdsUnknown: "This run's hold metrics are unavailable.",
  rails: () => `${t("W-PF-01.metric.paypal")} (simulated sandbox)`,
  onPaypal: (count: number, total: number, share: string) =>
    `${t("W-PF-01.metric.paypalValue", { count, total, share })} (simulated PayPal sandbox)`,
  railsPaypal: (members: number, share: string) =>
    `${members} on PayPal (simulated sandbox) this season, ${share} of value`,
  railsCash: (members: number) => `${members} in cash at the bodega`,
  railsWord: "Cash",
  timing: () => t("W-PF-01.metric.time"),
  timingPending: "Still running",
  timingNote: "From the record's own timestamps: invoice funded to the last payout notice.",
  source: "Computed from this record; fs-api supplies this run's public hold metrics.",
} as const;

export const FEES_COPY = {
  heading: "Fees",
  summary: "Simulated PayPal sandbox fees and who budgets for them",
  invoiceMarked: "Invoice: marked as paid in the Simulated PayPal sandbox, so the simulator charged no fee.",
  invoicePaid: "Invoice: the simulated PayPal sandbox fee is not reported in this record.",
  payouts: (rail: PaypalRail, fee: string, n: number) =>
    rail === "simulator"
      ? `Payouts: the simulated sandbox reported ${fee} for ${n} payments.`
      : `Payouts: PayPal reported ${fee} for ${n} payments.`,
  payoutsPending: "Payouts: the simulated PayPal sandbox fee is not reported in this record.",
  disbursement: (line: string, unused: string) =>
    `From the ${line} co-op disbursement line. Unused: ${unused}, modelled in the co-op's simulated PayPal balance.`,
  production:
    "In production a Philippine co-op pays PayPal PH's fees: receiving 4.40% + US$0.30, payouts 2% capped at ₱50 each, conversion 3.0%.",
} as const;

export const PLOT_COPY = {
  heading: "Where the cacao came from",
  caption: () => t("W-PF-01.plots"),
  table: "Members by verified kilos",
} as const;

export const FOOTER_COPY = {
  recon: () => t("W-PF-01.footer.recon"),
  merchant: "Lantern Bay pays the co-op, which is the merchant of record. Fair Split never holds the money.",
  /** ADR-0002, I8: under the simulator the footer says the PayPal sandbox itself is simulated. */
  sandbox: (rail: PaypalRail) =>
    t(rail === "simulator" ? "W-PF-01.footer.simulator" : "W-PF-01.footer.sandbox"),
  /**
   * The amounts are dollars and the trail ends at the slip, not at Claude's pencil (pencil means an unconfirmed
   * reading). Reported to WS-DS for the catalog's `W-PF-01.tagline`; the console says it until the key changes.
   */
  tagline: () => "Every dollar, traced to the slip it was weighed on.",
  privacy: "Members appear by ID only, never by name (Philippine Data Privacy Act, RA 10173).",
} as const;

export const LINES_COPY = {
  hint: "Press an amount to see where it comes from, down to the slip.",
  caption: "Every member's line: verified kilos, rail, net amount and status",
  share: (kg: string, of: string) => `${kg} of the co-op's ${of} verified kilos`,
  bonusShare: (kg: string, of: string) => `${kg} of ${of} Grade 1`,
  premiumNote: "R0, never deducted",
  fromSlips: "From slips",
  openSlip: (serial: string, kg: string | null) => `Slip ${serial}${kg ? `, ${kg}` : ""}: open it`,
  backToLine: "Back to the line",
  close: "Close",
  sum: (n: number) => `${n} lines.`,
  netOf: "Net",
  traceOpen: (memberNo: string) => `Line ${memberNo} open, with its receipt and slips.`,
  slipOpen: (serial: string) => `Slip ${serial} open.`,
  cropNote:
    "Drawn from the slip's recorded boxes until its photo tile lands. Payable kilos are the money's source. With a zoom button focused, the arrow keys pan.",
  cropMissing: (serial: string) => `Slip ${serial} isn't in this browser's copy of the season.`,
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
} as const;
