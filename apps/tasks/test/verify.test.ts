import { describe, expect, it } from "vitest";
import {
  childEnv,
  parseArgs,
  planVerify,
  resolveCommand,
  runVerify,
  type StepRunner,
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
});
