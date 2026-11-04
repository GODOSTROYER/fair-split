import { expect, it, vi } from "vitest";
import { createTestApp } from "../test/index.js";
import * as quota from "./quota.js";

it("HD6-5/13: refunded failures still consume a bounded global admission-attempt budget", async () => {
  const app = await createTestApp();
  const rail = vi.spyOn(quota, "judgeRail").mockRejectedValue(new Error("synthetic admission failure"));
  try {
    for (let i = 0; i < 121; i++) {
      const r = await app.json("/v1/judge/sessions", {
        method: "POST",
        body: {},
        headers: { "cf-connecting-ip": "192.0.2.148" },
      });
      expect(r.status, `attempt ${i + 1}`).toBe(i < 120 ? 500 : 429);
    }
    expect(rail).toHaveBeenCalledTimes(120);
  } finally {
    rail.mockRestore();
    await app.close();
  }
});
