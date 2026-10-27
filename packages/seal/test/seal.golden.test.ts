// The cross-engine check WS-APP runs on Hermes (device and Expo web export) once ui-native lands: on Node it
// must pass, it must cover both variants and the print size, and it must notice a drawing that changed.

import { describe, expect, it } from "vitest";
import { fnv1a32, SEAL_GOLDEN, sealFingerprint, verifySealGolden } from "../src/golden.js";
import { SEAL_PRINT, seal, TWO_RING_BELOW } from "../src/seal.js";

describe("seal golden drawings (cross-engine determinism)", () => {
  it("FNV-1a matches its published test vectors", () => {
    expect(fnv1a32("")).toBe("811c9dc5");
    expect(fnv1a32("a")).toBe("e40c292c");
    expect(fnv1a32("foobar")).toBe("bf9cf968");
  });

  it("V8 draws every golden seal exactly as pinned", () => {
    expect(verifySealGolden()).toEqual({ ok: true, mismatches: [] });
  });

  it("covers both variants and the 80 mm print size", () => {
    const sizes = SEAL_GOLDEN.map((c) => c.size);
    expect(sizes.some((s) => s < TWO_RING_BELOW)).toBe(true);
    expect(sizes).toContain(TWO_RING_BELOW);
    expect(sizes).toContain(SEAL_PRINT.px);
    expect(new Set(SEAL_GOLDEN.map((c) => `${c.digest}:${c.size}`)).size).toBe(SEAL_GOLDEN.length);
  });

  it("reports a drawing that differs, with what this engine drew", () => {
    const [first] = SEAL_GOLDEN;
    if (!first) throw new Error("no golden cases");
    const report = verifySealGolden([{ ...first, fingerprint: "00000000" }]);
    expect(report.ok).toBe(false);
    expect(report.mismatches).toEqual([{ ...first, fingerprint: "00000000", actual: first.fingerprint }]);
  });

  it("fingerprints the path data itself: one ring moved by 0.01 px changes it", () => {
    const { digest, size, fingerprint } = SEAL_GOLDEN[0] ?? { digest: "", size: 0, fingerprint: "" };
    const rings = seal(digest, size).rings.map((r) => r.d);
    expect(fnv1a32(rings.join("|"))).toBe(fingerprint);
    const nudged = [...rings];
    nudged[0] = (nudged[0] ?? "").replace(
      /^M(\d+(?:\.\d+)?)/,
      (_, x: string) => `M${Math.round((Number(x) + 0.01) * 100) / 100}`,
    );
    expect(fnv1a32(nudged.join("|"))).not.toBe(fingerprint);
    expect(sealFingerprint(digest, size)).toBe(fingerprint);
  });
});
