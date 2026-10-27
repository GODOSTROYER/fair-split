// /ops's read model (W-OP-01): failures classified without guessing, health rows in words, the three kill switches
// from the run's own events and FS_KILL, and PayPal's notices from a live run or the season's hash chain.

import { ApiClientError, ContractError, NetworkError } from "@fairsplit/api-client";
import type { RunEvent } from "@fairsplit/contracts";
import { getSnapshot } from "@fairsplit/seed";
import { describe, expect, it } from "vitest";
import {
  classifyFailure,
  flagRows,
  type Healthz,
  healthRows,
  noticesFromEvents,
  noticesFromLedger,
  opsDegraded,
  outboxSummary,
  type ReadOutcome,
  type Readyz,
  verifiedWords,
} from "./opsModel.js";

const snapshot = getSnapshot();

function apiError(status: number, code: string, notImplemented = false) {
  return new ApiClientError(
    { code, status, message: "x", ...(notImplemented ? { notImplemented: true } : {}) } as never,
    { command: "x", rail: null, requestId: null },
  );
}

describe("classifyFailure", () => {
  it("tells a route that isn't there from one that refused or failed", () => {
    expect(classifyFailure(apiError(404, "NOT_FOUND"), "http", 1).kind).toBe("not-served");
    expect(classifyFailure(apiError(401, "UNAUTHENTICATED"), "http", 1).kind).toBe("refused");
    expect(classifyFailure(apiError(403, "FORBIDDEN"), "http", 1).kind).toBe("refused");
    expect(classifyFailure(apiError(500, "INTERNAL"), "http", 1)).toEqual({
      kind: "down",
      status: 500,
      at: 1,
    });
    expect(classifyFailure(new ContractError("x", 200, "html", [], null), "http", 1).kind).toBe("not-served");
    expect(classifyFailure(new ContractError("x", 503, "no body", [], null), "http", 1)).toEqual({
      kind: "down",
      status: 503,
      at: 1,
    });
  });

  it("reads a missing answer as not served in the mock and as down against the API", () => {
    const err = new NetworkError("x", new TypeError("No mock answers GET /readyz."), false);
    expect(classifyFailure(err, "mock", 1).kind).toBe("not-served");
    expect(classifyFailure(err, "http", 1)).toEqual({ kind: "down", status: null, at: 1 });
  });
});

describe("health rows", () => {
  const live: ReadOutcome<Healthz> = {
    kind: "ok",
    data: { status: "ok", service: "fs-api", version: "0.1.0", rail: "simulated", uptimeS: 7_380 },
    at: 1,
  };

  it("says liveness and readiness in words, rail included", () => {
    const rows = healthRows(live, { kind: "not-served", at: 1 });
    expect(rows[0]).toMatchObject({ check: "Liveness (/healthz)", status: "Up", tone: "ok" });
    expect(rows[0]?.detail).toContain("up 2 h 3 min");
    expect(rows[0]?.detail).toContain("Simulated PayPal sandbox");
    expect(rows[1]).toMatchObject({ status: "Not served yet", tone: "quiet" });
    expect(opsDegraded(live, { kind: "not-served", at: 1 })).toBe(false);
  });

  it("lists readiness checks, and only a PayPal failure reads as PayPal's", () => {
    const ready: ReadOutcome<Readyz> = {
      kind: "ok",
      at: 1,
      data: {
        status: "not_ready",
        rail: "simulated",
        checks: {
          db: { ok: true, role: "login" },
          listen: { ok: false, error: "no LISTEN bus in this process" },
          dispatcher: { ok: true, executor: "inline" },
          flags: { forcedByEnv: [] },
          paypal: {
            token: { cached: false, failures: 2, lastError: "401 from the token endpoint" },
            webhooks: "ok",
          },
        },
      },
    };
    const rows = healthRows(live, ready);
    expect(rows.find((r) => r.key === "ready")).toMatchObject({ status: "Not ready", tone: "attention" });
    expect(rows.find((r) => r.key === "listen")).toMatchObject({
      status: "Failing",
      detail: "no LISTEN bus in this process",
    });
    expect(rows.find((r) => r.key === "paypal-token")).toMatchObject({ status: "Failing", tone: "paypal" });
    expect(opsDegraded(live, ready)).toBe(true);
    expect(opsDegraded({ kind: "down", status: 503, at: 1 }, undefined)).toBe(true);
  });
});

function flagEvent(
  id: string,
  flag: "kill_payouts" | "kill_paypal_live" | "kill_ai_live",
  on: boolean,
): RunEvent {
  return {
    id,
    ws: "ws",
    runId: null,
    at: "2026-10-30T02:14:00.000Z",
    actor: { kind: "human", id: "treasurer:analyn", display: "Analyn" },
    provenance: "seeded",
    type: "flag.changed",
    payload: { flag, on, by: "treasurer:analyn" },
  } as unknown as RunEvent;
}

describe("kill switches", () => {
  it("are off with no change recorded, follow the newest flag.changed, and FS_KILL wins", () => {
    const none = flagRows([], []);
    expect(none.map((r) => [r.flag, r.on, r.source])).toEqual([
      ["kill_payouts", false, "default"],
      ["kill_paypal_live", false, "default"],
      ["kill_ai_live", false, "default"],
    ]);
    const rows = flagRows(
      [
        flagEvent("1", "kill_payouts", true),
        flagEvent("2", "kill_payouts", false),
        flagEvent("3", "kill_ai_live", true),
      ],
      ["paypal_live"],
    );
    expect(rows.find((r) => r.flag === "kill_payouts")).toMatchObject({
      on: false,
      by: "treasurer:analyn",
      source: "event",
    });
    expect(rows.find((r) => r.flag === "kill_ai_live")).toMatchObject({ on: true, source: "event" });
    expect(rows.find((r) => r.flag === "kill_paypal_live")).toMatchObject({
      on: true,
      forcedByEnv: true,
      by: "FS_KILL",
    });
  });
});

describe("PayPal's notices", () => {
  it("come from the season's hash chain, newest first, labelled with how each was checked", () => {
    const rows = noticesFromLedger(snapshot.proof.ledger, "simulator");
    const applied = snapshot.proof.ledger.filter((e) => e.kind === "webhook.applied");
    expect(rows).toHaveLength(applied.length);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.notice === "PAYMENT.PAYOUTS-ITEM.SUCCEEDED")).toBe(true);
    expect(rows.every((r) => !r.check.includes("verified") || r.check.includes("postback"))).toBe(true);
    expect(Date.parse(rows[0]?.at ?? "")).toBeGreaterThanOrEqual(Date.parse(rows.at(-1)?.at ?? ""));
  });

  it("never call a simulated signature verified", () => {
    expect(verifiedWords("self", "simulator")).toBe("Signature checked (simulator's CA)");
    expect(verifiedWords("self", "sandbox")).toBe("Signature verified");
  });

  it("come from a live run's events, a repeated delivery marked as such", () => {
    const events = [
      {
        id: "10",
        ws: "ws",
        runId: "r",
        at: "2026-10-30T02:20:00.000Z",
        actor: { kind: "paypal", id: "paypal", display: "PayPal" },
        provenance: "simulated_rail",
        type: "item.updated",
        payload: {
          itemId: "i",
          senderItemId: "r37-M-014",
          memberNo: "M-014",
          payoutItemId: "PI-1",
          from: "PENDING",
          to: "SUCCESS",
          rank: 60,
          source: "webhook",
          eventId: "WH-1",
        },
      },
      {
        id: "11",
        ws: "ws",
        runId: "r",
        at: "2026-10-30T02:20:05.000Z",
        actor: { kind: "paypal", id: "paypal", display: "PayPal" },
        provenance: "simulated_rail",
        type: "webhook.received",
        payload: {
          webhookEventId: "w",
          paypalEventId: "WH-1",
          eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
          verified: "self",
          duplicate: true,
        },
      },
    ] as unknown as RunEvent[];
    const rows = noticesFromEvents(events, "simulator");
    expect(rows.map((r) => r.id)).toEqual(["11", "10"]);
    expect(rows[0]).toMatchObject({ duplicate: true, status: "Delivery repeated, already applied" });
    expect(rows[1]).toMatchObject({
      object: "r37-M-014",
      check: "Webhook, signature checked (simulator)",
      paypalEventId: "WH-1",
    });
  });
});

describe("the outbox summary", () => {
  it("counts rows by state", () => {
    expect(
      outboxSummary([
        { id: "1", task: "postPayoutBatch", state: "done", attempts: 1, createdAt: "x" },
        { id: "2", task: "settleBatch", state: "queued", attempts: 0, createdAt: "x" },
        { id: "3", task: "pushNotify", state: "dead", attempts: 8, createdAt: "x" },
        { id: "4", task: "processWebhook", state: "running", attempts: 1, createdAt: "x" },
      ]),
    ).toEqual({ queued: 1, running: 1, dead: 1, done: 1 });
  });
});
