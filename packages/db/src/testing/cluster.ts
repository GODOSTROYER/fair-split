/**
 * A real Postgres for tests, with no system install.
 *
 * - `FS_TEST_DATABASE_URL` set (CI's Postgres service): use it as the admin URL.
 * - Otherwise: an embedded Postgres 17 cluster from the `embedded-postgres` platform binaries, kept in
 *   `<package>/.cache/pg/` (gitignored). initdb runs once; later runs start the cluster in about half a second.
 *   It binds 127.0.0.1 on a free port with trust auth, fsync off. Everything it writes stays in the worktree:
 *   TEMP/TMP point into .cache while initdb runs.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

export interface TestCluster {
  adminUrl: string;
  source: "embedded" | "external";
  stop(): Promise<void>;
}

interface Binaries {
  initdb: string;
  pg_ctl: string;
}

async function binaries(): Promise<Binaries> {
  const os = process.platform === "win32" ? "windows" : process.platform;
  const pkg = `@embedded-postgres/${os}-${process.arch}`;
  const mod = (await import(pkg)) as Binaries;
  return { initdb: mod.initdb, pg_ctl: mod.pg_ctl };
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${path.basename(cmd)} timed out after ${timeoutMs} ms\n${out}`));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    // 'exit', not 'close': on Windows the server started by `pg_ctl start` can inherit the pipes and hold
    // them open long after pg_ctl itself has returned
    child.on("exit", (code) => {
      clearTimeout(timer);
      setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        if (code === 0) resolve(out);
        else reject(new Error(`${path.basename(cmd)} ${args[0] ?? ""} exited ${code}\n${out}`));
      }, 50);
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function runningPort(dataDir: string): number | null {
  const pidFile = path.join(dataDir, "postmaster.pid");
  if (!existsSync(pidFile)) return null;
  // postmaster.pid line 4 is the port
  const port = Number(readFileSync(pidFile, "utf8").split(/\r?\n/)[3]);
  return Number.isInteger(port) && port > 0 ? port : null;
}

export async function startTestCluster(opts: { cacheDir?: string } = {}): Promise<TestCluster> {
  const external = process.env.FS_TEST_DATABASE_URL;
  if (external) return { adminUrl: external, source: "external", stop: async () => {} };

  const cacheDir = path.resolve(opts.cacheDir ?? path.join(process.cwd(), ".cache"));
  const dataDir = path.join(cacheDir, "pg", "pg17");
  const tmpDir = path.join(cacheDir, "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const env = { ...process.env, TEMP: tmpDir, TMP: tmpDir, TMPDIR: tmpDir, LC_MESSAGES: "C" };
  const bin = await binaries();

  if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
    mkdirSync(path.dirname(dataDir), { recursive: true });
    await run(
      bin.initdb,
      [
        `--pgdata=${dataDir}`,
        "--username=postgres",
        "--auth=trust",
        "--encoding=UTF8",
        "--locale=C",
        "--no-sync",
      ],
      env,
    );
  }

  // a cluster left running by an aborted run is reused rather than fought over
  let port = runningPort(dataDir);
  let reachable = false;
  if (port !== null) {
    reachable = await run(bin.pg_ctl, ["status", "-D", dataDir], env, 15_000).then(
      () => true,
      () => false,
    );
  }
  if (!reachable) {
    port = await freePort();
    const serverOpts = [
      `-p ${port}`,
      "-c listen_addresses=127.0.0.1",
      "-c fsync=off",
      "-c synchronous_commit=off",
      "-c full_page_writes=off",
      "-c max_connections=300",
      "-c deadlock_timeout=200ms",
    ].join(" ");
    await run(
      bin.pg_ctl,
      [
        "start",
        "-D",
        dataDir,
        "-w",
        "-t",
        "60",
        "-l",
        path.join(cacheDir, "pg", "pg17.log"),
        "-o",
        serverOpts,
      ],
      env,
    );
  }

  return {
    adminUrl: `postgres://postgres@127.0.0.1:${port}/postgres`,
    source: "embedded",
    stop: async () => {
      await run(bin.pg_ctl, ["stop", "-D", dataDir, "-m", "fast", "-w", "-t", "30"], env, 60_000).catch(
        () => {},
      );
    },
  };
}
