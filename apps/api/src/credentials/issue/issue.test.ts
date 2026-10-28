// Credential issuance, pure parts: the operator's scrypt hash, pairing secrets, persona parsing, token and
// link lifetimes, and the issuer/verifier codec round trip (one definition of every wire format).
import { createHash, randomUUID } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createFakeClock } from "../../lib/clock.js";
import { createTestDeps } from "../../test/deps.js";
import {
  createCredentialKeys,
  DEVICE_TOKEN_TTL_MS,
  FRAME_TOKEN_TTL_MS,
  LINK_TTL_MS,
  verifyLink,
} from "../verify/index.js";
import { checkLink, issueBrandLink, issueMemberLink, newJti } from "./links.js";
import { hashOperatorPassword, parseScryptHash, verifyOperatorPassword } from "./operator.js";
import {
  code6Digest,
  generateCode6,
  generatePairingToken,
  isPairingToken,
  pairingTokenSha256,
} from "./pairing.js";
import { canIssue, isPairableRole, parsePersonaRef } from "./personas.js";
import { tokenExpiry } from "./tokens.js";

describe("operator password (scrypt, PHC string)", () => {
  it("verifies the right password only, in constant time over equal-length keys", async () => {
    const hash = await hashOperatorPassword("sandbox only, not a real secret", { ln: 10 });
    expect(hash).toMatch(/^\$scrypt\$ln=10,r=8,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(await verifyOperatorPassword(hash, "sandbox only, not a real secret")).toBe(true);
    expect(await verifyOperatorPassword(hash, "sandbox only, not a real secreT")).toBe(false);
    expect(await verifyOperatorPassword(hash, "")).toBe(false);
    expect(await verifyOperatorPassword(hash, "x".repeat(1025))).toBe(false);
    // the same password hashes differently each time (random salt)
    expect(await hashOperatorPassword("p", { ln: 10 })).not.toBe(await hashOperatorPassword("p", { ln: 10 }));
  });

  it("refuses malformed or unbounded hashes instead of running them", async () => {
    const salt = Buffer.alloc(16, 1).toString("base64");
    const key = Buffer.alloc(32, 2).toString("base64");
    expect(parseScryptHash(`$scrypt$ln=15,r=8,p=1$${salt}$${key}`)).toMatchObject({ ln: 15, r: 8, p: 1 });
    for (const bad of [
      undefined,
      "",
      "plain-text-password",
      `$scrypt$ln=30,r=8,p=1$${salt}$${key}`, // N = 2^30: refused, never run
      `$scrypt$ln=15,r=99,p=1$${salt}$${key}`,
      `$scrypt$ln=15,r=8,p=1$${Buffer.alloc(4).toString("base64")}$${key}`, // salt too short
      `$argon2id$v=19$m=65536,t=3,p=4$${salt}$${key}`,
    ]) {
      expect(parseScryptHash(bad), String(bad)).toBeNull();
      expect(await verifyOperatorPassword(bad, "anything")).toBe(false);
    }
  });
});

describe("pairing secrets", () => {
  it("a 256-bit QR token and six digits from a CSPRNG", () => {
    const tokens = new Set(Array.from({ length: 200 }, generatePairingToken));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(isPairingToken(t)).toBe(true);
    expect(isPairingToken(`fsp_${"a".repeat(42)}`)).toBe(false);
    for (let i = 0; i < 500; i++) expect(generateCode6()).toMatch(/^\d{6}$/);
    expect(pairingTokenSha256("fsp_x")).toBe(createHash("sha256").update("fsp_x").digest("hex"));
  });

  it("a code is stored as a keyed digest: deterministic per key, useless without it", () => {
    const a = createCredentialKeys({ cookieSecret: "a".repeat(40) });
    const b = createCredentialKeys({ cookieSecret: "b".repeat(40) });
    expect(code6Digest(a, "042137")).toBe(code6Digest(a, "042137"));
    expect(code6Digest(a, "042137")).not.toBe(code6Digest(b, "042137"));
    expect(code6Digest(a, "042137")).not.toBe(createHash("sha256").update("042137").digest("hex"));
    expect(code6Digest(a, "042137")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("personas", () => {
  it("reads {role}:{name} and refuses anything else", () => {
    expect(parsePersonaRef("board:ernesto")).toEqual({ role: "board", persona: "ernesto" });
    expect(parsePersonaRef("member:M-014")).toEqual({ role: "member", persona: "M-014" });
    for (const bad of ["ernesto", "board:", ":ernesto", "board:ern esto", "board:<x>", "a:b:c"]) {
      expect(parsePersonaRef(bad), bad).toBeNull();
    }
  });

  it("only co-op roles are pairable; only the judge and the treasurer issue", () => {
    expect(["treasurer", "board", "clerk", "member", "brand"].every(isPairableRole)).toBe(true);
    expect(isPairableRole("judge")).toBe(false);
    expect(isPairableRole("operator")).toBe(false);
    expect(canIssue("judge")).toBe(true);
    expect(canIssue("treasurer")).toBe(true);
    for (const r of ["board", "clerk", "member", "brand", "operator"] as const)
      expect(canIssue(r)).toBe(false);
  });
});

describe("lifetimes: a credential never outlives its workspace", () => {
  it("frame 2 h, device 30 days, both capped by the workspace's end", () => {
    const now = new Date("2026-10-28T02:00:00.000Z");
    expect(tokenExpiry(now, "frame", null).getTime() - now.getTime()).toBe(FRAME_TOKEN_TTL_MS);
    expect(tokenExpiry(now, "device", null).getTime() - now.getTime()).toBe(DEVICE_TOKEN_TTL_MS);
    const wsEnd = new Date(now.getTime() + 3_600_000);
    expect(tokenExpiry(now, "frame", wsEnd)).toEqual(wsEnd);
    expect(tokenExpiry(now, "device", wsEnd)).toEqual(wsEnd);
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 * 86_400_000 }),
        fc.constantFrom("frame", "device" as const),
        (left, kind) => {
          const end = new Date(now.getTime() + left);
          expect(tokenExpiry(now, kind, end).getTime()).toBeLessThanOrEqual(end.getTime());
        },
      ),
    );
  });
});

describe("signed links: the issuer and the verifier agree on every byte", () => {
  const clock = createFakeClock("2026-10-28T02:00:00.000Z");
  const { deps } = createTestDeps({ clock });
  const ws = randomUUID();

  it("a member link verifies for 30 days with the public half only, then expires", () => {
    const line = randomUUID();
    const link = issueMemberLink(deps, {
      workspaceId: ws,
      lineId: line,
      now: clock.now(),
      workspaceExpiresAt: null,
    });
    expect(link.url).toBe(`${deps.env.publicOrigin}/s/${link.token}`);
    expect(link.expiresAt.getTime() - clock.nowMs()).toBe(LINK_TTL_MS);
    const v = verifyLink(deps.credentials.keys.linkPublicKeyHex, link.token, clock.nowMs());
    expect(v).toMatchObject({ ok: true, payload: { k: "member", ws, lineId: line, jti: link.jti } });
    expect(verifyLink(deps.credentials.keys.linkPublicKeyHex, link.token, link.expiresAt.getTime())).toEqual({
      ok: false,
      reason: "expired",
    });
    // one changed character anywhere breaks the signature
    const i = link.token.indexOf(".") - 3;
    const flipped = `${link.token.slice(0, i)}${link.token[i] === "A" ? "B" : "A"}${link.token.slice(i + 1)}`;
    expect(verifyLink(deps.credentials.keys.linkPublicKeyHex, flipped, clock.nowMs()).ok).toBe(false);
    // another server's key never verifies it
    const other = createCredentialKeys({ linkSigningKey: "2e".repeat(32) });
    expect(verifyLink(other.linkPublicKeyHex, link.token, clock.nowMs())).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("a brand link names its brand; both are capped by the workspace's end", () => {
    const end = new Date(clock.nowMs() + 86_400_000);
    const link = issueBrandLink(deps, {
      workspaceId: ws,
      brand: "lantern-bay",
      now: clock.now(),
      workspaceExpiresAt: end,
    });
    expect(link.url).toContain("/b/fsb_");
    expect(link.expiresAt).toEqual(end);
    expect(verifyLink(deps.credentials.keys.linkPublicKeyHex, link.token, clock.nowMs())).toMatchObject({
      ok: true,
      payload: { k: "brand", brand: "lantern-bay" },
    });
  });

  it("every link id is fresh (128 bits, base64url)", () => {
    const ids = new Set(Array.from({ length: 500 }, newJti));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("checkLink reads revocation from the credential store the resolver reads (one source for every path)", async () => {
    const { deps: d, memoryStore } = createTestDeps({ clock });
    const store = memoryStore as NonNullable<typeof memoryStore>;
    store.workspaces.set(ws, null);
    const link = issueMemberLink(d, {
      workspaceId: ws,
      lineId: randomUUID(),
      now: clock.now(),
      workspaceExpiresAt: null,
    });
    expect(await checkLink(d, link.token, "member")).toMatchObject({ ok: true, payload: { jti: link.jti } });
    store.revokedLinks.add(link.jti);
    expect(await checkLink(d, link.token, "member")).toEqual({ ok: false, reason: "revoked" });
    const revoked = await d.credentials.resolver.resolve({ authorization: `Bearer ${link.token}` });
    expect(revoked.kind === "invalid" && revoked.problem.message).toMatch(/revoked/);
  });
});
