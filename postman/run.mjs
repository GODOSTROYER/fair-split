#!/usr/bin/env node
// Runs the Postman collection with newman against a LOCAL keyless fs-api (the e2e stack, or `pnpm dev` with
// PP_MODE=simulator), and prints a summary. Nothing here is a dependency: newman runs through npx at an exact version.
//
//   node postman/run.mjs --base-url http://127.0.0.1:<port> [--no-sim] [--out <dir>] [-- <extra newman args>]
//
// 1. Refuses any origin that is not loopback http, and any fs-api whose /healthz does not read rail "simulated":
//    the collection is for the local simulator only, never a hosted demo or PayPal's sandbox.
// 2. Refuses a stale collection (postman/build.mjs is the source; run `node postman/build.mjs`).
// 3. Starts the standalone PayPal simulator (tools/paypal-sim.ts, in memory, a temporary data dir) for the
//    insufficient-funds path, with the committed registry's fictional fs-judge app; `--no-sim` skips that path.
// 4. `npx --yes newman@6.2.3 run …` with the localhost environment, the CLI and JSON reporters; the JSON report goes
//    to .codex-scratch/postman/ (gitignored; it holds this run's short-lived local tokens).
// 5. Prints requests, assertions, failures and durations, stops the simulator, and exits with newman's code.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCollection, COLLECTION_PATH } from "./build.mjs";

export const NEWMAN_VERSION = "6.2.3";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const ENVIRONMENT = join(HERE, "localhost.postman_environment.json");
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function parseArgs(argv) {
  const o = {
    baseUrl: process.env.FS_BASE_URL ?? null,
    sim: true,
    out: join(ROOT, ".codex-scratch", "postman"),
    extra: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      o.extra = argv.slice(i + 1);
      break;
    }
    if (a === "--base-url") o.baseUrl = argv[++i];
    else if (a === "--no-sim") o.sim = false;
    else if (a === "--out") o.out = resolve(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

/** The origin, if it is plain http on a loopback host; otherwise throws. */
export function localOrigin(raw) {
  if (!raw)
    throw new Error("give the local fs-api origin: --base-url http://127.0.0.1:<port> (or FS_BASE_URL)");
  const u = new URL(raw);
  if (u.protocol !== "http:" || !LOOPBACK.has(u.hostname) || (u.pathname !== "/" && u.pathname !== "")) {
    throw new Error(
      `refusing ${raw}: this collection runs only against a local keyless stack (http on loopback)`,
    );
  }
  return u.origin;
}

function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.unref();
    s.on("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

/** The standalone simulator on a free loopback port, in memory; resolves once it listens. */
async function startSimulator() {
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), "fs-postman-sim-"));
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "tools/paypal-sim.ts", "--port", String(port), "--fresh"],
    {
      cwd: ROOT,
      env: { ...process.env, SIM_DATA_DIR: dataDir, SIM_PERSIST: "0", SIM_HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const stop = () => {
    if (child.exitCode === null) child.kill();
    rmSync(dataDir, { recursive: true, force: true });
  };
  await new Promise((ok, fail) => {
    let out = "";
    const timer = setTimeout(() => fail(new Error(`the simulator did not start in 60 s\n${out}`)), 60_000);
    const seen = (d) => {
      out += d.toString("utf8");
      if (out.includes("listening on")) {
        clearTimeout(timer);
        ok();
      }
    };
    child.stdout.on("data", seen);
    child.stderr.on("data", seen);
    child.once("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`the simulator exited with ${code}\n${out}`));
    });
  });
  const registry = JSON.parse(readFileSync(join(ROOT, "packages/paypal-sim/data/accounts.json"), "utf8"));
  const app = registry.apps.find((a) => a.name === "fs-judge");
  return { url: `http://127.0.0.1:${port}`, clientId: app.client_id, clientSecret: app.client_secret, stop };
}

function quote(arg) {
  return process.platform === "win32" && /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function runNewman(args) {
  return new Promise((ok) => {
    const win = process.platform === "win32";
    const child = spawn(win ? "npx.cmd" : "npx", args.map(quote), {
      cwd: ROOT,
      stdio: "inherit",
      shell: win,
    });
    child.once("exit", (code) => ok(code ?? 1));
  });
}

const ms = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`);

/** The run summary from newman's JSON report. */
export function summarise(report) {
  const { stats, timings, failures } = report.run;
  const lines = [
    `requests     ${stats.requests.total} (${stats.requests.failed} failed)`,
    `test scripts ${stats.testScripts.total} (${stats.testScripts.failed} failed)`,
    `assertions   ${stats.assertions.total} (${stats.assertions.failed} failed)`,
    `duration     ${ms(timings.completed - timings.started)}; responses avg ${ms(timings.responseAverage)}, min ${ms(timings.responseMin)}, max ${ms(timings.responseMax)}`,
  ];
  for (const f of failures)
    lines.push(`FAILED ${f.source?.name ?? "?"}: ${f.error?.test ?? ""} ${f.error?.message ?? ""}`);
  return lines.join("\n");
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const origin = localOrigin(o.baseUrl);
  const health = await fetch(`${origin}/healthz`).then(
    (r) => r.json(),
    (e) => {
      throw new Error(
        `no fs-api at ${origin} (${e.message}); start one: corepack pnpm --filter @fairsplit/e2e stack`,
      );
    },
  );
  if (health.rail !== "simulated") {
    throw new Error(`refusing: ${origin} reads rail "${health.rail}", not the simulated PayPal sandbox`);
  }
  const committed = JSON.parse(readFileSync(COLLECTION_PATH, "utf8"));
  if (JSON.stringify(committed) !== JSON.stringify(buildCollection())) {
    throw new Error("the collection is stale: run `node postman/build.mjs` first");
  }
  mkdirSync(o.out, { recursive: true });
  const report = join(o.out, `newman-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const sim = o.sim ? await startSimulator() : null;
  const stop = () => sim?.stop();
  process.once("SIGINT", () => {
    stop();
    process.exit(130);
  });
  let code = 1;
  try {
    const vars = {
      baseUrl: origin,
      simBaseUrl: sim?.url ?? "",
      simClientId: sim?.clientId ?? "",
      simClientSecret: sim?.clientSecret ?? "",
    };
    console.log(
      `[postman] newman ${NEWMAN_VERSION} against ${origin}${sim ? `, simulator at ${sim.url}` : " (no simulator: 3a skipped)"}`,
    );
    code = await runNewman([
      "--yes",
      `newman@${NEWMAN_VERSION}`,
      "run",
      COLLECTION_PATH,
      "--environment",
      ENVIRONMENT,
      ...Object.entries(vars).flatMap(([k, v]) => ["--env-var", `${k}=${v}`]),
      "--reporters",
      "cli,json",
      "--reporter-json-export",
      report,
      "--timeout-request",
      "30000",
      ...o.extra,
    ]);
  } finally {
    stop();
  }
  try {
    console.log(`\n[postman] summary (${report})\n${summarise(JSON.parse(readFileSync(report, "utf8")))}`);
  } catch {
    console.log("[postman] no JSON report was written");
  }
  process.exit(code);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(`[postman] ${err.message}`);
    process.exit(2);
  });
}
