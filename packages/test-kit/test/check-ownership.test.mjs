// Unit tests for tools/check-ownership.mjs (WS-QA owns both). They run against the real docs/ownership.md.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkChanges,
  globToRegExp,
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

  it("lets any workstream commit the lockfile", () => {
    expect(checkChanges(ownership, "WS-DATA", edit("pnpm-lock.yaml", "packages/db/package.json")).ok).toBe(
      true,
    );
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
