/**
 * TEMPORARY SHIM: replace with @fairsplit/i18n (ICU MessageFormat through i18next + i18next-icu) after WS-DS merges.
 *
 * Keys are `<screenId>.<key>` (S1.4); UI code holds no user-facing literals. Arguments use `{name}`.
 * Every ceb and fil string is machine-translated, pending native review (OD-2), and the app says so on member
 * surfaces until a native speaker signs off in i18n/REVIEW.md.
 */
import type { Lang } from "./contracts";

type Entry = Readonly<Record<Lang, string>>;
const same = (s: string): Entry => ({ ceb: s, fil: s, en: s });

export const messages = {
  "app.name": same("Fair Split"),
  "app.lockup": same("Fair Split: co-op payroll"),
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

  /* M-MB-01 Bayad */
  "M-MB-01.season": same("Season {code}"),
  "M-MB-01.paminawa": { ceb: "Paminawa", fil: "Pakinggan", en: "Listen" },
  "M-MB-01.paminawaHint": {
    ceb: "Paminawa ang inyong statement",
    fil: "Pakinggan ang inyong statement",
    en: "Listen to your statement",
  },
  "M-MB-01.kgRate": {
    ceb: "{kg} × {rate} kada kilo",
    fil: "{kg} × {rate} bawat kilo",
    en: "{kg} × {rate} a kg",
  },
  "M-MB-01.premium": same("Premium"),
  "M-MB-01.noDeductions": { ceb: "walay kaltas", fil: "walang kaltas", en: "no deductions" },
  "M-MB-01.bonus": { ceb: "Bonus sa kalidad", fil: "Bonus sa kalidad", en: "Quality bonus" },
  "M-MB-01.credit": { ceb: "Gibalik kaninyo", fil: "Ibinalik sa inyo", en: "Returned to you" },
  "M-MB-01.net": { ceb: "Inyong bayad", fil: "Inyong bayad", en: "Your pay" },
  "M-MB-01.ruleRef": same("{rule}, {card}"),
  "M-MB-01.expanded": {
    ceb: "{kg} × {rate} kada kilo ({rule}). Walay kaltas.",
    fil: "{kg} × {rate} bawat kilo ({rule}). Walang kaltas.",
    en: "{kg} × {rate} a kg ({rule}). No deductions.",
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
    ceb: "Ang kilo niini nga resibo dili pa final.",
    fil: "Hindi pa pinal ang kilo ng resibong ito.",
    en: "This slip's kilos are provisional.",
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

  /* M-CL-01 Scan, M-CK-02 outbox */
  "M-CL-01.title": same("Scan"),
  "M-CL-01.station": same("Purok 2 pickup"),
  "M-CL-01.fab": { ceb: "Scan resibo", fil: "Scan resibo", en: "Scan a slip" },
  "M-CL-01.offline": {
    ceb: "Walay signal. {n} ka resibo natipigan sa telepono.",
    fil: "Walang signal. {n} resibo ang nakatabi sa telepono.",
    en: "No signal. {n} slips saved on this phone.",
  },
  "M-CL-01.waiting": {
    ceb: "{n} ka resibo naghulat nga ipadala.",
    fil: "{n} resibo ang naghihintay maipadala.",
    en: "{n} slips waiting to send.",
  },
  "M-CL-01.allSent": { ceb: "Tanan napadala na.", fil: "Naipadala na lahat.", en: "Everything is sent." },
  "M-CL-01.today": { ceb: "Karong adlawa", fil: "Ngayong araw", en: "Today" },
  "M-CL-01.count": {
    ceb: "{n} ka resibo, {sent} napadala",
    fil: "{n} resibo, {sent} naipadala",
    en: "{n} slips, {sent} sent",
  },
  "M-CL-01.quality": {
    ceb: "Ngitngit kaayo. I-scan pag-usab.",
    fil: "Masyadong madilim. I-scan muli.",
    en: "Too dark. Scan again.",
  },
  "M-CL-01.duplicate": {
    ceb: "Napadala na sa {time}.",
    fil: "Naipadala na po noong {time}.",
    en: "Already sent at {time}.",
  },
  "M-CL-01.duplicateWaiting": {
    ceb: "Natipigan na kini sa {time}.",
    fil: "Naitabi na ito noong {time}.",
    en: "Already saved at {time}.",
  },
  "M-CL-01.saved": { ceb: "Natipigan. {n} ka panid.", fil: "Naitabi. {n} pahina.", en: "Saved. {n} pages." },
  "M-CL-01.unavailable": {
    ceb: "Walay document scanner niini nga telepono. Gamita ang camera.",
    fil: "Walang document scanner ang teleponong ito. Gamitin ang camera.",
    en: "This phone has no document scanner. Use the camera.",
  },
  "M-CL-01.samples": { ceb: "Sample nga resibo", fil: "Sample na resibo", en: "Sample slips" },
  "M-CL-01.samplesHint": {
    ceb: "Sa web, ang scanner nahimong sample nga resibo. Ang mga kuha para sa sunod nga pay run.",
    fil: "Sa web, nagiging sample na resibo ang scanner. Para sa susunod na pay run ang mga kuha.",
    en: "On the web the scanner becomes sample slips. Captures are filed for the next pay run.",
  },
  "M-CL-01.addSample": {
    ceb: "Idugang ang resibo {serial}",
    fil: "Idagdag ang resibo {serial}",
    en: "Add slip {serial}",
  },
  "M-CL-01.rescan": {
    ceb: "Gihangyo ni {name} nga i-scan pag-usab ang photo {photo}.",
    fil: "Hiniling ni {name} na i-scan muli ang photo {photo}.",
    en: "{name} asked you to rescan photo {photo}.",
  },
  "M-CL-01.capture": { ceb: "Kuhaa", fil: "Kunan", en: "Capture" },
  "M-CL-01.edgeGuide": {
    ceb: "Ibutang ang resibo sulod sa kahon",
    fil: "Ilagay ang resibo sa loob ng kahon",
    en: "Fit the slip inside the frame",
  },
  "M-CL-01.cameraDenied": {
    ceb: "Walay access sa camera. Ablihi ang settings sa telepono.",
    fil: "Walang access sa camera. Buksan ang settings ng telepono.",
    en: "No camera access. Open the phone's settings.",
  },
  "M-CL-02.title": same("Outbox"),
  "M-CL-02.empty": {
    ceb: "Wala pay resibo. Pindota ang Scan resibo.",
    fil: "Wala pang resibo. Pindutin ang Scan resibo.",
    en: "No slips yet. Tap Scan a slip.",
  },
  "M-CL-02.queued": { ceb: "Naghulat", fil: "Naghihintay", en: "Waiting" },
  "M-CL-02.uploading": { ceb: "Ginapadala", fil: "Ipinapadala", en: "Sending" },
  "M-CL-02.uploaded": { ceb: "Napadala", fil: "Naipadala", en: "Sent" },
  "M-CL-02.read": { ceb: "{n} ka linya nabasa", fil: "{n} linya ang nabasa", en: "{n} rows read" },
  "M-CL-02.retryIn": {
    ceb: "Mosulay pag-usab sa {s} s",
    fil: "Susubukan muli sa {s} s",
    en: "Retrying in {s} s",
  },
  "M-CL-02.refused": {
    ceb: "Wala gidawat sa server. Ipadala pag-usab kon andam na.",
    fil: "Hindi tinanggap ng server. Ipadala muli kapag handa na.",
    en: "The server didn't accept it. Send again when ready.",
  },
  "M-CL-02.sendNow": { ceb: "Ipadala karon", fil: "Ipadala ngayon", en: "Send now" },
  "M-CL-02.notRead": { ceb: "Wala pa mabasa", fil: "Hindi pa nababasa", en: "Not read yet" },
  "M-CL-02.serial": same("Resibo {serial}"),
  "M-CL-02.duplicateOf": {
    ceb: "Pareho sa resibo nga napadala na",
    fil: "Kapareho ng resibong naipadala na",
    en: "Same as a slip already sent",
  },
  "M-CL-02.sample": same("Synthetic sample"),

  /* M-BD-01 co-sign request */
  "M-BD-01.title": { ceb: "Pirma sa Board", fil: "Pirma ng Board", en: "Board co-sign" },
  "M-BD-01.request": {
    ceb: "Co-sign sa Season {season}: {n} ka bayad pinaagi sa PayPal",
    fil: "Co-sign sa Season {season}: {n} bayad sa PayPal",
    en: "Co-sign Season {season}: {n} payouts by PayPal",
  },
  "M-BD-01.why": {
    ceb: "Ngano ikaw: ang batch milapas sa {threshold}.",
    fil: "Bakit kayo: lumampas ang batch sa {threshold}.",
    en: "Why you: the batch is over {threshold}.",
  },
  "M-BD-01.holds": { ceb: "Nasulbad nga mga hold", fil: "Mga naayos na hold", en: "Holds resolved" },
  "M-BD-01.items": { ceb: "Mga bayad sa PayPal", fil: "Mga bayad sa PayPal", en: "PayPal payouts" },
  "M-BD-01.seal": {
    ceb: "Itandi ang selyo ug hash sa console",
    fil: "Ihambing ang selyo at hash sa console",
    en: "Compare the seal and hash with the console",
  },
  "M-BD-01.key1": {
    ceb: "Napirmahan na ni {name} (1 sa 2)",
    fil: "Napirmahan na ni {name} (1 sa 2)",
    en: "Signed by {name} (1 of 2)",
  },
  "M-BD-01.waitingKey1": {
    ceb: "Wala pa mopirma si {name}",
    fil: "Hindi pa pumipirma si {name}",
    en: "{name} hasn't signed yet",
  },
  "M-BD-01.presence": {
    ceb: "Naa si {name} sa approval screen",
    fil: "Nasa approval screen si {name}",
    en: "{name} is on the approval screen",
  },
  "M-BD-01.review": { ceb: "Padayon sa pagpirma", fil: "Magpatuloy sa pagpirma", en: "Continue to sign" },
  "M-BD-01.sendBack": { ceb: "Ipabalik kang {name}", fil: "Ibalik kay {name}", en: "Send back to {name}" },
  "M-BD-01.reason": { ceb: "Ngano? (kinahanglan)", fil: "Bakit? (kailangan)", en: "Why? (required)" },
  "M-BD-01.sendBackConfirm": { ceb: "Ipabalik", fil: "Ibalik", en: "Send back" },
  "M-BD-01.sentBack": {
    ceb: "Gipabalik kang {name}. Walay napirmahan.",
    fil: "Ibinalik kay {name}. Walang napirmahan.",
    en: "Sent back to {name}. Nothing was signed.",
  },
  "M-BD-01.expired": {
    ceb: "Nag-expire na ang hangyo. Pangayo og bag-o kang {name}.",
    fil: "Nag-expire na ang kahilingan. Humingi ng bago kay {name}.",
    en: "The co-sign request expired. Ask {name} to send it again.",
  },
  "M-BD-01.changed": {
    ceb: "Nausab ang batch human nimo kini giablihan. Walay napirmahan. Tan-awa pag-usab.",
    fil: "Nagbago ang batch matapos ninyong buksan. Walang napirmahan. Suriin muli.",
    en: "The batch changed after you opened it. Nothing was signed. Review again.",
  },
  "M-BD-01.offline": {
    ceb: "Kinahanglan og signal aron makapirma. Dili kini ipadala sa ulahi.",
    fil: "Kailangan ng signal para makapirma. Hindi ito ipapadala mamaya.",
    en: "Signing needs a connection. A signature is never sent later.",
  },
  "M-BD-01.empty": {
    ceb: "Walay naghulat sa inyong pirma.",
    fil: "Walang naghihintay sa inyong pirma.",
    en: "Nothing is waiting for your signature.",
  },
  "M-BD-01.expires": {
    ceb: "{batch}, mo-expire sa {time}",
    fil: "{batch}, mag-e-expire sa {time}",
    en: "{batch}, expires {time}",
  },
  "M-BD-01.signedAlready": {
    ceb: "Napirmahan na ninyo kini nga batch.",
    fil: "Napirmahan na ninyo ang batch na ito.",
    en: "You have signed this batch.",
  },

  "hold.DUPLICATE_SLIP": same("Same slip twice"),
  "hold.IMPLAUSIBLE_YIELD": same("More than the plot can grow"),
  "hold.NO_RULE": same("Deduction with no rule"),
  "hold.RATE_MISMATCH": same("Rate differs from the card"),
  "hold.SUSPECTED_INJECTION": same("Text that reads like an instruction"),
  "hold.LOW_CONFIDENCE": same("By hand"),
  "hold.MASS_BALANCE": same("Mass balance"),

  /* M-BD-02 sign */
  "M-BD-02.title": { ceb: "Pirmahi", fil: "Pirmahan", en: "Sign" },
  "M-BD-02.slab": { ceb: "Pirmahi", fil: "Pirmahan", en: "Sign" },
  "M-BD-02.caption": {
    ceb: "Kupti, dayon gamita ang inyong fingerprint.",
    fil: "Pindutin nang matagal, saka gamitin ang inyong fingerprint.",
    en: "Hold, then use your fingerprint.",
  },
  "M-BD-02.captionPin": {
    ceb: "Kupti, dayon isulat ang PIN sa telepono.",
    fil: "Pindutin nang matagal, saka ilagay ang PIN ng telepono.",
    en: "Hold, then enter the phone's PIN.",
  },
  "M-BD-02.captionDemo": {
    ceb: "Kupti aron mopirma gamit ang demo key.",
    fil: "Pindutin nang matagal para pumirma gamit ang demo key.",
    en: "Hold to sign with the demo key.",
  },
  "M-BD-02.another": {
    ceb: "Dili makakupti? Pirmahi sa laing paagi",
    fil: "Hindi makapindot nang matagal? Pumirma sa ibang paraan",
    en: "Can't hold? Sign another way",
  },
  "M-BD-02.holdUntil": {
    ceb: "Kupti hangtod mo-klik",
    fil: "Pindutin hanggang mag-click",
    en: "Hold until it clicks",
  },
  "M-BD-02.prompt": {
    ceb: "Pirmahi ang batch sa Season {season}",
    fil: "Pirmahan ang batch ng Season {season}",
    en: "Sign the Season {season} batch",
  },
  "M-BD-02.signing": { ceb: "Ginapirmahan", fil: "Pinipirmahan", en: "Signing" },
  "M-BD-02.signed": {
    ceb: "Napirmahan. Key {key}. Parehas ang batch hash sa console.",
    fil: "Napirmahan na. Key {key}. Pareho ang batch hash sa console.",
    en: "Signed. Key {key}. The batch hash matches the console.",
  },
  "M-BD-02.sealed": {
    ceb: "Giaprobahan ni {a} ug {b}",
    fil: "Inaprubahan nina {a} at {b}",
    en: "Approved by {a} and {b}",
  },
  "M-BD-02.cancelled": {
    ceb: "Wala napirmahi. Walay nausab.",
    fil: "Hindi napirmahan. Walang nagbago.",
    en: "Not signed. Nothing changed.",
  },
  "M-BD-02.mismatch": {
    ceb: "Lahi ang batch hash. Walay napirmahan.",
    fil: "Iba ang batch hash. Walang napirmahan.",
    en: "The batch hash is different. Nothing was signed.",
  },
  "M-BD-02.error": {
    ceb: "Wala nahuman ang pirma. Walay napadala. Sulayi pag-usab.",
    fil: "Hindi natapos ang pirma. Walang naipadala. Subukan muli.",
    en: "Signing didn't finish. Nothing was sent. Try again.",
  },
  "M-BD-02.noLock": {
    ceb: "Butangi og screen lock ang telepono aron makapirma.",
    fil: "Maglagay ng screen lock sa telepono para makapirma.",
    en: "Set a screen lock on this phone to sign.",
  },
  "M-BD-02.invalidated": {
    ceb: "Nausab ang fingerprint sa telepono. Ikonektar pag-usab aron makahimo og bag-ong key.",
    fil: "Nagbago ang fingerprint sa telepono. Ikonekta muli para gumawa ng bagong key.",
    en: "This phone's fingerprints changed. Pair again to make a new key.",
  },
  "M-BD-02.demoKey": same("Demo key (this browser)"),
  "M-BD-02.deviceKey": {
    ceb: "Key {key}, sa secure store sa telepono",
    fil: "Key {key}, nasa secure store ng telepono",
    en: "Key {key}, in this phone's secure store",
  },
  "M-BD-02.confirmTitle": {
    ceb: "Pirmahi kini nga batch?",
    fil: "Pirmahan ang batch na ito?",
    en: "Sign this batch?",
  },
  "M-BD-02.confirmBody": {
    ceb: "{n} ka bayad, {amount}, pinaagi sa PayPal. Kini magpadala og kwarta.",
    fil: "{n} bayad, {amount}, sa PayPal. Magpapadala ito ng pera.",
    en: "{n} payouts, {amount}, by PayPal. This moves money.",
  },
  "M-BD-02.confirmSign": { ceb: "Pirmahi", fil: "Pirmahan", en: "Sign" },
  "M-BD-02.srLabel": {
    ceb: "{label}, {amount}, magpadala og kwarta",
    fil: "{label}, {amount}, magpapadala ng pera",
    en: "{label}, {amount}, moves money",
  },
  "M-BD-02.progress": same("{pct}%"),

  /* /s/:token member link */
  "M-LINK.expired": {
    ceb: "Nag-expire na kini nga link. Pangayo og bag-o sa treasurer.",
    fil: "Nag-expire na ang link na ito. Humingi ng bago sa treasurer.",
    en: "This link has expired. Ask the treasurer for a new one.",
  },
  "M-LINK.invalid": {
    ceb: "Dili mabasa kini nga link.",
    fil: "Hindi mabasa ang link na ito.",
    en: "This link can't be read.",
  },
  "M-LINK.readOnly": { ceb: "Basahon lang", fil: "Para basahin lang", en: "Read only" },
} as const satisfies Record<string, Entry>;

export type MessageKey = keyof typeof messages;

export function translate(
  lang: Lang,
  key: MessageKey,
  args?: Readonly<Record<string, string | number>>,
): string {
  const entry: Entry = messages[key];
  const template = entry[lang] ?? entry.en;
  if (!args) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, name: string) =>
    name in args ? String(args[name]) : m,
  );
}
