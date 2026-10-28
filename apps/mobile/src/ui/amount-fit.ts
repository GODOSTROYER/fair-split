/**
 * The large amount's box (S2.2.1, S1.12, design §8 "Large text"). The figure is one line of one SVG text, so it can
 * neither wrap nor reflow: it takes its role's size at the phone's text size (the 48 sp hero capped at 1.5×, amount-l
 * at 2×) and, when that is wider than the room it has (a 360 dp phone at 2.0×, a long cash figure, 200% zoom on the
 * web), the whole figure scales down until it fits. Pure; `ui/amount.tsx` measures the figure and the room and draws.
 */

/** The hollow look's 4 px stroke shows 2 px outside the glyphs on each side; the figure starts 2 px in. */
export const AMOUNT_PAD = 4;
/** Half the cap height of FS Sans CondXBold (729/1000 em): the digits sit centred on the line. */
export const CAP_HALF = 0.3645;
/** How far each large role follows the system text size (design §8: the hero already starts at 48 sp). */
export const AMOUNT_SCALE_CAP = { hero: 1.5, l: 2 } as const;

export interface AmountType {
  fontSize: number;
  lineHeight: number;
}

/** The role at the phone's text size, capped. A scale the platform cannot report counts as 1×. */
export function amountType(role: AmountType, fontScale: number, cap: number): AmountType {
  const s = Number.isFinite(fontScale) && fontScale > 0 ? Math.min(fontScale, cap) : 1;
  return { fontSize: role.fontSize * s, lineHeight: role.lineHeight * s };
}

/**
 * What the box's last layout says about the room. The box is as wide as its full-size figure (`full`, the figure plus
 * the stroke pad) unless its parent holds it narrower, so:
 * - `limit`: the parent held it narrower than its figure; the parent's width is the room;
 * - `free`: the figure fits (it did, or it is no wider than the box already was);
 * - `unknown`: no layout yet, or a layout of a smaller figure that fitted, which says nothing about a wider one.
 */
export type Room = { kind: "limit"; width: number } | { kind: "free" } | { kind: "unknown" };

/** Half a pixel of tolerance: layout widths are fractional, the figure's box is whole pixels. */
const EPS = 0.5;

export function roomFrom(last: { width: number; full: number } | null, full: number): Room {
  if (!last || last.width <= 0) return { kind: "unknown" };
  const held = last.width + EPS < last.full;
  if (full <= last.width + EPS) return { kind: "free" };
  return held ? { kind: "limit", width: last.width } : { kind: "unknown" };
}

export interface AmountBox extends AmountType {
  /** The drawing's width: the full figure, or the room when the figure had to scale down. */
  width: number;
  /** One line of the (scaled) type. */
  height: number;
  /** 1 at full size; below 1 when the figure scaled down to fit. */
  fit: number;
  /** False until the figure and its room are known: draw nothing, keep one line of height. */
  ready: boolean;
}

/** The figure's full width at `type` (`natural`, measured on one line) plus the stroke pad: the box's own width. */
export function fullWidth(natural: number): number {
  return natural > 0 ? Math.ceil(natural) + AMOUNT_PAD : AMOUNT_PAD;
}

export function fitAmount(type: AmountType, natural: number, room: Room): AmountBox {
  const full = fullWidth(natural);
  const whole: AmountBox = { ...type, width: full, height: type.lineHeight, fit: 1, ready: true };
  if (natural <= 0 || room.kind === "unknown") return { ...whole, ready: false };
  if (room.kind === "free" || full <= room.width) return whole;
  const fit = Math.max(0.05, (room.width - AMOUNT_PAD) / natural);
  return {
    fontSize: type.fontSize * fit,
    lineHeight: type.lineHeight * fit,
    width: room.width,
    height: type.lineHeight * fit,
    fit,
    ready: true,
  };
}
