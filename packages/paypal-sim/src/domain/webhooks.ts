// Webhook events, signed deliveries, retries, resend, out-of-order/duplicate toggles and postback
// verification. Deliveries are signed exactly like PayPal's: RSA-SHA256 over
// `transmissionId|transmissionTime|webhookId|crc32(rawBody)` with the simulator's leaf certificate.
import { isDeepStrictEqual } from "node:util";
import { crc32 } from "node:zlib";
import { SIMULATED_HEADER } from "../constants.js";
import type { SpecName } from "../contract/openapi.js";
import { checkWebhookTarget } from "../net.js";
import type { Simulator } from "../simulator.js";
import type { DeliveryRecord, EventRecord, Json, JsonObject, WebhookRecord } from "../state.js";
import { newCorrelationId, newEventId, newTransmissionId } from "../util/ids.js";
import { rawMember } from "../util/rawjson.js";
import { isoMillis, isoSeconds } from "../util/time.js";

/** Event types the simulator emits, with PayPal's descriptions. `*` subscribes to all of them. */
export const EVENT_TYPES: { name: string; description: string }[] = [
  { name: "INVOICING.INVOICE.CREATED", description: "An invoice is created." },
  { name: "INVOICING.INVOICE.UPDATED", description: "An invoice is updated." },
  { name: "INVOICING.INVOICE.SCHEDULED", description: "An invoice is scheduled." },
  {
    name: "INVOICING.INVOICE.PAID",
    description: "An invoice is paid, partially paid, or payment is made and is pending.",
  },
  { name: "INVOICING.INVOICE.CANCELLED", description: "A merchant or customer cancels an invoice." },
  { name: "INVOICING.INVOICE.REFUNDED", description: "An invoice is refunded or partially refunded." },
  { name: "PAYMENT.PAYOUTSBATCH.DENIED", description: "A batch payout payment is denied." },
  {
    name: "PAYMENT.PAYOUTSBATCH.PROCESSING",
    description: "The state of a batch payout payment changes to processing.",
  },
  { name: "PAYMENT.PAYOUTSBATCH.SUCCESS", description: "A batch payout payment completes successfully." },
  { name: "PAYMENT.PAYOUTS-ITEM.BLOCKED", description: "A payouts item is blocked." },
  { name: "PAYMENT.PAYOUTS-ITEM.CANCELED", description: "A payouts item is canceled." },
  { name: "PAYMENT.PAYOUTS-ITEM.DENIED", description: "A payouts item is denied." },
  { name: "PAYMENT.PAYOUTS-ITEM.FAILED", description: "A payouts item fails." },
  { name: "PAYMENT.PAYOUTS-ITEM.HELD", description: "A payouts item is held." },
  { name: "PAYMENT.PAYOUTS-ITEM.REFUNDED", description: "A payouts item is refunded." },
  { name: "PAYMENT.PAYOUTS-ITEM.RETURNED", description: "A payouts item is returned." },
  { name: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", description: "A payouts item succeeds." },
  { name: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED", description: "A payouts item is unclaimed." },
];

const KNOWN = new Set(EVENT_TYPES.map((e) => e.name));
export const isKnownEventType = (name: string): boolean => name === "*" || KNOWN.has(name);

/**
 * PayPal "will reattempt delivery up to 25 times over the course of 3 days" after any non-2xx answer
 * (developer.paypal.com/api/rest/webhooks). Seconds before retry n; the 25 waits add up to exactly three
 * days (259,200 s), the last one closing the window. With the first attempt that is 26 attempts in all.
 */
export const RETRY_BACKOFF_S: readonly number[] = Object.freeze([
  5, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 3600, 7200, 7200, 10800, 10800, 14400, 14400, 18000, 21600,
  21600, 21600, 21600, 25200, 25200, 28570,
]);

/** The literal webhook ID PayPal uses to sign mock (simulate-event) deliveries. */
export const MOCK_WEBHOOK_ID = "WEBHOOK_ID";

/** resource_type → [spec, definition, the part of `resource` it describes, where (for messages)]. */
const RESOURCE_SCHEMAS: Record<string, [SpecName, string, (r: JsonObject) => unknown, string]> = {
  invoices: ["invoicing", "invoice", (r) => r.invoice, " resource.invoice"],
  payouts: ["payouts", "payout_batch", (r) => r, " resource"],
  payouts_item: ["payouts", "payout_item", (r) => r, " resource"],
};

export interface EmitInput {
  clientId: string;
  eventType: string;
  resourceType: string;
  resourceVersion?: string;
  summary: string;
  resource: JsonObject;
  resourceIds: string[];
}

export class WebhookEngine {
  private held: DeliveryRecord[] = [];

  constructor(private readonly sim: Simulator) {}

  subscribers(clientId: string, eventType: string): WebhookRecord[] {
    return Object.values(this.sim.state.webhooks).filter(
      (w) => w.clientId === clientId && (w.eventTypes.includes("*") || w.eventTypes.includes(eventType)),
    );
  }

  private buildEvent(id: string, input: EmitInput, createdAt: number): JsonObject {
    const base = this.sim.options.apiBaseUrl;
    const event: JsonObject = {
      id,
      event_version: "1.0",
      create_time: isoMillis(createdAt),
      resource_type: input.resourceType,
    };
    if (input.resourceVersion) event.resource_version = input.resourceVersion;
    event.event_type = input.eventType;
    event.summary = input.summary;
    event.resource = input.resource;
    event.links = [
      { href: `${base}/v1/notifications/webhooks-events/${id}`, rel: "self", method: "GET" },
      { href: `${base}/v1/notifications/webhooks-events/${id}/resend`, rel: "resend", method: "POST" },
    ];
    return event;
  }

  /** Records an event and delivers it to every subscribed webhook of the owning app. */
  emit(input: EmitInput): EventRecord | null {
    const targets = this.subscribers(input.clientId, input.eventType);
    const id = newEventId();
    const createdAt = this.sim.clock.now();
    const event = this.buildEvent(id, input, createdAt);
    this.checkEvent(event, input);
    if (targets.length === 0) return null;
    const record: EventRecord = {
      id,
      clientId: input.clientId,
      createdAt,
      eventType: input.eventType,
      body: JSON.stringify(event),
      webhookIds: targets.map((t) => t.id),
      mock: false,
      resourceIds: input.resourceIds,
    };
    this.sim.state.events[id] = record;
    this.sim.state.eventOrder.push(id);
    for (const w of targets) {
      this.deliver(record, w);
      if (this.sim.state.delivery.duplicate) this.deliver(record, w);
    }
    this.sim.markDirty();
    return record;
  }

  /**
   * The envelope is checked against the Webhooks spec's `event`, whose `resource` is a free-form object, so the
   * resource is also checked against its own API schema: an invoice event's `resource.invoice` is Invoicing's
   * `invoice`, a batch event's resource Payouts' `payout_batch`, an item event's Payouts' `payout_item`.
   */
  private checkEvent(event: JsonObject, input: EmitInput): void {
    const parts: [SpecName, string, unknown, string][] = [["webhooks", "event", event, ""]];
    const target = RESOURCE_SCHEMAS[input.resourceType];
    if (target) parts.push([target[0], target[1], target[2](input.resource), target[3]]);
    for (const [spec, def, value, where] of parts) {
      const issues = this.sim.contract.check(spec, def, value, "res");
      if (issues.length > 0) {
        this.sim.recordViolation(`event ${input.eventType}${where}: ${JSON.stringify(issues)}`);
        continue;
      }
      if (!this.sim.options.strictProperties) continue;
      const extra = this.sim.contract.undeclared(spec, def, value, "res");
      if (extra.length > 0)
        this.sim.recordViolation(`event ${input.eventType}${where}: undeclared ${extra.join(", ")}`);
    }
  }

  /** Creates a signed transmission of `event` to `webhook` (a resend or duplicate gets a new transmission id). */
  deliver(
    event: EventRecord,
    webhook: { id: string; url: string },
    opts: { mock?: boolean } = {},
  ): DeliveryRecord {
    const now = this.sim.clock.now();
    const transmissionId = newTransmissionId();
    const time = isoSeconds(now);
    const signedWebhookId = opts.mock ? MOCK_WEBHOOK_ID : webhook.id;
    const signature = this.sign(event, transmissionId, time, signedWebhookId);
    const d: DeliveryRecord = {
      transmissionId,
      eventId: event.id,
      webhookId: webhook.id,
      url: webhook.url,
      time,
      signature,
      certUrl: this.sim.certUrl,
      attempts: 0,
      status: "PENDING",
      lastStatusCode: null,
      lastError: null,
      createdAt: now,
      mock: Boolean(opts.mock),
    };
    this.sim.state.deliveries[transmissionId] = d;
    if (this.sim.state.delivery.outOfOrder) {
      d.status = "HELD";
      this.held.push(d);
      // A no-op tick guarantees the scheduler drains (and releases held deliveries) after this burst.
      this.sim.scheduler.schedule(0, () => undefined);
    } else {
      this.sim.scheduler.schedule(0, () => this.attempt(transmissionId));
    }
    return d;
  }

  private sign(event: EventRecord, transmissionId: string, time: string, webhookId: string): string {
    const crc = crc32(Buffer.from(event.body, "utf8")) >>> 0;
    return this.sim.signing.signMessage(`${transmissionId}|${time}|${webhookId}|${crc}`);
  }

  /** Out-of-order mode: deliveries held during a burst go out newest first once processing drains. */
  releaseHeld(): void {
    if (this.held.length === 0) return;
    const batch = this.held.reverse();
    this.held = [];
    for (const d of batch) {
      d.status = "PENDING";
      this.sim.scheduler.schedule(0, () => this.attempt(d.transmissionId));
    }
  }

  clearHeld(): void {
    this.held = [];
  }

  headersFor(d: DeliveryRecord): Record<string, string> {
    return {
      "content-type": "application/json",
      "paypal-transmission-id": d.transmissionId,
      "paypal-transmission-time": d.time,
      "paypal-transmission-sig": d.signature,
      "paypal-cert-url": d.certUrl,
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-auth-version": "v2",
      "correlation-id": newCorrelationId(),
      "user-agent": "FairSplit-PayPal-Simulator/1.0 (simulated webhook, not PayPal)",
      [SIMULATED_HEADER]: "true",
    };
  }

  private async attempt(transmissionId: string): Promise<void> {
    const d = this.sim.state.deliveries[transmissionId];
    if (!d || d.status === "SUCCESS" || d.status === "FAILED") return;
    const event = this.sim.state.events[d.eventId];
    if (!event) return;
    // Checked again on every attempt: a URL stored earlier (a snapshot, a changed policy) gets no POST.
    const target = checkWebhookTarget(this.sim.options.webhookTargets, d.url);
    if (!target.ok) {
      d.status = "FAILED";
      d.lastStatusCode = null;
      d.lastError = `not delivered: ${target.description}`;
      this.sim.markDirty();
      return;
    }
    if (d.attempts > 0) {
      // A retry is transmitted afresh: same transmission id, new transmission time and signature.
      d.time = isoSeconds(this.sim.clock.now());
      d.signature = this.sign(event, d.transmissionId, d.time, d.mock ? MOCK_WEBHOOK_ID : d.webhookId);
    }
    d.attempts++;
    try {
      const res = await this.sim.options.deliveryFetch(d.url, {
        method: "POST",
        headers: this.headersFor(d),
        body: event.body,
        // A redirect is an answer like any other non-2xx: never followed, so it cannot point us elsewhere.
        redirect: "manual",
        signal: AbortSignal.timeout(this.sim.options.deliveryTimeoutMs),
      });
      d.lastStatusCode = res.status;
      d.lastError = null;
      try {
        await res.body?.cancel();
      } catch {
        // the answer's body is never read
      }
      if (res.status >= 200 && res.status < 300) {
        d.status = "SUCCESS";
        this.sim.markDirty();
        return;
      }
    } catch (err) {
      d.lastStatusCode = null;
      d.lastError = err instanceof Error ? err.message : String(err);
    }
    if (d.attempts >= this.sim.options.maxAttempts) {
      d.status = "FAILED";
      this.sim.markDirty();
      return;
    }
    const wait = RETRY_BACKOFF_S[Math.min(d.attempts - 1, RETRY_BACKOFF_S.length - 1)] ?? 28570;
    this.sim.scheduler.schedule(wait, () => this.attempt(transmissionId));
    this.sim.markDirty();
  }

  /** POST /v1/notifications/webhooks-events/{id}/resend: same event, new transmission ids. */
  resend(event: EventRecord, webhookIds: string[] | undefined): DeliveryRecord[] {
    const owned = Object.values(this.sim.state.webhooks).filter((w) => w.clientId === event.clientId);
    const targets =
      webhookIds && webhookIds.length > 0
        ? owned.filter((w) => webhookIds.includes(w.id))
        : owned.filter((w) => event.webhookIds.includes(w.id));
    return targets.map((w) => this.deliver(event, w, { mock: event.mock }));
  }

  /** Mock event (simulate-event): delivered unsigned-for-real, i.e. signed with the literal `WEBHOOK_ID`. */
  simulate(
    clientId: string,
    url: string,
    eventType: string,
    resource: JsonObject,
    resourceType: string,
  ): EventRecord {
    const id = newEventId();
    const createdAt = this.sim.clock.now();
    const event = this.buildEvent(
      id,
      {
        clientId,
        eventType,
        resourceType,
        summary: `Simulated ${eventType} (mock)`,
        resource,
        resourceIds: [],
      },
      createdAt,
    );
    const record: EventRecord = {
      id,
      clientId,
      createdAt,
      eventType,
      body: JSON.stringify(event),
      webhookIds: [],
      mock: true,
      resourceIds: [],
    };
    this.sim.state.events[id] = record;
    this.deliver(record, { id: MOCK_WEBHOOK_ID, url }, { mock: true });
    return record;
  }

  /**
   * POST /v1/notifications/verify-webhook-signature. SUCCESS only when the posted values verify with the
   * simulator's certificate over transmission_id|transmission_time|webhook_id|crc32(webhook_event as posted),
   * the cert URL is the simulator's, and the webhook belongs to the calling app. Mock events always FAIL,
   * as PayPal documents for its own mock events.
   */
  verify(clientId: string, rawBody: string, parsed: JsonObject): "SUCCESS" | "FAILURE" {
    const s = (k: string): string => (typeof parsed[k] === "string" ? (parsed[k] as string) : "");
    if (s("auth_algo") !== "SHA256withRSA") return "FAILURE";
    if (s("cert_url") !== this.sim.certUrl) return "FAILURE";
    const webhook = this.sim.state.webhooks[s("webhook_id")];
    if (!webhook || webhook.clientId !== clientId) return "FAILURE";
    const rawEvent = rawMember(rawBody, "webhook_event") ?? JSON.stringify(parsed.webhook_event ?? null);
    const crc = crc32(Buffer.from(rawEvent, "utf8")) >>> 0;
    const message = `${s("transmission_id")}|${s("transmission_time")}|${s("webhook_id")}|${crc}`;
    if (!this.sim.signing.verifyMessage(message, s("transmission_sig"))) return "FAILURE";
    const delivery = this.sim.state.deliveries[s("transmission_id")];
    if (!delivery || delivery.mock) return "FAILURE";
    const event = this.sim.state.events[delivery.eventId];
    if (!event || !isDeepStrictEqual(JSON.parse(event.body) as Json, parsed.webhook_event)) return "FAILURE";
    return "SUCCESS";
  }
}
