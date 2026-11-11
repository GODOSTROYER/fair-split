// Words for a farmer or a judge, never a developer (UI gate round 4). The policy lattice names its rules in camelCase
// (invoiceEqualsQuote) and the agent's tools in snake_case (create_invoice); neither belongs in visible text. A
// refusal reads "Refused · invoice must equal quote", and the rule's own id stays in the id style behind "Why" (or in
// a row's detail), where a technical reader looks for it. File names (keys.json) belong behind an IDs disclosure.

import { format } from "./format.js";

/** Each policy rule (packages/domain POLICIES, register §9) in a few plain words. */
const RULE_WORDS: Readonly<Record<string, string>> = {
  killSwitch: "payouts are paused",
  sandboxOnly: "simulated sandbox only",
  allowlist: "action not allowed",
  phaseGate: "not at this step",
  budgetCap: "over the budget cap",
  invoiceEqualsQuote: "invoice must equal quote",
  invoicerIsBusinessEmail: "invoice must come from the co-op",
  recipientInBrandAllowlist: "recipient must be the buyer",
  referenceCarriesHash: "reference must carry the hash",
  dueWithin30Days: "due within 30 days",
  sendNeedsTreasurer: "the treasurer sends it",
};

/**
 * Rules that say only that a step is not open (or not allowed) at all. A refusal names the rule that says what was
 * wrong with the attempt first, and one of these only when nothing else refused it.
 */
const GATE_RULES: ReadonlySet<string> = new Set(["phaseGate", "allowlist", "sandboxOnly", "killSwitch"]);

/** Each agent tool by what it makes or does. */
const TOOL_WORDS: Readonly<Record<string, string>> = {
  create_invoice: "invoice draft",
  send_invoice: "invoice send",
  record_payment: "payment record",
  cancel_invoice: "invoice cancel",
  create_payout: "payout batch",
  create_payouts: "payout batch",
  cancel_payout_item: "payout cancel",
};

/** "someNewRule" or "some_new_rule" as "some new rule". */
function spaced(id: string): string {
  return id
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

/** A policy rule's id in plain words ("invoiceEqualsQuote" is "invoice must equal quote"). */
export function ruleWords(ruleId: string): string {
  return RULE_WORDS[ruleId] ?? spaced(ruleId);
}

/** An agent tool's name in plain words ("create_invoice" is "invoice draft"). */
export function toolWords(tool: string): string {
  return TOOL_WORDS[tool] ?? spaced(tool);
}

/** The rule that best says why: the first that is not a bare gate, else the first. */
export function tellingRule(decidedBy: readonly string[]): string | null {
  return decidedBy.find((r) => !GATE_RULES.has(r)) ?? decidedBy[0] ?? null;
}

/** A refusal's title: "Refused · invoice must equal quote" (just "Refused" when no rule is named). */
export function refusalTitle(decidedBy: readonly string[], refused = "Refused"): string {
  const rule = tellingRule(decidedBy);
  return rule ? `${refused} · ${ruleWords(rule)}` : refused;
}

// ------------------------------------------------------------------ captions for people (round 5: no ids for people)

/** A whole-dollar amount without its cents ("US$300"); other amounts keep them. */
function wholeMoney(cents: number): string {
  return format.money(cents).replace(/\.00$/, "");
}

/**
 * Under the Chair, what his key is for, in words: "Co-signs batches over US$300" (never "> US$300 · R5"). The rule's
 * id belongs in the row's title (`ruleTitle`).
 */
export function chairCaption(thresholdCents: number): string {
  return `Co-signs batches over ${wholeMoney(thresholdCents)}`;
}

/** Under the treasurer: where her key lives. Its id sits behind an "IDs" disclosure, never in this line. */
export const KEY_CAPTION = "Key on this browser";

/** The disclosure that holds ids, hashes and file names for a technical reader (as on Proof). */
export const IDS_LABEL = "IDs";

/** A rule's id for a title or an accessible name, never the visible text: "Rule R5". */
export function ruleTitle(ruleId: string, words?: string): string {
  return words ? `Rule ${ruleId} · ${words}` : `Rule ${ruleId}`;
}

/**
 * One term for the season's dial everywhere (the dial, Approve's checklist, a toast): "Shrink · limit 2.0%". The
 * engine's figure beside it is its own ("2.05%").
 */
export function shrinkLabel(tolBp: number): string {
  return `Shrink · limit ${format.percentBp(tolBp, 1)}`;
}

/** The dial's word on its own, where the limit is already said ("Shrink within limit"). */
export const SHRINK = "Shrink";

/**
 * The developer words in a visible string: camelCase identifiers (phaseGate), snake_case names (create_invoice) and
 * file names (keys.json). A screen's test asserts this is empty for its visible text.
 */
export function developerWords(text: string): string[] {
  const found = text.match(
    /\b[a-z]+(?:[A-Z][a-z0-9]*)+\b|\b[a-z0-9]+(?:_[a-z0-9]+)+\b|\b[\w-]+\.(?:json|ts|tsx|js|mjs)\b/g,
  );
  return found ? [...found] : [];
}
