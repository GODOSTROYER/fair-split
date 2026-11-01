import type { schema } from "@fairsplit/db";
import { describe, expect, it } from "vitest";
import { approvalDto } from "./dto.js";

describe("approval key labels", () => {
  it.each([
    ["fs-analyn-demo-a1b2c3", "Browser demo key"],
    ["fs-ernesto-demo-000000", "Browser demo key"],
    ["fs-analyn-a1", "Device key"],
    ["fs-analyn-w1", "Demo key (this browser)"],
    ["fs-analyn-s1", "Sample key (seeded)"],
  ])("inv.i8.key-label: %s is labelled %s", (keyId, label) => {
    const row = {
      keyId,
      role: "treasurer",
      createdAt: new Date("2026-11-01T00:00:00Z"),
      voidedAt: null,
      provenance: "simulated_rail",
    } as typeof schema.approvals.$inferSelect;
    expect(approvalDto(row).keyLabel).toBe(label);
  });
});
