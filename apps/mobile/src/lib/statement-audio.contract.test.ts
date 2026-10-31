// IC-11 across the wire (ADR-0011 §6), the app's half. fs-api's answer to GET /v1/media/audio/:lineId for the hero
// line M-014, rendered by fs-api's own statement renderer and resolved against a fixture manifest with a clip of
// every sentence, is apps/api/src/routes/media/ic11-m014.golden.json (fs-api's ic11-golden.test.ts and its route
// test keep it equal to what fs-api serves). Here it goes through `withServedAudio` and `audioPlan` as a live answer
// would, against the app's own M-014 statement: every sentence the phone shows in the form fs-api spoke plays the
// clip fs-api served for it, and a sentence in another form (the cash PAY, the product AI note under fs-api's seeded
// one) gets the phone's voice, never the other form's clip.
//
// The phone's renderer does not write fs-api's words ("resibo 0 4 0 3" where fs-api says "resibo zero four zero
// three"), so a phone that hashed its own sentences would throw these clips away. It pairs sentences instead.
import { readFileSync } from "node:fs";
import { StatementAudio } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../_shims/domain";
import { buildDemoStatement } from "../services/demo-fixtures";
import { audioPlan, statementSentences, withServedAudio } from "./statement";

const GOLDEN = new URL("../../../api/src/routes/media/ic11-m014.golden.json", import.meta.url);
const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, unknown>;
const LANGS = ["ceb", "fil", "en"] as const;
const ORIGIN = "https://fs.test";
/** The app's own statement of the hero line, as a paid PayPal line. */
const hero = buildDemoStatement({ stage: "paid", now: "2026-10-30T09:12:00+08:00" });
const served = (lang: (typeof LANGS)[number]) => StatementAudio.parse(golden[lang]);
/**
 * The form of each slot the app's hero statement shows (its templates' `{slot}.{variant}`): the PayPal PAY and the
 * default form of the rest, the product AI note among them. fs-api speaks T1's seeded AI note for this seeded line
 * once T1 has merged; the app shows the seeded note only when its templates name it.
 */
const phoneForm = (slot: string) => (slot === "PAY" ? "paypal" : "default");

describe("IC-11: the clips fs-api serves for M-014 play on the phone (ADR-0011 §6)", () => {
  it.each(LANGS)(
    "%s: every sentence in fs-api's form plays the clip fs-api served for it, with its mention offsets",
    (lang) => {
      const answer = served(lang);
      expect(answer.memberNo).toBe(hero.member.memberNo);
      // fs-api and the phone agree on the form of every slot but, at most, the AI note (product or seeded)
      for (const s of answer.sentences) {
        if (s.slot === "AI_NOTE") expect(["default", "seeded"]).toContain(s.variant);
        else expect(s.variant, `${lang} ${s.slot}`).toBe(phoneForm(s.slot));
      }
      const live = { ...hero, lineId: answer.lineId };
      const plan = audioPlan(withServedAudio(live, answer, ORIGIN), lang, { deviceVoice: true });
      expect(plan.steps.map((s) => s.slot)).toEqual(answer.sentences.map((s) => s.slot));
      plan.steps.forEach((step, i) => {
        const sentence = answer.sentences[i];
        const clip = sentence?.clip;
        expect(step.voice, `${lang} ${step.slot}`).toEqual(
          sentence?.variant === phoneForm(sentence?.slot ?? "")
            ? {
                kind: "clip",
                url: `${ORIGIN}${clip?.url}`,
                lang,
                label: clip?.label,
                durationMs: clip?.durationMs,
              }
            : { kind: "device" },
        );
      });
      const clipped = plan.steps.filter((s) => s.voice.kind === "clip").length;
      expect(clipped).toBeGreaterThanOrEqual(plan.steps.length - 1);
      expect(plan.mode).toBe(clipped === plan.steps.length ? "synthetic" : "mixed");
      const sources = answer.sentences.find((s) => s.slot === "SOURCES")?.clip;
      expect(sources?.offsets.length).toBeGreaterThan(0);
      expect(plan.steps.find((s) => s.slot === "SOURCES")?.cues.map((c) => [c.ref, c.offsetMs])).toEqual(
        sources?.offsets.map((o) => [o.ref, o.atMs]),
      );
    },
  );

  it.each(LANGS)(
    "%s: once the line moves to the bodega, fs-api's PayPal PAY clip is never played for the cash sentence",
    (lang) => {
      const answer = served(lang);
      const live = withServedAudio({ ...hero, lineId: answer.lineId }, answer, ORIGIN);
      const paypal = audioPlan(live, lang, { deviceVoice: true });
      const cash = audioPlan(live, lang, { deviceVoice: true, rail: "cash" });
      const pay = cash.steps.find((s) => s.slot === "PAY");
      expect(pay?.id).toBe("pay-cash");
      expect(pay?.voice).toEqual({ kind: "device" });
      expect(cash.mode).toBe("mixed");
      // every other sentence keeps its clip
      expect(cash.steps.filter((s) => s.slot !== "PAY").map((s) => s.voice)).toEqual(
        paypal.steps.filter((s) => s.slot !== "PAY").map((s) => s.voice),
      );
    },
  );

  it("has teeth: fs-api's words are not the phone's, so a phone hashing its own sentences would drop clips", () => {
    for (const lang of LANGS) {
      const own = statementSentences(hero, lang).sentences;
      const answer = served(lang);
      const notThePhones = own.filter((s, i) => sha256Hex(s.spoken) !== answer.sentences[i]?.textSha256);
      expect(notThePhones.map((s) => s.slot)).toEqual(expect.arrayContaining(["DELIVERY", "SOURCES"]));
    }
  });
});
