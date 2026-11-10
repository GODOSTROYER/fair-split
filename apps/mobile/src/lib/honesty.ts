/**
 * Honesty marks with a budget (UI gate round 3, the console's `@fairsplit/ui-web` honesty marks, drawn for the phone).
 * Pure, tested in Node; `ui/honesty.tsx` draws them.
 *
 * - One micro-tag, a 12 px dashed circle and the word "Sandbox" at 13 sp, 20 px tall, only beside a PayPal money
 *   value; a screen reader hears its whole label ("Simulated PayPal sandbox", or the replayed rail's words).
 * - Every other provenance pill becomes a bare legend glyph whose words are its accessible name: a hatched square for
 *   synthetic data, a dashed circle for a simulated system, a solid square for real code.
 * - At most three tags a screen and two micro-tags (the console's TAG_BUDGET); glyphs are not tags.
 */

export type HonestyKind = "real" | "simulated" | "synthetic";

/** Which glyph each of the phone's old pills becomes. */
export const MARK_KIND = {
  demoData: "synthetic",
  syntheticSample: "synthetic",
  syntheticVoice: "synthetic",
  seedStandIn: "synthetic",
  machineTranslated: "simulated",
  demoKey: "simulated",
  simulatedPush: "simulated",
  simulatedSandbox: "simulated",
  realCode: "real",
} as const satisfies Record<string, HonestyKind>;

export type MarkName = keyof typeof MARK_KIND;

/** The micro-tag's one word, the same in Cebuano, Filipino and English (a product term). */
export const MICRO_WORD = "Sandbox";

/** The console's budget: three tags a screen at most, two of them micro-tags. */
export const TAG_BUDGET = { perScreen: 3, microPerScreen: 2 } as const;

export interface HatchLine {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/**
 * The synthetic glyph's 45° hatch inside a square from `lo` to `hi` (each line cut to the square, so no clip path):
 * the same six strokes as the console's glyph.
 */
export function hatchLines(lo: number, hi: number): HatchLine[] {
  const s = hi - lo;
  return [0.3, 0.6, 0.9, 1.2, 1.5, 1.8].map((f) => {
    const c = 2 * lo + f * s;
    const x1 = Math.max(lo, c - hi);
    const x2 = Math.min(hi, c - lo);
    return { x1, y1: c - x1, x2, y2: c - x2 };
  });
}

/** The dashed circle's dash and gap at a size: "not real, or not yet". */
export function ringDash(size: number): readonly [number, number] {
  const dash = Math.max(1.4, size / 7);
  return [dash, dash * 0.8];
}
