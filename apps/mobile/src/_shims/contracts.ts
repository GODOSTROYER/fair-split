/**
 * TEMPORARY SHIM: replace with @fairsplit/contracts after WS-CORE merges.
 *
 * Mirrors the decision register's names and shapes exactly, and only the parts apps/mobile reads:
 * §4 screen IDs and routes, §7 states and member status words, §8 the signed approval payload,
 * §11 IC-01 RunEvent names. Keep it minimal so the swap is a mechanical import change.
 */

/* ------------------------------------------------------------------ languages, roles, provenance */

export const LANGS = ["ceb", "fil", "en"] as const;
export type Lang = (typeof LANGS)[number];

export type Role = "brand" | "treasurer" | "board" | "clerk" | "member" | "judge" | "operator";
/** The three roles the Fair Split app binds a phone to (register §4, app navigation). */
export type AppRole = Extract<Role, "member" | "clerk" | "board">;

/** Invariant I8: every row says where it came from, and the UI labels anything that is not live. */
export type Provenance = "live" | "replay" | "simulated_rail" | "seeded";

/* ------------------------------------------------------------------ §7 states */

export const RUN_STATES = [
  "DRAFT",
  "QUOTED",
  "INVOICED",
  "FUNDED",
  "EXTRACTING",
  "COMPUTED",
  "IN_REVIEW",
  "TREASURER_APPROVED",
  "AWAITING_BOARD",
  "APPROVED",
  "POSTING",
  "POSTED",
  "SETTLING",
  "NEEDS_FOLLOW_UP",
  "SETTLED",
  "CLOSED",
  "CANCELLED",
  "DENIED",
  "HALTED",
] as const;
export type RunState = (typeof RUN_STATES)[number];

export const LINE_STATES = [
  "COMPUTED",
  "READY",
  "HELD",
  "EXCLUDED",
  "OFF_RAIL_DUE",
  "OFF_RAIL_PAID",
  "LOCKED",
  "SUBMITTED",
  "PAYPAL_PENDING",
  "PAID",
  "UNCLAIMED",
  "PAYPAL_HELD",
  "NEEDS_ACTION",
  "REVERSED",
  "RETURNED",
  "REROUTED",
] as const;
export type LineState = (typeof LINE_STATES)[number];

export type HoldKind =
  | "DUPLICATE_SLIP"
  | "IMPLAUSIBLE_YIELD"
  | "NO_RULE"
  | "RATE_MISMATCH"
  | "SUSPECTED_INJECTION"
  | "LOW_CONFIDENCE"
  | "MASS_BALANCE";
export type HoldGate = "BLOCKS_APPROVAL" | "RESERVES_LINE";
export type HoldState = "OPEN" | "ASKED_CHAIR" | "RESOLVED" | "EXCLUDED";

/** Payout item ranks (register §7). A status applies only if its rank is higher than the current one. */
export const ITEM_STATUS_RANK = {
  PENDING: 10,
  ONHOLD: 20,
  UNCLAIMED: 30,
  RETURNED: 40,
  FAILED: 50,
  BLOCKED: 50,
  SUCCESS: 60,
  REFUNDED: 70,
  REVERSED: 70,
} as const;
export type ItemStatus = keyof typeof ITEM_STATUS_RANK;

/** Webhook event names map to statuses before ranking: SUCCEEDED→SUCCESS, HELD→ONHOLD, CANCELED→RETURNED. */
export const ITEM_EVENT_TO_STATUS: Readonly<Record<string, ItemStatus>> = {
  SUCCEEDED: "SUCCESS",
  HELD: "ONHOLD",
  CANCELED: "RETURNED",
  UNCLAIMED: "UNCLAIMED",
  FAILED: "FAILED",
  RETURNED: "RETURNED",
  BLOCKED: "BLOCKED",
  REFUNDED: "REFUNDED",
  REVERSED: "REVERSED",
};

/* ------------------------------------------------------------------ IC-01 RunEvent */

export const RUN_EVENT_TYPES = [
  "run.state",
  "line.state",
  "item.updated",
  "hold.raised",
  "hold.resolved",
  "field.entered",
  "extract.row",
  "extract.field",
  "extract.quarantined",
  "approval.signed",
  "approval.declined",
  "presence",
  "webhook.received",
  "invoice.state",
  "policy.verdict",
  "agent.delta",
  "capture.synced",
  "flag.changed",
] as const;
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

export type ActorKind = "human" | "agent" | "system" | "paypal";

/** SSE envelope (S3): `{id, ws, runId, type, at, actor:{kind,id,impersonatedBy?}, provenance, payload}`. */
export interface RunEvent<T extends RunEventType = RunEventType, P = unknown> {
  id: string;
  ws: string;
  runId: string;
  type: T;
  at: string;
  actor: { kind: ActorKind; id: string; impersonatedBy?: string };
  provenance: Provenance;
  payload: P;
}

export interface ItemUpdatedPayload {
  senderItemId: string;
  memberNo: string;
  status: ItemStatus;
  /** PayPal's own `transaction_status`; colour and copy follow it, never a test value. */
  transactionStatus?: string;
  payoutItemId?: string;
  source: "webhook" | "status_check";
  signature?: "self" | "postback" | "dev_mock";
}

export interface ApprovalSignedPayload {
  role: ApprovalRole;
  keyId: string;
  approverId: string;
}

export interface PresencePayload {
  persona: string;
  view: string;
}

export interface CaptureSyncedPayload {
  captureId: string;
  documentId: string;
  rowsRead?: number;
  serial?: string;
}

/* ------------------------------------------------------------------ §8 signed approval payload */

export type ApprovalRole = "TREASURER" | "CHAIR";

/**
 * Signed payload (register §8): JCS{v, runId, seasonId, rateCardSha256, batchSha256, itemCount, totalCents,
 * currency, role, approverId, nonce, exp}. The server issues it; the phone checks it against what it shows and signs
 * the RFC 8785 bytes with Ed25519.
 */
export interface ApprovalPayload {
  v: 1;
  runId: string;
  seasonId: string;
  rateCardSha256: string;
  batchSha256: string;
  itemCount: number;
  totalCents: number;
  currency: "USD";
  role: ApprovalRole;
  approverId: string;
  nonce: string;
  /** RFC 3339 UTC. The server refuses anything more than 30 minutes ahead. */
  exp: string;
}

/** One batch item as hashed into batchSha256 (register §8). */
export interface BatchItem {
  senderItemId: string;
  receiver: string;
  amountCents: number;
  currency: "USD";
}

/* ------------------------------------------------------------------ §4 screens and routes */

export const SCREEN = {
  firstRun: "M-ON-01",
  bayad: "M-MB-01",
  resibo: "M-MB-02",
  paminawa: "M-MB-03",
  pangutana: "M-MB-04",
  clerk: "M-CL-01",
  cosign: "M-BD-01",
  sign: "M-BD-02",
} as const;
export type ScreenId = (typeof SCREEN)[keyof typeof SCREEN];

/** App routes (register §4). Groups are part of the file path, not the URL. */
export const APP_ROUTES = {
  language: "/onboarding/language",
  theme: "/onboarding/theme",
  pair: "/onboarding/pair",
  bayad: "/(member)/bayad",
  resibo: "/(member)/resibo",
  paminawa: "/(member)/paminawa",
  pangutana: "/(member)/pangutana",
  scan: "/(clerk)/scan",
  outbox: "/(clerk)/outbox",
  pirma: (runSlug: string) => `/(board)/pirma/${runSlug}` as const,
  sign: (runSlug: string) => `/(board)/pirma/${runSlug}/sign` as const,
} as const;

/** `runSlug` = `2026A-r{runSeq}` (register §4). */
export const RUN_SLUG_RE = /^\d{4}[A-Z]-r\d+$/;

/* ------------------------------------------------------------------ §7 status words (member copy) */

export type MemberStatus =
  | "HELD"
  | "EXCLUDED"
  | "PAYPAL_PENDING"
  | "PAID"
  | "OFF_RAIL_DUE"
  | "OFF_RAIL_PAID"
  | "UNCLAIMED"
  | "RETURNED"
  | "REROUTED"
  | "PAYPAL_HELD"
  | "NEEDS_ACTION"
  | "REVERSED";

/** A raw state name is never shown (register §7). The register fixes the ceb words; S1.10 adds fil and en. */
export const MEMBER_STATUS_WORDS: Readonly<Record<MemberStatus, Readonly<Record<Lang, string>>>> = {
  HELD: { ceb: "Gisusi pa", fil: "Sinusuri pa po", en: "Still checking" },
  EXCLUDED: {
    ceb: "Ibalhin sa sunod nga bayad",
    fil: "Ililipat po sa susunod na bayad",
    en: "Moved to the next pay run",
  },
  PAYPAL_PENDING: {
    ceb: "Gipadala na, naghulat sa PayPal",
    fil: "Naipadala na po, hinihintay ang PayPal",
    en: "Sent, waiting for PayPal",
  },
  PAID: { ceb: "Bayad na", fil: "Bayad na po", en: "Paid" },
  OFF_RAIL_DUE: { ceb: "Andam sa bodega", fil: "Handa na po sa bodega", en: "Ready at the bodega" },
  OFF_RAIL_PAID: { ceb: "Nadawat", fil: "Natanggap na po", en: "Received" },
  UNCLAIMED: {
    ceb: "Wala madawat sa PayPal",
    fil: "Hindi po natanggap sa PayPal",
    en: "Not received through PayPal",
  },
  RETURNED: { ceb: "Gibalik sa co-op", fil: "Ibinalik po sa co-op", en: "Returned to the co-op" },
  REROUTED: { ceb: "Gipadala pag-usab", fil: "Ipinadala pong muli", en: "Sent again" },
  PAYPAL_HELD: { ceb: "Gipugngan sa PayPal", fil: "Hinahawakan po ng PayPal", en: "PayPal is holding it" },
  NEEDS_ACTION: {
    ceb: "Wala molampos sa PayPal",
    fil: "Hindi po natuloy sa PayPal",
    en: "PayPal didn't complete it",
  },
  REVERSED: { ceb: "Gibawi", fil: "Binawi po", en: "Reversed" },
};

/* ------------------------------------------------------------------ error codes the app reacts to */

export type ApiErrorCode =
  | "PAIRING_EXPIRED"
  | "PAIRING_USED"
  | "PAIRING_INVALID"
  | "DIGEST_MISMATCH"
  | "APPROVAL_EXPIRED"
  | "NONCE_REUSED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "UNAUTHENTICATED"
  | "RATE_LIMITED"
  | "NETWORK";
