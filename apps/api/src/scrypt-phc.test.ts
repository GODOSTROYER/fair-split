// FS_OPERATOR_PASSWORD_SCRYPT's shape, checked at boot by the leaf module ./scrypt-phc.ts (env.ts cannot import the
// credentials code). It must accept exactly what credentials/issue/operator.ts `parseScryptHash` accepts, so a value
// boot lets through always parses at sign-in and one it refuses never would; tools/ops-hash-password.mjs's output
// passes, and a password pasted in place of its hash is refused by name, never echoed.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hashOperatorPassword, parseScryptHash } from "./credentials/issue/operator.js";
import { BootRefusal, parseEnv } from "./env.js";
import { isScryptPhc, SCRYPT_PHC_LIMITS } from "./scrypt-phc.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// Assembled at runtime, so no password-shaped literal sits in the source for the secret guards.
const PASSWORD = ["bulawanon", "ops", "sign", "in", "4c2e"].join("-");

const b64 = (n: number, url = false) => {
  const s = Buffer.alloc(n, 0xfb).toString(url ? "base64url" : "base64");
  return s.replace(/=+$/, "");
};
const phc = (params: string, salt: string, hash: string) => ["$scrypt", params, salt, hash].join("$");

/** Strings around every edge of the format and its bounds. */
function cases(): string[] {
  const salt = b64(16);
  const hash = b64(32);
  return [
    phc("ln=15,r=8,p=1", salt, hash),
    phc("ln=10,r=1,p=1", salt, hash),
    phc("ln=20,r=32,p=16", b64(64), b64(64)),
    phc("ln=9,r=8,p=1", salt, hash),
    phc("ln=21,r=8,p=1", salt, hash),
    phc("ln=15,r=0,p=1", salt, hash),
    phc("ln=15,r=33,p=1", salt, hash),
    phc("ln=15,r=8,p=0", salt, hash),
    phc("ln=15,r=8,p=17", salt, hash),
    phc("ln=15,r=8,p=1", b64(15), hash),
    phc("ln=15,r=8,p=1", b64(65), hash),
    phc("ln=15,r=8,p=1", salt, b64(15)),
    phc("ln=15,r=8,p=1", salt, b64(65)),
    phc("ln=15,r=8,p=1", b64(16, true), b64(32, true)),
    phc("ln=15,r=8,p=1", `${salt}==`, hash),
    phc("ln=15,r=8,p=1", `${salt}===`, hash),
    phc("ln=15,r=8,p=1", "not base64!", hash),
    phc("ln=015,r=8,p=1", salt, hash),
    phc("r=8,ln=15,p=1", salt, hash),
    phc("ln=15,r=8", salt, hash),
    `${phc("ln=15,r=8,p=1", salt, hash)}$extra`,
    phc("ln=15,r=8,p=1", salt, hash).replace("$scrypt", "$argon2id"),
    `  ${phc("ln=15,r=8,p=1", salt, hash)}  `,
    PASSWORD,
    "",
    "$scrypt$",
  ];
}

describe("scrypt-phc: the boot-time shape check of FS_OPERATOR_PASSWORD_SCRYPT", () => {
  it("agrees with parseScryptHash (what sign-in verifies) on every edge of the format and its bounds", () => {
    for (const value of cases()) {
      expect(isScryptPhc(value), JSON.stringify(value)).toBe(parseScryptHash(value) !== null);
    }
    expect(SCRYPT_PHC_LIMITS).toEqual({
      ln: [10, 20],
      r: [1, 32],
      p: [1, 16],
      salt: [16, 64],
      hash: [16, 64],
    });
  });

  it("accepts what hashOperatorPassword makes (ln 10 to 20)", async () => {
    for (const ln of [10, 12]) {
      const value = await hashOperatorPassword(PASSWORD, { ln });
      expect(isScryptPhc(value)).toBe(true);
    }
  });

  it("tools/ops-hash-password.mjs's output passes, and boots on Render", () => {
    const r = spawnSync(process.execPath, [path.join(REPO, "tools", "ops-hash-password.mjs"), "--stdin"], {
      cwd: path.join(REPO, "docs"),
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
      input: `${PASSWORD}\n`,
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    });
    expect(r.status, r.stderr).toBe(0);
    const hash = r.stdout.trim();
    expect(isScryptPhc(hash)).toBe(true);
    const env = parseEnv({
      RENDER: "true",
      RENDER_EXTERNAL_URL: "https://fs-api.onrender.com",
      PP_ENV: "sandbox",
      DATABASE_URL: "postgres://fs_app@db/fairsplit",
      FS_COOKIE_SECRET: "x".repeat(40),
      FS_LINK_SIGNING_KEY: "ab".repeat(32),
      FS_LEDGER_SIGNING_KEY: "cd".repeat(32),
      FS_OPERATOR_PASSWORD_SCRYPT: hash,
    });
    expect(env.secrets.operatorPasswordScrypt).toBe(hash);
  });

  it("a password pasted in place of its hash is refused by name, and never echoed", () => {
    let problems: readonly string[] = [];
    try {
      parseEnv({ FS_OPERATOR_PASSWORD_SCRYPT: PASSWORD });
    } catch (e) {
      expect(e).toBeInstanceOf(BootRefusal);
      problems = (e as BootRefusal).problems;
    }
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^FS_OPERATOR_PASSWORD_SCRYPT must be a scrypt hash/);
    expect(problems[0]).toMatch(/ops-hash-password/);
    expect(problems.join(" ")).not.toContain(PASSWORD);
  });
});
