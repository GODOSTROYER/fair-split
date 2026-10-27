// msw handlers for the routes the console calls that API_COMMANDS does not list yet (pending in IC-08), answered
// by the same api-client mock world: S3.8's frame tokens, S3.9's Reset and the `/healthz` rail label
// (ADR-0002). A frame token is minted the way a phone pairs (createPairing, then claimPairing), so the world
// knows whose credential it is and attributes that phone's steps to the right persona. Everything is mock data.

import { HEADER } from "@fairsplit/api-client";
import { MOCK_SESSION_ID, MockProblem, type MockStage, type MockWorld } from "@fairsplit/api-client/msw";
import { ERROR_HTTP_STATUS, type Role } from "@fairsplit/contracts";
import { HttpResponse, http, type RequestHandler } from "msw";
import { z } from "zod";
import type { FramePersona, FrameTokenGrant } from "../adapter.js";
import { PENDING_PATHS } from "../api.js";
import { TREASURER } from "./driver.js";

/** S3.8: who each Judge-stage frame is, and the credential scope its token carries. */
export const FRAME_PERSONAS: Readonly<
  Record<
    FramePersona,
    { readonly scope: string; readonly persona: string; readonly role: Role; readonly memberNo?: string }
  >
> = {
  member: { scope: "member:M-014", persona: "M-014", role: "member", memberNo: "M-014" },
  chair: { scope: "board:ernesto", persona: "ernesto", role: "board" },
  clerk: { scope: "clerk:jessie", persona: "jessie", role: "clerk" },
};

/** S3.8: frame tokens live 2 hours. */
export const FRAME_TOKEN_TTL_MS = 2 * 60 * 60_000;

const FrameRequest = z.strictObject({ persona: z.enum(["member", "chair", "clerk"]) });

function problem(world: MockWorld, p: MockProblem): Response {
  const status = ERROR_HTTP_STATUS[p.code];
  return HttpResponse.json(
    { code: p.code, status, message: p.message },
    { status, headers: { [HEADER.rail]: world.rail, "Cache-Control": "no-store" } },
  );
}

function bearer(request: Request): string | null {
  return /^Bearer[ ]+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;
}

/** The session's console credential (the treasurer's, from createJudgeSession), else a refusal. */
function requireConsole(world: MockWorld, request: Request, sid: unknown): MockProblem | null {
  const token = bearer(request);
  const caller = token ? world.callerOf(token) : null;
  if (!caller) return new MockProblem("UNAUTHENTICATED", "Start a judge session first.");
  if (caller.role !== "treasurer" && caller.role !== "judge") {
    return new MockProblem("FORBIDDEN", "Only the judge's console manages its session.");
  }
  if (sid !== MOCK_SESSION_ID) return new MockProblem("NOT_FOUND", "No judge session with that ID.");
  return null;
}

/** Mints a frame token as a pairing would, so the world attributes the frame's steps to its persona. */
export function mintFrameToken(world: MockWorld, persona: FramePersona, nowMs: number): FrameTokenGrant {
  const who = FRAME_PERSONAS[persona];
  const pairing = world.execute("createPairing", {
    params: {},
    input: { persona: who.persona, role: who.role, ...(who.memberNo ? { memberNo: who.memberNo } : {}) },
    // The session's console (the treasurer) pairs the stage's phones.
    caller: TREASURER,
    headers: { idempotencyKey: null },
  });
  const claimed = world.execute("claimPairing", {
    params: {},
    input: { code6: pairing.body.code6 },
    caller: null,
    headers: { idempotencyKey: null },
  });
  return {
    token: claimed.body.token,
    exp: nowMs + FRAME_TOKEN_TTL_MS,
    persona: who.scope,
    ws: world.workspaceId,
  };
}

export interface PendingHandlerOptions {
  readonly world: MockWorld;
  /** Where Reset returns the world (the Judge stage's first view: `invoiced`). */
  readonly resetStage: MockStage;
  readonly now?: () => number;
}

/** Handlers for the pending routes, matched on any origin like api-client's own. */
export function createPendingHandlers(options: PendingHandlerOptions): RequestHandler[] {
  const { world } = options;
  const now = options.now ?? (() => Date.now());
  return [
    http.post(`*${PENDING_PATHS.frames}`, async ({ request, params }) => {
      const refused = requireConsole(world, request, params.sid);
      if (refused) return problem(world, refused);
      const parsed = FrameRequest.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return problem(world, new MockProblem("VALIDATION_FAILED", "A frame names member, chair or clerk."));
      }
      try {
        const grant = mintFrameToken(world, parsed.data.persona, now());
        return HttpResponse.json(grant, { status: 201, headers: { [HEADER.rail]: world.rail } });
      } catch (error) {
        if (error instanceof MockProblem) return problem(world, error);
        throw error;
      }
    }),
    http.post(`*${PENDING_PATHS.reset}`, ({ request, params }) => {
      const refused = requireConsole(world, request, params.sid);
      if (refused) return problem(world, refused);
      world.reset(options.resetStage);
      return new HttpResponse(null, { status: 204, headers: { [HEADER.rail]: world.rail } });
    }),
    http.get(`*${PENDING_PATHS.health}`, () =>
      HttpResponse.json(
        { status: "ok", service: "fs-api", mock: true, rail: world.rail },
        { headers: { "Cache-Control": "no-store" } },
      ),
    ),
  ];
}
