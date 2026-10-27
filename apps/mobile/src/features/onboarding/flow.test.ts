import { describe, expect, it } from "vitest";
import { SCREEN_STATES } from "../../_shims/contracts";
import {
  afterPairing,
  firstLanguage,
  languageFromLocale,
  largeText,
  type PairState,
  pairScreenState,
  QR_CELLS,
  qrFacsimileCells,
  scanRefused,
  shouldClaimScan,
  stampInitials,
  stencilGlyphs,
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

  it("claims a scanned code once, and never again after a refusal until another code or Scan again", () => {
    // The camera keeps reporting the same expired QR: one claim, then silence.
    expect(shouldClaimScan(null, "fairsplit://pair?t=abc", "idle")).toBe(true);
    expect(shouldClaimScan("fairsplit://pair?t=abc", "fairsplit://pair?t=abc", "pairing")).toBe(false);
    expect(shouldClaimScan("fairsplit://pair?t=abc", "fairsplit://pair?t=abc", "expired")).toBe(false);
    // The treasurer shows a new QR: a different code is claimed.
    expect(shouldClaimScan("fairsplit://pair?t=abc", "fairsplit://pair?t=def", "expired")).toBe(true);
    // "Scan again" forgets the last code, so the same QR can be tried once more (back in signal, say).
    expect(shouldClaimScan(null, "fairsplit://pair?t=abc", "offline")).toBe(true);
    expect(shouldClaimScan(null, "fairsplit://pair?t=abc", "paired")).toBe(false);
    expect(shouldClaimScan(null, "  ", "idle")).toBe(false);
  });

  it("stencils the season and lot marks with bridges only where a counter would fall out", () => {
    const cut = (s: string) =>
      stencilGlyphs(s)
        .map((g) => (g.bridged ? g.char : "."))
        .join("");
    expect(cut("2026-A")).toBe(".0.6.A");
    expect(cut("LB-PH-2026-03")).toBe(".B.P...0.6.0.");
    expect(
      stencilGlyphs("2026-a")
        .map((g) => g.char)
        .join(""),
    ).toBe("2026-A");
  });

  it("draws the same facsimile QR every time, clear of its three finder squares", () => {
    const cells = qrFacsimileCells();
    expect(qrFacsimileCells()).toEqual(cells);
    for (const [r, c] of cells) {
      expect(r >= 0 && r < QR_CELLS && c >= 0 && c < QR_CELLS).toBe(true);
      const corner = (r < 8 && c < 8) || (r < 8 && c > 16) || (r > 16 && c < 8);
      expect(corner, `${r},${c}`).toBe(false);
    }
    const open = QR_CELLS * QR_CELLS - 3 * 64;
    expect(cells.length / open).toBeGreaterThan(0.3);
    expect(cells.length / open).toBeLessThan(0.6);
  });

  it("stamps first and last initials, never a middle initial", () => {
    expect(stampInitials("Ernesto P. Cabahug")).toBe("EC");
    expect(stampInitials("Analyn R. Sumalinog")).toBe("AS");
    expect(stampInitials("Jessie")).toBe("J");
    expect(stampInitials("")).toBe("");
  });

  it("offers Scan again only after a refused claim", () => {
    const refused: PairState[] = ["expired", "used", "invalid", "offline", "error"];
    for (const s of refused) expect(scanRefused(s)).toBe(true);
    for (const s of ["idle", "pairing", "paired"] as PairState[]) expect(scanRefused(s)).toBe(false);
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
