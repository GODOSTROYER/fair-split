import { describe, expect, it } from "vitest";
import { redact, requireEnv } from "../src/util/env.js";

describe("env loader", () => {
  it("names a missing variable without printing any value", () => {
    const name = "FAIRSPLIT_MEDIA_TEST_MISSING_VAR";
    delete process.env[name];
    expect(() => requireEnv(name)).toThrow(/Missing FAIRSPLIT_MEDIA_TEST_MISSING_VAR/);
  });

  it("returns a set variable", () => {
    process.env.FAIRSPLIT_MEDIA_TEST_SET = "value-123456";
    expect(requireEnv("FAIRSPLIT_MEDIA_TEST_SET")).toBe("value-123456");
  });

  it("redacts secret values from messages", () => {
    expect(redact("key=abcdefgh12345 failed", ["abcdefgh12345"])).toBe("key=REDACTED failed");
    expect(redact("short ab", ["ab"])).toBe("short ab");
  });
});
