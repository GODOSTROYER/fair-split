import {
  type FieldFixture,
  type SlipFixture,
  type SlipRowField,
  slipFieldEntries,
} from "../fixtures/schema.js";
import { SLIP_BOXES } from "../template/slip-template.js";

/**
 * Whether a water stain really hides what it washes out (verify:media, slip 0462). A stain hides digits;
 * the slip's own arithmetic can still give the value away. S4.2's row checks tie the kilo boxes together:
 * gross − tare = net and net − mc_less = payable, within ±10 g. Slip 0462's stain turns gross and net into
 * "6?.80" and "6?.50", but box 11 (Bayranan) reads a clear 64.50, box 10 0.00 and box 7 0.30, so a reader
 * (or a model that infers, which the read prompt forbids) can work out both. A stain that leaks may still
 * hold in a recorded read, but whether the story can live with it is the user's decision, so a leaking
 * stain reaches HOLDS only with that decision recorded (`recordReadVerdict`, `replayBlockers`).
 *
 * Which boxes are stained comes from what the prompt asked to wash out (`requested`) or what was seen ("?"),
 * not from how a reviewer words it: a stained box with nothing readable as a number (recorded ILLEGIBLE or
 * ABSENT, say) hides its whole value, and still leaks when the readable boxes give it away.
 */

/** `sum = a + b` for each S4.2 row check, in kilos. */
const IDENTITIES: readonly (readonly [SlipRowField, SlipRowField, SlipRowField])[] = [
  ["gross_kg", "net_kg", "tare_kg"],
  ["net_kg", "payable_kg", "mc_less_kg"],
];

/** S4.2's row checks hold within ±10 g: one hundredth of a kilo. */
const TOLERANCE_CENTI = 1;

const BOX_OF: Readonly<Record<string, number>> = Object.fromEntries(
  SLIP_BOXES.flatMap((b) => b.fields.map((f) => [f, b.no])),
);

export interface StainLeak {
  field: SlipRowField;
  /** The printed box the field is written in. */
  box: number;
  /** What the stain leaves visible ("?" per washed-out character). */
  visible: string;
  /** How the box was recorded. */
  legibility: FieldFixture["legibility"];
  /** `partly`: the value worked out fits the characters left visible; `fully`: nothing readable is left. */
  concealed: "partly" | "fully";
  /** The value the other boxes give away, written like `visible`. */
  derived: string;
  /** The readable boxes it is worked out from. */
  boxes: number[];
}

/** S4.2's kilo normaliser: comma to dot, "kg" dropped. */
const normalise = (s: string) => s.replace(/,/g, ".").replace(/kg/i, "").trim();

/** Hundredths of a kilo for a readable value, or null. */
function centi(text: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(normalise(text));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

const unreadable = (f: FieldFixture) => f.legibility === "ILLEGIBLE" || f.legibility === "ABSENT";
const washedOut = (text: string) => normalise(text).includes("?");

/**
 * What the stain hides of a field. `partly`: what is visible keeps some characters ("6?.80"). `fully`: the
 * field is stained (the prompt asked for washed-out characters, or the reviewer saw some) and nothing of it
 * reads as a number, whether the reviewer recorded it ILLEGIBLE or ABSENT or typed something unreadable.
 * Null when the stain hides none of it: it reads as a number, or it is not a stained box (an illegible
 * box 10 gives nothing away, and hides no stain).
 */
function concealment(f: FieldFixture): StainLeak["concealed"] | null {
  if (!unreadable(f) && washedOut(f.visible)) return "partly";
  if (!unreadable(f) && centi(f.visible) !== null) return null;
  return washedOut(f.requested) || washedOut(f.visible) ? "fully" : null;
}

/** Hundredths of a kilo written as S4.2 kilos ("64.80"), or null for a weight no slip can hold. */
function kilos(value: number): string | null {
  return value < 0 ? null : `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

/** `value` written with as many decimals as `pattern`, if it fits the pattern's readable characters. */
function fit(value: number, pattern: string): string | null {
  if (value < 0) return null;
  const p = normalise(pattern);
  const decimals = (p.split(".")[1] ?? "").length;
  if (decimals > 2 || value % 10 ** (2 - decimals) !== 0) return null;
  const whole = Math.floor(value / 100);
  const frac = String(value % 100)
    .padStart(2, "0")
    .slice(0, decimals);
  const text = decimals ? `${whole}.${frac}` : String(whole);
  if (text.length !== p.length) return null;
  return [...p].every((c, i) => c === "?" || c === text[i]) ? text : null;
}

/** The stained kilo fields of a slip that its readable boxes give away, by box number. */
export function stainLeaks(slip: SlipFixture): StainLeak[] {
  const known = new Map<SlipRowField, { value: number; boxes: number[] }>();
  for (const [sum, a, b] of IDENTITIES) {
    for (const field of [sum, a, b]) {
      const f = slip.fields[field];
      if (unreadable(f) || washedOut(f.visible)) continue;
      const value = centi(f.visible);
      if (value !== null) known.set(field, { value, boxes: [BOX_OF[field] ?? 0] });
    }
  }
  const leaks: StainLeak[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const [sum, a, b] of IDENTITIES) {
      const ks = known.get(sum);
      const ka = known.get(a);
      const kb = known.get(b);
      const candidates: [SlipRowField, number, number[]][] = [];
      if (!ks && ka && kb) candidates.push([sum, ka.value + kb.value, [...ka.boxes, ...kb.boxes]]);
      if (ks && !ka && kb) candidates.push([a, ks.value - kb.value, [...ks.boxes, ...kb.boxes]]);
      if (ks && ka && !kb) candidates.push([b, ks.value - ka.value, [...ks.boxes, ...ka.boxes]]);
      for (const [field, value, from] of candidates) {
        const f = slip.fields[field];
        const concealed = concealment(f);
        if (!concealed) continue;
        // Partly hidden: within the row checks' tolerance, the reading that fits what the stain leaves
        // visible (a value that contradicts the visible characters gives nothing away). Fully hidden: the
        // value itself, since nothing visible can contradict it.
        let derived: string | null = null;
        if (concealed === "fully") derived = kilos(value);
        else for (const d of [0, -TOLERANCE_CENTI, TOLERANCE_CENTI]) derived ??= fit(value + d, f.visible);
        if (derived === null) continue;
        const boxes = [...new Set(from)];
        known.set(field, { value: centi(derived) ?? value, boxes });
        leaks.push({
          field,
          box: BOX_OF[field] ?? 0,
          visible: f.visible,
          legibility: f.legibility,
          concealed,
          derived,
          boxes,
        });
        changed = true;
      }
    }
  }
  return leaks.sort((x, y) => x.box - y.box);
}

/** One line for messages: `box 6 "6?.80" is 64.80 from boxes 11, 10, 7; box 8 (illegible) is …`. */
export function describeLeaks(leaks: readonly StainLeak[]): string {
  return leaks
    .map((l) => {
      const shown =
        l.legibility === "ILLEGIBLE" || l.legibility === "ABSENT"
          ? `(${l.legibility.toLowerCase()})`
          : `"${l.visible}"`;
      return `box ${l.box} ${shown} is ${l.derived} from box${l.boxes.length > 1 ? "es" : ""} ${l.boxes.join(", ")}`;
    })
    .join("; ");
}

/**
 * The stained fields a slip's label does not send to a person (`expect` other than HUMAN), as
 * `gross_kg is EITHER, not HUMAN`. A WATER_STAIN holds only when a passing read sends every one of them to a
 * person (C-17); with any of them listed here, a passing read shows nothing about the stain.
 */
export function unroutedStain(slip: SlipFixture): string[] {
  return slipFieldEntries(slip)
    .filter((e) => e.field.requested.includes("?") && e.field.expect !== "HUMAN")
    .map((e) => `${e.path.replace(/^fields\./, "")} is ${e.field.expect}, not HUMAN`);
}
