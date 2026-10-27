import { describe, expect, it } from "vitest";
import type { ApiResult, CosignRequestDTO } from "../../_shims/api-client";
import { runSlug } from "../../_shims/seed";
import { buildDemoCosign } from "../../services/demo-fixtures";
import { parseRememberedRun, pickTarget, probeRequest, runCandidates } from "./open-run";

const NOW = new Date("2026-10-29T10:20:00+08:00");
const found = (over: Partial<CosignRequestDTO> = {}): ApiResult<CosignRequestDTO> => ({
  ok: true,
  value: { ...buildDemoCosign({ now: NOW, treasurerSigned: true }), ...over },
});

describe("the Pirma tab finds the request waiting for the Chair", () => {
  it("asks the run a push or link opened first, then the seed's run, each once", () => {
    expect(runCandidates("2026A-r38", runSlug)).toEqual(["2026A-r38", runSlug]);
    expect(runCandidates(runSlug, runSlug)).toEqual([runSlug]);
    expect(runCandidates(null, runSlug)).toEqual([runSlug]);
    expect(runCandidates("../../etc", runSlug)).toEqual([runSlug]);
  });

  it("calls a request open only while it waits for his key", () => {
    expect(probeRequest(found(), NOW.getTime())).toBe("open");
    expect(probeRequest(found({ state: "override", reason: "override" }), NOW.getTime())).toBe("open");
    expect(probeRequest(found({ state: "signed" }), NOW.getTime())).toBe("closed");
    expect(probeRequest(found({ state: "declined" }), NOW.getTime())).toBe("closed");
    expect(probeRequest(found(), NOW.getTime() + 31 * 60_000)).toBe("closed");
    expect(probeRequest({ ok: false, code: "PAIRING_INVALID", status: 404 }, NOW.getTime())).toBe("missing");
    expect(probeRequest({ ok: false, code: "NETWORK" }, NOW.getTime())).toBe("offline");
    expect(probeRequest({ ok: false, code: "RATE_LIMITED", status: 429 }, NOW.getTime())).toBe("error");
  });

  it("opens the first open run, and otherwise says there is nothing to sign, never the seed's closed run", () => {
    expect(
      pickTarget([
        { runSlug: "2026A-r38", probe: "closed" },
        { runSlug, probe: "open" },
      ]),
    ).toEqual({ kind: "open", runSlug });
    expect(pickTarget([{ runSlug, probe: "closed" }])).toEqual({ kind: "none" });
    expect(pickTarget([{ runSlug, probe: "missing" }])).toEqual({ kind: "none" });
    expect(pickTarget([])).toEqual({ kind: "none" });
    expect(pickTarget([{ runSlug, probe: "offline" }])).toEqual({ kind: "offline" });
    expect(pickTarget([{ runSlug, probe: "error" }])).toEqual({ kind: "error" });
  });

  it("remembers a run per workspace, so a re-paired phone never asks another workspace's run", () => {
    const raw = JSON.stringify({ ws: "ws_judge_7", runSlug: "2026A-r38" });
    expect(parseRememberedRun(raw, "ws_judge_7")).toBe("2026A-r38");
    expect(parseRememberedRun(raw, "ws_judge_8")).toBeNull();
    expect(parseRememberedRun(raw, null)).toBeNull();
    expect(parseRememberedRun("{nope", "ws_judge_7")).toBeNull();
    expect(parseRememberedRun(JSON.stringify({ ws: "w", runSlug: "x/../y" }), "w")).toBeNull();
  });
});
