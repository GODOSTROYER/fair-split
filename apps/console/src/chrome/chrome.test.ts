// The stage's words: the run pill names the next human step in S1.6's order; the top bar and What's real say
// how PayPal runs (ADR-0002) and never call simulated activity "real", "live" or "verified" (I8, S1.11's CI
// word list); the stage's own states and every refusal read as information, never as an "error".

import { ERROR_CODES } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { describeContext, describeEvent } from "../data/describe.js";
import { ERROR_WORDS, errorView, PAYPAL_CODES } from "../data/errors.js";
import { applyRunEvents, emptyRunView, firstView } from "../data/run-view.js";
import { provenanceFooter } from "../lib/provenance.js";
import { createTestWorld, seedSnapshot } from "../test/world.js";
import { railLine, story, whatsReal } from "./copy.js";
import { nextStep } from "./next-step.js";
import { activeRailItem, railItems } from "./rail-items.js";
import { stageNoticeFor } from "./StageNotice.js";

const snapshot = seedSnapshot();
const CTX = { inSession: true, season: "2026-A", recordedOn: "29 Oct", byHandSlip: "0462", payouts: 8 };

function runTo(step: (world: ReturnType<typeof createTestWorld>, runSlug: string) => void) {
  const world = createTestWorld();
  const session = world.createJudgeSession();
  step(world, session.runSlug);
  return applyRunEvents(
    emptyRunView(session.runSlug, "session"),
    world.eventsAfter(`run:${session.runSlug}`, null),
  );
}

describe("run pill (S1.6)", () => {
  it("walks the judge's loop in order, each step with who acts next", () => {
    const first = nextStep(firstView(snapshot), { ...CTX, inSession: false });
    expect(first).toMatchObject({
      id: "mark-paid",
      actor: "person",
      text: "Next: mark the invoice paid (sandbox)",
    });
    const reading = runTo((w, r) => {
      w.markPaid(r);
    });
    expect(nextStep(reading, CTX)).toMatchObject({ id: "by-hand", actor: "person", screen: "W-TR-04" });
    const holds = runTo((w, r) => {
      w.markPaid(r);
      w.enterField(w.byHandFieldId(r) ?? "", { value: "64.80" });
    });
    const step = nextStep(holds, CTX);
    expect(step).toMatchObject({ id: "holds", screen: "W-TR-06", text: "Next: 3 holds need you" });
    expect(step.to).toBe(`/runs/${holds.runSlug}/split?hold=H1`);
    const cosign = runTo((w, r) => {
      w.markPaid(r);
      w.enterField(w.byHandFieldId(r) ?? "", { value: "64.80" });
      for (const label of ["H1", "H2", "H3"] as const) {
        const id = w.holdIdFor(r, label) ?? "";
        if (label === "H1") w.resolveHold(id, { resolution: "COUNT_ONCE" });
        if (label === "H2")
          w.resolveHold(id, {
            resolution: "REGISTER_PLOT",
            plot: { plotNo: "P-053-B", areaHa: "0.80", trees: 120 },
          });
        if (label === "H3") w.resolveHold(id, { resolution: "RETURN_AS_CREDIT" });
      }
      const payload = w.approvalPayload(r, "treasurer").payload;
      w.submitApproval(r, { role: "treasurer", keyId: "fs-analyn-w1", signature: "b".repeat(128), payload });
    });
    expect(nextStep(cosign, CTX)).toMatchObject({ id: "cosign", persona: "chair", actor: "person" });
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
    expect(railLine("simulator")).toMatch(/simulated PayPal sandbox/);
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
    const session = world.createJudgeSession();
    world.markPaid(session.runSlug);
    const rows = world
      .eventsAfter(`run:${session.runSlug}`, null)
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
      "PayPal’s sandbox is pacing us. You’re next, about 40 s.",
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
