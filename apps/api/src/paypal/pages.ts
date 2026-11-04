// PP_MODE=simulator, in process (ADR-0010): the simulator's PUBLIC pages under /paypal-sim, and nothing else of it.
// They are the webhook certificate chain (`/paypal-sim/sim/certs/SIMCERT-….pem`, which every delivery names), the
// labelled invoice and pay pages and /sim/health. The simulator's REST API stays in process (the rail and the
// interceptor answer PayPal's sandbox hosts) and its /sim/admin API is never mounted: any other path under the prefix
// is the simulator's own 404.
import type { Context, Hono } from "hono";
import type { AppEnv } from "../lib/context.js";
import { readBodyWithLimit } from "../webhooks/paypal.js";
import type { SimulatorPages } from "./mode.js";

export function mountSimulatorPages(app: Hono<AppEnv>, pages: SimulatorPages | null): void {
  if (!pages) return;
  const serve = async (c: Context<AppEnv>): Promise<Response> => {
    const request = c.req.raw;
    if (request.method === "GET" || request.method === "HEAD") return pages.fetch(request);
    const body = await readBodyWithLimit(request, 4096);
    if (body === null) return new Response(null, { status: 413 });
    return pages.fetch(new Request(request.url, { method: request.method, headers: request.headers, body }));
  };
  app.all(pages.basePath, serve);
  app.all(`${pages.basePath}/*`, serve);
}
