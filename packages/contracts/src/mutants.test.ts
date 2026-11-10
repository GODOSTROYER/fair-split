// Tests that kill mutation-testing survivors (handoff T3) in contracts: every task's dedupe key (the
// outbox's idempotency key, I7: two enqueues of one logical task must collide, two different tasks must
// not), the key-ID shape check on non-string input, the reserved-line note and path filling.
import { describe, expect, it } from "vitest";
import {
  apiPath,
  consoleLineLabel,
  keyIdFitsKind,
  ledgerKeyIdFitsKind,
  MEMBER_LINE_LABELS,
  TASKS,
} from "./index.js";

const key = (name: keyof typeof TASKS, args: Record<string, unknown>) =>
  (TASKS[name].dedupeKey as (a: Record<string, unknown>) => string)(args);

describe("task dedupe keys, exactly", () => {
  it.each([
    ["ensureInvoice", { target: "SENT", runId: "r1" }, "inv:r1:sent"],
    ["ensureInvoice", { target: "PAID", invoiceId: "INV2-X", n: 1 }, "fund:INV2-X:1"],
    ["recordPayment", { invoiceId: "INV2-X" }, "pay:INV2-X"],
    ["processWebhook", { paypalEventId: "WH-1" }, "wh:WH-1"],
    ["postPayoutBatch", { senderBatchId: "2026A-7f3a91c2-r37" }, "post:2026A-7f3a91c2-r37"],
    ["settleBatch", { batchId: "B1", n: 2 }, "settle:B1:2"],
    ["cancelUnclaimed", { payoutItemId: "8AELMXH8UB2P8" }, "cancel:8AELMXH8UB2P8"],
    ["reroute", { lineId: "L1", n: 1 }, "reroute:L1:x1"],
    ["extract", { documentIds: ["d2", "d1", "d3"] }, "extract:d1+d2+d3"],
    ["readRateCard", { documentId: "d9" }, "ratecard:d9"],
    ["computeRun", { runId: "r1", version: 3 }, "compute:r1:v3"],
    ["explain", { lineId: "L1", lang: "ceb" }, "explain:L1:ceb"],
    ["agentTurn", { runId: "r1", purpose: "DRAFT_INVOICE", turn: 2 }, "agent:r1:DRAFT_INVOICE:-:2"],
    ["agentTurn", { runId: "r1", purpose: "PROPOSE", holdId: "h1", turn: 2 }, "agent:r1:PROPOSE:h1:2"],
    ["pushNotify", { kind: "line", targetId: "t1", eventId: "e1" }, "push:line:t1:e1"],
    ["reconcile", { mode: "hot", windowStart: "2026-11-05T00:00:00Z" }, "reconcile:hot:2026-11-05T00:00:00Z"],
    ["judgeReset", { slot: 4 }, "reset:pool:4"],
    ["judgeReset", { workspaceId: "w1", slot: 4 }, "reset:w1:4"],
    ["warmCaches", { slot: 7 }, "warm:7"],
  ] as const)("%s %j → %s", (name, args, expected) => {
    expect(key(name, args)).toBe(expected);
  });

  it("extract's key does not depend on the order of its documents, and does not reorder the caller's list", () => {
    const ids = ["d2", "d1"];
    expect(key("extract", { documentIds: ids })).toBe(key("extract", { documentIds: ["d1", "d2"] }));
    expect(ids).toEqual(["d2", "d1"]);
  });
});

describe("small contract helpers", () => {
  it("key-ID shape checks refuse anything that is not two strings and a known kind", () => {
    expect(keyIdFitsKind("app", "fs-ernesto-a1")).toBe(true);
    expect(keyIdFitsKind(7, "fs-ernesto-a1")).toBe(false);
    expect(keyIdFitsKind("app", 7)).toBe(false);
    expect(keyIdFitsKind("toString", "fs-ernesto-a1")).toBe(false);
    expect(ledgerKeyIdFitsKind("server", "fs-ledger-k1")).toBe(true);
    expect(ledgerKeyIdFitsKind(null, "fs-ledger-k1")).toBe(false);
  });

  it("only a held line reserved by a hold carries the reserved note", () => {
    expect(consoleLineLabel("HELD")).toBe(MEMBER_LINE_LABELS.HELD.console);
    expect(consoleLineLabel("READY", true)).toBe(MEMBER_LINE_LABELS.READY.console);
    expect(consoleLineLabel("HELD", true)).not.toBe(MEMBER_LINE_LABELS.HELD.console);
    expect(consoleLineLabel("HELD", true).startsWith(`${MEMBER_LINE_LABELS.HELD.console}. `)).toBe(true);
  });

  it("apiPath names a missing parameter and encodes the given ones", () => {
    expect(apiPath("/v1/runs/:runId/lines/:lineId", { runId: "r 1", lineId: "L1" })).toBe(
      "/v1/runs/r%201/lines/L1",
    );
    expect(() => apiPath("/v1/runs/:runId", {})).toThrow("missing path param runId");
  });
});
