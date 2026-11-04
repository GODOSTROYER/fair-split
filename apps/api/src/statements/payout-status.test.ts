import { describe, expect, it } from "vitest";
import { payoutStatusPresentation } from "../lib/payout-status.js";
import { type StatementLineFacts, statementPlan } from "./plan.js";
import { renderStatement } from "./render.js";

/** The replay word in each reader's language: ceb and fil machine-translated, chipped like every ceb and fil key. */
const REPLAY_WORD = {
  en: "Replayed (labelled): earlier simulated PayPal sandbox run",
  ceb: "Gi-replay (gilabelan): miaging simulated PayPal sandbox run",
  fil: "Ni-replay (may label): naunang simulated PayPal sandbox run",
} as const;
/** An English sentence in a Cebuano or Filipino SMS (product terms such as "simulated PayPal sandbox" stay). */
const ENGLISH = /\b(?:Replayed|labelled|earlier|this run|payment|not)\b/;

const facts: StatementLineFacts = {
  lineId: "00000000-0000-4000-8000-000000000014",
  memberNo: "M-014",
  lang: "en",
  state: "PAID",
  verifiedG: 1000,
  grade1G: 1000,
  premiumCents: 100,
  bonusCents: 50,
  netCents: 150,
  deductions: [],
  credits: [],
  slipSerials: ["0403"],
  honorific: "Nang Celing",
  payer: "Buyer",
  resolutionNo: "BR-1",
  treasurer: "Analyn",
  coop: "Bulawanon Kakaw",
  fx: { num: 625, den: 10 },
  cashDay: null,
  itemStatus: "SUCCESS",
  itemProvenance: "replay",
};

describe("inv.i8.api-payout-presentation", () => {
  it.each(["en", "ceb", "fil"] as const)(
    "%s RETURNED remains a payout outcome until the cash decision",
    (lang) => {
      const returned = { ...facts, lang, state: "RETURNED" as const, itemStatus: "RETURNED" as const };
      const replay = payoutStatusPresentation(returned, lang);
      expect(replay).toMatchObject({ replayed: true, tone: "neutral", amountState: "unsettled" });
      expect(replay.statusWord).toBe(REPLAY_WORD[lang]);
      const replaySms = renderStatement(statementPlan(returned)).sms;
      expect(replaySms.text).toContain(REPLAY_WORD[lang]);
      if (lang !== "en") expect(replaySms.text).not.toMatch(ENGLISH);
      expect(replaySms.fits).toBe(true);

      const live = { ...returned, itemProvenance: "simulated_rail" as const };
      expect(payoutStatusPresentation(live, lang).statusWord).toMatch(/simulated PayPal sandbox/);
      expect(payoutStatusPresentation(live, lang).replayed).toBe(false);
      const liveSms = renderStatement(statementPlan(live)).sms;
      expect(liveSms.text).toContain(payoutStatusPresentation(live, lang).statusWord);
      expect(liveSms.text).not.toMatch(/replay|ready in cash|sent to your PayPal/i);
      expect(liveSms.fits).toBe(true);
    },
  );

  it.each(["OFF_RAIL_DUE", "OFF_RAIL_PAID"] as const)(
    "%s is a current cash decision despite an old replay return",
    (state) => {
      const cash = { ...facts, state, itemStatus: "RETURNED" as const };
      const p = payoutStatusPresentation(cash);
      expect(p.replayed).toBe(false);
      expect(p.statusWord).not.toMatch(/replay|PayPal/i);
      expect(renderStatement(statementPlan(cash)).sms.text).not.toMatch(/replay|PayPal/i);
    },
  );

  it("labels a waiting PayPal state simulated before an item exists, without replaying the run label", () => {
    const p = payoutStatusPresentation({ state: "LOCKED", itemStatus: null, itemProvenance: null });
    expect(p.statusWord).toContain("simulated PayPal sandbox");
    expect(p.replayed).toBe(false);
  });

  it("preserves console register words for the brand", () => {
    expect(payoutStatusPresentation({ state: "OFF_RAIL_DUE" }, "console").statusWord).toBe("Cash due");
    expect(payoutStatusPresentation(facts, "console").statusWord).toBe(REPLAY_WORD.en);
  });

  it.each(["en", "ceb", "fil"] as const)("%s replay item controls status, amount and SMS", (lang) => {
    const p = payoutStatusPresentation(facts, lang);
    expect(p).toMatchObject({
      replayed: true,
      tone: "neutral",
      amountState: "unsettled",
      simulatedLabel: "Simulated PayPal sandbox",
    });
    expect(p.statusWord).toBe(REPLAY_WORD[lang]);
    expect(p.statusWord).toContain("simulated PayPal sandbox run");
    const sms = renderStatement(statementPlan({ ...facts, lang })).sms;
    expect(sms.text).toContain(REPLAY_WORD[lang]);
    expect(sms.text).not.toMatch(/\bpaid\b|Bayad na|bayad na/i);
    // A Cebuano or Filipino SMS carries no English sentence.
    if (lang !== "en") expect(sms.text).not.toMatch(ENGLISH);
    expect(sms.fits).toBe(true);
  });

  it.each(["en", "ceb", "fil"] as const)("%s live simulator stays simulated and never replayed", (lang) => {
    const live = { ...facts, itemProvenance: "simulated_rail" as const };
    const p = payoutStatusPresentation(live, lang);
    expect(p).toMatchObject({ replayed: false, tone: "jade", amountState: "landed" });
    expect(p.statusWord).toContain("simulated PayPal sandbox");
    expect(p.statusWord).not.toMatch(/replay/i);
    const sms = renderStatement(statementPlan({ ...live, lang })).sms;
    expect(sms.text).toContain("Simulated PayPal sandbox");
    expect(sms.text).not.toMatch(/replay/i);
    expect(sms.fits).toBe(true);
  });

  it.each(["READY", "HELD", "EXCLUDED", "OFF_RAIL_DUE", "OFF_RAIL_PAID"] as const)(
    "%s has no replayed PayPal status",
    (state) => {
      const f = { ...facts, state, itemStatus: null };
      const p = payoutStatusPresentation(f, "en");
      expect(p.replayed).toBe(false);
      expect(p.statusWord).not.toMatch(/replay|PayPal/i);
      expect(renderStatement(statementPlan(f)).sms.text).not.toMatch(/replay|PayPal/i);
    },
  );
});
