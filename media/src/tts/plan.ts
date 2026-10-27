import type { Lang } from "./statement.js";

/**
 * How many Gemini TTS requests the audio work needs, and how many days that takes at a daily limit
 * (S10: "quota measured"). One request per member and language (register §9 Audio), each split locally
 * into sentence clips.
 *
 * - The approved plan (00-plan.md, AI system, Audio) narrows the register's "everything else": M-014 in
 *   three languages, the other PayPal members in their own language (Rhea's request carries both PAY
 *   variants), then Merlyn; everyone else gets labelled device speech. Audio days 3–4 Nov, retakes 5 Nov.
 * - The register alone (§9, order step 3 "everything else") would add one request for each of the other
 *   55 members.
 * - Film narration: ten spoken beats (plan, Demo video); S4.6 keeps Gemini finals to at most three a day
 *   on 6–8 Nov, with drafts on Kokoro.
 */

export interface PlannedRequest {
  member_no: string;
  lang: Lang;
  why: string;
}

/** Members and languages from register §2 (hero table) and the plan's audio order. */
export const APPROVED_STATEMENT_REQUESTS: readonly PlannedRequest[] = [
  { member_no: "M-014", lang: "ceb", why: "hero member, three languages" },
  { member_no: "M-014", lang: "fil", why: "hero member, three languages" },
  { member_no: "M-014", lang: "en", why: "hero member, three languages" },
  { member_no: "M-007", lang: "ceb", why: "PayPal member (H1)" },
  { member_no: "M-060", lang: "fil", why: "PayPal member (0462 by hand)" },
  { member_no: "M-018", lang: "ceb", why: "PayPal member (H3)" },
  { member_no: "M-039", lang: "en", why: "PayPal member" },
  { member_no: "M-022", lang: "ceb", why: "PayPal member (loan cap)" },
  { member_no: "M-002", lang: "ceb", why: "PayPal member, audio first" },
  { member_no: "M-031", lang: "en", why: "Rhea: one request carries both PAY variants" },
  { member_no: "M-053", lang: "ceb", why: "Merlyn, cash (H2)" },
];

/** Members in the register's 64 with no request above (64 − 9 named members). */
export const REGISTER_OTHER_MEMBERS = 55;
/** Spoken beats in the 2:50 film script (plan, Demo video). */
export const NARRATION_BEATS = 10;
/** S4.6: Gemini narration finals at most three a day, 6–8 Nov. */
export const NARRATION_FINALS_PER_DAY = 3;

/** The two statement audio days the plan allows before retakes (3–4 Nov). */
export const STATEMENT_DAYS = 2;

export function daysNeeded(requests: number, perDay: number): number {
  if (!Number.isInteger(requests) || requests < 0)
    throw new Error(`requests must be a whole number: ${requests}`);
  if (!Number.isInteger(perDay) || perDay < 1)
    throw new Error(`a daily limit must be a positive whole number: ${perDay}`);
  return Math.ceil(requests / perDay);
}

export interface DailyLimit {
  /** Requests per Pacific day for the model; null while nobody has read it in AI Studio. */
  value: number | null;
  source: string;
}

export interface RequestPlan {
  requests: {
    approvedPlanStatements: number;
    approvedPlanList: readonly PlannedRequest[];
    registerFullPlanStatements: number;
    narrationBeats: number;
  };
  schedule: string;
  /** The smallest daily limit that fits the approved statements into the two audio days. */
  minimumDailyLimitForSchedule: number;
  dailyLimit: DailyLimit;
  /** Days each part needs at the daily limit (null while the limit is unknown). */
  days: {
    approvedPlanStatements: number | null;
    registerFullPlanStatements: number | null;
    narrationAtFinalsCap: number;
  };
  /** Days at the self-imposed ledger cap, which is not a measured limit. */
  daysAtSelfImposedCap: { cap: number; approvedPlanStatements: number; registerFullPlanStatements: number };
  verdict: string;
}

export function requestPlan(dailyLimit: DailyLimit, selfImposedCap: number): RequestPlan {
  const approved = APPROVED_STATEMENT_REQUESTS.length;
  const full = approved + REGISTER_OTHER_MEMBERS;
  const known = dailyLimit.value;
  const minimum = Math.ceil(approved / STATEMENT_DAYS);
  return {
    requests: {
      approvedPlanStatements: approved,
      approvedPlanList: APPROVED_STATEMENT_REQUESTS,
      registerFullPlanStatements: full,
      narrationBeats: NARRATION_BEATS,
    },
    schedule: "Statements 3–4 Nov, retakes 5 Nov (plan); narration finals 6–8 Nov, at most 3 a day (S4.6)",
    minimumDailyLimitForSchedule: minimum,
    dailyLimit,
    days: {
      approvedPlanStatements: known === null ? null : daysNeeded(approved, known),
      registerFullPlanStatements: known === null ? null : daysNeeded(full, known),
      narrationAtFinalsCap: daysNeeded(NARRATION_BEATS, NARRATION_FINALS_PER_DAY),
    },
    daysAtSelfImposedCap: {
      cap: selfImposedCap,
      approvedPlanStatements: daysNeeded(approved, selfImposedCap),
      registerFullPlanStatements: daysNeeded(full, selfImposedCap),
    },
    verdict:
      known === null
        ? `UNKNOWN: the daily limit has not been read. The approved plan needs ${approved} statement requests, so it fits 3–4 Nov only if the free tier allows at least ${minimum} a day; otherwise fall back to labelled Filipino audio or device speech.`
        : known >= minimum
          ? `FITS: ${approved} statement requests at ${known} a day take ${daysNeeded(approved, known)} day(s) of the 2 planned.`
          : `DOES NOT FIT: ${approved} statement requests at ${known} a day take ${daysNeeded(approved, known)} days, more than the 2 planned; the user chooses labelled device speech for the rest or a paid tier (S10 fallback).`,
  };
}
