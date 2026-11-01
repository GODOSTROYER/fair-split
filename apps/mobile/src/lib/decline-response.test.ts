import { describe, expect, expectTypeOf, it } from "vitest";
import { createHttpApi, type FairSplitApi } from "../_shims/api-client";
import { runSlug } from "../_shims/seed";
import { createDemoApi } from "../services/demo-api";

describe("decline response parity", () => {
  it("types and returns fs-api's IN_REVIEW transition in live and demo mode", async () => {
    const live = createHttpApi({
      origin: "http://localhost",
      getBearer: () => null,
      fetch: async () => Response.json({ runState: "IN_REVIEW" }),
    });
    const demo = createDemoApi({ now: () => new Date(), randomBytes: (n) => new Uint8Array(n) });
    for (const api of [live, demo]) {
      expect(await api.declineApproval(runSlug, { role: "chair", reason: "Check the slips" })).toEqual({
        ok: true,
        value: { runState: "IN_REVIEW" },
      });
    }
    type Reply = Awaited<ReturnType<FairSplitApi["declineApproval"]>>;
    expectTypeOf<Extract<Reply, { ok: true }>["value"]>().toEqualTypeOf<{ runState: "IN_REVIEW" }>();
  });
});
