/**
 * Copy for M-ON-01 first run: language, theme, pairing (BOARD+ONBOARDING slice).
 * Keys are `<screenId>.<key>`; the shell's own keys (common, tab, slab, seal) come from `_shims/i18n.ts`.
 * Pure data (tested in Node); screens read it through `useT()` from `./use-t`.
 * ceb and fil are machine-translated, pending native review (OD-2).
 */
import type { Lang } from "../../_shims/contracts";
import { defineMessages, type MessageArgs, type MessageKey, same, translateIn } from "../../_shims/i18n";

export const messages = defineMessages({
  /* M-ON-01 first run */
  "M-ON-01.lang.prompt": {
    ceb: "Pilia ang inyong pinulongan",
    fil: "Piliin ang inyong wika",
    en: "Choose your language",
  },
  "M-ON-01.lang.name": { ceb: "Cebuano", fil: "Filipino", en: "English" },
  "M-ON-01.lang.sample": { ceb: "Maayong adlaw.", fil: "Magandang araw po.", en: "Good day." },
  "M-ON-01.lang.play": {
    ceb: "Paminawa ang Cebuano",
    fil: "Pakinggan ang Filipino",
    en: "Hear English",
  },
  "M-ON-01.lang.notYet": same("Hiligaynon, Waray, Bikol: wala pa (not yet)"),
  "M-ON-01.lang.deviceVoice": {
    ceb: "Tingog sa telepono",
    fil: "Boses ng telepono",
    en: "The phone's own voice",
  },
  "M-ON-01.continue": { ceb: "Padayon", fil: "Magpatuloy", en: "Continue" },
  "M-ON-01.theme.title": {
    ceb: "Unsa ang mas klaro nimo?",
    fil: "Alin ang mas malinaw sa inyo?",
    en: "Which is clearer for you?",
  },
  "M-ON-01.theme.adlaw": same("Adlaw"),
  "M-ON-01.theme.adlawHint": {
    ceb: "Hayag, para sa adlaw",
    fil: "Maliwanag, para sa araw",
    en: "Light, for daylight",
  },
  "M-ON-01.theme.tablea": same("Tablea"),
  "M-ON-01.theme.tableaHint": {
    ceb: "Ngitngit, para sa gabii",
    fil: "Madilim, para sa gabi",
    en: "Dark, for evenings",
  },
  "M-ON-01.theme.sampleGreeting": {
    ceb: "Maayong adlaw, {name}.",
    fil: "Magandang araw po, {name}.",
    en: "Good day, {name}.",
  },
  "M-ON-01.pair.title": {
    ceb: "Pangayo sa treasurer sa inyong QR.",
    fil: "Hingin po sa treasurer ang inyong QR.",
    en: "Ask the treasurer for your QR.",
  },
  "M-ON-01.pair.scanHint": {
    ceb: "Itutok ang camera sa QR.",
    fil: "Itutok ang camera sa QR.",
    en: "Point the camera at the QR.",
  },
  "M-ON-01.pair.allowCamera": {
    ceb: "Tugoti ang camera",
    fil: "Payagan ang camera",
    en: "Allow the camera",
  },
  "M-ON-01.pair.codeLabel": {
    ceb: "O isulat ang 6 ka numero",
    fil: "O ilagay ang 6 na numero",
    en: "Or type the 6-digit code",
  },
  "M-ON-01.pair.codeAction": {
    ceb: "Ikonektar kini nga telepono",
    fil: "Ikonekta ang telepono",
    en: "Pair this phone",
  },
  "M-ON-01.pair.cameraDenied": {
    ceb: "Walay access sa camera. Isulat ang 6 ka numero gikan sa treasurer.",
    fil: "Walang access sa camera. Ilagay ang 6 na numero mula sa treasurer.",
    en: "No camera access. Type the 6-digit code from the treasurer.",
  },
  "M-ON-01.pair.expired": {
    ceb: "Nag-expire na kini nga code. Pangayo og bag-o sa treasurer.",
    fil: "Nag-expire na po ang code na ito. Humingi ng bago sa treasurer.",
    en: "This code has expired. Ask the treasurer for a new one.",
  },
  "M-ON-01.pair.used": {
    ceb: "Nagamit na kini nga code. Pangayo og bag-o sa treasurer.",
    fil: "Nagamit na po ang code na ito. Humingi ng bago sa treasurer.",
    en: "This code was already used. Ask the treasurer for a new one.",
  },
  "M-ON-01.pair.invalid": {
    ceb: "Dili kini QR sa Fair Split. Sulayi pag-usab.",
    fil: "Hindi ito QR ng Fair Split. Subukan muli.",
    en: "That isn't a Fair Split QR. Try again.",
  },
  "M-ON-01.pair.offline": {
    ceb: "Walay signal. Sulayi pag-usab kon naa nay signal.",
    fil: "Walang signal. Subukan muli kapag may signal na.",
    en: "No signal. Try again when you have signal.",
  },
  "M-ON-01.pair.error": {
    ceb: "Wala nakonektar. Sulayi pag-usab o pangayo og bag-ong QR.",
    fil: "Hindi naikonekta. Subukan muli o humingi ng bagong QR.",
    en: "Pairing didn't finish. Try again or ask for a new QR.",
  },
  "M-ON-01.pair.pairing": {
    ceb: "Ginakonektar ang telepono",
    fil: "Ikinokonekta ang telepono",
    en: "Pairing this phone",
  },
  "M-ON-01.pair.paired": {
    ceb: "Konektado na. Kini nga telepono para sa {role}.",
    fil: "Nakakonekta na po. Ang teleponong ito ay para sa {role}.",
    en: "Paired. This phone is for the {role}.",
  },
  "M-ON-01.pair.demoTitle": {
    ceb: "Walay server nga gi-set. Sulayi ang usa ka papel gamit ang demo data.",
    fil: "Walang server na naka-set. Subukan ang isang papel gamit ang demo data.",
    en: "No server is set. Try a role with demo data.",
  },
  "M-ON-01.pair.demoMember": {
    ceb: "Miyembro, Nang Celing",
    fil: "Miyembro, Gng. Bacus",
    en: "Member, Mrs. Bacus",
  },
  "M-ON-01.pair.demoBoard": {
    ceb: "Board, Nong Ernesto",
    fil: "Board, G. Cabahug",
    en: "Board, Mr. Cabahug",
  },
  "M-ON-01.pair.demoClerk": { ceb: "Clerk, Jessie", fil: "Clerk, Jessie", en: "Clerk, Jessie" },
});

export type OnboardingKey = keyof typeof messages | MessageKey;

/** For copy in a language other than the app's (the three-language first-run prompt, language chips). */
export function t(lang: Lang, key: OnboardingKey, args?: MessageArgs): string {
  return translateIn(messages, lang, key, args);
}
