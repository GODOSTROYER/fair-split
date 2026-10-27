// Statements, pure: templates validate (I1), the plan picks the right sentences for the line's state, and the
// renderer is the only place a number becomes text: display, spoken and SMS, checked on the seed's hero lines.
import type { MemberLineState } from "@fairsplit/contracts";
import { format, mulDivFloor, mulDivHalfUp } from "@fairsplit/domain";
import { getLine, getMember, getRateCard, getRun, getSeason } from "@fairsplit/seed";
import { describe, expect, it } from "vitest";
import { must } from "../proof/testing/world.js";
import { gsm7Length } from "./gsm7.js";
import { type StatementLineFacts, statementPlan } from "./plan.js";
import { renderStatement } from "./render.js";
import { TEMPLATE_PLACEHOLDERS, TEMPLATES_V1 } from "./templates.js";
import type { Lang } from "./types.js";
import { validateTemplate, validateTemplates } from "./validate.js";

const FX = getRun().fx.centavosPerCent;

/** A statement's facts straight from the seed snapshot (IC-03: no figure typed here). */
function seedFacts(memberNo: string, lang: Lang, over: Partial<StatementLineFacts> = {}): StatementLineFacts {
  const line = getLine(memberNo);
  const member = getMember(memberNo);
  if (!line || !member) throw new Error(`no seed line ${memberNo}`);
  const card = getRateCard();
  const item = getRun().items.find((i) => i.memberNo === memberNo);
  return {
    lineId: member.id,
    memberNo,
    lang,
    state: (getRun().lineStates[memberNo] ?? "READY") as MemberLineState,
    verifiedG: line.verifiedG,
    grade1G: line.grade1G,
    premiumCents: line.premiumCents,
    bonusCents: line.bonusCents,
    netCents: line.netCents,
    deductions: line.deductions.map((d) => ({
      ruleId: d.ruleId,
      category: d.category,
      amountCents: d.amountCents,
    })),
    credits: line.credits.map((c) => ({
      serial: c.serial,
      phpCentavos: c.phpCentavos,
      amountCents: c.amountCents,
    })),
    slipSerials: line.slipSerials,
    honorific: member.addressAs[lang],
    payer: card.canonical.pricing.buyer,
    resolutionNo: card.canonical.resolutionNo,
    treasurer: getSeason().officers.find((o) => o.role === "TREASURER")?.shortName ?? null,
    coop: getSeason().coop.shortName,
    fx: FX,
    cashDay: null,
    itemStatus: item?.status ?? null,
    ...over,
  };
}

const text = (memberNo: string, lang: Lang, over: Partial<StatementLineFacts> = {}) => {
  const r = renderStatement(statementPlan(seedFacts(memberNo, lang, over)));
  return { ...r, all: r.display.map((s) => s.text).join(" ") };
};

describe("statement templates (I1: words and placeholders only)", () => {
  it("inv.i1.no-model-numbers: every v1 template in every language validates", () => {
    expect(validateTemplates(TEMPLATES_V1)).toEqual([]);
    for (const lang of ["en", "ceb", "fil"] as const) {
      expect(Object.keys(TEMPLATES_V1[lang]).sort()).toEqual(Object.keys(TEMPLATE_PLACEHOLDERS).sort());
    }
  });

  it("refuses a digit, a number word, a stray or missing placeholder, and 'error' in member copy", () => {
    expect(validateTemplate("BONUS.default", "Quality bonus: 21 dollars.", "en")).toEqual(
      expect.arrayContaining([expect.stringContaining("digit"), expect.stringContaining("placeholders")]),
    );
    expect(
      validateTemplate("BONUS.default", "Quality bonus: twenty-one {{BONUS_USD}}.", "en").sort(),
    ).toEqual(['BONUS.default: the number word "one"', 'BONUS.default: the number word "twenty"']);
    expect(validateTemplate("BONUS.default", "Bonus: {{BONUS_USD}} {{NET_PHP}}.", "en")).toEqual([
      "BONUS.default: placeholders {BONUS_USD,NET_PHP} differ from the declared {BONUS_USD}",
    ]);
    expect(validateTemplate("BONUS.default", "Bonus {{SECRET}} {{BONUS_USD}}", "en")).toContain(
      "BONUS.default: unknown placeholder {{SECRET}}",
    );
    expect(validateTemplate("PAY.checking", "There was an error with your pay.", "en")).toEqual([
      'PAY.checking: the word "error" in member copy',
    ]);
    expect(validateTemplate("PAY.checking", "Duha ka resibo.", "ceb")).toEqual([
      'PAY.checking: the number word "duha"',
    ]);
    // currency nouns are allowed (plan amendment), number words are not
    expect(validateTemplate("BONUS.default", "Bonus in dollars and pesos: {{BONUS_USD}}.", "en")).toEqual([]);
  });
});

describe("statementPlan and renderStatement", () => {
  it("the hero line (M-014, PayPal, paid) reads money first, every amount from code", () => {
    const line = must(getLine("M-014"));
    const r = text("M-014", "en");
    const pay = must(r.display.find((s) => s.slot === "PAY"));
    const pesos = Math.floor(mulDivFloor(line.netCents, FX.num, FX.den) / 100);
    expect(pay.variant).toBe("paypal");
    expect(pay.text).toBe(
      `Your pay this season: ${format.money(line.netCents)}, to your PayPal. In pesos that is about ₱${format.groupThousands(String(pesos))} (estimate), before PayPal's 3% fee to change it.`,
    );
    expect(r.display.find((s) => s.slot === "PREMIUM")?.text).toBe(
      `Premium from ${getRateCard().canonical.pricing.buyer}: ${format.money(line.premiumCents)}, with no deductions.`,
    );
    expect(r.display.find((s) => s.slot === "GREETING")?.text).toBe(
      `Good day, ${must(getMember("M-014")).addressAs.en}. Thank you for your hard work.`,
    );
    expect(r.display.map((s) => s.slot)).toEqual([
      "GREETING",
      "DELIVERY",
      "PREMIUM",
      "BONUS",
      "DEDUCTION",
      "PAY",
      "SOURCES",
      "HELP",
      "AI_NOTE",
    ]);
    const sources = must(r.display.find((s) => s.slot === "SOURCES"));
    expect(sources.mentions).toEqual(line.slipSerials.map((x) => `slip:${x}`));
    expect(r.display.find((s) => s.slot === "AI_NOTE")?.text).toBe(
      "Your slips were read twice by AI (Claude). Readings it was unsure of were checked by a person, and Treasurer Analyn approved this pay.",
    );
  });

  it("Cebuano is the hero's registry language; the peso estimate is floored and labelled", () => {
    const line = must(getLine("M-014"));
    const pesos = Math.floor(mulDivFloor(line.netCents, FX.num, FX.den) / 100);
    const r = text("M-014", "ceb");
    expect(r.all).toContain(`Maayong adlaw, ${must(getMember("M-014")).addressAs.ceb}.`);
    expect(r.all).toContain(`mga ₱${format.groupThousands(String(pesos))} (gibanabana)`);
    expect(r.all).toContain("Adto kang Treasurer Analyn sa bodega.");
  });

  it("a cash line (M-053) shows exact pesos at the run's rate, half-up, and the rate itself", () => {
    const line = must(getLine("M-053"));
    const exact = mulDivHalfUp(line.netCents, FX.num, FX.den);
    const r = text("M-053", "en", { cashDay: getRun().cashDay });
    const pay = must(r.display.find((s) => s.slot === "PAY"));
    expect(pay.variant).toBe("cash");
    expect(pay.text).toBe(
      `Your pay this season: ${format.money(exact, "PHP")}, in cash at the bodega on ${format.date(getRun().cashDay, "en")}. That is ${format.money(line.netCents)} at ${format.money(mulDivHalfUp(100, FX.num, FX.den), "PHP")} to the dollar.`,
    );
    const nodate = must(text("M-053", "en").display.find((s) => s.slot === "PAY"));
    expect(nodate.variant).toBe("cash_nodate");
  });

  it("a returned credit names the slip and the pesos written on it (M-018, H3)", () => {
    const credit = must(must(getLine("M-018")).credits[0]);
    const r = text("M-018", "en");
    const s = must(r.display.find((x) => x.slot === "CREDIT"));
    expect(s.text).toBe(
      `The ₱${format.groupThousands(String(credit.phpCentavos / 100))} deduction on slip ${credit.serial} is not on the rate card the Board approved, so it comes back to you: ${format.money(credit.amountCents)}.`,
    );
    expect(s.mentions).toEqual([`slip:${credit.serial}`]);
  });

  it("a capped loan names its rule and the resolution (M-022, R3)", () => {
    const d = must(must(getLine("M-022")).deductions[0]);
    const s = must(text("M-022", "en").display.find((x) => x.slot === "DEDUCTION"));
    expect(s.text).toBe(
      `Less ${format.money(d.amountCents)} for your loan (${d.ruleId}, ${getRateCard().canonical.resolutionNo}).`,
    );
    expect(s.mentions).toEqual([`rule:${d.ruleId}`]);
  });

  it("a line still being checked shows kilos and slips but no amount, and claims no approval", () => {
    for (const state of ["COMPUTED", "READY", "HELD"] as const) {
      const r = text("M-014", "en", { state });
      expect(r.all).not.toMatch(/US\$|₱/);
      expect(r.display.find((s) => s.slot === "PAY")?.variant).toBe("checking");
      expect(r.display.find((s) => s.slot === "AI_NOTE")?.text).not.toContain("approved");
      expect(r.sms.text).not.toMatch(/US\$|P\d/);
    }
    expect(text("M-014", "en", { state: "EXCLUDED" }).display.find((s) => s.slot === "PAY")?.text).toBe(
      "Your pay moves to the next pay run.",
    );
  });

  it("without the treasurer's name the role is named; without a rate only dollars are said", () => {
    const r = text("M-014", "en", { treasurer: null, fx: null });
    expect(r.display.find((s) => s.slot === "HELP")?.text).toBe(
      "Questions? See the treasurer at the bodega.",
    );
    expect(r.display.find((s) => s.slot === "PAY")?.variant).toBe("paypal_usd");
    expect(r.all).not.toContain("₱");
  });

  it("spoken text carries no digit: money and kilos as words, slips digit by digit", () => {
    for (const lang of ["en", "ceb", "fil"] as const) {
      for (const no of ["M-014", "M-018", "M-022", "M-053"]) {
        const r = renderStatement(statementPlan(seedFacts(no, lang, { cashDay: getRun().cashDay })));
        for (const s of r.spoken) expect(s.text, `${no} ${lang} ${s.slot}`).not.toMatch(/\p{Nd}/u);
      }
    }
    const spoken = text("M-014", "en").spoken;
    expect(spoken.find((s) => s.slot === "SOURCES")?.text).toContain("zero four zero three");
    expect(spoken.find((s) => s.slot === "PAY")?.text).toContain(
      format.amountSpoken(must(getLine("M-014")).netCents, "en"),
    );
  });

  it("every seeded member's SMS is GSM-7 and fits one message, the peso written P", () => {
    for (const no of getRun()
      .items.map((i) => i.memberNo)
      .concat(["M-053", "M-001"])) {
      for (const lang of ["en", "ceb", "fil"] as const) {
        const r = text(no, lang);
        expect(r.sms.fits, `${no} ${lang}: ${r.sms.text}`).toBe(true);
        expect(r.sms.text).not.toContain("₱");
      }
    }
    expect(text("M-014", "ceb").sms.text).toBe(
      `Bulawanon Kakaw: Nang Celing, bayad na ang ${format.money(must(getLine("M-014")).netCents)} sa PayPal (mga P${format.groupThousands(String(Math.floor(mulDivFloor(must(getLine("M-014")).netCents, FX.num, FX.den) / 100)))}). Resibo ${must(getLine("M-014")).slipSerials.join(",")}. Pangutana: Treasurer Analyn.`,
    );
  });

  it("an SMS that would not fit falls back to the short form", () => {
    const many = Array.from({ length: 30 }, (_, i) => String(1000 + i));
    const r = text("M-014", "en", { slipSerials: many });
    expect(r.sms.fits).toBe(true);
    expect(statementPlan(seedFacts("M-014", "en", { slipSerials: many })).sms.variant).toBe("paid_short");
  });
});

describe("GSM-7", () => {
  it("counts the basic set once, the extension twice, and refuses the rest", () => {
    expect(gsm7Length("Pacaña")).toBe(6);
    expect(gsm7Length("€[]")).toBe(6);
    expect(gsm7Length("₱")).toBeNull();
    expect(gsm7Length("“quoted”")).toBeNull();
  });
});
