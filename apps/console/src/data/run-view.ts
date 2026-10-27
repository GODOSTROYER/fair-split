// The live run, as the console sees it: a pure reducer over IC-01 RunEvents (SSE, replayed from
// Last-Event-ID) on top of a base built from the IC-03 snapshot. State only moves forward (I5): an event at
// or below the last applied ID is a replay and changes nothing; payout items only climb in rank; a run in
// an exit state stays there. One `item.updated` feeds every surface (C-05).

import {
  type ApprovalRole,
  type HoldGate,
  type HoldKind,
  type HoldResolutionKind,
  type HoldState,
  type InvoiceStatus,
  ITEM_STATUS_TO_LINE_STATE,
  type MemberLineState,
  PAY_RUN_RANK,
  PAYOUT_ITEM_RANK,
  type PayoutItemStatus,
  type PayRunState,
  type Provenance,
  type RunEvent,
  type RunEventOf,
  type SeasonSnapshot,
  type SystemFlagName,
  type WebhookVerified,
} from "@fairsplit/contracts";

export type LineChanger = "paypal" | "engine" | "person" | "system";

export interface RunLine {
  readonly memberNo: string;
  readonly lineId: string | null;
  readonly state: MemberLineState;
  /** Who moved it last: the grid washes jade only for PayPal and pencil only for the engine (S2.7). */
  readonly changedBy: LineChanger | null;
  readonly eventId: string | null;
  readonly at: string | null;
}

export interface RunItem {
  readonly senderItemId: string;
  readonly memberNo: string;
  readonly status: PayoutItemStatus;
  readonly rank: number;
  readonly payoutItemId: string | null;
  readonly source: "webhook" | "status_check" | "post_response" | "cancel" | "seed";
  readonly eventId: string | null;
  readonly at: string | null;
}

export interface RunHold {
  readonly holdId: string;
  readonly label: string;
  readonly key: string;
  readonly kind: HoldKind;
  readonly gate: HoldGate;
  readonly memberNo: string | null;
  readonly lineId: string | null;
  readonly state: HoldState;
  readonly resolution: HoldResolutionKind | null;
  readonly resolvedBy: string | null;
  readonly raisedAt: string | null;
  readonly resolvedAt: string | null;
  readonly eventId: string | null;
}

export interface RunField {
  readonly fieldId: string;
  readonly docId: string;
  readonly serial: string;
  readonly field: string;
  readonly value: string;
  readonly derived: Readonly<Record<string, string>>;
  readonly enteredBy: string;
  readonly at: string;
  readonly eventId: string;
}

export type RunRow = RunEventOf<"extract.row">["payload"] & { readonly eventId: string; readonly at: string };

export interface RunQuarantine {
  readonly docId: string;
  readonly row: number | null;
  readonly source: string;
  readonly eventId: string;
  readonly at: string;
}

export interface RunApproval {
  readonly approvalId: string;
  readonly role: ApprovalRole;
  readonly keyId: string;
  readonly batchSha256: string;
  readonly at: string;
  readonly eventId: string | null;
}

export interface RunPresence {
  readonly persona: string;
  readonly view: string;
  readonly holdId: string | null;
  readonly expiresAt: string;
}

export interface RunWebhook {
  readonly paypalEventId: string;
  readonly eventType: string;
  readonly verified: WebhookVerified;
  readonly duplicate: boolean;
  readonly at: string;
  readonly eventId: string;
}

/**
 * Where a view came from: the seeded showcase run (r37, end state), the Judge stage's first view (the
 * showcase at INVOICED, no session and no calls), or a judge session's live run.
 */
export type RunOrigin = "showcase" | "first-view" | "session";

export interface RunView {
  readonly runSlug: string;
  readonly runId: string | null;
  readonly origin: RunOrigin;
  readonly state: PayRunState;
  readonly invoice: {
    readonly number: string;
    readonly status: InvoiceStatus | null;
    readonly dueCents: number | null;
    readonly provenance: Provenance;
  };
  readonly lines: Readonly<Record<string, RunLine>>;
  readonly items: Readonly<Record<string, RunItem>>;
  readonly holds: Readonly<Record<string, RunHold>>;
  readonly fields: Readonly<Record<string, RunField>>;
  readonly rows: readonly RunRow[];
  readonly quarantined: readonly RunQuarantine[];
  readonly approvals: {
    readonly treasurer: RunApproval | null;
    readonly chair: RunApproval | null;
    readonly declined: { readonly role: ApprovalRole; readonly reason: string; readonly by: string } | null;
  };
  readonly flags: Readonly<Partial<Record<SystemFlagName, boolean>>>;
  readonly presence: readonly RunPresence[];
  readonly webhooks: {
    readonly received: number;
    readonly duplicates: number;
    readonly last: RunWebhook | null;
  };
  /** Every applied event, oldest first (capped), for the run log and the ribbon. */
  readonly events: readonly RunEvent[];
  readonly lastEventId: string | null;
  readonly lastEventAt: string | null;
  readonly applied: number;
}

export const MAX_LOGGED_EVENTS = 2000;

/** SSE IDs are bigserials written as decimal strings: compare them as numbers of any length. */
export function compareEventIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function emptyRunView(runSlug: string, origin: RunOrigin, runId: string | null = null): RunView {
  return {
    runSlug,
    runId,
    origin,
    state: "DRAFT",
    invoice: { number: `FS-${runSlug}`, status: null, dueCents: null, provenance: "live" },
    lines: {},
    items: {},
    holds: {},
    fields: {},
    rows: [],
    quarantined: [],
    approvals: { treasurer: null, chair: null, declined: null },
    flags: {},
    presence: [],
    webhooks: { received: 0, duplicates: 0, last: null },
    events: [],
    lastEventId: null,
    lastEventAt: null,
    applied: 0,
  };
}

/**
 * The Judge stage's first view (S3.9): the showcase run as it stood before funding, rendered from the
 * snapshot with no session and no calls. The invoice is sent and hollow; nothing is read yet.
 */
export function firstView(snapshot: SeasonSnapshot): RunView {
  const run = snapshot.run;
  return {
    ...emptyRunView(run.runSlug, "first-view", run.id),
    state: "INVOICED",
    invoice: {
      number: run.invoice.invoiceNumber,
      status: "SENT",
      dueCents: run.invoice.amountCents,
      provenance: "seeded",
    },
  };
}

/**
 * A judge session's run before its first event (S3.9): the session claims a workspace cloned from the showcase
 * as it stood at INVOICED, so the base is the first view under the session's own run. Everything after it
 * arrives over the run's SSE stream, replayed from the start.
 */
export function sessionView(
  snapshot: SeasonSnapshot,
  run: { readonly runSlug: string; readonly runId: string },
): RunView {
  return { ...firstView(snapshot), runSlug: run.runSlug, runId: run.runId, origin: "session" };
}

/** The showcase run (r37) at its end state, straight from the snapshot. Everything in it is seeded. */
export function showcaseView(snapshot: SeasonSnapshot): RunView {
  const run = snapshot.run;
  const lines: Record<string, RunLine> = {};
  for (const [memberNo, state] of Object.entries(run.lineStates)) {
    lines[memberNo] = { memberNo, lineId: null, state, changedBy: null, eventId: null, at: null };
  }
  const items: Record<string, RunItem> = {};
  for (const item of run.items) {
    items[item.senderItemId] = {
      senderItemId: item.senderItemId,
      memberNo: item.memberNo,
      status: item.status,
      rank: PAYOUT_ITEM_RANK[item.status],
      payoutItemId: item.payoutItemId,
      source: "seed",
      eventId: item.eventId,
      at: null,
    };
  }
  const holds: Record<string, RunHold> = {};
  for (const hold of snapshot.holds) {
    holds[hold.label] = {
      holdId: hold.label,
      label: hold.label,
      key: hold.key,
      kind: hold.kind,
      gate: hold.gate,
      memberNo: hold.memberNo,
      lineId: null,
      state: hold.resolvedWith ? "RESOLVED" : "OPEN",
      resolution: hold.resolvedWith,
      resolvedBy: hold.resolvedBy,
      raisedAt: null,
      resolvedAt: hold.resolvedAt,
      eventId: null,
    };
  }
  const approval = (role: ApprovalRole): RunApproval | null => {
    const signed = run.approvals.find((a) => a.role === role);
    return signed
      ? {
          approvalId: `${run.runSlug}:${role}`,
          role,
          keyId: signed.keyId,
          batchSha256: signed.payload.batchSha256,
          at: signed.payload.exp,
          eventId: null,
        }
      : null;
  };
  return {
    ...emptyRunView(run.runSlug, "showcase", run.id),
    state: run.state,
    invoice: {
      number: run.invoice.invoiceNumber,
      status: run.invoice.status,
      dueCents: run.invoice.dueCents,
      provenance: run.invoice.provenance,
    },
    lines,
    items,
    holds,
    approvals: { treasurer: approval("treasurer"), chair: approval("chair"), declined: null },
  };
}

/** The base a run screen starts from before its stream replays. */
export function baseRunView(snapshot: SeasonSnapshot, runSlug: string): RunView {
  return runSlug === snapshot.run.runSlug ? showcaseView(snapshot) : emptyRunView(runSlug, "session");
}

function changer(event: RunEvent): LineChanger {
  switch (event.actor.kind) {
    case "paypal":
      return "paypal";
    case "engine":
    case "agent":
      return "engine";
    case "human":
      return "person";
    default:
      return "system";
  }
}

function applyRunState(view: RunView, e: RunEventOf<"run.state">): RunView {
  const current = view.state;
  if (PAY_RUN_RANK[current] >= 99) return view; // CANCELLED, DENIED and HALTED are terminal
  const { from, to } = e.payload;
  // Compare-and-set (the server's FSM may legitimately move back to IN_REVIEW when approvals are voided),
  // or a forward catch-up after a gap. Anything else is stale.
  if (from === current || PAY_RUN_RANK[to] > PAY_RUN_RANK[current]) return { ...view, state: to };
  return view;
}

function applyItem(view: RunView, e: RunEventOf<"item.updated">): RunView {
  const p = e.payload;
  const current = view.items[p.senderItemId];
  const rank = PAYOUT_ITEM_RANK[p.to];
  if (current && rank <= current.rank) return view; // ranks only climb (register §7)
  const items = {
    ...view.items,
    [p.senderItemId]: {
      senderItemId: p.senderItemId,
      memberNo: p.memberNo,
      status: p.to,
      rank,
      payoutItemId: p.payoutItemId ?? current?.payoutItemId ?? null,
      source: p.source,
      eventId: e.id,
      at: e.at,
    },
  };
  const line = view.lines[p.memberNo];
  const lines = {
    ...view.lines,
    [p.memberNo]: {
      memberNo: p.memberNo,
      lineId: line?.lineId ?? null,
      state: ITEM_STATUS_TO_LINE_STATE[p.to],
      changedBy: "paypal" as const,
      eventId: e.id,
      at: e.at,
    },
  };
  return { ...view, items, lines };
}

function applyEvent(view: RunView, e: RunEvent): RunView {
  switch (e.type) {
    case "run.state":
      return applyRunState(view, e);
    case "line.state": {
      const p = e.payload;
      const line: RunLine = {
        memberNo: p.memberNo,
        lineId: p.lineId,
        state: p.to,
        changedBy: changer(e),
        eventId: e.id,
        at: e.at,
      };
      return { ...view, lines: { ...view.lines, [p.memberNo]: line } };
    }
    case "item.updated":
      return applyItem(view, e);
    case "hold.raised": {
      const p = e.payload;
      if (view.holds[p.holdId]) return view;
      const hold: RunHold = {
        holdId: p.holdId,
        label: p.label,
        key: p.key,
        kind: p.kind,
        gate: p.gate,
        memberNo: p.memberNo,
        lineId: p.lineId,
        state: "OPEN",
        resolution: null,
        resolvedBy: null,
        raisedAt: e.at,
        resolvedAt: null,
        eventId: e.id,
      };
      return { ...view, holds: { ...view.holds, [p.holdId]: hold } };
    }
    case "hold.resolved": {
      const p = e.payload;
      const prior = view.holds[p.holdId];
      if (prior && (prior.state === "RESOLVED" || prior.state === "EXCLUDED")) return view;
      const hold: RunHold = {
        holdId: p.holdId,
        label: p.label,
        key: prior?.key ?? p.holdId,
        kind: prior?.kind ?? "LOW_CONFIDENCE",
        gate: prior?.gate ?? "BLOCKS_APPROVAL",
        memberNo: prior?.memberNo ?? null,
        lineId: prior?.lineId ?? null,
        state: p.state,
        resolution: p.resolution,
        resolvedBy: p.resolvedBy,
        raisedAt: prior?.raisedAt ?? null,
        resolvedAt: e.at,
        eventId: e.id,
      };
      return { ...view, holds: { ...view.holds, [p.holdId]: hold } };
    }
    case "field.entered": {
      const p = e.payload;
      const field: RunField = {
        fieldId: p.fieldId,
        docId: p.docId,
        serial: p.serial,
        field: p.field,
        value: p.value,
        derived: p.derived,
        enteredBy: p.enteredBy,
        at: e.at,
        eventId: e.id,
      };
      return { ...view, fields: { ...view.fields, [p.fieldId]: field } };
    }
    case "extract.row": {
      const row: RunRow = { ...e.payload, eventId: e.id, at: e.at };
      const rows = view.rows.filter((r) => !(r.docId === row.docId && r.row === row.row));
      return { ...view, rows: [...rows, row] };
    }
    case "extract.quarantined": {
      const q: RunQuarantine = {
        docId: e.payload.docId,
        row: e.payload.row,
        source: e.payload.source,
        eventId: e.id,
        at: e.at,
      };
      return { ...view, quarantined: [...view.quarantined, q] };
    }
    case "approval.signed": {
      const p = e.payload;
      const approval: RunApproval = {
        approvalId: p.approvalId,
        role: p.role,
        keyId: p.keyId,
        batchSha256: p.batchSha256,
        at: e.at,
        eventId: e.id,
      };
      return {
        ...view,
        approvals: { ...view.approvals, [p.role]: approval, declined: null },
      };
    }
    case "approval.declined": {
      const p = e.payload;
      return {
        ...view,
        approvals: { ...view.approvals, declined: { role: p.role, reason: p.reason, by: p.by } },
      };
    }
    case "presence": {
      const p = e.payload;
      const others = view.presence.filter((x) => x.persona !== p.persona);
      return {
        ...view,
        presence: [...others, { persona: p.persona, view: p.view, holdId: p.holdId, expiresAt: p.expiresAt }],
      };
    }
    case "webhook.received": {
      const p = e.payload;
      const last: RunWebhook = {
        paypalEventId: p.paypalEventId,
        eventType: p.eventType,
        verified: p.verified,
        duplicate: p.duplicate,
        at: e.at,
        eventId: e.id,
      };
      return {
        ...view,
        webhooks: {
          received: view.webhooks.received + 1,
          duplicates: view.webhooks.duplicates + (p.duplicate ? 1 : 0),
          last,
        },
      };
    }
    case "invoice.state": {
      const p = e.payload;
      return {
        ...view,
        invoice: { number: p.invoiceNumber, status: p.to, dueCents: p.dueCents, provenance: e.provenance },
      };
    }
    case "flag.changed":
      return { ...view, flags: { ...view.flags, [e.payload.flag]: e.payload.on } };
    case "policy.verdict":
    case "agent.delta":
    case "capture.synced":
    case "extract.field":
      return view;
  }
}

/** Applies one event. Replays (an ID at or below the last applied) and other runs' events change nothing. */
export function applyRunEvent(view: RunView, event: RunEvent): RunView {
  if (view.lastEventId !== null && compareEventIds(event.id, view.lastEventId) <= 0) return view;
  if (event.runId !== null && view.runId !== null && event.runId !== view.runId) return view;
  const next = applyEvent(view, event);
  const events =
    view.events.length >= MAX_LOGGED_EVENTS
      ? [...view.events.slice(view.events.length - MAX_LOGGED_EVENTS + 1), event]
      : [...view.events, event];
  return {
    ...next,
    runId: view.runId ?? event.runId,
    events,
    lastEventId: event.id,
    lastEventAt: event.at,
    applied: view.applied + 1,
  };
}

export function applyRunEvents(view: RunView, events: readonly RunEvent[]): RunView {
  let next = view;
  for (const event of events) next = applyRunEvent(next, event);
  return next;
}

// ------------------------------------------------------------------------------------------ selectors

const OPEN_HOLD_STATES: readonly HoldState[] = ["OPEN", "ASKED_CHAIR"];

export function openHolds(view: RunView): RunHold[] {
  return Object.values(view.holds).filter((h) => OPEN_HOLD_STATES.includes(h.state));
}

/** Holds that block approval (register §7: duplicate, yield, by-hand kilos and the mass-balance dial). */
export function blockingHolds(view: RunView): RunHold[] {
  return openHolds(view).filter((h) => h.gate === "BLOCKS_APPROVAL");
}

/** The three hold cards the treasurer resolves (H1–H3), excluding the by-hand field and the dial. */
export function holdCards(view: RunView): RunHold[] {
  return Object.values(view.holds)
    .filter((h) => h.kind !== "LOW_CONFIDENCE" && h.kind !== "MASS_BALANCE")
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function byHandHolds(view: RunView): RunHold[] {
  return Object.values(view.holds).filter((h) => h.kind === "LOW_CONFIDENCE");
}

export function itemCounts(view: RunView): { readonly total: number; readonly confirmed: number } {
  const items = Object.values(view.items);
  return { total: items.length, confirmed: items.filter((i) => i.status === "SUCCESS").length };
}

export function atLeast(view: RunView, state: PayRunState): boolean {
  return PAY_RUN_RANK[view.state] < 99 && PAY_RUN_RANK[view.state] >= PAY_RUN_RANK[state];
}

/** Which engine checkpoint in the snapshot matches what the run has resolved so far. */
export function checkpointFor(view: RunView): "read" | "byHand" | "resolved" {
  const holds = Object.values(view.holds);
  if (holds.length === 0) return view.origin === "showcase" ? "resolved" : "read";
  const open = openHolds(view);
  if (open.length === 0) return "resolved";
  return byHandHolds(view).some((h) => !OPEN_HOLD_STATES.includes(h.state)) ? "byHand" : "read";
}

export type RunStripStage = "RATIFIED" | "FUNDED" | "READ" | "CHECKED" | "APPROVED" | "PAID";

/** Register §7's run strip: each stage lights only when its condition holds. */
export function runStrip(view: RunView, ratified: boolean): Readonly<Record<RunStripStage, boolean>> {
  const read = atLeast(view, "COMPUTED");
  return {
    RATIFIED: ratified,
    FUNDED: atLeast(view, "FUNDED"),
    READ: read,
    CHECKED: read && blockingHolds(view).length === 0,
    APPROVED: atLeast(view, "APPROVED"),
    PAID: atLeast(view, "SETTLED"),
  };
}

export type AmountState = "pencil" | "you" | "ink" | "hollow" | "landed" | "attested";

const HOLLOW_LINE_STATES: readonly MemberLineState[] = [
  "SUBMITTED",
  "PAYPAL_PENDING",
  "UNCLAIMED",
  "PAYPAL_HELD",
  "NEEDS_ACTION",
  "RETURNED",
  "REROUTED",
  "OFF_RAIL_DUE",
  "REVERSED",
];

/** S2.2.1's state map: the grammar every amount renders as `data-amount-state`. */
export function lineAmountState(view: RunView, memberNo: string): AmountState {
  const state = view.lines[memberNo]?.state;
  if (state === "PAID") return "landed";
  if (state === "OFF_RAIL_PAID") return "attested";
  if (state && HOLLOW_LINE_STATES.includes(state)) return "hollow";
  return atLeast(view, "APPROVED") ? "ink" : "pencil";
}

export function invoiceAmountState(view: RunView): AmountState {
  return atLeast(view, "FUNDED") ? "landed" : "hollow";
}

/** Presence that has not expired yet (S3.7: a presence lasts 25 s). */
export function livePresence(view: RunView, now: number): RunPresence[] {
  return view.presence.filter((p) => Date.parse(p.expiresAt) > now);
}
