import { PayPalAPI } from "@paypal/agent-toolkit/mcp";
import type { z } from "zod";
import type { CallPriority, PayPalAuth } from "./_shims/paypal-core.js";
import { isToolkitMethod, type ToolkitMethod } from "./actions.js";
import { type CallCapture, installCapture, withCapture } from "./capture.js";
import { toolkitZodSchemas } from "./schemas.js";

/** Appears in the toolkit's User-Agent: "PayPal Agent Toolkit Typescript: FairSplit, Version: 1.11.0, …". */
export const TOOLKIT_SOURCE = "FairSplit";
/** PayPalHttp's timeout (S3 §S3.6.2); the toolkit itself sets none. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** IC-04 `limiter.take` (TEMPORARY local port until WS-DATA's limiter lands). Rejects when denied. */
export interface ToolkitLimiter {
  take(request: { purpose: string; priority: CallPriority }): Promise<unknown>;
}

/** One row for `paypal_calls` (purpose, status, debug_id, request_id, ms). */
export interface ToolkitCallRecord {
  purpose: string;
  method: ToolkitMethod;
  attempt: number;
  ok: boolean;
  status: number | null;
  debugId: string | null;
  requestId: string | null;
  errorCode: string | null;
  ms: number;
}

export interface ToolkitDeps {
  /** IC-05 PayPalAuth: the one shared token cache. The toolkit never fetches its own token. */
  auth: PayPalAuth;
  limiter?: ToolkitLimiter;
  /** Best effort: a failing recorder never fails the PayPal call. */
  onCall?: (record: ToolkitCallRecord) => void | Promise<void>;
  timeoutMs?: number;
  priority?: CallPriority;
}

export interface TkOptions {
  priority?: CallPriority;
}

export type Tk = <T = unknown>(
  method: ToolkitMethod,
  args: unknown,
  requestId?: string,
  options?: TkOptions,
) => Promise<T>;

/** The method is not on the server allowlist; nothing was sent. */
export class ToolkitMethodError extends Error {
  constructor(readonly method: string) {
    super(`Not an allowlisted toolkit method: ${method}`);
    this.name = "ToolkitMethodError";
  }
}

/** The arguments failed the toolkit's own zod schema; nothing was sent. */
export class ToolkitArgsError extends Error {
  constructor(
    readonly method: ToolkitMethod,
    readonly issues: z.ZodIssue[],
  ) {
    super(
      `${method}: arguments rejected by the toolkit schema: ${issues.map((i) => i.path.join(".") || "(root)").join(", ")}`,
    );
    this.name = "ToolkitArgsError";
  }
}

/** PayPal (or the transport) failed the call. `status` is null when no response arrived. */
export class ToolkitError extends Error {
  readonly method: ToolkitMethod;
  readonly status: number | null;
  readonly code: string;
  readonly debugId: string | null;
  readonly requestId: string | null;
  readonly transportError: string | null;

  constructor(init: {
    method: ToolkitMethod;
    status: number | null;
    code: string;
    message: string;
    debugId: string | null;
    requestId: string | null;
    transportError: string | null;
  }) {
    super(`${init.method}: ${init.message}`);
    this.name = "ToolkitError";
    this.method = init.method;
    this.status = init.status;
    this.code = init.code;
    this.debugId = init.debugId;
    this.requestId = init.requestId;
    this.transportError = init.transportError;
  }

  /** True when PayPal may have processed the request although we saw no success (5xx, timeout). */
  get outcomeUnknown(): boolean {
    return this.status === null || this.status >= 500;
  }
}

interface RunFailure {
  ok?: boolean;
  status?: number;
  code?: string;
  message?: string;
  error?: { message?: string; type?: string };
}

function parseRunOutput(raw: string | undefined): unknown {
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** `PayPalAPI.run()` encodes failures as `{ok:false,status,code,message}` or `{error:{message,type}}`. */
function asFailure(out: unknown): RunFailure | null {
  if (!out || typeof out !== "object" || Array.isArray(out)) return null;
  const o = out as RunFailure;
  if (o.ok === false) return o;
  if (o.error && typeof o.error === "object") return o;
  return null;
}

/**
 * The one execution path for Invoicing (graft G1), shared by the agent and deterministic code:
 * the toolkit's zod schema validates the arguments, then a fresh `PayPalAPI` built from OUR
 * token runs the method. A fresh instance per call sidesteps the toolkit's token that never
 * refreshes and keeps one call's PayPal-Request-Id out of the next.
 */
export class PayPalToolkit {
  readonly #deps: ToolkitDeps;

  constructor(deps: ToolkitDeps) {
    this.#deps = deps;
    installCapture();
  }

  readonly tk: Tk = async <T = unknown>(
    method: ToolkitMethod,
    args: unknown,
    requestId?: string,
    options?: TkOptions,
  ): Promise<T> => {
    if (!isToolkitMethod(method)) throw new ToolkitMethodError(String(method));
    const schema = toolkitZodSchemas().get(method);
    if (!schema) throw new ToolkitMethodError(method);
    const parsed = schema.safeParse(args);
    if (!parsed.success) throw new ToolkitArgsError(method, parsed.error.issues);

    const priority = options?.priority ?? this.#deps.priority ?? "live";
    const purpose = `toolkit:${method}`;
    for (let attempt = 1; ; attempt++) {
      await this.#deps.limiter?.take({ purpose, priority });
      const token = await this.#deps.auth.token();
      const api = new PayPalAPI(token.v, {
        sandbox: true,
        source: TOOLKIT_SOURCE,
        ...(requestId ? { request_id: requestId } : {}),
      });
      const capture: CallCapture = {
        debugId: null,
        status: null,
        transportError: null,
        timeoutMs: this.#deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      };
      const started = performance.now();
      const raw = await withCapture(capture, () => api.run(method, parsed.data));
      const ms = Math.round(performance.now() - started);
      const out = parseRunOutput(raw);
      const failure = asFailure(out);
      const status = failure?.status ?? capture.status;
      const code = failure
        ? (failure.code ?? (failure.error ? "PAYPAL_TOOL_ERROR" : "PAYPAL_API_HTTP_ERROR"))
        : null;
      await this.#record({
        purpose,
        method,
        attempt,
        ok: !failure,
        status,
        debugId: capture.debugId,
        requestId: requestId ?? null,
        errorCode: code,
        ms,
      });
      if (!failure) return out as T;
      if (status === 401 && attempt === 1) {
        this.#deps.auth.invalidate();
        continue;
      }
      throw new ToolkitError({
        method,
        status: status ?? null,
        code: code ?? "PAYPAL_TOOL_ERROR",
        message: failure.message ?? failure.error?.message ?? "Unknown toolkit error",
        debugId: capture.debugId,
        requestId: requestId ?? null,
        transportError: capture.transportError,
      });
    }
  };

  async #record(record: ToolkitCallRecord): Promise<void> {
    try {
      await this.#deps.onCall?.(record);
    } catch {
      // Observability must never turn a completed PayPal call into a failure the caller retries.
    }
  }
}

/** `tk(method, args, requestId?)` bound to its dependencies (IC-06). */
export function createTk(deps: ToolkitDeps): Tk {
  return new PayPalToolkit(deps).tk;
}
