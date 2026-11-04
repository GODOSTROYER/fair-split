// One judge through the 60-second loop over HTTP, in the order the e2e `api` project drives it (e2e/lib/judge-run.ts,
// specs/api/cold-judge-timing.spec.ts): the first press with no cookie, two live event streams on the run (the stage
// opens five; two is the per-credential cap), INVOICED, Mark paid (a QUEUED answer honoured), the reading to
// IN_REVIEW, slip 0462 by hand and holds H1–H3 resolved, both officers' browser demo keys, both keys, the payout POST,
// Rhea's line to cash, SETTLED, Proof, and Reset. Waits follow the event stream, with a GET of the run every few
// seconds as a fallback (the console's own pattern), never a tight poll.
//
// Every judge reports what its run was (live or replay, and why), what each step took, and whether the labels held:
// a replayed payout must carry replay provenance on its item updates and a "replay" Proof, never a verified one.
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { ApprovalPayload, CreateJudgeSessionResponse } from "@fairsplit/contracts";
import { approvalBytes, ed25519Sign, jcs } from "@fairsplit/domain";
import {
  type Answer,
  type EventStream,
  type Hdrs,
  type JudgeClient,
  type StreamEvent,
  sleep,
} from "./client.js";

export const SIMULATED_LABEL = "Simulated PayPal sandbox (contract-tested against PayPal's OpenAPI specs)";

/** The run's states in their forward order (I5: state only moves forward, apart from the I4 send-back). */
export const STATE_ORDER = [
  "DRAFT",
  "QUOTED",
  "INVOICED",
  "FUNDED",
  "EXTRACTING",
  "COMPUTED",
  "IN_REVIEW",
  "TREASURER_APPROVED",
  "AWAITING_BOARD",
  "APPROVED",
  "POSTING",
  "POSTED",
  "SETTLING",
  "NEEDS_FOLLOW_UP",
  "SETTLED",
] as const;

const tallyOf = (xs: readonly string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].map(([k, n]) => `${k}:${n}`).join(" ");
};

export const rank = (state: string | null | undefined) =>
  STATE_ORDER.indexOf((state ?? "") as (typeof STATE_ORDER)[number]);

/** The seed's review (e2e/lib/judge-run.ts HOLD_RESOLUTIONS). */
const HOLD_RESOLUTIONS: Readonly<Record<string, unknown>> = {
  H1: { resolution: "COUNT_ONCE" },
  H2: { resolution: "REGISTER_PLOT", plot: { plotNo: "P-053-B", areaHa: "0.60", trees: 330 } },
  H3: { resolution: "RETURN_AS_CREDIT" },
};

export type Outcome =
  | "settled" // the whole loop, Proof and Reset
  | "press_refused" // the first press was refused (429 RATE_LIMITED, or a QUEUED that never cleared)
  | "stuck" // a step did not arrive within its budget
  | "error"; // an answer the loop did not expect

export interface JudgeResult {
  judge: number;
  ip: string;
  outcome: Outcome;
  /** The step that failed or stalled ("" when settled). */
  failedAt: string;
  detail: string;
  /** live | replay (the judge session's rail decision at the press), "" when the press was refused. */
  rail: string;
  railReason: string;
  /** Rail at the payout (GET /v1/judge/session after both keys), which can differ from the press. */
  payoutRail: string;
  payoutReason: string;
  pressStatus: number;
  /** Times from the first press, ms (NaN when not reached). */
  pressMs: number;
  invoicedMs: number;
  fundedMs: number;
  inReviewMs: number;
  keysMs: number;
  /** The run.state POSTING event: fs-api is sending the payouts POST (the 60 s budget's end). */
  postingMs: number;
  postedMs: number;
  settledMs: number;
  proofMs: number;
  resetMs: number;
  markPaidQueued: number;
  /** The pay-cash answer when PayPal's pacing deferred Rhea's cancel ("503 CIRCUIT_OPEN"), else "". */
  cashPaced: string;
  /** Proof's verification status (sample | replay | …) and the payout-items plate's state. */
  proofStatus: string;
  payoutPlate: string;
  paypalVerified: number;
  /** The PAID lines' provenance ("seeded:7"), and for a replayed payout the Proof export's batch items. */
  paidLineProvenance: string;
  exportItems: string;
  /** Label checks: each counts violations (0 = the labels held). */
  labelViolations: number;
  labelNotes: string;
  /** Lines' states after settling ("PAID:7 OFF_RAIL_DUE:57"). */
  lines: string;
  events: number;
  streamRefusals: number;
  streamReconnects: number;
}

export interface FanoutSample {
  /** Event write time (`at`, clock_timestamp() at insert) to arrival on each of the run's two streams, ms. */
  lagA: number;
  lagB: number;
  /** |arrival on A − arrival on B|: how far apart two subscribers of the same run hear the same event. */
  spread: number;
  /**
   * True for the last-written event of a burst (events arriving within 3 ms of each other on stream A, which is how
   * one transaction's events arrive). Its write time is the closest to the transaction's commit, so its lag is the
   * best client-side estimate of commit → delivery; the lag of earlier events in the burst also counts the time the
   * transaction kept running after writing them.
   */
  tail: boolean;
}

export interface JudgeOptions {
  /** Budget for one awaited step (a judge's patience). */
  stepMs?: number;
  /** Fallback GET of the run while waiting for an event. */
  fallbackGetMs?: number;
  /** Sink for fan-out samples (live events seen on both streams). */
  fanout?: (s: FanoutSample) => void;
}

interface RunView {
  run: { state: string; version: number; provenance: string };
  invoice: { status: string | null; provenance: string } | null;
  holds: { open: number; blocking: number; total: number };
  lines: Record<string, number>;
}

class StepFailed extends Error {
  constructor(
    readonly step: string,
    readonly outcome: Outcome,
    message: string,
  ) {
    super(message);
  }
}

function brief(a: Answer): string {
  const b = a.json as { code?: string } | null;
  return `${a.status}${b?.code ? ` ${b.code}` : ""}`;
}

function retryAfter(a: Answer): number | null {
  const b = a.json as { code?: string; retryAfterMs?: number } | null;
  if (a.status !== 429 && a.status !== 503) return null;
  if (typeof b?.retryAfterMs === "number" && b.retryAfterMs > 0) return b.retryAfterMs;
  const h = Number(a.headers["retry-after"]);
  return Number.isFinite(h) && h > 0 ? h * 1000 : 1_000;
}

const isQueued = (a: Answer) => (a.json as { code?: string } | null)?.code === "QUEUED";

export async function runJudge(
  judge: number,
  client: JudgeClient,
  o: JudgeOptions = {},
): Promise<JudgeResult> {
  const stepMs = o.stepMs ?? 180_000;
  const fallbackGetMs = o.fallbackGetMs ?? 5_000;
  const r: JudgeResult = {
    judge,
    ip: client.localAddress ?? "default",
    outcome: "settled",
    failedAt: "",
    detail: "",
    rail: "",
    railReason: "",
    payoutRail: "",
    payoutReason: "",
    pressStatus: 0,
    pressMs: Number.NaN,
    invoicedMs: Number.NaN,
    fundedMs: Number.NaN,
    inReviewMs: Number.NaN,
    keysMs: Number.NaN,
    postingMs: Number.NaN,
    postedMs: Number.NaN,
    settledMs: Number.NaN,
    proofMs: Number.NaN,
    resetMs: Number.NaN,
    markPaidQueued: 0,
    cashPaced: "",
    proofStatus: "",
    payoutPlate: "",
    paypalVerified: -1,
    labelViolations: 0,
    labelNotes: "",
    lines: "",
    paidLineProvenance: "",
    exportItems: "",
    events: 0,
    streamRefusals: 0,
    streamReconnects: 0,
  };
  const notes: string[] = [];
  const violate = (note: string) => {
    r.labelViolations++;
    if (notes.length < 6) notes.push(note);
  };

  let streams: EventStream[] = [];
  let session: { sessionId: string; runSlug: string; asTreasurer: Hdrs } | null = null;
  const pressedAt = Date.now();
  const since = () => Date.now() - pressedAt;

  try {
    // 1. The first press, with no cookie. QUEUED (a workspace is being prepared) is honoured; RATE_LIMITED is not.
    let press: Answer;
    for (;;) {
      press = await client.post("press", "/v1/judge/sessions", {});
      const wait = retryAfter(press);
      if (press.status === 201 || wait === null || !isQueued(press) || since() + wait > stepMs) break;
      await sleep(wait + 200);
    }
    r.pressStatus = press.status;
    r.pressMs = since();
    if (press.status !== 201) throw new StepFailed("press", "press_refused", brief(press));
    const s = CreateJudgeSessionResponse.parse(press.json);
    if (!client.cookie("fs_js")) throw new StepFailed("press", "error", "no judge cookie");
    session = {
      sessionId: s.sessionId,
      runSlug: s.runSlug,
      asTreasurer: { authorization: `Bearer ${s.consoleToken}` },
    };
    const run = s.runSlug;
    const asT = session.asTreasurer;

    // 2. Two streams on the run, opened at once as the stage does.
    streams = [0, 1].map(() => client.stream(`/v1/runs/${run}/events`, asT));
    const [a] = streams as [EventStream, EventStream];

    const rail = await client.get("session", "/v1/judge/session", asT);
    const railBody = rail.json as { rail?: { mode?: string; reason?: string | null; label?: string } } | null;
    r.rail = railBody?.rail?.mode ?? "?";
    r.railReason = railBody?.rail?.reason ?? "";
    checkRailLabel(railBody?.rail, violate, "press");

    let lastView: RunView | null = null;
    const view = async () => {
      const g = await client.get("run", `/v1/runs/${run}`, asT);
      if (g.status === 200) lastView = g.json as RunView;
      return lastView;
    };
    /** Until the run reaches `state` (or later), by its run.state event, else the fallback GET. */
    const reach = async (step: string, state: string, ms = stepMs) => {
      const want = rank(state);
      const until = Date.now() + ms;
      while (Date.now() < until) {
        const e = await a.waitFor(
          (x) => x.type === "run.state" && rank(String(x.payload.to)) >= want,
          Math.min(fallbackGetMs, until - Date.now()),
        );
        if (e) return e.arrivedAt - pressedAt;
        const v = await view();
        if (v && rank(v.run.state) >= want) return since();
      }
      throw new StepFailed(step, "stuck", `not ${state} after ${ms} ms (last ${lastView?.run.state ?? "?"})`);
    };

    r.invoicedMs = await reach("invoiced", "INVOICED");

    // 3. Mark paid, honouring PayPal's pacing (a QUEUED step runs from the outbox when its wait ends).
    for (;;) {
      const paid = await client.post("mark-paid", `/v1/runs/${run}/mark-paid`, {}, asT);
      if (paid.status === 200) break;
      const wait = retryAfter(paid);
      if (wait !== null && isQueued(paid)) {
        r.markPaidQueued++;
        await sleep(wait + 200);
        const v = await view();
        if (v && rank(v.run.state) > rank("INVOICED")) break;
        continue;
      }
      if (paid.status === 409) {
        const v = await view();
        if (v && rank(v.run.state) > rank("INVOICED")) break;
      }
      throw new StepFailed("mark-paid", "error", brief(paid));
    }
    r.fundedMs = await reach("funded", "FUNDED");
    r.inReviewMs = await reach("in-review", "IN_REVIEW");

    // 4. The review: slip 0462's gross by hand, then H1–H3.
    const season = run.replace(/-r[0-9]+$/, "");
    const slip = (await client.get("slip", `/v1/seasons/${season}/slips/0462`, asT)).json as {
      slips?: { fields: { id: string; field: string }[] }[];
    } | null;
    const field = slip?.slips?.flatMap((x) => x.fields).find((f) => f.field === "gross_kg");
    const byHand = await client.post(
      "field-enter",
      `/v1/fields/${field?.id ?? "none"}/enter`,
      {
        value: "64.80",
      },
      asT,
    );
    if (byHand.status !== 200) throw new StepFailed("by-hand", "error", brief(byHand));
    const holds = (await client.get("holds", `/v1/runs/${run}/holds`, asT)).json as {
      holds?: { id: string; label: string }[];
    } | null;
    for (const [label, resolution] of Object.entries(HOLD_RESOLUTIONS)) {
      const hold = holds?.holds?.find((h) => h.label === label);
      if (!hold) throw new StepFailed("holds", "error", `no hold ${label}`);
      const res = await client.post("hold-resolve", `/v1/holds/${hold.id}/resolve`, resolution, asT);
      if (res.status !== 200) throw new StepFailed("holds", "error", `${label} ${brief(res)}`);
    }

    // 5. Both officers' browser demo keys, then both keys.
    const frame = await client.post(
      "chair-frame",
      `/v1/judge/sessions/${s.sessionId}/frames`,
      { persona: "board:ernesto" },
      {},
    );
    if (frame.status !== 201) throw new StepFailed("chair-frame", "error", brief(frame));
    const asChair = { authorization: `Bearer ${(frame.json as { token: string }).token}` };
    const treasurer = await registerKey(client, s.workspaceId, "treasurer", asT);
    const chair = await registerKey(client, s.workspaceId, "chair", asChair);
    for (const signer of [treasurer, chair]) {
      const k = await signKey(client, run, signer);
      if (k.status !== 201) throw new StepFailed(`key-${signer.role}`, "error", brief(k));
    }
    r.keysMs = since();
    const payoutRail = (await client.get("session", "/v1/judge/session", asT)).json as {
      rail?: { mode?: string; reason?: string | null; label?: string };
    } | null;
    r.payoutRail = payoutRail?.rail?.mode ?? "?";
    r.payoutReason = payoutRail?.rail?.reason ?? "";
    checkRailLabel(payoutRail?.rail, violate, "payout");

    // 6. The payouts POST, then Rhea's UNCLAIMED line to cash, then SETTLED.
    r.postingMs = await reach("posting", "POSTING");
    r.postedMs = await reach("posted", "POSTED");
    await reach("follow-up", "NEEDS_FOLLOW_UP");
    const atFollowUp = await view();
    if (rank(atFollowUp?.run.state) < rank("SETTLED")) {
      const lines = (await client.get("lines", `/v1/runs/${run}/lines`, asT)).json as {
        lines?: { id: string; state: string }[];
      } | null;
      const rhea = lines?.lines?.find((l) => l.state === "UNCLAIMED");
      if (rhea) {
        const cash = await client.post("pay-cash", `/v1/lines/${rhea.id}/pay-cash`, {}, asT);
        // a paced cancel (429 QUEUED, or the 503 CIRCUIT_OPEN the cancel task answers for a busy lane) stays
        // recorded and the outbox retries it: the judge waits for SETTLED below, as the stage does
        if (cash.status !== 200) {
          if (retryAfter(cash) === null) throw new StepFailed("pay-cash", "error", brief(cash));
          r.cashPaced = brief(cash);
        }
      }
    }
    r.settledMs = await reach("settled", "SETTLED", 420_000);
    const settled = await view();
    r.lines = Object.entries(settled?.lines ?? {})
      .map(([k, v]) => `${k}:${v}`)
      .join(" ");
    const final = (await client.get("lines", `/v1/runs/${run}/lines`, asT)).json as {
      lines?: { state: string; provenance: string }[];
    } | null;
    r.paidLineProvenance = tallyOf(
      (final?.lines ?? []).filter((l) => l.state === "PAID").map((l) => l.provenance),
    );

    // 7. Proof: the public verification, until it settles on sample (live) or replay; then the label checks.
    const replayed = r.payoutRail === "replay" || r.rail === "replay";
    const proofUntil = Date.now() + 90_000;
    type Verification = {
      status?: string;
      plates?: Record<string, { ok: boolean; state?: string; reason: string | null }>;
    };
    let verification: Verification | null = null;
    while (Date.now() < proofUntil) {
      const v = await client.get("proof-verification", `/v1/proof/${run}/verification`);
      verification = (v.json as { verification?: Verification } | null)?.verification ?? null;
      const m = await client.get("proof-metrics", `/v1/proof/${run}/metrics`);
      r.paypalVerified =
        (m.json as { paid?: { paypalVerified?: { members?: number } } } | null)?.paid?.paypalVerified
          ?.members ?? -1;
      if (verification?.status === "replay") break;
      if (verification?.status === "sample" && r.paypalVerified === 7) break;
      await sleep(2_000);
    }
    r.proofMs = since();
    r.proofStatus = verification?.status ?? "?";
    r.payoutPlate = verification?.plates?.payoutItems?.state ?? "?";
    const items = streams.flatMap((x) => x.events).filter((e) => e.type === "item.updated");
    if (replayed) {
      // the treasurer's Proof export (as e2e inv.i8.over-quota checks it): every batch item replayed, no notice id
      const exported = await client.get("proof-export", `/v1/proof/${run}/export`, asT);
      const exportItems =
        (
          exported.json as {
            bundle?: { batch?: { items?: { provenance?: string; eventId: string | null }[] } };
          } | null
        )?.bundle?.batch?.items ?? [];
      r.exportItems = tallyOf(exportItems.map((i) => `${i.provenance}${i.eventId === null ? "" : "+event"}`));
      if (exported.status === 200 && exportItems.some((i) => i.provenance !== "replay" || i.eventId !== null))
        violate(`replayed payout's export items read ${r.exportItems}`);
      if (r.proofStatus !== "replay") violate(`replayed payout's Proof reads ${r.proofStatus}`);
      if (r.paypalVerified !== 0) violate(`replayed payout counts ${r.paypalVerified} PayPal-verified`);
      if (items.some((e) => e.provenance !== "replay"))
        violate("replayed payout item without replay provenance");
    } else {
      if (r.proofStatus !== "sample") violate(`live payout's Proof reads ${r.proofStatus}`);
      if (items.some((e) => e.provenance !== "simulated_rail"))
        violate("live item without simulated provenance");
    }
    const unlabelled = client.exchanges.filter((x) => x.status > 0 && x.rail !== "simulated");
    if (unlabelled.length > 0) violate(`${unlabelled.length} answers without X-FS-Rail: simulated`);
    const claude = streams[0]?.events.filter(
      (e) => JSON.stringify(e.payload).includes("Claude") && e.provenance !== "replay",
    );
    if (claude && claude.length > 0) violate(`${claude.length} Claude events not labelled replay`);
  } catch (err) {
    if (err instanceof StepFailed) {
      r.outcome = err.outcome;
      r.failedAt = err.step;
      r.detail = err.message;
    } else {
      r.outcome = "error";
      r.failedAt = r.failedAt || "exception";
      r.detail = (err as Error).message.slice(0, 200);
    }
  } finally {
    for (const st of streams) st.stop();
    collectFanout(streams, o.fanout);
    r.events = streams[0]?.events.length ?? 0;
    r.streamRefusals = streams.reduce((n, st) => n + st.refusals.length, 0);
    r.streamReconnects = streams.reduce((n, st) => n + st.reconnects, 0);
    // 8. Reset (also after a failure, so a stalled judge frees its workspace as a judge pressing Reset would).
    if (session) {
      const t0 = Date.now();
      const reset = await client.post("reset", `/v1/judge/sessions/${session.sessionId}/reset`, {}, {});
      r.resetMs = Date.now() - t0;
      if (reset.status !== 200) {
        r.outcome = r.outcome === "settled" ? "error" : r.outcome;
        r.failedAt = r.failedAt || "reset";
        r.detail = r.detail || brief(reset);
      }
      if (reset.status === 200) {
        const stale = await client.get("run-after-reset", `/v1/runs/${session.runSlug}`, session.asTreasurer);
        if (![401, 403, 404, 410].includes(stale.status))
          violate(`old token still reads the run (${stale.status})`);
      }
    }
    r.labelNotes = notes.join("; ");
  }
  return r;
}

/** I8 on the rail decision the stage shows: a replay reads "Replay: …", a live run the simulated label. */
export function checkRailLabel(
  rail: { mode?: string; reason?: string | null; label?: string } | undefined,
  violate: (note: string) => void,
  when: string,
): void {
  if (!rail) {
    violate(`${when}: no rail decision`);
    return;
  }
  if (rail.mode === "replay" && !rail.label?.startsWith("Replay: "))
    violate(`${when}: replay rail labelled "${rail.label}"`);
  if (rail.mode === "live" && rail.label !== SIMULATED_LABEL)
    violate(`${when}: live rail labelled "${rail.label}"`);
  if (rail.label && /\bpaid\b/i.test(rail.label) && rail.mode === "replay")
    violate(`${when}: replay label mentions paid`);
}

/** Live events seen on both of the run's streams: write time → arrival on each, and the spread between them. */
function collectFanout(streams: EventStream[], sink: JudgeOptions["fanout"]): void {
  if (!sink || streams.length < 2) return;
  const [a, b] = streams as [EventStream, EventStream];
  for (const f of fanoutSamples(a.events, b.events)) sink(f);
}

/**
 * Fan-out samples from two subscribers of one run (pure). Only live events count (not the Last-Event-ID replay). A
 * burst is consecutive arrivals on `a` within 3 ms of each other; its last-written event is flagged `tail`.
 */
export function fanoutSamples(a: readonly StreamEvent[], b: readonly StreamEvent[]): FanoutSample[] {
  const onB = new Map<string, StreamEvent>(b.map((e) => [e.id, e]));
  const live = a.filter((e) => !e.replayed && Number.isFinite(e.at));
  const tails = new Set<string>();
  let burst: StreamEvent[] = [];
  const close = () => {
    const last = burst.reduce<StreamEvent | null>((m, e) => (m === null || e.at >= m.at ? e : m), null);
    if (last) tails.add(last.id);
    burst = [];
  };
  for (const e of live) {
    const prev = burst.at(-1);
    if (prev && e.arrivedAt - prev.arrivedAt > 3) close();
    burst.push(e);
  }
  close();
  const out: FanoutSample[] = [];
  for (const e of live) {
    const f = onB.get(e.id);
    if (!f || f.replayed) continue;
    out.push({
      lagA: e.arrivedAt - e.at,
      lagB: f.arrivedAt - f.at,
      spread: Math.abs(e.arrivedAt - f.arrivedAt),
      tail: tails.has(e.id),
    });
  }
  return out;
}

interface Signer {
  role: "treasurer" | "chair";
  keyId: string;
  privateKey: KeyObject;
  headers: Hdrs;
}

/** A browser demo key for the role, registered through its own credential (proof of possession). */
async function registerKey(
  client: JudgeClient,
  workspaceId: string,
  role: "treasurer" | "chair",
  headers: Hdrs,
): Promise<Signer> {
  const approverId = role === "treasurer" ? "treasurer:analyn" : "board:ernesto";
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyHex = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url").toString(
    "hex",
  );
  const statement = jcs({ v: 1, purpose: "fs.register-demo-key", ws: workspaceId, approverId, publicKeyHex });
  const res = await client.post(
    "register-key",
    "/v1/judge/keys",
    { publicKeyHex, signatureHex: ed25519Sign(privateKey, statement) },
    headers,
  );
  if (res.status !== 201) throw new StepFailed(`register-${role}`, "error", brief(res));
  return { role, keyId: (res.json as { keyId: string }).keyId, privateKey, headers };
}

async function signKey(client: JudgeClient, run: string, signer: Signer): Promise<Answer> {
  const p = await client.get(
    "approval-payload",
    `/v1/runs/${run}/approval-payload?role=${signer.role}`,
    signer.headers,
  );
  if (p.status !== 200) throw new StepFailed(`payload-${signer.role}`, "error", brief(p));
  const payload = ApprovalPayload.parse((p.json as { payload: unknown }).payload);
  return client.post(
    "approve",
    `/v1/runs/${run}/approvals`,
    {
      role: signer.role,
      keyId: signer.keyId,
      signature: ed25519Sign(signer.privateKey, approvalBytes(payload)),
      payload,
    },
    signer.headers,
  );
}
