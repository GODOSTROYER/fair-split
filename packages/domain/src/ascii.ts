// Plain-ASCII text checks for values the policy lattice compares (I1). An untrusted string is never
// passed to `toLowerCase`, `trim` or `normalize` before an equality decision: Unicode case mapping
// folds lookalikes such as U+212A KELVIN SIGN into ASCII "k". Only ASCII A-Z is ever folded.

/**
 * A strict e-mail address in printable ASCII: a dot-atom local part, then LDH domain labels and a
 * letter TLD. No spaces, controls, quotes, comments or anything outside U+0021-U+007E.
 */
const ASCII_EMAIL =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const EMAIL_MAX = 254;

/** True only for a string that is a strict printable-ASCII e-mail address. */
export function isAsciiEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= EMAIL_MAX && ASCII_EMAIL.test(value);
}

/** Lower-cases ASCII A-Z only; every other code unit is left exactly as it is. */
export function foldAsciiCase(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/**
 * The comparison key for an e-mail address: the address with ASCII A-Z folded, or null when it is
 * not a strict printable-ASCII e-mail (which then matches nothing).
 */
export function asciiEmailKey(value: unknown): string | null {
  return isAsciiEmail(value) ? foldAsciiCase(value) : null;
}
