import { describe, expect, it } from "vitest";
import {
  DEMO_BEARER,
  HREF,
  homeHref,
  type PairedSession,
  parseSession,
  pirmaHref,
  sessionValid,
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
