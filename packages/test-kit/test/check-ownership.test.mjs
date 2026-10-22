// Unit tests for tools/check-ownership.mjs (WS-QA owns both). They run against the real docs/ownership.md.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkChanges,
  GATE_FILES,
  globToRegExp,
  loadOwnership,
  main,
  matchPath,
  owns,
  parseNameStatus,
  parseOwnership,
  workstreamFromBranch,
} from "../../../tools/check-ownership.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ownership = parseOwnership(readFileSync(resolve(repoRoot, "docs/ownership.md"), "utf8"));
const edit = (...paths) => paths.map((path) => ({ status: "M", path }));

describe("glob matching", () => {
  it("handles *, ** and braces", () => {
    expect(globToRegExp("tools/{tts,imagegen}.ts").test("tools/tts.ts")).toBe(true);
    expect(globToRegExp("tools/{tts,imagegen}.ts").test("tools/setup.ts")).toBe(false);
    expect(globToRegExp("packages/ai/src/{agent,explain}/**").test("packages/ai/src/agent/run.ts")).toBe(
      true,
    );
    expect(globToRegExp("packages/ai/*").test("packages/ai/package.json")).toBe(true);
    expect(globToRegExp("packages/ai/*").test("packages/ai/src/index.ts")).toBe(false);
    expect(globToRegExp("**/package.json").test("package.json")).toBe(true);
    expect(globToRegExp("**/package.json").test("packages/db/package.json")).toBe(true);
  });

  it("treats a plain path as a file or a directory prefix", () => {
    expect(matchPath("packages/domain", "packages/domain/src/money.ts")).toBe(true);
    expect(matchPath("packages/domain", "packages/domain-extra/x.ts")).toBe(false);
    expect(matchPath("README.md", "README.md")).toBe(true);
    expect(matchPath("README.md", "docs/README.md")).toBe(false);
    expect(matchPath("docs/**", "docs\\adr\\001.md")).toBe(true);
  });
});

describe("docs/ownership.md", () => {
  it("lists the thirteen workstreams from register section 11, plus WS-PPSIM (ADR-0002)", () => {
    expect(Object.keys(ownership.workstreams).sort()).toEqual(
      [
        "WS-AGENT",
        "WS-API",
        "WS-APP",
        "WS-CONSOLE",
        "WS-CORE",
        "WS-DATA",
        "WS-DS",
        "WS-MEDIA",
        "WS-OPS",
        "WS-PPCORE",
        "WS-PPMONEY",
        "WS-PPSIM",
        "WS-QA",
        "WS-READ",
      ].sort(),
    );
  });

  it("resolves exceptions", () => {
    expect(owns(ownership, "WS-API", "apps/api/src/routes/runs.ts")).toBe(true);
    expect(owns(ownership, "WS-API", "apps/api/src/webhooks/paypal.ts")).toBe(false);
    expect(owns(ownership, "WS-PPCORE", "apps/api/src/webhooks/paypal.ts")).toBe(true);
    expect(owns(ownership, "WS-CONSOLE", "apps/console/src/prototype/Slab.tsx")).toBe(false);
    expect(owns(ownership, "WS-DS", "apps/console/src/prototype/Slab.tsx")).toBe(true);
    expect(owns(ownership, "WS-QA", "docs/spec/00-decision-register.md")).toBe(false);
  });

  it("gives WS-OPS tools/** except what other rows own", () => {
    expect(owns(ownership, "WS-OPS", "tools/export-sandbox-ids.ts")).toBe(true);
    expect(owns(ownership, "WS-OPS", "tools/setup-webhooks.ts")).toBe(false);
    expect(owns(ownership, "WS-OPS", "tools/tts.ts")).toBe(false);
    expect(owns(ownership, "WS-OPS", "tools/check-ownership.mjs")).toBe(false);
    expect(owns(ownership, "WS-QA", "tools/check-ownership.mjs")).toBe(true);
  });
});

describe("workstreamFromBranch", () => {
  it("maps ws/<id> and deps/*", () => {
    expect(workstreamFromBranch("ws/ppcore")).toBe("WS-PPCORE");
    expect(workstreamFromBranch("refs/heads/ws/qa")).toBe("WS-QA");
    expect(workstreamFromBranch("deps/axe-core")).toBe("deps");
    expect(workstreamFromBranch("main")).toBeNull();
    expect(workstreamFromBranch(undefined)).toBeNull();
  });
});

describe("checkChanges", () => {
  it("passes when every path is owned", () => {
    const r = checkChanges(
      ownership,
      "WS-CORE",
      edit("packages/domain/src/money.ts", "packages/seed/package.json"),
    );
    expect(r).toEqual({ ok: true, violations: [] });
  });

  it("fails a path outside the workstream and names the owner", () => {
    const r = checkChanges(
      ownership,
      "WS-CORE",
      edit("packages/domain/src/a.ts", "packages/db/src/schema.ts"),
    );
    expect(r.ok).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].path).toBe("packages/db/src/schema.ts");
    expect(r.violations[0].reason).toContain("WS-DATA");
  });

  it("fails a path no workstream owns", () => {
    const r = checkChanges(ownership, "WS-QA", edit("random-file.txt"));
    expect(r.violations[0].reason).toContain("no workstream");
  });

  it("lets WS-QA edit root hygiene files but not the specs", () => {
    expect(checkChanges(ownership, "WS-QA", edit("biome.json", ".github/workflows/ci.yml")).ok).toBe(true);
    expect(checkChanges(ownership, "WS-QA", edit("docs/spec/02-architecture.md")).ok).toBe(false);
  });

  it("lets anyone add, but nobody edit, files in append-only folders", () => {
    expect(checkChanges(ownership, "WS-APP", [{ status: "A", path: "docs/spikes/S7.md" }]).ok).toBe(true);
    expect(checkChanges(ownership, "WS-QA", [{ status: "M", path: "docs/adr/001-x.md" }]).ok).toBe(false);
    expect(checkChanges(ownership, "WS-QA", [{ status: "D", path: "docs/gates/G0.md" }]).ok).toBe(false);
  });

  it("keeps the lockfile, the catalog and versions.md in the deps lane (S5.2.3 rule 4)", () => {
    expect(checkChanges(ownership, "WS-DATA", edit("packages/db/package.json")).ok).toBe(true);
    for (const ws of Object.keys(ownership.workstreams)) {
      for (const file of ["pnpm-lock.yaml", "pnpm-workspace.yaml", "docs/versions.md"]) {
        expect(checkChanges(ownership, ws, edit(file)).ok, `${ws} ${file}`).toBe(false);
      }
    }
    const depsFiles = edit("pnpm-lock.yaml", "pnpm-workspace.yaml", "docs/versions.md");
    expect(checkChanges(ownership, "deps", depsFiles).ok).toBe(true);
  });

  it("refuses a deletion, rename or type change of the gate's files for every lane, WS-QA and bootstrap included", () => {
    expect(GATE_FILES).toEqual(["docs/ownership.md", "tools/check-ownership.mjs"]);
    const lanes = [...Object.keys(ownership.workstreams), "deps"];
    for (const file of GATE_FILES) {
      const removals = {
        delete: [{ status: "D", path: file }],
        rename: parseNameStatus(`R100\t${file}\t${file}.old`),
        retype: [{ status: "T", path: file }],
      };
      for (const ws of lanes) {
        for (const [how, changes] of Object.entries(removals)) {
          for (const bootstrap of [false, true]) {
            const r = checkChanges(ownership, ws, changes, { bootstrap });
            const gate = r.violations.find((v) => v.path === file);
            expect(r.ok, `${ws} ${how} ${file}`).toBe(false);
            expect(gate?.reason, `${ws} ${how} ${file}`).toMatch(/may not be deleted, renamed or retyped/);
          }
        }
      }
      // Editing them stays WS-QA's job, judged like any other path.
      expect(checkChanges(ownership, "WS-QA", edit(file)).ok).toBe(true);
      expect(checkChanges(ownership, "WS-OPS", edit(file)).ok).toBe(false);
    }
  });

  it("lets only WS-QA's bootstrap PR touch the deps-lane files", () => {
    const files = [
      { status: "A", path: "docs/versions.md" },
      ...edit("pnpm-lock.yaml", "pnpm-workspace.yaml"),
    ];
    expect(checkChanges(ownership, "WS-QA", files, { bootstrap: true }).ok).toBe(true);
    expect(checkChanges(ownership, "WS-QA", files).ok).toBe(false);
    expect(checkChanges(ownership, "WS-DATA", files, { bootstrap: true }).ok).toBe(false);
  });

  it("limits the deps lane to dependency files", () => {
    expect(checkChanges(ownership, "deps", edit("pnpm-workspace.yaml", "docs/versions.md")).ok).toBe(true);
    expect(checkChanges(ownership, "deps", edit("apps/api/package.json")).ok).toBe(true);
    expect(checkChanges(ownership, "deps", edit("packages/domain/src/money.ts")).ok).toBe(false);
  });

  it("rejects an unknown workstream", () => {
    expect(() => checkChanges(ownership, "WS-NOPE", [])).toThrow(/Unknown workstream/);
  });
});

describe("parseNameStatus", () => {
  it("splits renames into a delete of the old path and an add of the new one", () => {
    const out = parseNameStatus(
      "M\tREADME.md\nA\tdocs/adr/002-x.md\nR095\tpackages/db/a.ts\tpackages/domain/a.ts\n",
    );
    expect(out).toEqual([
      { status: "M", path: "README.md" },
      { status: "A", path: "docs/adr/002-x.md" },
      { status: "D", path: "packages/db/a.ts" },
      { status: "R", path: "packages/domain/a.ts" },
    ]);
  });

  it("accepts plain paths from git diff --name-only as modifications", () => {
    expect(parseNameStatus("README.md\r\npackages/domain/src/x.ts\n")).toEqual([
      { status: "M", path: "README.md" },
      { status: "M", path: "packages/domain/src/x.ts" },
    ]);
    const changes = parseNameStatus("README.md\npackages/domain/src/x.ts\n");
    expect(checkChanges(ownership, "WS-QA", changes).ok).toBe(false);
  });

  it("rejects a status code with no path", () => {
    expect(() => parseNameStatus("M\t\n")).toThrow(/Unreadable/);
  });

  it("catches a rename across workstreams", () => {
    const changes = parseNameStatus("R100\tpackages/db/src/x.ts\tpackages/domain/src/x.ts");
    expect(checkChanges(ownership, "WS-CORE", changes).ok).toBe(false);
  });
});

describe("CLI", () => {
  const quiet = (fn) => {
    const { log, error } = console;
    console.log = () => {};
    console.error = () => {};
    try {
      return fn();
    } finally {
      console.log = log;
      console.error = error;
    }
  };

  it("exits 0 for owned files and 1 otherwise", () => {
    expect(quiet(() => main(["--ws", "qa", "README.md"], {}))).toBe(0);
    expect(quiet(() => main(["--branch", "ws/qa", "packages/domain/src/x.ts"], {}))).toBe(1);
  });

  it("reads the branch from GITHUB_HEAD_REF and skips non-workstream branches", () => {
    expect(quiet(() => main(["packages/db/src/x.ts"], { GITHUB_HEAD_REF: "ws/data" }))).toBe(0);
    expect(quiet(() => main(["anything"], { GITHUB_REF_NAME: "main" }))).toBe(0);
    expect(quiet(() => main(["--strict", "anything"], { GITHUB_REF_NAME: "main" }))).toBe(1);
  });

  it("runs as a script", () => {
    const out = execFileSync(
      process.execPath,
      [resolve(repoRoot, "tools/check-ownership.mjs"), "--ws", "QA", "README.md"],
      {
        encoding: "utf8",
      },
    );
    expect(out).toContain("all within WS-QA");
  });
});

// Each case builds real git repositories (1-2 s on Windows), so the 5 s default is too tight under load.
describe("CI mode: a PR is judged by its base's rules", { timeout: 30_000 }, () => {
  // Throwaway git repositories in the OS temp dir, never under packages/: deps:check (dependency-rules.test.mjs)
  // walks packages/** in parallel and fails with ENOENT when it meets a repo that a test here just deleted.
  const base = mkdtempSync(join(tmpdir(), "fs-ownership-repos-"));
  const hooks = join(base, "no-hooks");
  mkdirSync(hooks, { recursive: true });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  const realRules = readFileSync(resolve(repoRoot, "docs/ownership.md"), "utf8");
  const quietMain = (args) => {
    const { log, error, warn } = console;
    const lines = [];
    const capture = (m) => lines.push(String(m));
    console.log = capture;
    console.error = capture;
    console.warn = capture;
    try {
      return { code: main(args, {}), out: lines.join("\n") };
    } finally {
      Object.assign(console, { log, error, warn });
    }
  };

  /** A repo whose main holds `baseFiles`. */
  function makeRepo(baseFiles) {
    const dir = mkdtempSync(join(base, "repo-"));
    const git = (...args) =>
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "-c",
          `core.hooksPath=${hooks}`,
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim();
    const write = (rel, text) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    };
    const commit = (msg) => {
      git("add", "-A");
      git("commit", "-q", "--allow-empty", "-m", msg);
      return git("rev-parse", "HEAD");
    };
    git("init", "-q", "-b", "main");
    write("README.md", "fixture\n");
    for (const [rel, text] of Object.entries(baseFiles)) write(rel, text);
    const mainSha = commit("base");
    return { dir, git, write, commit, mainSha };
  }

  const ci = (r, branch) => ["--branch", branch, "--base", r.mainSha, "--repo", r.dir, "--strict"];
  const coreRow = "`packages/contracts`, `packages/domain`, `packages/seed`";
  const widenedCore = realRules.replace(coreRow, `${coreRow}, \`packages/db/**\`, \`docs/ownership.md\``);
  // The shape of the scaffold's first docs/ownership.md: a prose table with no backticks and no shared rules.
  const proseRules =
    "# Path ownership by workstream\n\n| WS | Owned paths |\n| --- | --- |\n" +
    "| WS-CORE | packages/contracts, packages/domain, packages/seed |\n| WS-QA | .github/**, docs/** |\n";

  it("rejects a ws/core PR that adds packages/db/** to its own WS-CORE row", () => {
    const r = makeRepo({ "docs/ownership.md": realRules });
    r.git("checkout", "-q", "-b", "ws/core");
    expect(realRules).toContain(coreRow);
    r.write("docs/ownership.md", widenedCore);
    r.write("packages/db/src/schema.ts", "export {};\n");
    r.commit("widen my row");

    const judged = quietMain(ci(r, "ws/core"));
    expect(judged.code).toBe(1);
    expect(judged.out).toContain("packages/db/src/schema.ts");
    expect(judged.out).toContain("M docs/ownership.md");
    expect(judged.out).toContain(`rules from ${r.mainSha}:docs/ownership.md`);

    // Control: judged by the PR's own widened rules, the same diff would have passed.
    const selfJudged = quietMain([...ci(r, "ws/core"), "--ownership-ref", "HEAD"]);
    expect(selfJudged.code).toBe(0);
  });

  it("fails a PR from a branch that is not ws/<id> or deps/* under --strict", () => {
    const r = makeRepo({ "docs/ownership.md": realRules });
    r.git("checkout", "-q", "-b", "fix/x");
    r.write("packages/db/src/schema.ts", "export {};\n");
    r.commit("sneak");
    expect(quietMain(ci(r, "fix/x")).code).toBe(1);
    expect(quietMain(["--base", r.mainSha, "--repo", r.dir, "--strict"]).code).toBe(1);
  });

  it("bootstrap only when the base has neither gate file: WS-QA's PR installs the rules and the stack", () => {
    const r = makeRepo({});
    r.git("checkout", "-q", "-b", "ws/qa");
    r.write("docs/ownership.md", realRules);
    r.write("docs/versions.md", "# Pinned versions\n");
    r.write("pnpm-lock.yaml", "lockfileVersion: 9\n");
    r.commit("bootstrap");
    expect(loadOwnership({ repo: r.dir, ref: r.mainSha }).bootstrap).toBe(true);
    const judged = quietMain(ci(r, "ws/qa"));
    expect(judged.code).toBe(0);
    expect(judged.out).toMatch(/bootstrap/);

    r.git("checkout", "-q", "-b", "ws/data", r.mainSha);
    r.write("docs/ownership.md", realRules);
    r.write("pnpm-lock.yaml", "lockfileVersion: 9\n");
    r.write("packages/db/src/schema.ts", "export {};\n");
    r.commit("not mine");
    expect(quietMain(ci(r, "ws/data")).code).toBe(1);
  });

  it("no bootstrap when the base has the checker but lost its rules: fails closed, WS-QA included", () => {
    const r = makeRepo({ "tools/check-ownership.mjs": "// the checker\n" });
    r.git("checkout", "-q", "-b", "ws/qa");
    r.write("docs/ownership.md", realRules);
    r.write("docs/versions.md", "# Pinned versions\n");
    r.commit("re-add rules and take the deps lane");
    expect(() => loadOwnership({ repo: r.dir, ref: r.mainSha })).toThrow(
      /tools\/check-ownership\.mjs is there.*failing closed/,
    );
    const judged = quietMain(ci(r, "ws/qa"));
    expect(judged.code).toBe(1);
    expect(judged.out).toMatch(/failing closed/);
    expect(judged.out).not.toMatch(/bootstrap|all within/);
  });

  it("a PR that deletes the rules or renames the checker fails, WS-QA's too, so bootstrap cannot reopen", () => {
    const r = makeRepo({ "docs/ownership.md": realRules, "tools/check-ownership.mjs": "// the checker\n" });
    r.git("checkout", "-q", "-b", "ws/qa");
    rmSync(join(r.dir, "docs/ownership.md"));
    r.commit("drop the rules");
    const dropped = quietMain(ci(r, "ws/qa"));
    expect(dropped.code).toBe(1);
    expect(dropped.out).toContain("D docs/ownership.md: the ownership gate's files may not be deleted");

    r.git("checkout", "-q", "-B", "ws/qa", r.mainSha);
    r.git("mv", "tools/check-ownership.mjs", "tools/check-ownership.old.mjs");
    r.commit("rename the checker");
    const renamed = quietMain(ci(r, "ws/qa"));
    expect(renamed.code).toBe(1);
    expect(renamed.out).toContain(
      "D tools/check-ownership.mjs: the ownership gate's files may not be deleted",
    );

    r.git("checkout", "-q", "-B", "ws/qa", r.mainSha);
    r.write("docs/ownership.md", `${realRules}\n<!-- a reviewed edit -->\n`);
    r.commit("edit the rules");
    expect(quietMain(ci(r, "ws/qa")).code).toBe(0); // control: WS-QA may still edit them
  });

  it("bootstrap is WS-QA's alone: on a base without rules another workstream cannot grant itself paths", () => {
    const r = makeRepo({});
    r.git("checkout", "-q", "-b", "ws/data");
    const dataRow = "`packages/db`, `packages/outbox`";
    expect(realRules).toContain(dataRow);
    const selfGranted = `${dataRow}, \`docs/ownership.md\`, \`pnpm-lock.yaml\``;
    r.write("docs/ownership.md", realRules.replace(dataRow, selfGranted));
    r.write("pnpm-lock.yaml", "lockfileVersion: 9\n");
    r.write("packages/db/src/schema.ts", "export {};\n");
    r.commit("rules that grant WS-DATA everything it touches");
    const judged = quietMain(ci(r, "ws/data"));
    expect(judged.code).toBe(1);
    expect(judged.out).toMatch(/only WS-QA/);
    expect(judged.out).not.toMatch(/all within/);
  });

  it.each([
    ["the scaffold's prose table", { "docs/ownership.md": proseRules }],
    ["a directory", { "docs/ownership.md/README.md": "a directory, not the rules\n" }],
  ])("fails closed when the base's docs/ownership.md exists but cannot be read or parsed: %s", (_, files) => {
    const r = makeRepo(files);
    r.git("checkout", "-q", "-b", "ws/qa");
    rmSync(join(r.dir, "docs/ownership.md"), { recursive: true, force: true });
    r.write("docs/ownership.md", realRules);
    r.write("docs/versions.md", "# Pinned versions\n");
    r.commit("install machine-readable rules");
    expect(() => loadOwnership({ repo: r.dir, ref: r.mainSha })).toThrow(/failing closed/);
    const judged = quietMain(ci(r, "ws/qa"));
    expect(judged.code).toBe(1);
    expect(judged.out).toMatch(/failing closed/);
    expect(judged.out).not.toMatch(/bootstrap|all within/);
  });

  it("a PR that edits docs/ownership.md cannot widen its own paths, even when the base's copy is broken", () => {
    const broken = realRules.slice(0, realRules.indexOf("## Shared rules"));
    expect(() => parseOwnership(broken)).toThrow();
    const r = makeRepo({ "docs/ownership.md": broken });
    r.git("checkout", "-q", "-b", "ws/core");
    r.write("docs/ownership.md", widenedCore);
    r.write("packages/db/src/schema.ts", "export {};\n");
    r.commit("repair the rules and widen my row");
    const judged = quietMain(ci(r, "ws/core"));
    expect(judged.code).toBe(1);
    expect(judged.out).toMatch(/failing closed/);
    expect(judged.out).not.toMatch(/all within/);
  });

  it("fails closed on git errors other than 'does not exist': missing commit, unknown ref, missing tree", () => {
    const r = makeRepo({ "docs/ownership.md": realRules });
    r.write("docs/ownership.md", `${realRules}\n<!-- side commit -->\n`);
    const side = r.commit("a later commit with its own copy of the rules");
    r.git("checkout", "-q", "-b", "ws/qa", r.mainSha);
    r.write("README.md", "edited by WS-QA\n");
    r.commit("qa edit");
    expect(quietMain(ci(r, "ws/qa")).code).toBe(0); // control: readable base rules, owned path

    // Corrupt or partial clone: the side commit's docs/ tree object is gone, so `git cat-file -e`
    // says the path is "not in" that tree although the file is there.
    const docsTree = r.git("rev-parse", `${side}:docs`);
    const object = join(r.dir, ".git", "objects", docsTree.slice(0, 2), docsTree.slice(2));
    expect(existsSync(object)).toBe(true);
    chmodSync(object, 0o644);
    rmSync(object);

    for (const ref of ["0123456789abcdef0123456789abcdef01234567", "no-such-branch", side]) {
      expect(() => loadOwnership({ repo: r.dir, ref }), ref).toThrow(/failing closed/);
      const judged = quietMain([...ci(r, "ws/qa"), "--ownership-ref", ref]);
      expect(judged.code, ref).toBe(1);
      expect(judged.out, ref).not.toMatch(/bootstrap|all within/);
    }
  });

  it("refuses an empty or option-like --base or --ownership-ref instead of judging by the working tree", () => {
    const r = makeRepo({ "docs/ownership.md": realRules });
    r.git("checkout", "-q", "-b", "ws/core");
    r.write("docs/ownership.md", widenedCore);
    r.write("packages/db/src/schema.ts", "export {};\n");
    r.commit("widen my row");
    const run = (...args) => quietMain(["--branch", "ws/core", "--repo", r.dir, "--strict", ...args]);
    expect(run("--base", r.mainSha, "--ownership-ref", "").code).toBe(1);
    expect(run("--ownership-ref", r.mainSha, "--base", "").code).toBe(1);
    expect(run("--base", r.mainSha, "--ownership-ref").code).toBe(1);
    expect(run("--ownership-ref", r.mainSha, "--base", "--output=diff.txt").code).toBe(1);
    expect(existsSync(join(r.dir, "diff.txt...HEAD"))).toBe(false);
  });

  it("once the base has rules they win: WS-QA can no longer touch versions.md, the deps lane can", () => {
    const r = makeRepo({ "docs/ownership.md": realRules, "docs/versions.md": "# Pinned versions\n" });
    r.git("checkout", "-q", "-b", "ws/qa");
    r.write("docs/versions.md", "# Pinned versions\n| `left-pad` | 1.3.0 |\n");
    r.commit("sneak a pin");
    expect(loadOwnership({ repo: r.dir, ref: r.mainSha }).bootstrap).toBe(false);
    expect(quietMain(ci(r, "ws/qa")).code).toBe(1);
    r.git("checkout", "-q", "-b", "deps/left-pad");
    expect(quietMain(ci(r, "deps/left-pad")).code).toBe(0);
  });

  // The ownership step of .github/workflows/ci.yml itself, run the way GitHub runs a step with no `shell:`
  // (`bash -e {0}`). Stub checkers print which copy ran, so the test sees the step's choice directly.
  const bash = findBash();
  const stub = (who) => `console.log(${JSON.stringify(who)}, process.argv.slice(2).join(" "));\n`;
  function runStep(r, baseSha) {
    const runnerTemp = mkdtempSync(join(base, "runner-"));
    const script = join(runnerTemp, "ownership-step.sh");
    writeFileSync(script, ownershipStepScript());
    const env = { ...process.env };
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
    env[pathKey] = `${dirname(process.execPath)}${delimiter}${env[pathKey] ?? ""}`;
    Object.assign(env, {
      BASE_SHA: baseSha,
      EVENT_NAME: "pull_request",
      GITHUB_REF_NAME: "1/merge",
      GITHUB_HEAD_REF: "ws/qa",
      GITHUB_WORKSPACE: posix(r.dir),
      RUNNER_TEMP: posix(runnerTemp),
    });
    const res = spawnSync(bash, ["--noprofile", "--norc", "-e", posix(script)], {
      cwd: r.dir,
      env,
      encoding: "utf8",
    });
    return { code: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}${res.error?.message ?? ""}` };
  }

  it("the CI step finds its run script in ci.yml", () => {
    const step = ownershipStepScript();
    expect(step).toMatch(/git ls-tree --full-tree "\$BASE_SHA" -- tools\/check-ownership\.mjs/);
    expect(step).not.toMatch(/cat-file -e/);
    expect(step).toMatch(/--ownership-ref "\$BASE_SHA" --strict/);
  });

  it.skipIf(!bash)("the CI step runs the base's checker whenever the base has one", () => {
    const r = makeRepo({ "docs/ownership.md": realRules, "tools/check-ownership.mjs": stub("BASE-CHECKER") });
    r.git("checkout", "-q", "-b", "ws/qa");
    r.write("tools/check-ownership.mjs", stub("HEAD-CHECKER"));
    r.commit("swap in a checker that passes everything");
    const run = runStep(r, r.mainSha);
    expect(run.code, run.out).toBe(0);
    expect(run.out).toContain(`BASE-CHECKER --repo ${posix(r.dir)} --base ${r.mainSha}`);
    expect(run.out).toContain(`--ownership-ref ${r.mainSha} --strict`);
    expect(run.out).not.toContain("HEAD-CHECKER");
  });

  it.skipIf(!bash)(
    "the CI step runs the head copy only when ls-tree confirms the base has no checker",
    () => {
      const r = makeRepo({ "docs/ownership.md": realRules });
      r.git("checkout", "-q", "-b", "ws/qa");
      r.write("tools/check-ownership.mjs", stub("HEAD-CHECKER"));
      r.commit("add the checker");
      const run = runStep(r, r.mainSha);
      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain("HEAD-CHECKER");
      expect(run.out).toMatch(/::warning::Base \w+ has no tools\/check-ownership\.mjs/);
    },
  );

  it.skipIf(!bash)("the CI step fails closed on any other git outcome instead of using the head copy", () => {
    // A missing tree object (corrupt or partial clone): ls-tree cannot tell whether the checker is there.
    const corrupt = makeRepo({ "tools/check-ownership.mjs": stub("BASE-CHECKER") });
    const toolsTree = corrupt.git("rev-parse", `${corrupt.mainSha}:tools`);
    corrupt.git("checkout", "-q", "-b", "ws/qa");
    corrupt.write("tools/check-ownership.mjs", stub("HEAD-CHECKER"));
    corrupt.commit("swap the checker");
    const object = join(corrupt.dir, ".git", "objects", toolsTree.slice(0, 2), toolsTree.slice(2));
    chmodSync(object, 0o644);
    rmSync(object);
    // A checker path that is a directory in the base, not a regular file.
    const dir = makeRepo({ "tools/check-ownership.mjs/index.mjs": stub("BASE-CHECKER") });
    dir.git("checkout", "-q", "-b", "ws/qa");
    rmSync(join(dir.dir, "tools/check-ownership.mjs"), { recursive: true, force: true });
    dir.write("tools/check-ownership.mjs", stub("HEAD-CHECKER"));
    dir.commit("replace the directory");

    for (const [name, r, sha] of [
      ["missing tree object", corrupt, corrupt.mainSha],
      ["directory in the base", dir, dir.mainSha],
      ["unknown commit", dir, "0123456789abcdef0123456789abcdef01234567"],
      ["empty base", dir, ""],
    ]) {
      const run = runStep(r, sha);
      expect(run.code, `${name}: ${run.out}`).not.toBe(0);
      expect(run.out, name).not.toMatch(/HEAD-CHECKER|BASE-CHECKER|::warning::/);
    }
  });
});

/** Forward slashes for bash and node on Windows (C:\x\y -> C:/x/y); unchanged elsewhere. */
const posix = (p) => p.replace(/\\/g, "/");

/**
 * bash to run the workflow step with, or null. On Windows the bash on PATH may be WSL's launcher, so use the
 * bash that ships with Git for Windows (<git>/mingw64/libexec/git-core -> <git>/bin/bash.exe).
 */
function findBash() {
  if (process.platform !== "win32") return "bash";
  try {
    const gitCore = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
    const gitRoot = resolve(gitCore, "../../..");
    return (
      [join(gitRoot, "bin", "bash.exe"), join(gitRoot, "usr", "bin", "bash.exe")].find(existsSync) ?? null
    );
  } catch {
    return null;
  }
}

/** The `run: |` body of ci.yml's "Ownership path check" step, de-indented. */
function ownershipStepScript() {
  const lines = readFileSync(resolve(repoRoot, ".github/workflows/ci.yml"), "utf8")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const start = lines.findIndex((l) => /^\s+- name: Ownership path check/.test(l));
  const next = lines.findIndex((l, i) => i > start && /^\s+- name: /.test(l));
  const runAt = lines.findIndex((l, i) => i > start && /^\s+run: \|$/.test(l));
  if (start === -1 || runAt === -1 || (next !== -1 && runAt > next)) {
    throw new Error("ci.yml: no run block in the Ownership path check step");
  }
  const indent = lines[runAt].search(/\S/) + 2;
  const body = [];
  for (let i = runAt + 1; i < lines.length; i++) {
    if (lines[i].trim() !== "" && lines[i].search(/\S/) < indent) break;
    body.push(lines[i].slice(indent));
  }
  return `${body.join("\n").trimEnd()}\n`;
}
