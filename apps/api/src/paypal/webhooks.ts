// Mounts WS-PPCORE's `/webhooks/paypal` route (apps/api/src/webhooks, not edited here) with fs-api's
// persistence: one transaction stores the `webhook_events` row (ON CONFLICT (paypal_event_id) DO NOTHING)
// and enqueues `processWebhook` in the outbox (I7); a repeated delivery of a stored event appends a
// `webhook.received {duplicate: true}` run event once the event belongs to a workspace (MM-6's resent copy).
// Rows carry the rail's provenance (I8): `simulated_rail` in simulator mode, `live` in the sandbox.
import { TASKS } from "@fairsplit/contracts";
import { appendEvent, type Db, schema, type Tx } from "@fairsplit/db";
import { enqueue } from "@fairsplit/outbox";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import type { Logger } from "pino";
import { clientIp } from "../lib/client-ip.js";
import type { AppEnv } from "../lib/context.js";
import {
  createPayPalWebhookHandler,
  type DuplicateDelivery,
  honoPayPalWebhook,
  type PayPalWebhookHandler,
  type WebhookEventInsert,
} from "../webhooks/paypal.js";
import type { PayPalRail } from "./mode.js";

export const WEBHOOK_PATH = "/webhooks/paypal";

export interface WebhookWiring {
  db: Db;
  rail: PayPalRail;
  logger: Logger;
}

/** `wh:<paypal event id>`, IC-01's processWebhook dedupe key. */
function paypalEventIdFromDedupeKey(dedupeKey: string): string {
  return dedupeKey.startsWith("wh:") ? dedupeKey.slice(3) : dedupeKey;
}

export function createWebhookHandler(w: WebhookWiring): PayPalWebhookHandler {
  const log = w.logger.child({ route: WEBHOOK_PATH });
  return createPayPalWebhookHandler<Tx>({
    verify: (raw, headers, ctx) =>
      w.rail.core.verifier.verifyDetailed(raw, headers, w.rail.webhookId ?? "", { clientIp: ctx.clientIp }),
    releaseTransmission: (id) => w.rail.core.verifier.releaseTransmission(id),
    transaction: (fn) => w.db.transaction(fn),
    async insertWebhookEvent(tx, row: WebhookEventInsert) {
      const [inserted] = await tx
        .insert(schema.webhookEvents)
        .values({
          paypalEventId: row.paypalEventId,
          eventType: row.eventType ?? "UNKNOWN",
          resourceKey: row.resourceKey,
          verified: row.verified,
          raw: row.raw,
          status: row.status,
          // The proposed `delivery` jsonb is not in the schema yet (SPLIT.md gaps): keep the reject reason.
          error: row.delivery?.rejectReason ?? null,
          provenance: w.rail.provenance,
        })
        .onConflictDoNothing({ target: schema.webhookEvents.paypalEventId })
        .returning({ id: schema.webhookEvents.id });
      return inserted ?? null;
    },
    async enqueue(tx, name, args, dedupeKey) {
      const full = {
        webhookEventId: args.webhookEventId,
        paypalEventId: paypalEventIdFromDedupeKey(dedupeKey),
      };
      // IC-01 owns the key; the route's shim computes the same `wh:<id>`.
      await enqueue(tx, name, full, TASKS.processWebhook.dedupeKey(full));
    },
    async onDuplicate(tx, d: DuplicateDelivery) {
      const [stored] = await tx
        .select({ id: schema.webhookEvents.id, workspaceId: schema.webhookEvents.workspaceId })
        .from(schema.webhookEvents)
        .where(eq(schema.webhookEvents.paypalEventId, d.paypalEventId))
        .limit(1);
      if (!stored?.workspaceId) return;
      await appendEvent(tx, {
        workspaceId: stored.workspaceId,
        type: "webhook.received",
        actor: { kind: "paypal", id: "paypal:webhook" },
        provenance: w.rail.provenance,
        payload: {
          webhookEventId: stored.id,
          paypalEventId: d.paypalEventId,
          eventType: d.eventType,
          verified: d.verified,
          duplicate: true,
        },
      });
    },
    logger: log,
  });
}

export function mountPayPalWebhooks(app: Hono<AppEnv>, handler: PayPalWebhookHandler): void {
  app.post(WEBHOOK_PATH, honoPayPalWebhook(handler, { clientIp: (req) => clientIp(req.headers) }));
}
