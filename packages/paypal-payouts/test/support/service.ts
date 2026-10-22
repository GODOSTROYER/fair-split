import { type PayoutLimits, PayoutsService, type PayoutsServiceDeps } from "../../src/index.js";
import { registeredKeyVerifier } from "./approvals.js";
import { referenceBatchDigest } from "./digest.js";
import { NOW } from "./fixtures.js";
import { RealPayPalHttp } from "./http.js";
import type { MemoryPayoutsRepo } from "./repo.js";

/** Register C-21 (US$400 cap), Judge Mode's 8 items, and PP_RECEIVERS as the sandbox aliases. */
export const JUDGE_LIMITS: PayoutLimits = {
  maxBatchTotalCents: 40_000n,
  maxItems: 8,
  receiverAllowed: (receiver) => receiver.endsWith("@example.test"),
};

/** A service wired like apps/tasks will wire it: every guard present, sleeps recorded instead of waited. */
export function makeService(repo: MemoryPayoutsRepo, extra: Partial<PayoutsServiceDeps> = {}) {
  const sleeps: number[] = [];
  const service = new PayoutsService({
    http: new RealPayPalHttp(),
    repo,
    batchDigest: referenceBatchDigest,
    verifyApprovalSignature: registeredKeyVerifier(),
    killSwitch: async () => false,
    limits: JUDGE_LIMITS,
    sleep: async (ms) => void sleeps.push(ms),
    now: () => NOW,
    ...extra,
  });
  return { service, sleeps };
}
