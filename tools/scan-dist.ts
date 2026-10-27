// The dist scan (S3.13 "Builds"): fs-api's Render build ends with this step. It fails the build if a
// secret reached any built file under apps/*/dist (the console, the /app web export, the API bundle,
// their source maps and media):
//   - the value of any secret environment variable present at build time, 8 characters or longer
//     (Render injects a service's env vars into its build, so these are the real values);
//   - a credential recognisable by its shape: a PayPal access token (A21AA…), an Anthropic key
//     (sk-ant-…), a Render API key (rnd_…), a Google API key, or a PEM private key.
//
//   corepack pnpm exec tsx tools/scan-dist.ts [--root=<repo root>]
//
// Prints file paths and the NAME of what matched (an env var name or a pattern label), never a value.
// Exit 0 when clean, 1 on any finding or an unreadable tree. Self-contained on purpose: render.yaml's
// build filter watches this one file.
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** S3.13: shorter values are too likely to occur by chance in minified code. */
export const MIN_SECRET_LENGTH = 8;

/** Credentials recognisable by shape, whatever env var (if any) they came from. */
export const SECRET_PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: "PayPal access token (A21AA…)", pattern: /A21AA[A-Za-z0-9_-]{20,}/ },
  { label: "Anthropic API key (sk-ant-…)", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { label: "Render API key (rnd_…)", pattern: /rnd_[A-Za-z0-9]{20,}/ },
  { label: "Google API key (AIza…)", pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { label: "PEM private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

/** Names whose values may ship to clients by design (S3.13: clients read only these prefixes). */
const PUBLIC_NAME = /^(VITE_PUBLIC_|EXPO_PUBLIC_)/;
/** Switches that start with PP_ but are not secrets (S3.13's PP_ENV, ADR-0002's PP_MODE). */
const PP_SWITCHES: ReadonlySet<string> = new Set(["PP_ENV", "PP_MODE"]);

/**
 * True for env names whose values are secrets: render.yaml's rule (KEY, SECRET, TOKEN, PASSWORD,
 * SCRYPT, SHA256, and every PP_ name but the switches), plus database URLs, which carry passwords.
 */
export function isSecretEnvName(name: string): boolean {
  if (PUBLIC_NAME.test(name)) return false;
  if (/KEY|SECRET|TOKEN|PASSWORD|SCRYPT|SHA256|CREDENTIAL|PRIVATE/.test(name)) return true;
  if (/^PAYPAL_/.test(name)) return true;
  if (name.startsWith("PP_")) return !PP_SWITCHES.has(name);
  return /(^|_)DATABASE(_[A-Z]+)*_URL$/.test(name);
}

export interface Needle {
  /** The env var name; never the value. */
  readonly name: string;
  readonly bytes: readonly Buffer[];
}

/** The secret values to look for, each as its raw and URL-encoded bytes. */
export function secretNeedles(env: NodeJS.ProcessEnv): Needle[] {
  const out: Needle[] = [];
  for (const [name, raw] of Object.entries(env)) {
    const value = raw?.trim();
    if (!value || value.length < MIN_SECRET_LENGTH || !isSecretEnvName(name)) continue;
    const forms = new Set([value, encodeURIComponent(value)]);
    out.push({ name, bytes: [...forms].map((f) => Buffer.from(f, "utf8")) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface Finding {
  /** Repo-relative, forward slashes. */
  readonly file: string;
  /** `env:<NAME>` or `pattern:<label>`. */
  readonly what: string;
}

/** Every regular file under apps/<app>/dist, recursively. Symlinks are skipped, never followed. */
export function distFiles(root: string): string[] {
  const apps = join(root, "apps");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) out.push(path);
    }
  };
  let names: string[] = [];
  try {
    names = readdirSync(apps);
  } catch {
    return out;
  }
  for (const app of names.sort()) {
    const dist = join(apps, app, "dist");
    try {
      if (!lstatSync(dist).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(dist);
  }
  return out.sort();
}

/** Pure over one file's bytes. */
export function scanBytes(bytes: Buffer, needles: readonly Needle[]): string[] {
  const hits: string[] = [];
  for (const n of needles) if (n.bytes.some((b) => bytes.includes(b))) hits.push(`env:${n.name}`);
  // latin1 maps each byte to one char, so patterns see binary files byte for byte.
  const text = bytes.toString("latin1");
  for (const p of SECRET_PATTERNS) if (p.pattern.test(text)) hits.push(`pattern:${p.label}`);
  return hits;
}

export interface ScanResult {
  readonly files: number;
  readonly needles: number;
  readonly findings: readonly Finding[];
}

export function scanDist(root: string, env: NodeJS.ProcessEnv): ScanResult {
  const needles = secretNeedles(env);
  const files = distFiles(root);
  const findings: Finding[] = [];
  for (const file of files) {
    const rel = relative(root, file).replaceAll("\\", "/");
    for (const what of scanBytes(readFileSync(file), needles)) findings.push({ file: rel, what });
  }
  return { files: files.length, needles: needles.length, findings };
}

/** Status lines for the build log: paths and names only. */
export function report(result: ScanResult): string[] {
  const head = `scan-dist: ${result.files} files under apps/*/dist, ${result.needles} secret values, ${SECRET_PATTERNS.length} patterns`;
  if (result.findings.length === 0) return [head, "scan-dist: PASS"];
  return [
    head,
    ...result.findings.map((f) => `scan-dist: FOUND ${f.what} in ${f.file}`),
    `scan-dist: FAIL (${result.findings.length} findings); fix the build, then rotate anything that shipped`,
  ];
}

export function parseArgs(argv: readonly string[], defaultRoot: string): { root: string } {
  let root = defaultRoot;
  for (const arg of argv) {
    if (arg.startsWith("--root=")) root = resolve(arg.slice("--root=".length));
    else throw new Error(`unknown argument: ${arg}`);
  }
  return { root };
}

export function main(argv: readonly string[], env: NodeJS.ProcessEnv, log: (line: string) => void): number {
  const here = dirname(fileURLToPath(import.meta.url));
  const { root } = parseArgs(argv, resolve(here, ".."));
  const result = scanDist(root, env);
  for (const line of report(result)) log(line);
  return result.findings.length === 0 ? 0 : 1;
}

const isMain = (() => {
  try {
    return (
      Boolean(process.argv[1]) &&
      realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? "")
    );
  } catch {
    return false;
  }
})();

if (isMain) {
  try {
    process.exitCode = main(process.argv.slice(2), process.env, (line) => console.log(line));
  } catch (err) {
    console.log(`scan-dist: FAIL (${err instanceof Error ? err.name : "error"})`);
    process.exitCode = 1;
  }
}
