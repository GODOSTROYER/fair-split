// Operator login (S3.8, W-OP-01): `FS_OPERATOR_PASSWORD_SCRYPT` holds a scrypt hash in the PHC string format
//
//   $scrypt$ln=<log2 N>,r=<block size>,p=<parallelism>$<salt, base64>$<hash, base64>
//
// (base64 with or without padding, standard or URL-safe alphabet). `hashOperatorPassword()` makes one, e.g.
//   corepack pnpm --filter @fairsplit/api exec tsx -e "import('./src/credentials/issue/operator.ts').then(async m => console.log(await m.hashOperatorPassword(process.argv[1])))" 'the password'
// A correct password sets the HMAC-signed `fs_ops` cookie (8 h). The comparison is constant-time, the work
// factor is bounded so a malformed hash cannot exhaust memory, and nothing about the hash is ever logged.
import { randomBytes, type ScryptOptions, scrypt, timingSafeEqual } from "node:crypto";
import { deleteCookie, setCookie } from "hono/cookie";
import type { AppContext, AppDeps } from "../../lib/context.js";
import { cookieAttributes, OPERATOR_COOKIE, signCookie } from "../verify/index.js";

export interface ScryptHash {
  ln: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

/** Bounds on the parameters we accept, so a bad hash string is refused rather than run. */
const LIMITS = { ln: [10, 20], r: [1, 32], p: [1, 16], salt: [16, 64], hash: [16, 64] } as const;
export const DEFAULT_SCRYPT = { ln: 15, r: 8, p: 1, saltBytes: 16, hashBytes: 32 } as const;
/** Longer passwords are refused before any work is done. */
export const OPERATOR_PASSWORD_MAX = 1024;

const B64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

function b64(s: string): Buffer | null {
  if (!B64.test(s)) return null;
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

const within = (v: number, [lo, hi]: readonly [number, number]) => Number.isInteger(v) && v >= lo && v <= hi;

/** Parses `$scrypt$ln=..,r=..,p=..$salt$hash`; null when malformed or out of bounds. */
export function parseScryptHash(s: string | undefined): ScryptHash | null {
  if (!s) return null;
  const m = /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([^$]+)\$([^$]+)$/.exec(s.trim());
  if (!m) return null;
  const [ln, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const salt = b64(m[4] as string);
  const hash = b64(m[5] as string);
  if (!salt || !hash) return null;
  if (!within(ln, LIMITS.ln) || !within(r, LIMITS.r) || !within(p, LIMITS.p)) return null;
  if (!within(salt.length, LIMITS.salt) || !within(hash.length, LIMITS.hash)) return null;
  return { ln, r, p, salt, hash };
}

function derive(password: string, h: Pick<ScryptHash, "ln" | "r" | "p" | "salt">, keylen: number) {
  const N = 2 ** h.ln;
  const opts: ScryptOptions = { N, r: h.r, p: h.p, maxmem: 256 * N * h.r * h.p + 4 * 1024 * 1024 };
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize("NFC"), h.salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Makes a hash string for `FS_OPERATOR_PASSWORD_SCRYPT` (tooling and tests; the server never stores one). */
export async function hashOperatorPassword(
  password: string,
  o: { ln?: number; salt?: Buffer } = {},
): Promise<string> {
  const salt = o.salt ?? randomBytes(DEFAULT_SCRYPT.saltBytes);
  const ln = o.ln ?? DEFAULT_SCRYPT.ln;
  const key = await derive(password, { ln, r: DEFAULT_SCRYPT.r, p: DEFAULT_SCRYPT.p, salt }, 32);
  const enc = (b: Buffer) => b.toString("base64").replace(/=+$/, "");
  return `$scrypt$ln=${ln},r=${DEFAULT_SCRYPT.r},p=${DEFAULT_SCRYPT.p}$${enc(salt)}$${enc(key)}`;
}

/** Constant-time check of a password against the configured hash. False for any malformed input. */
export async function verifyOperatorPassword(stored: string | undefined, password: string): Promise<boolean> {
  const h = parseScryptHash(stored);
  if (!h || password.length === 0 || password.length > OPERATOR_PASSWORD_MAX) return false;
  const key = await derive(password, h, h.hash.length);
  return key.length === h.hash.length && timingSafeEqual(key, h.hash);
}

/** Sets the `fs_ops` cookie (HttpOnly, SameSite=Lax, Secure on https, 8 h). Returns its expiry. */
export function setOperatorCookie(c: AppContext, deps: AppDeps, now: Date): Date {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + Math.floor(OPERATOR_COOKIE.ttlMs / 1000);
  const value = signCookie(deps.credentials.keys.hmacKey(OPERATOR_COOKIE.purpose), {
    v: 1,
    sub: "operator",
    iat,
    exp,
  });
  setCookie(c, OPERATOR_COOKIE.name, value, cookieAttributes(deps.env.publicOrigin, OPERATOR_COOKIE.ttlMs));
  return new Date(exp * 1000);
}

/** Ends the operator session in this browser. */
export function clearOperatorCookie(c: AppContext, deps: AppDeps): void {
  const { maxAge: _maxAge, ...attrs } = cookieAttributes(deps.env.publicOrigin, 0);
  deleteCookie(c, OPERATOR_COOKIE.name, attrs);
}
