// The RunEvent catalogue (IC-01). `run_events` is append-only: it is the realtime feed (SSE with
// Last-Event-ID replay), the replay source and the timeline. Payloads carry IDs and facts, never
// secrets. One forward-only `item.updated` event feeds every surface (C-05).
import { z } from "zod";
import { Actor } from "./entities.js";
import {
  AgentBlock,
  ApprovalRole,
  DecidedBy,
  HoldGate,
  HoldKind,
  HoldResolutionKind,
  HoldState,
  InvoiceStatus,
  MemberLineState,
  PayoutItemStatus,
  PayRunState,
  PolicyName,
  QuarantineSource,
  ReadVariant,
  SlipFieldName,
  SystemFlagName,
  Verdict,
  WebhookVerified,
} from "./enums.js";
import { IsoDateTime, KeyId, MemberNo, Provenance, Sha256Hex, SlipSerial } from "./primitives.js";

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
export const RunEventType = z.enum(RUN_EVENT_TYPES);
export type RunEventType = z.infer<typeof RunEventType>;

/** Why a state moved: a short machine code plus an optional reference (event ID, hold ID…). */
export const Cause = z.strictObject({ code: z.string(), ref: z.string().nullable() });
export type Cause = z.infer<typeof Cause>;

const Box = z.strictObject({ x1: z.int(), y1: z.int(), x2: z.int(), y2: z.int() });

const ExtractRowField = z.strictObject({
  value: z.string().nullable(),
  score: z.number().min(0).max(1),
  decidedBy: DecidedBy.nullable(),
  display: z.string(),
});

export const RunEventPayloads = {
  "run.state": z.strictObject({ runId: z.string(), from: PayRunState, to: PayRunState, cause: Cause }),
  "line.state": z.strictObject({
    lineId: z.string(),
    memberNo: MemberNo,
    from: MemberLineState,
    to: MemberLineState,
    cause: Cause,
  }),
  "item.updated": z.strictObject({
    itemId: z.string(),
    senderItemId: z.string(),
    memberNo: MemberNo,
    payoutItemId: z.string().nullable(),
    from: PayoutItemStatus,
    to: PayoutItemStatus,
    rank: z.int().nonnegative(),
    /** "webhook" when a verified event moved it; "status_check" when a GET did. */
    source: z.enum(["webhook", "status_check", "post_response", "cancel"]),
    eventId: z.string().nullable(),
  }),
  "hold.raised": z.strictObject({
    holdId: z.string(),
    label: z.string(),
    key: z.string(),
    kind: HoldKind,
    gate: HoldGate,
    memberNo: MemberNo.nullable(),
    lineId: z.string().nullable(),
  }),
  "hold.resolved": z.strictObject({
    holdId: z.string(),
    label: z.string(),
    state: HoldState,
    resolution: HoldResolutionKind,
    resolvedBy: z.string(),
  }),
  "field.entered": z.strictObject({
    fieldId: z.string(),
    docId: z.string(),
    serial: SlipSerial,
    field: SlipFieldName,
    value: z.string(),
    derived: z.record(z.string(), z.string()),
    enteredBy: z.string(),
  }),
  "extract.row": z.strictObject({
    docId: z.string(),
    row: z.int().nonnegative(),
    serial: SlipSerial,
    memberNo: MemberNo.nullable(),
    fields: z.record(z.string(), ExtractRowField),
  }),
  "extract.field": z.strictObject({
    docId: z.string(),
    row: z.int().nonnegative(),
    field: SlipFieldName,
    variant: ReadVariant,
    box: Box,
  }),
  "extract.quarantined": z.strictObject({
    docId: z.string(),
    row: z.int().nonnegative().nullable(),
    box: Box.nullable(),
    source: QuarantineSource,
  }),
  "approval.signed": z.strictObject({
    approvalId: z.string(),
    role: ApprovalRole,
    keyId: KeyId,
    batchSha256: Sha256Hex,
  }),
  "approval.declined": z.strictObject({ role: ApprovalRole, reason: z.string(), by: z.string() }),
  presence: z.strictObject({
    persona: z.string(),
    view: z.string(),
    holdId: z.string().nullable(),
    expiresAt: IsoDateTime,
  }),
  "webhook.received": z.strictObject({
    webhookEventId: z.string(),
    paypalEventId: z.string(),
    eventType: z.string(),
    verified: WebhookVerified,
    duplicate: z.boolean(),
  }),
  "invoice.state": z.strictObject({
    invoiceId: z.string(),
    invoiceNumber: z.string(),
    from: InvoiceStatus.nullable(),
    to: InvoiceStatus,
    dueCents: z.int().nonnegative(),
  }),
  "policy.verdict": z.strictObject({
    tool: z.string(),
    verdict: Verdict,
    decidedBy: z.array(PolicyName),
    reasons: z.array(z.string()),
    sessionId: z.string().nullable(),
  }),
  "agent.delta": z.strictObject({ sessionId: z.string(), block: AgentBlock, text: z.string() }),
  "capture.synced": z.strictObject({
    captureId: z.string(),
    documentId: z.string(),
    sha256: Sha256Hex,
    exactDuplicateOf: z.string().nullable(),
  }),
  "flag.changed": z.strictObject({ flag: SystemFlagName, on: z.boolean(), by: z.string() }),
} as const satisfies Record<RunEventType, z.ZodType>;

const envelope = {
  /** bigserial, as a string so it can be the SSE Last-Event-ID. */
  id: z.string().regex(/^\d+$/),
  ws: z.string(),
  runId: z.string().nullable(),
  at: IsoDateTime,
  actor: Actor,
  provenance: Provenance,
};

function variant<T extends RunEventType>(type: T) {
  return z.strictObject({ ...envelope, type: z.literal(type), payload: RunEventPayloads[type] });
}

export const RunEvent = z.discriminatedUnion("type", [
  variant("run.state"),
  variant("line.state"),
  variant("item.updated"),
  variant("hold.raised"),
  variant("hold.resolved"),
  variant("field.entered"),
  variant("extract.row"),
  variant("extract.field"),
  variant("extract.quarantined"),
  variant("approval.signed"),
  variant("approval.declined"),
  variant("presence"),
  variant("webhook.received"),
  variant("invoice.state"),
  variant("policy.verdict"),
  variant("agent.delta"),
  variant("capture.synced"),
  variant("flag.changed"),
]);
export type RunEvent = z.infer<typeof RunEvent>;
export type RunEventOf<T extends RunEventType> = Extract<RunEvent, { type: T }>;
export type RunEventPayload<T extends RunEventType> = z.infer<(typeof RunEventPayloads)[T]>;

/** SSE scopes served by the API (S3.7). */
export const SseScope = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("workspace"), ws: z.string() }),
  z.strictObject({ kind: z.literal("run"), runSlug: z.string() }),
  z.strictObject({ kind: z.literal("line"), lineId: z.string() }),
  z.strictObject({ kind: z.literal("proof"), runSlug: z.string() }),
]);
export type SseScope = z.infer<typeof SseScope>;
