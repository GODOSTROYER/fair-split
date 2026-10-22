// Task-entry guards shared by every executor: the kill switch (architecture §11 "every task entry",
// S3.11) and the sandbox-only boot check (S3.13).
import type { TaskName } from "./_shims/contracts.js";

/** `FS_KILL=payouts,paypal_live,ai_live` forces these flags on everywhere (S3.11). */
export const KILL_FLAGS = ["payouts", "paypal_live", "ai_live"] as const;
export type KillFlag = (typeof KILL_FLAGS)[number];

/**
 * Which tasks a flag refuses at entry. `kill_payouts` refuses posting, cancel and re-route but lets
 * posted batches keep settling; `kill_paypal_live` also refuses invoice creation. `kill_ai_live`
 * means "replay only", which ClaudeGateway enforces inside the AI tasks, so it refuses none here.
 */
export const TASKS_REFUSED_BY_FLAG: Readonly<Record<KillFlag, readonly TaskName[]>> = Object.freeze({
  payouts: ["postPayoutBatch", "cancelUnclaimed", "reroute"],
  paypal_live: ["ensureInvoice", "postPayoutBatch", "cancelUnclaimed", "reroute"],
  ai_live: [],
});

/**
 * Returns the name of a kill flag that refuses `name`, or undefined. Read fresh on every task entry;
 * WS-DATA's per-workspace `system_flags` read is combined with it (`anyFlag`) once wired.
 */
export type FlagCheck = (name: TaskName) => string | undefined | Promise<string | undefined>;

export function parseFsKill(value: string | undefined): Set<KillFlag> {
  const known: ReadonlySet<string> = new Set(KILL_FLAGS);
  return new Set(
    (value ?? "")
      .split(",")
      .map((f) => f.trim())
      .filter((f): f is KillFlag => known.has(f)),
  );
}

/** The `FS_KILL` check. Reads the environment on every call, never caches. */
export function envFlagCheck(env: NodeJS.ProcessEnv = process.env): FlagCheck {
  return (name) => {
    for (const flag of parseFsKill(env.FS_KILL)) {
      if (TASKS_REFUSED_BY_FLAG[flag].includes(name)) return `FS_KILL:${flag}`;
    }
    return undefined;
  };
}

/** Combine checks; the first flag that refuses wins. A check that throws fails the run (fail closed). */
export function anyFlag(...checks: readonly FlagCheck[]): FlagCheck {
  return async (name) => {
    for (const check of checks) {
      const flag = await check(name);
      if (flag) return flag;
    }
    return undefined;
  };
}

export class NotSandboxError extends Error {
  override readonly name = "NotSandboxError";
}

/** S3.13: refuse to boot unless `PP_ENV=sandbox`. Unset counts as not sandbox. */
export function assertSandbox(env: NodeJS.ProcessEnv = process.env): void {
  if (env.PP_ENV !== "sandbox") {
    const got = env.PP_ENV === undefined ? "unset" : `"${env.PP_ENV}"`;
    throw new NotSandboxError(`PP_ENV must be "sandbox" (got ${got}); refusing to start`);
  }
}
