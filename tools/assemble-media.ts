// The curated /media folder fs-api serves (render.yaml: STATIC_MEDIA_DIR=apps/api/dist/media). fs-api's Render
// build runs this step before the dist scan. media/ itself is never served: next to the synthetic clips and
// images it holds the prompts, the eval labels, the review sessions, the masters, its own code and
// node_modules. This step copies only the files an explicit allowlist names, keeping their media/-relative
// paths (the IC-11 manifest's `file` values, the seed's `media/photos/A.webp`), and fails the build on anything
// else:
//   - an allowlist entry outside the public folders, with `**`, `..`, a backslash or an absolute path, or for a
//     type other than an .m4a clip, a .webp image or the one audio manifest;
//   - a matched file that is a symlink;
//   - an audio manifest that is not JSON, or that names a clip the allowlist does not serve (it would 404 and
//     the statement would fall back to the device voice).
// The output folder is replaced, so nothing from an earlier build lingers.
//
//   corepack pnpm exec tsx tools/assemble-media.ts [--root=<repo root>] [--out=<apps/<app>/dist/…>]
//
// Exit 0 when the folder is assembled, 1 on any problem (nothing is written then). Self-contained on purpose,
// like tools/scan-dist.ts: render.yaml's build filter watches this one file.
import {
  copyFileSync,
  type Dirent,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the allowlist is read from, under the repo root. */
export const MEDIA_ROOT = "media";
/** Where the folder is written, under the repo root: render.yaml's STATIC_MEDIA_DIR (tools/lib/blueprint.ts). */
export const MEDIA_PUBLIC_DIR = "apps/api/dist/media";

/** The only folders under media/ anything may be served from. */
export const PUBLIC_FOLDERS: readonly string[] = ["audio", "photos", "slips", "docs"];

/**
 * What /media serves, as globs relative to media/ (`*` and `?` stay inside one path segment, `{a,b}` is a
 * choice; there is no `**`). A new kind of public file is a new line here, reviewed like any other change.
 */
export const MEDIA_ALLOWLIST: readonly string[] = [
  // IC-11's statement clips (AAC, synthetic Gemini voices, each labelled) and the manifest that lists them.
  "audio/manifest.json",
  "audio/M-???/{ceb,fil,en}/s*.m4a",
  "audio/drafts/M-???/{ceb,fil,en}/s*.m4a",
  // IC-11's four-slip photos A–L (display WebP), the ten one-slip hero flats, the BR 2026-04 and logbook pages.
  "photos/?.webp",
  "slips/*.webp",
  "docs/*.webp",
];

const MANIFEST = "audio/manifest.json";
const SERVED_TYPE = /\.(?:m4a|webp)$/;

/** One allowlist glob as an anchored RegExp over media/-relative POSIX paths. */
function globRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      re += `(?:${glob
        .slice(i + 1, end)
        .split(",")
        .map((alt) => alt.replace(/[.+^$()|[\]\\*?]/g, "\\$&"))
        .join("|")})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Problems with the allowlist itself; empty when every entry can reach only servable files. */
export function checkAllowlist(allowlist: readonly string[]): string[] {
  const out: string[] = [];
  for (const glob of allowlist) {
    const segments = glob.split("/");
    const why =
      isAbsolute(glob) || glob.startsWith("/")
        ? "is absolute"
        : glob.includes("\\")
          ? "has a backslash"
          : glob.includes("**")
            ? "has **"
            : segments.includes("..") || segments.includes(".")
              ? "leaves its folder"
              : /\{[^}]*$/.test(glob)
                ? "has an unclosed brace"
                : !PUBLIC_FOLDERS.includes(segments[0] ?? "") || segments.length < 2
                  ? `is outside ${PUBLIC_FOLDERS.join(", ")}`
                  : glob !== MANIFEST && !SERVED_TYPE.test(glob)
                    ? "is not an .m4a clip, a .webp image or the audio manifest"
                    : null;
    if (why) out.push(`allowlist entry ${glob} ${why}`);
  }
  return out;
}

export interface AssembleResult {
  /** media/-relative paths copied (none when there were problems), sorted. */
  readonly files: readonly string[];
  readonly bytes: number;
  readonly problems: readonly string[];
}

/** Every entry under the public folders of `mediaDir`, media/-relative, without following links. */
function candidates(mediaDir: string): { rel: string; link: boolean }[] {
  const out: { rel: string; link: boolean }[] = [];
  const walk = (dir: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const path = join(dir, e.name);
      const rel = relative(mediaDir, path).split(sep).join("/");
      if (e.isSymbolicLink()) out.push({ rel, link: true });
      else if (e.isDirectory()) walk(path);
      else if (e.isFile()) out.push({ rel, link: false });
    }
  };
  for (const folder of PUBLIC_FOLDERS) walk(join(mediaDir, folder));
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** Clip paths an IC-11 manifest names (`{entries: [{file}]}` or a bare array). */
function manifestFiles(text: string): string[] | null {
  try {
    const raw = JSON.parse(text) as unknown;
    const list = Array.isArray(raw) ? raw : ((raw as { entries?: unknown[] } | null)?.entries ?? []);
    return list.flatMap((e) =>
      e && typeof e === "object" && typeof (e as { file?: unknown }).file === "string"
        ? [(e as { file: string }).file]
        : [],
    );
  } catch {
    return null;
  }
}

/** Plans the folder from `root`/media, and writes it to `out` (replacing it) only when there is no problem. */
export function assembleMedia(
  root: string,
  out: string,
  allowlist: readonly string[] = MEDIA_ALLOWLIST,
): AssembleResult {
  const problems = checkAllowlist(allowlist);
  if (problems.length > 0) return { files: [], bytes: 0, problems };
  const mediaDir = join(root, MEDIA_ROOT);
  const globs = allowlist.map(globRegExp);
  const files: string[] = [];
  for (const c of candidates(mediaDir)) {
    if (!globs.some((g) => g.test(c.rel))) continue;
    if (c.link) problems.push(`${c.rel} is a symlink; only regular files are served`);
    else files.push(c.rel);
  }
  if (files.includes(MANIFEST)) {
    const named = manifestFiles(readFileSync(join(mediaDir, MANIFEST), "utf8"));
    if (named === null) problems.push(`${MANIFEST} is not valid JSON`);
    else
      for (const file of [...new Set(named)])
        if (!files.includes(file))
          problems.push(`${MANIFEST} names ${file}, which the allowlist does not serve`);
  }
  if (problems.length > 0) return { files: [], bytes: 0, problems };
  rmSync(out, { recursive: true, force: true });
  let bytes = 0;
  for (const rel of files) {
    const to = join(out, ...rel.split("/"));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(mediaDir, ...rel.split("/")), to);
    bytes += lstatSync(to).size;
  }
  mkdirSync(out, { recursive: true });
  return { files, bytes, problems: [] };
}

/** `--root` (default: this checkout) and `--out` (default: STATIC_MEDIA_DIR), which must be under apps/<app>/dist. */
export function parseArgs(argv: readonly string[], defaultRoot: string): { root: string; out: string } {
  let root = defaultRoot;
  let out: string | undefined;
  for (const arg of argv) {
    if (arg.startsWith("--root=")) root = resolve(arg.slice("--root=".length));
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (out === undefined) return { root, out: join(root, MEDIA_PUBLIC_DIR) };
  const full = resolve(root, out);
  const parts = relative(root, full).split(sep);
  if (parts[0] !== "apps" || !parts[1] || parts[2] !== "dist" || parts.length < 4)
    throw new Error("--out must be a folder under apps/<app>/dist (it is replaced)");
  return { root, out: full };
}

export function main(argv: readonly string[], log: (line: string) => void): number {
  const here = dirname(fileURLToPath(import.meta.url));
  const { root, out } = parseArgs(argv, resolve(here, ".."));
  const r = assembleMedia(root, out);
  const where = relative(root, out).split(sep).join("/");
  if (r.problems.length > 0) {
    for (const p of r.problems) log(`assemble-media: ${p}`);
    log(`assemble-media: FAIL (${r.problems.length} problems); nothing was written to ${where}`);
    return 1;
  }
  log(`assemble-media: ${r.files.length} files, ${r.bytes} bytes, into ${where}`);
  return 0;
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
    process.exitCode = main(process.argv.slice(2), (line) => console.log(line));
  } catch (err) {
    console.log(`assemble-media: FAIL (${err instanceof Error ? err.message : "error"})`);
    process.exitCode = 1;
  }
}
