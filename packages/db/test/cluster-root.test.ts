/**
 * The embedded cluster as root (DR-4, the Linux clean-clone check). Postgres's initdb and postgres refuse to run
 * as uid 0 ("initdb: error: cannot be run as root"), which is how Docker containers and many CI images run. The
 * harness says so before it spawns anything, and names both ways out: a regular user, or FS_TEST_DATABASE_URL.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rootRefusal, startTestCluster } from "../src/testing/cluster.js";

const saved = process.env.FS_TEST_DATABASE_URL;
afterEach(() => {
  if (saved === undefined) delete process.env.FS_TEST_DATABASE_URL;
  else process.env.FS_TEST_DATABASE_URL = saved;
});

describe("the embedded cluster as root", () => {
  it("refuses uid 0 with a message naming both ways out", () => {
    const why = rootRefusal(0);
    expect(why).toMatch(/root/);
    expect(why).toContain("FS_TEST_DATABASE_URL");
    expect(why).toMatch(/regular user/);
  });

  it("accepts any other user, and Windows, which has no uid", () => {
    expect(rootRefusal(1000)).toBeNull();
    expect(rootRefusal(undefined)).toBeNull();
  });

  it("fails before initdb runs: no data directory is created", async () => {
    delete process.env.FS_TEST_DATABASE_URL;
    const cacheDir = mkdtempSync(path.join(tmpdir(), "fs-root-"));
    try {
      await expect(startTestCluster({ cacheDir, uid: 0 })).rejects.toThrow(/FS_TEST_DATABASE_URL/);
      expect(existsSync(path.join(cacheDir, "pg"))).toBe(false);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("an external server needs no embedded cluster, so root may use one", async () => {
    process.env.FS_TEST_DATABASE_URL = "postgres://postgres@127.0.0.1:1/postgres";
    const cluster = await startTestCluster({ uid: 0 });
    expect(cluster.source).toBe("external");
    expect(cluster.adminUrl).toBe("postgres://postgres@127.0.0.1:1/postgres");
  });
});
