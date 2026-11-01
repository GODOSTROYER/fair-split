// IC-11 across the wire (ADR-0011 §6), the app's half. fs-api's answer to GET /v1/media/audio/:lineId for the hero
// line M-014, rendered by fs-api's own statement renderer and resolved against a fixture manifest with a clip of
// every sentence, is apps/api/src/routes/media/ic11-m014.golden.json (fs-api's ic11-golden.test.ts and its route
// test keep it equal to what fs-api serves). Here it goes through `withServedAudio` and `audioPlan` as a live answer
// would, against the app's own M-014 statement: every sentence the phone shows in the form fs-api spoke plays the
// clip fs-api served for it, and a sentence in another form (such as a cash PAY) gets the phone's voice, never the
// other form's clip.
//
// The phone's renderer does not write fs-api's words ("resibo 0 4 0 3" where fs-api says "resibo zero four zero
// three"), so a phone that hashed its own sentences would throw these clips away. It pairs sentences instead.
//
// The same holds for the planned cash lines, Rhea (M-031) and Merlyn (M-053), from ic11-cash.golden.json: fs-api
// speaks PAY.cash_nodate until the clerk records the cash received and the dated PAY.cash after, and the phone plays
// each clip only under its own sentence of that very form.
import { readFileSync } from "node:fs";
import { StatementAudio } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import type { StatementDTO } from "../_shims/api-client";
import type { Lang } from "../_shims/contracts";
import { format, sha256Hex } from "../_shims/domain";
import { namedMembers } from "../_shims/seed";
import { buildDemoStatement } from "../services/demo-fixtures";
import { withNoDate } from "../test/pay-forms";
import { type AudioPlan, audioPlan, statementSentences, withServedAudio } from "./statement";

const GOLDEN = new URL("../../../api/src/routes/media/ic11-m014.golden.json", import.meta.url);
const CASH_GOLDEN = new URL("../../../api/src/routes/media/ic11-cash.golden.json", import.meta.url);
const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, unknown>;
const LANGS = ["ceb", "fil", "en"] as const;
const ORIGIN = "https://fs.test";
/** The app's own statement of the hero line, as a paid PayPal line. */
const hero = buildDemoStatement({ stage: "paid", now: "2026-10-30T09:12:00+08:00" });
const served = (lang: (typeof LANGS)[number]) => StatementAudio.parse(golden[lang]);
/**
 * The form of each slot the app's hero statement shows (its templates' `{slot}.{variant}`): the PayPal PAY and the
 * seeded AI note and the default form of the rest. fs-api speaks T1's seeded AI note for this seeded line too.
 */
const phoneForm = (slot: string) => (slot === "PAY" ? "paypal" : slot === "AI_NOTE" ? "seeded" : "default");

describe("IC-11: the clips fs-api serves for M-014 play on the phone (ADR-0011 §6)", () => {
  it.each(LANGS)(
    "%s: every sentence in fs-api's form plays the clip fs-api served for it, with its mention offsets",
    (lang) => {
      const answer = served(lang);
      expect(answer.memberNo).toBe(hero.member.memberNo);
      // fs-api and the phone agree on every form, including T1's seeded AI note.
      for (const s of answer.sentences) {
        expect(s.variant, `${lang} ${s.slot}`).toBe(phoneForm(s.slot));
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
      expect(clipped).toBe(plan.steps.length);
      expect(plan.mode).toBe("synthetic");
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

interface CashCase {
  case: string;
  memberNo: string;
  lang: Lang;
  /** The receipt's day fs-api rendered from, or null while the cash is due. */
  cashDay: string | null;
}
const cashGolden = JSON.parse(readFileSync(CASH_GOLDEN, "utf8")) as {
  cases: (CashCase & { answer: unknown })[];
};
/** fs-api's answer for one cash line, due (no receipt) or received (a receipt), as the contract parses it. */
const cashAnswer = (memberNo: string, received: boolean) => {
  const c = cashGolden.cases.find((x) => x.memberNo === memberNo && (x.cashDay !== null) === received);
  if (!c) throw new Error(`no ${memberNo} case in ic11-cash.golden.json`);
  return { ...c, answer: StatementAudio.parse(c.answer) };
};

/**
 * The phone's statement of a cash line, from its own demo fixture, re-keyed to fs-api's line (the golden's line is
 * the member's seed UUID) and named for the member, with her slips; `receivedOn` is the day the clerk recorded her
 * cash received, or null while it is due. Her figures stay the demo's: pairing never reads them.
 */
function phoneLine(
  answer: StatementAudio,
  receivedOn: string | null,
  templates: "demo" | "with-no-date" = "with-no-date",
): StatementDTO {
  const base = buildDemoStatement({ stage: "cash-due", now: "2026-10-30T09:12:00+08:00" });
  const named = namedMembers.find((m) => m.memberNo === answer.memberNo);
  if (!named) throw new Error(`no named member ${answer.memberNo}`);
  const serials = (answer.sentences.find((s) => s.slot === "SOURCES")?.mentions ?? []).map((m) =>
    m.replace(/^slip:/, ""),
  );
  const dto: StatementDTO = {
    ...base,
    lineId: answer.lineId,
    member: {
      ...base.member,
      memberNo: named.memberNo,
      displayName: named.name,
      nameByLang: named.nameByLang,
    },
    rail: "CASH",
    lineState: receivedOn ? "OFF_RAIL_PAID" : "OFF_RAIL_DUE",
    slips: serials.map((serial) => ({ ...(base.slips[0] as StatementDTO["slips"][number]), serial })),
    history: [
      ...base.history,
      ...(receivedOn ? [{ kind: "received" as const, at: `${receivedOn}T09:30:00+08:00`, by: ["JS"] }] : []),
    ],
  };
  return templates === "with-no-date" ? withNoDate(dto) : dto;
}

const pay = (plan: AudioPlan) => plan.steps.find((s) => s.slot === "PAY");
/** fs-api's clip for its PAY sentence, as the phone plays it. */
const payClip = (answer: StatementAudio) => {
  const clip = answer.sentences.find((s) => s.slot === "PAY")?.clip;
  return {
    kind: "clip",
    url: `${ORIGIN}${clip?.url}`,
    lang: answer.lang,
    label: clip?.label,
    durationMs: clip?.durationMs,
  };
};
const play = (dto: StatementDTO, answer: StatementAudio) =>
  audioPlan(withServedAudio(dto, answer, ORIGIN), answer.lang, { deviceVoice: true, rail: "cash" });

describe("IC-11: the cash lines' PAY clip plays only under the PAY form fs-api spoke (ADR-0011 §6)", () => {
  it.each(["M-031", "M-053"])(
    "%s: fs-api's PAY.cash_nodate clip plays under the phone's no-date cash sentence, never under the dated one",
    (memberNo) => {
      const due = cashAnswer(memberNo, false);
      const receivedOn = cashAnswer(memberNo, true).cashDay;
      expect(due.answer.sentences.find((s) => s.slot === "PAY")?.variant).toBe("cash_nodate");
      // no receipt on the phone either: it shows the no-date form and plays fs-api's clip for it
      const plan = play(phoneLine(due.answer, null), due.answer);
      expect(plan.steps.map((s) => s.slot)).toEqual(due.answer.sentences.map((s) => s.slot));
      expect(pay(plan)).toMatchObject({ id: "pay-cash-nodate", voice: payClip(due.answer) });
      // T1's seeded AI note now matches the phone's seeded form too.
      expect(plan.steps.filter((s) => s.voice.kind !== "clip").map((s) => s.slot)).toEqual([]);
      expect(plan.mode).toBe("synthetic");
      // with a receipt on the phone (its dated sentence), the no-date clip is never played
      const dated = play(phoneLine(due.answer, receivedOn), due.answer);
      expect(pay(dated)).toMatchObject({ id: "pay-cash", voice: { kind: "device" } });
    },
  );

  it.each(["M-031", "M-053"])(
    "%s: once the receipt is recorded, fs-api's dated PAY.cash clip plays under the dated sentence, which names its day",
    (memberNo) => {
      const received = cashAnswer(memberNo, true);
      const lang = received.answer.lang;
      expect(received.answer.sentences.find((s) => s.slot === "PAY")?.variant).toBe("cash");
      const plan = play(phoneLine(received.answer, received.cashDay), received.answer);
      expect(pay(plan)).toMatchObject({ id: "pay-cash", voice: payClip(received.answer) });
      // the phone's dated sentence names the receipt's day, the very day fs-api's clip says
      const shown = statementSentences(phoneLine(received.answer, received.cashDay), lang, "cash").sentences;
      expect(shown.find((s) => s.slot === "PAY")?.display).toContain(
        format.date(received.cashDay ?? "", lang),
      );
      // a phone that has not seen the receipt shows the no-date sentence, which never plays the dated clip
      const stale = play(phoneLine(received.answer, null), received.answer);
      expect(pay(stale)).toMatchObject({ id: "pay-cash-nodate", voice: { kind: "device" } });
    },
  );

  it.each(["M-031", "M-053"])(
    "%s: with the demo's templates, which lack the no-date form, the dated stand-in gets the phone's voice",
    (memberNo) => {
      for (const received of [false, true]) {
        const { answer } = cashAnswer(memberNo, received);
        // no receipt on the phone: fs-api's form would be the no-date one, which the demo cannot show
        const plan = play(phoneLine(answer, null, "demo"), answer);
        // the dated sentence stands in, read by the phone's voice: never fs-api's no-date clip, nor its dated one
        expect(pay(plan), `received ${received}`).toMatchObject({
          id: "pay-cash",
          voice: { kind: "device" },
        });
        expect(plan.steps.filter((s) => s.voice.kind !== "clip").map((s) => s.slot)).toEqual(["PAY"]);
      }
    },
  );
});
