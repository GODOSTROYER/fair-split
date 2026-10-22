// @fairsplit/i18n: en / fil / ceb catalogs as ICU messages on i18next + i18next-icu, the register's status
// words, a CLDR plural function that works where the platform lacks ceb data, and the native-review ledger.

import i18next, { type i18n } from "i18next";
import ICU from "i18next-icu";
import { ceb } from "./catalog/ceb.js";
import { type Catalog, en, type MessageKey } from "./catalog/en.js";
import { fil } from "./catalog/fil.js";

export type { Catalog, MessageKey } from "./catalog/en.js";
export * from "./plural.js";
export * from "./review.js";

export const LANGS = ["ceb", "fil", "en"] as const;
export type Lang = (typeof LANGS)[number];

/** The language each member surface opens in: Cebuano first, Filipino and English one tap away. */
export const DEFAULT_MEMBER_LANG: Lang = "ceb";
/** The console is in English, in the co-op's own words (resibo, kaltas, purok, bodega). */
export const CONSOLE_LANG: Lang = "en";

export const LANG_NAMES: Readonly<Record<Lang, string>> = { ceb: "Cebuano", fil: "Filipino", en: "English" };

export const CATALOGS: {
  readonly en: Catalog;
  readonly fil: Partial<Catalog>;
  readonly ceb: Partial<Catalog>;
} = {
  en,
  fil,
  ceb,
};

/** Keys a member surface needs in all three languages (everything the Cebuano catalog carries). */
export const MEMBER_KEYS = Object.keys(ceb) as MessageKey[];

export type Values = Readonly<Record<string, string | number>>;

/**
 * A synchronous i18next instance with ICU MessageFormat. Cebuano is formatted with Filipino's ICU locale,
 * which shares its CLDR plural rule, because Hermes and older Android ICU may lack ceb data.
 */
export function createI18n(lang: Lang = DEFAULT_MEMBER_LANG): i18n {
  const instance = i18next.createInstance();
  instance.use(new ICU({ parseLngForICU: (lng: string) => (lng === "ceb" ? "fil" : lng) }));
  void instance.init({
    lng: lang,
    fallbackLng: "en",
    supportedLngs: [...LANGS],
    resources: {
      en: { translation: en },
      fil: { translation: fil },
      ceb: { translation: ceb },
    },
    initAsync: false,
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instance;
}

const instances = new Map<Lang, i18n>();

/** Formats one message. Missing ceb or fil keys fall back to English. */
export function translate(lang: Lang, key: MessageKey, values?: Values): string {
  let instance = instances.get(lang);
  if (!instance) {
    instance = createI18n(lang);
    instances.set(lang, instance);
  }
  return String(instance.t(key, values as Record<string, unknown>));
}

/** A translator bound to one language, for components that render a whole surface. */
export function translator(lang: Lang): (key: MessageKey, values?: Values) => string {
  return (key, values) => translate(lang, key, values);
}

/** Member line states (register §7). */
export const LINE_STATES = [
  "COMPUTED",
  "READY",
  "HELD",
  "EXCLUDED",
  "LOCKED",
  "SUBMITTED",
  "PAYPAL_PENDING",
  "PAID",
  "OFF_RAIL_DUE",
  "OFF_RAIL_PAID",
  "UNCLAIMED",
  "RETURNED",
  "REROUTED",
  "PAYPAL_HELD",
  "NEEDS_ACTION",
  "REVERSED",
] as const;
export type LineState = (typeof LINE_STATES)[number];

/** A raw state name is never shown: members read these words in their own language. */
export function statusWord(state: LineState, lang: Lang): string {
  return translate(lang, `status.${state}`);
}

/** The console's word for a line state (English, the co-op's vocabulary). */
export function consoleStatusWord(state: LineState): string {
  return translate("en", `console.status.${state}`);
}
