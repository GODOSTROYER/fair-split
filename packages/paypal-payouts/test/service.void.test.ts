// S3.6.4 step 3 under concurrency (the STATE.md security entry of 27 Oct). A failed approval check
// voids the approvals the service checked, named by their nonces, and only while they are still the
// run's live approvals and the run is APPROVED; the void takes its turn in the service's write queue;
// an infrastructure fault in the officer key registry voids nothing. The mirror on the write side: a
// primary batch's rows are written (APPROVED → POSTING) only while the approvals that were checked
// are still live, so an executor that read the run before a void and a re-sign cannot post the old
// lines.

import { linesDigest } from "@fairsplit/domain";
import { describe, expect, it, vi } from "vitest";
import type {
  ApprovedLine,
  OfficerKey,
  PayoutsRepository,
  SignedApproval,
  SubmittedBatch,
} from "../src/index.js";
import {
  approvalsFor,
  created,
  EXP,
  HERO_LINES,
  NOW,
  postingSnapshot,
  RUN_FACTS,
  withEditedLine,
} from "./support/fixtures.js";
import { onPost, paypalJson, requests, useMsw } from "./support/msw.js";
import { MemoryPayoutsRepo, staleAfterRead } from "./support/repo.js";
import { makeService } from "./support/service.js";

useMsw();

const RUN_ID = RUN_FACTS.runId;
/** The approvals' `exp`: an executor whose check runs at this moment finds them expired. */
const LATE = new Date(EXP);

const posts = () => requests.filter((r) => r.method === "POST" && r.url.pathname === "/v1/payments/payouts");
const voids = (repo: MemoryPayoutsRepo) => repo.events.filter((e) => e.type === "voidApprovals");
const noncesOf = (approvals: readonly SignedApproval[]) => approvals.map((a) => a.payload.nonce);

/** The hero run, APPROVED by both keys (S1). */
async function approvedRun() {
  const signed = await approvalsFor(HERO_LINES);
  const repo = new MemoryPayoutsRepo({
    postings: [await postingSnapshot(HERO_LINES, { approvals: signed })],
  });
  return { repo, nonces: noncesOf(signed) };
}

describe("a failed check voids only the approvals it checked, and only while they are the run's", () => {
  it("names them by nonce: a set signed after its read stays live, and the next post goes out on it", async () => {
    const { repo, nonces: s1 } = await approvedRun();
    const s2 = await approvalsFor(HERO_LINES);
    // Meanwhile another executor, its check late, fails on S1 and voids it; both keys sign S2.
    const other = makeService(repo, { now: () => LATE }).service;
    const stale = staleAfterRead(repo, async () => {
      await expect(other.executeApproved(RUN_ID)).resolves.toMatchObject({ code: "DIGEST_MISMATCH" });
      repo.sign(RUN_ID, s2);
    });
    // This executor read S1 before all that, and its check fails on S1 too.
    const { service } = makeService(repo, { repo: stale, now: () => LATE });

    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "refused",
      code: "DIGEST_MISMATCH",
    });

    expect(voids(repo)).toMatchObject([
      { nonces: s1, applied: true },
      { nonces: s1, applied: false },
    ]);
    expect(repo.voidedNonces(RUN_ID)).toEqual(s1);
    expect(repo.liveNonces(RUN_ID)).toEqual(noncesOf(s2));
    expect(repo.runStates.get(RUN_ID)).toBe("APPROVED");
    expect(posts()).toHaveLength(0);

    onPost("/v1/payments/payouts", () => paypalJson(created(), 201));
    await expect(makeService(repo).service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "created",
    });
    expect(posts()).toHaveLength(1);
  });

  it("voids nothing once another executor wrote the run's rows: those approvals authorised its batch", async () => {
    const { repo, nonces } = await approvedRun();
    onPost("/v1/payments/payouts", () => paypalJson(created(), 201));
    const onTime = makeService(repo).service;
    let theirs: unknown;
    const stale = staleAfterRead(repo, async () => {
      theirs = await onTime.executeApproved(RUN_ID);
    });
    const { service } = makeService(repo, { repo: stale, now: () => LATE });

    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "refused",
      code: "DIGEST_MISMATCH",
    });

    expect(theirs).toMatchObject({ kind: "created" });
    expect(posts()).toHaveLength(1);
    // The compare-and-set found the run POSTING: nothing voided, the run not sent back to review.
    expect(voids(repo)).toMatchObject([{ nonces, applied: false }]);
    expect(repo.liveNonces(RUN_ID)).toEqual(nonces);
    expect(repo.runStates.get(RUN_ID)).toBe("POSTING");
  });

  it("in one service the void takes its turn behind a write in flight, so it finds the run POSTING", async () => {
    const { repo, nonces } = await approvedRun();
    onPost("/v1/payments/payouts", () => paypalJson(created(), 201));
    let reachWrite!: () => void;
    const writing = new Promise<void>((resolve) => {
      reachWrite = resolve;
    });
    let releaseWrite!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const slowWrites: PayoutsRepository = new Proxy(repo, {
      get(target, prop) {
        if (prop === "writeSubmitted") {
          return async (batch: SubmittedBatch) => {
            reachWrite();
            await held;
            return target.writeSubmitted(batch);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    let clock = NOW;
    const { service } = makeService(repo, { repo: slowWrites, now: () => clock });

    const first = service.executeApproved(RUN_ID); // checked at NOW, now writing its rows
    await writing;
    clock = LATE;
    const second = service.executeApproved(RUN_ID); // its check fails: the approvals expired
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(voids(repo)).toEqual([]); // queued behind the write, not run beside it

    releaseWrite();
    await expect(first).resolves.toMatchObject({ kind: "created" });
    await expect(second).resolves.toMatchObject({ kind: "refused", code: "DIGEST_MISMATCH" });
    expect(voids(repo)).toMatchObject([{ nonces, applied: false }]);
    expect(repo.liveNonces(RUN_ID)).toEqual(nonces);
    expect(posts()).toHaveLength(1);
  });
});

describe("an infrastructure fault in the officer key registry voids nothing", () => {
  it("a registry that cannot be read throws: the post rejects, nothing voided, written or sent", async () => {
    const { repo, nonces } = await approvedRun();
    const officerKeys = vi.fn(async (): Promise<readonly OfficerKey[]> => {
      throw new Error("device_keys unavailable");
    });
    const { service } = makeService(repo, { officerKeys });

    await expect(service.executeApproved(RUN_ID)).rejects.toThrow("device_keys unavailable");

    expect(officerKeys).toHaveBeenCalledWith(RUN_ID);
    expect(repo.events).toEqual([]);
    expect(repo.liveNonces(RUN_ID)).toEqual(nonces);
    expect(repo.runStates.get(RUN_ID)).toBe("APPROVED");
    expect(requests).toHaveLength(0);

    // The registry is back: the same approvals post.
    onPost("/v1/payments/payouts", () => paypalJson(created(), 201));
    await expect(makeService(repo).service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "created",
    });
  });

  it.each([
    ["undefined", undefined],
    ['"yes"', "yes"],
    ["1", 1],
    ["null", null],
    ["one row, not a list", { keyId: "fs-analyn-w1" }],
  ])(
    "a registry read that answers %s, not a list, is a fault: nothing voided or sent",
    async (_label, answer) => {
      const { repo, nonces } = await approvedRun();
      const { service } = makeService(repo, {
        officerKeys: async () => answer as unknown as readonly OfficerKey[],
      });
      await expect(service.executeApproved(RUN_ID)).rejects.toThrow(TypeError);
      expect(repo.events).toEqual([]);
      expect(repo.liveNonces(RUN_ID)).toEqual(nonces);
      expect(requests).toHaveLength(0);
    },
  );
});

describe("the write's compare-and-set: rows only under approvals that are still live", () => {
  it("a new batch's rows name the approvals the service checked", async () => {
    const { repo, nonces } = await approvedRun();
    onPost("/v1/payments/payouts", () => paypalJson(created(), 201));
    await expect(makeService(repo).service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "created",
    });
    const write = repo.events.find((e) => e.type === "writeSubmitted");
    expect(write?.type === "writeSubmitted" && write.batch.approvalNonces).toEqual(nonces);
  });

  it("inv.i4.digest-is-payout: an executor that read the old lines cannot post them after their approvals were voided and the new lines signed", async () => {
    const { repo } = await approvedRun();
    const edited: ApprovedLine[] = HERO_LINES.map((l) =>
      l.memberNo === "M-014" ? { ...l, amountCents: l.amountCents + 100n } : l,
    );
    const editedMembers = withEditedLine("M-014");
    const s2 = await approvalsFor(edited, { linesDigest: linesDigest(editedMembers) });
    onPost("/v1/payments/payouts", () => paypalJson(created(), 201));
    // Meanwhile a late check voids S1 (IN_REVIEW), M-014's line is edited, and both keys sign S2.
    const late = makeService(repo, { now: () => LATE }).service;
    const stale = staleAfterRead(repo, async () => {
      await expect(late.executeApproved(RUN_ID)).resolves.toMatchObject({ code: "DIGEST_MISMATCH" });
      repo.edit(RUN_ID, { lines: edited, memberLines: editedMembers });
      repo.sign(RUN_ID, s2);
    });
    // This executor read the old lines and S1, and S1 still checks out against them at NOW.
    const { service } = makeService(repo, { repo: stale });

    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "refused",
      code: "INVALID_BATCH",
    });
    // The run is APPROVED again, but on S2: a write under S1 stores nothing and sends nothing.
    expect(repo.runStates.get(RUN_ID)).toBe("APPROVED");
    expect(repo.batches.size).toBe(0);
    expect(posts()).toHaveLength(0);

    // A fresh read posts the lines the officers signed last.
    await expect(makeService(repo).service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "created",
    });
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.body).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ sender_item_id: "r37-M-014", amount: { currency: "USD", value: "65.45" } }),
      ]),
    });
  });
});
