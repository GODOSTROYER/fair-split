/**
 * TEMPORARY SHIM: replace with @fairsplit/i18n (ICU MessageFormat through i18next + i18next-icu) after WS-DS merges.
 *
 * Keys are `<screenId>.<key>` (S1.5); UI code holds no user-facing literals. Arguments use `{name}`.
 * Every ceb and fil string is machine-translated, pending native review (OD-2), and every Cebuano and Filipino surface
 * says so (`pendingReview`, drawn by the chrome) until a native speaker signs off in i18n/REVIEW.md.
 *
 * Catalogs are split by owner so three slices can write copy in parallel without touching one file:
 * - this file: the shell's own keys (app, common, role, tab, slab, seal), frozen with the shell;
 * - `features/onboarding/messages.ts` (M-ON-01), `features/statement/messages.ts` (M-MB-01…04),
 *   `features/clerk/messages.ts` (M-CL-01, the outbox) and `features/board/messages.ts` (M-BD-01/02, hold kinds).
 * Each slice reads its own catalog plus these keys through `useMessages(catalog)` (ui/text.tsx). WS-DS merges them
 * into one ICU catalog later; the key names do not change.
 */
import type { Lang } from "./contracts";

export type Entry = Readonly<Record<Lang, string>>;
export type Catalog = Readonly<Record<string, Entry>>;
export type MessageArgs = Readonly<Record<string, string | number>>;

/** The same text in all three languages (names, product terms, codes). */
export const same = (s: string): Entry => ({ ceb: s, fil: s, en: s });

/**
 * OD-2 (S1.6, S1.13): whether a surface in `lang` shows "Machine-translated, pending native review". The chip stays
 * while any visible string is unreviewed, and no Cebuano or Filipino key has been signed off in i18n/REVIEW.md yet,
 * so every ceb and fil surface shows it; English is the source text.
 */
export function pendingReview(lang: Lang): boolean {
  return lang !== "en";
}

/** Declares a catalog, keeping its literal keys for type-checked lookups. */
export function defineMessages<const C extends Record<string, Entry>>(catalog: C): C {
  return catalog;
}

export const messages = defineMessages({
  "app.name": same("Fair Split"),
  "app.lockup": same("Fair Split: co-op payroll"),
  "common.payoutSimulatedLabel": same("Simulated PayPal sandbox"),
  "common.payoutSimulatedCopy": {
    ceb: "Kini nga bayad pinaagi sa simulated PayPal sandbox. Walay tinuod nga kuwarta nga molihok.",
    fil: "Ang bayad na ito ay sa simulated PayPal sandbox. Walang totoong perang gagalaw.",
    en: "This payment uses the simulated PayPal sandbox. No real money moves.",
  },
  "common.payoutReplayChip": {
    ceb: "Gi-replay · Simulated PayPal sandbox",
    fil: "Ni-replay · Simulated PayPal sandbox",
    en: "Replayed · Simulated PayPal sandbox",
  },
  "common.payoutReplayCopy": {
    ceb: "Gi-replay nga bayad sa simulated PayPal sandbox.",
    fil: "Ni-replay na bayad sa simulated PayPal sandbox.",
    en: "Replayed payment from the simulated PayPal sandbox.",
  },
  "common.payoutUnknown": {
    ceb: "Wala mailhi ang gigikanan sa bayad.",
    fil: "Hindi alam ang pinagmulan ng bayad.",
    en: "Payment rail unknown.",
  },
  "common.payoutPlannedChip": {
    ceb: "Giplano nga replay (labelled) · Simulated PayPal sandbox",
    fil: "Planadong replay (labelled) · Simulated PayPal sandbox",
    en: "Planned replay (labelled) · Simulated PayPal sandbox",
  },
  "common.payoutPlannedCopy": {
    ceb: "Giplano ang labelled replay sa simulated PayPal sandbox. Wala pay payout item; ang kahimtang sa linya iya niini nga run.",
    fil: "Planado ang labelled replay sa simulated PayPal sandbox. Wala pang payout item; ang status ng linya ay para sa run na ito.",
    en: "This run plans a labelled replay of the simulated PayPal sandbox payout step. No payout item exists yet; the line status belongs to this run.",
  },
  "common.payoutReplayStatus": {
    ceb: "Gi-replay: {status}",
    fil: "Ni-replay: {status}",
    en: "Replayed: {status}",
  },
  "common.demoData": {
    ceb: "Demo data, walay server",
    fil: "Demo data, walang server",
    en: "Demo data, no server",
  },
  "common.machineTranslated": same("Machine-translated, pending native review"),
  "common.offline": { ceb: "Walay signal", fil: "Walang signal", en: "No signal" },
  "common.tryAgain": { ceb: "Sulayi pag-usab", fil: "Subukan muli", en: "Try again" },
  "common.back": { ceb: "Balik", fil: "Bumalik", en: "Back" },
  "common.close": { ceb: "Sirado", fil: "Isara", en: "Close" },
  "common.cancel": { ceb: "Kanselahon", fil: "Kanselahin", en: "Cancel" },
  "common.loading": { ceb: "Gikarga", fil: "Naglo-load", en: "Loading" },
  "common.reconnecting": {
    ceb: "Nagkonektar pag-usab. Mga kausaban hangtod {time}.",
    fil: "Muling kumokonekta. Mga pagbabago hanggang {time}.",
    en: "Reconnecting. Showing changes up to {time}.",
  },
  "common.syntheticSample": same("Synthetic sample"),
  "common.syntheticData": {
    ceb: "Sintetiko nga co-op ug datos. Walay tinuod nga mag-uuma ang nabayran.",
    fil: "Sintetikong co-op at datos. Walang totoong magsasaka ang nabayaran.",
    en: "Synthetic co-op and data. No real farmer was paid.",
  },
  "role.member": { ceb: "miyembro", fil: "miyembro", en: "member" },
  "role.clerk": same("clerk"),
  "role.board": same("Board"),
  "tab.bayad": { ceb: "Bayad", fil: "Bayad", en: "Pay" },
  "tab.resibo": { ceb: "Resibo", fil: "Resibo", en: "Slips" },
  "tab.pangutana": { ceb: "Pangutana", fil: "Tanong", en: "Questions" },
  "tab.scan": same("Scan"),
  "tab.outbox": same("Outbox"),
  "tab.pirma": { ceb: "Pirma", fil: "Pirma", en: "Sign" },

  "common.langName": { ceb: "Cebuano", fil: "Filipino", en: "English" },
  "common.offlineRetry": {
    ceb: "Walay signal. Sulayi pag-usab kon naa nay signal.",
    fil: "Walang signal. Subukan muli kapag may signal na.",
    en: "No signal. Try again when you have signal.",
  },
  "common.error": {
    ceb: "Wala nahuman. Sulayi pag-usab.",
    fil: "Hindi natapos. Subukan muli.",
    en: "That didn't finish. Try again.",
  },
  "common.lastCopy": {
    ceb: "Katapusang kopya, {time}",
    fil: "Huling kopya, {time}",
    en: "Last copy, {time}",
  },
  "common.cash": same("Cash"),
  "common.demoKey": same("Demo key (this browser)"),
  "common.deviceVoice": {
    ceb: "Tingog sa telepono",
    fil: "Boses ng telepono",
    en: "The phone's own voice",
  },
  "common.estimate": { ceb: "gibanabana", fil: "tantiya", en: "estimate" },

  /* Slab and its dialog route (S2.7): shared by every hold-to-commit control */
  "slab.release": { ceb: "Buhii aron mopirma", fil: "Bitawan para pumirma", en: "Release to sign" },
  "slab.holdUntil": {
    ceb: "Kupti hangtod mo-klik",
    fil: "Pindutin hanggang mag-click",
    en: "Hold until it clicks",
  },
  "slab.disarmed": { ceb: "Walay napirmahan.", fil: "Walang napirmahan.", en: "Nothing was signed." },
  "slab.another": {
    ceb: "Dili makakupti? Aprobahi sa laing paagi",
    fil: "Hindi makapindot nang matagal? Aprubahan sa ibang paraan",
    en: "Can't hold? Approve another way",
  },
  "slab.progress": same("{pct}%"),
  "slab.recipients": { ceb: "Mga makadawat", fil: "Mga tatanggap", en: "Recipients" },
  "seal.label": {
    ceb: "Selyo sa batch, {keys} sa 2 ka key",
    fil: "Selyo ng batch, {keys} sa 2 key",
    en: "Batch seal, {keys} of 2 keys",
  },
  "seal.hash": same("Batch hash {hash}"),
  /** S2.2.1: a field a person must enter or confirm wears a "You" tag. */
  "amount.you": { ceb: "Ikaw", fil: "Ikaw", en: "You" },
});

export type MessageKey = keyof typeof messages;

/** Fills `{name}` arguments; an argument the template does not name is ignored, a missing one stays visible. */
export function interpolate(template: string, args?: MessageArgs): string {
  if (!args) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, name: string) =>
    name in args ? String(args[name]) : m,
  );
}

/** A key from `catalog`, falling back to the shell's keys; English if a language is missing. */
export function translateIn<C extends Catalog>(
  catalog: C,
  lang: Lang,
  key: (keyof C & string) | MessageKey,
  args?: MessageArgs,
): string {
  const entry: Entry | undefined = (catalog as Catalog)[key] ?? (messages as Catalog)[key];
  if (!entry) return key;
  return interpolate(entry[lang] ?? entry.en, args);
}

export function translate(lang: Lang, key: MessageKey, args?: MessageArgs): string {
  return translateIn(messages, lang, key, args);
}

const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;

/**
 * Catalog hygiene, for every catalog's own test: keys are `<screenId>.<key>`, every language is present and not
 * empty, all three languages name the same `{placeholders}`, and a slice key never shadows a shell key.
 */
export function catalogProblems(catalog: Catalog, opts: { shell?: boolean } = {}): string[] {
  const problems: string[] = [];
  const langs = ["ceb", "fil", "en"] as const;
  for (const [key, entry] of Object.entries(catalog)) {
    if (!/^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9_]+)+$/.test(key)) problems.push(`${key}: not <screenId>.<key>`);
    if (!opts.shell && key in messages) problems.push(`${key}: shadows a shell key`);
    for (const l of langs) {
      if (typeof entry[l] !== "string" || !entry[l].trim()) problems.push(`${key}: no ${l}`);
    }
    const sets = langs.map((l) =>
      [...(entry[l] ?? "").matchAll(PLACEHOLDER)]
        .map((m) => m[1])
        .sort()
        .join(","),
    );
    if (new Set(sets).size > 1) problems.push(`${key}: placeholders differ between languages`);
  }
  return problems;
}
