/**
 * App chrome on Material 3 structure, themed from our tokens (design §6 "Navigation"; Android guidance): the
 * navigation bar with three destinations per role, a small top app bar, and the edge-to-edge screen frame that
 * carries the screen's test hooks (`testID` = its register ID, `data-state` from IC-01's list) and the labels that
 * keep it honest (demo data, machine translation).
 */

import { useFocusEffect } from "expo-router";
import type { BottomTabBarProps } from "expo-router/tabs";
import { type ReactNode, useCallback } from "react";
import { Pressable, ScrollView, type ScrollViewProps, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ScreenStateOf, ScreenWithStates } from "../_shims/contracts";
import { space, target } from "../_shims/tokens.native";
import { stage } from "../services/frame-bridge";
import { useFs } from "../theme/theme";
import { SurfaceLabels } from "./primitives";
import { Txt } from "./text";

/**
 * M3 navigation bar: icon in a pill indicator over its label; 48 dp targets; the system Back stays the system's. A
 * tab's `tabBarAccessibilityLabel` (its title plus a badge's count: "Outbox, 3 on this phone") is what a screen
 * reader hears; without one it hears the title.
 */
export function NavBar({ state, descriptors, emitter, navigateToTab }: BottomTabBarProps) {
  const { t } = useFs();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.nav,
        {
          paddingBottom: Math.max(insets.bottom, space.s8),
          backgroundColor: t.color.plate,
          borderTopColor: t.color.rule,
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const desc = descriptors[route.key];
        if (!desc) return null;
        const { options } = desc;
        if ((options as { href?: unknown }).href === null) return null;
        const focused = state.index === index;
        const label = typeof options.title === "string" ? options.title : route.name;
        const onPress = () => {
          const ev = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !ev.defaultPrevented) navigateToTab(route.key);
        };
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
            testID={`tab.${route.name.replace(/[^a-z]/gi, "")}`}
            dataSet={{ state: focused ? "selected" : "idle" }}
            style={styles.item}
          >
            <View style={[styles.indicator, { backgroundColor: focused ? t.color.ink : "transparent" }]}>
              {options.tabBarIcon?.({ focused, color: focused ? t.color.plate : t.color.ink2, size: 24 })}
            </View>
            <Txt
              kind="label"
              style={{ color: focused ? t.color.ink : t.color.ink2 }}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
            >
              {label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** M3 small top app bar: a leading action, the title (a header for screen readers), trailing actions. */
export function TopBar({
  title,
  trailing,
  leading,
}: {
  title: string;
  trailing?: ReactNode;
  leading?: ReactNode;
}) {
  const { t } = useFs();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.top, { paddingTop: insets.top, backgroundColor: t.color.ground }]}>
      <View style={styles.topRow}>
        {leading}
        <Txt kind="title2" accessibilityRole="header" style={{ flex: 1 }} numberOfLines={1}>
          {title}
        </Txt>
        {trailing}
      </View>
    </View>
  );
}

export interface ScreenProps<S extends ScreenWithStates> {
  /** The register's screen ID (`M-MB-01`…): the root's testID and the stage's `fs.focus`. */
  testID: S;
  /** `data-state`, from IC-01's list for this screen: an unlisted state fails to compile. */
  state: ScreenStateOf<S>;
  children: ReactNode;
  scroll?: boolean;
  topInset?: boolean;
  footer?: ReactNode;
  contentStyle?: ScrollViewProps["contentContainerStyle"];
  refreshControl?: ScrollViewProps["refreshControl"];
}

/**
 * Edge-to-edge screen on the ground colour with 16 dp gutters and 24 dp between sections (design §2.4), opened by its
 * labels: the demo label whenever data is not live (I8) and "Machine-translated, pending native review" whenever the
 * language is Cebuano or Filipino (OD-2), on every screen of every role. It carries the screen's test hooks, and in a
 * judge frame it tells the stage which screen it shows (IC-12 `fs.focus`).
 */
export function Screen<S extends ScreenWithStates>({
  testID,
  state,
  children,
  scroll = true,
  topInset = true,
  footer,
  contentStyle,
  refreshControl,
}: ScreenProps<S>) {
  const { t } = useFs();
  const insets = useSafeAreaInsets();
  useFocusEffect(
    useCallback(() => {
      stage.focus(testID);
    }, [testID]),
  );
  const pad = { paddingTop: topInset ? insets.top + space.s16 : space.s16 };
  return (
    <View testID={testID} dataSet={{ state }} style={[styles.screen, { backgroundColor: t.color.ground }]}>
      {scroll ? (
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[styles.content, pad, contentStyle]}
          keyboardShouldPersistTaps="handled"
        >
          <SurfaceLabels screen={testID} />
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, pad, { flex: 1 }, contentStyle as object]}>
          <SurfaceLabels screen={testID} />
          {children}
        </View>
      )}
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.s12,
  },
  item: { flex: 1, alignItems: "center", gap: space.s4, minHeight: target.min },
  indicator: {
    width: 64,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  top: { paddingHorizontal: space.s16 },
  topRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: space.s12 },
  screen: { flex: 1 },
  content: { paddingHorizontal: space.s16, paddingBottom: space.s48, gap: space.s24 },
});
