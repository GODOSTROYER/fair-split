// Rolldown plugin for tsdown.config.ts: a module inlined into the bundle keeps its own `import.meta`.
//
// The bundle inlines every @fairsplit/* package (their exports point at TypeScript source) and
// Rolldown leaves `import.meta` as written, so in an inlined module `import.meta.url` becomes the URL
// of the chunk it landed in (apps/tasks/dist/...), not of its source file. Every file a package reads
// next to its source then moves: packages/ai's `new URL("./prompts/", import.meta.url)` points at
// dist/prompts/ (ENOENT, and the read, rate-card and classify prompt folders collapse into one),
// packages/db's `../migrations` at apps/tasks/migrations, and a CLI guard comparing
// `import.meta.url` with process.argv[1] fires inside the entry.
//
// In every module that does not belong to the app being built, this plugin makes `import.meta`
// describe the module's source file, as Node does without a bundler:
//   import.meta.url       the source file's URL      import.meta.dirname  its directory
//   import.meta.filename  its path                   import.meta.main     false (never the entry)
// Any other use (import.meta.resolve, a computed key, the bare object, a write) fails the build: it
// cannot be made faithful here, and a silent difference is the bug this plugin exists to prevent.
//
// The paths are relative to the output directory, so dist runs inside the checkout it was built
// from. Render does that: the build and the start command share one directory, which also holds the
// root node_modules that the bundle's external npm dependencies need. The app's own modules keep the
// chunk's `import.meta`, because the entries compare it with process.argv[1].
//
// How: each `import.meta` becomes `__fs_meta()`, which has the same length, so no column moves and
// the transform needs no source map. The module ends with a hoisted `function __fs_meta()` that
// returns its frozen meta object, and each chunk holding such a module starts with
// `__fs_sourceMeta(path)`, which resolves `path` against the output directory from that chunk.
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { TsdownPlugin } from "tsdown";

/** The `import.meta` properties an inlined module may read. */
export const SUPPORTED_META = ["url", "filename", "dirname", "main"] as const;

const META = "import.meta";
/** Same length as `import.meta` (11), so every original column keeps its position. */
const STAND_IN = "__fs_meta()";
const MODULE_FN = "__fs_meta";
const HELPER = "__fs_sourceMeta";

const JS_MODULE_TYPES = ["js", "jsx", "ts", "tsx"] as const;
type JsModuleType = (typeof JS_MODULE_TYPES)[number];

interface AstNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

/** One `import.meta` in runtime code. `problem` is set when it cannot be made faithful. */
export interface ImportMetaUse {
  readonly start: number;
  readonly end: number;
  readonly problem?: string;
}

const isNode = (value: unknown): value is AstNode =>
  typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";

const nameOf = (node: unknown): string | undefined =>
  isNode(node) && node.type === "Identifier" ? (node.name as string) : undefined;

function problemOf(
  meta: AstNode,
  parent: AstNode | undefined,
  grandparent: AstNode | undefined,
): string | undefined {
  if (parent?.type !== "MemberExpression" || parent.object !== meta) return "the bare import.meta object";
  if (parent.computed) return "a computed import.meta key";
  const key = nameOf(parent.property) ?? "?";
  if (!(SUPPORTED_META as readonly string[]).includes(key)) return `import.meta.${key}`;
  const written =
    (grandparent?.type === "AssignmentExpression" && grandparent.left === parent) ||
    (grandparent?.type === "UpdateExpression" && grandparent.argument === parent) ||
    (grandparent?.type === "UnaryExpression" && grandparent.operator === "delete");
  return written ? `a write to import.meta.${key}` : undefined;
}

/**
 * Every `import.meta` in `program` (an ESTree AST with `start`/`end` offsets, as Rolldown's
 * `this.parse` returns), in source order. Strings and comments are not nodes, so they never match,
 * and a TypeScript type cannot hold `import.meta` (`typeof import.meta` does not parse).
 */
export function findImportMeta(program: unknown): ImportMetaUse[] {
  const uses: ImportMetaUse[] = [];
  const visit = (node: AstNode, parent?: AstNode, grandparent?: AstNode): void => {
    if (node.type === "MetaProperty" && nameOf(node.meta) === "import") {
      const problem = problemOf(node, parent, grandparent);
      uses.push(
        problem ? { start: node.start, end: node.end, problem } : { start: node.start, end: node.end },
      );
    }
    for (const value of Object.values(node))
      for (const child of Array.isArray(value) ? value : [value])
        if (isNode(child)) visit(child, node, parent);
  };
  if (isNode(program)) visit(program);
  return uses.sort((a, b) => a.start - b.start);
}

/** `line:column` (1-based) of an offset, for build errors. */
export function positionOf(code: string, offset: number): string {
  const before = code.slice(0, offset).split("\n");
  return `${before.length}:${(before.at(-1)?.length ?? 0) + 1}`;
}

/** Refusals for one module, empty when every use can be rewritten. */
export function refusals(code: string, uses: readonly ImportMetaUse[]): string[] {
  const out: string[] = [];
  for (const use of uses) {
    const problem =
      use.problem ??
      (code.slice(use.start, use.end) === META ? undefined : "import.meta with spaces or comments inside");
    if (problem) out.push(`${positionOf(code, use.start)} ${problem}`);
  }
  if (new RegExp(`\\b(?:${MODULE_FN}|${HELPER})\\b`).test(code))
    out.push(`the module already uses ${MODULE_FN} or ${HELPER}`);
  return out;
}

/** A relative POSIX path as a relative URL (each segment percent-encoded, `..` kept). */
export const toUrlPath = (path: string): string =>
  path
    .split("/")
    .map((s) => (s === ".." ? s : encodeURIComponent(s)))
    .join("/");

/**
 * The module with each `import.meta` replaced by `__fs_meta()` and that function appended. Offsets
 * are unchanged, so the original source map still holds.
 */
export function rewriteModule(
  code: string,
  uses: readonly ImportMetaUse[],
  sourceFromOutDir: string,
): string {
  let out = "";
  let at = 0;
  for (const use of uses) {
    out += code.slice(at, use.start) + STAND_IN;
    at = use.end;
  }
  const path = JSON.stringify(toUrlPath(sourceFromOutDir));
  return `${out}${code.slice(at)}\nfunction ${MODULE_FN}() {\n  return (${MODULE_FN}.v ??= ${HELPER}(${path}));\n}\n`;
}

/** The helper that starts every chunk holding a rewritten module; `chunkFileName` is relative to the output directory. */
export function sourceMetaHelper(chunkFileName: string): string {
  const depth = chunkFileName.split("/").length - 1;
  const outDir = JSON.stringify(depth === 0 ? "./" : "../".repeat(depth));
  return [
    "// import.meta of the modules inlined below describes their source files (apps/tasks/build/inline-import-meta.ts).",
    `function ${HELPER}(path) {`,
    `  const url = new URL(path, new URL(${outDir}, import.meta.url));`,
    '  const filename = process.getBuiltinModule("node:url").fileURLToPath(url);',
    '  const dirname = process.getBuiltinModule("node:path").dirname(filename);',
    "  return Object.freeze({ __proto__: null, url: url.href, filename, dirname, main: false });",
    "}",
  ].join("\n");
}

/** The plugin. One build at a time per instance: it learns the output directory from tsdown's resolved config. */
export function inlinedImportMeta(): TsdownPlugin {
  let outDir: string | undefined;
  let appRoot: string | undefined;
  /** Rewritten module id → its source path relative to the output directory. */
  const rewritten = new Map<string, string>();
  const roots = new Map<string, string | undefined>();

  /** The nearest directory at or above `dir` that holds a package.json. */
  const packageRoot = (dir: string): string | undefined => {
    if (roots.has(dir)) return roots.get(dir);
    const parent = dirname(dir);
    const root = existsSync(join(dir, "package.json"))
      ? dir
      : parent === dir
        ? undefined
        : packageRoot(parent);
    roots.set(dir, root);
    return root;
  };

  return {
    name: "fairsplit:inlined-import-meta",
    tsdownConfigResolved(config) {
      roots.clear();
      outDir = config.outDir;
      appRoot = packageRoot(config.cwd ?? process.cwd());
    },
    buildStart() {
      rewritten.clear();
    },
    renderStart(output) {
      // The helper reads the chunk's own import.meta.url, which only ESM output has.
      if (output.format !== "es") this.error(`ESM output only (got ${output.format})`);
    },
    transform: {
      filter: { code: /\bimport\s*\.\s*meta\b/, moduleType: [...JS_MODULE_TYPES] },
      handler(code, id, meta) {
        if (!isAbsolute(id) || id.includes("\0") || id.includes("?")) return null;
        if (!outDir || !appRoot)
          return this.error("needs tsdown: the output directory comes from tsdownConfigResolved");
        if (packageRoot(dirname(id)) === appRoot) return null;
        const program = this.parse(code, { lang: meta.moduleType as JsModuleType, preserveParens: false });
        const uses = findImportMeta(program);
        if (uses.length === 0) return null;
        const file = relative(appRoot, id).split(sep).join("/");
        const refused = refusals(code, uses);
        if (refused.length > 0)
          return this.error(
            `${file}: an inlined module may read only import.meta.{${SUPPORTED_META.join(",")}}; ` +
              `found ${refused.join("; ")}`,
          );
        const fromOutDir = relative(outDir, id);
        if (isAbsolute(fromOutDir)) return this.error(`${file}: no relative path from ${outDir}`);
        const source = fromOutDir.split(sep).join("/");
        rewritten.set(id, source);
        return { code: rewriteModule(code, uses, source), map: null };
      },
    },
    banner(chunk) {
      return chunk.moduleIds.some((id) => rewritten.has(id)) ? sourceMetaHelper(chunk.fileName) : "";
    },
  };
}
