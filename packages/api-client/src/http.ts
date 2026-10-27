// IC-08: what HTTP adds to IC-01's `API_COMMANDS`. One definition shared by the server (apps/api), the typed
// client and the msw handlers, so the three can never disagree about a status, an error code, a header or a
// path. Pure: imports only `@fairsplit/contracts` (no fetch, no DOM, no node built-ins).
import { API_COMMANDS, type ApiCommandName, type ErrorCode, type SseScope } from "@fairsplit/contracts";
import type { z } from "zod";

// ---------------------------------------------------------------- commands

export type Command<N extends ApiCommandName> = (typeof API_COMMANDS)[N];

export const COMMAND_NAMES = Object.keys(API_COMMANDS) as ApiCommandName[];

/** The commands served as server-sent events (subscribe to them; they are not called). */
export type SseCommandName = {
  [N in ApiCommandName]: Command<N> extends { sse: true } ? N : never;
}[ApiCommandName];

/** The JSON request/response commands. */
export type JsonCommandName = Exclude<ApiCommandName, SseCommandName>;

export const JSON_COMMAND_NAMES = COMMAND_NAMES.filter((n) => !isSseCommand(n)) as JsonCommandName[];

export function isSseCommand(name: ApiCommandName): name is SseCommandName {
  return (API_COMMANDS[name] as { sse?: boolean }).sse === true;
}

/** Server side: what the handler receives (the request schema's output: POST body or GET query). */
export type CommandInput<N extends ApiCommandName> = Command<N>["request"] extends z.ZodType
  ? z.output<Command<N>["request"]>
  : undefined;

/** Client side: what the caller sends (the request schema's input). */
export type CommandRequest<N extends ApiCommandName> = Command<N>["request"] extends z.ZodType
  ? z.input<Command<N>["request"]>
  : undefined;

/** Server side: what a handler returns (the response schema's input; `never` when the command never succeeds). */
export type CommandOutput<N extends ApiCommandName> = Command<N>["response"] extends z.ZodType
  ? z.input<Command<N>["response"]>
  : never;

/** Client side: what a successful call resolves to (the response schema's output). */
export type CommandData<N extends ApiCommandName> = Command<N>["response"] extends z.ZodType
  ? z.output<Command<N>["response"]>
  : never;

// ---------------------------------------------------------------- path parameters

type ParamName<S extends string> = S extends `${infer Name}.${string}` ? Name : S;

/** `/v1/runs/:runSlug/approvals` → "runSlug"; `/v1/proof/:runSlug.json` → "runSlug". */
export type PathParamNames<P extends string> = P extends `${string}:${infer Rest}`
  ? Rest extends `${infer Seg}/${infer Tail}`
    ? ParamName<Seg> | PathParamNames<`/${Tail}`>
    : ParamName<Rest>
  : never;

export type PathParamsOf<P extends string> = { [K in PathParamNames<P>]: string };

export type PathParams<N extends ApiCommandName> = PathParamsOf<Command<N>["path"]>;

export function pathParamNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1] as string);
}

/** A run slug in a path: `2026A-r37`, `2026A-r4730001`. */
export const RUN_SLUG_PATTERN = "[0-9]{4}[A-Z]-r[0-9]+";

/** Fills `:params` (URL-encoded); `:runSlug.json` keeps its `.json` suffix. Throws on a missing param. */
export function fillPath(path: string, params: Readonly<Record<string, string>> = {}): string {
  return path.replace(/:([A-Za-z]+)/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined || value === "") throw new TypeError(`missing path param :${key} for ${path}`);
    return encodeURIComponent(value);
  });
}

export interface CompiledPath {
  readonly path: string;
  readonly names: readonly string[];
  readonly regex: RegExp;
  /** The decoded params when `pathname` matches, else null. */
  match(pathname: string): Record<string, string> | null;
}

/**
 * A contract path as an anchored matcher. `:runSlug` only matches a run slug, so `/v1/proof/:runSlug.json`
 * and `/v1/proof/:runSlug` never capture each other's URLs; other params match one path segment.
 */
export function compilePath(path: string): CompiledPath {
  const names: string[] = [];
  let source = "^";
  let last = 0;
  for (const m of path.matchAll(/:([A-Za-z]+)/g)) {
    source += escapeRegex(path.slice(last, m.index));
    const name = m[1] as string;
    names.push(name);
    source += name === "runSlug" ? `(${RUN_SLUG_PATTERN})` : "([^/]+)";
    last = (m.index ?? 0) + m[0].length;
  }
  source += `${escapeRegex(path.slice(last))}$`;
  const regex = new RegExp(source);
  return {
    path,
    names,
    regex,
    match(pathname) {
      const m = regex.exec(pathname);
      if (!m) return null;
      const out: Record<string, string> = {};
      try {
        names.forEach((name, i) => {
          out[name] = decodeURIComponent(m[i + 1] ?? "");
        });
      } catch {
        return null;
      }
      return out;
    },
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------- statuses and errors

export type SuccessStatus = 200 | 201 | 202;

/** Success statuses per command; the first is the default. 201 when the call creates something. */
export const SUCCESS_STATUS = {
  createJudgeSession: [201, 200],
  markPaid: [200],
  resolveHold: [200],
  enterField: [200],
  addDeduction: [],
  approvalPayload: [200],
  submitApproval: [201],
  declineApproval: [200],
  payCash: [200],
  resend: [200],
  capture: [201, 200],
  createPairing: [201],
  claimPairing: [200],
  presence: [200],
  createReviewRequest: [201],
  setFlag: [200],
  runEvents: [200],
  workspaceEvents: [200],
  proof: [200],
  proofJson: [200],
  proofExport: [200],
} as const satisfies Record<ApiCommandName, readonly SuccessStatus[]>;

export type CommandSuccessStatus<N extends ApiCommandName> = (typeof SUCCESS_STATUS)[N][number];

/**
 * Boundary errors any command can answer with, on top of its own `errors` list: a bad request, a missing
 * or expired credential, an id that is not in the caller's workspace, a throttle, or a server fault.
 */
export const COMMON_ERRORS = [
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FRAME_TOKEN_EXPIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMITED",
  "INTERNAL",
] as const satisfies readonly ErrorCode[];
export type CommonErrorCode = (typeof COMMON_ERRORS)[number];

/** A POST may carry `Idempotency-Key` (S3.10): another body under a used key is 422; a retry mid-flight 409. */
export const IDEMPOTENCY_ERRORS = [
  "IDEMPOTENCY_KEY_REUSED",
  "VERSION_CONFLICT",
] as const satisfies readonly ErrorCode[];
export type IdempotencyErrorCode = (typeof IDEMPOTENCY_ERRORS)[number];

type TakesIdempotencyKey<N extends ApiCommandName> = Command<N>["method"] extends "POST"
  ? Command<N>["auth"] extends "frame_or_session"
    ? true
    : false
  : false;

/** Every code command N can answer with. */
export type CommandErrorCode<N extends ApiCommandName> =
  | Command<N>["errors"][number]
  | CommonErrorCode
  | (TakesIdempotencyKey<N> extends true ? IdempotencyErrorCode : never);

export function takesIdempotencyKey(name: ApiCommandName): boolean {
  const cmd = API_COMMANDS[name];
  return cmd.method === "POST" && cmd.auth === "frame_or_session";
}

export function errorCodesOf(name: ApiCommandName): ErrorCode[] {
  const own = API_COMMANDS[name].errors as readonly ErrorCode[];
  const extra = takesIdempotencyKey(name) ? IDEMPOTENCY_ERRORS : [];
  return [...new Set<ErrorCode>([...own, ...COMMON_ERRORS, ...extra])];
}

/** A registered command whose handler is not filled in yet answers 501 with code INTERNAL and this reason. */
export const NOT_IMPLEMENTED_STATUS = 501;
export const NOT_IMPLEMENTED_REASON = "NOT_IMPLEMENTED";

// ---------------------------------------------------------------- headers and the rail (I8)

export const HEADER = {
  requestId: "X-Request-Id",
  /** `simulated` | `sandbox` on every /v1 response: which PayPal rail this server talks to (I8). */
  rail: "X-FS-Rail",
  idempotencyKey: "Idempotency-Key",
  contentDigest: "Content-Digest",
  lastEventId: "Last-Event-ID",
  /** `true` when a stored response was replayed for a repeated Idempotency-Key. */
  replayed: "Idempotent-Replayed",
  retryAfter: "Retry-After",
} as const;

/** The PayPal rail label every PayPal-derived value carries in the UI (ADR-0002). */
export type RailLabel = "simulated" | "sandbox";

/** `fetch`'s cookie policy (the DOM's `RequestCredentials`, spelled out so Node and React Native typecheck). */
export type CredentialsMode = "omit" | "same-origin" | "include";

export function railOf(value: string | null | undefined): RailLabel | null {
  return value === "simulated" || value === "sandbox" ? value : null;
}

// ---------------------------------------------------------------- server-sent events (S3.7)

/** Stream paths per SSE scope. `run` and `workspace` are IC-01 commands; `line` and `proof` are S3.7 streams. */
export const SSE_PATHS = {
  workspace: API_COMMANDS.workspaceEvents.path,
  run: API_COMMANDS.runEvents.path,
  line: "/v1/lines/:lineId/events",
  proof: "/v1/proof/:runSlug/events",
} as const satisfies Record<SseScope["kind"], string>;

/** Who may open each stream: an acting credential, that line's member link too, or anyone (aggregates only). */
export const SSE_AUTH = {
  workspace: "frame_or_session",
  run: "frame_or_session",
  line: "frame_or_session_or_member_link",
  proof: "public",
} as const satisfies Record<SseScope["kind"], string>;

/** The stream path for a scope, params filled. */
export function ssePath(scope: SseScope): string {
  switch (scope.kind) {
    case "workspace":
      return fillPath(SSE_PATHS.workspace, { ws: scope.ws });
    case "run":
      return fillPath(SSE_PATHS.run, { runSlug: scope.runSlug });
    case "line":
      return fillPath(SSE_PATHS.line, { lineId: scope.lineId });
    case "proof":
      return fillPath(SSE_PATHS.proof, { runSlug: scope.runSlug });
  }
}

/** The server pings every 15 s; a stream silent for longer than this is treated as dead and reopened. */
export const SSE_PING_MS = 15_000;
export const SSE_STALE_MS = 45_000;
/** Reconnect backoff (S3.7): 0.5 s doubling to 8 s, with jitter. */
export const SSE_BACKOFF = { minMs: 500, maxMs: 8_000 } as const;
