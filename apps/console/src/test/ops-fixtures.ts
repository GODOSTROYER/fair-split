// Test-only sample answers for the reads /ops asks the API's ops slice for (sections.ts): the shapes the shared-change
// request names, filled with plausible values. The app never imports this file; nothing here is a real reading.

import type { EvalReport } from "@fairsplit/contracts";
import type { OutboxRead } from "../features/ops/opsModel.js";
import type {
  BalanceRead,
  ClaudeRead,
  LatencyRead,
  LimiterRead,
  OpsSession,
  QuotasRead,
  ReconciliationRead,
  ScopesRead,
} from "../features/ops/sections.js";

const PP = "https://uri.paypal.com/services/";

export const SAMPLE_SESSION: OpsSession = { role: "operator", expiresAt: "2026-10-30T10:00:00.000Z" };

export const SAMPLE_SCOPES: ScopesRead = {
  granted: [`${PP}payments/payouts`, `${PP}invoicing`, "openid"],
  required: [`${PP}payments/payouts`, `${PP}invoicing`, `${PP}reporting/search/read`],
  checkedAt: "2026-10-30T02:00:00.000Z",
};

export const SAMPLE_LIMITER: LimiterRead = {
  windowS: 60,
  calls: 12,
  backgroundCalls: 3,
  limit: 40,
  backgroundLimit: 20,
  circuit: { open: false, until: null, lastRateLimitAt: null },
  sharedIp429s: { count: 0, lastAt: null, lastDebugId: null },
};

export const SAMPLE_LATENCY: LatencyRead = {
  rows: [
    { path: "record_to_invoice_paid", p50Ms: 2300, p95Ms: 8100, samples: 14 },
    { path: "post_to_first_item", p50Ms: 640, p95Ms: 1900, samples: 14 },
    { path: "post_to_success", p50Ms: 25_200, p95Ms: 94_000, samples: 12 },
  ],
  since: "2026-10-23T00:00:00.000Z",
};

export const SAMPLE_CLAUDE: ClaudeRead = {
  day: "2026-10-30",
  lanes: [
    { lane: "judge_invoice", spentCents: 124, capCents: 500, calls: 12 },
    { lane: "judge_read", spentCents: 150, capCents: 150, calls: 31 },
    { lane: "judge_ask", spentCents: 0, capCents: 150, calls: 1 },
  ],
};

export const SAMPLE_EVAL: EvalReport = {
  v: 1,
  generatedAt: "2026-10-29T18:12:00.000Z",
  set: "test",
  cases: Array.from({ length: 24 }, (_, i) => ({
    id: `case-${String(i + 1).padStart(2, "0")}`,
    kind: i % 3 === 0 ? "composite" : "flat",
    pass: i !== 7,
    exactRow: i !== 7 && i !== 15,
    unsafeAccepts: 0,
    routedToPerson: i === 7 || i === 15,
  })),
  metrics: { exactRowRate: 0.917, unsafeAutoAccepts: 0, injectionCatchRate: 1, duplicateF1: 0.95 },
  baseline: { name: "OCR only", exactRowRate: 0.58 },
  bars: { exactRowRate: 0.9, unsafeAutoAccepts: 0, injectionCatchRate: 1, duplicateF1: 0.9 },
  green: true,
  versions: { promptV: "read-7", schemaV: "slip-3" },
};

export const SAMPLE_RECONCILIATION: ReconciliationRead = {
  last: {
    kind: "nightly",
    ranAt: "2026-10-30T02:07:00.000Z",
    windowStart: "2026-10-28T02:07:00.000Z",
    windowEnd: "2026-10-30T02:07:00.000Z",
    matched: 8,
    unmatched: 0,
    lagging: true,
  },
};

export const SAMPLE_BALANCE: BalanceRead = {
  currency: "USD",
  estimatedCents: 9_634_412,
  observed: { cents: 9_700_000, at: "2026-10-27T01:00:00.000Z", by: "the operator" },
  lowCents: 500_000,
};

export const SAMPLE_QUOTAS: QuotasRead = {
  rows: [
    { key: "global_posts_day", used: 4, limit: 15 },
    { key: "global_posts_hour", used: 1, limit: 3 },
    { key: "public_posts_day", used: 2, limit: 5 },
    { key: "judge_posts_day", used: 3, limit: 3 },
  ],
};

export const SAMPLE_OUTBOX: OutboxRead = {
  rows: [
    { id: "t3", task: "settleBatch", state: "queued", attempts: 0, createdAt: "2026-10-30T02:16:00.000Z" },
    { id: "t2", task: "postPayoutBatch", state: "done", attempts: 1, createdAt: "2026-10-30T02:15:00.000Z" },
  ],
  executor: "inline",
  lastTickAt: "2026-10-30T02:15:30.000Z",
};
