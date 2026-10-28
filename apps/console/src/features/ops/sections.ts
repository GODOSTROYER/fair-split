// S3.15's /ops sections beyond health, the switches, the notices and the outbox: scopes, the limiter against 40 and
// 20 with the circuit and shared-IP 429s, webhook latency, Claude spend, the eval report, the last reconciliation,
// estimated against observed balance, and quotas; plus who is reading (the operator, or a judge read-only) and the
// treasurer key's registration. The API's ops slice owes each read below (reported as shared changes, routes and
// shapes exact); until one answers, its section says "Not served yet" and names the route. Pure functions: every
// row is words computed from served data, so each is tested.

import { EvalReport, type PublishedKeys } from "@fairsplit/contracts";
import { z } from "zod";
import { format } from "../../lib/format.js";
import { davaoIsoDate, davaoShort } from "../proof/davao.js";
import type { HealthTone } from "./opsModel.js";

/** The reads /ops asks the API's ops slice for (all GET; operator-scoped unless marked public). */
export const SECTION_PATHS = {
  /** Who is reading: 200 for the operator cookie `fs_ops` from /ops/login, 401 for everyone else. */
  session: "/v1/ops/session",
  /** Public: the officer keys Fair Split publishes (Proof's trust anchors), where fs-analyn-w1 shows once registered. */
  keys: "/.well-known/fairsplit-keys.json",
  scopes: "/v1/ops/scopes",
  limiter: "/v1/ops/limiter",
  latency: "/v1/ops/latency",
  claude: "/v1/ops/claude",
  eval: "/v1/ops/eval",
  reconciliation: "/v1/ops/reconciliation",
  balance: "/v1/ops/balance",
  quotas: "/v1/ops/quotas",
} as const;

export type SectionRead = Exclude<keyof typeof SECTION_PATHS, "session" | "keys">;

/** One row of a section's table: what, its value in words, a tone, and why. */
export interface OpsRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly tone: HealthTone;
  readonly detail: string;
  /** Money rows only (S2.2.1): a machine's estimate prints in pencil, a person's record in ink. */
  readonly amountState?: "pencil" | "ink";
}

const Iso = z.string().min(1);

function at(instant: string | null | undefined): string {
  return instant ? `${davaoShort(instant)}, Davao time` : "";
}

/** A fraction 0–1 as "92.5%" (the formatter takes integers only). */
function rate(fraction: number): string {
  return format.percent(Math.round(Math.max(0, fraction) * 1000), 1000, 1);
}

/** "420 ms" under a second, else "3 min 12 s" (format.elapsedWords). */
export function latencyWords(ms: number): string {
  const whole = Math.round(ms);
  return whole < 1000 ? `${whole} ms` : format.elapsedWords(whole);
}

// ------------------------------------------------------------------------------------------------ who is reading

export const OpsSession = z.looseObject({ role: z.string(), expiresAt: Iso.optional() });
export type OpsSession = z.infer<typeof OpsSession>;

// ------------------------------------------------------------------------------------------------ scopes

export const ScopesRead = z.looseObject({
  granted: z.array(z.string()),
  required: z.array(z.string()),
  checkedAt: Iso.nullable().optional(),
});
export type ScopesRead = z.infer<typeof ScopesRead>;

const SCOPE_PREFIX = "https://uri.paypal.com/services/";

/** "https://uri.paypal.com/services/payments/payouts" → "payments/payouts". */
export function scopeName(scope: string): string {
  return scope.startsWith(SCOPE_PREFIX) ? scope.slice(SCOPE_PREFIX.length) : scope;
}

export function scopeRows(read: ScopesRead): OpsRow[] {
  const granted = new Set(read.granted);
  const rows: OpsRow[] = read.required.map((scope) => ({
    key: scope,
    label: scopeName(scope),
    value: granted.has(scope) ? "Granted" : "Missing",
    tone: granted.has(scope) ? "ok" : "attention",
    detail: granted.has(scope) ? "" : "A step that needs it fails until the app is granted it.",
  }));
  for (const scope of read.granted) {
    if (read.required.includes(scope)) continue;
    rows.push({ key: scope, label: scopeName(scope), value: "Granted", tone: "quiet", detail: "Not needed" });
  }
  return rows;
}

// ------------------------------------------------------------------------------------------------ limiter

export const LimiterRead = z.looseObject({
  windowS: z.number().int().positive(),
  calls: z.number().int().nonnegative(),
  backgroundCalls: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  backgroundLimit: z.number().int().positive(),
  circuit: z.looseObject({
    open: z.boolean(),
    until: Iso.nullable().optional(),
    lastRateLimitAt: Iso.nullable().optional(),
  }),
  sharedIp429s: z.looseObject({
    count: z.number().int().nonnegative(),
    lastAt: Iso.nullable().optional(),
    lastDebugId: z.string().nullable().optional(),
  }),
});
export type LimiterRead = z.infer<typeof LimiterRead>;

export function limiterRows(read: LimiterRead): OpsRow[] {
  const window = `last ${read.windowS} s`;
  const shared = read.sharedIp429s;
  return [
    {
      key: "calls",
      label: `PayPal calls, ${window}`,
      value: `${read.calls} of ${read.limit}`,
      tone: read.calls >= read.limit ? "attention" : "ok",
      detail:
        read.calls >= read.limit
          ? "At the cap: the next step waits its turn."
          : "Every service shares this window; PayPal blocks an IP above 50 a minute.",
    },
    {
      key: "background",
      label: `Background calls, ${window}`,
      value: `${read.backgroundCalls} of ${read.backgroundLimit}`,
      tone: read.backgroundCalls >= read.backgroundLimit ? "attention" : "ok",
      detail: "Sweeps, settles and resets; live presses keep the rest.",
    },
    read.circuit.open
      ? {
          key: "circuit",
          label: "Circuit",
          value: read.circuit.until ? `Open until ${format.time(read.circuit.until)}` : "Open",
          // A 429 from PayPal opened it: the one failure that reads red here.
          tone: "paypal",
          detail: `PayPal answered 429${read.circuit.lastRateLimitAt ? ` at ${at(read.circuit.lastRateLimitAt)}` : ""}. PayPal steps play as a labelled replay until it closes.`,
        }
      : {
          key: "circuit",
          label: "Circuit",
          value: "Closed",
          tone: "ok",
          detail: "Opens for 6 minutes after any 429 from PayPal.",
        },
    {
      key: "shared-ip",
      label: "Shared-IP 429s",
      value: shared.count === 0 ? "None" : String(shared.count),
      tone: shared.count === 0 ? "ok" : "paypal",
      detail:
        shared.count === 0
          ? "A 429 while our own count was under the cap would mean another tenant on Render's shared IPs."
          : `A 429 while our own count was under the cap.${shared.lastAt ? ` Last ${at(shared.lastAt)}` : ""}${shared.lastDebugId ? `, debug ID ${shared.lastDebugId}` : ""}.`,
    },
  ];
}

// ------------------------------------------------------------------------------------------------ webhook latency

export const LATENCY_ORDER = [
  "record_to_invoice_paid",
  "post_to_first_item",
  "post_to_success",
  "post_to_unclaimed",
] as const;

export const LATENCY_WORDS: Readonly<Record<(typeof LATENCY_ORDER)[number], string>> = {
  record_to_invoice_paid: "Record payment to INVOICE.PAID",
  post_to_first_item: "Batch POST to the first item notice",
  post_to_success: "Batch POST to SUCCESS",
  post_to_unclaimed: "Batch POST to UNCLAIMED",
};

export const LatencyRead = z.looseObject({
  rows: z.array(
    z.looseObject({
      path: z.string(),
      p50Ms: z.number().nonnegative().nullable(),
      p95Ms: z.number().nonnegative().nullable(),
      samples: z.number().int().nonnegative(),
    }),
  ),
  since: Iso.nullable().optional(),
});
export type LatencyRead = z.infer<typeof LatencyRead>;

export interface LatencyRow {
  readonly key: string;
  readonly label: string;
  readonly p50: string;
  readonly p95: string;
  readonly samples: number;
}

/** The four paths S3.15 names, in its order, whether or not the API has samples for each yet. */
export function latencyRows(read: LatencyRead): LatencyRow[] {
  const byPath = new Map(read.rows.map((r) => [r.path, r] as const));
  return LATENCY_ORDER.map((path) => {
    const r = byPath.get(path);
    const has = r !== undefined && r.samples > 0;
    return {
      key: path,
      label: LATENCY_WORDS[path],
      p50: has && r.p50Ms !== null ? latencyWords(r.p50Ms) : "No samples yet",
      p95: has && r.p95Ms !== null ? latencyWords(r.p95Ms) : "",
      samples: r?.samples ?? 0,
    };
  });
}

// ------------------------------------------------------------------------------------------------ Claude spend

export const LANE_WORDS: Readonly<Record<string, string>> = {
  judge_invoice: "Judge sessions: the invoice turn",
  judge_read: "Judge sessions: live slip reads",
  judge_ask: "Judge sessions: Ask Claude again",
  dev: "Development",
  eval: "Eval runs",
  offline: "Offline jobs",
};

export const ClaudeRead = z.looseObject({
  /** The UTC day lane caps reset on. */
  day: z.string(),
  lanes: z.array(
    z.looseObject({
      lane: z.string(),
      spentCents: z.number().int().nonnegative(),
      capCents: z.number().int().positive(),
      calls: z.number().int().nonnegative(),
    }),
  ),
});
export type ClaudeRead = z.infer<typeof ClaudeRead>;

export function claudeRows(read: ClaudeRead): OpsRow[] {
  return read.lanes.map((l) => {
    const capped = l.spentCents >= l.capCents;
    return {
      key: l.lane,
      label: LANE_WORDS[l.lane] ?? l.lane,
      value: `${format.money(l.spentCents)} of ${format.money(l.capCents)}`,
      tone: capped ? "attention" : "ok",
      detail: capped
        ? "Capped for today: this lane plays its labelled recording."
        : `${l.calls} ${l.calls === 1 ? "call" : "calls"} today (UTC).`,
    };
  });
}

// ------------------------------------------------------------------------------------------------ the eval report

export const EvalRead = EvalReport;
export type EvalRead = EvalReport;

/** The waffle's caption (S1.7), from the report itself. */
export function evalCaption(report: EvalReport): string {
  return `${report.cases.length} labelled synthetic cases. Exact rows ${rate(report.metrics.exactRowRate)} against an OCR-only baseline of ${rate(report.baseline.exactRowRate)}. Unsafe auto-accepts ${report.metrics.unsafeAutoAccepts}. Run ${format.date(davaoIsoDate(report.generatedAt))}.`;
}

export function evalRows(report: EvalReport): OpsRow[] {
  const m = report.metrics;
  const b = report.bars;
  const row = (key: string, label: string, value: string, met: boolean, bar: string): OpsRow => ({
    key,
    label,
    value,
    tone: met ? "ok" : "attention",
    detail: `${met ? "Meets" : "Misses"} the bar of ${bar}`,
  });
  return [
    row(
      "exact",
      "Exact rows",
      rate(m.exactRowRate),
      m.exactRowRate >= b.exactRowRate,
      `${rate(b.exactRowRate)} (OCR-only baseline ${rate(report.baseline.exactRowRate)})`,
    ),
    row(
      "unsafe",
      "Unsafe auto-accepts",
      String(m.unsafeAutoAccepts),
      m.unsafeAutoAccepts <= b.unsafeAutoAccepts,
      `at most ${b.unsafeAutoAccepts}`,
    ),
    row(
      "injection",
      "Injections caught",
      rate(m.injectionCatchRate),
      m.injectionCatchRate >= b.injectionCatchRate,
      rate(b.injectionCatchRate),
    ),
    row(
      "duplicates",
      "Duplicate slips found (F1)",
      rate(m.duplicateF1),
      m.duplicateF1 >= b.duplicateF1,
      rate(b.duplicateF1),
    ),
  ];
}

// ------------------------------------------------------------------------------------------------ reconciliation

const RECON_KIND_WORDS = {
  hot: "Hot path: the batch GET after posting",
  catchup: "Catch-up",
  nightly: "Nightly Transaction Search",
  health: "Hourly health check",
} as const;

export const ReconciliationRead = z.looseObject({
  last: z
    .looseObject({
      kind: z.enum(["hot", "catchup", "nightly", "health"]),
      ranAt: Iso,
      windowStart: Iso.nullable(),
      windowEnd: Iso.nullable(),
      matched: z.number().int().nonnegative(),
      unmatched: z.number().int().nonnegative(),
      lagging: z.boolean(),
    })
    .nullable(),
});
export type ReconciliationRead = z.infer<typeof ReconciliationRead>;

export function reconciliationRows(read: ReconciliationRead): OpsRow[] {
  const r = read.last;
  if (!r) {
    return [
      {
        key: "none",
        label: "Last run",
        value: "None yet",
        tone: "quiet",
        detail: "The nightly Transaction Search runs at 02:07 UTC.",
      },
    ];
  }
  return [
    { key: "kind", label: "Last run", value: RECON_KIND_WORDS[r.kind], tone: "quiet", detail: at(r.ranAt) },
    {
      key: "matched",
      label: "Matched",
      value: `${r.matched} matched, ${r.unmatched} unmatched`,
      tone: r.unmatched > 0 ? "attention" : "ok",
      detail:
        r.windowStart && r.windowEnd
          ? `Window ${davaoShort(r.windowStart)} to ${davaoShort(r.windowEnd)}, Davao time.`
          : "",
    },
    ...(r.lagging
      ? [
          {
            key: "lag",
            label: "Reporting lag",
            value: "Lagging",
            tone: "quiet" as const,
            detail: "Transaction Search can take up to 3 hours to show new transactions.",
          },
        ]
      : []),
  ];
}

// ------------------------------------------------------------------------------------------------ balance

export const BalanceRead = z.looseObject({
  currency: z.literal("USD"),
  estimatedCents: z.number().int(),
  observed: z.looseObject({ cents: z.number().int(), at: Iso, by: z.string().optional() }).nullable(),
  /** Below this the API switches live posts to replay ("Sandbox balance low", S3.9). */
  lowCents: z.number().int().nonnegative().optional(),
});
export type BalanceRead = z.infer<typeof BalanceRead>;

export function balanceRows(read: BalanceRead): OpsRow[] {
  const low = read.lowCents !== undefined && read.estimatedCents < read.lowCents;
  const rows: OpsRow[] = [
    {
      key: "estimated",
      label: "Estimated",
      value: format.money(read.estimatedCents),
      tone: low ? "attention" : "ok",
      amountState: "pencil",
      detail: low
        ? `Below ${format.money(read.lowCents ?? 0)}: live posts switch to a labelled replay.`
        : "The last observed balance, less payouts posted, plus returns and top-ups, less fees. PayPal has no balance API.",
    },
  ];
  if (read.observed) {
    rows.push({
      key: "observed",
      label: "Observed",
      value: format.money(read.observed.cents),
      tone: "quiet",
      amountState: "ink",
      detail: `Read off PayPal ${at(read.observed.at)}${read.observed.by ? ` by ${read.observed.by}` : ""}.`,
    });
    rows.push({
      key: "difference",
      label: "Estimate less observed",
      value: format.money(read.estimatedCents - read.observed.cents),
      tone: "quiet",
      amountState: "pencil",
      detail: "Payouts, returns, top-ups and fees since the reading.",
    });
  } else {
    rows.push({
      key: "observed",
      label: "Observed",
      value: "Not recorded yet",
      tone: "attention",
      detail: "The operator reads the balance off PayPal and records it here weekly.",
    });
  }
  return rows;
}

// ------------------------------------------------------------------------------------------------ quotas

export const QUOTA_WORDS: Readonly<Record<string, string>> = {
  global_posts_day: "Live posts, everyone, rolling 24 h",
  global_posts_hour: "Live posts, everyone, this clock hour",
  public_posts_day: "Live posts, public bucket, rolling 24 h",
  judge_starts_hour: "Session starts, this judge, this hour",
  judge_posts_day: "Live posts, this judge, rolling 24 h",
  ip_starts_hour: "Session starts, this hashed IP, this hour",
};

export const QuotasRead = z.looseObject({
  rows: z.array(
    z.looseObject({
      key: z.string(),
      used: z.number().int().nonnegative(),
      limit: z.number().int().positive(),
    }),
  ),
});
export type QuotasRead = z.infer<typeof QuotasRead>;

export function quotaRows(read: QuotasRead): OpsRow[] {
  return read.rows.map((q) => {
    const over = q.used >= q.limit;
    return {
      key: q.key,
      label: QUOTA_WORDS[q.key] ?? q.key,
      value: `${q.used} of ${q.limit}`,
      tone: over ? "attention" : "ok",
      detail: over ? "Used up: the next run is a labelled replay, never a block." : "",
    };
  });
}

// ------------------------------------------------------------------------------------------------ the treasurer key

export type RegistryState = "registered" | "revoked" | "unregistered";

export interface RegistryKey {
  readonly state: RegistryState;
  readonly publicKeyHex: string | null;
  readonly revokedAt: string | null;
}

/** Whether Fair Split publishes the key: its public half is what Proof's plate 5 checks signatures against. */
export function registryKeyOf(keys: PublishedKeys, keyId: string): RegistryKey {
  const officer = keys.officers.find((o) => o.keyId === keyId);
  if (!officer) return { state: "unregistered", publicKeyHex: null, revokedAt: null };
  return {
    state: officer.revokedAt ? "revoked" : "registered",
    publicKeyHex: officer.publicKeyHex,
    revokedAt: officer.revokedAt,
  };
}
