import { asDbError, type FairSplitDbError, pgError } from "../src/errors.js";
import { type Actor, systemScope, type WorkspaceScope, workspaceScope } from "../src/scope.js";

export const treasurer: Actor = {
  kind: "human",
  id: "treasurer:analyn",
  impersonatedBy: "judge_session:test",
};

export function scopeOf(workspaceId: string, actor: Actor = treasurer): WorkspaceScope {
  return workspaceScope({ workspaceId, actor, via: "frame_token" });
}

export { systemScope };

/** Runs fn and returns the error it threw (fails the test if it did not throw). */
export async function caught(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected the operation to throw");
}

export async function dbError(fn: () => Promise<unknown>): Promise<FairSplitDbError> {
  const e = await caught(fn);
  const mapped = asDbError(e);
  if (!mapped) throw new Error(`expected a FairSplitDbError, got: ${String((e as Error)?.message ?? e)}`);
  return mapped;
}

export async function sqlState(fn: () => Promise<unknown>): Promise<string | undefined> {
  return pgError(await caught(fn))?.code;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function until(cond: () => boolean, timeoutMs = 5000, stepMs = 10): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await sleep(stepMs);
  }
}
