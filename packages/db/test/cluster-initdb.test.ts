/**
 * An initdb that dies part-way (DR-4, the Linux clean-clone check). initdb writes PG_VERSION first and the
 * `postgres` database last, so a run killed between the two (turbo stopping every task when another package's test
 * fails, during a package's first initdb) left a directory the next run took for a finished cluster: every later
 * Postgres suite of that package failed (`database "postgres" does not exist`, or a server that never answered)
 * until someone deleted <package>/.cache/pg by hand. initdb now runs in a scratch directory that becomes the cluster
 * only once initdb has exited 0.
 *
 * Fake initdb and pg_ctl scripts stand in for the binaries, so the test needs no Postgres; they are POSIX shell
 * scripts, so it skips on Windows.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startTestCluster } from "../src/testing/cluster.js";

const saved = process.env.FS_TEST_DATABASE_URL;
const roots: string[] = [];
afterEach(() => {
  if (saved === undefined) delete process.env.FS_TEST_DATABASE_URL;
  else process.env.FS_TEST_DATABASE_URL = saved;
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** A fake initdb that writes PG_VERSION into --pgdata, then exits with `code`; and a pg_ctl that always succeeds. */
function fakes(code: number) {
  const root = mkdtempSync(path.join(tmpdir(), "fs-initdb-"));
  roots.push(root);
  const initdb = path.join(root, "initdb");
  const pgCtl = path.join(root, "pg_ctl");
  writeFileSync(
    initdb,
    `#!/bin/sh\nfor a in "$@"; do case "$a" in --pgdata=*) d="\${a#--pgdata=}";; esac; done\nmkdir -p "$d/base/1" && echo 17 > "$d/PG_VERSION"\nexit ${code}\n`,
  );
  writeFileSync(pgCtl, "#!/bin/sh\nexit 0\n");
  chmodSync(initdb, 0o755);
  chmodSync(pgCtl, 0o755);
  const cacheDir = path.join(root, ".cache");
  return { cacheDir, pgDir: path.join(cacheDir, "pg"), binaries: { initdb, pg_ctl: pgCtl } };
}

describe.skipIf(process.platform === "win32")("the embedded cluster's first initdb", () => {
  it("an initdb that fails part-way leaves no cluster for the next run to reuse", async () => {
    delete process.env.FS_TEST_DATABASE_URL;
    const f = fakes(1);
    await expect(startTestCluster({ cacheDir: f.cacheDir, uid: 1000, binaries: f.binaries })).rejects.toThrow(
      /initdb/,
    );
    expect(existsSync(path.join(f.pgDir, "pg17", "PG_VERSION"))).toBe(false);
  });

  it("a finished initdb becomes the cluster, with no scratch directory left beside it", async () => {
    delete process.env.FS_TEST_DATABASE_URL;
    const f = fakes(0);
    const cluster = await startTestCluster({ cacheDir: f.cacheDir, uid: 1000, binaries: f.binaries });
    expect(cluster.source).toBe("embedded");
    expect(existsSync(path.join(f.pgDir, "pg17", "PG_VERSION"))).toBe(true);
    expect(readdirSync(f.pgDir).filter((n) => n.startsWith("pg17."))).toEqual([]);
  });

  it("a scratch directory an earlier killed initdb left behind is cleared", async () => {
    delete process.env.FS_TEST_DATABASE_URL;
    const f = fakes(0);
    mkdirSync(path.join(f.pgDir, "pg17.initdb-12345", "base"), { recursive: true });
    await startTestCluster({ cacheDir: f.cacheDir, uid: 1000, binaries: f.binaries });
    expect(readdirSync(f.pgDir).filter((n) => n.startsWith("pg17."))).toEqual([]);
  });
});
