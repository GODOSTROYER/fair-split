import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { pendingReview } from "../../_shims/i18n";
import { messages } from "./messages";
import { commitSignature, nativeVaultRefusal, slabLive } from "./sign-flow";

describe("native live enrollment boundary", () => {
  it("inv.i6.native-live: refuses before a payload, fingerprint, signature, registration or submission", async () => {
    const fingerprint = vi.fn();
    const register = vi.fn();
    const submit = vi.fn();
    const payload = vi.fn();
    const sign = vi.fn(async () => {
      await fingerprint();
      await register();
      await submit();
      return { ok: false as const, state: "error" as const, detail: "unexpected" };
    });
    const result = await commitSignature({
      refusal: () => nativeVaultRefusal(false, "device"),
      payload,
      sign,
    });
    expect(result).toMatchObject({ ok: false, state: "error" });
    for (const effect of [payload, sign, fingerprint, register, submit])
      expect(effect).not.toHaveBeenCalled();
  });

  it("allows the browser demo vault in live mode and keeps native offline demo available", () => {
    expect(nativeVaultRefusal(false, "demo")).toBeNull();
    expect(nativeVaultRefusal(true, "demo")).toBeNull();
    expect(nativeVaultRefusal(true, "device")).toBeNull();
  });

  it("wires the refusal before signing and keeps the slab closed with translated recovery copy", () => {
    const hook = readFileSync(new URL("./use-sign.ts", import.meta.url), "utf8");
    const screen = readFileSync(new URL("./sign-screen.tsx", import.meta.url), "utf8");
    expect(hook).toContain("nativeVaultRefusal(demo, keyVault.kind)");
    const commit = hook.slice(hook.indexOf("const commit ="));
    expect(commit.indexOf("if (nativeUnsupported)")).toBeGreaterThanOrEqual(0);
    expect(commit.indexOf("if (nativeUnsupported)")).toBeLessThan(commit.indexOf("keyVault.sign("));
    expect(hook).toMatch(/nativeUnsupported\s*\?\s*"closed"/);
    expect(slabLive("closed")).toBe(false);
    expect(screen).toMatch(/nativeUnsupported\s*\?\s*"M-BD-02.nativeEnrollment"/);
    const entry = messages["M-BD-02.nativeEnrollment"];
    expect(entry.en).toContain("Native phone signing is not enrolled");
    expect(entry.en).toContain("labelled browser demo");
    for (const lang of ["en", "ceb", "fil"] as const) expect(entry[lang]).toBeTruthy();
    expect(pendingReview("ceb")).toBe(true);
    expect(pendingReview("fil")).toBe(true);
  });
});
