import { describe, expect, it } from "vitest";
import { clientIpKey, UNKNOWN_CLIENT } from "./client-ip.js";

describe("clientIpKey (per-IP certificate-fetch budget)", () => {
  it.each([
    ["198.51.100.7", "198.51.100.7"],
    [" 198.51.100.7 ", "198.51.100.7"],
    ["2001:db8:1:2::1", "2001:db8:1:2::/64"],
    ["2001:0db8:0001:0002:ffff:ffff:ffff:0009", "2001:db8:1:2::/64"],
    ["[2001:db8:1:2::1]:443", "2001:db8:1:2::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["::ffff:203.0.113.9", "203.0.113.9"],
    ["::ffff:cb00:7109", "203.0.113.9"],
    ["2001:db8::203.0.113.9", "2001:db8:0:0::/64"],
  ])("%j → %j", (address, key) => {
    expect(clientIpKey(address)).toBe(key);
  });

  it.each([null, undefined, "", "unknown", "not-an-ip", "999.1.1.1", "1.2.3.4.5", "x".repeat(500)])(
    "%j shares the one budget for unknown clients",
    (value) => {
      expect(clientIpKey(value)).toBe(UNKNOWN_CLIENT);
    },
  );
});
