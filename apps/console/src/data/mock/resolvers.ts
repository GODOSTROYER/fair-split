// How the mock world answers each API_COMMANDS entry, shared by both mock transports: the msw handlers
// (HTTP, for dev in a browser with service workers and for Node tests) and the in-memory adapter (dev where a
// service worker cannot register, and fast component tests). One table, so the two can never disagree.

import type { ApiCommandName } from "@fairsplit/contracts";
import type { CallableName, CommandRequest, CommandResponse, FramePersona } from "../adapter.js";
import type { MockSession, MockWorld } from "./world.js";

export interface ResolveContext {
  readonly params: Readonly<Record<string, string>>;
  /** The request, already parsed by the command's contract schema (query for GET, body for POST). */
  readonly input: unknown;
  /** The judge session the bearer token belongs to, or null. */
  readonly session: MockSession | null;
}

type Resolver<N extends CallableName> = (world: MockWorld, ctx: ResolveContext) => CommandResponse<N> | never;

const p = (ctx: ResolveContext, key: string): string => ctx.params[key] ?? "";
const body = <N extends CallableName>(ctx: ResolveContext) => ctx.input as CommandRequest<N>;

/** Every callable command (API_COMMANDS minus the two SSE streams), answered by the world. */
export const MOCK_RESOLVERS: { readonly [N in CallableName]: Resolver<N> } = {
  createJudgeSession: (world) => world.createJudgeSession(),
  markPaid: (world, ctx) => world.markPaid(p(ctx, "runSlug")),
  resolveHold: (world, ctx) => world.resolveHold(p(ctx, "holdId"), body<"resolveHold">(ctx)),
  enterField: (world, ctx) => world.enterField(p(ctx, "fieldId"), body<"enterField">(ctx)),
  addDeduction: (world) => world.addDeduction(),
  approvalPayload: (world, ctx) =>
    world.approvalPayload(p(ctx, "runSlug"), body<"approvalPayload">(ctx).role),
  submitApproval: (world, ctx) => world.submitApproval(p(ctx, "runSlug"), body<"submitApproval">(ctx)),
  declineApproval: (world, ctx) => world.declineApproval(p(ctx, "runSlug"), body<"declineApproval">(ctx)),
  payCash: (world, ctx) => world.payCash(p(ctx, "lineId")),
  resend: (world, ctx) => world.resend(p(ctx, "lineId"), body<"resend">(ctx)),
  capture: (world, ctx) => world.capture(body<"capture">(ctx), ctx.session),
  createPairing: (world, ctx) => world.createPairing(body<"createPairing">(ctx)),
  claimPairing: (world) => world.claimPairing(),
  presence: (world, ctx) => world.presence(ctx.session, body<"presence">(ctx)),
  createReviewRequest: (world, ctx) =>
    world.createReviewRequest(ctx.session, body<"createReviewRequest">(ctx)),
  setFlag: (world, ctx) => world.setFlag(ctx.session, body<"setFlag">(ctx)),
  proof: (world, ctx) => world.proof(p(ctx, "runSlug"), false),
  proofJson: (world, ctx) => world.proof(p(ctx, "runSlug"), false),
  proofExport: (world, ctx) => world.proof(p(ctx, "runSlug"), true),
};

export function resolveCommand<N extends CallableName>(
  world: MockWorld,
  name: N,
  ctx: ResolveContext,
): CommandResponse<N> {
  return (MOCK_RESOLVERS[name] as Resolver<N>)(world, ctx);
}

/** The SSE scope key the world files events under, for a stream command's params. */
export function streamScopeKey(
  name: Extract<ApiCommandName, "runEvents" | "workspaceEvents">,
  params: Readonly<Record<string, string>>,
): string {
  return name === "runEvents" ? `run:${params.runSlug ?? ""}` : `workspace:${params.ws ?? ""}`;
}

/** `{persona}` from a frame-token request body, or null. */
export function framePersonaOf(input: unknown): FramePersona | null {
  const persona = (input as { persona?: unknown } | null)?.persona;
  return persona === "member" || persona === "chair" || persona === "clerk" ? persona : null;
}
