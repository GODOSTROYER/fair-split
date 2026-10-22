// Loads a local .env without ever echoing values. Existing process env wins (Render injects its own).
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Walks up from `start` to find the nearest `.env`. Returns its path, or undefined. */
export function findDotEnv(start: string = process.cwd()): string | undefined {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Loads the nearest .env into process.env (Node's built-in parser; keys already set are kept).
 * Returns only the names it saw, never values.
 */
export function loadDotEnv(start?: string): { path?: string; loaded: boolean } {
  const path = findDotEnv(start);
  if (!path) return { loaded: false };
  try {
    process.loadEnvFile(path);
    return { path, loaded: true };
  } catch {
    return { path, loaded: false };
  }
}

/** True when the variable is set to a non-empty value. Never returns the value. */
export function hasEnv(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env[name];
  return typeof v === "string" && v.trim() !== "";
}
