// Each default project owns one Playwright invocation and therefore one private stack. The product's public
// successful-payout cap stays unchanged: browser motion modes never spend the same database's quota twice.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECTS = ["api", "chromium", "reduced-motion"] as const;

/** Preserve explicit project choices; otherwise isolate each project without changing test filters. */
export function projectInvocations(args: readonly string[]): string[][] {
  const separator = args.indexOf("--");
  const optionsEnd = separator < 0 ? args.length : separator;
  const options = args.slice(0, optionsEnd);
  if (options.some((arg) => arg === "--project" || arg.startsWith("--project="))) return [[...args]];
  return PROJECTS.map((project) => [...options, `--project=${project}`, ...args.slice(optionsEnd)]);
}

export function run(args: readonly string[]): number {
  const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
  for (const invocation of projectInvocations(args)) {
    const result = spawnSync(process.execPath, [cli, "test", ...invocation], {
      cwd: dirname(fileURLToPath(import.meta.url)),
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error) {
      process.stderr.write("[e2e] Playwright could not start.\n");
      return 1;
    }
    if (result.status !== 0) return result.status ?? (result.signal === "SIGINT" ? 130 : 1);
  }
  return 0;
}

// Importing the pure argument helper in unit tests must never launch a browser or a stack.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = run(process.argv.slice(2));
}
