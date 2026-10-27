// In-process routing of PayPal *sandbox* traffic to the simulator, so code with a hard-coded base URL
// (@paypal/agent-toolkit 1.11.0, @paypal/paypal-server-sdk) runs unmodified in PP_MODE=simulator.
//  • createSandboxDispatcher(): an undici-compatible Dispatcher for fetch (`fetch(url, { dispatcher })`).
//  • installSandboxInterceptor(): process-wide — wraps the global undici dispatcher (global fetch) and
//    node:http/https request()/get() (axios, follow-redirects) for the sandbox hosts only. Live PayPal hosts
//    and every other host pass through untouched.
// Both answer with the simulator's REST routes only (Simulator.apiFetch): PayPal's API host has no /sim pages,
// and every request counts as one client address ("in-process"), as all of a server's calls share one IP.
import http, { type ClientRequest, type IncomingMessage, type RequestOptions } from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import type { AddressInfo } from "node:net";
import { urlToHttpOptions } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { SANDBOX_HOSTS } from "./constants.js";
import { IN_PROCESS_ENV } from "./http/app.js";
import type { Simulator } from "./simulator.js";

/** Structural subset of undici's dispatch options. */
export interface DispatchOptionsLike {
  origin?: string | URL;
  path: string;
  method?: string;
  headers?: unknown;
  body?: unknown;
}

type Controller = {
  abort(reason?: Error): void;
  pause(): void;
  resume(): void;
  readonly aborted: boolean;
  readonly paused: boolean;
  readonly reason: Error | null;
};

/** Both generations of undici's dispatch handler protocol. */
export interface DispatchHandlerLike {
  onConnect?(abort: (err?: Error) => void): void;
  onResponseStarted?(): void;
  onHeaders?(
    statusCode: number,
    headers: Buffer[],
    resume: () => void,
    statusText: string,
  ): boolean | undefined;
  onData?(chunk: Buffer): boolean | undefined;
  onComplete?(trailers: string[] | null): void;
  onError?(err: Error): void;
  onRequestStart?(controller: Controller, context: unknown): void;
  onResponseStart?(
    controller: Controller,
    statusCode: number,
    headers: Record<string, string | string[]>,
    statusMessage?: string,
  ): void;
  onResponseData?(controller: Controller, chunk: Buffer): void;
  onResponseEnd?(controller: Controller, trailers: Record<string, string | string[]>): void;
  onResponseError?(controller: Controller, err: Error): void;
}

export interface DispatcherLike {
  dispatch(opts: DispatchOptionsLike, handler: DispatchHandlerLike): boolean;
  close(): Promise<void>;
  destroy(): Promise<void>;
}

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "upgrade",
]);

function toHeaders(raw: unknown): Headers {
  const h = new Headers();
  const add = (k: unknown, v: unknown) => {
    const key = String(k).toLowerCase();
    if (HOP_BY_HOP.has(key) || v === undefined || v === null) return;
    if (Array.isArray(v)) for (const x of v) h.append(key, String(x));
    else h.append(key, String(v));
  };
  if (Array.isArray(raw)) {
    if (raw.length > 0 && Array.isArray(raw[0])) for (const [k, v] of raw as [unknown, unknown][]) add(k, v);
    else for (let i = 0; i + 1 < raw.length; i += 2) add(raw[i], raw[i + 1]);
  } else if (raw && typeof raw === "object") {
    if (typeof (raw as Headers).forEach === "function" && raw instanceof Headers)
      raw.forEach((v, k) => {
        add(k, v);
      });
    else for (const [k, v] of Object.entries(raw as Record<string, unknown>)) add(k, v);
  }
  return h;
}

async function readBody(body: unknown): Promise<Buffer | null> {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  const chunks: Buffer[] = [];
  if (typeof (body as ReadableStream).getReader === "function") {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }
  if (typeof (body as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function") {
    for await (const c of body as AsyncIterable<unknown>)
      chunks.push(typeof c === "string" ? Buffer.from(c) : Buffer.from(c as Uint8Array));
    return Buffer.concat(chunks);
  }
  if (typeof (body as Iterable<unknown>)[Symbol.iterator] === "function") {
    for (const c of body as Iterable<unknown>)
      chunks.push(typeof c === "string" ? Buffer.from(c) : Buffer.from(c as Uint8Array));
    return Buffer.concat(chunks);
  }
  return Buffer.from(String(body));
}

/**
 * An undici-compatible Dispatcher that answers requests for the sandbox hosts from the simulator and
 * forwards everything else to `fallback` (default: the global dispatcher at install time).
 */
export function createSandboxDispatcher(
  sim: Simulator,
  opts: { fallback?: DispatcherLike; hosts?: readonly string[] } = {},
): DispatcherLike {
  const hosts = new Set(opts.hosts ?? SANDBOX_HOSTS);
  const handle = async (o: DispatchOptionsLike, handler: DispatchHandlerLike, origin: URL) => {
    let aborted = false;
    let reason: Error | null = null;
    const controller: Controller = {
      abort(err?: Error) {
        aborted = true;
        reason = err ?? new Error("aborted");
      },
      pause() {},
      resume() {},
      get aborted() {
        return aborted;
      },
      get paused() {
        return false;
      },
      get reason() {
        return reason;
      },
    };
    const modern =
      typeof handler.onRequestStart === "function" || typeof handler.onResponseStart === "function";
    try {
      if (modern) handler.onRequestStart?.(controller, {});
      else handler.onConnect?.((err?: Error) => controller.abort(err));
      const method = (o.method ?? "GET").toUpperCase();
      const body = await readBody(o.body);
      const headers = toHeaders(o.headers);
      const request = new Request(new URL(o.path, origin), {
        method,
        headers,
        ...(body && method !== "GET" && method !== "HEAD" ? { body: new Uint8Array(body) } : {}),
      });
      const response = await sim.apiFetch(request, IN_PROCESS_ENV);
      const payload = Buffer.from(await response.arrayBuffer());
      if (aborted) throw reason ?? new Error("aborted");
      if (modern) {
        const h: Record<string, string | string[]> = {};
        response.headers.forEach((v, k) => {
          h[k] = v;
        });
        handler.onResponseStart?.(controller, response.status, h, response.statusText);
        if (payload.length > 0) handler.onResponseData?.(controller, payload);
        handler.onResponseEnd?.(controller, {});
      } else {
        handler.onResponseStarted?.();
        const raw: Buffer[] = [];
        response.headers.forEach((v, k) => {
          raw.push(Buffer.from(k), Buffer.from(v));
        });
        handler.onHeaders?.(response.status, raw, () => {}, response.statusText);
        if (payload.length > 0) handler.onData?.(payload);
        handler.onComplete?.([]);
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (modern) handler.onResponseError?.(controller, e);
      else handler.onError?.(e);
    }
  };
  return {
    dispatch(o, handler) {
      const origin = new URL(String(o.origin ?? "http://localhost"));
      if (!hosts.has(origin.hostname)) {
        if (!opts.fallback) {
          handler.onError?.(new Error(`no fallback dispatcher for ${origin.host}`));
          return false;
        }
        return opts.fallback.dispatch(o, handler);
      }
      void handle(o, handler, origin);
      return true;
    },
    close: async () => {},
    destroy: async () => {},
  };
}

export interface InstalledInterceptor {
  /** http://127.0.0.1:<port> — the in-process loopback listener that serves node:http(s) callers. */
  readonly loopbackUrl: string;
  readonly hosts: readonly string[];
  uninstall(): Promise<void>;
}

type RequestFn = typeof http.request;
const GLOBAL_DISPATCHER = Symbol.for("undici.globalDispatcher.1");
let active: InstalledInterceptor | null = null;

/**
 * Routes every request for the sandbox hosts (https://api-m.sandbox.paypal.com, https://api.sandbox.paypal.com)
 * made through the global fetch or node:http/https to `sim`. Returns a handle whose uninstall() restores
 * the originals. Only one interceptor can be active per process.
 */
export async function installSandboxInterceptor(
  sim: Simulator,
  opts: { hosts?: readonly string[] } = {},
): Promise<InstalledInterceptor> {
  if (active) throw new Error("a PayPal sandbox interceptor is already installed in this process");
  const hosts = [...(opts.hosts ?? SANDBOX_HOSTS)];
  const hostSet = new Set(hosts);

  const server = http.createServer(
    getRequestListener((req) => sim.apiFetch(req, IN_PROCESS_ENV), { overrideGlobalObjects: false }),
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const agent = new http.Agent({ keepAlive: true });

  const originals = {
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
  };

  const reroute = (defaultProtocol: "http:" | "https:", original: RequestFn): RequestFn =>
    function patched(this: unknown, ...args: unknown[]): ClientRequest {
      const [a, b, c] = args;
      let url: URL | undefined;
      let options: RequestOptions = {};
      let callback: ((res: IncomingMessage) => void) | undefined;
      if (typeof a === "string" || a instanceof URL) {
        try {
          url = new URL(String(a));
        } catch {
          return (original as (...x: unknown[]) => ClientRequest).apply(this, args);
        }
        if (typeof b === "function") callback = b as (res: IncomingMessage) => void;
        else {
          options = (b ?? {}) as RequestOptions;
          callback = c as ((res: IncomingMessage) => void) | undefined;
        }
      } else {
        options = (a ?? {}) as RequestOptions;
        callback = b as ((res: IncomingMessage) => void) | undefined;
      }
      const merged: RequestOptions = url ? { ...urlToHttpOptions(url), ...options } : { ...options };
      const hostname =
        merged.hostname ?? (typeof merged.host === "string" ? merged.host.replace(/:\d+$/, "") : "");
      if (!hostSet.has(hostname ?? ""))
        return (original as (...x: unknown[]) => ClientRequest).apply(this, args);
      const protocol = merged.protocol ?? defaultProtocol;
      const headers: Record<string, string | string[]> = {};
      const rawHeaders = merged.headers;
      if (Array.isArray(rawHeaders)) {
        for (let i = 0; i + 1 < rawHeaders.length; i += 2)
          headers[String(rawHeaders[i]).toLowerCase()] = String(rawHeaders[i + 1]);
      } else if (rawHeaders) {
        for (const [k, v] of Object.entries(rawHeaders)) {
          if (v === undefined) continue;
          headers[k.toLowerCase()] = Array.isArray(v) ? v.map(String) : String(v);
        }
      }
      const defaultPort = protocol === "https:" ? 443 : 80;
      const port0 = merged.port ? Number(merged.port) : defaultPort;
      headers.host = port0 === defaultPort ? String(hostname) : `${hostname}:${port0}`;
      headers["x-forwarded-proto"] = protocol.replace(":", "");
      const rerouted: RequestOptions = {
        method: merged.method ?? "GET",
        path: merged.path ?? "/",
        headers,
        host: "127.0.0.1",
        hostname: "127.0.0.1",
        port,
        agent,
        ...(merged.timeout !== undefined ? { timeout: merged.timeout } : {}),
        ...(merged.signal ? { signal: merged.signal } : {}),
        ...(merged.auth ? { auth: merged.auth } : {}),
      };
      return originals.httpRequest(rerouted, callback as (res: IncomingMessage) => void);
    } as RequestFn;

  const asGet =
    (request: RequestFn) =>
    (...args: unknown[]): ClientRequest => {
      const req = (request as (...x: unknown[]) => ClientRequest)(...args);
      req.end();
      return req;
    };

  const httpRequest = reroute("http:", originals.httpRequest);
  const httpsRequest = reroute("https:", originals.httpsRequest);
  (http as { request: RequestFn }).request = httpRequest;
  (http as { get: unknown }).get = asGet(httpRequest);
  (https as { request: RequestFn }).request = httpsRequest;
  (https as { get: unknown }).get = asGet(httpsRequest);
  syncBuiltinESMExports();

  // Make sure Node has created its global undici dispatcher, then wrap it.
  await (await fetch("data:text/plain,paypal-sim")).text();
  const g = globalThis as unknown as Record<symbol, DispatcherLike | undefined>;
  const previous = g[GLOBAL_DISPATCHER];
  g[GLOBAL_DISPATCHER] = createSandboxDispatcher(sim, { hosts, ...(previous ? { fallback: previous } : {}) });

  const handle: InstalledInterceptor = {
    loopbackUrl: `http://127.0.0.1:${port}`,
    hosts,
    async uninstall() {
      (http as { request: RequestFn }).request = originals.httpRequest;
      (http as { get: unknown }).get = originals.httpGet;
      (https as { request: RequestFn }).request = originals.httpsRequest;
      (https as { get: unknown }).get = originals.httpsGet;
      syncBuiltinESMExports();
      g[GLOBAL_DISPATCHER] = previous;
      agent.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (active === handle) active = null;
    },
  };
  active = handle;
  return handle;
}
