// en / ceb / fil words for every status in register §7. A raw state name is never rendered.
// Member-line words are S1.10's table verbatim. Every ceb and fil string is machine-translated,
// pending native review (OD-2), until signed off in i18n/REVIEW.md.
// Names are never hard-coded: `{treasurer}` and `{chair}` are filled from the registry.
import type {
  HoldGate,
  HoldKind,
  HoldState,
  InvoiceStatus,
  MemberLineState,
  PayoutItemStatus,
  PayRunState,
  Rail,
  RunStripStep,
} from "./enums.js";
import type { Lang, Provenance } from "./primitives.js";

export const LABEL_REVIEW_STATUS = "Machine-translated, pending native review" as const;

export interface Words {
  en: string;
  ceb: string;
  fil: string;
}

/** Member copy in three languages plus the console word (English, using the co-op's words). */
export interface LineWords extends Words {
  console: string;
}

export const MEMBER_LINE_LABELS: Readonly<Record<MemberLineState, LineWords>> = {
  COMPUTED: { ceb: "Gisusi pa", fil: "Sinusuri pa po", en: "Still checking", console: "Ready" },
  READY: { ceb: "Gisusi pa", fil: "Sinusuri pa po", en: "Still checking", console: "Ready" },
  HELD: { ceb: "Gisusi pa", fil: "Sinusuri pa po", en: "Still checking", console: "Gisusi pa" },
  EXCLUDED: {
    ceb: "Ibalhin sa sunod nga bayad",
    fil: "Ililipat po sa susunod na bayad",
    en: "Moved to the next pay run",
    console: "Excluded, carried over",
  },
  LOCKED: {
    ceb: "Gipadala na, naghulat sa PayPal",
    fil: "Naipadala na po, hinihintay ang PayPal",
    en: "Sent, waiting for PayPal",
    console: "Sent",
  },
  SUBMITTED: {
    ceb: "Gipadala na, naghulat sa PayPal",
    fil: "Naipadala na po, hinihintay ang PayPal",
    en: "Sent, waiting for PayPal",
    console: "Sent",
  },
  PAYPAL_PENDING: {
    ceb: "Gipadala na, naghulat sa PayPal",
    fil: "Naipadala na po, hinihintay ang PayPal",
    en: "Sent, waiting for PayPal",
    console: "Sent",
  },
  PAID: { ceb: "Bayad na", fil: "Bayad na po", en: "Paid", console: "Paid" },
  OFF_RAIL_DUE: {
    ceb: "Andam sa bodega",
    fil: "Handa na po sa bodega",
    en: "Ready at the bodega",
    console: "Cash due",
  },
  OFF_RAIL_PAID: { ceb: "Nadawat", fil: "Natanggap na po", en: "Received", console: "Cash received" },
  UNCLAIMED: {
    ceb: "Wala madawat sa PayPal",
    fil: "Hindi po natanggap sa PayPal",
    en: "Not received through PayPal",
    console: "Parked",
  },
  RETURNED: {
    ceb: "Gibalik sa co-op",
    fil: "Ibinalik po sa co-op",
    en: "Returned to the co-op",
    console: "Returned",
  },
  REROUTED: { ceb: "Gipadala pag-usab", fil: "Ipinadala pong muli", en: "Sent again", console: "Re-routed" },
  PAYPAL_HELD: {
    ceb: "Gipugngan sa PayPal",
    fil: "Hinahawakan po ng PayPal",
    en: "PayPal is holding it",
    console: "Held by PayPal",
  },
  NEEDS_ACTION: {
    ceb: "Wala molampos sa PayPal",
    fil: "Hindi po natuloy sa PayPal",
    en: "PayPal didn't complete it",
    console: "Needs action",
  },
  REVERSED: { ceb: "Gibawi", fil: "Binawi po", en: "Reversed", console: "Reversed" },
};

/** Added to the console word of a HELD line whose hold only reserves it. */
export const RESERVED_LINE_NOTE: Words = {
  en: "Reserved, never redistributed.",
  ceb: "Gireserba, dili ipanghatag sa uban.",
  fil: "Nakareserba, hindi ipapamahagi sa iba.",
};

/** Run pill words (S1.10). */
export const RUN_STATE_LABELS: Readonly<Record<PayRunState, Words>> = {
  DRAFT: { en: "Draft", ceb: "Borador", fil: "Borador" },
  QUOTED: { en: "Quoted", ceb: "Nakwenta na ang invoice", fil: "Nakuwenta na ang invoice" },
  INVOICED: { en: "Sent to Lantern Bay", ceb: "Gipadala sa Lantern Bay", fil: "Ipinadala sa Lantern Bay" },
  FUNDED: { en: "Funded", ceb: "Napondohan na", fil: "Napondohan na" },
  EXTRACTING: { en: "Reading slips", ceb: "Gibasa ang mga resibo", fil: "Binabasa ang mga resibo" },
  COMPUTED: { en: "Lines computed", ceb: "Nakwenta na ang mga linya", fil: "Nakuwenta na ang mga linya" },
  IN_REVIEW: { en: "In review", ceb: "Gisusi pa", fil: "Sinusuri pa" },
  TREASURER_APPROVED: {
    en: "Approved by {treasurer}",
    ceb: "Giaprobahan ni {treasurer}",
    fil: "Inaprubahan ni {treasurer}",
  },
  AWAITING_BOARD: { en: "Waiting for {chair}", ceb: "Naghulat kang {chair}", fil: "Hinihintay si {chair}" },
  APPROVED: { en: "Approved", ceb: "Giaprobahan na", fil: "Aprobado na" },
  POSTING: { en: "Posting to PayPal", ceb: "Gipadala sa PayPal", fil: "Ipinapadala sa PayPal" },
  POSTED: { en: "Posted", ceb: "Napadala na", fil: "Naipadala na" },
  SETTLING: { en: "PayPal confirming", ceb: "Gikumpirma sa PayPal", fil: "Kinukumpirma ng PayPal" },
  NEEDS_FOLLOW_UP: { en: "Needs a decision", ceb: "Kinahanglan og desisyon", fil: "Kailangan ng desisyon" },
  SETTLED: { en: "Settled", ceb: "Nahusay na", fil: "Naayos na" },
  CLOSED: { en: "Closed", ceb: "Sirado na", fil: "Sarado na" },
  CANCELLED: { en: "Cancelled", ceb: "Gikansela", fil: "Kinansela" },
  DENIED: { en: "Declined by PayPal", ceb: "Gibalibaran sa PayPal", fil: "Tinanggihan ng PayPal" },
  HALTED: { en: "Paused", ceb: "Gihunong sa una", fil: "Itinigil muna" },
};

/** Hold words (S1.10). LOW_CONFIDENCE shows as "By hand"; MASS_BALANCE as the dial. */
export const HOLD_KIND_LABELS: Readonly<Record<HoldKind, Words>> = {
  DUPLICATE_SLIP: {
    en: "Same slip twice",
    ceb: "Parehas nga resibo, kaduha",
    fil: "Parehong resibo, dalawang beses",
  },
  IMPLAUSIBLE_YIELD: {
    en: "More than the plot can grow",
    ceb: "Labaw sa maabot sa uma",
    fil: "Higit sa kayang ibunga ng taniman",
  },
  NO_RULE: { en: "Deduction with no rule", ceb: "Kaltas nga walay lagda", fil: "Kaltas na walang patakaran" },
  RATE_MISMATCH: { en: "Rate differs from the card", ceb: "Lahi sa rate card", fil: "Iba sa rate card" },
  SUSPECTED_INJECTION: {
    en: "Text that reads like an instruction",
    ceb: "Sulat nga morag mando",
    fil: "Sulat na parang utos",
  },
  LOW_CONFIDENCE: { en: "By hand", ceb: "Isulat sa kamot", fil: "Isusulat nang mano-mano" },
  MASS_BALANCE: { en: "Mass balance", ceb: "Balanse sa timbang", fil: "Balanse ng timbang" },
};

/** Gate chips (design §5). */
export const HOLD_GATE_LABELS: Readonly<Record<HoldGate, Words>> = {
  BLOCKS_APPROVAL: {
    en: "Blocks approval. Changes kilos.",
    ceb: "Babagan ang pag-apruba. Mausab ang kilo.",
    fil: "Hinaharang ang pag-apruba. Nagbabago ang kilo.",
  },
  RESERVES_LINE: {
    en: "Reserves this line only. Never redistributed.",
    ceb: "Kini ra nga linya ang gireserba. Dili ipanghatag sa uban.",
    fil: "Ang linyang ito lang ang nakareserba. Hindi ipapamahagi sa iba.",
  },
};

export const HOLD_STATE_LABELS: Readonly<Record<HoldState, Words>> = {
  OPEN: { en: "Needs a decision", ceb: "Kinahanglan og desisyon", fil: "Kailangan ng desisyon" },
  ASKED_CHAIR: { en: "Asked {chair}", ceb: "Gipangutana si {chair}", fil: "Tinanong si {chair}" },
  RESOLVED: { en: "Resolved", ceb: "Nahusay na", fil: "Naayos na" },
  EXCLUDED: {
    en: "Excluded, carried over",
    ceb: "Gibalhin sa sunod nga bayad",
    fil: "Inilipat sa susunod na bayad",
  },
};

/** Console words for PayPal's item statuses. UNCLAIMED is "Parked", never a failure. */
export const PAYOUT_ITEM_STATUS_LABELS: Readonly<Record<PayoutItemStatus, Words>> = {
  SUBMITTED: { en: "Sent", ceb: "Gipadala na", fil: "Naipadala na" },
  PENDING: { en: "Waiting for PayPal", ceb: "Naghulat sa PayPal", fil: "Hinihintay ang PayPal" },
  ONHOLD: { en: "Held by PayPal", ceb: "Gipugngan sa PayPal", fil: "Hinahawakan ng PayPal" },
  UNCLAIMED: { en: "Parked", ceb: "Wala madawat sa PayPal", fil: "Hindi natanggap sa PayPal" },
  RETURNED: { en: "Returned to the co-op", ceb: "Gibalik sa co-op", fil: "Ibinalik sa co-op" },
  FAILED: { en: "PayPal didn't complete it", ceb: "Wala molampos sa PayPal", fil: "Hindi natuloy sa PayPal" },
  BLOCKED: { en: "Blocked by PayPal", ceb: "Gibabagan sa PayPal", fil: "Hinarang ng PayPal" },
  SUCCESS: { en: "Paid", ceb: "Bayad na", fil: "Bayad na" },
  REFUNDED: { en: "Refunded", ceb: "Gi-refund", fil: "Ni-refund" },
  REVERSED: { en: "Reversed", ceb: "Gibawi", fil: "Binawi" },
};

/** Run strip on W-TR-01 (register §7). */
export const RUN_STRIP_LABELS: Readonly<Record<RunStripStep, Words>> = {
  RATIFIED: { en: "Ratified", ceb: "Gipalig-on", fil: "Pinagtibay" },
  FUNDED: { en: "Funded", ceb: "Napondohan", fil: "Napondohan" },
  READ: { en: "Read", ceb: "Nabasa", fil: "Nabasa" },
  CHECKED: { en: "Checked", ceb: "Nasusi", fil: "Nasuri" },
  APPROVED: { en: "Approved", ceb: "Giaprobahan", fil: "Inaprubahan" },
  PAID: { en: "Paid", ceb: "Nabayran", fil: "Nabayaran" },
};

/** I8: provenance labels. "Live" is never used for sandbox calls (S1.10 word list). */
export const PROVENANCE_LABELS: Readonly<Record<Provenance, Words>> = {
  live: { en: "Real sandbox call", ceb: "Tinuod nga sandbox call", fil: "Totoong sandbox call" },
  replay: {
    en: "Replay of a recorded run",
    ceb: "Replay sa narekord nga run",
    fil: "Replay ng nairekord na run",
  },
  simulated_rail: { en: "Simulated rail", ceb: "Simulated nga rail", fil: "Simulated na rail" },
  seeded: { en: "Seeded sample", ceb: "Sample nga gi-seed", fil: "Sample na naka-seed" },
};

export const INVOICE_STATUS_LABELS: Readonly<Record<InvoiceStatus, Words>> = {
  DRAFT: { en: "Draft", ceb: "Borador", fil: "Borador" },
  SENT: { en: "Sent to Lantern Bay", ceb: "Gipadala sa Lantern Bay", fil: "Ipinadala sa Lantern Bay" },
  SCHEDULED: { en: "Scheduled", ceb: "Naka-iskedyul", fil: "Naka-iskedyul" },
  UNPAID: { en: "Waiting for payment", ceb: "Naghulat sa bayad", fil: "Hinihintay ang bayad" },
  PAYMENT_PENDING: { en: "Payment pending", ceb: "Naghulat pa ang bayad", fil: "Nakabinbin ang bayad" },
  PARTIALLY_PAID: { en: "Partly paid", ceb: "Bahin pa ang nabayran", fil: "Bahagya pa lang ang bayad" },
  PAID: { en: "Paid by Lantern Bay", ceb: "Gibayran sa Lantern Bay", fil: "Binayaran ng Lantern Bay" },
  MARKED_AS_PAID: {
    en: "Marked as paid in sandbox",
    ceb: "Gimarkahan nga bayad sa sandbox",
    fil: "Minarkahang bayad sa sandbox",
  },
  CANCELLED: { en: "Cancelled", ceb: "Gikansela", fil: "Kinansela" },
  REFUNDED: { en: "Refunded", ceb: "Gi-refund", fil: "Ni-refund" },
  PARTIALLY_REFUNDED: { en: "Partly refunded", ceb: "Bahin nga gi-refund", fil: "Bahagyang ni-refund" },
  MARKED_AS_REFUNDED: {
    en: "Marked as refunded",
    ceb: "Gimarkahan nga gi-refund",
    fil: "Minarkahang ni-refund",
  },
};

export const RAIL_LABELS: Readonly<Record<Rail, Words>> = {
  PAYPAL: { en: "PayPal", ceb: "PayPal", fil: "PayPal" },
  CASH: { en: "Cash at the bodega", ceb: "Cash sa bodega", fil: "Cash sa bodega po" },
};

export interface LabelVars {
  treasurer?: string;
  chair?: string;
}

/** Picks a language and fills `{treasurer}` / `{chair}`. Missing names are left as an initial-free word. */
export function pickLabel(words: Words, lang: Lang, vars: LabelVars = {}): string {
  const raw = words[lang];
  return raw
    .replaceAll("{treasurer}", vars.treasurer ?? "the treasurer")
    .replaceAll("{chair}", vars.chair ?? "the Chair");
}

/** Console word for a member line, adding the reserved note for RESERVES_LINE holds. */
export function consoleLineLabel(state: MemberLineState, reserved = false): string {
  const base = MEMBER_LINE_LABELS[state].console;
  return state === "HELD" && reserved ? `${base}. ${RESERVED_LINE_NOTE.en}` : base;
}
