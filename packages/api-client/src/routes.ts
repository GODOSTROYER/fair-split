// Typed calls for the fs-api routes outside IC-01 that the Judge stage, the frame bridge (IC-12) and /ops use:
// the judge slice's session, lane, token renewal, Reset, "Try to break it", judge code and demo keys, and the auth
// folder's frame tokens, operator sign-in, operator pairing, whoami and signed links.
//
//   import { createApiClient, judgeRoutes } from "@fairsplit/api-client";
//   const judge = judgeRoutes(createApiClient());                 // same origin: the judge cookie rides along
//   const status = await judge.judgeSession();                    // { rail: { mode, reason, label, quota }, lane, … }
//   const { token } = await judge.frameToken({ params: { sid }, body: { persona: "board:ernesto" } });
//   const renewed = await judge.renewJudgeSession({ params: { sid }, token: null }); // 401 once the session ended
//
// The schemas mirror the server's route definitions (apps/api/src/judge/schemas.ts, judge/keys.ts and the auth
// folder). apps/api's `client-routes` test compares every one with the route the server mounts (method, path,
// auth class, success statuses and both schemas as JSON Schema), so drift fails CI on either side.
import {
  CreateJudgeSessionResponse,
  CreatePairingResponse,
  DeviceKeyId,
  Ed25519PublicKeyHex,
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
import type { ApiClient, CallOptions } from "./client.js";
import type { PathParamNames } from "./http.js";

// ---------------------------------------------------------------- vocabularies (as the server defines them)

/** Why a judge step replays instead of going live (S3.9). */
export const REPLAY_REASONS = [
  "kill_switch",
  "simulator_not_running",
  "circuit_open",
  "lane_full",
  "balance_unknown",
  "balance_low",
  "daily_cap",
  "hourly_cap",
  "session_cap",
  "public_share",
] as const;
export type ReplayReason = (typeof REPLAY_REASONS)[number];

/** Where the balance estimate behind the live-post floor comes from. */
export const BALANCE_SOURCES = ["reading", "simulator_opening", "unknown"] as const;

/** "Try to break it" (S3.9): three tampers with a draft invoice, and a one-cent change after both keys. */
export const TAMPER_KINDS = ["amount", "offsetting", "recipient", "change_payout"] as const;
export type TamperKind = (typeof TAMPER_KINDS)[number];

// ---------------------------------------------------------------- judge folder

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
    cents: z.int().nullable(),
    source: z.enum(BALANCE_SOURCES),
    at: IsoDateTime.nullable(),
  }),
});

export const RailView = z.strictObject({
  mode: z.enum(["live", "replay"]),
  reason: z.enum(REPLAY_REASONS).nullable(),
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
export const JudgeCodeResponse = z.strictObject({ ok: z.literal(true), bucket: z.literal("judge_code") });

export const DemoKeyRequest = z.strictObject({
  publicKeyHex: Ed25519PublicKeyHex,
  /** Ed25519 signature (hex) over the JCS of the registration statement: proof the browser holds the key. */
  signatureHex: z.string().regex(/^[0-9a-f]{128}$/),
});
export const DemoKeyResponse = z.strictObject({
  keyId: DeviceKeyId,
  approverId: z.string(),
  kind: z.literal("web_demo"),
  label: z.string(),
  publicKeyHex: Ed25519PublicKeyHex,
});

// ---------------------------------------------------------------- auth folder

export const FrameTokenRequest = z.strictObject({
  /** `{role}:{persona}`: board:ernesto, member:M-014, clerk:jessie, treasurer:analyn, brand:dana. */
  persona: z.string().min(3).max(48),
});
export const FrameTokenResponse = z.strictObject({
  /** Bearer `fst_…`, 2 h. Hand it to the frame over IC-12 (`fs.token`), never in a URL. */
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

export const OpsPairingRequest = z.strictObject({
  workspaceId: Uuid,
  persona: z.string().min(1).max(32),
  role: Role,
  memberNo: MemberNo.optional(),
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
/** A lost slip: every live member link of one line (printed on any day, or issued) is revoked. */
export const RevokeLineLinksRequest = z.strictObject({ lineId: Uuid });
export const RevokeLineLinksResponse = z.strictObject({
  lineId: Uuid,
  /** The links this call revoked (none when nothing of the line was still live). */
  jtis: z.array(z.string()),
});

// ---------------------------------------------------------------- the route table

export type RouteAuth = "none" | "public" | "frame_or_session" | "operator";

export interface RouteSpec {
  readonly method: "GET" | "POST";
  /** Contract style, `:param` segments. */
  readonly path: string;
  readonly auth: RouteAuth;
  readonly request: z.ZodType | null;
  readonly response: z.ZodType;
  readonly success: readonly number[];
}

/** The judge and auth routes outside IC-01, keyed by the server's route name. */
export const JUDGE_ROUTES = {
  judgeSession: {
    method: "GET",
    path: "/v1/judge/session",
    auth: "frame_or_session",
    request: null,
    response: JudgeSessionStatus,
    success: [200],
  },
  judgeLane: {
    method: "GET",
    path: "/v1/judge/lane",
    auth: "public",
    request: null,
    response: PublicLaneView,
    success: [200],
  },
  resetJudgeSession: {
    method: "POST",
    path: "/v1/judge/sessions/:sid/reset",
    auth: "frame_or_session",
    request: null,
    response: ResetResponse,
    success: [200],
  },
  /**
   * The console token's renewal, with the judge cookie alone: resumes this session only (createJudgeSession's
   * resume answer). An ended session (Reset, expiry, purge) is 401 FRAME_TOKEN_EXPIRED, never a new workspace.
   */
  renewJudgeSession: {
    method: "POST",
    path: "/v1/judge/sessions/:sid/renew",
    auth: "frame_or_session",
    request: null,
    response: CreateJudgeSessionResponse,
    success: [200],
  },
  tamper: {
    method: "POST",
    path: "/v1/judge/sessions/:sid/tamper",
    auth: "frame_or_session",
    request: TamperRequest,
    response: TamperResponse,
    success: [200],
  },
  judgeCode: {
    method: "POST",
    path: "/v1/judge/code",
    auth: "frame_or_session",
    request: JudgeCodeRequest,
    response: JudgeCodeResponse,
    success: [200],
  },
  registerDemoKey: {
    method: "POST",
    path: "/v1/judge/keys",
    auth: "frame_or_session",
    request: DemoKeyRequest,
    response: DemoKeyResponse,
    success: [201],
  },
  frameToken: {
    method: "POST",
    path: "/v1/judge/sessions/:sid/frames",
    auth: "frame_or_session",
    request: FrameTokenRequest,
    response: FrameTokenResponse,
    success: [201],
  },
  opsLogin: {
    method: "POST",
    path: "/v1/ops/login",
    auth: "none",
    request: OpsLoginRequest,
    response: OpsLoginResponse,
    success: [200],
  },
  opsLogout: {
    method: "POST",
    path: "/v1/ops/logout",
    auth: "none",
    request: null,
    response: OkResponse,
    success: [200],
  },
  opsPairing: {
    method: "POST",
    path: "/v1/ops/pairing",
    auth: "operator",
    request: OpsPairingRequest,
    response: CreatePairingResponse,
    success: [201],
  },
  whoami: {
    method: "GET",
    path: "/v1/credential",
    auth: "public",
    request: null,
    response: CredentialView,
    success: [200],
  },
  issueMemberLink: {
    method: "POST",
    path: "/v1/links/member",
    auth: "frame_or_session",
    request: MemberLinkRequest,
    response: LinkResponse,
    success: [201],
  },
  revokeMemberLink: {
    method: "POST",
    path: "/v1/links/member/revoke",
    auth: "frame_or_session",
    request: RevokeLinkRequest,
    response: RevokeLinkResponse,
    success: [200],
  },
  revokeLineLinks: {
    method: "POST",
    path: "/v1/links/member/revoke-line",
    auth: "frame_or_session",
    request: RevokeLineLinksRequest,
    response: RevokeLineLinksResponse,
    success: [200],
  },
  issueBrandLink: {
    method: "POST",
    path: "/v1/links/brand",
    auth: "operator",
    request: BrandLinkRequest,
    response: LinkResponse,
    success: [201],
  },
} as const satisfies Record<string, RouteSpec>;

export type JudgeRouteName = keyof typeof JUDGE_ROUTES;
type Route<K extends JudgeRouteName> = (typeof JUDGE_ROUTES)[K];

type RouteParams<K extends JudgeRouteName> = [PathParamNames<Route<K>["path"]>] extends [never]
  ? unknown
  : { params: Record<PathParamNames<Route<K>["path"]>, string> };
type RouteBody<K extends JudgeRouteName> = Route<K>["request"] extends z.ZodType
  ? { body: z.input<Route<K>["request"]> }
  : unknown;

/** Arguments of route K: `params` for path params, `body` when it takes one, and call options. */
export type RouteArgs<K extends JudgeRouteName> = RouteParams<K> & RouteBody<K> & CallOptions;
export type RouteData<K extends JudgeRouteName> = z.output<Route<K>["response"]>;

type RouteMethod<K extends JudgeRouteName> =
  object extends RouteArgs<K>
    ? (args?: RouteArgs<K>) => Promise<RouteData<K>>
    : (args: RouteArgs<K>) => Promise<RouteData<K>>;

export type JudgeRouteMethods = { readonly [K in JudgeRouteName]: RouteMethod<K> };

/**
 * One typed method per judge and auth route over a client (its token, cookies, errors and rail handling):
 * answers parse with the route's schema, and refusals throw the client's typed `ApiClientError`.
 */
export function judgeRoutes(api: ApiClient): JudgeRouteMethods {
  const call = (name: JudgeRouteName, args: Record<string, unknown> = {}) => {
    const route: RouteSpec = JUDGE_ROUTES[name];
    const { params, body, ...options } = args as {
      params?: Record<string, string>;
      body?: unknown;
    } & CallOptions;
    return api.request({
      ...options,
      name,
      method: route.method,
      path: route.path,
      ...(params ? { params } : {}),
      ...(route.method === "POST" ? { body: body ?? {} } : {}),
      schema: route.response,
    });
  };
  return Object.fromEntries(
    (Object.keys(JUDGE_ROUTES) as JudgeRouteName[]).map((name) => [
      name,
      (args?: Record<string, unknown>) => call(name, args),
    ]),
  ) as unknown as JudgeRouteMethods;
}
