import { describe, expect, it } from "vitest";
import { isSampleKey, signingKeyKind } from "./keys.js";

describe("signing keys by their IDs (S3.8, C-13)", () => {
  it("names each officer key's kind from its shape alone", () => {
    expect(signingKeyKind("fs-analyn-w1")).toBe("web");
    expect(signingKeyKind("fs-ernesto-a1")).toBe("app");
    expect(signingKeyKind("fs-analyn-demo-k3x9q2")).toBe("web_demo");
    expect(signingKeyKind("fs-ernesto-demo-000000")).toBe("web_demo");
    expect(signingKeyKind("fs-analyn-s1")).toBe("seeded");
  });

  it("reads an ID no signing key can carry as none, so a judge's key never passes for a real one", () => {
    for (const id of [
      "fs-analyn-demo-ABC123",
      "fs-analyn-demo-abc12",
      "fs-ledger-k1",
      "fs-analyn",
      "w1",
      "",
    ]) {
      expect(signingKeyKind(id)).toBeNull();
    }
  });

  it("inv.i8 demo and seeded keys are samples; device keys are not", () => {
    expect(isSampleKey("fs-analyn-demo-k3x9q2")).toBe(true);
    expect(isSampleKey("fs-ernesto-s1")).toBe(true);
    expect(isSampleKey("fs-analyn-w1")).toBe(false);
    expect(isSampleKey("fs-ernesto-a1")).toBe(false);
    expect(isSampleKey("not-a-key")).toBe(false);
  });
});
