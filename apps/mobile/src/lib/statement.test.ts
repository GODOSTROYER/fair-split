import { describe, expect, it } from "vitest";
import { sha256Hex } from "../_shims/domain";
import { buildDemoStatement } from "../services/demo-fixtures";
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
  lineApproved,
  MONEY_SLOTS,
  mergeTrack,
  sentenceFor,
  spokenSerial,
  statementSentences,
  statementValues,
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
  const clip = (lang: "ceb" | "fil" | "en", spoken: string, i: number, extra: object = {}) => ({
    url: `https://media.invalid/${lang}/${i}.m4a`,
    textSha256: sha256Hex(spoken),
    label: "Sintetikong tingog (Gemini TTS)",
    durationMs: 4000,
    ...extra,
  });
  const withClips = (langs: ("ceb" | "fil" | "en")[], mutate?: (spoken: string, i: number) => string) => {
    const audio: Record<string, ReturnType<typeof clip>[]> = {};
    for (const l of langs) {
      audio[l] = statementSentences(dto, l).sentences.map((s, i) =>
        clip(l, mutate ? mutate(s.spoken, i) : s.spoken, i),
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
      withClips(["ceb"], (spoken, i) => (i === 2 ? `${spoken} ` : spoken)),
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
        en: statementSentences(dto, "en").sentences.map((s, i) =>
          clip("en", s.spoken, i, { mentions: [{ ref: "slip:0403", offsetMs: 1234 }] }),
        ),
      },
    };
    const exact = audioPlan(manifest, "en", { deviceVoice: true }).steps.find((s) => s.slot === "SOURCES");
    expect(exact?.cues[0]?.offsetMs).toBe(1234);
  });

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
