import { describe, expect, it } from "vitest";
import * as contractShim from "../src/_shims/contracts.js";
import * as cron from "../src/cron.js";
import { captureLogger } from "./helpers.js";

describe("retired tasks cron planner", () => {
  it("contains no second schedule or provisional scheduled-task keys", () => {
    expect(cron).not.toHaveProperty("planCronRun");
    expect(cron).not.toHaveProperty("runCron");
    expect(contractShim).not.toHaveProperty("TASK_KEYS");
  });

  it("refuses the obsolete plan CLI and names the authoritative API plan and thin trigger", async () => {
    const { logger, lines } = captureLogger();
    await expect(cron.main(["--plan", "--at=2026-10-24T02:07:00Z"], { logger })).resolves.toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.msg).toContain("apps/api/src/routes/internal/cron.ts");
    expect(lines[0]?.msg).toContain("node tools/cron-tick.mjs");
    expect(lines[0]?.msg).not.toContain("cron.plan");
  });
});
