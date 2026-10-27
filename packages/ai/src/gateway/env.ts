import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Loads the nearest `.env` (walking up from `startDir`) into process.env with Node's built-in
 * loader. Existing variables win. Values are never printed; the return value says only which file
 * was read and which of the expected names are now present.
 */
export function loadEnv(
  startDir: string = process.cwd(),
  expect: readonly string[] = ["ANTHROPIC_API_KEY"],
): { file: string | null; present: Record<string, boolean> } {
  let dir = resolve(startDir);
  let file: string | null = null;
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      file = candidate;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (file) process.loadEnvFile(file);
  const present = Object.fromEntries(expect.map((k) => [k, Boolean(process.env[k])]));
  return { file, present };
}
