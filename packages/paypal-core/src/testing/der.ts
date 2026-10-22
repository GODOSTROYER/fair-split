// Minimal ASN.1 DER encoder, enough to build X.509 v3 certificates with node:crypto alone
// (Node can sign and parse certificates but has no API to create them). Test use only.

const length = (n: number): Buffer => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};

export const tlv = (tag: number, content: Buffer): Buffer =>
  Buffer.concat([Buffer.from([tag]), length(content.length), content]);

export const sequence = (...items: Buffer[]): Buffer => tlv(0x30, Buffer.concat(items));
export const set = (...items: Buffer[]): Buffer => tlv(0x31, Buffer.concat(items));
export const nullValue = (): Buffer => Buffer.from([0x05, 0x00]);
export const boolean = (value: boolean): Buffer => tlv(0x01, Buffer.from([value ? 0xff : 0x00]));
export const octetString = (content: Buffer): Buffer => tlv(0x04, content);
export const utf8String = (value: string): Buffer => tlv(0x0c, Buffer.from(value, "utf8"));
export const printableString = (value: string): Buffer => tlv(0x13, Buffer.from(value, "ascii"));
/** BIT STRING with the given number of unused trailing bits in the last byte. */
export const bitString = (content: Buffer, unusedBits = 0): Buffer =>
  tlv(0x03, Buffer.concat([Buffer.from([unusedBits]), content]));
/** Context-specific constructed tag [n] (EXPLICIT). */
export const explicit = (n: number, content: Buffer): Buffer => tlv(0xa0 + n, content);
/** Context-specific primitive tag [n] (IMPLICIT), e.g. dNSName is [2]. */
export const implicitPrimitive = (n: number, content: Buffer): Buffer => tlv(0x80 + n, content);

/** Non-negative INTEGER in minimal two's-complement form. */
export function integer(value: bigint): Buffer {
  if (value < 0n) throw new RangeError("only non-negative integers are supported");
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  let bytes = Buffer.from(hex, "hex");
  if ((bytes[0] ?? 0) & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return tlv(0x02, bytes);
}

export function objectIdentifier(dotted: string): Buffer {
  const parts = dotted.split(".").map((p) => Number.parseInt(p, 10));
  const [first = 0, second = 0, ...rest] = parts;
  const bytes = [first * 40 + second];
  for (const part of rest) {
    const chunk: number[] = [];
    let v = part;
    do {
      chunk.unshift(v & 0x7f);
      v = Math.floor(v / 128);
    } while (v > 0);
    for (let i = 0; i < chunk.length - 1; i++) chunk[i] = (chunk[i] ?? 0) | 0x80;
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

/** UTCTime for 1950–2049, GeneralizedTime otherwise (RFC 5280 §4.1.2.5). */
export function time(date: Date): Buffer {
  const iso = date.toISOString();
  const year = date.getUTCFullYear();
  const digits = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return year >= 1950 && year < 2050
    ? tlv(0x17, Buffer.from(digits.slice(2), "ascii"))
    : tlv(0x18, Buffer.from(digits, "ascii"));
}
