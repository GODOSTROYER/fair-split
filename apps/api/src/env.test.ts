import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BootRefusal, killEnv, parseEnv, TRUSTED_EDGES } from "./env.js";

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

/**
 * The two other secrets render.yaml prompts for, which fs-api needs on Render (fake: the operator hash has the PHC
 * shape boot checks, assembled at runtime, and hashes no password).
 */
const RENDER_PROMPTED = {
  FS_LEDGER_SIGNING_KEY: "cd".repeat(32),
  FS_OPERATOR_PASSWORD_SCRYPT: ["$scrypt", "ln=15,r=8,p=1", "A".repeat(22), "B".repeat(43)].join("$"),
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

  it("accepts the FS_COOKIE_SECRET Render generates (generateValue: a base64-encoded 256-bit value)", () => {
    for (const value of [randomBytes(32).toString("base64"), randomBytes(32).toString("base64url")]) {
      expect(value.length).toBeGreaterThanOrEqual(43);
      expect(parseEnv({ ...PROD, FS_COOKIE_SECRET: value }).secrets.cookieSecret).toBe(value);
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

describe("env: FS_TRUSTED_EDGE names the one hop client addresses come from (S3.9)", () => {
  const { NODE_ENV: _n, ...offRender } = PROD;
  const onRender = { ...offRender, ...RENDER_PROMPTED, RENDER_EXTERNAL_URL: "https://fs-api.onrender.com" };

  it("defaults to none off Render and to render on Render (RENDER=true is set by the platform)", () => {
    expect(parseEnv({}).trustedEdge).toBe("none");
    expect(parseEnv({ ...onRender, RENDER: "true" }).trustedEdge).toBe("render");
  });

  it("takes an explicit value anywhere and refuses anything else, naming the variable", () => {
    for (const edge of TRUSTED_EDGES) expect(parseEnv({ FS_TRUSTED_EDGE: edge }).trustedEdge).toBe(edge);
    expect(parseEnv({ ...onRender, RENDER: "true", FS_TRUSTED_EDGE: "none" }).trustedEdge).toBe("none");
    expect(parseEnv({ FS_TRUSTED_EDGE: " Render " }).trustedEdge).toBe("render");
    expect(refusal({ FS_TRUSTED_EDGE: "true-client-ip" })).toEqual([
      "FS_TRUSTED_EDGE must be one of none, proxy, cloudflare, render",
    ]);
  });

  it("warns in production off Render when nothing says which proxy is in front", () => {
    expect(parseEnv(PROD).warnings.join(" ")).toMatch(/FS_TRUSTED_EDGE/);
    expect(parseEnv({ ...PROD, FS_TRUSTED_EDGE: "proxy" }).warnings.join(" ")).not.toMatch(/FS_TRUSTED_EDGE/);
    expect(parseEnv({ ...onRender, RENDER: "true" }).warnings.join(" ")).not.toMatch(/FS_TRUSTED_EDGE/);
  });
});

describe("env: the public origin (links, pairing QR codes, the cookies' Secure flag)", () => {
  const { NODE_ENV: _n, ...offRender } = PROD;
  const RENDER_URL = "https://fs-api.onrender.com";

  it("on Render falls back to RENDER_EXTERNAL_URL, which Render sets on every web service", () => {
    const env = parseEnv({
      ...offRender,
      ...RENDER_PROMPTED,
      RENDER: "true",
      RENDER_EXTERNAL_URL: RENDER_URL,
    });
    expect(env.publicOrigin).toBe(RENDER_URL);
    expect(env.onRender).toBe(true);
  });

  it("PUBLIC_ORIGIN, then PUBLIC_BASE_URL, win over RENDER_EXTERNAL_URL (a custom domain)", () => {
    const base = { ...offRender, ...RENDER_PROMPTED, RENDER: "true", RENDER_EXTERNAL_URL: RENDER_URL };
    expect(parseEnv({ ...base, PUBLIC_ORIGIN: "https://fairsplit.example" }).publicOrigin).toBe(
      "https://fairsplit.example",
    );
    expect(parseEnv({ ...base, PUBLIC_BASE_URL: "https://pay.example/x" }).publicOrigin).toBe(
      "https://pay.example",
    );
  });

  it("on Render refuses to boot with no origin at all, rather than print localhost links", () => {
    expect(refusal({ ...offRender, RENDER: "true" })).toContain(
      "on Render, PUBLIC_ORIGIN or RENDER_EXTERNAL_URL must name the public origin",
    );
    expect(refusal({ ...offRender, RENDER: "true", RENDER_EXTERNAL_URL: "fs-api" })).toContain(
      "PUBLIC_ORIGIN must be an http(s) origin",
    );
  });

  it("off Render stays on localhost:PORT unless an origin is given", () => {
    expect(parseEnv({ PORT: "9000" }).publicOrigin).toBe("http://localhost:9000");
    expect(parseEnv({ RENDER_EXTERNAL_URL: RENDER_URL }).publicOrigin).toBe(RENDER_URL);
  });
});

describe("env: on Render every secret the Blueprint prompts for is required (a blank prompt must not deploy green)", () => {
  const { NODE_ENV: _n, ...offRender } = PROD;
  const onRender = { ...offRender, RENDER: "true", RENDER_EXTERNAL_URL: "https://fs-api.onrender.com" };
  const LEDGER =
    "FS_LEDGER_SIGNING_KEY is required on Render (unset, Proof reads Sample and changes on every restart)";
  const OPERATOR = "FS_OPERATOR_PASSWORD_SCRYPT is required on Render (unset, no one can sign in to /ops)";

  it("refuses to boot when the ledger key or the operator hash is unset, naming each", () => {
    expect(refusal(onRender)).toEqual(expect.arrayContaining([LEDGER, OPERATOR]));
    const { FS_LEDGER_SIGNING_KEY: _l, ...noLedger } = { ...onRender, ...RENDER_PROMPTED };
    expect(refusal(noLedger)).toEqual([LEDGER]);
    const { FS_OPERATOR_PASSWORD_SCRYPT: _o, ...noOperator } = { ...onRender, ...RENDER_PROMPTED };
    expect(refusal(noOperator)).toEqual([OPERATOR]);
  });

  it("treats a prompt left blank (empty or whitespace, as Render allows) as unset", () => {
    for (const blank of ["", "   "]) {
      expect(
        refusal({ ...onRender, FS_LEDGER_SIGNING_KEY: blank, FS_OPERATOR_PASSWORD_SCRYPT: blank }),
      ).toEqual(expect.arrayContaining([LEDGER, OPERATOR]));
    }
  });

  it("with all four secrets set it boots without the Sample-ledger warning; refusals never echo a value", () => {
    const env = parseEnv({ ...onRender, ...RENDER_PROMPTED });
    expect(env.onRender).toBe(true);
    expect(env.secrets.ledgerSigningKey).toBe(RENDER_PROMPTED.FS_LEDGER_SIGNING_KEY);
    expect(env.secrets.operatorPasswordScrypt).toBe(RENDER_PROMPTED.FS_OPERATOR_PASSWORD_SCRYPT);
    expect(env.warnings.join(" ")).not.toMatch(/FS_LEDGER_SIGNING_KEY/);
    const problems = refusal({ ...onRender, FS_COOKIE_SECRET: undefined, FS_LINK_SIGNING_KEY: undefined });
    expect(problems).toEqual(
      expect.arrayContaining([
        "FS_COOKIE_SECRET is required in production",
        "FS_LINK_SIGNING_KEY is required in production",
        LEDGER,
        OPERATOR,
      ]),
    );
    expect(problems.join(" ")).not.toContain(PROD.DATABASE_URL);
  });

  it("refuses an operator hash that is not a scrypt PHC string (a pasted password), naming it, never the value", () => {
    for (const pasted of [SECRET_LOOKING, "$scrypt$ln=15,r=8,p=1$short$short", "plain password 123"]) {
      const problems = refusal({ ...onRender, ...RENDER_PROMPTED, FS_OPERATOR_PASSWORD_SCRYPT: pasted });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/^FS_OPERATOR_PASSWORD_SCRYPT must be a scrypt hash in PHC form/);
      expect(problems.join(" ")).not.toContain(pasted);
    }
  });

  it("refuses one seed for both FS_LINK_SIGNING_KEY and FS_LEDGER_SIGNING_KEY, naming both, never the seed", () => {
    const same = "e7".repeat(32);
    const problems = refusal({
      ...onRender,
      ...RENDER_PROMPTED,
      FS_LINK_SIGNING_KEY: same,
      FS_LEDGER_SIGNING_KEY: same,
    });
    expect(problems).toEqual([
      "FS_LINK_SIGNING_KEY and FS_LEDGER_SIGNING_KEY must be two different seeds (links and ledger checkpoints never share a key)",
    ]);
    expect(problems.join(" ")).not.toContain(same);
    // off Render too: one key must never sign both
    expect(refusal({ FS_LINK_SIGNING_KEY: same, FS_LEDGER_SIGNING_KEY: same })).toHaveLength(1);
    expect(parseEnv({ ...onRender, ...RENDER_PROMPTED }).secrets.linkSigningKey).not.toBe(
      RENDER_PROMPTED.FS_LEDGER_SIGNING_KEY,
    );
  });

  it("with no database source on Render, names DATABASE_OWNER_URL and FS_APP_DB_PASSWORD (Render sets no DATABASE_URL)", () => {
    const { DATABASE_URL: _d, ...noDatabase } = { ...onRender, ...RENDER_PROMPTED };
    const problems = refusal(noDatabase);
    expect(problems).toEqual([
      "on Render, DATABASE_OWNER_URL and FS_APP_DB_PASSWORD are required (render.yaml sets both from fs-db; fs-api builds fs_app's DATABASE_URL from them)",
    ]);
    expect(problems.join(" ")).not.toMatch(/DATABASE_URL is required/);
    // off Render, production still names DATABASE_URL
    const { DATABASE_URL: _p, ...prodNoDb } = PROD;
    expect(refusal(prodNoDb)).toContain("DATABASE_URL is required in production");
  });

  it("off Render, production included, both stay optional: the ledger key only warns, as before", () => {
    expect(parseEnv({}).warnings.join(" ")).toMatch(/FS_LEDGER_SIGNING_KEY unset/);
    expect(parseEnv(PROD).warnings.join(" ")).toMatch(/FS_LEDGER_SIGNING_KEY unset/);
    expect(parseEnv(PROD).secrets.operatorPasswordScrypt).toBeUndefined();
  });
});
