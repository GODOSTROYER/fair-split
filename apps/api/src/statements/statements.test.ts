// Statements, pure: templates validate (I1), the plan picks the right sentences for the line's state, and the
// renderer is the only place a number becomes text: display, spoken and SMS, checked on the seed's hero lines.
import { createHash } from "node:crypto";
import type { MemberLineState } from "@fairsplit/contracts";
import { format, mulDivFloor, mulDivHalfUp } from "@fairsplit/domain";
import { getLine, getMember, getRateCard, getRun, getSeason } from "@fairsplit/seed";
import { describe, expect, it } from "vitest";
import { must } from "../proof/testing/world.js";
import { readingProvenanceOf } from "./facts.js";
import { gsm7Length } from "./gsm7.js";
import { type StatementLineFacts, statementPlan } from "./plan.js";
import { aiNoteVariant, renderStatement, spokenScript, spokenTextSha256 } from "./render.js";
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
    // a real reading: the product AI_NOTE (seeded and unknown readings: "the AI_NOTE" below)
    const r = text("M-014", "en", { readingProvenance: "live" });
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

describe("the AI_NOTE: Claude's reading only when Claude read the slips (T1)", () => {
  const LANGS = ["en", "ceb", "fil"] as const;
  /** Each AI_NOTE form, by the line facts that pick it. */
  const FORMS = {
    default: {},
    noname: { treasurer: null },
    checking: { state: "COMPUTED" },
  } as const satisfies Record<string, Partial<StatementLineFacts>>;
  const DEMO = { default: "seeded", noname: "seeded_noname", checking: "seeded_checking" } as const;
  const fill = (t: string | undefined) => must(t).replace("{{TREASURER}}", "Analyn");
  const noteOf = (r: ReturnType<typeof renderStatement>) => ({
    display: must(r.display.find((s) => s.slot === "AI_NOTE")),
    spoken: must(r.spoken.find((s) => s.slot === "AI_NOTE")),
  });
  const render = (lang: Lang, over: Partial<StatementLineFacts>) =>
    renderStatement(statementPlan(seedFacts("M-014", lang, over)));

  it("the demo wording, word for word (§6), in English", () => {
    const en = (over: Partial<StatementLineFacts>) =>
      noteOf(render("en", { readingProvenance: "seeded", ...over })).display.text;
    expect(en({})).toBe(
      "In this demo, the slip readings are a labelled stand-in for Claude's double reading; a person checked the unsure ones, and Treasurer Analyn approved this pay.",
    );
    expect(en(FORMS.noname)).toBe(
      "In this demo, the slip readings are a labelled stand-in for Claude's double reading; a person checked the unsure ones, and the treasurer approved this pay.",
    );
    expect(en(FORMS.checking)).toBe(
      "In this demo, the slip readings are a labelled stand-in for Claude's double reading; a person checked the unsure ones.",
    );
  });

  it("the demo wording in Cebuano and Filipino (machine-translated, chipped like every ceb and fil key)", () => {
    const note = (lang: Lang, over: Partial<StatementLineFacts>) =>
      noteOf(render(lang, { readingProvenance: "seeded", ...over })).display.text;
    expect(note("ceb", {})).toBe(
      "Niini nga demo, ang mga basa sa resibo puli nga may label para sa makaduha nga pagbasa ni Claude; ang mga basa nga dili sigurado gisusi sa tawo, ug giaprobahan ni Treasurer Analyn kini nga bayad.",
    );
    expect(note("ceb", FORMS.noname)).toBe(
      "Niini nga demo, ang mga basa sa resibo puli nga may label para sa makaduha nga pagbasa ni Claude; ang mga basa nga dili sigurado gisusi sa tawo, ug giaprobahan sa tesorero kini nga bayad.",
    );
    expect(note("ceb", FORMS.checking)).toBe(
      "Niini nga demo, ang mga basa sa resibo puli nga may label para sa makaduha nga pagbasa ni Claude; ang mga basa nga dili sigurado gisusi sa tawo.",
    );
    expect(note("fil", {})).toBe(
      "Sa demo na ito, ang mga basa sa resibo ay pamalit na may label para sa makalawang pagbasa ni Claude; sinuri ng tao ang mga basang hindi tiyak, at inaprubahan ni Treasurer Analyn ang bayad na ito.",
    );
    expect(note("fil", FORMS.noname)).toBe(
      "Sa demo na ito, ang mga basa sa resibo ay pamalit na may label para sa makalawang pagbasa ni Claude; sinuri ng tao ang mga basang hindi tiyak, at inaprubahan ng ingat-yaman ang bayad na ito.",
    );
    expect(note("fil", FORMS.checking)).toBe(
      "Sa demo na ito, ang mga basa sa resibo ay pamalit na may label para sa makalawang pagbasa ni Claude; sinuri ng tao ang mga basang hindi tiyak.",
    );
  });

  it("a seeded reading takes the demo variant in every language and form, display and spoken alike", () => {
    for (const lang of LANGS) {
      for (const [form, over] of Object.entries(FORMS) as [
        keyof typeof FORMS,
        Partial<StatementLineFacts>,
      ][]) {
        const plan = statementPlan(seedFacts("M-014", lang, { readingProvenance: "seeded", ...over }));
        expect(plan.readingProvenance).toBe("seeded");
        const n = noteOf(renderStatement(plan));
        const want = fill(TEMPLATES_V1[lang][`AI_NOTE.${DEMO[form]}`]);
        expect(n.display.variant, `${lang} ${form}`).toBe(DEMO[form]);
        expect(n.display.text, `${lang} ${form}`).toBe(want);
        expect(n.spoken.variant).toBe(DEMO[form]);
        expect(n.spoken.text, `${lang} ${form} spoken`).toBe(want);
        expect(n.display.text).toContain("demo");
        expect(n.display.text).not.toContain("AI (Claude)");
      }
    }
  });

  it("a real (live) reading keeps the product AI_NOTE in every language and form", () => {
    for (const lang of LANGS) {
      for (const [form, over] of Object.entries(FORMS) as [
        keyof typeof FORMS,
        Partial<StatementLineFacts>,
      ][]) {
        const plan = statementPlan(seedFacts("M-014", lang, { readingProvenance: "live", ...over }));
        expect(plan.readingProvenance).toBe("live");
        const n = noteOf(renderStatement(plan));
        const want = fill(TEMPLATES_V1[lang][`AI_NOTE.${form}`]);
        expect(n.display.variant, `${lang} ${form}`).toBe(form);
        expect(n.display.text, `${lang} ${form}`).toBe(want);
        expect(n.spoken.text, `${lang} ${form} spoken`).toBe(want);
        expect(n.display.text).toContain("AI (Claude)");
      }
    }
  });

  it("an unknown or missing reading provenance takes the demo variant, never the Claude claim", () => {
    for (const lang of LANGS) {
      for (const p of [undefined, null, "replay", "simulated_rail"] as const) {
        const plan = statementPlan(seedFacts("M-014", lang, { readingProvenance: p }));
        expect(plan.readingProvenance ?? null).toBe(p ?? null);
        const n = noteOf(renderStatement(plan));
        expect(n.display.variant, `${lang} ${String(p)}`).toBe("seeded");
        expect(n.spoken.variant).toBe("seeded");
      }
      // renderStatement decides on its own: a plan that names the product note but carries no reading
      // provenance (made elsewhere, or stored before T1) still renders the demo note
      const live = statementPlan(seedFacts("M-014", lang, { readingProvenance: "live" }));
      const { readingProvenance: _dropped, ...bare } = live;
      expect(bare.sentences.find((s) => s.slot === "AI_NOTE")?.variant).toBe("default");
      const n = noteOf(renderStatement(bare));
      expect(n.display.variant).toBe("seeded");
      expect(n.display.text).toBe(fill(TEMPLATES_V1[lang]["AI_NOTE.seeded"]));
    }
  });

  it("the variant choice never upgrades a demo note to the claim, and refuses a form it does not know", () => {
    expect(aiNoteVariant("seeded", "live")).toBe("seeded");
    expect(aiNoteVariant("seeded_checking", "live")).toBe("seeded_checking");
    expect(aiNoteVariant("default", "live")).toBe("default");
    expect(aiNoteVariant("noname", "seeded")).toBe("seeded_noname");
    expect(() => aiNoteVariant("short", undefined)).toThrow(/no demo variant/);
  });

  it("the SMS carries no AI_NOTE: the same GSM-7 text, in one message, whichever the reading", () => {
    for (const lang of LANGS) {
      for (const no of ["M-014", "M-053", "M-018"]) {
        const seeded = text(no, lang, { readingProvenance: "seeded" }).sms;
        const live = text(no, lang, { readingProvenance: "live" }).sms;
        expect(seeded).toEqual(live);
        expect(seeded.fits, `${no} ${lang}`).toBe(true);
        expect(seeded.text).not.toMatch(/Claude|demo/);
      }
    }
  });

  it("inv.i1.no-model-numbers: the demo texts pass every validator, and the demo disclosure is frozen", () => {
    for (const lang of LANGS) {
      for (const key of ["AI_NOTE.seeded", "AI_NOTE.seeded_noname", "AI_NOTE.seeded_checking"]) {
        expect(validateTemplate(key, must(TEMPLATES_V1[lang][key]), lang), `${lang} ${key}`).toEqual([]);
      }
    }
    // a committed variant may not swap the disclosure for the claim (or reword it at all)
    expect(
      validateTemplate("AI_NOTE.seeded_checking", must(TEMPLATES_V1.en["AI_NOTE.checking"]), "en"),
    ).toEqual([
      "AI_NOTE.seeded_checking: the demo disclosure is frozen; a committed variant must keep its words",
    ]);
  });

  it("spokenScript: each spoken sentence with the sha256 of its exact words, deterministic (AU2's export)", () => {
    for (const lang of LANGS) {
      const plan = statementPlan(seedFacts("M-014", lang, { readingProvenance: "seeded" }));
      const script = spokenScript(plan);
      expect(script.map((s) => s.text)).toEqual(renderStatement(plan).spoken.map((s) => s.text));
      for (const s of script) {
        expect(s.textSha256).toBe(createHash("sha256").update(s.text, "utf8").digest("hex"));
        expect(spokenTextSha256(s.text)).toBe(s.textSha256);
      }
      expect(spokenScript(statementPlan(seedFacts("M-014", lang, { readingProvenance: "seeded" })))).toEqual(
        script,
      );
      const note = must(script.find((s) => s.slot === "AI_NOTE"));
      expect(note.variant).toBe("seeded");
      expect(note.text).toBe(fill(TEMPLATES_V1[lang]["AI_NOTE.seeded"]));
    }
  });

  it("a line's reading provenance: Claude's only when every reading is live; nothing known is no claim", () => {
    expect(readingProvenanceOf([])).toBeNull();
    expect(readingProvenanceOf(["live", "live"])).toBe("live");
    expect(readingProvenanceOf(["live", "seeded"])).toBe("seeded");
    expect(readingProvenanceOf(["live", "replay"])).toBe("replay");
    expect(readingProvenanceOf(["replay", "seeded"])).toBe("seeded");
    expect(readingProvenanceOf(["simulated_rail"])).toBe("simulated_rail");
    expect(readingProvenanceOf(["live", "something-else"])).toBe("seeded");
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
