// Response and request schemas of the judge slice's extra routes (documented in OpenAPI from these, and
// checked by the shell before a response leaves). IC-01 commands use the contract's own schemas.
import {
  IsoDateTime,
  MemberNo,
  PayRunState,
  PolicyName,
  Role,
  RunSlug,
  Uuid,
  Verdict,
} from "@fairsplit/contracts";
import { z } from "zod";
import { TAMPER_KINDS } from "./tamper.js";

export const QuotaView = z.strictObject({
  dailyCap: z.int().nonnegative(),
  used24h: z.int().nonnegative(),
  hourlyCap: z.int().nonnegative(),
  usedThisHour: z.int().nonnegative(),
  sessionCap: z.int().nonnegative(),
  sessionUsed: z.int().nonnegative(),
  publicCap: z.int().nonnegative(),
  publicUsed: z.int().nonnegative(),
  coded: z.boolean(),
  balance: z.strictObject({
    cents: z.int(),
    /** "opening_estimate" until a balance reading exists: the UI says "estimate". */
    source: z.enum(["reading", "opening_estimate"]),
    at: IsoDateTime.nullable(),
  }),
});

export const RailView = z.strictObject({
  mode: z.enum(["live", "replay"]),
  reason: z
    .enum([
      "kill_switch",
      "simulator_not_running",
      "circuit_open",
      "balance_low",
      "daily_cap",
      "hourly_cap",
      "session_cap",
      "public_share",
    ])
    .nullable(),
  label: z.string(),
  rail: z.enum(["simulated", "sandbox"]),
  quota: QuotaView,
});

export const LaneStatus = z.strictObject({
  /** 0 = this session's burst holds the lane; n = n bursts ahead; null = not in the lane. */
  position: z.int().nonnegative().nullable(),
  etaMs: z.int().nonnegative().nullable(),
  depth: z.int().nonnegative(),
  holderStep: z.string().nullable(),
});

export const JudgeSessionStatus = z.strictObject({
  sessionId: Uuid,
  workspaceId: Uuid,
  runId: Uuid.nullable(),
  runSlug: RunSlug.nullable(),
  runState: PayRunState.nullable(),
  /** When the workspace (and every token minted in it) ends. */
  sessionExpiresAt: IsoDateTime,
  rail: RailView,
  lane: LaneStatus,
  tamper: z.strictObject({ changePayoutArmed: z.boolean() }),
});

export const PublicLaneView = z.strictObject({
  lane: z.strictObject({ depth: z.int().nonnegative(), holderStep: z.string().nullable() }),
  rail: RailView,
});

export const ResetResponse = z.strictObject({
  reset: z.literal(true),
  sessionId: Uuid,
  workspaceId: Uuid,
  endedAt: IsoDateTime,
  revokedTokens: z.int().nonnegative(),
});

export const TamperRequest = z.strictObject({ kind: z.enum(TAMPER_KINDS) });
export const TamperResponse = z.strictObject({
  kind: z.enum(TAMPER_KINDS),
  label: z.string(),
  simulated: z.literal(true),
  runSlug: RunSlug,
  verdict: Verdict.nullable(),
  decidedBy: z.array(PolicyName),
  reasons: z.array(z.string()),
  armed: z.boolean(),
  paypalCalls: z.literal(0),
  modelCalls: z.literal(0),
});

export const JudgeCodeRequest = z.strictObject({ code: z.string().min(1).max(128) });
export const JudgeCodeResponse = z.strictObject({
  ok: z.literal(true),
  bucket: z.literal("judge_code"),
});

// ---------------------------------------------------------------- auth folder

export const FrameTokenRequest = z.strictObject({
  /** `{role}:{persona}`: board:ernesto, member:M-014, clerk:jessie, treasurer:analyn, brand:dana. */
  persona: z.string().min(3).max(48),
});
export const FrameTokenResponse = z.strictObject({
  /** Bearer `fst_…`, 2 h. Sent to the frame over IC-12 (`fs.token`), never in a URL. */
  token: z.string().min(16),
  role: Role,
  persona: z.string(),
  workspaceId: Uuid,
  expiresAt: IsoDateTime,
});

export const OpsLoginRequest = z.strictObject({ password: z.string().min(1).max(1024) });
export const OpsLoginResponse = z.strictObject({ ok: z.literal(true), expiresAt: IsoDateTime });
export const OkResponse = z.strictObject({ ok: z.literal(true) });

export const CredentialView = z.strictObject({
  kind: z.enum(["frame", "device", "judge_session", "operator", "member_link", "brand_link"]),
  role: Role,
  persona: z.string(),
  /** The actor this credential writes as (`{role}:{persona}`). */
  actor: z.string(),
  impersonatedBy: z.string().nullable(),
  workspaceId: Uuid.nullable(),
  sessionId: Uuid.nullable(),
  lineId: Uuid.nullable(),
  memberNo: MemberNo.nullable(),
  brand: z.string().nullable(),
  runSlug: RunSlug.nullable(),
  expiresAt: IsoDateTime,
});

export const MemberLinkRequest = z.strictObject({ lineId: Uuid });
export const BrandLinkRequest = z.strictObject({
  workspaceId: Uuid,
  brand: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
    .optional(),
});
export const LinkResponse = z.strictObject({
  kind: z.enum(["member", "brand"]),
  /** `https://<origin>/s/<token>` or `/b/<token>`: the link is its own secret; share it, never log it. */
  url: z.string(),
  jti: z.string(),
  expiresAt: IsoDateTime,
});
export const RevokeLinkRequest = z.strictObject({ jti: z.string().min(8).max(64) });
export const RevokeLinkResponse = z.strictObject({ revoked: z.boolean(), jti: z.string() });
