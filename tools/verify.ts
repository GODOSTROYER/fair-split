// Clean-clone verification (gate G7: "Verify from a clean clone; submit").
//
//   corepack pnpm exec tsx tools/verify.ts [--source=<git url or path>] [--ref=<branch|sha>]
//                                          [--dir=<empty dir>] [--db=<postgres url>]
//                                          [--keep] [--lint] [--json]
//
// Clones the committed tree (never the working copy), then runs, stopping at the first failure:
//   install    corepack pnpm install --frozen-lockfile
//   typecheck  corepack pnpm typecheck
//   lint       corepack pnpm exec biome ci .
//   deps:check corepack pnpm deps:check
//   test       corepack pnpm test
//   build      corepack pnpm build
// Children get a scrubbed environment (`isDroppedEnv`): no API keys, no PayPal or database
// credentials, no kill flags, CI=1, so a clean clone proves the repo passes on recorded fixtures.
// The Postgres integration tier (S3.16) runs on packages/db's embedded Postgres by default; `--db`
// points it at a server instead, as FS_TEST_DATABASE_URL for the test step only (never printed).
// The test step reports the tests each package skipped, so a tier that quietly skips shows up.
// Exit 0 when every step passes.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, resolve, win32 } from "node:path";
import { isMain } from "../apps/tasks/src/main.js";
import { REPO_ROOT } from "./lib/blueprint.js";

export interface VerifyStep {
  readonly id: "clone" | "checkout" | "install" | "typecheck" | "lint" | "deps:check" | "test" | "build";
  readonly command: string;
  readonly args: readonly string[];
  /** Relative to the clone directory, or "." for the parent when cloning. */
  readonly inClone: boolean;
}

export interface VerifyOptions {
  readonly source: string;
  readonly dir: string;
  readonly ref?: string | undefined;
  /** Retained for existing callers; lint is always part of verification. */
  readonly lint?: boolean;
  /** Postgres for the integration tier, given to the test step as FS_TEST_DATABASE_URL. */
  readonly db?: string | undefined;
}

export interface StepResult {
  readonly id: VerifyStep["id"];
  readonly ok: boolean;
  readonly ms: number;
  readonly exitCode: number | null;
  /** Last lines of combined output, for a failing step only. */
  readonly tail?: string;
  /** The test step only: tests skipped per package, read from the vitest summaries. */
  readonly skipped?: Readonly<Record<string, number>>;
}

/** Pure: the ordered steps for a verification run. */
export function planVerify(opts: VerifyOptions): VerifyStep[] {
  const pnpm = (...args: string[]): Pick<VerifyStep, "command" | "args"> => ({
    command: "corepack",
    args: ["pnpm", ...args],
  });
  const steps: VerifyStep[] = [
    {
      id: "clone",
      command: "git",
      args: ["clone", "--quiet", "--no-hardlinks", opts.source, opts.dir],
      inClone: false,
    },
  ];
  if (opts.ref)
    steps.push({ id: "checkout", command: "git", args: ["checkout", "--quiet", opts.ref], inClone: true });
  steps.push({ id: "install", ...pnpm("install", "--frozen-lockfile"), inClone: true });
  steps.push({ id: "typecheck", ...pnpm("typecheck"), inClone: true });
  steps.push({ id: "lint", ...pnpm("exec", "biome", "ci", "."), inClone: true });
  steps.push({ id: "deps:check", ...pnpm("deps:check"), inClone: true });
  steps.push({ id: "test", ...pnpm("test"), inClone: true });
  steps.push({ id: "build", ...pnpm("build"), inClone: true });
  return steps;
}

/** Anything named like a credential. */
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|SCRYPT|SHA256|CREDENTIAL|PRIVATE|COOKIE/i;
/**
 * Whole families: PayPal (PP_ and the older PAYPAL_), model and platform keys, the app's own
 * settings (FS_*: FS_KILL, FS_APP_DB_PASSWORD, FS_DB_*, FS_TEST_DATABASE_URL, …), the older KILL_*
 * flags, every database URL (DATABASE_URL, DATABASE_OWNER_URL, LIMITER_DATABASE_URL, …), libpq's PG*
 * variables, and NODE_ENV (production would make the install skip devDependencies).
 */
const DROPPED_FAMILY =
  /^(PP_|PAYPAL_|ANTHROPIC_|GEMINI_|OPENAI_|GOOGLE_|RENDER_|EXPO_|FS_|KILL_|PG[A-Z]+$|NODE_ENV$)|(^|_)DATABASE(_[A-Z]+)*_URL$/i;

/** Env names never passed to a verification child. */
export function isDroppedEnv(name: string): boolean {
  return SECRET_NAME.test(name) || DROPPED_FAMILY.test(name);
}

export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (!isDroppedEnv(k)) out[k] = v;
  out.CI = "1";
  out.COREPACK_ENABLE_DOWNLOAD_PROMPT = "0";
  out.EXECUTOR = "inline";
  out.FORCE_COLOR = "0";
  return out;
}

export type StepRunner = (
  step: VerifyStep,
  cwd: string,
  env: NodeJS.ProcessEnv,
) => { exitCode: number | null; output: string };

/** Where to look for Node's own corepack; tests pass another platform's layout. */
export interface NodeHost {
  readonly platform: NodeJS.Platform;
  readonly execPath: string;
  readonly exists: (path: string) => boolean;
}

const THIS_NODE: NodeHost = { platform: process.platform, execPath: process.execPath, exists: existsSync };

/**
 * Node ships corepack as a script; running it with node needs no shell (Windows would need one for corepack.cmd).
 * Windows installs keep it beside node.exe; the Linux and macOS tarballs keep it under `<prefix>/lib/node_modules`,
 * with node in `<prefix>/bin`. A Node with no bundled corepack gets the bare command, found on PATH.
 */
export function resolveCommand(
  command: string,
  args: readonly string[],
  host: NodeHost = THIS_NODE,
): [string, string[]] {
  if (command === "corepack") {
    const p = host.platform === "win32" ? win32 : posix;
    const bin = p.dirname(host.execPath);
    const modules =
      host.platform === "win32" ? p.join(bin, "node_modules") : p.join(bin, "..", "lib", "node_modules");
    const js = p.join(modules, "corepack", "dist", "corepack.js");
    if (host.exists(js)) return [host.execPath, [js, ...args]];
  }
  return [command, [...args]];
}

export const spawnRunner: StepRunner = (step, cwd, env) => {
  const [command, args] = resolveCommand(step.command, step.args);
  const r = spawnSync(command, args, { cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return {
    exitCode: r.status,
    output: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? String(r.error) : ""}`,
  };
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI colour codes, which start with ESC.
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * Tests skipped per package, from vitest's summary lines (`Tests  3 failed | 40 passed | 2 skipped (45)`),
 * which turbo prefixes with `<package>:test: `. Todo tests count as skipped. Packages with none are omitted.
 */
export function skippedTests(output: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of output.replace(ANSI, "").split(/\r?\n/)) {
    const m = /^(?:(\S+?):test:)?\s*Tests\s+(.+)\(\d+\)\s*$/.exec(line);
    if (!m) continue;
    const pkg = m[1] ?? "(root)";
    const n = [...(m[2] ?? "").matchAll(/(\d+)\s+(?:skipped|todo)\b/g)].reduce(
      (sum, x) => sum + Number(x[1]),
      0,
    );
    if (n > 0) out[pkg] = (out[pkg] ?? 0) + n;
  }
  return out;
}

/** One line for the log: `none`, or `@fairsplit/db 3, @fairsplit/ai 1 (4 in all)`. */
export function describeSkipped(skipped: Readonly<Record<string, number>>): string {
  const entries = Object.entries(skipped).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return "none";
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  return `${entries.map(([pkg, n]) => `${pkg} ${n}`).join(", ")} (${total} in all)`;
}

/** The password in a postgres URL, raw and decoded, when it is long enough to scrub safely. */
function passwordOf(url: string): string[] {
  try {
    const raw = new URL(url).password;
    return [...new Set([raw, decodeURIComponent(raw)])].filter((p) => p.length >= 4);
  } catch {
    return [];
  }
}

export function runVerify(
  opts: VerifyOptions,
  deps: {
    runner?: StepRunner;
    env?: NodeJS.ProcessEnv;
    now?: () => number;
    onStep?: (r: StepResult) => void;
  } = {},
): StepResult[] {
  const runner = deps.runner ?? spawnRunner;
  const now = deps.now ?? Date.now;
  const env = childEnv(deps.env ?? process.env);
  const db = opts.db?.trim() || undefined;
  // The --db URL carries a password; nothing this tool prints or returns may contain either.
  const hidden = db ? [db, ...passwordOf(db)] : [];
  const results: StepResult[] = [];
  for (const step of planVerify(opts)) {
    const started = now();
    const stepEnv = step.id === "test" && db ? { ...env, FS_TEST_DATABASE_URL: db } : env;
    const cwd = step.inClone ? opts.dir : resolve(opts.dir, "..");
    const { exitCode, output: raw } = runner(step, cwd, stepEnv);
    const output = hidden.reduce((text, secret) => text.split(secret).join("<--db>"), raw);
    const ok = exitCode === 0;
    const result: StepResult = {
      id: step.id,
      ok,
      ms: now() - started,
      exitCode,
      ...(ok ? {} : { tail: output.trim().split(/\r?\n/).slice(-30).join("\n") }),
      ...(step.id === "test" ? { skipped: skippedTests(output) } : {}),
    };
    results.push(result);
    deps.onStep?.(result);
    if (!ok) break;
  }
  return results;
}

export interface CliOptions {
  source: string;
  ref?: string | undefined;
  dir?: string;
  db?: string;
  keep: boolean;
  lint: boolean;
  json: boolean;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const o: CliOptions = { source: REPO_ROOT, keep: false, lint: true, json: false };
  for (const a of argv) {
    const [k, v] = a.includes("=")
      ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]
      : [a, undefined];
    if (k === "--source" && v) o.source = v;
    else if (k === "--ref" && v) o.ref = v;
    else if (k === "--dir" && v) o.dir = v;
    else if (k === "--db" && v) {
      if (!/^postgres(ql)?:\/\//.test(v)) throw new Error("--db must be a postgres:// URL");
      o.db = v;
    } else if (k === "--keep") o.keep = true;
    else if (k === "--lint") o.lint = true;
    else if (k === "--json") o.json = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

export function headOf(repo: string): string | undefined {
  const r = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

function main(argv: readonly string[]): number {
  const cli = parseArgs(argv);
  // A local source verifies exactly the commit it has checked out (worktrees included).
  if (!cli.ref && existsSync(cli.source)) cli.ref = headOf(cli.source);
  let dir: string;
  if (cli.dir) {
    dir = resolve(cli.dir);
    if (existsSync(dir) && readdirSync(dir).length > 0)
      throw new Error(`--dir must be empty or absent: ${dir}`);
    mkdirSync(resolve(dir, ".."), { recursive: true });
  } else {
    dir = join(mkdtempSync(join(tmpdir(), "fs-verify-")), "fair-split");
  }
  const results = runVerify(
    { source: cli.source, dir, ref: cli.ref, lint: cli.lint, db: cli.db },
    {
      onStep: (r) => {
        if (!cli.json)
          console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id.padEnd(9)}  ${(r.ms / 1000).toFixed(1)} s`);
        if (!r.ok && !cli.json && r.tail) console.log(r.tail);
        if (r.skipped && !cli.json) console.log(`      skipped tests: ${describeSkipped(r.skipped)}`);
      },
    },
  );
  if (!cli.json && !cli.db)
    console.log("      integration tier: packages/db's embedded Postgres (pass --db=<url> to use a server)");
  const ok =
    results.every((r) => r.ok) &&
    results.length === planVerify({ source: cli.source, dir, ref: cli.ref, lint: cli.lint }).length;
  if (cli.json) console.log(JSON.stringify({ ok, dir, results }, null, 2));
  else console.log(ok ? `verify: clean clone passed (${dir})` : `verify: FAILED (clone kept at ${dir})`);
  if (ok && !cli.keep) rmSync(dir, { recursive: true, force: true });
  return ok ? 0 : 1;
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
