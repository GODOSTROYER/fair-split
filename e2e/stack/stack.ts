// The e2e stack (E1): everything a judge's browser talks to, private to one run, on free ports.
//
//   1. the console build and the /app export (`turbo run build`, cached; E2E_SKIP_BUILD=1 skips it, and
//      E2E_CONSOLE_DIR serves another console build, such as a branch's, instead of apps/console/dist);
//   2. curated public media assembled under .codex-scratch/e2e-stack, then an embedded Postgres 17 there
//      (gitignored; @fairsplit/db/testing, as fs-api's smoke does, or
//      FS_TEST_DATABASE_URL when CI provides a Postgres), a fresh `fs_e2e` database, every migration applied;
//   3. fs-api in its own process (src/index.ts through tsx), PP_MODE=simulator: PayPal answers through fs-api's
//      in-process simulator (ADR-0010), so every PayPal-derived value is "Simulated PayPal sandbox". Keyless: no
//      ANTHROPIC_API_KEY reaches it, so the reading is the seed's labelled stand-in and nothing claims a live Claude
//      read. fs-api serves the console at /, the /app export and /media from the same origin;
//   4. throwaway signing secrets made here for this run (cookie, link and ledger keys), passed only to the child's
//      environment and never printed. No operator password or judge code: no spec signs in to /ops.
//
// stop() always stops everything: fs-api, then the database and the cluster. stopSync() does the same where nothing
// can be awaited (a process 'exit' listener). A pid file lets the next start end an fs-api an aborted run left.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@fairsplit/db";
import { startTestCluster, withDatabase } from "@fairsplit/db/testing";
// @fairsplit/db/testing also holds openTestDb, which reads Vitest's provided context; the package's global setup
// declares that context's type, so the program needs it to typecheck. Nothing from it runs here.
import type {} from "@fairsplit/db/testing/global-setup";
import postgres from "postgres";
import { assembleMedia } from "../../tools/assemble-media.js";
import { E2E_HOURLY_CAP } from "../lib/quota-config.js";

export const E2E_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = path.resolve(E2E_ROOT, "..");
const API_ROOT = path.join(REPO_ROOT, "apps", "api");
const CACHE_DIR = path.join(REPO_ROOT, ".codex-scratch", "e2e-stack");
const MEDIA_DIR = path.join(CACHE_DIR, "media");
const PID_FILE = path.join(CACHE_DIR, "fs-api.pid");
const DATABASE = "fs_e2e";

export interface StackOptions {
  log?: (line: string) => void;
  /** Skip `turbo run build` (the console and /app dists must already exist). Default: E2E_SKIP_BUILD. */
  skipBuild?: boolean;
  /** Serve this console build instead of apps/console/dist (absolute path). Default: E2E_CONSOLE_DIR. */
  consoleDir?: string;
  /** How long fs-api may take to answer /healthz and /readyz. */
  bootTimeoutMs?: number;
}

export interface Stack {
  origin: string;
  /**
   * The stack's own database (the local cluster's admin login on fs_e2e). The specs read PayPal's window from it
   * (lib/paypal-window.ts); it is passed to them in the environment, never printed.
   */
  databaseUrl: string;
  /** Where the console fs-api serves came from (apps/console/dist or E2E_CONSOLE_DIR). */
  consoleDir: string;
  pid: number;
  /** fs-api's recent output (warn and above). */
  output(): string;
  stop(): Promise<void>;
  stopSync(): void;
}

export function freePort(): Promise<number> {
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

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** An fs-api an aborted run left behind (its pid file names it): ended before a new one starts. */
function endLeftover(log: (line: string) => void): void {
  if (!existsSync(PID_FILE)) return;
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  if (Number.isInteger(pid) && pid > 0 && alive(pid)) {
    log(`ending fs-api pid ${pid} left by an earlier run`);
    try {
      process.kill(pid);
    } catch {
      // gone in the meantime
    }
  }
  rmSync(PID_FILE, { force: true });
}

function build(log: (line: string) => void, withConsole: boolean): void {
  const turbo = path.join(REPO_ROOT, "node_modules", "turbo", "bin", "turbo");
  const filters = [...(withConsole ? ["--filter=@fairsplit/console"] : []), "--filter=@fairsplit/mobile"];
  log(`building ${withConsole ? "the console and " : ""}the /app export (turbo, cached)`);
  const r = spawnSync(process.execPath, [turbo, "run", "build", ...filters, "--output-logs=errors-only"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    windowsHide: true,
    timeout: 15 * 60_000,
  });
  if (r.status !== 0) {
    throw new Error(`turbo run build failed (${r.status ?? r.signal})\n${r.stdout}\n${r.stderr}`);
  }
}

async function waitFor(
  url: string,
  child: ChildProcess,
  timeoutMs: number,
  ok: (status: number) => boolean,
): Promise<number | null> {
  const until = Date.now() + timeoutMs;
  let last: number | null = null;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`fs-api exited with code ${child.exitCode} during boot`);
    last = await fetch(url).then(
      (r) => r.status,
      () => null,
    );
    if (last !== null && ok(last)) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  return last;
}

/**
 * The embedded cluster, answering. startTestCluster reuses a cluster an aborted run left running; when that one does
 * not answer (its process was killed and postmaster.pid is stale), it is stopped and started afresh, once.
 */
async function openCluster(log: (line: string) => void) {
  for (let attempt = 1; ; attempt++) {
    const cluster = await startTestCluster({ cacheDir: CACHE_DIR });
    const probe = postgres(cluster.adminUrl, { max: 1, onnotice: () => {}, connect_timeout: 10 });
    try {
      await probe`select 1`;
      return cluster;
    } catch (err) {
      await cluster.stop();
      if (attempt >= 2) throw err;
      log(`the cluster an earlier run left does not answer (${(err as Error).message}); starting it afresh`);
      rmSync(path.join(CACHE_DIR, "pg", "pg17", "postmaster.pid"), { force: true });
    } finally {
      await probe.end({ timeout: 5 });
    }
  }
}

export async function startStack(o: StackOptions = {}): Promise<Stack> {
  const log = o.log ?? (() => undefined);
  const consoleOverride = o.consoleDir ?? process.env.E2E_CONSOLE_DIR;
  const consoleDir = path.resolve(consoleOverride ?? path.join(REPO_ROOT, "apps", "console", "dist"));
  const appDir = path.join(REPO_ROOT, "apps", "mobile", "dist");
  mkdirSync(CACHE_DIR, { recursive: true });
  endLeftover(log);

  if (!(o.skipBuild ?? process.env.E2E_SKIP_BUILD === "1")) build(log, consoleOverride === undefined);
  for (const [what, dir] of [
    ["console", consoleDir],
    ["/app export", appDir],
  ] as const) {
    if (!existsSync(path.join(dir, "index.html"))) throw new Error(`no ${what} build at ${dir}`);
  }

  // Global setup and the manual stack use the same allowlist as Render; never serve the media source tree.
  const media = assembleMedia(REPO_ROOT, MEDIA_DIR);
  if (media.problems.length > 0)
    throw new Error(`curated media assembly failed: ${media.problems.join("; ")}`);
  log(`assembled ${media.files.length} curated media files`);

  const cluster = await openCluster(log);
  let child: ChildProcess | null = null;
  let stopped = false;
  const dropDatabase = async () => {
    const admin = postgres(cluster.adminUrl, { max: 1, onnotice: () => {} });
    await admin.unsafe(`drop database if exists "${DATABASE}" with (force)`).catch(() => undefined);
    await admin.end({ timeout: 5 });
  };
  const killChild = () => {
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    rmSync(PID_FILE, { force: true });
  };
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((r) => child?.once("exit", () => r()));
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
    }
    killChild();
    await dropDatabase();
    await cluster.stop();
  };
  const stopSync = () => {
    if (stopped) return;
    stopped = true;
    killChild();
    cluster.stopSync();
  };

  try {
    await dropDatabase();
    const admin = postgres(cluster.adminUrl, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database "${DATABASE}"`);
    await admin.end({ timeout: 5 });
    const url = withDatabase(cluster.adminUrl, DATABASE);
    await runMigrations(url);
    log(`postgres ${cluster.source} cluster, database ${DATABASE} migrated`);

    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    // A whitelist, not process.env: no ANTHROPIC_API_KEY, PayPal credential or other secret of the shell reaches it.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      ...(process.platform === "win32"
        ? { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP }
        : { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR }),
      NODE_ENV: "test",
      LOG_LEVEL: "warn",
      HOST: "127.0.0.1",
      PORT: String(port),
      PUBLIC_ORIGIN: origin,
      DATABASE_URL: url,
      PP_ENV: "sandbox",
      PP_MODE: "simulator",
      // The real hourly cap is global, so fresh spec cookies alone cannot isolate payout specs. This override is
      // accepted only in test+simulator mode; daily, per-cookie, balance, lane and PayPal pacing guards still bind.
      FS_TEST_JUDGE_HOURLY_MAX: String(E2E_HOURLY_CAP),
      EXECUTOR: "inline",
      FS_COOKIE_SECRET: randomBytes(32).toString("hex"),
      FS_LINK_SIGNING_KEY: randomBytes(32).toString("hex"),
      FS_LEDGER_SIGNING_KEY: randomBytes(32).toString("hex"),
      FS_REPO_ROOT: REPO_ROOT,
      STATIC_CONSOLE_DIR: consoleDir,
      STATIC_APP_DIR: appDir,
      STATIC_MEDIA_DIR: MEDIA_DIR,
    };
    child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: API_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    writeFileSync(PID_FILE, String(child.pid ?? ""));
    const output: string[] = [];
    const keep = (d: Buffer) => {
      output.push(d.toString("utf8"));
      if (output.length > 400) output.shift();
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    const timeout = o.bootTimeoutMs ?? 120_000;
    try {
      const health = await waitFor(`${origin}/healthz`, child, timeout, (s) => s === 200);
      if (health !== 200) throw new Error(`fs-api /healthz did not answer 200 within ${timeout} ms`);
      const ready = await waitFor(`${origin}/readyz`, child, 30_000, (s) => s === 200);
      if (ready !== 200) throw new Error(`fs-api /readyz answered ${ready ?? "nothing"}, not 200`);
    } catch (err) {
      throw new Error(`${(err as Error).message}\n--- fs-api output ---\n${output.join("")}`);
    }
    log(`fs-api up at ${origin} (pid ${child.pid}), console from ${consoleDir}`);
    return {
      origin,
      databaseUrl: url,
      consoleDir,
      pid: child.pid ?? 0,
      output: () => output.join(""),
      stop,
      stopSync,
    };
  } catch (err) {
    await stop();
    throw err;
  }
}
