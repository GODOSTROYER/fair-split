// Security headers on every response (S3.8, S3.13, S1 "every route sends Referrer-Policy: no-referrer").
// HTML gets a same-origin CSP whose `frame-ancestors 'self'` lets the Judge stage frame its own phone
// frames and nobody else; API responses get `default-src 'none'`. A route may set its own CSP first
// (the sandboxed /docs page does); this middleware never overwrites one.
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../lib/context.js";

export const API_CSP = "default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

export const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/** Paths whose pages must not be indexed (S3.9: judge, Proof, brand and member links), plus the API. */
export const NOINDEX_PREFIXES = [
  "/judge",
  "/p/",
  "/b/",
  "/s/",
  "/app/s/",
  "/proof/",
  "/ops",
  "/prototype",
  "/v1/",
  "/docs",
];

export interface SecurityOptions {
  /** https origins also get HSTS. */
  publicOrigin: string;
  /** The `X-FS-Rail` value (I8): `simulated` or `sandbox`. */
  railLabel: string;
}

export function securityHeaders(opts: SecurityOptions): MiddlewareHandler<AppEnv> {
  const https = opts.publicOrigin.startsWith("https://");
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    const set = (name: string, value: string) => {
      if (!h.has(name)) c.header(name, value);
    };
    set("X-Content-Type-Options", "nosniff");
    set("Referrer-Policy", "no-referrer");
    set("X-Frame-Options", "SAMEORIGIN");
    set("Cross-Origin-Opener-Policy", "same-origin");
    set("Cross-Origin-Resource-Policy", "same-origin");
    set("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=(), usb=()");
    if (https) set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    const path = c.req.path;
    if (NOINDEX_PREFIXES.some((p) => path === p.replace(/\/$/, "") || path.startsWith(p))) {
      set("X-Robots-Tag", "noindex, nofollow");
    }
    const isHtml = (h.get("content-type") ?? "").startsWith("text/html");
    set("Content-Security-Policy", isHtml ? HTML_CSP : API_CSP);
    if (path.startsWith("/v1/") || path.startsWith("/webhooks/") || path.startsWith("/internal/")) {
      set("Cache-Control", "no-store");
      set("X-FS-Rail", opts.railLabel);
    }
  };
}
