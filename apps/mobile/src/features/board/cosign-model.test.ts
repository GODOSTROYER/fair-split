import { describe, expect, it } from "vitest";
import type { ApprovalPayloadDTO, CosignRequestDTO } from "../../_shims/api-client";
import { type ApprovalPayload, SCREEN_STATES } from "../../_shims/contracts";
import { jcs } from "../../_shims/domain";
import { batchSha256, linesDigest, seasonId } from "../../_shims/seed";
import { checkApprovalPayload, checkCosignRequest } from "../../lib/signing";
import { buildDemoApproval, buildDemoCosign } from "../../services/demo-fixtures";
import { forgedCashLine, movedCent } from "../../test/cosign-batches";
import {
  type CosignSnapshot,
  canCommit,
  changedCue,
  changeReason,
  commitRefusal,
  compactLayout,
  EMPTY_MEMORY,
  forgetPayload,
  hashRows,
  holdNote,
  memberOf,
  openedFrom,
  payloadPlan,
  prefetchFor,
  presenceView,
  rememberPayload,
  rememberRequest,
  requestExpired,
  requestScope,
  requestStatus,
  sameAsOpened,
  sealKeysFor,
  treasurerPresence,
  whyKey,
} from "./cosign-model";

const NOW = new Date("2026-10-29T10:20:00+08:00");

function snap(over: Partial<CosignSnapshot> = {}, dto: Partial<CosignRequestDTO> = {}): CosignSnapshot {
  const d = { ...buildDemoCosign({ now: NOW, treasurerSigned: true }), ...dto };
  return {
    loading: false,
    loadError: null,
    dto: d,
    check: checkCosignRequest(d),
    payloadOk: true,
    opened: { batchSha256, linesDigest, seasonId },
    online: true,
    now: NOW.getTime(),
    sentBack: false,
    chairSigned: false,
    ...over,
  };
}

describe("M-BD-01 status", () => {
  it("shows the request when the phone's own hash matches what it opened", () => {
    expect(requestStatus(snap())).toBe("request");
    expect(requestStatus(snap({}, { state: "override", reason: "override" }))).toBe("override");
  });

  it.each([
    ["loading", { dto: null, check: null, loading: true }],
    ["offline", { dto: null, check: null, loadError: "offline" as const }],
    ["none", { dto: null, check: null, loadError: "none" as const }],
    ["error", { dto: null, check: null, loadError: "error" as const }],
    ["sent-back", { sentBack: true }],
    ["signed", { chairSigned: true }],
    ["offline", { online: false }],
  ] as const)("is %s", (status, over) => {
    expect(requestStatus(snap(over))).toBe(status);
  });

  it("expires at the request's own time, or when the server says so", () => {
    const later = NOW.getTime() + 31 * 60_000;
    expect(requestStatus(snap({ now: later }))).toBe("expired");
    expect(requestStatus(snap({}, { state: "expired" }))).toBe("expired");
    expect(requestExpired({ state: "request", expiresAt: "garbage" }, NOW.getTime())).toBe(true);
  });

  it("inv.i4.changed-after-open: a new batch under the same request is never signable", () => {
    const s = snap({ opened: { batchSha256: "a".repeat(64), linesDigest, seasonId } });
    expect(changeReason(s)).toBe("changed");
    expect(requestStatus(s)).toBe("changed");
  });

  it("inv.i4.lines-changed-after-open: the same payouts with other member lines are a changed batch too", () => {
    const s = snap({ opened: { batchSha256, linesDigest: "b".repeat(64), seasonId } });
    expect(changeReason(s)).toBe("changed");
    expect(requestStatus(s)).toBe("changed");
  });

  it("inv.i4.server-hash: a hash that is not the items' hash shows as changed, never as a request", () => {
    const s = snap({}, { batchSha256: "0".repeat(64) });
    expect(changeReason(s)).toBe("hash");
    expect(requestStatus(s)).toBe("changed");
  });

  it("inv.i4.server-lines: member lines that are not what their hashes cover, or not the claimed digest, too", () => {
    const d = buildDemoCosign({ now: NOW, treasurerSigned: true });
    for (const s of [
      snap({}, { linesDigest: "e".repeat(64) }),
      snap({}, { lines: forgedCashLine(d.lines) }),
      snap({}, { lines: d.lines.slice(1) }),
    ]) {
      expect(changeReason(s)).toBe("lines");
      expect(requestStatus(s)).toBe("changed");
      expect(commitRefusal(s)).toBe("mismatch");
    }
  });

  it("clacks once as the request turns changed (MM-5 mismatch), never while it stays changed", () => {
    expect(changedCue("request", "changed")).toBe("seal.mismatch");
    expect(changedCue("loading", "changed")).toBe("seal.mismatch");
    expect(changedCue(null, "changed")).toBe("seal.mismatch");
    expect(changedCue("changed", "changed")).toBeNull();
    expect(changedCue("changed", "request")).toBeNull();
    expect(changedCue("request", "expired")).toBeNull();
    expect(changedCue("loading", "request")).toBeNull();
  });

  it("refuses a payload that is not this batch", () => {
    expect(changeReason(snap({ payloadOk: false }))).toBe("payload");
    expect(requestStatus(snap({ payloadOk: false }))).toBe("changed");
  });

  it("a request sent back elsewhere leaves nothing to sign", () => {
    expect(requestStatus(snap({}, { state: "declined" }))).toBe("none");
  });

  it("only produces IC-01 states", () => {
    const all = [
      snap(),
      snap({ sentBack: true }),
      snap({ chairSigned: true }),
      snap({ online: false }),
      snap({ dto: null, check: null, loading: true }),
    ].map(requestStatus);
    for (const s of all) expect(SCREEN_STATES["M-BD-01"]).toContain(s);
  });
});

describe("what the Chair reads", () => {
  it("says why him: the batch rule, a line over the limit, or an override", () => {
    expect(whyKey({ reason: "batch-over-threshold", totalCents: 36839, thresholdCents: 30000 })).toBe(
      "M-BD-01.why.batch",
    );
    expect(whyKey({ reason: "line-over-threshold", totalCents: 20000, thresholdCents: 30000 })).toBe(
      "M-BD-01.why.line",
    );
    expect(whyKey({ reason: "override", totalCents: 36839, thresholdCents: 30000 })).toBe(
      "M-BD-01.why.override",
    );
  });

  it("prints the hash in four rows of four groups, as the console does", () => {
    const rows = hashRows(batchSha256);
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r).toMatch(/^[0-9a-f]{4}( [0-9a-f]{4}){3}$/);
    expect(rows.join(" ").replaceAll(" ", "")).toBe(batchSha256);
  });

  it("shows key 1 when the treasurer has signed and key 2 once the Chair has", () => {
    expect(sealKeysFor({ treasurerSigned: null }, false)).toBe(0);
    expect(sealKeysFor({ treasurerSigned: { keyId: "fs-analyn-w1", at: NOW.toISOString() } }, false)).toBe(1);
    expect(sealKeysFor(null, true)).toBe(2);
  });

  it("shows the treasurer's presence only while it is fresh", () => {
    const p = { persona: "treasurer:analyn", view: "approve", at: NOW.toISOString() };
    expect(treasurerPresence(p, NOW.getTime() + 30_000)).toEqual(p);
    expect(treasurerPresence(p, NOW.getTime() + 61_000)).toBeNull();
    expect(treasurerPresence({ ...p, persona: "board:ernesto" }, NOW.getTime())).toBeNull();
    expect(treasurerPresence(null, NOW.getTime())).toBeNull();
  });

  it("names members by number and reports which hold the Chair has open", () => {
    expect(memberOf({ senderItemId: "r37-M-014" })).toBe("M-014");
    expect(memberOf({ senderItemId: "r37x2-M-031", memberNo: "M-031" })).toBe("M-031");
    expect(presenceView("2026A-r37", null)).toBe("cosign:2026A-r37");
    expect(presenceView("2026A-r37", "H2")).toBe("cosign:2026A-r37:hold:H2");
  });
});

describe("large text", () => {
  it("moves the thumb zone into the scroll at 200% zoom, on short phones and from font scale 1.5", () => {
    expect(compactLayout(390, 844, 1)).toBe(false);
    expect(compactLayout(360, 740, 1.3)).toBe(false);
    expect(compactLayout(195, 422, 1)).toBe(true); // 200% browser zoom on a 390 px phone
    expect(compactLayout(360, 520, 1)).toBe(true);
    expect(compactLayout(411, 891, 2)).toBe(true);
  });
});

/* ------------------------------------------------------------------ signing only what was opened (I4) */

/** One cent moved between two payouts and their PayPal lines: a valid batch, but not the one opened. */
const otherBatch = movedCent;

/** The approval-payload answer for `dto`, with `over` in its payload (and the JCS of that payload). */
function payloadFor(dto: CosignRequestDTO, over: Partial<ApprovalPayload> = {}): ApprovalPayloadDTO {
  const base = buildDemoApproval(dto, {
    role: "chair",
    nonce: "n_01JB7Q3X9M2",
    exp: new Date(NOW.getTime() + 10 * 60_000).toISOString(),
  });
  const payload = { ...base.payload, ...over };
  return { ...base, payload, jcs: jcs(payload) };
}

describe("the gate in front of the key", () => {
  it("lets the key be asked for only while the request is open and is the batch he opened", () => {
    expect(commitRefusal(snap())).toBeNull();
    expect(canCommit(snap({}, { state: "override", reason: "override" }))).toBe(true);
  });

  const cases: [string, Partial<CosignSnapshot>, Partial<CosignRequestDTO>, string][] = [
    ["the batch changed", { opened: { batchSha256: "a".repeat(64), linesDigest, seasonId } }, {}, "mismatch"],
    ["the payload was another batch", { payloadOk: false }, {}, "mismatch"],
    ["the server's hash is not the items'", {}, { batchSha256: "0".repeat(64) }, "mismatch"],
    ["nothing was ever opened", { opened: null }, {}, "mismatch"],
    ["there is no signal", { online: false }, {}, "offline"],
    ["it was sent back", { sentBack: true }, {}, "closed"],
    ["it is signed already", { chairSigned: true }, {}, "closed"],
    ["it expired", { now: NOW.getTime() + 31 * 60_000 }, {}, "closed"],
    ["it was declined elsewhere", {}, { state: "declined" }, "closed"],
    ["nothing has loaded", { dto: null, check: null, loading: true }, {}, "closed"],
  ];
  it.each(cases)("inv.i4.gate: refuses when %s", (_why, over, dto, refusal) => {
    const s = snap(over, dto);
    expect(commitRefusal(s)).toBe(refusal);
    expect(canCommit(s)).toBe(false);
  });
});

describe("what the phone remembers between fetches", () => {
  const a = buildDemoCosign({ now: NOW, treasurerSigned: true });
  const b = otherBatch(a);

  it("opens the first good batch, and keeps it when the same batch is fetched again", () => {
    const first = rememberRequest(EMPTY_MEMORY, a, false);
    expect(first.opened).toEqual({ batchSha256, linesDigest, seasonId });
    const withPayload = { ...first, payload: payloadFor(a), payloadOk: true };
    const again = rememberRequest(withPayload, a, false);
    expect(again.opened).toEqual(first.opened);
    expect(again.payload).toEqual(withPayload.payload);
    expect(again.payloadOk).toBe(true);
  });

  it("inv.i4.payload-dropped-on-change: a new batch keeps the opened one and drops the payload in hand", () => {
    const opened = { ...rememberRequest(EMPTY_MEMORY, a, false), payload: payloadFor(a), payloadOk: true };
    const changed = rememberRequest(opened, b, false);
    expect(changed.opened).toEqual(opened.opened);
    expect(sameAsOpened(changed.check, changed.opened)).toBe(false);
    expect(changed.payload).toBeNull();
    expect(changed.payloadOk).toBeNull();
    expect(prefetchFor(changed)).toBeNull();
    expect(payloadPlan(changed, NOW)).toEqual({ kind: "refuse" });
  });

  it("opens the new batch only when he reviews it again, and starts it with no payload", () => {
    const changed = rememberRequest(rememberRequest(EMPTY_MEMORY, a, false), b, false);
    const reviewed = rememberRequest(changed, b, true);
    expect(reviewed.opened).toEqual(openedFrom(checkCosignRequest(b)));
    expect(reviewed.payload).toBeNull();
    expect(prefetchFor(reviewed)?.batchSha256).toBe(b.batchSha256);
  });

  it("never opens a batch whose claimed hash is not its items' hash", () => {
    const bad = rememberRequest(EMPTY_MEMORY, { ...a, batchSha256: "0".repeat(64) }, false);
    expect(bad.opened).toBeNull();
    expect(prefetchFor(bad)).toBeNull();
    expect(payloadPlan(bad, NOW)).toEqual({ kind: "refuse" });
  });

  it("prefetches only an open request whose key 1 is in", () => {
    expect(prefetchFor(rememberRequest(EMPTY_MEMORY, a, false))?.batchSha256).toBe(batchSha256);
    expect(prefetchFor(rememberRequest(EMPTY_MEMORY, { ...a, treasurerSigned: null }, false))).toBeNull();
    expect(prefetchFor(rememberRequest(EMPTY_MEMORY, { ...a, state: "signed" }, false))).toBeNull();
  });

  it("keeps a payload only for the batch it was checked against, and only while that batch is open", () => {
    const m = rememberRequest(EMPTY_MEMORY, a, false);
    const expected = prefetchFor(m);
    if (!expected) throw new Error("the fixture is signable");
    const good = checkApprovalPayload(payloadFor(a), expected, NOW);
    expect(rememberPayload(m, expected, good)).toMatchObject({ payloadOk: true });
    const wrong = checkApprovalPayload(payloadFor(b), expected, NOW);
    expect(rememberPayload(m, expected, wrong)).toMatchObject({ payload: null, payloadOk: false });
    const late = payloadFor(a, { exp: new Date(NOW.getTime() - 1).toISOString() });
    const expired = checkApprovalPayload(late, expected, NOW);
    expect(rememberPayload(m, expected, expired)).toMatchObject({ payload: null, payloadOk: null });
    // An answer for a batch he no longer has open changes nothing (he reviewed the new one meanwhile).
    const reviewed = rememberRequest(m, b, true);
    expect(rememberPayload(reviewed, expected, good)).toBe(reviewed);
    expect(rememberPayload(reviewed, expected, wrong)).toBe(reviewed);
    expect(forgetPayload({ ...m, payload: payloadFor(a) }).payload).toBeNull();
  });

  it("uses the payload in hand while it has two minutes left, then fetches one for the opened batch", () => {
    const m = rememberRequest(EMPTY_MEMORY, a, false);
    const fresh = { ...m, payload: payloadFor(a), payloadOk: true };
    expect(payloadPlan(fresh, NOW)).toMatchObject({ kind: "cached" });
    const soon = new Date(NOW.getTime() + 90_000).toISOString();
    const stale = { ...fresh, payload: payloadFor(a, { exp: soon }) };
    expect(payloadPlan(stale, NOW)).toMatchObject({
      kind: "fetch",
      expected: { batchSha256, linesDigest, seasonId },
    });
    // A payload in hand that is not the opened batch is never reused, whatever it claims.
    expect(payloadPlan({ ...fresh, payload: payloadFor(b) }, NOW)).toMatchObject({ kind: "fetch" });
  });
});

describe("a resolved hold in the Chair's language", () => {
  it("never sets the console's English summary as his own words", () => {
    expect(holdNote("en", { gloss: false, expanded: false })).toBe("line");
    expect(holdNote("ceb", { gloss: false, expanded: false })).toBe("hidden");
    expect(holdNote("ceb", { gloss: false, expanded: true })).toBe("note");
    // UI gate round 5 (one language a line): a judge frame's gloss no longer opens every hold's English note.
    expect(holdNote("fil", { gloss: true, expanded: false })).toBe("hidden");
    expect(holdNote("fil", { gloss: true, expanded: true })).toBe("note");
  });
});

describe("whose review it is (security review: an opened batch belongs to the officer who opened it)", () => {
  it("cosign.scope: another officer paired, or the same name in another workspace, starts the request over", () => {
    const ernesto = "a1b2c3d4e5f60718"; // identityKey of the Chair's pairing
    expect(requestScope("2026A-r37", ernesto)).toBe(requestScope("2026A-r37", ernesto)); // a new token: the same
    expect(requestScope("2026A-r37", ernesto)).not.toBe(requestScope("2026A-r37", "0f1e2d3c4b5a6978"));
    expect(requestScope("2026A-r37", ernesto)).not.toBe(requestScope("2026A-r37", null));
    expect(requestScope("2026A-r37", ernesto)).not.toBe(requestScope("2026A-r38", ernesto));
    expect(requestScope("a|b", "c")).not.toBe(requestScope("a", "b|c"));
  });
});
