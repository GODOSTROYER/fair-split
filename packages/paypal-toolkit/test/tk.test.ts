import { delay, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import {
  PayPalToolkit,
  ToolkitArgsError,
  type ToolkitCallRecord,
  ToolkitError,
  type ToolkitMethod,
  ToolkitMethodError,
} from "../src/index.js";
import { createdLink, fakeAuth, INVOICE_ID, invoiceBody, paypalError } from "./support/fixtures.js";
import { onGet, onPost, paypalJson, requests, sequence, useMsw } from "./support/msw.js";

useMsw();

const minimalCreate = {
  currency_code: "USD",
  invoice_number: "FS-2026A-r37",
  primary_recipients: [{ billing_info: { email_address: "lantern-bay@example.test" } }],
  items: [{ name: "Premium", quantity: "1", unit_amount: { currency_code: "USD", value: "2887.50" } }],
};

function kit(overrides: Partial<ConstructorParameters<typeof PayPalToolkit>[0]> = {}) {
  const auth = fakeAuth();
  const calls: ToolkitCallRecord[] = [];
  const toolkit = new PayPalToolkit({ auth, onCall: (r) => void calls.push(r), ...overrides });
  return { toolkit, auth, calls };
}

describe("tk(): the toolkit's PayPalAPI on our injected token (G1)", () => {
  it("runs create_invoice through the toolkit with our bearer token and records the debug id", async () => {
    onPost("/v2/invoicing/invoices", () => paypalJson(createdLink(), 201, "dbg-create-1"));
    const { toolkit, auth, calls } = kit();

    const out = await toolkit.tk("create_invoice", minimalCreate);

    expect(out).toEqual(createdLink());
    expect(auth.token).toHaveBeenCalledTimes(1);
    const [req] = requests;
    expect(req?.headers.get("authorization")).toBe("Bearer test-token-1");
    expect(req?.headers.get("paypal-request-id")).toBeNull();
    expect(req?.headers.get("user-agent")).toContain("PayPal Agent Toolkit Typescript: FairSplit");
    // The toolkit, not our code, nests the flat arguments into PayPal's invoice body.
    expect(req?.body).toMatchObject({
      detail: { invoice_number: "FS-2026A-r37", currency_code: "USD" },
      items: minimalCreate.items,
    });
    expect(calls).toEqual([
      expect.objectContaining({
        method: "create_invoice",
        ok: true,
        status: 201,
        debugId: "dbg-create-1",
        attempt: 1,
      }),
    ]);
  });

  it("sends PayPal-Request-Id only when the caller gives one", async () => {
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalJson({}, 201));
    const { toolkit } = kit();
    await toolkit.tk(
      "create_conditional_rules_for_invoice",
      {
        invoice_id: INVOICE_ID,
        rules: [
          {
            conditional_rule_type: "AUTO_CANCEL",
            rule_expiry_terms: {
              rule_expiry_condition: "SPECIFIC_DATE",
              condition_rule_end_date: "2026-11-30",
            },
          },
        ],
      },
      `cr-${INVOICE_ID}`,
    );
    expect(requests[0]?.headers.get("paypal-request-id")).toBe(`cr-${INVOICE_ID}`);
  });

  it("validates arguments with the toolkit's own zod schema before anything is sent", async () => {
    const { toolkit, auth } = kit();
    await expect(toolkit.tk("get_invoice", { invoice_id: "../../v1/oauth2/token" })).rejects.toBeInstanceOf(
      ToolkitArgsError,
    );
    await expect(toolkit.tk("record_payment_for_invoice", { invoice_id: INVOICE_ID })).rejects.toBeInstanceOf(
      ToolkitArgsError,
    );
    expect(auth.token).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it("refuses any method outside the server allowlist", async () => {
    const { toolkit } = kit();
    for (const method of ["create_payout_batch", "cancel_sent_invoice", "create_refund", "pay_order"]) {
      await expect(toolkit.tk(method as ToolkitMethod, {})).rejects.toBeInstanceOf(ToolkitMethodError);
    }
    expect(requests).toHaveLength(0);
  });

  it("turns PayPal's error into a ToolkitError that keeps status and debug id (run() drops them)", async () => {
    onGet("/v2/invoicing/invoices/:id", () =>
      paypalJson(paypalError("RESOURCE_NOT_FOUND", "The specified resource does not exist."), 404, "dbg-404"),
    );
    const { toolkit, calls } = kit();
    const error = await toolkit.tk("get_invoice", { invoice_id: INVOICE_ID }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolkitError);
    expect(error).toMatchObject({
      method: "get_invoice",
      status: 404,
      code: "PAYPAL_API_HTTP_ERROR",
      debugId: "dbg-404",
      outcomeUnknown: false,
    });
    expect(calls[0]).toMatchObject({ ok: false, status: 404, errorCode: "PAYPAL_API_HTTP_ERROR" });
  });

  it("on a 401 invalidates the shared token and retries once", async () => {
    onGet(
      "/v2/invoicing/invoices/:id",
      sequence(
        () =>
          paypalJson({ error: "invalid_token", error_description: "Access Token not found in cache" }, 401),
        () => paypalJson(invoiceBody()),
      ),
    );
    const { toolkit, auth, calls } = kit();
    const out = await toolkit.tk<{ id: string }>("get_invoice", { invoice_id: INVOICE_ID });
    expect(out.id).toBe(INVOICE_ID);
    expect(auth.invalidate).toHaveBeenCalledTimes(1);
    expect(requests.map((r) => r.headers.get("authorization"))).toEqual([
      "Bearer test-token-1",
      "Bearer test-token-2",
    ]);
    expect(calls.map((c) => c.attempt)).toEqual([1, 2]);
  });

  it("does not retry a second 401", async () => {
    onGet("/v2/invoicing/invoices/:id", () => paypalJson({ error: "invalid_token" }, 401));
    const { toolkit, auth } = kit();
    await expect(toolkit.tk("get_invoice", { invoice_id: INVOICE_ID })).rejects.toMatchObject({
      status: 401,
    });
    expect(auth.invalidate).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(2);
  });

  it("reports a dropped connection as an unknown outcome", async () => {
    onPost("/v2/invoicing/invoices", () => HttpResponse.error());
    const { toolkit } = kit();
    const error = (await toolkit
      .tk("create_invoice", minimalCreate)
      .catch((e: unknown) => e)) as ToolkitError;
    expect(error).toBeInstanceOf(ToolkitError);
    expect(error.status).toBeNull();
    expect(error.outcomeUnknown).toBe(true);
    expect(error.transportError).not.toBeNull();
  });

  it("gives the toolkit's unbounded requests our timeout", async () => {
    onGet("/v2/invoicing/invoices/:id", async () => {
      await delay(2_000);
      return paypalJson(invoiceBody());
    });
    const { toolkit } = kit({ timeoutMs: 50 });
    const error = (await toolkit
      .tk("get_invoice", { invoice_id: INVOICE_ID })
      .catch((e: unknown) => e)) as ToolkitError;
    expect(error).toBeInstanceOf(ToolkitError);
    expect(error.outcomeUnknown).toBe(true);
    expect(error.transportError).toBe("ECONNABORTED");
  });

  it("takes a limiter token per attempt, at the caller's priority", async () => {
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody()));
    const take = vi.fn(async () => undefined);
    const { toolkit } = kit({ limiter: { take }, priority: "background" });
    await toolkit.tk("get_invoice", { invoice_id: INVOICE_ID });
    await toolkit.tk("get_invoice", { invoice_id: INVOICE_ID }, undefined, { priority: "live" });
    expect(take.mock.calls).toEqual([
      [{ purpose: "toolkit:get_invoice", priority: "background" }],
      [{ purpose: "toolkit:get_invoice", priority: "live" }],
    ]);
  });

  it("sends nothing when the limiter denies the call", async () => {
    const { toolkit, auth } = kit({
      limiter: { take: async () => Promise.reject(new Error("RATE_LIMITED")) },
    });
    await expect(toolkit.tk("get_invoice", { invoice_id: INVOICE_ID })).rejects.toThrow("RATE_LIMITED");
    expect(auth.token).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it("keeps each concurrent call's debug id to itself", async () => {
    onGet("/v2/invoicing/invoices/:id", async ({ url }) => {
      const id = url.pathname.split("/").pop() as string;
      await delay(id.endsWith("A") ? 40 : 5);
      return paypalJson(invoiceBody({ id }), 200, `dbg-${id}`);
    });
    const { toolkit, calls } = kit();
    await Promise.all([
      toolkit.tk("get_invoice", { invoice_id: "INV2-AAAA-AAAA-AAAA-AAAA" }),
      toolkit.tk("get_invoice", { invoice_id: "INV2-BBBB-BBBB-BBBB-BBBB" }),
    ]);
    expect(calls.map((c) => c.debugId).sort()).toEqual([
      "dbg-INV2-AAAA-AAAA-AAAA-AAAA",
      "dbg-INV2-BBBB-BBBB-BBBB-BBBB",
    ]);
  });

  it("never fails a completed call because the recorder failed", async () => {
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody()));
    const { toolkit } = kit({
      onCall: () => {
        throw new Error("paypal_calls insert failed");
      },
    });
    await expect(toolkit.tk("get_invoice", { invoice_id: INVOICE_ID })).resolves.toMatchObject({
      id: INVOICE_ID,
    });
  });
});
