import { describe, expect, it } from "vitest";
import {
  CARRIED_FLAGS,
  carriedFlags,
  DEMO_BEARER,
  demoWorkspaceAfterReset,
  HREF,
  homeHref,
  identityKey,
  type PairedSession,
  pairingChanged,
  pairingId,
  parseSession,
  pirmaHref,
  sessionValid,
  withFlags,
} from "./session";

const now = new Date("2026-10-29T02:00:00Z");
const session: PairedSession = {
  kind: "device",
  bearer: "fsd_0123456789abcdef",
  expiresAt: "2026-11-28T02:00:00Z",
  workspaceId: "ws_showcase",
  persona: "member:M-014",
  role: "member",
  memberNo: "M-014",
  displayName: "Consolacion Bacus",
  lang: "ceb",
  pairedAt: "2026-10-29T01:00:00Z",
};

describe("paired session", () => {
  it("lands each role on its home: the statement, the scanner, or the open co-sign request", () => {
    expect(homeHref("member", null)).toBe(HREF.bayad);
    expect(HREF.bayad).toBe("/(member)/(tabs)/bayad");
    expect(homeHref("clerk", null)).toBe("/(clerk)/scan");
    expect(homeHref("board", "2026A-r37")).toEqual({
      pathname: "/(board)/pirma/[runSlug]",
      params: { runSlug: "2026A-r37" },
    });
    expect(homeHref("board", null)).toBe(HREF.pirmaHome);
    expect(pirmaHref("2026A-r37")).toEqual(homeHref("board", "2026A-r37"));
  });

  it("treats an expired frame token as unpaired", () => {
    expect(sessionValid({ expiresAt: "2026-10-29T03:59:59Z" }, now)).toBe(true);
    expect(sessionValid({ expiresAt: "2026-10-29T01:59:59Z" }, now)).toBe(false);
    expect(sessionValid({ expiresAt: "not a date" }, now)).toBe(false);
    expect(sessionValid(null, now)).toBe(false);
  });

  it("restores a stored session, and treats anything malformed or expired as none", () => {
    expect(parseSession(JSON.stringify(session), now)).toEqual(session);
    expect(parseSession(JSON.stringify({ ...session, role: "treasurer" }), now)).toBeNull();
    expect(parseSession(JSON.stringify({ ...session, expiresAt: "2026-10-01T00:00:00Z" }), now)).toBeNull();
    expect(parseSession("{not json", now)).toBeNull();
    expect(parseSession(null, now)).toBeNull();
    const { lang: _l, ...noLang } = session;
    expect(parseSession(JSON.stringify(noLang), now)?.lang).toBeNull();
  });

  it("marks the demo session, which holds no secret", () => {
    expect(DEMO_BEARER).toBe("demo-session");
  });
});

describe("what a clerk pairing names (station, treasurer)", () => {
  it("keeps the station and the treasurer's name through a restart, trimmed", () => {
    const raw = JSON.stringify({
      ...session,
      role: "clerk",
      persona: "clerk:jessie",
      memberNo: null,
      station: "  Purok 2 pickup ",
      treasurerName: "Analyn",
    });
    expect(parseSession(raw, now)).toMatchObject({ station: "Purok 2 pickup", treasurerName: "Analyn" });
  });

  it("leaves them out when absent, blank or not text", () => {
    const blank = parseSession(JSON.stringify({ ...session, station: "  ", treasurerName: 42 }), now);
    expect(blank).not.toBeNull();
    expect(blank && "station" in blank).toBe(false);
    expect(blank && "treasurerName" in blank).toBe(false);
    expect(parseSession(JSON.stringify(session), now)).toEqual(session);
  });
});

describe("flags that travel with the index redirect", () => {
  it("keeps only the visit's display and demo flags, never a token", () => {
    expect(carriedFlags("?demo=member&stage=sent&motion=reduced&t=fsp_secret&token=x&line=HELD")).toEqual({
      demo: "member",
      stage: "sent",
      motion: "reduced",
      line: "HELD",
    });
    expect(carriedFlags("tier=low&theme=tablea&fsTrace=1")).toEqual({
      tier: "low",
      theme: "tablea",
      fsTrace: "1",
    });
    expect(carriedFlags("")).toEqual({});
    expect(carriedFlags("?demo=")).toEqual({});
    expect(CARRIED_FLAGS).not.toContain("t");
  });

  it("puts them on the role's home, without overriding the route's own params", () => {
    expect(withFlags(HREF.bayad, {})).toBe(HREF.bayad);
    expect(withFlags(HREF.bayad, { demo: "member", stage: "paid" })).toEqual({
      pathname: "/(member)/(tabs)/bayad",
      params: { demo: "member", stage: "paid" },
    });
    expect(withFlags(pirmaHref("2026A-r37"), { demo: "board", runSlug: "evil" })).toEqual({
      pathname: "/(board)/pirma/[runSlug]",
      params: { demo: "board", runSlug: "2026A-r37" },
    });
  });

  it("sends a board phone to its Pirma tab when no run is named", () => {
    expect(withFlags(homeHref("board", null), { demo: "board" })).toEqual({
      pathname: "/(board)/pirma",
      params: { demo: "board" },
    });
  });
});

describe("demo workspaces after a judge reset", () => {
  it("is the stage's workspace until the first reset, then a fresh one per reset", () => {
    expect(demoWorkspaceAfterReset("ws_demo_local", 0)).toBe("ws_demo_local");
    const after = [1, 2, 3].map((n) => demoWorkspaceAfterReset("ws_demo_local", n));
    expect(new Set(after).size).toBe(3);
    expect(after.every((w) => w !== "ws_demo_local" && w.startsWith("ws_demo_local"))).toBe(true);
  });
});

describe("pairings and identities (security review: what a phone keeps stays with whom it belongs to)", () => {
  it("session.pairing-id: names a pairing without its bearer; the same after a restart, new after pairing again", () => {
    const id = pairingId(session);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    const restored = parseSession(JSON.stringify(session), now);
    if (!restored) throw new Error("expected the session back");
    expect(pairingId(restored)).toBe(id);
    const sameButBearer: PairedSession = { ...session, bearer: "fsd_another_token" };
    expect(pairingId(sameButBearer)).toBe(id); // never derived from the secret
    expect(pairingId({ ...session, pairedAt: "2026-10-29T03:00:00Z" })).not.toBe(id); // paired again
    expect(pairingId({ ...session, workspaceId: "ws_judge_7" })).not.toBe(id);
    expect(pairingId({ ...session, persona: "member:M-031" })).not.toBe(id);
  });

  it("session.identity-key: the same person across pairings; another persona or workspace is someone else", () => {
    const k = identityKey(session);
    expect(k).toMatch(/^[0-9a-f]{16}$/);
    const pairedAgain: PairedSession = { ...session, pairedAt: "2026-10-29T03:00:00Z", bearer: "fsd_new" };
    expect(identityKey(pairedAgain)).toBe(k);
    expect(identityKey({ ...session, workspaceId: "ws_judge_7" })).not.toBe(k);
    expect(identityKey({ ...session, persona: "member:M-031" })).not.toBe(k);
    // Fields never run into each other: ("a|b", "c") is not ("a", "b|c").
    expect(identityKey({ workspaceId: "a|b", persona: "c" })).not.toBe(
      identityKey({ workspaceId: "a", persona: "b|c" }),
    );
    expect(k).not.toBe(pairingId(session));
  });

  it("session.pairing-changed: pairing again or unpairing changes it; a restart or the first pairing does not", () => {
    expect(pairingChanged(null, session)).toBe(false); // first pairing: nothing of an earlier one to drop
    expect(pairingChanged(null, null)).toBe(false);
    expect(pairingChanged(session, { ...session })).toBe(false); // restored after a restart
    expect(pairingChanged(session, { ...session, pairedAt: "2026-10-29T03:00:00Z" })).toBe(true);
    const chair: PairedSession = { ...session, persona: "board:ernesto", role: "board" };
    expect(pairingChanged(session, chair)).toBe(true);
    expect(pairingChanged(session, { ...session, workspaceId: "ws_judge_7" })).toBe(true);
    expect(pairingChanged(session, null)).toBe(true); // unpaired
  });
});
