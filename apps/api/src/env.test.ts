import { describe, expect, it } from "vitest";
import { BootRefusal, killEnv, parseEnv } from "./env.js";

// A distinctive fake value (deliberately not key-shaped, so the secret guards stay quiet): it must never be echoed.
const SECRET_LOOKING = "not-a-real-secret-value-7f3a91c2-0123456789";

function refusal(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (e) {
    expect(e).toBeInstanceOf(BootRefusal);
    return [...(e as BootRefusal).problems];
  }
  throw new Error("expected a boot refusal");
}

const PROD = {
  NODE_ENV: "production",
  PP_ENV: "sandbox",
  DATABASE_URL: "postgres://fs_app@db/fairsplit",
  FS_COOKIE_SECRET: "x".repeat(40),
  FS_LINK_SIGNING_KEY: "ab".repeat(32),
};

describe("env: boot refusals (S3.13)", () => {
  it("defaults to the simulated rail on a local machine, with warnings instead of refusals", () => {
    const env = parseEnv({});
    expect(env.paypal.mode).toBe("simulator");
    expect(env.paypal.env).toBe("sandbox");
    expect(env.port).toBe(8787);
    expect(env.production).toBe(false);
    expect(env.warnings.join(" ")).toMatch(/PP_ENV unset/);
    expect(env.warnings.join(" ")).toMatch(/ephemeral/);
  });

  it("refuses any PP_ENV but sandbox, and accepts the scaffold's PAYPAL_ENV spelling", () => {
    expect(refusal({ PP_ENV: "live" })).toEqual([
      "PP_ENV must be sandbox: Fair Split never talks to live PayPal",
    ]);
    expect(refusal({ PAYPAL_ENV: "production" })[0]).toMatch(/PP_ENV must be sandbox/);
    expect(parseEnv({ PAYPAL_ENV: "sandbox" }).paypal.env).toBe("sandbox");
  });

  it("refuses a missing PP_ENV in production", () => {
    const { PP_ENV: _drop, ...rest } = PROD;
    expect(refusal(rest)).toContain("PP_ENV is missing (set PP_ENV=sandbox)");
  });

  it("refuses dev mocks on Render or in production", () => {
    expect(refusal({ ...PROD, PP_DEV_MOCKS: "1" })[0]).toMatch(/PP_DEV_MOCKS/);
    const { NODE_ENV: _n, ...onRender } = PROD;
    expect(refusal({ ...onRender, RENDER: "true", PP_DEV_MOCKS: "true" })[0]).toMatch(/PP_DEV_MOCKS/);
    expect(parseEnv({ PP_DEV_MOCKS: "1" }).paypal.devMocks).toBe(true);
  });

  it("PP_MODE=sandbox needs credentials and a webhook id", () => {
    expect(refusal({ PP_MODE: "sandbox" })).toEqual([
      "PP_MODE=sandbox needs PP_CLIENT_ID, PP_CLIENT_SECRET, PP_WEBHOOK_ID",
    ]);
    const env = parseEnv({
      PP_MODE: "sandbox",
      PAYPAL_CLIENT_ID: "id",
      PAYPAL_CLIENT_SECRET: "s",
      PP_WEBHOOK_ID: "W1",
    });
    expect(env.paypal.mode).toBe("sandbox");
    expect(env.paypal.clientId).toBe("id");
  });

  it("production needs the cookie and link keys and a database", () => {
    const problems = refusal({ NODE_ENV: "production", PP_ENV: "sandbox" });
    expect(problems).toEqual(
      expect.arrayContaining([
        "FS_COOKIE_SECRET is required in production",
        "FS_LINK_SIGNING_KEY is required in production",
        "DATABASE_URL is required in production",
      ]),
    );
    expect(parseEnv(PROD).production).toBe(true);
  });

  it("rejects malformed secrets without echoing their values", () => {
    const problems = refusal({
      FS_COOKIE_SECRET: "short",
      FS_LINK_SIGNING_KEY: SECRET_LOOKING,
      JUDGE_CODE_SHA256: "nope",
    });
    expect(problems).toHaveLength(3);
    for (const p of problems) {
      expect(p).not.toContain(SECRET_LOOKING);
      expect(p).not.toContain("short");
    }
  });

  it("EXECUTOR=workflow needs RENDER_API_KEY", () => {
    expect(refusal({ EXECUTOR: "workflow" })).toEqual(["EXECUTOR=workflow needs RENDER_API_KEY"]);
  });

  it("lists every problem at once", () => {
    expect(refusal({ PP_ENV: "live", PP_MODE: "sandbox", EXECUTOR: "workflow" })).toHaveLength(3);
  });

  it("reads the PayPal account variables in both spellings (render.yaml PP_*, .env.example PAYPAL_*)", () => {
    const scaffold = parseEnv({
      PAYPAL_BUSINESS_EMAIL: "coop@business.example.com",
      PAYPAL_BUYER_EMAIL: "lanternbay@personal.example.com",
      PAYPAL_MEMBER_EMAILS: "m014@personal.example.com",
    }).paypal;
    expect(scaffold).toMatchObject({
      businessEmail: "coop@business.example.com",
      payerEmail: "lanternbay@personal.example.com",
      receivers: "m014@personal.example.com",
    });
    const both = parseEnv({ PP_BUSINESS_EMAIL: "a@x.example", PAYPAL_BUSINESS_EMAIL: "b@x.example" }).paypal;
    expect(both.businessEmail).toBe("a@x.example");
  });

  it("type errors name the variable, not the value", () => {
    const problems = refusal({ PORT: "eighty", PP_MODE: "real" });
    expect(problems.join(" ")).toMatch(/PORT/);
    expect(problems.join(" ")).toMatch(/PP_MODE/);
    expect(problems.join(" ")).not.toContain("eighty");
  });

  it("normalises the public origin and passes only kill variables to flag reads", () => {
    const env = parseEnv({
      PUBLIC_ORIGIN: "https://fs-api.onrender.com/some/path",
      FS_KILL: "payouts",
      ANTHROPIC_API_KEY: SECRET_LOOKING,
    });
    expect(env.publicOrigin).toBe("https://fs-api.onrender.com");
    expect(killEnv(env)).toEqual({
      FS_KILL: "payouts",
      KILL_PAYOUTS: undefined,
      KILL_PAYPAL_LIVE: undefined,
      KILL_AI_LIVE: undefined,
    });
  });
});

describe("env: PayPal e-mail settings are plain ASCII (domain requireAsciiEmail, I1)", () => {
  // U+0430 CYRILLIC SMALL LETTER A: looks like "a", folds to nothing the lattice would match
  const LOOKALIKE = "coop@busin\u0430ss.example.com";

  it("refuses a lookalike or malformed address in any PP_* e-mail setting, naming the setting, never the value", () => {
    const problems = refusal({
      PP_BUSINESS_EMAIL: LOOKALIKE,
      PP_PAYER_EMAIL: "lantern bay@example.com",
      PP_UNCLAIMED_RECEIVER: "rhea.example.com",
      PP_RECEIVERS: JSON.stringify({ "M-014": "m014@example.com", "M-031": `m031${"\u212A"}@example.com` }),
    });
    expect(problems).toEqual([
      "PP_BUSINESS_EMAIL is not a plain ASCII e-mail address",
      "PP_PAYER_EMAIL is not a plain ASCII e-mail address",
      "PP_UNCLAIMED_RECEIVER is not a plain ASCII e-mail address",
      "PP_RECEIVERS[M-031] is not a plain ASCII e-mail address",
    ]);
    expect(problems.join(" ")).not.toContain("example.com");
  });

  it("checks every receiver pair and the scaffold's spellings, and refuses unreadable JSON", () => {
    expect(refusal({ PAYPAL_MEMBER_EMAILS: "M-014=m014@example.com, M-007=m 007@example.com" })).toEqual([
      "PAYPAL_MEMBER_EMAILS[M-007] is not a plain ASCII e-mail address",
    ]);
    expect(refusal({ PAYPAL_BUYER_EMAIL: LOOKALIKE })).toEqual([
      "PAYPAL_BUYER_EMAIL is not a plain ASCII e-mail address",
    ]);
    expect(refusal({ PP_RECEIVERS: "{not json" })[0]).toMatch(/PP_RECEIVERS must be a JSON map/);
  });

  it("accepts plain ASCII addresses, punycode TLDs included", () => {
    const env = parseEnv({
      PP_BUSINESS_EMAIL: "coop@business.example.com",
      PP_PAYER_EMAIL: "lantern-bay@shop.xn--p1ai",
      PP_RECEIVERS: "M-014=m014@example.com,M-031=m031@example.com",
    });
    expect(env.paypal.payerEmail).toBe("lantern-bay@shop.xn--p1ai");
  });
});

describe("env: PP_CERT_ALLOW pins PayPal webhook cert ids for paypal-core", () => {
  const current = "CERT-360caa42-fca2a594-bf9ab596";
  const next = "CERT-360caa42-fca2a594-0e1c0de5";

  it("reads ids and sandbox cert URLs, deduplicated, in order", () => {
    const env = parseEnv({
      PP_CERT_ALLOW: ` ${current},https://api-m.sandbox.paypal.com/v1/notifications/certs/${next} ${current}`,
    });
    expect(env.paypal.knownCertIds).toEqual([current, next]);
    expect(parseEnv({ PAYPAL_CERT_ALLOW: current }).paypal.knownCertIds).toEqual([current]);
    expect(parseEnv({}).paypal.knownCertIds).toEqual([]);
  });

  it("refuses anything else (a live-PayPal URL, an unknown shape, more than 8 ids), naming only the variable", () => {
    for (const value of [
      "CERT-nope",
      `https://api-m.paypal.com/v1/notifications/certs/${current}`,
      Array.from({ length: 9 }, (_, n) => `CERT-360caa42-fca2a594-0000000${n}`).join(","),
    ]) {
      const problems = refusal({ PP_CERT_ALLOW: value });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/^PP_CERT_ALLOW must list at most 8 PayPal cert ids/);
      expect(problems[0]).not.toContain("api-m.paypal.com");
    }
  });
});
