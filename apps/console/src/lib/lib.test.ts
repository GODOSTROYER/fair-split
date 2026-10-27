// The console's pure helpers: SHA-256 (verify-core's synchronous hash in the browser), route parameters checked
// against IC-01's formats, query parameters the frozen routes do not declare, and the client env (only
// VITE_PUBLIC_* reaches the bundle).

import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readEnv } from "./env.js";
import { readingSearch, splitSearch } from "./route-params.js";
import { searchParamValue } from "./search-param.js";
import { fromHex, sha256Hex, toHex } from "./sha256.js";

describe("sha256", () => {
  it("matches the FIPS 180-4 vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("agrees with Node's crypto on any input, including UTF-8 and block edges", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 300 }), (text) => {
        expect(sha256Hex(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
      }),
      { numRuns: 200 },
    );
    for (const n of [55, 56, 63, 64, 65, 119, 120]) {
      const text = "x".repeat(n);
      expect(sha256Hex(text)).toBe(createHash("sha256").update(text).digest("hex"));
    }
  });

  it("round-trips hex and refuses malformed hex", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    expect(fromHex(toHex(bytes))).toEqual(bytes);
    expect(fromHex("abc")).toBeNull();
    expect(fromHex("zz")).toBeNull();
  });
});

describe("route and search parameters", () => {
  it("keeps register values and sets anything else to undefined (the router merges over raw search)", () => {
    expect(splitSearch({ hold: "H1", member: "M-014" })).toEqual({ hold: "H1", member: "M-014" });
    expect(splitSearch({ hold: "<script>", member: 14 })).toEqual({ hold: undefined, member: undefined });
    expect(readingSearch({ photo: "B" })).toEqual({ photo: "B" });
    expect(readingSearch({ photo: "P07" })).toEqual({ photo: "P07" });
    expect(readingSearch({ photo: "Z" })).toEqual({ photo: undefined });
  });

  it("reads undeclared query parameters as strings", () => {
    expect(searchParamValue({ play: 1 }, "play")).toBe("1");
    expect(searchParamValue({ verify: "yes" }, "verify")).toBe("yes");
    expect(searchParamValue({ flag: true }, "flag")).toBe("true");
    expect(searchParamValue({ list: [1] }, "list")).toBeUndefined();
    expect(searchParamValue({}, "missing")).toBeUndefined();
  });
});

describe("client env", () => {
  it("labels PayPal as the simulator unless the build says sandbox, and takes only an http(s) origin", () => {
    expect(readEnv({}, "http")).toEqual({
      data: "http",
      paypalRail: "simulator",
      apiBase: "",
      appBase: "/app",
    });
    expect(readEnv({ VITE_PUBLIC_FS_PAYPAL_RAIL: "sandbox" }, "mock").paypalRail).toBe("sandbox");
    expect(readEnv({ VITE_PUBLIC_FS_PAYPAL_RAIL: "live" }, "mock").paypalRail).toBe("simulator");
    expect(readEnv({ VITE_PUBLIC_FS_API_BASE: "https://api.example/v1?x=1" }, "http").apiBase).toBe(
      "https://api.example",
    );
    expect(readEnv({ VITE_PUBLIC_FS_API_BASE: "javascript:alert(1)" }, "http").apiBase).toBe("");
  });
});
