// inv.i4.digest-is-payout (architecture §0): whatever the database's lines become between the
// signatures and the POST, the re-hash refuses it and nothing reaches the repository or PayPal. That
// holds for the PayPal lines (batchSha256) and for every member line, the cash lines too (linesDigest,
// the approved plan's amendment to register §8).

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ApprovedLine, MemberLineHash } from "../src/index.js";
import {
  approvalsFor,
  HERO_LINES,
  lineHash,
  MEMBER_LINES,
  postingSnapshot,
  RUN_FACTS,
} from "./support/fixtures.js";
import { requests, useMsw } from "./support/msw.js";
import { MemoryPayoutsRepo } from "./support/repo.js";
import { makeService } from "./support/service.js";

useMsw();

type Mutation =
  | { kind: "amount"; index: number; delta: bigint }
  | { kind: "receiver"; index: number; local: string }
  | { kind: "drop"; index: number }
  | { kind: "add"; memberNo: number; cents: bigint }
  | { kind: "member"; index: number; memberNo: number }
  | { kind: "swapAmounts"; a: number; b: number };

const index = fc.integer({ min: 0, max: HERO_LINES.length - 1 });
const mutation: fc.Arbitrary<Mutation> = fc.oneof(
  fc.record({
    kind: fc.constant("amount" as const),
    index,
    delta: fc.bigInt({ min: -2_000n, max: 2_000n }).filter((d) => d !== 0n),
  }),
  fc.record({ kind: fc.constant("receiver" as const), index, local: fc.stringMatching(/^[a-z]{3,12}$/) }),
  fc.record({ kind: fc.constant("drop" as const), index }),
  fc.record({
    kind: fc.constant("add" as const),
    memberNo: fc.integer({ min: 100, max: 999 }),
    cents: fc.bigInt({ min: 1n, max: 50_000n }),
  }),
  fc.record({ kind: fc.constant("member" as const), index, memberNo: fc.integer({ min: 100, max: 999 }) }),
  fc.record({ kind: fc.constant("swapAmounts" as const), a: index, b: index }),
);

function apply(lines: readonly ApprovedLine[], m: Mutation): ApprovedLine[] | null {
  const out = lines.map((l) => ({ ...l }));
  switch (m.kind) {
    case "amount": {
      const l = out[m.index] as ApprovedLine;
      l.amountCents += m.delta;
      return l.amountCents > 0n ? out : null;
    }
    case "receiver": {
      const l = out[m.index] as ApprovedLine;
      const receiver = `${m.local}@example.test`;
      if (receiver === l.receiver) return null;
      l.receiver = receiver;
      return out;
    }
    case "drop":
      out.splice(m.index, 1);
      return out;
    case "add":
      out.push({
        lineId: "added",
        memberNo: `M-${m.memberNo}`,
        receiver: "added@example.test",
        amountCents: m.cents,
        currency: "USD",
      });
      return out;
    case "member": {
      (out[m.index] as ApprovedLine).memberNo = `M-${m.memberNo}`;
      return out;
    }
    case "swapAmounts": {
      const a = out[m.a] as ApprovedLine;
      const b = out[m.b] as ApprovedLine;
      if (a.amountCents === b.amountCents) return null;
      [a.amountCents, b.amountCents] = [b.amountCents, a.amountCents];
      return out;
    }
  }
}

type LinesMutation =
  | { kind: "rehash"; index: number; version: number }
  | { kind: "dropCash"; index: number }
  | { kind: "add"; memberNo: number }
  | { kind: "swapHashes"; a: number; b: number };

const PAYPAL_MEMBERS = new Set(HERO_LINES.map((l) => l.memberNo));
const memberIndex = fc.integer({ min: 0, max: MEMBER_LINES.length - 1 });
const linesMutation: fc.Arbitrary<LinesMutation> = fc.oneof(
  fc.record({
    kind: fc.constant("rehash" as const),
    index: memberIndex,
    version: fc.integer({ min: 2, max: 99 }),
  }),
  fc.record({ kind: fc.constant("dropCash" as const), index: memberIndex }),
  fc.record({ kind: fc.constant("add" as const), memberNo: fc.integer({ min: 65, max: 999 }) }),
  fc.record({ kind: fc.constant("swapHashes" as const), a: memberIndex, b: memberIndex }),
);

/** Every member line after the change, or null for a change that leaves them as signed. */
function applyToLines(lines: readonly MemberLineHash[], m: LinesMutation): MemberLineHash[] | null {
  const out = lines.map((l) => ({ ...l }));
  switch (m.kind) {
    case "rehash": {
      const l = out[m.index] as MemberLineHash;
      l.lineSha256 = lineHash(l.memberNo, m.version);
      return out;
    }
    case "dropCash": {
      // A PayPal line's member line cannot go while its item stays: that is an invalid batch.
      if (PAYPAL_MEMBERS.has((out[m.index] as MemberLineHash).memberNo)) return null;
      out.splice(m.index, 1);
      return out;
    }
    case "add": {
      const memberNo = `M-${String(m.memberNo).padStart(3, "0")}`;
      out.push({ memberNo, lineSha256: lineHash(memberNo) });
      return out;
    }
    case "swapHashes": {
      const a = out[m.a] as MemberLineHash;
      const b = out[m.b] as MemberLineHash;
      if (a.lineSha256 === b.lineSha256) return null;
      [a.lineSha256, b.lineSha256] = [b.lineSha256, a.lineSha256];
      return out;
    }
  }
}

describe("inv.i4.digest-is-payout", () => {
  it("refuses every change to the run's member lines after signing, cash lines included: nothing sent, the keys voided", async () => {
    const approvals = await approvalsFor(HERO_LINES);
    await fc.assert(
      fc.asyncProperty(linesMutation, async (m) => {
        const memberLines = applyToLines(MEMBER_LINES, m);
        fc.pre(memberLines !== null);
        // The PayPal lines are exactly as signed, so batchSha256 still matches: only linesDigest sees it.
        const repo = new MemoryPayoutsRepo({
          postings: [await postingSnapshot(HERO_LINES, { approvals, memberLines: memberLines ?? [] })],
        });
        const { service } = makeService(repo);
        const out = await service.executeApproved(RUN_FACTS.runId);
        expect(out).toMatchObject({
          kind: "refused",
          code: "DIGEST_MISMATCH",
          reason: "A line changed after it was signed. Nothing was sent.",
        });
        expect(repo.types()).toEqual(["voidApprovals"]);
        expect(repo.batches.size).toBe(0);
        expect(requests).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });

  it("refuses every change the database's lines undergo after signing, sends nothing and voids the keys", async () => {
    const approvals = await approvalsFor(HERO_LINES);
    await fc.assert(
      fc.asyncProperty(mutation, async (m) => {
        const lines = apply(HERO_LINES, m);
        fc.pre(lines !== null);
        const repo = new MemoryPayoutsRepo({
          postings: [await postingSnapshot(lines as ApprovedLine[], { approvals })],
        });
        const { service } = makeService(repo);
        const out = await service.executeApproved(RUN_FACTS.runId);
        expect(out.kind).toBe("refused");
        if (out.kind === "refused") expect(["DIGEST_MISMATCH", "INVALID_BATCH"]).toContain(out.code);
        // Nothing written but, after a failed approval check, the void (S3.6.4 step 3).
        const voided = out.kind === "refused" && out.code === "DIGEST_MISMATCH";
        expect(repo.types()).toEqual(voided ? ["voidApprovals"] : []);
        expect(requests).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });
});
