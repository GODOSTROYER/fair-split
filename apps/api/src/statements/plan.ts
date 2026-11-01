// `statementPlan(facts)`: which sentences a member's statement has, in S1.11's slot order, with integer facts
// and mentions. Pure: the line's state, rail and engine numbers decide everything; no model is asked (AI-8 drafts
// variants offline only). Lines still being checked show no amount (M-MB-01 `checking`).
import type { MemberLineState, PayoutItemStatus, Provenance } from "@fairsplit/contracts";
import { aiNoteVariant, pesoEstimateCentavos, pesoExactCentavos, renderSms } from "./render.js";
import { PAYPAL_FX_FEE_BP, TEMPLATE_V, TEMPLATES_V1 } from "./templates.js";
import type {
  Fact,
  Lang,
  Placeholder,
  PlannedSentence,
  SmsVariant,
  StatementPlan,
  TemplateSet,
} from "./types.js";

export interface StatementLineFacts {
  lineId: string;
  memberNo: string;
  lang: Lang;
  state: MemberLineState;
  verifiedG: number;
  grade1G: number;
  premiumCents: number;
  bonusCents: number;
  netCents: number;
  deductions: readonly {
    ruleId: "R1" | "R3" | "R4";
    category: "CBU" | "LOAN" | "ADVANCE";
    amountCents: number;
  }[];
  /** Credits returned (a mark no rule allows): the slip and the pesos written on it, when known. */
  credits: readonly { serial: string | null; phpCentavos: number | null; amountCents: number }[];
  slipSerials: readonly string[];
  /** The registry's honorific in this language ("Nang Celing"). */
  honorific: string;
  /** The buyer named on the ratified card ("Lantern Bay Chocolate Co."). */
  payer: string;
  /** "BR 2026-04". */
  resolutionNo: string;
  /** The treasurer's given name from the registry, or null (statements then name the role). */
  treasurer: string | null;
  /** The SMS sender name. */
  coop: string;
  /** The run's recorded rate, centavos per cent; null when the run has none. */
  fx: { num: number; den: number } | null;
  /** The cash day at the bodega, when the run has one. */
  cashDay: string | null;
  /** The PayPal item's status, for "paid" against "sent". */
  itemStatus: PayoutItemStatus | null;
  /**
   * Where the line's slip readings came from (`readingProvenanceOf`, facts.ts). Only `live`, a real Claude
   * reading, keeps the product AI_NOTE; seeded, replayed, null or absent take the demo note (T1).
   */
  readingProvenance?: Provenance | null;
}

const CHECKING: readonly MemberLineState[] = ["COMPUTED", "READY", "HELD"];
const CASH: readonly MemberLineState[] = ["OFF_RAIL_DUE", "OFF_RAIL_PAID", "RETURNED"];

export type PayKind = "checking" | "excluded" | "cash" | "paypal";

export function payKindOf(f: Pick<StatementLineFacts, "state">): PayKind {
  if (CHECKING.includes(f.state)) return "checking";
  if (f.state === "EXCLUDED") return "excluded";
  if (CASH.includes(f.state)) return "cash";
  return "paypal";
}

const s = (
  slot: PlannedSentence["slot"],
  variant: string,
  facts: Partial<Record<Placeholder, Fact>> = {},
  mentions: string[] = [],
): PlannedSentence => ({ slot, variant, facts: facts as PlannedSentence["facts"], mentions });

export function statementPlan(f: StatementLineFacts, templates: TemplateSet = TEMPLATES_V1): StatementPlan {
  const kind = payKindOf(f);
  const sentences: PlannedSentence[] = [];
  const text = (t: string): Fact => ({ k: "text", text: t });
  const usd = (cents: number): Fact => ({ k: "usd", cents });

  sentences.push(s("GREETING", "default", { HONORIFIC_NAME: text(f.honorific) }));
  sentences.push(
    s("DELIVERY", "default", {
      KG_TOTAL: { k: "kg", grams: f.verifiedG },
      GRADE_SUMMARY: { k: "grade", verifiedG: f.verifiedG, grade1G: f.grade1G },
    }),
  );

  if (kind === "cash" || kind === "paypal") {
    sentences.push(s("PREMIUM", "default", { PAYER: text(f.payer), PREMIUM_USD: usd(f.premiumCents) }));
    sentences.push(s("BONUS", "default", { BONUS_USD: usd(f.bonusCents) }));
    for (const d of f.deductions) {
      sentences.push(
        s(
          "DEDUCTION",
          "default",
          {
            DEDUCTION_USD: usd(d.amountCents),
            RULE_LABEL: { k: "category", category: d.category },
            RULE: { k: "rule", id: d.ruleId },
            BR: { k: "resolution", resolutionNo: f.resolutionNo },
          },
          [`rule:${d.ruleId}`],
        ),
      );
    }
    for (const c of f.credits) {
      if (c.serial !== null && c.phpCentavos !== null) {
        sentences.push(
          s(
            "CREDIT",
            "written",
            {
              WRITTEN_PHP: { k: "php_written", centavos: c.phpCentavos },
              SLIP: { k: "slip", serial: c.serial },
              CREDIT_USD: usd(c.amountCents),
            },
            [`slip:${c.serial}`],
          ),
        );
      } else {
        sentences.push(s("CREDIT", "plain", { CREDIT_USD: usd(c.amountCents) }));
      }
    }
    if (kind === "paypal") {
      sentences.push(
        f.fx
          ? s("PAY", "paypal", {
              NET_USD: usd(f.netCents),
              NET_PHP: { k: "php_est", centavos: pesoEstimateCentavos(f.netCents, f.fx) },
              FX_FEE: { k: "pct", bp: PAYPAL_FX_FEE_BP },
            })
          : s("PAY", "paypal_usd", { NET_USD: usd(f.netCents) }),
      );
    } else if (f.fx) {
      const facts: Partial<Record<Placeholder, Fact>> = {
        NET_PHP: { k: "php", centavos: pesoExactCentavos(f.netCents, f.fx) },
        NET_USD: usd(f.netCents),
        RATE: { k: "rate", num: f.fx.num, den: f.fx.den },
      };
      if (f.cashDay) sentences.push(s("PAY", "cash", { ...facts, CASH_DATE: { k: "date", iso: f.cashDay } }));
      else sentences.push(s("PAY", "cash_nodate", facts));
    } else {
      sentences.push(s("PAY", "cash_usd", { NET_USD: usd(f.netCents) }));
    }
  } else {
    sentences.push(s("PAY", kind));
  }

  if (f.slipSerials.length > 0) {
    sentences.push(
      s(
        "SOURCES",
        "default",
        { SLIPS: { k: "slips", serials: [...f.slipSerials] } },
        f.slipSerials.map((x) => `slip:${x}`),
      ),
    );
  }
  sentences.push(f.treasurer ? s("HELP", "default", { TREASURER: text(f.treasurer) }) : s("HELP", "noname"));
  // the plan names the note renderStatement will say, so `explain` records the words actually shown
  const reading = f.readingProvenance ?? null;
  const note = (form: "default" | "noname" | "checking") => aiNoteVariant(form, reading);
  if (kind === "checking" || kind === "excluded") sentences.push(s("AI_NOTE", note("checking")));
  else if (f.treasurer) sentences.push(s("AI_NOTE", note("default"), { TREASURER: text(f.treasurer) }));
  else sentences.push(s("AI_NOTE", note("noname")));

  const plan: StatementPlan = {
    lineId: f.lineId,
    lang: f.lang,
    templateV: TEMPLATE_V,
    sentences,
    sms: smsPlan(f, kind),
    readingProvenance: reading,
  };
  // The SMS must fit one GSM-7 message: fall back to the short form (no slips, no name) when it does not.
  if (
    !renderSms(plan, templates).fits &&
    !plan.sms.variant.endsWith("_short") &&
    !plan.sms.variant.endsWith("_usd")
  ) {
    plan.sms = { ...plan.sms, variant: `${plan.sms.variant}_short` as SmsVariant };
  }
  return plan;
}

function smsPlan(f: StatementLineFacts, kind: PayKind): StatementPlan["sms"] {
  const base: Partial<Record<Placeholder, Fact>> = {
    COOP: { k: "text", text: f.coop },
    HONORIFIC_NAME: { k: "text", text: f.honorific },
  };
  const tail: Partial<Record<Placeholder, Fact>> = {
    SLIPS: { k: "slips", serials: [...f.slipSerials] },
    ...(f.treasurer ? { TREASURER: { k: "text", text: f.treasurer } } : {}),
  };
  const full = f.treasurer !== null && f.slipSerials.length > 0;
  const pick = (v: "paid" | "sent" | "cash" | "checking"): SmsVariant => (full ? v : `${v}_short`);
  if (kind === "checking" || kind === "excluded") {
    return {
      variant: pick("checking"),
      facts: { ...base, ...(full ? tail : {}) } as StatementPlan["sms"]["facts"],
    };
  }
  const paid = f.itemStatus === "SUCCESS" || f.state === "PAID";
  if (!f.fx) {
    const v: SmsVariant = kind === "cash" ? "cash_usd" : paid ? "paid_usd" : "sent_usd";
    return {
      variant: v,
      facts: { ...base, NET_USD: { k: "usd", cents: f.netCents } } as StatementPlan["sms"]["facts"],
    };
  }
  if (kind === "cash") {
    return {
      variant: pick("cash"),
      facts: {
        ...base,
        NET_PHP: { k: "php", centavos: pesoExactCentavos(f.netCents, f.fx) },
        ...(full ? tail : {}),
      } as StatementPlan["sms"]["facts"],
    };
  }
  return {
    variant: pick(paid ? "paid" : "sent"),
    facts: {
      ...base,
      NET_USD: { k: "usd", cents: f.netCents },
      NET_PHP: { k: "php_est", centavos: pesoEstimateCentavos(f.netCents, f.fx) },
      ...(full ? tail : {}),
    } as StatementPlan["sms"]["facts"],
  };
}
