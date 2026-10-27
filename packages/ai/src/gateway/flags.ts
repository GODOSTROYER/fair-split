/** The flags the gateway honours. `kill_ai_live` is read fresh on every call (architecture §11). */
export type AiFlag = "kill_ai_live";

/** Which flags apply: S3.11 keeps `system_flags` per workspace, so a judge can only stop their own demo. */
export interface FlagScope {
  workspaceId?: string | null;
}

/**
 * Where the gateway reads its flags. Production (fs-api, fs-tasks) passes WS-DATA's `system_flags`
 * source, read fresh per call and scoped by `workspaceId`, usually combined with `envFlagSource()` so
 * `FS_KILL` still forces a flag on everywhere.
 */
export interface FlagSource {
  isOn(flag: AiFlag, scope?: FlagScope): boolean | Promise<boolean>;
  /**
   * True when the flag lives only in this process (environment, constants). Such a source cannot see
   * a per-workspace flag set through the API, so the gateway refuses it in production.
   */
  readonly processLocal?: boolean;
}

const truthy = (v: string | undefined): boolean => v !== undefined && /^(1|true|yes|on)$/i.test(v.trim());

/**
 * Environment flags: `KILL_AI_LIVE=true`, or `FS_KILL` naming the flag (S3.11 spells it
 * `FS_KILL=payouts,paypal_live,ai_live`; the full name `kill_ai_live` works too), or
 * `FS_KILL=all|true`. The environment is read at call time, never cached. Applies to every workspace.
 */
export function envFlagSource(env: NodeJS.ProcessEnv = process.env): FlagSource {
  return {
    processLocal: true,
    isOn(flag) {
      if (flag === "kill_ai_live" && truthy(env.KILL_AI_LIVE)) return true;
      const forced = (env.FS_KILL ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const short = flag.replace(/^kill_/, "");
      return forced.some((f) => f === flag || f === short || f === "all" || f === "true");
    },
  };
}

/**
 * A flag is on if any source says so; adding a source can only make the gateway stricter. The result
 * is process-local only when every source is.
 */
export function anyFlagSource(...sources: FlagSource[]): FlagSource {
  return {
    processLocal: sources.every((s) => s.processLocal === true),
    async isOn(flag, scope) {
      for (const s of sources) if (await s.isOn(flag, scope)) return true;
      return false;
    },
  };
}

/** Fixed flags for tests and one-off runs (process-local). */
export const staticFlags = (on: Partial<Record<AiFlag, boolean>>): FlagSource => ({
  processLocal: true,
  isOn: (flag) => on[flag] === true,
});
