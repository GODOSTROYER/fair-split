/**
 * Small app primitives on the design tokens: flat buttons (navigation and reversible, non-money actions; a person's
 * commit is a Slab), chips (choice, status, rule), the ink stamp, hatching, banners, the wordmark, hashes and the
 * labels that keep simulated things honest (I8). Every one has its accessibility built in: a role, a label, its
 * state, and a 48 dp target where it can be pressed.
 */
import { type ReactNode, useState } from "react";
import {
  type LayoutChangeEvent,
  Pressable,
  type PressableProps,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import type { MemberStatus } from "../_shims/contracts";
import { pendingReview } from "../_shims/i18n";
import { layout, radius, space, target } from "../_shims/tokens.native";
import { MARK_KIND } from "../lib/honesty";
import { STATUS_GLYPH, STATUS_TONE, type StatusTone } from "../lib/item-status";
import { inFrame } from "../services/frame-bridge";
import { useApp } from "../state/app";
import { useFs } from "../theme/theme";
import { Glyph, type GlyphName } from "./glyph";
import { LegendGlyph, type LegendGlyphProps, MarkRow, QuietMarks } from "./honesty";
import { Txt, useT } from "./text";

/* ------------------------------------------------------------------ Button */

export interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  /**
   * UI gate round 2: one flat primary and one outline secondary, as on the console. "hand" and "filled" are the
   * primary (the indigo face, radius 12, no lip, no glow); "quiet" and "tonal" are the secondary (white, a 1 px
   * outline); "text" is a quiet underlined link.
   */
  variant?: "filled" | "hand" | "quiet" | "tonal" | "text";
  icon?: GlyphName;
  tall?: boolean;
  style?: ViewStyle;
  testID?: string;
}

export function Button({ label, variant = "filled", icon, tall, style, disabled, ...rest }: ButtonProps) {
  const { t } = useFs();
  const primary = variant === "hand" || variant === "filled";
  const outline = variant === "quiet" || variant === "tonal";
  const text = variant === "text";
  const face = primary ? t.slab.chalk.face : outline ? t.color.plate : "transparent";
  const fg = primary ? t.slab.chalk.label : t.color.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={text ? 8 : 0}
      {...rest}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: tall ? target.primary : target.min,
          backgroundColor: face,
          borderColor: outline ? t.color.ruleStrong : "transparent",
          paddingHorizontal: text ? space.s4 : space.s16,
          opacity: disabled ? 0.55 : 1,
        },
        text ? styles.textButton : null,
        // The press moves a quarter of the old lip and darkens the face a step; no shadow, no glow.
        pressed && !disabled
          ? {
              transform: [{ translateY: 1 }],
              backgroundColor: primary ? t.slab.chalk.edgeRight : t.color.pencilWash,
            }
          : null,
        style,
      ]}
    >
      {icon ? <Glyph name={icon} size={text ? 18 : 20} color={fg} /> : null}
      <Txt kind={text ? "label" : "slab"} style={[{ color: fg }, text ? styles.link : null]}>
        {label}
      </Txt>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ Chip */

/** A choice: filled ink when selected. As a radio (`role="radio"`) it reports checked, as a toggle selected. */
export function Chip({
  label,
  selected,
  onPress,
  icon,
  testID,
  accessibilityLabel,
  role = "button",
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: GlyphName;
  testID?: string;
  accessibilityLabel?: string;
  role?: "button" | "radio";
}) {
  const { t } = useFs();
  const body = (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: selected ? t.color.ink : t.color.plate,
          borderColor: selected ? t.color.ink : t.color.rule,
        },
      ]}
    >
      {icon ? <Glyph name={icon} size={16} color={selected ? t.color.plate : t.color.ink2} /> : null}
      <Txt kind="label" style={{ color: selected ? t.color.plate : t.color.ink }}>
        {label}
      </Txt>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      aria-checked={role === "radio" ? !!selected : undefined}
      accessibilityState={role === "radio" ? { checked: !!selected } : { selected: !!selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      dataSet={{ state: selected ? "selected" : "idle" }}
      hitSlop={6}
      style={({ pressed }) => [
        { minHeight: target.min, justifyContent: "center" },
        pressed && { opacity: 0.8 },
      ]}
    >
      {body}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ Ink stamp */

/**
 * A person's initials at the id step (13 sp, never the old 9): every human decision carries one (ADR-0016). UI gate
 * round 4: the console's avatar, white with a 1 px ink-2 ring and ink initials; indigo is for action only.
 */
export function InkStamp({ initials, label }: { initials: string; label?: string }) {
  const { t } = useFs();
  return (
    <View
      accessible
      accessibilityLabel={label ?? initials}
      style={[styles.stamp, { backgroundColor: t.color.plate, borderColor: t.color.ink2 }]}
    >
      <Txt kind="stamp" style={{ color: t.color.ink }} maxFontSizeMultiplier={1}>
        {initials}
      </Txt>
    </View>
  );
}

/* ------------------------------------------------------------------ Hatch */

export function hatchPath(w: number, h: number, step = 6): string {
  let d = "";
  for (let x = -h; x < w; x += step) d += `M${x} ${h}L${x + h} 0`;
  return d;
}

/** 45° hatching, 1.5 px every 6 px: cash at the bodega, or unavailable. Always paired with a word. */
export function Hatch({ color, style }: { color?: string; style?: ViewStyle }) {
  const { t } = useFs();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ w: Math.ceil(e.nativeEvent.layout.width), h: Math.ceil(e.nativeEvent.layout.height) });
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]} onLayout={onLayout}>
      {size.w > 0 ? (
        <Svg width={size.w} height={size.h}>
          <Path d={hatchPath(size.w, size.h)} stroke={color ?? t.color.hatch} strokeWidth={1.5} />
        </Svg>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ Banner */

export function Banner({
  tone = "neutral",
  icon,
  children,
  action,
  testID,
}: {
  tone?: "neutral" | "decide" | "offline" | "paypal-failure";
  icon?: GlyphName;
  children: ReactNode;
  action?: ReactNode;
  testID?: string;
}) {
  const { t } = useFs();
  const bg =
    tone === "decide" ? t.color.canaryWash : tone === "paypal-failure" ? t.color.redWash : t.color.plate2;
  const border =
    tone === "decide" ? t.color.canaryBorder : tone === "paypal-failure" ? t.color.red : t.color.rule;
  const fg = tone === "paypal-failure" ? t.color.red : t.color.ink;
  return (
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: bg, borderColor: border }]}
    >
      {icon ? <Glyph name={icon} size={20} color={fg} /> : null}
      <View style={{ flex: 1, gap: space.s4 }}>{children}</View>
      {action}
    </View>
  );
}

/* ------------------------------------------------------------------ labels */

/*
 * UI gate round 3 retires the honesty pill: the rail is one "Sandbox" micro-tag beside the PayPal value it covers
 * (`ui/honesty.tsx` MicroTag) and every other provenance is a bare legend glyph whose words are its name.
 */

/**
 * I8: anything not live says so. Shown on every screen while the app runs on local demo data. UI gate round 3: the
 * synthetic legend glyph (a hatched square), its words its accessible name; no pill.
 */
export function DemoLabel() {
  const { demo } = useApp();
  const t = useT();
  if (!demo) return null;
  return <LegendGlyph testID="demo-label" kind={MARK_KIND.demoData} label={t("common.demoData")} />;
}

/**
 * OD-2 (S1.6): "Machine-translated, pending native review" while the language is Cebuano or Filipino
 * (`pendingReview`). UI gate round 3: the simulated legend glyph (a dashed circle), its words its accessible name.
 */
export function MachineTranslatedNote({ testID }: { testID?: string }) {
  const { lang } = useApp();
  const t = useT();
  if (!pendingReview(lang)) return null;
  return (
    <LegendGlyph testID={testID} kind={MARK_KIND.machineTranslated} label={t("common.machineTranslated")} />
  );
}

/**
 * The marks that open every surface: demo data (I8) and the review mark (OD-2), as bare glyphs on one row; a tap
 * shows their words. The chrome draws them on every `<Screen>`; the one surface that is not a screen, the Paminawa
 * sheet, draws them itself. `screen` is the register ID: the review mark's test hook is `{screen}.machine`.
 * Round 5 (provenance once): inside the judge stage's frames nothing is drawn in the corner (the stage's indicator
 * and What's real say it); the marks keep their hooks and their words for assistive technology (`QuietMarks`).
 */
export function SurfaceLabels({ screen }: { screen: string }) {
  const { demo, lang } = useApp();
  const t = useT();
  const marks: LegendGlyphProps[] = [];
  if (demo) marks.push({ testID: "demo-label", kind: MARK_KIND.demoData, label: t("common.demoData") });
  if (pendingReview(lang)) {
    marks.push({
      testID: `${screen}.machine`,
      kind: MARK_KIND.machineTranslated,
      label: t("common.machineTranslated"),
    });
  }
  return inFrame ? <QuietMarks marks={marks} /> : <MarkRow marks={marks} />;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Txt kind="label" color="ink2" accessibilityRole="header" style={{ marginBottom: space.s8 }}>
      {children}
    </Txt>
  );
}

/* ------------------------------------------------------------------ StatusChip, RuleChip */

/**
 * A status in words, with a glyph, never by colour alone (design §2.2). One job per colour: jade flush means PayPal
 * confirmed it; canary means a person must decide ("Gisusi pa", "Parked"), never an error; red is only a PayPal
 * failure; hatch is cash at the bodega. `state` lands in `data-state` for tests.
 */
export function StatusChip({
  label,
  tone,
  testID,
  state,
}: {
  label: string;
  tone: StatusTone;
  /** Kept for callers; round 2 draws the state as a dot (✓ only on confirmed money). */
  glyph?: GlyphName;
  testID?: string;
  state?: string;
}) {
  const { t } = useFs();
  // UI gate round 2 (the console's pill): white with a 1 px rule, and the colour lives only in the dot. Confirmed
  // money is the one filled pill (jade, ✓). Round 3 (docs/DESIGN.md §2, §4): jade is only money the simulated PayPal
  // confirmed and dashed means simulated only, so money in flight is the neutral pill: a solid ring, the hollow
  // pending dot and its word in ink.
  const look = {
    landed: { bg: t.color.jade, fg: t.color.onJade, border: t.color.jadeFlushBorder },
    pending: { bg: t.color.plate, fg: t.color.ink, border: t.color.ruleStrong },
    decide: { bg: t.color.plate, fg: t.color.ink, border: t.color.ruleStrong },
    failure: { bg: t.color.plate, fg: t.color.red, border: t.color.ruleStrong },
    cash: { bg: t.color.plate, fg: t.color.ink, border: t.color.ruleStrong },
    neutral: { bg: t.color.plate, fg: t.color.ink2, border: t.color.ruleStrong },
  }[tone];
  return (
    <View
      testID={testID}
      dataSet={{ state: state ?? tone, tone }}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[styles.status, { backgroundColor: look.bg, borderColor: look.border }]}
    >
      {tone === "landed" ? <Glyph name="check" size={14} color={look.fg} /> : <StatusDot tone={tone} />}
      {/* The words wrap inside the chip (long Cebuano status words, 200% text); they are never cut off. */}
      <Txt kind="label" style={[styles.statusWords, { color: look.fg }]}>
        {label}
      </Txt>
    </View>
  );
}

/**
 * A status as a dot (the console's `StateDot`, docs/DESIGN.md §4): amber when a person decides, red only when PayPal
 * failed, jade only when PayPal confirmed, a hatch swatch for cash, a hollow ink-3 ring while the money is with
 * PayPal (pending), a hollow steel ring otherwise (waiting). Always beside its word.
 */
export function StatusDot({ tone, size = 8 }: { tone: StatusTone; size?: number }) {
  const { t } = useFs();
  if (tone === "cash") {
    return (
      <View
        style={[
          styles.dot,
          { width: size + 2, height: size + 2, borderRadius: 2, borderColor: t.color.hatch },
        ]}
      >
        <Hatch />
      </View>
    );
  }
  const fill =
    tone === "decide"
      ? t.color.canary
      : tone === "failure"
        ? t.color.red
        : tone === "landed"
          ? t.color.jade
          : "transparent";
  const ring =
    tone === "landed"
      ? t.color.jadeFlushBorder
      : tone === "pending"
        ? t.color.ink3
        : tone === "neutral"
          ? t.color.steelLine
          : fill;
  return (
    <View
      style={[
        styles.dot,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: fill, borderColor: ring },
      ]}
    />
  );
}

/** The member's status word for a line, in her language, with its tone and glyph (register §7). */
export function MemberStatusChip({
  status,
  word,
  testID,
}: {
  status: MemberStatus;
  /** The word from IC-01's map (`MEMBER_STATUS_WORDS[status][lang]`), possibly with a date: "Bayad na, 30 Okt". */
  word: string;
  testID?: string;
}) {
  return (
    <StatusChip
      label={word}
      tone={STATUS_TONE[status]}
      glyph={STATUS_GLYPH[status]}
      testID={testID}
      state={status}
    />
  );
}

/**
 * A ruled deduction (design §2.2): plate-2, no hue of its own. Round 5 (no ids for people): it reads its words alone
 * ("CBU −1.09"); the rule's id is part of its accessible name only. A chip with no words of its own draws nothing:
 * its row already says the deduction, and speaks the rule.
 */
export function RuleChip({ ruleId, label, testID }: { ruleId: string; label?: string; testID?: string }) {
  const { t } = useFs();
  if (!label) return null;
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={ruleId ? `${label}, rule ${ruleId}` : label}
      style={[styles.rule, { backgroundColor: t.color.plate2, borderColor: t.color.rule }]}
    >
      <Txt kind="label">{label}</Txt>
    </View>
  );
}

/* ------------------------------------------------------------------ Wordmark, HashText */

/** "Fair Split: co-op payroll": the name never appears without its descriptor (register §1, S2.7). */
export function Wordmark({ size = "title2" }: { size?: "title1" | "title2" | "bodyStrong" }) {
  const t = useT();
  return (
    <Txt kind={size} accessibilityRole="header">
      {t("app.lockup")}
    </Txt>
  );
}

/** A hash in groups of four ("7f3a 91c2 …"), for cross-checking by eye against the console. */
export function HashText({
  hex,
  groups,
  testID,
}: {
  hex: string;
  /** Show only the first n groups (the seal footer shows two; the co-sign shows four). */
  groups?: number;
  testID?: string;
}) {
  const t = useT();
  const parts = hex.toLowerCase().match(/.{1,4}/g) ?? [];
  const shown = (groups ? parts.slice(0, groups) : parts).join(" ");
  return (
    <Txt
      kind="hash"
      color="ink2"
      selectable
      testID={testID}
      accessibilityLabel={t("seal.hash", { hash: shown })}
    >
      {shown}
    </Txt>
  );
}

export function Rule() {
  const { t } = useFs();
  return <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: t.color.rule }} />;
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s8,
    borderRadius: radius.control,
    borderWidth: 1,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s4,
    minHeight: 32,
    paddingHorizontal: space.s12,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  stamp: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.s12,
    padding: space.s12,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  status: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    gap: space.s8,
    // Round 4: the phone's scale of the console's pill (32 px, the label step's 15/520), the same for every status.
    minHeight: layout.statusChip,
    paddingLeft: space.s8 + 2,
    paddingRight: space.s12,
    paddingVertical: space.s4,
    borderWidth: 1,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  dot: { borderWidth: 1, overflow: "hidden" },
  statusWords: { flexShrink: 1 },
  rule: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s4,
    paddingHorizontal: space.s8,
    paddingVertical: 2,
    borderWidth: 1,
    borderRadius: radius.cell,
  },
  textButton: { alignSelf: "flex-start" },
  link: { textDecorationLine: "underline" },
});
