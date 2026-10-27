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
      knownCertIds: [],
    });
  });

  it("reads PP_CERT_ALLOW: PayPal cert ids (or their sandbox cert URLs) to pin, e.g. the current and the next one", () => {
    const base = { PP_ENV: "sandbox", PP_CLIENT_ID: id, PP_CLIENT_SECRET: secret, PP_WEBHOOK_ID: "WH1" };
    const current = "CERT-360caa42-fca2a594-bf9ab596";
    const next = "CERT-360caa42-fca2a594-0e1c0de5";
    expect(
      loadPayPalConfig({
        ...base,
        PP_CERT_ALLOW: ` ${current},https://api-m.sandbox.paypal.com/v1/notifications/certs/${next}  ${current}`,
      }).knownCertIds,
    ).toEqual([current, next]);
    expect(loadPayPalConfig({ ...base, PAYPAL_CERT_ALLOW: current }).knownCertIds).toEqual([current]);
    expect(loadPayPalConfig({ ...base, PP_CERT_ALLOW: " " }).knownCertIds).toEqual([]);
  });

  it.each([
    ["not a cert id", "CERT-nope"],
    ["an upper-case id", "CERT-360CAA42-FCA2A594-BF9AB596"],
    ["a live-PayPal URL", "https://api-m.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596"],
    [
      "a URL with a query",
      "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596?x=1",
    ],
    ["more than 8 ids", Array.from({ length: 9 }, (_, n) => `CERT-360caa42-fca2a594-0000000${n}`).join(",")],
  ])("refuses PP_CERT_ALLOW with %s, naming the variable but not the value", (_label, value) => {
    const err = catchConfig(() =>
      loadPayPalConfig({
        PP_ENV: "sandbox",
        PP_CLIENT_ID: id,
        PP_CLIENT_SECRET: secret,
        PP_WEBHOOK_ID: "WH1",
        PP_CERT_ALLOW: value,
      }),
    );
    expect(err.code).toBe("INVALID_VALUE");
    expect(err.variables).toEqual(["PP_CERT_ALLOW"]);
    expect(err.message).not.toContain(value);
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

  // Verifier follow-up (trust, minor): S3.6.5 and S3.13 refuse PP_DEV_MOCKS=1 when RENDER=true. Render sets
  // RENDER=true on every service whatever NODE_ENV says, and anyone can have PayPal's public simulator
  // send events to our URL, so a Render deploy with dev mocks on would accept them as 'dev_mock'.
  it.each([
    ["NODE_ENV unset", {}],
    ["NODE_ENV=development", { NODE_ENV: "development" }],
    ["NODE_ENV=test", { NODE_ENV: "test" }],
  ])("refuses dev mocks on Render (RENDER=true), %s, naming the variables but no value", (_label, extra) => {
    const base = {
      PP_ENV: "sandbox",
      PP_CLIENT_ID: id,
      PP_CLIENT_SECRET: secret,
      PP_WEBHOOK_ID: "WH1",
      ...extra,
    };
    for (const render of ["true", "TRUE", " true ", "1"]) {
      for (const mocks of [{ PP_DEV_MOCKS: "1" }, { PAYPAL_DEV_MOCKS: "true" }]) {
        const err = catchConfig(() => loadPayPalConfig({ ...base, ...mocks, RENDER: render }));
        expect(err.code).toBe("DEV_MOCKS_IN_PRODUCTION");
        expect(err.variables).toEqual(["PP_DEV_MOCKS", "RENDER"]);
        expect(err.message).toMatch(/RENDER/);
      }
    }
    // Dev mocks off is fine on Render, and RENDER unset or false leaves local development alone.
    expect(loadPayPalConfig({ ...base, PP_DEV_MOCKS: "0", RENDER: "true" }).devMocks).toBe(false);
    expect(loadPayPalConfig({ ...base, RENDER: "true" }).devMocks).toBe(false);
    expect(loadPayPalConfig({ ...base, PP_DEV_MOCKS: "1", RENDER: "false" }).devMocks).toBe(true);
    expect(loadPayPalConfig({ ...base, PP_DEV_MOCKS: "1" }).devMocks).toBe(true);
  });
});
