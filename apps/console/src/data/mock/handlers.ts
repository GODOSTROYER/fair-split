// msw handlers for every API_COMMANDS entry, backed by a MockWorld over the seed snapshot. Requests are
// parsed with the contract's request schema (400 VALIDATION_FAILED otherwise), credentials are checked by
// auth class (401 UNAUTHENTICATED), and every success is parsed with the response schema before it leaves,
// so the mock can never drift from IC-01. SSE streams replay from Last-Event-ID, then stream live. The
// answers themselves come from ./resolvers.ts, which the in-memory adapter shares.

import { API_COMMANDS, type ApiCommandName, apiError, type RunEvent } from "@fairsplit/contracts";
import { HttpResponse, http, type RequestHandler } from "msw";
import type { CallableName } from "../adapter.js";
import { sseFrame } from "../sse.js";
import { framePersonaOf, resolveCommand, streamScopeKey } from "./resolvers.js";
import { MockApiError, type MockWorld } from "./world.js";

function errorResponse(error: unknown): Response {
  if (error instanceof MockApiError) return HttpResponse.json(error.body, { status: error.status });
  const body = apiError("INTERNAL", error instanceof Error ? error.message : "The mock failed.");
  return HttpResponse.json(body, { status: body.status });
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

const UNPARSEABLE = Symbol("unparseable");

async function bodyOf(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return UNPARSEABLE;
  }
}

function queryOf(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

export interface MockHandlerOptions {
  /** Prefix for absolute URLs in Node tests ("http://localhost"); empty in the browser. */
  readonly origin?: string;
}

/** The handler for one callable command: its contract, its auth class, and the world's answer. */
function commandHandler(world: MockWorld, name: CallableName, origin: string): RequestHandler {
  const def = API_COMMANDS[name];
  const path = `${origin}${def.path}`;
  const method = def.method === "GET" ? http.get : http.post;
  return method(path, async ({ request, params }) => {
    const raw = def.method === "GET" ? queryOf(request) : await bodyOf(request);
    let input: unknown = raw;
    if (def.request) {
      const parsed = def.request.safeParse(raw);
      if (!parsed.success) {
        const failure = apiError("VALIDATION_FAILED", `${name}: the request does not match its contract.`);
        return HttpResponse.json(failure, { status: failure.status });
      }
      input = parsed.data;
    }
    const session = world.sessionForToken(bearer(request));
    if (def.auth === "frame_or_session" && !session) {
      const failure = apiError("UNAUTHENTICATED", "Start a judge session first.");
      return HttpResponse.json(failure, { status: failure.status });
    }
    try {
      const result = resolveCommand(world, name, {
        params: params as Record<string, string>,
        input,
        session,
      });
      if (def.response) def.response.parse(result);
      return HttpResponse.json(result as unknown as Record<string, unknown>, {
        status: name === "createJudgeSession" ? 201 : 200,
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
}

function streamHandler(
  world: MockWorld,
  name: "runEvents" | "workspaceEvents",
  origin: string,
): RequestHandler {
  return http.get(`${origin}${API_COMMANDS[name].path}`, ({ request, params }) => {
    if (!world.sessionForToken(bearer(request))) {
      const failure = apiError("UNAUTHENTICATED", "Start a judge session first.");
      return HttpResponse.json(failure, { status: failure.status });
    }
    const scope = streamScopeKey(name, params as Record<string, string>);
    const lastEventId = request.headers.get("last-event-id");
    const encoder = new TextEncoder();
    let stop: (() => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: RunEvent) => {
          try {
            controller.enqueue(encoder.encode(sseFrame(event)));
          } catch {
            stop?.();
          }
        };
        controller.enqueue(encoder.encode(": connected\n\n"));
        for (const event of world.eventsAfter(scope, lastEventId)) send(event);
        stop = world.listen(scope, send);
        request.signal.addEventListener("abort", () => {
          stop?.();
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      },
      cancel() {
        stop?.();
      },
    });
    return new HttpResponse(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
    });
  });
}

/** Command names the mock answers over HTTP (the parity test checks this equals API_COMMANDS). */
export const MOCKED_COMMANDS: readonly ApiCommandName[] = [
  "createJudgeSession",
  "markPaid",
  "resolveHold",
  "enterField",
  "addDeduction",
  "approvalPayload",
  "submitApproval",
  "declineApproval",
  "payCash",
  "resend",
  "capture",
  "createPairing",
  "claimPairing",
  "presence",
  "createReviewRequest",
  "setFlag",
  "proofJson",
  "proofExport",
  "proof",
  "runEvents",
  "workspaceEvents",
];

export function createMockHandlers(world: MockWorld, options: MockHandlerOptions = {}): RequestHandler[] {
  const o = options.origin ?? "";
  const handlers: RequestHandler[] = [];
  for (const name of MOCKED_COMMANDS) {
    if (name === "runEvents" || name === "workspaceEvents") handlers.push(streamHandler(world, name, o));
    // `/v1/proof/:runSlug.json` must match before the bare Proof path would take "2026A-r37.json".
    else if (name === "proofJson") handlers.push(proofJsonHandler(world, o));
    else handlers.push(commandHandler(world, name, o));
  }
  // Pending IC-08 additions the console already calls (adapter.pending, reported to WS-API).
  handlers.push(
    http.post(`${o}/v1/judge/sessions/:sid/frames`, async ({ request, params }) => {
      const persona = framePersonaOf(await bodyOf(request));
      if (!persona) {
        const failure = apiError("VALIDATION_FAILED", "Name the frame's persona: member, chair or clerk.");
        return HttpResponse.json(failure, { status: failure.status });
      }
      try {
        return HttpResponse.json(world.frameToken(String(params.sid), persona));
      } catch (error) {
        return errorResponse(error);
      }
    }),
    http.post(`${o}/v1/judge/sessions/:sid/reset`, ({ params }) => {
      try {
        world.resetSession(String(params.sid));
        return HttpResponse.json({ ok: true });
      } catch (error) {
        return errorResponse(error);
      }
    }),
  );
  return handlers;
}

function proofJsonHandler(world: MockWorld, origin: string): RequestHandler {
  return http.get(new RegExp(`^${escapeRegExp(origin)}/v1/proof/([^/]+)\\.json$`), ({ request }) => {
    const slug = /\/v1\/proof\/([^/]+)\.json$/.exec(new URL(request.url).pathname)?.[1] ?? "";
    try {
      const result = resolveCommand(world, "proofJson", {
        params: { runSlug: decodeURIComponent(slug) },
        input: null,
        session: null,
      });
      return HttpResponse.json(API_COMMANDS.proofJson.response.parse(result));
    } catch (error) {
      return errorResponse(error);
    }
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
