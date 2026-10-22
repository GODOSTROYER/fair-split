/**
 * Copy for M-BD-01/02 co-sign request and sign, plus the hold kinds it lists (BOARD+ONBOARDING slice).
 * Keys are `<screenId>.<key>`; the shell's own keys (common, tab, slab, seal) come from `_shims/i18n.ts`.
 * Pure data (tested in Node); screens read it through `useT()` from `./use-t`.
 * ceb and fil are machine-translated, pending native review (OD-2).
 */
import type { Lang } from "../../_shims/contracts";
import { defineMessages, type MessageArgs, type MessageKey, same, translateIn } from "../../_shims/i18n";

export const messages = defineMessages({
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
});

export type BoardKey = keyof typeof messages | MessageKey;

/** For copy in a language other than the app's (the three-language first-run prompt, language chips). */
export function t(lang: Lang, key: BoardKey, args?: MessageArgs): string {
  return translateIn(messages, lang, key, args);
}
