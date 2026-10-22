// Webhook registration and event catch-up helpers (architecture §6.4, S3.6.5), shared by
// tools/setup-webhooks.ts, the hourly drift check in judgeReset and `/readyz`.
//
// Registration is idempotent:
//   1. GET /v1/notifications/webhooks.
//   2. A webhook with the same URL: unchanged, or PATCH replace /event_types when the set differs.
//   3. Else a webhook of ours on an old URL (same path, e.g. a previous Cloudflare tunnel): PATCH
//      replace /url and /event_types, which keeps its id, so PP_WEBHOOK_ID survives tunnel restarts.
//   4. Else POST a new webhook.
// PATCH supports only `replace` on `/url` and `/event_types` (webhooks.update in the v1 OpenAPI spec).
// Other webhooks on the app are never touched; extra copies of ours are reported, not deleted.

import { z } from "zod";
import { expectOk, type PayPalHttp } from "../http.js";
import type { CallPriority } from "../types.js";
import { WEBHOOK_EVENT_TYPES } from "../webhook/event.js";

const WebhookSchema = z
  .object({
    id: z.string().min(1),
    url: z.string(),
    event_types: z.array(z.object({ name: z.string() }).passthrough()).default([]),
  })
  .passthrough();

const WebhookListSchema = z.object({ webhooks: z.array(WebhookSchema).default([]) }).passthrough();
const LookupListSchema = z
  .object({ webhooks_lookups: z.array(z.object({ id: z.string() }).passthrough()).default([]) })
  .passthrough();
const LookupSchema = z.object({ id: z.string() }).passthrough();

export interface RegisteredWebhook {
  id: string;
  url: string;
  eventTypes: string[];
}

export type EnsureWebhookAction = "unchanged" | "updated_event_types" | "updated_url" | "created";

export interface EnsureWebhookResult {
  action: EnsureWebhookAction;
  dryRun: boolean;
  /** Null only for a dry-run create. */
  webhookId: string | null;
  url: string;
  eventTypes: readonly string[];
  previousUrl: string | null;
  /** Other webhooks of ours (same path, other URL) left in place. */
  staleWebhookIds: readonly string[];
}

export interface EnsureWebhookOptions {
  url: string;
  eventTypes?: readonly string[];
  dryRun?: boolean;
  priority?: CallPriority;
}

function normalizeUrl(value: string): string {
  try {
    return new URL(value).href;
  } catch {
    return value;
  }
}

function sameEventSet(a: readonly string[], b: readonly string[]): boolean {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((name, i) => name === right[i]);
}

function toRecord(w: z.infer<typeof WebhookSchema>): RegisteredWebhook {
  return { id: w.id, url: w.url, eventTypes: w.event_types.map((e) => e.name) };
}

export async function listWebhooks(
  http: PayPalHttp,
  priority: CallPriority = "background",
): Promise<RegisteredWebhook[]> {
  const body = expectOk(
    await http.request({
      method: "GET",
      path: "/v1/notifications/webhooks",
      query: { anchor_type: "APPLICATION" },
      purpose: "webhooks.list",
      priority,
    }),
  );
  return WebhookListSchema.parse(body).webhooks.map(toRecord);
}

export async function ensureWebhook(
  http: PayPalHttp,
  options: EnsureWebhookOptions,
  convergeAttempt = 0,
): Promise<EnsureWebhookResult> {
  const url = normalizeUrl(options.url);
  const eventTypes = [...(options.eventTypes ?? WEBHOOK_EVENT_TYPES)];
  const dryRun = options.dryRun === true;
  const priority = options.priority ?? "background";
  const eventBody = eventTypes.map((name) => ({ name }));
  const targetPath = new URL(url).pathname;

  const existing = await listWebhooks(http, priority);
  const exact = existing.find((w) => normalizeUrl(w.url) === url);
  const ours = existing.filter((w) => w !== exact && safePath(w.url) === targetPath);
  const base = { dryRun, url, eventTypes, previousUrl: null as string | null };

  if (exact) {
    const stale = ours.map((w) => w.id);
    if (sameEventSet(exact.eventTypes, eventTypes)) {
      return { ...base, action: "unchanged", webhookId: exact.id, staleWebhookIds: stale };
    }
    if (!dryRun) {
      expectOk(
        await http.request({
          method: "PATCH",
          path: `/v1/notifications/webhooks/${encodeURIComponent(exact.id)}`,
          body: [{ op: "replace", path: "/event_types", value: eventBody }],
          purpose: "webhooks.update",
          priority,
          idempotent: true,
        }),
      );
    }
    return { ...base, action: "updated_event_types", webhookId: exact.id, staleWebhookIds: stale };
  }

  const [reuse, ...others] = ours;
  if (reuse) {
    if (!dryRun) {
      expectOk(
        await http.request({
          method: "PATCH",
          path: `/v1/notifications/webhooks/${encodeURIComponent(reuse.id)}`,
          body: [
            { op: "replace", path: "/url", value: url },
            { op: "replace", path: "/event_types", value: eventBody },
          ],
          purpose: "webhooks.update",
          priority,
          idempotent: true,
        }),
      );
    }
    return {
      ...base,
      action: "updated_url",
      webhookId: reuse.id,
      previousUrl: reuse.url,
      staleWebhookIds: others.map((w) => w.id),
    };
  }

  if (dryRun) return { ...base, action: "created", webhookId: null, staleWebhookIds: [] };
  const created = await http.request({
    method: "POST",
    path: "/v1/notifications/webhooks",
    body: { url, event_types: eventBody },
    purpose: "webhooks.create",
    priority,
  });
  if (!created.ok && created.name === "WEBHOOK_URL_ALREADY_EXISTS" && convergeAttempt === 0) {
    // Another run registered it between our list and create: converge on the existing one, once.
    return ensureWebhook(http, options, 1);
  }
  const webhook = WebhookSchema.parse(expectOk(created));
  return { ...base, action: "created", webhookId: webhook.id, staleWebhookIds: [] };
}

function safePath(value: string): string | null {
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

export interface EnsureLookupResult {
  action: "exists" | "created";
  dryRun: boolean;
  lookupId: string | null;
}

/** Make sure the app has a webhooks-lookup (S3.6.5 step 3). Lists first, so re-runs are no-ops. */
export async function ensureWebhookLookup(
  http: PayPalHttp,
  options: { dryRun?: boolean; priority?: CallPriority } = {},
): Promise<EnsureLookupResult> {
  const priority = options.priority ?? "background";
  const dryRun = options.dryRun === true;
  const list = LookupListSchema.parse(
    expectOk(
      await http.request({
        method: "GET",
        path: "/v1/notifications/webhooks-lookup",
        purpose: "webhooks.lookup.list",
        priority,
      }),
    ),
  );
  const first = list.webhooks_lookups[0];
  if (first) return { action: "exists", dryRun, lookupId: first.id };
  if (dryRun) return { action: "created", dryRun, lookupId: null };
  const created = LookupSchema.parse(
    expectOk(
      await http.request({
        method: "POST",
        path: "/v1/notifications/webhooks-lookup",
        purpose: "webhooks.lookup.create",
        priority,
      }),
    ),
  );
  return { action: "created", dryRun, lookupId: created.id };
}

export interface RegistrationCheck {
  ok: boolean;
  webhookId: string | null;
  problems: string[];
}

/** Read-only drift check for `/readyz` and the hourly health pass (one API call). Never throws. */
export async function checkWebhookRegistration(
  http: PayPalHttp,
  expected: { url: string; webhookId?: string | null; eventTypes?: readonly string[] },
): Promise<RegistrationCheck> {
  let hooks: RegisteredWebhook[];
  try {
    hooks = await listWebhooks(http, "background");
  } catch (err) {
    return {
      ok: false,
      webhookId: null,
      problems: [`list failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  const url = normalizeUrl(expected.url);
  const hook = hooks.find((w) => normalizeUrl(w.url) === url);
  if (!hook) return { ok: false, webhookId: null, problems: ["no webhook registered for this URL"] };
  const problems: string[] = [];
  if (expected.webhookId && hook.id !== expected.webhookId)
    problems.push("registered id differs from PP_WEBHOOK_ID");
  if (!sameEventSet(hook.eventTypes, [...(expected.eventTypes ?? WEBHOOK_EVENT_TYPES)])) {
    problems.push("event types differ from the register's 15");
  }
  return { ok: problems.length === 0, webhookId: hook.id, problems };
}

const EventListSchema = z
  .object({
    events: z.array(z.object({ id: z.string(), event_type: z.string() }).passthrough()).default([]),
    links: z.array(z.object({ href: z.string(), rel: z.string() }).passthrough()).default([]),
  })
  .passthrough();

export type ListedWebhookEvent = z.infer<typeof EventListSchema>["events"][number];

export interface ListWebhookEventsOptions {
  /** Inclusive bounds (PayPal: "created on or after start_time and on or before end_time"). */
  startTime: Date;
  endTime: Date;
  pageSize?: number;
  maxPages?: number;
  priority?: CallPriority;
  /** Continue from a `next` link returned by an earlier listing instead of starting the window over. */
  from?: string | null;
}

export interface ListWebhookEventsResult {
  /** In PayPal's order (newest first, judging by its keyset `index_time` cursor; not documented). */
  events: ListedWebhookEvent[];
  /** More pages remained after `maxPages`. */
  truncated: boolean;
  /** PayPal's `next` link where the listing stopped; null when it reached the end. */
  next: string | null;
}

/**
 * Catch-up after downtime (S3.6.5): GET /v1/notifications/webhooks-events?start_time=&end_time=,
 * following `next` links. Bounded by `maxPages` so a catch-up pass has a known call cost.
 */
export async function listWebhookEvents(
  http: PayPalHttp,
  options: ListWebhookEventsOptions,
): Promise<ListWebhookEventsResult> {
  const maxPages = options.maxPages ?? 5;
  const events: ListedWebhookEvent[] = [];
  let path: string | null = options.from ?? "/v1/notifications/webhooks-events";
  let query: Record<string, string | number> | undefined = options.from
    ? undefined
    : {
        page_size: options.pageSize ?? 50,
        start_time: options.startTime.toISOString(),
        end_time: options.endTime.toISOString(),
      };
  for (let page = 0; page < maxPages && path !== null; page++) {
    const body = EventListSchema.parse(
      expectOk(
        await http.request({
          method: "GET",
          path,
          ...(query ? { query } : {}),
          purpose: "webhooks.events.list",
          priority: options.priority ?? "background",
        }),
      ),
    );
    events.push(...body.events);
    path = body.links.find((l) => l.rel === "next")?.href ?? null;
    query = undefined;
  }
  return { events, truncated: path !== null, next: path };
}

/** The duplicate beat: POST /v1/notifications/webhooks-events/{id}/resend (once per live run). */
export async function resendWebhookEvent(
  http: PayPalHttp,
  eventId: string,
  webhookIds: readonly string[],
  priority: CallPriority = "live",
) {
  return http.request<unknown>({
    method: "POST",
    path: `/v1/notifications/webhooks-events/${encodeURIComponent(eventId)}/resend`,
    body: { webhook_ids: webhookIds },
    purpose: "webhooks.events.resend",
    priority,
  });
}
