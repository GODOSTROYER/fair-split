// Statement templates v1: S1.11's reference copy verbatim, with the approved plan's amendments (AI_NOTE reworded;
// the PayPal peso figure is the estimate before PayPal's conversion fee, with the fee named separately; RATE on
// cash lines). Words and {{PLACEHOLDERS}} only (I1). Cebuano and Filipino are machine-translated, pending native
// review (OD-2), until each key is signed off. A person commits any AI-8 variant; it must keep the slot and the
// placeholder set, and pass `validateTemplate` (./validate.ts).
import type { TemplateSet } from "./types.js";

export const TEMPLATE_V = "statements-v1";

/** Shown beside ceb and fil text until a native reviewer signs the key off. */
export const REVIEW_CHIP = "Machine-translated, pending native review";

export const TEMPLATES_V1: TemplateSet = {
  en: {
    "GREETING.default": "Good day, {{HONORIFIC_NAME}}. Thank you for your hard work.",
    "DELIVERY.default": "You delivered {{KG_TOTAL}} of dried cacao, {{GRADE_SUMMARY}}.",
    "PREMIUM.default": "Premium from {{PAYER}}: {{PREMIUM_USD}}, with no deductions.",
    "BONUS.default": "Quality bonus: {{BONUS_USD}}.",
    "DEDUCTION.default": "Less {{DEDUCTION_USD}} for {{RULE_LABEL}} ({{RULE}}, {{BR}}).",
    "CREDIT.written":
      "The {{WRITTEN_PHP}} deduction on slip {{SLIP}} is not on the rate card the Board approved, so it comes back to you: {{CREDIT_USD}}.",
    "CREDIT.plain":
      "A deduction on your slip is not on the rate card the Board approved, so it comes back to you: {{CREDIT_USD}}.",
    "PAY.paypal":
      "Your pay this season: {{NET_USD}}, to your PayPal. In pesos that is {{NET_PHP}}, before PayPal's {{FX_FEE}} fee to change it.",
    "PAY.cash":
      "Your pay this season: {{NET_PHP}}, in cash at the bodega on {{CASH_DATE}}. That is {{NET_USD}} at {{RATE}} to the dollar.",
    "PAY.cash_nodate":
      "Your pay this season: {{NET_PHP}}, in cash at the bodega. That is {{NET_USD}} at {{RATE}} to the dollar.",
    "PAY.checking": "Your pay is still being checked, so there is no amount yet.",
    "PAY.excluded": "Your pay moves to the next pay run.",
    "SOURCES.default": "It comes from your slips {{SLIPS}}.",
    "HELP.default": "Questions? See Treasurer {{TREASURER}} at the bodega.",
    "HELP.noname": "Questions? See the treasurer at the bodega.",
    "AI_NOTE.default":
      "Your slips were read twice by AI (Claude). Readings it was unsure of were checked by a person, and Treasurer {{TREASURER}} approved this pay.",
    "AI_NOTE.noname":
      "Your slips were read twice by AI (Claude). Readings it was unsure of were checked by a person, and the treasurer approved this pay.",
    "AI_NOTE.checking":
      "Your slips were read twice by AI (Claude). Readings it was unsure of were checked by a person.",
    // T1: the demo AI_NOTE, for a run whose slips Claude did not read here (seeded, replayed or unknown).
    // renderStatement picks it (aiNoteVariant); its words are frozen (validate.ts).
    "AI_NOTE.seeded":
      "In this demo, the slip readings are a labelled stand-in for Claude's double reading; a person checked the unsure ones, and Treasurer {{TREASURER}} approved this pay.",
    "AI_NOTE.seeded_noname":
      "In this demo, the slip readings are a labelled stand-in for Claude's double reading; a person checked the unsure ones, and the treasurer approved this pay.",
    "AI_NOTE.seeded_checking":
      "In this demo, the slip readings are a labelled stand-in for Claude's double reading; a person checked the unsure ones.",
    "sms.paid":
      "{{COOP}}: {{HONORIFIC_NAME}}, your {{NET_USD}} is paid to your PayPal ({{NET_PHP}}). Slips {{SLIPS}}. Questions: Treasurer {{TREASURER}}.",
    "sms.sent":
      "{{COOP}}: {{HONORIFIC_NAME}}, your {{NET_USD}} is sent to your PayPal ({{NET_PHP}}). Slips {{SLIPS}}. Questions: Treasurer {{TREASURER}}.",
    "sms.cash":
      "{{COOP}}: {{HONORIFIC_NAME}}, your {{NET_PHP}} is ready in cash at the bodega. Slips {{SLIPS}}. Questions: Treasurer {{TREASURER}}.",
    "sms.checking":
      "{{COOP}}: {{HONORIFIC_NAME}}, your pay is still being checked. Slips {{SLIPS}}. Questions: Treasurer {{TREASURER}}.",
    "sms.paid_short": "{{COOP}}: {{HONORIFIC_NAME}}, your {{NET_USD}} is paid to your PayPal ({{NET_PHP}}).",
    "sms.sent_short": "{{COOP}}: {{HONORIFIC_NAME}}, your {{NET_USD}} is sent to your PayPal ({{NET_PHP}}).",
    "sms.cash_short": "{{COOP}}: {{HONORIFIC_NAME}}, your {{NET_PHP}} is ready in cash at the bodega.",
    "sms.checking_short": "{{COOP}}: {{HONORIFIC_NAME}}, your pay is still being checked.",
    "PAY.paypal_usd": "Your pay this season: {{NET_USD}}, to your PayPal.",
    "PAY.cash_usd": "Your pay this season: {{NET_USD}}, in cash at the bodega.",
    "sms.paid_usd": "{{COOP}}: {{HONORIFIC_NAME}}, your {{NET_USD}} is paid to your PayPal.",
    "sms.sent_usd": "{{COOP}}: {{HONORIFIC_NAME}}, your {{NET_USD}} is sent to your PayPal.",
    "sms.cash_usd": "{{COOP}}: {{HONORIFIC_NAME}}, your {{NET_USD}} is ready in cash at the bodega.",
  },
  ceb: {
    "GREETING.default": "Maayong adlaw, {{HONORIFIC_NAME}}. Salamat sa inyong paghago.",
    "DELIVERY.default": "Nagdala mo og {{KG_TOTAL}} nga uga nga cacao, {{GRADE_SUMMARY}}.",
    "PREMIUM.default": "Premium gikan sa {{PAYER}}: {{PREMIUM_USD}}, walay kaltas.",
    "BONUS.default": "Bonus sa kalidad: {{BONUS_USD}}.",
    "DEDUCTION.default": "Gikaltasan og {{DEDUCTION_USD}} para sa {{RULE_LABEL}} ({{RULE}}, {{BR}}).",
    "CREDIT.written":
      "Ang {{WRITTEN_PHP}} nga kaltas sa resibo {{SLIP}} wala sa rate card nga giaprobahan sa Board, mao nga gibalik kini kaninyo: {{CREDIT_USD}}.",
    "CREDIT.plain":
      "Ang kaltas sa inyong resibo wala sa rate card nga giaprobahan sa Board, mao nga gibalik kini kaninyo: {{CREDIT_USD}}.",
    "PAY.paypal":
      "Ang inyong bayad karong season: {{NET_USD}}, sa inyong PayPal. Sa peso, {{NET_PHP}}, sa dili pa ang {{FX_FEE}} nga bayad sa PayPal sa pag-ilis.",
    "PAY.cash":
      "Ang inyong bayad karong season: {{NET_PHP}}, cash sa bodega sa {{CASH_DATE}}. Gikan sa {{NET_USD}} sa {{RATE}} matag dolyar.",
    "PAY.cash_nodate":
      "Ang inyong bayad karong season: {{NET_PHP}}, cash sa bodega. Gikan sa {{NET_USD}} sa {{RATE}} matag dolyar.",
    "PAY.checking": "Gisusi pa ang inyong bayad, mao nga wala pay kantidad.",
    "PAY.excluded": "Ang inyong bayad ibalhin sa sunod nga bayad.",
    "SOURCES.default": "Gikan kini sa inyong resibo {{SLIPS}}.",
    "HELP.default": "Naa moy pangutana? Adto kang Treasurer {{TREASURER}} sa bodega.",
    "HELP.noname": "Naa moy pangutana? Adto sa tesorero sa bodega.",
    "AI_NOTE.default":
      "Ang inyong mga resibo gibasa sa makaduha sa AI (Claude). Ang mga basa nga dili sigurado gisusi sa tawo, ug giaprobahan ni Treasurer {{TREASURER}} kini nga bayad.",
    "AI_NOTE.noname":
      "Ang inyong mga resibo gibasa sa makaduha sa AI (Claude). Ang mga basa nga dili sigurado gisusi sa tawo, ug giaprobahan sa tesorero kini nga bayad.",
    "AI_NOTE.checking":
      "Ang inyong mga resibo gibasa sa makaduha sa AI (Claude). Ang mga basa nga dili sigurado gisusi sa tawo.",
    // T1's demo AI_NOTE: machine-translated, pending native review (REVIEW_CHIP), like every ceb key.
    "AI_NOTE.seeded":
      "Niini nga demo, ang mga basa sa resibo puli nga may label para sa makaduha nga pagbasa ni Claude; ang mga basa nga dili sigurado gisusi sa tawo, ug giaprobahan ni Treasurer {{TREASURER}} kini nga bayad.",
    "AI_NOTE.seeded_noname":
      "Niini nga demo, ang mga basa sa resibo puli nga may label para sa makaduha nga pagbasa ni Claude; ang mga basa nga dili sigurado gisusi sa tawo, ug giaprobahan sa tesorero kini nga bayad.",
    "AI_NOTE.seeded_checking":
      "Niini nga demo, ang mga basa sa resibo puli nga may label para sa makaduha nga pagbasa ni Claude; ang mga basa nga dili sigurado gisusi sa tawo.",
    "sms.paid":
      "{{COOP}}: {{HONORIFIC_NAME}}, bayad na ang {{NET_USD}} sa PayPal ({{NET_PHP}}). Resibo {{SLIPS}}. Pangutana: Treasurer {{TREASURER}}.",
    "sms.sent":
      "{{COOP}}: {{HONORIFIC_NAME}}, gipadala na ang {{NET_USD}} sa PayPal ({{NET_PHP}}). Resibo {{SLIPS}}. Pangutana: Treasurer {{TREASURER}}.",
    "sms.cash":
      "{{COOP}}: {{HONORIFIC_NAME}}, andam sa bodega ang {{NET_PHP}} cash. Resibo {{SLIPS}}. Pangutana: Treasurer {{TREASURER}}.",
    "sms.checking":
      "{{COOP}}: {{HONORIFIC_NAME}}, gisusi pa ang inyong bayad. Resibo {{SLIPS}}. Pangutana: Treasurer {{TREASURER}}.",
    "sms.paid_short": "{{COOP}}: {{HONORIFIC_NAME}}, bayad na ang {{NET_USD}} sa PayPal ({{NET_PHP}}).",
    "sms.sent_short": "{{COOP}}: {{HONORIFIC_NAME}}, gipadala na ang {{NET_USD}} sa PayPal ({{NET_PHP}}).",
    "sms.cash_short": "{{COOP}}: {{HONORIFIC_NAME}}, andam sa bodega ang {{NET_PHP}} cash.",
    "sms.checking_short": "{{COOP}}: {{HONORIFIC_NAME}}, gisusi pa ang inyong bayad.",
    "PAY.paypal_usd": "Ang inyong bayad karong season: {{NET_USD}}, sa inyong PayPal.",
    "PAY.cash_usd": "Ang inyong bayad karong season: {{NET_USD}}, cash sa bodega.",
    "sms.paid_usd": "{{COOP}}: {{HONORIFIC_NAME}}, bayad na ang {{NET_USD}} sa PayPal.",
    "sms.sent_usd": "{{COOP}}: {{HONORIFIC_NAME}}, gipadala na ang {{NET_USD}} sa PayPal.",
    "sms.cash_usd": "{{COOP}}: {{HONORIFIC_NAME}}, andam sa bodega ang {{NET_USD}} cash.",
  },
  fil: {
    "GREETING.default": "Magandang araw po, {{HONORIFIC_NAME}}. Salamat po sa inyong pagsisikap.",
    "DELIVERY.default": "Nagdala po kayo ng {{KG_TOTAL}} na tuyong cacao, {{GRADE_SUMMARY}}.",
    "PREMIUM.default": "Premium mula sa {{PAYER}}: {{PREMIUM_USD}}, walang kaltas.",
    "BONUS.default": "Bonus sa kalidad: {{BONUS_USD}}.",
    "DEDUCTION.default": "Binawasan po ng {{DEDUCTION_USD}} para sa {{RULE_LABEL}} ({{RULE}}, {{BR}}).",
    "CREDIT.written":
      "Ang {{WRITTEN_PHP}} na bawas sa resibo {{SLIP}} ay wala po sa rate card na inaprubahan ng Board, kaya ibinabalik po namin ito: {{CREDIT_USD}}.",
    "CREDIT.plain":
      "Ang bawas sa inyong resibo ay wala po sa rate card na inaprubahan ng Board, kaya ibinabalik po namin ito: {{CREDIT_USD}}.",
    "PAY.paypal":
      "Ang inyong bayad ngayong season: {{NET_USD}}, sa inyong PayPal. Sa piso, {{NET_PHP}}, bago ang {{FX_FEE}} na singil ng PayPal sa pagpapalit.",
    "PAY.cash":
      "Ang inyong bayad ngayong season: {{NET_PHP}}, cash sa bodega sa {{CASH_DATE}}. Mula sa {{NET_USD}} sa {{RATE}} bawat dolyar.",
    "PAY.cash_nodate":
      "Ang inyong bayad ngayong season: {{NET_PHP}}, cash sa bodega. Mula sa {{NET_USD}} sa {{RATE}} bawat dolyar.",
    "PAY.checking": "Sinusuri pa po ang inyong bayad, kaya wala pang halaga.",
    "PAY.excluded": "Ililipat po ang inyong bayad sa susunod na bayad.",
    "SOURCES.default": "Galing po ito sa inyong mga resibo {{SLIPS}}.",
    "HELP.default": "May tanong po kayo? Lumapit po kay Treasurer {{TREASURER}} sa bodega.",
    "HELP.noname": "May tanong po kayo? Lumapit po sa ingat-yaman sa bodega.",
    "AI_NOTE.default":
      "Binasa nang makalawa ng AI (Claude) ang inyong mga resibo. Ang mga basang hindi tiyak ay sinuri ng tao, at inaprubahan ni Treasurer {{TREASURER}} ang bayad na ito.",
    "AI_NOTE.noname":
      "Binasa nang makalawa ng AI (Claude) ang inyong mga resibo. Ang mga basang hindi tiyak ay sinuri ng tao, at inaprubahan ng ingat-yaman ang bayad na ito.",
    "AI_NOTE.checking":
      "Binasa nang makalawa ng AI (Claude) ang inyong mga resibo. Ang mga basang hindi tiyak ay sinuri ng tao.",
    // T1's demo AI_NOTE: machine-translated, pending native review (REVIEW_CHIP), like every fil key.
    "AI_NOTE.seeded":
      "Sa demo na ito, ang mga basa sa resibo ay pamalit na may label para sa makalawang pagbasa ni Claude; sinuri ng tao ang mga basang hindi tiyak, at inaprubahan ni Treasurer {{TREASURER}} ang bayad na ito.",
    "AI_NOTE.seeded_noname":
      "Sa demo na ito, ang mga basa sa resibo ay pamalit na may label para sa makalawang pagbasa ni Claude; sinuri ng tao ang mga basang hindi tiyak, at inaprubahan ng ingat-yaman ang bayad na ito.",
    "AI_NOTE.seeded_checking":
      "Sa demo na ito, ang mga basa sa resibo ay pamalit na may label para sa makalawang pagbasa ni Claude; sinuri ng tao ang mga basang hindi tiyak.",
    "sms.paid":
      "{{COOP}}: {{HONORIFIC_NAME}}, bayad na po ang {{NET_USD}} sa PayPal ({{NET_PHP}}). Resibo {{SLIPS}}. Tanong: Treasurer {{TREASURER}}.",
    "sms.sent":
      "{{COOP}}: {{HONORIFIC_NAME}}, naipadala na po ang {{NET_USD}} sa PayPal ({{NET_PHP}}). Resibo {{SLIPS}}. Tanong: Treasurer {{TREASURER}}.",
    "sms.cash":
      "{{COOP}}: {{HONORIFIC_NAME}}, handa na po sa bodega ang {{NET_PHP}} cash. Resibo {{SLIPS}}. Tanong: Treasurer {{TREASURER}}.",
    "sms.checking":
      "{{COOP}}: {{HONORIFIC_NAME}}, sinusuri pa po ang inyong bayad. Resibo {{SLIPS}}. Tanong: Treasurer {{TREASURER}}.",
    "sms.paid_short": "{{COOP}}: {{HONORIFIC_NAME}}, bayad na po ang {{NET_USD}} sa PayPal ({{NET_PHP}}).",
    "sms.sent_short":
      "{{COOP}}: {{HONORIFIC_NAME}}, naipadala na po ang {{NET_USD}} sa PayPal ({{NET_PHP}}).",
    "sms.cash_short": "{{COOP}}: {{HONORIFIC_NAME}}, handa na po sa bodega ang {{NET_PHP}} cash.",
    "sms.checking_short": "{{COOP}}: {{HONORIFIC_NAME}}, sinusuri pa po ang inyong bayad.",
    "PAY.paypal_usd": "Ang inyong bayad ngayong season: {{NET_USD}}, sa inyong PayPal.",
    "PAY.cash_usd": "Ang inyong bayad ngayong season: {{NET_USD}}, cash sa bodega.",
    "sms.paid_usd": "{{COOP}}: {{HONORIFIC_NAME}}, bayad na po ang {{NET_USD}} sa PayPal.",
    "sms.sent_usd": "{{COOP}}: {{HONORIFIC_NAME}}, naipadala na po ang {{NET_USD}} sa PayPal.",
    "sms.cash_usd": "{{COOP}}: {{HONORIFIC_NAME}}, handa na po sa bodega ang {{NET_USD}} cash.",
  },
};

/** The placeholder set each template key declares (a committed variant must keep exactly this set). */
export const TEMPLATE_PLACEHOLDERS: Readonly<Record<string, readonly string[]>> = {
  "GREETING.default": ["HONORIFIC_NAME"],
  "DELIVERY.default": ["KG_TOTAL", "GRADE_SUMMARY"],
  "PREMIUM.default": ["PAYER", "PREMIUM_USD"],
  "BONUS.default": ["BONUS_USD"],
  "DEDUCTION.default": ["DEDUCTION_USD", "RULE_LABEL", "RULE", "BR"],
  "CREDIT.written": ["WRITTEN_PHP", "SLIP", "CREDIT_USD"],
  "CREDIT.plain": ["CREDIT_USD"],
  "PAY.paypal": ["NET_USD", "NET_PHP", "FX_FEE"],
  "PAY.cash": ["NET_PHP", "CASH_DATE", "NET_USD", "RATE"],
  "PAY.cash_nodate": ["NET_PHP", "NET_USD", "RATE"],
  "PAY.checking": [],
  "PAY.excluded": [],
  "SOURCES.default": ["SLIPS"],
  "HELP.default": ["TREASURER"],
  "HELP.noname": [],
  "AI_NOTE.default": ["TREASURER"],
  "AI_NOTE.noname": [],
  "AI_NOTE.checking": [],
  "AI_NOTE.seeded": ["TREASURER"],
  "AI_NOTE.seeded_noname": [],
  "AI_NOTE.seeded_checking": [],
  "sms.paid": ["COOP", "HONORIFIC_NAME", "NET_USD", "NET_PHP", "SLIPS", "TREASURER"],
  "sms.sent": ["COOP", "HONORIFIC_NAME", "NET_USD", "NET_PHP", "SLIPS", "TREASURER"],
  "sms.cash": ["COOP", "HONORIFIC_NAME", "NET_PHP", "SLIPS", "TREASURER"],
  "sms.checking": ["COOP", "HONORIFIC_NAME", "SLIPS", "TREASURER"],
  "sms.paid_short": ["COOP", "HONORIFIC_NAME", "NET_USD", "NET_PHP"],
  "sms.sent_short": ["COOP", "HONORIFIC_NAME", "NET_USD", "NET_PHP"],
  "sms.cash_short": ["COOP", "HONORIFIC_NAME", "NET_PHP"],
  "sms.checking_short": ["COOP", "HONORIFIC_NAME"],
  "PAY.paypal_usd": ["NET_USD"],
  "PAY.cash_usd": ["NET_USD"],
  "sms.paid_usd": ["COOP", "HONORIFIC_NAME", "NET_USD"],
  "sms.sent_usd": ["COOP", "HONORIFIC_NAME", "NET_USD"],
  "sms.cash_usd": ["COOP", "HONORIFIC_NAME", "NET_USD"],
};

/** PayPal's published conversion spread, named on PayPal lines (FEE_TABLE; GCash's 1% is a UI segment). */
export const PAYPAL_FX_FEE_BP = 300;
