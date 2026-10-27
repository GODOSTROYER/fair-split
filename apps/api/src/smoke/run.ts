// `corepack pnpm --filter @fairsplit/api smoke`: boots fs-api the way Render starts it and smokes it over HTTP.
//
//   1. an embedded Postgres 17 (apps/api/.cache/smoke, gitignored; the test clusters are never touched), a fresh
//      `fs_smoke` database, every migration applied as the owner (Render's preDeployCommand does the same);
//   2. fs-api in its own process (`src/index.ts` through tsx, or the bundle with `--dist` after `pnpm build`),
//      PP_MODE=simulator: PayPal answers through the labelled stub (503 SIMULATOR_NOT_RUNNING, nothing pays), or
//      through a running WS-PPSIM simulator with `--sim-url <origin>`; the smoke calls nothing else;
//   3. throwaway secrets made here for this run only (cookie and link keys, an operator password and a judge
//      code), passed to the child's environment and never printed;
//   4. the checks in ./checks.ts, then the process, the database and the cluster are stopped.
//
// `--url <origin>` smokes an already running fs-api instead (no boot; operator checks need
// FS_SMOKE_OPERATOR_PASSWORD, the judge-code check FS_SMOKE_JUDGE_CODE). `--json <file>` writes the report.
// Exit code 0 only when every check passed and every IC-01 command was exercised.
import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runMigrations } from "@fairsplit/db";
import { startTestCluster, withDatabase } from "@fairsplit/db/testing";
import postgres from "postgres";
import { hashOperatorPassword } from "../credentials/issue/operator.js";
import { runSmoke, type SmokeReport } from "./checks.js";

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATABASE = "fs_smoke";

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

async function waitForHealth(base: string, child: ChildProcess, timeoutMs = 90_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child.exitCode !== null)
      throw new Error(`fs-api exited with code ${child.exitCode} before it was healthy`);
    const ok = await fetch(`${base}/healthz`)
      .then((r) => r.status === 200)
      .catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`fs-api was not healthy within ${timeoutMs} ms`);
}

/** Starts Postgres, a fresh database and fs-api. Returns the origin and a stop function. */
async function boot(o: { dist: boolean; simUrl: string | undefined; log: (line: string) => void }) {
  const cluster = await startTestCluster({ cacheDir: path.join(API_ROOT, ".cache", "smoke") });
  const admin = postgres(cluster.adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists "${DATABASE}" with (force)`);
  await admin.unsafe(`create database "${DATABASE}"`);
  await admin.end({ timeout: 5 });
  const url = withDatabase(cluster.adminUrl, DATABASE);
  await runMigrations(url);
  o.log(`postgres ${cluster.source} cluster, database ${DATABASE} migrated`);

  const operatorPassword = randomBytes(18).toString("base64url");
  const judgeCode = randomBytes(6).toString("hex");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    NODE_ENV: "development",
    LOG_LEVEL: "warn",
    HOST: "127.0.0.1",
    PORT: String(port),
    PUBLIC_ORIGIN: origin,
    DATABASE_URL: url,
    PP_ENV: "sandbox",
    PP_MODE: "simulator",
    ...(o.simUrl ? { PP_SIM_URL: o.simUrl } : {}),
    EXECUTOR: "inline",
    FS_COOKIE_SECRET: randomBytes(32).toString("hex"),
    FS_LINK_SIGNING_KEY: randomBytes(32).toString("hex"),
    FS_OPERATOR_PASSWORD_SCRYPT: await hashOperatorPassword(operatorPassword, { ln: 12 }),
    JUDGE_CODE_SHA256: createHash("sha256").update(judgeCode, "utf8").digest("hex"),
    FS_REPO_ROOT: path.resolve(API_ROOT, "..", ".."),
  };
  const args = o.dist ? ["--enable-source-maps", "dist/index.js"] : ["--import", "tsx", "src/index.ts"];
  const child = spawn(process.execPath, args, {
    cwd: API_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const output: string[] = [];
  const keep = (d: Buffer) => {
    output.push(d.toString("utf8"));
    if (output.length > 400) output.shift();
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  try {
    await waitForHealth(origin, child);
  } catch (err) {
    child.kill();
    await cluster.stop();
    throw new Error(`${(err as Error).message}\n--- fs-api output ---\n${output.join("")}`);
  }
  o.log(`fs-api up at ${origin} (${o.dist ? "dist/index.js" : "src/index.ts via tsx"}, pid ${child.pid})`);

  return {
    origin,
    operatorPassword,
    judgeCode,
    output: () => output.join(""),
    async stop() {
      if (child.exitCode === null) {
        const exited = new Promise<void>((r) => child.once("exit", () => r()));
        child.kill("SIGTERM");
        await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
      }
      const drop = postgres(cluster.adminUrl, { max: 1, onnotice: () => {} });
      await drop.unsafe(`drop database if exists "${DATABASE}" with (force)`).catch(() => undefined);
      await drop.end({ timeout: 5 });
      await cluster.stop();
    },
  };
}

function print(report: SmokeReport, log: (line: string) => void): void {
  const failed = report.checks.filter((c) => !c.ok);
  log("");
  log(
    `run: ${report.run ? `${report.run.slug} state ${report.run.state} invoice ${report.run.invoiceStatus ?? "none"}` : "none"}`,
  );
  log(
    `IC-01 commands exercised: ${report.covered.length}/${report.covered.length + report.missing.length}${report.missing.length ? ` (missing ${report.missing.join(", ")})` : ""}`,
  );
  log(`checks: ${report.checks.length - failed.length}/${report.checks.length} passed`);
  for (const c of failed) log(`  FAIL ${c.name} ${c.target}: ${c.status ?? "---"} ${c.outcome}`);
  log(report.ok ? "SMOKE OK" : "SMOKE FAILED");
}

async function main(): Promise<number> {
  // `pnpm smoke -- --json x` hands the script a leading `--`; drop it
  const argv = process.argv.slice(2);
  const { values } = parseArgs({
    args: argv[0] === "--" ? argv.slice(1) : argv,
    options: {
      url: { type: "string" },
      dist: { type: "boolean", default: false },
      "sim-url": { type: "string" },
      json: { type: "string" },
      "show-logs": { type: "boolean", default: false },
    },
  });
  const log = (line: string) => process.stdout.write(`${line}\n`);
  if (values.url) {
    const report = await runSmoke({
      baseUrl: values.url,
      operatorPassword: process.env.FS_SMOKE_OPERATOR_PASSWORD,
      judgeCode: process.env.FS_SMOKE_JUDGE_CODE,
      log,
    });
    print(report, log);
    if (values.json) writeFileSync(values.json, JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  }
  const server = await boot({ dist: values.dist ?? false, simUrl: values["sim-url"], log });
  try {
    const report = await runSmoke({
      baseUrl: server.origin,
      operatorPassword: server.operatorPassword,
      judgeCode: server.judgeCode,
      log,
    });
    print(report, log);
    if (values.json) writeFileSync(values.json, JSON.stringify(report, null, 2));
    if (!report.ok || values["show-logs"]) log(`--- fs-api output (warn and above) ---\n${server.output()}`);
    return report.ok ? 0 : 1;
  } finally {
    await server.stop();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`smoke failed to run: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
