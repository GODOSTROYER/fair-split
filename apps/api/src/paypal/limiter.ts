// Adapts WS-DATA's Postgres limiter (`createLimiter(db)`: 40 calls a minute across services, 20 for
// background work, a 6-minute circuit after a 429) to paypal-core's `PayPalLimiter` + `PayPalCallRecorder`
// hooks, so every PayPal HTTP attempt takes a slot and lands in `paypal_calls` with its debug_id.
import type { Limiter } from "@fairsplit/db";
import type {
  LimiterDecision,
  LimiterRequest,
  PayPalCallRecord,
  PayPalCallRecorder,
  PayPalLimiter,
} from "@fairsplit/paypal-core";

export interface DbPayPalLimiter extends PayPalLimiter, PayPalCallRecorder {}

export function dbPayPalLimiter(
  limiter: Limiter,
  opts: { workspaceId?: string | null } = {},
): DbPayPalLimiter {
  return {
    async take(req: LimiterRequest): Promise<LimiterDecision> {
      const r = await limiter.take({
        purpose: req.purpose,
        priority: req.priority,
        workspaceId: opts.workspaceId ?? null,
      });
      if (r.ok) return { ok: true, ticket: r.callId };
      return {
        ok: false,
        reason: r.reason === "BACKGROUND_FULL" ? "BACKGROUND_SHARE_FULL" : r.reason,
        retryAfterMs: r.retryAfterMs,
      };
    },
    // The circuit is derived from the 429 row the recorder writes, so nothing to do here.
    reportRateLimited: () => undefined,
    async record(call: PayPalCallRecord) {
      if (!call.ticket) return;
      await limiter.record(call.ticket, {
        status: call.status === 0 ? null : call.status,
        debugId: call.debugId,
        ms: call.ms,
        error: call.outcome === "ok" ? null : call.outcome,
      });
    },
  };
}
