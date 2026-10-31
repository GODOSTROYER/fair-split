// One judge run scripted through fs-api: the treasurer works the review in the console's place, the Chair signs
// key 2 in its own frame's place, and a live event stream (opened right after the first press, as the stage does)
// keeps every run event with the moment it arrived. fs-api's SSE replay holds only the newest 500 events of a scope,
// so the run's phases are read from this stream, never from a replay afterwards.
import {
  type Answer,
  Api,
  chairFrame,
  firstPress,
  type JudgeSession,
  type RunEvent,
  registerSigner,
  type Signer,
  sign,
  sleep,
  waitForRun,
} from "./api.js";

export interface Arrival extends RunEvent {
  /** Client clock, ms since the epoch, when the event arrived on the stream. */
  arrivedAt: number;
}

export interface Collector {
  readonly events: Arrival[];
  /** The first event matching `pred`, waiting up to `ms` for it. */
  waitFor(pred: (e: Arrival) => boolean, ms: number): Promise<Arrival | null>;
  stop(): Promise<void>;
}

/**
 * Streams /v1/runs/:slug/events from the start (Last-Event-ID 0: everything after the first press is still in the
 * replay window) and reconnects from the last id it saw whenever the server ends the stream (a slow client's
 * overflow), so the history it keeps has no gap and no duplicate.
 */
export function collectRunEvents(api: Api, s: JudgeSession): Collector {
  const events: Arrival[] = [];
  const seen = new Set<string>();
  const ac = new AbortController();
  let lastId = "0";
  const loop = (async () => {
    while (!ac.signal.aborted) {
      try {
        const res = await fetch(`${api.base}/v1/runs/${s.runSlug}/events`, {
          headers: { ...s.asTreasurer, accept: "text/event-stream", "last-event-id": lastId },
          signal: ac.signal,
        });
        if (res.status !== 200 || !res.body) {
          await sleep(500);
          continue;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl = buffer.indexOf("\n");
          while (nl >= 0) {
            const line = buffer.slice(0, nl).trimEnd();
            buffer = buffer.slice(nl + 1);
            nl = buffer.indexOf("\n");
            if (!line.startsWith("data:")) continue;
            let e: Partial<RunEvent> & { id?: string | number };
            try {
              e = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            if (typeof e.type !== "string" || e.id === undefined) continue;
            const id = String(e.id);
            if (seen.has(id)) continue;
            seen.add(id);
            lastId = id;
            events.push({
              id,
              type: e.type,
              provenance: String(e.provenance),
              payload: (e.payload ?? {}) as Record<string, unknown>,
              arrivedAt: Date.now(),
            });
          }
        }
      } catch {
        if (ac.signal.aborted) return;
        await sleep(300);
      }
    }
  })();
  return {
    events,
    async waitFor(pred, ms) {
      const until = Date.now() + ms;
      for (;;) {
        const hit = events.find(pred);
        if (hit) return hit;
        if (Date.now() > until) return null;
        await sleep(100);
      }
    },
    async stop() {
      ac.abort();
      await loop;
    },
  };
}

export const runState = (to: string) => (e: Arrival) => e.type === "run.state" && e.payload.to === to;

/** The seed's review: slip 0462's smudged gross by hand, then H1 (count once), H2 (register the plot), H3 (credit). */
export const HOLD_RESOLUTIONS: Readonly<Record<string, unknown>> = {
  H1: { resolution: "COUNT_ONCE" },
  H2: { resolution: "REGISTER_PLOT", plot: { plotNo: "P-053-B", areaHa: "0.60", trees: 330 } },
  H3: { resolution: "RETURN_AS_CREDIT" },
};

export interface ReviewOutcome {
  byHand: Answer;
  field: { id: string; field: string } | undefined;
  resolved: Record<string, number>;
  holdsBefore: { id: string; label: string; state: string; kind?: string; blocking?: boolean }[];
}

export async function workTheReview(api: Api, s: JudgeSession): Promise<ReviewOutcome> {
  // the run slug names its season: 2026A-r1 is run 1 of season 2026A
  const season = s.runSlug.replace(/-r[0-9]+$/, "");
  const slip = (await api.get(`/v1/seasons/${season}/slips/0462`, s.asTreasurer)).json as {
    slips: { fields: { id: string; field: string }[] }[];
  } | null;
  const field = slip?.slips.flatMap((x) => x.fields).find((f) => f.field === "gross_kg");
  const byHand = await api.post(`/v1/fields/${field?.id ?? "none"}/enter`, { value: "64.80" }, s.asTreasurer);
  const list = (await api.get(`/v1/runs/${s.runSlug}/holds`, s.asTreasurer)).json as {
    holds: ReviewOutcome["holdsBefore"];
  };
  const resolved: Record<string, number> = {};
  for (const [label, resolution] of Object.entries(HOLD_RESOLUTIONS)) {
    const hold = list.holds.find((h) => h.label === label);
    resolved[label] = hold
      ? (await api.post(`/v1/holds/${hold.id}/resolve`, resolution, s.asTreasurer)).status
      : 0;
  }
  return { byHand, field, resolved, holdsBefore: list.holds };
}

export interface Officers {
  treasurer: Signer;
  chair: Signer;
}

/** Both officers' browser demo keys: the treasurer's through the console token, the Chair's through its frame. */
export async function officers(api: Api, s: JudgeSession): Promise<Officers> {
  const chairHeaders = await chairFrame(api, s);
  return {
    treasurer: await registerSigner(api, s, "treasurer", s.asTreasurer),
    chair: await registerSigner(api, s, "chair", chairHeaders),
  };
}

export async function bothKeys(api: Api, s: JudgeSession, o: Officers): Promise<[Answer, Answer]> {
  const key1 = await sign(api, s, o.treasurer);
  const key2 = await sign(api, s, o.chair);
  return [key1, key2];
}

/** A run state at or past `state` on the way to settled (or the I4 send-back's return to review). */
export const POSTED_OR_LATER = ["POSTED", "SETTLING", "NEEDS_FOLLOW_UP", "SETTLED"];

/** The press, the invoice, Mark paid and the reading, to IN_REVIEW. */
export async function pressToReview(api: Api) {
  const s = await firstPress(api);
  const events = collectRunEvents(api, s);
  const invoiced = await waitForRun(api, s, (r) => r.run.state === "INVOICED", 60_000);
  const markPaid = await api.post(`/v1/runs/${s.runSlug}/mark-paid`, {}, s.asTreasurer);
  const reviewed = await waitForRun(
    api,
    s,
    (r) => !["INVOICED", "FUNDED", "EXTRACTING", "COMPUTED"].includes(r.run.state),
    120_000,
  );
  return { s, events, invoiced, markPaid, reviewed };
}

/** A whole run without the tamper, to SETTLED with Rhea paid in cash (for specs that need a settled run). */
export async function settledRun(base: string) {
  const api = new Api(base);
  const { s, events, reviewed } = await pressToReview(api);
  if (reviewed?.run.state !== "IN_REVIEW") throw new Error(`reading ended at ${reviewed?.run.state}`);
  await workTheReview(api, s);
  await bothKeys(api, s, await officers(api, s));
  const followUp = await waitForRun(
    api,
    s,
    (r) => r.run.state === "NEEDS_FOLLOW_UP" || r.run.state === "SETTLED",
    180_000,
  );
  if (followUp?.run.state === "NEEDS_FOLLOW_UP") {
    const lines = (await api.get(`/v1/runs/${s.runSlug}/lines`, s.asTreasurer)).json as {
      lines: { id: string; state: string }[];
    };
    const rhea = lines.lines.find((l) => l.state === "UNCLAIMED");
    if (rhea) await api.post(`/v1/lines/${rhea.id}/pay-cash`, {}, s.asTreasurer);
  }
  const settled = await waitForRun(api, s, (r) => r.run.state === "SETTLED", 60_000);
  // Rhea's cancel: the simulator signs a CANCELED delivery, which fs-api verifies and files among the run's events
  await events.waitFor(
    (e) => e.type === "webhook.received" && e.payload.eventType === "PAYMENT.PAYOUTS-ITEM.CANCELED",
    60_000,
  );
  await events.stop();
  if (settled?.run.state !== "SETTLED") throw new Error(`run ended at ${settled?.run.state}`);
  // Proof counts a SUCCESS item as PayPal-verified once its simulator-signed webhook is stored, a moment after the
  // status checks settle the run, and its verification rests on them: wait for both, so a page opened now shows the
  // finished record
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    const m = (await api.get(`/v1/proof/${s.runSlug}/metrics`)).json as {
      paid?: { paypalVerified?: { members?: number } };
    } | null;
    const v = (await api.get(`/v1/proof/${s.runSlug}/verification`)).json as {
      verification?: { status?: string };
    } | null;
    if (m?.paid?.paypalVerified?.members === 7 && v?.verification?.status === "sample") break;
    await sleep(500);
  }
  return { api, s };
}
