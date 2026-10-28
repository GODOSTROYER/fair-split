// Per-request context: a request id (a client's `X-Request-Id` when it looks safe, else a fresh UUIDv7),
// echoed on the response; a child logger carrying it; the shared deps; and one access-log line per request.
import { uuidv7 } from "@fairsplit/db";
import type { MiddlewareHandler } from "hono";
import type { AppDeps, AppEnv } from "../lib/context.js";

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** Link routes carry a credential in the path (`/s/:token`, `/b/:token`, `/app/s/:token`): never log it. */
const TOKEN_IN_PATH = /^(\/(?:app\/)?[sb]\/)[^/]+/;

/** The request path as access logs may show it (query strings are never logged either). */
export function loggablePath(path: string): string {
  return path.replace(TOKEN_IN_PATH, "$1[REDACTED]");
}

export function requestContext(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : uuidv7();
    const log = deps.logger.child({ requestId });
    c.set("requestId", requestId);
    c.set("log", log);
    c.set("deps", deps);
    c.header("X-Request-Id", requestId);
    const started = performance.now();
    await next();
    const path = loggablePath(c.req.path);
    const isApi = path.startsWith("/v1") || path.startsWith("/webhooks") || path.startsWith("/internal");
    const quiet = path === "/healthz" || path === "/readyz" || (!isApi && c.res.status < 400);
    const line = {
      method: c.req.method,
      path,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
    };
    if (c.res.status >= 500) log.error(line, "request failed");
    else if (quiet) log.debug(line, "request");
    else log.info(line, "request");
  };
}
