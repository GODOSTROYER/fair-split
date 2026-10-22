// Clean-clone verification (gate G7: "Verify from a clean clone; submit").
//
//   corepack pnpm exec tsx tools/verify.ts [--source=<git url or path>] [--ref=<branch|sha>]
//                                          [--dir=<empty dir>] [--keep] [--lint] [--json]
//
// Clones the committed tree (never the working copy), then runs, stopping at the first failure:
//   install    corepack pnpm install --frozen-lockfile
//   typecheck  corepack pnpm typecheck
//   lint       corepack pnpm lint            (only with --lint)
//   test       corepack pnpm test
//   build      corepack pnpm build
// Children get a scrubbed environment: no API keys, no PayPal credentials, CI=1, so a clean clone
// proves the repo passes with recorded fixtures only. Exit 0 when every step passes.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isMain } from "../apps/tasks/src/main.js";
import { REPO_ROOT } from "./lib/blueprint.js";

export interface VerifyStep {
  readonly id: "clone" | "checkout" | "install" | "typecheck" | "lint" | "test" | "build";
  readonly command: string;
  readonly args: readonly string[];
  /** Relative to the clone directory, or "." for the parent when cloning. */
  readonly inClone: boolean;
}

export interface VerifyOptions {
  readonly source: string;
  readonly dir: string;
  readonly ref?: string | undefined;
  readonly lint?: boolean;
}

export interface StepResult {
  readonly id: VerifyStep["id"];
  readonly ok: boolean;
  readonly ms: number;
  readonly exitCode: number | null;
  /** Last lines of combined output, for a failing step only. */
  readonly tail?: string;
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
  if (opts.lint) steps.push({ id: "lint", ...pnpm("lint"), inClone: true });
  steps.push({ id: "test", ...pnpm("test"), inClone: true });
  steps.push({ id: "build", ...pnpm("build"), inClone: true });
  return steps;
}

/** Env names never passed to a verification child. */
const DROPPED_ENV =
  /^(PP_|ANTHROPIC_|GEMINI_|RENDER_API_KEY$|OPENAI_|EXPO_ACCESS_TOKEN$|STATEMENT_SIGNING_KEY$|BETTER_AUTH_SECRET$|DATABASE_URL$)/;

export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (!DROPPED_ENV.test(k)) out[k] = v;
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

/** Node ships corepack as a script next to the binary; running it with node avoids a shell on Windows. */
export function resolveCommand(command: string, args: readonly string[]): [string, string[]] {
  if (command === "corepack") {
    const js = join(dirname(process.execPath), "node_modules", "corepack", "dist", "corepack.js");
    if (existsSync(js)) return [process.execPath, [js, ...args]];
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
  const results: StepResult[] = [];
  for (const step of planVerify(opts)) {
    const started = now();
    const { exitCode, output } = runner(step, step.inClone ? opts.dir : resolve(opts.dir, ".."), env);
    const ok = exitCode === 0;
    const result: StepResult = {
      id: step.id,
      ok,
      ms: now() - started,
      exitCode,
      ...(ok ? {} : { tail: output.trim().split(/\r?\n/).slice(-30).join("\n") }),
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
  keep: boolean;
  lint: boolean;
  json: boolean;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const o: CliOptions = { source: REPO_ROOT, keep: false, lint: false, json: false };
  for (const a of argv) {
    const [k, v] = a.includes("=")
      ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]
      : [a, undefined];
    if (k === "--source" && v) o.source = v;
    else if (k === "--ref" && v) o.ref = v;
    else if (k === "--dir" && v) o.dir = v;
    else if (k === "--keep") o.keep = true;
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
    { source: cli.source, dir, ref: cli.ref, lint: cli.lint },
    {
      onStep: (r) => {
        if (!cli.json)
          console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id.padEnd(9)}  ${(r.ms / 1000).toFixed(1)} s`);
        if (!r.ok && !cli.json && r.tail) console.log(r.tail);
      },
    },
  );
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
