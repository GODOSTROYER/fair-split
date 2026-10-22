// Contract: the Payouts tool has PR #107's names and Tool shape, and the agent cannot reach the two
// money-moving calls (register §8: create and cancel are server-only, through PayoutsService).

import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as pkg from "../src/index.js";
import {
  AGENT_PAYOUT_ACTIONS,
  ALL_PAYOUT_TOOLS_ENABLED,
  agentPayoutToolSchemas,
  agentPayoutTools,
  isToolAllowed,
  PayoutsApiError,
  PayoutToolNotAllowedError,
  payoutTools,
  runAgentPayoutTool,
  SERVER_ONLY_PAYOUT_METHODS,
} from "../src/index.js";
import { PAYOUT_BATCH_ID, paypalError } from "./support/fixtures.js";
import { FetchPayPalHttp } from "./support/http.js";
import { onGet, paypalJson, requests, useMsw } from "./support/msw.js";

useMsw();

describe("PR #107 tool shape", () => {
  it("has the four tools with PR #107's methods, names and actions, in order", () => {
    expect(payoutTools({}).map(({ method, name, actions }) => ({ method, name, actions }))).toEqual([
      { method: "create_payout_batch", name: "Create Batch Payout", actions: { payouts: { create: true } } },
      { method: "get_payout_batch", name: "Get Batch Payout", actions: { payouts: { get: true } } },
      { method: "get_payout_item", name: "Get Payout Item", actions: { payouts: { getItem: true } } },
      {
        method: "cancel_unclaimed_payout_item",
        name: "Cancel Unclaimed Payout Item",
        actions: { payouts: { cancelItem: true } },
      },
    ]);
  });

  it("matches the toolkit's Tool type: exactly method, name, description, parameters (a ZodObject), actions", () => {
    for (const tool of payoutTools({})) {
      expect(Object.keys(tool).sort()).toEqual(["actions", "description", "method", "name", "parameters"]);
      expect(tool.parameters).toBeInstanceOf(z.ZodObject);
      expect(tool.description.trim().length).toBeGreaterThan(50);
    }
  });

  it("keeps the money-moving actions out of ALL_TOOLS_ENABLED, as PR #107 does", () => {
    expect(ALL_PAYOUT_TOOLS_ENABLED).toEqual({ payouts: { get: true, getItem: true } });
  });

  it("gates tools with the toolkit's isToolAllowed semantics", () => {
    const enabled = (actions: Record<string, Record<string, boolean>>) =>
      payoutTools({})
        .filter((t) => isToolAllowed(t, { actions }))
        .map((t) => t.method);
    expect(enabled({ payouts: { get: true } })).toEqual(["get_payout_batch"]);
    expect(enabled({ payouts: { get: true, getItem: true } })).toEqual([
      "get_payout_batch",
      "get_payout_item",
    ]);
    expect(enabled({ payouts: { unknownKey: true } })).toEqual([]);
    expect(enabled({ invoices: { create: true } })).toEqual([]);
  });
});

describe("allowlist contract: the agent cannot reach money-moving payout calls", () => {
  it("declares only the two reads to the agent", () => {
    expect(AGENT_PAYOUT_ACTIONS).toEqual({ payouts: { get: true, getItem: true } });
    expect(agentPayoutTools().map((t) => t.method)).toEqual(["get_payout_batch", "get_payout_item"]);
    expect(agentPayoutToolSchemas().map((t) => t.name)).toEqual(["get_payout_batch", "get_payout_item"]);
  });

  it("serves inlined draft-07 JSON Schema, converted like the toolkit's /openai tools", () => {
    for (const tool of agentPayoutToolSchemas()) {
      expect(tool.input_schema).toMatchObject({
        type: "object",
        additionalProperties: false,
        $schema: "http://json-schema.org/draft-07/schema#",
      });
      expect(JSON.stringify(tool.input_schema)).not.toContain("$ref");
    }
    const batch = agentPayoutToolSchemas()[0]?.input_schema as unknown as {
      required?: string[];
      properties: object;
    };
    expect(batch.required).toEqual(["payout_batch_id"]);
    expect(Object.keys(batch.properties)).toEqual(["payout_batch_id", "page", "page_size", "total_required"]);
  });

  it.each([...SERVER_ONLY_PAYOUT_METHODS, "record_payment_for_invoice", "create_invoice", "anything"])(
    "refuses %s through the agent path, sending nothing",
    async (tool) => {
      const http = new FetchPayPalHttp();
      await expect(
        runAgentPayoutTool(http, tool, { payout_item_id: "8AELMXH8UB2P8" }),
      ).rejects.toBeInstanceOf(PayoutToolNotAllowedError);
      expect(http.calls).toHaveLength(0);
    },
  );

  it("exports no function that creates or cancels a payout outside PayoutsService", () => {
    const exported = Object.keys(pkg);
    expect(exported).not.toContain("createPayoutBatch");
    expect(exported).not.toContain("cancelUnclaimedPayoutItem");
    expect(exported).toContain("PayoutsService");
  });
});

describe("the agent's reads", () => {
  it("GETs a batch with PR #107's paging defaults and no PayPal-Request-Id", async () => {
    onGet("/v1/payments/payouts/:id", () =>
      paypalJson({ batch_header: { payout_batch_id: PAYOUT_BATCH_ID } }),
    );
    const out = await runAgentPayoutTool(new FetchPayPalHttp(), "get_payout_batch", {
      payout_batch_id: PAYOUT_BATCH_ID,
    });
    expect(out).toEqual({ batch_header: { payout_batch_id: PAYOUT_BATCH_ID } });
    const [get] = requests;
    expect(get?.url.pathname).toBe(`/v1/payments/payouts/${PAYOUT_BATCH_ID}`);
    expect(get?.url.search).toBe("?page=1&page_size=100&total_required=true");
    expect(get?.headers.get("paypal-request-id")).toBeNull();
  });

  it("surfaces PayPal's error with its debug id", async () => {
    onGet("/v1/payments/payouts-item/:id", () =>
      paypalJson(paypalError("INVALID_RESOURCE_ID", "Requested resource ID was not found."), 404, "dbg-404"),
    );
    const error = await runAgentPayoutTool(new FetchPayPalHttp(), "get_payout_item", {
      payout_item_id: "8AELMXH8UB2P8",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PayoutsApiError);
    expect(error).toMatchObject({ status: 404, paypalName: "INVALID_RESOURCE_ID", debugId: "dbg-404" });
  });
});
