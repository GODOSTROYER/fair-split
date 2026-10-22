/**
 * Small app primitives on the design tokens: flat buttons (for navigation and reversible, non-money actions;
 * human commits use the Slab), chips, the ink stamp, hatching, banners and the demo label.
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
import { radius, space, target } from "../_shims/tokens.native";
import { useApp } from "../state/app";
import { useFs } from "../theme/theme";
import { Glyph, type GlyphName } from "./glyph";
import { Txt, useT } from "./text";

/* ------------------------------------------------------------------ Button */

export interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  variant?: "filled" | "tonal" | "text";
  icon?: GlyphName;
  tall?: boolean;
  style?: ViewStyle;
  testID?: string;
}

export function Button({ label, variant = "filled", icon, tall, style, disabled, ...rest }: ButtonProps) {
  const { t } = useFs();
  const face = variant === "filled" ? t.color.ink : variant === "tonal" ? t.color.plate2 : "transparent";
  const fg = variant === "filled" ? t.color.plate : t.color.ink;
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
        pressed && { backgroundColor: variant === "filled" ? t.color.ink2 : t.color.pencilWash },
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

export function Chip({
  label,
  selected,
  onPress,
  icon,
  testID,
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: GlyphName;
  testID?: string;
  accessibilityLabel?: string;
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
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
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

/** An 18 px ink square with a person's initials: every human decision carries one (design §2.5). */
export function InkStamp({ initials, label }: { initials: string; label?: string }) {
  const { t } = useFs();
  return (
    <View
      accessible
      accessibilityLabel={label ?? initials}
      style={[styles.stamp, { backgroundColor: t.color.ink }]}
    >
      <Txt kind="caption" style={[styles.stampText, { color: t.color.plate }]} maxFontSizeMultiplier={1}>
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
      style={[styles.demoLabel, { borderColor: fs.t.color.rule, backgroundColor: fs.t.color.plate2 }]}
    >
      <Glyph name="info" size={14} color={fs.t.color.ink2} />
      <Txt kind="caption" color="ink2">
        {t("common.demoData")}
      </Txt>
    </View>
  );
}

export function MachineTranslatedNote() {
  const { lang } = useApp();
  const t = useT();
  if (lang === "en") return null;
  return (
    <Txt kind="caption" color="ink3" testID="machine-translated">
      {t("common.machineTranslated")}
    </Txt>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Txt kind="label" color="ink2" accessibilityRole="header" style={{ marginBottom: space.s8 }}>
      {children}
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
    borderRadius: radius.plate,
    borderWidth: 1,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s4,
    minHeight: 32,
    paddingHorizontal: space.s12,
    borderRadius: radius.plate,
    borderWidth: 1,
  },
  stamp: { width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  stampText: { fontSize: 9, lineHeight: 11, fontFamily: "MonaSans_700Bold" },
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.s12,
    padding: space.s12,
    borderWidth: 1,
    borderRadius: radius.plate,
  },
  demoLabel: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: space.s4,
    paddingHorizontal: space.s8,
    paddingVertical: 2,
    borderWidth: 1,
    borderRadius: radius.plate,
  },
});
