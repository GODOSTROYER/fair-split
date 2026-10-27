// Unit tests for tools/check-ownership.mjs and for .github/workflows/ownership.yml, the workflow that runs it on
// GitHub (WS-QA owns all three). They run against the real docs/ownership.md.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  CHECKER_FILE,
  caseCollisions,
  checkChanges,
  GATE_FILES,
  GATE_WORKFLOW_FILE,
  globToRegExp,
  isGateFile,
  loadOwnership,
  main,
  matchPath,
  OWNERSHIP_FILE,
  owns,
  parseArgs,
  parseNameStatus,
  parseNameStatusZ,
  parseOwnership,
  workstreamFromBranch,
} from "../../../tools/check-ownership.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const readText = (rel) => readFileSync(resolve(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");
const realRules = readText(OWNERSHIP_FILE);
const ownership = parseOwnership(realRules);
const edit = (...paths) => paths.map((path) => ({ status: "M", path }));
/** The approval token the checker prints for a pending change to the gate's files. */
const tokenIn = (out) => /--approve-gate-change ([0-9a-f]{16})/.exec(out)?.[1];

// Throwaway git repositories in the OS temp dir, never under packages/: deps:check (dependency-rules.test.mjs)
// walks packages/** in parallel and fails with ENOENT when it meets a repo that a test here just deleted.
const tmpBase = mkdtempSync(join(tmpdir(), "fs-ownership-repos-"));
const hooks = join(tmpBase, "no-hooks");
mkdirSync(hooks, { recursive: true });
afterAll(() => rmSync(tmpBase, { recursive: true, force: true }));

/** A repo whose main holds README.md plus `baseFiles`. */
function makeRepo(baseFiles) {
  const dir = mkdtempSync(join(tmpBase, "repo-"));
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
  /** Commits exactly what is staged (no `add -A`), for trees the working copy cannot hold. */
  const commitIndex = (msg) => {
    git("commit", "-q", "--allow-empty", "-m", msg);
    return git("rev-parse", "HEAD");
  };
  const commit = (msg) => {
    git("add", "-A");
    return commitIndex(msg);
  };
  /**
   * Stages `rel` straight into the index. A Windows or macOS working copy cannot hold
   * `apps/api/src/Webhooks/x.ts` next to `apps/api/src/webhooks/`, but a commit made on Linux can.
   */
  const stage = (rel, text) => {
    const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: dir,
      input: text,
      encoding: "utf8",
    });
    git("update-index", "--add", "--cacheinfo", `100644,${blob.trim()},${rel}`);
  };
  git("init", "-q", "-b", "main");
  write("README.md", "fixture\n");
  for (const [rel, text] of Object.entries(baseFiles)) write(rel, text);
  const mainSha = commit("base");
  return { dir, git, write, commit, commitIndex, stage, mainSha };
}

/** Runs main() with console output captured: { code, out }. */
function quietMain(args, env = {}) {
  const { log, error, warn } = console;
  const lines = [];
  const capture = (m) => lines.push(String(m));
  console.log = capture;
  console.error = capture;
  console.warn = capture;
  try {
    return { code: main(args, env), out: lines.join("\n") };
  } finally {
    Object.assign(console, { log, error, warn });
  }
}

/**
 * A branch with two best merge bases against main, made on purpose. main = merge(p1, p2), where p2 is WS-PPCORE's
 * branch. ws/api starts at p1 and merges p2 with `-s ours` (p2's history, p1's tree), then adds an owned route.
 * `git diff main...ws/api` diffs from one merge base and shows only the route; `git merge` merges against a
 * virtual base built from both, so it silently reverts WS-PPCORE's merged files. main is checked out at the end.
 */
function crissCross() {
  const r = makeRepo({ "docs/ownership.md": realRules, [CHECKER_FILE]: readText(CHECKER_FILE) });
  r.git("checkout", "-q", "-b", "ws/ppcore");
  r.write("apps/api/src/webhooks/security.ts", "export const hardened = true;\n");
  r.write("packages/paypal-core/src/webhook/verify.ts", "export const verify = 'hardened';\n");
  const p2 = r.commit("harden the webhooks");
  r.git("checkout", "-q", "main");
  r.write("docs/notes.md", "main moves on\n");
  const p1 = r.commit("main moves on");
  r.git("merge", "-q", "--no-ff", "-m", "merge: ws/ppcore", "ws/ppcore");
  const main2 = r.git("rev-parse", "HEAD");
  r.git("checkout", "-q", "-b", "ws/api", p1);
  r.git("merge", "-q", "-s", "ours", "-m", "take ws/ppcore's history, not its tree", "ws/ppcore");
  r.write("apps/api/src/routes/ping.ts", "export {};\n");
  const attack = r.commit("an owned route");
  r.git("checkout", "-q", "main");
  return { r, p1, p2, main2, attack };
}

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

  it("ignores letter case, as Windows and macOS checkouts do", () => {
    expect(matchPath("apps/api/src/webhooks/**", "apps/api/src/Webhooks/paypal.ts")).toBe(true);
    expect(matchPath("README.md", "readme.MD")).toBe(true);
    expect(matchPath("packages/domain", "Packages/Domain/src/x.ts")).toBe(true);
    expect(matchPath("packages/domain", "Packages/DomainX/src/x.ts")).toBe(false);
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

  it("keeps every exception for a path spelled in another letter case", () => {
    expect(owns(ownership, "WS-API", "apps/api/src/Webhooks/paypal.ts")).toBe(false);
    expect(owns(ownership, "WS-PPCORE", "apps/api/src/Webhooks/paypal.ts")).toBe(true);
    expect(owns(ownership, "WS-CONSOLE", "apps/console/src/Prototype/Slab.tsx")).toBe(false);
    expect(owns(ownership, "WS-OPS", "tools/Check-Ownership.mjs")).toBe(false);
    expect(owns(ownership, "WS-QA", "Docs/Spec/02-architecture.md")).toBe(false);
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
    expect(workstreamFromBranch("")).toBeNull();
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

  it("refuses a deletion, rename or type change of the gate's files for every lane, approved or not", () => {
    expect(GATE_FILES).toEqual([OWNERSHIP_FILE, CHECKER_FILE, GATE_WORKFLOW_FILE]);
    expect(GATE_WORKFLOW_FILE).toBe(".github/workflows/ownership.yml");
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
            for (const gateChangeApproved of [false, true]) {
              const r = checkChanges(ownership, ws, changes, { bootstrap, gateChangeApproved });
              const gate = r.violations.find((v) => v.path === file);
              expect(r.ok, `${ws} ${how} ${file}`).toBe(false);
              expect(gate?.reason, `${ws} ${how} ${file}`).toMatch(/may not be deleted, renamed or retyped/);
            }
          }
        }
      }
    }
  });

  it("lets WS-QA change a gate file only with the merger's approval, and no other lane at all", () => {
    for (const file of GATE_FILES) {
      for (const status of ["M", "A"]) {
        const changes = [{ status, path: file }];
        const pending = checkChanges(ownership, "WS-QA", changes);
        expect(pending.ok, file).toBe(false);
        expect(pending.violations).toEqual([
          {
            path: file,
            status,
            reason: expect.stringMatching(/merger approves exactly this version/),
            gate: true,
          },
        ]);
        expect(checkChanges(ownership, "WS-QA", changes, { gateChangeApproved: true }).ok, file).toBe(true);
        for (const ws of ["WS-OPS", "WS-API", "WS-CORE", "deps"]) {
          const r = checkChanges(ownership, ws, changes, { gateChangeApproved: true });
          expect(r.ok, `${ws} ${file}`).toBe(false);
          expect(r.violations[0].gate, `${ws} ${file}`).toBeUndefined();
        }
      }
    }
    // A gate file spelled in another letter case is still a gate file.
    expect(isGateFile("TOOLS/Check-Ownership.mjs")).toBe(true);
    expect(isGateFile("docs/ownership.md.bak")).toBe(false);
    expect(checkChanges(ownership, "WS-QA", edit(".GitHub/workflows/Ownership.yml")).violations[0].gate).toBe(
      true,
    );
    // ci.yml is not part of the gate: WS-QA edits it like any file it owns, and no other lane can.
    expect(checkChanges(ownership, "WS-QA", edit(".github/workflows/ci.yml")).ok).toBe(true);
    expect(checkChanges(ownership, "WS-API", edit(".github/workflows/ci.yml")).ok).toBe(false);
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

describe("parseNameStatusZ", () => {
  it("reads NUL-separated entries, so tabs, newlines and non-ASCII names arrive as committed", () => {
    const z = [
      ...["M", "README.md"],
      ...["R087", "packages/db/a\tb.ts", "packages/domain/a\tb.ts"],
      ...["A", "docs/caf\u00e9\n.md"],
      ...["C100", "docs/x.md", "docs/y.md"],
      "",
    ].join("\0");
    expect(parseNameStatusZ(z)).toEqual([
      { status: "M", path: "README.md" },
      { status: "D", path: "packages/db/a\tb.ts" },
      { status: "R", path: "packages/domain/a\tb.ts" },
      { status: "A", path: "docs/caf\u00e9\n.md" },
      { status: "A", path: "docs/y.md" },
    ]);
    expect(parseNameStatusZ("")).toEqual([]);
  });

  it("rejects a truncated or unknown entry", () => {
    expect(() => parseNameStatusZ("R100\0only-one-path\0")).toThrow(/Unreadable/);
    expect(() => parseNameStatusZ("M\0")).toThrow(/Unreadable/);
    expect(() => parseNameStatusZ("README.md\0")).toThrow(/Unreadable/);
  });
});

describe("caseCollisions", () => {
  const tree = ["README.md", "apps/api/src/webhooks/paypal.ts", "apps/api/src/Webhooks/x.ts"];

  it("flags a changed path that differs from another path or folder only in letter case", () => {
    const v = caseCollisions(tree, [{ status: "A", path: "apps/api/src/Webhooks/x.ts" }]);
    expect(v).toHaveLength(1);
    expect(v[0].reason).toMatch(
      /^apps\/api\/src\/Webhooks differs only in letter case from apps\/api\/src\/webhooks;/,
    );
    expect(caseCollisions(["README.md", "readme.md"], edit("readme.md"))[0].reason).toMatch(
      /^readme\.md differs only in letter case from README\.md;/,
    );
  });

  it("lets deletions, a case-only rename and ordinary paths through", () => {
    expect(caseCollisions(["Readme.md"], parseNameStatus("R100\tREADME.md\tReadme.md"))).toEqual([]);
    expect(caseCollisions(tree, [{ status: "D", path: "apps/api/src/Webhooks/x.ts" }])).toEqual([]);
    expect(caseCollisions(["README.md", "apps/api/src/webhooks/paypal.ts"], edit("README.md"))).toEqual([]);
  });
});

describe("CLI", () => {
  it("exits 0 for owned files and 1 otherwise", () => {
    expect(quiet(() => main(["--ws", "qa", "README.md"], {}))).toBe(0);
    expect(quiet(() => main(["--branch", "ws/qa", "packages/domain/src/x.ts"], {}))).toBe(1);
  });

  it("reads the branch from GITHUB_HEAD_REF and skips non-workstream branches", () => {
    expect(quiet(() => main(["packages/db/src/x.ts"], { GITHUB_HEAD_REF: "ws/data" }))).toBe(0);
    expect(quiet(() => main(["anything"], { GITHUB_REF_NAME: "main" }))).toBe(0);
    expect(quiet(() => main(["--strict", "anything"], { GITHUB_REF_NAME: "main" }))).toBe(1);
  });

  it("falls back to GITHUB_REF_NAME when GITHUB_HEAD_REF is empty, as GitHub exports it on a push", () => {
    const push = (ref, file) =>
      quietMain(["--strict", file], { GITHUB_HEAD_REF: "", GITHUB_REF_NAME: ref, GITHUB_EVENT_NAME: "push" });
    const ok = push("ws/data", "packages/db/src/x.ts");
    expect(ok.code, ok.out).toBe(0);
    expect(ok.out).toContain("all within WS-DATA");
    expect(push("ws/core", "packages/db/src/x.ts").code).toBe(1);
    expect(push("", "packages/db/src/x.ts").out).toContain('branch "(none)" is not ws/<id> or deps/*');
  });

  it("refuses --head without --base, and an approval that is not a printed token or has no commit", () => {
    expect(() => parseArgs(["--head", "HEAD"])).toThrow(/--head needs --base/);
    expect(() => parseArgs(["--base", "main", "--approve-gate-change", "yes"])).toThrow(/16-hex-digit/);
    expect(quiet(() => main(["--head", "HEAD", "README.md"], {}))).toBe(1);
    const noCommit = quietMain(["--ws", "qa", "--approve-gate-change", "0123456789abcdef", OWNERSHIP_FILE]);
    expect(noCommit.code).toBe(1);
    expect(noCommit.out).toMatch(/needs --base/);
    // Without --base a gate change can be reported but never approved.
    const listed = quietMain(["--ws", "qa", OWNERSHIP_FILE]);
    expect(listed.code).toBe(1);
    expect(listed.out).toMatch(/rerun with --base/);
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
describe("--base mode: a PR is judged by its base's rules", { timeout: 60_000 }, () => {
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
    expect(judged.out).toContain("M docs/ownership.md: not owned by WS-CORE");
    expect(judged.out).toContain(`rules from ${r.mainSha}:docs/ownership.md`);

    // Control: judged by the PR's own widened rules, the same diff would have passed once the merger approved
    // the rules change. Judged by the base's rules, no approval helps.
    const selfJudged = quietMain([...ci(r, "ws/core"), "--ownership-ref", "HEAD"]);
    expect(selfJudged.code).toBe(1);
    const token = tokenIn(selfJudged.out);
    expect(token).toMatch(/^[0-9a-f]{16}$/);
    expect(
      quietMain([...ci(r, "ws/core"), "--ownership-ref", "HEAD", "--approve-gate-change", token]).code,
    ).toBe(0);
    expect(quietMain([...ci(r, "ws/core"), "--approve-gate-change", token]).code).toBe(1);
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
    const pending = quietMain(ci(r, "ws/qa"));
    expect(pending.out).toMatch(/bootstrap/);
    expect(pending.code).toBe(1); // the rules are a gate file: the merger approves them
    expect(pending.out).toContain("A docs/ownership.md: the ownership gate's own file");
    expect(pending.out).not.toMatch(/docs\/versions\.md|pnpm-lock\.yaml/);
    const judged = quietMain([...ci(r, "ws/qa"), "--approve-gate-change", tokenIn(pending.out)]);
    expect(judged.code, judged.out).toBe(0);

    r.git("checkout", "-q", "-b", "ws/data", r.mainSha);
    r.write("docs/ownership.md", realRules);
    r.write("pnpm-lock.yaml", "lockfileVersion: 9\n");
    r.write("packages/db/src/schema.ts", "export {};\n");
    r.commit("not mine");
    expect(quietMain(ci(r, "ws/data")).code).toBe(1);
  });

  it("bootstrap judges by the judged commit's own rules, not the working tree's", () => {
    const r = makeRepo({});
    r.git("checkout", "-q", "-b", "ws/qa");
    r.write("docs/ownership.md", realRules);
    r.write("docs/versions.md", "# Pinned versions\n");
    const pr = r.commit("bootstrap");
    r.git("checkout", "-q", "main"); // as the gate job has it: the base checked out, the PR's head fetched
    expect(existsSync(join(r.dir, "docs/ownership.md"))).toBe(false);
    const args = ["--branch", "ws/qa", "--base", r.mainSha, "--head", pr, "--repo", r.dir, "--strict"];
    const pending = quietMain(args);
    expect(pending.code).toBe(1);
    expect(pending.out).toContain(`rules from ${pr}:docs/ownership.md (bootstrap`);
    const approved = quietMain([...args, "--approve-gate-change", tokenIn(pending.out)]);
    expect(approved.code, approved.out).toBe(0);

    // The judged commit's copy must parse: a malformed one fails closed instead of falling back.
    r.git("checkout", "-q", "-B", "ws/qa", r.mainSha);
    r.write("docs/ownership.md", proseRules);
    const broken = r.commit("prose rules");
    r.git("checkout", "-q", "main");
    const judged = quietMain(["--branch", "ws/qa", "--base", r.mainSha, "--head", broken, "--repo", r.dir]);
    expect(judged.code).toBe(1);
    expect(judged.out).toMatch(/malformed.*failing closed/);
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
    // No approval covers a deletion.
    const forced = quietMain([...ci(r, "ws/qa"), "--approve-gate-change", "0123456789abcdef"]);
    expect(forced.code).toBe(1);
    expect(forced.out).toContain(
      "D tools/check-ownership.mjs: the ownership gate's files may not be deleted",
    );
  });

  it("a change to a gate file lands only with the merger's approval of exactly that version", () => {
    const r = makeRepo({ "docs/ownership.md": realRules, "tools/check-ownership.mjs": "// the checker\n" });
    r.git("checkout", "-q", "-b", "ws/qa");
    r.write("tools/check-ownership.mjs", "// passes everything\n");
    r.commit("neuter the checker");
    const pending = quietMain(ci(r, "ws/qa"));
    expect(pending.code).toBe(1);
    expect(pending.out).toContain("M tools/check-ownership.mjs: the ownership gate's own file");
    expect(pending.out).toContain("CI cannot approve, and workstream agents never pass this flag");
    const token = tokenIn(pending.out);
    expect(token).toMatch(/^[0-9a-f]{16}$/);
    const approved = quietMain([...ci(r, "ws/qa"), "--approve-gate-change", token]);
    expect(approved.code, approved.out).toBe(0);
    expect(approved.out).toContain(`gate change ${token} approved`);

    // One more edit after the review: the old approval no longer covers it.
    r.write("tools/check-ownership.mjs", "// passes everything, and then some\n");
    r.commit("edit after the review");
    const stale = quietMain([...ci(r, "ws/qa"), "--approve-gate-change", token]);
    expect(stale.code).toBe(1);
    expect(stale.out).toContain(`The approval given (${token}) is for a different version of these files`);
    expect(tokenIn(stale.out)).not.toBe(token);

    // An approval never stretches to paths outside the workstream.
    r.write("packages/domain/src/x.ts", "export {};\n");
    r.commit("and a stray file");
    const stray = quietMain(ci(r, "ws/qa"));
    const strayApproved = quietMain([...ci(r, "ws/qa"), "--approve-gate-change", tokenIn(stray.out)]);
    expect(strayApproved.code).toBe(1);
    expect(strayApproved.out).toContain("A packages/domain/src/x.ts: not owned by WS-QA (owned by WS-CORE)");
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
    expect(run("--base", r.mainSha, "--head", "--output=diff.txt").code).toBe(1);
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

  it("refuses a path that differs from another only in letter case", () => {
    const r = makeRepo({ "docs/ownership.md": realRules, "apps/api/src/webhooks/paypal.ts": "export {};\n" });
    r.git("checkout", "-q", "-b", "ws/api");
    r.stage("apps/api/src/Webhooks/paypal.ts", "export const forged = 1;\n");
    r.commitIndex("a second webhooks folder, as a Linux checkout can hold it");
    const judged = quietMain(ci(r, "ws/api"));
    expect(judged.code).toBe(1);
    expect(judged.out).toContain(
      "A apps/api/src/Webhooks/paypal.ts: not owned by WS-API (owned by WS-PPCORE)",
    );
    expect(judged.out).toMatch(
      /apps\/api\/src\/Webhooks differs only in letter case from apps\/api\/src\/webhooks/,
    );

    // A case-only rename of a file the workstream owns is fine: the tree then holds one spelling.
    const q = makeRepo({ "docs/ownership.md": realRules });
    q.git("checkout", "-q", "-b", "ws/qa");
    q.git("mv", "README.md", "Readme.md");
    q.commitIndex("rename");
    const renamed = quietMain(ci(q, "ws/qa"));
    expect(renamed.code, renamed.out).toBe(0);
  });

  it("fails closed when base and head have more than one merge base: the merge would revert another lane", () => {
    const { r, p1, p2, main2, attack } = crissCross();
    const args = (head) => [
      "--branch",
      "ws/api",
      "--base",
      main2,
      "--head",
      head,
      "--repo",
      r.dir,
      "--strict",
    ];
    expect(r.git("merge-base", "--all", main2, attack).split("\n").sort()).toEqual([p1, p2].sort());
    // The trap: a diff from one merge base shows only the owned route...
    expect(r.git("diff", "--name-status", `${main2}...${attack}`)).toBe("A\tapps/api/src/routes/ping.ts");
    // ...while git merge, against a virtual base built from both, deletes WS-PPCORE's merged files.
    r.git("checkout", "-q", "-b", "trial", main2);
    r.git("merge", "-q", "--no-ff", "-m", "trial merge", attack);
    const merged = r.git("ls-tree", "-r", "--name-only", "HEAD").split("\n");
    r.git("checkout", "-q", "main");
    expect(merged).toContain("apps/api/src/routes/ping.ts");
    expect(merged).not.toContain("apps/api/src/webhooks/security.ts");
    expect(merged).not.toContain("packages/paypal-core/src/webhook/verify.ts");

    const judged = quietMain(args(attack));
    expect(judged.code).toBe(1);
    expect(judged.out).toMatch(/2 merge bases/);
    expect(judged.out).toContain(p1);
    expect(judged.out).toContain(p2);
    expect(judged.out).toMatch(/merge .* into the branch first/);
    expect(judged.out).not.toMatch(/all within/);

    // The remedy the message names: merge the base's tip into the branch. There is then one merge base, and
    // the revert shows as what it is.
    r.git("checkout", "-q", "ws/api");
    r.git("merge", "-q", "--no-edit", main2);
    const remerged = r.git("rev-parse", "HEAD");
    r.git("checkout", "-q", "main");
    expect(r.git("merge-base", "--all", main2, remerged)).toBe(main2);
    const caught = quietMain(args(remerged));
    expect(caught.code).toBe(1);
    expect(caught.out).toContain(
      "D apps/api/src/webhooks/security.ts: not owned by WS-API (owned by WS-PPCORE)",
    );
    expect(caught.out).toContain(
      "D packages/paypal-core/src/webhook/verify.ts: not owned by WS-API (owned by WS-PPCORE)",
    );

    // Control: an honest branch that merged main's tip and adds the same route passes.
    r.git("checkout", "-q", "-b", "ws/api-honest", p1);
    r.git("merge", "-q", "--no-edit", main2);
    r.write("apps/api/src/routes/ping.ts", "export {};\n");
    const honest = r.commit("an owned route, on top of main");
    r.git("checkout", "-q", "main");
    const ok = quietMain(args(honest));
    expect(ok.code, ok.out).toBe(0);
    expect(ok.out).toContain("1 changed path(s), all within WS-API");
  });

  it("judges the tree git merge would produce: a file the merge moves into another lane's folder", () => {
    const r = makeRepo({
      "docs/ownership.md": realRules,
      "apps/api/src/hooks/a.ts": "export const a = 1;\n",
      "apps/api/src/hooks/b.ts": "export const b = 2;\n",
    });
    r.git("checkout", "-q", "-b", "ws/api");
    r.write("apps/api/src/hooks/c.ts", "export const c = 3;\n");
    const pr = r.commit("a new file in a WS-API folder");
    r.git("checkout", "-q", "main");
    r.git("mv", "apps/api/src/hooks", "apps/api/src/webhooks");
    const main2 = r.commitIndex("main moves that folder under webhooks/ (WS-PPCORE)");
    // The branch's own diff names only its folder; git merge follows the directory rename and puts the new file
    // under apps/api/src/webhooks/, which WS-PPCORE owns.
    expect(r.git("diff", "--name-status", `${main2}...${pr}`)).toBe("A\tapps/api/src/hooks/c.ts");
    const judged = quietMain([
      "--branch",
      "ws/api",
      "--base",
      main2,
      "--head",
      pr,
      "--repo",
      r.dir,
      "--strict",
    ]);
    expect(judged.code).toBe(1);
    expect(judged.out).toContain("A apps/api/src/webhooks/c.ts: not owned by WS-API (owned by WS-PPCORE)");
    expect(judged.out).not.toContain("apps/api/src/hooks/c.ts:");
    expect(judged.out).toMatch(/conflicts? in 1 path/);
  });

  it("a conflict inside the branch's own paths is the merger's to resolve: judged, not refused", () => {
    const r = makeRepo({
      "docs/ownership.md": realRules,
      "apps/api/src/routes/x.ts": "export const x = 0;\n",
    });
    r.git("checkout", "-q", "-b", "ws/api");
    r.write("apps/api/src/routes/x.ts", "export const x = 1;\n");
    const pr = r.commit("branch edit");
    r.git("checkout", "-q", "main");
    r.write("apps/api/src/routes/x.ts", "export const x = 2;\n");
    const main2 = r.commit("main edit");
    const judged = quietMain([
      "--branch",
      "ws/api",
      "--base",
      main2,
      "--head",
      pr,
      "--repo",
      r.dir,
      "--strict",
    ]);
    expect(judged.code, judged.out).toBe(0);
    expect(judged.out).toContain("all within WS-API");
    expect(judged.out).toMatch(/conflicts? in 1 path.*apps\/api\/src\/routes\/x\.ts/s);
  });

  it("fails closed when the branch shares no history with the base", () => {
    const r = makeRepo({ "docs/ownership.md": realRules });
    r.git("checkout", "-q", "--orphan", "ws/api");
    r.git("rm", "-rqf", ".");
    r.write("apps/api/src/routes/ping.ts", "export {};\n");
    const pr = r.commit("unrelated history");
    r.git("checkout", "-q", "main");
    const judged = quietMain(["--branch", "ws/api", "--base", r.mainSha, "--head", pr, "--repo", r.dir]);
    expect(judged.code).toBe(1);
    expect(judged.out).toMatch(/share no history/);
    expect(judged.out).not.toMatch(/all within/);
  });

  it("reads paths NUL-separated: a non-ASCII name is not quoted into a path nobody owns", () => {
    const r = makeRepo({ "docs/ownership.md": realRules });
    r.git("checkout", "-q", "-b", "ws/qa");
    r.write("docs/caf\u00e9-notes.md", "# Notes\n");
    r.commit("a note");
    const judged = quietMain(ci(r, "ws/qa"));
    expect(judged.code, judged.out).toBe(0);
    // Control: git's default, quoted output (no -z) would have made it a path no workstream owns.
    const quoted = r.git("-c", "core.quotePath=true", "diff", "--name-status", `${r.mainSha}...HEAD`);
    expect(quoted).toContain('"docs/caf\\303\\251-notes.md"');
    expect(checkChanges(ownership, "WS-QA", parseNameStatus(quoted)).ok).toBe(false);
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

/** The lines of a top-level YAML key's block (`on`, `permissions`), without the key line. */
function topLevelBlock(text, key) {
  const lines = text.split("\n");
  const start = lines.indexOf(`${key}:`);
  if (start === -1) throw new Error(`no top-level ${key}: block`);
  const body = [];
  for (let i = start + 1; i < lines.length && !/^\S/.test(lines[i]); i++) body.push(lines[i]);
  return body.join("\n");
}

/** The lines of the step named `name`, up to the next step. */
function stepBlock(text, name) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  if (start === -1) throw new Error(`no step named ${name}`);
  const indent = lines[start].search(/\S/);
  const body = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() !== "" && lines[i].search(/\S/) <= indent) break;
    body.push(lines[i]);
  }
  return body.join("\n");
}

/** Every `run: |` body in a workflow, de-indented. */
function runBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  lines.forEach((l, at) => {
    if (!/^\s+run: \|$/.test(l)) return;
    const indent = l.search(/\S/) + 2;
    const body = [];
    for (let i = at + 1; i < lines.length; i++) {
      if (lines[i].trim() !== "" && lines[i].search(/\S/) < indent) break;
      body.push(lines[i].slice(indent));
    }
    blocks.push(`${body.join("\n").trimEnd()}\n`);
  });
  return blocks;
}

/** The `run: |` body of the step named `name`. */
function stepScript(text, name) {
  const [body] = runBlocks(stepBlock(text, name));
  if (!body) throw new Error(`step ${name} has no run block`);
  return body;
}

const withoutComments = (text) =>
  text
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

describe("the gate on GitHub: .github/workflows/ownership.yml", { timeout: 60_000 }, () => {
  const wf = readText(GATE_WORKFLOW_FILE);

  it("runs on pull_request_target only, with read-only rights, so GitHub takes it from main", () => {
    const on = topLevelBlock(wf, "on");
    expect(on).toMatch(/^ {2}pull_request_target:$/m);
    expect(on).toMatch(/^ {4}branches: \[main\]$/m);
    expect(on).not.toMatch(/^ {2}(pull_request|push|workflow_dispatch|workflow_run|merge_group|schedule):/m);
    expect(topLevelBlock(wf, "permissions").trim()).toBe("contents: read");
    expect(withoutComments(wf)).not.toMatch(/:\s*write\b|permissions:\s*write-all/);
  });

  it("checks out the default branch and never installs or runs the PR's code", () => {
    const checkout = stepBlock(wf, "Checkout the default branch (trusted code only)");
    expect(checkout).toMatch(/persist-credentials: false/);
    expect(checkout).not.toMatch(/^\s+(ref|repository):/m);
    expect(withoutComments(wf)).not.toMatch(/\b(pnpm|npm|npx|yarn|corepack)\b/);
    // Values from the event reach scripts only through env, never pasted into a script.
    for (const body of runBlocks(wf)) expect(body).not.toContain("${{");
    const fetch = stepScript(wf, "Fetch the PR's commits (data only, never checked out or run)");
    expect(fetch).toMatch(/fetch --no-tags --no-recurse-submodules/);
    expect(fetch).toContain('"+refs/pull/$PR_NUMBER/head:refs/remotes/pr/head"');
    const gate = stepScript(wf, "Ownership gate");
    expect(gate).toMatch(/git cat-file blob "\$base:tools\/check-ownership\.mjs" > "\$checker"/);
    expect(gate).toMatch(/--branch "\$PR_HEAD_REF"/);
    expect(gate).toMatch(/--base "\$base" --head "\$PR_HEAD_SHA" --ownership-ref "\$base" --strict/);
  });

  it("ci.yml runs no ownership check: on pull_request it is the PR's own copy, which the PR could edit", () => {
    const ciYml = withoutComments(readText(".github/workflows/ci.yml"));
    expect(ciYml).not.toMatch(/check-ownership|ownership:check/);
    expect(ciYml).toMatch(/^ {2}pull_request:$/m);
  });

  // The gate step itself, run the way GitHub runs a step with no `shell:` (`bash -e {0}`), in a repository laid
  // out like the job's: the default branch checked out, the PR's commits present as objects.
  const bash = findBash();
  const stub = (who) => `console.log(${JSON.stringify(who)}, process.argv.slice(2).join(" "));\n`;
  function runGate(r, headSha, headRef, extraEnv = {}) {
    const runnerTemp = mkdtempSync(join(tmpBase, "runner-"));
    const script = join(runnerTemp, "ownership-gate.sh");
    writeFileSync(script, stepScript(wf, "Ownership gate"));
    const env = { ...process.env };
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
    env[pathKey] = `${dirname(process.execPath)}${delimiter}${env[pathKey] ?? ""}`;
    Object.assign(env, {
      PR_HEAD_SHA: headSha,
      PR_HEAD_REF: headRef,
      PR_HEAD_REPO: "fairsplit/fair-split",
      GITHUB_REPOSITORY: "fairsplit/fair-split",
      GITHUB_WORKSPACE: posix(r.dir),
      RUNNER_TEMP: posix(runnerTemp),
      // pull_request_target sets these from the PR too; the gate must judge by PR_HEAD_REF alone.
      GITHUB_HEAD_REF: "ws/qa",
      GITHUB_REF_NAME: "main",
      ...extraEnv,
    });
    const res = spawnSync(bash, ["--noprofile", "--norc", "-e", posix(script)], {
      cwd: r.dir,
      env,
      encoding: "utf8",
    });
    return { code: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}${res.error?.message ?? ""}` };
  }

  it.skipIf(!bash)("runs main's checker with main's rules, never the PR's copy", () => {
    const r = makeRepo({ "docs/ownership.md": realRules, [CHECKER_FILE]: stub("BASE-CHECKER") });
    r.git("checkout", "-q", "-b", "ws/qa");
    r.write(CHECKER_FILE, stub("HEAD-CHECKER"));
    const pr = r.commit("swap in a checker that passes everything");
    r.git("checkout", "-q", "main");
    const run = runGate(r, pr, "ws/qa");
    expect(run.code, run.out).toBe(0);
    expect(run.out).toContain(
      `BASE-CHECKER --repo ${posix(r.dir)} --branch ws/qa --base ${r.mainSha} --head ${pr} ` +
        `--ownership-ref ${r.mainSha} --strict`,
    );
    expect(run.out).not.toContain("HEAD-CHECKER");
  });

  it.skipIf(!bash)("fails closed when main has no checker: a PR's own copy never runs", () => {
    const r = makeRepo({ "docs/ownership.md": realRules });
    r.git("checkout", "-q", "-b", "ws/core");
    r.write(CHECKER_FILE, stub("HEAD-CHECKER"));
    r.write("apps/api/src/webhooks/paypal.ts", "export {};\n");
    const pr = r.commit("bring my own checker and take WS-PPCORE's webhooks");
    r.git("checkout", "-q", "main");
    const run = runGate(r, pr, "ws/core");
    expect(run.code).not.toBe(0);
    expect(run.out).toMatch(/has no tools\/check-ownership\.mjs as a regular file; failing closed/);
    expect(run.out).not.toContain("HEAD-CHECKER");
  });

  it.skipIf(!bash)("fails closed on a missing tree object or a checker that is not a regular file", () => {
    // A missing tree object (corrupt or partial clone): ls-tree cannot tell whether the checker is there.
    const corrupt = makeRepo({ [CHECKER_FILE]: stub("BASE-CHECKER") });
    const toolsTree = corrupt.git("rev-parse", `${corrupt.mainSha}:tools`);
    corrupt.git("checkout", "-q", "-b", "ws/qa");
    corrupt.write(CHECKER_FILE, stub("HEAD-CHECKER"));
    const corruptPr = corrupt.commit("swap the checker");
    corrupt.git("checkout", "-q", "main");
    const object = join(corrupt.dir, ".git", "objects", toolsTree.slice(0, 2), toolsTree.slice(2));
    chmodSync(object, 0o644);
    rmSync(object);
    // A checker path that is a directory on main, not a regular file.
    const dir = makeRepo({ "tools/check-ownership.mjs/index.mjs": stub("BASE-CHECKER") });
    dir.git("checkout", "-q", "-b", "ws/qa");
    rmSync(join(dir.dir, CHECKER_FILE), { recursive: true, force: true });
    dir.write(CHECKER_FILE, stub("HEAD-CHECKER"));
    const dirPr = dir.commit("replace the directory");
    dir.git("checkout", "-q", "main");

    for (const [name, r, pr] of [
      ["missing tree object", corrupt, corruptPr],
      ["directory on main", dir, dirPr],
    ]) {
      const run = runGate(r, pr, "ws/qa");
      expect(run.code, `${name}: ${run.out}`).not.toBe(0);
      expect(run.out, name).not.toMatch(/HEAD-CHECKER|BASE-CHECKER/);
    }
  });

  it.skipIf(!bash)("refuses a fork's PR and a head commit that was not fetched", () => {
    const r = makeRepo({ "docs/ownership.md": realRules, [CHECKER_FILE]: stub("BASE-CHECKER") });
    r.git("checkout", "-q", "-b", "ws/qa");
    r.write("README.md", "edited\n");
    const pr = r.commit("docs");
    r.git("checkout", "-q", "main");
    const fork = runGate(r, pr, "ws/qa", { PR_HEAD_REPO: "someone/fair-split" });
    expect(fork.code).toBe(1);
    expect(fork.out).toMatch(/A fork's branch name says nothing about its workstream/);
    const missing = runGate(r, "0123456789abcdef0123456789abcdef01234567", "ws/qa");
    expect(missing.code).toBe(1);
    expect(missing.out).toMatch(/is not among the fetched commits/);
    for (const run of [fork, missing]) expect(run.out).not.toContain("BASE-CHECKER");
  });

  it.skipIf(!bash)(
    "with main's real checker: a ws/api PR cannot take .github or other lanes' paths, and WS-QA cannot switch the gate off",
    () => {
      const r = makeRepo({
        "docs/ownership.md": realRules,
        [CHECKER_FILE]: readText(CHECKER_FILE),
        [GATE_WORKFLOW_FILE]: wf,
        ".github/workflows/ci.yml": "name: ci\n",
      });
      r.git("checkout", "-q", "-b", "ws/api");
      r.write(".github/workflows/ci.yml", "name: ci\n# the ownership step, removed\n");
      r.write("apps/api/src/routes/health.ts", "export {};\n");
      r.write("packages/domain/src/sneak.ts", "export {};\n");
      const stray = r.commit("stray");
      r.git("checkout", "-q", "-b", "ws/qa", r.mainSha);
      r.write(GATE_WORKFLOW_FILE, "name: ownership\non: pull_request_target\njobs: {}\n");
      const neutered = r.commit("switch the gate off");
      r.git("checkout", "-q", "-b", "qa-delete", r.mainSha);
      rmSync(join(r.dir, GATE_WORKFLOW_FILE));
      const deleted = r.commit("delete the gate");
      r.git("checkout", "-q", "-b", "qa-docs", r.mainSha);
      r.write("README.md", "edited by WS-QA\n");
      const docs = r.commit("docs");
      r.git("checkout", "-q", "main");

      const api = runGate(r, stray, "ws/api");
      expect(api.code).toBe(1);
      expect(api.out).toContain("M .github/workflows/ci.yml: not owned by WS-API (owned by WS-QA)");
      expect(api.out).toContain("A packages/domain/src/sneak.ts: not owned by WS-API (owned by WS-CORE)");
      expect(api.out).not.toContain("apps/api/src/routes/health.ts");

      const off = runGate(r, neutered, "ws/qa");
      expect(off.code).toBe(1);
      expect(off.out).toContain(`M ${GATE_WORKFLOW_FILE}: the ownership gate's own file`);
      expect(off.out).toContain("CI cannot approve");

      const gone = runGate(r, deleted, "ws/qa");
      expect(gone.code).toBe(1);
      expect(gone.out).toContain(`D ${GATE_WORKFLOW_FILE}: the ownership gate's files may not be deleted`);

      const ok = runGate(r, docs, "ws/qa");
      expect(ok.code, ok.out).toBe(0);
      expect(ok.out).toContain("all within WS-QA");
    },
  );

  it.skipIf(!bash)(
    "with main's real checker: a PR with two merge bases, whose merge would revert WS-PPCORE, fails",
    () => {
      const { r, p1, p2, attack } = crissCross();
      const run = runGate(r, attack, "ws/api");
      expect(run.code, run.out).toBe(1);
      expect(run.out).toMatch(/2 merge bases/);
      expect(run.out).toContain(p1);
      expect(run.out).toContain(p2);
      expect(run.out).not.toMatch(/all within/);
    },
  );
});
