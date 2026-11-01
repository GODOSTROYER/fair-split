// PP_MODE=simulator, in process (ADR-0010): the simulator's PUBLIC pages under /paypal-sim, and nothing else of it.
// They are the webhook certificate chain (`/paypal-sim/sim/certs/SIMCERT-….pem`, which every delivery names), the
// labelled invoice and pay pages and /sim/health. The simulator's REST API stays in process (the rail and the
// interceptor answer PayPal's sandbox hosts) and its /sim/admin API is never mounted: any other path under the prefix
// is the simulator's own 404.
import type { Hono } from "hono";
import type { AppEnv } from "../lib/context.js";
import type { SimulatorPages } from "./mode.js";

export function mountSimulatorPages(app: Hono<AppEnv>, pages: SimulatorPages | null): void {
  if (!pages) return;
  const serve = (request: Request) => pages.fetch(request);
  app.all(pages.basePath, (c) => serve(c.req.raw));
  app.all(`${pages.basePath}/*`, (c) => serve(c.req.raw));
}
