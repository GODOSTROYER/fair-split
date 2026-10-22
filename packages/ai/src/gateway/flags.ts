/** The flags the gateway honours. `kill_ai_live` is read fresh on every call (architecture §11). */
export type AiFlag = "kill_ai_live";

export interface FlagSource {
  isOn(flag: AiFlag): boolean | Promise<boolean>;
}

const truthy = (v: string | undefined): boolean => v !== undefined && /^(1|true|yes|on)$/i.test(v.trim());

/**
 * Environment flags: `KILL_AI_LIVE=true`, or `FS_KILL` naming the flag (comma-separated), or
 * `FS_KILL=all|true`. The environment is read at call time, never cached.
 */
export function envFlagSource(env: NodeJS.ProcessEnv = process.env): FlagSource {
  return {
    isOn(flag) {
      if (flag === "kill_ai_live" && truthy(env.KILL_AI_LIVE)) return true;
      const forced = (env.FS_KILL ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      return forced.includes(flag) || forced.includes("all") || forced.includes("true");
    },
  };
}

/** A flag is on if any source says so; adding a source can only make the gateway stricter. */
export function anyFlagSource(...sources: FlagSource[]): FlagSource {
  return {
    async isOn(flag) {
      for (const s of sources) if (await s.isOn(flag)) return true;
      return false;
    },
  };
}

export const staticFlags = (on: Partial<Record<AiFlag, boolean>>): FlagSource => ({
  isOn: (flag) => on[flag] === true,
});
