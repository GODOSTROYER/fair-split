// Mutation testing (handoff T3) found the batch checks' edges untested: the 15,000-item limit, the
// largest amount and total a JSON number carries exactly, and the 127-character receiver. Each case
// sits on an edge; the refusal reason tells which check answered. Everything that passes the batch
// checks is then stopped at the approval gate (no approvals are presented), so nothing is ever sent.

import { describe, expect, it } from "vitest";
import type { ApprovedLine } from "../src/index.js";
import { HERO_LINES, postingSnapshot, RUN_FACTS } from "./support/fixtures.js";
import { requests, useMsw } from "./support/msw.js";
import { MemoryPayoutsRepo } from "./support/repo.js";
import { makeService } from "./support/service.js";

useMsw();

const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
const HERO = HERO_LINES[0] as ApprovedLine;

async function outcome(lines: readonly ApprovedLine[]) {
  const repo = new MemoryPayoutsRepo({ postings: [await postingSnapshot(lines, { approvals: [] })] });
  const { service } = makeService(repo);
  const out = await service.executeApproved(RUN_FACTS.runId);
  expect(requests).toHaveLength(0);
  expect(repo.batches.size).toBe(0);
  return out;
}

/** Past every batch check: the next gate (approvals) answers. */
const PAST_BATCH_CHECKS = { kind: "refused", code: "APPROVALS_MISSING" };
// A RegExp inside toMatchObject matches any string under Vitest 5 (it is an object with no own keys, so
// a vacuous subset): reasons given as patterns go through expect.stringMatching.
const invalid = (reason: string | RegExp) => ({
  kind: "refused",
  code: "INVALID_BATCH",
  reason: typeof reason === "string" ? reason : expect.stringMatching(reason),
});

const many = (n: number): ApprovedLine[] =>
  Array.from({ length: n }, (_, i) => {
    const memberNo = `X-${String(i + 1).padStart(5, "0")}`;
    return {
      ...HERO,
      lineId: `line-${memberNo}`,
      memberNo,
      receiver: `${memberNo.toLowerCase()}@example.test`,
    };
  });

describe("PayoutsService batch bounds (mutation-tested edges)", () => {
  it("PayPal's 15,000-item limit: 15,000 passes the count check, 15,001 is refused by it", async () => {
    // 15,000 strangers then fail the member-line check, which is the next one: not the count.
    const atLimit = await outcome(many(15_000));
    expect(atLimit).toMatchObject(invalid(/is not one of the run's member lines/));
    await expect(outcome(many(15_001))).resolves.toMatchObject(
      invalid("A batch holds 1 to 15,000 items, not 15001"),
    );
  }, 60_000);

  it("an amount of Number.MAX_SAFE_INTEGER cents is exact and passes; one cent more is refused", async () => {
    await expect(outcome([{ ...HERO, amountCents: MAX_SAFE_CENTS }])).resolves.toMatchObject(
      PAST_BATCH_CHECKS,
    );
    await expect(outcome([{ ...HERO, amountCents: MAX_SAFE_CENTS + 1n }])).resolves.toMatchObject(
      invalid(`${HERO.memberNo}: amount must be positive cents`),
    );
  });

  it("the batch total must be exact as a JSON number: the largest safe total passes, one cent more is refused", async () => {
    const [a, b] = HERO_LINES as [ApprovedLine, ApprovedLine];
    const half = MAX_SAFE_CENTS / 2n; // 2^52 - 1: two halves plus one cent is exactly MAX_SAFE_INTEGER
    await expect(
      outcome([
        { ...a, amountCents: half + 1n },
        { ...b, amountCents: half },
      ]),
    ).resolves.toMatchObject(PAST_BATCH_CHECKS);
    await expect(
      outcome([
        { ...a, amountCents: half + 1n },
        { ...b, amountCents: half + 1n },
      ]),
    ).resolves.toMatchObject(invalid("The batch total is too large to sign"));
  });

  it("a receiver of 127 characters passes; 128 is refused (PayPal's receiver limit)", async () => {
    const receiver = (length: number) => `${"r".repeat(length - "@example.test".length)}@example.test`;
    expect(receiver(127)).toHaveLength(127);
    await expect(outcome([{ ...HERO, receiver: receiver(127) }])).resolves.toMatchObject(PAST_BATCH_CHECKS);
    await expect(outcome([{ ...HERO, receiver: receiver(128) }])).resolves.toMatchObject(
      invalid(`${HERO.memberNo}: recipient_type is EMAIL only`),
    );
  });
});
