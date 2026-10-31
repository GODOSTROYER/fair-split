import { StatementAudio } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import type { StatementAudioClip, StatementAudioSentence, StatementDTO } from "../_shims/api-client";
import { sha256Hex } from "../_shims/domain";
import { buildDemoStatement } from "../services/demo-fixtures";
import { withNoDate } from "../test/pay-forms";
import { figureRuns, isFigure } from "../ui/figures";
import { EMPTY_TRACK } from "./item-status";
import {
  amountStateFor,
  applicableTemplates,
  audioPlan,
  chooseVoice,
  clipCuesReached,
  cuesReached,
  fillSentence,
  glossPairs,
  hasDigit,
  legacyStatementCacheKeys,
  lineApproved,
  MONEY_SLOTS,
  mergeTrack,
  payForm,
  readFailureOf,
  sentenceFor,
  spokenSerial,
  statementCacheKey,
  statementSentences,
  statementValues,
  templateVariant,
  withServedAudio,
} from "./statement";

const dto = buildDemoStatement({ stage: "paid", now: "2026-10-30T09:12:00+08:00" });

describe("statement sentences", () => {
  it("renders the hero line in Cebuano, one sentence per slot, PayPal variant", () => {
    const { sentences, rejected } = statementSentences(dto, "ceb");
    expect(rejected).toEqual([]);
    expect(sentences.map((s) => s.slot)).toEqual([
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
    expect(sentences.map((s) => s.display)).toEqual([
      "Maayong adlaw, Nang Celing. Salamat sa inyong paghago.",
      "Nagdala mo og 148.0 kg nga uga nga cacao, tanan Grade 1.",
      "Premium gikan sa Lantern Bay: US$43.69, walay kaltas.",
      "Bonus sa kalidad: US$21.85.",
      "Gikaltasan og US$1.09 para sa CBU (R1, BR 2026-04).",
      "Ang inyong bayad karong season: US$64.45, sa inyong PayPal. Kung ilisan sa peso, mga ₱4,028.",
      "Gikan kini sa inyong resibo 0403, 0419, 0436 ug 0467.",
      "Naa moy pangutana? Adto kang Treasurer Analyn sa bodega.",
      "Ang inyong mga resibo gibasa sa makaduha sa AI (Claude). Ang mga pagbasa nga dili sigurado gisusi sa usa ka tawo, ug si Treasurer Analyn ang miaprobar niini nga bayad.",
    ]);
  });

  it("speaks money as words for device speech", () => {
    const { sentences } = statementSentences(dto, "en");
    expect(sentences.find((s) => s.slot === "PAY")?.spoken).toBe(
      "Your pay this season: sixty-four dollars and forty-five cents, to your PayPal. Changed to pesos, about four thousand twenty-eight pesos.",
    );
  });

  it("names the slips so Paminawa can lift their chips", () => {
    const sources = statementSentences(dto, "fil").sentences.find((s) => s.slot === "SOURCES");
    expect(sources?.mentions).toEqual(["slip:0403", "slip:0419", "slip:0436", "slip:0467"]);
    expect(sources?.display).toBe("Galing po ito sa inyong mga resibo 0403, 0419, 0436 at 0467.");
  });

  it("reads the cash variant, exact pesos at the run's rate, once the line moves to the bodega", () => {
    const cash = buildDemoStatement({ stage: "cash-due", now: "2026-10-30T09:12:00+08:00" });
    const pay = statementSentences(cash, "en").sentences.find((s) => s.slot === "PAY");
    expect(pay?.display).toBe("Your pay this season: ₱4,028.13, in cash at the bodega on 30 Oct 2026.");
    expect(applicableTemplates(cash, "en", "cash").filter((s) => s.slot === "PAY")).toHaveLength(1);
  });

  it("inv.i1.no-model-numbers: a model sentence with a digit is never shown", () => {
    const values = statementValues(dto, "ceb");
    expect(fillSentence({ id: "x", text: "Ang inyong bayad: 64.45 dolyar." }, values)).toEqual({
      ok: false,
      id: "x",
      reason: "digit-in-template",
    });
    // Non-ASCII digits too.
    expect(hasDigit("bayad ٦٤")).toBe(true);
    expect(hasDigit("bayad {{NET_USD}}")).toBe(false);
  });

  it("inv.i1.placeholders-only: unknown placeholders and stray braces are rejected", () => {
    const values = statementValues(dto, "ceb");
    expect(fillSentence({ id: "y", text: "Bayad: {{AMOUNT}}." }, values)).toMatchObject({
      ok: false,
      reason: "unknown-placeholder",
    });
    expect(fillSentence({ id: "z", text: "Bayad: {{NET_USD}} }}" }, values)).toMatchObject({
      ok: false,
      reason: "stray-braces",
    });
  });

  it("inv.i1.engine-values: every figure in the filled text comes from the DTO, formatted by format.*", () => {
    const { sentences } = statementSentences(dto, "en");
    const text = sentences.map((s) => s.display).join(" ");
    for (const figure of ["US$43.69", "US$21.85", "US$1.09", "US$64.45", "₱4,028", "148.0 kg"]) {
      expect(text).toContain(figure);
    }
  });
});

describe("PAY's form, as fs-api's statement plan picks it (ADR-0011 §6)", () => {
  const NOW = "2026-10-30T09:12:00+08:00";
  const at = (stage: Parameters<typeof buildDemoStatement>[0]["stage"]) =>
    buildDemoStatement({ stage, now: NOW });
  const noRate = (d: StatementDTO): StatementDTO => ({ ...d, fx: { phpPerUsd: "" } });

  it("by the line, its rail, the run's rate and the cash receipt: the seven forms fs-api renders", () => {
    expect(payForm(at("paid"))).toBe("paypal");
    expect(payForm(at("sent"))).toBe("paypal");
    expect(payForm(noRate(at("paid")))).toBe("paypal_usd");
    // at the bodega: no receipt yet, then the clerk's receipt (it names the day), or no run rate at all
    expect(payForm(at("cash-due"))).toBe("cash_nodate");
    expect(payForm(at("cash-received"))).toBe("cash");
    expect(payForm(noRate(at("cash-due")))).toBe("cash_usd");
    // the capsule moved a PayPal line to the bodega: still no receipt
    expect(payForm(at("paid"), "cash")).toBe("cash_nodate");
    // still being checked, or held, or excluded from the run
    expect(payForm(at("checking"))).toBe("checking");
    expect(payForm({ ...at("checking"), lineState: "HELD" })).toBe("checking");
    expect(payForm({ ...at("paid"), lineState: "EXCLUDED" })).toBe("excluded");
  });

  it("shows the template of that form, else the rail's own as a stand-in, and names the receipt's day", () => {
    const pay = (d: StatementDTO, rail?: "paypal" | "cash") =>
      applicableTemplates(d, "en", rail ?? (d.rail === "CASH" ? "cash" : "paypal")).filter(
        (t) => t.slot === "PAY",
      );
    // with a no-date template, a line at the bodega shows it until the receipt, then the dated one
    expect(pay(withNoDate(at("cash-due"))).map((t) => t.id)).toEqual(["pay-cash-nodate"]);
    expect(pay(withNoDate(at("cash-received"))).map((t) => t.id)).toEqual(["pay-cash"]);
    expect(pay(withNoDate(at("paid"))).map((t) => t.id)).toEqual(["pay"]);
    // the demo's templates have no no-date form: the dated one stands in (the phone's voice reads it)
    expect(pay(at("cash-due")).map((t) => t.id)).toEqual(["pay-cash"]);
    // the dated sentence names the day the clerk recorded the cash received, the day fs-api's PAY.cash says
    const received = {
      ...at("cash-received"),
      history: [
        ...at("cash-received").history.filter((h) => h.kind !== "received"),
        { kind: "received" as const, at: "2026-11-05T10:00:00+08:00" },
      ],
    };
    expect(statementSentences(received, "en").sentences.find((s) => s.slot === "PAY")?.display).toBe(
      "Your pay this season: ₱4,028.13, in cash at the bodega on 5 Nov 2026.",
    );
  });
});

describe("statement segments", () => {
  it("splits words from engine values so money can be set in the figure face", () => {
    const premium = statementSentences(dto, "en").sentences.find((s) => s.slot === "PREMIUM");
    expect(premium?.segments).toEqual([
      { text: "Premium from ", value: false },
      { text: "Lantern Bay", value: true },
      { text: ": ", value: false },
      { text: "US$43.69", value: true },
      { text: ", with no deductions.", value: false },
    ]);
    expect(premium?.segments.map((x) => x.text).join("")).toBe(premium?.display);
  });

  it("changes face only for the figures inside an engine value, never for its words", () => {
    const sources = statementSentences(dto, "ceb").sentences.find((s) => s.slot === "SOURCES");
    const runs = figureRuns(sources?.segments ?? []);
    expect(runs.filter(isFigure).map((r) => r.text)).toEqual(["0403", "0419", "0436", "0467"]);
    expect(runs.some((r) => r.text.includes(" ug ") && !r.value)).toBe(true);
    expect(runs.map((r) => r.text).join("")).toBe(sources?.display);
  });

  it("keeps names and the payer in prose and sets every amount in the figure face", () => {
    const sentence = (lang: "ceb" | "en", slot: string) =>
      statementSentences(dto, lang).sentences.find((s) => s.slot === slot);
    expect(figureRuns(sentence("ceb", "GREETING")?.segments ?? []).filter(isFigure)).toEqual([]);
    const pay = figureRuns(sentence("en", "PAY")?.segments ?? []);
    expect(pay.filter(isFigure).map((r) => r.text)).toEqual(["US$64.45", "₱4,028"]);
  });
});

describe("English gloss (IC-12 gloss, S1.13)", () => {
  it("pairs each Cebuano sentence with the English sentence of the same template", () => {
    const pairs = glossPairs(dto, "ceb");
    const greeting = sentenceFor(pairs, "GREETING");
    expect(greeting?.sentence.display).toBe("Maayong adlaw, Nang Celing. Salamat sa inyong paghago.");
    expect(greeting?.gloss?.display).toBe("Good day, Mrs. Bacus. Thank you for your hard work.");
    expect(pairs.every((p) => p.gloss !== null)).toBe(true);
  });

  it("has nothing to gloss in English", () => {
    expect(glossPairs(dto, "en").every((p) => p.gloss === null)).toBe(true);
    expect(sentenceFor(glossPairs(dto, "en"), "CREDIT")).toBeNull();
  });
});

describe("Paminawa audio plan (register §9, M-MB-03)", () => {
  type L = "ceb" | "fil" | "en";
  /**
   * fs-api's hash of its own words for sentence `i` (ADR-0011 §3), deliberately not the hash of the phone's words:
   * the phone pairs fs-api's sentences with its own by slot and mentions, and never hashes what it renders (§6).
   */
  const apiHash = (lang: L, i: number) => sha256Hex(`fs-api's words for ${lang} sentence ${i}`);
  /** fs-api's served sentence for the phone's sentence `i` (IC-11): which one it is, fs-api's hash, its clip. */
  const voiced = (
    lang: L,
    i: number,
    extra: Partial<StatementAudioClip> = {},
    d: StatementDTO = dto,
    rail: "paypal" | "cash" = "paypal",
  ): StatementAudioSentence => {
    const own = statementSentences(d, lang, rail).sentences[i];
    if (!own?.slot) throw new Error(`no sentence ${i} in ${lang}`);
    const template = d.sentences[lang].find((t) => t.id === own.id);
    return {
      slot: own.slot,
      // the form fs-api rendered (`{slot}.{variant}`): PAY's as fs-api's plan picks it for this line and rail
      // (PAY.paypal for the paid hero, PAY.cash_nodate at the bodega before a receipt), the default form of the rest
      variant: own.slot === "PAY" ? payForm(d, rail) : "default",
      mentions: own.slot === "DEDUCTION" ? [`rule:${template?.ref}`] : own.mentions,
      textSha256: apiHash(lang, i),
      clip: {
        url: `https://media.invalid/${lang}/${i}.m4a`,
        textSha256: apiHash(lang, i),
        label: "Sintetikong tingog (Gemini TTS)",
        slot: own.slot,
        offsets: [],
        durationMs: 4000,
        ...extra,
      },
    };
  };
  /** fs-api's audio for every sentence of `langs`; `otherWords(i)` gives sentence `i` a clip of other words. */
  const withClips = (langs: L[], otherWords?: (i: number) => boolean) => {
    const audio: Record<string, StatementAudioSentence[]> = {};
    for (const l of langs) {
      audio[l] = statementSentences(dto, l).sentences.map((_, i) =>
        voiced(l, i, otherWords?.(i) ? { textSha256: sha256Hex("other words") } : {}),
      );
    }
    return { ...dto, audio };
  };

  it("reads with the phone's own voice, labelled, while no clip exists", () => {
    const plan = audioPlan(dto, "ceb", { deviceVoice: true });
    expect(plan.mode).toBe("device-voice");
    expect(plan.steps.every((s) => s.voice.kind === "device")).toBe(true);
    expect(audioPlan(dto, "ceb", { deviceVoice: false }).mode).toBe("text-only");
  });

  it("plays the synthetic clip of every sentence rendered from exactly its words", () => {
    const plan = audioPlan(withClips(["ceb"]), "ceb", { deviceVoice: true });
    expect(plan.mode).toBe("synthetic");
    expect(plan.steps.map((s) => (s.voice.kind === "clip" ? s.voice.url : null))).toEqual(
      plan.steps.map((_, i) => `https://media.invalid/ceb/${i}.m4a`),
    );
  });

  it("never plays a clip whose words changed: that sentence falls back to the phone's voice", () => {
    const plan = audioPlan(
      withClips(["ceb"], (i) => i === 2),
      "ceb",
      { deviceVoice: true },
    );
    expect(plan.mode).toBe("mixed");
    expect(plan.steps[2]?.voice.kind).toBe("device");
    expect(plan.steps[1]?.voice.kind).toBe("clip");
  });

  it("plays Filipino clips under the Cebuano text when there is no Cebuano audio (S10 fallback)", () => {
    const plan = audioPlan(withClips(["fil"]), "ceb", { deviceVoice: true });
    expect(plan.mode).toBe("filipino-audio");
    const first = plan.steps[0];
    expect(first?.voice).toMatchObject({ kind: "clip", lang: "fil" });
    expect(first?.spoken).toContain("Maayong adlaw");
  });

  it("falls back to the phone's voice for clips it cannot reach offline", () => {
    const plan = audioPlan(withClips(["ceb"]), "ceb", { deviceVoice: true, playable: () => false });
    expect(plan.mode).toBe("device-voice");
  });

  it("cues each slip where the voice names it: a character index, and the clip's own offset", () => {
    const device = audioPlan(dto, "en", { deviceVoice: true });
    const sources = device.steps.find((s) => s.slot === "SOURCES");
    expect(sources?.cues.map((c) => c.serial)).toEqual(["0403", "0419", "0436", "0467"]);
    for (const c of sources?.cues ?? []) {
      expect(sources?.spoken.slice(c.charIndex, c.charIndex + 7)).toBe(c.serial.split("").join(" "));
      expect(c.offsetMs).toBeNull();
    }
    const synthetic = audioPlan(withClips(["en"]), "en", { deviceVoice: true });
    const timed = synthetic.steps.find((s) => s.slot === "SOURCES");
    const offsets = timed?.cues.map((c) => c.offsetMs ?? -1) ?? [];
    expect(offsets.every((o, i) => o > 0 && o < 4000 && (i === 0 || o > (offsets[i - 1] ?? 0)))).toBe(true);
    const manifest = {
      ...dto,
      audio: {
        en: statementSentences(dto, "en").sentences.map((_, i) =>
          voiced("en", i, { offsets: [{ ref: "slip:0403", atMs: 1234 }] }),
        ),
      },
    };
    const exact = audioPlan(manifest, "en", { deviceVoice: true }).steps.find((s) => s.slot === "SOURCES");
    expect(exact?.cues[0]?.offsetMs).toBe(1234);
  });

  it("never plays a clip recorded for another slot, even with the same words", () => {
    const misfiled = { ...dto, audio: { ceb: [voiced("ceb", 0, { slot: "HELP" })] } };
    expect(audioPlan(misfiled, "ceb", { deviceVoice: true }).steps[0]?.voice.kind).toBe("device");
  });

  it("pairs each sentence with fs-api's by slot and the rule it names, so two deductions never swap clips", () => {
    const en = dto.sentences.en;
    const r1 = en.find((t) => t.slot === "DEDUCTION" && t.ref === "R1");
    const two: StatementDTO = {
      ...dto,
      amounts: {
        ...dto.amounts,
        deductions: [...dto.amounts.deductions, { ruleId: "R3", label: "Loan", cents: 500 }],
      },
      sentences: {
        ...dto.sentences,
        en: en.flatMap((t) => (t === r1 ? [t, { ...t, id: "deduction-R3", ref: "R3" }] : [t])),
      },
    };
    const own = statementSentences(two, "en").sentences;
    const [a, b] = [own.findIndex((s) => s.id === r1?.id), own.findIndex((s) => s.id === "deduction-R3")];
    expect(a >= 0 && b === a + 1).toBe(true);
    // fs-api reads the loan first: each deduction still plays the clip made for it
    const served = own.map((_, i) => voiced("en", i, {}, two));
    const swapped = served.map((s, i) => (i === a ? served[b] : i === b ? served[a] : s) ?? s);
    const plan = audioPlan({ ...two, audio: { en: swapped } }, "en", { deviceVoice: true });
    expect(plan.mode).toBe("synthetic");
    expect(plan.steps[a]?.voice).toMatchObject({ url: `https://media.invalid/en/${a}.m4a` });
    expect(plan.steps[b]?.voice).toMatchObject({ url: `https://media.invalid/en/${b}.m4a` });
  });

  it("a sentence fs-api did not serve, or served for another rule, is read by the phone's own voice", () => {
    const served = statementSentences(dto, "en").sentences.map((_, i) => voiced("en", i));
    const other = served
      .filter((s) => s.slot !== "HELP")
      .map((s) => (s.slot === "DEDUCTION" ? { ...s, mentions: ["rule:R4"] } : s));
    const plan = audioPlan({ ...dto, audio: { en: other } }, "en", { deviceVoice: true });
    expect(plan.mode).toBe("mixed");
    expect(plan.steps.filter((s) => s.voice.kind === "device").map((s) => s.slot)).toEqual([
      "DEDUCTION",
      "HELP",
    ]);
  });

  it("names each template's form as fs-api does (`{slot}.{variant}`): the demo's PAY forms, the rest default", () => {
    for (const lang of ["ceb", "fil", "en"] as const) {
      for (const rail of ["paypal", "cash"] as const) {
        const forms = applicableTemplates(dto, lang, rail).map((t) => `${t.slot}.${templateVariant(t)}`);
        expect(forms, `${lang} ${rail}`).toEqual([
          "GREETING.default",
          "DELIVERY.default",
          "PREMIUM.default",
          "BONUS.default",
          "DEDUCTION.default",
          `PAY.${rail}`,
          "SOURCES.default",
          "HELP.default",
          // the product note ("read twice by AI (Claude)"): never paired with T1's seeded AI_NOTE.seeded
          "AI_NOTE.default",
        ]);
      }
    }
    expect(templateVariant({ slot: "PAY" })).toBe("paypal");
    expect(templateVariant({ slot: "AI_NOTE", variant: "seeded" })).toBe("seeded");
  });

  it("never plays fs-api's PayPal PAY clip for the cash PAY sentence when the line moves to the bodega", () => {
    // fs-api spoke the statement while the line was on PayPal; the live item track then turned the capsule to cash
    const served = withClips(["en"]);
    const cash = audioPlan(served, "en", { deviceVoice: true, rail: "cash" });
    const pay = cash.steps.find((s) => s.slot === "PAY");
    expect(pay?.spoken).toContain("in cash at the bodega");
    expect(pay?.voice).toEqual({ kind: "device" });
    expect(cash.mode).toBe("mixed");
    expect(cash.steps.filter((s) => s.voice.kind === "device").map((s) => s.slot)).toEqual(["PAY"]);
    // the PayPal sentence still plays it
    expect(
      audioPlan(served, "en", { deviceVoice: true }).steps.find((s) => s.slot === "PAY")?.voice.kind,
    ).toBe("clip");
  });

  it("plays fs-api's cash PAY clip only under the same cash form: PAY.cash_nodate until a receipt, then PAY.cash", () => {
    // fs-api, read again with the line at the bodega and no receipt yet, speaks PAY.cash_nodate
    const nodate = withNoDate(dto);
    const due = {
      ...nodate,
      audio: {
        en: statementSentences(nodate, "en", "cash").sentences.map((_, i) =>
          voiced("en", i, {}, nodate, "cash"),
        ),
      },
    };
    expect(due.audio.en.find((s) => s.slot === "PAY")?.variant).toBe("cash_nodate");
    const onDue = audioPlan(due, "en", { deviceVoice: true, rail: "cash" });
    expect(onDue.mode).toBe("synthetic");
    expect(onDue.steps.find((s) => s.slot === "PAY")).toMatchObject({ id: "pay-cash-nodate" });
    // on PayPal the line shows its PayPal sentence, which never plays the cash clip
    expect(audioPlan(due, "en", { deviceVoice: true }).steps.find((s) => s.slot === "PAY")?.voice).toEqual({
      kind: "device",
    });
    // the demo's own templates lack the no-date form: its dated cash sentence stands in, read by the phone's voice
    const standIn = audioPlan({ ...dto, audio: due.audio }, "en", { deviceVoice: true, rail: "cash" });
    expect(standIn.steps.find((s) => s.slot === "PAY")).toMatchObject({
      id: "pay-cash",
      voice: { kind: "device" },
    });
    expect(standIn.steps.filter((s) => s.voice.kind === "device").map((s) => s.slot)).toEqual(["PAY"]);
    // once the clerk records the cash received, fs-api speaks the dated PAY.cash, and the dated sentence plays it
    const received = withNoDate(
      buildDemoStatement({ stage: "cash-received", now: "2026-10-30T09:12:00+08:00" }),
    );
    const paid = {
      ...received,
      audio: {
        en: statementSentences(received, "en").sentences.map((_, i) => voiced("en", i, {}, received, "cash")),
      },
    };
    expect(paid.audio.en.find((s) => s.slot === "PAY")?.variant).toBe("cash");
    const onReceived = audioPlan(paid, "en", { deviceVoice: true });
    expect(onReceived.mode).toBe("synthetic");
    expect(onReceived.steps.find((s) => s.slot === "PAY")).toMatchObject({ id: "pay-cash" });
    // and a phone still without the receipt shows the no-date sentence, which never plays the dated clip
    const noReceipt = { ...paid, history: paid.history.filter((h) => h.kind !== "received") };
    expect(
      audioPlan(noReceipt, "en", { deviceVoice: true }).steps.find((s) => s.slot === "PAY"),
    ).toMatchObject({
      id: "pay-cash-nodate",
      voice: { kind: "device" },
    });
  });

  it.each([
    ["AI_NOTE", "seeded"],
    ["AI_NOTE", "seeded_checking"],
    ["AI_NOTE", "checking"],
    ["HELP", "noname"],
    ["GREETING", "seeded"],
  ] as const)(
    "never plays fs-api's %s.%s clip under the phone's other form of that slot",
    (slot, variant) => {
      const served = withClips(["ceb"]);
      const other = {
        ...served,
        audio: { ceb: served.audio.ceb?.map((s) => (s.slot === slot ? { ...s, variant } : s)) },
      };
      const plan = audioPlan(other, "ceb", { deviceVoice: true });
      expect(plan.mode).toBe("mixed");
      expect(plan.steps.filter((s) => s.voice.kind !== "clip").map((s) => s.slot)).toEqual([slot]);
    },
  );

  it("fires each cue once, in order, as the voice reaches it", () => {
    const sources = audioPlan(dto, "en", { deviceVoice: true }).steps.find((s) => s.slot === "SOURCES");
    const cues = sources?.cues ?? [];
    expect(cuesReached(cues, 0, 0)).toEqual([]);
    expect(cuesReached(cues, cues[1]?.charIndex ?? 0, 0).map((c) => c.serial)).toEqual(["0403", "0419"]);
    expect(cuesReached(cues, Number.MAX_SAFE_INTEGER, 2).map((c) => c.serial)).toEqual(["0436", "0467"]);
  });

  it("inv.i1.spoken: the voice reads serials digit by digit and money as words, never a model's figure", () => {
    expect(spokenSerial("0403")).toBe("0 4 0 3");
    const pay = audioPlan(dto, "ceb", { deviceVoice: true }).steps.find((s) => s.slot === "PAY");
    expect(pay?.spoken).toContain("sixty-four dollars and forty-five cents");
  });
});

describe("clip cues (register §9 mention offsets)", () => {
  const cues = [
    { ref: "slip:0403", serial: "0403", charIndex: 30, offsetMs: 1200 },
    { ref: "slip:0419", serial: "0419", charIndex: 40, offsetMs: null },
    { ref: "slip:0436", serial: "0436", charIndex: 50, offsetMs: 2600 },
  ];
  it("fires in order at the clip's own media time, an unknown offset with its predecessor", () => {
    expect(clipCuesReached(cues, 0, 0)).toEqual([]);
    expect(clipCuesReached(cues, 1300, 0).map((c) => c.serial)).toEqual(["0403", "0419"]);
    expect(clipCuesReached(cues, 2599, 2)).toEqual([]);
    expect(clipCuesReached(cues, 2600, 2).map((c) => c.serial)).toEqual(["0436"]);
  });
  it("never skips ahead of a cue the voice has not reached", () => {
    const shuffled = [cues[2], cues[0]].filter((c) => c !== undefined);
    expect(cuesReached(shuffled, 45, 0)).toEqual([]);
  });
});

describe("inv.i5.member-track: a statement read never moves the item backwards", () => {
  const track = { status: "SUCCESS" as const, updatedAt: "2026-10-30T01:00:00Z", seen: ["e1"] };
  it("keeps an SSE status that is ahead of a stale read", () => {
    expect(mergeTrack(track, { senderItemId: "r37-M-014", status: "PENDING", updatedAt: null })).toBe(track);
  });
  it("takes the read when it is level or ahead", () => {
    const pending = { status: "PENDING" as const, updatedAt: "2026-10-30T00:00:00Z", seen: ["e0"] };
    expect(
      mergeTrack(pending, {
        senderItemId: "r37-M-014",
        status: "SUCCESS",
        updatedAt: "2026-10-30T01:00:00Z",
      }),
    ).toEqual({ status: "SUCCESS", updatedAt: "2026-10-30T01:00:00Z", seen: ["e0"] });
    expect(mergeTrack(EMPTY_TRACK, { senderItemId: "x", status: "UNCLAIMED", updatedAt: null }).status).toBe(
      "UNCLAIMED",
    );
  });
  it("clears for a run with no item yet, but remembers the events it has applied", () => {
    expect(mergeTrack(track, { senderItemId: "r37-M-014", status: null, updatedAt: null })).toEqual({
      status: null,
      updatedAt: null,
      seen: ["e1"],
    });
    expect(mergeTrack(track, null).status).toBeNull();
  });
});

describe("the hero amount follows the amount grammar (S2.2.1)", () => {
  it("is hollow in flight, landed only when PayPal confirms, attested when the cash is handed over", () => {
    expect(amountStateFor("sent", true)).toBe("hollow");
    expect(amountStateFor("paid", true)).toBe("landed");
    expect(amountStateFor("cash-due", true)).toBe("hollow");
    expect(amountStateFor("cash-received", true)).toBe("attested");
    expect(amountStateFor("unclaimed", true)).toBe("hollow");
    expect(amountStateFor("reversed", true)).toBe("hollow");
  });
  it("is pencil until both keys are turned, ink after; an excluded line stays pencil", () => {
    expect(amountStateFor("checking", false)).toBe("pencil");
    expect(amountStateFor("checking", true)).toBe("ink");
    expect(amountStateFor("excluded", true)).toBe("pencil");
  });
  it("knows a run is approved from its batch digest or its history", () => {
    expect(lineApproved(dto)).toBe(true);
    const checking = buildDemoStatement({ stage: "checking", now: "2026-10-30T09:12:00+08:00" });
    expect(lineApproved(checking)).toBe(false);
  });
});

describe("a line still being checked speaks no amount (S1.9 checking)", () => {
  it("leaves the money sentences out of the statement and of Paminawa, and keeps the indexes dense", () => {
    const checking = buildDemoStatement({ stage: "checking", now: "2026-10-30T09:12:00+08:00" });
    const pairs = glossPairs(checking, "ceb", undefined, MONEY_SLOTS);
    expect(pairs.map((p) => p.sentence.slot)).toEqual(["GREETING", "DELIVERY", "SOURCES", "HELP", "AI_NOTE"]);
    const plan = audioPlan(checking, "ceb", { deviceVoice: true, exclude: MONEY_SLOTS });
    expect(plan.steps.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    expect(plan.steps.some((s) => /dollar|peso/.test(s.spoken))).toBe(false);
  });
});

describe("the phone's own voice (register §9: device speech, labelled)", () => {
  const voices = [
    { identifier: "en-us-x-sfg", language: "en_US" },
    { identifier: "fil-ph-x-cfc", language: "fil-PH" },
    { identifier: "Google English (India)", language: "en-IN" },
  ];
  it("reads Cebuano with the best Filipino voice, and Filipino with it too", () => {
    expect(chooseVoice("ceb", voices)).toEqual({ language: "fil-ph", voiceId: "fil-ph-x-cfc" });
    expect(chooseVoice("fil", [{ identifier: "tl", language: "tl-PH" }])).toEqual({
      language: "tl-ph",
      voiceId: "tl",
    });
  });
  it("prefers a Philippine English voice, then any listed English", () => {
    expect(chooseVoice("en", [...voices, { identifier: "ph", language: "en-PH" }])?.voiceId).toBe("ph");
    expect(chooseVoice("en", voices)?.voiceId).toBe("en-us-x-sfg");
  });
  it("never reads Cebuano with an English voice: no Filipino voice means text only", () => {
    expect(
      chooseVoice(
        "ceb",
        voices.filter((v) => !v.language.startsWith("fil")),
      ),
    ).toBeNull();
    expect(chooseVoice("fil", [])).toBeNull();
  });
});

describe("the copy kept on this phone (security review: a statement is read back only by whom it belongs to)", () => {
  /** A member link as fs-api signs it (`body.sig`); the phone cannot check the signature. */
  const link = (lineId: string, exp: string, sigByte: number) =>
    `${Buffer.from(JSON.stringify({ exp, lineId })).toString("base64url")}.${Buffer.alloc(64, sigByte).toString("base64url")}`;
  const LINE = "line_2026A_r37_M-014";

  it("statement.cache-own: a member's copy is kept under who she is (workspace and persona), none without a pairing", () => {
    expect(statementCacheKey({ identity: "a1b2c3d4e5f60718", linkToken: null })).toBe(
      "fs.statement.v2.member.a1b2c3d4e5f60718",
    );
    expect(statementCacheKey({ identity: null, linkToken: null })).toBeNull();
  });

  it("statement.cache-link: a link's copy is kept under the link itself, never under the line it claims", () => {
    const real = link(LINE, "2026-11-29T00:00:00Z", 7);
    const forged = link(LINE, "2099-01-01T00:00:00Z", 9); // the same line, a token fs-api never signed
    const k = statementCacheKey({ identity: null, linkToken: real });
    expect(k).toMatch(/^fs\.statement\.v2\.link\.[0-9a-f]{32}$/);
    expect(statementCacheKey({ identity: "a1b2c3d4e5f60718", linkToken: real })).toBe(k); // any phone, same link
    expect(statementCacheKey({ identity: null, linkToken: forged })).not.toBe(k);
    expect(k).not.toContain(LINE);
  });

  it("statement.cache-fallback: the kept copy shows only while the server is unreachable or struggling", () => {
    expect(readFailureOf({ code: "NETWORK" })).toBe("offline"); // no answer at all
    expect(readFailureOf({ code: "INTERNAL", status: 500 })).toBe("offline");
    expect(readFailureOf({ code: "NETWORK", status: 503 })).toBe("offline");
    expect(readFailureOf({ code: "RATE_LIMITED", status: 429 })).toBe("offline");
    expect(readFailureOf({ code: "NETWORK", status: 408 })).toBe("offline");
    // The credential itself was refused: an expired, revoked or forged link, a pairing the co-op no longer knows.
    for (const [code, status] of [
      ["UNAUTHENTICATED", 401],
      ["FRAME_TOKEN_EXPIRED", 401],
      ["FORBIDDEN", 403],
      ["NETWORK", 403],
      ["NOT_FOUND", 404],
      ["PAIRING_TOKEN_INVALID", 410],
      ["SIGNATURE_INVALID", 422],
    ] as const) {
      expect(readFailureOf({ code, status })).toBe("refused");
    }
    expect(readFailureOf({ code: "VALIDATION_FAILED", status: 400 })).toBe("failed");
  });

  it("statement.cache-legacy: names the copies an earlier build kept under a persona or a claimed line", () => {
    expect(legacyStatementCacheKeys({ persona: "member:M-014", linkLineId: null })).toEqual([
      "fs.statement.cache.member:M-014",
      "fs.statement.cache.member",
    ]);
    expect(legacyStatementCacheKeys({ persona: null, linkLineId: LINE })).toEqual([
      `fs.statement.link.${LINE}`,
      "fs.statement.link.unknown",
    ]);
    // None of them is ever a key the phone keeps a copy under now.
    const now = statementCacheKey({ identity: "a1b2c3d4e5f60718", linkToken: null });
    expect(legacyStatementCacheKeys({ persona: "member:M-014", linkLineId: LINE })).not.toContain(now);
  });
});

describe("the clips fs-api serves (GET /v1/media/audio/:lineId, IC-11, ADR-0011)", () => {
  const ORIGIN = "https://fs.test";
  /** A live statement: fs-api's line IDs are UUIDs (the demo's are labelled slugs). */
  const live = { ...dto, lineId: "0190f3c2-6c1e-7c3a-8d2b-1a2b3c4d5e6f" };
  /** The route's answer for the hero line in `lang`, as the contract parses it: `clips` picks which sentences have one. */
  const served = (
    lang: "ceb" | "fil" | "en",
    clips: (slot: string, i: number) => Partial<StatementAudioClip> | null,
  ) => {
    const sentences = statementSentences(dto, lang).sentences.map((s, i) => {
      const slot = s.slot ?? "unknown";
      const over = clips(slot, i);
      // fs-api's hash of fs-api's words: never the phone's own (ADR-0011 §6)
      const words = sha256Hex(`fs-api's ${lang} ${slot}`);
      return {
        slot,
        variant: slot === "PAY" ? "paypal" : "default",
        mentions: slot === "DEDUCTION" ? ["rule:R1"] : s.mentions,
        textSha256: words,
        clip:
          over === null
            ? null
            : {
                url: `/media/audio/M-014/${lang}/${slot}.m4a`,
                textSha256: words,
                label: "Sintetikong tingog (Gemini TTS)",
                slot: s.slot,
                offsets: [],
                durationMs: 4_634,
                ...over,
              },
      };
    });
    const some = sentences.some((s) => s.clip);
    return StatementAudio.parse({
      lineId: live.lineId,
      memberNo: dto.member.memberNo,
      lang,
      source: sentences.every((s) => s.clip) ? "gemini" : some ? "mixed" : "device",
      label: some ? "Sintetikong tingog (Gemini TTS)" : "Tingog sa telepono",
      deviceLabel: "Tingog sa telepono",
      sentences,
    });
  };

  it("plays the served greeting clip from fs-api's origin and reads the rest with the phone's voice", () => {
    const answer = served("ceb", (slot) => (slot === "GREETING" ? {} : null));
    const plan = audioPlan(withServedAudio(live, answer, ORIGIN), "ceb", { deviceVoice: true });
    expect(plan.mode).toBe("mixed");
    expect(plan.steps[0]?.voice).toEqual({
      kind: "clip",
      url: `${ORIGIN}/media/audio/M-014/ceb/GREETING.m4a`,
      lang: "ceb",
      label: "Sintetikong tingog (Gemini TTS)",
      durationMs: 4_634,
    });
    expect(plan.steps.slice(1).every((s) => s.voice.kind === "device")).toBe(true);
  });

  it("plays every sentence when every one has a clip, with the served mention offsets", () => {
    const answer = served("en", (slot) =>
      slot === "SOURCES" ? { offsets: [{ ref: "slip:0403", atMs: 1_500 }] } : {},
    );
    const plan = audioPlan(withServedAudio(live, answer), "en", { deviceVoice: true });
    expect(plan.mode).toBe("synthetic");
    expect(plan.steps[0]?.voice).toMatchObject({ kind: "clip", url: "/media/audio/M-014/en/GREETING.m4a" });
    expect(plan.steps.find((s) => s.slot === "SOURCES")?.cues[0]).toMatchObject({
      ref: "slip:0403",
      offsetMs: 1_500,
    });
  });

  it("checks again: a served clip whose hash is not fs-api's for its sentence falls back to the phone's voice", () => {
    const answer = served("ceb", (slot) =>
      slot === "GREETING" ? { textSha256: sha256Hex("other words") } : null,
    );
    expect(audioPlan(withServedAudio(live, answer, ORIGIN), "ceb", { deviceVoice: true }).mode).toBe(
      "device-voice",
    );
  });

  it("drops a served clip whose URL is not a same-origin IC-11 clip of this member and language", () => {
    const answer = served("ceb", (slot) => (slot === "GREETING" ? {} : null));
    // the app imports the contract's types only, so a malformed answer reaches it unparsed
    const tampered = (url: string) => ({
      ...answer,
      sentences: answer.sentences.map((s, i) => (i === 0 && s.clip ? { ...s, clip: { ...s.clip, url } } : s)),
    });
    for (const url of [
      "https://evil.example/a.m4a",
      "//evil.example/media/audio/M-014/ceb/GREETING.m4a",
      "/media/../../etc/x.m4a",
      "/media/audio/M-014/ceb/../../M-007/ceb/GREETING.m4a",
      "/media/audio/drafts/M-014/ceb/s1.m4a",
      "/media/audio/M-014/ceb/GREETING.m4a?x=1",
      "/media/audio/M-014/ceb/GREETING.M4A",
      "/media/audio/M-014/ceb/a\\b.m4a",
      // another member's or another language's folder
      "/media/audio/M-007/ceb/GREETING.m4a",
      "/media/audio/M-014/fil/GREETING.m4a",
    ]) {
      for (const origin of ["", ORIGIN]) {
        const d = withServedAudio(live, tampered(url), origin);
        expect(d.audio.ceb?.[0]?.clip, url).toBeNull();
        expect(audioPlan(d, "ceb", { deviceVoice: true }).steps[0]?.voice, url).toEqual({ kind: "device" });
      }
    }
    // a clip under the contract's pattern still plays
    const ok = withServedAudio(
      live,
      tampered("/media/audio/M-014/ceb/s01-GREETING-596b9e42811d.m4a"),
      ORIGIN,
    );
    expect(audioPlan(ok, "ceb", { deviceVoice: true }).steps[0]?.voice).toMatchObject({
      kind: "clip",
      url: `${ORIGIN}/media/audio/M-014/ceb/s01-GREETING-596b9e42811d.m4a`,
    });
  });

  it("keeps the statement as it is for another line's answer, and keeps the other languages' clips", () => {
    const answer = served("ceb", () => ({}));
    expect(withServedAudio(live, { ...answer, lineId: "0190f3c2-6c1e-7c3a-8d2b-000000000000" })).toBe(live);
    const fil = served("fil", () => ({}));
    const both = withServedAudio(withServedAudio(live, answer), fil);
    expect(both.audio.ceb?.length).toBe(answer.sentences.length);
    expect(both.audio.fil?.length).toBe(fil.sentences.length);
    const none = withServedAudio(
      live,
      served("en", () => null),
    );
    expect(none.audio.en?.every((s) => s.clip === null)).toBe(true);
    expect(audioPlan(none, "en", { deviceVoice: true }).mode).toBe("device-voice");
  });
});
