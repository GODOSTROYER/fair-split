// S3.6.4 step 4's hourly guards as fs-api wires them into PayoutsService: C-21's 40 live batches a rolling day and
// the US$10,000 balance floor bind on the sandbox rail (the shared business account); the simulated rail moves no
// money at PayPal, so they never bind there (the per-batch guards and the judge lane's quota still do).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JUDGE_QUOTA } from "../judge/quota.js";
import { createTestApp, type TestApp } from "../test/index.js";
import { MAX_POSTS_PER_24H, MIN_BALANCE_CENTS, spendGuardsFor } from "./payouts.js";

const SANDBOX = {
  PP_MODE: "sandbox",
  PP_CLIENT_ID: "test-client",
  PP_CLIENT_SECRET: "test-secret",
  PP_WEBHOOK_ID: "WHTEST",
};

describe("spendGuardsFor", () => {
  let sim: TestApp;
  let sandbox: TestApp;
  beforeAll(async () => {
    sim = await createTestApp({ db: "postgres" });
    sandbox = await createTestApp({ db: "postgres", env: SANDBOX });
  });
  afterAll(async () => {
    await sim?.close();
    await sandbox?.close();
  });

  it("the sandbox rail: 40 live batches a day, the balance estimate kept above US$10,000", async () => {
    const g = spendGuardsFor(sandbox.deps);
    expect(g.maxPostsPer24h).toBe(MAX_POSTS_PER_24H);
    expect(MAX_POSTS_PER_24H).toBe(40);
    expect(g.minBalanceCents).toBe(MIN_BALANCE_CENTS);
    expect(MIN_BALANCE_CENTS).toBe(1_000_000n);
    // no reading yet: register §8's opening US$100,000 seeds the estimate, minus nothing posted
    expect(await g.balanceCents()).toBe(BigInt(JUDGE_QUOTA.simulatorOpeningCents));
    expect(await g.postsInLast24h(sandbox.clock.now())).toBe(0);
  });

  it("the simulated rail: the daily ceiling and the floor never bind", async () => {
    const g = spendGuardsFor(sim.deps);
    expect(g.maxPostsPer24h).toBe(Number.MAX_SAFE_INTEGER);
    expect(g.minBalanceCents).toBe(0n);
    expect(await g.balanceCents()).toBe(BigInt(JUDGE_QUOTA.simulatorOpeningCents));
  });
});
