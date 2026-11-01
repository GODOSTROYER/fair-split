// IC-11 across the wire (ADR-0011 §6), fs-api's half. fs-api renders seeded lines with its own statement renderer
// and resolves them against a fixture manifest that has a clip of every spoken sentence, made the way the manifest
// producer makes them (AU2's export: `spokenScript`, the text and its `textSha256`). Those answers are kept as goldens
// the app's half (apps/mobile/src/lib/statement-audio.contract.test.ts) feeds to `withServedAudio` and `audioPlan`:
// - ic11-m014.golden.json: the hero line M-014, paid by PayPal, in every language;
// - ic11-cash.golden.json: the two planned cash lines, Rhea (M-031, en) and Merlyn (M-053, ceb), while their cash is
//   due (no receipt: fs-api speaks PAY.cash_nodate) and once the clerk recorded it received (PAY.cash, dated).
//
// What the two sides must agree on is which sentences there are: slot, variant (which form of the slot: PAY.paypal,
// PAY.cash_nodate or PAY.cash, the product or the seeded AI note), mentions and reading order, and the clip served for
// each. This test fails when that drifts. The words' hashes are fs-api's own business (the phone pairs sentences, it
// never hashes words), so they are checked only for consistency; a template change that keeps the sentences needs no
// new golden, a change of variant does. Regenerate both with FS_WRITE_IC11_GOLDEN=1, then format them with Biome.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIO_CLIP_URL_RE, type Lang, MemberLineState, StatementAudio } from "@fairsplit/contracts";
import { format } from "@fairsplit/domain";
import { getLine, getMember, getRateCard, getRun, getSeason } from "@fairsplit/seed";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { type StatementLineFacts, statementPlan } from "../../statements/plan.js";
import { renderStatement, type SpokenSentence, spokenScript } from "../../statements/render.js";
import { STATEMENT_SLOTS } from "../../statements/types.js";
import * as resolver from "./audio.js";
import { AUDIO_CLIP_FILE_RE, type ManifestEntry, resolveStatementAudio } from "./audio.js";

const GOLDEN = fileURLToPath(new URL("./ic11-m014.golden.json", import.meta.url));
const CASH_GOLDEN = fileURLToPath(new URL("./ic11-cash.golden.json", import.meta.url));
const LANGS = ["ceb", "fil", "en"] as const;
const Golden = z.strictObject({
  about: z.string(),
  ceb: StatementAudio,
  fil: StatementAudio,
  en: StatementAudio,
});
/** One cash line in one state: the facts fs-api rendered it from that the phone also holds, and fs-api's answer. */
const CashCase = z.strictObject({
  case: z.string(),
  memberNo: z.string(),
  lang: z.enum(LANGS),
  state: MemberLineState,
  /** The cash receipt's day (fs-api's `cashDay`, the clerk's "Nadawat"), or null while the cash is due. */
  cashDay: z.iso.date().nullable(),
  answer: StatementAudio,
});
type CashCase = z.infer<typeof CashCase>;
const CashGolden = z.strictObject({ about: z.string(), cases: z.array(CashCase) });

/** A seeded line's statement facts straight from the seed snapshot (IC-03: no figure typed here). */
function lineFacts(memberNo: string, lang: Lang, over: Partial<StatementLineFacts> = {}): StatementLineFacts {
  const line = getLine(memberNo);
  const member = getMember(memberNo);
  if (!line || !member) throw new Error(`no seed line ${memberNo}`);
  const card = getRateCard();
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
    fx: getRun().fx.centavosPerCent,
    cashDay: null,
    itemStatus: getRun().items.find((i) => i.memberNo === memberNo)?.status ?? null,
    ...over,
  };
}

/** The planned cash lines (AU2's requests): Rhea, PayPal parked then moved to cash, and Merlyn, cash from the start. */
const CASH_LINES = [
  { memberNo: "M-031", lang: "en" },
  { memberNo: "M-053", lang: "ceb" },
] as const;
/** The day the clerk records the cash handed over (the run's cash day, as the showcase world attests it). */
const RECEIPT_DAY = getRun().cashDay;
/** Each cash line while its cash is due (the seed's state, no receipt) and once it is received (a receipt, dated). */
const cashFacts = (memberNo: string, lang: Lang, received: boolean) =>
  lineFacts(memberNo, lang, received ? { state: "OFF_RAIL_PAID", cashDay: RECEIPT_DAY } : {});

/**
 * A clip's file as ADR-0011 §4 names it, which main's media assembly serves (`audio/M-???/{lang}/s*.m4a`):
 * `s{NN}-{SLOT}-{hash12}.m4a`, NN the slot's place in the statement (GREETING 01 … AI_NOTE 10).
 */
function clipFile(memberNo: string, lang: Lang, s: Pick<SpokenSentence, "slot" | "textSha256">): string {
  const nn = String(STATEMENT_SLOTS.indexOf(s.slot) + 1).padStart(2, "0");
  return `audio/${memberNo}/${lang}/s${nn}-${s.slot}-${s.textSha256.slice(0, 12)}.m4a`;
}

let mediaDir: string;
const answers = {} as Record<Lang, StatementAudio>;
let cases: CashCase[] = [];

/**
 * fs-api's answer for one line, as the route builds it (index.ts): the spoken sentences of the rendered statement,
 * resolved against a published fixture manifest whose entries the producer made from `spokenScript` (the exact text
 * and its `textSha256`), one clip of each sentence.
 */
function answerFor(facts: StatementLineFacts): StatementAudio {
  const { memberNo, lang } = facts;
  const plan = statementPlan(facts);
  const script = spokenScript(plan);
  const entries: ManifestEntry[] = script.map((s) => {
    const file = clipFile(memberNo, lang, s);
    mkdirSync(path.dirname(path.join(mediaDir, file)), { recursive: true });
    writeFileSync(path.join(mediaDir, ...file.split("/")), Buffer.alloc(32));
    return {
      member_no: memberNo,
      lang,
      slot: s.slot,
      file,
      duration_ms: 6_000,
      text: s.text,
      text_sha256: s.textSha256,
      synthetic: true,
      draft: false,
      model: "gemini-3.8-flash-tts",
      voice: "Sulafat",
      created_at: "2026-11-03T03:30:00.000Z",
      offsets:
        s.slot === "SOURCES"
          ? s.mentions.map((ref, k) => ({ ref, at_ms: 1_500 + 600 * k }))
          : s.slot === "GREETING"
            ? [{ ref: "fact:HONORIFIC_NAME", at_ms: 700 }]
            : [],
    };
  });
  return StatementAudio.parse(
    resolveStatementAudio({
      lineId: plan.lineId,
      memberNo,
      lang,
      sentences: script.map((s, i) => ({
        slot: s.slot,
        variant: s.variant,
        text: s.text,
        mentions: s.mentions,
        placeholders: Object.keys(plan.sentences[i]?.facts ?? {}),
      })),
      entries,
      mediaDir,
    }),
  );
}

/** A clip URL with the part its words name (`hash12`) masked. */
const unworded = (url: string) => url.replace(/-[0-9a-f]{12}(-t\d+)?\.m4a$/, "-{hash12}$1.m4a");

/** What both sides must agree on: everything but the words' hashes (and the part of a clip's name they give). */
function withoutWords(a: StatementAudio) {
  return {
    ...a,
    sentences: a.sentences.map(({ textSha256: _, clip, ...s }) => {
      if (!clip) return { ...s, clip };
      const { textSha256: __, ...c } = clip;
      return { ...s, clip: { ...c, url: unworded(c.url) } };
    }),
  };
}

beforeAll(() => {
  mediaDir = mkdtempSync(path.join(tmpdir(), "fs-ic11-"));
  for (const lang of LANGS) answers[lang] = answerFor(lineFacts("M-014", lang));
  cases = CASH_LINES.flatMap(({ memberNo, lang }) =>
    [false, true].map((received) => {
      const facts = cashFacts(memberNo, lang, received);
      return {
        case: `${memberNo} ${lang}, cash ${received ? "received (a receipt, dated)" : "due (no receipt yet)"}`,
        memberNo,
        lang,
        state: facts.state,
        cashDay: facts.cashDay,
        answer: answerFor(facts),
      };
    }),
  );
  if (process.env.FS_WRITE_IC11_GOLDEN === "1") {
    const about =
      "IC-11 (ADR-0011): fs-api's GET /v1/media/audio/:lineId answer for the seeded hero line M-014, rendered by " +
      "fs-api's statement renderer and resolved against a fixture manifest with a clip of every sentence. Written " +
      "by apps/api/src/routes/media/ic11-golden.test.ts; read by apps/mobile/src/lib/statement-audio.contract.test.ts.";
    writeFileSync(GOLDEN, `${JSON.stringify({ about, ...answers }, null, 2)}\n`);
    const cashAbout =
      "IC-11 (ADR-0011): fs-api's GET /v1/media/audio/:lineId answers for the planned cash lines M-031 (en) and " +
      "M-053 (ceb), while the cash is due (PAY.cash_nodate) and once a receipt is recorded (PAY.cash, dated), " +
      "rendered by fs-api's statement renderer and resolved against a fixture manifest with a clip of every " +
      "sentence. lineId is the member's seed UUID, not a demo line id. Written by " +
      "apps/api/src/routes/media/ic11-golden.test.ts; read by apps/mobile/src/lib/statement-audio.contract.test.ts.";
    writeFileSync(CASH_GOLDEN, `${JSON.stringify({ about: cashAbout, cases }, null, 2)}\n`);
  }
});
afterAll(() => rmSync(mediaDir, { recursive: true, force: true }));

const drifted = (what: string) =>
  `fs-api's ${what} drifted from its IC-11 golden; if that is intended, rerun with FS_WRITE_IC11_GOLDEN=1 and ` +
  "check the app's half (statement-audio.contract.test.ts)";

describe("IC-11 golden: fs-api's answer for M-014, as the app receives it (ADR-0011 §6)", () => {
  const golden = () => Golden.parse(JSON.parse(readFileSync(GOLDEN, "utf8")));

  it("fs-api speaks the golden's sentences, in its order, and serves each its clip, in every language", () => {
    const g = golden();
    for (const lang of LANGS) {
      const a = answers[lang];
      expect(a.source, lang).toBe("gemini");
      expect(a.sentences.every((s) => s.clip !== null)).toBe(true);
      expect(withoutWords(a), drifted(`M-014 ${lang} sentences`)).toEqual(withoutWords(g[lang]));
    }
  });

  it("the golden names each sentence's form as fs-api rendered it: M-014 is paid by PayPal", () => {
    for (const lang of LANGS) {
      const spoken = renderStatement(statementPlan(lineFacts("M-014", lang))).spoken;
      const g = golden()[lang];
      expect(g.sentences.map((s) => s.variant)).toEqual(spoken.map((s) => s.variant));
      expect(g.sentences.find((s) => s.slot === "PAY")?.variant, lang).toBe("paypal");
    }
  });

  it("the golden names M-014's deduction by its rule and its slips by serial, as fs-api's plan does", () => {
    const en = golden().en;
    const line = getLine("M-014");
    expect(en.sentences.map((s) => s.slot)).toEqual([
      "GREETING",
      "DELIVERY",
      "PREMIUM",
      "BONUS",
      ...(line?.deductions ?? []).map(() => "DEDUCTION"),
      "PAY",
      "SOURCES",
      "HELP",
      "AI_NOTE",
    ]);
    expect(en.sentences.filter((s) => s.slot === "DEDUCTION").map((s) => s.mentions)).toEqual(
      (line?.deductions ?? []).map((d) => [`rule:${d.ruleId}`]),
    );
    expect(en.sentences.find((s) => s.slot === "SOURCES")?.mentions).toEqual(
      (line?.slipSerials ?? []).map((x) => `slip:${x}`),
    );
  });

  it("each golden clip carries the hash of the very sentence it was served for, and fs-api's hashes are its own", () => {
    const g = golden();
    for (const lang of LANGS) {
      for (const s of g[lang].sentences) expect(s.clip?.textSha256, `${lang} ${s.slot}`).toBe(s.textSha256);
      expect(new Set(g[lang].sentences.map((s) => s.textSha256)).size).toBe(g[lang].sentences.length);
      // the route hashes fs-api's words: the answer's hashes are those of the sentences it rendered
      const script = spokenScript(statementPlan(lineFacts("M-014", lang)));
      expect(answers[lang].sentences.map((s) => s.textSha256)).toEqual(script.map((s) => s.textSha256));
    }
  });
});

describe("IC-11 golden: fs-api's cash lines while the cash is due and once it is received (ADR-0011 §6)", () => {
  const golden = () => CashGolden.parse(JSON.parse(readFileSync(CASH_GOLDEN, "utf8")));
  const pay = (a: StatementAudio) => a.sentences.find((s) => s.slot === "PAY");

  it("fs-api speaks the golden's sentences for M-031 and M-053, due and received, and serves each its clip", () => {
    const g = golden();
    expect(g.cases.map((c) => [c.memberNo, c.lang, c.state, c.cashDay])).toEqual(
      cases.map((c) => [c.memberNo, c.lang, c.state, c.cashDay]),
    );
    for (const [i, c] of cases.entries()) {
      expect(c.answer.source, c.case).toBe("gemini");
      expect(withoutWords(c.answer), drifted(c.case)).toEqual(withoutWords(g.cases[i]?.answer ?? c.answer));
    }
  });

  it("speaks PAY.cash_nodate until a receipt exists, and PAY.cash, naming the receipt's day, once it does", () => {
    for (const { memberNo, lang } of CASH_LINES) {
      // the seed leaves both lines' cash due at the bodega, with no receipt
      expect(getRun().lineStates[memberNo], memberNo).toBe("OFF_RAIL_DUE");
      const due = renderStatement(statementPlan(cashFacts(memberNo, lang, false)));
      const received = renderStatement(statementPlan(cashFacts(memberNo, lang, true)));
      expect(due.spoken.find((s) => s.slot === "PAY")?.variant, memberNo).toBe("cash_nodate");
      expect(received.spoken.find((s) => s.slot === "PAY")?.variant, memberNo).toBe("cash");
      expect(received.display.find((s) => s.slot === "PAY")?.text).toContain(format.date(RECEIPT_DAY, lang));
    }
    for (const c of golden().cases)
      expect(pay(c.answer)?.variant, c.case).toBe(c.cashDay ? "cash" : "cash_nodate");
  });

  it("the cash lines' other sentences are those of any paid line: one deduction by rule, the slips by serial", () => {
    for (const c of golden().cases) {
      const line = getLine(c.memberNo);
      expect(c.answer.sentences.filter((s) => s.slot === "DEDUCTION").map((s) => s.mentions)).toEqual(
        (line?.deductions ?? []).map((d) => [`rule:${d.ruleId}`]),
      );
      expect(c.answer.sentences.find((s) => s.slot === "SOURCES")?.mentions).toEqual(
        (line?.slipSerials ?? []).map((x) => `slip:${x}`),
      );
      // the golden's line is the member's seed UUID; a demo DTO keyed otherwise must take this lineId (K1d)
      expect(c.answer.lineId).toBe(getMember(c.memberNo)?.id);
    }
  });
});

describe("one hash, and clip names main's media assembly serves (ADR-0011 §3, §4)", () => {
  it("the route names fs-api's words with spokenTextSha256, the very hash the manifest producer writes", () => {
    // there is one helper (T1's spokenTextSha256, which spokenScript uses); the route keeps no hash of its own
    expect(Object.keys(resolver)).not.toContain("sha256Text");
    for (const c of [
      ...LANGS.map((l) => lineFacts("M-014", l)),
      ...cases.map((x) => cashFacts(x.memberNo, x.lang, !!x.cashDay)),
    ]) {
      const script = spokenScript(statementPlan(c));
      const a = answerFor(c);
      // an entry written from the producer's text and text_sha256 is served, under the route's own hash
      expect(a.sentences.map((s) => s.textSha256)).toEqual(script.map((s) => s.textSha256));
      expect(a.sentences.map((s) => s.clip?.textSha256)).toEqual(script.map((s) => s.textSha256));
    }
  });

  it("names each clip s{NN}-{SLOT}-{hash12}.m4a under audio/{member}/{lang}/: the route, the contract and main's allowlist accept it", () => {
    // main's tools/assemble-media.ts MEDIA_ALLOWLIST serves audio/M-???/{ceb,fil,en}/s*.m4a
    const mainAllowlist = /^audio\/M-[^/]{3}\/(?:ceb|fil|en)\/s[^/]*\.m4a$/;
    for (const a of [...LANGS.map((l) => answers[l]), ...cases.map((c) => c.answer)]) {
      const files = a.sentences.map((s) => (s.clip?.url ?? "").replace(/^\/media\//, ""));
      for (const f of files) {
        expect(AUDIO_CLIP_FILE_RE.test(f), f).toBe(true);
        expect(mainAllowlist.test(f), f).toBe(true);
        expect(AUDIO_CLIP_URL_RE.test(`/media/${f}`), f).toBe(true);
      }
      // one file per sentence of a statement (the same words of one member share theirs)
      expect(new Set(files).size, `${a.memberNo} ${a.lang}`).toBe(files.length);
    }
    // a retake gets a new name: the same stem with a take suffix
    expect(AUDIO_CLIP_FILE_RE.test("audio/M-031/en/s07-PAY-0a1b2c3d4e5f-t2.m4a")).toBe(true);
    expect(mainAllowlist.test("audio/M-031/en/s07-PAY-0a1b2c3d4e5f-t2.m4a")).toBe(true);
  });
});
