import { describe, expect, it } from "vitest";
import { readBlueprint } from "../../../tools/lib/blueprint.js";
import {
  childEnv,
  describeSkipped,
  isDroppedEnv,
  parseArgs,
  planVerify,
  resolveCommand,
  runVerify,
  type StepRunner,
  skippedTests,
  type VerifyStep,
} from "../../../tools/verify.js";

const opts = { source: "https://github.com/example/fair-split.git", dir: "/tmp/fs-verify/fair-split" };

describe("tools/verify (clean-clone verification, gate G7)", () => {
  it("plans clone, install, typecheck, test, build in that order", () => {
    const steps = planVerify(opts);
    expect(steps.map((s) => s.id)).toEqual(["clone", "install", "typecheck", "test", "build"]);
    expect(steps[0]).toMatchObject({
      command: "git",
      args: ["clone", "--quiet", "--no-hardlinks", opts.source, opts.dir],
      inClone: false,
    });
    expect(steps[1]).toMatchObject({ command: "corepack", args: ["pnpm", "install", "--frozen-lockfile"] });
  });

  it("checks out a ref and adds lint when asked", () => {
    const ids = planVerify({ ...opts, ref: "abc123", lint: true }).map((s) => s.id);
    expect(ids).toEqual(["clone", "checkout", "install", "typecheck", "lint", "test", "build"]);
  });

  it("stops at the first failure and keeps the failing output tail", () => {
    const seen: VerifyStep["id"][] = [];
    const runner: StepRunner = (step) => {
      seen.push(step.id);
      return step.id === "typecheck"
        ? { exitCode: 2, output: "a\nb\nerror TS2322: nope" }
        : { exitCode: 0, output: "" };
    };
    const rs = runVerify(opts, { runner, env: {} });
    expect(seen).toEqual(["clone", "install", "typecheck"]);
    expect(rs.at(-1)).toMatchObject({ id: "typecheck", ok: false, exitCode: 2 });
    expect(rs.at(-1)?.tail).toContain("TS2322");
  });

  it("runs the clone in the parent directory and every other step inside the clone", () => {
    const cwds: string[] = [];
    runVerify(opts, {
      runner: (_s, cwd) => {
        cwds.push(cwd.replaceAll("\\", "/"));
        return { exitCode: 0, output: "" };
      },
      env: {},
    });
    expect(cwds[0]?.endsWith("/tmp/fs-verify")).toBe(true);
    expect(cwds.slice(1).every((c) => c === opts.dir)).toBe(true);
  });

  it("gives children no credentials and forces CI, inline executor and no corepack prompt", () => {
    const env = childEnv({
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "x",
      GEMINI_API_KEY: "x",
      PP_CLIENT_SECRET: "x",
      RENDER_API_KEY: "x",
      DATABASE_URL: "postgres://x",
      STATEMENT_SIGNING_KEY: "x",
    });
    expect(env).toEqual({
      PATH: "/usr/bin",
      CI: "1",
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
      EXECUTOR: "inline",
      FORCE_COLOR: "0",
    });
  });

  it("drops the owner's DSN, the kill flags and every other app or database setting, keeping the OS's", () => {
    const dropped = [
      "DATABASE_OWNER_URL",
      "LIMITER_DATABASE_URL",
      "FS_TEST_DATABASE_URL",
      "FS_KILL",
      "FS_APP_DB_PASSWORD",
      "FS_DB_HOST",
      "FS_TASKS_SLUG",
      "PP_MODE",
      "PAYPAL_CLIENT_SECRET",
      "KILL_PAYOUTS",
      "CRON_SECRET",
      "FS_COOKIE_SECRET",
      "FS_LINK_SIGNING_KEY",
      "FS_LEDGER_SIGNING_KEY",
      "FS_OPERATOR_PASSWORD_SCRYPT",
      "JUDGE_CODE_SHA256",
      "EXPO_PUSH_TOKEN",
      "PGPASSWORD",
      "PGHOST",
      "OPENAI_API_KEY",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "BETTER_AUTH_SECRET",
      "NODE_ENV",
    ];
    const kept = [
      "PATH",
      "Path",
      "HOME",
      "USERPROFILE",
      "SystemRoot",
      "TEMP",
      "APPDATA",
      "PATHEXT",
      "LOG_LEVEL",
    ];
    for (const name of dropped) expect(isDroppedEnv(name), name).toBe(true);
    for (const name of kept) expect(isDroppedEnv(name), name).toBe(false);
    const env = childEnv(Object.fromEntries([...dropped, ...kept].map((k) => [k, "v"])));
    expect(Object.keys(env).sort()).toEqual(
      [...kept, "CI", "COREPACK_ENABLE_DOWNLOAD_PROMPT", "EXECUTOR", "FORCE_COLOR"].sort(),
    );
  });

  it("drops every secret and app setting render.yaml declares, so a clean clone never sees a deploy's values", () => {
    let checked = 0;
    for (const s of readBlueprint().services ?? [])
      for (const v of s.envVars ?? []) {
        const key = v.key ?? "";
        if (
          v.sync === false ||
          v.generateValue ||
          v.fromDatabase ||
          v.fromService ||
          /^(PP_|FS_)/.test(key)
        ) {
          expect(isDroppedEnv(key), `${s.name}.${key}`).toBe(true);
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(15);
  });

  it("--db reaches only the test step, as FS_TEST_DATABASE_URL, and never appears in what it reports", () => {
    const db = ["postgres://verify", "not-a-real-password@localhost:5432/fs"].join(":");
    const seen: Record<string, string | undefined> = {};
    const rs = runVerify(
      { ...opts, db },
      {
        runner: (step, _cwd, env) => {
          seen[step.id] = env.FS_TEST_DATABASE_URL;
          return step.id === "test"
            ? { exitCode: 1, output: `connect ${db} refused: password not-a-real-password rejected` }
            : { exitCode: 0, output: "" };
        },
        env: { FS_TEST_DATABASE_URL: "postgres://developer-own/db" },
      },
    );
    expect(seen).toEqual({ clone: undefined, install: undefined, typecheck: undefined, test: db });
    expect(JSON.stringify(rs)).not.toContain("not-a-real-password");
    expect(rs.at(-1)?.tail).toBe("connect <--db> refused: password <--db> rejected");
  });

  it("reports skipped tests per package from vitest's summaries, through turbo's prefixes and colours", () => {
    const output = [
      "@fairsplit/tasks:test:       Tests  240 passed (240)",
      "@fairsplit/db:test:       Tests  \u001b[1m\u001b[32m40 passed\u001b[39m\u001b[22m | \u001b[33m25 skipped\u001b[39m (65)",
      "@fairsplit/ai:test:       Tests  1 failed | 30 passed | 2 skipped | 1 todo (34)",
      "@fairsplit/ai:test:  Test Files  3 passed (3)",
      "      Tests  4 skipped (4)",
    ].join("\n");
    expect(skippedTests(output)).toEqual({ "@fairsplit/db": 25, "@fairsplit/ai": 3, "(root)": 4 });
    expect(describeSkipped(skippedTests(output))).toBe(
      "(root) 4, @fairsplit/ai 3, @fairsplit/db 25 (32 in all)",
    );
    expect(describeSkipped({})).toBe("none");
    const rs = runVerify(opts, {
      runner: (s) => ({ exitCode: 0, output: s.id === "test" ? output : "" }),
      env: {},
    });
    expect(rs.find((r) => r.id === "test")?.skipped).toEqual({
      "@fairsplit/db": 25,
      "@fairsplit/ai": 3,
      "(root)": 4,
    });
    expect(rs.find((r) => r.id === "build")?.skipped).toBeUndefined();
  });

  it("passes the scrubbed env to every step", () => {
    const envs: NodeJS.ProcessEnv[] = [];
    runVerify(opts, {
      runner: (_s, _c, e) => {
        envs.push(e);
        return { exitCode: 0, output: "" };
      },
      env: { ANTHROPIC_API_KEY: "x" },
    });
    expect(envs.every((e) => e.ANTHROPIC_API_KEY === undefined && e.CI === "1")).toBe(true);
  });

  it("parses CLI flags", () => {
    expect(parseArgs(["--source=../x", "--ref=main", "--dir=out", "--keep", "--lint", "--json"])).toEqual({
      source: "../x",
      ref: "main",
      dir: "out",
      keep: true,
      lint: true,
      json: true,
    });
    expect(parseArgs(["--db=postgresql://localhost:5432/fs"]).db).toBe("postgresql://localhost:5432/fs");
    expect(() => parseArgs(["--db=mysql://localhost/fs"])).toThrow(/postgres/);
    expect(() => parseArgs(["--nope"])).toThrow();
  });
});

describe("resolveCommand", () => {
  it("runs corepack through node (no shell), and other commands as given", () => {
    const [cmd, args] = resolveCommand("corepack", ["pnpm", "test"]);
    expect(cmd).toBe(process.execPath);
    expect(args.slice(-2)).toEqual(["pnpm", "test"]);
    expect(args[0]?.replaceAll("\\", "/")).toMatch(/corepack\/dist\/corepack\.js$/);
    expect(resolveCommand("git", ["status"])).toEqual(["git", ["status"]]);
  });

  // Windows installs corepack beside node.exe; Linux and macOS tarballs put it under ../lib/node_modules.
  it("finds corepack.js in each platform's Node layout", () => {
    const found = (platform: NodeJS.Platform, execPath: string) => {
      const seen: string[] = [];
      const exists = (p: string) => {
        seen.push(p.replaceAll("\\", "/"));
        return seen.length === 1;
      };
      const [cmd, args] = resolveCommand("corepack", ["pnpm", "test"], { platform, execPath, exists });
      return { cmd, js: args[0]?.replaceAll("\\", "/"), rest: args.slice(1), seen };
    };
    const win = found("win32", "C:\\Program Files\\nodejs\\node.exe");
    expect(win.cmd).toBe("C:\\Program Files\\nodejs\\node.exe");
    expect(win.js).toBe("C:/Program Files/nodejs/node_modules/corepack/dist/corepack.js");
    expect(win.rest).toEqual(["pnpm", "test"]);
    for (const platform of ["linux", "darwin"] as const) {
      const unix = found(platform, "/opt/hostedtoolcache/node/24.19.0/x64/bin/node");
      expect(unix.cmd).toBe("/opt/hostedtoolcache/node/24.19.0/x64/bin/node");
      expect(unix.js).toBe(
        "/opt/hostedtoolcache/node/24.19.0/x64/lib/node_modules/corepack/dist/corepack.js",
      );
      expect(unix.rest).toEqual(["pnpm", "test"]);
    }
  });

  it("falls back to the bare command when this Node ships no corepack", () => {
    const host = { platform: "linux" as const, execPath: "/usr/bin/node", exists: () => false };
    expect(resolveCommand("corepack", ["pnpm"], host)).toEqual(["corepack", ["pnpm"]]);
  });
});
