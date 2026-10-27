// CI's render.yaml lint (S3.17; S3.13's YAML rules). Validates the Blueprint against Render's
// published JSON Schema (vendored in tools/lib/render-blueprint.schema.json) and against Fair Split's
// deployment rules (tools/lib/blueprint.ts): one region, paid plans, the thin cron, per-service
// secrets with no literal values, fs_app-only database access, build filters, the PayPal rail.
//
//   corepack pnpm exec tsx tools/lint-render.ts [--file=render.yaml]
//
// Exit 0 when both pass, 1 otherwise. Prints rule violations only; render.yaml holds no secret values.
import { resolve } from "node:path";
import { isMain } from "../apps/tasks/src/main.js";
import { BLUEPRINT_PATH, checkPolicy, readBlueprint, validateAgainstSchema } from "./lib/blueprint.js";

export interface LintResult {
  readonly schema: readonly string[];
  readonly policy: readonly string[];
}

export function lintRender(path: string = BLUEPRINT_PATH): LintResult {
  const bp = readBlueprint(path);
  return { schema: validateAgainstSchema(bp), policy: checkPolicy(bp) };
}

export function formatLint(result: LintResult): string[] {
  const section = (name: string, problems: readonly string[]) =>
    problems.length === 0
      ? [`render.yaml ${name}: PASS`]
      : [`render.yaml ${name}: FAIL`, ...problems.map((p) => `  - ${p}`)];
  return [...section("schema", result.schema), ...section("policy", result.policy)];
}

export function parseArgs(argv: readonly string[]): { file: string } {
  let file = BLUEPRINT_PATH;
  for (const arg of argv) {
    if (arg.startsWith("--file=")) file = resolve(arg.slice("--file=".length));
    else throw new Error(`unknown argument: ${arg}`);
  }
  return { file };
}

export function main(argv: readonly string[], log: (line: string) => void): number {
  const result = lintRender(parseArgs(argv).file);
  for (const line of formatLint(result)) log(line);
  return result.schema.length === 0 && result.policy.length === 0 ? 0 : 1;
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2), (line) => console.log(line));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
