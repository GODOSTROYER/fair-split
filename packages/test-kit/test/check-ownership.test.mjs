// Unit tests for tools/check-ownership.mjs (WS-QA owns both). They run against the real docs/ownership.md.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkChanges,
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
  it("lists all thirteen workstreams from register section 11", () => {
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

describe("CI mode: a PR is judged by its base's rules", () => {
  // Throwaway git repositories inside this worktree's gitignored node_modules.
  const base = resolve(repoRoot, "packages/test-kit/node_modules/.cache/ownership-repos");
  const hooks = resolve(base, "no-hooks");
  mkdirSync(hooks, { recursive: true });
  const repos = [];
  afterAll(() => {
    for (const r of repos) rmSync(r, { recursive: true, force: true });
  });

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
    repos.push(dir);
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

  it("rejects a ws/core PR that adds packages/db/** to its own WS-CORE row", () => {
    const r = makeRepo({ "docs/ownership.md": realRules });
    r.git("checkout", "-q", "-b", "ws/core");
    const coreRow = "`packages/contracts`, `packages/domain`, `packages/seed`";
    expect(realRules).toContain(coreRow);
    r.write(
      "docs/ownership.md",
      realRules.replace(coreRow, `${coreRow}, \`packages/db/**\`, \`docs/ownership.md\``),
    );
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

  it("bootstrap: with no machine-readable rules on the base, WS-QA may install the stack, others may not", () => {
    const r = makeRepo({
      "docs/ownership.md": "# Path ownership\n\n| WS | Owned paths |\n| -- | -- |\n| WS-QA | docs |\n",
    });
    r.git("checkout", "-q", "-b", "ws/qa");
    r.write("docs/ownership.md", realRules);
    r.write("docs/versions.md", "# Pinned versions\n");
    r.write("pnpm-lock.yaml", "lockfileVersion: 9\n");
    r.commit("bootstrap");
    expect(loadOwnership({ repo: r.dir, ref: r.mainSha }).bootstrap).toBe(true);
    expect(quietMain(ci(r, "ws/qa")).code).toBe(0);

    r.git("checkout", "-q", "-b", "ws/data", r.mainSha);
    r.write("docs/ownership.md", realRules);
    r.write("pnpm-lock.yaml", "lockfileVersion: 9\n");
    r.write("packages/db/src/schema.ts", "export {};\n");
    r.commit("not mine");
    expect(quietMain(ci(r, "ws/data")).code).toBe(1);
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
});
