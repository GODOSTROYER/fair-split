/**
 * Copy for M-CL-01 Scan and its outbox (CLERK slice).
 * Keys are `<screenId>.<key>`; the shell's own keys (common, tab, slab, seal) come from `_shims/i18n.ts`.
 * Pure data (tested in Node); screens read it through `useT()` from `./use-t`.
 * ceb and fil are machine-translated, pending native review (OD-2).
 */
import type { Lang } from "../../_shims/contracts";
import { defineMessages, type MessageArgs, type MessageKey, same, translateIn } from "../../_shims/i18n";

export const messages = defineMessages({
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
});

export type ClerkKey = keyof typeof messages | MessageKey;

/** For copy in a language other than the app's (the three-language first-run prompt, language chips). */
export function t(lang: Lang, key: ClerkKey, args?: MessageArgs): string {
  return translateIn(messages, lang, key, args);
}
