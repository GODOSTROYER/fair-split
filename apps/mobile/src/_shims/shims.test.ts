import { describe, expect, it } from "vitest";
import { MEMBER_STATUS_WORDS } from "./contracts";
import { batchDigest, format, fsm, jcs, sha256Hex } from "./domain";
import { seal } from "./seal";
import { batchItems, batchSha256, rateCardSha256, runId, senderBatchId } from "./seed";

describe("format (C-22 deterministic formatter shim)", () => {
  it("formats the register's money figures", () => {
    expect(format.usd(6445)).toBe("US$64.45");
    expect(format.usd(433350)).toBe("US$4,333.50");
    expect(format.usd(-109)).toBe("−US$1.09");
    expect(format.usdPlain(-109)).toBe("−1.09");
    expect(format.usd(36839)).toBe("US$368.39");
  });

  it("labels the peso as an estimate at the run's reference rate (₱62.50)", () => {
    expect(format.pesoEstimate(6445, "62.50", "ceb")).toBe("mga ₱4,028 (gibanabana)");
    expect(format.pesoEstimate(6445, "62.50", "fil")).toBe("humigit-kumulang ₱4,028 (tantiya)");
    expect(format.pesoEstimate(6445, "62.50", "en")).toBe("about ₱4,028 (estimate)");
    expect(format.peso(12784, "62.50")).toBe("₱7,990"); // Merlyn Ponce, register §2
    expect(format.peso(433350, "62.50")).toBe("₱270,844"); // the invoice, register §2
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

describe("seal (S2.7)", () => {
  const rings = seal(batchSha256, 200);

  it("grows five rings from the hash: three for key 1, two for key 2", () => {
    expect(rings).toHaveLength(5);
    expect(rings.map((r) => r.owner)).toEqual([1, 1, 1, 2, 2]);
    expect(seal(batchSha256, 200)).toEqual(rings); // deterministic
  });

  it("keeps every ring inside its band and within the 2,000-point budget", () => {
    const bands = [
      [22, 38],
      [40, 56],
      [58, 72],
      [76, 86],
      [88, 98],
    ];
    rings.forEach((ring, i) => {
      const pts = [...ring.d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      expect(pts.length).toBeLessThanOrEqual(2001);
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
    // Changing the high nibble of byte 0 always changes ring 0's lobe count (16k is never a multiple of 37).
    const flipped = `${batchSha256[0] === "0" ? "1" : "0"}${batchSha256.slice(1)}`;
    expect(seal(flipped, 200)[0]?.d).not.toBe(rings[0]?.d);
    expect(() => seal("not-a-hash", 200)).toThrow(RangeError);
  });
});
