// The run pill names the next human step and the stage pre-focuses its control (S1.6). The steps follow the
// judge's 60-second loop: mark paid, the replayed reading, slip 0462 by hand, the three holds, key 1, the
// Chair's key, PayPal confirming, Rhea's decision, then Proof. While the drawer is open on a hold that is still
// open, the pill names that hold's own decision, so it never points away from the card on screen. Pure: it
// reads the run view and the drawer's hold only.

import { webRoutes } from "@fairsplit/contracts";
import { type MessageKey, translate } from "@fairsplit/i18n";
import type { FramePersona } from "../data/adapter.js";
import { payoutStatus } from "../data/payout-replay.js";
import { byHandHolds, holdCards, openHolds, type RunHold, type RunView } from "../data/run-view.js";
import type { ConsoleScreenId } from "../lib/screens.js";

export type StepId =
  | "mark-paid"
  | "recording"
  | "reading"
  | "by-hand"
  | "holds"
  | "approve"
  | "cosign"
  | "confirming"
  | "rhea"
  | "done"
  | "denied"
  | "halted"
  | "cancelled";

/** Who moves the run next: a person (canary marker), the machine (pencil), PayPal (an open ring), or nobody. */
export type StepActor = "person" | "machine" | "paypal" | "done";

export interface NextStep {
  readonly id: StepId;
  /** The pill's words. */
  readonly text: string;
  readonly actor: StepActor;
  /** The screen whose control the stage pre-focuses. */
  readonly screen: ConsoleScreenId;
  /** Where the pill takes the judge. */
  readonly to: string;
  /** A phone frame to raise for this step (the Chair's key). */
  readonly persona?: FramePersona;
  /**
   * The run's state in the pill's words when the register's word would overclaim (UI gate round 3): a settled run
   * with cash still due at the bodega reads "PayPal complete · cash due", never "Settled".
   */
  readonly stateWord?: string;
}

export interface NextStepContext {
  readonly inSession: boolean;
  readonly pressing?: boolean;
  /** "2026-A" */
  readonly season: string;
  /** The recording date for the replay line, already formatted ("29 Oct"). */
  readonly recordedOn: string;
  /** The by-hand slip ("0462"). */
  readonly byHandSlip: string;
  /** Items in the batch (8). */
  readonly payouts: number;
  /** The hold open in the drawer (`?hold=`, a label or an ID): the pill names that hold's own decision. */
  readonly openHold?: string | null;
  /** Members the plan pays in cash at the bodega (the snapshot's 56): until each is received, cash is due. */
  readonly cashMembers?: number;
}

/**
 * Cash is still due on a settled run: a cash line reads due, or fewer cash lines read received than the plan pays
 * in cash. A settled run is PayPal's part complete, never the whole run, until the bodega's cash is handed over.
 */
export function cashStillDue(view: RunView, cashMembers = 0): boolean {
  const lines = Object.values(view.lines);
  if (lines.some((l) => l.state === "OFF_RAIL_DUE")) return true;
  return lines.filter((l) => l.state === "OFF_RAIL_PAID").length < cashMembers;
}

const en = (key: MessageKey, values?: Record<string, string | number>) => translate("en", key, values);

/** Names the pill keeps capitalised after "Next:" (people, PayPal, Proof). */
const PROPER = /^(PayPal|Proof|Ernesto|Analyn|Rhea|Claude|Lantern)\b/;

/**
 * The pill's words always start "Next:" (round 5): "Review cash handover" reads "Next: review cash handover", "Open
 * Proof" reads "Next: open Proof". Words that already start "Next:" are kept; a name keeps its capital.
 */
export function pillWords(text: string): string {
  const words = text.trim();
  if (/^Next:/.test(words)) return words;
  const first =
    PROPER.test(words) || /^[A-Z]{2}/.test(words) ? words : words.charAt(0).toLowerCase() + words.slice(1);
  return `Next: ${first}`;
}

/** What deciding each hold card means, in the pill's words (S1.7 W-TR-06's slabs). */
const HOLD_DECISION: Partial<Record<RunHold["kind"], string>> = {
  DUPLICATE_SLIP: "count it once",
  IMPLAUSIBLE_YIELD: "register a plot",
  NO_RULE: "return the multa as a credit",
};

/** The open hold card the drawer shows, if the drawer is open on one. */
function drawerHold(view: RunView, openHold: string | null | undefined): RunHold | null {
  if (!openHold) return null;
  const hold = Object.values(view.holds).find((h) => h.label === openHold || h.holdId === openHold);
  return hold && HOLD_DECISION[hold.kind] && openHolds(view).includes(hold) ? hold : null;
}

export function nextStep(view: RunView | undefined, ctx: NextStepContext): NextStep {
  const runSlug = view?.runSlug ?? "";
  const markPaid: NextStep = {
    id: "mark-paid",
    text: en("W-JG-01.pill.markPaid"),
    actor: "person",
    screen: "W-JG-01",
    to: webRoutes.judge(),
  };
  if (ctx.pressing && (!view || ["DRAFT", "QUOTED", "INVOICED"].includes(view.state)))
    return { ...markPaid, id: "recording", actor: "paypal", text: en("W-JG-01.pill.recording") };
  if (!view || !ctx.inSession) return markPaid;
  switch (view.state) {
    case "DRAFT":
    case "QUOTED":
    case "INVOICED":
      return markPaid;
    case "FUNDED":
    case "EXTRACTING":
      return {
        id: "reading",
        text: en("W-JG-01.pill.reading"),
        actor: "machine",
        screen: "W-TR-03",
        to: webRoutes.reading(ctx.season),
      };
    case "COMPUTED":
    case "IN_REVIEW": {
      const shown = drawerHold(view, ctx.openHold);
      if (shown) {
        return {
          id: "holds",
          text: `Next: ${HOLD_DECISION[shown.kind]} (${shown.label})`,
          actor: "person",
          screen: "W-TR-06",
          to: webRoutes.holdDrawer(runSlug, shown.label),
        };
      }
      if (byHandHolds(view).some((h) => h.state === "OPEN")) {
        return {
          id: "by-hand",
          text: en("W-JG-01.pill.byHand", { slip: ctx.byHandSlip }),
          actor: "person",
          screen: "W-TR-04",
          to: webRoutes.byHand(ctx.season, ctx.byHandSlip),
        };
      }
      const open = holdCards(view).filter((h) => openHolds(view).includes(h));
      const first = open[0];
      if (first) {
        return {
          id: "holds",
          text: en("W-JG-01.pill.holds", { count: open.length }),
          actor: "person",
          screen: "W-TR-06",
          to: webRoutes.holdDrawer(runSlug, first.label),
        };
      }
      return {
        id: "approve",
        text: en("W-JG-01.pill.approve", { count: ctx.payouts }),
        actor: "person",
        screen: "W-TR-07",
        to: webRoutes.approve(runSlug),
      };
    }
    case "TREASURER_APPROVED":
    case "AWAITING_BOARD":
      return {
        id: "cosign",
        text: en("W-JG-01.pill.cosign"),
        actor: "person",
        screen: "W-TR-07",
        to: webRoutes.approve(runSlug),
        persona: "chair",
      };
    case "APPROVED":
    case "POSTING":
    case "POSTED":
    case "SETTLING":
      return {
        id: "confirming",
        text: payoutStatus({ itemStatus: "PENDING", view }).replayed
          ? "Replaying payout statuses from an earlier simulated PayPal sandbox run"
          : en("W-JG-01.pill.confirming"),
        actor: "paypal",
        screen: "W-TR-08",
        to: webRoutes.fanout(runSlug),
      };
    case "NEEDS_FOLLOW_UP":
      return {
        id: "rhea",
        text: en("W-JG-01.pill.rhea"),
        actor: "person",
        screen: "W-TR-08",
        to: webRoutes.fanout(runSlug),
      };
    case "SETTLED":
    case "CLOSED":
      // PayPal's part is complete; with cash still due at the bodega the pill never says Settled or Done. Proof
      // lists every cash line as due, so the review is there.
      if (cashStillDue(view, ctx.cashMembers ?? 0)) {
        return {
          id: "done",
          text: en("W-JG-01.pill.cashDue"),
          actor: "person",
          screen: "W-PF-01",
          to: webRoutes.proof(runSlug),
          stateWord: en("W-JG-01.pill.stateCashDue"),
        };
      }
      return {
        id: "done",
        text: en("W-JG-01.pill.done"),
        actor: "done",
        screen: "W-PF-01",
        to: webRoutes.proof(runSlug),
      };
    case "DENIED":
      return {
        id: "denied",
        text: "The simulated PayPal sandbox declined the batch. Nothing was sent.",
        actor: "paypal",
        screen: "W-TR-07",
        to: webRoutes.approve(runSlug),
      };
    case "HALTED":
      return {
        id: "halted",
        text: "Payouts paused by the co-op.",
        actor: "person",
        screen: "W-TR-07",
        to: webRoutes.approve(runSlug),
      };
    case "CANCELLED":
      return {
        id: "cancelled",
        text: "This run was cancelled. Reset to start again.",
        actor: "done",
        screen: "W-JG-01",
        to: webRoutes.judge(),
      };
  }
}
