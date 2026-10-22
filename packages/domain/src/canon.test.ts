import { describe, expect, it } from "vitest";
import { jcs, jcsBytes, jcsSha256, sha256Hex } from "./canon.js";
import { ed25519FromSeed, ed25519Sign, ed25519Verify } from "./sig.js";
import { uuidv7, uuidv7Time } from "./uuid.js";

describe("JCS and sha256", () => {
  it("canonicalizes key order, whitespace and numbers (RFC 8785)", () => {
    expect(jcs({ b: 1, a: [true, null, "x"] })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(jcs({ z: { y: 2, x: 1 } })).toBe('{"z":{"x":1,"y":2}}');
    expect(jcs(1e21)).toBe("1e+21");
    expect(jcs(0.1 + 0.2)).toBe("0.30000000000000004");
    expect(jcs("€")).toBe('"€"');
  });

  it("refuses values JSON cannot carry", () => {
    expect(() => jcs(undefined)).toThrow(TypeError);
    expect(() => jcs({ a: 10n })).toThrow();
    expect(() => jcs(Number.NaN)).toThrow();
  });

  it("hashes known vectors", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(sha256Hex("abc"));
    expect(jcsSha256({ b: 1, a: 2 })).toBe(jcsSha256({ a: 2, b: 1 }));
    expect(new TextDecoder().decode(jcsBytes({ a: "₱" }))).toBe('{"a":"₱"}');
  });
});

describe("deterministic UUIDv7", () => {
  it("is a valid v7 UUID carrying its timestamp", () => {
    const ms = Date.parse("2026-10-29T01:00:00.000Z");
    const id = uuidv7(ms, "run:2026A-r37");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidv7Time(id)).toBe(ms);
    expect(uuidv7(ms, "run:2026A-r37")).toBe(id);
    expect(uuidv7(ms, "run:2026A-r38")).not.toBe(id);
    expect(() => uuidv7(-1, "x")).toThrow(RangeError);
  });
});

describe("Ed25519", () => {
  const seed = sha256Hex("test key");
  it("signs and verifies over raw keys", () => {
    const k = ed25519FromSeed(seed);
    expect(k.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
    const sig = ed25519Sign(k.privateKey, "payload");
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
    expect(ed25519Verify(k.publicKeyHex, "payload", sig)).toBe(true);
    expect(ed25519Verify(k.publicKeyHex, "payload!", sig)).toBe(false);
    expect(ed25519FromSeed(seed).publicKeyHex).toBe(k.publicKeyHex);
  });

  it("never throws on bad input", () => {
    const other = ed25519FromSeed(sha256Hex("other"));
    const sig = ed25519Sign(ed25519FromSeed(seed).privateKey, "m");
    expect(ed25519Verify(other.publicKeyHex, "m", sig)).toBe(false);
    expect(ed25519Verify("zz", "m", sig)).toBe(false);
    expect(ed25519Verify(other.publicKeyHex, "m", "00")).toBe(false);
    expect(() => ed25519FromSeed("short")).toThrow(RangeError);
  });
});
