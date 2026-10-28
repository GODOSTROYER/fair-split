// `tk()` for this process: the real @paypal/agent-toolkit 1.11.0 code path (graft G1), on the shared PayPal
// token cache (`deps.paypal.core.auth`, IC-05), behind the same Postgres limiter every PayPal call takes (40 calls
// a minute across services, the 6-minute circuit after a 429; WS-DATA's `paypalCoreLimiter`), with each attempt
// completing its `paypal_calls` row with the debug_id. Nothing else in the slice calls Invoicing.
import { type CallPriority, createLimiter, paypalCoreLimiter } from "@fairsplit/db";
import { createTk, type Tk, type ToolkitCallRecord } from "@fairsplit/paypal-toolkit";
import type { AppDeps } from "../lib/context.js";
import { LaneRefused } from "./errors.js";

export interface ToolkitOptions {
  workspaceId: string | null;
  priority?: CallPriority;
}

export function toolkitFor(deps: Pick<AppDeps, "db" | "paypal" | "logger" | "clock">, o: ToolkitOptions): Tk {
  const { limiter, recorder } = paypalCoreLimiter(createLimiter(deps.db), { workspaceId: o.workspaceId });
  // tk() takes a slot before each attempt and reports the attempt after it, in order: the reports complete the
  // slots' rows first in, first out.
  const tickets: string[] = [];
  return createTk({
    auth: deps.paypal.core.auth,
    priority: o.priority ?? "live",
    limiter: {
      async take(req) {
        const r = await limiter.take(req);
        // Refused: nothing is sent. Thrown as the lane's own refusal so callers classify it QUEUED/CIRCUIT_OPEN.
        if (!r.ok) throw new LaneRefused(r.reason, r.retryAfterMs);
        if (r.ticket) tickets.push(r.ticket);
        return r;
      },
      reportRateLimited: (at) => limiter.reportRateLimited(at),
    },
    async onCall(rec: ToolkitCallRecord) {
      await recorder.record({
        at: deps.clock.now(),
        purpose: rec.purpose,
        priority: o.priority ?? "live",
        method: rec.method,
        path: `toolkit:${rec.method}`,
        status: rec.status ?? 0,
        outcome: rec.ok ? "ok" : rec.status === null ? "network_error" : "http_error",
        debugId: rec.debugId,
        requestId: rec.requestId,
        ms: rec.ms,
        attempt: rec.attempt,
        ticket: tickets.shift() ?? null,
      });
    },
  });
}
