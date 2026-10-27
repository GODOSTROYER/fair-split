// The import.meta rewrite that keeps inlined packages reading their own files (build/inline-import-meta.ts).
// The AST comes from Rolldown's own parser, the one the plugin gets as `this.parse` during a build.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, Rolldown } from "tsdown";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  findImportMeta,
  inlinedImportMeta,
  positionOf,
  refusals,
  rewriteModule,
  SUPPORTED_META,
  sourceMetaHelper,
  toUrlPath,
} from "../build/inline-import-meta.ts";

async function parse(code: string, lang: "ts" | "js" = "ts"): Promise<unknown> {
  let program: unknown;
  const bundle = await Rolldown.rolldown({
    input: "probe",
    logLevel: "silent",
    plugins: [
      {
        name: "parse-probe",
        resolveId: (id) => (id === "probe" ? "\0probe" : null),
        load: (id) => (id === "\0probe" ? "export {};" : null),
        buildStart() {
          program = this.parse(code, { lang, preserveParens: false });
        },
      },
    ],
  });
  await bundle.generate({ format: "es" }); // the build, and so buildStart, runs here
  await bundle.close();
  return program;
}

const slices = (code: string, uses: { start: number; end: number }[]) =>
  uses.map((u) => code.slice(u.start, u.end));

describe("findImportMeta: every import.meta in runtime code", () => {
  it("finds the four supported reads, in source order, at exact UTF-16 offsets", async () => {
    const code = [
      "// “Prompts”, ₱ and é before the first use move UTF-8 offsets but not UTF-16 ones.",
      'const a: URL = new URL("./prompts/", import.meta.url);',
      "const b = (import.meta).dirname;",
      "const c = import.meta?.filename;",
      "const d = import.meta.main as boolean;",
    ].join("\n");
    const uses = findImportMeta(await parse(code));
    expect(uses).toHaveLength(4);
    expect(uses.every((u) => u.problem === undefined)).toBe(true);
    expect(slices(code, uses)).toEqual(Array(4).fill("import.meta"));
    expect(uses.map((u) => u.start)).toEqual([...uses.map((u) => u.start)].sort((x, y) => x - y));
    expect(SUPPORTED_META).toEqual(["url", "filename", "dirname", "main"]);
  });

  it("ignores import.meta in strings, comments and templates' text, and sees through TypeScript wrappers", async () => {
    const code = [
      "// import.meta.url in a comment",
      'const s = "import.meta.url in a string";',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source code with a template literal
      "const t = `import.meta.url in a template, ${import.meta.url} in its expression`;",
      "type Meta = ImportMeta;",
      "const u = (import.meta.url as string)!;",
      "enum E { A = import.meta.url.length }",
    ].join("\n");
    const uses = findImportMeta(await parse(code));
    expect(uses.map((u) => positionOf(code, u.start))).toEqual(["3:45", "5:12", "6:14"]);
    expect(uses.every((u) => u.problem === undefined)).toBe(true);
  });

  it("refuses what cannot be made faithful: resolve, unknown keys, computed keys, the bare object, writes", async () => {
    const code = [
      'const r = import.meta.resolve("./x.js");',
      "const e = import.meta.env;",
      'const k = import.meta["url"];',
      "const o = import.meta;",
      'import.meta.url = "file:///elsewhere";',
      "delete import.meta.dirname;",
      "import.meta.main++;",
    ].join("\n");
    const problems = findImportMeta(await parse(code)).map((u) => u.problem);
    expect(problems).toEqual([
      "import.meta.resolve",
      "import.meta.env",
      "a computed import.meta key",
      "the bare import.meta object",
      "a write to import.meta.url",
      "a write to import.meta.dirname",
      "a write to import.meta.main",
    ]);
  });
});

describe("refusals", () => {
  it("reports each refused use with its line and column", async () => {
    const code = 'const ok = import.meta.url;\nconst no = import.meta.resolve("x");\n';
    expect(refusals(code, findImportMeta(await parse(code)))).toEqual(["2:12 import.meta.resolve"]);
  });

  it("refuses import.meta written with spaces inside (the stand-in must keep its length)", async () => {
    const code = "const u = import . meta.url;";
    expect(refusals(code, findImportMeta(await parse(code)))).toEqual([
      "1:11 import.meta with spaces or comments inside",
    ]);
  });

  it("refuses a module that already uses the generated names", async () => {
    const code = "const __fs_meta = 1;\nconst u = import.meta.url;";
    expect(refusals(code, findImportMeta(await parse(code)))).toEqual([
      "the module already uses __fs_meta or __fs_sourceMeta",
    ]);
  });
});

describe("rewriteModule", () => {
  it("replaces only real uses, keeps every original line's length, and appends the module's meta function", async () => {
    const code = [
      'import { readFileSync } from "node:fs";',
      "// import.meta.url stays in this comment",
      'const note = "import.meta.url stays in this string";',
      'export const DIR = new URL("./prompts/", import.meta.url);',
      "export const where = { dir: import.meta.dirname, main: import.meta.main };",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source code with a template literal
      "export const read = (n: string) => readFileSync(new URL(`${n}.md`, DIR), 'utf8');",
    ].join("\n");
    const out = rewriteModule(
      code,
      findImportMeta(await parse(code)),
      "../../packages/ai/src/read/prompts.ts",
    );
    const lines = code.split("\n");
    const outLines = out.split("\n");
    expect(outLines.slice(0, lines.length).map((l) => l.length)).toEqual(lines.map((l) => l.length));
    expect(outLines[1]).toBe(lines[1]);
    expect(outLines[2]).toBe(lines[2]);
    expect(outLines[3]).toBe('export const DIR = new URL("./prompts/", __fs_meta().url);');
    expect(outLines[4]).toBe("export const where = { dir: __fs_meta().dirname, main: __fs_meta().main };");
    expect(out.slice(code.length)).toBe(
      "\nfunction __fs_meta() {\n" +
        '  return (__fs_meta.v ??= __fs_sourceMeta("../../packages/ai/src/read/prompts.ts"));\n' +
        "}\n",
    );
  });

  it("percent-encodes path segments for the URL and keeps `..`", () => {
    expect(toUrlPath("../../node_modules/@fairsplit/p q/a#b%.ts")).toBe(
      "../../node_modules/%40fairsplit/p%20q/a%23b%25.ts",
    );
  });
});

describe("sourceMetaHelper: resolves against the output directory from wherever the chunk sits", () => {
  it.each([
    ["index.js", '"./"'],
    ["_chunks/wiring.js", '"../"'],
    ["a/b/c.js", '"../../"'],
  ])("%s → %s", (fileName, up) => {
    const helper = sourceMetaHelper(fileName);
    expect(helper).toContain(`new URL(path, new URL(${up}, import.meta.url))`);
    expect(helper).toContain("main: false");
  });

  it("produces Node's own values for a source file", () => {
    const dir = mkdtempSync(join(tmpdir(), "fs-meta-helper-"));
    try {
      mkdirSync(join(dir, "dist/_chunks"), { recursive: true });
      mkdirSync(join(dir, "pkg/src"), { recursive: true });
      writeFileSync(
        join(dir, "dist/_chunks/x.js"),
        `${sourceMetaHelper("_chunks/x.js")}\nconsole.log(JSON.stringify(__fs_sourceMeta("../pkg/src/a.ts")));\n`,
      );
      const r = spawnSync(process.execPath, [join(dir, "dist/_chunks/x.js")], { encoding: "utf8" });
      expect(r.stderr).toBe("");
      const meta = JSON.parse(r.stdout) as Record<string, unknown>;
      const filename = join(dir, "pkg/src/a.ts");
      expect(meta).toEqual({
        url: pathToFileURL(filename).href,
        filename,
        dirname: dirname(filename),
        main: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("inlinedImportMeta in a tsdown build", () => {
  let dir = "";
  const pkg = () => join(dir, "node_modules/@fairsplit/meta-probe");
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "fs-meta-build-"));
    mkdirSync(join(pkg(), "src"), { recursive: true });
    writeFileSync(
      join(pkg(), "package.json"),
      JSON.stringify({
        name: "@fairsplit/meta-probe",
        type: "module",
        exports: { ".": "./src/index.ts", "./resolve": "./src/resolve.ts" },
      }),
    );
    writeFileSync(join(pkg(), "src/index.ts"), "export const here: string = import.meta.url;\n");
    writeFileSync(
      join(pkg(), "src/resolve.ts"),
      'export const next: string = import.meta.resolve("./x.js");\n',
    );
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "meta-app", type: "module" }));
    writeFileSync(
      join(dir, "own.ts"),
      'import { here } from "@fairsplit/meta-probe";\nconsole.log(JSON.stringify({ own: import.meta.url, here }));\n',
    );
    writeFileSync(
      join(dir, "bad.ts"),
      'import { next } from "@fairsplit/meta-probe/resolve";\nconsole.log(next);\n',
    );
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const run = (entry: string, outDir: string, format: "esm" | "cjs" = "esm") =>
    build({
      cwd: dir,
      config: false,
      tsconfig: false,
      entry: { [entry]: `${entry}.ts` },
      outDir,
      format,
      platform: "node",
      target: "node24",
      fixedExtension: false,
      hash: false,
      dts: false,
      logLevel: "silent",
      deps: { alwaysBundle: [/^@fairsplit\//] },
      plugins: [inlinedImportMeta()],
    });

  it("the app's own modules keep the chunk's import.meta; the inlined one gets its source file", async () => {
    await run("own", "out");
    const r = spawnSync(process.execPath, ["out/own.js"], { cwd: dir, encoding: "utf8" });
    expect(r.stderr).toBe("");
    const { own, here } = JSON.parse(r.stdout) as { own: string; here: string };
    expect(own).toMatch(/\/out\/own\.js$/);
    expect(fileURLToPath(here)).toBe(join(pkg(), "src/index.ts"));
    expect(readFileSync(join(dir, "out/own.js"), "utf8")).toMatch(
      /^\/\/ import\.meta of the modules inlined below/,
    );
  }, 60_000);

  it("fails the build, naming the file and position, for a use it cannot make faithful", async () => {
    await expect(run("bad", "out-bad")).rejects.toThrow(
      /node_modules\/@fairsplit\/meta-probe\/src\/resolve\.ts: an inlined module may read only import\.meta\.\{url,filename,dirname,main\}; found 1:29 import\.meta\.resolve/,
    );
  }, 60_000);

  it("refuses CommonJS output, where the helper has no import.meta of its own", async () => {
    await expect(run("own", "out-cjs", "cjs")).rejects.toThrow(/ESM output only \(got cjs\)/);
  }, 60_000);
});
