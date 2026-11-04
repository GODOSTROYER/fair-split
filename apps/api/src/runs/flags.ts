// Kill switches (S3.11): `kill_payouts`, `kill_paypal_live`, `kill_ai_live`, per workspace, so a judge can stop
// only their own demo; `FS_KILL` forces them on everywhere. Read fresh at every use, never cached: in the
// approval route, before every PayPal call and at every money task's entry.
//
// `setFlag` (IC-01) flips one in a single transaction with its ledger entry and the IC-01 `flag.changed`
// event. Turning `kill_payouts` on HALTs every run waiting on signatures (TREASURER_APPROVED,
// AWAITING_BOARD, APPROVED) with its approvals voided: "Payouts paused by the co-op." Turning `kill_payouts` or
// `kill_paypal_live` off brings the PayPal steps that waited it out forward (money/resume.ts).
import type { PayRunState, SystemFlagDTO, SystemFlagName } from "@fairsplit/contracts";
import {
  type DbOrTx,
  envKills,
  readFlags,
  schema,
  type WorkspaceScope,
  withWorkspaceTx,
} from "@fairsplit/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { killEnv } from "../env.js";
import type { CommandHandler } from "../lib/command.js";
import type { AppDeps } from "../lib/context.js";
import { ApiProblem } from "../lib/problem.js";
import { resumeStalledPosts, wakeWaitingPosts } from "../money/resume.js";
import { allow, CAN, personaId } from "./access.js";
import { emit, factLedger, noteSha256 } from "./events.js";
import { cause, moveLine, moveRun, type RunRow } from "./machine.js";

export interface KillFlags {
  killPayouts: boolean;
  killPaypalLive: boolean;
  killAiLive: boolean;
}

/** A fresh read of the three switches (env-forced or stored). */
export async function readKill(
  deps: Pick<AppDeps, "db" | "env">,
  workspaceId: string,
  db?: DbOrTx,
): Promise<KillFlags> {
  const f = await readFlags(db ?? deps.db, workspaceId, killEnv(deps.env));
  return {
    killPayouts: f.kill_payouts.on,
    killPaypalLive: f.kill_paypal_live.on,
    killAiLive: f.kill_ai_live.on,
  };
}

export function killSwitchOn(flag: SystemFlagName, setBy: string | null, setAt: Date | null): ApiProblem {
  const when = setAt ? ` ${setAt.toISOString().slice(11, 16)} UTC` : "";
  const who = setBy === "FS_KILL" ? "the operator (FS_KILL)" : (setBy ?? "the co-op");
  const what =
    flag === "kill_payouts"
      ? "payouts are paused by the co-op"
      : flag === "kill_paypal_live"
        ? "PayPal calls are paused"
        : "live AI is paused";
  return new ApiProblem("KILL_SWITCH_ON", `Refused: kill switch on, ${what} (set by ${who}${when}).`, {
    details: { flag },
  });
}

/** Throws 423 KILL_SWITCH_ON when `flag` is on (read fresh). */
export async function assertNotKilled(
  deps: Pick<AppDeps, "db" | "env">,
  workspaceId: string,
  flag: SystemFlagName,
  db?: DbOrTx,
): Promise<void> {
  const f = await readFlags(db ?? deps.db, workspaceId, killEnv(deps.env));
  const v = f[flag];
  if (v.on) throw killSwitchOn(flag, v.setBy, v.setAt);
}

const HALTABLE: readonly PayRunState[] = ["TREASURER_APPROVED", "AWAITING_BOARD", "APPROVED"];

export async function flagDto(
  deps: Pick<AppDeps, "db" | "env">,
  db: DbOrTx,
  workspaceId: string,
  flag: SystemFlagName,
): Promise<SystemFlagDTO> {
  const f = (await readFlags(db, workspaceId, killEnv(deps.env)))[flag];
  const forced = envKills(killEnv(deps.env)).has(flag);
  const [row] = await db
    .select()
    .from(schema.systemFlags)
    .where(and(eq(schema.systemFlags.workspaceId, workspaceId), eq(schema.systemFlags.flag, flag)));
  return {
    workspaceId,
    flag,
    on: f.on,
    setBy: row?.setBy ?? (forced ? "FS_KILL" : null),
    setAt: row?.setAt ? row.setAt.toISOString() : null,
    forcedByEnv: forced,
  };
}

/**
 * HALTs one run waiting on signatures or on its POST (S3.11 `kill_payouts`): its approvals voided, its lines
 * unlocked, the run HALTED with the switch as its reason. The caller holds the run lock.
 */
export async function haltRun(
  tx: DbOrTx,
  scope: WorkspaceScope,
  run: RunRow,
  at: Date,
  reason: SystemFlagName,
): Promise<RunRow> {
  await voidLiveApprovals(tx, scope, run.id, at, reason);
  const halted = await moveRun(tx, scope, {
    id: run.id,
    from: run.state as PayRunState,
    to: "HALTED",
    version: run.version,
    cause: cause("HALT", reason),
    provenance: "live",
    patch: { haltedReason: reason },
  });
  await unlockLines(tx, scope, run.id, "HALT");
  return halted;
}

/** The effect of `kill_payouts` turning on: HALT runs waiting on signatures and void their approvals. */
async function haltSigningRuns(tx: DbOrTx, scope: WorkspaceScope, at: Date): Promise<string[]> {
  const runs = await tx
    .select()
    .from(schema.payRuns)
    .where(and(eq(schema.payRuns.workspaceId, scope.workspaceId), inArray(schema.payRuns.state, HALTABLE)));
  const halted: string[] = [];
  for (const run of runs) {
    await haltRun(tx, scope, run, at, "kill_payouts");
    halted.push(run.id);
  }
  return halted;
}

/** Voids every live approval of a run (a line edit after key 1, a decline, a digest mismatch, a HALT). */
export async function voidLiveApprovals(
  tx: DbOrTx,
  scope: WorkspaceScope,
  runId: string,
  at: Date,
  why: string,
): Promise<number> {
  const t = schema.approvals;
  const voided = await tx
    .update(t)
    .set({ voidedAt: at, voidReason: why })
    .where(and(eq(t.workspaceId, scope.workspaceId), eq(t.runId, runId), isNull(t.voidedAt)))
    .returning({ id: t.id, role: t.role, nonce: t.nonce });
  for (const a of voided) {
    await factLedger(
      tx,
      scope,
      "approval.voided",
      {
        runId,
        approvalId: a.id,
        role: a.role === "board" ? "chair" : "treasurer",
        nonce: a.nonce,
        reasonSha256: noteSha256(why),
      },
      { runId, at },
    );
  }
  return voided.length;
}

/** LOCKED → READY for every line of a run whose approvals were voided before posting (fsm "UNLOCK"). */
export async function assertNoCashLines(tx: DbOrTx, scope: WorkspaceScope, runId: string): Promise<void> {
  const t = schema.memberLines;
  const [cash] = await tx
    .select({ id: t.id })
    .from(t)
    .where(
      and(
        eq(t.workspaceId, scope.workspaceId),
        eq(t.runId, runId),
        inArray(t.state, ["OFF_RAIL_DUE", "OFF_RAIL_PAID"]),
      ),
    )
    .limit(1);
  if (cash) throw new Error("Invariant I3: a run with cash already due or paid cannot return to review");
}

export async function unlockLines(
  tx: DbOrTx,
  scope: WorkspaceScope,
  runId: string,
  code: string,
): Promise<void> {
  await assertNoCashLines(tx, scope, runId);
  const t = schema.memberLines;
  const locked = await tx
    .select({ id: t.id, version: t.version, memberNo: schema.members.memberNo })
    .from(t)
    .innerJoin(schema.members, eq(schema.members.id, t.memberId))
    .where(and(eq(t.workspaceId, scope.workspaceId), eq(t.runId, runId), eq(t.state, "LOCKED")));
  for (const l of locked) {
    await moveLine(tx, scope, {
      id: l.id,
      memberNo: l.memberNo,
      runId,
      from: "LOCKED",
      to: "READY",
      version: l.version,
      cause: cause(code),
      provenance: "live",
    });
  }
}

export const setFlagHandler: CommandHandler<"setFlag"> = async (ctx) => {
  allow(ctx.credential, CAN.setFlag, "The kill switch");
  const { flag, on } = ctx.input;
  const at = ctx.now();
  const by = personaId(ctx.credential);
  const { deps, scope } = ctx;
  await withWorkspaceTx(deps.db, scope, async (tx) => {
    const t = schema.systemFlags;
    const [prev] = await tx
      .select({ on: t.on })
      .from(t)
      .where(and(eq(t.workspaceId, scope.workspaceId), eq(t.flag, flag)));
    if ((prev?.on ?? false) === on) return;
    await tx
      .insert(t)
      .values({ workspaceId: scope.workspaceId, flag, on, setBy: by, reason: null, setAt: at })
      .onConflictDoUpdate({
        target: [t.workspaceId, t.flag],
        set: { on, setBy: by, reason: null, setAt: at },
      });
    await factLedger(tx, scope, "flag.flipped", { flag, on }, { at });
    await emit(tx, scope, "flag.changed", { flag, on, by }, { provenance: "live" });
    if (flag === "kill_payouts" && on) await haltSigningRuns(tx, scope, at);
    if (!on && (flag === "kill_payouts" || flag === "kill_paypal_live")) {
      // The PayPal steps that waited the switch out (a written batch's POST, a re-route, a cancel) are due now,
      // and a written batch nothing waits for any more gets its POST back (same ids, I4 re-checked).
      await wakeWaitingPosts(tx, scope.workspaceId);
      await resumeStalledPosts({ db: tx, logger: deps.logger }, { workspaceId: scope.workspaceId });
    }
  });
  return { flag: await flagDto(deps, deps.db, scope.workspaceId, flag) };
};
