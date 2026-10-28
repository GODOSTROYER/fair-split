// Judge Mode's live-or-replay decision, applied to every PayPal step of a judge workspace (S3.9, S3.11, C-06,
// plan "Limits"): Claude's invoice turn, ensureInvoice, recordPayment ("Mark paid"), the batch POST, the parked
// item's cancel and the re-route. Each asks `railForStep` before any PayPal call:
//
//   outside judge workspaces     live: the configured rail, no lane, no quota (the run slice's own guards stand)
//   a run that already replays   replay, to the end (a run is live until one of its PayPal steps replays: its
//                                session started as a replay, or its invoice or batch was replayed)
//   otherwise                    judge/live-step.ts `beginLiveStep`: a fresh peek (kill_paypal_live, the simulator
//                                stub, the 429 circuit, an unknown or low balance, the daily, hourly, per-cookie and
//                                public quotas), then the single-flight lane (in this process, and across processes
//                                through a Postgres advisory lock), then the binding decision WHILE holding it (the
//                                post reserves its slot under the quota lock):
//                                  queued → the task re-queues itself (runs/now.ts deferTask) for its turn;
//                                  replay → the step runs on the replay rail (paypal/replay.ts): no PayPal call,
//                                           every row and event `replay`, a `judge.step.replayed` ledger entry
//                                           naming the source run's real ids;
//                                  live   → the step runs on the configured rail holding the lane; `end()` frees it
//                                           (the post settles its reservation with the outcome).
//
// Over quota is always a labelled replay, never a block: the rules require access "without any restriction".
// A replay never reaches PayPal, so it spends nothing: the replay rail's batches carry provenance `replay` and are
// counted neither as live posts (judge/quota.ts) nor by C-21's 40-a-day ceiling (money/payouts.ts).
import type { PayoutItemStatus } from "@fairsplit/contracts";
import { appendLedger, type DbOrTx, schema, systemScope, withWorkspaceTx } from "@fairsplit/db";
import { getRun } from "@fairsplit/seed";
import { and, eq, sql } from "drizzle-orm";
import {
  beginLiveStep,
  isJudgeWorkspace,
  type JudgeStep,
  judgeRail,
  judgeRuntime,
  type LivePostOutcome,
  NO_JUDGE_QUOTA,
  type RailDecision,
  REPLAY_REASONS,
  type ReplayReason,
  replayDecision,
} from "../judge/index.js";
import type { AppDeps } from "../lib/context.js";
import { isReplayRail, type ReplaySource, replayRail } from "../paypal/replay.js";
import { PayPalStepError } from "./errors.js";
import { partiesOf } from "./policy.js";

export type StepRail =
  | {
      kind: "live";
      deps: AppDeps;
      /** Frees the lane (and settles the post's reservation with its outcome). Always call it, in `finally`. */
      end(outcome?: LivePostOutcome | null): Promise<void>;
    }
  | { kind: "replay"; deps: AppDeps; decision: RailDecision }
  | {
      kind: "queued";
      /** When to ask again. */
      retryAfterMs: number;
      /** Bursts ahead (null when another process holds the lane). */
      position: number | null;
    };

const LEDGER_KIND = "judge.step.replayed";
const STEP_ACTOR = { kind: "system", id: "system:judge-lane", impersonatedBy: null } as const;

const settleStatus = (status: string, cancelled: boolean): PayoutItemStatus =>
  // an item our cancel returned (the cash path) was UNCLAIMED when the settle GET read it
  (status === "RETURNED" && cancelled ? "UNCLAIMED" : status) as PayoutItemStatus;

/**
 * The run PayPal steps replay from: the latest settled live run on this rail (any workspace: they all pay from
 * the one business account), else the showcase run r37, else the seed snapshot (whose ids are synthetic).
 */
export async function replaySource(db: DbOrTx, provenance: "live" | "simulated_rail"): Promise<ReplaySource> {
  const pick = async (filter: ReturnType<typeof sql>) =>
    (
      (await db.execute(sql`
        select r.run_slug, pb.id::text as batch_id, pb.paypal_batch_id, pb.submitted_at,
               i.paypal_invoice_id, i.payer_view_url
          from pay_runs r
          join workspaces w on w.id = r.workspace_id
          join payout_batches pb on pb.run_id = r.id and pb.workspace_id = r.workspace_id
                                and pb.kind = 'primary' and pb.paypal_batch_id is not null
          left join invoices i on i.run_id = r.id and i.workspace_id = r.workspace_id
         where ${filter}
         order by pb.submitted_at desc
         limit 1`)) as unknown as {
        run_slug: string;
        batch_id: string;
        paypal_batch_id: string;
        submitted_at: Date | string;
        paypal_invoice_id: string | null;
        payer_view_url: string | null;
      }[]
    )[0];
  const live = await pick(
    sql`r.state in ('SETTLED', 'CLOSED') and pb.provenance = ${provenance} and r.provenance = ${provenance}`,
  );
  const row = live ?? (await pick(sql`w.kind = 'showcase' and pb.provenance <> 'replay'`));
  if (row) {
    const items = (await db.execute(sql`
      select m.member_no, pi.status, pi.cancel_requested_at is not null as cancelled, pi.fee_cents::text as fee
        from payout_items pi
        join member_lines ml on ml.id = pi.line_id and ml.workspace_id = pi.workspace_id
        join members m on m.id = ml.member_id and m.workspace_id = ml.workspace_id
       where pi.batch_id = ${row.batch_id}`)) as unknown as {
      member_no: string;
      status: string;
      cancelled: boolean;
      fee: string | null;
    }[];
    return {
      kind: live ? "live_run" : "showcase",
      runSlug: row.run_slug,
      recordedOn: new Date(row.submitted_at).toISOString().slice(0, 10),
      invoiceId: row.paypal_invoice_id,
      payerViewUrl: row.payer_view_url,
      payoutBatchId: row.paypal_batch_id,
      items: new Map(
        items.map((i) => [
          i.member_no,
          { status: settleStatus(i.status, i.cancelled), feeCents: i.fee === null ? null : Number(i.fee) },
        ]),
      ),
    };
  }
  const seed = getRun();
  return {
    kind: "seed",
    runSlug: seed.runSlug,
    recordedOn: seed.recordedOn,
    invoiceId: null,
    payerViewUrl: null,
    payoutBatchId: null,
    items: new Map(
      seed.items.map((i) => [
        i.memberNo,
        { status: settleStatus(i.status, i.status === "RETURNED"), feeCents: null },
      ]),
    ),
  };
}

/** The same deps on the replay rail (paypal/replay.ts): nothing they do reaches PayPal; everything is `replay`. */
export async function replayDeps<D extends Pick<AppDeps, "db" | "env" | "paypal" | "clock">>(
  deps: D,
  decision: Pick<RailDecision, "reason" | "label">,
): Promise<D> {
  if (isReplayRail(deps.paypal)) return deps;
  const source = await replaySource(deps.db, deps.paypal.label === "sandbox" ? "live" : "simulated_rail");
  const parties = partiesOf(deps);
  return {
    ...deps,
    paypal: replayRail(deps.paypal, {
      db: deps.db,
      now: () => deps.clock.now(),
      businessEmail: parties.businessEmail,
      payerEmail: parties.payer.email,
      unclaimedReceiver: deps.env.paypal.unclaimedReceiver ?? null,
      source,
      reason: decision.reason ?? "kill_switch",
      label: `${decision.label} (replay of the ${source.recordedOn} run ${source.runSlug})`,
    }),
  };
}

/** The replay rail a replayed run's later steps run on (its settle GETs, its cancels): why it replays, kept. */
export async function replayDepsForRun<D extends Pick<AppDeps, "db" | "env" | "paypal" | "clock">>(
  deps: D,
  workspaceId: string,
  runId: string,
): Promise<D> {
  const why = await runReplays(deps.db, workspaceId, runId);
  return replayDeps(deps, replayDecision(why.reason ?? "kill_switch", deps.paypal.label, NO_JUDGE_QUOTA));
}

const isReason = (r: string | null | undefined): r is ReplayReason =>
  !!r && (REPLAY_REASONS as readonly string[]).includes(r);

/**
 * Whether a run already replays (its session started as a replay, or one of its PayPal steps was replayed), and
 * why: a run is live until one of its PayPal steps replays, then a replay to the end.
 */
export async function runReplays(
  db: DbOrTx,
  workspaceId: string,
  runId: string,
): Promise<{ replays: boolean; reason: ReplayReason | null }> {
  const [row] = (await db.execute(sql`
    select r.provenance as run,
           (select i.provenance from invoices i where i.run_id = r.id and i.workspace_id = r.workspace_id) as invoice,
           exists (select 1 from payout_batches pb
                    where pb.run_id = r.id and pb.workspace_id = r.workspace_id and pb.provenance = 'replay') as batch,
           (select e.payload->>'reason' from ledger_entries e
             where e.workspace_id = r.workspace_id and e.run_id = r.id and e.kind = ${LEDGER_KIND}
             order by e.seq desc limit 1) as step_reason,
           (select e.payload->>'replayReason' from ledger_entries e
             where e.workspace_id = r.workspace_id and e.run_id = r.id and e.kind = 'judge.session.started'
             order by e.seq limit 1) as session_reason
      from pay_runs r
     where r.id = ${runId} and r.workspace_id = ${workspaceId}`)) as unknown as {
    run: string;
    invoice: string | null;
    batch: boolean;
    step_reason: string | null;
    session_reason: string | null;
  }[];
  if (!row) return { replays: false, reason: null };
  const replays = row.run === "replay" || row.invoice === "replay" || row.batch === true;
  const reason = isReason(row.step_reason)
    ? row.step_reason
    : isReason(row.session_reason)
      ? row.session_reason
      : null;
  return { replays, reason };
}

/** One `judge.step.replayed` entry per run and step (ids and enums only): why it replays, and from which run. */
async function recordReplayed(
  deps: AppDeps,
  o: { workspaceId: string; runId: string; step: JudgeStep; reason: ReplayReason },
  source: ReplaySource,
): Promise<void> {
  const scope = systemScope(o.workspaceId, STEP_ACTOR);
  await withWorkspaceTx(deps.db, scope, async (tx) => {
    const [seen] = await tx
      .select({ id: schema.ledgerEntries.id })
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, o.workspaceId),
          eq(schema.ledgerEntries.runId, o.runId),
          eq(schema.ledgerEntries.kind, LEDGER_KIND),
          sql`${schema.ledgerEntries.payload}->>'step' = ${o.step}`,
        ),
      )
      .limit(1);
    if (seen) return;
    await appendLedger(tx, scope, {
      kind: LEDGER_KIND,
      payload: {
        runId: o.runId,
        step: o.step,
        reason: o.reason,
        source: {
          kind: source.kind,
          runSlug: source.runSlug,
          recordedOn: source.recordedOn,
          invoiceId: source.invoiceId,
          payoutBatchId: source.payoutBatchId,
        },
      },
      runId: o.runId,
      at: deps.clock.now(),
    });
  });
}

async function replaying(
  deps: AppDeps,
  o: { workspaceId: string; runId: string; step: JudgeStep },
  decision: RailDecision,
): Promise<StepRail> {
  // a burst that will not run live must not keep the turn it was promised (the session start joins the lane)
  judgeRuntime(deps).lane.release({ workspaceId: o.workspaceId, step: o.step });
  const replay = await replayDeps(deps, decision);
  if (isReplayRail(replay.paypal)) {
    await recordReplayed(
      deps,
      { ...o, reason: (decision.reason ?? "kill_switch") as ReplayReason },
      replay.paypal.replay.source,
    );
  }
  return { kind: "replay", deps: replay, decision };
}

/** See the header: the rail one PayPal step of a run runs on, decided fresh before any PayPal call. */
export async function railForStep(
  deps: AppDeps,
  o: { workspaceId: string; runId: string; step: JudgeStep; amountCents?: number },
): Promise<StepRail> {
  const live = (): StepRail => ({ kind: "live", deps, end: async () => undefined });
  if (!(await isJudgeWorkspace(deps.db, o.workspaceId))) return live();
  const sticky = await runReplays(deps.db, o.workspaceId, o.runId);
  if (sticky.replays) {
    let reason = sticky.reason;
    if (!reason) {
      const fresh = await judgeRail(deps, { workspaceId: o.workspaceId, sessionId: null, step: o.step });
      reason = fresh.reason ?? "kill_switch";
    }
    return replaying(deps, o, replayDecision(reason, deps.paypal.label, NO_JUDGE_QUOTA));
  }
  const step = await beginLiveStep(deps, {
    workspaceId: o.workspaceId,
    step: o.step,
    ...(o.step === "post" ? { runId: o.runId } : {}),
    ...(o.amountCents !== undefined ? { amountCents: o.amountCents } : {}),
  });
  if (step.kind === "queued") {
    return { kind: "queued", retryAfterMs: Math.max(1_000, step.retryAfterMs), position: step.position };
  }
  if (step.kind === "replay") return replaying(deps, o, step.decision);
  return { kind: "live", deps, end: (outcome) => step.end(outcome ?? null) };
}

/**
 * The rail a step on an EXISTING payout item runs on (its settle GET, its cancel, its re-route): a replayed item
 * stays on the replay rail (it exists only in the replay); a live item is never replayed (that would fake a
 * cancel or a payment PayPal never made), so its step runs live, through the lane in a judge workspace.
 */
export async function railForItem(
  deps: AppDeps,
  o: { workspaceId: string; runId: string; step: JudgeStep; itemProvenance: string },
): Promise<StepRail | { kind: "refused"; decision: RailDecision }> {
  if (o.itemProvenance === "replay") {
    const why = await runReplays(deps.db, o.workspaceId, o.runId);
    const decision = replayDecision(why.reason ?? "kill_switch", deps.paypal.label, NO_JUDGE_QUOTA);
    return { kind: "replay", deps: await replayDeps(deps, decision), decision };
  }
  if (!(await isJudgeWorkspace(deps.db, o.workspaceId))) {
    return { kind: "live", deps, end: async () => undefined };
  }
  const step = await beginLiveStep(deps, { workspaceId: o.workspaceId, step: o.step });
  if (step.kind === "queued") {
    return { kind: "queued", retryAfterMs: Math.max(1_000, step.retryAfterMs), position: step.position };
  }
  if (step.kind === "replay") return { kind: "refused", decision: step.decision };
  return { kind: "live", deps, end: (outcome) => step.end(outcome ?? null) };
}

/** A judge step waiting its turn in the live lane (money/rail.ts): it re-queues itself for that turn. */
export class LaneQueued extends PayPalStepError {
  constructor(rail: { retryAfterMs: number; position: number | null }) {
    super(
      "QUEUED",
      rail.position === null
        ? "Another live PayPal run is in progress; this step is next in line."
        : `This step is number ${rail.position + 1} in the live PayPal lane.`,
      { transient: true, retryAfterMs: rail.retryAfterMs },
    );
  }
}

/** A live item's step the rail would replay: never replayed (that would fake PayPal), refused or waited out. */
export function notReplayable(decision: RailDecision): PayPalStepError {
  if (decision.reason === "kill_switch") {
    return new PayPalStepError("KILL_SWITCH_ON", "PayPal calls are paused by the kill switch.", {
      transient: false,
    });
  }
  return new PayPalStepError(
    decision.reason === "circuit_open" ? "CIRCUIT_OPEN" : "QUEUED",
    `PayPal steps wait: ${decision.label}.`,
    { transient: true, retryAfterMs: decision.reason === "circuit_open" ? 6 * 60_000 : 30_000 },
  );
}
