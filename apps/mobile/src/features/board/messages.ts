/**
 * Copy for M-BD-01 co-sign request and M-BD-02 sign, the hold kinds they list, and the push channels (BOARD slice).
 * Keys are `<screenId>.<key>`; the shell's own keys (common, tab, slab, seal) come from `_shims/i18n.ts`.
 * Pure data (tested in Node); screens read it through `useT()` from `./use-t`.
 * ceb and fil are machine-translated, pending native review (OD-2). S1.9's Cebuano lines are used as written.
 */
import type { Lang } from "../../_shims/contracts";
import { defineMessages, type MessageArgs, type MessageKey, same, translateIn } from "../../_shims/i18n";

export const messages = defineMessages({
  /* M-BD-01 co-sign request */
  "M-BD-01.heading": {
    ceb: "Pirmahan sa Season {season}",
    fil: "Pipirmahan sa Season {season}",
    en: "Co-sign Season {season}",
  },
  "M-BD-01.count": {
    ceb: "{n} ka bayad pinaagi sa PayPal",
    fil: "{n} bayad sa PayPal",
    en: "{n} payouts by PayPal",
  },
  "M-BD-01.why.batch": {
    ceb: "Ngano ikaw: ang batch milapas sa {threshold}.",
    fil: "Bakit kayo: lumampas ang batch sa {threshold}.",
    en: "Why you: the batch is over {threshold}.",
  },
  "M-BD-01.why.line": {
    ceb: "Ngano ikaw: usa ka bayad milapas sa limit sa rate card.",
    fil: "Bakit kayo: may isang bayad na lampas sa limitasyon ng rate card.",
    en: "Why you: one payout is over the rate card's limit.",
  },
  "M-BD-01.why.override": {
    ceb: "Ngano ikaw: adunay override nga kinahanglan sa Board.",
    fil: "Bakit kayo: may override na kailangan ng Board.",
    en: "Why you: an override needs the Board.",
  },
  "M-BD-01.holds": {
    ceb: "{n} ka hold, nasulbad",
    fil: "{n} hold, naayos na",
    en: "{n} holds, resolved",
  },
  "M-BD-01.holdBy": {
    ceb: "Gisulbad ni {name}, {time}",
    fil: "Inayos ni {name}, {time}",
    en: "Resolved by {name}, {time}",
  },
  "M-BD-01.holdA11y": {
    ceb: "{id}, {kind}. {resolved}.",
    fil: "{id}, {kind}. {resolved}.",
    en: "{id}, {kind}. {resolved}.",
  },
  /* The console's own summary of a hold is English until fs-api sends a localisable one: labelled as such. */
  "M-BD-01.holdNote": {
    ceb: "Gikan sa console, sa English",
    fil: "Mula sa console, sa English",
    en: "From the console",
  },
  "M-BD-01.seal": {
    ceb: "Itandi ang selyo ug ang hash sa console",
    fil: "Ihambing ang selyo at ang hash sa console",
    en: "Compare the seal and the hash with the console",
  },
  "M-BD-01.computed": {
    ceb: "Gikuwenta kini nga telepono gikan sa {n} ka bayad sa ubos",
    fil: "Kinuwenta ng teleponong ito mula sa {n} bayad sa ibaba",
    en: "Worked out on this phone from the {n} payouts below",
  },
  "M-BD-01.items": { ceb: "Mga bayad sa PayPal", fil: "Mga bayad sa PayPal", en: "PayPal payouts" },
  "M-BD-01.total": { ceb: "Tanan", fil: "Kabuuan", en: "Total" },
  "M-BD-01.key1": {
    ceb: "Napirmahan na ni {name}. Key 1 sa 2.",
    fil: "Napirmahan na ni {name}. Key 1 sa 2.",
    en: "Signed by {name}. Key 1 of 2.",
  },
  "M-BD-01.waitingKey1": {
    ceb: "Wala pa mopirma si {name}. Ang imo ang ikaduhang key.",
    fil: "Hindi pa pumipirma si {name}. Sa inyo ang ikalawang key.",
    en: "{name} hasn't signed yet. Yours is the second key.",
  },
  "M-BD-01.presence": {
    ceb: "Naa si {name} sa approval screen.",
    fil: "Nasa approval screen si {name}.",
    en: "{name} is on the approval screen.",
  },
  "M-BD-01.sign": {
    ceb: "Padayon sa pagpirma",
    fil: "Magpatuloy sa pagpirma",
    en: "Continue to sign",
  },
  "M-BD-01.sendBack": { ceb: "Ipabalik kang {name}", fil: "Ibalik kay {name}", en: "Send back to {name}" },
  "M-BD-01.sendBack.title": {
    ceb: "Ipabalik kang {name}?",
    fil: "Ibalik kay {name}?",
    en: "Send it back to {name}?",
  },
  "M-BD-01.sendBack.body": {
    ceb: "Walay mapirmahan. Mausab ni {name} ang batch ug padalhan ka og bag-o.",
    fil: "Walang mapipirmahan. Mababago ni {name} ang batch at padadalhan kayo ng bago.",
    en: "Nothing is signed. {name} can change the batch and send you a new one.",
  },
  "M-BD-01.sendBack.reason": {
    ceb: "Ngano? Makita kini ni {name}.",
    fil: "Bakit? Makikita ito ni {name}.",
    en: "Why? {name} will see this.",
  },
  "M-BD-01.sendBack.short": {
    ceb: "Isulat ang rason sa pipila ka pulong.",
    fil: "Isulat ang dahilan sa ilang salita.",
    en: "Write the reason in a few words.",
  },
  "M-BD-01.sendBack.confirm": { ceb: "Ipabalik", fil: "Ibalik", en: "Send back" },
  "M-BD-01.sendBack.failed": {
    ceb: "Wala naipabalik. Sulayi pag-usab.",
    fil: "Hindi naibalik. Subukan muli.",
    en: "It wasn't sent back. Try again.",
  },
  "M-BD-01.sentBack": {
    ceb: "Gipabalik kang {name}. Walay napirmahan.",
    fil: "Ibinalik kay {name}. Walang napirmahan.",
    en: "Sent back to {name}. Nothing was signed.",
  },
  "M-BD-01.override": {
    ceb: "Gihangyo ni {name} ang usa ka override. Ang imong pirma nag-uyon niini; ang Dili mobalik niini kaniya.",
    fil: "Humiling si {name} ng override. Ang pirma ninyo ay pagsang-ayon dito; ang Hindi ay ibabalik ito sa kanya.",
    en: "{name} asked for an override. Your signature agrees to it; No sends it back to her.",
  },
  "M-BD-01.overrideNo": { ceb: "Dili", fil: "Hindi", en: "No" },
  "M-BD-01.expired": {
    ceb: "Nag-expire na kini nga hangyo. Walay napirmahan. Pangayo og bag-o kang {name}.",
    fil: "Nag-expire na ang kahilingang ito. Walang napirmahan. Humingi ng bago kay {name}.",
    en: "This request expired. Nothing was signed. Ask {name} to send it again.",
  },
  "M-BD-01.changed": {
    ceb: "Nausab ang batch human nimo giablihan. Walay napirmahan. Susiha pag-usab.",
    fil: "Nagbago ang batch matapos ninyong buksan. Walang napirmahan. Suriin muli.",
    en: "The batch changed after you opened it. Nothing was signed. Review again.",
  },
  "M-BD-01.hashMismatch": {
    ceb: "Ang hash gikan sa server dili hash niini nga mga bayad. Walay mapirmahan. Sultihi si {name}.",
    fil: "Ang hash mula sa server ay hindi hash ng mga bayad na ito. Walang mapipirmahan. Sabihan si {name}.",
    en: "The server's hash is not the hash of these payouts. Nothing can be signed. Tell {name}.",
  },
  "M-BD-01.claimed": {
    ceb: "Server: {hash}",
    fil: "Server: {hash}",
    en: "Server: {hash}",
  },
  "M-BD-01.ours": {
    ceb: "Kini nga telepono: {hash}",
    fil: "Teleponong ito: {hash}",
    en: "This phone: {hash}",
  },
  "M-BD-01.reviewAgain": { ceb: "Susiha pag-usab", fil: "Suriin muli", en: "Review again" },
  "M-BD-01.offline": {
    ceb: "Kinahanglan og signal aron makapirma. Dili kini ipadala sa ulahi.",
    fil: "Kailangan ng signal para makapirma. Hindi ito ipapadala mamaya.",
    en: "Signing needs a connection. A signature is never sent later.",
  },
  "M-BD-01.none": {
    ceb: "Walay pirmahan karon.",
    fil: "Walang pipirmahan ngayon.",
    en: "Nothing to sign right now.",
  },
  "M-BD-01.noneBody": {
    ceb: "Sultihan ka sa Fair Split kon naay batch nga kinahanglan sa imong pirma.",
    fil: "Sasabihan kayo ng Fair Split kapag may batch na kailangan ng inyong pirma.",
    en: "Fair Split tells you when a batch needs your signature.",
  },
  "M-BD-01.error": {
    ceb: "Wala maablihi ang hangyo.",
    fil: "Hindi nabuksan ang kahilingan.",
    en: "The request didn't open.",
  },
  "M-BD-01.signed": {
    ceb: "Napirmahan na nimo kini nga batch.",
    fil: "Napirmahan na ninyo ang batch na ito.",
    en: "You signed this batch.",
  },
  "M-BD-01.approvedBy": {
    ceb: "Giaprobahan ni {a} ug {b}",
    fil: "Inaprubahan nina {a} at {b}",
    en: "Approved by {a} and {b}",
  },
  "M-BD-01.expires": {
    ceb: "Mo-expire sa {time}",
    fil: "Mag-e-expire sa {time}",
    en: "Expires at {time}",
  },
  "M-BD-01.batch": same("Batch {batch}"),
  "M-BD-01.language": { ceb: "Pinulongan", fil: "Wika", en: "Language" },
  "M-BD-01.push.label": same("Simulated push"),
  "M-BD-01.push.app": same("Fair Split"),
  "M-BD-01.push.now": { ceb: "karon", fil: "ngayon", en: "now" },
  "M-BD-01.push.title": {
    ceb: "Co-sign sa Season {season}: {n} ka bayad, {amount}",
    fil: "Co-sign sa Season {season}: {n} bayad, {amount}",
    en: "Co-sign Season {season}: {n} payouts, {amount}",
  },
  "M-BD-01.push.unconfigured": {
    ceb: "Wala pa ma-set ang mga pahibalo niini nga telepono. Ablihi ang Fair Split aron makita ang mga pirmahan.",
    fil: "Hindi pa naka-set ang mga abiso sa teleponong ito. Buksan ang Fair Split para makita ang mga pipirmahan.",
    en: "Notifications aren't set up on this phone yet. Open Fair Split to see what needs your signature.",
  },
  "M-BD-01.push.denied": {
    ceb: "Gipalong ang mga pahibalo sa Fair Split. Ablihi ang Fair Split aron makita ang mga pirmahan.",
    fil: "Nakapatay ang mga abiso ng Fair Split. Buksan ang Fair Split para makita ang mga pipirmahan.",
    en: "Notifications are off for Fair Split. Open Fair Split to see what needs your signature.",
  },
  "M-BD-01.push.openSettings": {
    ceb: "Ablihi ang Settings",
    fil: "Buksan ang Settings",
    en: "Open Settings",
  },

  /* Hold kinds as the Chair reads them (S1.11's console words, in his language) */
  "hold.DUPLICATE_SLIP": {
    ceb: "Usa ka resibo, giihap kaduha",
    fil: "Iisang resibo, binilang nang dalawang beses",
    en: "Same slip twice",
  },
  "hold.IMPLAUSIBLE_YIELD": {
    ceb: "Labaw sa kaya sa uma",
    fil: "Higit sa kaya ng taniman",
    en: "More than the plot can grow",
  },
  "hold.NO_RULE": {
    ceb: "Kaltas nga walay lagda",
    fil: "Bawas na walang patakaran",
    en: "Deduction with no rule",
  },
  "hold.RATE_MISMATCH": {
    ceb: "Lahi ang rate sa rate card",
    fil: "Iba ang rate sa rate card",
    en: "Rate differs from the card",
  },
  "hold.SUSPECTED_INJECTION": {
    ceb: "Sinulat nga morag mando",
    fil: "Sulat na parang utos",
    en: "Text that reads like an instruction",
  },
  "hold.LOW_CONFIDENCE": { ceb: "Gisulod sa kamot", fil: "Ipinasok nang mano-mano", en: "By hand" },
  "hold.MASS_BALANCE": { ceb: "Balanse sa timbang", fil: "Balanse ng timbang", en: "Mass balance" },

  /* M-BD-02 sign */
  "M-BD-02.title": { ceb: "Pirmahi ang batch", fil: "Pirmahan ang batch", en: "Sign the batch" },
  "M-BD-02.slab": { ceb: "Pirmahi", fil: "Pirmahan", en: "Sign" },
  "M-BD-02.caption.biometric": {
    ceb: "Kupti, dayon gamita ang inyong fingerprint.",
    fil: "Pindutin nang matagal, saka gamitin ang inyong fingerprint.",
    en: "Hold, then use your fingerprint.",
  },
  "M-BD-02.caption.pin": {
    ceb: "Kupti, dayon gamita ang fingerprint o PIN sa telepono.",
    fil: "Pindutin nang matagal, saka gamitin ang fingerprint o PIN ng telepono.",
    en: "Hold, then use your fingerprint or the phone's PIN.",
  },
  "M-BD-02.caption.demo": {
    ceb: "Kupti aron mopirma. Kini nga browser mopirma gamit ang demo key.",
    fil: "Pindutin nang matagal para pumirma. Pipirma ang browser na ito gamit ang demo key.",
    en: "Hold to sign. This browser signs with a demo key.",
  },
  "M-BD-02.another": {
    ceb: "Dili makakupti? Pirmahi sa laing paagi",
    fil: "Hindi makapindot nang matagal? Pumirma sa ibang paraan",
    en: "Can't hold? Sign another way",
  },
  "M-BD-02.prompt": {
    ceb: "Pirmahi ang batch sa Season {season}",
    fil: "Pirmahan ang batch ng Season {season}",
    en: "Sign the Season {season} batch",
  },
  "M-BD-02.promptDetail": {
    ceb: "{n} ka bayad, {amount}",
    fil: "{n} bayad, {amount}",
    en: "{n} payouts, {amount}",
  },
  "M-BD-02.signing": {
    ceb: "Ginapirmahan. Sunda ang telepono.",
    fil: "Pinipirmahan. Sundin ang telepono.",
    en: "Signing. Follow the phone.",
  },
  "M-BD-02.signingDemo": {
    ceb: "Ginapirmahan gamit ang demo key.",
    fil: "Pinipirmahan gamit ang demo key.",
    en: "Signing with the demo key.",
  },
  "M-BD-02.signed": {
    ceb: "Napirmahan. Key {key}. Parehas ang batch hash sa console.",
    fil: "Napirmahan. Key {key}. Pareho ang batch hash sa console.",
    en: "Signed. Key {key}. The batch hash matches the console.",
  },
  "M-BD-02.sealed": {
    ceb: "Giaprobahan ni {a} ug {b}",
    fil: "Inaprubahan nina {a} at {b}",
    en: "Approved by {a} and {b}",
  },
  "M-BD-02.next": {
    ceb: "Ipadala na sa PayPal ang {n} ka bayad.",
    fil: "Ipapadala na sa PayPal ang {n} bayad.",
    en: "The {n} payouts go to PayPal next.",
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
  "M-BD-02.stale": {
    ceb: "Gibag-o ang hangyo. Kupti pag-usab aron mopirma.",
    fil: "Na-refresh ang kahilingan. Pindutin muli nang matagal para pumirma.",
    en: "The request was refreshed. Hold again to sign.",
  },
  "M-BD-02.error": {
    ceb: "Wala nahuman ang pirma. Walay napadala. Sulayi pag-usab.",
    fil: "Hindi natapos ang pirma. Walang naipadala. Subukan muli.",
    en: "Signing didn't finish. Nothing was sent. Try again.",
  },
  "M-BD-02.noLock": {
    ceb: "Butangi og screen lock (PIN o fingerprint) ang telepono aron makapirma.",
    fil: "Maglagay ng screen lock (PIN o fingerprint) sa telepono para makapirma.",
    en: "Set a screen lock (PIN or fingerprint) on this phone to sign.",
  },
  "M-BD-02.invalidated": {
    ceb: "Nausab ang mga fingerprint niini nga telepono, busa wala na ang daan nga key. Paghimo og bag-o.",
    fil: "Nagbago ang mga fingerprint ng teleponong ito, kaya wala na ang lumang key. Gumawa ng bago.",
    en: "This phone's fingerprints changed, so the old key is gone. Make a new one.",
  },
  "M-BD-02.newKey": { ceb: "Paghimo og bag-ong key", fil: "Gumawa ng bagong key", en: "Make a new key" },
  "M-BD-02.lockedOut": {
    ceb: "Daghan kaayong sulay. Hulata og pipila ka minuto, dayon sulayi pag-usab.",
    fil: "Masyadong maraming subok. Maghintay ng ilang minuto, saka subukan muli.",
    en: "Too many tries. Wait a few minutes, then try again.",
  },
  "M-BD-02.waitKey1": {
    ceb: "Mapirmahan nimo human mopirma si {name}.",
    fil: "Mapipirmahan ninyo kapag nakapirma na si {name}.",
    en: "You can sign once {name} has signed.",
  },
  "M-BD-02.closed": {
    ceb: "Walay pirmahan niini nga batch.",
    fil: "Walang pipirmahan sa batch na ito.",
    en: "There is nothing to sign in this batch.",
  },
  "M-BD-02.key.device": {
    ceb: "Key {key}, sa secure store niini nga telepono",
    fil: "Key {key}, nasa secure store ng teleponong ito",
    en: "Key {key}, in this phone's secure store",
  },
  "M-BD-02.key.first": {
    ceb: "Key {key}, himoon sa una nimong pirma",
    fil: "Key {key}, gagawin sa una ninyong pirma",
    en: "Key {key}, made at your first signature",
  },
  "M-BD-02.key.demo": same("Demo key (this browser), {key}"),
  "M-BD-02.key.demoNew": {
    ceb: "Demo key (this browser), himoon sa pagpirma",
    fil: "Demo key (this browser), gagawin sa pagpirma",
    en: "Demo key (this browser), made when you sign",
  },
  "M-BD-02.confirmTitle": {
    ceb: "Pirmahi kini nga batch?",
    fil: "Pirmahan ang batch na ito?",
    en: "Sign this batch?",
  },
  "M-BD-02.confirmBody": {
    ceb: "{n} ka bayad, {amount}, pinaagi sa PayPal. Kini magpadala og kwarta. Sunod: ang fingerprint o PIN.",
    fil: "{n} bayad, {amount}, sa PayPal. Magpapadala ito ng pera. Susunod: ang fingerprint o PIN.",
    en: "{n} payouts, {amount}, by PayPal. This moves money. Next: your fingerprint or PIN.",
  },
  "M-BD-02.confirmBodyDemo": {
    ceb: "{n} ka bayad, {amount}, pinaagi sa PayPal. Kini magpadala og kwarta. Ang demo key sa browser ang mopirma.",
    fil: "{n} bayad, {amount}, sa PayPal. Magpapadala ito ng pera. Ang demo key ng browser ang pipirma.",
    en: "{n} payouts, {amount}, by PayPal. This moves money. The browser's demo key signs.",
  },
  "M-BD-02.confirmSign": { ceb: "Pirmahi", fil: "Pirmahan", en: "Sign" },
  "M-BD-02.srLabel": {
    ceb: "{label}, {amount}, magpadala og kwarta",
    fil: "{label}, {amount}, magpapadala ng pera",
    en: "{label}, {amount}, moves money",
  },
  "M-BD-02.back": { ceb: "Balik sa hangyo", fil: "Bumalik sa kahilingan", en: "Back to the request" },
  "M-BD-02.done": { ceb: "Human na", fil: "Tapos na", en: "Done" },
  "M-BD-02.compare": {
    ceb: "Itandi sa console",
    fil: "Ihambing sa console",
    en: "Compare with the console",
  },

  /* Push channels (Android notification settings) */
  "push.channel.cosign": {
    ceb: "Mga hangyo sa pagpirma",
    fil: "Mga kahilingang pirmahan",
    en: "Co-sign requests",
  },
  "push.channel.bayad": {
    ceb: "Bayad na (mga bayad)",
    fil: "Bayad na (mga bayad)",
    en: "Bayad na (payments)",
  },
});

export type BoardKey = keyof typeof messages | MessageKey;

/** For copy in a language other than the app's, or outside a component (push channel names). */
export function t(lang: Lang, key: BoardKey, args?: MessageArgs): string {
  return translateIn(messages, lang, key, args);
}
