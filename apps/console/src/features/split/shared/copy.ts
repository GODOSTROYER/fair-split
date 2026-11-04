// The runs slice's words (W-TR-05 to W-TR-09). Keys @fairsplit/i18n already carries are read from the catalog
// (`en`); the rest live here until WS-DS adds them under `W-TR-0n.*` (reported). Sentence case, no exclamation
// marks, buttons name outcomes, a hold is never an error, and under the simulated rail nothing PayPal is
// "real", "live" or "verified" (S1.11). Every figure arrives as an argument formatted by `format.*`.

import { type MessageKey, translate, type Values } from "@fairsplit/i18n";

/** A catalog message in the console's language (English, in the co-op's own words). */
export const en = (key: MessageKey, values?: Values): string => translate("en", key, values);

export const SPLIT = {
  loading: "Printing the lines",
  empty: "No lines yet. They appear once the slips are read.",
  emptyLink: "Open the reading room",
  declined: "The simulated PayPal sandbox declined the batch: the balance is too low. Nothing was sent.",
  allDecided: "Every hold is decided. The batch is ready for two keys.",
  decidedKey1: "Every hold is decided. Analyn signed; the batch waits for Ernesto.",
  decidedApproved:
    "Every hold is decided and both keys signed. The simulated PayPal sandbox confirms each payment as it lands.",
  decidedSettled: "Every hold was decided and the run is settled.",
  approveLink: "Open Approve",
  nextHold: (label: string, title: string) => `Open ${label}: ${title}`,
  byHandNext: (slip: string) => `Enter slip ${slip} by hand`,
  filters: "Filter lines",
  allColumns: "All columns",
  fewerColumns: "Fewer columns",
  totalsLines: (n: number) => `${n} lines`,
  slipCount: (n: number) => (n === 1 ? "1 slip" : `${n} slips`),
  showAll: (n: number) => `Show all ${n} lines`,
  balanced: "Balanced",
  unbalanced: "Does not balance",
  gridLabel: "Member lines",
  noMatch: "No lines match this filter.",
  showingAll: "Showing every line.",
  pending: "Waits for slip",
  creditPending: (label: string) => `Waits for ${label}`,
  creditReturned: "Returned multa",
  confidenceUnknown: "Read earlier this season",
  byHand: "By hand",
  perTreeOver: (kg: string, limit: string) => `${kg} a tree, over ${limit}`,
  movedToCash: "Moved to cash",
  reserved: "Reserved, never redistributed.",
  held: "Gisusi pa",
  openLine: (name: string) => `Open ${name}'s line`,
  openHold: (label: string, name: string) => `Open hold ${label} on ${name}'s line`,
  dialPending: (slip: string) => `Waits for slip ${slip}`,
  dialInside: "Inside the limit",
  dialOutside: "Over the limit",
  massBalanceCaption: (verified: string, shipped: string) =>
    `${verified} verified against ${shipped} shipped`,
  provenance: "Lines",
} as const;

export const HOLDS = {
  meta: (index: number, total: number) => en("W-TR-06.position", { index, total }),
  notFound: "No hold with that name in this run.",
  notFoundHelp: "Open the split review to see the holds this run has.",
  next: (label: string) => `Next: hold ${label}`,
  allDecided: "Every hold is decided. Open Approve",
  slipMeta: (serial: string) => `Slip ${serial}`,
  back: "Back to the split",
  resolvedNote: "Decided. The engine recomputed every line.",
  overrideNote:
    "Counted as two deliveries, an override: Ernesto co-signs it with the batch (Schedule A, R5).",
  h1EffectInside: (amount: string, members: number) =>
    `Counting it once returns ${amount} to ${members} members. Enter slip 0462 first to see the mass balance it settles.`,
  yieldEffect: (plot: string) =>
    `Registering ${plot} adds its trees to her yield check. Her kilos and pay don't change.`,
  creditReturned: (credit: string) => `Returned as a ${credit} credit paid by the co-op.`,
  ruleOk: (rule: string) => `Matches ${rule}`,
  twoDeliveriesTitle: "Why are these two deliveries?",
  twoDeliveriesHint: "Say what the clerk or the member told you. The Chair reads this before he signs.",
  reasonLabel: "Reason",
  reasonSubmit: "Count both, with this reason",
  reasonCancel: "Keep it open",
  fieldsMatch: (n: number, total: number) =>
    n === total ? `${n} of ${total} fields match. Same slip.` : `${n} of ${total} fields match.`,
  compareCaption: "The two copies, field by field",
  field: { serial: "Serial", date: "Date", member: "Member", net: "Net kg" },
  copyWhite: "white original",
  copyPink: "pink duplicate",
  copyYellow: "yellow copy",
  photo: (id: string) => `Photo ${id}`,
  slipAlt: (serial: string, copy: string, photo: string) => `Slip ${serial}, ${copy}, photo ${photo}`,
  shrinkNow: "Mass balance now",
  shrinkInside: (shrink: string, limit: string) => `Shrink ${shrink}, inside the ${limit} limit.`,
  h1EngineInside: (
    slip: string,
    photoA: string,
    photoB: string,
    amount: string,
    members: number,
    name: string,
    shrink: string,
    limit: string,
  ) =>
    `Slip ${slip} is in two photos: the white original (${photoA}) and the pink duplicate (${photoB}). Counting both moves ${amount} from ${members} members to ${name}. Shrink reads ${shrink}, inside the ${limit} limit, because slip 0462 is not entered yet.`,
  plotsTitle: "Registered plots",
  plotRegistered: (no: string, ha: string, trees: number) => `${no}, ${ha} ha, ${trees} trees`,
  plotPending: (no: string, ha: string, trees: number) =>
    `${no}, ${ha} ha, ${trees} trees, not in the registry yet`,
  plotPrivate: "The plot point stays private.",
  plotForm: "The plot to register",
  plotNo: "Plot",
  plotArea: "Area (ha)",
  plotTrees: "Trees",
  perTreeLimit: (limit: string) => `Limit ${limit} kg a tree`,
  perTreeNow: (kg: string) => `${kg} kg a tree now`,
  marksTitle: (slip: string) => `Box 13 on slip ${slip}`,
  markRule: (rule: string) => `Rule ${rule}`,
  markNoRule: "No rule",
  closedList:
    "Schedule A is a closed list: CBU (R1), hauling (R2), a loan with an Authority to Deduct (R3), an advance with a voucher (R4).",
  creditEffect: (credit: string) =>
    `Returns ${credit} to him as a correction credit paid by the co-op. Nobody else's line changes.`,
  byHandTitle: (slip: string) => `Slip ${slip} needs a person`,
  byHandLink: (slip: string) => `Enter slip ${slip} by hand`,
  byHandDone: (slip: string) => `Slip ${slip} was entered by hand.`,
  massTitle: "Mass balance",
  massLink: "Open H1, the slip counted twice",
  massCleared: "The engine cleared it when the duplicate was counted once.",
  asked: "Asked Ernesto",
  conflict: "Ernesto is viewing this hold",
  srCountOnce: (amount: string, members: number) =>
    `Count it once, returns ${amount} to ${members} members, changes a line, button`,
  srRegister: (plot: string) => `Register plot ${plot}, changes a line, button`,
  srReturn: (credit: string) => `Return the fine as a credit of ${credit}, changes a line, button`,
} as const;

export const APPROVE = {
  loading: "Preparing the batch",
  blockedHolds: (n: number) =>
    n === 1 ? "Resolve 1 hold that changes kilos first" : `Resolve ${n} holds that change kilos first`,
  blockedReading: "The slips are still being read. Approval opens once every line is computed.",
  blockedWaiting: "Approval waits for",
  blockedLink: (label: string) => `Open ${label}`,
  signing: "Signing the batch hash with this browser's key",
  keyLine: (keyId: string, label: string) => `Key ${keyId}, ${label}`,
  keySeeded: "Sample key (seeded)",
  keyDevice: "Device key",
  keyBrowser: "Browser key, registered from /ops",
  keyDemoChair: "Demo key (the Chair's phone frame)",
  keyWebCrypto: "Made by WebCrypto in this browser; the private half can't be exported.",
  keyNoble: "Held in this page's memory for this session; it never leaves the browser.",
  waitingKey: en("W-TR-07.key.waiting"),
  waitingChair: en("W-TR-07.waiting"),
  presence: (hold: string) => en("W-TR-07.presence", { hold }),
  presenceApproval: "Ernesto is on the co-sign request",
  approved: en("W-TR-07.approved"),
  postedLink: "Watch the payments land",
  watchPayouts: "Watch the payouts",
  posting: (batch: string) => en("W-TR-07.posting", { batch }),
  posted:
    "The simulated PayPal sandbox accepted the batch. Each payment turns jade only when the simulated PayPal sandbox confirms it.",
  declined: (who: string) => `${who} sent the batch back`,
  declinedNext: "Fix what he asked, then approve again.",
  expired: "The co-sign request expired. Send again.",
  expiredAction: "Sign again",
  mismatch: "The batch changed after you opened it. Nothing was signed. Review again.",
  mismatchAction: "Reload the batch",
  denied: en("W-TR-07.denied"),
  killed: en("W-TR-07.killed"),
  /** S1.7 `retrying`: PayPal's Payouts POST, retried by the server (shown once a contract event carries it). */
  paypalRetrying: (attempt: number, of: number) =>
    `The simulated PayPal sandbox didn't answer. Retrying with the same request ID, so no one is paid twice. Attempt ${attempt} of ${of}.`,
  /** This browser sending its own signed approval again: not PayPal, and not the spec's `retrying`. */
  resending: (send: number, of: number) =>
    `The server didn't answer. Sending your signature again with the same request ID, so it counts once. Send ${send} of ${of}.`,
  payloadLoading: "Preparing the batch to sign",
  payloadFailed: "The batch to sign didn't load. Load it again",
  payloadRetry: "Load the batch again",
  confirmTitle: (count: number) => en("confirm.title", { count }),
  confirmBody: (amount: string, count: number) => en("confirm.body", { amount, count }),
  srApprove: (label: string, spoken: string) => `${label}, ${spoken}, ${en("slab.consequence.money")}`,
  sealWaiting: "The seal grows from the batch hash once every hold that changes kilos is decided",
  batchLabel: "Batch",
  batchPending: "Not final yet",
  linesDigest: "Lines digest",
  linesNote: (lines: number, cash: number) =>
    `all ${lines} lines, the ${cash} cash lines too; this browser recomputed it`,
  rateCard: "Rate card",
  signTitle: "What you and Ernesto sign",
  voided: (time: string) =>
    `Both approvals voided at ${time}. A payout changed after signing, so nothing was sent. Review and sign again.`,
  voidedKey: (time: string) => `Voided ${time}`,
  ledgerNote: "Compare these by eye with the Chair's phone: the seal above grows from the batch hash.",
  cosignTitle: "Co-sign as Ernesto from your own phone",
  cosignBody: "Uses a labelled demo key made in your phone's browser.",
  cosignMake: "Make a co-sign code",
  cosignCode: "Type it on the phone's pairing screen. It works once.",
  cosignLink: "Or open the pairing link on the phone",
  cosignExpires: (time: string) => `Expires ${time}.`,
  cosignFrame: "Or sign in the Chair frame on the stage",
  feesLabel: en("W-TR-07.feesLabel"),
  chairWhy: (threshold: string) => en("W-TR-07.key.chairWhy", { threshold }),
  safeEngine: "Engine",
} as const;

export const FANOUT = {
  loading: "Drawing the fan",
  notPosted: "Not posted yet. The batch posts after both keys.",
  notPostedLink: "Open Approve",
  waiting: (time: string) =>
    `Posted ${time}. The simulated PayPal sandbox confirms each payment as it lands.`,
  waitingSeeded: "Posted. The simulated PayPal sandbox confirms each payment as it lands.",
  elapsed: (clock: string) => `${clock} since posting`,
  parked: (name: string) => `${name} is parked. Decide how she gets paid.`,
  denied: "The simulated PayPal sandbox declined the batch. No money moved.",
  done: (paid: number, cash: number, kept: string) =>
    `${paid} paid by the simulated PayPal sandbox. ${cash} in cash. ${kept} kept for members.`,
  doneFees:
    "The simulated PayPal sandbox reports each modelled fee with the item; none is shown until it arrives.",
  onPaypal: (pct: string, n: number, total: number) =>
    `On simulated PayPal: ${pct} of value (${n} of ${total} members)`,
  /**
   * The fan's one-line count, in the same words as the stage's Proof counter: what PayPal was sent, what it
   * confirmed, what waits on a person, and who is paid in cash. "8 sent through the simulated PayPal sandbox, 7 confirmed, 1 parked."
   */
  shareCounts: (c: {
    readonly onRail: number;
    readonly sent: number;
    readonly confirmed: number;
    readonly parked: number;
    readonly failed: number;
    readonly cash: number;
    readonly posting?: boolean;
  }) => {
    if (c.posting)
      return `Sent to the simulated PayPal sandbox. Confirmations land one by one. ${c.cash} in cash at the bodega.`;
    const paypal =
      c.sent === 0
        ? `${c.onRail} to send through the simulated PayPal sandbox once both keys sign`
        : [
            `${c.sent} sent through the simulated PayPal sandbox`,
            `${c.confirmed} confirmed`,
            ...(c.parked > 0 ? [`${c.parked} parked`] : []),
            ...(c.failed > 0 ? [`${c.failed} failed`] : []),
          ].join(", ");
    return `${paypal}. ${c.cash} in cash at the bodega.`;
  },
  shareValue: (pct: string) => `On simulated PayPal: ${pct} of value.`,
  cashBand: (n: number, date: string, amount: string) =>
    `${n} members, cash at the bodega on ${date}: ${amount}`,
  cashBandMembers: (n: number, date: string) => `${n} members, cash at the bodega on ${date}`,
  cashBandFirst: (n: number) => `${n} members, cash at`,
  cashBandSecond: (date: string) => `the bodega on ${date}`,
  movedToCash: (name: string) => `${name}, moved to cash`,
  title: "Run",
  feesSoFar:
    "The simulated PayPal sandbox reports each modelled fee with its item; none has arrived in this run's notices.",
  railCash: "Cash",
  statusWaiting: "Sent, waiting for simulated PayPal",
  parkedChip: "Parked",
  failedChip: "Simulated PayPal failed it",
  log: "Run log",
  lane: { MACHINE: "Machine", PEOPLE: "People", PAYPAL: "PayPal" },
  laneEmpty: {
    MACHINE: "Nothing from the machines yet.",
    PEOPLE: "Nobody has acted yet.",
    PAYPAL: "No PayPal notice yet.",
  },
  seededLog: "Seeded showcase history. Start a run to watch each notice arrive.",
  latency: "From funding to each confirmed payment",
  latencySummary: (p50: string, max: string) => `Median ${p50}, slowest ${max}`,
  latencyEmpty: "Confirmations appear here as the simulated PayPal sandbox sends them.",
  rheaWhy: (name: string, amount: string) =>
    `${name}'s address has no PayPal account, so the simulated PayPal sandbox parked ${amount} as unclaimed. It returns to the co-op by itself after 30 days, or you can decide now.`,
  payCash: "Pay in cash at the bodega",
  payCashUnavailable: "Moving a line to cash needs the live run. This is the seeded showcase.",
  srPayCash: (name: string, amount: string) =>
    `Pay ${name} ${amount} in cash at the bodega, changes a line, button`,
  resend: "Re-send after she confirms her email",
  resendNote: "Needs her confirmed email and your key on a new one-item batch",
  resendPending: "Re-sending needs a confirmed email address. Ask Rhea at the bodega first.",
  wait: "Or wait: she can join PayPal and claim it within 30 days. This simulator models claiming; PayPal's own sandbox is untested.",
  // S1.7's wording: the cash is due on cash day, not paid yet.
  rerouted: (_name: string, date: string) =>
    `Returned to the co-op's simulated PayPal balance. Cash at the bodega on ${date}.`,
  duplicate: "Delivery repeated, already applied.",
  figure: "Where the money goes",
  tableCaption: "Payout threads and cash lines",
  col: { member: "Member", rail: "Rail", amount: "Amount", status: "Status" },
  summaryCaption: "Run summary",
} as const;

interface SmsParts {
  readonly coop: string;
  readonly name: string;
  readonly status: string;
  readonly amount: string;
  readonly rail: "cash" | "paypal";
  readonly slips: string;
  readonly treasurer: string;
}

const smsRail = (p: SmsParts, cash: string, paypal: string) => (p.rail === "cash" ? cash : paypal);
const RAIL_WORDS = {
  ceb: (p: SmsParts) => smsRail(p, ", cash sa bodega", " sa simulated PayPal sandbox"),
  fil: (p: SmsParts) => smsRail(p, ", cash sa bodega", " sa simulated PayPal sandbox"),
  en: (p: SmsParts) => smsRail(p, ", in cash at the bodega", " through the simulated PayPal sandbox"),
} as const;

export const LINE = {
  loading: "Printing the line",
  notFound: "No member with that number in this run.",
  notFoundHelp: "Open the split review to see every line of this run.",
  receipt: "Why this is the number",
  slips: "Slips",
  slipCaption: (serial: string, photo: string, kg: string) => `Slip ${serial}, photo ${photo}, ${kg} net`,
  archived: "Archived photo",
  archivedNote: "Read earlier this season; the photo is archived.",
  history: "Line history",
  historyEmpty: "Nothing has happened to this line yet in this run.",
  seeded: "Seeded sample",
  approvedBy: (a: string, b: string) => `Approved by ${a} and ${b}`,
  signedBy: (who: string) => `${who} signed the batch`,
  holdRaised: (label: string) => `${label} raised by the engine`,
  holdResolved: (label: string, who: string) => `${label} resolved by ${who}`,
  paypalNotice: "Simulated PayPal sandbox notice, webhook",
  ourCancel: "Our cancel",
  creditName: "Returned multa",
  machineTranslated: en("W-JG-01.machineTranslated"),
  smsTitle: "SMS",
  smsPreview: "Preview, not sent",
  smsCount: (n: number, segments: number) =>
    segments > 1 ? `${n} characters, GSM-7, ${segments} messages` : `${n} characters, GSM-7`,
  smsUnicode: "Needs Unicode: longer messages, more cost",
  langLabel: "Language",
  langName: { ceb: "Cebuano", fil: "Filipino", en: "English" },
  sms: {
    ceb: (p: SmsParts) =>
      `${p.coop}: ${p.name}, ${p.status}: ${p.amount}${RAIL_WORDS.ceb(p)}. Resibo ${p.slips}. Pangutana: Treasurer ${p.treasurer}.`,
    fil: (p: SmsParts) =>
      `${p.coop}: ${p.name}, ${p.status}: ${p.amount}${RAIL_WORDS.fil(p)}. Resibo ${p.slips}. Tanong: Treasurer ${p.treasurer}.`,
    en: (p: SmsParts) =>
      `${p.coop}: ${p.name}, ${p.status}: ${p.amount}${RAIL_WORDS.en(p)}. Slips ${p.slips}. Questions: Treasurer ${p.treasurer}.`,
  },
  /** The same message without the questions line, then without the slips, when the full one passes 160. */
  smsNoHelp: {
    ceb: (p: SmsParts) =>
      `${p.coop}: ${p.name}, ${p.status}: ${p.amount}${RAIL_WORDS.ceb(p)}. Resibo ${p.slips}.`,
    fil: (p: SmsParts) =>
      `${p.coop}: ${p.name}, ${p.status}: ${p.amount}${RAIL_WORDS.fil(p)}. Resibo ${p.slips}.`,
    en: (p: SmsParts) =>
      `${p.coop}: ${p.name}, ${p.status}: ${p.amount}${RAIL_WORDS.en(p)}. Slips ${p.slips}.`,
  },
  smsShort: {
    ceb: (p: SmsParts) => `${p.coop}: ${p.name}, ${p.status}: ${p.amount}${RAIL_WORDS.ceb(p)}.`,
    fil: (p: SmsParts) => `${p.coop}: ${p.name}, ${p.status}: ${p.amount}${RAIL_WORDS.fil(p)}.`,
    en: (p: SmsParts) => `${p.coop}: ${p.name}, ${p.status}: ${p.amount}${RAIL_WORDS.en(p)}.`,
  },
  /**
   * A replayed status (fs-api's short frame, in the member's language; ceb and fil machine-translated, chipped):
   * never "Paid", and never this run's payment.
   */
  smsReplay: {
    ceb: (p: SmsParts) =>
      `${p.coop}: ${p.name}, ${p.amount}. Gi-replay (gilabelan): miaging simulated PayPal sandbox run; dili bayad niini nga run.`,
    fil: (p: SmsParts) =>
      `${p.coop}: ${p.name}, ${p.amount}. Ni-replay (may label): naunang simulated PayPal sandbox run; hindi bayad sa run na ito.`,
    en: (p: SmsParts) =>
      `${p.coop}: ${p.name}, ${p.amount}. Replayed (labelled): earlier simulated PayPal sandbox run; not this run's payment.`,
  },
  smsReplayShort: {
    ceb: (p: SmsParts) =>
      `${p.amount}. Gi-replay (gilabelan): miaging simulated PayPal sandbox run; dili bayad niini nga run.`,
    fil: (p: SmsParts) =>
      `${p.amount}. Ni-replay (may label): naunang simulated PayPal sandbox run; hindi bayad sa run na ito.`,
    en: (p: SmsParts) =>
      `${p.amount}. Replayed (labelled): earlier simulated PayPal sandbox run; not this run's payment.`,
  },
  pair: "Pair a phone",
  pairOffline: "Pairing a phone needs the live run. This is the seeded showcase.",
  srPair: (name: string) => `Pair a phone for ${name}, ${en("slab.consequence.reversible")}`,
  pairCode: "Pairing code",
  pairHow: "On the member's phone: Fair Split, then Pair, then type the code.",
  pairExpires: (time: string) => `Single use. Expires ${time}.`,
  print: "Print statement",
  markReceived: "Mark received",
  srMarkReceived: (name: string, amount: string) =>
    `Mark ${name}'s ${amount} received, ${en("slab.consequence.line")}`,
  markReceivedBefore: (date: string) => `Available on cash day, ${date}.`,
  markReceivedNotWired: "Recording a cash receipt isn't wired on the server yet. Nothing changed.",
  nadawat: "Nadawat",
  witness: "Witness",
  photograph: "Then photograph the Nadawat box. The co-op keeps the image; Proof shows only its hash.",
  cashFrom: (usd: string, rate: string) => `From ${usd} at ${rate} to the dollar`,
  cashLabel: "Cash at the bodega",
  paypalLabel: "To her or his PayPal",
  printTitle: "Pay statement",
  printSeal: "Batch seal",
  printRateCard: (hash: string, card: string) => `Rate card ${hash}, ${card}, approved by the Board`,
  printSlips: (slips: string, kg: string) => `From slips ${slips}: ${kg}`,
  printQuestions: (treasurer: string) => `Questions? See Treasurer ${treasurer} at the bodega.`,
  printSynthetic: "Synthetic sample. No real farmer was paid.",
  printButton: "Print",
  printBack: "Back to the line",
  printPaypal: "Paid through the simulated PayPal sandbox. This copy is for the member's records.",
  printHeld: "Still checking. This line prints its amount once every hold on it is decided.",
  printQrPending: "The member's own link prints here once statement links are issued.",
  nadawatHow: "Signature or thumbmark",
  cashDay: (date: string) => `Cash day ${date}`,
  receiptPremium: "Premium, never deducted (R0)",
  receiptBonus: "Quality bonus",
  receiptNet: "Net",
} as const;
