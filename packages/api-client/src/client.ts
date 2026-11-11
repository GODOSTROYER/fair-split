// The typed client: one method per IC-01 command, derived from `API_COMMANDS` at the type level, so a renamed
// field or a new error code is a compile error in the console and the app, never a runtime surprise.
//
//   const api = createApiClient({ token: () => frameToken });            // same origin, judge cookie included
//   const { hold } = await api.resolveHold({ params: { holdId }, body: { resolution: "COUNT_ONCE" } });
//   const r = await api.result("submitApproval", { params: { runSlug }, body });   // no throw: r.ok / r.error.code
//   const stop = api.subscribe({ kind: "run", runSlug }, { onEvent: (e) => … });   // SSE with Last-Event-ID
//
// Requests: JSON bodies; `Authorization: Bearer <token>` when a token is set; `credentials: "same-origin"` so
// the judge cookie rides along. Commands that declare `Content-Digest` get it computed over the exact body
// bytes, and `Idempotency-Key` is sent when given (captures default it to their captureId, as the clerk outbox
// retries with the same key). Responses are parsed with the command's zod schema (contract drift becomes a
// `ContractError`); every `/v1` answer's `X-FS-Rail` header is exposed as `meta.rail` and `client.rail` (I8).
import { API_COMMANDS, type ApiCommandName, type SseScope } from "@fairsplit/contracts";
import type { z } from "zod";
import { contentDigest } from "./bytes.js";
import {
  ApiClientError,
  type ClientFailure,
  ContractError,
  failureFromBody,
  NetworkError,
} from "./errors.js";
import {
  type Command,
  type CommandData,
  type CommandErrorCode,
  type CredentialsMode,
  fillPath,
  HEADER,
  type JsonCommandName,
  type PathParamNames,
  type PathParams,
  type RailLabel,
  railOf,
  SUCCESS_STATUS,
} from "./http.js";
import { type SseHandlers, type SseOptions, type Subscription, subscribe } from "./sse.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type MaybePromise<T> = T | Promise<T>;
export type TokenSource = string | null | (() => MaybePromise<string | null | undefined>);

export interface ApiClientOptions {
  /** Origin of fs-api. "" (default) means relative URLs: the console and `/app` are served by the API itself. */
  baseUrl?: string;
  /** `expo/fetch` on native (streams SSE), `app.request` bound in server tests, msw-intercepted fetch in UI tests. */
  fetch?: FetchLike;
  /** Bearer credential: a frame/console token (`fst_`), a device token (`fsd_`) or a signed link (`fsm_`, `fsb_`). */
  token?: TokenSource;
  /** Cookie policy (default "same-origin": the judge cookie `fs_js` rides along). */
  credentials?: CredentialsMode;
  /** Extra headers on every request. */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** Parse every success body with the contract (default true). Turn off only for a measured hot path. */
  validate?: boolean;
  /** Observes every failure before it is thrown or returned (logging; FRAME_TOKEN_EXPIRED → ask the stage). */
  onError?: (failure: ClientFailure) => void;
}

export interface CallOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** S3.10: a retry with the same key and body replays the stored response. Captures default to `captureId`. */
  idempotencyKey?: string;
  /** Overrides the client's token for this call (`null` sends none). */
  token?: string | null;
}

type RequestSchema<N extends JsonCommandName> = Command<N>["request"];

/** An object with no fields: a body or query it is assignable to (`{}` for MarkPaidRequest, …) is optional. */
type NoFields = Record<never, never>;

type InputArg<N extends JsonCommandName> =
  RequestSchema<N> extends z.ZodType
    ? Command<N>["method"] extends "POST"
      ? NoFields extends z.input<RequestSchema<N>>
        ? { body?: z.input<RequestSchema<N>> }
        : { body: z.input<RequestSchema<N>> }
      : NoFields extends z.input<RequestSchema<N>>
        ? { query?: z.input<RequestSchema<N>> }
        : { query: z.input<RequestSchema<N>> }
    : unknown;

type ParamsArg<N extends JsonCommandName> = [PathParamNames<Command<N>["path"]>] extends [never]
  ? unknown
  : { params: PathParams<N> };

/** Arguments of command N: `params` for path params, `body` (POST) or `query` (GET), and call options. */
export type CallArgs<N extends JsonCommandName> = ParamsArg<N> & InputArg<N> & CallOptions;

export interface CallMeta {
  status: number;
  requestId: string | null;
  /** `simulated` | `sandbox`: the PayPal rail of the server that answered (label PayPal-derived values with it). */
  rail: RailLabel | null;
  /** True when the server replayed a stored response for a repeated Idempotency-Key. */
  replayed: boolean;
}

export type ApiResult<N extends JsonCommandName> =
  | { ok: true; data: CommandData<N>; meta: CallMeta }
  | { ok: false; error: ClientFailure<CommandErrorCode<N>> };

type CommandMethod<N extends JsonCommandName> =
  object extends CallArgs<N>
    ? (args?: CallArgs<N>) => Promise<CommandData<N>>
    : (args: CallArgs<N>) => Promise<CommandData<N>>;

/** One method per JSON command: `api.resolveHold(args)`, `api.proof({ params: { runSlug } })`, … */
export type CommandMethods = { readonly [N in JsonCommandName]: CommandMethod<N> };

/** A route outside IC-01 (a slice's extra read, `/ops` data, `/.well-known/…`): typed by the schema you pass. */
export interface RawRequest<S extends z.ZodType | undefined = undefined> extends CallOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Contract-style path, e.g. `/v1/seasons/:seasonCode`. */
  path: string;
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Parses the success body; without it the parsed JSON is returned as `unknown`. */
  schema?: S;
  /** For logs and errors (default `METHOD path`). */
  name?: string;
}

export interface ApiClient extends CommandMethods {
  readonly baseUrl: string;
  /** The rail label of the last answer (`null` before the first one). */
  readonly rail: RailLabel | null;
  /** Calls command N; resolves to its parsed response or throws a `ClientFailure`. */
  call<N extends JsonCommandName>(
    name: N,
    ...args: object extends CallArgs<N> ? [CallArgs<N>?] : [CallArgs<N>]
  ): Promise<CommandData<N>>;
  /** Like `call`, but never throws: `{ ok: true, data, meta }` or `{ ok: false, error }` with a typed `error.code`. */
  result<N extends JsonCommandName>(
    name: N,
    ...args: object extends CallArgs<N> ? [CallArgs<N>?] : [CallArgs<N>]
  ): Promise<ApiResult<N>>;
  /** A route outside IC-01, with the same auth, errors and rail handling. */
  request<S extends z.ZodType | undefined = undefined>(
    r: RawRequest<S>,
  ): Promise<S extends z.ZodType ? z.output<S> : unknown>;
  /** The URL of a command (for links and downloads: `/v1/proof/2026A-r37.json`). */
  url<N extends ApiCommandName>(
    name: N,
    params?: Partial<PathParams<N>>,
    query?: Record<string, string>,
  ): string;
  /** Opens a server-sent event stream with Last-Event-ID resume and reconnect (S3.7). */
  subscribe(scope: SseScope, handlers: SseHandlers, options?: SseOptions): Subscription;
  /** Replaces the bearer token (e.g. after `createJudgeSession` or an IC-12 `fs.token`). */
  setToken(token: TokenSource): void;
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
  const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const validate = options.validate ?? true;
  let token: TokenSource = options.token ?? null;
  let lastRail: RailLabel | null = null;
  // A hint only: the server's nonrefundable network budget remains authoritative.
  let judgePreparationAttempt = 1;

  const resolveToken = async (override: string | null | undefined): Promise<string | null> => {
    if (override !== undefined) return override;
    const t = typeof token === "function" ? await token() : token;
    return t ?? null;
  };

  const report = (failure: ClientFailure) => {
    try {
      options.onError?.(failure);
    } catch {
      // an observer never changes the outcome
    }
  };

  interface Prepared {
    name: string;
    method: string;
    url: string;
    bodyText: string | undefined;
    headers: Headers;
    signal: AbortSignal | undefined;
  }

  async function prepare(
    name: string,
    method: string,
    path: string,
    o: {
      params?: Record<string, string> | undefined;
      query?: Record<string, unknown> | undefined;
      body?: unknown;
      declared?: readonly string[] | undefined;
      call: CallOptions;
      defaultIdempotencyKey?: string | undefined;
    },
  ): Promise<Prepared> {
    const url = `${baseUrl}${fillPath(path, o.params ?? {})}${queryString(o.query)}`;
    const headers = new Headers(typeof options.headers === "function" ? options.headers() : options.headers);
    headers.set("accept", "application/json");
    for (const [k, v] of Object.entries(o.call.headers ?? {})) headers.set(k, v);
    const bearer = await resolveToken(o.call.token);
    if (bearer) headers.set("authorization", `Bearer ${bearer}`);
    let bodyText: string | undefined;
    if (BODY_METHODS.has(method)) {
      bodyText = JSON.stringify(o.body ?? {});
      headers.set("content-type", "application/json");
      if (o.declared?.includes(HEADER.contentDigest))
        headers.set(HEADER.contentDigest, contentDigest(bodyText));
      const key = o.call.idempotencyKey ?? o.defaultIdempotencyKey;
      if (key) headers.set(HEADER.idempotencyKey, key);
    }
    return { name, method, url, bodyText, headers, signal: o.call.signal };
  }

  async function send(p: Prepared): Promise<{ res: Response; text: string; meta: CallMeta }> {
    let res: Response;
    try {
      res = await doFetch(p.url, {
        method: p.method,
        headers: p.headers,
        credentials: options.credentials ?? "same-origin",
        ...(p.bodyText !== undefined ? { body: p.bodyText } : {}),
        ...(p.signal ? { signal: p.signal } : {}),
      });
    } catch (err) {
      const failure = new NetworkError(p.name, err, p.signal?.aborted === true || isAbortError(err));
      report(failure);
      throw failure;
    }
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      const failure = new NetworkError(p.name, err, p.signal?.aborted === true || isAbortError(err));
      report(failure);
      throw failure;
    }
    const rail = railOf(res.headers.get(HEADER.rail));
    if (rail) lastRail = rail;
    const meta: CallMeta = {
      status: res.status,
      requestId: res.headers.get(HEADER.requestId),
      rail,
      replayed: res.headers.get(HEADER.replayed) === "true",
    };
    if (!res.ok) {
      const failure = failureFromBody(res.status, text, { command: p.name, rail, requestId: meta.requestId });
      if (p.name === "createJudgeSession" && failure instanceof ApiClientError) {
        judgePreparationAttempt =
          failure.code === "QUEUED" && failure.details.reason === "PREPARING_WORKSPACE"
            ? Math.min(8, judgePreparationAttempt + 1)
            : 1;
      }
      report(failure);
      throw failure;
    }
    if (p.name === "createJudgeSession") judgePreparationAttempt = 1;
    return { res, text, meta };
  }

  function parseSuccess(
    name: string,
    status: number,
    text: string,
    schema: z.ZodType | null,
    requestId: string | null,
  ): unknown {
    let json: unknown;
    if (text !== "") {
      try {
        json = JSON.parse(text);
      } catch {
        const failure = new ContractError(
          name,
          status,
          "answered a success body that is not JSON",
          [],
          requestId,
        );
        report(failure);
        throw failure;
      }
    }
    if (!schema || !validate) return json;
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const failure = new ContractError(
        name,
        status,
        "answered a body that does not match its contract",
        parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })),
        requestId,
      );
      report(failure);
      throw failure;
    }
    return parsed.data;
  }

  async function run<N extends JsonCommandName>(
    name: N,
    args: CallArgs<N> | undefined,
  ): Promise<{ data: CommandData<N>; meta: CallMeta }> {
    const cmd = API_COMMANDS[name] as Command<JsonCommandName>;
    const a = (args ?? {}) as CallOptions & {
      params?: Record<string, string>;
      body?: unknown;
      query?: Record<string, unknown>;
    };
    const declared = (cmd as { headers?: readonly string[] }).headers;
    const p = await prepare(name, cmd.method, cmd.path, {
      params: a.params,
      query: cmd.method === "GET" ? a.query : undefined,
      body: a.body,
      declared,
      call: a,
      defaultIdempotencyKey:
        declared?.includes(HEADER.idempotencyKey) && a.body && typeof a.body === "object"
          ? ((a.body as { captureId?: string }).captureId ?? undefined)
          : undefined,
    });
    if (name === "createJudgeSession") p.headers.set("x-fs-judge-attempt", String(judgePreparationAttempt));
    const { text, meta } = await send(p);
    if (validate && !(SUCCESS_STATUS[name] as readonly number[]).includes(meta.status)) {
      const failure = new ContractError(
        name,
        meta.status,
        `answered an undocumented status ${meta.status}`,
        [],
        meta.requestId,
      );
      report(failure);
      throw failure;
    }
    const data = parseSuccess(name, meta.status, text, cmd.response, meta.requestId) as CommandData<N>;
    return { data, meta };
  }

  const client = {
    get baseUrl() {
      return baseUrl;
    },
    get rail() {
      return lastRail;
    },
    async call<N extends JsonCommandName>(name: N, args?: CallArgs<N>) {
      return (await run(name, args)).data;
    },
    async result<N extends JsonCommandName>(name: N, args?: CallArgs<N>): Promise<ApiResult<N>> {
      try {
        const { data, meta } = await run(name, args);
        return { ok: true, data, meta };
      } catch (err) {
        if (err instanceof ApiClientError || err instanceof NetworkError || err instanceof ContractError) {
          return { ok: false, error: err as ClientFailure<CommandErrorCode<N>> };
        }
        throw err;
      }
    },
    async request<S extends z.ZodType | undefined = undefined>(r: RawRequest<S>) {
      const method = r.method ?? "GET";
      const name = r.name ?? `${method} ${r.path}`;
      const p = await prepare(name, method, r.path, {
        params: r.params,
        query: r.query,
        body: r.body,
        call: r,
      });
      const { text, meta } = await send(p);
      return parseSuccess(name, meta.status, text, r.schema ?? null, meta.requestId) as S extends z.ZodType
        ? z.output<S>
        : unknown;
    },
    url<N extends ApiCommandName>(
      name: N,
      params: Partial<PathParams<N>> = {},
      query?: Record<string, string>,
    ) {
      return `${baseUrl}${fillPath(API_COMMANDS[name].path, params as Record<string, string>)}${queryString(query)}`;
    },
    subscribe(scope: SseScope, handlers: SseHandlers, sseOptions: SseOptions = {}) {
      return subscribe(scope, handlers, {
        baseUrl,
        fetch: doFetch,
        token: () => resolveToken(undefined),
        credentials: options.credentials ?? "same-origin",
        ...sseOptions,
      });
    },
    setToken(next: TokenSource) {
      token = next;
    },
  };

  const methods = Object.fromEntries(
    (Object.keys(API_COMMANDS) as ApiCommandName[])
      .filter((n) => !(API_COMMANDS[n] as { sse?: boolean }).sse)
      .map((n) => [n, (args?: unknown) => client.call(n as JsonCommandName, args as never)]),
  );
  return Object.assign(client, methods) as unknown as ApiClient;
}

function queryString(query: Record<string, unknown> | undefined): string {
  if (!query) return "";
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

function isAbortError(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { name?: string }).name === "AbortError";
}
