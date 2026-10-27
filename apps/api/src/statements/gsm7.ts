// GSM 03.38 (GSM-7) for the SMS preview (S1.13 "SMS"): the basic set counts one septet, the extension table
// two (escape + character); anything else does not fit GSM-7 at all (a message would fall back to UCS-2 and 70
// characters). ñ and Ñ are in the basic set; ₱ is not, so SMS writes the peso as "P".
const BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const EXTENSION = "\f^{}\\[~]|€";

const basic = new Set([...BASIC]);
const extension = new Set([...EXTENSION]);

export const SMS_MAX_SEPTETS = 160;

/** Septets the text needs in GSM-7, or null when a character is outside GSM-7. */
export function gsm7Length(text: string): number | null {
  let n = 0;
  for (const ch of text) {
    if (basic.has(ch)) n += 1;
    else if (extension.has(ch)) n += 2;
    else return null;
  }
  return n;
}

/** True when the text is GSM-7 and fits one 160-septet SMS. */
export function fitsOneSms(text: string): boolean {
  const n = gsm7Length(text);
  return n !== null && n <= SMS_MAX_SEPTETS;
}
