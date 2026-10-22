import { describe, expect, it } from "vitest";
import {
  AMOUNT_STATE,
  AMOUNT_STATES,
  amountStateOf,
  LINE_STATES,
  MEMBER_STATUS_WORDS,
  SCREEN,
  SCREEN_STATES,
  SLAB_STATES,
} from "./contracts";
import { batchDigest, linesDigest as digestLines, FEE_TABLE, format, fsm, jcs, sha256Hex } from "./domain";
import { SMALL_SEAL_MAX, seal, sealStroke } from "./seal";
import {
  batchItems,
  batchSha256,
  linesDigest,
  namedLines,
  rateCardSha256,
  runId,
  senderBatchId,
} from "./seed";

describe("format (C-22 deterministic formatter shim)", () => {
  it("formats the register's money figures", () => {
    expect(format.usd(6445)).toBe("US$64.45");
    expect(format.usd(433350)).toBe("US$4,333.50");
    expect(format.usd(-109)).toBe("−US$1.09");
    expect(format.usdPlain(-109)).toBe("−1.09");
    expect(format.usd(36839)).toBe("US$368.39");
  });

  it("labels the PayPal peso as an estimate at the run's rate, floored (approved plan)", () => {
    expect(format.pesoEstimate(6445, "62.50", "ceb")).toBe("mga ₱4,028 (gibanabana)");
    expect(format.pesoEstimate(6445, "62.50", "fil")).toBe("humigit-kumulang ₱4,028 (tantiya)");
    expect(format.pesoEstimate(6445, "62.50", "en")).toBe("about ₱4,028 (estimate)");
    expect(format.peso(12784, "62.50")).toBe("₱7,990"); // Merlyn Ponce, register §2
    // An estimate never promises a centavo more than the rate gives: ₱270,843.75 reads "about ₱270,843".
    expect(format.peso(433350, "62.50")).toBe("₱270,843");
  });

  it("gives cash its exact pesos at the run's recorded rate, half-up to the centavo", () => {
    expect(format.cashPesos(12784, "62.50")).toBe("₱7,990.00"); // Merlyn Ponce collects exactly this
    expect(format.cashPesos(6445, "62.50")).toBe("₱4,028.13"); // ₱4,028.125, half-up
    expect(format.cashSpoken(12784, "62.50")).toBe("seven thousand nine hundred ninety pesos, cash");
  });

  it("prints published fee rates from basis points, with their sources (C-28)", () => {
    expect(format.percentBp(FEE_TABLE.paypalConversionBp)).toBe("3%");
    expect(format.percentBp(FEE_TABLE.gcashTransferBp)).toBe("1%");
    expect(format.percentBp(440)).toBe("4.40%");
    expect(FEE_TABLE.paypalSource).toMatch(/PayPal/);
  });

  it("reads amounts as full phrases for screen readers (S1.11)", () => {
    expect(format.amountSpoken(6445, "62.50")).toBe(
      "sixty-four dollars and forty-five cents, about four thousand twenty-eight pesos, estimate",
    );
    expect(format.amountSpoken(36839)).toBe("three hundred sixty-eight dollars and thirty-nine cents");
    expect(format.amountSpoken(100)).toBe("one dollar");
  });

  it("formats kilos, dates, times, hashes and sizes", () => {
    expect(format.kg(148000)).toBe("148.0 kg");
    expect(format.kg(38450, 2)).toBe("38.45 kg");
    expect(format.kg(9780600)).toBe("9,780.6 kg");
    expect(format.date("2026-10-30T09:12:00+08:00", "ceb")).toBe("30 Okt 2026");
    expect(format.date("2026-10-30T09:12:00+08:00", "en")).toBe("30 Oct 2026");
    expect(format.dayMonth("2026-10-29T16:30:00Z", "ceb")).toBe("30 Okt"); // Philippine time, not the phone's
    expect(format.time("2026-10-30T01:12:00Z")).toBe("09:12");
    expect(format.elapsed(14_000)).toBe("0:14");
    expect(format.elapsed(3_723_000)).toBe("1:02:03");
    expect(format.hash("7f3a91c2deadbeef", 2)).toBe("7f3a 91c2");
    expect(format.bytes(412_345)).toBe("412 KB");
    expect(format.list(["0403", "0419", "0436", "0467"], "ceb")).toBe("0403, 0419, 0436 ug 0467");
  });
});

describe("batchDigest (register §8)", () => {
  it("is computed, not typed, and independent of item order", () => {
    expect(batchSha256).toMatch(/^[0-9a-f]{64}$/);
    const reversed = batchDigest({ runId, senderBatchId, rateCardSha256 }, [...batchItems].reverse());
    expect(reversed).toBe(batchSha256);
  });

  it("hashes exactly JCS{runId, senderBatchId, rateCardSha256, items sorted by senderItemId}", () => {
    const sorted = [...batchItems].sort((a, b) => (a.senderItemId < b.senderItemId ? -1 : 1));
    expect(batchSha256).toBe(sha256Hex(jcs({ runId, senderBatchId, rateCardSha256, items: sorted })));
    expect(senderBatchId).toBe(`2026A-${rateCardSha256.slice(0, 8)}-r37`);
  });
});

describe("fsm.item ranks (register §7)", () => {
  it("applies only rank-forward statuses", () => {
    expect(fsm.item.apply("PENDING", "SUCCESS")).toBe("SUCCESS");
    expect(fsm.item.apply("SUCCESS", "PENDING")).toBeNull();
    expect(fsm.item.apply("FAILED", "BLOCKED")).toBeNull(); // equal rank
    expect(fsm.item.apply("SUCCESS", "REVERSED")).toBe("REVERSED");
    expect(fsm.item.apply("UNCLAIMED", "RETURNED")).toBeNull();
    expect(fsm.item.apply("UNCLAIMED", "RETURNED", { ownCancel: true })).toBe("RETURNED");
  });
});

describe("member status words (register §7)", () => {
  it("keeps the register's fixed Cebuano words", () => {
    expect(MEMBER_STATUS_WORDS.HELD.ceb).toBe("Gisusi pa");
    expect(MEMBER_STATUS_WORDS.PAYPAL_PENDING.ceb).toBe("Gipadala na, naghulat sa PayPal");
    expect(MEMBER_STATUS_WORDS.PAID.ceb).toBe("Bayad na");
    expect(MEMBER_STATUS_WORDS.OFF_RAIL_DUE.ceb).toBe("Andam sa bodega");
    expect(MEMBER_STATUS_WORDS.OFF_RAIL_PAID.ceb).toBe("Nadawat");
    expect(MEMBER_STATUS_WORDS.UNCLAIMED.ceb).toBe("Wala madawat sa PayPal");
    expect(MEMBER_STATUS_WORDS.HELD.fil).toBe("Sinusuri pa po");
    expect(MEMBER_STATUS_WORDS.HELD.en).toBe("Still checking");
  });

  it("never uses error, fraud or a raw state name in member copy (S1.10 word list)", () => {
    for (const words of Object.values(MEMBER_STATUS_WORDS)) {
      for (const w of Object.values(words)) {
        expect(w).not.toMatch(/error|fraud|[A-Z]{2,}_[A-Z]{2,}/i);
      }
    }
  });
});

describe("linesDigest (approved plan, register §8 amendment)", () => {
  it("inv.i4.lines-bound: binds every member line, PayPal and cash, independent of order", () => {
    expect(linesDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(digestLines(runId, [...namedLines].reverse())).toBe(linesDigest);
    const moved = namedLines.map((l) => (l.memberNo === "M-053" ? { ...l, netCents: l.netCents - 1 } : l));
    expect(digestLines(runId, moved)).not.toBe(linesDigest);
  });
});

describe("contracts shim: screens, states and the amount grammar", () => {
  it("lists data-states for every app screen, with no duplicates", () => {
    for (const id of Object.values(SCREEN)) {
      const states = SCREEN_STATES[id];
      expect(states.length).toBeGreaterThan(0);
      expect(new Set(states).size).toBe(states.length);
    }
    expect(SLAB_STATES).toContain("armed");
  });

  it("maps every line state to an amount state (S2.2.1)", () => {
    for (const s of LINE_STATES) expect(AMOUNT_STATES).toContain(AMOUNT_STATE[s]);
    expect(AMOUNT_STATE.PAID).toBe("landed");
    expect(AMOUNT_STATE.OFF_RAIL_PAID).toBe("attested");
    expect(AMOUNT_STATE.PAYPAL_PENDING).toBe("hollow");
    expect(AMOUNT_STATE.REVERSED).toBe("hollow");
  });

  it("turns pencil to ink when the run is approved, but never an excluded line", () => {
    expect(amountStateOf("READY", { approved: false })).toBe("pencil");
    expect(amountStateOf("READY", { approved: true })).toBe("ink");
    expect(amountStateOf("EXCLUDED", { approved: true })).toBe("pencil");
    expect(amountStateOf("PAID", { approved: true })).toBe("landed");
  });
});

describe("seal (S2.7)", () => {
  const rings = seal(batchSha256, 200);
  const points = (d: string) => {
    const n = d.replace(/[MLZ]/g, " ").trim().split(/\s+/).map(Number);
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i] ?? 0, n[i + 1] ?? 0]);
    return out;
  };

  it("grows five rings from the hash: three for key 1, two for key 2", () => {
    expect(rings).toHaveLength(5);
    expect(rings.map((r) => r.owner)).toEqual([1, 1, 1, 2, 2]);
    expect(seal(batchSha256, 200)).toEqual(rings); // deterministic
  });

  it("keeps every ring inside its band, sampled at 40N points (N = 10…20 lobes)", () => {
    const bands = [
      [22, 38],
      [40, 56],
      [58, 72],
      [76, 86],
      [88, 98],
    ];
    rings.forEach((ring, i) => {
      const pts = points(ring.d);
      expect(pts.length).toBe(ring.points);
      expect(ring.points % 40).toBe(0);
      expect(ring.points / 40).toBeGreaterThanOrEqual(10);
      expect(ring.points / 40).toBeLessThanOrEqual(20);
      const band = bands[i] ?? [0, 0];
      const lo = band[0] ?? 0;
      const hi = band[1] ?? 0;
      for (const [x, y] of pts) {
        const r = Math.hypot((x ?? 0) - 100, (y ?? 0) - 100);
        expect(r).toBeGreaterThanOrEqual(lo - 0.05);
        expect(r).toBeLessThanOrEqual(hi + 0.05);
      }
      expect(ring.length).toBeGreaterThan(0);
    });
  });

  it("changes when one byte of the batch hash changes", () => {
    // Byte 0 + 1 always changes ring 0's lobe count, 10 + b[0] % 11.
    const b0 = Number.parseInt(batchSha256.slice(0, 2), 16);
    const bumped = `${((b0 + 1) % 256).toString(16).padStart(2, "0")}${batchSha256.slice(2)}`;
    expect(seal(bumped, 200)[0]?.d).not.toBe(rings[0]?.d);
    expect(() => seal("not-a-hash", 200)).toThrow(RangeError);
  });

  it("draws two rings below 96 px (key 1 inside, key 2 outside) and strokes at least one device pixel", () => {
    const small = seal(batchSha256, 64);
    expect(small.map((r) => r.owner)).toEqual([1, 2]);
    expect(seal(batchSha256, SMALL_SEAL_MAX)).toHaveLength(5);
    expect(sealStroke(200)).toBe(1);
    expect(sealStroke(48)).toBe(1);
    expect(sealStroke(400)).toBe(1.5);
  });
});
