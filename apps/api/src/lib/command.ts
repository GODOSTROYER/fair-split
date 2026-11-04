// The command builder: one place that turns an IC-01 command (or a slice's extra route) into a Hono route
// with the same behaviour everywhere, so slices only write the handler:
//
//   1. credential: `frame_or_session` → a verified acting credential or 401/403; `public`/`none` → optional
//      (a presented credential that fails is available as `ctx.credentialProblem`); `operator` → fs_ops.
//   2. path params: validated (runSlug → RunSlug, ids → UUID) → 400 VALIDATION_FAILED.
//   3. declared headers: `Content-Digest` must match the body (422 CONTENT_DIGEST_MISMATCH);
//      `Idempotency-Key` required where declared.
//   4. input: POST JSON body / GET query parsed with the contract's zod schema → 400 VALIDATION_FAILED.
//   5. idempotency: a POST with `Idempotency-Key` runs once per workspace (S3.10).
//   6. handler → body (or `reply(status, body)`); thrown errors map to ApiError (middleware/errors.ts).
//   7. response: checked against the contract's response schema; a mismatch is a 500 outside production
//      (so contract drift fails tests) and a logged warning in production.
//   8. OpenAPI: the route is documented from the same spec (src/openapi.ts).
import { API_COMMANDS, type ApiCommandName, type ErrorCode, RunSlug, Uuid } from "@fairsplit/contracts";
import type { WorkspaceScope } from "@fairsplit/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Logger } from "pino";
import type { z } from "zod";
import {
  type ActingCredential,
  type Credential,
  isActing,
  type OperatorCredential,
  scopeOf,
} from "../credentials/verify/index.js";
import { credentialResult } from "../middleware/credential.js";
import { toApiProblem } from "../middleware/errors.js";
import { documentRoute, type SchemaCatalog } from "../openapi.js";
import type { RailLabel, RailProvenance } from "../paypal/mode.js";
import {
  COMMAND_FOLDER,
  type Command,
  type CommandInput,
  type CommandOutput,
  type CommandSuccessStatus,
  errorCodesOf,
  type JsonCommandName,
  type PathParams,
  pathParamNames,
  ROUTE_FOLDERS,
  type RouteFolder,
  SUCCESS_STATUS,
} from "./commands.js";
import type { AppContext, AppDeps, AppEnv } from "./context.js";
import { digestMatches, sha256Hex } from "./digest.js";
import { IDEMPOTENCY_KEY_RE, type IdempotencyHold } from "./idempotency.js";
import { ApiProblem, problem, type ValidationIssue } from "./problem.js";

// ---------------------------------------------------------------- specs

export type AuthClass = "none" | "public" | "frame_or_session" | "operator";
export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A normalised route: what both IC-01 commands and slice routes compile to. */
export interface RouteSpec {
  /** operationId: the command name, or `<folder>.<name>` for slice routes. */
  name: string;
  method: RouteMethod;
  /** Contract style: `/v1/holds/:holdId/resolve` (`:runSlug.json` is allowed). */
  path: string;
  auth: AuthClass;
  /** POST/PUT/PATCH: the JSON body; GET/DELETE: the query object. */
  request: z.ZodType | null;
  response: z.ZodType | null;
  success: readonly number[];
  /** Every code this route may answer with (documented; the client types them). */
  errors: readonly ErrorCode[];
  /** Declared request headers (Idempotency-Key, Content-Digest). */
  headers: readonly string[];
  /** Path param validators; defaults: runSlug → RunSlug, anything else → UUID. */
  params?: Readonly<Record<string, z.ZodType>>;
  tag: string;
  summary?: string;
  description?: string;
  /** Largest accepted body (default 64 KB). */
  maxBodyBytes?: number;
  /** True for IC-01 commands. */
  contract: boolean;
  /** An IC-01 command still answered by the shell's 501 placeholder (documented with its 501 response). */
  placeholder?: boolean;
  /** Server-sent events (documented as text/event-stream). */
  sse?: boolean;
}

export function commandSpec(name: ApiCommandName): RouteSpec {
  const cmd = API_COMMANDS[name];
  const folder = COMMAND_FOLDER[name];
  return {
    name,
    method: cmd.method,
    path: cmd.path,
    auth: cmd.auth,
    request: cmd.request,
    response: cmd.response,
    success: SUCCESS_STATUS[name],
    errors: errorCodesOf(name),
    headers: (cmd as { headers?: readonly string[] }).headers ?? [],
    tag: folder === "shell:sse" ? "events" : folder,
    description: `IC-01 API_COMMANDS.${name} · auth ${cmd.auth} · ${
      folder === "shell:sse" ? "shell (src/sse)" : `${ROUTE_FOLDERS[folder]} slice (src/routes/${folder})`
    }`,
    contract: true,
    ...((cmd as { sse?: boolean }).sse ? { sse: true } : {}),
  };
}

// ---------------------------------------------------------------- handler types

const REPLY = Symbol.for("fs.reply");

export interface Reply<B> {
  readonly [REPLY]: true;
  readonly status: number;
  readonly body: B;
  readonly headers: Readonly<Record<string, string>>;
  /** Already serialized trusted handler result (Proof cache). Validated once per immutable body/schema. */
  readonly serializedBody?: string;
}

/** Answer with a specific success status (e.g. 200 instead of 201 for a resumed session) and headers. */
export function reply<B>(
  status: 200 | 201 | 202 | 204,
  body: B,
  headers: Record<string, string> = {},
): Reply<B> {
  return { [REPLY]: true, status, body, headers };
}

export function serializedReply<B>(
  body: B,
  serializedBody: string,
  headers: Record<string, string> = {},
): Reply<B> {
  return { ...reply(200, body, headers), serializedBody };
}

function isReply(v: unknown): v is Reply<unknown> {
  return !!v && typeof v === "object" && (v as Record<symbol, unknown>)[REPLY] === true;
}

// Weak keys retain neither an evicted Proof nor a route schema. Only successful validation of the exact
// object/string pair is reused; ordinary replies and replacement bodies still receive the full check.
const validatedBodies = new WeakMap<object, WeakMap<z.ZodType, string>>();

export type CredentialFor<A> = A extends "frame_or_session"
  ? ActingCredential
  : A extends "operator"
    ? OperatorCredential
    : Credential | null;

export type ScopeFor<A> = A extends "frame_or_session" ? WorkspaceScope : WorkspaceScope | null;

interface BaseContext<A> {
  readonly c: AppContext;
  readonly deps: AppDeps;
  readonly log: Logger;
  readonly requestId: string;
  /** The verified credential (see `CredentialFor`). The workspace always comes from here. */
  readonly credential: CredentialFor<A>;
  /** `@fairsplit/db` repository scope derived from the credential. */
  readonly scope: ScopeFor<A>;
  /** A credential was presented but did not verify (only on `none`/`public` routes, which then run anonymous). */
  readonly credentialProblem: ApiProblem | null;
  /** I8: the PayPal rail of this server (`simulated` | `sandbox`) and its provenance label. */
  readonly rail: { label: RailLabel; provenance: RailProvenance };
  /** The exact request body text ("" for GET). */
  readonly rawBody: string;
  /** The exact request body bytes (what `Content-Digest` and the idempotency hash cover). */
  readonly rawBytes: Uint8Array;
  header(name: string): string | undefined;
  now(): Date;
}

export interface CommandContext<N extends JsonCommandName> extends BaseContext<Command<N>["auth"]> {
  readonly name: N;
  readonly input: CommandInput<N>;
  readonly params: PathParams<N>;
}

export type CommandResult<N extends JsonCommandName> = CommandOutput<N> | Reply<CommandOutput<N>>;

/** What a slice writes for an IC-01 command. Return the body, `reply(status, body)`, or throw an ApiProblem. */
export type CommandHandler<N extends JsonCommandName> = (
  ctx: CommandContext<N>,
) => Promise<CommandResult<N>> | CommandResult<N>;

type ParamNames<P extends string> = P extends `${string}:${infer Rest}`
  ? Rest extends `${infer Seg}/${infer Tail}`
    ? (Seg extends `${infer N}.${string}` ? N : Seg) | ParamNames<`/${Tail}`>
    : Rest extends `${infer N}.${string}`
      ? N
      : Rest
  : never;

export interface RouteDef<
  P extends string,
  A extends AuthClass,
  Req extends z.ZodType | undefined,
  Res extends z.ZodType | undefined,
> {
  method: RouteMethod;
  path: P;
  auth: A;
  /** Unique within the folder; the operationId becomes `<folder>.<name>`. */
  name: string;
  summary?: string;
  description?: string;
  request?: Req;
  response?: Res;
  /** Success statuses, the first is the default (200). */
  success?: readonly (200 | 201 | 202 | 204)[];
  /** Codes beyond the common boundary errors. */
  errors?: readonly ErrorCode[];
  headers?: readonly string[];
  params?: Partial<Record<ParamNames<P>, z.ZodType>>;
  maxBodyBytes?: number;
}

export interface RouteContext<P extends string, A extends AuthClass, Req extends z.ZodType | undefined>
  extends BaseContext<A> {
  readonly name: string;
  readonly input: Req extends z.ZodType ? z.output<Req> : undefined;
  readonly params: { [K in ParamNames<P>]: string };
}

export type RouteHandler<
  P extends string,
  A extends AuthClass,
  Req extends z.ZodType | undefined,
  Res extends z.ZodType | undefined,
> = (ctx: RouteContext<P, A, Req>) => Promise<RouteResult<Res>> | RouteResult<Res>;

export type RouteResult<Res> = Res extends z.ZodType ? z.input<Res> | Reply<z.input<Res>> : unknown;

// ---------------------------------------------------------------- not implemented (501)

const NOT_IMPLEMENTED = Symbol.for("fs.notImplemented");

/**
 * The placeholder every command starts with: answers 501 with an IC-01 body (code INTERNAL,
 * details.reason NOT_IMPLEMENTED). A slice replaces it with its handler.
 */
export const notImplemented = Object.assign(
  async function notImplemented<N extends JsonCommandName>(ctx: CommandContext<N>): Promise<never> {
    const folder = COMMAND_FOLDER[ctx.name as JsonCommandName] as RouteFolder;
    throw problem.notImplemented(ctx.name, ROUTE_FOLDERS[folder]);
  },
  { [NOT_IMPLEMENTED]: true },
);

export function isNotImplemented(handler: unknown): boolean {
  return (
    typeof handler === "function" && (handler as unknown as Record<symbol, unknown>)[NOT_IMPLEMENTED] === true
  );
}

// ---------------------------------------------------------------- mounting

const RUN_SLUG_RE = "[0-9]{4}[A-Z]-r[0-9]+";

/** Contract path → Hono path. runSlug segments are constrained so `/v1/proof/:runSlug.json` and `/v1/proof/:runSlug` never collide. */
export function toHonoPath(path: string): string {
  return path
    .replace(/:runSlug\.json\b/g, `:runSlug{${RUN_SLUG_RE}\\.json}`)
    .replace(/:runSlug(?![{A-Za-z])/g, `:runSlug{${RUN_SLUG_RE}}`);
}

const DEFAULT_PARAM_SCHEMAS: Readonly<Record<string, z.ZodType>> = { runSlug: RunSlug };

export interface Mounter {
  readonly app: OpenAPIHono<AppEnv>;
  readonly catalog: SchemaCatalog;
}

/** Mounts an IC-01 command with its handler (the registry calls this for every command). */
export function mountCommand<N extends JsonCommandName>(
  m: Mounter,
  name: N,
  handler: CommandHandler<N>,
): void {
  const spec: RouteSpec = { ...commandSpec(name), placeholder: isNotImplemented(handler) };
  mountSpec(m, spec, handler as unknown as AnyHandler);
}

/** Mounts a slice's extra JSON route (non-contract reads, judge resets, /ops data…). */
export function mountRoute<
  P extends string,
  A extends AuthClass,
  Req extends z.ZodType | undefined,
  Res extends z.ZodType | undefined,
>(
  m: Mounter,
  folder: string,
  def: RouteDef<P, A, Req, Res>,
  handler: RouteHandler<P, A, Req, Res>,
): RouteSpec {
  const spec: RouteSpec = {
    name: `${folder}.${def.name}`,
    method: def.method,
    path: def.path,
    auth: def.auth,
    request: def.request ?? null,
    response: def.response ?? null,
    success: def.success ?? [200],
    errors: [...new Set<ErrorCode>([...(def.errors ?? []), ...errorCodesOfAuth(def.auth)])],
    headers: def.headers ?? [],
    ...(def.params ? { params: def.params as Record<string, z.ZodType> } : {}),
    tag: folder,
    ...(def.summary ? { summary: def.summary } : {}),
    ...(def.description ? { description: def.description } : {}),
    ...(def.maxBodyBytes ? { maxBodyBytes: def.maxBodyBytes } : {}),
    contract: false,
  };
  mountSpec(m, spec, handler as unknown as AnyHandler);
  return spec;
}

function errorCodesOfAuth(auth: AuthClass): ErrorCode[] {
  return auth === "frame_or_session" || auth === "operator"
    ? ["VALIDATION_FAILED", "UNAUTHENTICATED", "FRAME_TOKEN_EXPIRED", "FORBIDDEN", "NOT_FOUND", "INTERNAL"]
    : ["VALIDATION_FAILED", "NOT_FOUND", "RATE_LIMITED", "INTERNAL"];
}

type AnyHandler = (ctx: Record<string, unknown>) => Promise<unknown> | unknown;

function mountSpec(m: Mounter, spec: RouteSpec, handler: AnyHandler): void {
  m.app.on(spec.method, toHonoPath(spec.path), (c) => runRoute(c as AppContext, spec, handler));
  documentRoute(m.app, m.catalog, spec);
}

const BODY_METHODS = new Set<RouteMethod>(["POST", "PUT", "PATCH"]);

async function runRoute(c: AppContext, spec: RouteSpec, handler: AnyHandler): Promise<Response> {
  const deps = c.get("deps");
  const log = c.get("log");
  const requestId = c.get("requestId");

  // 1. credential
  let credential: Credential | null = null;
  let credentialProblem: ApiProblem | null = null;
  const resolved = await credentialResult(c);
  if (spec.auth === "frame_or_session" || spec.auth === "operator") {
    if (resolved.kind === "none") throw problem.unauthenticated();
    if (resolved.kind === "invalid") throw resolved.problem;
    if (spec.auth === "frame_or_session" && !isActing(resolved.credential)) {
      throw problem.forbidden("Read-only links and the operator session cannot do this.");
    }
    if (spec.auth === "operator" && resolved.credential.kind !== "operator") {
      throw problem.forbidden("This needs the operator session (/ops).");
    }
    credential = resolved.credential;
  } else if (resolved.kind === "ok") {
    credential = resolved.credential;
  } else if (resolved.kind === "invalid") {
    credentialProblem = resolved.problem;
  }
  const scope = credential ? scopeOf(credential) : null;

  // 2. path params
  const params = parseParams(c, spec);

  // 3. body and declared headers. The digest covers the exact bytes received (RFC 9530), so it is checked
  // before the body is decoded: a body corrupted in transit is a 422 the clerk outbox retries, not a 400.
  let rawBytes: Uint8Array = EMPTY_BODY;
  if (BODY_METHODS.has(spec.method)) rawBytes = await readBody(c, spec.maxBodyBytes ?? 64 * 1024);
  if (spec.headers.includes("Content-Digest")) {
    const header = c.req.header("content-digest");
    if (!header)
      throw problem.validation("Content-Digest is required.", [issue("headers.content-digest", "required")]);
    if (!digestMatches(header, rawBytes)) {
      throw new ApiProblem(
        "CONTENT_DIGEST_MISMATCH",
        "The body does not match its Content-Digest; resend it.",
      );
    }
  }
  const rawBody = decodeBody(rawBytes);
  const idemKey = c.req.header("idempotency-key");
  if (spec.headers.includes("Idempotency-Key") && !idemKey) {
    throw problem.validation("Idempotency-Key is required.", [issue("headers.idempotency-key", "required")]);
  }

  // 4. input
  const input = parseInput(c, spec, rawBody);

  // 5. idempotency (POSTs with a workspace; S3.10)
  let idem: { hold: IdempotencyHold; scope: WorkspaceScope } | null = null;
  if (idemKey !== undefined && spec.method === "POST" && scope) {
    if (!IDEMPOTENCY_KEY_RE.test(idemKey)) {
      throw problem.validation("Idempotency-Key must be 1–255 visible ASCII characters.", [
        issue("headers.idempotency-key", "invalid"),
      ]);
    }
    const claim = await deps.idempotency.claim(scope, {
      key: idemKey,
      method: spec.method,
      route: spec.path,
      requestSha256: sha256Hex(rawBytes),
    });
    if (claim.kind === "replay") {
      return c.body(JSON.stringify(claim.body), claim.status as 200, {
        "content-type": "application/json",
        "Idempotent-Replayed": "true",
      });
    }
    if (claim.kind === "mismatch") {
      throw new ApiProblem(
        "IDEMPOTENCY_KEY_REUSED",
        "This Idempotency-Key was used with a different request.",
      );
    }
    if (claim.kind === "in_flight") {
      throw new ApiProblem(
        "VERSION_CONFLICT",
        "The first request with this Idempotency-Key is still running.",
        {
          details: { reason: "IDEMPOTENCY_KEY_IN_FLIGHT" },
        },
      );
    }
    // Only this request's hold completes or releases the key (a stale claim never overwrites the result).
    idem = { hold: { key: claim.key, token: claim.token }, scope };
  }

  // 6. handler
  const ctx = {
    name: spec.name,
    c,
    deps,
    log,
    requestId,
    input,
    params,
    credential,
    scope,
    credentialProblem,
    rail: { label: deps.paypal.label, provenance: deps.paypal.provenance },
    rawBody,
    rawBytes,
    header: (name: string) => c.req.header(name),
    now: () => deps.clock.now(),
  };
  let result: unknown;
  try {
    result = await handler(ctx);
  } catch (err) {
    if (idem) {
      const p = toApiProblem(err);
      if (p.status >= 500) await deps.idempotency.release(idem.scope, idem.hold).catch(() => false);
      else
        await deps.idempotency.complete(idem.scope, idem.hold, {
          status: p.status,
          body: p.toBody(requestId),
        });
    }
    throw err;
  }

  // 7. response
  const out = isReply(result) ? result : { status: spec.success[0] ?? 200, body: result, headers: {} };
  const strict = !deps.env.production;
  if (!spec.success.includes(out.status)) {
    log.error({ route: spec.name, status: out.status }, "handler answered an undocumented status");
    if (strict) throw problem.internal(`${spec.name} answered an undocumented status ${out.status}.`);
  }
  if (spec.response && out.status !== 204) {
    const serialized =
      "serializedBody" in out && typeof out.serializedBody === "string" ? out.serializedBody : null;
    const objectBody = out.body !== null && typeof out.body === "object" ? out.body : null;
    const validated = objectBody ? validatedBodies.get(objectBody) : undefined;
    const cached = serialized !== null && validated?.get(spec.response) === serialized;
    const check = cached ? null : spec.response.safeParse(out.body);
    if (check && !check.success) {
      log.error(
        { route: spec.name, issues: check.error.issues.slice(0, 10) },
        "response does not match the contract",
      );
      if (strict) throw problem.internal(`${spec.name} answered a body that does not match its contract.`);
    } else if (check?.success && serialized !== null && objectBody) {
      const schemas = validated ?? new WeakMap<z.ZodType, string>();
      schemas.set(spec.response, serialized);
      validatedBodies.set(objectBody, schemas);
    }
  }
  if (idem)
    await deps.idempotency.complete(idem.scope, idem.hold, { status: out.status, body: out.body ?? null });
  for (const [k, v] of Object.entries(out.headers)) c.header(k, v);
  if (out.status === 204) return c.body(null, 204);
  if ("serializedBody" in out && typeof out.serializedBody === "string") {
    return c.body(out.serializedBody, out.status as 200, { "content-type": "application/json" });
  }
  return c.json(out.body as object, out.status as 200);
}

function issue(path: string, message: string, code = "invalid"): ValidationIssue {
  return { path, message, code };
}

function parseParams(c: AppContext, spec: RouteSpec): Record<string, string> {
  const out: Record<string, string> = {};
  const issues: ValidationIssue[] = [];
  for (const name of pathParamNames(spec.path)) {
    let value = c.req.param(name) ?? "";
    if (name === "runSlug" && spec.path.includes(":runSlug.json")) value = value.replace(/\.json$/, "");
    const schema = spec.params?.[name] ?? DEFAULT_PARAM_SCHEMAS[name] ?? Uuid;
    const r = schema.safeParse(value);
    if (!r.success)
      issues.push(issue(`params.${name}`, r.error.issues[0]?.message ?? "invalid", "invalid_param"));
    else out[name] = String(r.data);
  }
  if (issues.length > 0) throw problem.validation("A path parameter is not valid.", issues);
  return out;
}

const EMPTY_BODY = new Uint8Array(0);
const UTF8 = new TextDecoder("utf-8", { fatal: true });

/**
 * The body's bytes, never more than `max` of them in memory. A declared Content-Length over the cap is refused
 * before anything is read; otherwise the stream is read chunk by chunk and cancelled the moment the running total
 * passes the cap, so neither a chunked body nor one under an understated length is buffered whole first.
 */
async function readBody(c: AppContext, max: number): Promise<Uint8Array> {
  const tooLarge = () =>
    problem.validation(`The body is larger than ${max} bytes.`, [
      issue("body", `larger than ${max} bytes`, "too_big"),
    ]);
  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > max) throw tooLarge();
  const raw = c.req.raw;
  if (raw.bodyUsed) {
    // already drained into Hono's cache by earlier code: what it holds is all there is
    const cached = new Uint8Array(await c.req.arrayBuffer());
    if (cached.byteLength > max) throw tooLarge();
    return cached;
  }
  if (!raw.body) return EMPTY_BODY;
  const reader = raw.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  // The stream is spent: later readers (c.req.json(), text()) get these bytes from Hono's body cache, which
  // holds promises at run time (its `BodyCache` type names the resolved values).
  const cache = c.req.bodyCache as unknown as { arrayBuffer?: Promise<ArrayBuffer> };
  cache.arrayBuffer = Promise.resolve(bytes.buffer);
  return bytes;
}

function decodeBody(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) return "";
  try {
    return UTF8.decode(bytes);
  } catch {
    throw problem.validation("The body is not valid UTF-8.", [
      issue("body", "not valid UTF-8", "invalid_utf8"),
    ]);
  }
}

function parseInput(c: AppContext, spec: RouteSpec, rawBody: string): unknown {
  if (!spec.request) return undefined;
  let value: unknown;
  if (BODY_METHODS.has(spec.method)) {
    const type = c.req.header("content-type") ?? "";
    if (rawBody.trim() === "") value = {};
    else {
      if (type && !/^application\/(?:[\w.+-]+\+)?json\b/i.test(type)) {
        throw problem.validation("Send the body as application/json.");
      }
      try {
        value = JSON.parse(rawBody);
      } catch {
        throw problem.validation("The body is not valid JSON.", [
          issue("body", "not valid JSON", "invalid_json"),
        ]);
      }
    }
  } else {
    value = c.req.query();
  }
  const r = spec.request.safeParse(value);
  if (!r.success) {
    const where = BODY_METHODS.has(spec.method) ? "body" : "query";
    throw problem.validation(
      "The request does not match the contract.",
      r.error.issues
        .slice(0, 20)
        .map((i) => issue([where, ...i.path.map(String)].join("."), i.message, i.code)),
    );
  }
  return r.data;
}

/** Type helper for tests and slices: the success statuses of a command. */
export type SuccessOf<N extends JsonCommandName> = CommandSuccessStatus<N>;
