/**
 * App chrome on Material 3 structure, themed from our tokens: a navigation bar with three destinations per role,
 * a small top app bar, and the edge-to-edge screen frame (design §6 "Navigation"; android.md).
 */
import type { BottomTabBarProps } from "expo-router/tabs";
import type { ReactNode } from "react";
import { Pressable, ScrollView, type ScrollViewProps, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, space, target } from "../_shims/tokens.native";
import { useFs } from "../theme/theme";
import { DemoLabel } from "./primitives";
import { Txt } from "./text";

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
            accessibilityLabel={label}
            testID={`tab.${route.name.replace(/[^a-z]/gi, "")}`}
            style={styles.item}
          >
            <View style={[styles.indicator, { backgroundColor: focused ? t.color.ink : "transparent" }]}>
              {options.tabBarIcon?.({ focused, color: focused ? t.color.plate : t.color.ink2, size: 24 })}
            </View>
            <Txt kind="label" style={{ color: focused ? t.color.ink : t.color.ink2 }} numberOfLines={1}>
              {label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

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

/** Edge-to-edge screen on the ground colour with 16 dp gutters and the demo label when it applies. */
export function Screen({
  children,
  scroll = true,
  topInset = true,
  footer,
  contentStyle,
  testID,
  state,
  ...rest
}: {
  children: ReactNode;
  scroll?: boolean;
  topInset?: boolean;
  footer?: ReactNode;
  contentStyle?: ScrollViewProps["contentContainerStyle"];
  testID?: string;
  state?: string;
} & Pick<ScrollViewProps, "refreshControl">) {
  const { t } = useFs();
  const insets = useSafeAreaInsets();
  const pad = { paddingTop: topInset ? insets.top + space.s16 : space.s16 };
  return (
    <View
      testID={testID}
      dataSet={state ? { state } : undefined}
      style={[styles.screen, { backgroundColor: t.color.ground }]}
    >
      {scroll ? (
        <ScrollView
          {...rest}
          contentContainerStyle={[styles.content, pad, contentStyle]}
          keyboardShouldPersistTaps="handled"
        >
          <DemoLabel />
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, pad, { flex: 1 }, contentStyle as object]}>
          <DemoLabel />
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
    borderRadius: radius.plate,
    alignItems: "center",
    justifyContent: "center",
  },
  top: { paddingHorizontal: space.s16 },
  topRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: space.s12 },
  screen: { flex: 1 },
  content: { paddingHorizontal: space.s16, paddingBottom: space.s48, gap: space.s24 },
});
