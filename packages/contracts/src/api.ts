// Request and response schemas for the API commands in decision register §4 ("API commands").
// `/v1/*` is typed RPC; OpenAPI and msw handlers are generated from this registry (IC-08).
import { z } from "zod";
import { ApprovalPayload, ProofBundle } from "./domain.js";
import {
  ApprovalDTO,
  HoldDTO,
  MemberLineDTO,
  ReviewRequestDTO,
  SlipFieldDTO,
  SystemFlagDTO,
} from "./entities.js";
import {
  ApprovalRole,
  HoldResolutionKind,
  InvoiceStatus,
  PayRunState,
  Role,
  SystemFlagName,
} from "./enums.js";
import type { ErrorCode } from "./errors.js";
import {
  DeviceKeyId,
  IsoDateTime,
  MemberNo,
  PlotNo,
  Provenance,
  RunSlug,
  Sha256Hex,
  SlipSerial,
  Uuid,
} from "./primitives.js";

export const HttpMethod = z.enum(["GET", "POST"]);
export type HttpMethod = z.infer<typeof HttpMethod>;

// ---------------------------------------------------------------- judge sessions

export const CreateJudgeSessionRequest = z.strictObject({});
export const CreateJudgeSessionResponse = z.strictObject({
  sessionId: Uuid,
  workspaceId: Uuid,
  runId: Uuid,
  runSlug: RunSlug,
  /** Bearer frame token for `treasurer:analyn`, 2 hours. Returned once, never put in a URL. */
  consoleToken: z.string().min(16),
  expiresAt: IsoDateTime,
  queuePosition: z.int().nonnegative().nullable(),
});

// ---------------------------------------------------------------- funding (simulated rail)

export const MarkPaidRequest = z.strictObject({});
export const MarkPaidResponse = z.strictObject({
  runSlug: RunSlug,
  invoiceId: z.string(),
  invoiceStatus: InvoiceStatus,
  runState: PayRunState,
  provenance: z.literal("simulated_rail"),
});

// ---------------------------------------------------------------- holds and fields

export const ResolveHoldRequest = z.discriminatedUnion("resolution", [
  z.strictObject({ resolution: z.literal("COUNT_ONCE") }),
  z.strictObject({ resolution: z.literal("TWO_DELIVERIES"), reason: z.string().min(3) }),
  z.strictObject({
    resolution: z.literal("REGISTER_PLOT"),
    plot: z.strictObject({
      plotNo: PlotNo,
      areaHa: z.string().regex(/^\d+\.\d{2}$/),
      trees: z.int().positive(),
    }),
  }),
  z.strictObject({ resolution: z.literal("RETURN_AS_CREDIT") }),
  z.strictObject({ resolution: z.literal("APPLY_RULE"), ruleId: z.enum(["R1", "R2", "R3", "R4"]) }),
  z.strictObject({ resolution: z.literal("EXCLUDE_LINE"), reason: z.string().min(3) }),
  z.strictObject({ resolution: z.literal("CONFIRM_AS_READ") }),
  z.strictObject({ resolution: z.literal("ASK_CHAIR"), reason: z.string().min(3) }),
]);
export type ResolveHoldRequest = z.infer<typeof ResolveHoldRequest>;
export const ResolveHoldResponse = z.strictObject({
  hold: HoldDTO,
  resolution: HoldResolutionKind.nullable(),
  runVersion: z.int().nonnegative(),
  recomputed: z.boolean(),
  /** Set when the resolution is an override and so needs the Chair (R5). */
  needsChair: z.boolean(),
});

export const EnterFieldRequest = z.strictObject({
  /** Exactly as typed, e.g. "64.80". Code derives the rest (net = gross − tare). */
  value: z.string().min(1).max(16),
});
export type EnterFieldRequest = z.infer<typeof EnterFieldRequest>;
export const EnterFieldResponse = z.strictObject({
  field: SlipFieldDTO,
  derived: z.record(z.string(), z.string()),
  /** Whether the derived net matches the logbook witness line. */
  logbookMatch: z.boolean().nullable(),
  matchesReadPattern: z.boolean(),
  runVersion: z.int().nonnegative(),
});

// ---------------------------------------------------------------- rate card (MM-4)

export const AddDeductionRequest = z.strictObject({
  label: z.string().min(1),
  amountText: z.string().min(1),
});
/** This command always answers 409 RATE_CARD_RATIFIED citing the hash. */
export const AddDeductionResponse = z.never();

// ---------------------------------------------------------------- approvals (I6)

export const ApprovalPayloadQuery = z.strictObject({ role: ApprovalRole });
export const ApprovalPayloadResponse = z.strictObject({ payload: ApprovalPayload, jcs: z.string() });

export const SubmitApprovalRequest = z.strictObject({
  role: ApprovalRole,
  /** Only a device key (`a`, `w` or a C-13 `demo` key) can sign; a seeded key (`s`) is refused by the schema. */
  keyId: DeviceKeyId,
  /** Ed25519 signature over the JCS bytes of `payload`, hex. */
  signature: z.string().regex(/^[0-9a-f]{128}$/),
  payload: ApprovalPayload,
});
export type SubmitApprovalRequest = z.infer<typeof SubmitApprovalRequest>;
export const SubmitApprovalResponse = z.strictObject({
  approval: ApprovalDTO,
  runState: PayRunState,
  needsChair: z.boolean(),
});

export const DeclineApprovalRequest = z.strictObject({
  role: ApprovalRole,
  keyId: DeviceKeyId.optional(),
  reason: z.string().min(3),
});
export const DeclineApprovalResponse = z.strictObject({ runState: PayRunState });

// ---------------------------------------------------------------- lines

export const PayCashRequest = z.strictObject({});
export const PayCashResponse = z.strictObject({ line: MemberLineDTO, cancelled: z.boolean() });

export const ResendRequest = z.strictObject({
  newReceiver: z.email().max(127),
  keyId: DeviceKeyId,
  signature: z.string().regex(/^[0-9a-f]{128}$/),
  payload: ApprovalPayload,
});
export const ResendResponse = z.strictObject({ line: MemberLineDTO, senderBatchId: z.string() });

// ---------------------------------------------------------------- captures (clerk outbox)

/** Headers: `Idempotency-Key` (UUIDv7 capture ID) and `Content-Digest` (sha-256). */
export const CaptureRequest = z.strictObject({
  captureId: Uuid,
  sha256: Sha256Hex,
  mime: z.enum(["image/jpeg", "image/webp", "image/png"]),
  bytes: z.int().positive(),
  station: z.enum(["BODEGA", "PUROK_2", "PUROK_4"]),
  capturedAt: IsoDateTime,
});
export type CaptureRequest = z.infer<typeof CaptureRequest>;
export const CaptureResponse = z.strictObject({
  documentId: Uuid,
  status: z.enum(["accepted", "already_received", "exact_duplicate"]),
  exactDuplicateOf: Uuid.nullable(),
});

// ---------------------------------------------------------------- pairing, presence, review, flags

export const CreatePairingRequest = z.strictObject({
  persona: z.string().min(1),
  role: Role,
  memberNo: MemberNo.optional(),
});
export const CreatePairingResponse = z.strictObject({
  /** `https://<origin>/app/pair#t=…`; single use, 10 minutes. */
  url: z.string(),
  code6: z.string().regex(/^\d{6}$/),
  expiresAt: IsoDateTime,
});

export const ClaimPairingRequest = z.union([
  z.strictObject({ token: z.string().min(16) }),
  z.strictObject({ code6: z.string().regex(/^\d{6}$/) }),
]);
export const ClaimPairingResponse = z.strictObject({
  token: z.string().min(16),
  role: Role,
  persona: z.string(),
  workspaceId: Uuid,
  expiresAt: IsoDateTime,
});

/** At most 1 Hz per client; the server throttles `presence` events to one per 5 s. */
export const PresenceRequest = z.strictObject({
  view: z.string().min(1).max(64),
  holdId: z.string().optional(),
});
export const PresenceResponse = z.strictObject({ ok: z.literal(true) });

export const CreateReviewRequest = z.strictObject({
  lineId: Uuid,
  slipSerial: SlipSerial.optional(),
  note: z.string().max(500).optional(),
});
export const CreateReviewResponse = z.strictObject({ reviewRequest: ReviewRequestDTO });

export const SetFlagRequest = z.strictObject({ flag: SystemFlagName, on: z.boolean() });
export const SetFlagResponse = z.strictObject({ flag: SystemFlagDTO });

// ---------------------------------------------------------------- proof

export const ProofResponse = z.strictObject({
  bundle: ProofBundle,
  provenance: Provenance,
  /** Public Proof shows member IDs only (C-23). */
  redacted: z.boolean(),
});

// ---------------------------------------------------------------- registry

export interface ApiCommand {
  readonly name: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly auth: "none" | "frame_or_session" | "public";
  readonly request: z.ZodType | null;
  readonly response: z.ZodType | null;
  readonly sse?: boolean;
  readonly errors: readonly ErrorCode[];
  readonly headers?: readonly string[];
}

export const API_COMMANDS = {
  createJudgeSession: {
    name: "createJudgeSession",
    method: "POST",
    path: "/v1/judge/sessions",
    auth: "none",
    request: CreateJudgeSessionRequest,
    response: CreateJudgeSessionResponse,
    errors: ["RATE_LIMITED", "QUEUED", "INTERNAL"],
  },
  markPaid: {
    name: "markPaid",
    method: "POST",
    path: "/v1/runs/:runSlug/mark-paid",
    auth: "frame_or_session",
    request: MarkPaidRequest,
    response: MarkPaidResponse,
    errors: ["INVALID_TRANSITION", "KILL_SWITCH_ON", "CIRCUIT_OPEN", "QUEUED", "PAYPAL_REJECTED"],
  },
  resolveHold: {
    name: "resolveHold",
    method: "POST",
    path: "/v1/holds/:holdId/resolve",
    auth: "frame_or_session",
    request: ResolveHoldRequest,
    response: ResolveHoldResponse,
    errors: ["HOLD_NOT_OPEN", "RESOLUTION_NOT_ALLOWED", "VERSION_CONFLICT", "FORBIDDEN"],
  },
  enterField: {
    name: "enterField",
    method: "POST",
    path: "/v1/fields/:fieldId/enter",
    auth: "frame_or_session",
    request: EnterFieldRequest,
    response: EnterFieldResponse,
    errors: ["VALIDATION_FAILED", "VERSION_CONFLICT", "FORBIDDEN"],
  },
  addDeduction: {
    name: "addDeduction",
    method: "POST",
    path: "/v1/rate-cards/:id/deductions",
    auth: "frame_or_session",
    request: AddDeductionRequest,
    response: null,
    errors: ["RATE_CARD_RATIFIED"],
  },
  approvalPayload: {
    name: "approvalPayload",
    method: "GET",
    path: "/v1/runs/:runSlug/approval-payload",
    auth: "frame_or_session",
    request: ApprovalPayloadQuery,
    response: ApprovalPayloadResponse,
    errors: ["BLOCKING_HOLDS_OPEN", "INVALID_TRANSITION"],
  },
  submitApproval: {
    name: "submitApproval",
    method: "POST",
    path: "/v1/runs/:runSlug/approvals",
    auth: "frame_or_session",
    request: SubmitApprovalRequest,
    response: SubmitApprovalResponse,
    errors: [
      "DIGEST_MISMATCH",
      "SIGNATURE_INVALID",
      "KEY_NOT_REGISTERED",
      "APPROVER_MISMATCH",
      "SIGNERS_NOT_DISTINCT",
      "SEASON_MISMATCH",
      "APPROVAL_EXPIRED",
      "NONCE_REUSED",
      "BLOCKING_HOLDS_OPEN",
      "KILL_SWITCH_ON",
      "INVALID_TRANSITION",
    ],
  },
  declineApproval: {
    name: "declineApproval",
    method: "POST",
    path: "/v1/runs/:runSlug/approvals/decline",
    auth: "frame_or_session",
    request: DeclineApprovalRequest,
    response: DeclineApprovalResponse,
    errors: ["INVALID_TRANSITION", "FORBIDDEN"],
  },
  payCash: {
    name: "payCash",
    method: "POST",
    path: "/v1/lines/:lineId/pay-cash",
    auth: "frame_or_session",
    request: PayCashRequest,
    response: PayCashResponse,
    errors: ["INVALID_TRANSITION", "KILL_SWITCH_ON", "PAYPAL_REJECTED", "CIRCUIT_OPEN"],
  },
  resend: {
    name: "resend",
    method: "POST",
    path: "/v1/lines/:lineId/resend",
    auth: "frame_or_session",
    request: ResendRequest,
    response: ResendResponse,
    errors: [
      "INVALID_TRANSITION",
      "SIGNATURE_INVALID",
      "KEY_NOT_REGISTERED",
      "APPROVER_MISMATCH",
      "KILL_SWITCH_ON",
      "PAYPAL_REJECTED",
    ],
  },
  capture: {
    name: "capture",
    method: "POST",
    path: "/v1/captures",
    auth: "frame_or_session",
    request: CaptureRequest,
    response: CaptureResponse,
    errors: ["CONTENT_DIGEST_MISMATCH", "IDEMPOTENCY_KEY_REUSED", "VALIDATION_FAILED"],
    headers: ["Idempotency-Key", "Content-Digest"],
  },
  createPairing: {
    name: "createPairing",
    method: "POST",
    path: "/v1/pairing",
    auth: "frame_or_session",
    request: CreatePairingRequest,
    response: CreatePairingResponse,
    errors: ["FORBIDDEN"],
  },
  claimPairing: {
    name: "claimPairing",
    method: "POST",
    path: "/v1/pairing/claim",
    auth: "none",
    request: ClaimPairingRequest,
    response: ClaimPairingResponse,
    errors: ["PAIRING_TOKEN_INVALID", "RATE_LIMITED"],
  },
  presence: {
    name: "presence",
    method: "POST",
    path: "/v1/presence",
    auth: "frame_or_session",
    request: PresenceRequest,
    response: PresenceResponse,
    errors: ["RATE_LIMITED"],
  },
  createReviewRequest: {
    name: "createReviewRequest",
    method: "POST",
    path: "/v1/review-requests",
    auth: "frame_or_session",
    request: CreateReviewRequest,
    response: CreateReviewResponse,
    errors: ["FORBIDDEN", "NOT_FOUND"],
  },
  setFlag: {
    name: "setFlag",
    method: "POST",
    path: "/v1/flags",
    auth: "frame_or_session",
    request: SetFlagRequest,
    response: SetFlagResponse,
    errors: ["FORBIDDEN"],
  },
  runEvents: {
    name: "runEvents",
    method: "GET",
    path: "/v1/runs/:runSlug/events",
    auth: "frame_or_session",
    request: null,
    response: null,
    sse: true,
    errors: ["NOT_FOUND", "UNAUTHENTICATED"],
    headers: ["Last-Event-ID"],
  },
  workspaceEvents: {
    name: "workspaceEvents",
    method: "GET",
    path: "/v1/workspaces/:ws/events",
    auth: "frame_or_session",
    request: null,
    response: null,
    sse: true,
    errors: ["NOT_FOUND", "UNAUTHENTICATED"],
    headers: ["Last-Event-ID"],
  },
  proof: {
    name: "proof",
    method: "GET",
    path: "/v1/proof/:runSlug",
    auth: "public",
    request: null,
    response: ProofResponse,
    errors: ["NOT_FOUND"],
  },
  proofJson: {
    name: "proofJson",
    method: "GET",
    path: "/v1/proof/:runSlug.json",
    auth: "public",
    request: null,
    response: ProofResponse,
    errors: ["NOT_FOUND"],
  },
  proofExport: {
    name: "proofExport",
    method: "GET",
    path: "/v1/proof/:runSlug/export",
    auth: "frame_or_session",
    request: null,
    response: ProofResponse,
    errors: ["NOT_FOUND", "FORBIDDEN"],
  },
} as const satisfies Record<string, ApiCommand>;

export type ApiCommandName = keyof typeof API_COMMANDS;

/** Non-RPC paths the API also serves (register §4). */
export const API_PATHS = {
  webhooks: "/webhooks/paypal",
  healthz: "/healthz",
  readyz: "/readyz",
  openapi: "/openapi.json",
  docs: "/docs",
} as const;

/** Fills `:params` in a command path. */
export function apiPath(path: string, params: Record<string, string>): string {
  return path.replace(/:([A-Za-z]+)/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`missing path param ${key}`);
    return encodeURIComponent(value);
  });
}
