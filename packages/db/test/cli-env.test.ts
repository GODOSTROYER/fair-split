import { describe, expect, it } from "vitest";
import { databaseName, resolveMigrateEnv } from "../src/cli/env.js";

describe("migrate CLI credentials (S3.4, WS-OPS render.yaml contract)", () => {
  // no credentials in the strings: these tests are about which variable wins, not about passwords
  const owner = "postgres://owner@db.internal:5432/fairsplit";
  const app = "postgres://fs_app@db.internal:5432/fairsplit";

  it("prefers DATABASE_OWNER_URL and carries FS_APP_DB_PASSWORD through", () => {
    expect(
      resolveMigrateEnv({ DATABASE_OWNER_URL: owner, DATABASE_URL: app, FS_APP_DB_PASSWORD: "x".repeat(20) }),
    ).toEqual({ ownerUrl: owner, source: "DATABASE_OWNER_URL", appPassword: "x".repeat(20) });
  });

  it("on Render never falls back to DATABASE_URL, which is fs_app's login there", () => {
    expect(() => resolveMigrateEnv({ RENDER: "true", DATABASE_URL: app })).toThrow(/DATABASE_OWNER_URL/);
  });

  it("off Render (local, CI) the one DATABASE_URL is the owner; an empty password means none", () => {
    expect(resolveMigrateEnv({ DATABASE_URL: owner, FS_APP_DB_PASSWORD: "" })).toEqual({
      ownerUrl: owner,
      source: "DATABASE_URL",
      appPassword: null,
    });
    expect(() => resolveMigrateEnv({})).toThrow(/not set/);
  });

  it("logs only the database name", () => {
    expect(databaseName(owner)).toBe("fairsplit");
    expect(databaseName("postgres://u@h:1")).toBe("(default)");
  });
});
