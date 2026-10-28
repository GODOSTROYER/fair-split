// msw handlers for the judge routes the console calls whose fs-api rules api-client's mock cannot apply here,
// answered by the same api-client mock world in fs-api's typed shapes (`JUDGE_ROUTES`): S3.8's frame tokens and
// S3.9's Reset, plus the `/healthz` rail label (ADR-0002). fs-api accepts Reset and frame tokens only from the
// judge cookie of that session (`requireOwnSession`), and a bearer wins over the cookie there, so a request
// carrying the console's bearer is refused (403). api-client's mock checks the `fs_js` cookie header, which
// neither the in-memory fetch nor a service worker can carry; here a request with no bearer stands for the
// cookie. A frame token is minted the way a phone pairs (createPairing, then claimPairing), so the world knows
// whose credential it is and attributes that phone's steps to the right persona. Everything is mock data.

import { HEADER, JUDGE_ROUTES } from "@fairsplit/api-client";
import { MOCK_SESSION_ID, MockProblem, type MockStage, type MockWorld } from "@fairsplit/api-client/msw";
import { ERROR_HTTP_STATUS, type Role } from "@fairsplit/contracts";
import { HttpResponse, http, type RequestHandler } from "msw";
import { FRAME_SCOPES, type FramePersona } from "../adapter.js";
import { PENDING_PATHS } from "../api.js";
import { TREASURER } from "./driver.js";

/** S3.8: who each Judge-stage frame is (its credential scope is `FRAME_SCOPES`). */
export const FRAME_PERSONAS: Readonly<
  Record<FramePersona, { readonly persona: string; readonly role: Role; readonly memberNo?: string }>
> = {
  member: { persona: "M-014", role: "member", memberNo: "M-014" },
  chair: { persona: "ernesto", role: "board" },
  clerk: { persona: "jessie", role: "clerk" },
};

/** S3.8: frame tokens live 2 hours. */
export const FRAME_TOKEN_TTL_MS = 2 * 60 * 60_000;

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

/** fs-api's `requireOwnSession`: the judge cookie of `:sid`, and never a bearer (a bearer wins over the cookie). */
function requireOwnSession(request: Request, sid: unknown): MockProblem | null {
  if (bearer(request)) {
    return new MockProblem("FORBIDDEN", "Only the judge stage that started this session can do this.");
  }
  if (String(sid).toLowerCase() !== MOCK_SESSION_ID) {
    return new MockProblem("FORBIDDEN", "This is another judge session.");
  }
  return null;
}

/** The frame persona a `{role}:{persona}` scope names, if the stage has that frame. */
function frameOf(scope: string): FramePersona | null {
  const entry = Object.entries(FRAME_SCOPES).find(([, s]) => s.toLowerCase() === scope.toLowerCase());
  return (entry?.[0] as FramePersona | undefined) ?? null;
}

/** Mints a frame token as a pairing would, so the world attributes the frame's steps to its persona. */
export function mintFrameToken(world: MockWorld, persona: FramePersona, nowMs: number) {
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
    role: who.role,
    persona: who.persona,
    workspaceId: world.workspaceId,
    expiresAt: new Date(nowMs + FRAME_TOKEN_TTL_MS).toISOString(),
  };
}

export interface PendingHandlerOptions {
  readonly world: MockWorld;
  /** Where Reset returns the world (the Judge stage's first view: `invoiced`). */
  readonly resetStage: MockStage;
  readonly now?: () => number;
}

/** Handlers for these routes, matched on any origin like api-client's own, and answered before them. */
export function createPendingHandlers(options: PendingHandlerOptions): RequestHandler[] {
  const { world } = options;
  const now = options.now ?? (() => Date.now());
  return [
    http.post(`*${PENDING_PATHS.frames}`, async ({ request, params }) => {
      const refused = requireOwnSession(request, params.sid);
      if (refused) return problem(world, refused);
      const parsed = JUDGE_ROUTES.frameToken.request.safeParse(await request.json().catch(() => null));
      const persona = parsed.success ? frameOf(parsed.data.persona) : null;
      if (!persona) {
        return problem(
          world,
          new MockProblem(
            "VALIDATION_FAILED",
            "A persona is {role}:{name}, e.g. board:ernesto or member:M-014.",
          ),
        );
      }
      try {
        const grant = mintFrameToken(world, persona, now());
        return HttpResponse.json(grant, { status: 201, headers: { [HEADER.rail]: world.rail } });
      } catch (error) {
        if (error instanceof MockProblem) return problem(world, error);
        throw error;
      }
    }),
    http.post(`*${PENDING_PATHS.reset}`, ({ request, params }) => {
      const refused = requireOwnSession(request, params.sid);
      if (refused) return problem(world, refused);
      world.reset(options.resetStage);
      return HttpResponse.json(
        {
          reset: true,
          sessionId: MOCK_SESSION_ID,
          workspaceId: world.workspaceId,
          endedAt: new Date(now()).toISOString(),
          revokedTokens: 1,
        },
        { status: 200, headers: { [HEADER.rail]: world.rail } },
      );
    }),
    http.get(`*${PENDING_PATHS.health}`, () =>
      HttpResponse.json(
        { status: "ok", service: "fs-api", mock: true, rail: world.rail },
        { headers: { "Cache-Control": "no-store" } },
      ),
    ),
  ];
}
