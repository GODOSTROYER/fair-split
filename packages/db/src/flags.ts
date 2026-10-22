/**
 * Kill switches (architecture §11, S3.11): `kill_payouts`, `kill_paypal_live`, `kill_ai_live`, per workspace so a
 * judge can only stop their own demo. `FS_KILL=payouts,paypal_live,ai_live` (or `all`) forces them on everywhere.
 * Flags are read fresh at every use, never cached. A flip writes the ledger and emits `flag.changed` in the same
 * transaction.
 */
import { and, eq, sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import { type Provenance, SYSTEM_FLAGS, type SystemFlag } from "./_shims/contracts.js";
import type { DbOrTx, Tx } from "./client.js";
import { appendEvent, lockWorkspaceLog } from "./events.js";
import { appendLedger } from "./ledger.js";
import { systemFlags } from "./schema/index.js";
import type { WorkspaceScope } from "./scope.js";

export type FlagSource = "env" | "workspace" | "default";

export interface FlagValue {
  on: boolean;
  source: FlagSource;
  setBy: string | null;
  setAt: Date | null;
  reason: string | null;
}

export type FlagState = Record<SystemFlag, FlagValue>;

/**
 * Parses FS_KILL (comma-separated: payouts, paypal_live, ai_live, all; full names also accepted). The
 * `.env.example` booleans KILL_PAYOUTS / KILL_PAYPAL_LIVE / KILL_AI_LIVE are honoured too.
 */
export function envKills(env: Record<string, string | undefined> = process.env): Set<SystemFlag> {
  const out = new Set<SystemFlag>();
  for (const raw of (env.FS_KILL ?? "").split(",")) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    if (t === "all") for (const f of SYSTEM_FLAGS) out.add(f);
    const name = (t.startsWith("kill_") ? t : `kill_${t}`) as SystemFlag;
    if (SYSTEM_FLAGS.includes(name)) out.add(name);
  }
  for (const f of SYSTEM_FLAGS) {
    if (/^(1|true|on|yes)$/i.test(env[f.toUpperCase()] ?? "")) out.add(f);
  }
  return out;
}

export async function readFlags(
  db: DbOrTx,
  workspaceId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<FlagState> {
  const rows = await db.select().from(systemFlags).where(eq(systemFlags.workspaceId, workspaceId));
  const forced = envKills(env);
  const state = {} as FlagState;
  for (const f of SYSTEM_FLAGS) {
    const row = rows.find((r) => r.flag === f);
    if (forced.has(f)) state[f] = { on: true, source: "env", setBy: "FS_KILL", setAt: null, reason: null };
    else if (row)
      state[f] = { on: row.on, source: "workspace", setBy: row.setBy, setAt: row.setAt, reason: row.reason };
    else state[f] = { on: false, source: "default", setBy: null, setAt: null, reason: null };
  }
  return state;
}

/** Fresh read of one flag: true when the switch is on (env or workspace). */
export async function isKilled(
  db: DbOrTx,
  workspaceId: string,
  flag: SystemFlag,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  if (envKills(env).has(flag)) return true;
  const [row] = await db
    .select({ on: systemFlags.on })
    .from(systemFlags)
    .where(and(eq(systemFlags.workspaceId, workspaceId), eq(systemFlags.flag, flag)));
  return row?.on ?? false;
}

export async function setFlag(
  db: DbOrTx,
  scope: WorkspaceScope,
  flag: SystemFlag,
  on: boolean,
  opts: { reason?: string; provenance: Provenance },
): Promise<{ changed: boolean }> {
  if (!(db instanceof PgTransaction)) return db.transaction((tx) => setFlag(tx, scope, flag, on, opts));
  const tx = db as Tx;
  if (!SYSTEM_FLAGS.includes(flag)) throw new TypeError(`unknown flag ${flag}`);
  // the workspace log lock serialises flips with each other and with ledger appends
  await lockWorkspaceLog(tx, scope.workspaceId);
  const [prev] = await tx
    .select({ on: systemFlags.on })
    .from(systemFlags)
    .where(and(eq(systemFlags.workspaceId, scope.workspaceId), eq(systemFlags.flag, flag)));
  if ((prev?.on ?? false) === on) return { changed: false };
  await tx
    .insert(systemFlags)
    .values({ workspaceId: scope.workspaceId, flag, on, setBy: scope.actor.id, reason: opts.reason ?? null })
    .onConflictDoUpdate({
      target: [systemFlags.workspaceId, systemFlags.flag],
      set: { on, setBy: scope.actor.id, reason: opts.reason ?? null, setAt: sql`now()` },
    });
  const payload = { flag, on, reason: opts.reason ?? null };
  await appendLedger(tx, scope, { kind: "flag.flipped", payload });
  await appendEvent(tx, {
    workspaceId: scope.workspaceId,
    type: "flag.changed",
    actor: scope.actor,
    provenance: opts.provenance,
    payload,
  });
  return { changed: true };
}

export const flags = { read: readFlags, isKilled, set: setFlag, envKills };
