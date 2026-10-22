import { describe, expect, it } from "vitest";
import {
  acceptFromStage,
  expiryIso,
  feedbackMessage,
  focusMessage,
  momentMessage,
  parseToFrame,
  personaMemberNo,
  personaRole,
  readyMessage,
} from "./frame-protocol";

const token = {
  v: 1,
  t: "fs.token",
  token: "fst_01JB7Q3X9M2V8K4N5P6R7S8T9",
  exp: 1_793_000_000,
  persona: "member:M-014",
  ws: "ws_judge_017",
};

describe("IC-12 FrameBridge, frame side", () => {
  it("accepts the stage's token, preferences and reset", () => {
    expect(parseToFrame(token)).toEqual(token);
    expect(
      parseToFrame({ v: 1, t: "fs.prefs", tier: "low", sound: false, reducedMotion: true, gloss: true }),
    ).toEqual({ v: 1, t: "fs.prefs", tier: "low", sound: false, reducedMotion: true, gloss: true });
    expect(parseToFrame({ v: 1, t: "fs.reset" })).toEqual({ v: 1, t: "fs.reset" });
  });

  it("ignores other versions, unknown types and malformed fields", () => {
    expect(parseToFrame({ ...token, v: 2 })).toBeNull();
    expect(parseToFrame({ ...token, t: "fs.frame-token" })).toBeNull();
    expect(parseToFrame({ ...token, token: "has spaces in it, nope" })).toBeNull();
    expect(parseToFrame({ ...token, token: "x".repeat(600) })).toBeNull();
    expect(parseToFrame({ ...token, exp: Number.NaN })).toBeNull();
    expect(parseToFrame({ ...token, persona: "treasurer:analyn" })).toBeNull();
    expect(parseToFrame({ ...token, ws: "" })).toBeNull();
    expect(
      parseToFrame({ v: 1, t: "fs.prefs", tier: "ultra", sound: false, reducedMotion: false, gloss: false }),
    ).toBeNull();
    expect(parseToFrame("fs.reset")).toBeNull();
    expect(parseToFrame(null)).toBeNull();
    expect(parseToFrame([token])).toBeNull();
  });

  it("only listens to its own parent on its own origin (a token never comes from elsewhere)", () => {
    const parent = {};
    const self = { origin: "https://fs-api.onrender.com", parent };
    expect(acceptFromStage({ origin: self.origin, source: parent, data: token }, self)).toEqual(token);
    expect(acceptFromStage({ origin: "https://evil.example", source: parent, data: token }, self)).toBeNull();
    expect(acceptFromStage({ origin: self.origin, source: {}, data: token }, self)).toBeNull();
    expect(
      acceptFromStage({ origin: self.origin, source: null, data: token }, { ...self, parent: null }),
    ).toBeNull();
  });

  it("reads the role and member number from the persona", () => {
    expect(personaRole("member:M-014")).toBe("member");
    expect(personaRole("board:ernesto")).toBe("board");
    expect(personaRole("clerk:jessie")).toBe("clerk");
    expect(personaRole("brand:dana")).toBeNull();
    expect(personaMemberNo("member:M-014")).toBe("M-014");
    expect(personaMemberNo("board:ernesto")).toBeNull();
  });

  it("treats exp as seconds or milliseconds", () => {
    expect(expiryIso(1_793_000_000)).toBe("2026-10-26T07:33:20.000Z");
    expect(expiryIso(1_793_000_000_000)).toBe("2026-10-26T07:33:20.000Z");
  });

  it("versions every message it sends to the stage", () => {
    expect(readyMessage("chair", null, "0.1.0")).toEqual({
      v: 1,
      t: "fs.ready",
      frameId: "chair",
      persona: null,
      build: "0.1.0",
    });
    expect(focusMessage("M-BD-02")).toEqual({ v: 1, t: "fs.focus", screenId: "M-BD-02" });
    expect(momentMessage("MM-1", "done")).toEqual({ v: 1, t: "fs.moment", moment: "MM-1", phase: "done" });
    expect(feedbackMessage("item.paid.member")).toEqual({
      v: 1,
      t: "fs.feedback",
      event: "item.paid.member",
    });
    expect(feedbackMessage("hold.quarter", 2)).toEqual({
      v: 1,
      t: "fs.feedback",
      event: "hold.quarter",
      index: 2,
    });
  });
});
