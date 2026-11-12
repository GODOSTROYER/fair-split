import { describe, expect, it, vi } from "vitest";
import { SCREEN_STATES } from "../../_shims/contracts";
import { type PairedSession, pairingChanged } from "../../services/session";
import {
  afterPairing,
  firstLanguage,
  type LinkAnswer,
  languageFromLocale,
  linkClaimNeedsConfirm,
  linkStep,
  type PairState,
  pairScreenState,
  QR_CELLS,
  qrFacsimileCells,
  scanRefused,
  shouldClaimScan,
  stampInitials,
  textSizePct,
} from "./flow";

/** The Chair's phone, paired to his co-op (his signing key, fs-ernesto-a1, is bound to this pairing). */
const chair: PairedSession = {
  kind: "device",
  bearer: "fsd_chair_phone",
  expiresAt: "2027-01-01T00:00:00Z",
  workspaceId: "ws_bulawanon",
  persona: "board:ernesto",
  role: "board",
  memberNo: null,
  displayName: "Ernesto P. Cabahug",
  lang: "ceb",
  pairedAt: "2026-10-20T08:00:00Z",
};

/** What the link's token claims: some other workspace, seeded to look the same. */
const elsewhere: PairedSession = {
  ...chair,
  bearer: "fsd_other",
  workspaceId: "ws_somebody_else",
  pairedAt: "2026-10-28T09:00:00Z",
};

/**
 * A pairing link opened on this phone, end to end as the app runs it: the screen's step (`linkStep`), the claim when
 * the step says so, then the shell's rule (state/app.tsx): the signing key is forgotten whenever the pairing changes.
 */
async function openLink(session: PairedSession | null, answer: LinkAnswer | null) {
  const claim = vi.fn(async (_token: string) => elsewhere);
  const forget = vi.fn();
  let paired = session;
  const step = linkStep({ session, token: "fsp_from_a_link", answer });
  if (step === "claim") {
    const next = await claim("fsp_from_a_link");
    if (pairingChanged(paired, next)) forget();
    paired = next;
  }
  return { step, claim, forget, paired };
}

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

  it("reads the text size as a percentage", () => {
    expect(textSizePct(1)).toBe(100);
    expect(textSizePct(1.3)).toBe(130);
    expect(textSizePct(Number.NaN)).toBe(100);
  });
});

describe("a pairing link never replaces a pairing by itself (re-pairing trust)", () => {
  it("asks first on a paired phone, and claims at once on an unpaired one (a judge's QR link)", () => {
    expect(linkClaimNeedsConfirm(chair, "fsp_from_a_link")).toBe(true);
    expect(linkClaimNeedsConfirm(null, "fsp_from_a_link")).toBe(false);
    // No token, no question: the screen is the ordinary pairing card.
    expect(linkClaimNeedsConfirm(chair, undefined)).toBe(false);
    expect(linkClaimNeedsConfirm(chair, "   ")).toBe(false);

    expect(linkStep({ session: chair, token: "fsp_from_a_link", answer: null })).toBe("ask");
    expect(linkStep({ session: null, token: "fsp_from_a_link", answer: null })).toBe("claim");
    expect(linkStep({ session: chair, token: undefined, answer: null })).toBe("none");
    expect(linkStep({ session: null, token: "", answer: null })).toBe("none");
  });

  it("treats a stored pairing it could not read as paired: a link asks first, and waits until storage is read", () => {
    // A keystore read error is not "nothing stored": the phone may hold a pairing (and a board key) it cannot see.
    expect(linkClaimNeedsConfirm(null, "fsp_from_a_link", true)).toBe(true);
    expect(linkStep({ session: null, token: "fsp_from_a_link", answer: null, pairingUnreadable: true })).toBe(
      "ask",
    );
    expect(
      linkStep({ session: null, token: "fsp_from_a_link", answer: "cancel", pairingUnreadable: true }),
    ).toBe("keep");
    expect(
      linkStep({ session: null, token: "fsp_from_a_link", answer: "confirm", pairingUnreadable: true }),
    ).toBe("claim");
    // Read and empty: an unpaired phone still pairs from the QR's link in one step.
    expect(
      linkStep({ session: null, token: "fsp_from_a_link", answer: null, pairingUnreadable: false }),
    ).toBe("claim");
    // Before the shell has read storage, a link waits: neither a claim nor a question.
    expect(linkStep({ session: null, token: "fsp_from_a_link", answer: null, ready: false })).toBe("none");
    expect(linkStep({ session: chair, token: "fsp_from_a_link", answer: "confirm", ready: false })).toBe(
      "none",
    );
  });

  it("claims only once the person confirms, and then the old pairing's key goes, as the dialog said", async () => {
    expect(linkStep({ session: chair, token: "fsp_from_a_link", answer: "confirm" })).toBe("claim");
    const r = await openLink(chair, "confirm");
    expect(r.claim).toHaveBeenCalledOnce();
    expect(r.forget).toHaveBeenCalledOnce();
    expect(r.paired).toBe(elsewhere);
  });

  it("cancelling claims nothing: the session and the Chair's signing key stay as they were", async () => {
    expect(linkStep({ session: chair, token: "fsp_from_a_link", answer: "cancel" })).toBe("keep");
    const r = await openLink(chair, "cancel");
    expect(r.claim).not.toHaveBeenCalled();
    expect(r.forget).not.toHaveBeenCalled();
    expect(r.paired).toBe(chair);
  });

  it("waiting for the answer claims nothing either", async () => {
    const r = await openLink(chair, null);
    expect(r.step).toBe("ask");
    expect(r.claim).not.toHaveBeenCalled();
    expect(r.forget).not.toHaveBeenCalled();
  });

  it("an unpaired phone claims the link with no question, and has no key to lose", async () => {
    const r = await openLink(null, null);
    expect(r.claim).toHaveBeenCalledOnce();
    expect(r.forget).not.toHaveBeenCalled();
    expect(r.paired).toBe(elsewhere);
  });
});
