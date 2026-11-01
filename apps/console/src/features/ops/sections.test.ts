// S3.15's sections in words (W-OP-01): every row computed from what the API's ops slice serves, red only for a
// PayPal failure, money in pencil when it is an estimate, and the treasurer key as Fair Split publishes it.

import { getSnapshot } from "@fairsplit/api-client/seed";
import type { PublishedKeys } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import {
  SAMPLE_BALANCE,
  SAMPLE_CLAUDE,
  SAMPLE_EVAL,
  SAMPLE_LATENCY,
  SAMPLE_LIMITER,
  SAMPLE_QUOTAS,
  SAMPLE_RECONCILIATION,
  SAMPLE_SCOPES,
} from "../../test/ops-fixtures.js";
import {
  BalanceRead,
  balanceRows,
  ClaudeRead,
  claudeRows,
  EvalRead,
  evalCaption,
  evalRows,
  LatencyRead,
  LimiterRead,
  latencyRows,
  latencyWords,
  limiterRows,
  QuotasRead,
  quotaRows,
  ReconciliationRead,
  reconciliationRows,
  registryKeyOf,
  ScopesRead,
  scopeName,
  scopeRows,
} from "./sections.js";

describe("the samples match the shapes /ops asks for", () => {
  it("parses every sample with its read's schema", () => {
    expect(ScopesRead.safeParse(SAMPLE_SCOPES).success).toBe(true);
    expect(LimiterRead.safeParse(SAMPLE_LIMITER).success).toBe(true);
    expect(LatencyRead.safeParse(SAMPLE_LATENCY).success).toBe(true);
    expect(ClaudeRead.safeParse(SAMPLE_CLAUDE).success).toBe(true);
    expect(EvalRead.safeParse(SAMPLE_EVAL).success).toBe(true);
    expect(ReconciliationRead.safeParse(SAMPLE_RECONCILIATION).success).toBe(true);
    expect(BalanceRead.safeParse(SAMPLE_BALANCE).success).toBe(true);
    expect(QuotasRead.safeParse(SAMPLE_QUOTAS).success).toBe(true);
  });
});

describe("scopes", () => {
  it("lists what the steps need, granted or missing, then what is granted but not needed", () => {
    const rows = scopeRows(SAMPLE_SCOPES);
    expect(rows.map((r) => [r.label, r.value, r.tone])).toEqual([
      ["payments/payouts", "Granted", "ok"],
      ["invoicing", "Granted", "ok"],
      ["reporting/search/read", "Missing", "attention"],
      ["openid", "Granted", "quiet"],
    ]);
    expect(scopeName("openid")).toBe("openid");
  });
});

describe("the limiter, the circuit and shared-IP 429s", () => {
  it("reads the 60 s window against 40 and 20, and a closed circuit", () => {
    const rows = limiterRows(SAMPLE_LIMITER);
    expect(rows.map((r) => [r.key, r.value, r.tone])).toEqual([
      ["calls", "12 of 40", "ok"],
      ["background", "3 of 20", "ok"],
      ["circuit", "Closed", "ok"],
      ["shared-ip", "None", "ok"],
    ]);
    expect(rows[0]?.label).toBe("PayPal calls, last 60 s");
  });

  it("says an open circuit and a shared-IP 429 in PayPal's red, with the debug ID", () => {
    const rows = limiterRows({
      ...SAMPLE_LIMITER,
      calls: 40,
      circuit: { open: true, until: "2026-10-30T02:46:00.000Z", lastRateLimitAt: "2026-10-30T02:40:00.000Z" },
      sharedIp429s: { count: 1, lastAt: "2026-10-30T02:40:00.000Z", lastDebugId: "f1d2c3b4a5" },
    });
    expect(rows.find((r) => r.key === "calls")).toMatchObject({ tone: "attention" });
    expect(rows.find((r) => r.key === "circuit")).toMatchObject({
      value: "Open until 10:46:00",
      tone: "paypal",
    });
    const shared = rows.find((r) => r.key === "shared-ip");
    expect(shared).toMatchObject({ value: "1", tone: "paypal" });
    expect(shared?.detail).toContain("debug ID f1d2c3b4a5");
  });
});

describe("webhook latency", () => {
  it("names S3.15's four paths in order, with or without samples", () => {
    const rows = latencyRows(SAMPLE_LATENCY);
    expect(rows.map((r) => r.label)).toEqual([
      "Record payment to INVOICE.PAID",
      "Batch POST to the first item notice",
      "Batch POST to SUCCESS",
      "Batch POST to UNCLAIMED",
    ]);
    expect(rows[0]).toMatchObject({ p50: "2 s", p95: "8 s", samples: 14 });
    expect(rows[1]).toMatchObject({ p50: "640 ms", p95: "1 s" });
    expect(rows[2]).toMatchObject({ p95: "1 min 34 s" });
    expect(rows[3]).toMatchObject({ p50: "No samples yet", p95: "", samples: 0 });
    expect(latencyWords(999.4)).toBe("999 ms");
    expect(latencyWords(999.6)).toBe("1 s");
  });
});

describe("Claude spend", () => {
  it("reads each lane against its cap, and a capped lane as its recording", () => {
    const rows = claudeRows(SAMPLE_CLAUDE);
    expect(rows[0]).toMatchObject({
      label: "Judge sessions: the invoice turn",
      value: "US$1.24 of US$5.00",
      tone: "ok",
      detail: "12 calls today (UTC).",
    });
    expect(rows[1]).toMatchObject({ value: "US$1.50 of US$1.50", tone: "attention" });
    expect(rows[1]?.detail).toContain("labelled recording");
    expect(rows[2]?.detail).toBe("1 call today (UTC).");
  });
});

describe("the eval report", () => {
  it("captions the run and measures it against its bars", () => {
    expect(evalCaption(SAMPLE_EVAL)).toBe(
      "24 labelled synthetic cases. Exact rows 91.7% against an OCR-only baseline of 58.0%. Unsafe auto-accepts 0. Run 30 Oct 2026.",
    );
    const rows = evalRows(SAMPLE_EVAL);
    expect(rows.map((r) => [r.key, r.value, r.tone])).toEqual([
      ["exact", "91.7%", "ok"],
      ["unsafe", "0", "ok"],
      ["injection", "100.0%", "ok"],
      ["duplicates", "95.0%", "ok"],
    ]);
    const missed = evalRows({ ...SAMPLE_EVAL, metrics: { ...SAMPLE_EVAL.metrics, unsafeAutoAccepts: 1 } });
    expect(missed.find((r) => r.key === "unsafe")).toMatchObject({
      tone: "attention",
      detail: "Misses the bar of at most 0",
    });
  });
});

describe("the last reconciliation", () => {
  it("reads the run, what matched, and Transaction Search's lag", () => {
    const rows = reconciliationRows(SAMPLE_RECONCILIATION);
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ["kind", "Nightly Transaction Search"],
      ["matched", "8 matched, 0 unmatched"],
      ["lag", "Lagging"],
    ]);
    expect(rows[0]?.detail).toBe("30 Oct, 10:07:00, Davao time");
    expect(reconciliationRows({ last: null })[0]).toMatchObject({ value: "None yet" });
  });
});

describe("the balance", () => {
  it("prints the estimate in pencil, the person's reading in ink, and the gap", () => {
    const rows = balanceRows(SAMPLE_BALANCE);
    expect(rows.map((r) => [r.key, r.value, r.amountState])).toEqual([
      ["estimated", "US$96,344.12", "pencil"],
      ["observed", "US$97,000.00", "ink"],
      ["difference", "−US$655.88", "pencil"],
    ]);
  });

  it("flags a low estimate and a balance nobody has read yet", () => {
    const rows = balanceRows({ ...SAMPLE_BALANCE, estimatedCents: 420_000, observed: null });
    expect(rows[0]).toMatchObject({ tone: "attention" });
    expect(rows[0]?.detail).toContain("Below US$5,000.00");
    expect(rows[1]).toMatchObject({ value: "Not recorded yet", tone: "attention" });
  });
});

describe("quotas", () => {
  it("reads each against its limit; a used-up one is a replay, never a block", () => {
    const rows = quotaRows(SAMPLE_QUOTAS);
    expect(rows[0]).toMatchObject({
      label: "Live posts, everyone, rolling 24 h",
      value: "4 of 15",
      tone: "ok",
    });
    expect(rows[3]).toMatchObject({ value: "3 of 3", tone: "attention" });
    expect(rows[3]?.detail).toContain("never a block");
  });
});

describe("the treasurer key as Fair Split publishes it", () => {
  const keys = getSnapshot().publishedKeys;
  const officer = keys.officers[0];

  it("is unregistered until fs-analyn-w1 is published, then registered, then revoked", () => {
    expect(registryKeyOf(keys, "fs-analyn-w1").state).toBe("unregistered");
    if (!officer) throw new Error("the seed publishes officer keys");
    const published: PublishedKeys = {
      ...keys,
      officers: [...keys.officers, { ...officer, keyId: "fs-analyn-w1", kind: "web", revokedAt: null }],
    };
    expect(registryKeyOf(published, "fs-analyn-w1")).toEqual({
      state: "registered",
      publicKeyHex: officer.publicKeyHex,
      revokedAt: null,
    });
    const revoked: PublishedKeys = {
      ...keys,
      officers: [{ ...officer, keyId: "fs-analyn-w1", kind: "web", revokedAt: "2026-11-01T00:00:00.000Z" }],
    };
    expect(registryKeyOf(revoked, "fs-analyn-w1").state).toBe("revoked");
  });
});
