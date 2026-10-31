/**
 * Test helper: the PAY form the demo templates lack. fs-api speaks `PAY.cash_nodate` for a line at the bodega until
 * the clerk records the cash received (apps/api statements/plan.ts), so a phone that is to play that clip needs a
 * template of the same form. These are TEMPLATES_V1's words for it (apps/api statements/templates.ts), the words K1d's
 * demo takes from AU2's export.
 */
import type { StatementDTO } from "../_shims/api-client";
import type { Lang, StatementTemplate } from "../_shims/contracts";

export const PAY_CASH_NODATE: Readonly<Record<Lang, StatementTemplate>> = {
  ceb: {
    id: "pay-cash-nodate",
    slot: "PAY",
    variant: "cash_nodate",
    text: "Ang inyong bayad karong season: {{NET_PHP}}, cash sa bodega. Gikan sa {{NET_USD}} sa {{RATE}} matag dolyar.",
  },
  fil: {
    id: "pay-cash-nodate",
    slot: "PAY",
    variant: "cash_nodate",
    text: "Ang inyong bayad ngayong season: {{NET_PHP}}, cash sa bodega. Mula sa {{NET_USD}} sa {{RATE}} bawat dolyar.",
  },
  en: {
    id: "pay-cash-nodate",
    slot: "PAY",
    variant: "cash_nodate",
    text: "Your pay this season: {{NET_PHP}}, in cash at the bodega. That is {{NET_USD}} at {{RATE}} to the dollar.",
  },
};

/** The statement with a `PAY.cash_nodate` template beside its other PAY forms, in every language. */
export function withNoDate(dto: StatementDTO): StatementDTO {
  const add = (lang: Lang) =>
    dto.sentences[lang].flatMap((t) =>
      t.slot === "PAY" && t.variant === "cash" ? [t, PAY_CASH_NODATE[lang]] : [t],
    );
  return { ...dto, sentences: { ceb: add("ceb"), fil: add("fil"), en: add("en") } };
}
