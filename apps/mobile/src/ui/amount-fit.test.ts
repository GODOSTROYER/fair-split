import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AMOUNT_PAD,
  AMOUNT_SCALE_CAP,
  type AmountType,
  amountType,
  fitAmount,
  type Room,
  roomFrom,
} from "./amount-fit";

/** The app's large roles (theme.tsx typeScale): amount-hero 48/52 sp, amount-l 32/36. */
const HERO: AmountType = { fontSize: 48, lineHeight: 52 };
const L: AmountType = { fontSize: 32, lineHeight: 36 };

/**
 * Advance widths in FS Sans CondXBold (assets/fonts/native, read with fontTools), in em: the statement's figures.
 * The width of a figure at a size is its em width times the size: the phone measures it, these stand in for it.
 */
const EM = {
  usd: 3.564, // "US$64.45"
  cash: 3.884, // "₱4,028.13"
  cash5: 4.377, // "₱12,345.67"
  cash6: 4.87, // "₱123,456.78"
} as const;

/** The statement card's inner width: the window less the screen's 16 dp gutters and the card's 16 dp padding. */
const cardInner = (window: number) => window - 2 * 16 - 2 * 16;

function figure(em: number, type: AmountType) {
  return em * type.fontSize;
}

/** The box a figure gets in a column of `room` dp at a font scale, as the phone settles it. */
function settle(em: number, role: AmountType, cap: number, fontScale: number, room: number) {
  const type = amountType(role, fontScale, cap);
  const natural = figure(em, type);
  const full = Math.ceil(natural) + AMOUNT_PAD;
  return fitAmount(type, natural, roomFrom({ width: Math.min(full, room), full }, full));
}

describe("the large amount's type size (S1.12, design §8)", () => {
  it("follows the system text size, the 48 sp hero only to 1.5×, amount-l to 2×", () => {
    expect(amountType(HERO, 1, AMOUNT_SCALE_CAP.hero)).toEqual({ fontSize: 48, lineHeight: 52 });
    expect(amountType(HERO, 1.3, AMOUNT_SCALE_CAP.hero).fontSize).toBeCloseTo(62.4);
    expect(amountType(HERO, 2, AMOUNT_SCALE_CAP.hero)).toEqual({ fontSize: 72, lineHeight: 78 });
    expect(amountType(L, 2, AMOUNT_SCALE_CAP.l)).toEqual({ fontSize: 64, lineHeight: 72 });
    expect(amountType(HERO, 0.85, AMOUNT_SCALE_CAP.hero).fontSize).toBeCloseTo(40.8);
    // A scale the platform cannot report is 1×.
    expect(amountType(HERO, Number.NaN, AMOUNT_SCALE_CAP.hero)).toEqual(HERO);
    expect(amountType(HERO, 0, AMOUNT_SCALE_CAP.hero)).toEqual(HERO);
  });
});

describe("what the last layout says about the room", () => {
  it("knows nothing before a layout, or from a layout of a smaller figure that had room", () => {
    expect(roomFrom(null, 180)).toEqual({ kind: "unknown" });
    expect(roomFrom({ width: 0, full: 180 }, 180)).toEqual({ kind: "unknown" });
    // The first layout (nothing measured yet) only says there were 4 dp: the figure may or may not fit.
    expect(roomFrom({ width: AMOUNT_PAD, full: AMOUNT_PAD }, 180)).toEqual({ kind: "unknown" });
  });

  it("has room when the figure fitted, or fits where the last one did", () => {
    expect(roomFrom({ width: 180, full: 180 }, 180)).toEqual({ kind: "free" });
    expect(roomFrom({ width: 348, full: AMOUNT_PAD }, 180)).toEqual({ kind: "free" });
  });

  it("is limited to the parent's width when the parent held the box narrower than its figure", () => {
    expect(roomFrom({ width: 142, full: 176 }, 176)).toEqual({ kind: "limit", width: 142 });
    // An older, wider figure was held at 142: the parent is 142 wide, whatever figure comes next.
    expect(roomFrom({ width: 142, full: 260 }, 176)).toEqual({ kind: "limit", width: 142 });
    expect(roomFrom({ width: 142, full: 260 }, 120)).toEqual({ kind: "free" });
  });
});

describe("the large amount never wraps and never clips (S2.2.1)", () => {
  it("keeps its size where it fits: US$64.45 on a 412 dp phone", () => {
    const box = settle(EM.usd, HERO, AMOUNT_SCALE_CAP.hero, 1, cardInner(412));
    expect(box).toMatchObject({ ready: true, fit: 1, fontSize: 48, lineHeight: 52, height: 52 });
    expect(box.width).toBe(Math.ceil(EM.usd * 48) + AMOUNT_PAD);
  });

  it("fits a 360 dp phone at font scale 1.3 and 2.0, in US$ and in cash pesos", () => {
    for (const em of [EM.usd, EM.cash]) {
      for (const scale of [1.3, 2]) {
        const room = cardInner(360);
        const box = settle(em, HERO, AMOUNT_SCALE_CAP.hero, scale, room);
        expect(box.ready).toBe(true);
        expect(box.width, `${em} em at ${scale}×`).toBeLessThanOrEqual(room);
        expect(em * box.fontSize + AMOUNT_PAD, `${em} em at ${scale}×`).toBeLessThanOrEqual(room + 0.01);
      }
    }
  });

  it("scales the whole figure down at 200% zoom on the web (a 206 px window), on one line", () => {
    const room = cardInner(206);
    for (const em of [EM.usd, EM.cash]) {
      const box = settle(em, HERO, AMOUNT_SCALE_CAP.hero, 1, room);
      expect(box.fit).toBeLessThan(1);
      expect(box.width).toBe(room);
      expect(em * box.fontSize + AMOUNT_PAD).toBeCloseTo(room, 5);
      // One line: the box is exactly one line of the scaled type, never two.
      expect(box.height).toBeCloseTo(box.lineHeight, 5);
      expect(box.lineHeight / box.fontSize).toBeCloseTo(52 / 48, 5);
    }
  });

  it("scales a long cash figure down on a 360 dp phone at 2.0×, as the hero and as amount-l", () => {
    const room = cardInner(360);
    for (const [em, role, cap] of [
      [EM.cash5, HERO, AMOUNT_SCALE_CAP.hero],
      [EM.cash6, L, AMOUNT_SCALE_CAP.l],
    ] as const) {
      const box = settle(em, role, cap, 2, room);
      expect(box.fit, `${em} em`).toBeLessThan(1);
      expect(em * box.fontSize + AMOUNT_PAD, `${em} em`).toBeLessThanOrEqual(room + 0.01);
    }
  });

  it("draws nothing until the room is known, and keeps one line of height meanwhile", () => {
    const unknown: Room = { kind: "unknown" };
    expect(fitAmount(HERO, 171, unknown)).toMatchObject({ ready: false, height: 52 });
    expect(fitAmount(HERO, 0, { kind: "free" })).toMatchObject({ ready: false, height: 52 });
  });

  it("property: for any figure, room and text size, the drawn figure fits and never grows past its type", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 9, noNaN: true }),
        fc.double({ min: 0.85, max: 3, noNaN: true }),
        fc.integer({ min: 40, max: 1200 }),
        fc.boolean(),
        (em, scale, room, hero) => {
          const role = hero ? HERO : L;
          const cap = hero ? AMOUNT_SCALE_CAP.hero : AMOUNT_SCALE_CAP.l;
          const type = amountType(role, scale, cap);
          const box = settle(em, role, cap, scale, room);
          expect(box.ready).toBe(true);
          expect(box.fit).toBeGreaterThan(0);
          expect(box.fit).toBeLessThanOrEqual(1);
          expect(box.fontSize).toBeLessThanOrEqual(type.fontSize);
          expect(box.width).toBeLessThanOrEqual(room);
          if (box.fit < 1) expect(em * box.fontSize + AMOUNT_PAD).toBeLessThanOrEqual(room + 1e-6);
          expect(box.height).toBeCloseTo(type.lineHeight * box.fit, 6);
        },
      ),
    );
  });
});
