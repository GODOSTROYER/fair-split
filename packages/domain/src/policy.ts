// The policy lattice (register §9, S4.4): the verdict is the maximum over all policies, where
// ALLOW (0) < REQUIRE_APPROVAL (1) < DENY (2), so adding a policy can only make a call stricter.
// No tool moves money: create and cancel payouts are never agent tools (I6).
import {
  AGENT_TOOL_NAMES,
  type Decision,
  type InvoiceQuote,
  PAY_RUN_RANK,
  PAYOUT_READ_TOOLS,
  type PolicyCtx,
  type PolicyName,
  type PolicyResult,
  READ_TOOLS,
  TOOLKIT_TOOLS,
  type ToolCall,
  VERDICT_RANK,
  type Verdict,
} from "@fairsplit/contracts";
import { match, P } from "ts-pattern";
import { addDays } from "./format.js";
import { jcs } from "./jcs.js";
import { parseDecimalMinor } from "./money.js";

export type Rank = 0 | 1 | 2;
export type Policy = (call: ToolCall, ctx: PolicyCtx) => { verdict: Rank; reason: string | null };

const ALLOW = { verdict: 0 as Rank, reason: null };
const deny = (reason: string) => ({ verdict: 2 as Rank, reason });
const needsApproval = (reason: string) => ({ verdict: 1 as Rank, reason });

const known = new Set<string>(AGENT_TOOL_NAMES);
const toolkit = new Set<string>(TOOLKIT_TOOLS);
const payoutReads = new Set<string>(PAYOUT_READ_TOOLS);
const reads = new Set<string>(READ_TOOLS);

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** A normalised view of a PayPal Invoicing v2 create body (nested `detail` or flattened fields). */
export interface InvoiceDraftView {
  currencyCode: string | null;
  invoiceNumber: string | null;
  reference: string | null;
  note: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  invoicerEmail: string | null;
  recipientEmails: string[];
  items: {
    name: string | null;
    quantity: string | null;
    unitAmountCents: number | null;
    currency: string | null;
  }[];
}

export function readInvoiceDraft(args: unknown): InvoiceDraftView {
  const a = obj(args);
  const detail = obj(a.detail);
  const term = obj(detail.payment_term);
  const invoicer = obj(a.invoicer);
  const recipients = Array.isArray(a.primary_recipients) ? a.primary_recipients : [];
  const items = Array.isArray(a.items) ? a.items : [];
  return {
    currencyCode: str(detail.currency_code) ?? str(a.currency_code),
    invoiceNumber: str(detail.invoice_number) ?? str(a.invoice_number),
    reference: str(detail.reference) ?? str(a.reference),
    note: str(detail.note) ?? str(a.note),
    invoiceDate: str(detail.invoice_date) ?? str(a.invoice_date),
    dueDate: str(term.due_date) ?? str(a.due_date),
    invoicerEmail: str(invoicer.email_address) ?? str(a.invoicer_email_address),
    recipientEmails: recipients
      .map((r) => str(obj(obj(r).billing_info).email_address) ?? str(obj(r).email_address))
      .filter((e): e is string => e !== null),
    items: items.map((raw) => {
      const it = obj(raw);
      const unit = obj(it.unit_amount);
      const value = str(unit.value);
      return {
        name: str(it.name),
        quantity: str(it.quantity),
        unitAmountCents: value === null ? null : parseDecimalMinor(value),
        currency: str(unit.currency_code),
      };
    }),
  };
}

/** Every YYYY-MM-DD found under a key containing "date" (except invoice_date), anywhere in the args. */
export function scheduleDates(args: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key: string) => {
    if (typeof v === "string") {
      if (/date/i.test(key) && key !== "invoice_date" && /^\d{4}-\d{2}-\d{2}/.test(v))
        out.push(v.slice(0, 10));
      return;
    }
    if (Array.isArray(v)) for (const x of v) walk(x, key);
    else if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(args, "");
  return out;
}

const rankOf = (s: PolicyCtx["runState"]) => PAY_RUN_RANK[s];

export const killSwitch: Policy = (call, ctx) => {
  if (ctx.flags.killAiLive) return deny("kill_ai_live is on");
  // Payout reads are live PayPal calls too, so kill_paypal_live stops them as well (stricter).
  if (ctx.flags.killPaypalLive && (toolkit.has(call.name) || payoutReads.has(call.name))) {
    return deny("kill_paypal_live is on");
  }
  if (ctx.flags.killPayouts && call.name === "request_payout_batch") return deny("kill_payouts is on");
  return ALLOW;
};

export const sandboxOnly: Policy = (call, ctx) => {
  if (!(toolkit.has(call.name) || payoutReads.has(call.name))) return ALLOW;
  return ctx.ppEnv === "sandbox" && ctx.toolkitSandbox ? ALLOW : deny("PayPal tools run in the sandbox only");
};

export const allowlist: Policy = (call) =>
  known.has(call.name) ? ALLOW : deny(`${call.name} is not an agent tool`);

export const phaseGate: Policy = (call, ctx) => {
  const s = ctx.runState;
  const a = obj(call.args);
  return match(call.name)
    .when(
      (n) => reads.has(n),
      () => ALLOW,
    )
    .with("get_invoice", () => (rankOf(s) >= rankOf("QUOTED") ? ALLOW : deny("no invoice before QUOTED")))
    .with("create_invoice", () =>
      s !== "QUOTED"
        ? deny("create_invoice only in QUOTED")
        : ctx.invoiceExists
          ? deny("the invoice already exists")
          : ALLOW,
    )
    .with("create_conditional_rules_for_invoice", () =>
      s === "QUOTED" && ctx.invoiceExists ? ALLOW : deny("the AUTO_CANCEL rule needs the invoice, in QUOTED"),
    )
    .with("send_invoice", () =>
      s === "QUOTED" && ctx.invoiceExists ? ALLOW : deny("send_invoice needs the invoice, in QUOTED"),
    )
    .with("propose_resolution", () => {
      if (s !== "IN_REVIEW") return deny("propose_resolution only in IN_REVIEW");
      const holdId = str(a.hold_id);
      const hold = ctx.holds.find((h) => h.holdId === holdId);
      return hold && hold.state === "OPEN" ? ALLOW : deny("the hold is not open");
    })
    .with("request_payout_batch", () => {
      if (s !== "IN_REVIEW") return deny("request_payout_batch only in IN_REVIEW");
      const blocking = ctx.holds.some(
        (h) => (h.state === "OPEN" || h.state === "ASKED_CHAIR") && h.gate === "BLOCKS_APPROVAL",
      );
      return blocking ? deny("a hold still blocks approval") : ALLOW;
    })
    .with(P.union("get_payout_batch", "get_payout_item"), () =>
      (rankOf(s) >= rankOf("POSTED") && rankOf(s) < 99) || s === "DENIED"
        ? ALLOW
        : deny("payout reads only after the batch is posted"),
    )
    .otherwise(() => deny("no phase allows this tool"));
};

export const budgetCap: Policy = (_call, ctx) => {
  if (ctx.budget.spentMicros >= ctx.budget.capMicros) return deny("session budget spent");
  if (ctx.budget.iteration >= ctx.budget.maxIterations) return deny("iteration limit reached");
  return ALLOW;
};

/**
 * Keys that move money on an Invoicing v2 create body. A code quote has none of them, so any one,
 * at any depth, means PayPal would bill something other than the quote (I1).
 */
export const INVOICE_MONEY_KEYS: ReadonlySet<string> = new Set([
  "amount",
  "breakdown",
  "item_total",
  "tax",
  "tax_total",
  "discount",
  "item_discount",
  "invoice_discount",
  "shipping",
  "custom",
  "gratuity",
  "minimum_amount_due",
  "due_amount",
  "payments",
  "refunds",
  "template_id",
]);

/** Toggles that let the payer pay a different amount: they must be absent or false. */
const PAYMENT_TOGGLES: ReadonlySet<string> = new Set(["allow_partial_payment", "allow_tip"]);

/** Item fields that move no money; anything else on an item is refused. */
const ITEM_WORD_KEYS: ReadonlySet<string> = new Set([
  "name",
  "description",
  "quantity",
  "unit_amount",
  "unit_of_measure",
  "item_date",
]);

/** The money a create_invoice body carries, normalised: what the quote must deep-equal. */
export interface InvoiceMoney {
  currency: string | null;
  items: {
    name: string | null;
    quantity: string | null;
    unitAmountCents: number | null;
    currency: string | null;
  }[];
  /** Paths of money-bearing keys and payment toggles that are on, e.g. "items[1].discount". */
  extras: string[];
}

export function invoiceMoney(args: unknown): InvoiceMoney {
  const d = readInvoiceDraft(args);
  const extras: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) {
      for (const [i, x] of v.entries()) walk(x, `${path}[${i}]`);
      return;
    }
    if (v === null || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      const at = path ? `${path}.${k}` : k;
      if (INVOICE_MONEY_KEYS.has(k) || (PAYMENT_TOGGLES.has(k) && x !== false)) extras.push(at);
      else walk(x, at);
    }
  };
  walk(args, "");
  const items = Array.isArray(obj(args).items) ? (obj(args).items as unknown[]) : [];
  items.forEach((raw, i) => {
    for (const k of Object.keys(obj(raw))) {
      if (!ITEM_WORD_KEYS.has(k) && !INVOICE_MONEY_KEYS.has(k)) extras.push(`items[${i}].${k}`);
    }
  });
  return { currency: d.currencyCode, items: d.items, extras };
}

/** The money fields create_invoice must carry for a quote: its three lines, nothing else. */
export function quoteMoney(quote: InvoiceQuote): InvoiceMoney {
  return {
    currency: quote.currency,
    items: quote.items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitAmountCents: i.unitAmountCents,
      currency: quote.currency,
    })),
    extras: [],
  };
}

/** I1: the agent's draft must deep-equal the code quote in every field that moves money. */
export const invoiceEqualsQuote: Policy = (call, ctx) => {
  if (call.name !== "create_invoice") return ALLOW;
  const want = quoteMoney(ctx.expected.quote);
  const got = invoiceMoney(call.args);
  const extra = got.extras[0];
  if (extra !== undefined) return deny(`${extra} is not in the quote`);
  if (got.currency !== want.currency) return deny("currency differs from the quote");
  if (readInvoiceDraft(call.args).invoiceNumber !== ctx.expected.invoiceNumber) {
    return deny("invoice_number differs from the code's");
  }
  if (got.items.length !== want.items.length) return deny("item count differs from the quote");
  for (let i = 0; i < want.items.length; i++) {
    const w = want.items[i];
    const g = got.items[i];
    if (!w || !g) return deny("item missing");
    if (g.name !== w.name) return deny(`item ${i + 1} name differs from the quote`);
    if (g.quantity !== w.quantity) return deny(`item ${i + 1} quantity differs`);
    if (g.unitAmountCents !== w.unitAmountCents) return deny(`item ${i + 1} amount differs from the quote`);
    if (g.currency !== w.currency) return deny(`item ${i + 1} currency differs`);
  }
  // Belt and braces: the normalised draft must be exactly the quote's money.
  return jcs(got) === jcs(want) ? ALLOW : deny("the draft's money differs from the quote");
};

export const invoicerIsBusinessEmail: Policy = (call, ctx) => {
  if (call.name !== "create_invoice") return ALLOW;
  const e = readInvoiceDraft(call.args).invoicerEmail;
  return e !== null && e.toLowerCase() === ctx.expected.businessEmail.toLowerCase()
    ? ALLOW
    : deny("the invoicer is not the co-op's business account");
};

export const recipientInBrandAllowlist: Policy = (call, ctx) => {
  if (call.name !== "create_invoice") return ALLOW;
  const emails = readInvoiceDraft(call.args).recipientEmails;
  const allowed = new Set(ctx.expected.brandAllowlist.map((e) => e.toLowerCase()));
  if (emails.length === 0) return deny("no recipient");
  return emails.every((e) => allowed.has(e.toLowerCase()))
    ? ALLOW
    : deny("a recipient is not on the brand allowlist");
};

export const referenceCarriesHash: Policy = (call, ctx) => {
  if (call.name !== "create_invoice") return ALLOW;
  const d = readInvoiceDraft(call.args);
  if (d.reference !== ctx.expected.reference) return deny("reference must be rc:{rateCardSha16}");
  return d.note?.includes(ctx.expected.memo) ? ALLOW : deny("the note must carry the code-rendered memo");
};

export const dueWithin30Days: Policy = (call, ctx) => {
  if (call.name !== "create_invoice" && call.name !== "create_conditional_rules_for_invoice") return ALLOW;
  const dates = scheduleDates(call.args);
  if (dates.length === 0) return deny("no due or AUTO_CANCEL date");
  const latest = addDays(ctx.today, 30);
  return dates.every((d) => d > ctx.today && d <= latest)
    ? ALLOW
    : deny("dates must be after today and within 30 days");
};

export const sendNeedsTreasurer: Policy = (call) =>
  call.name === "send_invoice" ? needsApproval("send_invoice waits for the treasurer") : ALLOW;

/** The named policies, in register §9 order. */
export const POLICIES: Readonly<Record<PolicyName, Policy>> = {
  killSwitch,
  sandboxOnly,
  allowlist,
  phaseGate,
  budgetCap,
  invoiceEqualsQuote,
  invoicerIsBusinessEmail,
  recipientInBrandAllowlist,
  referenceCarriesHash,
  dueWithin30Days,
  sendNeedsTreasurer,
};

const VERDICTS: readonly Verdict[] = ["ALLOW", "REQUIRE_APPROVAL", "DENY"];

/** Max over a set of policies. With no policies the verdict is ALLOW. */
export function decideWith(
  call: ToolCall,
  ctx: PolicyCtx,
  policies: Readonly<Partial<Record<PolicyName, Policy>>>,
): Decision {
  const results: PolicyResult[] = [];
  let rank: Rank = 0;
  for (const [name, policy] of Object.entries(policies) as [PolicyName, Policy][]) {
    const r = policy(call, ctx);
    results.push({ policy: name, verdict: VERDICTS[r.verdict] as Verdict, reason: r.reason });
    if (r.verdict > rank) rank = r.verdict;
  }
  const verdict = VERDICTS[rank] as Verdict;
  return {
    tool: call.name,
    verdict,
    rank,
    results,
    decidedBy: rank === 0 ? [] : results.filter((r) => VERDICT_RANK[r.verdict] === rank).map((r) => r.policy),
  };
}

/** IC-02 `decide(call, ctx)`: the maximum verdict over every named policy. */
export function decide(call: ToolCall, ctx: PolicyCtx): Decision {
  return decideWith(call, ctx, POLICIES);
}
