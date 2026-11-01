// The shape of FS_OPERATOR_PASSWORD_SCRYPT, checked at boot (env.ts). A leaf with no imports: env.ts cannot import
// the credentials code (credentials/issue/operator.ts imports the app context, which imports env.ts). It accepts
// exactly what operator.ts `parseScryptHash` accepts at sign-in (scrypt-phc.test.ts holds the two to the same
// answers): the PHC string tools/ops-hash-password.mjs prints,
//
//   $scrypt$ln=<log2 N>,r=<block size>,p=<parallelism>$<salt, base64>$<hash, base64>
//
// (base64 with or without padding, standard or URL-safe alphabet), within the same bounds. So a password pasted in
// place of its hash stops the deploy instead of deploying green with every /ops sign-in answering 401.

export const SCRYPT_PHC = /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([^$]+)\$([^$]+)$/;

/** The parameters and byte lengths sign-in accepts (operator.ts LIMITS), so a bad hash is refused, never run. */
export const SCRYPT_PHC_LIMITS = {
  ln: [10, 20],
  r: [1, 32],
  p: [1, 16],
  salt: [16, 64],
  hash: [16, 64],
} as const;

const B64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

const within = (v: number, [lo, hi]: readonly [number, number]) => Number.isInteger(v) && v >= lo && v <= hi;

/** Decoded length of a base64 (standard or URL-safe) field, or null when it is not base64. */
function b64Bytes(s: string): number | null {
  if (!B64.test(s)) return null;
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").length;
}

/** Whether `value` is a scrypt PHC string sign-in can verify. Never logs or returns any part of it. */
export function isScryptPhc(value: string): boolean {
  const m = SCRYPT_PHC.exec(value.trim());
  if (!m) return false;
  const salt = b64Bytes(m[4] as string);
  const hash = b64Bytes(m[5] as string);
  if (salt === null || hash === null) return false;
  return (
    within(Number(m[1]), SCRYPT_PHC_LIMITS.ln) &&
    within(Number(m[2]), SCRYPT_PHC_LIMITS.r) &&
    within(Number(m[3]), SCRYPT_PHC_LIMITS.p) &&
    within(salt, SCRYPT_PHC_LIMITS.salt) &&
    within(hash, SCRYPT_PHC_LIMITS.hash)
  );
}
