import type { ChildProcess } from "node:child_process";

/** Await process completion and drained pipes; a log line alone does not prove the exit code. */
export function waitForChild(
  child: ChildProcess,
  timeoutMs: number,
): Promise<{ status: number; output: string }> {
  return new Promise((resolve, reject) => {
    let output = "";
    let timedOut = false;
    let failure: Error | undefined;
    const collect = (data: string) => {
      output += data;
    };
    child.stdout?.setEncoding("utf8").on("data", collect);
    child.stderr?.setEncoding("utf8").on("data", collect);
    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      // Settle on close, after the killed process and its pipes are gone.
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(deadline);
      child.stdout?.off("data", collect);
      child.stderr?.off("data", collect);
      child.off("error", onError);
      child.off("close", onClose);
    };
    const onError = (error: Error) => {
      if (child.pid === undefined) {
        cleanup();
        reject(error);
      } else {
        // A failed operation (including kill) can emit error while the process is still alive.
        // Keep the deadline and close listener until it has actually exited.
        failure ??= error;
      }
    };
    const onClose = (status: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      if (timedOut) reject(new Error(`Boot child timed out after ${timeoutMs} ms`));
      else if (failure) reject(failure);
      else if (status === null) reject(new Error(`Boot child ended with ${signal ?? "no exit code"}`));
      else resolve({ status, output });
    };
    child.on("error", onError);
    child.once("close", onClose);
  });
}
