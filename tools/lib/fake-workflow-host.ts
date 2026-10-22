// A stand-in for Render's workflow host, speaking the @renderinc/sdk 1.3.0 socket protocol
// (HTTP over a Unix socket / Windows named pipe at RENDER_SDK_SOCKET_PATH):
//   POST /register-tasks  {tasks:[{name, options}]}          (RENDER_SDK_MODE=register)
//   GET  /input           {task_name, input: base64(JSON args), task_run_id}   (RENDER_SDK_MODE=run)
//   POST /callback        {complete:{output: base64(JSON [result])}} | {error:{details}}
// Used by the protocol test and by spike S6 to run the real fs-tasks entry the way Render does.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface RegisteredTask {
  name: string;
  options?: {
    retry?: { max_retries?: number; wait_duration_ms?: number; factor?: number };
    timeout_seconds?: number;
    plan?: string;
  };
}

export type CallbackBody = { complete: { output: string } } | { error: { details: string } };

export interface HostResult {
  readonly exitCode: number | null;
  readonly registered?: RegisteredTask[];
  readonly callback?: CallbackBody;
  /** Decoded task result when the callback completed. */
  readonly result?: unknown;
  /** Milliseconds from spawn to the first protocol request (process cold start + task registration). */
  readonly firstRequestMs?: number;
  /** Milliseconds from spawn to the register or callback request. */
  readonly doneMs?: number;
  readonly stderr: string;
}

export interface HostRun {
  readonly entry: string;
  readonly mode: "register" | "run";
  readonly taskName?: string;
  readonly input?: unknown[];
  readonly cwd: string;
  /** Extra node flags, e.g. ["--import", "tsx"] to run TypeScript sources. */
  readonly nodeArgs?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
}

function socketPath(): string {
  const id = `fs-tasks-${randomUUID()}`;
  return process.platform === "win32" ? `\\\\.\\pipe\\${id}` : join(tmpdir(), `${id}.sock`);
}

async function readJson(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

/** Spawn `entry` under a fake host and resolve once the process exits. */
export async function runUnderFakeHost(run: HostRun): Promise<HostResult> {
  const path = socketPath();
  const started = performance.now();
  let firstRequestMs: number | undefined;
  let doneMs: number | undefined;
  let registered: RegisteredTask[] | undefined;
  let callback: CallbackBody | undefined;

  const server: Server = createServer(async (req, res) => {
    firstRequestMs ??= performance.now() - started;
    const url = req.url ?? "";
    try {
      if (req.method === "POST" && url.startsWith("/register-tasks")) {
        registered = ((await readJson(req)) as { tasks: RegisteredTask[] }).tasks;
        doneMs = performance.now() - started;
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
      } else if (req.method === "GET" && url.startsWith("/input")) {
        const body = {
          task_name: run.taskName ?? "",
          input: Buffer.from(JSON.stringify(run.input ?? [])).toString("base64"),
          task_run_id: "trn-fake-0001",
          root_task_run_id: "trn-fake-0001",
        };
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
      } else if (req.method === "POST" && url.startsWith("/callback")) {
        callback = (await readJson(req)) as CallbackBody;
        doneMs = performance.now() - started;
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
      } else {
        res.writeHead(404).end();
      }
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => resolve());
  });

  try {
    const child = spawn(process.execPath, [...(run.nodeArgs ?? []), run.entry], {
      cwd: run.cwd,
      env: {
        ...process.env,
        ...run.env,
        RENDER_SDK_SOCKET_PATH: path,
        RENDER_SDK_MODE: run.mode,
        LOG_LEVEL: run.env?.LOG_LEVEL ?? "silent",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`fake host: ${run.entry} did not exit within ${run.timeoutMs ?? 30_000} ms`));
      }, run.timeoutMs ?? 30_000);
      child.once("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    let result: unknown;
    if (callback && "complete" in callback && callback.complete.output) {
      result = (JSON.parse(Buffer.from(callback.complete.output, "base64").toString("utf8")) as unknown[])[0];
    }
    return {
      exitCode,
      stderr,
      ...(registered ? { registered } : {}),
      ...(callback ? { callback } : {}),
      ...(result !== undefined ? { result } : {}),
      ...(firstRequestMs !== undefined ? { firstRequestMs } : {}),
      ...(doneMs !== undefined ? { doneMs } : {}),
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (process.platform !== "win32") rmSync(path, { force: true });
  }
}
