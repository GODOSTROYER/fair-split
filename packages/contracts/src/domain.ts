// Shapes that cross into and out of @fairsplit/domain (IC-02). Domain is pure; these are its
// inputs and outputs, so the API, tasks, seed and UI agree on them.
import { z } from "zod";
import {
  AnomalyKind,
  AnomalyOverlap,
  ApprovalRole,
  CopyColor,
  Grade,
  HoldGate,
  HoldKind,
  HoldResolutionKind,
  InvoiceStatus,
  Legibility,
  PayoutBatchStatus,
  PayoutItemStatus,
  PayRunState,
  PolicyName,
  ProofStatus,
  Rail,
  SlipFieldName,
  Station,
  Verdict,
  WebhookEventType,
  WebhookVerified,
} from "./enums.js";
import {
  Cents,
  Ed25519PublicKeyHex,
  Grams,
  IsoDate,
  IsoDateTime,
  Json,
  KeyId,
  LedgerKeyId,
  MemberNo,
  NonNegCents,
  PlotNo,
  Provenance,
  Rational,
  RunSlug,
  SeasonCode,
  Sha256Hex,
  SlipSerial,
} from "./primitives.js";

// ---------------------------------------------------------------- rate card (I2)

export const RuleId = z.enum(["R0", "R1", "R2", "R3", "R4", "R5", "R6", "CLOSED"]);
export type RuleId = z.infer<typeof RuleId>;
export const DEDUCTION_RULE_IDS = ["R1", "R2", "R3", "R4"] as const satisfies readonly RuleId[];

export const RulePool = z.enum(["PREMIUM", "BONUS", "NONE"]);
export type RulePool = z.infer<typeof RulePool>;

export const RuleKind = z.enum(["SHARE", "DEDUCTION", "COSIGN", "TOLERANCE", "CLOSED_LIST"]);
export type RuleKind = z.infer<typeof RuleKind>;

export const RuleBasis = z.enum([
  "VERIFIED_KG",
  "VERIFIED_G1_KG",
  "PCT_OF_BONUS",
  "PER_NET_KG",
  "BATCH_TOTAL",
  "LINE_TOTAL",
  "OVERRIDE",
  "MASS_BALANCE",
  "KG_PER_TREE",
  "READ_CONFIDENCE",
  "NONE",
]);
export type RuleBasis = z.infer<typeof RuleBasis>;

export const RequiredDocument = z.enum(["NONE", "AUTHORITY_TO_DEDUCT", "VOUCHER"]);
export type RequiredDocument = z.infer<typeof RequiredDocument>;

/** One printed term of Schedule A with its verbatim quote (the text layer must contain it). */
export const RateTerm = z.strictObject({
  ruleId: RuleId,
  pool: RulePool,
  kind: RuleKind,
  basis: RuleBasis,
  label: z.string(),
  valueAsWritten: z.string(),
  capAsWritten: z.string(),
  conditionAsWritten: z.string(),
  requiresDocument: RequiredDocument,
  source: z.strictObject({ page: z.int().positive(), quote: z.string().min(1) }),
});
export type RateTerm = z.infer<typeof RateTerm>;

/** The typed, re-parsed values the engine runs on. Integers only. */
export const RateCardRules = z.strictObject({
  share: z.strictObject({
    ruleId: z.literal("R0"),
    premiumBasis: z.literal("VERIFIED_KG"),
    bonusBasis: z.literal("VERIFIED_G1_KG"),
    premiumNeverDeducted: z.literal(true),
  }),
  cbu: z.strictObject({
    ruleId: z.literal("R1"),
    bp: z.int().positive(),
    paidUpCapCentavos: z.int().positive(),
  }),
  hauling: z.strictObject({
    ruleId: z.literal("R2"),
    centavosPerNetKg: z.int().positive(),
    stations: z.array(Station).min(1),
  }),
  loan: z.strictObject({
    ruleId: z.literal("R3"),
    capBp: z.int().positive(),
    requires: z.literal("AUTHORITY_TO_DEDUCT"),
  }),
  advance: z.strictObject({
    ruleId: z.literal("R4"),
    capBp: z.int().positive(),
    requires: z.literal("VOUCHER"),
  }),
  cosign: z.strictObject({
    ruleId: z.literal("R5"),
    batchOverCents: z.int().positive(),
    lineOverCents: z.int().positive(),
    anyOverride: z.boolean(),
  }),
  tolerances: z.strictObject({
    ruleId: z.literal("R6"),
    massBalanceTolBp: z.int().positive(),
    kgPerTreeMaxG: z.int().positive(),
    autoAcceptBp: z.int().positive(),
  }),
  closedList: z.strictObject({
    ruleId: z.literal("CLOSED"),
    deductionRuleIds: z.array(RuleId),
    amendableInSeason: z.literal(false),
  }),
});
export type RateCardRules = z.infer<typeof RateCardRules>;

/** The buyer's terms as approved by the GA and cited inside the card (C-09: one hash). */
export const BuyerPricing = z.strictObject({
  buyer: z.string(),
  currency: z.literal("USD"),
  premiumCentsPerShippedKg: z.int().positive(),
  bonusCentsPerShippedGrade1Kg: z.int().positive(),
  disbursementCents: z.int().nonnegative(),
});
export type BuyerPricing = z.infer<typeof BuyerPricing>;

/** Exactly what is JCS-canonicalized and sha256-hashed when the board ratifies. */
export const RateCardCanonical = z.strictObject({
  v: z.literal(1),
  season: SeasonCode,
  resolutionNo: z.string(),
  ratifiedOn: IsoDate,
  gaCitation: z.strictObject({ resolutionNo: z.string(), approvedOn: IsoDate }),
  pricing: BuyerPricing,
  rules: RateCardRules,
  terms: z.array(RateTerm).min(1),
  documents: z.array(z.strictObject({ name: z.string(), sha256: Sha256Hex })),
});
export type RateCardCanonical = z.infer<typeof RateCardCanonical>;

export const Ratification = z.strictObject({
  role: z.enum(["SECRETARY", "CHAIR"]),
  name: z.string(),
  act: z.enum(["CERTIFIED", "ATTESTED"]),
  at: IsoDateTime,
});
export type Ratification = z.infer<typeof Ratification>;

export const RatifiedRateCard = z.strictObject({
  canonical: RateCardCanonical,
  sha256: Sha256Hex,
  /** First 8 hex digits, used in sender_batch_id. */
  rc8: z.string().regex(/^[0-9a-f]{8}$/),
  /** First 16 hex digits, used in the invoice reference `rc:{sha16}`. */
  sha16: z.string().regex(/^[0-9a-f]{16}$/),
  ratifiedAt: IsoDateTime,
  ratifications: z.array(Ratification),
});
export type RatifiedRateCard = z.infer<typeof RatifiedRateCard>;

// ---------------------------------------------------------------- lot and invoice quote (C-09)

export const Lot = z.strictObject({
  lotCode: z.string(),
  shippedG: Grams,
  grade1ShippedG: Grams,
  sacks: z.int().positive(),
  sackKind: z.string(),
  shippedOn: IsoDate,
});
export type Lot = z.infer<typeof Lot>;

export const QuoteItemKey = z.enum(["PREMIUM", "BONUS", "DISBURSEMENT"]);
export type QuoteItemKey = z.infer<typeof QuoteItemKey>;

export const InvoiceQuoteItem = z.strictObject({
  key: QuoteItemKey,
  name: z.string(),
  quantity: z.literal("1"),
  unitAmountCents: NonNegCents,
});
export type InvoiceQuoteItem = z.infer<typeof InvoiceQuoteItem>;

/** Computed from the lot and the card before any slip is read. The agent's draft must deep-equal it. */
export const InvoiceQuote = z.strictObject({
  currency: z.literal("USD"),
  items: z.array(InvoiceQuoteItem).length(3),
  totalCents: NonNegCents,
  premiumPoolCents: NonNegCents,
  bonusPoolCents: NonNegCents,
  poolCents: NonNegCents,
  disbursementCents: NonNegCents,
  lotCode: z.string(),
  rateCardSha256: Sha256Hex,
});
export type InvoiceQuote = z.infer<typeof InvoiceQuote>;

// ---------------------------------------------------------------- engine input

export const EngineLoan = z.strictObject({
  ref: z.string(),
  outstandingCentavos: z.int().nonnegative(),
  authorityToDeduct: z.boolean(),
});
export type EngineLoan = z.infer<typeof EngineLoan>;

export const EngineAdvance = z.strictObject({
  voucherNo: z.string().nullable(),
  outstandingCentavos: z.int().nonnegative(),
});
export type EngineAdvance = z.infer<typeof EngineAdvance>;

export const EngineMember = z.strictObject({
  memberNo: MemberNo,
  rail: Rail,
  registeredTrees: z.int().nonnegative(),
  cbuPaidUpCentavos: z.int().nonnegative(),
  loans: z.array(EngineLoan),
  advances: z.array(EngineAdvance),
});
export type EngineMember = z.infer<typeof EngineMember>;

/** A deduction line written in box 13 at the bodega. Classified by AI-6; checked by code. */
export const EngineMark = z.strictObject({
  markId: z.string(),
  text: z.string(),
  ruleId: z.union([RuleId, z.literal("NO_MATCH")]),
  /** Parsed by code from the text (last number, ₱/P/PHP optional). Null when unparseable. */
  writtenCentavos: z.int().nonnegative().nullable(),
  /** For R3/R4 marks: the ATD or voucher cited on the slip. */
  documentRef: z.string().nullable(),
});
export type EngineMark = z.infer<typeof EngineMark>;

export const EngineAnomaly = z.strictObject({
  anomalyId: z.string(),
  kind: AnomalyKind,
  quarantined: z.boolean(),
  overlap: AnomalyOverlap,
  source: z.enum(["screen", "read_a", "read_b"]),
});
export type EngineAnomaly = z.infer<typeof EngineAnomaly>;

export const PendingField = z.strictObject({
  fieldId: z.string(),
  field: SlipFieldName,
  score: z.number().min(0).max(1),
});
export type PendingField = z.infer<typeof PendingField>;

/** One slip image's agreed row. `payableG` is null while a kilo field waits for a person. */
export const EngineRow = z.strictObject({
  rowId: z.string(),
  documentId: z.string(),
  photoId: z.string().nullable(),
  serial: SlipSerial,
  copy: CopyColor,
  memberNo: MemberNo,
  slipDate: IsoDate,
  station: Station,
  netG: Grams.nullable(),
  payableG: Grams.nullable(),
  grade: Grade,
  plotNo: PlotNo.nullable(),
  pendingFields: z.array(PendingField),
  enteredByHand: z.boolean(),
  marks: z.array(EngineMark),
  anomalies: z.array(EngineAnomaly),
});
export type EngineRow = z.infer<typeof EngineRow>;

/** A precomputed near-duplicate signal (dHash distance between two slip crops). */
export const NearDuplicate = z.strictObject({
  rowA: z.string(),
  rowB: z.string(),
  dhashDistance: z.int().nonnegative(),
});
export type NearDuplicate = z.infer<typeof NearDuplicate>;

const resolutionBase = { holdKey: z.string(), by: z.string(), at: IsoDateTime };

export const EngineResolution = z.discriminatedUnion("resolution", [
  z.strictObject({ ...resolutionBase, resolution: z.literal("COUNT_ONCE") }),
  z.strictObject({ ...resolutionBase, resolution: z.literal("TWO_DELIVERIES"), reason: z.string().min(1) }),
  z.strictObject({
    ...resolutionBase,
    resolution: z.literal("REGISTER_PLOT"),
    plot: z.strictObject({ plotNo: PlotNo, areaHa: z.string(), trees: z.int().positive() }),
  }),
  z.strictObject({ ...resolutionBase, resolution: z.literal("RETURN_AS_CREDIT") }),
  z.strictObject({ ...resolutionBase, resolution: z.literal("APPLY_RULE"), ruleId: RuleId }),
  z.strictObject({ ...resolutionBase, resolution: z.literal("EXCLUDE_LINE"), reason: z.string().min(1) }),
  z.strictObject({ ...resolutionBase, resolution: z.literal("CONFIRM_AS_READ") }),
]);
export type EngineResolution = z.infer<typeof EngineResolution>;

/** A hold raised by an earlier computation of the same run (so the engine can report it cleared). */
export const PriorHold = z.strictObject({
  key: z.string(),
  kind: HoldKind,
  gate: HoldGate,
  memberNo: MemberNo.nullable(),
});
export type PriorHold = z.infer<typeof PriorHold>;

export const EngineInput = z.strictObject({
  card: RatifiedRateCard,
  lot: Lot,
  /** Run's fixed exchange rate, centavos per cent (₱62.50 per US$ = 125/2). */
  fx: Rational,
  members: z.array(EngineMember).min(1),
  rows: z.array(EngineRow),
  nearDuplicates: z.array(NearDuplicate),
  resolutions: z.array(EngineResolution),
  priorHolds: z.array(PriorHold),
});
export type EngineInput = z.infer<typeof EngineInput>;

// ---------------------------------------------------------------- engine output

export const LineDeduction = z.strictObject({
  ruleId: z.enum(["R1", "R3", "R4"]),
  category: z.enum(["CBU", "LOAN", "ADVANCE"]),
  /** What the rule alone gives, before any cap (half-up per component). */
  computedCents: NonNegCents,
  /** The cap that applied (rounded down), or null. */
  capCents: NonNegCents.nullable(),
  amountCents: NonNegCents,
  ref: z.string().nullable(),
  /** Peso balance carried to the next season (loans and advances). */
  carriedCentavos: z.int().nonnegative().nullable(),
});
export type LineDeduction = z.infer<typeof LineDeduction>;

export const LineCredit = z.strictObject({
  kind: z.literal("RETURNED_MARK"),
  holdKey: z.string(),
  markId: z.string(),
  serial: SlipSerial,
  text: z.string(),
  phpCentavos: z.int().nonnegative(),
  amountCents: NonNegCents,
});
export type LineCredit = z.infer<typeof LineCredit>;

export const EngineLineState = z.enum(["READY", "HELD", "EXCLUDED"]);
export type EngineLineState = z.infer<typeof EngineLineState>;

export const EngineLine = z.strictObject({
  memberNo: MemberNo,
  rail: Rail,
  state: EngineLineState,
  verifiedG: Grams,
  grade1G: Grams,
  slipSerials: z.array(SlipSerial),
  premiumCents: NonNegCents,
  bonusCents: NonNegCents,
  grossCents: NonNegCents,
  deductions: z.array(LineDeduction),
  credits: z.array(LineCredit),
  deductionsCents: NonNegCents,
  creditsCents: NonNegCents,
  netCents: Cents,
  holdKeys: z.array(z.string()),
  lineSha256: Sha256Hex,
});
export type EngineLine = z.infer<typeof EngineLine>;

export const EngineHoldState = z.enum(["OPEN", "RESOLVED", "EXCLUDED"]);
export type EngineHoldState = z.infer<typeof EngineHoldState>;

export const EngineHold = z.strictObject({
  key: z.string(),
  kind: HoldKind,
  gate: HoldGate,
  state: EngineHoldState,
  memberNo: MemberNo.nullable(),
  serials: z.array(SlipSerial),
  rowIds: z.array(z.string()),
  documentIds: z.array(z.string()),
  /** Engine facts behind the hold; every number in an engine line comes from here. */
  params: z.record(z.string(), Json),
  resolution: z
    .strictObject({ kind: HoldResolutionKind, by: z.string(), at: IsoDateTime.nullable() })
    .nullable(),
});
export type EngineHold = z.infer<typeof EngineHold>;

export const MassBalanceStatus = z.enum(["PENDING", "INSIDE", "OUTSIDE"]);
export type MassBalanceStatus = z.infer<typeof MassBalanceStatus>;

export const MassBalance = z.strictObject({
  status: MassBalanceStatus,
  verifiedG: Grams,
  grade1G: Grams,
  shippedG: Grams,
  /** (verified − shipped) / shipped in basis points, rounded half away from zero. */
  shrinkBp: z.int(),
  tolBp: z.int().positive(),
  pendingRowIds: z.array(z.string()),
});
export type MassBalance = z.infer<typeof MassBalance>;

/** I3 proof: pool = Σ gross = Σ net + Σ deductions − Σ credits, in integer cents. */
export const ConservationProof = z.strictObject({
  premiumPoolCents: NonNegCents,
  bonusPoolCents: NonNegCents,
  poolCents: NonNegCents,
  premiumSumCents: NonNegCents,
  bonusSumCents: NonNegCents,
  grossCents: NonNegCents,
  deductionsCents: NonNegCents,
  creditsCents: NonNegCents,
  netCents: Cents,
  onRailNetCents: Cents,
  offRailNetCents: Cents,
  carriedNetCents: Cents,
  balanced: z.boolean(),
});
export type ConservationProof = z.infer<typeof ConservationProof>;

export const Quarantine = z.strictObject({
  anomalyId: z.string(),
  documentId: z.string(),
  rowId: z.string(),
  serial: SlipSerial,
  source: z.enum(["screen", "read_a", "read_b"]),
  hold: z.boolean(),
});
export type Quarantine = z.infer<typeof Quarantine>;

export const EngineOutput = z.strictObject({
  engineVersion: z.literal("engine v1"),
  lines: z.array(EngineLine),
  holds: z.array(EngineHold),
  massBalance: MassBalance,
  conservation: ConservationProof,
  quarantines: z.array(Quarantine),
  approvalBlocked: z.boolean(),
  blockingHoldKeys: z.array(z.string()),
});
export type EngineOutput = z.infer<typeof EngineOutput>;

// ---------------------------------------------------------------- reading (AI-2 agreement)

export const FieldRead = z.strictObject({
  valueText: z.string(),
  legibility: Legibility,
  overwrittenFrom: z.string(),
});
export type FieldRead = z.infer<typeof FieldRead>;

export const AgreementOutcome = z.enum(["AUTO_ACCEPT", "ZOOM", "CONFIRM_ONE_TAP", "PERSON", "SKIPPED"]);
export type AgreementOutcome = z.infer<typeof AgreementOutcome>;

export const AgreementResult = z.strictObject({
  score: z.number().min(0).max(1),
  /** Which row of the S4.2 table matched (1–7), or 0 when the field was skipped. */
  row: z.int().min(0).max(7),
  outcome: AgreementOutcome,
  autoAccept: z.boolean(),
  /** The value a person would be offered or the accepted value (normalised), or null. */
  value: z.string().nullable(),
  /** Per-character merge of A and B for display: "?" wherever they differ ("6?.80"). */
  display: z.string(),
});
export type AgreementResult = z.infer<typeof AgreementResult>;

// ---------------------------------------------------------------- payouts and approvals (I4, I6)

export const BatchItem = z.strictObject({
  senderItemId: z.string().max(63),
  receiver: z.string().max(127),
  amountCents: z.int().positive(),
  currency: z.literal("USD"),
});
export type BatchItem = z.infer<typeof BatchItem>;

export const BatchDigest = z.strictObject({
  runId: z.string(),
  senderBatchId: z.string().max(256),
  rateCardSha256: Sha256Hex,
  items: z.array(BatchItem).min(1),
  itemCount: z.int().positive(),
  totalCents: z.int().positive(),
  batchSha256: Sha256Hex,
  jcs: z.string(),
});
export type BatchDigest = z.infer<typeof BatchDigest>;

/**
 * The JCS payload each approver signs with Ed25519: register §8 as amended by the approved plan
 * (ADR-0001), JCS{v, runId, seasonId, rateCardSha256, batchSha256, linesDigest, itemCount, totalCents,
 * currency, role, approverId, nonce, exp}. `batchSha256` binds the PayPal items; `linesDigest` binds
 * every member line, so both keys cover the cash lines too.
 */
export const ApprovalPayload = z.strictObject({
  v: z.literal(1),
  runId: z.string(),
  seasonId: z.string(),
  rateCardSha256: Sha256Hex,
  batchSha256: Sha256Hex,
  /**
   * The lines root over every member line, on and off rail: sha256(JCS([{memberNo, lineSha256}]
   * sorted by memberNo)), the root the run's `lines.computed` entry carries and Proof plate 4
   * recomputes (domain `linesDigest`).
   */
  linesDigest: Sha256Hex,
  itemCount: z.int().positive(),
  totalCents: z.int().positive(),
  currency: z.literal("USD"),
  role: ApprovalRole,
  approverId: z.string(),
  nonce: z.string().min(8),
  exp: IsoDateTime,
});
export type ApprovalPayload = z.infer<typeof ApprovalPayload>;

export const SignedApproval = z.strictObject({
  role: ApprovalRole,
  keyId: KeyId,
  /**
   * Raw 32-byte Ed25519 public key, hex, as presented. Never a trust anchor: the server verifies
   * against the officer key registry (`device_keys`) and the Proof against the published keys.
   */
  publicKeyHex: Ed25519PublicKeyHex,
  payload: ApprovalPayload,
  /** 64-byte Ed25519 signature over the payload's JCS bytes, hex. */
  signatureHex: z.string().regex(/^[0-9a-f]{128}$/),
});
export type SignedApproval = z.infer<typeof SignedApproval>;

/**
 * How a signing key came to exist (S3 `device_keys.kind`, plus `seeded`). `app` is a person's app
 * key (`fs-{persona}-a{n}`) and `web` a persisted browser key (`fs-{persona}-w{n}`, the treasurer's
 * `fs-analyn-w1`). `web_demo` is a labelled browser key made for one judge session (C-13) and
 * `seeded` derives from public text: both are sample keys, so a Proof they sign reads "Sample",
 * never "Verified". Ledger keys have their own kinds (`LedgerKey.kind`: `server` or `seeded`).
 */
export const SigningKeyKind = z.enum(["app", "web", "web_demo", "seeded"]);
export type SigningKeyKind = z.infer<typeof SigningKeyKind>;
export const SAMPLE_KEY_KINDS: readonly SigningKeyKind[] = ["web_demo", "seeded"];

/**
 * One officer key: a row of the registry the server reads from `device_keys` (joined with the
 * officer's role) and the entry the app publishes for Proof. The key may sign only as `approverId`
 * in `role`.
 */
export const OfficerKey = z.strictObject({
  keyId: KeyId,
  approverId: z.string().min(1),
  role: ApprovalRole,
  publicKeyHex: Ed25519PublicKeyHex,
  kind: SigningKeyKind,
  revokedAt: IsoDateTime.nullable(),
});
export type OfficerKey = z.infer<typeof OfficerKey>;

/**
 * A pinned ledger key. `seeded` derives from public text: a checkpoint it signs reads "Sample". Once
 * `revokedAt` is set the key is untrusted for every checkpoint, whatever date the checkpoint claims.
 */
export const LedgerKey = z.strictObject({
  keyId: LedgerKeyId,
  publicKeyHex: Ed25519PublicKeyHex,
  kind: z.enum(["server", "seeded"]),
  revokedAt: IsoDateTime.nullable(),
});
export type LedgerKey = z.infer<typeof LedgerKey>;

/**
 * The Proof verifier's trust anchors, always passed in from outside the bundle: the published
 * officer keys (plate 5) and the pinned ledger keys (the checkpoint). Nothing in a bundle is trusted.
 */
export const ProofTrust = z.strictObject({
  officers: z.array(OfficerKey),
  ledger: z.array(LedgerKey),
});
export type ProofTrust = z.infer<typeof ProofTrust>;

/** `/.well-known/fairsplit-keys.json`, which the app publishes and the README pins. */
export const PublishedKeys = ProofTrust.extend({ v: z.literal(1) });
export type PublishedKeys = z.infer<typeof PublishedKeys>;

export const CosignReason = z.enum(["BATCH_OVER_THRESHOLD", "LINE_OVER_THRESHOLD", "OVERRIDE"]);
export type CosignReason = z.infer<typeof CosignReason>;

// ---------------------------------------------------------------- policy lattice

export const ToolCall = z.strictObject({
  name: z.string(),
  args: z.unknown(),
});
export type ToolCall = z.infer<typeof ToolCall>;

export const PolicyHold = z.strictObject({
  holdId: z.string(),
  state: z.enum(["OPEN", "ASKED_CHAIR", "RESOLVED", "EXCLUDED"]),
  gate: HoldGate,
});
export type PolicyHold = z.infer<typeof PolicyHold>;

export const PolicyCtx = z.strictObject({
  flags: z.strictObject({ killPayouts: z.boolean(), killPaypalLive: z.boolean(), killAiLive: z.boolean() }),
  ppEnv: z.string(),
  toolkitSandbox: z.boolean(),
  runState: PayRunState,
  invoiceExists: z.boolean(),
  holds: z.array(PolicyHold),
  budget: z.strictObject({
    spentMicros: z.int().nonnegative(),
    capMicros: z.int().nonnegative(),
    iteration: z.int().nonnegative(),
    maxIterations: z.int().positive(),
  }),
  /** What code expects; the canonical invoice and its AUTO_CANCEL rule are built from these alone. */
  expected: z.strictObject({
    quote: InvoiceQuote,
    invoiceNumber: z.string(),
    reference: z.string(),
    memo: z.string(),
    businessEmail: z.string(),
    /** The brand this run invoices (`PP_PAYER_EMAIL` and its business name): the one recipient. */
    payer: z.strictObject({ email: z.string(), businessName: z.string() }),
    brandAllowlist: z.array(z.string()),
    /** PayPal's ID of this run's invoice, once created; null before. */
    invoiceId: z.string().nullable(),
    /** PayPal's `invoice_date` for it, read back by a GET (we never send one); null before. */
    invoiceDate: z.string().nullable(),
  }),
  today: IsoDate,
});
export type PolicyCtx = z.infer<typeof PolicyCtx>;

export const PolicyResult = z.strictObject({
  policy: PolicyName,
  verdict: Verdict,
  reason: z.string().nullable(),
});
export type PolicyResult = z.infer<typeof PolicyResult>;

export const Decision = z.strictObject({
  tool: z.string(),
  verdict: Verdict,
  rank: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  results: z.array(PolicyResult),
  /** Names of the policies that set the verdict (empty when ALLOW). */
  decidedBy: z.array(PolicyName),
});
export type Decision = z.infer<typeof Decision>;

// ---------------------------------------------------------------- ledger chain and proof

export const GENESIS_PREV_HASH = "0".repeat(64);

export const LedgerEntry = z.strictObject({
  seq: z.int().positive(),
  kind: z.string(),
  actorKind: z.enum(["human", "agent", "engine", "paypal", "system"]),
  actorId: z.string(),
  impersonatedBy: z.string().nullable(),
  payload: Json,
  at: IsoDateTime,
  prevHash: Sha256Hex,
  entryHash: Sha256Hex,
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;

/**
 * Ledger kinds whose payloads the Proof verifier reads (S3.12). Writers must append exactly these
 * shapes, in the transaction that causes them. Every other kind (rate_card.certified,
 * field.entered, hold.raised, hold.resolved, approval.declined, approval.voided, flag.changed,
 * agent.tool_call and so on) carries free JSON.
 */
export const PROOF_LEDGER_KINDS = [
  "key.registered",
  "rate_card.ratified",
  "invoice.funded",
  "rows.accepted",
  "lines.computed",
  "approval.signed",
  "payout.submitting",
  "payout.cancel",
  "webhook.applied",
] as const;
export const ProofLedgerKind = z.enum(PROOF_LEDGER_KINDS);
export type ProofLedgerKind = z.infer<typeof ProofLedgerKind>;

const webhookApplied = {
  eventId: z.string().min(1),
  eventType: WebhookEventType,
  verified: WebhookVerified,
  provenance: Provenance,
};

export const LedgerPayloads = {
  /**
   * A key enters the ledger before it signs; `persona` is the approverId it signs as. Proof plate 5
   * takes public keys only from here, never from the bundle.
   */
  "key.registered": z.strictObject({
    keyId: KeyId,
    persona: z.string().min(1),
    kind: SigningKeyKind,
    publicKeyHex: Ed25519PublicKeyHex,
  }),
  "rate_card.ratified": z.strictObject({
    rateCardSha256: Sha256Hex,
    resolutionNo: z.string(),
    ratifiedAt: IsoDateTime,
  }),
  /** Appended with the FUNDED transition, from a fresh GET of the invoice. */
  "invoice.funded": z.strictObject({
    runId: z.string(),
    invoiceNumber: z.string().max(25),
    status: z.enum(["PAID", "MARKED_AS_PAID"]),
    amountCents: NonNegCents,
    dueCents: NonNegCents,
    reference: z.string(),
  }),
  "rows.accepted": z.strictObject({
    documentId: z.string(),
    photoId: z.string().nullable(),
    sha256: Sha256Hex,
    serials: z.array(SlipSerial).min(1),
    slipDates: z.array(IsoDate).min(1),
    provenance: Provenance,
  }),
  /** linesRootSha256 = sha256(JCS([{memberNo, lineSha256}] sorted by memberNo)). */
  "lines.computed": z.strictObject({
    runId: z.string(),
    engine: z.literal("engine v1"),
    rateCardSha256: Sha256Hex,
    lineCount: z.int().nonnegative(),
    linesRootSha256: Sha256Hex,
    premiumPoolCents: NonNegCents,
    bonusPoolCents: NonNegCents,
    netCents: Cents,
    onRailNetCents: Cents,
    balanced: z.boolean(),
  }),
  /** Appended with the approval, by the approver: the entry's actorId is `approverId`. */
  "approval.signed": z.strictObject({
    runId: z.string(),
    role: ApprovalRole,
    keyId: KeyId,
    approverId: z.string(),
    batchSha256: Sha256Hex,
    nonce: z.string(),
  }),
  /** Appended with the batch and item rows written as SUBMITTED, before the POST. */
  "payout.submitting": z.strictObject({
    runId: z.string(),
    senderBatchId: z.string().max(256),
    batchSha256: Sha256Hex,
    itemCount: z.int().positive(),
    totalCents: z.int().positive(),
    note: z.string(),
  }),
  /** Our cancel of an UNCLAIMED item: RETURNED is accepted only after it (register §7). */
  "payout.cancel": z.strictObject({
    senderItemId: z.string(),
    payoutItemId: z.string(),
    afterCancel: z.enum(["cash", "reroute"]),
  }),
  "webhook.applied": z.discriminatedUnion("resource", [
    z.strictObject({
      ...webhookApplied,
      resource: z.literal("payout_item"),
      senderItemId: z.string(),
      payoutItemId: z.string(),
      status: PayoutItemStatus,
    }),
    z.strictObject({
      ...webhookApplied,
      resource: z.literal("payout_batch"),
      senderBatchId: z.string(),
      batchStatus: PayoutBatchStatus,
    }),
    z.strictObject({
      ...webhookApplied,
      resource: z.literal("invoice"),
      invoiceNumber: z.string(),
      status: InvoiceStatus,
    }),
  ]),
} as const satisfies Record<ProofLedgerKind, z.ZodType>;
export type LedgerPayload<K extends ProofLedgerKind> = z.infer<(typeof LedgerPayloads)[K]>;

/** Exactly what a line hash covers (`lineSha256 = sha256(JCS(canonical))`); Proof plate 4 re-hashes it. */
export const LineCanonical = z.strictObject({
  v: z.literal(1),
  engine: z.literal("engine v1"),
  rateCardSha256: Sha256Hex,
  memberNo: MemberNo,
  rail: Rail,
  verifiedG: Grams,
  grade1G: Grams,
  slipSerials: z.array(SlipSerial),
  premiumCents: NonNegCents,
  bonusCents: NonNegCents,
  deductions: z.array(
    z.strictObject({
      ruleId: z.enum(["R1", "R3", "R4"]),
      amountCents: NonNegCents,
      ref: z.string().nullable(),
      carriedCentavos: z.int().nonnegative().nullable(),
    }),
  ),
  credits: z.array(z.strictObject({ markId: z.string(), amountCents: NonNegCents })),
  netCents: Cents,
});
export type LineCanonical = z.infer<typeof LineCanonical>;

export const ProofLine = z.strictObject({
  memberNo: MemberNo,
  rail: Rail,
  premiumCents: NonNegCents,
  bonusCents: NonNegCents,
  deductionsCents: NonNegCents,
  creditsCents: NonNegCents,
  netCents: Cents,
  /** The canonical content the line hash covers. */
  canonical: LineCanonical,
  lineSha256: Sha256Hex,
});
export type ProofLine = z.infer<typeof ProofLine>;

export const ProofItem = z.strictObject({
  senderItemId: z.string(),
  receiver: z.string(),
  amountCents: z.int().positive(),
  currency: z.literal("USD"),
  payoutItemId: z.string().nullable(),
  status: PayoutItemStatus,
  /** The verified webhook event the status rests on (null only while SUBMITTED or PENDING). */
  eventId: z.string().nullable(),
});
export type ProofItem = z.infer<typeof ProofItem>;

/**
 * The ledger's head when the Proof was served, signed with a pinned ledger key over
 * JCS{purpose: "fairsplit.ledger.checkpoint", v, keyId, runId, seq, entryHash, at}. It anchors the
 * hash chain: an edited bundle can be re-chained, but not re-signed.
 */
export const LedgerCheckpoint = z.strictObject({
  v: z.literal(1),
  runId: z.string(),
  seq: z.int().positive(),
  entryHash: Sha256Hex,
  at: IsoDateTime,
  keyId: LedgerKeyId,
  signatureHex: z.string().regex(/^[0-9a-f]{128}$/),
});
export type LedgerCheckpoint = z.infer<typeof LedgerCheckpoint>;

/**
 * The public Proof bundle (S3.12). Every plate is bound to the hash-chained `ledger`: a field the
 * ledger does not attest fails verification, so re-hashing and re-signing the bundle is not enough,
 * and the ledger's head is anchored by `checkpoint`, signed with a pinned ledger key.
 */
export const ProofBundle = z.strictObject({
  v: z.literal(1),
  runId: z.string(),
  runSlug: RunSlug,
  invoice: z.strictObject({
    invoiceNumber: z.string(),
    status: InvoiceStatus,
    amountCents: NonNegCents,
    dueCents: z.int().nonnegative(),
    reference: z.string(),
  }),
  rateCard: z.strictObject({ canonical: RateCardCanonical, sha256: Sha256Hex, ratifiedAt: IsoDateTime }),
  firstSlipDate: IsoDate,
  documents: z.array(z.strictObject({ documentId: z.string(), sha256: Sha256Hex })),
  pools: z.strictObject({ premiumPoolCents: NonNegCents, bonusPoolCents: NonNegCents }),
  lines: z.array(ProofLine),
  approvals: z.array(SignedApproval),
  batch: z.strictObject({
    runId: z.string(),
    senderBatchId: z.string(),
    rateCardSha256: Sha256Hex,
    batchSha256: Sha256Hex,
    /** The batch note sent to PayPal: "Fair Split 2026-A, batch {digest8}". */
    note: z.string(),
    items: z.array(ProofItem),
  }),
  ledger: z.array(LedgerEntry),
  checkpoint: LedgerCheckpoint,
});
export type ProofBundle = z.infer<typeof ProofBundle>;

export const PlateName = z.enum(["paid", "ratified", "read", "computed", "twoKeys", "payoutItems"]);
export type PlateName = z.infer<typeof PlateName>;

export const PlateResult = z.strictObject({ ok: z.boolean(), reason: z.string().nullable() });
export type PlateResult = z.infer<typeof PlateResult>;

export const ChainVerification = z.strictObject({
  /** True only when `status` is "verified". */
  ok: z.boolean(),
  /**
   * "verified": every check passed with published keys. "sample": every check passed in demo mode,
   * but a seeded or demo key signed (rendered "Sample", never "Verified"). "failed": anything else.
   */
  status: ProofStatus,
  chain: z.strictObject({ ok: z.boolean(), entries: z.int().nonnegative(), brokenAtSeq: z.int().nullable() }),
  checkpoint: z.strictObject({
    ok: z.boolean(),
    reason: z.string().nullable(),
    seq: z.int().nullable(),
    keyId: z.string().nullable(),
  }),
  /** Key IDs of the seeded or demo keys that signed (approvals or the checkpoint). */
  sampleKeys: z.array(z.string()),
  /** PayPal's own records of this run, to match in PayPal: invoice reference, batch ID and note. */
  anchors: z.strictObject({
    invoiceNumber: z.string().nullable(),
    invoiceReference: z.string().nullable(),
    senderBatchId: z.string().nullable(),
    batchNote: z.string().nullable(),
    batchNoteDigest: z.string().nullable(),
  }),
  plates: z.strictObject({
    paid: PlateResult,
    ratified: PlateResult,
    read: PlateResult,
    computed: PlateResult,
    twoKeys: PlateResult,
    payoutItems: PlateResult,
  }),
});
export type ChainVerification = z.infer<typeof ChainVerification>;

// ---------------------------------------------------------------- statements (AI-8 contract ask)

export const StatementSlot = z.enum([
  "GREETING",
  "DELIVERY",
  "PREMIUM",
  "BONUS",
  "DEDUCTION",
  "CREDIT",
  "TOTAL",
  "SOURCE",
  "HELP",
]);
export type StatementSlot = z.infer<typeof StatementSlot>;

export const StatementText = z.strictObject({
  sentences: z.array(
    z.strictObject({ id: StatementSlot, text: z.string(), placeholders: z.array(z.string()) }),
  ),
  sms: z.strictObject({ text: z.string(), placeholders: z.array(z.string()) }),
});
export type StatementText = z.infer<typeof StatementText>;

/** The audit agent's proposal for a hold (S4.4). No state change. */
export const HoldProposal = z.strictObject({
  holdId: z.string(),
  resolution: z.enum([
    "COUNT_ONCE",
    "TWO_DELIVERIES",
    "REGISTER_PLOT",
    "RETURN_AS_CREDIT",
    "APPLY_RULE",
    "EXCLUDE_LINE",
  ]),
  finding: z.enum([
    "PINK_COPY_OF_SAME_SLIP",
    "RESHOOT_OF_SAME_SLIP",
    "UNREGISTERED_SECOND_PLOT",
    "FINE_NOT_IN_SCHEDULE",
    "CLERK_ARITHMETIC",
    "OTHER",
  ]),
  evidenceIds: z.array(z.string()),
  sessionId: z.string(),
  at: IsoDateTime,
});
export type HoldProposal = z.infer<typeof HoldProposal>;

/** Eval report (S4.11 contract ask). */
export const EvalReport = z.strictObject({
  v: z.literal(1),
  generatedAt: IsoDateTime,
  set: z.enum(["test", "dev"]),
  cases: z.array(
    z.strictObject({
      id: z.string(),
      kind: z.string(),
      pass: z.boolean(),
      exactRow: z.boolean(),
      unsafeAccepts: z.int().nonnegative(),
      routedToPerson: z.boolean(),
    }),
  ),
  metrics: z.strictObject({
    exactRowRate: z.number().min(0).max(1),
    unsafeAutoAccepts: z.int().nonnegative(),
    injectionCatchRate: z.number().min(0).max(1),
    duplicateF1: z.number().min(0).max(1),
  }),
  baseline: z.strictObject({ name: z.string(), exactRowRate: z.number().min(0).max(1) }),
  bars: z.strictObject({
    exactRowRate: z.number(),
    unsafeAutoAccepts: z.int(),
    injectionCatchRate: z.number(),
    duplicateF1: z.number(),
  }),
  green: z.boolean(),
  versions: z.record(z.string(), z.string()),
});
export type EvalReport = z.infer<typeof EvalReport>;
