/**
 * Copy for M-CL-01 Scan (with cash day's "Nadawat" sheet) and M-CL-02 Outbox (CLERK slice).
 * Keys are `<screenId>.<key>`; the shell's own keys (common, tab, slab, seal) come from `_shims/i18n.ts`.
 * Pure data (tested in Node); screens read it through `useT()` from `./use-t`.
 * ceb and fil are machine-translated, pending native review (OD-2).
 *
 * Counts: Cebuano and Filipino nouns do not inflect ("3 ka resibo"), English does, so a counted phrase has a
 * `.one` and an `.other` key and `plural()` picks one (S1.13: the app registers its own plural rule).
 */
import type { Lang } from "../../_shims/contracts";
import { defineMessages, type MessageArgs, type MessageKey, same, translateIn } from "../../_shims/i18n";

export const messages = defineMessages({
  /* ---------------------------------------------------------------- M-CL-01 Scan */
  "M-CL-01.title": same("Scan"),
  "M-CL-01.station": same("Purok 2 pickup"),
  "M-CL-01.stationSr": {
    ceb: "Estasyon: {station}",
    fil: "Istasyon: {station}",
    en: "Station: {station}",
  },
  "M-CL-01.scan": { ceb: "Scan resibo", fil: "I-scan ang resibo", en: "Scan a slip" },
  "M-CL-01.scanSr": {
    ceb: "Scan resibo. Moabli ang scanner; matipig sa telepono bisan walay signal.",
    fil: "I-scan ang resibo. Bubukas ang scanner; maitatabi sa telepono kahit walang signal.",
    en: "Scan a slip. Opens the scanner; saved on this phone even without signal.",
  },
  "M-CL-01.addSampleNext": {
    ceb: "Idugang ang sample nga resibo",
    fil: "Idagdag ang sample na resibo",
    en: "Add a sample slip",
  },
  "M-CL-01.scanning": {
    ceb: "Gi-andam ang litrato",
    fil: "Inihahanda ang litrato",
    en: "Preparing the photo",
  },

  "M-CL-01.offline.one": {
    ceb: "Walay signal. {n} ka resibo natipigan sa telepono.",
    fil: "Walang signal. {n} resibo ang nakatabi sa telepono.",
    en: "No signal. {n} slip saved on this phone.",
  },
  "M-CL-01.offline.other": {
    ceb: "Walay signal. {n} ka resibo natipigan sa telepono.",
    fil: "Walang signal. {n} resibo ang nakatabi sa telepono.",
    en: "No signal. {n} slips saved on this phone.",
  },
  "M-CL-01.offlineEmpty": {
    ceb: "Walay signal. Padayon sa pag-scan: matipig kini sa telepono.",
    fil: "Walang signal. Tuloy lang sa pag-scan: itatabi ito sa telepono.",
    en: "No signal. Keep scanning: slips are saved on this phone.",
  },
  "M-CL-01.offlineAfter": {
    ceb: "Mapadala kini inig balik sa signal.",
    fil: "Maipapadala ito pagbalik ng signal.",
    en: "They go out by themselves when signal returns.",
  },
  "M-CL-01.waiting.one": {
    ceb: "{n} ka resibo naghulat nga ipadala.",
    fil: "{n} resibo ang naghihintay maipadala.",
    en: "{n} slip waiting to send.",
  },
  "M-CL-01.waiting.other": {
    ceb: "{n} ka resibo naghulat nga ipadala.",
    fil: "{n} resibo ang naghihintay maipadala.",
    en: "{n} slips waiting to send.",
  },
  "M-CL-01.refused.one": {
    ceb: "{n} ka resibo wala madawat. Tan-awa sa Outbox.",
    fil: "{n} resibo ang hindi natanggap. Tingnan sa Outbox.",
    en: "{n} slip wasn't accepted. Look in the Outbox.",
  },
  "M-CL-01.refused.other": {
    ceb: "{n} ka resibo wala madawat. Tan-awa sa Outbox.",
    fil: "{n} resibo ang hindi natanggap. Tingnan sa Outbox.",
    en: "{n} slips weren't accepted. Look in the Outbox.",
  },
  "M-CL-01.allSent": {
    ceb: "Tanan napadala na sa co-op.",
    fil: "Naipadala na lahat sa co-op.",
    en: "Everything has reached the co-op.",
  },
  "M-CL-01.ready": {
    ceb: "Andam. Ang matag resibo matipig una sa telepono.",
    fil: "Handa na. Itatabi muna sa telepono ang bawat resibo.",
    en: "Ready. Every slip is saved on this phone first.",
  },

  "M-CL-01.today": { ceb: "Karong adlawa", fil: "Ngayong araw", en: "Today" },
  "M-CL-01.tally.one": {
    ceb: "{n} ka resibo: {sent} napadala, {phone} sa telepono.",
    fil: "{n} resibo: {sent} naipadala, {phone} nasa telepono.",
    en: "{n} slip: {sent} sent, {phone} on this phone.",
  },
  "M-CL-01.tally.other": {
    ceb: "{n} ka resibo: {sent} napadala, {phone} sa telepono.",
    fil: "{n} resibo: {sent} naipadala, {phone} nasa telepono.",
    en: "{n} slips: {sent} sent, {phone} on this phone.",
  },
  "M-CL-01.tallyEmpty": {
    ceb: "Wala pay resibo karong adlawa.",
    fil: "Wala pang resibo ngayong araw.",
    en: "No slips yet today.",
  },
  "M-CL-01.tallyMore": same("+{n}"),
  "M-CL-01.recent": { ceb: "Bag-ong na-scan", fil: "Bagong na-scan", en: "Just scanned" },
  "M-CL-01.seeAll": {
    ceb: "Tan-awa tanan sa Outbox",
    fil: "Tingnan lahat sa Outbox",
    en: "See everything in the Outbox",
  },

  "M-CL-01.saved.one": {
    ceb: "Natipigan. {n} ka panid.",
    fil: "Naitabi. {n} pahina.",
    en: "Saved. {n} page.",
  },
  "M-CL-01.saved.other": {
    ceb: "Natipigan. {n} ka panid.",
    fil: "Naitabi. {n} pahina.",
    en: "Saved. {n} pages.",
  },
  "M-CL-01.duplicate": {
    ceb: "Napadala na kini sa {time}.",
    fil: "Naipadala na ito noong {time}.",
    en: "Already sent at {time}.",
  },
  "M-CL-01.duplicateWaiting": {
    ceb: "Natipigan na kini sa {time}.",
    fil: "Naitabi na ito noong {time}.",
    en: "Already saved at {time}.",
  },
  "M-CL-01.view": { ceb: "Tan-awa", fil: "Tingnan", en: "View" },
  "M-CL-01.saveFailed": {
    ceb: "Wala matipigi ang litrato sa telepono. I-scan pag-usab.",
    fil: "Hindi naitabi ang litrato sa telepono. I-scan muli.",
    en: "The photo wasn't saved on this phone. Scan it again.",
  },

  "M-CL-01.qualityTitle": { ceb: "Ngitngit kaayo", fil: "Masyadong madilim", en: "Too dark" },
  "M-CL-01.quality": {
    ceb: "Ngitngit kaayo. I-scan pag-usab.",
    fil: "Masyadong madilim. I-scan muli.",
    en: "Too dark. Scan again.",
  },
  "M-CL-01.qualitySmallTitle": {
    ceb: "Gamay kaayo ang litrato",
    fil: "Masyadong maliit ang litrato",
    en: "The photo is too small",
  },
  "M-CL-01.qualitySmall": {
    ceb: "Gamay kaayo ang litrato. I-scan pag-usab.",
    fil: "Masyadong maliit ang litrato. I-scan muli.",
    en: "The photo is too small. Scan again.",
  },
  "M-CL-01.qualityBody": {
    ceb: "Basin dili mabasa ang mga numero. Mas maayo i-scan pag-usab sa hayag nga dapit.",
    fil: "Baka hindi mabasa ang mga numero. Mas mabuting i-scan muli sa maliwanag na lugar.",
    en: "The numbers may not be readable. Scan it again somewhere brighter.",
  },
  "M-CL-01.qualityCount": {
    ceb: "Panid {i} sa {n}",
    fil: "Pahina {i} sa {n}",
    en: "Page {i} of {n}",
  },
  "M-CL-01.rescan": { ceb: "I-scan pag-usab", fil: "I-scan muli", en: "Scan again" },
  "M-CL-01.keep": { ceb: "Tipigi gihapon", fil: "Itabi pa rin", en: "Keep this page" },
  "M-CL-01.discarded": {
    ceb: "Wala gitipigi ang panid.",
    fil: "Hindi itinabi ang pahina.",
    en: "Page not kept.",
  },

  "M-CL-01.unavailable": {
    ceb: "Walay document scanner niini nga telepono. Gamita ang camera.",
    fil: "Walang document scanner ang teleponong ito. Gamitin ang camera.",
    en: "This phone has no document scanner. Use the camera.",
  },
  "M-CL-01.scannerError": {
    ceb: "Wala nahuman ang scanner. Sulayi pag-usab.",
    fil: "Hindi natapos ang scanner. Subukan muli.",
    en: "The scanner didn't finish. Try again.",
  },
  "M-CL-01.cameraTitle": {
    ceb: "Kuhai og litrato ang resibo",
    fil: "Kunan ng litrato ang resibo",
    en: "Photograph the slip",
  },
  "M-CL-01.capture": { ceb: "Kuhaa", fil: "Kunan", en: "Take photo" },
  "M-CL-01.edgeGuide": {
    ceb: "Ibutang ang resibo sulod sa kahon",
    fil: "Ilagay ang resibo sa loob ng kahon",
    en: "Fit the slip inside the frame",
  },
  "M-CL-01.cameraDenied": {
    ceb: "Walay access sa camera. Tugoti kini sa settings sa telepono.",
    fil: "Walang access sa camera. Payagan ito sa settings ng telepono.",
    en: "No camera access. Allow it in the phone's settings.",
  },
  "M-CL-01.cameraAsk": {
    ceb: "Tugoti ang camera",
    fil: "Payagan ang camera",
    en: "Allow the camera",
  },
  "M-CL-01.openSettings": {
    ceb: "Ablihi ang settings",
    fil: "Buksan ang settings",
    en: "Open settings",
  },
  "M-CL-01.library": {
    ceb: "Pili og litrato sa telepono",
    fil: "Pumili ng litrato sa telepono",
    en: "Choose a photo on this phone",
  },

  "M-CL-01.samples": { ceb: "Sample nga resibo", fil: "Sample na resibo", en: "Sample slips" },
  "M-CL-01.samplesHint": {
    ceb: "Gidrowing nga resibo para sa sunod nga pay run, nga adunay marka nga Synthetic sample.",
    fil: "Iginuhit na resibo para sa susunod na pay run, may markang Synthetic sample.",
    en: "Drawn slips for the next pay run, marked Synthetic sample.",
  },
  "M-CL-01.samplesOnly": {
    ceb: "Sa Judge Mode, sample nga resibo lang ang madawat sa co-op.",
    fil: "Sa Judge Mode, sample na resibo lang ang tinatanggap ng co-op.",
    en: "In Judge Mode the co-op accepts sample slips only.",
  },
  "M-CL-01.addSample": {
    ceb: "Idugang ang resibo {serial}",
    fil: "Idagdag ang resibo {serial}",
    en: "Add slip {serial}",
  },
  "M-CL-01.sampleSr": {
    ceb: "Sample nga resibo {serial}, {member}",
    fil: "Sample na resibo {serial}, {member}",
    en: "Sample slip {serial}, {member}",
  },
  "M-CL-01.sampleFiled": {
    ceb: "Natipigan na",
    fil: "Naitabi na",
    en: "Already filed",
  },

  /* ---------------------------------------------------------------- cash day (on M-CL-01) */
  "M-CL-01.cash.title": { ceb: "Cash sa bodega", fil: "Cash sa bodega", en: "Cash at the bodega" },
  "M-CL-01.cash.day": {
    ceb: "Adlaw sa cash: {date}",
    fil: "Araw ng cash: {date}",
    en: "Cash day: {date}",
  },
  "M-CL-01.cash.progress": {
    ceb: "{received} sa {total} nadawat na",
    fil: "{received} sa {total} ang natanggap na",
    en: "{received} of {total} received",
  },
  "M-CL-01.cash.notYet": {
    ceb: "Andam inig adlaw sa cash, {date}.",
    fil: "Handa sa araw ng cash, {date}.",
    en: "Available on cash day, {date}.",
  },
  "M-CL-01.cash.search": {
    ceb: "Pangitaa ang ngalan o numero",
    fil: "Hanapin ang pangalan o numero",
    en: "Search a name or member number",
  },
  "M-CL-01.cash.none": {
    ceb: "Walay cash nga bayad karon.",
    fil: "Walang cash na bayad ngayon.",
    en: "No cash payments right now.",
  },
  "M-CL-01.cash.noMatch": {
    ceb: "Walay nakit-an alang sa “{q}”.",
    fil: "Walang nahanap para sa “{q}”.",
    en: "Nothing found for “{q}”.",
  },
  "M-CL-01.cash.loading": {
    ceb: "Gikuha ang listahan sa cash",
    fil: "Kinukuha ang listahan ng cash",
    en: "Getting the cash list",
  },
  "M-CL-01.cash.loadError": {
    ceb: "Wala makuha ang listahan sa cash.",
    fil: "Hindi nakuha ang listahan ng cash.",
    en: "Couldn't get the cash list.",
  },
  "M-CL-01.cash.stale": {
    ceb: "Walay signal. Katapusang listahan, {time}.",
    fil: "Walang signal. Huling listahan, {time}.",
    en: "No signal. Last list, {time}.",
  },
  "M-CL-01.cash.movedFromPayPal": {
    ceb: "Gikan sa PayPal",
    fil: "Mula sa PayPal",
    en: "Moved from PayPal",
  },
  "M-CL-01.cash.onPhone": {
    ceb: "Natipigan sa telepono",
    fil: "Nakatabi sa telepono",
    en: "Saved on this phone",
  },
  "M-CL-01.cash.sending": { ceb: "Ginapadala", fil: "Ipinapadala", en: "Sending" },
  "M-CL-01.cash.recorded": {
    ceb: "Narekord sa co-op",
    fil: "Naitala sa co-op",
    en: "Recorded by the co-op",
  },
  "M-CL-01.cash.refused": {
    ceb: "Wala madawat sa co-op",
    fil: "Hindi natanggap ng co-op",
    en: "Not accepted by the co-op",
  },
  "M-CL-01.cash.rowSr": {
    ceb: "{name}, {member}, {amount}, {status}",
    fil: "{name}, {member}, {amount}, {status}",
    en: "{name}, {member}, {amount}, {status}",
  },
  "M-CL-01.cash.rowHint": {
    ceb: "Ablihi aron irekord ang cash",
    fil: "Buksan para itala ang cash",
    en: "Opens the cash receipt",
  },
  "M-CL-01.cash.receivedBy": {
    ceb: "Nadawat, {time}",
    fil: "Natanggap, {time}",
    en: "Received, {time}",
  },

  /* ---------------------------------------------------------------- the Nadawat sheet (cash receipt) */
  "M-CL-01.nadawat.member": {
    ceb: "{member}, andam sa bodega",
    fil: "{member}, handa sa bodega",
    en: "{member}, ready at the bodega",
  },
  "M-CL-01.nadawat.from": {
    ceb: "Gikan sa {usd} sa {rate} matag dolyar. Eksakto, dili gibanabana.",
    fil: "Mula sa {usd} sa {rate} bawat dolyar. Eksakto, hindi tantiya.",
    en: "From {usd} at {rate} to the dollar. Exact, not an estimate.",
  },
  "M-CL-01.nadawat.step1": {
    ceb: "Ipapirma o ipa-thumbmark sa miyembro ang kahon nga Nadawat sa iyang resibo.",
    fil: "Papirmahan o pa-thumbmark sa miyembro ang kahong Nadawat sa kanyang resibo.",
    en: "The member signs or thumbmarks the Nadawat box on the printed statement.",
  },
  "M-CL-01.nadawat.step2": {
    ceb: "Kuhai og litrato ang kahon nga Nadawat.",
    fil: "Kunan ng litrato ang kahong Nadawat.",
    en: "Photograph the Nadawat box.",
  },
  "M-CL-01.nadawat.step3": {
    ceb: "Ihatag ang cash, dayon markahi nga nadawat.",
    fil: "Iabot ang cash, saka markahang natanggap.",
    en: "Hand over the cash, then mark it received.",
  },
  "M-CL-01.nadawat.stepSr": {
    ceb: "Lakang {i} sa 3",
    fil: "Hakbang {i} sa 3",
    en: "Step {i} of 3",
  },
  "M-CL-01.nadawat.photo": { ceb: "Kuhai og litrato", fil: "Kunan ng litrato", en: "Take the photo" },
  "M-CL-01.nadawat.retake": { ceb: "Kuhai pag-usab", fil: "Kunan muli", en: "Retake" },
  "M-CL-01.nadawat.sample": {
    ceb: "Gamita ang sample nga litrato",
    fil: "Gamitin ang sample na litrato",
    en: "Use a sample photo",
  },
  "M-CL-01.nadawat.photoSr": {
    ceb: "Litrato sa kahon nga Nadawat, {size}",
    fil: "Litrato ng kahong Nadawat, {size}",
    en: "Photo of the Nadawat box, {size}",
  },
  "M-CL-01.nadawat.slab": { ceb: "Markahi nga nadawat", fil: "Markahang natanggap", en: "Mark received" },
  "M-CL-01.nadawat.slabSr": {
    ceb: "Markahi nga nadawat: {amount}, para kang {name}. Mausab ang iyang linya.",
    fil: "Markahang natanggap: {amount}, para kay {name}. Mababago ang kanyang linya.",
    en: "Mark received: {amount}, to {name}. Changes the member's line.",
  },
  "M-CL-01.nadawat.needPhoto": {
    ceb: "Kuhai una og litrato ang kahon.",
    fil: "Kunan muna ng litrato ang kahon.",
    en: "Photograph the box first.",
  },
  "M-CL-01.nadawat.held": {
    ceb: "Gisusi pa kini nga linya. Ayaw una ihatag ang cash.",
    fil: "Sinusuri pa ang linyang ito. Huwag munang iabot ang cash.",
    en: "This line is still being checked. Don't hand over cash yet.",
  },
  "M-CL-01.nadawat.done": {
    ceb: "Nadawat, {time}",
    fil: "Natanggap, {time}",
    en: "Received, {time}",
  },
  "M-CL-01.nadawat.doneOnPhone": {
    ceb: "Natipigan sa telepono. Mapadala kini inig naa nay signal.",
    fil: "Nakatabi sa telepono. Maipapadala ito kapag may signal na.",
    en: "Saved on this phone. It goes to the co-op when there is signal.",
  },
  "M-CL-01.nadawat.doneSent": {
    ceb: "Narekord sa co-op.",
    fil: "Naitala sa co-op.",
    en: "Recorded by the co-op.",
  },
  "M-CL-01.nadawat.doneRefused": {
    ceb: "Wala madawat sa co-op. Adto kang Treasurer {treasurer}.",
    fil: "Hindi natanggap ng co-op. Lumapit kay Treasurer {treasurer}.",
    en: "The co-op didn't accept it. See Treasurer {treasurer}.",
  },
  "M-CL-01.nadawat.stamp": {
    ceb: "Gimarkahan ni {initials}",
    fil: "Minarkahan ni {initials}",
    en: "Marked by {initials}",
  },
  "M-CL-01.nadawat.privacy": {
    ceb: "Ang co-op ang motipig sa litrato; ang hash ra niini ang makita sa Proof.",
    fil: "Ang co-op ang magtatabi ng litrato; ang hash lang nito ang makikita sa Proof.",
    en: "The co-op keeps the photo; Proof shows only its hash.",
  },
  "M-CL-01.nadawat.alreadyOnPhone": {
    ceb: "Natipigan na ang Nadawat niini sa {time}.",
    fil: "Naitabi na ang Nadawat nito noong {time}.",
    en: "This receipt was already saved at {time}.",
  },
  "M-CL-01.nadawat.photoFailed": {
    ceb: "Wala nakuha ang litrato. Sulayi pag-usab.",
    fil: "Hindi nakuha ang litrato. Subukan muli.",
    en: "The photo didn't save. Try again.",
  },

  /* ---------------------------------------------------------------- M-CL-02 Outbox */
  "M-CL-02.title": same("Outbox"),
  "M-CL-02.summary": {
    ceb: "{phone} sa telepono, {sent} napadala karong adlawa.",
    fil: "{phone} nasa telepono, {sent} naipadala ngayong araw.",
    en: "{phone} on this phone, {sent} sent today.",
  },
  "M-CL-02.summaryClear": {
    ceb: "Wala nay nahabilin sa telepono. {sent} napadala karong adlawa.",
    fil: "Wala nang naiwan sa telepono. {sent} ang naipadala ngayong araw.",
    en: "Nothing left on this phone. {sent} sent today.",
  },
  "M-CL-02.sendAll": { ceb: "Ipadala tanan karon", fil: "Ipadala lahat ngayon", en: "Send all now" },
  "M-CL-02.sectionPhone": { ceb: "Sa telepono", fil: "Nasa telepono", en: "On this phone" },
  "M-CL-02.sectionToday": {
    ceb: "Napadala karong adlawa",
    fil: "Naipadala ngayong araw",
    en: "Sent today",
  },
  "M-CL-02.sectionEarlier": { ceb: "Sayo pa", fil: "Mas maaga", en: "Earlier" },
  "M-CL-02.emptyTitle": { ceb: "Wala pay resibo", fil: "Wala pang resibo", en: "No slips yet" },
  "M-CL-02.emptyBody": {
    ceb: "Ang matag resibo nga imong i-scan makita dinhi hangtod makaabot sa co-op.",
    fil: "Makikita rito ang bawat resibong i-scan mo hanggang makarating sa co-op.",
    en: "Every slip you scan shows here until it reaches the co-op.",
  },
  "M-CL-02.queued": { ceb: "Naghulat sa iyang turno", fil: "Naghihintay ng turno", en: "Waiting its turn" },
  "M-CL-02.queuedOffline": {
    ceb: "Naghulat sa signal",
    fil: "Naghihintay ng signal",
    en: "Waiting for signal",
  },
  "M-CL-02.uploading": {
    ceb: "Ginapadala, {pct}%",
    fil: "Ipinapadala, {pct}%",
    en: "Sending, {pct}%",
  },
  "M-CL-02.uploaded": { ceb: "Napadala, {time}", fil: "Naipadala, {time}", en: "Sent, {time}" },
  "M-CL-02.recorded": {
    ceb: "Narekord sa co-op, {time}",
    fil: "Naitala sa co-op, {time}",
    en: "Recorded by the co-op, {time}",
  },
  "M-CL-02.read.one": {
    ceb: "{n} ka linya nabasa",
    fil: "{n} linya ang nabasa",
    en: "{n} row read",
  },
  "M-CL-02.read.other": {
    ceb: "{n} ka linya nabasa",
    fil: "{n} linya ang nabasa",
    en: "{n} rows read",
  },
  "M-CL-02.readBy": {
    ceb: "Gibasa sa Claude; susihon sa usa ka tawo ang dili sigurado",
    fil: "Binasa ng Claude; susuriin ng tao ang hindi tiyak",
    en: "Read by Claude; a person checks anything unsure",
  },
  "M-CL-02.retryIn": {
    ceb: "Mosulay pag-usab sa {s} s",
    fil: "Susubukan muli sa {s} s",
    en: "Retrying in {s} s",
  },
  "M-CL-02.retryInMin": {
    ceb: "Mosulay pag-usab sa {m} min",
    fil: "Susubukan muli sa {m} min",
    en: "Retrying in {m} min",
  },
  "M-CL-02.retryOffline": {
    ceb: "Mosulay pag-usab inig balik sa signal",
    fil: "Susubukan muli pagbalik ng signal",
    en: "Retrying when signal returns",
  },
  "M-CL-02.retryNow": { ceb: "Mosulay karon", fil: "Sinusubukan ngayon", en: "Trying now" },
  "M-CL-02.hintPortal": {
    ceb: "Ang Wi-Fi basin nangayo og login.",
    fil: "Baka humihingi ng login ang Wi-Fi.",
    en: "The Wi-Fi may be asking you to log in.",
  },
  "M-CL-02.refused": {
    ceb: "Wala madawat sa co-op ({code}). Ipadala pag-usab, o adto kang Treasurer {treasurer}.",
    fil: "Hindi natanggap ng co-op ({code}). Ipadala muli, o lumapit kay Treasurer {treasurer}.",
    en: "The co-op didn't accept it ({code}). Send it again, or see Treasurer {treasurer}.",
  },
  "M-CL-02.refusedAuth": {
    ceb: "Ipares pag-usab kini nga telepono sa treasurer, dayon ipadala.",
    fil: "Ipares muli ang teleponong ito sa treasurer, saka ipadala.",
    en: "Pair this phone with the treasurer again, then send.",
  },
  "M-CL-02.refusedMissing": {
    ceb: "Nawala ang litrato sa telepono. I-scan pag-usab ang resibo.",
    fil: "Nawala ang litrato sa telepono. I-scan muli ang resibo.",
    en: "The photo is gone from this phone. Scan the slip again.",
  },
  "M-CL-02.refusedTooLarge": {
    ceb: "Dako kaayo ang litrato. I-scan pag-usab.",
    fil: "Masyadong malaki ang litrato. I-scan muli.",
    en: "The photo is too large. Scan it again.",
  },
  "M-CL-02.refusedSamplesOnly": {
    ceb: "Sample nga resibo lang ang madawat sa Judge Mode.",
    fil: "Sample na resibo lang ang tinatanggap sa Judge Mode.",
    en: "Judge Mode accepts sample slips only.",
  },
  "M-CL-02.refusedLine": {
    ceb: "Dili na andam sa bodega kini nga linya. Adto kang Treasurer {treasurer}.",
    fil: "Hindi na handa sa bodega ang linyang ito. Lumapit kay Treasurer {treasurer}.",
    en: "This line is no longer ready at the bodega. See Treasurer {treasurer}.",
  },
  "M-CL-02.sendNow": { ceb: "Ipadala karon", fil: "Ipadala ngayon", en: "Send now" },
  "M-CL-02.sendNowSr": {
    ceb: "Ipadala karon: {title}",
    fil: "Ipadala ngayon: {title}",
    en: "Send now: {title}",
  },
  "M-CL-02.notRead": { ceb: "Wala pa mabasa", fil: "Hindi pa nababasa", en: "Not read yet" },
  "M-CL-02.serial": same("Resibo {serial}"),
  "M-CL-02.nadawat": {
    ceb: "Nadawat: {name}",
    fil: "Nadawat: {name}",
    en: "Cash receipt: {name}",
  },
  "M-CL-02.duplicateOf": {
    ceb: "Pareho sa resibo nga napadala na",
    fil: "Kapareho ng resibong naipadala na",
    en: "Same as a slip already sent",
  },
  "M-CL-02.meta": same("{size}, {time}"),
  "M-CL-02.rowSr": same("{title}. {status}. {meta}."),
  "M-CL-02.sent.one": {
    ceb: "{n} ka resibo napadala.",
    fil: "{n} resibo ang naipadala.",
    en: "{n} slip sent.",
  },
  "M-CL-02.sent.other": {
    ceb: "{n} ka resibo napadala.",
    fil: "{n} resibo ang naipadala.",
    en: "{n} slips sent.",
  },
  "M-CL-02.badgeSr": {
    ceb: "Outbox, {n} sa telepono",
    fil: "Outbox, {n} nasa telepono",
    en: "Outbox, {n} on this phone",
  },
});

export type ClerkKey = keyof typeof messages | MessageKey;

/** The bases that have both a `.one` and an `.other` key. */
export type PluralBase = {
  [K in keyof typeof messages]: K extends `${infer B}.one`
    ? `${B}.other` extends keyof typeof messages
      ? B
      : never
    : never;
}[keyof typeof messages];

/**
 * The counted key for `n` (S1.13): English says "1 slip" and "3 slips"; Cebuano and Filipino nouns do not
 * inflect, so both of their keys read the same.
 */
export function pluralKey(base: PluralBase, n: number): ClerkKey {
  return (n === 1 ? `${base}.one` : `${base}.other`) as ClerkKey;
}

/** For copy in a language other than the app's. */
export function t(lang: Lang, key: ClerkKey, args?: MessageArgs): string {
  return translateIn(messages, lang, key, args);
}
