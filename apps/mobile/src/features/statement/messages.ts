/**
 * Copy for M-MB-01…04 and the member's link: Bayad, Resibo, Paminawa, Pangutana (MEMBER slice).
 * Keys are `<screenId>.<key>`; the shell's own keys (common, tab, slab, seal) come from `_shims/i18n.ts`.
 * Pure data (tested in Node); screens read it through `useT()` from `./use-t`.
 *
 * Rules (S1.11): sentence case, no exclamation marks, a hold is "Gisusi pa" and never an error, PayPal is named as
 * the actor of anything PayPal did, a peso figure is "about … (estimate)" or exact cash. Figures arrive as
 * `{placeholders}` already formatted by `format.*`; no key carries a digit of its own except codes and citations.
 * ceb and fil are machine-translated, pending native review (OD-2).
 */
import type { Lang } from "../../_shims/contracts";
import { defineMessages, type MessageArgs, type MessageKey, same, translateIn } from "../../_shims/i18n";

export const messages = defineMessages({
  /* ------------------------------------------------------------ M-MB-01 Bayad: header and language */
  "M-MB-01.season": same("Season {code}"),
  "M-MB-01.glossOn": { ceb: "Ipakita ang English", fil: "Ipakita ang English", en: "Show English" },
  "M-MB-01.glossHint": {
    ceb: "English ilalom sa matag sentence",
    fil: "English sa ilalim ng bawat pangungusap",
    en: "English under each sentence",
  },

  /* ------------------------------------------------------------ the amount block and its states */
  "M-MB-01.kilosLabel": { ceb: "Inyong gidala", fil: "Inyong dinala", en: "You delivered" },
  "M-MB-01.expected": {
    ceb: "Gilauman nga petsa sa bayad: {date}",
    fil: "Inaasahang petsa ng bayad: {date}",
    en: "Expected pay date: {date}",
  },
  "M-MB-01.checking": {
    ceb: "Gisusi pa ang inyong linya. Walay kantidad hangtod mahuman ang pagsusi.",
    fil: "Sinusuri pa po ang inyong linya. Wala pang halaga hanggang matapos ang pagsusuri.",
    en: "Your line is still being checked. There is no amount until the check is done.",
  },
  "M-MB-01.held": {
    ceb: "Gisusi pa ang usa ka linya. Si Treasurer {name} ang mohukom.",
    fil: "Sinusuri pa po ang isang linya. Si Treasurer {name} ang magpapasya.",
    en: "One line is still being checked. Treasurer {name} decides.",
  },
  "M-MB-01.heldDated": {
    ceb: "Gisusi pa ang usa ka linya. Si Treasurer {name} ang mohukom sa dili pa ang {date}.",
    fil: "Sinusuri pa po ang isang linya. Si Treasurer {name} ang magpapasya bago ang {date}.",
    en: "One line is still being checked. Treasurer {name} decides by {date}.",
  },
  "M-MB-01.sent": {
    ceb: "Mabayad na kini kon mokumpirma na ang simulated PayPal sandbox.",
    fil: "Bayad na po ito kapag kinumpirma na ng simulated PayPal sandbox.",
    en: "It is paid once the simulated PayPal sandbox confirms payment.",
  },
  "M-MB-01.paid": {
    ceb: "Gikumpirma sa simulated PayPal sandbox ang bayad sa {date}, {time}.",
    fil: "Kinumpirma po ng simulated PayPal sandbox ang bayad noong {date}, {time}.",
    en: "Confirmed by the simulated PayPal sandbox on {date} at {time}.",
  },
  "M-MB-01.cashDue": {
    ceb: "Cash sa bodega, {date}. Gikan sa {usd} sa {rate} matag dolyar.",
    fil: "Cash sa bodega, {date}. Mula sa {usd} sa {rate} bawat dolyar.",
    en: "Cash at the bodega, {date}. From {usd} at {rate} a dollar.",
  },
  "M-MB-01.cashReceived": {
    ceb: "Nadawat sa bodega, {date}. Gikan sa {usd} sa {rate} matag dolyar.",
    fil: "Natanggap po sa bodega, {date}. Mula sa {usd} sa {rate} bawat dolyar.",
    en: "Received at the bodega, {date}. From {usd} at {rate} a dollar.",
  },
  "M-MB-01.cashUndated": {
    ceb: "Cash sa bodega. Gikan sa {usd} sa {rate} matag dolyar.",
    fil: "Cash sa bodega. Mula sa {usd} sa {rate} bawat dolyar.",
    en: "Cash at the bodega. From {usd} at {rate} a dollar.",
  },
  "M-MB-01.cashMoved": {
    ceb: "Wala madawat sa PayPal, busa gibalhin kini ni Treasurer {name} sa cash.",
    fil: "Hindi po natanggap sa PayPal, kaya inilipat ito ni Treasurer {name} sa cash.",
    en: "It was not received through PayPal, so Treasurer {name} moved it to cash.",
  },
  "M-MB-01.unclaimed": {
    ceb: "Si Treasurer {name} ang mohukom kung ibalhin kini sa cash.",
    fil: "Si Treasurer {name} ang magpapasya kung ililipat ito sa cash.",
    en: "Treasurer {name} will decide whether to move it to cash.",
  },
  "M-MB-01.returned": {
    ceb: "Si Treasurer {name} ang mohukom unsaon kini pagbayad kaninyo.",
    fil: "Si Treasurer {name} ang magpapasya kung paano ito ibabayad sa inyo.",
    en: "Treasurer {name} will decide how to pay it to you.",
  },
  "M-MB-01.paypalHeld": {
    ceb: "Gisusi pa kini sa PayPal. Si Treasurer {name} ang mosubay.",
    fil: "Sinusuri pa po ito ng PayPal. Si Treasurer {name} ang sumusubaybay.",
    en: "PayPal is still checking it. Treasurer {name} is following it up.",
  },
  "M-MB-01.needsAction": {
    ceb: "Si Treasurer {name} ang motabang aron mahuman kini.",
    fil: "Si Treasurer {name} ang tutulong para matapos ito.",
    en: "Treasurer {name} will help get it done.",
  },
  "M-MB-01.reversed": {
    ceb: "Gisusi kini ni Treasurer {name}.",
    fil: "Sinusuri ito ni Treasurer {name}.",
    en: "Treasurer {name} is looking into it.",
  },
  "M-MB-01.excluded": {
    ceb: "Ibalhin kini sa sunod nga bayad. Gitipigan para kaninyo, dili ihatag sa uban.",
    fil: "Ililipat po ito sa susunod na bayad. Nakalaan para sa inyo, hindi ibibigay sa iba.",
    en: "Moved to the next pay run. Reserved for you, never shared out.",
  },
  "M-MB-01.unbalanced": {
    ceb: "Gisusi pa: dili tugma ang mga numero niini nga linya. Si Treasurer {name} ang mosusi.",
    fil: "Sinusuri pa po: hindi tugma ang mga numero ng linyang ito. Susuriin ito ni Treasurer {name}.",
    en: "Still being checked: the figures on this line don't add up. Treasurer {name} will check them.",
  },

  /* ------------------------------------------------------------ Paminawa slab */
  "M-MB-01.paminawa": { ceb: "Paminawa", fil: "Pakinggan", en: "Listen" },
  "M-MB-01.paminawaHint": {
    ceb: "Paminawa ang inyong statement",
    fil: "Pakinggan ang inyong statement",
    en: "Listen to your statement",
  },

  /* ------------------------------------------------------------ ReceiptBar and MM-7 traces */
  "M-MB-01.share": {
    ceb: "Inyong {kg} sa {coopKg} nga na-verify nga kilo sa co-op",
    fil: "Ang inyong {kg} sa {coopKg} na beripikadong kilo ng co-op",
    en: "Your {kg} of the co-op's {coopKg} verified kilos",
  },
  "M-MB-01.premium": same("Premium"),
  "M-MB-01.noDeductions": { ceb: "walay kaltas", fil: "walang kaltas", en: "no deductions" },
  "M-MB-01.bonus": { ceb: "Bonus sa kalidad", fil: "Bonus sa kalidad", en: "Quality bonus" },
  "M-MB-01.credit": { ceb: "Gibalik kaninyo", fil: "Ibinalik sa inyo", en: "Returned to you" },
  "M-MB-01.creditSlip": {
    ceb: "Multa sa resibo {slip} nga walay lagda",
    fil: "Multa sa resibo {slip} na walang tuntunin",
    en: "Fine on slip {slip} with no rule",
  },
  "M-MB-01.net": { ceb: "Inyong bayad", fil: "Inyong bayad", en: "Your pay" },
  "M-MB-01.ruleRef": same("{card}, Schedule A"),
  "M-MB-01.minus": { ceb: "minus {amount}", fil: "bawas {amount}", en: "minus {amount}" },
  "M-MB-01.fees": {
    ceb: "PayPal: {paypal} kung ilisan sa peso. GCash: {gcash} kung ibalhin. Dili kini kaltas sa co-op.",
    fil: "PayPal: {paypal} kapag pinalitan sa piso. GCash: {gcash} kapag inilipat. Hindi ito kaltas ng co-op.",
    en: "PayPal: {paypal} to change it to pesos. GCash: {gcash} to move it there. Not a co-op deduction.",
  },
  "M-MB-01.tapHint": {
    ceb: "Tuplia aron makita kung asa kini gikan",
    fil: "Pindutin para makita kung saan ito galing",
    en: "Tap to see where this comes from",
  },
  "M-MB-01.tracePremium": {
    ceb: "Inyong {kg} sa {coopKg} nga na-verify nga kilo sa co-op ({rule}). Walay kaltas.",
    fil: "Ang inyong {kg} sa {coopKg} na beripikadong kilo ng co-op ({rule}). Walang kaltas.",
    en: "Your {kg} of the co-op's {coopKg} verified kilos ({rule}). No deductions.",
  },
  "M-MB-01.traceBonus": {
    ceb: "Bonus sa kalidad para sa inyong {kg} nga Grade 1.",
    fil: "Bonus sa kalidad para sa inyong {kg} na Grade 1.",
    en: "The quality bonus for your {kg} of Grade 1.",
  },
  "M-MB-01.traceDeduction": {
    ceb: "{label}: lagda {rule} sa {card}. Gi-ratify sa Board niadtong {date}, sa wala pa ang inyong unang resibo.",
    fil: "{label}: tuntunin {rule} ng {card}. Niratipika ng Board noong {date}, bago pa ang inyong unang resibo.",
    en: "{label}: rule {rule} of {card}. The Board ratified it on {date}, before your first slip.",
  },
  "M-MB-01.traceDeductionPlain": {
    ceb: "{label}: lagda {rule} sa {card}, gi-ratify sa Board niadtong {date}.",
    fil: "{label}: tuntunin {rule} ng {card}, niratipika ng Board noong {date}.",
    en: "{label}: rule {rule} of {card}, ratified by the Board on {date}.",
  },
  "M-MB-01.traceCredit": {
    ceb: "Ang {written} nga kaltas sa resibo {slip} wala sa rate card nga giaprobahan sa Board, mao nga gibalik kini kaninyo.",
    fil: "Ang {written} na bawas sa resibo {slip} ay wala po sa rate card na inaprubahan ng Board, kaya ibinabalik po namin ito.",
    en: "The {written} deduction on slip {slip} is not on the rate card the Board approved, so it comes back to you.",
  },
  "M-MB-01.traceNet": {
    ceb: "Gisusi niini nga telepono: eksakto ang suma hangtod sa sentimo.",
    fil: "Sinuri ng teleponong ito: eksakto ang suma hanggang sentimo.",
    en: "Checked on this phone: it adds up to the cent.",
  },
  "M-MB-01.traceNetOff": {
    ceb: "Dili tugma ang suma niini nga linya. Si Treasurer {name} ang mosusi.",
    fil: "Hindi tugma ang suma ng linyang ito. Susuriin ito ni Treasurer {name}.",
    en: "This line does not add up. Treasurer {name} will check it.",
  },
  "M-MB-01.traceFees": {
    ceb: "Gipatik nga rate, dili kaltas sa co-op. Gibanabana ang peso sa {rate} matag dolyar, ang rate niini nga bayad.",
    fil: "Nakalathalang rate, hindi kaltas ng co-op. Tantiya ang piso sa {rate} bawat dolyar, ang rate ng bayad na ito.",
    en: "Published rates, not co-op deductions. Pesos are estimated at {rate} a dollar, this pay run's rate.",
  },
  "M-MB-01.traceSlips": {
    ceb: "Tuplia ang resibo aron makita ang gisulat sa bodega.",
    fil: "Pindutin ang resibo para makita ang isinulat sa bodega.",
    en: "Tap a slip to see what was written at the bodega.",
  },

  /* ------------------------------------------------------------ slips, history, footer */
  "M-MB-01.slips": { ceb: "Gikan sa inyong resibo", fil: "Mula sa inyong mga resibo", en: "From your slips" },
  "M-MB-01.slipsTotal": { ceb: "Tanan: {kg}", fil: "Kabuuan: {kg}", en: "Together: {kg}" },
  "M-MB-01.history": { ceb: "Kasaysayan", fil: "Kasaysayan", en: "History" },
  "M-MB-01.historyApproved": {
    ceb: "Giaprobahan ni {a} ug {b}",
    fil: "Inaprubahan nina {a} at {b}",
    en: "Approved by {a} and {b}",
  },
  "M-MB-01.historySent": { ceb: "Gipadala", fil: "Ipinadala", en: "Sent" },
  "M-MB-01.historyPaid": { ceb: "Bayad na", fil: "Bayad na po", en: "Paid" },
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
  "M-MB-01.rateCard": {
    ceb: "Rate card {hash}, giaprobahan sa Board sa {date}",
    fil: "Rate card {hash}, inaprubahan ng Board noong {date}",
    en: "Rate card {hash}, approved by the Board on {date}",
  },
  "M-MB-01.sealCaption": {
    ceb: "Selyo sa batch nga gipirmahan ni {a} ug {b}",
    fil: "Selyo ng batch na pinirmahan nina {a} at {b}",
    en: "Batch seal signed by {a} and {b}",
  },

  /* ------------------------------------------------------------ Pangutana block (always last) */
  "M-MB-01.recheck": { ceb: "Ipasusi pag-usab", fil: "Ipasuri muli", en: "Ask for a re-check" },
  "M-MB-01.requestSent": {
    ceb: "Nadawat sa Komite, {date}.",
    fil: "Natanggap na po ng Komite, {date}.",
    en: "Received by the Committee, {date}.",
  },

  /* ------------------------------------------------------------ connection and loading */
  "M-MB-01.stale": {
    ceb: "Dili ma-update karon. Katapusang kopya, {time}.",
    fil: "Hindi ma-update ngayon. Huling kopya, {time}.",
    en: "Couldn't refresh. Last copy, {time}.",
  },
  "M-MB-01.loadFailed": {
    ceb: "Wala makuha ang inyong statement",
    fil: "Hindi nakuha ang inyong statement",
    en: "Your statement didn't load",
  },
  "M-MB-01.loadFailedBody": {
    ceb: "Sulayi pag-usab. Kon walay signal, sulayi inig naa nay signal.",
    fil: "Subukan muli. Kung walang signal, subukan kapag may signal na.",
    en: "Try again. With no signal, try once you have one.",
  },

  /* ------------------------------------------------------------ demo controls (labelled, I8) */
  "M-MB-01.demoTitle": same("Demo controls: simulated PayPal events, labelled"),
  "M-MB-01.demoSend": same("Approve and send"),
  "M-MB-01.demoConfirm": same("Simulated PayPal confirms"),
  "M-MB-01.demoUnclaimed": same("PayPal: unclaimed"),
  "M-MB-01.demoCash": same("Move to cash"),
  "M-MB-01.demoReceived": same("Cash received"),
  "M-MB-01.demoReset": same("Back to checking"),

  /* ------------------------------------------------------------ /s/:token member link */
  "M-MB-01.linkReadOnly": {
    ceb: "Basahon lang. Balido hangtod {date}.",
    fil: "Para basahin lang. May bisa hanggang {date}.",
    en: "Read only. Valid until {date}.",
  },
  "M-MB-01.linkTitle": {
    ceb: "Dili maablihan kini nga link",
    fil: "Hindi mabuksan ang link na ito",
    en: "This link can't open",
  },
  "M-MB-01.linkExpired": {
    ceb: "Nag-expire na kini nga link. Pangayo og bag-o sa treasurer.",
    fil: "Nag-expire na ang link na ito. Humingi ng bago sa treasurer.",
    en: "This link has expired. Ask the treasurer for a new one.",
  },
  "M-MB-01.linkInvalid": {
    ceb: "Dili mabasa kini nga link. Pangayo og bag-o sa treasurer.",
    fil: "Hindi mabasa ang link na ito. Humingi ng bago sa treasurer.",
    en: "This link can't be read. Ask the treasurer for a new one.",
  },

  /* ------------------------------------------------------------ the board's Bayad tab (run summary) */
  "M-MB-01.runItems": { ceb: "Mga bayad sa PayPal", fil: "Mga bayad sa PayPal", en: "PayPal payouts" },
  "M-MB-01.runRequest": {
    ceb: "Season {season}: {n} ka bayad pinaagi sa PayPal",
    fil: "Season {season}: {n} bayad sa PayPal",
    en: "Season {season}: {n} payouts by PayPal",
  },
  "M-MB-01.runSigned": {
    ceb: "Gipirmahan sa duha ka key",
    fil: "Pinirmahan ng dalawang key",
    en: "Signed with both keys",
  },
  "M-MB-01.runWaiting": {
    ceb: "Naghulat sa ikaduhang key",
    fil: "Naghihintay sa ikalawang key",
    en: "Waiting for the second key",
  },
  "M-MB-01.proof": { ceb: "Ablihi ang Proof", fil: "Buksan ang Proof", en: "Open Proof" },
  "M-MB-01.proofHint": {
    ceb: "Ang matag bayad, masusi sa bisan kinsa",
    fil: "Bawat bayad, masusuri ng kahit sino",
    en: "Every payment, checkable by anyone",
  },

  /* ------------------------------------------------------------ M-MB-02 Resibo */
  "M-MB-02.title": { ceb: "Inyong resibo", fil: "Inyong mga resibo", en: "Your slips" },
  "M-MB-02.subtitle": {
    ceb: "Gisulat sa bodega sa matag pagdala ninyo",
    fil: "Isinulat sa bodega sa bawat paghatid ninyo",
    en: "Written at the bodega each time you delivered",
  },
  "M-MB-02.total": { ceb: "Tanan", fil: "Kabuuan", en: "Together" },
  "M-MB-02.totalOff": {
    ceb: "Ang suma sa resibo dili pa tugma sa inyong linya. Gisusi pa kini.",
    fil: "Hindi pa tugma ang suma ng mga resibo sa inyong linya. Sinusuri pa ito.",
    en: "Your slips don't add up to your line yet. It is still being checked.",
  },
  "M-MB-02.mismatch": { ceb: "Dili tugma?", fil: "Hindi tugma?", en: "Doesn't match?" },
  "M-MB-02.mismatchHint": {
    ceb: "Ipasusi pag-usab ang inyong resibo",
    fil: "Ipasuri muli ang inyong resibo",
    en: "Ask for your slips to be re-checked",
  },
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
  "M-MB-02.slip": { ceb: "Resibo {serial}", fil: "Resibo {serial}", en: "Slip {serial}" },
  "M-MB-02.slipLabel": {
    ceb: "Resibo {serial}, {date}, {kg}",
    fil: "Resibo {serial}, {date}, {kg}",
    en: "Slip {serial}, {date}, {kg}",
  },
  "M-MB-02.written": {
    ceb: "Gisulat sa bodega, {date}",
    fil: "Isinulat sa bodega, {date}",
    en: "Written at the bodega, {date}",
  },
  "M-MB-02.close": { ceb: "Balik", fil: "Bumalik", en: "Back" },
  "M-MB-02.zoomListen": {
    ceb: "Paminawa kini nga bahin",
    fil: "Pakinggan ang bahaging ito",
    en: "Listen to this part",
  },
  "M-MB-02.emptyTitle": { ceb: "Wala pay resibo", fil: "Wala pang resibo", en: "No slips yet" },
  "M-MB-02.emptyBody": {
    ceb: "Makita dinhi ang inyong resibo inig basa na sa co-op.",
    fil: "Makikita rito ang inyong mga resibo kapag nabasa na ng co-op.",
    en: "Your slips appear here once the co-op has read them.",
  },
  /** Printed words on the slip template (slip-v1): the paper's own language, the same on every phone. */
  "M-MB-02.formTitle": same("Weigh slip"),
  "M-MB-02.formNo": same("No. {serial}"),
  "M-MB-02.formDate": same("Date"),
  "M-MB-02.formMember": same("Member No."),
  "M-MB-02.formName": same("Name"),
  "M-MB-02.formNet": same("Net kg"),
  "M-MB-02.formGrade": same("Grade"),

  /* ------------------------------------------------------------ M-MB-03 Paminawa */
  "M-MB-03.title": { ceb: "Paminawa", fil: "Pakinggan", en: "Listen" },
  "M-MB-03.play": { ceb: "I-play", fil: "I-play", en: "Play" },
  "M-MB-03.pause": { ceb: "Hunonga", fil: "Ihinto", en: "Pause" },
  "M-MB-03.slow": { ceb: "Hinay", fil: "Dahan-dahan", en: "Slower" },
  "M-MB-03.slowValue": same("0.85×"),
  "M-MB-03.restart": { ceb: "Sugdi pag-usab", fil: "Ulitin", en: "Start again" },
  "M-MB-03.progress": { ceb: "{n} sa {total}", fil: "{n} sa {total}", en: "{n} of {total}" },
  "M-MB-03.playFrom": { ceb: "Paminawa gikan dinhi", fil: "Pakinggan mula rito", en: "Play from here" },
  "M-MB-03.synthetic": {
    ceb: "Sintetikong tingog (Gemini TTS)",
    fil: "Sintetikong boses (Gemini TTS)",
    en: "Synthetic voice (Gemini TTS)",
  },
  "M-MB-03.deviceVoiceNote": {
    ceb: "Ang sintetikong tingog moabot pa.",
    fil: "Darating pa ang sintetikong boses.",
    en: "The synthetic voice is on its way.",
  },
  "M-MB-03.mixed": {
    ceb: "Sintetikong tingog ug tingog sa telepono",
    fil: "Sintetikong boses at boses ng telepono",
    en: "Synthetic voice and the phone's own voice",
  },
  "M-MB-03.filipinoAudio": {
    ceb: "Audio sa Filipino; teksto sa Cebuano",
    fil: "Audio sa Filipino; teksto sa Cebuano",
    en: "Filipino audio; Cebuano text",
  },
  "M-MB-03.textOnly": {
    ceb: "Walay tingog para sa {lang} niini nga telepono. Basaha ang teksto.",
    fil: "Walang boses para sa {lang} ang teleponong ito. Basahin ang teksto.",
    en: "This phone has no {lang} voice. Read the text.",
  },
  "M-MB-03.offline": {
    ceb: "Walay signal. Ang tingog sa telepono ang mobasa.",
    fil: "Walang signal. Ang boses ng telepono ang magbabasa.",
    en: "No signal. The phone's own voice reads it.",
  },
  "M-MB-03.lockTitle": { ceb: "Inyong statement", fil: "Inyong statement", en: "Your statement" },

  /* ------------------------------------------------------------ M-MB-04 Pangutana */
  "M-MB-04.title": { ceb: "Pangutana", fil: "Mga tanong", en: "Questions" },
  "M-MB-04.whoTitle": { ceb: "Kinsa ang pangutan-on", fil: "Sino ang tatanungin", en: "Who to ask" },
  "M-MB-04.treasurer": same("Treasurer {name}"),
  "M-MB-04.treasurerOnly": same("Treasurer"),
  "M-MB-04.where": { ceb: "Opisina sa bodega", fil: "Opisina sa bodega", en: "The bodega office" },
  "M-MB-04.when": {
    ceb: "Naa siya sa bodega sa adlaw sa bayad, {date}.",
    fil: "Nasa bodega siya sa araw ng bayad, {date}.",
    en: "At the bodega on pay day, {date}.",
  },
  "M-MB-04.whenAny": {
    ceb: "Naa siya sa bodega sa mga adlaw sa pagtimbang.",
    fil: "Nasa bodega siya sa mga araw ng timbangan.",
    en: "At the bodega on weighing days.",
  },
  "M-MB-04.rights": {
    ceb: "Aduna moy katungod nga motan-aw sa mga rekord sa co-op.",
    fil: "May karapatan po kayong makita ang mga rekord ng co-op.",
    en: "You have the right to see the co-op's records.",
  },
  "M-MB-04.rightsCite": same("RA 9520, Art. 83"),
  "M-MB-04.loadFailed": {
    ceb: "Wala makuha ang inyong linya",
    fil: "Hindi nakuha ang inyong linya",
    en: "Your line didn't load",
  },
  "M-MB-04.loadFailedBody": {
    ceb: "Kinahanglan ang inyong linya aron makapangayo og pagsusi pag-usab. Sulayi pag-usab, o inig naa nay signal.",
    fil: "Kailangan ang inyong linya para makahiling ng muling pagsusuri. Subukan muli, o kapag may signal na.",
    en: "Asking for a re-check needs your line. Try again, or once you have a signal.",
  },
  "M-MB-04.recheckTitle": { ceb: "Ipasusi pag-usab", fil: "Ipasuri muli", en: "Ask for a re-check" },
  "M-MB-04.recheckBody": {
    ceb: "Ipadala ang inyong linya ug resibo sa Komite sa Mediation ug Conciliation. Dili kini mausab sa inyong bayad samtang gisusi.",
    fil: "Ipadala ang inyong linya at resibo sa Mediation and Conciliation Committee. Hindi nito babaguhin ang inyong bayad habang sinusuri.",
    en: "Send your line and a slip to the Mediation and Conciliation Committee. Your pay does not change while they look.",
  },
  "M-MB-04.committee": same("Mediation and Conciliation Committee"),
  "M-MB-04.committeeCite": same("RA 9520, Art. 43"),
  "M-MB-04.pickSlip": { ceb: "Unsang resibo?", fil: "Aling resibo?", en: "Which slip?" },
  "M-MB-04.wholeLine": { ceb: "Ang tibuok linya", fil: "Ang buong linya", en: "The whole line" },
  "M-MB-04.note": {
    ceb: "Mubo nga sulat (dili kinahanglan)",
    fil: "Maikling tala (hindi kailangan)",
    en: "Short note (optional)",
  },
  "M-MB-04.noteCount": same("{n} / {max}"),
  "M-MB-04.send": { ceb: "Ipadala sa Komite", fil: "Ipadala sa Komite", en: "Send to the Committee" },
  "M-MB-04.sending": { ceb: "Ginapadala", fil: "Ipinapadala", en: "Sending" },
  "M-MB-04.sent": {
    ceb: "Nadawat sa Komite.",
    fil: "Natanggap na po ng Komite.",
    en: "Received by the Committee.",
  },
  "M-MB-04.sentAt": {
    ceb: "Nadawat sa Komite, {date} {time}.",
    fil: "Natanggap na po ng Komite, {date} {time}.",
    en: "Received by the Committee, {date} {time}.",
  },
  "M-MB-04.sentWhat": {
    ceb: "Gipadala: {what}",
    fil: "Ipinadala: {what}",
    en: "Sent: {what}",
  },
  "M-MB-04.sentNext": {
    ceb: "Ang tubag sa Komite makita dinhi, pirmado sa ilang inisyal.",
    fil: "Makikita rito ang sagot ng Komite, may inisyal nila.",
    en: "The Committee's answer appears here, initialled.",
  },
  "M-MB-04.failed": {
    ceb: "Wala napadala. Sulayi pag-usab.",
    fil: "Hindi naipadala. Subukan muli.",
    en: "Not sent. Try again.",
  },
  "M-MB-04.offline": {
    ceb: "Kinahanglan og signal aron ipadala.",
    fil: "Kailangan ng signal para maipadala.",
    en: "Sending needs a signal.",
  },
  "M-MB-04.yourRequest": { ceb: "Inyong hangyo", fil: "Inyong hiling", en: "Your request" },
});

export type StatementKey = keyof typeof messages | MessageKey;

/** For copy in a language other than the app's (the English gloss, language chips). */
export function t(lang: Lang, key: StatementKey, args?: MessageArgs): string {
  return translateIn(messages, lang, key, args);
}
