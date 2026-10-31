// IC-11 across the wire (ADR-0011 §6), fs-api's half. fs-api renders the seeded hero line M-014 with its own
// statement renderer, in every language, and resolves it against a fixture manifest that has a clip of every spoken
// sentence. That answer is kept in ic11-m014.golden.json, and the app's half
// (apps/mobile/src/lib/statement-audio.contract.test.ts) feeds the very same answer to `withServedAudio` and
// `audioPlan` and expects every sentence the phone renders in the same form to play its clip.
//
// What the two sides must agree on is which sentences there are: slot, variant (which form of the slot: PAY.paypal
// or PAY.cash, the product or the seeded AI note), mentions and reading order, and the clip served for each. This
// test fails when that drifts. The words' hashes are fs-api's own business (the phone pairs sentences, it never
// hashes words), so they are checked only for consistency; a template change that keeps the sentences needs no new
// golden, a change of variant does (T1's seeded AI note for M-014's seeded run is one). Regenerate it with
// FS_WRITE_IC11_GOLDEN=1, then format it with Biome.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Lang, type MemberLineState, StatementAudio } from "@fairsplit/contracts";
import { getLine, getMember, getRateCard, getRun, getSeason } from "@fairsplit/seed";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { type StatementLineFacts, statementPlan } from "../../statements/plan.js";
import { renderStatement } from "../../statements/render.js";
import { type ManifestEntry, resolveStatementAudio, sha256Text } from "./audio.js";

const GOLDEN = fileURLToPath(new URL("./ic11-m014.golden.json", import.meta.url));
const LANGS = ["ceb", "fil", "en"] as const;
const Golden = z.strictObject({
  about: z.string(),
  ceb: StatementAudio,
  fil: StatementAudio,
  en: StatementAudio,
});

/** M-014's statement facts straight from the seed snapshot (IC-03: no figure typed here). */
function heroFacts(lang: Lang): StatementLineFacts {
  const memberNo = "M-014";
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
  };
}

let mediaDir: string;
const answers = {} as Record<Lang, StatementAudio>;

/**
 * fs-api's answer for M-014 in `lang`, as the route builds it (index.ts): the spoken sentences of the rendered
 * statement, resolved against a published fixture manifest with a clip of each one's exact words.
 */
function heroAnswer(lang: Lang): StatementAudio {
  const plan = statementPlan(heroFacts(lang));
  const spoken = renderStatement(plan).spoken;
  const entries: ManifestEntry[] = spoken.map((s, i) => {
    const file = `audio/M-014/${lang}/${String(i).padStart(2, "0")}-${s.slot}.m4a`;
    mkdirSync(path.dirname(path.join(mediaDir, file)), { recursive: true });
    writeFileSync(path.join(mediaDir, ...file.split("/")), Buffer.alloc(32));
    return {
      member_no: "M-014",
      lang,
      slot: s.slot,
      file,
      duration_ms: 6_000,
      text: s.text,
      text_sha256: sha256Text(s.text),
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
      memberNo: "M-014",
      lang,
      sentences: spoken.map((s, i) => ({
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

/** What both sides must agree on: everything but the words' hashes. */
function withoutWords(a: StatementAudio) {
  return {
    ...a,
    sentences: a.sentences.map(({ textSha256: _, clip, ...s }) => {
      if (!clip) return { ...s, clip };
      const { textSha256: __, ...c } = clip;
      return { ...s, clip: c };
    }),
  };
}

beforeAll(() => {
  mediaDir = mkdtempSync(path.join(tmpdir(), "fs-ic11-"));
  for (const lang of LANGS) answers[lang] = heroAnswer(lang);
  if (process.env.FS_WRITE_IC11_GOLDEN === "1") {
    const about =
      "IC-11 (ADR-0011): fs-api's GET /v1/media/audio/:lineId answer for the seeded hero line M-014, rendered by " +
      "fs-api's statement renderer and resolved against a fixture manifest with a clip of every sentence. Written " +
      "by apps/api/src/routes/media/ic11-golden.test.ts; read by apps/mobile/src/lib/statement-audio.contract.test.ts.";
    writeFileSync(GOLDEN, `${JSON.stringify({ about, ...answers }, null, 2)}\n`);
  }
});
afterAll(() => rmSync(mediaDir, { recursive: true, force: true }));

describe("IC-11 golden: fs-api's answer for M-014, as the app receives it (ADR-0011 §6)", () => {
  const golden = () => Golden.parse(JSON.parse(readFileSync(GOLDEN, "utf8")));

  it("fs-api speaks the golden's sentences, in its order, and serves each its clip, in every language", () => {
    const g = golden();
    for (const lang of LANGS) {
      const a = answers[lang];
      expect(a.source, lang).toBe("gemini");
      expect(a.sentences.every((s) => s.clip !== null)).toBe(true);
      expect(
        withoutWords(a),
        `fs-api's M-014 ${lang} sentences drifted from ic11-m014.golden.json; if that is intended, ` +
          "rerun with FS_WRITE_IC11_GOLDEN=1 and check the app's half (statement-audio.contract.test.ts)",
      ).toEqual(withoutWords(g[lang]));
    }
  });

  it("the golden names each sentence's form as fs-api rendered it: M-014 is paid by PayPal", () => {
    for (const lang of LANGS) {
      const spoken = renderStatement(statementPlan(heroFacts(lang))).spoken;
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
      const spoken = renderStatement(statementPlan(heroFacts(lang))).spoken;
      expect(answers[lang].sentences.map((s) => s.textSha256)).toEqual(spoken.map((s) => sha256Text(s.text)));
    }
  });
});
