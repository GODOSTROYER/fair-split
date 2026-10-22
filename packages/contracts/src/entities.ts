// API-facing DTOs for every entity group in decision register §7. Column names follow S3.4 in
// camelCase. Money is integer cents plus a currency; weights are grams; IDs are UUIDv7.
// Secrets never appear here: tokens are represented by their metadata only.
import { z } from "zod";
import { Lot, RateTerm, Ratification, RatifiedRateCard } from "./domain.js";
import {
  ActorKind,
  AnomalyKind,
  ApprovalRole,
  CallPriority,
  CopyColor,
  DecidedBy,
  DeviceKeyKind,
  DocumentKind,
  Executor,
  Grade,
  HoldGate,
  HoldKind,
  HoldResolutionKind,
  HoldState,
  InvoiceStatus,
  Legibility,
  MemberLineState,
  PayoutBatchKind,
  PayoutBatchStatus,
  PayoutItemStatus,
  PayRunState,
  QuarantineSource,
  Rail,
  ReadVariant,
  ReceiverKind,
  ReviewRequestState,
  Role,
  SlipFieldName,
  SlipRowState,
  Station,
  SystemFlagName,
  TaskState,
  WebhookStatus,
  WebhookVerified,
  WorkspaceKind,
} from "./enums.js";
import {
  Cents,
  Currency,
  Grams,
  IsoDate,
  IsoDateTime,
  Json,
  KeyId,
  Lang,
  MemberNo,
  NonNegCents,
  PhotoId,
  PlotNo,
  Provenance,
  Rational,
  RunSlug,
  SeasonCode,
  SeasonLabel,
  Sha256Hex,
  SlipSerial,
  Uuid,
} from "./primitives.js";

const scoped = { id: Uuid, workspaceId: Uuid };

// ---------------------------------------------------------------- identity

export const Workspace = z.strictObject({
  id: Uuid,
  kind: WorkspaceKind,
  seededFrom: Uuid.nullable(),
  claimedAt: IsoDateTime.nullable(),
  expiresAt: IsoDateTime.nullable(),
});
export type Workspace = z.infer<typeof Workspace>;

export const Membership = z.strictObject({
  ...scoped,
  userId: z.string().nullable(),
  persona: z.string().nullable(),
  role: Role,
  memberNo: MemberNo.nullable(),
});
export type Membership = z.infer<typeof Membership>;

/** A 2-hour bearer frame token. The token itself is returned once and stored only as sha256. */
export const FrameToken = z.strictObject({
  ...scoped,
  persona: z.string(),
  role: Role,
  memberNo: MemberNo.nullable(),
  expiresAt: IsoDateTime,
});
export type FrameToken = z.infer<typeof FrameToken>;

export const PairingToken = z.strictObject({
  ...scoped,
  persona: z.string(),
  role: Role,
  expiresAt: IsoDateTime,
  usedAt: IsoDateTime.nullable(),
});
export type PairingToken = z.infer<typeof PairingToken>;

export const DeviceKey = z.strictObject({
  ...scoped,
  keyId: KeyId,
  persona: z.string(),
  publicKeyHex: z.string().regex(/^[0-9a-f]{64}$/),
  kind: DeviceKeyKind,
  label: z.string(),
  revokedAt: IsoDateTime.nullable(),
});
export type DeviceKey = z.infer<typeof DeviceKey>;

export const PushToken = z.strictObject({
  ...scoped,
  persona: z.string(),
  platform: z.enum(["android", "ios", "web"]),
  createdAt: IsoDateTime,
});
export type PushToken = z.infer<typeof PushToken>;

// ---------------------------------------------------------------- co-op and rules

export const Coop = z.strictObject({
  ...scoped,
  name: z.string(),
  shortName: z.string(),
  locality: z.string(),
  region: z.string(),
  commodity: z.literal("cacao"),
  stations: z.array(z.strictObject({ station: Station, name: z.string() })),
  provenance: Provenance,
});
export type Coop = z.infer<typeof Coop>;

export const Honorifics = z.strictObject({ ceb: z.string(), fil: z.string(), en: z.string() });
export type Honorifics = z.infer<typeof Honorifics>;

export const Plot = z.strictObject({
  plotNo: PlotNo,
  memberNo: MemberNo,
  areaHa: z.string().regex(/^\d+\.\d{2}$/),
  trees: z.int().nonnegative(),
  registered: z.boolean(),
  registeredOn: IsoDate.nullable(),
});
export type Plot = z.infer<typeof Plot>;

export const Member = z.strictObject({
  ...scoped,
  memberNo: MemberNo,
  displayName: z.string(),
  /** How the statement greets them, per language (registry honorific, never guessed). */
  addressAs: Honorifics,
  /** As Jessie writes it on slips, in block capitals. */
  nameOnSlip: z.string(),
  gender: z.enum(["F", "M"]),
  lang: Lang,
  rail: Rail,
  receiverKind: ReceiverKind,
  /** Masked receiver for the brand view (C-23); the public Proof shows member IDs only. */
  receiverMasked: z.string().nullable(),
  signsWith: z.enum(["SIGNATURE", "THUMBMARK"]),
  audioFirst: z.boolean(),
  plots: z.array(Plot),
  cbuPaidUpCentavos: z.int().nonnegative(),
  provenance: Provenance,
});
export type Member = z.infer<typeof Member>;

export const Season = z.strictObject({
  ...scoped,
  code: SeasonCode,
  label: SeasonLabel,
  opensOn: IsoDate,
  closesOn: IsoDate,
  cosignBatchCents: NonNegCents,
  cosignLineCents: NonNegCents,
  massBalanceTolBp: z.int().positive(),
  kgPerTreeMaxG: z.int().positive(),
  autoAcceptBp: z.int().positive(),
  provenance: Provenance,
});
export type Season = z.infer<typeof Season>;

export const LotDTO = Lot.extend({ ...scoped, seasonId: Uuid, buyer: z.string(), provenance: Provenance });
export type LotDTO = z.infer<typeof LotDTO>;

export const RateCardDTO = RatifiedRateCard.extend({ ...scoped, seasonId: Uuid, provenance: Provenance });
export type RateCardDTO = z.infer<typeof RateCardDTO>;

export const RateRuleDTO = RateTerm.extend({ ...scoped, rateCardId: Uuid });
export type RateRuleDTO = z.infer<typeof RateRuleDTO>;

export const RatificationDTO = Ratification.extend({
  ...scoped,
  rateCardId: Uuid,
  signature: z.string().nullable(),
});
export type RatificationDTO = z.infer<typeof RatificationDTO>;

// ---------------------------------------------------------------- evidence

export const DocumentDTO = z.strictObject({
  ...scoped,
  kind: DocumentKind,
  photoId: PhotoId.nullable(),
  sha256: Sha256Hex,
  /** 64-bit dHash, hex. */
  phash: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .nullable(),
  bytes: z.int().nonnegative(),
  storage: z.enum(["static", "db"]),
  captureId: Uuid.nullable(),
  exactDuplicateOf: Uuid.nullable(),
  capturedOn: IsoDate.nullable(),
  readOn: IsoDate.nullable(),
  provenance: Provenance,
});
export type DocumentDTO = z.infer<typeof DocumentDTO>;

export const ExtractionRead = z.strictObject({
  ...scoped,
  documentId: Uuid,
  variant: ReadVariant,
  llmCallId: Uuid.nullable(),
  model: z.string(),
  modelServed: z.string(),
  effort: z.enum(["low", "medium"]),
  promptV: z.string(),
  schemaV: z.string(),
  stopReason: z.string(),
  costMicros: z.int().nonnegative(),
  provenance: Provenance,
});
export type ExtractionRead = z.infer<typeof ExtractionRead>;

export const SlipRow = z.strictObject({
  ...scoped,
  documentId: Uuid,
  serial: SlipSerial,
  rowNo: z.int().positive(),
  copy: CopyColor,
  memberId: Uuid.nullable(),
  memberNo: MemberNo.nullable(),
  slipDate: IsoDate.nullable(),
  station: Station,
  grossG: Grams.nullable(),
  tareG: Grams.nullable(),
  netG: Grams.nullable(),
  mcPctTenths: z.int().nonnegative().nullable(),
  mcLessG: Grams.nullable(),
  payableG: Grams.nullable(),
  grade: Grade.nullable(),
  minConfidence: z.number().min(0).max(1),
  state: SlipRowState,
  /** Fixture crop rectangle, normalised 0–1 (never from model boxes, C-10). */
  cropRect: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  provenance: Provenance,
});
export type SlipRow = z.infer<typeof SlipRow>;

export const SlipFieldDTO = z.strictObject({
  ...scoped,
  slipRowId: Uuid,
  field: SlipFieldName,
  readA: z.strictObject({ valueText: z.string(), legibility: Legibility }).nullable(),
  readB: z.strictObject({ valueText: z.string(), legibility: Legibility }).nullable(),
  zoom: z.strictObject({ valueText: z.string(), legibility: Legibility }).nullable(),
  score: z.number().min(0).max(1),
  /** Per-character merge of A and B ("6?.80"). */
  displayMerge: z.string(),
  finalValue: z.string().nullable(),
  decidedBy: DecidedBy.nullable(),
  provenance: Provenance,
});
export type SlipFieldDTO = z.infer<typeof SlipFieldDTO>;

export const DeductionMarkDTO = z.strictObject({
  ...scoped,
  slipRowId: Uuid,
  textVerbatim: z.string(),
  ruleId: z.string().nullable(),
  /** Written amount in PHP centavos, parsed by code. */
  writtenCentavos: z.int().nonnegative().nullable(),
  provenance: Provenance,
});
export type DeductionMarkDTO = z.infer<typeof DeductionMarkDTO>;

export const SlipAnomalyDTO = z.strictObject({
  ...scoped,
  documentId: Uuid,
  slipRowId: Uuid.nullable(),
  kind: AnomalyKind,
  source: QuarantineSource,
  quarantined: z.boolean(),
  /** Quarantined text never enters a later prompt; the UI shows a notice, not the text. */
  verbatim: z.string().nullable(),
  provenance: Provenance,
});
export type SlipAnomalyDTO = z.infer<typeof SlipAnomalyDTO>;

// ---------------------------------------------------------------- runs

export const PayRun = z.strictObject({
  ...scoped,
  seasonId: Uuid,
  runSeq: z.int().positive(),
  runSlug: RunSlug,
  state: PayRunState,
  version: z.int().nonnegative(),
  fx: Rational,
  quoteSha256: Sha256Hex.nullable(),
  rateCardSha256: Sha256Hex,
  batchSha256: Sha256Hex.nullable(),
  senderBatchId: z.string().nullable(),
  cashDay: IsoDate.nullable(),
  provenance: Provenance,
});
export type PayRun = z.infer<typeof PayRun>;

export const InvoiceDTO = z.strictObject({
  ...scoped,
  runId: Uuid,
  paypalInvoiceId: z.string().nullable(),
  invoiceNumber: z.string().max(25),
  status: InvoiceStatus,
  amountCents: NonNegCents,
  dueCents: NonNegCents,
  currency: z.literal("USD"),
  reference: z.string(),
  note: z.string(),
  invoiceDate: IsoDate,
  dueDate: IsoDate,
  autoCancelOn: IsoDate,
  payerViewUrl: z.string().nullable(),
  provenance: Provenance,
});
export type InvoiceDTO = z.infer<typeof InvoiceDTO>;

export const MemberLineDTO = z.strictObject({
  ...scoped,
  runId: Uuid,
  memberId: Uuid,
  memberNo: MemberNo,
  state: MemberLineState,
  rail: Rail,
  verifiedG: Grams,
  grade1G: Grams,
  premiumCents: NonNegCents,
  bonusCents: NonNegCents,
  deductions: z.array(
    z.strictObject({
      ruleId: z.string(),
      category: z.string(),
      amountCents: NonNegCents,
      ref: z.string().nullable(),
    }),
  ),
  creditsCents: NonNegCents,
  netCents: Cents,
  lineSha256: Sha256Hex,
  trace: z.array(z.string()),
  provenance: Provenance,
});
export type MemberLineDTO = z.infer<typeof MemberLineDTO>;

export const HoldDTO = z.strictObject({
  ...scoped,
  runId: Uuid,
  /** Display label in raise order: "H1", "H2", … (by-hand and the dial carry their own labels). */
  label: z.string(),
  key: z.string(),
  lineId: Uuid.nullable(),
  memberNo: MemberNo.nullable(),
  kind: HoldKind,
  gate: HoldGate,
  state: HoldState,
  engineParams: z.record(z.string(), Json),
  /** Engine line: a template whose digits all come from code. */
  engineLine: z.string(),
  /** Claude's line: pencil, never a digit. Null until written. */
  claudeLine: z.string().nullable(),
  evidence: z.array(z.strictObject({ kind: z.string(), ref: z.string() })),
  resolution: z
    .strictObject({
      kind: HoldResolutionKind,
      by: z.string(),
      at: IsoDateTime.nullable(),
      reason: z.string().nullable(),
    })
    .nullable(),
  provenance: Provenance,
});
export type HoldDTO = z.infer<typeof HoldDTO>;

export const ApprovalDTO = z.strictObject({
  ...scoped,
  runId: Uuid,
  role: ApprovalRole,
  keyId: KeyId,
  payloadJcs: z.string(),
  signatureHex: z.string().regex(/^[0-9a-f]{128}$/),
  nonce: z.string(),
  exp: IsoDateTime,
  signedAt: IsoDateTime,
  voidedAt: IsoDateTime.nullable(),
  /** "Demo key (this browser)" for web frames (C-13). */
  keyLabel: z.string(),
  provenance: Provenance,
});
export type ApprovalDTO = z.infer<typeof ApprovalDTO>;

export const StatementDTO = z.strictObject({
  ...scoped,
  lineId: Uuid,
  lang: Lang,
  sentences: z.array(z.strictObject({ id: z.string(), text: z.string(), placeholders: z.array(z.string()) })),
  sms: z.strictObject({ text: z.string(), gsm7Length: z.int().nonnegative() }),
  source: z.enum(["model", "template"]),
  provenance: Provenance,
});
export type StatementDTO = z.infer<typeof StatementDTO>;

export const CashReceiptDTO = z.strictObject({
  ...scoped,
  lineId: Uuid,
  memberNo: MemberNo,
  amountCents: NonNegCents,
  attestedBy: z.string(),
  signedWith: z.enum(["SIGNATURE", "THUMBMARK"]),
  receivedAt: IsoDateTime,
  provenance: Provenance,
});
export type CashReceiptDTO = z.infer<typeof CashReceiptDTO>;

export const ReviewRequestDTO = z.strictObject({
  ...scoped,
  lineId: Uuid,
  memberNo: MemberNo,
  slipSerial: SlipSerial.nullable(),
  note: z.string().nullable(),
  state: ReviewRequestState,
  answer: z.string().nullable(),
  createdAt: IsoDateTime,
  provenance: Provenance,
});
export type ReviewRequestDTO = z.infer<typeof ReviewRequestDTO>;

// ---------------------------------------------------------------- PayPal mirror

export const PayoutBatchDTO = z.strictObject({
  ...scoped,
  runId: Uuid,
  senderBatchId: z.string().max(256),
  requestId: Sha256Hex,
  paypalBatchId: z.string().nullable(),
  batchSha256: Sha256Hex,
  kind: PayoutBatchKind,
  status: PayoutBatchStatus,
  note: z.string(),
  provenance: Provenance,
});
export type PayoutBatchDTO = z.infer<typeof PayoutBatchDTO>;

export const PayoutItemDTO = z.strictObject({
  ...scoped,
  batchId: Uuid,
  lineId: Uuid,
  senderItemId: z.string().max(63),
  payoutItemId: z.string().nullable(),
  /** Masked for any public view. */
  receiver: z.string(),
  amountCents: z.int().positive(),
  currency: z.literal("USD"),
  status: PayoutItemStatus,
  statusRank: z.int().nonnegative(),
  feeCents: NonNegCents.nullable(),
  errors: z.array(z.string()),
  cancelRequestedAt: IsoDateTime.nullable(),
  cancelIntent: z.enum(["cash", "reroute"]).nullable(),
  supersedesItemId: Uuid.nullable(),
  provenance: Provenance,
});
export type PayoutItemDTO = z.infer<typeof PayoutItemDTO>;

export const WebhookEventDTO = z.strictObject({
  id: Uuid,
  workspaceId: Uuid.nullable(),
  paypalEventId: z.string(),
  eventType: z.string(),
  resourceKey: z.string().nullable(),
  verified: WebhookVerified.nullable(),
  status: WebhookStatus,
  receivedAt: IsoDateTime,
  provenance: Provenance,
});
export type WebhookEventDTO = z.infer<typeof WebhookEventDTO>;

export const PaypalCallDTO = z.strictObject({
  id: Uuid,
  at: IsoDateTime,
  purpose: z.string(),
  priority: CallPriority,
  path: z.string(),
  status: z.int(),
  debugId: z.string().nullable(),
  requestId: z.string().nullable(),
  ms: z.int().nonnegative(),
});
export type PaypalCallDTO = z.infer<typeof PaypalCallDTO>;

export const ReconciliationReportDTO = z.strictObject({
  ...scoped,
  kind: z.enum(["hot", "catchup", "nightly", "health"]),
  ranAt: IsoDateTime,
  windowStart: IsoDateTime.nullable(),
  windowEnd: IsoDateTime.nullable(),
  matched: z.int().nonnegative(),
  unmatched: z.int().nonnegative(),
  /** Transaction Search lags up to ~3 h; such figures are labelled. */
  lagging: z.boolean(),
  summary: z.record(z.string(), Json),
});
export type ReconciliationReportDTO = z.infer<typeof ReconciliationReportDTO>;

// ---------------------------------------------------------------- infrastructure

export const TaskOutboxDTO = z.strictObject({
  ...scoped,
  name: z.string(),
  args: z.record(z.string(), Json),
  dedupeKey: z.string(),
  state: TaskState,
  attempts: z.int().nonnegative(),
  runAfter: IsoDateTime,
  executor: Executor.nullable(),
  claimedBy: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type TaskOutboxDTO = z.infer<typeof TaskOutboxDTO>;

export const LedgerHeadDTO = z.strictObject({
  workspaceId: Uuid,
  seq: z.int().nonnegative(),
  headHash: Sha256Hex,
});
export type LedgerHeadDTO = z.infer<typeof LedgerHeadDTO>;

export const AgentSessionDTO = z.strictObject({
  ...scoped,
  runId: Uuid,
  purpose: z.enum(["DRAFT_INVOICE", "INVESTIGATE_HOLD", "REQUEST_BATCH"]),
  holdId: Uuid.nullable(),
  startedAt: IsoDateTime,
  iterations: z.int().nonnegative(),
  costMicros: z.int().nonnegative(),
  provenance: Provenance,
});
export type AgentSessionDTO = z.infer<typeof AgentSessionDTO>;

export const LlmCallDTO = z.strictObject({
  id: Uuid,
  cacheKey: Sha256Hex,
  purpose: z.string(),
  model: z.string(),
  modelServed: z.string(),
  effort: z.enum(["low", "medium"]),
  promptV: z.string(),
  schemaV: z.string(),
  stopReason: z.string(),
  costMicros: z.int().nonnegative(),
  recordedAt: IsoDateTime,
  provenance: Provenance,
});
export type LlmCallDTO = z.infer<typeof LlmCallDTO>;

export const IdempotencyKeyDTO = z.strictObject({
  key: z.string(),
  workspaceId: Uuid,
  bodySha256: Sha256Hex,
  responseStatus: z.int(),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type IdempotencyKeyDTO = z.infer<typeof IdempotencyKeyDTO>;

export const SystemFlagDTO = z.strictObject({
  workspaceId: Uuid,
  flag: SystemFlagName,
  on: z.boolean(),
  setBy: z.string().nullable(),
  setAt: IsoDateTime.nullable(),
  /** True when FS_KILL forces it on regardless of the stored value. */
  forcedByEnv: z.boolean(),
});
export type SystemFlagDTO = z.infer<typeof SystemFlagDTO>;

/** Actor carried by every run event and ledger entry. */
export const Actor = z.strictObject({
  kind: ActorKind,
  id: z.string(),
  impersonatedBy: z.string().nullable(),
});
export type Actor = z.infer<typeof Actor>;

export const MoneyPair = z.strictObject({ cents: Cents, currency: Currency });
export type MoneyPair = z.infer<typeof MoneyPair>;
