import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  cropBoxToMaster,
  cropForZoom,
  dHash64,
  hammingHex,
  imageIdentity,
  PREP_V,
  prepareImage,
} from "./prep.js";
import { countImageTokens, HIGH_RES_MAX_EDGE, HIGH_RES_MAX_TOKENS, resizedSize } from "./resize.js";
import { plainPage } from "./test-fixtures.js";

describe("resizedSize (Anthropic reference implementation)", () => {
  it("matches the documented examples", () => {
    expect(resizedSize(1075, 1520)).toEqual([924, 1307]);
    expect(resizedSize(1920, 1080)).toEqual([1456, 819]);
    expect(resizedSize(3840, 2160, HIGH_RES_MAX_EDGE, HIGH_RES_MAX_TOKENS)).toEqual([2576, 1449]);
    expect(resizedSize(1920, 1080, HIGH_RES_MAX_EDGE, HIGH_RES_MAX_TOKENS)).toEqual([1920, 1080]);
  });
  it("matches S4.2: 4032x3024 → 2212x1659 (4,740 tokens); 1536x1024 unchanged (2,035)", () => {
    expect(resizedSize(4032, 3024, HIGH_RES_MAX_EDGE, HIGH_RES_MAX_TOKENS)).toEqual([2212, 1659]);
    expect(countImageTokens(2212, 1659)).toBe(4740);
    expect(resizedSize(1536, 1024, HIGH_RES_MAX_EDGE, HIGH_RES_MAX_TOKENS)).toEqual([1536, 1024]);
    expect(countImageTokens(1536, 1024)).toBe(2035);
    expect(resizedSize(3024, 4032, HIGH_RES_MAX_EDGE, HIGH_RES_MAX_TOKENS)).toEqual([1659, 2212]);
  });
});

describe("prepareImage", () => {
  it("resizes to the high-resolution tier, strips metadata and makes a greyscale variant B", async () => {
    const big = await sharp({ create: { width: 4032, height: 3024, channels: 3, background: "#c08040" } })
      .withExif({ IFD0: { Copyright: "secret-gps-holder" } })
      .jpeg()
      .toBuffer();
    const p = await prepareImage(big);
    expect([p.width, p.height]).toEqual([2212, 1659]);
    expect(p.visualTokens).toBe(4740);
    const ma = await sharp(p.A).metadata();
    const mb = await sharp(p.B).metadata();
    expect([ma.width, ma.height, mb.width, mb.height]).toEqual([2212, 1659, 2212, 1659]);
    expect(ma.exif).toBeUndefined();
    expect(mb.channels).toBe(1);
    expect(p.identity.A).not.toBe(p.identity.B);
    expect(p.identity.A).toBe(imageIdentity(p.documentSha256, { variant: "A", rotation: 0 }));
    expect(PREP_V).toBe("prep.v1");
  });

  it("honours EXIF orientation and an explicit rotation", async () => {
    const tall = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#fff" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const p = await prepareImage(tall);
    expect([p.width, p.height]).toEqual([100, 200]);
    const r = await prepareImage(await plainPage(), { rotation: 90 });
    expect([r.width, r.height]).toEqual([1400, 1000]);
    expect(r.identity.A).not.toBe((await prepareImage(await plainPage())).identity.A);
  });

  it("keys on the document, not on the derived bytes", async () => {
    const page = await plainPage();
    const [x, y] = await Promise.all([prepareImage(page), prepareImage(page)]);
    expect(x.identity).toEqual(y.identity);
    expect(x.sentSha).toEqual(y.sentSha);
  });
});

describe("zoom crops", () => {
  it("pads 25% per side (min 160x96), upscales x2 and maps boxes back to the master", async () => {
    const master = (await prepareImage(await plainPage())).A;
    const crop = await cropForZoom(
      master,
      { width: 1000, height: 1400 },
      { x1: 500, y1: 590, x2: 900, y2: 640 },
    );
    expect(crop.rect).toEqual({ x1: 400, y1: 567, x2: 1000, y2: 663 });
    expect(crop.width).toBe(1000);
    expect(crop.scale.x).toBeCloseTo(1000 / 600, 6);
    const back = cropBoxToMaster({ x1: 0, y1: 0, x2: crop.width, y2: crop.height }, crop);
    expect(back).toEqual(crop.rect);
    const small = await cropForZoom(
      master,
      { width: 1000, height: 1400 },
      { x1: 10, y1: 10, x2: 30, y2: 20 },
    );
    expect([small.rect.x2 - small.rect.x1, small.rect.y2 - small.rect.y1]).toEqual([160, 96]);
    expect([small.width, small.height]).toEqual([320, 192]);
  });
});

describe("dHash", () => {
  it("is stable for the same crop and close for a re-encode", async () => {
    const page = await plainPage(1);
    const h1 = await dHash64(page);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
    expect(await dHash64(page)).toBe(h1);
    const reencoded = await sharp(page).jpeg({ quality: 60 }).toBuffer();
    expect(hammingHex(h1, await dHash64(reencoded))).toBeLessThanOrEqual(8);
    expect(hammingHex("ffffffffffffffff", "0000000000000000")).toBe(64);
  });
});
