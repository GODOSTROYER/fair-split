import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  API_COMMANDS,
  apiError,
  apiPath,
  appRoutes,
  CreateJudgeSessionResponse,
  consoleLineLabel,
  EngineInput,
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  HOLD_GATE_LABELS,
  HOLD_GATES,
  HOLD_KIND_LABELS,
  HOLD_KINDS,
  HOLD_STATE_LABELS,
  HOLD_STATES,
  HoldProposal,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUSES,
  ITEM_EVENT_TO_STATUS,
  ITEM_STATUS_TO_LINE_STATE,
  LANGS,
  MEMBER_LINE_LABELS,
  MEMBER_LINE_STATES,
  PAY_RUN_RANK,
  PAY_RUN_STATES,
  PAYOUT_ITEM_RANK,
  PAYOUT_ITEM_STATUS_LABELS,
  PAYOUT_ITEM_STATUSES,
  PROVENANCE_LABELS,
  PROVENANCES,
  pickLabel,
  RAIL_LABELS,
  RateCardRatifiedError,
  ResolveHoldRequest,
  RUN_EVENT_TYPES,
  RUN_STATE_LABELS,
  RUN_STRIP_LABELS,
  RUN_STRIP_STEPS,
  RunEvent,
  SCREEN_IDS,
  SCREENS,
  StatementText,
  TASK_NAMES,
  TASKS,
  taskDedupeKey,
  testId,
  WEBHOOK_EVENT_TYPES,
  type Words,
  webRoutes,
} from "./index.js";

const RAW_STATE = /^[A-Z][A-Z_]+$/;

function expectWords(map: Record<string, Words>, keys: readonly string[]) {
  expect(Object.keys(map).sort()).toEqual([...keys].sort());
  for (const k of keys) {
    for (const lang of LANGS) {
      const w = map[k]?.[lang];
      expect(w, `${k}/${lang}`).toBeTruthy();
      expect(RAW_STATE.test(w ?? ""), `${k}/${lang} looks like a raw state name`).toBe(false);
    }
  }
}

describe("label maps: a raw state name is never shown (register §7)", () => {
  it("covers every state, kind, gate and status in en, ceb and fil", () => {
    expectWords(MEMBER_LINE_LABELS, MEMBER_LINE_STATES);
    expectWords(RUN_STATE_LABELS, PAY_RUN_STATES);
    expectWords(HOLD_KIND_LABELS, HOLD_KINDS);
    expectWords(HOLD_GATE_LABELS, HOLD_GATES);
    expectWords(HOLD_STATE_LABELS, HOLD_STATES);
    expectWords(PAYOUT_ITEM_STATUS_LABELS, PAYOUT_ITEM_STATUSES);
    expectWords(RUN_STRIP_LABELS, RUN_STRIP_STEPS);
    expectWords(INVOICE_STATUS_LABELS, INVOICE_STATUSES);
    expectWords(RAIL_LABELS, ["PAYPAL", "CASH"]);
  });

  it("inv.i8.labels: every provenance renders as a label, and 'live' is never the word", () => {
    expectWords(PROVENANCE_LABELS, PROVENANCES);
    for (const p of PROVENANCES) expect(PROVENANCE_LABELS[p].en.toLowerCase()).not.toMatch(/\blive\b/);
  });

  it("keeps the register's fixed status words", () => {
    expect(MEMBER_LINE_LABELS.HELD).toMatchObject({
      ceb: "Gisusi pa",
      fil: "Sinusuri pa po",
      en: "Still checking",
    });
    expect(MEMBER_LINE_LABELS.PAYPAL_PENDING.ceb).toBe("Gipadala na, naghulat sa PayPal");
    expect(MEMBER_LINE_LABELS.PAID.ceb).toBe("Bayad na");
    expect(MEMBER_LINE_LABELS.OFF_RAIL_DUE.ceb).toBe("Andam sa bodega");
    expect(MEMBER_LINE_LABELS.OFF_RAIL_PAID.ceb).toBe("Nadawat");
    expect(MEMBER_LINE_LABELS.UNCLAIMED).toMatchObject({ ceb: "Wala madawat sa PayPal", console: "Parked" });
    expect(HOLD_KIND_LABELS.LOW_CONFIDENCE.en).toBe("By hand");
    expect(HOLD_GATE_LABELS.RESERVES_LINE.en).toBe("Reserves this line only. Never redistributed.");
    expect(consoleLineLabel("HELD", true)).toBe("Gisusi pa. Reserved, never redistributed.");
    expect(pickLabel(RUN_STATE_LABELS.AWAITING_BOARD, "en", { chair: "Ernesto" })).toBe(
      "Waiting for Ernesto",
    );
    expect(pickLabel(RUN_STATE_LABELS.TREASURER_APPROVED, "ceb", { treasurer: "Analyn" })).toBe(
      "Giaprobahan ni Analyn",
    );
  });
});

describe("states and ranks", () => {
  it("ranks payout item statuses as the register does", () => {
    expect(PAYOUT_ITEM_RANK).toMatchObject({
      PENDING: 10,
      ONHOLD: 20,
      UNCLAIMED: 30,
      RETURNED: 40,
      FAILED: 50,
      BLOCKED: 50,
      SUCCESS: 60,
      REFUNDED: 70,
      REVERSED: 70,
    });
    expect(ITEM_EVENT_TO_STATUS).toMatchObject({
      SUCCEEDED: "SUCCESS",
      HELD: "ONHOLD",
      CANCELED: "RETURNED",
    });
    expect(ITEM_STATUS_TO_LINE_STATE.UNCLAIMED).toBe("UNCLAIMED");
    expect(ITEM_STATUS_TO_LINE_STATE.FAILED).toBe("NEEDS_ACTION");
  });

  it("lists the run states in forward order with the three exits on top", () => {
    const main = PAY_RUN_STATES.filter((s) => PAY_RUN_RANK[s] < 99);
    expect(main).toEqual([
      "DRAFT",
      "QUOTED",
      "INVOICED",
      "FUNDED",
      "EXTRACTING",
      "COMPUTED",
      "IN_REVIEW",
      "TREASURER_APPROVED",
      "AWAITING_BOARD",
      "APPROVED",
      "POSTING",
      "POSTED",
      "SETTLING",
      "NEEDS_FOLLOW_UP",
      "SETTLED",
      "CLOSED",
    ]);
    expect(main.map((s) => PAY_RUN_RANK[s])).toEqual(
      [...main.map((s) => PAY_RUN_RANK[s])].sort((a, b) => a - b),
    );
    expect(PAY_RUN_STATES.filter((s) => PAY_RUN_RANK[s] === 99)).toEqual(["CANCELLED", "DENIED", "HALTED"]);
    expect(WEBHOOK_EVENT_TYPES).toHaveLength(15);
  });
});

describe("screens and routes (register §4)", () => {
  it("has every canonical screen ID", () => {
    expect(SCREEN_IDS).toEqual([
      "W-JG-01",
      "W-AU-01",
      "W-TR-01",
      "W-TR-02",
      "W-TR-03",
      "W-TR-04",
      "W-TR-05",
      "W-TR-06",
      "W-TR-07",
      "W-TR-08",
      "W-TR-09",
      "W-TR-10",
      "W-PF-01",
      "W-BR-01",
      "W-OP-01",
      "W-DP-01",
      "M-ON-01",
      "M-MB-01",
      "M-MB-02",
      "M-MB-03",
      "M-MB-04",
      "M-CL-01",
      "M-BD-01",
      "M-BD-02",
    ]);
    expect(SCREENS["W-TR-06"].alias).toBe("C6");
  });

  it("builds routes and test IDs", () => {
    expect(webRoutes.season("2026-A")).toBe("/season/2026-A");
    expect(webRoutes.reading("2026-A", "B")).toBe("/season/2026-A/reading?photo=B");
    expect(webRoutes.byHand("2026-A", "0462")).toBe("/season/2026-A/by-hand/0462");
    expect(webRoutes.holdDrawer("2026A-r37", "H1")).toBe("/runs/2026A-r37/split?hold=H1");
    expect(webRoutes.memberLine("2026A-r37", "M-014")).toBe("/runs/2026A-r37/split?member=M-014");
    expect(webRoutes.memberPrint("2026A-r37", "M-014")).toBe("/runs/2026A-r37/members/M-014/print");
    expect(webRoutes.fanout("2026A-r37")).toBe("/runs/2026A-r37/fanout");
    expect(webRoutes.proof("2026A-r37")).toBe("/proof/2026A-r37");
    expect(webRoutes.memberLink("tok")).toBe("/s/tok");
    expect(appRoutes.webBase).toBe("/app");
    expect(appRoutes.pirma("2026A-r37")).toBe("/(board)/pirma/2026A-r37");
    expect(appRoutes.pair("t1")).toBe("/app/pair?t=t1");
    expect(testId("W-TR-07", "approve")).toBe("W-TR-07.approve");
  });
});

describe("RunEvent catalogue (IC-01)", () => {
  const env = {
    id: "42",
    ws: "ws-1",
    runId: "run-1",
    at: "2026-10-29T02:10:52.000Z",
    actor: { kind: "paypal", id: "paypal", impersonatedBy: null },
    provenance: "live",
  } as const;
  const samples: Record<string, unknown> = {
    "run.state": { runId: "run-1", from: "APPROVED", to: "POSTING", cause: { code: "POST", ref: null } },
    "line.state": {
      lineId: "l",
      memberNo: "M-014",
      from: "PAYPAL_PENDING",
      to: "PAID",
      cause: { code: "ITEM", ref: "e" },
    },
    "item.updated": {
      itemId: "i",
      senderItemId: "r37-M-014",
      memberNo: "M-014",
      payoutItemId: "5KX",
      from: "PENDING",
      to: "SUCCESS",
      rank: 60,
      source: "webhook",
      eventId: "WH-1",
    },
    "hold.raised": {
      holdId: "h",
      label: "H1",
      key: "DUPLICATE_SLIP:0457",
      kind: "DUPLICATE_SLIP",
      gate: "BLOCKS_APPROVAL",
      memberNo: "M-007",
      lineId: null,
    },
    "hold.resolved": {
      holdId: "h",
      label: "H1",
      state: "RESOLVED",
      resolution: "COUNT_ONCE",
      resolvedBy: "AS",
    },
    "field.entered": {
      fieldId: "f",
      docId: "d",
      serial: "0462",
      field: "gross_kg",
      value: "64.80",
      derived: { net_kg: "64.50" },
      enteredBy: "AS",
    },
    "extract.row": {
      docId: "d",
      row: 0,
      serial: "0403",
      memberNo: "M-014",
      fields: { net_kg: { value: "38.45", score: 0.97, decidedBy: "agreement", display: "38.45" } },
    },
    "extract.field": {
      docId: "d",
      row: 0,
      field: "net_kg",
      variant: "A",
      box: { x1: 1, y1: 2, x2: 3, y2: 4 },
    },
    "extract.quarantined": { docId: "d", row: null, box: null, source: "screen" },
    "approval.signed": {
      approvalId: "a",
      role: "chair",
      keyId: "fs-ernesto-a1",
      batchSha256: "a".repeat(64),
    },
    "approval.declined": { role: "chair", reason: "Check H1 again", by: "EC" },
    presence: { persona: "board:ernesto", view: "hold", holdId: "H2", expiresAt: "2026-10-29T02:11:17.000Z" },
    "webhook.received": {
      webhookEventId: "w",
      paypalEventId: "WH-1",
      eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      verified: "self",
      duplicate: false,
    },
    "invoice.state": {
      invoiceId: "INV2",
      invoiceNumber: "FS-2026A-r37",
      from: "SENT",
      to: "MARKED_AS_PAID",
      dueCents: 0,
    },
    "policy.verdict": {
      tool: "create_invoice",
      verdict: "DENY",
      decidedBy: ["invoiceEqualsQuote"],
      reasons: ["item 2 amount differs"],
      sessionId: "s",
    },
    "agent.delta": { sessionId: "s", block: "tool", text: "Claude compared slip 0457 in photos B and D" },
    "capture.synced": { captureId: "c", documentId: "d", sha256: "b".repeat(64), exactDuplicateOf: null },
    "flag.changed": { flag: "kill_payouts", on: true, by: "AS" },
  };

  it("parses every event type of IC-01", () => {
    expect(Object.keys(samples).sort()).toEqual([...RUN_EVENT_TYPES].sort());
    for (const type of RUN_EVENT_TYPES) {
      const r = RunEvent.safeParse({ ...env, type, payload: samples[type] });
      expect(r.success, `${type}: ${r.success ? "" : r.error.message}`).toBe(true);
    }
  });

  it("rejects unknown types and wrong payloads", () => {
    expect(RunEvent.safeParse({ ...env, type: "item.deleted", payload: {} }).success).toBe(false);
    expect(
      RunEvent.safeParse({
        ...env,
        type: "run.state",
        payload: { runId: "r", from: "DRAFT", to: "PAID", cause: { code: "x", ref: null } },
      }).success,
    ).toBe(false);
  });
});

describe("TaskName registry", () => {
  it("lists the 16 tasks with dedupe keys", () => {
    expect(TASK_NAMES).toHaveLength(16);
    expect(taskDedupeKey("ensureInvoice", { target: "FUNDED", runId: "r", invoiceId: "INV2", n: 1 })).toBe(
      "fund:INV2:1",
    );
    expect(taskDedupeKey("ensureInvoice", { target: "SENT", runId: "r" })).toBe("inv:r:sent");
    expect(taskDedupeKey("processWebhook", { webhookEventId: "w", paypalEventId: "WH-1" })).toBe("wh:WH-1");
    expect(taskDedupeKey("postPayoutBatch", { runId: "r", senderBatchId: "2026A-7f3a91c2-r37" })).toBe(
      "post:2026A-7f3a91c2-r37",
    );
    expect(taskDedupeKey("settleBatch", { batchId: "b", n: 1 })).toBe("settle:b:1");
    expect(taskDedupeKey("extract", { documentIds: ["d2", "d1"], runId: null })).toBe(
      taskDedupeKey("extract", { documentIds: ["d1", "d2"], runId: "r" }),
    );
    expect(taskDedupeKey("reroute", { lineId: "l", n: 1 })).toBe("reroute:l:x1");
    expect(TASKS.extract.executor).toBe("workflow");
    expect(TASKS.postPayoutBatch.executor).toBe("inline");
  });

  it("validates arguments (IDs only)", () => {
    expect(() => taskDedupeKey("explain", { lineId: "l", lang: "de" })).toThrow();
    expect(() => taskDedupeKey("cancelUnclaimed", { payoutItemId: "p" })).toThrow();
    expect(() => taskDedupeKey("computeRun", { runId: "r", version: 1, extra: true })).toThrow();
  });
});

describe("errors and API commands", () => {
  it("maps every error code to an HTTP status", () => {
    for (const c of ERROR_CODES) expect(ERROR_HTTP_STATUS[c]).toBeGreaterThanOrEqual(400);
    expect(ERROR_HTTP_STATUS.RATE_CARD_RATIFIED).toBe(409);
    expect(apiError("KILL_SWITCH_ON", "Refused: kill switch on")).toMatchObject({ status: 423 });
    expect(
      RateCardRatifiedError.safeParse({
        code: "RATE_CARD_RATIFIED",
        status: 409,
        message: "Closed list.",
        hash: "f".repeat(64),
        rateCard: "BR 2026-04",
        ratifiedOn: "2026-03-14",
      }).success,
    ).toBe(true);
  });

  it("registers the register §4 commands", () => {
    const paths = Object.values(API_COMMANDS).map((c) => `${c.method} ${c.path}`);
    for (const p of [
      "POST /v1/judge/sessions",
      "POST /v1/runs/:runSlug/mark-paid",
      "POST /v1/holds/:holdId/resolve",
      "POST /v1/fields/:fieldId/enter",
      "POST /v1/rate-cards/:id/deductions",
      "POST /v1/runs/:runSlug/approvals",
      "POST /v1/runs/:runSlug/approvals/decline",
      "POST /v1/lines/:lineId/pay-cash",
      "POST /v1/lines/:lineId/resend",
      "POST /v1/captures",
      "POST /v1/pairing",
      "POST /v1/pairing/claim",
      "POST /v1/presence",
      "POST /v1/review-requests",
      "POST /v1/flags",
      "GET /v1/runs/:runSlug/events",
      "GET /v1/workspaces/:ws/events",
      "GET /v1/proof/:runSlug",
      "GET /v1/proof/:runSlug.json",
      "GET /v1/proof/:runSlug/export",
    ]) {
      expect(paths).toContain(p);
    }
    expect(API_COMMANDS.addDeduction.errors).toEqual(["RATE_CARD_RATIFIED"]);
    expect(apiPath(API_COMMANDS.resolveHold.path, { holdId: "H1" })).toBe("/v1/holds/H1/resolve");
    expect(apiPath(API_COMMANDS.proofJson.path, { runSlug: "2026A-r37" })).toBe("/v1/proof/2026A-r37.json");
    expect(() => apiPath(API_COMMANDS.resolveHold.path, {})).toThrow();
    expect(ResolveHoldRequest.safeParse({ resolution: "COUNT_ONCE" }).success).toBe(true);
    expect(
      ResolveHoldRequest.safeParse({
        resolution: "REGISTER_PLOT",
        plot: { plotNo: "P-053-B", areaHa: "0.60", trees: 330 },
      }).success,
    ).toBe(true);
    expect(ResolveHoldRequest.safeParse({ resolution: "TWO_DELIVERIES" }).success).toBe(false);
    expect(CreateJudgeSessionResponse.safeParse({}).success).toBe(false);
  });

  it("engine input requires integer money and known shapes", () => {
    expect(EngineInput.safeParse({}).success).toBe(false);
  });
});

describe("inv.i1.no-model-numbers", () => {
  function numericPaths(schema: unknown, path = "$"): string[] {
    if (schema === null || typeof schema !== "object") return [];
    const node = schema as Record<string, unknown>;
    const here = node.type === "number" || node.type === "integer" ? [path] : [];
    return [
      ...here,
      ...Object.entries(node).flatMap(([k, v]) =>
        Array.isArray(v)
          ? v.flatMap((x, i) => numericPaths(x, `${path}.${k}[${i}]`))
          : numericPaths(v, `${path}.${k}`),
      ),
    ];
  }

  it("the model's outputs (statement text, hold proposals) carry no number fields", () => {
    expect(numericPaths(z.toJSONSchema(z.object({ amount: z.number() })))).toEqual(["$.properties.amount"]);
    expect(numericPaths(z.toJSONSchema(StatementText))).toEqual([]);
    expect(numericPaths(z.toJSONSchema(HoldProposal))).toEqual([]);
  });
});

describe("inv.i7.outbox dedupe keys", () => {
  it("identical arguments give identical keys, so a second enqueue is a no-op", () => {
    const samples: [Parameters<typeof taskDedupeKey>[0], unknown][] = [
      ["recordPayment", { runId: "r", invoiceId: "INV2" }],
      ["cancelUnclaimed", { payoutItemId: "p", afterCancel: "cash" }],
      ["computeRun", { runId: "r", version: 3 }],
      ["explain", { lineId: "l", lang: "ceb" }],
      ["agentTurn", { runId: "r", purpose: "INVESTIGATE_HOLD", holdId: "h", turn: 1 }],
      ["pushNotify", { kind: "bayad_na", targetId: "l", eventId: "WH-1" }],
      ["reconcile", { mode: "nightly", windowStart: "2026-10-29T02:07:00.000Z" }],
      ["judgeReset", { trigger: "cron", workspaceId: null, slot: "2026-10-29T03" }],
      ["warmCaches", { slot: "2026-10-29" }],
      ["readRateCard", { documentId: "d" }],
    ];
    const keys = samples.map(([name, args]) => taskDedupeKey(name, args));
    expect(samples.map(([name, args]) => taskDedupeKey(name, structuredClone(args)))).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
