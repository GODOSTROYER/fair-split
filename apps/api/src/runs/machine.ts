// I5 at the HTTP boundary: every state write is a compare-and-set on state AND version,
//
//   UPDATE … SET state = $to, version = version + 1 WHERE id = $id AND workspace_id = $ws
//                                                       AND state = $from [AND version = $expected]
//
// after the edge itself is checked against the pure machines in `@fairsplit/domain` (`fsm.run`, `fsm.line`).
// Zero rows means someone else moved first: a `CasConflict` carries what the row holds now, and the
// handler answers VERSION_CONFLICT or INVALID_TRANSITION. A successful move appends its IC-01 event
// (`run.state`, `line.state`, `hold.resolved`) in the same transaction. Callers open the transaction with
// `withWorkspaceTx` so the workspace lock comes before these row locks (packages/db/src/tx.ts lock order).
import type {
  Cause,
  HoldResolutionKind,
  HoldState,
  MemberLineState,
  PayRunState,
  Provenance,
} from "@fairsplit/contracts";
import { type Actor, type DbOrTx, schema, type WorkspaceScope } from "@fairsplit/db";
import { lineMachine, runMachine } from "@fairsplit/domain";
import { and, eq, sql } from "drizzle-orm";
import { emit } from "./events.js";

export type RunRow = typeof schema.payRuns.$inferSelect;
export type LineRow = typeof schema.memberLines.$inferSelect;
export type HoldRow = typeof schema.holds.$inferSelect;

/** Someone moved the row first (or the edge is not in the machine). */
export class CasConflict extends Error {
  override readonly name = "CasConflict";
  constructor(
    readonly entity: "run" | "line" | "hold",
    readonly id: string,
    readonly reason: "ILLEGAL" | "STALE" | "NOT_FOUND",
    readonly current: { state: string; version: number } | null,
    message: string,
  ) {
    super(message);
  }
}

export const cause = (code: string, ref: string | null = null): Cause => ({ code, ref });

// ---------------------------------------------------------------- runs

export interface RunMove {
  id: string;
  from: PayRunState;
  to: PayRunState;
  /** Compare-and-set on version too (the version the caller read). */
  version?: number;
  cause: Cause;
  provenance: Provenance;
  actor?: Actor;
  patch?: Partial<Omit<typeof schema.payRuns.$inferInsert, "id" | "workspaceId" | "state" | "version">>;
}

export async function moveRun(tx: DbOrTx, scope: WorkspaceScope, m: RunMove): Promise<RunRow> {
  if (!runMachine.canTransition(m.from, m.to)) {
    throw new CasConflict("run", m.id, "ILLEGAL", null, `${m.from} → ${m.to} is not a run transition`);
  }
  const t = schema.payRuns;
  const [row] = await tx
    .update(t)
    .set({ ...(m.patch ?? {}), state: m.to, version: sql`${t.version} + 1` })
    .where(
      and(
        eq(t.workspaceId, scope.workspaceId),
        eq(t.id, m.id),
        eq(t.state, m.from),
        ...(m.version === undefined ? [] : [eq(t.version, m.version)]),
      ),
    )
    .returning();
  if (!row) throw await staleRun(tx, scope, m.id, `${m.from} → ${m.to}`);
  await emit(
    tx,
    scope,
    "run.state",
    { runId: m.id, from: m.from, to: m.to, cause: m.cause },
    { runId: m.id, provenance: m.provenance, ...(m.actor ? { actor: m.actor } : {}) },
  );
  return row;
}

/** Bumps a run's version without a state change (a review edit), compare-and-set on state and version. */
export async function touchRun(
  tx: DbOrTx,
  scope: WorkspaceScope,
  r: { id: string; state: PayRunState; version?: number },
): Promise<RunRow> {
  const t = schema.payRuns;
  const [row] = await tx
    .update(t)
    .set({ version: sql`${t.version} + 1` })
    .where(
      and(
        eq(t.workspaceId, scope.workspaceId),
        eq(t.id, r.id),
        eq(t.state, r.state),
        ...(r.version === undefined ? [] : [eq(t.version, r.version)]),
      ),
    )
    .returning();
  if (!row) throw await staleRun(tx, scope, r.id, `edit in ${r.state}`);
  return row;
}

async function staleRun(tx: DbOrTx, scope: WorkspaceScope, id: string, what: string): Promise<CasConflict> {
  const t = schema.payRuns;
  const [cur] = await tx
    .select({ state: t.state, version: t.version })
    .from(t)
    .where(and(eq(t.workspaceId, scope.workspaceId), eq(t.id, id)));
  return cur
    ? new CasConflict("run", id, "STALE", cur, `run moved first (${what}; now ${cur.state} v${cur.version})`)
    : new CasConflict("run", id, "NOT_FOUND", null, `run ${id} not found`);
}

// ---------------------------------------------------------------- member lines

export interface LineMove {
  id: string;
  memberNo: string;
  runId: string;
  from: MemberLineState;
  to: MemberLineState;
  version?: number;
  cause: Cause;
  provenance: Provenance;
  actor?: Actor;
  patch?: Partial<
    Omit<typeof schema.memberLines.$inferInsert, "id" | "workspaceId" | "state" | "version" | "runId">
  >;
}

export async function moveLine(tx: DbOrTx, scope: WorkspaceScope, m: LineMove): Promise<LineRow> {
  if (!lineMachine.canTransition(m.from, m.to)) {
    throw new CasConflict("line", m.id, "ILLEGAL", null, `${m.from} → ${m.to} is not a line transition`);
  }
  const t = schema.memberLines;
  const [row] = await tx
    .update(t)
    .set({ ...(m.patch ?? {}), state: m.to, provenance: m.provenance, version: sql`${t.version} + 1` })
    .where(
      and(
        eq(t.workspaceId, scope.workspaceId),
        eq(t.id, m.id),
        eq(t.state, m.from),
        ...(m.version === undefined ? [] : [eq(t.version, m.version)]),
      ),
    )
    .returning();
  if (!row) {
    const [cur] = await tx
      .select({ state: t.state, version: t.version })
      .from(t)
      .where(and(eq(t.workspaceId, scope.workspaceId), eq(t.id, m.id)));
    throw cur
      ? new CasConflict("line", m.id, "STALE", cur, `line moved first (now ${cur.state})`)
      : new CasConflict("line", m.id, "NOT_FOUND", null, `line ${m.id} not found`);
  }
  await emit(
    tx,
    scope,
    "line.state",
    { lineId: m.id, memberNo: m.memberNo, from: m.from, to: m.to, cause: m.cause },
    { runId: m.runId, lineId: m.id, provenance: m.provenance, ...(m.actor ? { actor: m.actor } : {}) },
  );
  return row;
}

// ---------------------------------------------------------------- holds

const HOLD_EDGES: Readonly<Record<HoldState, readonly HoldState[]>> = {
  OPEN: ["ASKED_CHAIR", "RESOLVED", "EXCLUDED"],
  ASKED_CHAIR: ["RESOLVED", "EXCLUDED"],
  RESOLVED: [],
  EXCLUDED: [],
};

export interface HoldMove {
  hold: HoldRow;
  to: HoldState;
  /** Required for RESOLVED/EXCLUDED: the resolution kind and its parameters. */
  resolution?: { kind: HoldResolutionKind; by: string; at: string; reason: string | null } & Record<
    string,
    unknown
  >;
  resolvedBy: string;
  provenance: Provenance;
  actor?: Actor;
  at: Date;
}

export async function moveHold(tx: DbOrTx, scope: WorkspaceScope, m: HoldMove): Promise<HoldRow> {
  const from = m.hold.state as HoldState;
  if (!HOLD_EDGES[from].includes(m.to)) {
    throw new CasConflict("hold", m.hold.id, "ILLEGAL", null, `${from} → ${m.to} is not a hold transition`);
  }
  const terminal = m.to === "RESOLVED" || m.to === "EXCLUDED";
  if (terminal && !m.resolution) throw new TypeError("a resolved hold needs its resolution");
  const t = schema.holds;
  const [row] = await tx
    .update(t)
    .set({
      state: m.to,
      version: sql`${t.version} + 1`,
      ...(terminal ? { resolvedBy: m.resolvedBy, resolvedAt: m.at, resolution: m.resolution ?? null } : {}),
    })
    .where(
      and(
        eq(t.workspaceId, scope.workspaceId),
        eq(t.id, m.hold.id),
        eq(t.state, from),
        eq(t.version, m.hold.version),
      ),
    )
    .returning();
  if (!row) {
    const [cur] = await tx
      .select({ state: t.state, version: t.version })
      .from(t)
      .where(and(eq(t.workspaceId, scope.workspaceId), eq(t.id, m.hold.id)));
    throw cur
      ? new CasConflict("hold", m.hold.id, "STALE", cur, `hold moved first (now ${cur.state})`)
      : new CasConflict("hold", m.hold.id, "NOT_FOUND", null, `hold ${m.hold.id} not found`);
  }
  if (terminal && m.resolution) {
    await emit(
      tx,
      scope,
      "hold.resolved",
      {
        holdId: row.id,
        label: row.code ?? row.kind,
        state: m.to,
        resolution: m.resolution.kind,
        resolvedBy: m.resolution.by,
      },
      {
        runId: row.runId,
        lineId: row.lineId,
        provenance: m.provenance,
        ...(m.actor ? { actor: m.actor } : {}),
      },
    );
  }
  return row;
}
