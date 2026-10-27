// IC-12 FrameBridge, stage side: versioned {v: 1}, same origin only, and only from a frame the stage registered;
// tokens never in a URL and never staler than the last; only the stage plays sound. The message shapes match
// the frame side WS-APP built (fs.ready with the iframe's name, a null persona and the app's build; tier
// "full" or "low").

import { afterEach, describe, expect, it, vi } from "vitest";
import type { FrameTokenGrant } from "../data/adapter.js";
import {
  DEV_STUB_BUILD,
  type FramePrefs,
  frameSrc,
  StageBridge,
  type StageBridgeHost,
  TOKEN_REFRESH_LEAD_MS,
  ToFrame,
  ToStage,
} from "./bridge.js";

const ORIGIN = "http://localhost:5173";

class FakeHost implements StageBridgeHost {
  readonly location = { origin: ORIGIN };
  private listener: ((event: MessageEvent) => void) | null = null;
  addEventListener(_type: "message", listener: (event: MessageEvent) => void) {
    this.listener = listener;
  }
  removeEventListener() {
    this.listener = null;
  }
  get listening() {
    return this.listener !== null;
  }
  deliver(data: unknown, source: unknown, origin = ORIGIN) {
    this.listener?.({ data, source, origin } as MessageEvent);
  }
}

function frameWindow() {
  const sent: { message: unknown; origin: string }[] = [];
  return {
    sent,
    window: {
      postMessage: (message: unknown, origin: string) => sent.push({ message, origin }),
    } as unknown as Window,
  };
}

const PREFS: FramePrefs = { tier: "full", sound: false, reducedMotion: false, gloss: true };
const READY = { v: 1, t: "fs.ready", frameId: "member", persona: null, build: "1.0.0+42" } as const;

function grant(exp: number): FrameTokenGrant {
  return { token: "fst_test_0123456789abcdef", exp, persona: "member:M-014", ws: "ws-1" };
}

afterEach(() => vi.useRealTimers());

describe("IC-12 FrameBridge, stage side", () => {
  it("accepts the frame side's own messages and refuses anything outside the protocol", () => {
    expect(ToStage.safeParse(READY).success).toBe(true);
    expect(ToStage.safeParse({ v: 1, t: "fs.feedback", event: "row.printed" }).success).toBe(true);
    expect(ToStage.safeParse({ v: 1, t: "fs.focus", screenId: "M-BD-01" }).success).toBe(true);
    expect(ToStage.safeParse({ v: 2, t: "fs.ready", frameId: "member" }).success).toBe(false);
    expect(ToStage.safeParse({ v: 1, t: "fs.token", token: "x".repeat(20) }).success).toBe(false);
    expect(ToStage.safeParse({ v: 1, t: "fs.feedback", event: "not.an.event" }).success).toBe(false);
    expect(ToFrame.safeParse({ v: 1, t: "fs.prefs", ...PREFS, tier: "reduced" }).success).toBe(false);
  });

  it("opens each persona's frame on the app's labelled demo state, with no token in the URL", () => {
    expect(frameSrc("member")).toBe("/app/?theme=adlaw&demo=member&stage=checking");
    expect(frameSrc("chair")).toBe("/app/?theme=adlaw&demo=board");
    expect(frameSrc("clerk", "/x")).toBe("/x/?theme=adlaw&demo=clerk");
  });

  it("answers fs.ready with the preferences and, once a session exists, a token, posted to its own origin only", async () => {
    const host = new FakeHost();
    const frame = frameWindow();
    const ready = vi.fn();
    const bridge = new StageBridge({
      host,
      tokenFor: async () => grant(Date.now() + 2 * 3600_000),
      onReady: ready,
    });
    bridge.start();
    bridge.setPrefs(PREFS);
    bridge.attach("member", frame.window);
    host.deliver(READY, frame.window);
    await vi.waitFor(() => expect(frame.sent).toHaveLength(2));
    expect(frame.sent.map((s) => (s.message as { t: string }).t)).toEqual(["fs.prefs", "fs.token"]);
    expect(frame.sent.every((s) => s.origin === ORIGIN)).toBe(true);
    expect(ready).toHaveBeenCalledWith("member", { frameId: "member", build: "1.0.0+42" });
    expect(bridge.isReady("member")).toBe(true);
    expect(bridge.buildOf("member")).toBe("1.0.0+42");
  });

  it("ignores messages from another origin or from a window it did not register", () => {
    const host = new FakeHost();
    const frame = frameWindow();
    const stranger = frameWindow();
    const bridge = new StageBridge({ host, tokenFor: async () => null });
    bridge.start();
    bridge.attach("member", frame.window);
    host.deliver(READY, frame.window, "https://evil.example");
    host.deliver(READY, stranger.window);
    host.deliver({ ...READY, v: 2 }, frame.window);
    expect(bridge.isReady("member")).toBe(false);
  });

  it("plays sound only on the stage: frame feedback is routed to the stage's handler", () => {
    const host = new FakeHost();
    const frame = frameWindow();
    const onFeedback = vi.fn();
    const bridge = new StageBridge({ host, tokenFor: async () => null, onFeedback });
    bridge.start();
    bridge.attach("chair", frame.window);
    host.deliver({ v: 1, t: "fs.feedback", event: "seal.complete" }, frame.window);
    expect(onFeedback).toHaveBeenCalledWith("seal.complete", undefined, "chair");
  });

  it("refreshes a token five minutes before it expires, and never sends a staler one", async () => {
    vi.useFakeTimers();
    const now = Date.parse("2026-10-27T10:00:00Z");
    vi.setSystemTime(now);
    const host = new FakeHost();
    const frame = frameWindow();
    const grants = [grant(now + 3600_000), grant(now + 1800_000), grant(now + 7200_000)];
    const tokenFor = vi.fn(async () => grants.shift() ?? null);
    const bridge = new StageBridge({ host, tokenFor, now: () => Date.now() });
    bridge.start();
    bridge.attach("member", frame.window);
    host.deliver(READY, frame.window);
    await vi.advanceTimersByTimeAsync(0);
    expect(frame.sent).toHaveLength(1);
    await bridge.refreshTokens(); // offers a staler grant: refused
    expect(frame.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3600_000 - TOKEN_REFRESH_LEAD_MS);
    expect(frame.sent).toHaveLength(2);
    expect((frame.sent[1]?.message as { exp: number } | undefined)?.exp).toBe(now + 7200_000);
    bridge.stop();
  });

  it("tells every ready frame to drop its session on Reset, and keeps frames registered across stop and start", async () => {
    const host = new FakeHost();
    const frame = frameWindow();
    const bridge = new StageBridge({ host, tokenFor: async () => null });
    bridge.start();
    bridge.attach("clerk", frame.window);
    bridge.stop();
    bridge.start(); // React may restart effects while the iframe stays mounted
    host.deliver({ ...READY, frameId: "clerk", build: DEV_STUB_BUILD }, frame.window);
    expect(bridge.isReady("clerk")).toBe(true);
    expect(bridge.buildOf("clerk")).toBe(DEV_STUB_BUILD);
    bridge.reset();
    expect(frame.sent.map((s) => (s.message as { t: string }).t)).toContain("fs.reset");
  });
});
