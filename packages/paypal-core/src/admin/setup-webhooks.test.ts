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
    [[], "--app must be dev or judge"],
    [["--app", "prod", "--url", TUNNEL], "--app must be dev or judge"],
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

describe("tools/setup-webhooks.ts: --app selects and checks the REST app's credentials", () => {
  const JUDGE_ID = "fs-judge-client";
  const JUDGE_SECRET = ["fs", "judge", "secret"].join("-");
  const RENDER = "https://fs-api.onrender.com/webhooks/paypal";
  const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;

  it.each(["dev", "fs-dev", "DEV"])("accepts --app %s", async (app) => {
    server.use(oauthHandler().handler);
    fakeWebhooksApi();
    const result = await run(["--app", app, "--url", TUNNEL, "--no-lookup"]);
    expect(result.code).toBe(0);
    expect(result.out[0]).toBe("setup-webhooks: app=fs-dev env=sandbox");
  });

  it("uses PP_CLIENT_ID_JUDGE / PP_CLIENT_SECRET_JUDGE for --app judge, and prints the app id, never the credentials", async () => {
    const oauth = oauthHandler();
    server.use(oauth.handler);
    fakeWebhooksApi();
    const result = await run(["--app", "judge", "--url", RENDER, "--no-lookup"], {
      ...ENV,
      PP_CLIENT_ID_JUDGE: JUDGE_ID,
      PP_CLIENT_SECRET_JUDGE: JUDGE_SECRET,
    });
    expect(result.code).toBe(0);
    expect(oauth.stub.authorizations).toEqual([basic(JUDGE_ID, JUDGE_SECRET)]);
    expect(result.out).toContain("credentials: PP_CLIENT_ID_JUDGE/PP_CLIENT_SECRET_JUDGE app_id=APP-FSTEST");
    expect(result.out).toContain(
      "tip: add PP_APP_ID_JUDGE=APP-FSTEST to the env so a mismatched app is refused next time",
    );
    for (const secret of [JUDGE_ID, JUDGE_SECRET, TEST_CLIENT_ID, TEST_CLIENT_SECRET]) {
      expect(result.all).not.toContain(secret);
    }
  });

  it("refuses --app fs-judge with the shared (dev) credentials before any PayPal call", async () => {
    const oauth = oauthHandler();
    server.use(oauth.handler);
    const api = fakeWebhooksApi();
    const result = await run(["--app", "fs-judge", "--url", RENDER]);
    expect(result.code).toBe(2);
    expect(result.err.join(" ")).toContain("PP_APP_ID_JUDGE");
    expect(oauth.stub.calls).toBe(0);
    expect(api.writes).toEqual([]);
  });

  it("accepts the shared credentials for judge once PP_APP_ID_JUDGE confirms them", async () => {
    server.use(oauthHandler().handler);
    const api = fakeWebhooksApi();
    const result = await run(["--app", "judge", "--url", RENDER, "--no-lookup"], {
      ...ENV,
      PP_APP_ID_JUDGE: "APP-FSTEST",
    });
    expect(result.code).toBe(0);
    expect(api.writes).toEqual([`POST ${RENDER}`]);
    expect(result.out.some((l) => l.startsWith("tip:"))).toBe(false);
  });

  it("refuses credentials whose app_id differs from PP_APP_ID_<APP>, even with --force, without writing", async () => {
    server.use(oauthHandler().handler);
    const api = fakeWebhooksApi();
    const result = await run(["--app", "judge", "--url", RENDER, "--force"], {
      ...ENV,
      PP_APP_ID_JUDGE: "APP-JUDGE0000000000",
    });
    expect(result.code).toBe(1);
    expect(result.err.join(" ")).toContain(
      "belong to app_id APP-FSTEST, but PP_APP_ID_JUDGE is APP-JUDGE0000000000",
    );
    expect(api.writes).toEqual([]);
  });

  it("refuses the other app's credentials (PP_APP_ID_DEV matches while --app judge)", async () => {
    server.use(oauthHandler().handler);
    const api = fakeWebhooksApi();
    const result = await run(["--app", "judge", "--url", RENDER], {
      ...ENV,
      PP_CLIENT_ID_JUDGE: JUDGE_ID,
      PP_CLIENT_SECRET_JUDGE: JUDGE_SECRET,
      PP_APP_ID_DEV: "APP-FSTEST",
    });
    expect(result.code).toBe(1);
    expect(result.err.join(" ")).toContain("these credentials are fs-dev's (PP_APP_ID_DEV)");
    expect(api.writes).toEqual([]);
  });

  it("refuses half-configured app credentials", async () => {
    const result = await run(["--app", "dev", "--url", TUNNEL], { ...ENV, PP_CLIENT_ID_DEV: "only-the-id" });
    expect(result.code).toBe(2);
    expect(result.err.join(" ")).toContain("set both PP_CLIENT_ID_DEV and PP_CLIENT_SECRET_DEV, or neither");
  });
});
