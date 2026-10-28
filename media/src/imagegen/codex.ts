import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * One `codex exec` per image (AI-11, S4.10). The prompt goes in on stdin; `--json` makes Codex print
 * JSONL events on stdout. The exit code is not trusted (openai/codex#37717): an image is accepted only
 * when a file is found and verified.
 *
 * Measured with codex-cli 0.159.3 on 22 Oct: the JSONL carries `thread.started {thread_id}`,
 * `item.completed {agent_message}` and `turn.completed {usage}` but no image item, so the image is found
 * at `$CODEX_HOME/generated_images/{thread_id}/exec-*.png`. A `saved_path` on any event is still honoured
 * first, in case a later CLI version reports it.
 */

export interface CodexUsage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
}

export interface CodexRunResult {
  exitCode: number | null;
  timedOut: boolean;
  threadId: string | null;
  usage: CodexUsage | null;
  agentMessages: string[];
  errors: string[];
  savedPaths: string[];
  startedAt: Date;
  durationMs: number;
}

export interface CodexRunOptions {
  prompt: string;
  workdir: string;
  inputImages?: readonly string[];
  timeoutMs?: number;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  spawnImpl?: SpawnLike;
  command?: CodexCommand;
  /** Process-tree kill used on timeout (injectable for tests). */
  kill?: (child: ChildProcess) => void;
}

export type SpawnLike = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

/** How Codex is started: always a direct spawn, never through a shell. */
export interface CodexCommand {
  file: string;
  prefixArgs: readonly string[];
}

export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** `$CODEX_HOME`, defaulting to `~/.codex`. */
export function codexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_HOME && env.CODEX_HOME.trim() !== "" ? env.CODEX_HOME : join(homedir(), ".codex");
}

/**
 * How to start Codex. On Windows `codex` is an npm `.cmd` shim, which Node can spawn only through
 * cmd.exe, and cmd.exe has no safe quoting for arbitrary arguments (it expands `%VAR%` and treats `^`, `&`
 * and `|` specially). So on Windows the shim's JavaScript entry is run with this Node, and if it cannot be
 * found the call fails with instructions instead of falling back to a shell. `CODEX_JS` overrides the entry.
 */
export function resolveCodexCommand(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = existsSync,
): CodexCommand {
  const candidates = [
    env.CODEX_JS,
    platform === "win32" && env.APPDATA
      ? join(env.APPDATA, "npm", "node_modules", "@openai", "codex", "bin", "codex.js")
      : undefined,
  ].filter((c): c is string => typeof c === "string" && c !== "");
  for (const c of candidates) if (exists(c)) return { file: process.execPath, prefixArgs: [c] };
  if (platform === "win32") {
    throw new Error(
      `codex.js not found (looked at: ${candidates.join(", ") || "nothing: APPDATA is unset"}). Install the CLI with "npm i -g @openai/codex", or set CODEX_JS to the full path of @openai/codex/bin/codex.js. imagegen never runs Codex through cmd.exe.`,
    );
  }
  return { file: "codex", prefixArgs: [] };
}

/** The `codex exec` argument list (S4.10), with input images attached by `--image=` for edits. */
export function buildExecArgs(
  opts: Pick<CodexRunOptions, "workdir" | "inputImages" | "reasoningEffort">,
): string[] {
  return [
    "exec",
    "--enable",
    "image_generation",
    "--skip-git-repo-check",
    "-s",
    "workspace-write",
    "-C",
    opts.workdir,
    "-c",
    `model_reasoning_effort=${opts.reasoningEffort ?? "low"}`,
    ...(opts.inputImages ?? []).map((i) => `--image=${i}`),
    "--json",
    "-",
  ];
}

export interface ParsedEvents {
  threadId: string | null;
  usage: CodexUsage | null;
  agentMessages: string[];
  errors: string[];
  savedPaths: string[];
}

/** Folds Codex JSONL events into what the pipeline needs. Unknown events and bad lines are ignored. */
export function parseCodexEvents(jsonl: string): ParsedEvents {
  const out: ParsedEvents = { threadId: null, usage: null, agentMessages: [], errors: [], savedPaths: [] };
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = String(e.type ?? "");
    if (type === "thread.started" && typeof e.thread_id === "string") out.threadId = e.thread_id;
    if (type === "turn.completed" && e.usage && typeof e.usage === "object") {
      const u = e.usage as Record<string, unknown>;
      out.usage = {
        input_tokens: Number(u.input_tokens ?? 0),
        cached_input_tokens: Number(u.cached_input_tokens ?? 0),
        output_tokens: Number(u.output_tokens ?? 0),
        reasoning_output_tokens: Number(u.reasoning_output_tokens ?? 0),
      };
    }
    if (type === "error" || type === "turn.failed") {
      const err = (e.error as Record<string, unknown> | undefined)?.message ?? e.message ?? JSON.stringify(e);
      out.errors.push(String(err));
    }
    const item = e.item as Record<string, unknown> | undefined;
    if (item && type === "item.completed") {
      if (item.type === "agent_message" && typeof item.text === "string") out.agentMessages.push(item.text);
      if (item.type === "error" && typeof item.message === "string") out.errors.push(item.message);
    }
    collectSavedPaths(e, out.savedPaths);
  }
  return out;
}

function collectSavedPaths(node: unknown, acc: string[]): void {
  if (!node || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if ((k === "saved_path" || k === "savedPath") && typeof v === "string" && !acc.includes(v)) acc.push(v);
    else if (v && typeof v === "object") collectSavedPaths(v, acc);
  }
}

/** Kills a process tree (Windows needs taskkill; elsewhere SIGKILL on the child is enough here). */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGKILL");
  }
}

/** Runs one `codex exec`, feeding the prompt on stdin, and returns the parsed events. Never rejects on exit codes. */
export function runCodexExec(opts: CodexRunOptions): Promise<CodexRunResult> {
  const cmd = opts.command ?? resolveCodexCommand();
  const args = [...cmd.prefixArgs, ...buildExecArgs(opts)];
  const spawnImpl = opts.spawnImpl ?? (nodeSpawn as SpawnLike);
  const startedAt = new Date();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolvePromise) => {
    const child = spawnImpl(cmd.file, args, {
      cwd: opts.workdir,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d: string) => {
      stdout += d;
    });
    child.stderr?.on("data", (d: string) => {
      stderr += d;
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      (opts.kill ?? killTree)(child);
    }, timeoutMs);
    const finish = (exitCode: number | null, extraError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const parsed = parseCodexEvents(stdout);
      const errors = [...parsed.errors];
      if (extraError) errors.push(extraError);
      if (timedOut) errors.push(`codex exec timed out after ${timeoutMs} ms`);
      if (exitCode !== 0 && stderr.trim()) errors.push(`stderr: ${stderr.trim().slice(-800)}`);
      resolvePromise({
        exitCode,
        timedOut,
        ...parsed,
        errors,
        startedAt,
        durationMs: Date.now() - startedAt.getTime(),
      });
    };
    child.on("error", (err) => finish(null, `spawn failed: ${err.message}`));
    child.on("close", (code) => finish(code));
    child.stdin?.on("error", () => {
      /* EPIPE when codex exits early; the close handler reports it */
    });
    child.stdin?.end(opts.prompt, "utf8");
  });
}

export interface FoundImage {
  path: string;
  mtimeMs: number;
  via: "saved_path" | "thread_dir";
}

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/**
 * Finds the image one exec produced: a reported `saved_path` first, then the newest image in the
 * thread's own `generated_images/{thread_id}` folder written after the exec started. Parallel execs never
 * see each other's files, because each has its own thread folder; without a thread id nothing is guessed.
 */
export async function findGeneratedImages(
  run: Pick<CodexRunResult, "threadId" | "savedPaths" | "startedAt">,
  home: string = codexHome(),
): Promise<FoundImage[]> {
  const found: FoundImage[] = [];
  for (const p of run.savedPaths) {
    try {
      const s = await stat(p);
      if (s.isFile()) found.push({ path: p, mtimeMs: s.mtimeMs, via: "saved_path" });
    } catch {
      /* reported but missing: fall through to the thread folder */
    }
  }
  if (found.length) return found;
  if (!run.threadId || !/^[\w-]+$/.test(run.threadId)) return [];
  const dir = join(home, "generated_images", run.threadId);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const since = run.startedAt.getTime() - 2_000;
  for (const n of names) {
    if (!IMAGE_EXT.test(n)) continue;
    const p = join(dir, n);
    const s = await stat(p);
    if (s.isFile() && s.mtimeMs >= since) found.push({ path: p, mtimeMs: s.mtimeMs, via: "thread_dir" });
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** `codex --version`, for the manifest. */
export function codexVersion(command: CodexCommand = resolveCodexCommand()): string {
  const r = spawnSync(command.file, [...command.prefixArgs, "--version"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  return (r.stdout ?? "").trim() || "unknown";
}

/** Reads a prompt file as UTF-8 (prompts are logged under media/prompts/). */
export async function readPrompt(path: string): Promise<string> {
  return readFile(path, "utf8");
}
