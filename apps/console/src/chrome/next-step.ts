// The run pill names the next human step and the stage pre-focuses its control (S1.6). The steps follow the
// judge's 60-second loop: mark paid, the replayed reading, slip 0462 by hand, the three holds, key 1, the
// Chair's key, PayPal confirming, Rhea's decision, then Proof. While the drawer is open on a hold that is still
// open, the pill names that hold's own decision, so it never points away from the card on screen. Pure: it
// reads the run view and the drawer's hold only.

import { webRoutes } from "@fairsplit/contracts";
import { type MessageKey, translate } from "@fairsplit/i18n";
import type { FramePersona } from "../data/adapter.js";
import { byHandHolds, holdCards, openHolds, type RunHold, type RunView } from "../data/run-view.js";
import type { ConsoleScreenId } from "../lib/screens.js";

export type StepId =
  | "mark-paid"
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
}

export interface NextStepContext {
  readonly inSession: boolean;
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
}

const en = (key: MessageKey, values?: Record<string, string | number>) => translate("en", key, values);

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
        text: en("W-JG-01.pill.confirming"),
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
        text: "PayPal declined the batch. Nothing was sent.",
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
