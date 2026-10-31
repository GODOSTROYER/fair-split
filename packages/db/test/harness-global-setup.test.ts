/**
 * The harness's Vitest global setup (src/testing/global-setup.ts), run the way a package runs it: a child
 * `vitest run` over a throwaway fixture in the OS temp dir whose config uses this global setup, against the
 * fixture's own embedded Postgres in <fixture>/.cache (so the fixture may stop it without touching this run's).
 *
 * At the ws/api trial merge a global setup that never settled made `vitest run` print only its RUN line and exit 0
 * having run no test, and turbo reported the package's tests as passed, with the cluster left running. Whatever goes
 * wrong in setup, the run must fail, say why, and leave no postgres behind.
 */
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestCluster, type TestCluster } from "../src/testing/cluster.js";
import { prepareTemplate, suitePrefix } from "../src/testing/template.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const harnessSetup = path.resolve(here, "../src/testing/global-setup.ts").replaceAll("\\", "/");
const vitestBin = path.join(
  path.dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
  "vitest.mjs",
);

const root = mkdtempSync(path.join(tmpdir(), "fs-harness-"));
const suite = path.basename(root);
const cacheDir = path.join(root, ".cache");
const pidFile = path.join(cacheDir, "pg", "pg17", "postmaster.pid");

const write = (rel: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text);
};
const config = (name: string, test: Record<string, unknown>) =>
  write(
    `vitest.${name}.config.mjs`,
    `export default ${JSON.stringify({ test: { globals: true, ...test } })};\n`,
  );

let cluster: TestCluster | undefined;

/** The fixture's cluster, started (or found running) from this process; the fixture's setup reuses it. */
async function fixtureCluster(): Promise<TestCluster> {
  const external = process.env.FS_TEST_DATABASE_URL;
  delete process.env.FS_TEST_DATABASE_URL; // the fixture always runs its own embedded cluster
  try {
    cluster = await startTestCluster({ cacheDir });
  } finally {
    if (external !== undefined) process.env.FS_TEST_DATABASE_URL = external;
  }
  return cluster;
}

async function withAdmin<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres((await fixtureCluster()).adminUrl, { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** `vitest run` in the fixture with one of its configs; output goes through a file, not a pipe. */
function vitestRun(name: string): { status: number | null; out: string } {
  const log = path.join(root, `${name}.log`);
  const fd = openSync(log, "w");
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) => !/^VITEST/.test(k) && !["FS_TEST_DATABASE_URL", "FORCE_COLOR"].includes(k),
      ),
    );
    const r = spawnSync(
      process.execPath,
      [vitestBin, "run", "--root", root, "--config", path.join(root, `vitest.${name}.config.mjs`)],
      { env: { ...env, NO_COLOR: "1" }, stdio: ["ignore", fd, fd], timeout: 150_000, windowsHide: true },
    );
    return { status: r.status, out: readFileSync(log, "utf8") };
  } finally {
    closeSync(fd);
  }
}

beforeAll(async () => {
  write("test/ok.test.mjs", 'test("runs", () => {\n  expect(1).toBe(1);\n});\n');
  write(
    "stall-setup.mjs",
    "// never settles, like the DROP DATABASE at the merge\nexport default () => new Promise(() => {});\n",
  );
  config("ok", { include: ["test/**/*.test.mjs"], globalSetup: [harnessSetup] });
  config("stall", { include: ["test/**/*.test.mjs"], globalSetup: [harnessSetup, "./stall-setup.mjs"] });
  config("empty", { include: ["nothing/**/*.test.mjs"], globalSetup: [harnessSetup] });
  await fixtureCluster(); // the first start runs initdb
}, 300_000);

afterAll(async () => {
  await cluster?.stop();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}, 120_000);

describe("the template of the current migrations", () => {
  it("is dropped and rebuilt when an interrupted drop left it INVALID", async () => {
    const { adminUrl } = await fixtureCluster();
    const name = await prepareTemplate(adminUrl, suite);
    // a drop clears the template flag first (a template cannot be dropped), then is cut short
    await withAdmin(
      (sql) => sql`update pg_database set datconnlimit = -2, datistemplate = false where datname = ${name}`,
    );

    await expect(prepareTemplate(adminUrl, suite)).resolves.toBe(name);

    const [row] = await withAdmin(
      (sql) => sql`select datconnlimit = -2 as invalid, datistemplate as template
                     from pg_database where datname = ${name}`,
    );
    expect(row).toEqual({ invalid: false, template: true });
  }, 180_000);
});

describe("a fixture suite run through the harness's global setup", () => {
  it("with no test files fails (Vitest's own check: no harness suite passes --passWithNoTests)", async () => {
    await fixtureCluster();
    const run = vitestRun("empty");
    expect(run.status, run.out).not.toBe(0);
    expect(run.out).toContain("No test files found");
  }, 180_000);

  it("runs its tests after cleaning up a leftover database that an interrupted DROP left INVALID", async () => {
    const leftover = `${suitePrefix(suite)}left0ver`;
    await withAdmin(async (sql) => {
      await sql.unsafe(`create database "${leftover}"`);
      await sql`update pg_database set datconnlimit = -2 where datname = ${leftover}`;
    });

    const run = vitestRun("ok");

    expect(run.status, run.out).toBe(0);
    expect(run.out).toMatch(/Tests\s+1 passed/);
    expect(existsSync(pidFile), "the teardown stops the cluster").toBe(false);
    const rows = await withAdmin((sql) => sql`select 1 from pg_database where datname = ${leftover}`);
    expect(rows).toHaveLength(0);
  }, 180_000);

  it("fails, and stops the cluster, when the run ends before Vitest tears the global setup down", async () => {
    await fixtureCluster();
    expect(existsSync(pidFile)).toBe(true);

    const run = vitestRun("stall");

    expect(run.status, run.out).toBe(1);
    expect(run.out).not.toMatch(/Tests\s+\d+ passed/);
    expect(run.out).toMatch(/exiting before Vitest tore down the global setup/);
    expect(existsSync(pidFile), "no postgres left running").toBe(false);
  }, 180_000);

  it("fails with the reason, and stops the cluster, when the global setup fails after the cluster started", async () => {
    const stuck = `${suitePrefix(suite)}stuck`;
    await withAdmin(async (sql) => {
      await sql.unsafe(`create database "${stuck}"`);
      await sql`update pg_database set datconnlimit = -2, datistemplate = true where datname = ${stuck}`;
    });
    try {
      const run = vitestRun("ok");

      expect(run.status, run.out).toBe(1);
      expect(run.out).not.toMatch(/Tests\s+\d+ passed/);
      expect(run.out).toMatch(/global setup failed/);
      expect(run.out).toContain(`"${stuck}" is invalid`);
      expect(existsSync(pidFile), "no postgres left running").toBe(false);
    } finally {
      await withAdmin(async (sql) => {
        await sql`update pg_database set datistemplate = false where datname = ${stuck}`;
        await sql.unsafe(`drop database if exists "${stuck}" with (force)`);
      });
    }
  }, 180_000);
});
