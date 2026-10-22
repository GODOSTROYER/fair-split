import { describe, expect, it } from "vitest";
import {
  ALL_SCOPES,
  fakeWebhooksApi,
  oauthHandler,
  recordingSleep,
  server,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
  useMswServer,
} from "../test-support.js";
import { runSetupWebhooks } from "./setup-webhooks.js";

useMswServer();

const ENV = { PP_ENV: "sandbox", PP_CLIENT_ID: TEST_CLIENT_ID, PP_CLIENT_SECRET: TEST_CLIENT_SECRET };
const TUNNEL = "https://quiet-river-1234.trycloudflare.com/webhooks/paypal";

async function run(argv: string[], env: Record<string, string | undefined> = ENV) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runSetupWebhooks(
    argv,
    env,
    { out: (l) => out.push(l), err: (l) => err.push(l) },
    { sleep: recordingSleep().sleep },
  );
  return { code, out, err, all: [...out, ...err].join("\n") };
}

describe("tools/setup-webhooks.ts logic", () => {
  it("registers the webhook and lookup, prints PP_WEBHOOK_ID, and never prints credentials or tokens", async () => {
    server.use(oauthHandler().handler);
    const api = fakeWebhooksApi();
    const result = await run(["--app", "fs-dev", "--url", TUNNEL]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("PP_WEBHOOK_ID=WH0001");
    expect(
      result.out.some((l) => l.startsWith("webhook: created id=WH0001") && l.includes("events=15")),
    ).toBe(true);
    expect(result.out).toContain("lookup: created id=WL-1");
    expect(result.all).not.toContain(TEST_CLIENT_SECRET);
    expect(result.all).not.toContain(TEST_CLIENT_ID);
    expect(result.all).not.toContain("tok-1");
    expect(api.writes).toEqual([`POST ${TUNNEL}`, "POST lookup"]);
  });

  it("is idempotent: a second run makes no writes", async () => {
    server.use(oauthHandler().handler);
    const api = fakeWebhooksApi();
    await run(["--app", "fs-dev", "--url", TUNNEL]);
    const second = await run(["--app", "fs-dev", "--url", TUNNEL]);
    expect(second.code).toBe(0);
    expect(second.out.some((l) => l.startsWith("webhook: unchanged id=WH0001"))).toBe(true);
    expect(second.out).toContain("lookup: exists id=WL-1");
    expect(api.writes).toEqual([`POST ${TUNNEL}`, "POST lookup"]);
  });

  it("dry run plans without writing", async () => {
    server.use(oauthHandler().handler);
    const api = fakeWebhooksApi();
    const result = await run(["--app", "fs-dev", "--url", TUNNEL, "--dry-run"]);
    expect(result.code).toBe(0);
    expect(result.out.some((l) => l.includes("(planned)"))).toBe(true);
    expect(api.writes).toEqual([]);
    expect(result.out.some((l) => l.startsWith("PP_WEBHOOK_ID="))).toBe(false);
  });

  it("stops when the token lacks the webhooks scope", async () => {
    server.use(
      oauthHandler({ scope: ALL_SCOPES.replace("https://uri.paypal.com/services/applications/webhooks", "") })
        .handler,
    );
    fakeWebhooksApi();
    const result = await run(["--app", "fs-dev", "--url", TUNNEL]);
    expect(result.code).toBe(1);
    expect(result.err.join(" ")).toContain("webhooks scope");
  });

  it.each([
    [[], "--app must be fs-dev or fs-judge"],
    [["--app", "prod", "--url", TUNNEL], "--app must be fs-dev or fs-judge"],
    [["--app", "fs-dev", "--url", "http://x.trycloudflare.com/webhooks/paypal"], "must be https"],
    [["--app", "fs-dev", "--url", "https://localhost/webhooks/paypal"], "public hostname"],
    [["--app", "fs-dev", "--url", "https://x.trycloudflare.com:8443/webhooks/paypal"], "port"],
    [["--app", "fs-dev", "--url", "https://x.trycloudflare.com/hooks"], "/webhooks/paypal"],
    [["--app", "fs-judge", "--url", TUNNEL], "looks like the wrong app"],
    [["--app", "fs-dev", "--url", "https://fs-api.onrender.com/webhooks/paypal"], "looks like the wrong app"],
    [["--bogus"], "Unknown option"],
  ])("refuses bad arguments %j", async (argv, message) => {
    const result = await run(argv);
    expect(result.code).toBe(2);
    expect(result.err.join("\n")).toContain(message);
  });

  it("--force allows an unusual app/host pairing", async () => {
    server.use(oauthHandler().handler);
    fakeWebhooksApi();
    expect((await run(["--app", "fs-judge", "--url", TUNNEL, "--force", "--no-lookup"])).code).toBe(0);
  });

  it("refuses non-sandbox environments and names missing variables without values", async () => {
    const live = await run(["--app", "fs-dev", "--url", TUNNEL], { ...ENV, PP_ENV: "live" });
    expect(live.code).toBe(1);
    expect(live.err.join(" ")).toContain("PP_ENV must be set to sandbox");
    const missing = await run(["--app", "fs-dev", "--url", TUNNEL], {
      PP_ENV: "sandbox",
      PP_CLIENT_ID: TEST_CLIENT_ID,
    });
    expect(missing.code).toBe(1);
    expect(missing.err.join(" ")).toContain("PP_CLIENT_SECRET");
    expect(missing.all).not.toContain(TEST_CLIENT_ID);
  });

  it("reports an OAuth failure with its debug id", async () => {
    server.use(oauthHandler({ status: 401 }).handler);
    const result = await run(["--app", "fs-dev", "--url", TUNNEL]);
    expect(result.code).toBe(1);
    expect(result.err.join(" ")).toContain("OAuth error: PayPal OAuth failed with HTTP 401 (invalid_client)");
    expect(result.err.join(" ")).toContain("dbg-oauth-fail");
  });

  it("prints usage with --help", async () => {
    const result = await run(["--help"]);
    expect(result.code).toBe(0);
    expect(result.out[0]).toContain("Usage:");
  });
});
