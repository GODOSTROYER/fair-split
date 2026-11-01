// One run-log row per event (design §5, S1.7 W-TR-08): plain words first, then the event name, IDs, source and
// signature result in caption type, in one of three lanes (Machine, People, PayPal). The ribbon shows the
// newest row of each lane; W-TR-08's full log uses the same rows. Never a raw state name: every status word
// comes from the contracts label maps. Under the simulator (ADR-0002) no PayPal row says "verified".

import {
  HOLD_KIND_LABELS,
  type HoldResolutionKind,
  INVOICE_STATUS_LABELS,
  type LogLane,
  PAY_RUN_RANK,
  PAYOUT_ITEM_STATUS_LABELS,
  type Provenance,
  pickLabel,
  RUN_STATE_LABELS,
  type RunEvent,
  type RunEventType,
  type SeasonSnapshot,
  type SlipFieldName,
  type SystemFlagName,
} from "@fairsplit/contracts";
import { format } from "../lib/format.js";

export interface LogRow {
  readonly id: string;
  readonly lane: LogLane;
  readonly words: string;
  readonly detail: string;
  /** The event's ISO instant, or an ISO date for seeded history; null when unknown. */
  readonly at: string | null;
  readonly type: RunEventType;
  readonly provenance: Provenance;
  /** A repeated PayPal delivery: logged, changes nothing, plays nothing. */
  readonly duplicate: boolean;
}

export interface DescribeContext {
  readonly memberName: (memberNo: string) => string;
  readonly personName: (actorId: string) => string;
  readonly itemAmount: (senderItemId: string) => string | null;
  readonly recordedOn: string;
  /**
   * The season check (mass balance) in the engine's figures: "shrink 2.05%, over 2.0%" when it is raised (slip
   * 0462 entered, the duplicate counted twice), "shrink 1.62%, inside 2.0%" once the engine clears it.
   */
  readonly seasonCheck?: { readonly raised: string; readonly cleared: string };
}

/** "shrink 2.05%, over 2.0%": a checkpoint's mass balance in words, every digit the engine's. */
function shrinkWords(mb: { readonly shrinkBp: number; readonly tolBp: number }): string {
  const over = mb.shrinkBp > mb.tolBp;
  return `shrink ${format.percentBp(mb.shrinkBp)}, ${over ? "over" : "inside"} ${format.percentBp(mb.tolBp, 1)}`;
}

export function describeContext(snapshot: SeasonSnapshot): DescribeContext {
  const members = new Map(snapshot.members.map((m) => [m.memberNo, m.displayName]));
  const people = new Map<string, string>();
  for (const officer of snapshot.officers) {
    people.set(officer.persona, officer.shortName);
    people.set(officer.initials, officer.shortName);
    people.set(officer.role.toLowerCase(), officer.shortName);
  }
  const amounts = new Map(
    snapshot.run.items.map((i) => [i.senderItemId.replace(/^r\d+-/, ""), i.amountCents]),
  );
  return {
    memberName: (no) => members.get(no) ?? no,
    personName: (id) => people.get(id) ?? people.get(id.split(":")[0] ?? id) ?? id,
    itemAmount: (senderItemId) => {
      const cents = amounts.get(senderItemId.replace(/^r\d+(?:x\d+)?-/, ""));
      return cents === undefined ? null : format.money(cents);
    },
    recordedOn: snapshot.run.recordedOn,
    seasonCheck: {
      raised: shrinkWords(snapshot.checkpoints.byHand.massBalance),
      cleared: shrinkWords(snapshot.checkpoints.resolved.massBalance),
    },
  };
}

function laneOf(event: RunEvent): LogLane {
  if (event.actor.kind === "paypal") return "PAYPAL";
  if (event.actor.kind === "human") return "PEOPLE";
  return "MACHINE";
}

function provenanceNote(provenance: Provenance, type: RunEventType): string | null {
  switch (provenance) {
    case "replay":
      return type.startsWith("extract.")
        ? "Seed stand-in, not a Claude recording"
        : type === "item.updated" || type === "invoice.state"
          ? "Labelled replay of an earlier simulated run (including a seed snapshot)"
          : type === "run.state"
            ? "Reached on replayed payout statuses"
            : "Labelled replay of an earlier demo event";
    case "simulated_rail":
      return "simulated PayPal sandbox";
    case "seeded":
      return type.startsWith("extract.") ? "Seed stand-in, not a Claude recording" : "Seeded demo event";
    case "live":
      return null;
  }
}

function verification(event: RunEventOf<"webhook.received">): string {
  if (event.provenance === "simulated_rail") return "simulated webhook, signature checked";
  switch (event.payload.verified) {
    case "self":
      return "webhook, signature checked";
    case "postback":
      return "webhook, postback checked";
    case "dev_mock":
      return "webhook, development mock, not verified";
    case "fetched":
      return "status check";
  }
}

type RunEventOf<T extends RunEventType> = Extract<RunEvent, { type: T }>;

/** What a person (or the engine) decided, in the console's words. Never the enum name. */
export const RESOLUTION_WORDS: Readonly<Record<HoldResolutionKind, string>> = {
  COUNT_ONCE: "counted once",
  TWO_DELIVERIES: "two deliveries, sent to the Chair",
  REGISTER_PLOT: "plot registered",
  RETURN_AS_CREDIT: "returned as a credit",
  APPLY_RULE: "rule applied",
  EXCLUDE_LINE: "line excluded, carried over",
  CONFIRM_AS_READ: "confirmed as read",
  ENTERED_BY_HAND: "entered by hand",
  ENGINE_CLEARED: "cleared by the engine",
};

/** The three kill switches, as the co-op says them. */
export const FLAG_WORDS: Readonly<Record<SystemFlagName, { readonly on: string; readonly off: string }>> = {
  kill_payouts: { on: "Payouts paused by the co-op", off: "Payouts resumed" },
  kill_paypal_live: { on: "PayPal calls paused; PayPal steps replay, labelled", off: "PayPal calls resumed" },
  kill_ai_live: {
    on: "Live slip reading paused; the labelled seed stand-in still plays",
    off: "Live slip reading resumed",
  },
};

/** Slip boxes, as printed on the slip. */
export const FIELD_WORDS: Readonly<Record<SlipFieldName, string>> = {
  serial: "serial",
  line_no: "line",
  date: "date",
  member_no: "member number",
  member_name: "member name",
  plot_no: "plot",
  sacks: "sacks",
  gross_kg: "gross kg",
  tare_kg: "tare kg",
  net_kg: "net kg",
  mc_pct: "moisture %",
  mc_less_kg: "moisture less kg",
  payable_kg: "payable kg",
  grade: "grade",
  clerk_initials: "clerk's initials",
  deductions: "deductions",
};

/** A row's time for the log: "10:21:41" for an event, "29 Oct" for seeded history, "" when unknown. */
export function rowTime(at: string | null): string {
  if (!at) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return format.dateShort(at);
  return Number.isNaN(Date.parse(at)) ? "" : format.time(at);
}

function itemSource(source: RunEventOf<"item.updated">["payload"]["source"]): string {
  switch (source) {
    case "webhook":
      return "webhook";
    case "status_check":
      return "Confirmed by a status check";
    case "post_response":
      return "PayPal's answer to the batch";
    case "cancel":
      return "our cancel";
  }
}

function join(...parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(", ");
}

/** A log row for an event, or null for events the log does not show (presence, agent text, read boxes). */
export function describeEvent(event: RunEvent, ctx: DescribeContext): LogRow | null {
  const base = {
    id: event.id,
    lane: laneOf(event),
    at: event.at,
    type: event.type,
    provenance: event.provenance,
    duplicate: false,
  };
  const note = provenanceNote(event.provenance, event.type);
  switch (event.type) {
    case "run.state": {
      const words = pickLabel(RUN_STATE_LABELS[event.payload.to], "en", {
        treasurer: ctx.personName("treasurer:analyn"),
        chair: ctx.personName("board:ernesto"),
      });
      const stateNote =
        event.provenance === "replay" && PAY_RUN_RANK[event.payload.to] < PAY_RUN_RANK.POSTING
          ? "Labelled replay of the simulated invoice and payment step"
          : note;
      return { ...base, words, detail: join("Run state", stateNote) };
    }
    case "line.state":
      return null;
    case "item.updated": {
      const p = event.payload;
      const name = ctx.memberName(p.memberNo);
      const amount = ctx.itemAmount(p.senderItemId);
      const status = pickLabel(PAYOUT_ITEM_STATUS_LABELS[p.to], "en");
      const words =
        event.provenance === "replay"
          ? `${name}: Replayed (labelled), simulated ${p.to.toLowerCase()}`
          : p.to === "SUCCESS"
            ? join(`Paid ${name} ${amount ?? ""}`.trim())
            : p.to === "UNCLAIMED"
              ? `${name}'s address has no PayPal account. Parked`
              : p.to === "RETURNED" && p.source === "cancel"
                ? `${name}: returned to the co-op's simulated PayPal balance`
                : `${name}: ${status.toLowerCase()}`;
      const eventName =
        event.provenance === "replay"
          ? null
          : p.to === "SUCCESS"
            ? "PAYMENT.PAYOUTS-ITEM.SUCCEEDED"
            : p.to === "PENDING"
              ? null
              : `PAYMENT.PAYOUTS-ITEM.${p.to === "RETURNED" && p.source === "cancel" ? "CANCELED" : p.to}`;
      // The whole item ID: it is what a person matches against PayPal's own records.
      const item = p.payoutItemId ? `item ${p.payoutItemId}` : null;
      return {
        ...base,
        lane: "PAYPAL",
        words,
        detail: join(
          eventName,
          item,
          event.provenance === "replay" ? "Replayed status" : itemSource(p.source),
          note,
        ),
      };
    }
    case "hold.raised": {
      const p = event.payload;
      if (p.kind === "MASS_BALANCE") {
        const figures = ctx.seasonCheck?.raised;
        return {
          ...base,
          words: figures ? `Season check: ${figures}` : "Season check raised",
          detail: join("Raised by the engine", note),
        };
      }
      const kind = pickLabel(HOLD_KIND_LABELS[p.kind], "en");
      // A label that is its kind's own word ("Mass balance") is said once.
      const words = p.label.toLowerCase() === kind.toLowerCase() ? kind : `${p.label}: ${kind}`;
      return { ...base, words, detail: join("Raised by the engine", note) };
    }
    case "hold.resolved": {
      const p = event.payload;
      if (p.resolution === "ENGINE_CLEARED") {
        // The engine clears the season check itself once the duplicate is counted once: machine work, in pencil.
        const figures = ctx.seasonCheck?.cleared;
        return {
          ...base,
          lane: "MACHINE",
          words: figures ? `Season check: ${figures}` : "Season check cleared",
          detail: join("Cleared by the engine", note),
        };
      }
      return {
        ...base,
        lane: "PEOPLE",
        words: `${p.label} resolved by ${ctx.personName(p.resolvedBy)}`,
        detail: join(RESOLUTION_WORDS[p.resolution], note),
      };
    }
    case "field.entered": {
      const p = event.payload;
      return {
        ...base,
        lane: "PEOPLE",
        words: `Slip ${p.serial} entered by ${ctx.personName(p.enteredBy)}`,
        detail: join(`${FIELD_WORDS[p.field] ?? "field"} ${p.value}`, note),
      };
    }
    case "extract.row": {
      const p = event.payload;
      return {
        ...base,
        words: `Read slip ${p.serial}${p.memberNo ? ` for ${p.memberNo}` : ""}`,
        detail:
          event.provenance === "seeded" || event.provenance === "replay"
            ? "Seed stand-in, not a Claude recording"
            : join("In a live run: read by Claude (claude-opus-5-5)", note),
      };
    }
    case "extract.quarantined":
      return {
        ...base,
        words: "Ignored text on a slip that looked like an instruction",
        detail: join("Text on a slip is never an instruction", note),
      };
    case "approval.signed": {
      const p = event.payload;
      const who = ctx.personName(p.role === "treasurer" ? "treasurer:analyn" : "board:ernesto");
      return {
        ...base,
        lane: "PEOPLE",
        words: `${who} signed`,
        detail: join(`key ${p.keyId}`, `batch ${format.hashGroups(p.batchSha256)}`, note),
      };
    }
    case "approval.declined": {
      const p = event.payload;
      return { ...base, lane: "PEOPLE", words: `${ctx.personName(p.by)} sent it back`, detail: p.reason };
    }
    case "webhook.received": {
      const p = event.payload;
      if (p.duplicate) {
        return {
          ...base,
          lane: "PAYPAL",
          words: "Delivery repeated, already applied.",
          detail: join(p.eventType, verification(event)),
          duplicate: true,
        };
      }
      return { ...base, lane: "PAYPAL", words: `PayPal notice: ${p.eventType}`, detail: verification(event) };
    }
    case "invoice.state": {
      const p = event.payload;
      const status = pickLabel(INVOICE_STATUS_LABELS[p.to], "en");
      return {
        ...base,
        lane: "PAYPAL",
        words: `Invoice ${p.invoiceNumber}: ${status}`,
        detail: join("Invoicing v2", note),
      };
    }
    case "policy.verdict": {
      const p = event.payload;
      const words =
        p.verdict === "DENY"
          ? `Policy refused ${p.tool}`
          : p.verdict === "REQUIRE_APPROVAL"
            ? `Policy asked for a person on ${p.tool}`
            : `Policy allowed ${p.tool}`;
      return { ...base, words, detail: join(p.decidedBy.join(", "), note) };
    }
    case "flag.changed": {
      const p = event.payload;
      return {
        ...base,
        lane: "PEOPLE",
        words: p.on ? FLAG_WORDS[p.flag].on : FLAG_WORDS[p.flag].off,
        detail: `Set by ${ctx.personName(p.by)}`,
      };
    }
    case "capture.synced":
      return {
        ...base,
        lane: "PEOPLE",
        words: "A slip photo arrived from the clerk's phone",
        detail: note ?? "",
      };
    case "presence":
    case "agent.delta":
    case "extract.field":
      return null;
  }
}

/** The newest row in each lane, for the stage ribbon. */
export function latestByLane(rows: readonly LogRow[]): Readonly<Record<LogLane, LogRow | null>> {
  const out: Record<LogLane, LogRow | null> = { MACHINE: null, PEOPLE: null, PAYPAL: null };
  for (const row of rows) out[row.lane] = row;
  return out;
}
