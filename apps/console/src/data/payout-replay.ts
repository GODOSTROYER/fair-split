import type { Lang, MemberLineState, PayoutItemStatus, ProofBundle } from "@fairsplit/contracts";
import { translate } from "@fairsplit/i18n";
import type { RunView } from "./run-view.js";

/** Only this run’s payout evidence establishes replay; the current quota never does. */
export function payoutReplayed(view: RunView | undefined, bundle?: ProofBundle | null): boolean {
  return (
    Boolean(Object.values(view?.items ?? {}).some((item) => item.provenance === "replay")) ||
    Boolean(view?.events?.some((event) => event.type === "item.updated" && event.provenance === "replay")) ||
    Boolean(bundle?.batch.items.some((item) => item.provenance === "replay")) ||
    Boolean(bundle?.ledger.some((entry) => entry.kind === "payout.item.replayed"))
  );
}

export const PAYOUT_REPLAY_NOTE = "Replayed (labelled): earlier simulated PayPal sandbox run";
export const payoutReplaySummary = (successful: number, total: number): string =>
  `${total} payout statuses replayed (labelled) from an earlier simulated PayPal sandbox run; ${successful} successful in that source run.`;

export const SIMULATED_PAYOUT_LABEL = "Simulated PayPal sandbox";
export const REPLAY_STATUS_WORD = "Replayed (labelled)";
export const REPLAY_STATUS_DETAIL =
  "From an earlier simulated PayPal sandbox run. This is not payment confirmation for this run.";

const payoutAttempt = (id: string) => Number(/^r\d+x(\d+)-/.exec(id)?.[1] ?? 0);

export function currentPayoutItem(view: RunView, memberNo: string) {
  return Object.values(view.items)
    .filter((item) => item.memberNo === memberNo)
    .sort((a, b) => payoutAttempt(a.senderItemId) - payoutAttempt(b.senderItemId))
    .at(-1);
}

/** Member evidence is scoped to the item. A run's quota/provenance cannot relabel another line. */
export function memberPayoutReplayed(
  view: RunView | undefined,
  memberNo: string,
  bundle?: ProofBundle | null,
  senderItemId?: string,
): boolean {
  const belongs = (id: string) => id.endsWith(`-${memberNo}`);
  const candidates = [
    ...Object.values(view?.items ?? {})
      .filter((item) => item.memberNo === memberNo)
      .map((item) => item.senderItemId),
    ...(bundle?.batch.items.filter((item) => belongs(item.senderItemId)).map((item) => item.senderItemId) ??
      []),
  ];
  const current = senderItemId ?? candidates.sort((a, b) => payoutAttempt(a) - payoutAttempt(b)).at(-1);
  const matches = (id: string) => (current ? id === current : belongs(id));
  return Boolean(
    Object.values(view?.items ?? {}).some(
      (item) => matches(item.senderItemId) && item.provenance === "replay",
    ) ||
      view?.events.some(
        (event) =>
          event.type === "item.updated" &&
          matches(event.payload.senderItemId) &&
          event.provenance === "replay",
      ) ||
      bundle?.batch.items.some((item) => matches(item.senderItemId) && item.provenance === "replay") ||
      bundle?.ledger.some((entry) => {
        const p = entry.payload;
        return (
          entry.kind === "payout.item.replayed" &&
          p !== null &&
          typeof p === "object" &&
          !Array.isArray(p) &&
          (typeof p.senderItemId === "string" ? matches(p.senderItemId) : !current && p.memberNo === memberNo)
        );
      }),
  );
}

const ITEM_LINE: Record<PayoutItemStatus, MemberLineState> = {
  SUBMITTED: "SUBMITTED",
  PENDING: "PAYPAL_PENDING",
  SUCCESS: "PAID",
  UNCLAIMED: "UNCLAIMED",
  ONHOLD: "PAYPAL_HELD",
  RETURNED: "RETURNED",
  FAILED: "NEEDS_ACTION",
  BLOCKED: "NEEDS_ACTION",
  REFUNDED: "REVERSED",
  REVERSED: "REVERSED",
};
const PAYPAL_STATES: readonly MemberLineState[] = [
  "SUBMITTED",
  "PAYPAL_PENDING",
  "PAID",
  "UNCLAIMED",
  "RETURNED",
  "PAYPAL_HELD",
  "NEEDS_ACTION",
  "REVERSED",
];
type Tone = "neutral" | "pencil" | "canary" | "jade" | "hatch" | "red";
type AmountState = "pencil" | "ink" | "hollow" | "landed" | "attested";
const TONE: Record<MemberLineState, Tone> = {
  COMPUTED: "canary",
  READY: "canary",
  HELD: "canary",
  EXCLUDED: "neutral",
  LOCKED: "pencil",
  SUBMITTED: "pencil",
  PAYPAL_PENDING: "pencil",
  PAID: "jade",
  OFF_RAIL_DUE: "hatch",
  OFF_RAIL_PAID: "neutral",
  UNCLAIMED: "canary",
  RETURNED: "neutral",
  REROUTED: "pencil",
  PAYPAL_HELD: "canary",
  NEEDS_ACTION: "red",
  REVERSED: "red",
};

/** The console's sole payout presentation policy. Domain states stay intact; their display needs evidence. */
export function payoutStatus(input: {
  readonly state?: MemberLineState;
  readonly itemStatus?: PayoutItemStatus;
  readonly view?: RunView | undefined;
  readonly bundle?: ProofBundle | null | undefined;
  readonly memberNo?: string | null | undefined;
  readonly senderItemId?: string | undefined;
  readonly provenance?: string | undefined;
  readonly replayed?: boolean | undefined;
  readonly paypal?: boolean | undefined;
  readonly lang?: Lang;
  readonly statusWord?: string;
}) {
  const state = input.state ?? (input.itemStatus ? ITEM_LINE[input.itemStatus] : "READY");
  const paypal = input.paypal !== false && (input.itemStatus !== undefined || PAYPAL_STATES.includes(state));
  const replayed =
    paypal &&
    (input.provenance === "replay" ||
      input.replayed === true ||
      (input.memberNo
        ? memberPayoutReplayed(input.view, input.memberNo, input.bundle, input.senderItemId)
        : payoutReplayed(input.view, input.bundle)));
  const baseWord = input.statusWord ?? translate(input.lang ?? "en", `console.status.${state}`);
  const amountState: AmountState = replayed
    ? "hollow"
    : state === "PAID"
      ? "landed"
      : state === "OFF_RAIL_PAID"
        ? "attested"
        : [
              "SUBMITTED",
              "PAYPAL_PENDING",
              "UNCLAIMED",
              "PAYPAL_HELD",
              "OFF_RAIL_DUE",
              "RETURNED",
              "REROUTED",
              "NEEDS_ACTION",
              "REVERSED",
            ].includes(state)
          ? "hollow"
          : state === "LOCKED"
            ? "ink"
            : "pencil";
  return {
    state,
    replayed,
    statusWord: replayed
      ? `${REPLAY_STATUS_WORD}, ${SIMULATED_PAYOUT_LABEL}`
      : paypal
        ? `${baseWord} (${SIMULATED_PAYOUT_LABEL})`
        : baseWord,
    tone: replayed ? ("neutral" as const) : TONE[state],
    amountState,
    simulatedLabel: paypal ? SIMULATED_PAYOUT_LABEL : null,
    detail: replayed ? REPLAY_STATUS_DETAIL : null,
  };
}
