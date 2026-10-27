// /ops (W-OP-01, S3.15 "plain tables"): what is running and how healthy it is, read fresh from the database.
// Never a secret, a token, a raw webhook body or a receiver. The operator sees every workspace; a judge (or an
// officer) sees their own workspace only, and no other tenant's rows, errors or webhooks.
//
//   rail and ledger key · kill switches (env-forced and per workspace) · the PayPal limiter (40/20 a minute, the
//   429 circuit) · outbox by state, its oldest wait, dead rows and the last cron task · webhooks by status, with
//   duplicates and the latest deliveries · SSE load · ledger heads (the workspace view re-verifies its chain) ·
//   Claude spend today · the latest reconciliation per kind · runs by state.
import {
  PayoutItemStatus,
  PayRunState,
  SystemFlagName,
  TaskState,
  WebhookStatus,
  WebhookVerified,
} from "@fairsplit/contracts";
import { createLimiter, envKills, readFlags, schema } from "@fairsplit/db";
import { and, desc, eq, gte, isNull, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { killEnv } from "../env.js";
import { checkLedger, readWorkspaceLedger } from "../ledger/chain.js";
import { describeLedgerKey, ledgerKeyOf } from "../ledger/keys.js";
import type { AppDeps } from "../lib/context.js";
import type { OpsView } from "./access.js";

const Iso = z.iso.datetime();
const Count = z.int().nonnegative();

export const OpsOverview = z.strictObject({
  view: z.enum(["operator", "workspace"]),
  workspaceId: z.uuid().nullable(),
  at: Iso,
  rail: z.strictObject({
    mode: z.enum(["simulator", "sandbox"]),
    label: z.enum(["simulated", "sandbox"]),
    provenance: z.enum(["simulated_rail", "live"]),
    transport: z.string(),
    credentials: z.enum(["configured", "placeholder"]),
    webhookId: z.enum(["configured", "missing"]),
  }),
  ledgerKey: z.strictObject({
    keyId: z.string(),
    kind: z.enum(["server", "seeded"]),
    publicKeyHex: z.string(),
    source: z.enum(["configured", "derived_sample", "ephemeral_sample"]),
    proofReads: z.enum(["Verified", "Sample"]),
  }),
  flags: z.strictObject({
    forcedByEnv: z.array(SystemFlagName),
    workspace: z
      .array(
        z.strictObject({
          flag: SystemFlagName,
          on: z.boolean(),
          source: z.enum(["env", "workspace", "default"]),
          setBy: z.string().nullable(),
          setAt: Iso.nullable(),
        }),
      )
      .nullable(),
    /** Operator view: how many workspaces have each flag on. */
    workspacesOn: z.record(z.string(), Count).nullable(),
  }),
  limiter: z.strictObject({
    inWindow: Count,
    backgroundInWindow: Count,
    perWindow: Count,
    backgroundPerWindow: Count,
    circuitOpen: z.boolean(),
    circuitOpenUntil: Iso.nullable(),
    rateLimitedLastHour: Count,
  }),
  outbox: z.strictObject({
    byState: z.partialRecord(TaskState, Count),
    oldestQueuedMs: z.int().nonnegative().nullable(),
    dead: z.array(
      z.strictObject({
        id: z.uuid(),
        name: z.string(),
        attempts: Count,
        /** Operator view only: the runner's last error (never a secret). */
        lastError: z.string().nullable(),
        updatedAt: Iso,
      }),
    ),
    lastCronTask: z.strictObject({ name: z.string(), at: Iso }).nullable(),
  }),
  webhooks: z.strictObject({
    byStatus: z.partialRecord(WebhookStatus, Count),
    duplicates: Count,
    recent: z.array(
      z.strictObject({
        paypalEventId: z.string(),
        eventType: z.string(),
        verified: WebhookVerified.nullable(),
        status: WebhookStatus,
        receivedAt: Iso,
        provenance: z.string(),
      }),
    ),
  }),
  items: z.partialRecord(PayoutItemStatus, Count),
  sse: z.strictObject({ open: Count, byLabel: z.record(z.string(), Count) }),
  ledger: z.array(
    z.strictObject({
      workspaceId: z.uuid(),
      kind: z.string(),
      seq: Count,
      entryHash: z.string(),
      /** Re-verified now (workspace view); null when not checked (operator view lists heads only). */
      verified: z.boolean().nullable(),
      brokenAtSeq: z.int().nullable(),
    }),
  ),
  claude: z.strictObject({ todayMicros: Count, calls: Count, byBudget: z.record(z.string(), Count) }),
  reconciliation: z.array(
    z.strictObject({
      kind: z.string(),
      at: Iso,
      lagging: z.boolean(),
      summary: z.record(z.string(), z.unknown()),
    }),
  ),
  runs: z.partialRecord(PayRunState, Count),
});
export type OpsOverview = z.infer<typeof OpsOverview>;

const CRON_TASKS = ["judgeReset", "reconcile", "warmCaches"];
const RECENT = 25;

function scoped<T extends { workspaceId: unknown }>(table: T, view: OpsView): SQL | undefined {
  return view.kind === "workspace" ? eq(table.workspaceId as never, view.workspaceId) : undefined;
}

function counts(rows: readonly { key: string | null; n: number | string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) if (r.key !== null) out[r.key] = Number(r.n);
  return out;
}

export async function opsOverview(
  deps: Pick<AppDeps, "db" | "env" | "clock" | "sse" | "paypal" | "credentials">,
  view: OpsView,
): Promise<OpsOverview> {
  const db = deps.db;
  const now = deps.clock.now();
  const ws = view.kind === "workspace" ? view.workspaceId : null;
  const rail = deps.paypal.describe();

  // flags
  const forced = [...envKills(killEnv(deps.env))].sort();
  let workspaceFlags: OpsOverview["flags"]["workspace"] = null;
  let workspacesOn: OpsOverview["flags"]["workspacesOn"] = null;
  if (ws) {
    const state = await readFlags(db, ws, killEnv(deps.env));
    workspaceFlags = (Object.keys(state) as (keyof typeof state)[]).map((flag) => ({
      flag,
      on: state[flag].on,
      source: state[flag].source,
      setBy: state[flag].setBy,
      setAt: state[flag].setAt ? state[flag].setAt.toISOString() : null,
    }));
  } else {
    const rows = await db
      .select({ key: schema.systemFlags.flag, n: sql<number>`count(*)` })
      .from(schema.systemFlags)
      .where(eq(schema.systemFlags.on, true))
      .groupBy(schema.systemFlags.flag);
    workspacesOn = counts(rows);
  }

  // limiter (shared across services; the 429 count is system-wide either way)
  const limiter = await createLimiter(db).state();
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const [r429] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.paypalCalls)
    .where(and(eq(schema.paypalCalls.status, 429), gte(schema.paypalCalls.at, hourAgo)));

  // outbox
  const ot = schema.taskOutbox;
  const byState = await db
    .select({ key: ot.state, n: sql<number>`count(*)` })
    .from(ot)
    .where(scoped(ot, view))
    .groupBy(ot.state);
  const [oldest] = await db
    .select({ at: sql<Date | null>`min(${ot.createdAt})` })
    .from(ot)
    .where(and(eq(ot.state, "queued"), scoped(ot, view)));
  const dead = await db
    .select({
      id: ot.id,
      name: ot.name,
      attempts: ot.attempts,
      lastError: ot.lastError,
      updatedAt: ot.updatedAt,
    })
    .from(ot)
    .where(and(eq(ot.state, "dead"), scoped(ot, view)))
    .orderBy(desc(ot.updatedAt))
    .limit(10);
  const [cron] = await db
    .select({ name: ot.name, at: ot.createdAt })
    .from(ot)
    .where(
      sql`${ot.name} in (${sql.join(
        CRON_TASKS.map((n) => sql`${n}`),
        sql`, `,
      )})`,
    )
    .orderBy(desc(ot.createdAt))
    .limit(1);

  // webhooks
  const we = schema.webhookEvents;
  const whScope = ws ? eq(we.workspaceId, ws) : undefined;
  const whByStatus = await db
    .select({ key: we.status, n: sql<number>`count(*)` })
    .from(we)
    .where(whScope)
    .groupBy(we.status);
  const recent = await db
    .select({
      paypalEventId: we.paypalEventId,
      eventType: we.eventType,
      verified: we.verified,
      status: we.status,
      receivedAt: we.receivedAt,
      provenance: we.provenance,
    })
    .from(we)
    .where(whScope)
    .orderBy(desc(we.receivedAt))
    .limit(RECENT);
  const re = schema.runEvents;
  const [dups] = await db
    .select({ n: sql<number>`count(*)` })
    .from(re)
    .where(and(eq(re.type, "webhook.received"), sql`${re.payload}->>'duplicate' = 'true'`, scoped(re, view)));

  const pi = schema.payoutItems;
  const items = await db
    .select({ key: pi.status, n: sql<number>`count(*)` })
    .from(pi)
    .where(scoped(pi, view))
    .groupBy(pi.status);

  // ledger heads
  let ledger: OpsOverview["ledger"];
  if (ws) {
    const entries = await readWorkspaceLedger(db, ws);
    const check = checkLedger(entries);
    const [w] = await db
      .select({ kind: schema.workspaces.kind })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ws));
    ledger = [
      {
        workspaceId: ws,
        kind: w?.kind ?? "unknown",
        seq: check.head?.seq ?? 0,
        entryHash: check.head?.entryHash ?? "0".repeat(64),
        verified: check.ok,
        brokenAtSeq: check.brokenAtSeq,
      },
    ];
  } else {
    const heads = await db
      .select({
        workspaceId: schema.ledgerHeads.workspaceId,
        seq: schema.ledgerHeads.seq,
        entryHash: schema.ledgerHeads.entryHash,
        kind: schema.workspaces.kind,
      })
      .from(schema.ledgerHeads)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.ledgerHeads.workspaceId))
      .orderBy(desc(schema.ledgerHeads.updatedAt))
      .limit(50);
    ledger = heads.map((h) => ({
      workspaceId: h.workspaceId,
      kind: h.kind,
      seq: Number(h.seq),
      entryHash: h.entryHash,
      verified: null,
      brokenAtSeq: null,
    }));
  }

  // Claude spend today (UTC day)
  const day = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const lc = schema.llmCalls;
  const spend = await db
    .select({
      key: lc.budgetKey,
      micros: sql<string>`coalesce(sum(${lc.costMicros}), 0)`,
      n: sql<number>`count(*)`,
    })
    .from(lc)
    .where(and(gte(lc.createdAt, day), scoped(lc, view)))
    .groupBy(lc.budgetKey);

  // reconciliation, latest per kind
  const rr = schema.reconciliationReports;
  const reports = await db
    .select({ kind: rr.kind, at: rr.createdAt, lagging: rr.lagging, summary: rr.summary })
    .from(rr)
    .where(ws ? eq(rr.workspaceId, ws) : isNull(rr.workspaceId))
    .orderBy(desc(rr.createdAt))
    .limit(50);
  const latest = new Map<string, (typeof reports)[number]>();
  for (const r of reports) if (!latest.has(r.kind)) latest.set(r.kind, r);

  const pr = schema.payRuns;
  const runs = await db
    .select({ key: pr.state, n: sql<number>`count(*)` })
    .from(pr)
    .where(scoped(pr, view))
    .groupBy(pr.state);

  const sse = deps.sse.stats();
  const transport = rail.simulator ? rail.simulator.kind : "sandbox";
  return {
    view: view.kind,
    workspaceId: ws,
    at: now.toISOString(),
    rail: {
      mode: rail.mode,
      label: rail.label,
      provenance: rail.provenance,
      transport,
      credentials: rail.credentials,
      webhookId: rail.webhookId,
    },
    ledgerKey: describeLedgerKey(ledgerKeyOf(deps)),
    flags: { forcedByEnv: forced, workspace: workspaceFlags, workspacesOn },
    limiter: {
      inWindow: limiter.inWindow,
      backgroundInWindow: limiter.backgroundInWindow,
      perWindow: limiter.limits.perWindow,
      backgroundPerWindow: limiter.limits.backgroundPerWindow,
      circuitOpen: limiter.circuitOpenUntil !== null && limiter.circuitOpenUntil.getTime() > now.getTime(),
      circuitOpenUntil: limiter.circuitOpenUntil ? limiter.circuitOpenUntil.toISOString() : null,
      rateLimitedLastHour: Number(r429?.n ?? 0),
    },
    outbox: {
      byState: counts(byState),
      oldestQueuedMs: oldest?.at ? Math.max(0, now.getTime() - new Date(oldest.at).getTime()) : null,
      dead: dead.map((d) => ({
        id: d.id,
        name: d.name,
        attempts: d.attempts,
        lastError: view.kind === "operator" ? (d.lastError ?? null) : null,
        updatedAt: d.updatedAt.toISOString(),
      })),
      lastCronTask: cron ? { name: cron.name, at: cron.at.toISOString() } : null,
    },
    webhooks: {
      byStatus: counts(whByStatus),
      duplicates: Number(dups?.n ?? 0),
      recent: recent.map((e) => ({
        paypalEventId: e.paypalEventId,
        eventType: e.eventType,
        verified: (e.verified as z.infer<typeof WebhookVerified> | null) ?? null,
        status: e.status as z.infer<typeof WebhookStatus>,
        receivedAt: e.receivedAt.toISOString(),
        provenance: e.provenance,
      })),
    },
    items: counts(items),
    sse: { open: sse.open, byLabel: sse.byLabel },
    ledger,
    claude: {
      todayMicros: spend.reduce((s, r) => s + Number(r.micros), 0),
      calls: spend.reduce((s, r) => s + Number(r.n), 0),
      byBudget: Object.fromEntries(spend.map((r) => [r.key, Number(r.micros)])),
    },
    reconciliation: [...latest.values()].map((r) => ({
      kind: r.kind,
      at: r.at.toISOString(),
      lagging: r.lagging,
      summary: (r.summary ?? {}) as Record<string, unknown>,
    })),
    runs: counts(runs),
  };
}
