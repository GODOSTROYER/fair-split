// Judge Mode's live-or-replay decision, applied to every PayPal step of a judge workspace (S3.9, S3.11, C-06,
// plan "Limits"): Claude's invoice turn, ensureInvoice, recordPayment ("Mark paid"), the batch POST, the parked
// item's cancel and the re-route. Each asks `railForStep` before any PayPal call:
//
//   outside judge workspaces     live: the configured rail, no lane, no quota (the run slice's own guards stand)
//   a post whose batch PayPal    done: nothing is sent and no slot is taken (posted, or denied: the task completes;
//   already answered             ADOPT_FAILED, rows PayPal holds under our ids but not as ours, needs a person)
//   a post whose batch is        live with its ids or a wait, never a replay (rows PayPal may hold), and never live
//   written live, unanswered     without a slot dated within a lane lease of its POST: the run's held reservation
//                                (a quick retry), else a fresh one dated now that the quotas allow (`beginLiveStep`
//                                resume); otherwise the task waits and re-queues itself
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
//                                           naming the source run's real ids (`replayStep`);
//                                  live   → the step runs on the configured rail holding the lane; `end()` frees it
//                                           (the post settles its reservation with the outcome).
//
// Over quota is always a labelled replay, never a block: the rules require access "without any restriction".
// A replay never reaches PayPal, so it spends nothing: the replay rail's batches carry provenance `replay` and are
// counted neither as live posts (judge/quota.ts) nor by C-21's 40-a-day ceiling (money/payouts.ts). A post that
// replays settles `not_posted` a slot an earlier attempt of it took and never used (judge/quota.ts
// `releaseUnusedSlots`).
//
// I8, both ways, for two executors of one run's post (a lost outbox heartbeat) that decide differently:
//   - live rows are never replayed: `replayStep` re-reads the run's rows in the transaction that writes the post's
//     `judge.step.replayed` label, under the workspace lock; rows written live make it wait instead (its next attempt
//     resumes them live), and nothing is labelled. The repository writes a run's live rows under the same lock and
//     refuses a run labelled replayed, so the label, once written, is never followed by a live write: a post is never
//     labelled replayed beside a live POST (`runReplays` also ignores a post label an older build left beside live
//     rows). The repository refuses to resume, mark posted or mark rejected live rows on the replay rail besides.
//   - rows written as a replay are never POSTed live: the repository refuses them on a live rail when it reads them
//     (`loadPosting`, the re-route's `findSupersedingItem`) and when it would write over them (`writeSubmitted`),
//     all before the service's POST, so a live executor sends nothing; its next attempt replays to the end
//     (money/payouts.ts `refuseOtherRailRows`).
import type { PayoutItemStatus } from "@fairsplit/contracts";
import { appendLedger, type DbOrTx, schema, systemScope, withWorkspaceTx } from "@fairsplit/db";
import { getRun } from "@fairsplit/seed";
import { and, eq, sql } from "drizzle-orm";
import {
  beginLiveStep,
  ELSEWHERE_RETRY_MS,
  isJudgeWorkspace,
  type JudgeStep,
  judgeRail,
  judgeRuntime,
  type LivePostOutcome,
  NO_JUDGE_QUOTA,
  postSettled,
  type RailDecision,
  REPLAY_COPY,
  REPLAY_REASONS,
  type ReplayReason,
  releaseUnusedSlots,
  replayDecision,
  resumeWaitMs,
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
      /** A written batch's post only: why it waits to be posted live (absent while it waits for its turn). */
      waitingFor?: ReplayReason;
    };

/**
 * The post of a batch PayPal already answered: nothing to send, no slot to take. `answered`: PayPal named it (POSTED
 * or further) or denied it; `adopt_failed`: PayPal holds a batch under these ids that is not ours (ADOPT_FAILED,
 * settled `posted`): it needs a person and is never posted again.
 */
export interface DoneRail {
  kind: "done";
  reason: "answered" | "adopt_failed";
  payoutBatchId: string | null;
}

interface StepInput {
  workspaceId: string;
  runId: string;
  step: JudgeStep;
  amountCents?: number;
}

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
 * why: a run is live until one of its PayPal steps replays, then a replay to the end. A post label beside the run's
 * live primary rows says nothing (I8: those rows were never replayed; only an older build could leave one, since
 * `replayStep` labels a post only while no live row is written, and a live write refuses a labelled run).
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
               and not (e.payload->>'step' = 'post'
                        and exists (select 1 from payout_batches lb
                                     where lb.run_id = r.id and lb.workspace_id = r.workspace_id
                                       and lb.kind = 'primary' and lb.provenance <> 'replay'))
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
  // any step replayed before (the session's start, the invoice, the funding, the batch) makes the run a replay
  const replays =
    row.run === "replay" || row.invoice === "replay" || row.batch === true || row.step_reason !== null;
  const reason = isReason(row.step_reason)
    ? row.step_reason
    : isReason(row.session_reason)
      ? row.session_reason
      : null;
  return { replays, reason };
}

/**
 * The run's primary batch if it is already written on a live rail (rows SUBMITTED or further, not a replay), with
 * the total it spends and what PayPal said of it so far; null while nothing is written.
 */
async function liveBatchWritten(
  db: DbOrTx,
  workspaceId: string,
  runId: string,
): Promise<{ totalCents: number; status: string; paypalBatchId: string | null } | null> {
  const [row] = await db
    .select({
      totalCents: schema.payoutBatches.totalCents,
      status: schema.payoutBatches.status,
      paypalBatchId: schema.payoutBatches.paypalBatchId,
    })
    .from(schema.payoutBatches)
    .where(
      and(
        eq(schema.payoutBatches.workspaceId, workspaceId),
        eq(schema.payoutBatches.runId, runId),
        eq(schema.payoutBatches.kind, "primary"),
        sql`${schema.payoutBatches.provenance} <> 'replay'`,
      ),
    )
    .limit(1);
  return row
    ? { totalCents: Number(row.totalCents), status: row.status, paypalBatchId: row.paypalBatchId }
    : null;
}

/**
 * One `judge.step.replayed` entry per run and step (ids and enums only): why it replays, and from which run. For the
 * post, I8's check then act: the run's rows are re-read in the same transaction, under the workspace lock the
 * repository's live write takes too (money/payouts.ts `writeSubmitted`, which refuses a labelled run), so the label is
 * written only while no live row is, and no live row follows it. False (nothing written) when live rows are there.
 */
async function recordReplayed(
  deps: AppDeps,
  o: { workspaceId: string; runId: string; step: JudgeStep; reason: ReplayReason },
  source: ReplaySource | null,
): Promise<boolean> {
  const scope = systemScope(o.workspaceId, STEP_ACTOR);
  return withWorkspaceTx(deps.db, scope, async (tx) => {
    if (o.step === "post" && (await liveBatchWritten(tx, o.workspaceId, o.runId))) return false;
    if (!source) return true;
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
    if (seen) return true;
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
    return true;
  });
}

/**
 * Runs one judge step of a run on the replay rail (see the header), deciding `decision` (a replay). I8, check then
 * act: a post whose rows another executor of the run wrote live since they were read is never replayed; the rows are
 * re-read under the workspace lock in the transaction that writes the label (`recordReplayed`), so the post waits
 * instead (`queued`: its next attempt resumes them live), and nothing is labelled. A post that replays frees the slots
 * its earlier attempts took and never used (judge/quota.ts `releaseUnusedSlots`), after its label is written (no live
 * write can follow it).
 */
export async function replayStep(
  deps: AppDeps,
  o: { workspaceId: string; runId: string; step: JudgeStep },
  decision: RailDecision,
): Promise<StepRail> {
  // a burst that will not run live must not keep the turn it was promised (the session start joins the lane)
  judgeRuntime(deps).lane.release({ workspaceId: o.workspaceId, step: o.step });
  const replay = await replayDeps(deps, decision);
  const source = isReplayRail(replay.paypal) ? replay.paypal.replay.source : null;
  const labelled =
    source === null && o.step !== "post"
      ? true
      : await recordReplayed(
          deps,
          { ...o, reason: (decision.reason ?? "kill_switch") as ReplayReason },
          source,
        );
  if (!labelled) return { kind: "queued", retryAfterMs: ELSEWHERE_RETRY_MS, position: null };
  if (o.step === "post") await releaseUnusedSlots(deps, o.runId);
  return { kind: "replay", deps: replay, decision };
}

/** See the header: the rail one PayPal step of a run runs on, decided fresh before any PayPal call. */
export async function railForStep(
  deps: AppDeps,
  o: StepInput & { step: "post" },
): Promise<StepRail | DoneRail>;
export async function railForStep(
  deps: AppDeps,
  o: StepInput & { step: Exclude<JudgeStep, "post"> },
): Promise<StepRail>;
export async function railForStep(deps: AppDeps, o: StepInput): Promise<StepRail | DoneRail> {
  const live = (): StepRail => ({ kind: "live", deps, end: async () => undefined });
  if (!(await isJudgeWorkspace(deps.db, o.workspaceId))) return live();
  const written = o.step === "post" ? await liveBatchWritten(deps.db, o.workspaceId, o.runId) : null;
  if (written) {
    // Only a batch still waiting for PayPal's answer is posted again (SUBMITTED, no PayPal id): one PayPal named or
    // denied completes the task, and one PayPal holds under our ids but not as ours (ADOPT_FAILED: its slot settled
    // `posted`) needs a person. Neither takes a slot, so neither weighs on anyone's quota again.
    if (written.paypalBatchId !== null || written.status !== "SUBMITTED") {
      return { kind: "done", reason: "answered", payoutBatchId: written.paypalBatchId };
    }
    if (await postSettled(deps.db, o.runId)) {
      return { kind: "done", reason: "adopt_failed", payoutBatchId: null };
    }
    // A batch written live is resumed live with its ids, never replayed (that would mark rows PayPal may hold
    // as posted under a replay id), and never live without a slot dated within a lane lease of its POST:
    // `beginLiveStep` (resume) takes the single-flight lane and posts under the slot the run holds while it still
    // carries the POST (a quick retry), or under a fresh one dated now that the quotas still allow (reserved under
    // the quota lock, its own run left out of the counts); otherwise it waits, as it does for a switch, the
    // simulator, the circuit or a full lane, and the task re-queues itself (runs/now.ts deferTask).
    const step = await beginLiveStep(deps, {
      workspaceId: o.workspaceId,
      step: "post",
      runId: o.runId,
      resume: true,
      amountCents: written.totalCents,
    });
    if (step.kind === "queued") {
      return {
        kind: "queued",
        retryAfterMs: Math.max(1_000, step.retryAfterMs),
        position: step.position,
        ...(step.waitingFor ? { waitingFor: step.waitingFor } : {}),
      };
    }
    if (step.kind === "replay") {
      // never: a resumed post waits instead; kept so a written batch can never reach the replay rail
      const reason = step.decision.reason ?? "kill_switch";
      return {
        kind: "queued",
        retryAfterMs: resumeWaitMs(reason, deps.clock.now()),
        position: null,
        waitingFor: reason,
      };
    }
    return { kind: "live", deps, end: (outcome) => step.end(outcome ?? null) };
  }
  // I8, check then act: rows another executor of this run wrote live since the read above are never replayed
  // (`replayStep` re-reads them under the workspace lock and waits instead).
  const replay = (decision: RailDecision): Promise<StepRail> => replayStep(deps, o, decision);
  const sticky = await runReplays(deps.db, o.workspaceId, o.runId);
  if (sticky.replays) {
    let reason = sticky.reason;
    if (!reason) {
      const fresh = await judgeRail(deps, { workspaceId: o.workspaceId, sessionId: null, step: o.step });
      reason = fresh.reason ?? "kill_switch";
    }
    return replay(replayDecision(reason, deps.paypal.label, NO_JUDGE_QUOTA));
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
  if (step.kind === "replay") return replay(step.decision);
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

/**
 * A judge step waiting its turn in the live lane, or a written batch waiting to be posted live (money/rail.ts):
 * it re-queues itself for that turn.
 */
export class LaneQueued extends PayPalStepError {
  constructor(rail: { retryAfterMs: number; position: number | null; waitingFor?: ReplayReason }) {
    super(
      "QUEUED",
      rail.waitingFor
        ? `The batch is written and waits to be posted live with the same ids (${REPLAY_COPY[rail.waitingFor]}); it is never replayed.`
        : rail.position === null
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
