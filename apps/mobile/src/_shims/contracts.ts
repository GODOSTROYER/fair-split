/**
 * IC-01 as the app reads it: WS-CORE's @fairsplit/contracts, plus the app-only names it does not define.
 *
 * - Every type the package defines is the package's own (`export type … from "@fairsplit/contracts"`). The imports
 *   are type-only, so nothing of the package is bundled: Metro does not tree-shake, and a runtime import would carry
 *   zod and every schema into each phone frame (+117 KB gzipped on the web export, measured 28 Oct).
 * - The few runtime values the app needs (state lists, item ranks, the key ID shapes, the payload's field set) are
 *   written here with `satisfies` the package's types, and `contracts.parity.test.ts` checks each one against the
 *   package's runtime value, so they cannot drift.
 * - Still shim-defined until WS-CORE or WS-API publish them: the app's screen states and amount grammar (register §4,
 *   S2.2.1), member status words, statement templates, the IC-12 frame messages, the app's SSE envelope (`RunEvent`,
 *   whose payloads predate the package's) and the app's own error codes beside the package's (`ApiErrorCode`).
 */
import type {
  ApprovalPayload,
  ApprovalRole,
  DeviceKeyKind,
  ErrorCode,
  HoldKind,
  Lang,
  MemberLineState,
  PayoutItemStatus,
  PayRunState,
  Provenance,
  Role,
} from "@fairsplit/contracts";

export type {
  ApprovalPayload,
  ApprovalRole,
  AudioOffset,
  BatchDigest,
  BatchItem,
  DeviceKeyKind,
  HoldGate,
  HoldKind,
  HoldState,
  Lang,
  LineCanonical,
  ProofLine,
  Provenance,
  Rail,
  Role,
  StatementAudio,
  StatementAudioClip,
  StatementAudioSentence,
} from "@fairsplit/contracts";

/* ------------------------------------------------------------------ languages, roles */

export const LANGS = ["ceb", "fil", "en"] as const satisfies readonly Lang[];

/** The three roles the Fair Split app binds a phone to (register §4, app navigation). */
export type AppRole = Extract<Role, "member" | "clerk" | "board">;

/* ------------------------------------------------------------------ §7 states */

export type RunState = PayRunState;
export type LineState = MemberLineState;

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
] as const satisfies readonly RunState[];

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
] as const satisfies readonly LineState[];

/** The hold kinds, in the package's order (`HOLD_KINDS`). */
export const HOLD_KINDS = [
  "DUPLICATE_SLIP",
  "IMPLAUSIBLE_YIELD",
  "NO_RULE",
  "RATE_MISMATCH",
  "SUSPECTED_INJECTION",
  "LOW_CONFIDENCE",
  "MASS_BALANCE",
] as const satisfies readonly HoldKind[];

/**
 * A payout item status as a phone sees it: every status but SUBMITTED, the row fs-api writes before its POST (no
 * PayPal event ever carries it).
 */
export type ItemStatus = Exclude<PayoutItemStatus, "SUBMITTED">;

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
} as const satisfies Readonly<Record<ItemStatus, number>>;

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

/**
 * The approval roles, lowercase as the package names them. The signed payload (register §8 as amended by the approved
 * plan, ADR-0001) is the package's `ApprovalPayload`: JCS{v, runId, seasonId, rateCardSha256, batchSha256,
 * linesDigest, itemCount, totalCents, currency, role, approverId, nonce, exp}. `linesDigest` hashes every member line,
 * so both keys bind the cash lines too. The server issues the payload; the phone recomputes both digests itself and
 * signs the RFC 8785 bytes with Ed25519.
 */
export const APPROVAL_ROLES = ["treasurer", "chair"] as const satisfies readonly ApprovalRole[];

/** The payload's exact field set, in JCS order. The phone refuses a payload with any other shape. */
export const APPROVAL_PAYLOAD_KEYS = [
  "approverId",
  "batchSha256",
  "currency",
  "exp",
  "itemCount",
  "linesDigest",
  "nonce",
  "rateCardSha256",
  "role",
  "runId",
  "seasonId",
  "totalCents",
  "v",
] as const satisfies readonly (keyof ApprovalPayload)[];

/* ------------------------------------------------------------------ signing keys (S3.8, C-13) */

/** S3 `device_keys.kind`: the Chair's app key, a persisted browser key (the treasurer's), a judge's demo key. */
export const DEVICE_KEY_KINDS = ["app", "web", "web_demo"] as const satisfies readonly DeviceKeyKind[];

/** `fs-{persona}`, where the persona is 1-24 letters and never `ledger` or `demo` (the package's `PERSONA`). */
const PERSONA = "fs-(?!(?:ledger|demo)-)[a-z]{1,24}";
/** `{n}`: 1-9999, no leading zero. */
const SEQ = "[1-9][0-9]{0,3}";

/**
 * The one ID shape of each device-key kind (the package's `KEY_ID_PATTERNS`): `fs-ernesto-a1` is an app key,
 * `fs-analyn-w1` a persisted browser key and `fs-ernesto-demo-k3x9pq` a judge's browser key, so a key's ID alone
 * tells its kind and a demo key can never take a real key's ID.
 */
export const KEY_ID_PATTERNS = {
  app: new RegExp(`^${PERSONA}-a${SEQ}$`),
  web: new RegExp(`^${PERSONA}-w${SEQ}$`),
  demo: new RegExp(`^${PERSONA}-demo-[a-z0-9]{6}$`),
} as const;

const KIND_PATTERN: Readonly<Record<DeviceKeyKind, RegExp>> = {
  app: KEY_ID_PATTERNS.app,
  web: KEY_ID_PATTERNS.web,
  web_demo: KEY_ID_PATTERNS.demo,
};

/** True when `keyId` has the ID shape of the device-key `kind` (the package's `deviceKeyIdFitsKind`). */
export function deviceKeyIdFitsKind(kind: unknown, keyId: unknown): boolean {
  if (typeof kind !== "string" || typeof keyId !== "string" || !Object.hasOwn(KIND_PATTERN, kind))
    return false;
  return KIND_PATTERN[kind as DeviceKeyKind].test(keyId);
}

/* ------------------------------------------------------------------ §4 screens and routes */

export const SCREEN = {
  firstRun: "M-ON-01",
  bayad: "M-MB-01",
  resibo: "M-MB-02",
  paminawa: "M-MB-03",
  pangutana: "M-MB-04",
  clerk: "M-CL-01",
  /** The outbox half of M-CL-01 ("Scan and outbox"), kept as its own ID for test hooks. */
  outbox: "M-CL-02",
  cosign: "M-BD-01",
  sign: "M-BD-02",
} as const;
export type ScreenId = (typeof SCREEN)[keyof typeof SCREEN];

/**
 * App routes as register §4 writes them. Groups are part of the file path, not the URL, and the member tabs live in
 * a nested `(tabs)` group so Paminawa can be a modal over them; navigate with the typed hrefs in
 * `services/session.ts` (`HREF`), which spell the real file paths.
 */
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
  /** Web entry points: the pairing QR and the member's signed link. */
  pairLink: "/pair",
  memberLink: (token: string) => `/s/${token}` as const,
} as const;

/** `runSlug` = `2026A-r{runSeq}` (register §4). */
export const RUN_SLUG_RE = /^\d{4}[A-Z]-r\d+$/;

/**
 * `data-state` values per app screen root: S1.9's lists, plus the screens the register keeps and S1 retired (M-MB-02,
 * M-MB-04 and the outbox half of M-CL-01), whose states are named here. WS-QA's spec-lint checks every `data-state`
 * literal in apps/** against this list, and `<Screen id state>` only accepts these at compile time. A state that is
 * not here is a contract change (ADR), not a local edit.
 */
export const SCREEN_STATES = {
  "M-ON-01": [
    "language",
    "theme",
    "idle",
    "camera-denied",
    "pairing",
    "paired",
    "listen-choice",
    "expired",
    "used",
    "invalid",
    "offline",
    "error",
  ],
  "M-MB-01": [
    "loading",
    "error",
    "checking",
    "held-line",
    "sent",
    "paid",
    "cash-due",
    "cash-received",
    "unclaimed",
    "returned",
    "paypal-held",
    "needs-action",
    "reversed",
    "excluded",
    "request-sent",
    "request-answered",
    "offline",
    "run-summary",
    "link-expired",
    "link-invalid",
  ],
  "M-MB-02": ["loading", "list", "empty", "offline", "error"],
  "M-MB-03": ["loading", "paused", "playing", "device-voice", "filipino-audio", "text-only", "offline"],
  "M-MB-04": ["loading", "error", "none", "composing", "sending", "sent", "answered", "failed", "offline"],
  "M-CL-01": [
    "ready",
    "scanning",
    "uploading",
    "uploaded",
    "read",
    "failed",
    "quality",
    "duplicate-file",
    "camera-denied",
    "unavailable",
    "offline",
  ],
  "M-CL-02": ["empty", "online", "syncing", "offline"],
  "M-BD-01": [
    "loading",
    "none",
    "request",
    "override",
    "changed",
    "expired",
    "signed",
    "offline",
    "sent-back",
    "error",
  ],
  "M-BD-02": [
    "loading",
    "ready",
    "holding",
    "armed",
    "confirm",
    "biometric",
    "signed",
    "cancelled",
    "released-early",
    "disarmed",
    "mismatch",
    "expired",
    "offline",
    "error",
    "no-lock",
    "invalidated",
  ],
} as const;
export type ScreenWithStates = keyof typeof SCREEN_STATES;
export type ScreenStateOf<S extends ScreenWithStates> = (typeof SCREEN_STATES)[S][number];

/** `data-state` of the Slab primitive (S2.7); hold slabs also set `data-hold-progress` to 0, 25, 50, 75 or 100. */
export const SLAB_STATES = [
  "rest",
  "pressed",
  "holding",
  "armed",
  "committed",
  "unavailable",
  "bolted",
  "refusing",
] as const;
export type SlabState = (typeof SLAB_STATES)[number];

/* ------------------------------------------------------------------ IC-09 amount grammar (S2.2.1) */

/**
 * `data-amount-state`: pencil (read or computed, nobody signed), you (a person must enter it), ink (a person entered
 * or approved it), hollow (money in flight: sent, parked or cash due), landed (PayPal confirmed it), attested (cash
 * handed over and the clerk attested it).
 */
export const AMOUNT_STATES = ["pencil", "you", "ink", "hollow", "landed", "attested"] as const;
export type AmountState = (typeof AMOUNT_STATES)[number];

/**
 * The state map (S2.2.1) for a line before its run is APPROVED; `amountStateOf` applies the approval. REVERSED stays
 * hollow (its chip is red), EXCLUDED stays pencil ("Reserved, never redistributed").
 */
export const AMOUNT_STATE: Readonly<Record<LineState, AmountState>> = {
  COMPUTED: "pencil",
  READY: "pencil",
  HELD: "pencil",
  EXCLUDED: "pencil",
  LOCKED: "ink",
  SUBMITTED: "hollow",
  PAYPAL_PENDING: "hollow",
  UNCLAIMED: "hollow",
  PAYPAL_HELD: "hollow",
  NEEDS_ACTION: "hollow",
  RETURNED: "hollow",
  REROUTED: "hollow",
  REVERSED: "hollow",
  OFF_RAIL_DUE: "hollow",
  PAID: "landed",
  OFF_RAIL_PAID: "attested",
};

/** Every line turns to ink once the run is approved (both keys); voided approvals turn it back to pencil. */
export function amountStateOf(line: LineState, run: { approved: boolean }): AmountState {
  const base = AMOUNT_STATE[line];
  if (run.approved && base === "pencil" && line !== "EXCLUDED") return "ink";
  return base;
}

/* ------------------------------------------------------------------ IC-01 StatementPlan (approved plan, S1.11) */

/**
 * Statement slots in reading order (approved plan "AI system: Statements"). DEDUCTION repeats once per ruled
 * deduction and CREDIT appears at most once; PAY has a PayPal and a cash variant.
 */
export const STATEMENT_SLOTS = [
  "GREETING",
  "DELIVERY",
  "PREMIUM",
  "BONUS",
  "DEDUCTION",
  "CREDIT",
  "PAY",
  "SOURCES",
  "HELP",
  "AI_NOTE",
] as const;
export type StatementSlot = (typeof STATEMENT_SLOTS)[number];

/**
 * One sentence template: words and `{{PLACEHOLDERS}}` only, never a digit (I1). `ref` names the deduction rule
 * (`R1`) or the slip a DEDUCTION or CREDIT sentence is about.
 */
export interface StatementTemplate {
  id: string;
  slot: StatementSlot;
  /**
   * Which form of its slot this is, named as fs-api names it (its template key is `{slot}.{variant}`), so Paminawa
   * plays only fs-api's clip of this very form (ADR-0011 §6). PAY's variant is its rail (`paypal`, the default, or
   * `cash`); any other slot's is `default` unless named (`noname`, `written`, T1's `seeded` AI note).
   */
  variant?: string;
  ref?: string;
  text: string;
}

/* ------------------------------------------------------------------ IC-12 FrameBridge (approved plan, S3.8) */

/**
 * The judge stage and its phone frames talk only through these versioned, same-origin messages: the stage sends
 * the frame token, display preferences and resets; the frame reports readiness, moment phases, feedback events
 * (only the stage plays sound) and the screen it shows. Tokens never travel in a URL.
 */
export const FRAME_PROTOCOL_VERSION = 1 as const;

export interface FramePrefs {
  tier: "full" | "low";
  /** Sound is the stage's; frames only forward `fs.feedback`. */
  sound: boolean;
  reducedMotion: boolean;
  /** English under each Cebuano or Filipino statement sentence, for judges. */
  gloss: boolean;
}

export type ToFrame = { v: 1 } & (
  | { t: "fs.token"; token: string; exp: number; persona: string; ws: string }
  | ({ t: "fs.prefs" } & FramePrefs)
  | { t: "fs.reset" }
);

export type ToStage = { v: 1 } & (
  | { t: "fs.ready"; frameId: string; persona: string | null; build: string }
  | { t: "fs.moment"; moment: string; phase: string }
  | { t: "fs.feedback"; event: string; index?: number }
  | { t: "fs.focus"; screenId: ScreenId }
);

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

/**
 * Every code of the package's `ErrorCode` (what fs-api sends: `DIGEST_MISMATCH`, `KEY_NOT_REGISTERED`, …) plus the
 * app's own: `NETWORK` (no answer at all) and the three pairing outcomes the pairing screen names, which fs-api's
 * `PAIRING_TOKEN_INVALID` does not yet tell apart (shim-defined until WS-API says which it sends).
 */
export type ApiErrorCode = ErrorCode | "PAIRING_EXPIRED" | "PAIRING_USED" | "PAIRING_INVALID" | "NETWORK";
