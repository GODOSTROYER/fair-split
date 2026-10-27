// msw handlers for every IC-01 command, generated from `API_COMMANDS` and answered by a `MockWorld`.
// They behave like fs-api at the boundary, so a screen built on them meets no surprise on the real server:
// the same paths (`:runSlug` only matches a run slug), auth classes (401 without a credential), request
// validation (400 VALIDATION_FAILED with located issues), `Content-Digest` (422) and `Idempotency-Key` checks,
// IC-01 `ApiError` bodies with the right statuses, `Retry-After`, `X-Request-Id`, `X-FS-Rail` and SSE with
// Last-Event-ID replay. Parity with API_COMMANDS is tested (src/msw/parity.test.ts).
import {
  API_COMMANDS,
  type ApiCommandName,
  ERROR_HTTP_STATUS,
  type ErrorCode,
  type RunEvent,
  RunSlug,
} from "@fairsplit/contracts";
import { delay, type HttpHandler, HttpResponse, http } from "msw";
import { z } from "zod";
import { contentDigest, uuidv7 } from "../bytes.js";
import {
  type Command,
  type CommandRequest,
  compilePath,
  errorCodesOf,
  HEADER,
  JSON_COMMAND_NAMES,
  type JsonCommandName,
  SSE_PATHS,
} from "../http.js";
import { type CommandInvocation, type MockCaller, MockProblem, type MockWorld } from "./world.js";

export interface MockHandlerOptions {
  world: MockWorld;
  /**
   * Origin to match, e.g. `http://localhost:8787`. Default: any origin, so the same handlers serve a browser
   * (relative `/v1/...` URLs resolve against the page) and Node tests.
   */
  baseUrl?: string;
  /** Simulated latency per request: a number of ms, or msw's "real" (100–400 ms). Default 0. */
  latency?: number | "real";
  /** "required" (default): frame_or_session commands answer 401 without a bearer token or judge cookie. */
  auth?: "required" | "lenient";
  /** The judge code `POST /v1/judge/code` accepts (default "judge-code"). */
  judgeCode?: string;
  /** The operator password `POST /v1/ops/login` accepts (default "operator"). */
  operatorPassword?: string;
}

const UUID = z.uuid();

function originPattern(baseUrl: string | undefined): string {
  if (!baseUrl) return "[a-zA-Z][a-zA-Z0-9+.-]*://[^/]+";
  return baseUrl.replace(/\/+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** An anchored RegExp over the full URL for a contract path (msw matches RegExps against the clean URL). */
export function urlPattern(path: string, baseUrl?: string): RegExp {
  const compiled = compilePath(path);
  return new RegExp(`^${originPattern(baseUrl)}${compiled.regex.source.slice(1)}`);
}

function problemBody(p: MockProblem, requestId: string): Record<string, unknown> {
  return {
    ...(p.extra.fields ?? {}),
    code: p.code,
    status: ERROR_HTTP_STATUS[p.code],
    message: p.message,
    requestId,
    ...(p.extra.retryAfterMs !== undefined ? { retryAfterMs: Math.ceil(p.extra.retryAfterMs) } : {}),
    ...(p.extra.paypalDebugId ? { paypalDebugId: p.extra.paypalDebugId } : {}),
    ...(p.extra.details ? { details: p.extra.details } : {}),
  };
}

export function baseHeaders(world: MockWorld, requestId: string): Record<string, string> {
  return {
    [HEADER.requestId]: requestId,
    [HEADER.rail]: world.rail,
    "Cache-Control": "no-store",
  };
}

export function problemResponse(world: MockWorld, p: MockProblem, requestId: string): Response {
  const headers: Record<string, string> = baseHeaders(world, requestId);
  if (p.extra.retryAfterMs !== undefined) {
    headers[HEADER.retryAfter] = String(Math.max(1, Math.ceil(p.extra.retryAfterMs / 1000)));
  }
  return HttpResponse.json(problemBody(p, requestId), { status: ERROR_HTTP_STATUS[p.code], headers });
}

function bearerOf(request: Request): string | null {
  const m = /^Bearer[ ]+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  return m?.[1] ?? null;
}

function hasJudgeCookie(request: Request): boolean {
  return /(?:^|;\s*)fs_js=/.test(request.headers.get("cookie") ?? "");
}

/** The caller: a token the world minted, any well-formed token (as the judge), the judge cookie, or none. */
export function callerOf(world: MockWorld, request: Request): MockCaller | null {
  const token = bearerOf(request);
  if (token) {
    return world.callerOf(token) ?? { token, persona: "judge", role: "judge" };
  }
  if (hasJudgeCookie(request)) return { token: null, persona: "judge", role: "judge" };
  return null;
}

export function validationProblem(
  message: string,
  issues: { path: string; message: string; code: string }[],
) {
  return new MockProblem("VALIDATION_FAILED", message, { details: { issues } });
}

export function checkParams(path: string, params: Record<string, string>): void {
  const issues: { path: string; message: string; code: string }[] = [];
  for (const [name, value] of Object.entries(params)) {
    const ok = name === "runSlug" ? RunSlug.safeParse(value).success : UUID.safeParse(value).success;
    if (!ok) issues.push({ path: `params.${name}`, message: `not a valid ${name}`, code: "invalid_param" });
  }
  if (issues.length > 0) throw validationProblem(`A path parameter of ${path} is not valid.`, issues);
}

async function readInput<N extends JsonCommandName>(
  name: N,
  request: Request,
  url: URL,
): Promise<{ input: CommandRequest<N>; text: string }> {
  const cmd = API_COMMANDS[name] as Command<JsonCommandName>;
  const schema = cmd.request as z.ZodType | null;
  let raw: unknown;
  let text = "";
  if (cmd.method === "POST") {
    text = await request.text();
    if (text.trim() === "") raw = {};
    else {
      try {
        raw = JSON.parse(text);
      } catch {
        throw validationProblem("The body is not valid JSON.", [
          { path: "body", message: "not valid JSON", code: "invalid_json" },
        ]);
      }
    }
  } else {
    raw = Object.fromEntries(url.searchParams.entries());
  }
  if (!schema) return { input: undefined as CommandRequest<N>, text };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const where = cmd.method === "POST" ? "body" : "query";
    throw validationProblem(
      "The request does not match the contract.",
      parsed.error.issues.slice(0, 20).map((i) => ({
        path: [where, ...i.path.map(String)].join("."),
        message: i.message,
        code: i.code,
      })),
    );
  }
  return { input: parsed.data as CommandRequest<N>, text };
}

function commandHandler<N extends JsonCommandName>(name: N, o: MockHandlerOptions): HttpHandler {
  const { world } = o;
  const cmd = API_COMMANDS[name] as Command<JsonCommandName>;
  const compiled = compilePath(cmd.path);
  const declared = (cmd as { headers?: readonly string[] }).headers ?? [];
  const method = cmd.method === "GET" ? http.get : http.post;
  return method(urlPattern(cmd.path, o.baseUrl), async ({ request }) => {
    const requestId = uuidv7();
    if (o.latency !== undefined) await delay(o.latency);
    try {
      const url = new URL(request.url);
      const params = compiled.match(url.pathname);
      if (!params) throw new MockProblem("NOT_FOUND", `No route for ${cmd.method} ${url.pathname}`);
      const caller = callerOf(world, request);
      if (cmd.auth === "frame_or_session" && !caller && (o.auth ?? "required") === "required") {
        throw new MockProblem("UNAUTHENTICATED", "Sign in again: this request carries no valid credential.");
      }
      checkParams(cmd.path, params);
      const { input, text } = await readInput(name, request, url);
      if (declared.includes(HEADER.contentDigest)) {
        const header = request.headers.get(HEADER.contentDigest);
        if (!header) {
          throw validationProblem("Content-Digest is required.", [
            { path: "headers.content-digest", message: "required", code: "invalid" },
          ]);
        }
        if (header !== contentDigest(text)) {
          throw new MockProblem(
            "CONTENT_DIGEST_MISMATCH",
            "The body does not match its Content-Digest; resend it.",
          );
        }
      }
      const idempotencyKey = request.headers.get(HEADER.idempotencyKey);
      if (declared.includes(HEADER.idempotencyKey) && !idempotencyKey) {
        throw validationProblem("Idempotency-Key is required.", [
          { path: "headers.idempotency-key", message: "required", code: "invalid" },
        ]);
      }
      const injected = world.takeFailure(name);
      if (injected) throw injected;
      const call: CommandInvocation<N> = { params, input, caller, headers: { idempotencyKey } };
      const out = world.execute(name, call);
      return HttpResponse.json(out.body as object, {
        status: out.status,
        headers: baseHeaders(world, requestId),
      });
    } catch (err) {
      if (err instanceof MockProblem) return problemResponse(world, err, requestId);
      return problemResponse(
        world,
        new MockProblem(
          "INTERNAL",
          `mock ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
        requestId,
      );
    }
  });
}

// ---------------------------------------------------------------- SSE

type StreamKind = keyof typeof SSE_PATHS;

const encoder = new TextEncoder();

function frame(e: RunEvent): string {
  return `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
}

/** Which events a stream carries: everything (workspace, run), one line's, or public aggregates (proof). */
function inScope(world: MockWorld, kind: StreamKind, params: Record<string, string>, e: RunEvent): boolean {
  switch (kind) {
    case "workspace":
      return true;
    case "run":
      return e.runId === world.runId;
    case "line": {
      const line = world.line(params.lineId ?? "");
      if (!line) return false;
      const p = e.payload as { lineId?: string; memberNo?: string };
      return p.lineId === line.id || p.memberNo === line.memberNo;
    }
    case "proof":
      return e.type === "item.updated";
  }
}

/** The public Proof stream carries only aggregate counters ("3 of 8 confirmed"), never member data. */
function aggregateFrame(world: MockWorld, e: RunEvent): string {
  const confirmed = world
    .events()
    .filter((x) => x.type === "item.updated" && Number(x.id) <= Number(e.id))
    .reduce((m, x) => {
      const p = x.payload as { senderItemId: string; to: string };
      m.set(p.senderItemId, p.to);
      return m;
    }, new Map<string, string>());
  const of = world.lines().filter((l) => l.rail === "PAYPAL").length;
  const data = {
    confirmed: [...confirmed.values()].filter((s) => s === "SUCCESS").length,
    parked: [...confirmed.values()].filter((s) => s === "UNCLAIMED" || s === "RETURNED").length,
    of,
    at: e.at,
  };
  return `id: ${e.id}\nevent: aggregate\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamHandler(kind: StreamKind, o: MockHandlerOptions): HttpHandler {
  const { world } = o;
  const path = SSE_PATHS[kind];
  const compiled = compilePath(path);
  return http.get(urlPattern(path, o.baseUrl), ({ request }) => {
    const requestId = uuidv7();
    const url = new URL(request.url);
    const params = compiled.match(url.pathname) ?? {};
    const caller = callerOf(world, request);
    if (kind !== "proof" && !caller && (o.auth ?? "required") === "required") {
      return problemResponse(
        world,
        new MockProblem("UNAUTHENTICATED", "Sign in again: this request carries no valid credential."),
        requestId,
      );
    }
    if (kind === "run" && params.runSlug !== world.runSlug) {
      return problemResponse(
        world,
        new MockProblem("NOT_FOUND", "No such run in this workspace."),
        requestId,
      );
    }
    if (kind === "workspace" && params.ws !== world.workspaceId) {
      return problemResponse(world, new MockProblem("NOT_FOUND", "No such workspace."), requestId);
    }
    if (kind === "line" && !world.line(params.lineId ?? "")) {
      return problemResponse(
        world,
        new MockProblem("NOT_FOUND", "No such line in this workspace."),
        requestId,
      );
    }
    const lastRaw = request.headers.get(HEADER.lastEventId) ?? url.searchParams.get("lastEventId") ?? "";
    const after = /^\d{1,15}$/.test(lastRaw) ? Number(lastRaw) : 0;
    let unsubscribe: (() => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (text: string) => {
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            unsubscribe?.();
          }
        };
        const send = (e: RunEvent) => {
          if (Number(e.id) <= after || !inScope(world, kind, params, e)) return;
          write(kind === "proof" ? aggregateFrame(world, e) : frame(e));
        };
        write("retry: 1000\n: connected (mock)\n\n");
        for (const e of world.events().slice(-500)) send(e);
        unsubscribe = world.subscribe(send);
        request.signal?.addEventListener("abort", () => {
          unsubscribe?.();
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      },
      cancel() {
        unsubscribe?.();
      },
    });
    return new HttpResponse(stream, {
      status: 200,
      headers: { ...baseHeaders(world, requestId), "Content-Type": "text/event-stream; charset=utf-8" },
    });
  });
}

/** Every handler: one per JSON command, plus the run, workspace, line and public Proof streams. */
export function createMockHandlers(o: MockHandlerOptions): HttpHandler[] {
  return [
    ...JSON_COMMAND_NAMES.map((name) => commandHandler(name, o)),
    ...(Object.keys(SSE_PATHS) as StreamKind[]).map((kind) => streamHandler(kind, o)),
  ];
}

/** The codes `failNext` accepts for a command (its own errors plus the boundary ones). */
export function injectableCodes(name: ApiCommandName): ErrorCode[] {
  return errorCodesOf(name);
}
