// I1 at boot: the invoicer, the payer and the brand allowlist the policy lattice compares are strict printable-ASCII
// e-mails (domain `requireAsciiEmail`), checked once at boot (server.ts) on what `partiesOf` resolves.
import { describe, expect, it } from "vitest";
import { parseEnv } from "../env.js";
import { assertPartiesAscii, brandAllowlistOf, partiesOf } from "./policy.js";

describe("the invoicer, the payer and the brand allowlist", () => {
  it("on the simulated rail, the labelled aliases are plain ASCII and the allowlist is the payer alone", () => {
    const env = parseEnv({ PP_MODE: "simulator" });
    expect(() => assertPartiesAscii(env)).not.toThrow();
    const parties = partiesOf({ env });
    expect(parties.source).toBe("seeded_alias");
    expect(brandAllowlistOf(parties)).toEqual([parties.payer.email]);
  });

  it("from env: the configured addresses, the allowlist the payer's", () => {
    const env = parseEnv({
      PP_BUSINESS_EMAIL: "coop-business@example.com",
      PP_PAYER_EMAIL: "lantern-bay@example.com",
    });
    expect(() => assertPartiesAscii(env)).not.toThrow();
    expect(brandAllowlistOf(partiesOf({ env }))).toEqual(["lantern-bay@example.com"]);
  });

  it("refuses a lookalike payer that reached the boot check, naming the setting and never the address", () => {
    const env = parseEnv({ PP_BUSINESS_EMAIL: "coop-business@example.com", PP_PAYER_EMAIL: "a@example.com" });
    const tampered = { ...env, paypal: { ...env.paypal, payerEmail: "lantern-b\u0430y@example.com" } };
    expect(() => assertPartiesAscii(tampered)).toThrow(
      /^PP_PAYER_EMAIL is not a plain ASCII e-mail address$/,
    );
    try {
      assertPartiesAscii(tampered);
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("example.com");
    }
  });

  it("a sandbox rail without the two addresses still boots; its invoice steps refuse until they are set", () => {
    const env = parseEnv({
      PP_MODE: "sandbox",
      PP_CLIENT_ID: "test-client",
      PP_CLIENT_SECRET: "test-secret",
      PP_WEBHOOK_ID: "WHTEST",
    });
    expect(() => assertPartiesAscii(env)).not.toThrow();
    expect(() => partiesOf({ env })).toThrow(/PP_BUSINESS_EMAIL and PP_PAYER_EMAIL are required/);
  });
});
