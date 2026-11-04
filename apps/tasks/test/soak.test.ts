// tools/soak (the judge-load soak, handoff T5): its pure parts. The load run itself needs a running stack.
import { describe, expect, it } from "vitest";
import type { StreamEvent } from "../../../tools/soak/client.js";
import { checkRailLabel, fanoutSamples, rank, SIMULATED_LABEL } from "../../../tools/soak/judge.js";
import {
  cell,
  judgeAddress,
  parseArgs,
  percentile,
  summarize,
  tally,
  toCsv,
} from "../../../tools/soak/stats.js";

const ev = (id: string, at: number, arrivedAt: number, replayed = false): StreamEvent => ({
  id,
  type: "run.state",
  provenance: "simulated_rail",
  at,
  payload: {},
  arrivedAt,
  replayed,
});

describe("soak stats", () => {
  it("takes nearest-rank percentiles of the finite values", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile([3, Number.NaN, 1, 2], 100)).toBe(3);
    expect(percentile([], 50)).toBeNaN();
    expect(summarize([1, 2, 3, Number.NaN])).toMatchObject({ n: 3, p50: 2, max: 3, mean: 2 });
  });
  it("writes CSV cells: rounded numbers, empty NaN, quoted text", () => {
    expect(cell(1.25, 1)).toBe("1.3");
    expect(cell(Number.NaN)).toBe("");
    expect(cell('a,"b"')).toBe('"a,""b"""');
    expect(toCsv(["x", "y"], [{ x: 1, y: "z" }])).toBe("x,y\n1,z\n");
  });
  it("gives every judge its own loopback address, never .0 or .255", () => {
    expect(judgeAddress(0)).toBe("127.10.0.1");
    expect(judgeAddress(253)).toBe("127.10.0.254");
    expect(judgeAddress(254)).toBe("127.10.1.1");
    expect(judgeAddress(0, 42)).toBe("127.42.0.1");
    const many = new Set(Array.from({ length: 2000 }, (_, i) => judgeAddress(i)));
    expect(many.size).toBe(2000);
    expect(() => judgeAddress(-1)).toThrow();
  });
  it("tallies and parses arguments", () => {
    expect(tally(["replay", "live", "replay"])).toBe("live:1 replay:2");
    const a = parseArgs(["--judges=25", "--shared-ip", "x"]);
    expect(a.get("judges")).toBe("25");
    expect(a.get("shared-ip")).toBe("true");
  });
});

describe("soak judge checks", () => {
  it("orders run states forward", () => {
    expect(rank("POSTING")).toBeGreaterThan(rank("APPROVED"));
    expect(rank("SETTLED")).toBeGreaterThan(rank("NEEDS_FOLLOW_UP"));
    expect(rank("nope")).toBe(-1);
  });
  it("inv.i8.soak-labels: a replay must read 'Replay: …', a live run the simulated label", () => {
    const notes: string[] = [];
    const v = (n: string) => notes.push(n);
    checkRailLabel(
      { mode: "replay", label: "Replay: this hour's simulated PayPal sandbox payouts are used up" },
      v,
      "t",
    );
    checkRailLabel({ mode: "live", label: SIMULATED_LABEL }, v, "t");
    expect(notes).toEqual([]);
    checkRailLabel({ mode: "replay", label: SIMULATED_LABEL }, v, "t");
    checkRailLabel({ mode: "live", label: "PayPal" }, v, "t");
    checkRailLabel({ mode: "replay", label: "Replay: Paid" }, v, "t");
    checkRailLabel(undefined, v, "t");
    expect(notes).toHaveLength(4);
  });
  it("measures fan-out on live events seen by both streams, flagging each burst's last-written event", () => {
    const a = [ev("1", 1000, 1100), ev("2", 1050, 1101), ev("3", 2000, 2010), ev("0", 500, 900, true)];
    const b = [ev("1", 1000, 1104), ev("2", 1050, 1104), ev("3", 2000, 2030)];
    const s = fanoutSamples(a, b);
    expect(s).toHaveLength(3);
    expect(s.map((x) => x.tail)).toEqual([false, true, true]);
    expect(s[1]).toEqual({ lagA: 51, lagB: 54, spread: 3, tail: true });
    expect(s[2]?.spread).toBe(20);
  });
});
