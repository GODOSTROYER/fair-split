// fs-api rules api-client's mock does not apply, mirrored here so the console's tests and `vite dev` fail the way
// fs-api would. Each handler answers only what it refuses (or the one read it adds) and lets everything else
// through to api-client's handlers. Reported to WS-API for its mock (SPLIT.md "Mock fidelity").
//
//   createPairing   a member's persona is their member number (fs-api credentials/personas.ts resolvePersona)
//   link bearers    signed links (`fsb_` brand, `fsm_` member) are read-only: a frame_or_session command answers
//                   403 (fs-api lib/command.ts runRoute, ACTING_KINDS)
//   addDeduction    the card must be this workspace's (fs-api runs/load.ts cardById: 404 before the trigger)
//   GET /v1/seasons/:seasonCode   the season read, with the workspace's rate card ID (fs-api runs/reads.ts)
//   GET /v1/proof/:runSlug  a brand link of the workspace earns the full tier (fs-api proof/tier.ts tierFor)
//   workspace mark IDs  a judge workspace mints its own deduction-mark IDs (fs-api judge/world.ts uuidv7, and
//                   runs/engine.ts `markId: m.id`), and a line's hash covers its credits' mark IDs (domain
//                   lineCanonical): a line carrying a returned mark hashes differently from the seed's, so the
//                   approval payload's `linesDigest` is the workspace's, never the seed's
//   GET /v1/runs/:runSlug/lines  the run's own member lines with those hashes (fs-api runs/reads.ts LineList)

import { compilePath, HEADER } from "@fairsplit/api-client";
import { MockProblem, type MockWorld, urlPattern } from "@fairsplit/api-client/msw";
import {
  API_COMMANDS,
  type ApprovalPayload,
  ERROR_HTTP_STATUS,
  type ErrorCode,
  type MemberLineDTO,
} from "@fairsplit/contracts";
import { getResponse, HttpResponse, http, type RequestHandler } from "msw";
import { type JcsValue, jcs } from "../../lib/jcs.js";
import { linesRoot } from "../../lib/lines-root.js";
import { sha256Hex } from "../../lib/sha256.js";

export interface FidelityOptions {
  readonly world: MockWorld;
  /** The workspace's rate card ID (a judge workspace's clone mints its own); default the seed's. */
  readonly rateCardId: string;
  /** api-client's own handlers: the answers this file rewrites (the approval payload) come from them first. */
  readonly upstream: readonly RequestHandler[];
}

/**
 * The run's member lines as the workspace stores them. A line whose credits name a mark carries the workspace's
 * own hash: fs-api hashes the same canonical line with the workspace's uuidv7 mark ID, which the mock stands in
 * for with a hash of the seed's line hash and the workspace ID. Every other line hashes as the seed's does.
 */
export function workspaceLines(world: MockWorld): MemberLineDTO[] {
  return world.lines().map((line) =>
    line.creditsCents > 0
      ? {
          ...line,
          lineSha256: sha256Hex(jcs({ seedLineSha256: line.lineSha256, workspaceId: world.workspaceId })),
        }
      : line,
  );
}

const LINES_PATH = /\/v1\/runs\/([^/]+)\/lines$/;

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
  const { world, rateCardId, upstream } = options;
  const headers = { [HEADER.rail]: world.rail, "Cache-Control": "no-store" };
  return [
    http.all("*", ({ request }) => {
      const token = bearer(request);
      if (!token || !/^fs[bm]_/.test(token)) return undefined;
      const pathname = new URL(request.url).pathname;
      const acting = ACTING_ONLY.some((c) => c.method === request.method && c.path.match(pathname));
      if (!acting) return undefined;
      return refuse(world, "FORBIDDEN", "Read-only links and the operator session cannot do this.");
    }),
    http.get(urlPattern("/v1/proof/:runSlug"), ({ request }) => {
      const token = bearer(request);
      if (!token?.startsWith("fsb_")) return undefined;
      const injected = world.takeFailure("proof");
      if (injected) return refuse(world, injected.code, injected.message);
      const runSlug = /\/v1\/proof\/([^/]+)$/.exec(new URL(request.url).pathname)?.[1] ?? "";
      try {
        const full = world.execute("proofExport", {
          params: { runSlug },
          input: undefined as never,
          caller: { token, persona: "brand", role: "brand" },
          headers: { idempotencyKey: null },
        });
        return HttpResponse.json(full.body, {
          headers: { [HEADER.rail]: world.rail, "Cache-Control": "no-store" },
        });
      } catch (error) {
        if (error instanceof MockProblem) return refuse(world, error.code, error.message);
        throw error;
      }
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
    http.get(urlPattern(API_COMMANDS.approvalPayload.path), async ({ request }) => {
      // api-client's mock answers (its auth, validation, injected failures and states); then the lines root is
      // the workspace's, and the JCS bytes are the rewritten payload's.
      const answer = await getResponse([...upstream], request.clone());
      if (!answer?.ok) return answer;
      const body = (await answer.clone().json()) as { payload: ApprovalPayload; jcs: string };
      const payload: ApprovalPayload = { ...body.payload, linesDigest: linesRoot(workspaceLines(world)) };
      return HttpResponse.json(
        { payload, jcs: jcs(payload as unknown as JcsValue) },
        { status: answer.status, headers: answer.headers },
      );
    }),
    http.get("*/v1/runs/:runSlug/lines", ({ request }) => {
      if (!bearer(request)) return refuse(world, "UNAUTHENTICATED", "Sign in, or start a judge session.");
      const runSlug = LINES_PATH.exec(new URL(request.url).pathname)?.[1] ?? "";
      if (runSlug !== world.runSlug) return refuse(world, "NOT_FOUND", "No such run in this workspace.");
      return HttpResponse.json({ runSlug, lines: workspaceLines(world) }, { headers });
    }),
    http.get("*/v1/seasons/:seasonCode", () =>
      // The fields the console reads (the rest of fs-api's SeasonView is not mocked here).
      HttpResponse.json({ rateCard: { id: rateCardId } }, { headers }),
    ),
  ];
}
