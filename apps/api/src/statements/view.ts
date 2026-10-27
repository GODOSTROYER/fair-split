// The member's statement as every surface reads it (M-MB-01, W-TR-09, the 80 mm print, Paminawa): the plan and
// its three renderings, the status words in the member's language, and the amount block. Committed variants from
// the `statements` table are used only if they pass the validators; a stored text with a digit is never shown
// (I1), the frozen v1 templates are.
import {
  type Lang as ContractLang,
  LABEL_REVIEW_STATUS,
  MEMBER_LINE_LABELS,
  MemberLineState,
  MoneyDTO,
  Provenance,
} from "@fairsplit/contracts";
import { type DbOrTx, schema } from "@fairsplit/db";
import { format } from "@fairsplit/domain";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { StatementContext } from "./facts.js";
import { payKindOf, statementPlan } from "./plan.js";
import { estimateText, pesoEstimateCentavos, pesoExactCentavos, renderStatement } from "./render.js";
import { TEMPLATES_V1 } from "./templates.js";
import { Lang, RenderedSentence, StatementPlan, type TemplateSet } from "./types.js";
import { validateTemplate } from "./validate.js";

export const StatementView = z.strictObject({
  lineId: z.uuid(),
  memberNo: z.string(),
  lang: Lang,
  registryLang: Lang,
  langs: z.array(Lang),
  state: MemberLineState,
  /** What the pay sentence says: still being checked, moved on, cash at the bodega or PayPal. */
  pay: z.enum(["checking", "excluded", "cash", "paypal"]),
  /** The register's status words for this state, in this language (a raw state name is never shown). */
  statusWords: z.string(),
  /** "Machine-translated, pending native review" for ceb and fil until signed off (OD-2). */
  reviewChip: z.string().nullable(),
  amount: z
    .strictObject({
      usd: MoneyDTO,
      php: z.strictObject({ centavos: z.int(), display: z.string(), exact: z.boolean() }).nullable(),
      spoken: z.string(),
    })
    .nullable(),
  plan: StatementPlan,
  display: z.array(RenderedSentence),
  spoken: z.array(RenderedSentence),
  sms: z.strictObject({
    text: z.string(),
    gsm7Length: z.int().nonnegative().nullable(),
    fits: z.boolean(),
    /** Previews are never sent from here. */
    label: z.literal("Preview, not sent"),
  }),
  source: z.enum(["template", "model"]),
  provenance: Provenance,
});
export type StatementView = z.infer<typeof StatementView>;

/** Committed texts for one line and language, kept only where they validate; null when there are none. */
export async function committedTemplates(
  db: DbOrTx,
  workspaceId: string,
  lineId: string,
  lang: Lang,
): Promise<{ templates: TemplateSet; source: "template" | "model" } | null> {
  const [row] = await db
    .select({
      sentences: schema.statements.sentences,
      smsText: schema.statements.smsText,
      llmCallId: schema.statements.llmCallId,
    })
    .from(schema.statements)
    .where(
      and(
        eq(schema.statements.workspaceId, workspaceId),
        eq(schema.statements.lineId, lineId),
        eq(schema.statements.lang, lang),
      ),
    )
    .limit(1);
  if (!row) return null;
  const overrides: Record<string, string> = {};
  for (const s of Array.isArray(row.sentences) ? row.sentences : []) {
    const r = s as { id?: unknown; text?: unknown };
    if (typeof r.id !== "string" || typeof r.text !== "string") continue;
    if (validateTemplate(r.id, r.text, lang).length === 0) overrides[r.id] = r.text;
  }
  const merged: TemplateSet = { ...TEMPLATES_V1, [lang]: { ...TEMPLATES_V1[lang], ...overrides } };
  return { templates: merged, source: row.llmCallId ? "model" : "template" };
}

export async function statementView(db: DbOrTx, ctx: StatementContext): Promise<StatementView> {
  const lang = ctx.facts.lang;
  const committed = await committedTemplates(db, ctx.workspaceId, ctx.facts.lineId, lang);
  const templates = committed?.templates ?? TEMPLATES_V1;
  const plan = statementPlan(ctx.facts, templates);
  const rendered = renderStatement(plan, templates);
  const pay = payKindOf(ctx.facts);
  const f = ctx.facts;
  let amount: StatementView["amount"] = null;
  if (pay === "cash" || pay === "paypal") {
    const php =
      f.fx === null
        ? null
        : pay === "cash"
          ? {
              centavos: pesoExactCentavos(f.netCents, f.fx),
              display: format.money(pesoExactCentavos(f.netCents, f.fx), "PHP"),
              exact: true,
            }
          : {
              centavos: pesoEstimateCentavos(f.netCents, f.fx),
              display: estimateText(pesoEstimateCentavos(f.netCents, f.fx), lang),
              exact: false,
            };
    amount = {
      usd: format.moneyDTO(f.netCents),
      php,
      spoken: format.amountSpoken(f.netCents, lang as ContractLang),
    };
  }
  return {
    lineId: f.lineId,
    memberNo: f.memberNo,
    lang,
    registryLang: ctx.registryLang,
    langs: ["ceb", "fil", "en"],
    state: f.state,
    pay,
    statusWords: MEMBER_LINE_LABELS[f.state][lang],
    reviewChip: lang === "en" ? null : LABEL_REVIEW_STATUS,
    amount,
    plan,
    display: rendered.display,
    spoken: rendered.spoken,
    sms: { ...rendered.sms, label: "Preview, not sent" },
    source: committed?.source ?? "template",
    provenance: ctx.provenance,
  };
}
