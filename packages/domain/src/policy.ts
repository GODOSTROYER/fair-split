// The policy lattice (register §9, S4.4): the verdict is the maximum over all policies, where
// ALLOW (0) < REQUIRE_APPROVAL (1) < DENY (2), so adding a policy can only make a call stricter.
// No tool moves money: create and cancel payouts are never agent tools (I6).
import {
  AGENT_TOOL_NAMES,
  type Decision,
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
import {
  AUTO_CANCEL_MAX_DAYS_AHEAD,
  autoCancelDate,
  autoCancelRuleArgs,
  canonicalInvoice,
  itemLabelProblem,
  parseStrictIsoDate,
} from "./invoice.js";
import { minorToDecimal, parseDecimalMinor } from "./money.js";

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

// ---------------------------------------------------------------- reading a draft (one shape)
// Drafts are toolkit 1.11.0 `create_invoice` arguments: flat fields, with recipients and items in
// PayPal's nested shape. That is the only shape read. A field given both flat and in the REST API's
// nested form is ambiguous and denied; the nested form alone is never read.

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const has = (o: Record<string, unknown>, k: string) => Object.hasOwn(o, k);
const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

/** Flat toolkit fields and the REST API's nested spelling of the same field. */
const NESTED_ALIASES: readonly (readonly [flat: string, nested: readonly [string, string]])[] = [
  ["currency_code", ["detail", "currency_code"]],
  ["invoice_number", ["detail", "invoice_number"]],
  ["reference", ["detail", "reference"]],
  ["note", ["detail", "note"]],
  ["invoice_date", ["detail", "invoice_date"]],
  ["invoicer_email_address", ["invoicer", "email_address"]],
];

type FlatField = "currency_code" | "invoice_number" | "reference" | "note" | "invoicer_email_address";

export interface InvoiceFields {
  /** Flat fields as given (null when absent or not a string). */
  values: Readonly<Record<FlatField, string | null>>;
  /** Flat fields that are absent while their nested spelling is present: flat field → nested path. */
  nestedOnly: Readonly<Partial<Record<string, string>>>;
  /** Readable `primary_recipients[].billing_info.email_address` values. */
  recipientEmails: string[];
}

export type InvoiceFieldsRead = { ok: true; fields: InvoiceFields } | { ok: false; reason: string };

/** Reads a create_invoice draft in its one canonical shape, refusing ambiguity. */
export function readInvoiceFields(args: unknown): InvoiceFieldsRead {
  if (!isRecord(args)) return { ok: false, reason: "The draft is not an invoice body" };
  const nestedOnly: Record<string, string> = {};
  for (const [flat, [parent, key]] of NESTED_ALIASES) {
    const container = args[parent];
    const nested = isRecord(container) && has(container, key);
    if (!nested) continue;
    const nestedPath = `${parent}.${key}`;
    if (has(args, flat)) {
      return { ok: false, reason: `Ambiguous draft: ${flat} is given both as ${flat} and as ${nestedPath}` };
    }
    nestedOnly[flat] = nestedPath;
  }
  const str = (k: FlatField) => (typeof args[k] === "string" ? (args[k] as string) : null);
  const recipients = Array.isArray(args.primary_recipients) ? args.primary_recipients : [];
  return {
    ok: true,
    fields: {
      values: {
        currency_code: str("currency_code"),
        invoice_number: str("invoice_number"),
        reference: str("reference"),
        note: str("note"),
        invoicer_email_address: str("invoicer_email_address"),
      },
      nestedOnly,
      recipientEmails: recipients
        .map((r) => (isRecord(r) && isRecord(r.billing_info) ? r.billing_info.email_address : null))
        .filter((e): e is string => typeof e === "string" && EMAIL.test(e)),
    },
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One flat field's value, or why it cannot be read (ambiguous or only in the nested form). */
function field(
  read: InvoiceFieldsRead,
  k: FlatField,
): { ok: true; value: string | null } | { ok: false; reason: string } {
  if (!read.ok) return read;
  const nested = read.fields.nestedOnly[k];
  if (nested) return { ok: false, reason: `Non-canonical draft: ${k} must be the flat field, not ${nested}` };
  return { ok: true, value: read.fields.values[k] };
}

/** Keys that name where an invoice or its notifications go. */
const RECIPIENT_KEYS: ReadonlySet<string> = new Set([
  "primary_recipients",
  "additional_recipients",
  "recipients",
  "recipient",
  "email_address",
  "email",
  "emails",
  "phones",
  "phone",
  "shipping_info",
  "cc",
  "bcc",
  "cc_recipients",
  "send_to",
  "to",
]);
const RECIPIENT_EMAIL_PATH = /^primary_recipients\[\d+\]\.billing_info\.email_address$/;

/** Paths of recipient-bearing keys anywhere in the draft other than the one allowed place. */
function strayRecipientFields(args: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) {
      for (const [i, x] of v.entries()) walk(x, `${path}[${i}]`);
      return;
    }
    if (!isRecord(v)) return;
    for (const [k, x] of Object.entries(v)) {
      const at = join(path, k);
      const allowed = (path === "" && k === "primary_recipients") || RECIPIENT_EMAIL_PATH.test(at);
      if (RECIPIENT_KEYS.has(k) && !allowed) out.push(at);
      else walk(x, at);
    }
  };
  walk(args, "");
  return out.sort();
}

/** Paths of keys that set a date or a payment term, anywhere in the args (not descended into). */
function dateFields(args: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) {
      for (const [i, x] of v.entries()) walk(x, `${path}[${i}]`);
      return;
    }
    if (!isRecord(v)) return;
    for (const [k, x] of Object.entries(v)) {
      const at = join(path, k);
      if (/date/i.test(k) || k === "payment_term" || k === "term_type") out.push(at);
      else walk(x, at);
    }
  };
  walk(args, "");
  return out.sort();
}

/** A strict allowlist: "leaf" is any value, `[s]` a list of `s`, an object only the keys it names. */
type Shape = "leaf" | readonly [Shape] | { readonly [key: string]: Shape };

const INVOICE_SHAPE: Shape = {
  currency_code: "leaf",
  invoice_number: "leaf",
  reference: "leaf",
  note: "leaf",
  invoicer_email_address: "leaf",
  primary_recipients: [{ billing_info: { business_name: "leaf", email_address: "leaf" } }],
  items: [
    {
      name: "leaf",
      quantity: "leaf",
      unit_amount: { currency_code: "leaf", value: "leaf" },
      unit_of_measure: "leaf",
    },
  ],
};

const RULE_SHAPE: Shape = {
  invoice_id: "leaf",
  rules: [
    {
      conditional_rule_type: "leaf",
      rule_expiry_terms: { rule_expiry_condition: "leaf", condition_rule_end_date: "leaf" },
    },
  ],
};

/** send_invoice: this run's invoice, never e-mailed by PayPal (register §8, send_to_recipient false). */
const SEND_SHAPE: Shape = { invoice_id: "leaf", send_to_recipient: "leaf" };
export const canonicalSend = (invoiceId: string) => ({ invoice_id: invoiceId, send_to_recipient: false });

/** Every key the shape does not allow, by path, sorted. */
function unknownKeys(value: unknown, shape: Shape, path = "", out: string[] = []): string[] {
  if (shape === "leaf") return out;
  if (Array.isArray(shape)) {
    if (Array.isArray(value)) {
      for (const [i, x] of value.entries()) unknownKeys(x, shape[0] as Shape, `${path}[${i}]`, out);
    }
    return out;
  }
  if (!isRecord(value)) return out;
  const allowed = shape as { readonly [key: string]: Shape };
  for (const [k, x] of Object.entries(value)) {
    const sub = Object.hasOwn(allowed, k) ? allowed[k] : undefined;
    if (sub === undefined) out.push(join(path, k));
    else unknownKeys(x, sub, join(path, k), out);
  }
  return out.sort();
}

/** Paths where two JSON values differ (missing keys, lengths, types and values). */
function differences(a: unknown, b: unknown, path = "", out: string[] = []): string[] {
  if (isRecord(a) && isRecord(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (!has(a, k) || !has(b, k)) out.push(join(path, k));
      else differences(a[k], b[k], join(path, k), out);
    }
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(path || "(body)");
    else for (const [i, x] of a.entries()) differences(x, b[i], `${path}[${i}]`, out);
  } else if (a !== b) {
    out.push(path || "(body)");
  }
  return out;
}

/** Normalisation before comparing: amounts as two-decimal cents, e-mail addresses in lower case. */
function normalised(body: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(body ?? null)) as unknown;
  if (!isRecord(copy)) return copy;
  const lower = (o: Record<string, unknown>, k: string) => {
    if (typeof o[k] === "string") o[k] = (o[k] as string).toLowerCase();
  };
  lower(copy, "invoicer_email_address");
  for (const r of Array.isArray(copy.primary_recipients) ? copy.primary_recipients : []) {
    if (isRecord(r) && isRecord(r.billing_info)) lower(r.billing_info, "email_address");
  }
  for (const it of Array.isArray(copy.items) ? copy.items : []) {
    if (isRecord(it) && isRecord(it.unit_amount) && typeof it.unit_amount.value === "string") {
      const cents = parseDecimalMinor(it.unit_amount.value);
      if (cents !== null) it.unit_amount.value = minorToDecimal(cents);
    }
  }
  return copy;
}

const differReason = (paths: readonly string[], what: string) =>
  `${paths.join(", ")} ${paths.length === 1 ? "differs" : "differ"} from the code's ${what}`;

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

/** The invoice date PayPal recorded and today, both read strictly, or why not. */
function invoiceDates(
  ctx: PolicyCtx,
): { ok: true; invoiceDate: string; today: string } | { ok: false; reason: string } {
  if (ctx.expected.invoiceDate === null) return { ok: false, reason: "The invoice's date is not known yet" };
  const invoiceDate = parseStrictIsoDate(ctx.expected.invoiceDate);
  if (invoiceDate === null) return { ok: false, reason: "The invoice's date is not a YYYY-MM-DD date" };
  const today = parseStrictIsoDate(ctx.today);
  if (today === null) return { ok: false, reason: "Today is not a YYYY-MM-DD date" };
  return { ok: true, invoiceDate, today };
}

/**
 * I1: each invoice call deep-equals its canonical form, built by code. For create_invoice that is
 * `canonicalInvoice(quote, labels)`, where only the three item labels are the agent's; for the
 * AUTO_CANCEL rule it is `autoCancelRuleArgs(invoiceId, invoice date + 25)`; for send_invoice it is
 * `{invoice_id: this run's invoice, send_to_recipient: false}`. Every key the canonical
 * form does not carry (tax, discount, shipping, tip, partial payment, pay by bank, theme, extra
 * recipients, dates…) is named in the verdict; then the whole body is compared after normalising.
 */
export const invoiceEqualsQuote: Policy = (call, ctx) => {
  if (call.name === "create_invoice") {
    const read = readInvoiceFields(call.args);
    if (!read.ok) return deny(read.reason);
    const nested = Object.entries(read.fields.nestedOnly)[0];
    if (nested) return deny(`Non-canonical draft: ${nested[0]} must be the flat field, not ${nested[1]}`);
    const extra = unknownKeys(call.args, INVOICE_SHAPE);
    if (extra.length > 0) return deny(`Not in the canonical invoice: ${extra.join(", ")}`);
    const items = (call.args as Record<string, unknown>).items;
    let labels: string[] | undefined;
    if (Array.isArray(items) && items.length === ctx.expected.quote.items.length) {
      const names = items.map((it) => (isRecord(it) ? it.name : undefined));
      const problem = itemLabelProblem(names);
      if (problem) return deny(problem);
      labels = names as string[];
    }
    let want: unknown;
    try {
      want = canonicalInvoice(ctx.expected, labels);
    } catch {
      return deny("The code's quote cannot be invoiced");
    }
    const diff = differences(normalised(call.args), normalised(want));
    return diff.length === 0 ? ALLOW : deny(differReason(diff, "invoice"));
  }
  if (call.name === "create_conditional_rules_for_invoice") {
    if (!isRecord(call.args)) return deny("The rule arguments are not an object");
    const extra = unknownKeys(call.args, RULE_SHAPE);
    if (extra.length > 0) return deny(`Not in the canonical rule: ${extra.join(", ")}`);
    if (ctx.expected.invoiceId === null) return deny("There is no invoice to attach the rule to");
    const dates = invoiceDates(ctx);
    if (!dates.ok) return deny(dates.reason);
    const want = autoCancelRuleArgs(ctx.expected.invoiceId, autoCancelDate(dates.invoiceDate));
    const diff = differences(call.args, want);
    return diff.length === 0 ? ALLOW : deny(differReason(diff, "rule"));
  }
  if (call.name === "send_invoice") {
    if (!isRecord(call.args)) return deny("The send arguments are not an object");
    const extra = unknownKeys(call.args, SEND_SHAPE);
    if (extra.length > 0) return deny(`Not in the canonical send: ${extra.join(", ")}`);
    if (ctx.expected.invoiceId === null) return deny("There is no invoice to send");
    const diff = differences(call.args, canonicalSend(ctx.expected.invoiceId));
    return diff.length === 0 ? ALLOW : deny(differReason(diff, "send"));
  }
  return ALLOW;
};

export const invoicerIsBusinessEmail: Policy = (call, ctx) => {
  if (call.name !== "create_invoice") return ALLOW;
  const f = field(readInvoiceFields(call.args), "invoicer_email_address");
  if (!f.ok) return deny(f.reason);
  return f.value !== null && f.value.toLowerCase() === ctx.expected.businessEmail.toLowerCase()
    ? ALLOW
    : deny("The invoicer is not the co-op's business account");
};

/**
 * Exactly one recipient, read only from `primary_recipients[0].billing_info.email_address`, which
 * must be a readable e-mail on the brand allowlist. Any other recipient-bearing field (extra
 * recipients, cc, shipping info, phones, a flattened e-mail…) is named and denied.
 */
export const recipientInBrandAllowlist: Policy = (call, ctx) => {
  if (call.name !== "create_invoice") return ALLOW;
  const read = readInvoiceFields(call.args);
  if (!read.ok) return deny(read.reason);
  const stray = strayRecipientFields(call.args);
  if (stray.length > 0) return deny(`Not a recipient field the draft may set: ${stray.join(", ")}`);
  const recipients = (call.args as Record<string, unknown>).primary_recipients;
  if (!Array.isArray(recipients))
    return deny("primary_recipients must list one recipient with a readable e-mail");
  if (recipients.length !== 1) return deny("Exactly one recipient is allowed");
  const r = recipients[0];
  const email = isRecord(r) && isRecord(r.billing_info) ? r.billing_info.email_address : undefined;
  if (typeof email !== "string" || !EMAIL.test(email)) {
    return deny("The recipient has no readable e-mail at billing_info.email_address");
  }
  const allowed = new Set(ctx.expected.brandAllowlist.map((e) => e.toLowerCase()));
  return allowed.has(email.toLowerCase()) ? ALLOW : deny("A recipient is not on the brand allowlist");
};

export const referenceCarriesHash: Policy = (call, ctx) => {
  if (call.name !== "create_invoice") return ALLOW;
  const read = readInvoiceFields(call.args);
  const reference = field(read, "reference");
  if (!reference.ok) return deny(reference.reason);
  if (reference.value !== ctx.expected.reference) return deny("The reference must be rc:{rateCardSha16}");
  const note = field(read, "note");
  if (!note.ok) return deny(note.reason);
  return note.value === ctx.expected.memo ? ALLOW : deny("The note must be exactly the code-rendered memo");
};

const RULE_DATE_PATH = "rules[0].rule_expiry_terms.condition_rule_end_date";

/**
 * Dates (C-27, S3.6.3). An invoice draft sets no date and no payment term: PayPal dates the
 * invoice. The only date we send is the AUTO_CANCEL rule's, one SPECIFIC_DATE rule whose date,
 * read strictly as YYYY-MM-DD, is exactly PayPal's invoice date + 25 days, after today and at most
 * 30 days out. Anything unreadable is denied.
 */
export const dueWithin30Days: Policy = (call, ctx) => {
  if (call.name === "create_invoice") {
    const dates = dateFields(call.args);
    return dates.length === 0 ? ALLOW : deny(`The draft may not set dates: ${dates.join(", ")}`);
  }
  if (call.name !== "create_conditional_rules_for_invoice") return ALLOW;
  const a = isRecord(call.args) ? call.args : {};
  const rules = Array.isArray(a.rules) ? a.rules : [];
  const rule = rules.length === 1 && isRecord(rules[0]) ? rules[0] : null;
  const terms = rule && isRecord(rule.rule_expiry_terms) ? rule.rule_expiry_terms : null;
  if (
    !rule ||
    !terms ||
    rule.conditional_rule_type !== "AUTO_CANCEL" ||
    terms.rule_expiry_condition !== "SPECIFIC_DATE"
  ) {
    return deny("There must be exactly one AUTO_CANCEL rule on SPECIFIC_DATE");
  }
  const stray = dateFields(a).filter((p) => p !== RULE_DATE_PATH);
  if (stray.length > 0) return deny(`The draft may not set dates: ${stray.join(", ")}`);
  const date = parseStrictIsoDate(terms.condition_rule_end_date);
  if (date === null) return deny("The AUTO_CANCEL date is not a YYYY-MM-DD date");
  const dated = invoiceDates(ctx);
  if (!dated.ok) return deny(dated.reason);
  const want = autoCancelDate(dated.invoiceDate);
  if (date !== want) return deny(`The AUTO_CANCEL date must be the invoice date + 25 days (${want})`);
  if (date <= dated.today || date > addDays(dated.today, AUTO_CANCEL_MAX_DAYS_AHEAD)) {
    return deny("The AUTO_CANCEL date must be after today and within 30 days");
  }
  return ALLOW;
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
