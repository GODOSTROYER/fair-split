import { describe, expect, it } from "vitest";
import {
  ALIAS_DOMAIN,
  assertScrubbed,
  emailAlias,
  findUnscrubbed,
  REDACTED,
  scrub,
  scrubString,
  UnscrubbedFixtureError,
} from "../src/scrub.js";

// Fake secrets are assembled at runtime so secret scanners never see a literal in the source.
const fakePayPalToken = `A21${"AA"}${"x9".repeat(30)}`;
const fakeAnthropicKey = `sk-${"ant"}-api03-${"Q".repeat(40)}`;
const fakeGoogleKey = `AI${"za"}${"S".repeat(35)}`;
const fakeJwt = `ey${"J"}hbGciOiJIUzI1NiJ9.ey${"J"}zdWIiOiIxMjM0In0.${"s".repeat(20)}`;

const recorded = {
  request: {
    method: "POST",
    url: "https://api-m.sandbox.paypal.com/v1/payments/payouts",
    headers: {
      Authorization: `Bearer ${fakePayPalToken}`,
      "PayPal-Request-Id": "2026A-7f3a91c2-r37",
      "x-api-key": fakeAnthropicKey,
    },
    body: {
      sender_batch_header: { sender_batch_id: "2026A-7f3a91c2-r37", email_subject: "Bayad na" },
      items: [
        { receiver: "nang.celing@personal.example.com", sender_item_id: "r37-M-014" },
        { receiver: "rhea.jumawan@gmail.com", sender_item_id: "r37-M-031" },
      ],
    },
  },
  response: {
    body: {
      access_token: fakePayPalToken,
      refresh_token: "opaque-refresh-value-123456",
      client_secret: "shh-not-for-git",
      note: `debug: key=${fakeGoogleKey}, jwt=${fakeJwt}, contact ops%40fairsplit.app`,
      links: [{ href: "https://api-m.sandbox.paypal.com/v1/payments/payouts/BATCH1", rel: "self" }],
    },
  },
};

describe("scrub: tokens become REDACTED", () => {
  const clean = scrub(recorded);
  const text = JSON.stringify(clean);

  it("removes every recorded secret value", () => {
    for (const secret of [fakePayPalToken, fakeAnthropicKey, fakeGoogleKey, fakeJwt, "shh-not-for-git"]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain("opaque-refresh-value-123456");
  });

  it("keeps the auth scheme and redacts the credential", () => {
    expect(clean.request.headers.Authorization).toBe(`Bearer ${REDACTED}`);
    expect(clean.request.headers["x-api-key"]).toBe(REDACTED);
    expect(clean.response.body.access_token).toBe(REDACTED);
    expect(clean.response.body.client_secret).toBe(REDACTED);
  });

  it("redacts secrets embedded in free text", () => {
    expect(clean.response.body.note).toContain(`key=${REDACTED}`);
    expect(clean.response.body.note).toContain(`jwt=${REDACTED}`);
  });

  it("keeps non-secret identifiers untouched", () => {
    expect(clean.request.headers["PayPal-Request-Id"]).toBe("2026A-7f3a91c2-r37");
    expect(clean.request.body.items[0]?.sender_item_id).toBe("r37-M-014");
    expect(clean.response.body.links[0]?.href).toBe(recorded.response.body.links[0]?.href);
  });

  it("does not mutate its input", () => {
    expect(recorded.response.body.access_token).toBe(fakePayPalToken);
  });

  it("is idempotent", () => {
    expect(scrub(clean)).toEqual(clean);
  });
});

describe("scrub: emails become sandbox aliases", () => {
  const clean = scrub(recorded);

  it("replaces every address with an alias on the reserved domain", () => {
    for (const item of clean.request.body.items) {
      expect(item.receiver).toMatch(new RegExp(`^sb-[0-9a-f]{8}@${ALIAS_DOMAIN.replace(/\./g, "\\.")}$`));
    }
    expect(JSON.stringify(clean)).not.toMatch(/gmail\.com|personal\.example\.com|fairsplit\.app/);
  });

  it("is stable: the same address always gets the same alias, different addresses differ", () => {
    expect(emailAlias("Rhea.Jumawan@gmail.com")).toBe(emailAlias("rhea.jumawan@gmail.com"));
    expect(emailAlias("a@example.com")).not.toBe(emailAlias("b@example.com"));
    const [first, second] = clean.request.body.items;
    expect(first?.receiver).not.toBe(second?.receiver);
  });

  it("handles URL-encoded addresses", () => {
    expect(scrubString("to=ops%40fairsplit.app")).toBe(`to=${emailAlias("ops@fairsplit.app")}`);
  });

  it("uses a readable alias from the alias map", () => {
    const out = scrub(
      { receiver: "nang.celing@personal.example.com" },
      { emailAliases: { "nang.celing@personal.example.com": `m-014@${ALIAS_DOMAIN}` } },
    );
    expect(out.receiver).toBe(`m-014@${ALIAS_DOMAIN}`);
    expect(scrub(out)).toEqual(out);
  });

  it("rejects a mapped alias that could reach a real inbox", () => {
    expect(() => emailAlias("x@y.com", { emailAliases: { "x@y.com": "m-014@gmail.com" } })).toThrow(
      /\.invalid/,
    );
  });
});

describe("assertScrubbed", () => {
  it("passes on scrubbed output", () => {
    expect(() => assertScrubbed(scrub(recorded))).not.toThrow();
    expect(findUnscrubbed(scrub(recorded))).toEqual([]);
  });

  it("names each unscrubbed path", () => {
    const findings = findUnscrubbed(recorded);
    const paths = findings.map((f) => f.path);
    expect(paths).toContain("$.request.headers.Authorization");
    expect(paths).toContain("$.response.body.access_token");
    expect(paths).toContain("$.request.body.items[1].receiver");
    expect(() => assertScrubbed(recorded, "payout.json")).toThrow(UnscrubbedFixtureError);
  });
});
