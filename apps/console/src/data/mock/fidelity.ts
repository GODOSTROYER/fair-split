// fs-api rules api-client's mock does not apply, mirrored here so the console's tests and `vite dev` fail the way
// fs-api would. Each handler answers only what it refuses (or the one read it adds) and lets everything else
// through to api-client's handlers. Reported to WS-API for its mock (SPLIT.md "Mock fidelity").
//
//   createPairing   a member's persona is their member number (fs-api credentials/personas.ts resolvePersona)
//   link bearers    signed links (`fsb_` brand, `fsm_` member) are read-only: a frame_or_session command answers
//                   403 (fs-api lib/command.ts runRoute, ACTING_KINDS)
//   addDeduction    the card must be this workspace's (fs-api runs/load.ts cardById: 404 before the trigger)
//   GET /v1/seasons/:seasonCode   the season read, with the workspace's rate card ID (fs-api runs/reads.ts)

import { compilePath, HEADER } from "@fairsplit/api-client";
import type { MockWorld } from "@fairsplit/api-client/msw";
import { API_COMMANDS, ERROR_HTTP_STATUS, type ErrorCode } from "@fairsplit/contracts";
import { HttpResponse, http, type RequestHandler } from "msw";

export interface FidelityOptions {
  readonly world: MockWorld;
  /** The workspace's rate card ID (a judge workspace's clone mints its own); default the seed's. */
  readonly rateCardId: string;
}

function refuse(world: MockWorld, code: ErrorCode, message: string): Response {
  const status = ERROR_HTTP_STATUS[code];
  return HttpResponse.json(
    { code, status, message },
    { status, headers: { [HEADER.rail]: world.rail, "Cache-Control": "no-store" } },
  );
}

function bearer(request: Request): string | null {
  return /^Bearer[ ]+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;
}

/** The commands fs-api runs only for an acting credential (frame, device, judge session). */
const ACTING_ONLY = Object.values(API_COMMANDS)
  .filter((c) => c.auth === "frame_or_session")
  .map((c) => ({ method: c.method, path: compilePath(c.path) }));

export function createFidelityHandlers(options: FidelityOptions): RequestHandler[] {
  const { world, rateCardId } = options;
  return [
    http.all("*", ({ request }) => {
      const token = bearer(request);
      if (!token || !/^fs[bm]_/.test(token)) return undefined;
      const pathname = new URL(request.url).pathname;
      const acting = ACTING_ONLY.some((c) => c.method === request.method && c.path.match(pathname));
      if (!acting) return undefined;
      return refuse(world, "FORBIDDEN", "Read-only links and the operator session cannot do this.");
    }),
    http.post("*/v1/pairing", async ({ request }) => {
      const body = (await request
        .clone()
        .json()
        .catch(() => null)) as { persona?: unknown; role?: unknown; memberNo?: unknown } | null;
      if (!body || typeof body.persona !== "string") return undefined;
      if (body.role === "member") {
        const memberNo = typeof body.memberNo === "string" ? body.memberNo : body.persona;
        if (body.persona !== memberNo) {
          return refuse(
            world,
            "VALIDATION_FAILED",
            `A member's persona is their member number (${memberNo}).`,
          );
        }
      } else if (body.memberNo !== undefined) {
        return refuse(world, "VALIDATION_FAILED", "Only a member persona takes a member number.");
      }
      return undefined;
    }),
    http.post("*/v1/rate-cards/:id/deductions", ({ params }) => {
      if (String(params.id).toLowerCase() === rateCardId.toLowerCase()) return undefined;
      return refuse(world, "NOT_FOUND", "No such rate card in this workspace.");
    }),
    http.get("*/v1/seasons/:seasonCode", () =>
      // The fields the console reads (the rest of fs-api's SeasonView is not mocked here).
      HttpResponse.json(
        { rateCard: { id: rateCardId } },
        { headers: { [HEADER.rail]: world.rail, "Cache-Control": "no-store" } },
      ),
    ),
  ];
}
