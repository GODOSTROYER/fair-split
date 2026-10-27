// The portable byte helpers agree with node:crypto (the server's side of Content-Digest and the hashes).
import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { contentDigest, fromHex, sha256Hex, toBase64, toHex, utf8, uuidv7 } from "./bytes.js";

describe("bytes", () => {
  it("sha256 equals node:crypto for any bytes and any text", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        expect(sha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
      }),
    );
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 80 }), (text) => {
        expect(sha256Hex(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
      }),
    );
  });

  it("base64 and hex round-trip like Buffer", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 100 }), (bytes) => {
        expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
        expect(fromHex(toHex(bytes))).toEqual(bytes);
      }),
    );
    expect(() => fromHex("abc")).toThrow();
  });

  it("Content-Digest is RFC 9530 sha-256 over the UTF-8 body (what fs-api checks)", () => {
    const body = JSON.stringify({ station: "BODEGA", note: "Nadawat ₱" });
    expect(contentDigest(body)).toBe(`sha-256=:${createHash("sha256").update(utf8(body)).digest("base64")}:`);
  });

  it("uuidv7 carries the time, version 7 and the RFC variant", () => {
    const id = uuidv7(Date.UTC(2026, 9, 28, 2, 0, 0), new Uint8Array(10).fill(0xff));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16)).toBe(Date.UTC(2026, 9, 28, 2, 0, 0));
    expect(uuidv7()).not.toBe(uuidv7());
  });
});
