import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  buildExecArgs,
  findGeneratedImages,
  parseCodexEvents,
  quoteForCmd,
  resolveCodexCommand,
  runCodexExec,
} from "../src/imagegen/codex.js";

/** JSONL exactly as codex-cli 0.159.3 printed it for spike E1 (22 Oct). */
const RECORDED = [
  '{"type":"thread.started","thread_id":"01a16263-74e7-72c1-8050-acef4b1b8ecc"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"DONE"}}',
  '{"type":"turn.completed","usage":{"input_tokens":82344,"cached_input_tokens":66560,"cache_write_input_tokens":0,"output_tokens":903,"reasoning_output_tokens":0}}',
].join("\n");

describe("codex exec wrapper", () => {
  it("parses the recorded JSONL: thread id, usage and the agent's reply", () => {
    const e = parseCodexEvents(RECORDED);
    expect(e.threadId).toBe("01a16263-74e7-72c1-8050-acef4b1b8ecc");
    expect(e.usage).toEqual({
      input_tokens: 82344,
      cached_input_tokens: 66560,
      output_tokens: 903,
      reasoning_output_tokens: 0,
    });
    expect(e.agentMessages).toEqual(["DONE"]);
    expect(e.errors).toEqual([]);
    expect(e.savedPaths).toEqual([]);
  });

  it("collects errors and any saved_path a later CLI might report, and skips junk lines", () => {
    const e = parseCodexEvents(
      [
        "not json",
        '{"type":"error","message":"quota exceeded"}',
        '{"type":"turn.failed","error":{"message":"boom"}}',
        '{"type":"item.completed","item":{"type":"image_generation","result":{"saved_path":"C:/x/ig_1.png"}}}',
      ].join("\r\n"),
    );
    expect(e.errors).toEqual(["quota exceeded", "boom"]);
    expect(e.savedPaths).toEqual(["C:/x/ig_1.png"]);
  });

  it("builds one exec with image generation on, the prompt on stdin and edit inputs attached", () => {
    const args = buildExecArgs({ workdir: "W", inputImages: ["a.jpg"], reasoningEffort: "low" });
    expect(args.slice(0, 3)).toEqual(["exec", "--enable", "image_generation"]);
    expect(args).toContain("--skip-git-repo-check");
    expect(args.join(" ")).toContain("-s workspace-write -C W");
    expect(args).toContain("model_reasoning_effort=low");
    expect(args).toContain("--image=a.jpg");
    expect(args.slice(-2)).toEqual(["--json", "-"]);
  });

  it("quotes for cmd.exe only when needed", () => {
    expect(quoteForCmd("model_reasoning_effort=low")).toBe("model_reasoning_effort=low");
    expect(quoteForCmd("C:/a b/c.png")).toBe('"C:/a b/c.png"');
  });

  it("runs the npm shim's JavaScript entry with Node on Windows, so no shell parses arguments", () => {
    const win = resolveCodexCommand({ APPDATA: "C:/AppData" }, "win32", () => true);
    expect(win.shell).toBe(false);
    expect(win.file).toBe(process.execPath);
    expect(win.prefixArgs[0]).toMatch(/codex\.js$/);
    const fallback = resolveCodexCommand({ APPDATA: "C:/AppData" }, "win32", () => false);
    expect(fallback).toEqual({ file: "codex", prefixArgs: [], shell: true });
    expect(resolveCodexCommand({}, "linux", () => false)).toEqual({
      file: "codex",
      prefixArgs: [],
      shell: false,
    });
  });

  it("finds the image in the exec's own thread folder, newer than the start, never another thread's", async () => {
    const home = mkdtempSync(join(tmpdir(), "codexhome-"));
    const started = new Date();
    const mine = join(home, "generated_images", "thread-a");
    const other = join(home, "generated_images", "thread-b");
    mkdirSync(mine, { recursive: true });
    mkdirSync(other, { recursive: true });
    writeFileSync(join(mine, "exec-new.png"), "x");
    writeFileSync(join(mine, "exec-old.png"), "x");
    const old = new Date(started.getTime() - 3_600_000);
    utimesSync(join(mine, "exec-old.png"), old, old);
    writeFileSync(join(other, "exec-other.png"), "x");
    writeFileSync(join(mine, "notes.txt"), "x");
    const found = await findGeneratedImages(
      { threadId: "thread-a", savedPaths: [], startedAt: started },
      home,
    );
    expect(found.map((f) => f.path)).toEqual([join(mine, "exec-new.png")]);
    expect(found[0]?.via).toBe("thread_dir");
    expect(await findGeneratedImages({ threadId: null, savedPaths: [], startedAt: started }, home)).toEqual(
      [],
    );
    expect(
      await findGeneratedImages({ threadId: "../etc", savedPaths: [], startedAt: started }, home),
    ).toEqual([]);
    const reported = await findGeneratedImages(
      { threadId: "thread-a", savedPaths: [join(other, "exec-other.png")], startedAt: started },
      home,
    );
    expect(reported.map((f) => f.via)).toEqual(["saved_path"]);
  });

  function fakeChild(script: (c: FakeChild) => void) {
    const spawned: { file: string; args: readonly string[]; opts: SpawnOptions; stdin: string }[] = [];
    const spawnImpl = (file: string, args: readonly string[], opts: SpawnOptions) => {
      const c = new FakeChild();
      const record = { file, args, opts, stdin: "" };
      spawned.push(record);
      c.stdin.on("data", (d: Buffer) => {
        record.stdin += d.toString("utf8");
      });
      setTimeout(() => script(c), 5);
      return c as unknown as ChildProcess;
    };
    return { spawnImpl, spawned };
  }

  class FakeChild extends EventEmitter {
    stdin = new PassThrough();
    stdout = new PassThrough();
    stderr = new PassThrough();
    pid = undefined;
    killed = false;
  }

  it("feeds the prompt on stdin and returns parsed events without trusting the exit code", async () => {
    const { spawnImpl, spawned } = fakeChild((c) => {
      c.stdout.write(`${RECORDED}\n`);
      c.stdout.end();
      c.emit("close", 0);
    });
    const r = await runCodexExec({
      prompt: "draw one slip",
      workdir: "W",
      spawnImpl,
      command: { file: "node", prefixArgs: ["codex.js"], shell: false },
    });
    expect(spawned[0]?.stdin).toBe("draw one slip");
    expect(spawned[0]?.args.slice(0, 2)).toEqual(["codex.js", "exec"]);
    expect(r.exitCode).toBe(0);
    expect(r.threadId).toBe("01a16263-74e7-72c1-8050-acef4b1b8ecc");
    expect(r.timedOut).toBe(false);
  });

  it("kills a hung exec at the timeout and reports it", async () => {
    let killed = 0;
    const { spawnImpl } = fakeChild(() => undefined);
    const r = await runCodexExec({
      prompt: "p",
      workdir: "W",
      spawnImpl,
      timeoutMs: 30,
      command: { file: "node", prefixArgs: [], shell: false },
      kill: (c) => {
        killed++;
        setTimeout(() => (c as unknown as FakeChild).emit("close", null), 1);
      },
    });
    expect(killed).toBe(1);
    expect(r.timedOut).toBe(true);
    expect(r.errors.join(" ")).toMatch(/timed out/);
  });
});
