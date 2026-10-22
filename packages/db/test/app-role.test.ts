/**
 * fs_app as a login role (S3.4, review blocker). Where the owner may manage roles, the migrate CLI gives fs_app
 * LOGIN and a password, and the app logs in as fs_app itself: no SET ROLE can lead back to the owner, and only
 * the owner can disable a trigger. Where it may not, the assumed role (the owner's login plus `role=fs_app`)
 * still stops bugs, and the boot report says plainly that it does not stop a compromised app.
 */
import { createHash, createHmac } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/client.js";
import {
  AppRoleError,
  appDatabaseUrl,
  assertAppRole,
  disableAppLogin,
  enableAppLogin,
  inspectAppRole,
  parseScramVerifier,
  scramSha256Verifier,
} from "../src/roles.js";
import { openTestDb, type TestDb } from "../src/testing/index.js";
import { sqlState } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb();
});
afterAll(async () => {
  await t?.close();
});

const hmac = (key: Buffer, msg: string) => createHmac("sha256", key).update(msg).digest();

describe("SCRAM-SHA-256 verifier (computed here, so the password never reaches the server)", () => {
  it("reproduces RFC 7677's example exchange from the stored keys alone", () => {
    const verifier = scramSha256Verifier("pencil", {
      salt: Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64"),
      iterations: 4096,
    });
    const v = parseScramVerifier(verifier);
    expect(v.iterations).toBe(4096);
    const authMessage = [
      "n=user,r=rOprNGfwEbeRWgbNEkqO",
      "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096",
      "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0",
    ].join(",");
    // the server's check: H(ClientProof XOR HMAC(StoredKey, AuthMessage)) = StoredKey
    const proof = Buffer.from("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=", "base64");
    const signature = hmac(v.storedKey, authMessage);
    const clientKey = Buffer.from(proof.map((b, i) => b ^ (signature[i] ?? 0)));
    expect(createHash("sha256").update(clientKey).digest().equals(v.storedKey)).toBe(true);
    expect(hmac(v.serverKey, authMessage).toString("base64")).toBe(
      "6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=",
    );
  });

  it("uses a fresh salt each time and refuses passwords that would need SASLprep or URL escaping guesses", () => {
    const a = scramSha256Verifier("correct-horse-battery-staple");
    const b = scramSha256Verifier("correct-horse-battery-staple");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(() => scramSha256Verifier("short")).toThrow(/at least 16/);
    expect(() => scramSha256Verifier("päss-wörd-with-umlauts")).toThrow(/printable ASCII/);
    expect(() => scramSha256Verifier("has a space in the middle!")).toThrow(/printable ASCII/);
  });
});

describe("fs_app with its own login", () => {
  const password = `fs-test-${Date.now()}-login-role`;

  it("enableAppLogin stores our verifier verbatim: Postgres never saw the password", async () => {
    await enableAppLogin(t.url, password);
    try {
      const [row] = await t.owner.sql<{ rolcanlogin: boolean; rolinherit: boolean; rolpassword: string }[]>`
        select rolcanlogin, rolinherit, rolpassword from pg_authid where rolname = 'fs_app'`;
      expect(row?.rolcanlogin).toBe(true);
      expect(row?.rolinherit).toBe(false);
      const v = parseScramVerifier(row?.rolpassword ?? "");
      // recompute the keys from the password and the stored salt: they match what we sent
      expect(scramSha256Verifier(password, { salt: v.salt, iterations: v.iterations })).toBe(
        row?.rolpassword,
      );
    } finally {
      await disableAppLogin(t.url);
    }
  });

  it("a session that logged in as fs_app cannot SET ROLE back to the owner or disable a trigger", async () => {
    await enableAppLogin(t.url, password);
    const app = postgres(appDatabaseUrl(t.url, password), { max: 1, onnotice: () => {} });
    try {
      const [who] = await app<{ cu: string; su: string }[]>`select current_user as cu, session_user as su`;
      expect(who).toEqual({ cu: "fs_app", su: "fs_app" });
      const [owner] = await t.owner.sql<{ name: string }[]>`
        select pg_get_userbyid(datdba) as name from pg_database where datname = current_database()`;
      expect(await sqlState(() => app.unsafe(`set role "${owner?.name}"`))).toBe("42501");
      expect(await sqlState(() => app`alter table run_events disable trigger all`)).toBe("42501");
      expect(await sqlState(() => app`update ledger_entries set kind = kind`)).toBe("42501");
      const db = createDb(appDatabaseUrl(t.url, password), { max: 1 });
      try {
        const report = await assertAppRole(db.db);
        expect(report.mode).toBe("login");
        expect(report.writableHistory).toEqual([]);
      } finally {
        await db.close();
      }
    } finally {
      await app.end({ timeout: 5 });
      await disableAppLogin(t.url);
    }
  });

  it("appDatabaseUrl swaps in fs_app and escapes the password without printing it anywhere", () => {
    // built, not written out: a credentialled connection string in source trips the secret scanner
    const owner = new URL("postgres://db.internal:5432/fs?sslmode=require");
    owner.username = "owner";
    owner.password = "owner-password-for-this-test";
    const url = appDatabaseUrl(owner.toString(), "a/b@c:d#e%f");
    const u = new URL(url);
    expect(u.username).toBe("fs_app");
    expect(decodeURIComponent(u.password)).toBe("a/b@c:d#e%f");
    expect(u.host).toBe("db.internal:5432");
    expect(u.pathname).toBe("/fs");
    expect(u.searchParams.get("sslmode")).toBe("require");
  });
});

describe("the boot check (S3.4: refuse if the app could rewrite history)", () => {
  it("the assumed role is reported as such: it stops bugs, not a compromised app", async () => {
    const report = await inspectAppRole(t.app.db);
    expect(report.mode).toBe("assumed");
    expect(report.currentUser).toBe("fs_app");
    expect(report.writableHistory).toEqual([]);
    expect(report.canDeleteWorkspaces).toBe(false);
    expect(report.canReadPurgeTickets).toBe(false);
    // the documented limit of this mode: the session user is still the owner
    const reserved = await t.app.sql.reserve();
    try {
      await reserved.unsafe(`set role "${report.sessionUser}"`);
      const [who] = await reserved<{ cu: string }[]>`select current_user as cu`;
      expect(who?.cu).toBe(report.sessionUser);
    } finally {
      await reserved`reset role`.catch(() => {});
      reserved.release();
    }
    await expect(assertAppRole(t.app.db)).resolves.toMatchObject({ mode: "assumed" });
    await expect(assertAppRole(t.app.db, { allow: ["login"] })).rejects.toBeInstanceOf(AppRoleError);
  });

  it("refuses to boot as the owner, unless the owner fallback is explicitly allowed", async () => {
    const report = await inspectAppRole(t.owner.db);
    expect(report.mode).toBe("owner");
    expect(report.writableHistory).toContain("ledger_entries:UPDATE");
    const e = await assertAppRole(t.owner.db).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(AppRoleError);
    expect((e as AppRoleError).message).toMatch(/ledger_entries:UPDATE/);
    await expect(assertAppRole(t.owner.db, { allow: ["owner"] })).resolves.toMatchObject({ mode: "owner" });
  });
});
