// The S3.8 role table at the HTTP boundary. The brand views the Proof brand tier and exports it (the PROOF
// slice's /v1/brand routes, masked receivers); a member views their own line through their link. Neither
// reads a run through the runs slice: not the batch (every member's PayPal receiver and amount), the lines,
// the holds, the approvals, the season, the slips, the rate card or the kill switches. C-23 keeps the public
// Proof to member IDs; these reads would undo it.
import type { ApiError } from "@fairsplit/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunsHarness, startRuns } from "./testing/app.js";

let h: RunsHarness;

beforeAll(async () => {
  h = await startRuns();
});
afterAll(async () => h?.close());

const reads = () => [
  `/v1/runs/${h.world.runSlug}`,
  `/v1/runs/${h.world.runSlug}/batch`,
  `/v1/runs/${h.world.runSlug}/lines`,
  `/v1/runs/${h.world.runSlug}/holds`,
  `/v1/runs/${h.world.runSlug}/approvals`,
  "/v1/seasons/2026-A",
  "/v1/seasons/2026-A/slips?photo=J",
  "/v1/seasons/2026-A/slips/0462",
  `/v1/rate-cards/${h.world.rateCardId}`,
  "/v1/flags",
];

describe("who reads a run (S3.8)", () => {
  it("the brand reads none of it: no receivers, no per-member amounts, no approvals, no switches", async () => {
    for (const path of reads()) {
      const r = await h.t.json<ApiError>(path, { as: h.t.credentials.bearer(h.tokens.brand) });
      expect(r.status, path).toBe(403);
      expect(r.body.code, path).toBe("FORBIDDEN");
      expect(JSON.stringify(r.body), path).not.toContain("@");
    }
  });

  it("nor does a member's frame token (their own line comes through their link)", async () => {
    for (const path of reads()) {
      const r = await h.t.json<ApiError>(path, { as: h.t.credentials.bearer(h.tokens.member) });
      expect(r.status, path).toBe(403);
      expect(r.body.code, path).toBe("FORBIDDEN");
    }
  });

  it("the treasurer, the Chair and the clerk still read every one of them", async () => {
    for (const token of [h.tokens.treasurer, h.tokens.chair, h.tokens.clerk]) {
      for (const path of reads()) {
        const r = await h.t.json(path, { as: h.t.credentials.bearer(token) });
        expect(r.status, path).toBe(200);
      }
    }
  });
});
