import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of the repository root (the directory that holds pnpm-workspace.yaml). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
/** Absolute path of the media directory (IC-11 root). */
export const MEDIA_ROOT = join(REPO_ROOT, "media");

let loaded = false;

/**
 * Loads the gitignored repo-root `.env` into `process.env` once, without overriding variables that are
 * already set. It never prints, logs or returns any value: callers ask for one named variable with
 * {@link requireEnv}, and error messages name the variable, never its contents.
 */
export function loadEnv(file = join(REPO_ROOT, ".env")): void {
  if (loaded) return;
  loaded = true;
  if (existsSync(file)) process.loadEnvFile(file);
}

/** Returns a required secret or setting. The thrown error names the variable only. */
export function requireEnv(name: string): string {
  loadEnv();
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing ${name}: add it to the repo-root .env (never commit it).`);
  }
  return value;
}

/** Redacts every occurrence of the given secret values from a string (for error messages and logs). */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) if (s.length >= 8) out = out.split(s).join("REDACTED");
  return out;
}
