import { SEAL_GOLDEN, sealFingerprint, seal as sharedSeal } from "@fairsplit/seal";
import { describe, expect, it } from "vitest";
import { seal } from "../../_shims/seal";

describe("@fairsplit/seal parity", () => {
  for (const vector of SEAL_GOLDEN) {
    it(`golden ${vector.digest.slice(0, 8)} at ${vector.size}`, () => {
      expect(sealFingerprint(vector.digest, vector.size)).toBe(vector.fingerprint);
      const rings = seal(vector.digest, vector.size);
      expect(rings.map(({ d, length, owner }) => ({ d, length, owner }))).toEqual(
        sharedSeal(vector.digest, vector.size).rings.map(({ d, length, owner }) => ({ d, length, owner })),
      );
    });
  }
});
