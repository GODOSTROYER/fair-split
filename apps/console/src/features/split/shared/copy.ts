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
  allDecided: "Every hold decided",
  decidedKey1: "Every hold decided · Analyn signed",
  decidedApproved: "Every hold decided · both keys signed",
  decidedSettled: "Every hold decided · settled",
  /** Settled with cash still due at the bodega: PayPal's part is complete, the run is not (round 3). */
  decidedCashDue: "Every hold decided · PayPal complete · cash due",
  /** A replay run never promises fresh simulator confirmations (inv.i8). */
  decidedReplayed: "Every hold decided · both keys signed · payouts replayed (labelled)",
  /** The open decisions as counts: "3 holds open · 1 by hand". Nothing that is zero is said. */
  summary: (holds: number, byHand: number) =>
    [
      ...(holds > 0 ? [holds === 1 ? "1 hold open" : `${holds} holds open`] : []),
      ...(byHand > 0 ? [`${byHand} by hand`] : []),
    ].join(" · "),
  approveLink: "Open Approve",
  nextHold: (label: string, title: string) => `Open ${label}: ${title}`,
  byHandNext: (slip: string) => `Enter slip ${slip} by hand`,
  filters: "Filter lines",
  filter: { all: "All", held: "Held", byHand: "By hand", paypal: "PayPal", cash: "Cash" },
  /** The rail filters before the batch posts: the lines' planned rails, not payments. */
  railPlanned: "planned",
  railPlannedTitle: "Rails as planned: nothing is sent before both keys sign",
  allColumns: "All columns",
  fewerColumns: "Fewer columns",
  columns: "Columns",
  title: "Split review",
  /**
   * The header's one provenance line, trimmed (round 3): the labelled run and the rate card, their ids in the id
   * role ("run r37 · rate card f2d7 026d"). The lines, the engine and what the lines include are its title.
   */
  runWord: (showcase: boolean) => (showcase ? "showcase run" : "run"),
  rateCardWord: "rate card",
  provenanceTitle: (lines: number, basis: string) => `${lines} lines · engine v1 · ${basis}`,
  /** The grid's column words in the console's English (round 3): the money column says its currency. */
  netColumn: "Net US$",
  deductionsColumn: "Deductions",
  /** The footer says what its figure is. */
  totalsLabel: "Member net total",
  /** The reconciliation above the grid: pool − deductions (+ credits) = member net, every figure the engine's. */
  reconcile: {
    pool: "Pool",
    deductions: "deductions",
    credits: "credits",
    net: "member net",
  },
  reconcileSpoken: (pool: string, deductions: string, credits: string | null, net: string) =>
    `Pool ${pool} minus deductions ${deductions}${credits ? ` plus credits ${credits}` : ""} equals member net ${net}`,
  /** A narrow grid opens a line's calculation under it. */
  showParts: (name: string) => `Show ${name}'s premium, bonus and deductions`,
  partsColumn: "Parts",
  basis: {
    read: "before slip 0462",
    byHand: "after slip 0462 by hand",
    resolved: "every decision so far",
  },
  balancedTitle: (gross: string) =>
    `Gross = pool, to the cent (${gross}). Net + ruled deductions − credits = pool.`,
  premiumLock: "R0 · never deducted",
  dialWas: (was: string) => `was ${was}`,
  dialLimit: (limit: string) => `limit ±${limit}`,
  dialSpoken: (value: string) => `Mass balance ${value} percent`,
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
  /** The Verified kg cell's title: what the kilos make per registered tree, against the limit. */
  perTreeTitle: (kg: string, trees: number, limit: string) =>
    `${kg} kg a tree from ${trees} registered trees; the limit is ${limit}`,
  /** The duplicate badge (round 4): "0457 ×2" while its hold is open, "0457 counted once" once decided. */
  countedTwice: (serial: string) => `${serial} ×2`,
  countedOnce: (serial: string) => `${serial} counted once`,
  /** H2's note under Merlyn's line (round 4): the figure the hold is about, and its limit. */
  perTreeNote: (kg: string) => `${kg} kg a tree`,
  perTreeNoteMicro: (limit: string, trees: number) => `limit ${limit} kg · ${trees} registered trees`,
  openNote: (label: string) => `Open ${label}`,
  movedToCash: "Moved to cash",
  /** The console is English: "Held" and "Reserved"; Cebuano ("Gisusi pa") lives on the phone. */
  reserved: "Reserved",
  reservedTitle: "Reserved, never redistributed",
  held: "Held",
  openLine: (name: string) => `Open ${name}'s line`,
  openHold: (label: string, name: string) => `Open hold ${label} on ${name}'s line`,
  dialPending: (slip: string) => `Waits for slip ${slip}`,
  dialInside: "Inside limit",
  dialOutside: "Over limit",
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
  overrideNote: "Two deliveries, an override: Ernesto co-signs it with the batch (R5).",
  // One line plus the decision (unslop spec §3.7). Every figure arrives from the engine's facts.
  h1EngineInside: (amount: string, members: number, shrink: string, limit: string) =>
    `Counting both moves ${amount} from ${members} members. Shrink ${shrink}, inside the ${limit} limit until slip 0462 is in.`,
  /** Counting both, as a number line (round 3): what leaves the 63 and where it lands. */
  h1Flow: (amount: string, members: number, name: string) =>
    `${members} members −${amount} → ${name} +${amount}`,
  /**
   * H1's one effect line (round 4), directly above "Count it once": what counting it once does to the money and the
   * dial. The drawer has no engine row and no dial of its own.
   */
  h1Effect: (amount: string, members: number, shrinkBoth: string, shrinkOnce: string) =>
    `If counted once: +${amount} to ${members} members · ${shrinkBoth} → ${shrinkOnce}`,
  h1EffectInside: (amount: string, members: number) =>
    `If counted once: +${amount} to ${members} members · mass balance after slip 0462`,
  /** A hold's gate as its status pill (round 4): a few words, never a sentence with a full stop. */
  gate: { BLOCKS_APPROVAL: "Blocks approval", RESERVES_LINE: "Reserves this line" } as Readonly<
    Record<string, string>
  >,
  h1TitleOnce: (slip: string) => `Slip ${slip}, counted once`,
  h1TitleTwo: (slip: string) => `Slip ${slip}, two deliveries`,
  h1Returned: (amount: string, members: number) => `+${amount} back to ${members} members`,
  h2Title: (name: string, perTree: string) => `${name}: ${perTree} kg a tree`,
  h2TitleDone: (name: string) => `${name}, plot registered`,
  h2Engine: (kg: string, trees: number, limit: string) =>
    `${kg} from ${trees} registered trees. The limit is ${limit} kg a tree.`,
  h3Title: (slip: string) => `Slip ${slip}, a fine with no rule`,
  h3TitleDone: (slip: string) => `Slip ${slip}, fine returned`,
  h3Engine: (mark: string) => `${mark} matches no Schedule A rule.`,
  yieldEffect: (_plot: string) => "Her kilos and pay don't change.",
  creditReturned: (credit: string) => `+${credit} credit, paid by the co-op`,
  ruleOk: (rule: string) => `Matches ${rule}`,
  twoDeliveries: "Two deliveries",
  twoDeliveriesNote: "A reason, then the Chair",
  twoDeliveriesTitle: "Why are these two deliveries?",
  twoDeliveriesHint: "Say what the clerk or the member told you. The Chair reads this before he signs.",
  reasonLabel: "Reason",
  reasonSubmit: "Count both, with this reason",
  reasonCancel: "Keep it open",
  fieldsMatch: (n: number, total: number) => `${n}/${total} fields match`,
  fieldsMatchSpoken: (n: number, total: number) =>
    n === total ? `${n} of ${total} fields match. Same slip.` : `${n} of ${total} fields match.`,
  compareCaption: "The two copies, field by field",
  field: { serial: "Serial", date: "Date", member: "Member", net: "Net kg" },
  copyWhite: "white original",
  copyPink: "pink duplicate",
  copyYellow: "yellow copy",
  photo: (id: string) => `Photo ${id}`,
  copyCaption: (id: string, copy: string) => `${id} · ${copy}`,
  slipAlt: (serial: string, copy: string, photo: string) => `Slip ${serial}, ${copy}, photo ${photo}`,
  shrinkNow: "Mass balance now",
  shrinkInside: (shrink: string, limit: string) => `Shrink ${shrink}, inside the ${limit} limit.`,
  plotsTitle: "Registered plots",
  plotRegistered: (no: string, ha: string, trees: number) => `${no} · ${ha} ha · ${trees} trees`,
  plotPending: (no: string, ha: string, trees: number) => `${no} · ${ha} ha · ${trees} trees`,
  plotNotRegistered: "Not registered",
  plotPrivate: "Plot points stay private",
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
  closedListLabel: "Schedule A",
  rules: [
    { id: "R1", name: "CBU" },
    { id: "R2", name: "hauling" },
    { id: "R3", name: "loan" },
    { id: "R4", name: "advance" },
  ],
  creditEffect: (credit: string) => `+${credit} correction credit from the co-op · others unchanged`,
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
  signing: "Signing",
  /** The signers' count beside their title (unslop spec §3.9): "0/2 signed". */
  signedCount: (n: number) => `${n}/2 signed`,
  /** The two named signers beside the seal (UI gate round 3). */
  signersTitle: (officers: number) =>
    officers === 2 ? "Two officers sign this batch" : "One officer signs this batch",
  batchHashLabel: "Batch hash",
  /** The hero's label: what the amount is, before the tag says where it runs. */
  heroLabel: (count: number) => `PayPal batch · ${count === 1 ? "1 payout" : `${count} payouts`}`,
  railLabel: "The batch and the cash, by value",
  legendPaypal: "PayPal",
  legendCash: "Cash at the bodega",
  checksLabel: "Checks before signing",
  checkOpen: "Open",
  checkHolds: "Holds resolved",
  checkShrink: "Shrink within limit",
  checkLines: "Lines explained",
  checkRateCard: "Rate card unchanged",
  byHand: (n: number) => `${n} by hand`,
  since: (date: string) => `since ${date}`,
  /** The details' summary: the fees and the hashes stay one click away (spec §3.9). */
  detailsSummary: (fees: string) => `Fees ≈ ${fees} · what both keys sign`,
  keyName: { treasurer: "Analyn · Treasurer", chair: "Ernesto · Chair" },
  /** Why the Chair's key: "> US$300 · R5". */
  chairWhy: (threshold: string, ruleId: string) => `> ${threshold} · ${ruleId}`,
  tagDemoKey: "Demo key",
  tagSampleKey: "Sample key",
  keyBrowser: "browser key",
  keyDevice: "device key",
  keyWebCrypto: "Made by WebCrypto in this browser; the private half can't be exported.",
  keyNoble: "Held in this page's memory for this session; it never leaves the browser.",
  keyDemoChair: "Made in the Chair's phone frame.",
  waitingKey: en("W-TR-07.key.waiting"),
  presence: (hold: string) => en("W-TR-07.presence", { hold }),
  presenceApproval: "Ernesto is reviewing the batch",
  sameOnPhone: "Same seal on Ernesto's phone",
  approved: en("W-TR-07.approved"),
  postedLink: "Watch the payments land",
  watchPayouts: "Watch the payouts",
  posting: (batch: string) => `Posting ${batch} · re-hashed, it matches`,
  posted: "Batch accepted",
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
  linesNote: (lines: number, cash: number) => `· all ${lines} lines, ${cash} cash · recomputed here`,
  rateCard: "Rate card",
  signTitle: "What both keys sign",
  voided: (time: string) =>
    `Both approvals voided at ${time}. A payout changed after signing, so nothing was sent. Review and sign again.`,
  voidedKey: (time: string) => `Voided ${time}`,
  cosignTitle: "Co-sign on your phone",
  cosignMake: "Make a co-sign code",
  cosignCode: "Type it on the phone, once",
  cosignLink: "Open the pairing link",
  cosignExpires: (time: string) => `expires ${time}`,
  cosignFrame: "Or sign in the Chair frame",
  feesLabel: en("W-TR-07.feesLabel"),
  safeEngine: "Engine",
} as const;

export const FANOUT = {
  loading: "Drawing the fan",
  notPosted: "Not posted yet.",
  notPostedLink: "Open Approve",
  /** The run's instrument: "7/8" over "confirmed". */
  confirmedWord: "confirmed",
  confirmedOnPaypal: "confirmed on PayPal",
  posted: (time: string, clock: string) => `posted ${time} · ${clock}`,
  postedSeeded: "posted · confirming",
  needsYou: (n: number) => `${n} needs you`,
  cashDue: (n: number, date: string) => `${n} cash due ${date}`,
  cashPaid: (n: number) => `${n} paid in cash`,
  dueOn: (date: string) => `due ${date}`,
  replayedStatus: "Payout statuses replayed (labelled) from an earlier simulated PayPal sandbox run.",
  denied: "The simulated PayPal sandbox declined the batch. No money moved.",
  /** The money bar under the fan (spec §1.9): one legend row per state, the tag at its head. */
  shareLabel: "Where the run's money went, by value",
  shareTitle: "By value",
  legend: {
    planned: "To send",
    flight: "Sent",
    confirmed: "Confirmed",
    held: "Parked",
    failed: "Failed",
    returned: "Returned",
    replayed: "Replayed (labelled)",
    cash: "Cash at the bodega",
    kept: "Kept for members",
  },
  replayedShare: (sent: number, successful: number) =>
    `${sent} payout statuses replayed (labelled), ${successful} successful in the earlier simulated PayPal sandbox run.`,
  cashBandMembers: (n: number) => `${n} members · cash at the bodega`,
  movedToCash: (name: string) => `${name} → cash`,
  title: "Run",
  feesSoFar: "Simulated PayPal fees: none in this run's notices yet.",
  feesReplayed: "Fees belong to the earlier simulated run (labelled replay).",
  timingReplayed: "Timing replayed (labelled) from an earlier simulated run.",
  /** The run's remaining action while cash is due at the bodega: the run pill's words, said where the cash is. */
  reviewCash: en("W-JG-01.pill.cashDue"),
  railCash: "Cash",
  statusWaiting: "Sent, waiting for simulated PayPal",
  parkedChip: "Parked",
  failedChip: "Simulated PayPal failed it",
  log: "Run log",
  latest: "Latest",
  showAll: (n: number) => `All ${n} events`,
  lane: { MACHINE: "Machine", PEOPLE: "People", PAYPAL: "PayPal" },
  laneEmpty: {
    MACHINE: "Nothing from the machines yet.",
    PEOPLE: "Nobody has acted yet.",
    PAYPAL: "No PayPal notice yet.",
  },
  logEmpty: "Nothing has happened in this run yet.",
  seededLog: "Seeded showcase history",
  latency: "Funding to confirmation",
  latencySummary: (p50: string, max: string) => `median ${p50} · slowest ${max}`,
  latencyEmpty: "No confirmations yet",
  latencySeeded: "Timed only on a live run",
  rheaLine: "No PayPal account · unclaimed",
  rheaReplayed: "Unclaimed in the earlier simulated PayPal sandbox run · a labelled replay",
  returns: "returns to the co-op in 30 days",
  payCash: "Pay in cash at the bodega",
  payCashUnavailable: "Moving a line to cash needs the live run. This is the seeded showcase.",
  srPayCash: (name: string, amount: string) =>
    `Pay ${name} ${amount} in cash at the bodega, changes a line, button`,
  resend: "Re-send",
  resendNote: "her email + your key",
  resendPending: "needs her confirmed email first",
  // S1.7's wording: the cash is due on cash day, not paid yet.
  rerouted: (name: string) => `${name} → cash at the bodega`,
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
