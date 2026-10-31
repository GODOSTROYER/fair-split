/**
 * Member statement text (M-MB-01, M-MB-03). Templates (S1.11, written or drafted offline and committed by a person)
 * hold words and `{{PLACEHOLDERS}}` only; every number is filled in here from engine values formatted by
 * `format.*`. Invariant I1 on the phone: a sentence that carries a digit, or an unknown placeholder, is never shown
 * or spoken.
 *
 * The same filled sentences feed three readers:
 * - the statement and its English gloss (`glossPairs`: the English sentence with the same template id);
 * - Paminawa (`audioPlan`): each sentence plays the synthetic clip fs-api served for it, otherwise the phone's own
 *   voice reads it, labelled; Filipino clips stand in for Cebuano ones when spike S10 failed ("Audio sa Filipino;
 *   teksto sa Cebuano"). The clips are IC-11's (ADR-0011): fs-api's `GET /v1/media/audio/:lineId` answer goes into
 *   the statement with `withServedAudio`, and each sentence finds fs-api's by slot, the form of the slot (its
 *   template variant: the PayPal or the cash PAY, the product or the seeded AI note) and what it names (§6). These
 *   sentences are not fs-api's spoken words ("0 4 0 3" where fs-api says "zero four zero three"), so the phone never
 *   hashes them to check a clip;
 * - the slip chips, which rise when the voice names a slip (`MentionCue`: a character index for the phone's voice,
 *   a time offset for a clip).
 */
import type {
  StatementAudio,
  StatementAudioClip,
  StatementAudioSentence,
  StatementDTO,
} from "../_shims/api-client";
import {
  type AmountState,
  amountStateOf,
  ITEM_STATUS_RANK,
  type Lang,
  type LineState,
  type StatementSlot,
  type StatementTemplate,
} from "../_shims/contracts";
import { FEE_TABLE, format, sha256Hex } from "../_shims/domain";
import type { Segment } from "../ui/figures";
import { writtenPesos } from "./figures";
import { type CapsuleState, EMPTY_TRACK, type ItemTrack } from "./item-status";

export interface PlaceholderValue {
  display: string;
  /** What device speech reads (money as words). Defaults to `display`. */
  spoken?: string;
  /** Slip mentions, so Paminawa can lift the chip the voice is naming. */
  mentions?: readonly string[];
}

export const PLACEHOLDER_RE = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
/** Any Unicode decimal digit, so "٣" or "３" cannot slip a number past the check. */
const DIGIT_RE = /\p{Nd}/u;

export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1] ?? "");
}

export function hasDigit(text: string): boolean {
  return DIGIT_RE.test(text.replace(PLACEHOLDER_RE, ""));
}

export type FilledSentence =
  | {
      ok: true;
      id: string;
      slot: StatementSlot | null;
      display: string;
      spoken: string;
      mentions: string[];
      /** Template words and engine values in order, so figures can be set in the figure face (design §2.3). */
      segments: Segment[];
    }
  | { ok: false; id: string; reason: "digit-in-template" | "unknown-placeholder" | "stray-braces" };

export function fillSentence(
  s: { id: string; text: string; slot?: StatementSlot },
  values: Readonly<Record<string, PlaceholderValue>>,
): FilledSentence {
  if (hasDigit(s.text)) return { ok: false, id: s.id, reason: "digit-in-template" };
  const names = placeholdersOf(s.text);
  if (names.some((n) => !(n in values))) return { ok: false, id: s.id, reason: "unknown-placeholder" };
  if (/\{\{|\}\}/.test(s.text.replace(PLACEHOLDER_RE, "")))
    return { ok: false, id: s.id, reason: "stray-braces" };
  const mentions: string[] = [];
  const display = s.text.replace(PLACEHOLDER_RE, (_, n: string) => {
    const v = values[n];
    for (const m of v?.mentions ?? []) mentions.push(m);
    return v?.display ?? "";
  });
  const spoken = s.text.replace(
    PLACEHOLDER_RE,
    (_, n: string) => values[n]?.spoken ?? values[n]?.display ?? "",
  );
  const segments: Segment[] = [];
  let last = 0;
  for (const m of s.text.matchAll(PLACEHOLDER_RE)) {
    const at = m.index ?? 0;
    if (at > last) segments.push({ text: s.text.slice(last, at), value: false });
    segments.push({ text: values[m[1] ?? ""]?.display ?? "", value: true });
    last = at + m[0].length;
  }
  if (last < s.text.length) segments.push({ text: s.text.slice(last), value: false });
  return { ok: true, id: s.id, slot: s.slot ?? null, display, spoken, mentions, segments };
}

const GRADE_ALL: Readonly<Record<Lang, string>> = {
  ceb: "tanan Grade 1",
  fil: "lahat ay Grade 1",
  en: "all Grade 1",
};
const GRADE_PART: Readonly<Record<Lang, (kg: string) => string>> = {
  ceb: (kg) => `${kg} niini Grade 1`,
  fil: (kg) => `${kg} dito ay Grade 1`,
  en: (kg) => `${kg} of it Grade 1`,
};

const usd = (cents: number): PlaceholderValue => ({
  display: format.usd(cents),
  spoken: format.amountSpoken(cents),
});
const kilos = (grams: number): PlaceholderValue => ({
  display: format.kg(grams, 1),
  spoken: format.kg(grams, 1).replace(" kg", " kilos"),
});

/** How a voice reads a slip serial: digit by digit ("0 4 0 3"), never "four hundred three". */
export function spokenSerial(serial: string): string {
  return serial.split("").join(" ");
}

/** Which PAY sentence applies: a line that moved to the bodega reads the cash variant. */
export type PayRail = "paypal" | "cash";

/**
 * Engine values for one template, in the member's language. Values that depend on the sentence (which deduction,
 * which credit) come from its `ref`.
 */
export function statementValues(
  dto: StatementDTO,
  lang: Lang,
  s?: Pick<StatementTemplate, "slot" | "ref">,
  rail: PayRail = dto.rail === "CASH" ? "cash" : "paypal",
): Record<string, PlaceholderValue> {
  const a = dto.amounts;
  const serials = dto.slips.map((x) => x.serial);
  const g1 = dto.kilos.grade1Grams;
  const deduction = s?.slot === "DEDUCTION" ? a.deductions.find((d) => d.ruleId === s.ref) : a.deductions[0];
  const credit = s?.slot === "CREDIT" ? a.credits.find((c) => c.slip === s.ref) : a.credits[0];
  const rate = dto.fx.phpPerUsd;
  const values: Record<string, PlaceholderValue> = {
    HONORIFIC_NAME: { display: dto.member.nameByLang[lang] },
    KG_TOTAL: kilos(dto.kilos.netGrams),
    GRADE_SUMMARY: {
      display: g1 === dto.kilos.netGrams ? GRADE_ALL[lang] : GRADE_PART[lang](format.kg(g1)),
    },
    PAYER: { display: dto.payer.short },
    PREMIUM_USD: usd(a.premiumCents),
    BONUS_USD: usd(a.bonusCents),
    BR: { display: dto.rateCard.id },
    NET_USD: usd(a.netCents),
    NET_PHP:
      rail === "cash"
        ? { display: format.cashPesos(a.netCents, rate), spoken: format.cashSpoken(a.netCents, rate) }
        : { display: format.peso(a.netCents, rate), spoken: format.pesoSpoken(a.netCents, rate) },
    FX_FEE: { display: format.percentBp(FEE_TABLE.paypalConversionBp) },
    RATE: { display: `₱${rate}` },
    SLIPS: {
      display: format.list(serials, lang),
      spoken: format.list(serials.map(spokenSerial), lang),
      mentions: serials.map((x) => `slip:${x}`),
    },
    TREASURER: { display: dto.treasurer.first },
  };
  if (dto.cashDay) values.CASH_DATE = { display: format.date(dto.cashDay, lang) };
  if (deduction) {
    values.DEDUCTION_USD = usd(deduction.cents);
    values.RULE_LABEL = { display: deduction.label };
    values.RULE = { display: deduction.ruleId };
  }
  if (credit) {
    values.CREDIT_USD = usd(credit.cents);
    values.WRITTEN_PHP = { display: writtenPesos(credit.writtenCentavos) };
    values.SLIP = {
      display: credit.slip,
      spoken: spokenSerial(credit.slip),
      mentions: [`slip:${credit.slip}`],
    };
  }
  return values;
}

/** Templates that apply to this line: the right PAY variant, and one DEDUCTION or CREDIT per item it names. */
export function applicableTemplates(
  dto: StatementDTO,
  lang: Lang,
  rail: PayRail,
): readonly StatementTemplate[] {
  return (dto.sentences[lang] ?? []).filter((s) => {
    if (s.slot === "PAY") return templateVariant(s) === rail;
    if (s.slot === "DEDUCTION") return dto.amounts.deductions.some((d) => d.ruleId === s.ref);
    if (s.slot === "CREDIT") return dto.amounts.credits.some((c) => c.slip === s.ref);
    return true;
  });
}

/** The member's sentences, filled; rejected ones are dropped and reported so the server can regenerate them. */
export function statementSentences(dto: StatementDTO, lang: Lang, rail?: PayRail) {
  const r: PayRail = rail ?? (dto.rail === "CASH" ? "cash" : "paypal");
  const filled = applicableTemplates(dto, lang, r).map((s) =>
    fillSentence(s, statementValues(dto, lang, s, r)),
  );
  return {
    sentences: filled.filter((f): f is Extract<FilledSentence, { ok: true }> => f.ok),
    rejected: filled.filter((f): f is Extract<FilledSentence, { ok: false }> => !f.ok),
  };
}

export type StatementSentence = ReturnType<typeof statementSentences>["sentences"][number];

/* ------------------------------------------------------------------ English gloss */

export interface GlossPair {
  sentence: StatementSentence;
  /** The English sentence with the same template id, for judges and family (null in English). */
  gloss: StatementSentence | null;
}

/**
 * The slots that carry money. While a line is still being checked it has no amount yet (S1.9 `checking`), so the
 * statement and Paminawa leave these sentences out rather than speak a figure nobody has approved.
 */
export const MONEY_SLOTS: readonly StatementSlot[] = ["PREMIUM", "BONUS", "DEDUCTION", "CREDIT", "PAY"];

const keep = (exclude: readonly StatementSlot[] | undefined) => (s: { slot: StatementSlot | null }) =>
  !exclude || s.slot === null || !exclude.includes(s.slot);

/** Each Cebuano or Filipino sentence with its English counterpart underneath (IC-12 `gloss`, S1.13). */
export function glossPairs(
  dto: StatementDTO,
  lang: Lang,
  rail?: PayRail,
  exclude?: readonly StatementSlot[],
): GlossPair[] {
  const sentences = statementSentences(dto, lang, rail).sentences.filter(keep(exclude));
  if (lang === "en") return sentences.map((sentence) => ({ sentence, gloss: null }));
  const en = new Map(statementSentences(dto, "en", rail).sentences.map((s) => [s.id, s]));
  return sentences.map((sentence) => ({ sentence, gloss: en.get(sentence.id) ?? null }));
}

/** One slot's sentence (the greeting, the help line, the AI note), with its gloss. */
export function sentenceFor(pairs: readonly GlossPair[], slot: StatementSlot): GlossPair | null {
  return pairs.find((p) => p.sentence.slot === slot) ?? null;
}

/* ------------------------------------------------------------------ Paminawa: what plays each sentence */

/**
 * A clip as fs-api serves it (IC-11, ADR-0011): one sentence's synthetic voice, with `offsets`, where the voice
 * says each slip, rule, amount or name the sentence names, in the clip's own time.
 */
export type AudioClip = StatementAudioClip;

export type Voice =
  | {
      kind: "clip";
      url: string;
      /** The clip's language: Filipino under Cebuano text when S10 failed. */
      lang: Lang;
      label: string;
      durationMs: number | null;
    }
  /** The phone's own voice reads the sentence (labelled "Tingog sa telepono"). */
  | { kind: "device" }
  /** No clip and no voice on this phone for this language: the transcript is the statement. */
  | { kind: "none" };

export interface MentionCue {
  /** `slip:0403`. */
  ref: string;
  serial: string;
  /** Where the spoken text names the slip, for the phone's voice (`onBoundary` reaches it). */
  charIndex: number;
  /** When the clip names it: the manifest's offset, else estimated from the clip's length; null when unknown. */
  offsetMs: number | null;
}

export interface AudioStep {
  /** Index of the sentence on screen (the transcript underlines it). */
  index: number;
  id: string;
  slot: StatementSlot | null;
  /** What the phone's voice reads (money and serials as words); the display text is the transcript's. */
  spoken: string;
  voice: Voice;
  cues: readonly MentionCue[];
}

export type AudioMode = "synthetic" | "mixed" | "device-voice" | "filipino-audio" | "text-only";

export interface AudioPlan {
  mode: AudioMode;
  steps: AudioStep[];
}

function cuesFor(spoken: string, mentions: readonly string[], clip: AudioClip | null): MentionCue[] {
  const cues: MentionCue[] = [];
  let from = 0;
  for (const ref of mentions) {
    const serial = ref.replace(/^slip:/, "");
    const at = spoken.indexOf(spokenSerial(serial), from);
    const charIndex = at >= 0 ? at : from;
    if (at >= 0) from = at + spokenSerial(serial).length;
    const known = clip?.offsets.find((o) => o.ref === ref)?.atMs;
    const estimated =
      clip?.durationMs && spoken.length > 0
        ? Math.round((clip.durationMs * charIndex) / spoken.length)
        : null;
    cues.push({ ref, serial, charIndex, offsetMs: known ?? estimated });
  }
  return cues;
}

/** The slots a line can have several of, and what tells them apart: the rule or the slip each one is about. */
const ABOUT: Partial<Record<StatementSlot, "rule" | "slip">> = { DEDUCTION: "rule", CREDIT: "slip" };

/**
 * Which form of its slot a template is, as fs-api names it (`{slot}.{variant}`): PAY's rail (`paypal` when the
 * template names none, as `applicableTemplates` reads it), otherwise `default` unless the template names one.
 */
export function templateVariant(t: Pick<StatementTemplate, "slot" | "variant">): string {
  return t.variant ?? (t.slot === "PAY" ? "paypal" : "default");
}

/**
 * Which sentence this is, whoever rendered it and in whichever language (ADR-0011 §6): its slot and the form of the
 * slot (`PAY.paypal` is not `PAY.cash`, the product AI note is not T1's seeded one), plus the rule or slip it is about
 * for a deduction or a credit. Never its words. Null when the phone cannot name it.
 */
function ownKey(dto: StatementDTO, lang: Lang, s: StatementSentence): string | null {
  if (!s.slot) return null;
  const template = dto.sentences[lang]?.find((t) => t.id === s.id);
  if (!template) return null;
  const form = `${s.slot}.${templateVariant(template)}`;
  const kind = ABOUT[s.slot];
  if (!kind) return form;
  return template.ref ? `${form}|${kind}:${template.ref}` : null;
}

/** The same key for one of fs-api's served sentences, from its slot, variant and mentions. */
function servedKey(s: StatementAudioSentence): string | null {
  const form = `${s.slot}.${s.variant}`;
  const kind = ABOUT[s.slot];
  if (!kind) return form;
  const about = s.mentions.find((m) => m.startsWith(`${kind}:`));
  return about ? `${form}|${about}` : null;
}

/**
 * fs-api's served sentence for each of the phone's sentences: the one with the same key, the n-th for the phone's
 * n-th sentence of that key (reading order among equals); null where fs-api served none.
 */
function pairServed(
  keys: readonly (string | null)[],
  served: readonly StatementAudioSentence[] | undefined,
): (StatementAudioSentence | null)[] {
  const byKey = new Map<string, StatementAudioSentence[]>();
  for (const s of served ?? []) {
    const k = servedKey(s);
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), s]);
  }
  const taken = new Map<string, number>();
  return keys.map((k) => {
    if (!k) return null;
    const n = taken.get(k) ?? 0;
    taken.set(k, n + 1);
    return byKey.get(k)?.[n] ?? null;
  });
}

/**
 * The clip fs-api served for a sentence, when the phone may play it: recorded for that very sentence (its slot, and
 * fs-api's `textSha256` for it) and reachable. fs-api's hash is the only one that counts: the phone's own words are
 * not fs-api's spoken text, so hashing them would prove nothing (ADR-0011 §6).
 */
function servedClip(
  served: StatementAudioSentence | null,
  playable: (url: string) => boolean,
): AudioClip | null {
  const c = served?.clip;
  if (!served || !c) return null;
  return c.slot === served.slot && c.textSha256 === served.textSha256 && playable(c.url) ? c : null;
}

/**
 * What reads each sentence. A clip is used only when fs-api served it for this very sentence: paired by slot, the
 * form of the slot and what the sentence names, recorded for fs-api's words for it (its `textSha256`), so changed
 * words never play stale audio (fs-api then serves no clip). The form is the one the phone shows now: when `rail`
 * moves the line to the bodega after fs-api spoke its PayPal PAY, the cash sentence has no clip until fs-api's audio
 * is read again. A clip the phone cannot reach (offline, not cached) falls back to the phone's voice. For Cebuano
 * without Cebuano clips, Filipino clips of the same template stand in.
 */
export function audioPlan(
  dto: StatementDTO,
  lang: Lang,
  opts: {
    deviceVoice: boolean;
    playable?: (url: string) => boolean;
    rail?: PayRail;
    /** Slots to leave out (`MONEY_SLOTS` while the line is still being checked). */
    exclude?: readonly StatementSlot[];
  },
): AudioPlan {
  const playable = opts.playable ?? (() => true);
  const sentences = statementSentences(dto, lang, opts.rail).sentences.filter(keep(opts.exclude));
  const hasClips = (l: Lang) => !!dto.audio[l]?.some((s) => s.clip !== null);
  const filStandIn = lang === "ceb" && !hasClips("ceb") && hasClips("fil");
  const fil = filStandIn
    ? new Map(statementSentences(dto, "fil", opts.rail).sentences.map((s) => [s.id, s]))
    : null;
  const paired = pairServed(
    sentences.map((s) => ownKey(dto, lang, s)),
    dto.audio[filStandIn ? "fil" : lang],
  );
  const steps = sentences.map((s, index): AudioStep => {
    const standIn = fil?.get(s.id) ?? null;
    const clip = filStandIn && !standIn ? null : servedClip(paired[index] ?? null, playable);
    if (clip) {
      const voiced = standIn ?? s;
      return {
        index,
        id: s.id,
        slot: s.slot,
        spoken: s.spoken,
        voice: {
          kind: "clip",
          url: clip.url,
          lang: standIn ? "fil" : lang,
          label: clip.label,
          durationMs: clip.durationMs ?? null,
        },
        cues: cuesFor(voiced.spoken, voiced.mentions, clip),
      };
    }
    return {
      index,
      id: s.id,
      slot: s.slot,
      spoken: s.spoken,
      voice: opts.deviceVoice ? { kind: "device" } : { kind: "none" },
      cues: cuesFor(s.spoken, s.mentions, null),
    };
  });
  const clipped = steps.filter((x) => x.voice.kind === "clip");
  const mode: AudioMode =
    steps.length > 0 && clipped.length === steps.length
      ? filStandIn
        ? "filipino-audio"
        : "synthetic"
      : clipped.length > 0
        ? "mixed"
        : opts.deviceVoice
          ? "device-voice"
          : "text-only";
  return { mode, steps };
}

/**
 * Puts fs-api's answer to `GET /v1/media/audio/:lineId` into the statement as it came: every sentence fs-api speaks,
 * in reading order, becomes `dto.audio[lang]`, its clip's same-origin URL resolved against `origin` (the native app's
 * API origin; the web frames are served by fs-api itself). A sentence without a clip is read by the phone's voice.
 * `audioPlan` pairs these sentences with the phone's own and plays a clip only under fs-api's hash for its sentence.
 * An answer for another line changes nothing. Read the answer again whenever the statement is read again and
 * whenever the pay kind or the capsule changes (ADR-0011, K1c), so the clips follow the sentences on screen.
 */
export function withServedAudio(dto: StatementDTO, served: StatementAudio, origin = ""): StatementDTO {
  if (served.lineId.toLowerCase() !== dto.lineId.toLowerCase()) return dto;
  const base = origin.replace(/\/+$/, "");
  const sentences = served.sentences.map((s) =>
    s.clip?.url.startsWith("/") ? { ...s, clip: { ...s.clip, url: `${base}${s.clip.url}` } } : s,
  );
  return { ...dto, audio: { ...dto.audio, [served.lang]: sentences } };
}

/** Cues from `fired` on, in order, up to the first one not yet reached (each cue fires once). */
function duePrefix(
  cues: readonly MentionCue[],
  fired: number,
  reached: (c: MentionCue) => boolean,
): MentionCue[] {
  const due: MentionCue[] = [];
  for (const c of cues.slice(fired)) {
    if (!reached(c)) break;
    due.push(c);
  }
  return due;
}

/** The cues to fire as the phone's voice reaches `charIndex` (each cue once, in order). */
export function cuesReached(cues: readonly MentionCue[], charIndex: number, fired: number): MentionCue[] {
  return duePrefix(cues, fired, (c) => c.charIndex <= charIndex);
}

/**
 * The cues to fire as a clip reaches `ms` of media time (the playback rate does not matter: offsets are in the
 * clip's own time). A cue with no known offset fires as the clip starts.
 */
export function clipCuesReached(cues: readonly MentionCue[], ms: number, fired: number): MentionCue[] {
  return duePrefix(cues, fired, (c) => (c.offsetMs ?? 0) <= ms);
}

/* ------------------------------------------------------------------ the item track across reloads */

/**
 * Merges a fresh statement read into the item track that SSE keeps current. The read is the server's truth, but an
 * `item.updated` can land while the read is in flight, so a read never moves the status backwards (I5). A read
 * with no item status at all (a run that was reset, or not yet posted) clears the track; event ids already seen are
 * kept, so a redelivered event still changes nothing.
 */
export function mergeTrack(track: ItemTrack, item: StatementDTO["item"]): ItemTrack {
  const status = item?.status ?? null;
  if (status === null) return { ...EMPTY_TRACK, seen: track.seen };
  if (track.status === null || ITEM_STATUS_RANK[status] >= ITEM_STATUS_RANK[track.status]) {
    return { status, updatedAt: item?.updatedAt ?? track.updatedAt, seen: track.seen };
  }
  return track;
}

/* ------------------------------------------------------------------ the amount grammar on the statement */

/** The line state each capsule stands for, so the hero amount follows IC-09's grammar (`AMOUNT_STATE`). */
const LINE_FOR_CAPSULE: Readonly<Record<CapsuleState, LineState>> = {
  checking: "READY",
  "held-line": "HELD",
  sent: "PAYPAL_PENDING",
  paid: "PAID",
  "cash-due": "OFF_RAIL_DUE",
  "cash-received": "OFF_RAIL_PAID",
  unclaimed: "UNCLAIMED",
  returned: "RETURNED",
  "paypal-held": "PAYPAL_HELD",
  "needs-action": "NEEDS_ACTION",
  reversed: "REVERSED",
  excluded: "EXCLUDED",
};

/** Both keys signed this run: the approval is in her history, or the batch has a digest. */
export function lineApproved(dto: StatementDTO): boolean {
  return dto.batchSha256 !== null || dto.history.some((h) => h.kind === "approved");
}

/**
 * `data-amount-state` of the hero amount: hollow while the money is in flight (sent, parked, cash due), landed only
 * when PayPal confirmed it, attested when the clerk recorded the cash handed over (S2.2.1).
 */
export function amountStateFor(capsule: CapsuleState, approved: boolean): AmountState {
  return amountStateOf(LINE_FOR_CAPSULE[capsule], { approved });
}

/* ------------------------------------------------------------------ the phone's own voice */

/** The phone voice that reads a language: its BCP 47 tag, and the exact voice when the phone names one. */
export interface VoiceChoice {
  language: string;
  voiceId: string | null;
}

/** Best first. Cebuano falls back to Filipino (Tagalog) voices, as the first-run samples do; never to English. */
const VOICE_PREFERENCE: Readonly<Record<Lang, readonly string[]>> = {
  ceb: ["ceb", "fil", "tl"],
  fil: ["fil", "tl"],
  en: ["en-ph", "en-us", "en-gb", "en"],
};

/** Picks the phone's voice for a statement language from the voices it lists, or null when it has none for it. */
export function chooseVoice(
  lang: Lang,
  available: readonly { identifier: string; language: string }[],
): VoiceChoice | null {
  const norm = available.map((v) => ({ id: v.identifier, tag: v.language.replace("_", "-").toLowerCase() }));
  for (const want of VOICE_PREFERENCE[lang]) {
    const hit = norm.find((v) => v.tag === want || v.tag.startsWith(`${want}-`));
    if (hit) return { language: hit.tag, voiceId: hit.id };
  }
  return null;
}

/* ------------------------------------------------------------------ the copy kept on this phone */

/**
 * Where this phone keeps a statement's offline copy ("Katapusang kopya, 10:21"). A member's own read is kept under
 * who she is (`identity`: `identityKey`, her workspace and persona), so a phone paired to someone else, or to the
 * same member number in another co-op or judge workspace, never reads it. A link view (`/s/:token`) is kept under the
 * link itself, a fingerprint of the token as fs-api signed it, never under the line the token claims: the phone
 * cannot check those claims, so another token naming the same line (forged, or reissued) never opens this copy.
 * Null: nothing is kept (no pairing and no link).
 */
export function statementCacheKey(o: { identity: string | null; linkToken: string | null }): string | null {
  if (o.linkToken) {
    return `fs.statement.v2.link.${sha256Hex(`fair-split-statement-link:${o.linkToken}`).slice(0, 32)}`;
  }
  return o.identity ? `fs.statement.v2.member.${o.identity}` : null;
}

/**
 * The keys an earlier build kept copies under (the persona alone, or the line a link claims), which nothing reads any
 * more: removed when a statement opens, so a member's figures do not linger on a shared phone.
 */
export function legacyStatementCacheKeys(o: { persona: string | null; linkLineId: string | null }): string[] {
  if (o.linkLineId !== null) return [`fs.statement.link.${o.linkLineId}`, "fs.statement.link.unknown"];
  return [...(o.persona ? [`fs.statement.cache.${o.persona}`] : []), "fs.statement.cache.member"];
}

/** Codes that refuse the credential itself (a pairing or a link), whatever status carries them. */
const REFUSED_CODES: ReadonlySet<string> = new Set([
  "UNAUTHENTICATED",
  "FRAME_TOKEN_EXPIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "PAIRING_TOKEN_INVALID",
  "SIGNATURE_INVALID",
]);

/**
 * Why a statement read failed, as far as the copy on this phone is concerned:
 * - `offline`: no answer (no signal, DNS, a reset socket) or a struggling server (5xx, 408, 429): show the copy;
 * - `refused`: the pairing or the link was refused (401, 403, 404, 410, or such a code): never show it, and drop it;
 * - `failed`: any other refusal: show the error, keep the copy for when the server answers.
 */
export type ReadFailure = "offline" | "refused" | "failed";

export function readFailureOf(r: { code: string; status?: number }): ReadFailure {
  const s = r.status;
  if (s === undefined) return "offline";
  if (s >= 500 || s === 408 || s === 429) return "offline";
  if (s === 401 || s === 403 || s === 404 || s === 410 || REFUSED_CODES.has(r.code)) return "refused";
  return "failed";
}
