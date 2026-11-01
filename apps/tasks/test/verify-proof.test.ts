import { describe, expect, it } from "vitest";
import { proofUrls, runVerifyProof } from "../../../tools/verify-proof.js";

describe("verify-proof public transport", () => {
  it("accepts a Proof page or JSON route on HTTPS and loopback HTTP", () => {
    for (const path of ["/proof/2026A-r37", "/v1/proof/2026A-r37", "/v1/proof/2026A-r37.json"]) {
      expect(proofUrls(`https://proof.example${path}`)).toEqual({
        bundle: "https://proof.example/v1/proof/2026A-r37.json",
        keys: "https://proof.example/.well-known/fairsplit-keys.json?run=2026A-r37",
        runSlug: "2026A-r37",
      });
    }
    expect(proofUrls("http://localhost:8787/proof/2026A-r37").bundle).toContain(":8787/");
    expect(proofUrls("http://127.0.0.1:8787/proof/2026A-r37").bundle).toContain("127.0.0.1");
    expect(proofUrls("http://[::1]:8787/proof/2026A-r37").bundle).toContain("[::1]");
  });

  it.each([
    "file:///proof/2026A-r37",
    "ftp://proof.example/proof/2026A-r37",
    "http://proof.example/proof/2026A-r37",
    "https://user:password@proof.example/proof/2026A-r37",
    "https://proof.example/proof/2026A-r37?token=private",
    "https://proof.example/proof/2026A-r37#private",
    "https://proof.example/b/private",
    "https://proof.example/proof/not-a-run",
  ])("rejects unsafe or credential-bearing input without fetching: %s", async (url) => {
    let calls = 0;
    const out: string[] = [];
    expect(
      await runVerifyProof([url], {
        fetch: async () => {
          calls++;
          throw new Error("must not fetch");
        },
        print: (line) => out.push(line),
      }),
    ).toBe(1);
    expect(calls).toBe(0);
    expect(out.join("\n")).not.toContain("private");
    expect(out.join("\n")).not.toContain("password");
  });

  it("fetches without credentials, refuses redirects and hides remote error bodies", async () => {
    const out: string[] = [];
    const calls: RequestInit[] = [];
    const result = await runVerifyProof(["https://proof.example/proof/2026A-r37"], {
      fetch: async (_url, init) => {
        calls.push(init ?? {});
        return new Response("private response body", {
          status: 302,
          headers: { location: "https://other.example" },
        });
      },
      print: (line) => out.push(line),
    });
    expect(result).toBe(1);
    expect(calls[0]).toMatchObject({
      credentials: "omit",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    expect(out.join("\n")).toContain("HTTP 302");
    expect(out.join("\n")).not.toContain("private response body");
  });

  it("fails malformed JSON and bad argument counts without dumping data", async () => {
    const out: string[] = [];
    const deps = { fetch: async () => new Response("private data"), print: (line: string) => out.push(line) };
    expect(await runVerifyProof([], deps)).toBe(1);
    expect(await runVerifyProof(["https://proof.example/proof/2026A-r37"], deps)).toBe(1);
    expect(out.join("\n")).not.toContain("private data");
  });
});
