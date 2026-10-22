// inv.i4.digest-is-payout (architecture §0): whatever changes between the signature and the POST,
// the re-hash refuses it and nothing reaches the repository or PayPal.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ApprovedLine, PayoutsService } from "../src/index.js";
import { referenceBatchDigest } from "./support/digest.js";
import { approvedRun, HERO_LINES } from "./support/fixtures.js";
import { FetchPayPalHttp } from "./support/http.js";
import { requests, useMsw } from "./support/msw.js";
import { MemoryPayoutsRepo } from "./support/repo.js";

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

describe("inv.i4.digest-is-payout", () => {
  it("refuses every post-signature change to the batch, and sends nothing", async () => {
    const signed = await approvedRun();
    await fc.assert(
      fc.asyncProperty(mutation, async (m) => {
        const lines = apply(signed.lines, m);
        fc.pre(lines !== null);
        const repo = new MemoryPayoutsRepo();
        const service = new PayoutsService({
          http: new FetchPayPalHttp(),
          repo,
          batchDigest: referenceBatchDigest,
          sleep: async () => {},
        });
        const out = await service.executeApproved({ ...signed, lines: lines as ApprovedLine[] });
        expect(out.kind).toBe("refused");
        if (out.kind === "refused") expect(["DIGEST_MISMATCH", "INVALID_BATCH"]).toContain(out.code);
        expect(repo.events).toHaveLength(0);
        expect(requests).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });
});
