/**
 * Honesty marks with a budget on the phone (UI gate round 3; the console's `MicroTag` and `LegendGlyph`, drawn in
 * react-native-svg so the Member, Chair and Clerk screens carry the same marks as the stage). The meaning survives;
 * the pills go (`lib/honesty.ts`):
 *
 * - `MicroTag`: a 12 px dashed circle and "Sandbox" at 13 sp, 20 px tall, beside a PayPal money value only. A screen
 *   reader hears the whole label, never the one word; the label is also in the tag's text for the judge's checks.
 * - `LegendGlyph`: a bare 12 px glyph in place of every other provenance pill (hatched square synthetic, dashed
 *   circle simulated, solid square real). Its words are its accessible name and its hidden text.
 * - `MarkRow`: the glyphs that open a screen (demo data, machine translation), top right. A tap shows their words.
 */
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Line, Rect } from "react-native-svg";
import { space } from "../_shims/tokens.native";
import { type HonestyKind, hatchLines, MICRO_WORD, ringDash } from "../lib/honesty";
import { useFs } from "../theme/theme";
import { Txt } from "./text";

/**
 * Read by a screen reader and kept in the text, never drawn: the words behind a glyph or a micro-tag's one word, or
 * (round 5) a voice's whole label ("… (Gemini TTS)") behind its short words.
 */
export function Hidden({ children }: { children: string }) {
  return (
    <Text style={styles.hidden} numberOfLines={1}>
      {children}
    </Text>
  );
}

/** The glyph's shape alone: a dashed circle, a hatched square or a solid square, in `color` at `size` px. */
export function MarkShape({ kind, size = 12, color }: { kind: HonestyKind; size?: number; color: string }) {
  if (kind === "simulated") {
    const [dash, gap] = ringDash(size);
    return (
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={size / 2 - 1}
          fill="none"
          stroke={color}
          strokeWidth={1.25}
          strokeDasharray={[dash, gap]}
        />
      </Svg>
    );
  }
  const o = 1.5;
  const s = size - 3;
  if (kind === "real") {
    return (
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Rect x={o} y={o} width={s} height={s} rx={1.5} fill={color} />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <G stroke={color} strokeWidth={1}>
        {hatchLines(o, o + s).map((l) => (
          <Line key={`${l.x1}-${l.y1}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
        ))}
      </G>
      <Rect x={o} y={o} width={s} height={s} rx={1.5} fill="none" stroke={color} strokeWidth={1} />
    </Svg>
  );
}

/** A glyph's colour: steel for the dashed (simulated) circle, ink 3 for the others (both 4.5:1 or better on white). */
export function useMarkColor(kind: HonestyKind): string {
  const { t } = useFs();
  return kind === "simulated" ? t.color.steelLine : t.color.ink3;
}

export interface LegendGlyphProps {
  kind: HonestyKind;
  /** Its words: the accessible name ("Demo data, walay server"), kept in the text, never drawn. */
  label: string;
  size?: number;
  testID?: string;
  dataSet?: Record<string, string>;
}

/** A bare legend glyph in place of a provenance pill: no outline and no word on screen. */
export function LegendGlyph({ kind, label, size = 12, testID, dataSet }: LegendGlyphProps) {
  const color = useMarkColor(kind);
  return (
    <View
      testID={testID}
      dataSet={{ ...dataSet, fsGlyph: kind }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[styles.glyph, { width: size, height: size }]}
    >
      <MarkShape kind={kind} size={size} color={color} />
      <Hidden>{label}</Hidden>
    </View>
  );
}

export interface MicroTagProps {
  /** What a screen reader hears: "Simulated PayPal sandbox" (or the replayed rail's words). */
  label: string;
  /** The one word on screen. */
  word?: string;
  testID?: string;
  dataSet?: Record<string, string>;
}

/**
 * The micro-tag beside a PayPal money value: a 12 px dashed circle and "Sandbox" at the phone's smallest step (13 sp,
 * one over the console's 12 px), 20 px tall, ink 2 (it sits on a statement, where ink 3 never goes), no outline. At
 * most two a screen (TAG_BUDGET).
 */
export function MicroTag({ label, word = MICRO_WORD, testID, dataSet }: MicroTagProps) {
  const { t } = useFs();
  return (
    <View
      testID={testID}
      dataSet={{ ...dataSet, fsTag: "micro" }}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={styles.micro}
    >
      <MarkShape kind="simulated" size={12} color={t.color.steelLine} />
      <Txt
        kind="micro"
        color="ink2"
        aria-hidden
        importantForAccessibility="no"
        maxFontSizeMultiplier={1.5}
        style={styles.microWord}
      >
        {word}
      </Txt>
      <Hidden>{label}</Hidden>
    </View>
  );
}

/**
 * The marks that open a screen, as one row of bare glyphs. A tap shows their words beside them and a second tap hides
 * them again: on a phone there is no hover, and a member can still learn what each mark means.
 */
export function MarkRow({ marks }: { marks: readonly LegendGlyphProps[] }) {
  const [open, setOpen] = useState(false);
  if (!marks.length) return null;
  return (
    <Pressable
      onPress={() => setOpen((o) => !o)}
      accessibilityRole="button"
      accessibilityLabel={marks.map((m) => m.label).join(". ")}
      aria-expanded={open}
      hitSlop={12}
      dataSet={{ state: open ? "open" : "closed" }}
      style={({ pressed }) => [open ? styles.column : styles.row, pressed && styles.pressed]}
    >
      {marks.map((m) => (
        <View key={m.label} style={styles.mark}>
          <LegendGlyph {...m} />
          {open ? (
            <Txt kind="micro" color="ink2" aria-hidden importantForAccessibility="no" style={styles.flex}>
              {m.label}
            </Txt>
          ) : null}
        </View>
      ))}
    </Pressable>
  );
}

/**
 * The same marks with nothing drawn (UI gate round 5, provenance once): inside the judge stage's frames the stage's
 * own indicator and What's real say it, so the phone's corner glyphs go. Each mark keeps its test hook and its words
 * for assistive technology, in a 1 px box at the screen's corner that never takes a touch.
 */
export function QuietMarks({ marks }: { marks: readonly LegendGlyphProps[] }) {
  if (!marks.length) return null;
  return (
    <View pointerEvents="none" style={styles.quiet}>
      {marks.map((m) => (
        <View
          key={m.label}
          testID={m.testID}
          dataSet={{ ...m.dataSet, fsGlyph: m.kind, quiet: "" }}
          accessible
          accessibilityRole="text"
          accessibilityLabel={m.label}
          style={styles.quietMark}
        >
          <Hidden>{m.label}</Hidden>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  glyph: { alignItems: "center", justifyContent: "center" },
  quiet: { position: "absolute", top: 0, right: 0, width: 1, height: 1, overflow: "hidden", opacity: 0 },
  quietMark: { width: 1, height: 1, overflow: "hidden" },
  hidden: { position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 },
  micro: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: space.s4,
    minHeight: 20,
  },
  microWord: { fontSize: 13, lineHeight: 18 },
  // Top right, quiet, like a status mark: the screen's first content starts 8 px under it, not a section gap.
  row: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    gap: space.s8,
    minHeight: 20,
    marginBottom: -space.s16,
  },
  column: { alignSelf: "flex-end", alignItems: "flex-end", gap: space.s4, minHeight: 20 },
  mark: { flexDirection: "row", alignItems: "center", gap: space.s8 },
  pressed: { opacity: 0.7 },
  flex: { flexShrink: 1 },
});
