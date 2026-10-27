import { describe, expect, it } from "vitest";
import type { CosignRequestDTO } from "../../_shims/api-client";
import { SCREEN_STATES } from "../../_shims/contracts";
import { batchSha256 } from "../../_shims/seed";
import { checkCosignRequest } from "../../lib/signing";
import { buildDemoCosign } from "../../services/demo-fixtures";
import {
  type CosignSnapshot,
  changeReason,
  hashRows,
  memberOf,
  presenceView,
  requestExpired,
  requestStatus,
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
    openedHash: batchSha256,
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
    const s = snap({ openedHash: "a".repeat(64) });
    expect(changeReason(s)).toBe("changed");
    expect(requestStatus(s)).toBe("changed");
  });

  it("inv.i4.server-hash: a hash that is not the items' hash shows as changed, never as a request", () => {
    const s = snap({}, { batchSha256: "0".repeat(64) });
    expect(changeReason(s)).toBe("hash");
    expect(requestStatus(s)).toBe("changed");
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
