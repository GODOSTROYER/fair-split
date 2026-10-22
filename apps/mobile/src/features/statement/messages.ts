/**
 * Copy for M-MB-01…04 and the member's link: Bayad, Resibo, Paminawa, Pangutana (MEMBER slice).
 * Keys are `<screenId>.<key>`; the shell's own keys (common, tab, slab, seal) come from `_shims/i18n.ts`.
 * Pure data (tested in Node); screens read it through `useT()` from `./use-t`.
 * ceb and fil are machine-translated, pending native review (OD-2).
 */
import type { Lang } from "../../_shims/contracts";
import { defineMessages, type MessageArgs, type MessageKey, same, translateIn } from "../../_shims/i18n";

export const messages = defineMessages({
  /* M-MB-01 Bayad */
  "M-MB-01.season": same("Season {code}"),
  "M-MB-01.paminawa": { ceb: "Paminawa", fil: "Pakinggan", en: "Listen" },
  "M-MB-01.paminawaHint": {
    ceb: "Paminawa ang inyong statement",
    fil: "Pakinggan ang inyong statement",
    en: "Listen to your statement",
  },
  "M-MB-01.premium": same("Premium"),
  "M-MB-01.noDeductions": { ceb: "walay kaltas", fil: "walang kaltas", en: "no deductions" },
  "M-MB-01.bonus": { ceb: "Bonus sa kalidad", fil: "Bonus sa kalidad", en: "Quality bonus" },
  "M-MB-01.credit": { ceb: "Gibalik kaninyo", fil: "Ibinalik sa inyo", en: "Returned to you" },
  "M-MB-01.net": { ceb: "Inyong bayad", fil: "Inyong bayad", en: "Your pay" },
  "M-MB-01.ruleRef": same("{card}, Schedule A"),
  "M-MB-01.expanded": {
    ceb: "Inyong {kg} sa {coopKg} nga na-verify nga kilo sa co-op ({rule}). Walay kaltas.",
    fil: "Ang inyong {kg} sa {coopKg} na beripikadong kilo ng co-op ({rule}). Walang kaltas.",
    en: "Your {kg} of the co-op's {coopKg} verified kilos ({rule}). No deductions.",
  },
  "M-MB-01.tapHint": {
    ceb: "Tuplia aron makita kung asa kini gikan",
    fil: "Pindutin para makita kung saan ito galing",
    en: "Tap to see where this comes from",
  },
  "M-MB-01.slips": { ceb: "Gikan sa inyong resibo", fil: "Mula sa inyong mga resibo", en: "From your slips" },
  "M-MB-01.history": { ceb: "Kasaysayan", fil: "Kasaysayan", en: "History" },
  "M-MB-01.historyApproved": {
    ceb: "Giaprobahan ni {a} ug {b}",
    fil: "Inaprubahan nina {a} at {b}",
    en: "Approved by {a} and {b}",
  },
  "M-MB-01.historySent": { ceb: "Gipadala", fil: "Ipinadala", en: "Sent" },
  "M-MB-01.historyPaid": { ceb: "Bayad na", fil: "Bayad na po", en: "Paid" },
  "M-MB-01.rateCard": {
    ceb: "Rate card {hash}, giaprobahan sa Board",
    fil: "Rate card {hash}, inaprubahan ng Board",
    en: "Rate card {hash}, approved by the Board",
  },
  "M-MB-01.recheck": { ceb: "Ipasusi pag-usab", fil: "Ipasuri muli", en: "Ask for a re-check" },
  "M-MB-01.capsuleDated": same("{word}, {date}"),
  "M-MB-01.checkingDetail": {
    ceb: "Gisusi pa ang inyong linya. Gilauman nga petsa: {date}.",
    fil: "Sinusuri pa po ang inyong linya. Inaasahang petsa: {date}.",
    en: "Your line is still being checked. Expected date: {date}.",
  },
  "M-MB-01.heldDetail": {
    ceb: "Gisusi pa ang usa ka linya. Si Treasurer {name} ang mohukom.",
    fil: "Sinusuri pa po ang isang linya. Si Treasurer {name} ang magpapasya.",
    en: "One line is still being checked. Treasurer {name} decides.",
  },
  "M-MB-01.unclaimedDetail": {
    ceb: "Wala madawat sa PayPal. Si Treasurer {name} ang mohukom kung ibalhin sa cash.",
    fil: "Hindi po natanggap sa PayPal. Si Treasurer {name} ang magpapasya kung ililipat sa cash.",
    en: "Not received through PayPal. Treasurer {name} will decide whether to move it to cash.",
  },
  "M-MB-01.needsActionDetail": {
    ceb: "Wala molampos sa PayPal. Si Treasurer {name} ang motabang.",
    fil: "Hindi po natuloy sa PayPal. Si Treasurer {name} ang tutulong.",
    en: "PayPal didn't complete it. Treasurer {name} will help.",
  },
  "M-MB-01.paypalHeldDetail": {
    ceb: "Gipugngan sa PayPal samtang gisusi.",
    fil: "Hinahawakan po ng PayPal habang sinusuri.",
    en: "PayPal is holding it while it checks.",
  },
  "M-MB-01.offlineCopy": {
    ceb: "Katapusang kopya, {time}",
    fil: "Huling kopya, {time}",
    en: "Last copy, {time}",
  },
  "M-MB-01.estimateNote": {
    ceb: "Ang peso gibanabana sa ₱{rate} kada US$1.",
    fil: "Tantiya ang peso sa ₱{rate} bawat US$1.",
    en: "Pesos are an estimate at ₱{rate} per US$1.",
  },
  "M-MB-01.demoTitle": same("Demo controls: simulated PayPal events, labelled"),
  "M-MB-01.demoSend": same("Approve and send"),
  "M-MB-01.demoConfirm": same("PayPal confirms"),
  "M-MB-01.demoUnclaimed": same("PayPal: unclaimed"),
  "M-MB-01.demoReset": same("Back to checking"),
  /* M-MB-02 Resibo */
  "M-MB-02.title": { ceb: "Inyong resibo", fil: "Inyong mga resibo", en: "Your slips" },
  "M-MB-02.subtitle": {
    ceb: "Sinulat ni {clerk} sa bodega",
    fil: "Isinulat ni {clerk} sa bodega",
    en: "Written by {clerk} at the bodega",
  },
  "M-MB-02.total": { ceb: "Tanan", fil: "Kabuuan", en: "Total" },
  "M-MB-02.mismatch": { ceb: "Dili tugma?", fil: "Hindi tugma?", en: "Doesn't match?" },
  "M-MB-02.photoPending": {
    ceb: "Sample pa ni. Ang tinuod nga litrato moabot pa.",
    fil: "Sample pa lang ito. Darating pa ang totoong larawan.",
    en: "Sample only. The reviewed photo is on its way.",
  },
  "M-MB-02.provisional": {
    ceb: "Sample nga kilo para sa demo.",
    fil: "Sample na kilo para sa demo.",
    en: "Sample kilos for the demo.",
  },
  "M-MB-02.slip": same("Resibo {serial}"),
  "M-MB-02.close": { ceb: "Balik sa statement", fil: "Bumalik sa statement", en: "Back to the statement" },
  /* M-MB-03 Paminawa */
  "M-MB-03.title": { ceb: "Paminawa", fil: "Pakinggan", en: "Listen" },
  "M-MB-03.play": { ceb: "I-play", fil: "I-play", en: "Play" },
  "M-MB-03.pause": { ceb: "Hunonga", fil: "Ihinto", en: "Pause" },
  "M-MB-03.slow": { ceb: "Hinay", fil: "Dahan-dahan", en: "Slower" },
  "M-MB-03.restart": { ceb: "Sugdi pag-usab", fil: "Ulitin", en: "Start again" },
  "M-MB-03.synthetic": {
    ceb: "Sintetikong tingog (Gemini TTS)",
    fil: "Sintetikong boses (Gemini TTS)",
    en: "Synthetic voice (Gemini TTS)",
  },
  "M-MB-03.deviceVoice": {
    ceb: "Tingog sa telepono. Ang sintetikong tingog moabot pa.",
    fil: "Boses ng telepono. Darating pa ang sintetikong boses.",
    en: "The phone's own voice. The synthetic voice is on its way.",
  },
  "M-MB-03.noVoice": {
    ceb: "Walay tingog niini nga telepono. Basaha ang teksto.",
    fil: "Walang boses ang teleponong ito. Basahin ang teksto.",
    en: "This phone has no voice for this language. Read the text.",
  },
  /* M-MB-04 Pangutana */
  "M-MB-04.title": { ceb: "Pangutana", fil: "Mga tanong", en: "Questions" },
  "M-MB-04.whoTitle": { ceb: "Kinsa ang pangutan-on", fil: "Sino ang tatanungin", en: "Who to ask" },
  "M-MB-04.where": { ceb: "Opisina sa bodega", fil: "Opisina sa bodega", en: "The bodega office" },
  "M-MB-04.when": {
    ceb: "Naa siya sa bodega sa adlaw sa bayad, {date}.",
    fil: "Nasa bodega siya sa araw ng bayad, {date}.",
    en: "At the bodega on cash day, {date}.",
  },
  "M-MB-04.rights": {
    ceb: "Aduna moy katungod nga motan-aw sa mga rekord sa co-op.",
    fil: "May karapatan po kayong makita ang mga rekord ng co-op.",
    en: "You have the right to see the co-op's records.",
  },
  "M-MB-04.rightsCite": same("RA 9520, Art. 83"),
  "M-MB-04.recheckTitle": { ceb: "Ipasusi pag-usab", fil: "Ipasuri muli", en: "Ask for a re-check" },
  "M-MB-04.recheckBody": {
    ceb: "Ipadala ang inyong linya ug resibo sa Mediation and Conciliation Committee.",
    fil: "Ipadala ang inyong linya at resibo sa Mediation and Conciliation Committee.",
    en: "Send your line and slip to the Mediation and Conciliation Committee.",
  },
  "M-MB-04.pickSlip": { ceb: "Unsang resibo?", fil: "Aling resibo?", en: "Which slip?" },
  "M-MB-04.wholeLine": { ceb: "Ang tibuok linya", fil: "Ang buong linya", en: "The whole line" },
  "M-MB-04.note": {
    ceb: "Mubo nga sulat (dili kinahanglan)",
    fil: "Maikling tala (hindi kailangan)",
    en: "Short note (optional)",
  },
  "M-MB-04.send": { ceb: "Ipadala sa Komite", fil: "Ipadala sa Komite", en: "Send to the Committee" },
  "M-MB-04.sent": {
    ceb: "Nadawat sa Komite.",
    fil: "Natanggap na po ng Komite.",
    en: "Received by the Committee.",
  },
  "M-MB-04.sending": { ceb: "Ginapadala", fil: "Ipinapadala", en: "Sending" },
  "M-MB-04.failed": {
    ceb: "Wala napadala. Sulayi pag-usab kon naa nay signal.",
    fil: "Hindi naipadala. Subukan muli kapag may signal.",
    en: "Not sent. Try again when you have signal.",
  },
  /* /s/:token member link */
  "M-MB-01.linkExpired": {
    ceb: "Nag-expire na kini nga link. Pangayo og bag-o sa treasurer.",
    fil: "Nag-expire na ang link na ito. Humingi ng bago sa treasurer.",
    en: "This link has expired. Ask the treasurer for a new one.",
  },
  "M-MB-01.linkInvalid": {
    ceb: "Dili mabasa kini nga link.",
    fil: "Hindi mabasa ang link na ito.",
    en: "This link can't be read.",
  },
  "M-MB-01.readOnly": { ceb: "Basahon lang", fil: "Para basahin lang", en: "Read only" },

  /* The board's Bayad tab shows the run when the registry does not list the Chair as a member */
  "M-MB-01.runItems": { ceb: "Mga bayad sa PayPal", fil: "Mga bayad sa PayPal", en: "PayPal payouts" },
  "M-MB-01.runRequest": {
    ceb: "Season {season}: {n} ka bayad pinaagi sa PayPal",
    fil: "Season {season}: {n} bayad sa PayPal",
    en: "Season {season}: {n} payouts by PayPal",
  },
  "M-MB-01.share": {
    ceb: "Inyong {kg} sa {coopKg} nga na-verify nga kilo sa co-op",
    fil: "Ang inyong {kg} sa {coopKg} na beripikadong kilo ng co-op",
    en: "Your {kg} of the co-op's {coopKg} verified kilos",
  },
  "M-MB-01.historyUnclaimed": {
    ceb: "Wala madawat sa PayPal",
    fil: "Hindi po natanggap sa PayPal",
    en: "Not received through PayPal",
  },
  "M-MB-01.historyCashDue": {
    ceb: "Andam sa bodega",
    fil: "Handa na po sa bodega",
    en: "Ready at the bodega",
  },
  "M-MB-01.historyReceived": { ceb: "Nadawat", fil: "Natanggap na po", en: "Received" },
  "M-MB-01.historyHeld": { ceb: "Gisusi pa", fil: "Sinusuri pa po", en: "Still checking" },
  "M-MB-01.creditSlip": {
    ceb: "Multa sa resibo {slip} nga walay lagda",
    fil: "Multa sa resibo {slip} na walang tuntunin",
    en: "Fine on slip {slip} with no rule",
  },
});

export type StatementKey = keyof typeof messages | MessageKey;

/** For copy in a language other than the app's (the three-language first-run prompt, language chips). */
export function t(lang: Lang, key: StatementKey, args?: MessageArgs): string {
  return translateIn(messages, lang, key, args);
}
