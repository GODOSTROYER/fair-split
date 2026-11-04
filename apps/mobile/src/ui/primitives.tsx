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
import { fontFamily } from "../_shims/fonts";
import { pendingReview } from "../_shims/i18n";
import { radius, slabDepth, space, target } from "../_shims/tokens.native";
import { STATUS_GLYPH, STATUS_TONE, type StatusTone } from "../lib/item-status";
import { useApp } from "../state/app";
import { useFs } from "../theme/theme";
import { Glyph, type GlyphName } from "./glyph";
import { Txt, useT } from "./text";

/* ------------------------------------------------------------------ Button */

export interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  /** "hand": a person's decision, the indigo slab face on its d2 lip (ADR-0016). */
  variant?: "filled" | "hand" | "tonal" | "text";
  icon?: GlyphName;
  tall?: boolean;
  style?: ViewStyle;
  testID?: string;
}

export function Button({ label, variant = "filled", icon, tall, style, disabled, ...rest }: ButtonProps) {
  const { t } = useFs();
  const hand = variant === "hand";
  const face = hand
    ? t.slab.chalk.face
    : variant === "filled"
      ? t.color.ink
      : variant === "tonal"
        ? t.color.plate2
        : "transparent";
  const fg = hand ? t.slab.chalk.label : variant === "filled" ? t.color.plate : t.color.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={variant === "text" ? 8 : 0}
      {...rest}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: tall ? target.primary : target.min,
          backgroundColor: face,
          borderColor: variant === "tonal" ? t.color.rule : "transparent",
          paddingHorizontal: variant === "text" ? space.s8 : space.s16,
          opacity: disabled ? 0.55 : 1,
        },
        hand
          ? {
              borderRadius: radius.card,
              marginBottom: slabDepth.d2,
              boxShadow: `0px ${slabDepth.d2}px 0px ${t.slab.chalk.edgeRight}, 0px ${slabDepth.d2}px 0px 1px ${t.slab.chalk.edgeBottom}`,
            }
          : null,
        pressed && hand ? { transform: [{ translateY: slabDepth.d2 }], boxShadow: "none" } : null,
        pressed && !hand && { backgroundColor: variant === "filled" ? t.color.ink2 : t.color.pencilWash },
        style,
      ]}
    >
      {icon ? <Glyph name={icon} size={20} color={fg} /> : null}
      <Txt kind={variant === "text" ? "bodyStrong" : "slab"} style={{ color: fg }}>
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

/** A 20 px indigo stamp (radius 6) with a person's initials in white: every human decision carries one (ADR-0016). */
export function InkStamp({ initials, label }: { initials: string; label?: string }) {
  const { t } = useFs();
  return (
    <View
      accessible
      accessibilityLabel={label ?? initials}
      style={[styles.stamp, { backgroundColor: t.slab.chalk.face }]}
    >
      <Txt kind="caption" style={[styles.stampText, { color: t.slab.chalk.label }]} maxFontSizeMultiplier={1}>
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

/** I8: anything not live says so. Shown on every screen while the app runs on local demo data. */
export function DemoLabel() {
  const { demo } = useApp();
  const t = useT();
  const fs = useFs();
  if (!demo) return null;
  return (
    <View
      testID="demo-label"
      style={[styles.demoLabel, styles.honest, { borderColor: fs.t.color.steelLine }]}
    >
      <Glyph name="info" size={14} color={fs.t.color.ink3} />
      <Txt kind="caption" color="ink2">
        {t("common.demoData")}
      </Txt>
    </View>
  );
}

/**
 * OD-2 (S1.6): "Machine-translated, pending native review" while the language is Cebuano or Filipino
 * (`pendingReview`). Machine output is pencil (design §1): the translate glyph and the words in pencil, on a dashed
 * edge, beside the demo label.
 */
export function MachineTranslatedNote({ testID }: { testID?: string }) {
  const { lang } = useApp();
  const t = useT();
  const fs = useFs();
  if (!pendingReview(lang)) return null;
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={t("common.machineTranslated")}
      style={[styles.demoLabel, styles.machine, styles.honest, { borderColor: fs.t.color.steelLine }]}
    >
      <Glyph name="translate" size={14} color={fs.t.color.pencil} />
      <Txt kind="caption" style={{ color: fs.t.color.pencil, flexShrink: 1 }}>
        {t("common.machineTranslated")}
      </Txt>
    </View>
  );
}

/**
 * The labels that open every surface, on one row that wraps on a narrow phone: demo data (I8) and the review chip
 * (OD-2). The chrome draws them on every `<Screen>`; the one surface that is not a screen, the Paminawa sheet, draws
 * them itself. `screen` is the register ID: the chip's test hook is `{screen}.machine`.
 */
export function SurfaceLabels({ screen }: { screen: string }) {
  const { demo, lang } = useApp();
  if (!demo && !pendingReview(lang)) return null;
  return (
    <View style={styles.labels}>
      <DemoLabel />
      <MachineTranslatedNote testID={`${screen}.machine`} />
    </View>
  );
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
  glyph,
  testID,
  state,
}: {
  label: string;
  tone: StatusTone;
  glyph?: GlyphName;
  testID?: string;
  state?: string;
}) {
  const { t } = useFs();
  const look = {
    landed: { bg: t.color.jade, fg: t.color.onJade, border: t.color.jadeFlushBorder },
    decide: { bg: t.color.canaryWash, fg: t.color.ink, border: t.color.canaryBorder },
    failure: { bg: t.color.redWash, fg: t.color.red, border: t.color.red },
    cash: { bg: t.color.plate, fg: t.color.ink, border: t.color.rule },
    pending: { bg: "transparent", fg: t.color.ink, border: t.color.jadeFlushBorder },
    neutral: { bg: t.color.plate2, fg: t.color.ink2, border: t.color.rule },
  }[tone];
  return (
    <View
      testID={testID}
      dataSet={{ state: state ?? tone, tone }}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        styles.status,
        { backgroundColor: look.bg, borderColor: look.border },
        tone === "pending" ? styles.inFlight : null,
      ]}
    >
      {tone === "cash" ? <Hatch /> : null}
      {glyph ? <Glyph name={glyph} size={16} color={look.fg} /> : null}
      {/* The words wrap inside the chip (long Cebuano status words, 200% text); they are never cut off. */}
      <Txt kind="label" style={[styles.statusWords, { color: look.fg }]}>
        {label}
      </Txt>
    </View>
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

/** A ruled deduction (design §2.2): plate-2 with the rule ID in text, no hue of its own. "CBU −1.09 R1". */
export function RuleChip({ ruleId, label, testID }: { ruleId: string; label?: string; testID?: string }) {
  const { t } = useFs();
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={label ? `${label}, ${ruleId}` : ruleId}
      style={[styles.rule, { backgroundColor: t.color.plate2, borderColor: t.color.rule }]}
    >
      {label ? <Txt kind="label">{label}</Txt> : null}
      <Txt kind="label" color="ink2">
        {ruleId}
      </Txt>
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
  stamp: { width: 20, height: 20, borderRadius: radius.cell, alignItems: "center", justifyContent: "center" },
  stampText: { fontSize: 9, lineHeight: 11, fontFamily: fontFamily.strong },
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
    gap: space.s4,
    minHeight: 28,
    paddingHorizontal: space.s12,
    paddingVertical: space.s4,
    borderWidth: 1,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  /** Money on its way: a 1.5 px dashed jade outline on a transparent face (not yet money anyone holds). */
  inFlight: { borderStyle: "dashed", borderWidth: 1.5 },
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
  demoLabel: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: space.s4,
    paddingHorizontal: space.s8,
    paddingVertical: 2,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
  machine: { flexShrink: 1, maxWidth: "100%" },
  /** Not real, or not yet: the dashed steel honesty outline on a transparent face (ADR-0016). */
  honest: { borderStyle: "dashed", backgroundColor: "transparent" },
  labels: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.s8 },
});
