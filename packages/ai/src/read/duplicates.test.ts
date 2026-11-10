import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { PhotoFixture } from "./_shims/contracts.js";
import { type DuplicateCandidate, duplicatePairs, exactDuplicateOf } from "./duplicates.js";
import { toPixels } from "./geometry.js";
import { dHash64, hammingHex, prepareImage } from "./prep.js";
import { SMOKE_DIR, SMOKE_IMAGES } from "./smoke/make-images.js";

/** A slip row as the duplicate signals see it. */
function cand(id: string, over: Partial<DuplicateCandidate> = {}): DuplicateCandidate {
  return {
    id,
    docId: id.split("#")[0] ?? id,
    documentSha256: (id.split("#")[0] ?? id).padEnd(64, "0"),
    position: 0,
    copy: "WHITE_ORIGINAL",
    serial: "0457",
    memberNo: "M-014",
    date: "2026-07-14",
    payableGrams: 38_450,
    dhash: null,
    ...over,
  };
}

/** Each reviewed slip rectangle of the three code-drawn smoke images, cropped from variant A. */
async function smokeSlips(): Promise<Array<{ doc: string; serial: string; crop: Buffer; dhash: string }>> {
  const out: Array<{ doc: string; serial: string; crop: Buffer; dhash: string }> = [];
  for (const img of SMOKE_IMAGES) {
    const prep = await prepareImage(readFileSync(`${SMOKE_DIR}${img.file}`));
    const fixture = JSON.parse(readFileSync(`${SMOKE_DIR}${img.id}.fixture.json`, "utf8")) as PhotoFixture;
    for (const s of fixture.slips) {
      const r = toPixels(s.rect, prep.width, prep.height);
      const crop = await sharp(prep.A)
        .extract({ left: r.x1, top: r.y1, width: r.x2 - r.x1, height: r.y2 - r.y1 })
        .png()
        .toBuffer();
      out.push({ doc: img.id, serial: s.serial, crop, dhash: await dHash64(prep.A, r) });
    }
  }
  return out;
}

// Hashes of real slip crops (sharp): over 2 s alone on a busy machine, past vitest's default 5 s under turbo. On a
// busy 4-core Linux box (DR-4) one test took 10.5 s alone and past 30 s in two of two full runs: 120 s, as r1 has.
describe("duplicate signals (S4.2): a hash of a slip never makes a duplicate on its own", {
  timeout: 120_000,
}, () => {
  it("template-identical slips with different ink are not duplicates, though their hashes are close", async () => {
    const slips = await smokeSlips();
    expect(slips.map((s) => s.serial)).toEqual(["0901", "0902", "0903", "0904"]);
    // The printed template dominates a 64-bit hash of a whole slip: different slips land within the
    // re-shoot threshold (the review measured 3 of 6 pairs at 8 or less; 0903 and 0904 share a photo).
    const close = slips.flatMap((x, i) =>
      slips.slice(i + 1).filter((y) => hammingHex(x.dhash, y.dhash) <= 8),
    );
    expect(close.length).toBeGreaterThanOrEqual(2);
    const candidates = slips.map((s, i) =>
      cand(`${s.doc}#${i}`, {
        docId: s.doc,
        documentSha256: s.doc.padEnd(64, "0"),
        position: i,
        serial: s.serial,
        // Even with one member and one day on every slip, different serials and kilos stay clean.
        memberNo: "M-103",
        date: "2026-07-16",
        payableGrams: 38_450 + i * 10,
        dhash: s.dhash,
      }),
    );
    expect(duplicatePairs(candidates)).toEqual([]);
  });

  it("a re-encoded crop of the same slip pairs on DHASH + MEMBER_DATE_KILOS when its serial was misread", async () => {
    const [first] = await smokeSlips();
    if (!first) throw new Error("no smoke slip");
    const reencoded = await sharp(first.crop).jpeg({ quality: 60 }).toBuffer();
    const again = await dHash64(reencoded);
    expect(hammingHex(first.dhash, again)).toBeLessThanOrEqual(8);
    const pairs = duplicatePairs([
      cand("P1#0", { serial: "0901", dhash: first.dhash }),
      cand("P2#0", { serial: null, dhash: again }), // the serial did not read on the re-shoot
    ]);
    expect(pairs).toEqual([
      {
        a: "P1#0",
        b: "P2#0",
        signals: ["DHASH", "MEMBER_DATE_KILOS"],
        copies: ["WHITE_ORIGINAL", "WHITE_ORIGINAL"],
      },
    ]);
  });

  it("a re-shot slip whose serial reads pairs on the serial, however far its hash drifted", () => {
    const pairs = duplicatePairs([
      cand("B#1", { dhash: "0000000000000000" }),
      cand("Q#3", { dhash: "ffffffffffffffff" }),
    ]);
    expect(pairs).toEqual([
      { a: "B#1", b: "Q#3", signals: ["SAME_SERIAL"], copies: ["WHITE_ORIGINAL", "WHITE_ORIGINAL"] },
    ]);
  });

  it("H1: 0457 white in photo B and its pink copy in photo D pair on the serial, copy colours recorded", () => {
    const pairs = duplicatePairs([
      cand("B#2", { copy: "WHITE_ORIGINAL" }),
      cand("D#0", { copy: "PINK_DUPLICATE", payableGrams: null }),
    ]);
    expect(pairs).toEqual([
      { a: "B#2", b: "D#0", signals: ["SAME_SERIAL"], copies: ["WHITE_ORIGINAL", "PINK_DUPLICATE"] },
    ]);
  });

  it("a close hash only corroborates: alone, or with kilos that differ, it raises nothing", () => {
    const h = "00ff00ff00ff00ff";
    const near = "00ff00ff00ff00fe";
    // Two real deliveries by one member on one day (eval cells 9-10): different serials and kilos.
    expect(
      duplicatePairs([
        cand("E9#0", { serial: "0471", dhash: h }),
        cand("E10#0", { serial: "0472", payableGrams: 41_200, dhash: near }),
      ]),
    ).toEqual([]);
    // Different members entirely.
    expect(
      duplicatePairs([
        cand("X#0", { serial: "0471", memberNo: "M-002", dhash: h }),
        cand("Y#0", { serial: "0472", dhash: near }),
      ]),
    ).toEqual([]);
    // With the same serial, the hash is recorded next to it.
    expect(duplicatePairs([cand("X#0", { dhash: h }), cand("Y#0", { dhash: near })])[0]?.signals).toEqual([
      "SAME_SERIAL",
      "DHASH",
    ]);
  });

  it("without a reviewed rectangle there is no hash, so signal 4 cannot fire: only the serial pairs", () => {
    // A page (template rectangles not yet reviewed) or a live read without cropFixture: dhash null.
    // S4.2: signal 4 counts "only with signal 3", so a re-shoot with a misread serial goes unpaired.
    const misread = [
      cand("PAGE1#0", { serial: "0471" }),
      cand("PAGE2#0", { serial: "0477" }), // same member, date and payable kilos
    ];
    expect(duplicatePairs(misread)).toEqual([]);
    // One side hashed, the other not: still no corroboration.
    expect(
      duplicatePairs([
        misread[0] as DuplicateCandidate,
        { ...(misread[1] as DuplicateCandidate), dhash: "00ff00ff00ff00ff" },
      ]),
    ).toEqual([]);
    // A serial that reads still pairs, hash or no hash.
    expect(duplicatePairs([cand("PAGE1#0"), cand("PAGE2#0")])).toEqual([
      { a: "PAGE1#0", b: "PAGE2#0", signals: ["SAME_SERIAL"], copies: ["WHITE_ORIGINAL", "WHITE_ORIGINAL"] },
    ]);
  });

  it("never pairs two slots of one photo on the hash: they are two pieces of paper", () => {
    const h = "00ff00ff00ff00ff";
    expect(
      duplicatePairs([
        cand("C#0", { serial: "0449", position: 0, dhash: h }),
        cand("C#1", { serial: null, position: 1, dhash: h }),
      ]),
    ).toEqual([]);
    // A white original and its pink carbon photographed together are still one delivery.
    expect(
      duplicatePairs([cand("C#0", { position: 0 }), cand("C#1", { position: 1, copy: "PINK_DUPLICATE" })]),
    ).toEqual([
      { a: "C#0", b: "C#1", signals: ["SAME_SERIAL"], copies: ["WHITE_ORIGINAL", "PINK_DUPLICATE"] },
    ]);
  });

  it("logbook lines are witnesses, never duplicates; one file uploaded twice pairs slot by slot", () => {
    expect(duplicatePairs([cand("L#7", { copy: "LOGBOOK_LINE" }), cand("B#2")])).toEqual([]);
    const sha = "a".repeat(64);
    const pairs = duplicatePairs([
      cand("U1#0", { documentSha256: sha, serial: "0301", position: 0 }),
      cand("U2#0", { documentSha256: sha, serial: "0301", position: 0 }),
    ]);
    expect(pairs[0]?.signals).toEqual(["EXACT_DOCUMENT", "SAME_SERIAL"]);
    expect(exactDuplicateOf(sha, [{ id: "U1", sha256: sha }])).toBe("U1");
    expect(exactDuplicateOf("b".repeat(64), [{ id: "U1", sha256: sha }])).toBeNull();
  });
});
