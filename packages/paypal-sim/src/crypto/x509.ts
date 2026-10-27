// Minimal DER/X.509 v3 writer (RSA, sha256WithRSAEncryption) so the simulator can mint its own webhook
// signing CA and leaf certificate with node:crypto alone. Output parses with crypto.X509Certificate.
import { createHash, type KeyObject, randomBytes, sign } from "node:crypto";

function derLength(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
const nullValue = () => Buffer.from([0x05, 0x00]);
const bool = (v: boolean) => Buffer.from([0x01, 0x01, v ? 0xff : 0x00]);
const octets = (b: Buffer) => tlv(0x04, b);
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, "utf8"));
const printable = (s: string) => tlv(0x13, Buffer.from(s, "ascii"));
const explicit = (n: number, inner: Buffer) => tlv(0xa0 | n, inner);

function integer(value: Buffer | number): Buffer {
  let b: Buffer;
  if (typeof value === "number") {
    const bytes: number[] = [];
    let v = value;
    do {
      bytes.unshift(v & 0xff);
      v = Math.floor(v / 256);
    } while (v > 0);
    b = Buffer.from(bytes);
  } else {
    let i = 0;
    while (i < value.length - 1 && value[i] === 0) i++;
    b = value.subarray(i);
  }
  if (((b[0] ?? 0) & 0x80) !== 0) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}

function oid(dotted: string): Buffer {
  const parts = dotted.split(".").map(Number);
  const out: number[] = [40 * (parts[0] ?? 0) + (parts[1] ?? 0)];
  for (const p of parts.slice(2)) {
    const stack: number[] = [p & 0x7f];
    let v = Math.floor(p / 128);
    while (v > 0) {
      stack.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    out.push(...stack);
  }
  return tlv(0x06, Buffer.from(out));
}

function bitString(b: Buffer, unusedBits = 0): Buffer {
  return tlv(0x03, Buffer.concat([Buffer.from([unusedBits]), b]));
}

function time(d: Date): Buffer {
  const p = (n: number) => String(n).padStart(2, "0");
  const body = `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  const year = d.getUTCFullYear();
  if (year >= 1950 && year < 2050) return tlv(0x17, Buffer.from(`${p(year % 100)}${body}`, "ascii"));
  return tlv(0x18, Buffer.from(`${year}${body}`, "ascii"));
}

export interface DistinguishedName {
  commonName: string;
  organization: string;
  country?: string;
}

function name(dn: DistinguishedName): Buffer {
  const rdns: Buffer[] = [];
  if (dn.country) rdns.push(set(seq(oid("2.5.4.6"), printable(dn.country))));
  rdns.push(set(seq(oid("2.5.4.10"), utf8(dn.organization))));
  rdns.push(set(seq(oid("2.5.4.3"), utf8(dn.commonName))));
  return seq(...rdns);
}

const SHA256_WITH_RSA = () => seq(oid("1.2.840.113549.1.1.11"), nullValue());

function extension(id: string, critical: boolean, value: Buffer): Buffer {
  return critical ? seq(oid(id), bool(true), octets(value)) : seq(oid(id), octets(value));
}

/** SHA-1 of the subjectPublicKey bit string, the conventional key identifier (RFC 5280 §4.2.1.2). */
export function keyIdentifier(publicKey: KeyObject): Buffer {
  const spki = publicKey.export({ type: "spki", format: "der" });
  // SubjectPublicKeyInfo ::= SEQUENCE { algorithm, BIT STRING }; take the BIT STRING contents.
  let i = 0;
  const readLen = (pos: number): [number, number] => {
    const first = spki[pos] ?? 0;
    if (first < 0x80) return [first, pos + 1];
    const n = first & 0x7f;
    let len = 0;
    for (let k = 0; k < n; k++) len = len * 256 + (spki[pos + 1 + k] ?? 0);
    return [len, pos + 1 + n];
  };
  i = readLen(1)[1]; // inside outer SEQUENCE
  const [algLen, algStart] = readLen(i + 1);
  i = algStart + algLen; // at BIT STRING tag
  const [bitsLen, bitsStart] = readLen(i + 1);
  const bits = spki.subarray(bitsStart + 1, bitsStart + bitsLen); // skip unused-bits byte
  return createHash("sha1").update(bits).digest();
}

export interface CertificateSpec {
  subject: DistinguishedName;
  issuer: DistinguishedName;
  subjectPublicKey: KeyObject;
  issuerPrivateKey: KeyObject;
  issuerPublicKey: KeyObject;
  notBefore: Date;
  notAfter: Date;
  isCA: boolean;
}

/** Builds and signs an X.509 v3 certificate; returns DER. */
export function createCertificate(spec: CertificateSpec): Buffer {
  const serial = randomBytes(16);
  serial[0] = ((serial[0] ?? 1) & 0x7f) | 0x01;
  const ski = keyIdentifier(spec.subjectPublicKey);
  const aki = keyIdentifier(spec.issuerPublicKey);
  const extensions = [
    extension("2.5.29.19", true, spec.isCA ? seq(bool(true), integer(0)) : seq()),
    // keyUsage: CA → keyCertSign + cRLSign (bits 5, 6); leaf → digitalSignature (bit 0).
    extension(
      "2.5.29.15",
      true,
      spec.isCA ? bitString(Buffer.from([0x06]), 1) : bitString(Buffer.from([0x80]), 7),
    ),
    extension("2.5.29.14", false, octets(ski)),
    extension("2.5.29.35", false, seq(tlv(0x80, aki))),
  ];
  const tbs = seq(
    explicit(0, integer(2)),
    integer(serial),
    SHA256_WITH_RSA(),
    name(spec.issuer),
    seq(time(spec.notBefore), time(spec.notAfter)),
    name(spec.subject),
    spec.subjectPublicKey.export({ type: "spki", format: "der" }),
    explicit(3, seq(...extensions)),
  );
  const signature = sign("sha256", tbs, spec.issuerPrivateKey);
  return seq(tbs, SHA256_WITH_RSA(), bitString(signature));
}

export function toPem(der: Buffer, label = "CERTIFICATE"): string {
  const b64 = der.toString("base64").replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${b64.endsWith("\n") ? b64 : `${b64}\n`}-----END ${label}-----\n`;
}
