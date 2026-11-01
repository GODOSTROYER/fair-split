// The boot step fs-api takes before anything reads DATABASE_URL (S3.4, ADR-0005), lifted from apps/tasks/src/db-env.ts.
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { APP_DB_ROLE, DbEnvError, resolveAppDatabaseUrl, useAppDatabaseUrl } from "../src/index.js";

// Built at runtime so no connection string with a password sits in the source (secretlint).
const PASSWORD = ["Zm9v", "YmFy+/=", "@:?#%"].join("");
const ownerUrl = () => {
  const u = new URL("postgresql://dpg-test-a:5432/fairsplit");
  u.username = "fairsplit";
  u.password = "owner-password-not-real";
  return u.toString();
};
const renderParts = { FS_DB_HOST: "dpg-test-a", FS_DB_PORT: "5432", FS_DB_NAME: "fairsplit" };

describe("resolveAppDatabaseUrl (S3.4: every process connects as fs_app)", () => {
  it("builds fs_app's URL from Render's host, port and name plus FS_APP_DB_PASSWORD", () => {
    const r = resolveAppDatabaseUrl({ ...renderParts, FS_APP_DB_PASSWORD: PASSWORD });
    expect(r.source).toBe("parts");
    const u = new URL(r.url ?? "");
    expect([u.protocol, u.hostname, u.port, u.pathname]).toEqual([
      "postgresql:",
      "dpg-test-a",
      "5432",
      "/fairsplit",
    ]);
    expect(u.username).toBe(APP_DB_ROLE);
    expect(decodeURIComponent(u.password)).toBe(PASSWORD);
  });

  it("round-trips through the postgres driver's own URL parser", () => {
    const r = resolveAppDatabaseUrl({ ...renderParts, FS_APP_DB_PASSWORD: PASSWORD });
    const opts = postgres(r.url ?? "").options;
    expect(opts.user).toBe(APP_DB_ROLE);
    expect(opts.pass).toBe(PASSWORD);
    expect(opts.host).toEqual(["dpg-test-a"]);
    expect(opts.database).toBe("fairsplit");
  });

  it("defaults the port, and adds sslmode for an external host when asked", () => {
    const r = resolveAppDatabaseUrl({
      FS_DB_HOST: "dpg-test-a.virginia-postgres.render.com",
      FS_DB_NAME: "fairsplit",
      FS_DB_SSLMODE: "require",
      FS_APP_DB_PASSWORD: "pw",
    });
    const u = new URL(r.url ?? "");
    expect(u.port).toBe("5432");
    expect(u.searchParams.get("sslmode")).toBe("require");
  });

  it("builds fs_app's URL from the owner's DATABASE_OWNER_URL (fs-api on Render; migrate keeps the owner URL)", () => {
    const r = resolveAppDatabaseUrl({ DATABASE_OWNER_URL: ownerUrl(), FS_APP_DB_PASSWORD: PASSWORD });
    expect(r.source).toBe("from-owner");
    const u = new URL(r.url ?? "");
    expect([u.username, u.hostname, u.port, u.pathname]).toEqual([
      APP_DB_ROLE,
      "dpg-test-a",
      "5432",
      "/fairsplit",
    ]);
    expect(decodeURIComponent(u.password)).toBe(PASSWORD);
    expect(r.url).not.toContain("owner-password-not-real");
    expect(postgres(r.url ?? "").options.user).toBe(APP_DB_ROLE);
  });

  it("next to DATABASE_OWNER_URL, accepts a DATABASE_URL only when it is fs_app's own login", () => {
    const app = new URL(ownerUrl());
    app.username = APP_DB_ROLE;
    app.password = "app-password-not-real";
    expect(resolveAppDatabaseUrl({ DATABASE_OWNER_URL: ownerUrl(), DATABASE_URL: app.toString() })).toEqual({
      url: app.toString(),
      source: "as-is",
    });
    expect(() => resolveAppDatabaseUrl({ DATABASE_OWNER_URL: ownerUrl(), DATABASE_URL: ownerUrl() })).toThrow(
      /must be fs_app's own login/,
    );
  });

  it("swaps fs_app's credentials into an owner DATABASE_URL (local runs; the S3.14 sample)", () => {
    const r = resolveAppDatabaseUrl({ DATABASE_URL: ownerUrl(), FS_APP_DB_PASSWORD: PASSWORD });
    expect(r.source).toBe("swapped");
    const u = new URL(r.url ?? "");
    expect(u.username).toBe(APP_DB_ROLE);
    expect(decodeURIComponent(u.password)).toBe(PASSWORD);
    expect(r.url).not.toContain("owner-password-not-real");
    expect(u.hostname).toBe("dpg-test-a");
  });

  it("never names a credential in its errors", () => {
    for (const env of [
      { DATABASE_OWNER_URL: ownerUrl() },
      { DATABASE_OWNER_URL: ownerUrl(), DATABASE_URL: ownerUrl() },
      // Assembled at runtime, like ownerUrl(): no credential-bearing URL literal in the source.
      {
        DATABASE_OWNER_URL: ["mysql://u", "owner-password-not-real@h/db"].join(":"),
        FS_APP_DB_PASSWORD: "pw",
      },
    ]) {
      let message = "";
      try {
        resolveAppDatabaseUrl(env);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message).not.toBe("");
      expect(message).not.toContain("owner-password-not-real");
    }
  });

  it("leaves a local DATABASE_URL as given, and reports none without one", () => {
    expect(resolveAppDatabaseUrl({ DATABASE_URL: "postgres://localhost/fairsplit" })).toEqual({
      url: "postgres://localhost/fairsplit",
      source: "as-is",
    });
    expect(resolveAppDatabaseUrl({})).toEqual({ source: "none" });
    expect(resolveAppDatabaseUrl({ DATABASE_URL: "  " })).toEqual({ source: "none" });
  });

  it("refuses half-configured or ambiguous environments instead of guessing a role", () => {
    const bad: NodeJS.ProcessEnv[] = [
      { ...renderParts }, // no password: must never connect as anyone else
      { ...renderParts, FS_APP_DB_PASSWORD: "pw", DATABASE_URL: ownerUrl() },
      { FS_DB_HOST: "dpg-test-a", FS_APP_DB_PASSWORD: "pw" }, // no database name
      { ...renderParts, FS_DB_PORT: "99999", FS_APP_DB_PASSWORD: "pw" },
      { ...renderParts, FS_DB_HOST: "evil.example/x@other", FS_APP_DB_PASSWORD: "pw" },
      { ...renderParts, FS_DB_HOST: "[::1", FS_APP_DB_PASSWORD: "pw" },
      { DATABASE_URL: "not a url", FS_APP_DB_PASSWORD: "pw" },
      { DATABASE_URL: "mysql://h/db", FS_APP_DB_PASSWORD: "pw" },
      { ...renderParts, FS_APP_DB_PASSWORD: "pw", DATABASE_OWNER_URL: ownerUrl() }, // fs-tasks never gets it
      { DATABASE_OWNER_URL: ownerUrl() }, // no password: the app never runs as the owner
      { DATABASE_OWNER_URL: "not a url", FS_APP_DB_PASSWORD: "pw" },
      { DATABASE_OWNER_URL: "mysql://h/db", FS_APP_DB_PASSWORD: "pw" },
    ];
    for (const env of bad) expect(() => resolveAppDatabaseUrl(env), JSON.stringify(env)).toThrow(DbEnvError);
  });

  it("accepts IPv6 hosts", () => {
    const r = resolveAppDatabaseUrl({ ...renderParts, FS_DB_HOST: "::1", FS_APP_DB_PASSWORD: "pw" });
    expect(new URL(r.url ?? "").hostname).toBe("[::1]");
  });
});

describe("useAppDatabaseUrl (boot step)", () => {
  it("fs-api's boot points DATABASE_URL at fs_app and deletes the owner's URL and fs_app's password", () => {
    const env: NodeJS.ProcessEnv = {
      DATABASE_OWNER_URL: ownerUrl(),
      FS_APP_DB_PASSWORD: PASSWORD,
      RENDER: "true",
    };
    expect(useAppDatabaseUrl(env)).toBe("from-owner");
    expect(new URL(env.DATABASE_URL ?? "").username).toBe(APP_DB_ROLE);
    expect(env.FS_APP_DB_PASSWORD).toBeUndefined();
    expect(env.DATABASE_OWNER_URL).toBeUndefined();
    expect(JSON.stringify(env)).not.toContain("owner-password-not-real");
  });

  it("removes every other database credential after a swap, too", () => {
    const env: NodeJS.ProcessEnv = { DATABASE_URL: ownerUrl(), FS_APP_DB_PASSWORD: PASSWORD };
    expect(useAppDatabaseUrl(env)).toBe("swapped");
    expect(new URL(env.DATABASE_URL ?? "").username).toBe(APP_DB_ROLE);
    expect(Object.keys(env)).toEqual(["DATABASE_URL"]);
    expect(JSON.stringify(env)).not.toContain("owner-password-not-real");
  });

  it("refuses to boot, and leaves the environment alone, when the configuration is ambiguous", () => {
    const env: NodeJS.ProcessEnv = { DATABASE_OWNER_URL: ownerUrl(), DATABASE_URL: ownerUrl() };
    expect(() => useAppDatabaseUrl(env)).toThrow(DbEnvError);
    expect(env.DATABASE_URL).toBe(ownerUrl());
  });

  it("is a no-op locally", () => {
    const env: NodeJS.ProcessEnv = { DATABASE_URL: "postgres://localhost/fairsplit" };
    expect(useAppDatabaseUrl(env)).toBe("as-is");
    expect(env).toEqual({ DATABASE_URL: "postgres://localhost/fairsplit" });
  });
});
