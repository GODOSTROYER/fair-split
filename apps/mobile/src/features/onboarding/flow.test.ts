import { describe, expect, it } from "vitest";
import { SCREEN_STATES } from "../../_shims/contracts";
import {
  afterPairing,
  firstLanguage,
  languageFromLocale,
  largeText,
  type PairState,
  pairScreenState,
  textSizePct,
} from "./flow";

describe("M-ON-01 flow", () => {
  it("asks members read-or-listen once, after pairing, and never infers it", () => {
    expect(afterPairing("member", null)).toBe("listen-choice");
    expect(afterPairing("member", true)).toBe("home");
    expect(afterPairing("member", false)).toBe("home");
    expect(afterPairing("board", null)).toBe("home");
    expect(afterPairing("clerk", null)).toBe("home");
  });

  it("shows the camera-denied state only while nothing else is happening", () => {
    expect(pairScreenState({ state: "idle", cameraDenied: true, listenChoice: false })).toBe("camera-denied");
    expect(pairScreenState({ state: "pairing", cameraDenied: true, listenChoice: false })).toBe("pairing");
    expect(pairScreenState({ state: "paired", cameraDenied: false, listenChoice: true })).toBe(
      "listen-choice",
    );
  });

  it("only produces IC-01 states", () => {
    const states: PairState[] = [
      "idle",
      "pairing",
      "paired",
      "expired",
      "used",
      "invalid",
      "offline",
      "error",
    ];
    for (const state of states) {
      for (const cameraDenied of [true, false]) {
        for (const listenChoice of [true, false]) {
          expect(SCREEN_STATES["M-ON-01"]).toContain(pairScreenState({ state, cameraDenied, listenChoice }));
        }
      }
    }
  });

  it("takes the registry's language first, then the browser's", () => {
    expect(languageFromLocale("en-US")).toBe("en");
    expect(languageFromLocale("fil_PH")).toBe("fil");
    expect(languageFromLocale("tl")).toBe("fil");
    expect(languageFromLocale("ceb-PH")).toBe("ceb");
    expect(languageFromLocale("ja-JP")).toBeNull();
    expect(languageFromLocale(undefined)).toBeNull();
    expect(firstLanguage("ceb", "en-US")).toBe("ceb");
    expect(firstLanguage(null, "en-GB")).toBe("en");
  });

  it("reads the text size as a percentage, and stacks from 1.3×", () => {
    expect(textSizePct(1)).toBe(100);
    expect(textSizePct(1.3)).toBe(130);
    expect(textSizePct(Number.NaN)).toBe(100);
    expect(largeText(1.29)).toBe(false);
    expect(largeText(2)).toBe(true);
  });
});
