import { type PayoutLimits, PayoutsService, type PayoutsServiceDeps } from "../../src/index.js";
import { registeredKeyVerifier } from "./approvals.js";
import { referenceBatchDigest } from "./digest.js";
import { NOW } from "./fixtures.js";
import { RealPayPalHttp } from "./http.js";
import type { MemoryPayoutsRepo } from "./repo.js";

/** The co-op business account's sandbox balance (register: US$100,000). */
export const SANDBOX_BALANCE_CENTS = 10_000_000n;
/** Plan §Limits: below US$10,000 the PayPal steps replay. */
export const BALANCE_FLOOR_CENTS = 1_000_000n;

/**
 * Register C-21 (US$400 cap, 40 live batches a day), Judge Mode's 8 items, PP_RECEIVERS as the sandbox
 * aliases, and the plan's US$10,000 floor under the full sandbox balance. No batch posted yet today.
 */
export const JUDGE_LIMITS: PayoutLimits = {
  maxBatchTotalCents: 40_000n,
  maxItems: 8,
  receiverAllowed: (receiver) => receiver.endsWith("@example.test"),
  maxPostsPer24h: 40,
  postsInLast24h: async () => 0,
  balanceCents: async () => SANDBOX_BALANCE_CENTS,
  minBalanceCents: BALANCE_FLOOR_CENTS,
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
