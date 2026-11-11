import { expect, it } from "vitest";
import { createFakeClock } from "../lib/clock.js";
import { createKeyedRateLimiter } from "../lib/rate-limit.js";
import { PROOF_RATE_RULES, takeProofBuild } from "./limits.js";

it("HD6: two networks cannot spend the global cold Proof budget", () => {
  const deps = { rateLimits: createKeyedRateLimiter(createFakeClock()) };
  expect(PROOF_RATE_RULES.buildNetwork.limit).toBeLessThanOrEqual(PROOF_RATE_RULES.buildGlobal.limit / 6);
  for (const network of ["noisy-a", "noisy-b"]) {
    for (let i = 0; i < PROOF_RATE_RULES.buildNetwork.limit; i++) takeProofBuild(deps, network);
    expect(() => takeProofBuild(deps, network)).toThrow();
  }
  expect(() => takeProofBuild(deps, "honest")).not.toThrow();
  expect(deps.rateLimits.peek(PROOF_RATE_RULES.buildGlobal, "all")).toEqual({
    ok: true,
    remaining: PROOF_RATE_RULES.buildGlobal.limit - 2 * PROOF_RATE_RULES.buildNetwork.limit - 1,
  });
});
