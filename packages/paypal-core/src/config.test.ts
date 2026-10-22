import { describe, expect, it } from "vitest";
import { loadPayPalConfig } from "./config.js";
import { PayPalConfigError } from "./errors.js";

// Values are assembled at runtime so no credential-shaped literal is committed.
const id = ["client", "id", "1"].join("-");
const secret = ["client", "secret", "1"].join("-");

function catchConfig(fn: () => unknown): PayPalConfigError {
  try {
    fn();
  } catch (err) {
    if (err instanceof PayPalConfigError) return err;
    throw err;
  }
  throw new Error("expected a PayPalConfigError");
}

describe("loadPayPalConfig", () => {
  it("reads the PP_* names from the specs", () => {
    const config = loadPayPalConfig({
      PP_ENV: "sandbox",
      PP_CLIENT_ID: id,
      PP_CLIENT_SECRET: secret,
      PP_WEBHOOK_ID: "8PT597110X687430LKGECATA",
    });
    expect(config).toEqual({
      env: "sandbox",
      baseUrl: "https://api-m.sandbox.paypal.com",
      clientId: id,
      clientSecret: secret,
      webhookId: "8PT597110X687430LKGECATA",
      devMocks: false,
    });
  });

  it("falls back to the PAYPAL_* names in .env.example", () => {
    const config = loadPayPalConfig(
      { PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret },
      { requireWebhookId: false },
    );
    expect(config.clientId).toBe(id);
    expect(config.webhookId).toBeNull();
  });

  it("refuses anything but the sandbox", () => {
    expect(
      catchConfig(() => loadPayPalConfig({ PP_ENV: "live", PP_CLIENT_ID: id, PP_CLIENT_SECRET: secret }))
        .code,
    ).toBe("NOT_SANDBOX");
    expect(catchConfig(() => loadPayPalConfig({ PP_CLIENT_ID: id, PP_CLIENT_SECRET: secret })).code).toBe(
      "MISSING_ENV",
    );
  });

  it("names missing variables without echoing any value", () => {
    const err = catchConfig(() => loadPayPalConfig({ PP_ENV: "sandbox", PP_CLIENT_ID: id }));
    expect(err.code).toBe("MISSING_ENV");
    expect(err.variables).toEqual(["PP_CLIENT_SECRET", "PP_WEBHOOK_ID"]);
    expect(err.message).not.toContain(id);
  });

  it("refuses the simulator's literal WEBHOOK_ID as the real webhook id", () => {
    const err = catchConfig(() =>
      loadPayPalConfig({
        PP_ENV: "sandbox",
        PP_CLIENT_ID: id,
        PP_CLIENT_SECRET: secret,
        PP_WEBHOOK_ID: "WEBHOOK_ID",
      }),
    );
    expect(err.code).toBe("WEBHOOK_ID_IS_MOCK_LITERAL");
  });

  it("refuses a malformed webhook id", () => {
    const err = catchConfig(() =>
      loadPayPalConfig({
        PP_ENV: "sandbox",
        PP_CLIENT_ID: id,
        PP_CLIENT_SECRET: secret,
        PP_WEBHOOK_ID: "../x",
      }),
    );
    expect(err.code).toBe("INVALID_VALUE");
  });

  it("allows dev mocks in development and refuses them in production", () => {
    const base = {
      PP_ENV: "sandbox",
      PP_CLIENT_ID: id,
      PP_CLIENT_SECRET: secret,
      PP_WEBHOOK_ID: "WH1",
      PP_DEV_MOCKS: "1",
    };
    expect(loadPayPalConfig({ ...base, NODE_ENV: "development" }).devMocks).toBe(true);
    expect(catchConfig(() => loadPayPalConfig({ ...base, NODE_ENV: "production" })).code).toBe(
      "DEV_MOCKS_IN_PRODUCTION",
    );
    expect(loadPayPalConfig({ ...base, PP_DEV_MOCKS: "0", NODE_ENV: "production" }).devMocks).toBe(false);
  });
});
