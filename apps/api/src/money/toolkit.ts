// `tk()` for this process: the real @paypal/agent-toolkit 1.11.0 code path (graft G1), on the shared PayPal
// token cache (`deps.paypal.core.auth`), behind the same Postgres limiter every PayPal call takes (40 calls a
// minute across services, the 6-minute circuit after a 429), with each attempt recorded in `paypal_calls`
// with its debug_id. Nothing else in the slice calls Invoicing.
import { type CallPriority, createLimiter } from "@fairsplit/db";
import { createTk, type Tk, type ToolkitCallRecord } from "@fairsplit/paypal-toolkit";
import type { AppDeps } from "../lib/context.js";
import { LaneRefused } from "./errors.js";

export interface ToolkitOptions {
  workspaceId: string | null;
  priority?: CallPriority;
}

export function toolkitFor(deps: Pick<AppDeps, "db" | "paypal" | "logger">, o: ToolkitOptions): Tk {
  const limiter = createLimiter(deps.db);
  const tickets: string[] = [];
  const auth = deps.paypal.core.auth;
  return createTk({
    // The shared token cache, adapted to the toolkit's (shimmed) IC-05 shape.
    auth: {
      async token() {
        const t = await auth.token();
        return { v: t.v, exp: t.exp, scopes: [...t.scopes] };
      },
      invalidate: () => auth.invalidate(),
    },
    priority: o.priority ?? "live",
    limiter: {
      async take(req) {
        const r = await limiter.take({
          purpose: req.purpose,
          priority: req.priority,
          workspaceId: o.workspaceId,
        });
        if (!r.ok) throw new LaneRefused(r.reason, r.retryAfterMs);
        tickets.push(r.callId);
        return r;
      },
    },
    async onCall(rec: ToolkitCallRecord) {
      const ticket = tickets.shift();
      if (!ticket) return;
      await limiter.record(ticket, {
        status: rec.status,
        debugId: rec.debugId,
        ms: rec.ms,
        error: rec.ok ? null : rec.errorCode,
      });
    },
  });
}
