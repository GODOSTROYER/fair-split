import { describe, expect, it, vi } from "vitest";
import {
  AgentToolNotAllowedError,
  AgentToolRefusedError,
  conditionalRuleRequestId,
  PayPalToolkit,
  runAgentToolkitTool,
  type Tk,
} from "../src/index.js";
import { createdLink, fakeAuth, INVOICE_ID, invoiceBody } from "./support/fixtures.js";
import { onGet, onPost, paypalEmpty, paypalJson, requests, useMsw } from "./support/msw.js";

useMsw();

const approval = { approverId: "persona:analyn", approvedAt: "2026-11-05T02:00:00.000Z" };
const autoCancel = (date = "2026-11-30") => ({
  invoice_id: INVOICE_ID,
  rules: [
    {
      conditional_rule_type: "AUTO_CANCEL",
      rule_expiry_terms: { rule_expiry_condition: "SPECIFIC_DATE", condition_rule_end_date: date },
    },
  ],
});

describe("runAgentToolkitTool: the agent's only door to PayPal", () => {
  const tk = () => new PayPalToolkit({ auth: fakeAuth() }).tk;

  it("parks send_invoice until the treasurer approves, then sends it unmailed", async () => {
    onPost("/v2/invoicing/invoices/:id/send", () =>
      paypalJson({ rel: "payer-view", href: "https://x.test", method: "GET" }),
    );
    const pending = await runAgentToolkitTool(tk(), "send_invoice", {
      invoice_id: INVOICE_ID,
      send_to_recipient: true,
      note: "Season premium",
    });
    expect(pending).toEqual({
      status: "PENDING_APPROVAL",
      method: "send_invoice",
      args: { invoice_id: INVOICE_ID, send_to_recipient: false, note: "Season premium" },
    });
    expect(requests).toHaveLength(0);

    const sent = await runAgentToolkitTool(
      tk(),
      "send_invoice",
      { invoice_id: INVOICE_ID },
      { treasurerApproval: approval },
    );
    expect(sent.status).toBe("DONE");
    expect(requests[0]?.body).toEqual({ invoice_id: INVOICE_ID, send_to_recipient: false });
  });

  it("refuses extra recipients on a send", async () => {
    await expect(
      runAgentToolkitTool(
        tk(),
        "send_invoice",
        { invoice_id: INVOICE_ID, additional_recipients: ["attacker@example.test"] },
        { treasurerApproval: approval },
      ),
    ).rejects.toBeInstanceOf(AgentToolRefusedError);
    expect(requests).toHaveLength(0);
  });

  it("sends AUTO_CANCEL on a SPECIFIC_DATE under request id cr-{invoiceId}", async () => {
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    await runAgentToolkitTool(tk(), "create_conditional_rules_for_invoice", autoCancel());
    expect(requests[0]?.headers.get("paypal-request-id")).toBe(conditionalRuleRequestId(INVOICE_ID));
    expect(conditionalRuleRequestId(INVOICE_ID)).toBe(`cr-${INVOICE_ID}`);
  });

  it.each([
    [
      "an early-payment discount",
      {
        invoice_id: INVOICE_ID,
        rules: [
          {
            conditional_rule_type: "EARLY_PAYMENT_DISCOUNT",
            conditional_rule_value_type: "PERCENT",
            conditional_rule_value: "10",
            rule_expiry_terms: {
              rule_expiry_condition: "SPECIFIC_DATE",
              condition_rule_end_date: "2026-11-30",
            },
          },
        ],
      },
    ],
    [
      "a relative expiry",
      {
        invoice_id: INVOICE_ID,
        rules: [
          {
            conditional_rule_type: "AUTO_CANCEL",
            rule_expiry_terms: {
              rule_expiry_condition: "THIRTY_DAYS_AFTER_ISSUE_DATE",
              condition_rule_end_date: "2026-12-05",
            },
          },
        ],
      },
    ],
    [
      "two rules",
      { invoice_id: INVOICE_ID, rules: [...autoCancel().rules, ...autoCancel("2026-12-01").rules] },
    ],
  ])("refuses %s", async (_label, args) => {
    await expect(
      runAgentToolkitTool(tk(), "create_conditional_rules_for_invoice", args),
    ).rejects.toBeInstanceOf(AgentToolRefusedError);
    expect(requests).toHaveLength(0);
  });

  it("passes create_invoice and get_invoice through tk()", async () => {
    onPost("/v2/invoicing/invoices", () => paypalJson(createdLink(), 201));
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody()));
    const created = await runAgentToolkitTool(tk(), "create_invoice", {
      currency_code: "USD",
      primary_recipients: [],
      items: [],
    });
    expect(created).toEqual({ status: "DONE", method: "create_invoice", result: createdLink() });
    const got = await runAgentToolkitTool(tk(), "get_invoice", { invoice_id: INVOICE_ID });
    expect(got.status).toBe("DONE");
  });

  it("refuses arguments the toolkit schema rejects, before anything is sent", async () => {
    await expect(runAgentToolkitTool(tk(), "get_invoice", { invoice_id: "a/b" })).rejects.toBeInstanceOf(
      AgentToolRefusedError,
    );
  });

  it.each([
    "record_payment_for_invoice",
    "search_invoicing",
    "create_payout_batch",
    "cancel_unclaimed_payout_item",
    "cancel_sent_invoice",
    "delete_invoice",
    "create_refund",
    "pay_order",
    "generate_invoice_qr_code",
    "update_invoicing",
  ])("contract: the agent cannot reach %s", async (tool) => {
    const spy = vi.fn() as unknown as Tk;
    await expect(runAgentToolkitTool(spy, tool, {})).rejects.toBeInstanceOf(AgentToolNotAllowedError);
    expect(spy).not.toHaveBeenCalled();
  });
});
