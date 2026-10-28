// W-OP-01's read model (S3.15): pure functions over what /ops reads, so every row is computed from served data and
// tested. The reads the API's ops slice has not shipped yet are named, with the exact shapes this page expects
// (reported as shared changes); until then each says "not served yet" instead of guessing.

import { ApiClientError, ContractError, NetworkError } from "@fairsplit/api-client";
import {
  type LedgerEntry,
  LedgerPayloads,
  PAYOUT_ITEM_STATUS_LABELS,
  PROVENANCE_LABELS,
  type Provenance,
  pickLabel,
  type RunEvent,
  type SystemFlagName,
  type WebhookVerified,
} from "@fairsplit/contracts";
import { z } from "zod";
import type { DataSource, PaypalRail } from "../../lib/env.js";

// ------------------------------------------------------------------------------------------------ reads

/** Routes /ops reads. `/healthz` and `/readyz` exist; the `/v1/ops/*` reads are the ops slice's (pending). */
export const OPS_PATHS = {
  healthz: "/healthz",
  readyz: "/readyz",
  outbox: "/v1/ops/outbox",
  registerKey: "/v1/ops/keys",
} as const;

export const Healthz = z.looseObject({
  status: z.string(),
  service: z.string().optional(),
  version: z.string().optional(),
  rail: z.enum(["simulated", "sandbox"]).optional(),
  uptimeS: z.number().nonnegative().optional(),
  mock: z.boolean().optional(),
});
export type Healthz = z.infer<typeof Healthz>;

const Check = z.looseObject({ ok: z.boolean(), error: z.string().optional() });

export const Readyz = z.looseObject({
  status: z.enum(["ready", "not_ready"]),
  version: z.string().optional(),
  rail: z.enum(["simulated", "sandbox"]).optional(),
  checks: z.looseObject({
    db: Check.extend({ role: z.string().nullable().optional() }).optional(),
    listen: Check.extend({ roundTripMs: z.number().optional() }).optional(),
    dispatcher: Check.extend({ executor: z.string().optional() }).optional(),
    flags: z.looseObject({ forcedByEnv: z.array(z.string()) }).optional(),
    paypal: z
      .looseObject({
        token: z
          .looseObject({ cached: z.boolean(), failures: z.number(), lastError: z.string().nullable() })
          .optional(),
        webhooks: z.string().optional(),
      })
      .optional(),
  }),
});
export type Readyz = z.infer<typeof Readyz>;

/** The outbox read the ops slice owes (`GET /v1/ops/outbox`, operator): IC-04's task rows, newest first. */
export const OutboxRead = z.looseObject({
  rows: z.array(
    z.looseObject({
      id: z.string(),
      task: z.string(),
      state: z.enum(["queued", "dispatched", "running", "done", "dead"]),
      attempts: z.number().int().nonnegative(),
      createdAt: z.string(),
      updatedAt: z.string().optional(),
      lastError: z.string().nullable().optional(),
    }),
  ),
  executor: z.string().optional(),
  lastTickAt: z.string().nullable().optional(),
});
export type OutboxRead = z.infer<typeof OutboxRead>;

/** How a read ended, in words a page can show without guessing. */
export type ReadOutcome<T> =
  | { readonly kind: "ok"; readonly data: T; readonly at: number }
  /** The route isn't there yet: 404, 501, or the mock serves no such route. */
  | { readonly kind: "not-served"; readonly at: number }
  /** The credential can't read it (401, 403): the operator's sign-in. */
  | { readonly kind: "refused"; readonly at: number }
  /** The API answered that it isn't well (5xx), or didn't answer at all. */
  | { readonly kind: "down"; readonly status: number | null; readonly at: number };

export function classifyFailure(error: unknown, source: DataSource, at: number): ReadOutcome<never> {
  if (error instanceof ApiClientError) {
    if (error.notImplemented || error.status === 404) return { kind: "not-served", at };
    if (error.status === 401 || error.status === 403) return { kind: "refused", at };
    return { kind: "down", status: error.status, at };
  }
  if (error instanceof ContractError) {
    // A 2xx that isn't JSON is the SPA's own page answering a path the API doesn't serve.
    if (error.status >= 200 && error.status < 300) return { kind: "not-served", at };
    if (error.status === 404 || error.status === 501) return { kind: "not-served", at };
    if (error.status === 401 || error.status === 403) return { kind: "refused", at };
    return { kind: "down", status: error.status, at };
  }
  if (error instanceof NetworkError) {
    return source === "mock" ? { kind: "not-served", at } : { kind: "down", status: null, at };
  }
  return { kind: "down", status: null, at };
}

// ------------------------------------------------------------------------------------------------ health

export type HealthTone = "ok" | "attention" | "paypal" | "quiet";

export interface HealthRow {
  readonly key: string;
  readonly check: string;
  readonly status: string;
  readonly tone: HealthTone;
  readonly detail: string;
}

function uptimeWords(s: number): string {
  const total = Math.floor(s);
  if (total < 60) return `${total} s`;
  if (total < 3600) return `${Math.floor(total / 60)} min`;
  const h = Math.floor(total / 3600);
  return `${h} h ${Math.floor((total % 3600) / 60)} min`;
}

export function railLabelWords(rail: "simulated" | "sandbox" | undefined): string {
  if (rail === "sandbox") return "PayPal sandbox";
  return "Simulated PayPal sandbox";
}

const NOT_SERVED = "Not served yet";

export function healthRows(
  live: ReadOutcome<Healthz> | undefined,
  ready: ReadOutcome<Readyz> | undefined,
): HealthRow[] {
  const rows: HealthRow[] = [];
  if (!live)
    rows.push({ key: "live", check: "Liveness (/healthz)", status: "Checking", tone: "quiet", detail: "" });
  else if (live.kind === "ok") {
    const h = live.data;
    const ok = h.status === "ok";
    const parts = [
      h.service ?? "fs-api",
      h.version ? `version ${h.version}` : null,
      h.uptimeS !== undefined ? `up ${uptimeWords(h.uptimeS)}` : null,
      railLabelWords(h.rail),
      h.mock ? "mock API" : null,
    ].filter((p): p is string => p !== null);
    rows.push({
      key: "live",
      check: "Liveness (/healthz)",
      status: ok ? "Up" : "Down",
      tone: ok ? "ok" : "attention",
      detail: parts.join(", "),
    });
  } else {
    rows.push({
      key: "live",
      check: "Liveness (/healthz)",
      status:
        live.kind === "not-served" ? NOT_SERVED : live.kind === "refused" ? "Needs the operator" : "Down",
      tone: live.kind === "down" ? "attention" : "quiet",
      detail:
        live.kind === "down"
          ? live.status
            ? `The API answered ${live.status}.`
            : "The API didn't answer."
          : "",
    });
  }

  if (!ready) {
    rows.push({ key: "ready", check: "Readiness (/readyz)", status: "Checking", tone: "quiet", detail: "" });
    return rows;
  }
  if (ready.kind !== "ok") {
    // Readiness nobody reported is unknown, never ready: it counts against the page (opsDegraded).
    rows.push({
      key: "ready",
      check: "Readiness (/readyz)",
      status:
        ready.kind === "not-served"
          ? NOT_SERVED
          : ready.kind === "refused"
            ? "Needs the operator"
            : "Not ready",
      tone: "attention",
      detail:
        ready.kind === "not-served"
          ? "This API serves no readiness report yet, so this page can't call it ready."
          : ready.kind === "down"
            ? ready.status
              ? `The API answered ${ready.status}: it isn't ready.`
              : "The API didn't answer."
            : "Readiness is the operator's read here.",
    });
    return rows;
  }
  const r = ready.data;
  rows.push({
    key: "ready",
    check: "Readiness (/readyz)",
    status: r.status === "ready" ? "Ready" : "Not ready",
    tone: r.status === "ready" ? "ok" : "attention",
    detail: railLabelWords(r.rail),
  });
  const c = r.checks;
  const sub = (
    key: string,
    check: string,
    value: { ok: boolean; error?: string | undefined } | undefined,
    ok: string,
  ) => {
    if (!value) return;
    rows.push({
      key,
      check,
      status: value.ok ? "OK" : "Failing",
      tone: value.ok ? "ok" : "attention",
      detail: value.ok ? ok : (value.error ?? ""),
    });
  };
  sub("db", "Database", c.db, c.db?.role ? `role ${c.db.role}` : "select 1 within 1 s");
  sub(
    "listen",
    "Live updates (LISTEN)",
    c.listen,
    c.listen?.roundTripMs !== undefined ? `round trip ${c.listen.roundTripMs} ms` : "",
  );
  sub(
    "dispatcher",
    "Outbox dispatcher",
    c.dispatcher,
    c.dispatcher?.executor ? `executor ${c.dispatcher.executor}` : "",
  );
  if (c.paypal?.token) {
    const t = c.paypal.token;
    rows.push({
      key: "paypal-token",
      check: "PayPal token",
      status: t.failures > 0 ? "Failing" : t.cached ? "Cached" : "Not fetched yet",
      // A PayPal failure is the one thing that may read red (design §2.2).
      tone: t.failures > 0 ? "paypal" : "ok",
      detail:
        t.lastError ??
        (t.failures > 0 ? `${t.failures} failures` : "We never poll PayPal; this is the cached state."),
    });
  }
  if (c.paypal?.webhooks) {
    rows.push({
      key: "paypal-webhooks",
      check: "Webhook signature checks",
      status: c.paypal.webhooks,
      tone: "quiet",
      detail: "",
    });
  }
  return rows;
}

export type OpsHealthState = "loading" | "ready" | "degraded";

export interface OpsVerdict {
  readonly state: OpsHealthState;
  /** One sentence for the masthead: the page's state, and why when it isn't ready. */
  readonly words: string;
}

/**
 * W-OP-01's state. Ready needs both reads to answer well: liveness up and readiness "ready". Anything else is
 * degraded, a readiness report this API doesn't serve included (unknown is not ready).
 */
export function opsVerdict(
  live: ReadOutcome<Healthz> | undefined,
  ready: ReadOutcome<Readyz> | undefined,
): OpsVerdict {
  if (!live || !ready) return { state: "loading", words: "Checking health." };
  if (live.kind !== "ok") {
    return {
      state: "degraded",
      words:
        live.kind === "not-served"
          ? "Degraded: this API serves no liveness check."
          : live.kind === "refused"
            ? "Degraded: liveness is the operator's read here."
            : "Degraded: the API is down.",
    };
  }
  if (live.data.status !== "ok") return { state: "degraded", words: "Degraded: the API says it's down." };
  if (ready.kind !== "ok") {
    return {
      state: "degraded",
      words:
        ready.kind === "not-served"
          ? "Degraded: readiness isn't reported by this API yet, so nothing here can be called ready."
          : ready.kind === "refused"
            ? "Degraded: readiness is the operator's read here."
            : "Degraded: the API isn't ready.",
    };
  }
  if (ready.data.status !== "ready") {
    const failing = Object.entries(ready.data.checks)
      .filter(([, v]) => typeof v === "object" && v !== null && "ok" in v && v.ok === false)
      .map(([k]) => CHECK_WORDS[k] ?? k);
    return {
      state: "degraded",
      words: `Degraded: not ready${failing.length > 0 ? ` (${failing.join(", ")})` : ""}.`,
    };
  }
  return { state: "ready", words: "Ready: the API is up and every readiness check passes." };
}

const CHECK_WORDS: Readonly<Record<string, string>> = {
  db: "database",
  listen: "live updates",
  dispatcher: "outbox dispatcher",
};

/** /ops is degraded unless liveness is up and readiness answers "ready" (see opsVerdict). */
export function opsDegraded(
  live: ReadOutcome<Healthz> | undefined,
  ready: ReadOutcome<Readyz> | undefined,
): boolean {
  return opsVerdict(live, ready).state === "degraded";
}

// ------------------------------------------------------------------------------------------------ kill switches

export const FLAG_ORDER: readonly SystemFlagName[] = ["kill_payouts", "kill_paypal_live", "kill_ai_live"];

export const FLAG_WORDS: Readonly<
  Record<SystemFlagName, { readonly name: string; readonly effect: string }>
> = {
  kill_payouts: {
    name: "Payouts",
    effect:
      "Signing is refused and runs waiting for keys pause, with their approvals voided. Posted batches keep settling.",
  },
  kill_paypal_live: {
    name: "PayPal calls",
    effect: "PayPal steps replay the last real run, labelled, instead of calling PayPal.",
  },
  kill_ai_live: {
    name: "Live slip reading",
    effect: "Claude reads nothing live; the recorded run still plays.",
  },
};

export interface FlagRow {
  readonly flag: SystemFlagName;
  readonly on: boolean;
  readonly forcedByEnv: boolean;
  /** Who set it and when, as the run's `flag.changed` events or the API reported it. */
  readonly by: string | null;
  readonly at: string | null;
  /** Where the state comes from: the run's own events, the readiness report, or nothing recorded (off). */
  readonly source: "event" | "env" | "default";
}

const FORCED_NAMES: Readonly<Record<string, SystemFlagName>> = {
  payouts: "kill_payouts",
  paypal_live: "kill_paypal_live",
  ai_live: "kill_ai_live",
  kill_payouts: "kill_payouts",
  kill_paypal_live: "kill_paypal_live",
  kill_ai_live: "kill_ai_live",
};

/** The three switches: forced by env wins, then the newest `flag.changed` event, then the stored default (off). */
export function flagRows(events: readonly RunEvent[], forcedByEnv: readonly string[]): FlagRow[] {
  const forced = new Set(
    forcedByEnv.map((f) => FORCED_NAMES[f]).filter((f): f is SystemFlagName => f !== undefined),
  );
  const latest = new Map<SystemFlagName, { on: boolean; by: string; at: string }>();
  for (const e of events) {
    if (e.type !== "flag.changed") continue;
    latest.set(e.payload.flag, { on: e.payload.on, by: e.payload.by, at: e.at });
  }
  return FLAG_ORDER.map((flag) => {
    const event = latest.get(flag);
    if (forced.has(flag)) {
      return { flag, on: true, forcedByEnv: true, by: "FS_KILL", at: event?.at ?? null, source: "env" };
    }
    if (event) return { flag, on: event.on, forcedByEnv: false, by: event.by, at: event.at, source: "event" };
    return { flag, on: false, forcedByEnv: false, by: null, at: null, source: "default" };
  });
}

// ------------------------------------------------------------------------------------------------ PayPal's notices

export interface NoticeRow {
  readonly id: string;
  readonly at: string;
  /** The PayPal event name, or what moved ("Payout item"). */
  readonly notice: string;
  readonly object: string;
  readonly status: string;
  /** How we know: the signature check, a status check, our own cancel. */
  readonly check: string;
  readonly provenance: string;
  readonly duplicate: boolean;
  readonly paypalEventId: string | null;
}

export function verifiedWords(verified: WebhookVerified, rail: PaypalRail): string {
  switch (verified) {
    case "self":
      return rail === "simulator" ? "Signature checked (simulator's CA)" : "Signature verified";
    case "postback":
      return rail === "simulator" ? "Postback checked (simulated)" : "Verified by PayPal's postback";
    case "fetched":
      return "Confirmed by a fresh GET";
    case "dev_mock":
      return "Development mock, never applied in production";
  }
}

const SOURCE_WORDS: Readonly<
  Record<"webhook" | "status_check" | "post_response" | "cancel", (rail: PaypalRail) => string>
> = {
  webhook: (rail) =>
    rail === "simulator" ? "Webhook, signature checked (simulator)" : "Webhook, signature verified",
  status_check: () => "Status check",
  post_response: () => "PayPal's answer to the batch",
  cancel: () => "Our cancel",
};

function provenanceOf(p: Provenance): string {
  return pickLabel(PROVENANCE_LABELS[p], "en");
}

/** A live run's PayPal-side events, newest first (the run stream carries them as one forward-only log). */
export function noticesFromEvents(events: readonly RunEvent[], rail: PaypalRail): NoticeRow[] {
  const rows: NoticeRow[] = [];
  for (const e of events) {
    if (e.type === "item.updated") {
      const p = e.payload;
      rows.push({
        id: e.id,
        at: e.at,
        notice: "Payout item",
        object: p.senderItemId,
        status: pickLabel(PAYOUT_ITEM_STATUS_LABELS[p.to], "en"),
        check: SOURCE_WORDS[p.source](rail),
        provenance: provenanceOf(e.provenance),
        duplicate: false,
        paypalEventId: p.eventId,
      });
    } else if (e.type === "webhook.received") {
      const p = e.payload;
      rows.push({
        id: e.id,
        at: e.at,
        notice: p.eventType,
        object: p.paypalEventId,
        status: p.duplicate ? "Delivery repeated, already applied" : "Received",
        check: verifiedWords(p.verified, rail),
        provenance: provenanceOf(e.provenance),
        duplicate: p.duplicate,
        paypalEventId: p.paypalEventId,
      });
    } else if (e.type === "invoice.state") {
      const p = e.payload;
      rows.push({
        id: e.id,
        at: e.at,
        notice: "Invoice",
        object: p.invoiceNumber,
        status: p.to,
        check: "Fresh GET of the invoice",
        provenance: provenanceOf(e.provenance),
        duplicate: false,
        paypalEventId: null,
      });
    }
  }
  return rows.reverse();
}

/** The season's run: the verified notices its hash chain records (`webhook.applied`), newest first. */
export function noticesFromLedger(ledger: readonly LedgerEntry[], rail: PaypalRail): NoticeRow[] {
  const rows: NoticeRow[] = [];
  for (const e of ledger) {
    if (e.kind !== "webhook.applied") continue;
    const parsed = LedgerPayloads["webhook.applied"].safeParse(e.payload);
    if (!parsed.success) continue;
    const p = parsed.data;
    const object =
      p.resource === "payout_item"
        ? p.senderItemId
        : p.resource === "invoice"
          ? p.invoiceNumber
          : p.senderBatchId;
    const status =
      p.resource === "payout_item"
        ? pickLabel(PAYOUT_ITEM_STATUS_LABELS[p.status], "en")
        : p.resource === "invoice"
          ? p.status
          : p.batchStatus;
    rows.push({
      id: `ledger-${e.seq}`,
      at: e.at,
      notice: p.eventType,
      object,
      status,
      check: verifiedWords(p.verified, rail),
      provenance: provenanceOf(p.provenance),
      duplicate: false,
      paypalEventId: p.eventId,
    });
  }
  return rows.reverse();
}

// ------------------------------------------------------------------------------------------------ the outbox

export interface OutboxSummary {
  readonly queued: number;
  readonly running: number;
  readonly dead: number;
  readonly done: number;
}

export function outboxSummary(rows: OutboxRead["rows"]): OutboxSummary {
  const s = { queued: 0, running: 0, dead: 0, done: 0 };
  for (const r of rows) {
    if (r.state === "queued" || r.state === "dispatched") s.queued++;
    else if (r.state === "running") s.running++;
    else if (r.state === "dead") s.dead++;
    else s.done++;
  }
  return s;
}
