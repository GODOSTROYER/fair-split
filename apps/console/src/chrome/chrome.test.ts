// The stage's words: the run pill names the next human step in S1.6's order; the top bar and What's real say
// how PayPal runs (ADR-0002) and never call simulated activity "real", "live" or "verified" (I8, S1.11's CI
// word list); the stage's own states and every refusal read as information, never as an "error".

import { ERROR_CODES } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { describeContext, describeEvent } from "../data/describe.js";
import { ERROR_WORDS, errorView, PAYPAL_CODES } from "../data/errors.js";
import { applyRunEvents, emptyRunView, firstView, sessionView } from "../data/run-view.js";
import { provenanceFooter } from "../lib/provenance.js";
import { createTestWorld, seedSnapshot, type TestWorld } from "../test/world.js";
import { railLine, story, whatsReal } from "./copy.js";
import { nextStep } from "./next-step.js";
import { activeRailItem, placeStates, railItems } from "./rail-items.js";
import { stageNoticeFor } from "./StageNotice.js";

const snapshot = seedSnapshot();
const CTX = { inSession: true, season: "2026-A", recordedOn: "29 Oct", byHandSlip: "0462", payouts: 8 };

function runTo(step: (world: TestWorld) => void) {
  const world = createTestWorld();
  step(world);
  return applyRunEvents(sessionView(snapshot, world), world.eventsAfter(null));
}

describe("run pill (S1.6)", () => {
  it("walks the judge's loop in order, each step with who acts next", () => {
    const first = nextStep(firstView(snapshot), { ...CTX, inSession: false });
    expect(first).toMatchObject({
      id: "mark-paid",
      actor: "person",
      text: "Next: mark the invoice paid (simulated PayPal sandbox)",
    });
    const reading = runTo((w) => {
      w.markPaid();
    });
    expect(nextStep(reading, CTX)).toMatchObject({ id: "by-hand", actor: "person", screen: "W-TR-04" });
    const holds = runTo((w) => {
      w.markPaid();
      w.enterByHand("64.80");
    });
    const step = nextStep(holds, CTX);
    expect(step).toMatchObject({ id: "holds", screen: "W-TR-06", text: "Next: 3 holds need you" });
    expect(step.to).toBe(`/runs/${holds.runSlug}/split?hold=H1`);
    const cosign = runTo((w) => {
      w.markPaid();
      w.resolveAll();
      w.sign("treasurer");
    });
    expect(nextStep(cosign, CTX)).toMatchObject({ id: "cosign", persona: "chair", actor: "person" });
  });

  it("names the open drawer's own decision, never a step elsewhere, while that hold is open", () => {
    const reading = runTo((w) => {
      w.markPaid();
    });
    // Slip 0462 is still open, but the drawer shows H1: the pill names H1's decision and points at its card.
    const h1 = nextStep(reading, { ...CTX, openHold: "H1" });
    expect(h1).toMatchObject({ id: "holds", screen: "W-TR-06", text: "Next: count it once (H1)" });
    expect(h1.to).toBe(`/runs/${reading.runSlug}/split?hold=H1`);
    expect(nextStep(reading, { ...CTX, openHold: "H3" }).text).toBe(
      "Next: return the multa as a credit (H3)",
    );
    // A decided hold, or no drawer, gives the run's own next step back.
    const decided = runTo((w) => {
      w.markPaid();
      w.enterByHand("64.80");
      w.resolve("H1");
    });
    expect(nextStep(decided, { ...CTX, openHold: "H1" }).text).toBe("Next: 2 holds need you");
    expect(nextStep(reading, { ...CTX, openHold: null }).id).toBe("by-hand");
  });
});

describe("console rail places (S1.7)", () => {
  const items = railItems("2026-A", "2026A-r37");

  it("marks the places done, next or still ahead from the pill's step", () => {
    expect(placeStates(items, "W-JG-01", true)).toEqual({
      season: "next",
      "rate-card": "done",
      reading: "later",
      split: "later",
      approve: "later",
      run: "later",
    });
    expect(placeStates(items, "W-TR-06", true)).toEqual({
      season: "done",
      "rate-card": "done",
      reading: "done",
      split: "next",
      approve: "later",
      run: "later",
    });
    // Proof is the last step: every place is done.
    expect(Object.values(placeStates(items, "W-PF-01", true))).toEqual(Array(6).fill("done"));
    expect(placeStates(items, null, true)).toEqual({});
  });
});

describe("the ribbon's words", () => {
  it("says the season check in the engine's figures, raised and cleared, and an item's whole ID", () => {
    const ctx = describeContext(snapshot);
    const world = createTestWorld();
    world.markPaid();
    world.enterByHand("64.80");
    world.resolve("H1");
    const rows = world
      .eventsAfter(null)
      .map((e) => describeEvent(e, ctx))
      .filter((r) => r !== null);
    const check = rows.filter((r) => r.words.startsWith("Season check"));
    expect(check.map((r) => [r.lane, r.words])).toEqual([
      ["MACHINE", "Season check: shrink 2.05%, over 2.0%"],
      ["MACHINE", "Season check: shrink 1.62%, inside 2.0%"],
    ]);
    expect(rows.some((r) => /Mass balance: Mass balance/.test(r.words))).toBe(false);
    world.resolveAll();
    world.sign("treasurer");
    world.cosign();
    const paid = world
      .eventsAfter(null)
      .map((e) => describeEvent(e, ctx))
      .find((r) => r?.type === "item.updated" && r.words.startsWith("Paid "));
    expect(paid?.detail).toMatch(/item [A-Z0-9]{8,}(,|$)/);
    expect(paid?.detail).not.toMatch(/…/);
  });
});

describe("honest labels (I8: nothing simulated is unlabelled)", () => {
  const facts = {
    rail: "simulator" as const,
    recordedOn: "29 Oct",
    replayPhotos: 12,
    replaySlips: 48,
    earlierPhotos: 54,
    members: 64,
    paypalMembers: 8,
  };

  it("inv.i8.top-bar: the story names the simulated rail, and never says live", () => {
    expect(story(64)).toBe("A cacao co-op pays 64 farmers from one brand invoice.");
    expect(railLine("simulator")).toMatch(/simulated PayPal sandbox/i);
    expect(railLine("sandbox")).not.toMatch(/\blive\b/i);
  });

  it("inv.i8.whats-real: under the simulator, PayPal is listed as simulated, never as real", () => {
    const sections = whatsReal(facts);
    const real = sections.find((s) => s.id === "real");
    expect(real?.items.join(" ")).not.toMatch(/PayPal/);
    expect(sections.find((s) => s.id === "simulated-paypal")?.title).toBe("PayPal, simulated");
    expect(sections.some((s) => s.id === "real-paypal")).toBe(false);
    const sandbox = whatsReal({ ...facts, rail: "sandbox" });
    expect(sandbox.some((s) => s.id === "real-paypal")).toBe(true);
  });

  it("inv.i8.log: a simulated PayPal notice is never called verified", () => {
    const ctx = describeContext(snapshot);
    const world = createTestWorld();
    world.markPaid();
    const rows = world
      .eventsAfter(null)
      .filter((e) => e.provenance === "simulated_rail")
      .map((e) => describeEvent(e, ctx))
      .filter((r) => r !== null);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(`${row.words} ${row.detail}`).not.toMatch(/verified/i);
  });

  it("inv.i8.footers: a PayPal footer says which rail it came from", () => {
    expect(provenanceFooter({ kind: "paypal", source: "webhook", rail: "simulator" })).toBe(
      "Simulated PayPal sandbox, webhook, signature checked",
    );
    expect(provenanceFooter({ kind: "paypal", source: "webhook", rail: "sandbox" })).toBe(
      "PayPal, webhook, signature verified",
    );
    expect(
      provenanceFooter({
        kind: "paypal",
        source: "status_check",
        rail: "sandbox",
        provenance: "simulated_rail",
      }),
    ).toBe("Simulated PayPal sandbox, status check");
    expect(provenanceFooter({ kind: "claude", replayOf: "2026-10-29" })).toBe(
      "Read by Claude (claude-opus-5-5), replay of the 29 Oct run",
    );
    expect(provenanceFooter({ kind: "engine", rateCardSha256: snapshot.rateCard.sha256 })).toBe(
      `Computed by engine v1, rate card ${snapshot.figures.display.rc}`,
    );
  });
});

describe("refusals and stage states", () => {
  it("has the console's words for every error code, and red only when PayPal is the actor", () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_WORDS[code], code).toBeTruthy();
      expect(ERROR_WORDS[code]).not.toMatch(/\berror\b|\bfraud\b|!/i);
    }
    expect([...PAYPAL_CODES].sort()).toEqual(["PAYPAL_REJECTED", "PAYPAL_UNAVAILABLE"]);
    expect(errorView(new Error("boom"))).toMatchObject({ paypal: false, code: null, detail: "boom" });
  });

  it("shows one stage state at a time, the most pressing first", () => {
    const view = emptyRunView("2026A-r4170001", "session");
    const active = { status: "active" as const, session: null, error: null };
    expect(stageNoticeFor({ session: active, view, autoplay: "off", inSession: true })).toBeNull();
    expect(
      stageNoticeFor({
        session: { ...active, status: "resetting" },
        view,
        autoplay: "autoplay",
        inSession: true,
      })?.state,
    ).toBe("resetting");
    expect(stageNoticeFor({ session: active, view, autoplay: "paused", inSession: true })?.text).toBe(
      "Paused. You're driving.",
    );
    const queued = {
      ...active,
      session: {
        sessionId: "s",
        workspaceId: "w",
        runId: "r",
        runSlug: "2026A-r4170001",
        expiresAt: "2026-10-27T12:00:00Z",
        queuePosition: 1,
      },
    };
    expect(stageNoticeFor({ session: queued, view, autoplay: "off", inSession: true })?.text).toBe(
      "The simulated PayPal sandbox is pacing us (PayPal’s documented limit, modelled). You’re next, about 40 s.",
    );
    const ai = { ...view, flags: { kill_ai_live: true } };
    expect(stageNoticeFor({ session: active, view: ai, autoplay: "off", inSession: true })?.state).toBe(
      "ai-off",
    );
  });
});

describe("console rail", () => {
  it("lists the six places and knows which one a path belongs to", () => {
    const items = railItems("2026-A", "2026A-r37");
    expect(items.map((i) => i.id)).toEqual(["season", "rate-card", "reading", "split", "approve", "run"]);
    expect(activeRailItem("/judge")).toBe("season");
    expect(activeRailItem("/season/2026-A/by-hand/0462")).toBe("reading");
    expect(activeRailItem("/runs/2026A-r37/members/M-053/print")).toBe("split");
    expect(activeRailItem("/runs/2026A-r37/fanout")).toBe("run");
    expect(activeRailItem("/proof/2026A-r37")).toBeNull();
  });
});
