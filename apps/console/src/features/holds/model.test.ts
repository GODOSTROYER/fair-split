// W-TR-06's model against the seed and the mock world: both voices of every hold, built from the engine's own
// facts (the digits must equal the seed's engine lines), MM-3's honest field count, each decision's printed
// result, and where the treasurer goes next.

import { describe, expect, it } from "vitest";
import { applyRunEvents, type RunView, sessionView, showcaseView } from "../../data/run-view.js";
import { createTestWorld, seedSnapshot } from "../../test/world.js";
import {
  cardState,
  factsFor,
  findHold,
  nextAfter,
  noRuleFacts,
  position,
  resultLine,
  slipCopies,
  twinRows,
  voices,
  yieldFacts,
} from "./model.js";

const snapshot = seedSnapshot();
const straight = (s: string) => s.replaceAll("‘", "'").replaceAll("’", "'");

function viewOf(world: ReturnType<typeof createTestWorld>): RunView {
  return applyRunEvents(
    sessionView(snapshot, { runSlug: world.runSlug, runId: world.runId }),
    world.events(),
  );
}

function inReview() {
  const world = createTestWorld();
  world.markPaid();
  return world;
}

const seededLine = (label: string) => snapshot.holds.find((h) => h.label === label)?.engineLine ?? "";

describe("finding the hold the drawer shows", () => {
  it("by label (?hold=H1) or by ID, with its place among the three cards", () => {
    const world = inReview();
    const view = viewOf(world);
    const byLabel = findHold(view, "H1");
    expect(byLabel?.kind).toBe("DUPLICATE_SLIP");
    expect(findHold(view, world.holdId("H2"))?.label).toBe("H2");
    expect(findHold(view, "H9")).toBeUndefined();
    expect(byLabel && position(view, byLabel)).toEqual({ index: 1, total: 3 });
  });

  it("maps the register's hold states onto the card's", () => {
    const view = viewOf(inReview());
    const h1 = findHold(view, "H1");
    if (!h1) throw new Error("no H1");
    expect(cardState(h1, { resolving: false, conflict: false })).toBe("open");
    expect(cardState(h1, { resolving: true, conflict: false })).toBe("resolving");
    expect(cardState(h1, { resolving: false, conflict: true })).toBe("conflict");
    expect(cardState({ ...h1, state: "ASKED_CHAIR" }, { resolving: false, conflict: false })).toBe(
      "asked-chair",
    );
    expect(cardState({ ...h1, state: "RESOLVED" }, { resolving: false, conflict: false })).toBe("resolved");
    expect(cardState({ ...h1, state: "EXCLUDED" }, { resolving: false, conflict: false })).toBe("excluded");
  });
});

describe("two voices, every digit from the engine", () => {
  it("H1, H2 and H3 print one engine line whose every figure is the seed's engine line's, once 0462 is in", () => {
    const world = inReview();
    world.enterByHand();
    const view = viewOf(world);
    const figures = (s: string) => straight(s).match(/\d[\d.,]*\d|\d/g) ?? [];
    for (const label of ["H1", "H2", "H3"]) {
      const hold = findHold(view, label);
      if (!hold) throw new Error(`no ${label}`);
      const v = voices(snapshot, view, hold);
      // The unslopped line is one sentence (spec §3.7), shorter than the seed's paragraph...
      expect(v.engineLine.length, label).toBeLessThan(seededLine(label).length);
      expect(v.engineLine.split(". ").length, label).toBe(label === "H2" ? 2 : 1);
      // ...and every figure in it is a figure the engine's own sentence states (I1: no digit of its own).
      const seeded = new Set(figures(seededLine(label)));
      expect(figures(v.engineLine).length, label).toBeGreaterThan(0);
      for (const figure of figures(v.engineLine)) expect(seeded.has(figure), `${label} ${figure}`).toBe(true);
      // H1's seed sentence goes (round 3): its captions say "pink duplicate" and its glyph says "stand-in".
      expect(v.claudeLine, label).toBe(
        label === "H1" ? null : snapshot.holds.find((h) => h.label === label)?.claudeLine,
      );
      expect(v.claudeLine ?? "", label).not.toMatch(/\d/);
    }
  });

  it("before slip 0462, H1 says the dial still reads inside the limit, with the engine's figures then", () => {
    const view = viewOf(inReview());
    const h1 = findHold(view, "H1");
    if (!h1) throw new Error("no H1");
    const v = voices(snapshot, view, h1);
    expect(v.engineLine).toMatch(/US\$18\.06/);
    expect(v.engineLine).toMatch(/1\.38%, inside the 2\.0% limit/);
    expect(v.effect).toBe("If counted once: +US$18.06 to 63 members · shrink after slip 0462");
  });

  it("H1's titles and money effect", () => {
    const world = inReview();
    world.enterByHand();
    const view = viewOf(world);
    const h1 = findHold(view, "H1");
    if (!h1) throw new Error("no H1");
    const v = voices(snapshot, view, h1);
    expect(v.title).toBe("Slip 0457 counted twice");
    // Counting both, as a number line; counting once, the money back and the dial's move (round 3).
    expect(v.engineLine).toBe("63 members −US$17.94 → Nong Dioning +US$17.94");
    // One effect line (round 4): what counting it once does, the money and the dial's move.
    expect(v.effect).toBe("If counted once: +US$17.94 to 63 members · 2.05% → 1.62%");
    expect(voices(snapshot, view, { ...h1, state: "RESOLVED", resolution: "COUNT_ONCE" }).title).toBe(
      "Slip 0457, counted once",
    );
  });

  it("H2 reads Merlyn's registry: 140 trees registered, P-053-B (0.60 ha, 330 trees) not yet", () => {
    const view = viewOf(inReview());
    const h2 = findHold(view, "H2");
    if (!h2) throw new Error("no H2");
    const member = snapshot.members.find((m) => m.memberNo === "M-053");
    const y = yieldFacts(snapshot, h2, member);
    expect(y).toMatchObject({ kg: "300.0 kg", trees: 140, perTree: "2.14", limit: "1.6", treesAfter: 470 });
    expect(y.pendingPlot).toEqual({ plotNo: "P-053-B", areaHa: "0.60", trees: 330 });
    expect(y.ratio).toBeGreaterThan(1);
    expect(y.ratioAfter).toBeLessThan(1);
  });
});

describe("MM-3's evidence: matching fields, honestly counted", () => {
  it("the white original (photo B) and the pink duplicate (photo D) match on 4 of 4 fields", () => {
    const [a, b] = slipCopies(snapshot, "0457");
    if (!a || !b) throw new Error("slip 0457 needs two copies");
    expect([a.copy, a.photoId, b.copy, b.photoId]).toEqual(["WHITE_ORIGINAL", "B", "PINK_DUPLICATE", "D"]);
    const rows = twinRows(a, b);
    expect(rows.map((r) => r.field)).toEqual(["serial", "date", "member", "net"]);
    expect(rows.every((r) => r.match)).toBe(true);
  });

  it("a copy that differs is counted as different (3 of 4)", () => {
    const [a, b] = slipCopies(snapshot, "0457");
    if (!a || !b) throw new Error("slip 0457 needs two copies");
    const rows = twinRows(a, { ...b, boxes: { ...b.boxes, "8": "41.00" } });
    expect(rows.filter((r) => r.match)).toHaveLength(3);
  });
});

describe("what a decision prints, and what comes next", () => {
  it("each resolution prints the engine's result; the next step walks H1 → H2 → H3 → Approve", () => {
    const world = inReview();
    world.enterByHand();
    world.resolve("H1");
    let view = viewOf(world);
    const h1 = findHold(view, "H1");
    if (!h1) throw new Error("no H1");
    expect(resultLine(snapshot, view, h1, h1.resolution)).toBe("+US$17.94 back to 63 members");
    expect(nextAfter(snapshot, view, h1)).toMatchObject({
      kind: "hold",
      href: `/runs/${world.runSlug}/split?hold=H2`,
    });
    world.resolve("H2", {
      resolution: "REGISTER_PLOT",
      plot: { plotNo: "P-053-B", areaHa: "0.60", trees: 330 },
    });
    world.resolve("H3");
    view = viewOf(world);
    const h2 = findHold(view, "H2");
    const h3 = findHold(view, "H3");
    if (!h2 || !h3) throw new Error("no H2 or H3");
    expect(resultLine(snapshot, view, h2, h2.resolution)).toBe(
      "300.0 kg from 470 trees is 0.64 kg a tree. Inside the limit.",
    );
    expect(resultLine(snapshot, view, h3, h3.resolution)).toBe("+US$3.20 credit, paid by the co-op");
    expect(nextAfter(snapshot, view, h3)).toMatchObject({
      kind: "approve",
      href: `/runs/${world.runSlug}/approve`,
    });
  });

  it("two deliveries is an override the Chair co-signs; the showcase's holds are all decided", () => {
    const world = inReview();
    world.enterByHand();
    world.resolve("H1", { resolution: "TWO_DELIVERIES", reason: "Two sacks that day" });
    const view = viewOf(world);
    const h1 = findHold(view, "H1");
    if (!h1) throw new Error("no H1");
    expect(resultLine(snapshot, view, h1, h1.resolution)).toMatch(/override: Ernesto co-signs/);
    const show = showcaseView(snapshot);
    for (const label of ["H1", "H2", "H3"]) expect(findHold(show, label)?.state).toBe("RESOLVED");
  });
});

describe("API hold facts without display strings", () => {
  it("matches a live H3 UUID key to this member's engine hold without hold DTO credit params", () => {
    const view = viewOf(inReview());
    const hold = findHold(view, "H3");
    if (!hold) throw new Error("H3 required");
    const liveHold = { ...hold, key: "NO_RULE:52f182bb-09fc-4ff8-bbd9-e13b80195ce7" };
    const actual = noRuleFacts(snapshot, liveHold, factsFor(snapshot, view, liveHold));
    expect(actual.written).toBe("₱200");
    expect(actual.credit).toBe("US$3.20");
    expect(actual.creditCents).toBe(320);
    expect(voices(snapshot, view, liveHold).effect).toContain("US$3.20 correction credit");
  });

  it("falls back to the slip mark and engine credit cents for the H3 amounts", () => {
    const view = viewOf(inReview());
    const hold = findHold(view, "H3");
    const facts = snapshot.checkpoints.read.holds.find((h) => h.kind === "NO_RULE");
    if (!hold || !facts) throw new Error("H3 required");
    const {
      writtenDisplay: _written,
      writtenCentavos: _centavos,
      creditDisplay: _credit,
      ...params
    } = facts.params;
    const actual = noRuleFacts(snapshot, hold, { ...facts, params });
    expect(actual.written).toBe("₱200");
    expect(actual.credit).toBe("US$3.20");
    expect(actual.creditCents).toBe(320);
  });
});
