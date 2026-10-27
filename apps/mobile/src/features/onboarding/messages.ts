/**
 * Copy for M-ON-01 first run: language, "Klaro ba?", pairing, and read-or-listen (ONBOARDING slice).
 * Keys are `<screenId>.<key>`; the shell's own keys (common, role, slab, seal) come from `_shims/i18n.ts`.
 * Pure data (tested in Node); screens read it through `useT()` from `./use-t`.
 * ceb and fil are machine-translated, pending native review (OD-2). S1.9's Cebuano lines are used as written.
 */
import type { Lang } from "../../_shims/contracts";
import { defineMessages, type MessageArgs, type MessageKey, same, translateIn } from "../../_shims/i18n";

export const messages = defineMessages({
  /* Language */
  "M-ON-01.lang.prompt": {
    ceb: "Pilia ang inyong pinulongan",
    fil: "Piliin ang inyong wika",
    en: "Choose your language",
  },
  "M-ON-01.lang.name": { ceb: "Cebuano", fil: "Filipino", en: "English" },
  "M-ON-01.lang.sample": {
    ceb: "Maayong adlaw. Ania ang inyong bayad karong season.",
    fil: "Magandang araw po. Narito ang inyong bayad ngayong season.",
    en: "Good day. Here is your pay this season.",
  },
  "M-ON-01.lang.play": {
    ceb: "Paminawa ang Cebuano",
    fil: "Pakinggan ang Filipino",
    en: "Hear English",
  },
  "M-ON-01.lang.stop": { ceb: "Hunonga", fil: "Itigil", en: "Stop" },
  "M-ON-01.lang.notYet": {
    ceb: "Hiligaynon, Waray ug Bikol: wala pa",
    fil: "Hiligaynon, Waray at Bikol: wala pa",
    en: "Hiligaynon, Waray and Bikol: not yet",
  },
  "M-ON-01.lang.change": {
    ceb: "Mausab ninyo kini bisan kanus-a.",
    fil: "Mababago ninyo ito anumang oras.",
    en: "You can change this any time.",
  },
  "M-ON-01.continue": { ceb: "Padayon", fil: "Magpatuloy", en: "Continue" },

  /* "Klaro ba?" (the theme route: one theme, read at this phone's text size) */
  "M-ON-01.size.title": {
    ceb: "Klaro ba kini basahon?",
    fil: "Malinaw po ba itong basahin?",
    en: "Is this easy to read?",
  },
  "M-ON-01.size.body": {
    ceb: "Ingon niini ang inyong pahayag sa bayad, sa gidak-on sa letra niini nga telepono.",
    fil: "Ganito ang inyong statement ng bayad, sa laki ng letra ng teleponong ito.",
    en: "This is how your pay statement looks at this phone's text size.",
  },
  "M-ON-01.size.coop": same("{coop}, Season {season}"),
  "M-ON-01.size.greeting": {
    ceb: "Maayong adlaw, {name}. Salamat sa inyong paghago.",
    fil: "Magandang araw po, {name}. Salamat po sa inyong pagsisikap.",
    en: "Good day, {name}. Thank you for your hard work.",
  },
  "M-ON-01.size.clear": { ceb: "Oo, klaro", fil: "Oo, malinaw", en: "Yes, it's clear" },
  "M-ON-01.size.small": {
    ceb: "Gamay pa ang letra",
    fil: "Maliit pa ang letra",
    en: "The letters are too small",
  },
  "M-ON-01.size.how": {
    ceb: "Padak-a ang letra sa Settings sa telepono: Display, dayon Font size. Mosunod dayon ang Fair Split.",
    fil: "Palakihin ang letra sa Settings ng telepono: Display, saka Font size. Susunod agad ang Fair Split.",
    en: "Make the letters bigger in the phone's Settings: Display, then Font size. Fair Split follows at once.",
  },
  "M-ON-01.size.howWeb": {
    ceb: "Pindota ang Ctrl ug + aron mopadako ang letra. Mosunod dayon ang Fair Split.",
    fil: "Pindutin ang Ctrl at + para lumaki ang letra. Susunod agad ang Fair Split.",
    en: "Press Ctrl and + to make the letters bigger. Fair Split follows at once.",
  },
  "M-ON-01.size.open": { ceb: "Ablihi ang Settings", fil: "Buksan ang Settings", en: "Open Settings" },
  "M-ON-01.size.now": {
    ceb: "Gidak-on sa letra karon: {pct}%",
    fil: "Laki ng letra ngayon: {pct}%",
    en: "Text size now: {pct}%",
  },

  /* Pairing */
  "M-ON-01.pair.title": {
    ceb: "Pangayo sa treasurer sa inyong QR.",
    fil: "Hingin po sa treasurer ang inyong QR.",
    en: "Ask the treasurer for your QR.",
  },
  "M-ON-01.pair.scanHint": {
    ceb: "Itutok ang camera sa QR. Magamit kini kausa ra, sulod sa 10 ka minuto.",
    fil: "Itutok ang camera sa QR. Isang beses lang ito magagamit, sa loob ng 10 minuto.",
    en: "Point the camera at the QR. It works once, for 10 minutes.",
  },
  "M-ON-01.pair.scanWeb": {
    ceb: "I-scan ang QR gamit ang camera sa inyong telepono; moabli kini dinhi. O isulat ang code ubos sa QR.",
    fil: "I-scan ang QR gamit ang camera ng inyong telepono; dito ito magbubukas. O ilagay ang code sa ilalim ng QR.",
    en: "Scan the QR with your phone's camera; it opens here. Or type the code under the QR.",
  },
  "M-ON-01.pair.cameraNeeded": {
    ceb: "Gikinahanglan ang camera aron ma-scan ang QR.",
    fil: "Kailangan ang camera para ma-scan ang QR.",
    en: "The camera is needed to scan the QR.",
  },
  "M-ON-01.pair.allowCamera": {
    ceb: "Tugoti ang camera",
    fil: "Payagan ang camera",
    en: "Allow the camera",
  },
  "M-ON-01.pair.codeLabel": {
    ceb: "O isulat ang 6 ka numero ubos sa QR",
    fil: "O ilagay ang 6 na numero sa ilalim ng QR",
    en: "Or type the 6-digit code under the QR",
  },
  "M-ON-01.pair.codeA11y": {
    ceb: "Pairing code, {n} sa 6 ka numero",
    fil: "Pairing code, {n} sa 6 na numero",
    en: "Pairing code, {n} of 6 digits",
  },
  "M-ON-01.pair.codeAction": {
    ceb: "Ikonektar kini nga telepono",
    fil: "Ikonekta ang teleponong ito",
    en: "Pair this phone",
  },
  "M-ON-01.pair.cameraDenied": {
    ceb: "Walay access sa camera. Isulat ang 6 ka numero gikan sa treasurer.",
    fil: "Walang access sa camera. Ilagay ang 6 na numero mula sa treasurer.",
    en: "No camera access. Type the 6-digit code from the treasurer.",
  },
  "M-ON-01.pair.openSettings": {
    ceb: "Tugoti sa Settings",
    fil: "Payagan sa Settings",
    en: "Allow in Settings",
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
    ceb: "Dili kini QR o code sa Fair Split. Susiha ug sulayi pag-usab.",
    fil: "Hindi ito QR o code ng Fair Split. Suriin at subukan muli.",
    en: "That isn't a Fair Split QR or code. Check it and try again.",
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

  /* Read or listen first (members, S1.9) */
  "M-ON-01.listen.title": {
    ceb: "Unsa ang una ninyong gusto: basahon o paminawon?",
    fil: "Ano po ang gusto ninyo muna: basahin o pakinggan?",
    en: "What would you like first: read or listen?",
  },
  "M-ON-01.listen.read": { ceb: "Basahon", fil: "Basahin", en: "Read" },
  "M-ON-01.listen.readHint": {
    ceb: "Makita dayon ang inyong bayad ug ang rason niini.",
    fil: "Makikita agad ang inyong bayad at ang dahilan nito.",
    en: "See your pay and the reasons for it at once.",
  },
  "M-ON-01.listen.listen": { ceb: "Paminawon una", fil: "Pakinggan muna", en: "Listen first" },
  "M-ON-01.listen.listenHint": {
    ceb: "Basahon kini og kusog para kaninyo inig abli.",
    fil: "Babasahin ito nang malakas para sa inyo pagbukas.",
    en: "It is read aloud to you when it opens.",
  },
  "M-ON-01.listen.play": {
    ceb: "Paminawa ang pananglitan",
    fil: "Pakinggan ang halimbawa",
    en: "Hear an example",
  },
  "M-ON-01.listen.sample": {
    ceb: "Maayong adlaw. Salamat sa inyong paghago. Ania ang inyong bayad karong season.",
    fil: "Magandang araw po. Salamat po sa inyong pagsisikap. Narito po ang inyong bayad ngayong season.",
    en: "Good day. Thank you for your hard work. Here is your pay this season.",
  },
  "M-ON-01.listen.change": {
    ceb: "Mausab ninyo kini bisan kanus-a sa inyong pahayag.",
    fil: "Mababago ninyo ito anumang oras sa inyong statement.",
    en: "You can change this any time on your statement.",
  },
});

export type OnboardingKey = keyof typeof messages | MessageKey;

/** For copy in a language other than the app's (the three-language first-run prompt, language samples). */
export function t(lang: Lang, key: OnboardingKey, args?: MessageArgs): string {
  return translateIn(messages, lang, key, args);
}
