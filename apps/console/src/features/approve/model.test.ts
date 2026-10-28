// W-TR-07's model and key 1 against the seed and the mock world's own events: the state at every step of the
// story, the batch both keys sign, the lines digest the ledger records, and the browser's Ed25519 key, whose
// signature must verify over exactly the JCS bytes the API hands out (I4: the approved digest is the payout).

import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import { ApiClientError, ContractError, NetworkError } from "../../data/errors.js";
import { CHAIR } from "../../data/mock/driver.js";
import { applyRunEvents, type RunView, sessionView, showcaseView } from "../../data/run-view.js";
import { fromHex } from "../../lib/sha256.js";
import { createTestWorld, seedSnapshot } from "../../test/world.js";
import { jcs, utf8 } from "./jcs.js";
import { browserKey, forgetBrowserKeys, makeBrowserKey, webKeyId } from "./keys.js";
import {
  approveState,
  batchAmountState,
  batchFacts,
  batchHashOf,
  blockingReasons,
  canSign,
  chairRule,
  feeFacts,
  isUnanswered,
  keyKind,
  linesDigest,
  liveApprovals,
  NO_LOCAL,
  payloadMatches,
  paypalRetryOf,
  restingPhase,
  safeFacts,
  sealKeys,
  senderBatchIdFor,
  signedLinesDigest,
  wholeDollars,
} from "./model.js";

const snapshot = seedSnapshot();

function viewOf(world: ReturnType<typeof createTestWorld>): RunView {
  return applyRunEvents(
    sessionView(snapshot, { runSlug: world.runSlug, runId: world.runId }),
    world.events(),
  );
}

describe("the approval's state follows the story", () => {
  it("is blocked while reading and while holds that change kilos are open", () => {
    const world = createTestWorld();
    expect(approveState(viewOf(world))).toBe("blocked");
    world.markPaid();
    const view = viewOf(world);
    expect(approveState(view)).toBe("blocked");
    const reasons = blockingReasons(snapshot, view);
    expect(reasons.map((r) => r.hold.kind)).toEqual([
      "LOW_CONFIDENCE",
      "DUPLICATE_SLIP",
      "IMPLAUSIBLE_YIELD",
    ]);
    expect(reasons[0]?.href).toBe("/season/2026-A/by-hand/0462");
    expect(reasons[1]?.href).toBe(`/runs/${world.runSlug}/split?hold=H1`);
  });

  it("is ready once every blocking hold is decided (H3 only reserves its line)", () => {
    const world = createTestWorld();
    world.markPaid();
    world.enterByHand();
    world.resolve("H1");
    world.resolve("H2");
    const view = viewOf(world);
    expect(approveState(view)).toBe("ready");
    expect(restingPhase("ready")).toBe("ready");
  });

  it("waits for Ernesto after key 1, is approved after key 2, then posting and posted", () => {
    const world = createTestWorld();
    world.markPaid();
    world.resolveAll();
    world.sign("treasurer");
    const key1 = viewOf(world);
    expect(approveState(key1)).toBe("key1");
    expect(sealKeys(key1)).toBe(1);
    expect(restingPhase("key1")).toBe("waiting-2");
    world.cosign();
    const done = viewOf(world);
    expect(sealKeys(done)).toBe(2);
    expect(approveState(done)).toBe("approved");
    expect(batchAmountState(done)).toBe("hollow");
  });

  it("names the local refusals and PayPal's denial, and the kill switch bolts the slab", () => {
    const world = createTestWorld();
    world.markPaid();
    world.resolveAll();
    const view = viewOf(world);
    expect(approveState(view, { ...NO_LOCAL, mismatch: true })).toBe("mismatch");
    expect(approveState(view, { ...NO_LOCAL, expired: true })).toBe("expired");
    expect(approveState({ ...view, state: "DENIED" })).toBe("denied");
    expect(approveState({ ...view, flags: { kill_payouts: true } })).toBe("killed");
  });

  it("this browser sending its signature again is not S1.7's retrying: the run's state stands", () => {
    const world = createTestWorld();
    world.markPaid();
    world.resolveAll();
    const view = viewOf(world);
    expect(approveState(view, { ...NO_LOCAL, resending: 2 })).toBe("ready");
  });

  it("retrying is PayPal's Payouts POST only: shown while POSTING once an event carries the attempt", () => {
    const world = createTestWorld();
    world.markPaid();
    world.resolveAll();
    world.sign("treasurer");
    world.cosign();
    const posting = { ...viewOf(world), state: "POSTING" as const };
    expect(paypalRetryOf(posting)).toBeNull();
    expect(approveState(posting)).toBe("posting");
    expect(approveState(posting, NO_LOCAL, { attempt: 2, of: 4 })).toBe("retrying");
    expect(restingPhase("retrying")).toBe("inked");
    const ready = { ...posting, state: "IN_REVIEW" as const };
    expect(approveState(ready, NO_LOCAL, { attempt: 2, of: 4 })).not.toBe("retrying");
  });

  it("the Chair sends the batch back: his decline voids key 1, the seal empties, the batch is pencil again", () => {
    const world = createTestWorld();
    world.markPaid();
    world.resolveAll();
    world.sign("treasurer");
    expect(sealKeys(viewOf(world))).toBe(1);
    world.command("declineApproval", {
      params: { runSlug: world.runSlug },
      body: { role: "chair", reason: "Check Merlyn's second plot first." },
      as: CHAIR,
    });
    const view = viewOf(world);
    expect(view.state).toBe("IN_REVIEW");
    expect(approveState(view)).toBe("declined");
    expect(canSign("declined")).toBe(true);
    expect(liveApprovals(view)).toEqual({ treasurer: null, chair: null });
    expect(sealKeys(view)).toBe(0);
    expect(batchHashOf(view, null)).toBeNull();
    expect(batchAmountState(view)).toBe("pencil");
    expect(restingPhase("declined")).toBe("declined");
    world.sign("treasurer");
    const again = viewOf(world);
    expect(approveState(again)).toBe("key1");
    expect(sealKeys(again)).toBe(1);
  });

  it("the showcase is approved by two seeded sample keys, its batch landed and settled", () => {
    const view = showcaseView(snapshot);
    expect(approveState(view)).toBe("approved");
    expect(sealKeys(view)).toBe(2);
    expect(keyKind(view.approvals.treasurer?.keyId ?? "")).toBe("seeded");
    expect(batchAmountState(view)).toBe("ink");
  });
});

describe("the batch both keys sign", () => {
  it("8 payouts, US$368.39, 56 cash lines, every figure the engine's", () => {
    const world = createTestWorld();
    world.markPaid();
    world.resolveAll();
    const facts = batchFacts(snapshot, viewOf(world));
    expect(facts).toMatchObject({
      itemCount: 8,
      totalCents: snapshot.figures.batchTotalCents,
      cashCount: 56,
      cashCents: snapshot.figures.cashNetCents,
      lines: 64,
      final: true,
    });
    expect(facts.recipients.map((r) => r.memberNo)).toContain("M-014");
  });

  it("the fee line uses the published rates, labelled; the co-sign threshold prints as whole dollars", () => {
    expect(feeFacts(snapshot)).toEqual({
      sandboxEach: "US$0.25",
      count: 8,
      sandboxTotal: "US$2.00",
      production: "US$7.37",
      disbursement: "US$60.00",
    });
    expect(chairRule(snapshot, snapshot.figures.batchTotalCents)).toEqual({
      required: true,
      threshold: "US$300",
    });
    expect(wholeDollars(12_345)).toBe("US$123.45");
  });

  it("names the batch after the run: 2026A-{rc8}-r{runSeq}", () => {
    expect(senderBatchIdFor(snapshot, "2026A-r37")).toBe(snapshot.run.senderBatchId);
    expect(senderBatchIdFor(snapshot, "2026A-r1000001")).toBe(`2026A-${snapshot.rateCard.rc8}-r1000001`);
  });

  it("why it is safe: 3 holds resolved, 1 by hand, shrink 1.62% inside 2.0%, 64 of 64 explained, since 14 Mar", () => {
    const world = createTestWorld();
    world.markPaid();
    world.resolveAll();
    expect(safeFacts(snapshot, viewOf(world))).toEqual({
      holds: 3,
      byHand: 1,
      shrink: "1.62%",
      limit: "2.0%",
      explained: 64,
      lines: 64,
      date: "14 Mar",
    });
  });
});

describe("inv.i4 the approved digest is the payout", () => {
  it("inv.i4 the lines digest is the root the ledger's lines.computed records", () => {
    const entry = snapshot.proof.ledger.find((e) => e.kind === "lines.computed");
    const root = (entry?.payload as { linesRootSha256?: string } | undefined)?.linesRootSha256;
    expect(root).toMatch(/^[0-9a-f]{64}$/);
    expect(linesDigest(snapshot, showcaseView(snapshot))).toBe(root);
  });

  it("inv.i4 the browser rebuilds the API's JCS bytes exactly, and refuses a payload that differs", () => {
    const world = createTestWorld();
    world.markPaid();
    world.resolveAll();
    const { payload, jcs: serverJcs } = world.command("approvalPayload", {
      params: { runSlug: world.runSlug },
      query: { role: "treasurer" },
    });
    const shown = { batchSha256: payload.batchSha256, linesDigest: null };
    expect(jcs(payload as unknown as Parameters<typeof jcs>[0])).toBe(serverJcs);
    expect(payloadMatches(payload, serverJcs, shown)).toBe(true);
    expect(payloadMatches(payload, serverJcs, { ...shown, batchSha256: "0".repeat(64) })).toBe(false);
    expect(payloadMatches({ ...payload, totalCents: payload.totalCents + 1 }, serverJcs, shown)).toBe(false);
  });

  it("inv.i4 nothing shown, nothing signed: a payload the seal never showed is refused", () => {
    const world = createTestWorld();
    world.markPaid();
    world.resolveAll();
    const { payload, jcs: serverJcs } = world.command("approvalPayload", {
      params: { runSlug: world.runSlug },
      query: { role: "treasurer" },
    });
    expect(payloadMatches(payload, serverJcs, { batchSha256: null, linesDigest: null })).toBe(false);
  });

  it("inv.i4 once the payload carries a lines root, it must be the one this browser recomputed", () => {
    const world = createTestWorld();
    world.markPaid();
    world.resolveAll();
    const view = viewOf(world);
    const { payload } = world.command("approvalPayload", {
      params: { runSlug: world.runSlug },
      query: { role: "treasurer" },
    });
    // Today's contract has no linesDigest: nothing to show, nothing extra to compare.
    expect(signedLinesDigest(payload)).toBeNull();
    const ours = linesDigest(snapshot, view);
    expect(ours).toMatch(/^[0-9a-f]{64}$/);
    const carried = { ...payload, linesDigest: ours };
    const carriedJcs = jcs(carried as unknown as Parameters<typeof jcs>[0]);
    expect(signedLinesDigest(carried)).toBe(ours);
    const shown = { batchSha256: payload.batchSha256, linesDigest: ours };
    expect(payloadMatches(carried, carriedJcs, shown)).toBe(true);
    const other = { ...payload, linesDigest: "f".repeat(64) };
    const otherJcs = jcs(other as unknown as Parameters<typeof jcs>[0]);
    expect(payloadMatches(other, otherJcs, shown)).toBe(false);
    expect(payloadMatches(carried, carriedJcs, { ...shown, linesDigest: null })).toBe(false);
  });

  it("inv.i4 key 1 signs those bytes with a non-extractable WebCrypto key, and the signature verifies", async () => {
    const key = await makeBrowserKey(webKeyId("treasurer:analyn"));
    expect(key.keyId).toBe("fs-analyn-w1");
    expect(key.kind).toBe("webcrypto");
    const bytes = utf8(jcs({ v: 1, batchSha256: snapshot.run.batchSha256, totalCents: 36_839 }));
    const signature = await key.sign(bytes);
    expect(signature).toMatch(/^[0-9a-f]{128}$/);
    const pub = fromHex(key.publicKeyHex);
    const sig = fromHex(signature);
    expect(pub && sig && ed25519.verify(sig, bytes, pub)).toBe(true);
    expect(pub && sig && ed25519.verify(sig, utf8("a different batch"), pub)).toBe(false);
  });

  it("falls back to the labelled demo key where WebCrypto lacks Ed25519, and keeps one key per session", async () => {
    const demo = await makeBrowserKey("fs-analyn-w1", "demo");
    expect(demo.kind).toBe("demo");
    const bytes = utf8("{}");
    const sig = fromHex(await demo.sign(bytes));
    const pub = fromHex(demo.publicKeyHex);
    expect(sig && pub && ed25519.verify(sig, bytes, pub)).toBe(true);
    forgetBrowserKeys();
    const a = await browserKey("fs-analyn-w1", "session-a");
    const again = await browserKey("fs-analyn-w1", "session-a");
    const b = await browserKey("fs-analyn-w1", "session-b");
    expect(again.publicKeyHex).toBe(a.publicKeyHex);
    expect(b.publicKeyHex).not.toBe(a.publicKeyHex);
  });
});

describe("sending a signed approval again", () => {
  const ctx = { command: "submitApproval", rail: "simulated" as const, requestId: "req-1" };
  const answer = (status: number, code: string, details?: Record<string, unknown>) =>
    new ApiClientError(
      { code: code as never, status, message: `${code} (test)`, ...(details ? { details } : {}) },
      ctx,
    );

  it("only when the server gave no definitive answer: no connection, a 500, a gateway or a timeout", () => {
    expect(isUnanswered(new NetworkError("submitApproval", new TypeError("offline"), false))).toBe(true);
    expect(isUnanswered(answer(500, "INTERNAL"))).toBe(true);
    expect(isUnanswered(new ContractError("submitApproval", 502, "Bad gateway page"))).toBe(true);
    expect(isUnanswered(new ContractError("submitApproval", 504, "Gateway timeout page"))).toBe(true);
  });

  it("never for an answer: a 501 not wired yet, a definitive 5xx refusal, any 4xx, or a cancelled request", () => {
    expect(isUnanswered(answer(501, "INTERNAL", { reason: "NOT_IMPLEMENTED" }))).toBe(false);
    expect(isUnanswered(new ContractError("submitApproval", 501, "Not implemented"))).toBe(false);
    expect(isUnanswered(answer(503, "CIRCUIT_OPEN"))).toBe(false);
    expect(isUnanswered(answer(502, "PAYPAL_REJECTED"))).toBe(false);
    expect(isUnanswered(answer(409, "DIGEST_MISMATCH"))).toBe(false);
    expect(isUnanswered(answer(422, "APPROVAL_EXPIRED"))).toBe(false);
    expect(isUnanswered(new NetworkError("submitApproval", new Error("abort"), true))).toBe(false);
    expect(isUnanswered(new Error("anything else"))).toBe(false);
  });
});
