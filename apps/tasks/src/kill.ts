// Task-entry guards shared by every executor: the kill switch (architecture §11 "every task entry",
// S3.11) and the sandbox-only boot check (S3.13).
import type { TaskName, WorkspaceKind } from "./_shims/contracts.js";

/** `FS_KILL=payouts,paypal_live,ai_live` forces these flags on everywhere (S3.11). */
export const KILL_FLAGS = ["payouts", "paypal_live", "ai_live"] as const;
export type KillFlag = (typeof KILL_FLAGS)[number];

/** The flags in force for one run: `FS_KILL` united with the row's workspace `system_flags`. */
export type ActiveFlags = ReadonlySet<KillFlag>;

export const NO_FLAGS: ActiveFlags = Object.freeze(new Set<KillFlag>());

/**
 * Which tasks a flag refuses at task entry, before the handler runs. Only `kill_payouts` refuses
 * here (posting, cancel and re-route; posted batches keep settling, S3.11). The other two flags
 * change *how* a task runs, which the entry guard cannot decide because it sees only ids:
 * - `kill_paypal_live`: labelled replay in Judge Mode, refused in real mode (S3.11, register C-06).
 *   The PayPal lane decides with `paypalLane(flags, workspaceKind)` once it has loaded the row.
 * - `kill_ai_live`: replay only, enforced by ClaudeGateway (S4 §1 step 3).
 * Every handler receives the fresh flag set in `TaskInvocation.flags`.
 */
export const TASKS_REFUSED_AT_ENTRY: Readonly<Record<KillFlag, readonly TaskName[]>> = Object.freeze({
  payouts: ["postPayoutBatch", "cancelUnclaimed", "reroute"],
  paypal_live: [],
  ai_live: [],
});

/** The first active flag that refuses `name` at entry, or undefined. */
export function refusingFlag(name: TaskName, flags: ActiveFlags): KillFlag | undefined {
  return KILL_FLAGS.find((f) => flags.has(f) && TASKS_REFUSED_AT_ENTRY[f].includes(name));
}

/**
 * How a PayPal call runs under the current flags. `kill_paypal_live` turns live calls into a
 * labelled replay in Judge Mode (showcase, judge) and refuses them in real mode (S3.11). The
 * caller throws `KillSwitchError(task, "kill_paypal_live")` on `refuse`.
 */
export function paypalLane(flags: ActiveFlags, kind: WorkspaceKind): "live" | "replay" | "refuse" {
  if (!flags.has("paypal_live")) return "live";
  return kind === "real" ? "refuse" : "replay";
}

/** `kill_ai_live` means replay only, in every workspace kind. */
export function aiLane(flags: ActiveFlags): "live" | "replay" {
  return flags.has("ai_live") ? "replay" : "live";
}

/**
 * Reads the flags in force for a run, fresh on every task entry, never cached. `ids` are the run's
 * outbox ids, so WS-DATA's `system_flags` source can resolve each row's workspace.
 */
export type FlagSource = (name: TaskName, ids: readonly string[]) => ActiveFlags | Promise<ActiveFlags>;

export function parseFsKill(value: string | undefined): Set<KillFlag> {
  const known: ReadonlySet<string> = new Set(KILL_FLAGS);
  return new Set(
    (value ?? "")
      .split(",")
      .map((f) => f.trim())
      .filter((f): f is KillFlag => known.has(f)),
  );
}

/** The `FS_KILL` source. Reads the environment on every call, never caches. */
export function envFlags(env: NodeJS.ProcessEnv = process.env): FlagSource {
  return () => parseFsKill(env.FS_KILL);
}

/** Union of several sources. A source that throws fails the run (fail closed). */
export function unionFlags(...sources: readonly FlagSource[]): FlagSource {
  return async (name, ids) => {
    const out = new Set<KillFlag>();
    for (const source of sources) for (const f of await source(name, ids)) out.add(f);
    return out;
  };
}

/** An entry refuses to start (S3.13 boot check). */
export class BootRefusedError extends Error {
  override readonly name: string = "BootRefusedError";
}

export class NotSandboxError extends BootRefusedError {
  override readonly name = "NotSandboxError";
}

/** The one sandbox test (S3.13), shared by the boot check and tools/health-check.ts. Unset is not sandbox. */
export function isSandbox(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PP_ENV === "sandbox";
}

/** S3.13: refuse to boot unless `PP_ENV=sandbox`. Unset counts as not sandbox. */
export function assertSandbox(env: NodeJS.ProcessEnv = process.env): void {
  if (!isSandbox(env)) {
    const got = env.PP_ENV === undefined ? "unset" : `"${env.PP_ENV}"`;
    throw new NotSandboxError(`PP_ENV must be "sandbox" (got ${got}); refusing to start`);
  }
}

/**
 * Every entry's boot check (S3.13, plan "Proof and secrets"): sandbox only, and PayPal dev mocks
 * (which accept unsigned webhooks) never on Render, which sets `RENDER=true` in every service.
 */
export function assertBootEnv(env: NodeJS.ProcessEnv = process.env): void {
  assertSandbox(env);
  if (env.PP_DEV_MOCKS === "1" && env.RENDER === "true") {
    throw new BootRefusedError("PP_DEV_MOCKS=1 is not allowed on Render; refusing to start");
  }
}
