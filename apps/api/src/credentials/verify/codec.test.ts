import { randomUUID } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  bearerToken,
  generateOpaqueToken,
  isLinkToken,
  JudgeCookiePayload,
  OperatorCookiePayload,
  opaqueTokenSha256,
  parseOpaqueToken,
  signCookie,
  signLink,
  verifyCookie,
  verifyLink,
} from "./codec.js";
import { createCredentialKeys } from "./keys.js";

const keys = createCredentialKeys({ cookieSecret: "c".repeat(40), linkSigningKey: "2a".repeat(32) });
const NOW = Date.parse("2026-10-28T02:00:00Z");
const nowS = Math.floor(NOW / 1000);

describe("opaque bearer tokens", () => {
  it("are 256-bit, prefixed by kind, and stored only as sha256", () => {
    const frame = generateOpaqueToken("frame");
    const device = generateOpaqueToken("device");
    expect(frame).toMatch(/^fst_[A-Za-z0-9_-]{43}$/);
    expect(device).toMatch(/^fsd_[A-Za-z0-9_-]{43}$/);
    expect(parseOpaqueToken(frame)).toEqual({ kind: "frame" });
    expect(parseOpaqueToken(device)).toEqual({ kind: "device" });
    expect(opaqueTokenSha256(frame)).toMatch(/^[0-9a-f]{64}$/);
    expect(opaqueTokenSha256(frame)).not.toBe(opaqueTokenSha256(device));
  });

  it("rejects anything not shaped like one", () => {
    for (const bad of [
      "",
      "fst_",
      "fst_short",
      `fsx_${"a".repeat(43)}`,
      `fst_${"a".repeat(42)}!`,
      `FST_${"a".repeat(43)}`,
    ]) {
      expect(parseOpaqueToken(bad)).toBeNull();
    }
  });

  it("never repeat", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateOpaqueToken("frame")));
    expect(seen.size).toBe(200);
  });
});

describe("Authorization header", () => {
  it("accepts only Bearer", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer   abc")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});

describe("signed cookies (fs_js, fs_ops)", () => {
  const key = keys.hmacKey("cookie:fs_js");
  const payload = { v: 1 as const, sid: randomUUID(), ws: randomUUID(), iat: nowS, exp: nowS + 3600 };

  it("round-trip", () => {
    const v = verifyCookie(JudgeCookiePayload, key, signCookie(key, payload), NOW);
    expect(v).toEqual({ ok: true, payload });
  });

  it("expire", () => {
    const v = verifyCookie(JudgeCookiePayload, key, signCookie(key, payload), (nowS + 3600) * 1000);
    expect(v).toEqual({ ok: false, reason: "expired" });
  });

  it("refuse a cookie signed for another purpose (subkeys)", () => {
    const opsKey = keys.hmacKey("cookie:fs_ops");
    expect(opsKey.equals(key)).toBe(false);
    const forged = signCookie(opsKey, payload);
    expect(verifyCookie(JudgeCookiePayload, key, forged, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("refuse an operator payload in the judge cookie slot even when signed with the right key", () => {
    const op = signCookie(key, { v: 1, sub: "operator", iat: nowS, exp: nowS + 60 });
    expect(verifyCookie(JudgeCookiePayload, key, op, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyCookie(OperatorCookiePayload, key, op, NOW).ok).toBe(true);
  });

  it("reject any single-character tamper (property)", () => {
    const value = signCookie(key, payload);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: value.length - 1 }), fc.constantFrom(..."AZaz09-_."), (i, ch) => {
        if (value[i] === ch) return true;
        const tampered = value.slice(0, i) + ch + value.slice(i + 1);
        return !verifyCookie(JudgeCookiePayload, key, tampered, NOW).ok;
      }),
      { numRuns: 300 },
    );
  });

  it("reject junk", () => {
    for (const junk of [undefined, "", "abc", "a.b.c", "x".repeat(2000)]) {
      expect(verifyCookie(JudgeCookiePayload, key, junk, NOW).ok).toBe(false);
    }
  });
});

describe("signed links (member fsm_, brand fsb_)", () => {
  const member = {
    v: 1 as const,
    k: "member" as const,
    ws: randomUUID(),
    lineId: randomUUID(),
    jti: randomUUID(),
    exp: nowS + 86_400,
  };
  const brand = {
    v: 1 as const,
    k: "brand" as const,
    ws: randomUUID(),
    brand: "lantern-bay",
    jti: randomUUID(),
    exp: nowS + 86_400,
  };

  it("round-trip with the right prefix", () => {
    const m = signLink(keys.linkPrivateKey, member);
    const b = signLink(keys.linkPrivateKey, brand);
    expect(m.startsWith("fsm_")).toBe(true);
    expect(b.startsWith("fsb_")).toBe(true);
    expect(isLinkToken(m) && isLinkToken(b)).toBe(true);
    expect(verifyLink(keys.linkPublicKeyHex, m, NOW)).toEqual({ ok: true, payload: member });
    expect(verifyLink(keys.linkPublicKeyHex, b, NOW)).toEqual({ ok: true, payload: brand });
  });

  it("refuse another key, an expired link, and a swapped prefix", () => {
    const other = createCredentialKeys({ linkSigningKey: "3b".repeat(32) });
    const m = signLink(other.linkPrivateKey, member);
    expect(verifyLink(keys.linkPublicKeyHex, m, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    const mine = signLink(keys.linkPrivateKey, member);
    expect(verifyLink(keys.linkPublicKeyHex, mine, (member.exp + 1) * 1000)).toEqual({
      ok: false,
      reason: "expired",
    });
    // a member payload presented as a brand link fails the brand schema
    expect(verifyLink(keys.linkPublicKeyHex, `fsb_${mine.slice(4)}`, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("reject a tampered payload (property)", () => {
    const token = signLink(keys.linkPrivateKey, member);
    const dot = token.indexOf(".");
    fc.assert(
      fc.property(fc.integer({ min: 4, max: dot - 1 }), fc.constantFrom(..."AQgw"), (i, ch) => {
        if (token[i] === ch) return true;
        return !verifyLink(keys.linkPublicKeyHex, token.slice(0, i) + ch + token.slice(i + 1), NOW).ok;
      }),
      { numRuns: 200 },
    );
  });
});

describe("keys", () => {
  it("derive stable subkeys from FS_COOKIE_SECRET and go ephemeral without it", () => {
    const a = createCredentialKeys({ cookieSecret: "s".repeat(40) });
    const b = createCredentialKeys({ cookieSecret: "s".repeat(40) });
    expect(a.hmacKey("ip-hash").equals(b.hmacKey("ip-hash"))).toBe(true);
    expect(a.ephemeral).toEqual({ cookie: false, link: true });
    const c = createCredentialKeys({});
    const d = createCredentialKeys({});
    expect(c.hmacKey("ip-hash").equals(d.hmacKey("ip-hash"))).toBe(false);
    expect(c.linkPublicKeyHex).not.toBe(d.linkPublicKeyHex);
  });
});
