/**
 * App chrome on Material 3 structure, themed from our tokens (design §6 "Navigation"; Android guidance): the
 * navigation bar with three destinations per role, a small top app bar, and the edge-to-edge screen frame that
 * carries the screen's test hooks (`testID` = its register ID, `data-state` from IC-01's list) and the labels that
 * keep it honest (demo data, machine translation). UI gate round 4: the selected tab wears the console nav's pod wash,
 * the frame fades 24 px under the status inset once content is under it, and a list that passes `snapRows` never
 * rests with a row cut by the tab bar.
 */

import { useFocusEffect } from "expo-router";
import type { BottomTabBarProps } from "expo-router/tabs";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ScreenStateOf, ScreenWithStates } from "../_shims/contracts";
import { layout, space, target } from "../_shims/tokens.native";
import { type RowBox, rowSnapCover, SNAP_REST_MS } from "../lib/row-snap";
import { stage } from "../services/frame-bridge";
import { useFs } from "../theme/theme";
import { NAV_FADE_PX, navFadeBands, topFadeBands } from "./nav-fade";
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
      {/* The screen's content ends above the bar in a 12 px fade to the plate, never a hard cut (round 3). */}
      <EdgeFade color={t.color.plate} />
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
            {/* Round 4: the console nav's selected look, the pod wash under an ink icon (never a black slab). */}
            <View style={[styles.indicator, { backgroundColor: focused ? t.color.podWash : "transparent" }]}>
              {options.tabBarIcon?.({ focused, color: focused ? t.color.ink : t.color.ink2, size: 24 })}
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

/**
 * The 12 px fade a scrolled column ends in above a fixed bar (UI gate round 3), in the bar's own colour: placed as
 * the bar's first child, it sits just above the bar and never takes a touch.
 */
export function EdgeFade({ color }: { color: string }) {
  return (
    <View pointerEvents="none" aria-hidden style={styles.fade}>
      {navFadeBands().map((band) => (
        <View
          key={band.top}
          style={[
            styles.fadeBand,
            { top: band.top, height: band.height, opacity: band.opacity, backgroundColor: color },
          ]}
        />
      ))}
    </View>
  );
}

/**
 * The 24 px fade under the status inset (UI gate round 4), in the screen's own surface: shown once the content has
 * scrolled under it, so nothing is cut through a line at the top either. The inset itself is solid surface.
 */
function TopFade({ color, inset }: { color: string; inset: number }) {
  return (
    <View pointerEvents="none" aria-hidden style={[styles.topFade, { height: inset + layout.fade }]}>
      {inset > 0 ? (
        <View style={[styles.fadeBand, { top: 0, height: inset, backgroundColor: color }]} />
      ) : null}
      {topFadeBands(layout.fade).map((band) => (
        <View
          key={band.top}
          style={[
            styles.fadeBand,
            { top: inset + band.top, height: band.height, opacity: band.opacity, backgroundColor: color },
          ]}
        />
      ))}
    </View>
  );
}

/**
 * Rows never end under the tab bar (UI gate round 4): at rest, the row the viewport's bottom edge would cut is covered
 * from its top down in the screen's surface (whole row or none). Nothing is covered while the list moves.
 */
function SnapCover({ from, height, color }: { from: number; height: number; color: string }) {
  return (
    <View
      pointerEvents="none"
      aria-hidden
      style={[styles.snapCover, { top: from, height: Math.max(0, height - from), backgroundColor: color }]}
    />
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
  /**
   * The screen's own surface. "ground" (porcelain) under cards; "plate" (white) for a full-bleed document, the
   * member's statement (UI gate round 2: no card inside the phone, the statement is the screen).
   */
  surface?: "ground" | "plate";
  /**
   * The list's rows, in the scrolled content's coordinates (UI gate round 4): at rest, the row the bottom edge would
   * cut is covered, so a row never ends under the tab bar. Measure each row with `onLayout` against the content.
   */
  snapRows?: readonly RowBox[];
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
  surface = "ground",
  snapRows,
}: ScreenProps<S>) {
  const { t } = useFs();
  const insets = useSafeAreaInsets();
  useFocusEffect(
    useCallback(() => {
      stage.focus(testID);
    }, [testID]),
  );
  const pad = { paddingTop: topInset ? insets.top + space.s16 : space.s16 };
  // Round 4: the top fade shows once content is under it; the snap cover is placed when the list is at rest. Both
  // change state only when they change (a scroll does not re-render the screen on every frame).
  const [scrolled, setScrolled] = useState(false);
  const [viewport, setViewport] = useState(0);
  const [restY, setRestY] = useState<number | null>(0);
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (restTimer.current) clearTimeout(restTimer.current);
    },
    [],
  );
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    setScrolled(y > 0);
    if (!snapRows) return;
    setRestY(null);
    if (restTimer.current) clearTimeout(restTimer.current);
    restTimer.current = setTimeout(() => setRestY(y), SNAP_REST_MS);
  };
  const cover = snapRows && restY !== null ? rowSnapCover(snapRows, restY, viewport) : null;
  const surfaceColor = t.color[surface];
  return (
    <View testID={testID} dataSet={{ state }} style={[styles.screen, { backgroundColor: surfaceColor }]}>
      {scroll ? (
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[styles.content, pad, contentStyle]}
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          scrollEventThrottle={32}
          onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
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
      {scroll && scrolled ? <TopFade color={surfaceColor} inset={topInset ? insets.top : 0} /> : null}
      {cover !== null ? <SnapCover from={cover} height={viewport} color={surfaceColor} /> : null}
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
  fade: { position: "absolute", left: 0, right: 0, top: -NAV_FADE_PX, height: NAV_FADE_PX },
  fadeBand: { position: "absolute", left: 0, right: 0 },
  topFade: { position: "absolute", left: 0, right: 0, top: 0 },
  snapCover: { position: "absolute", left: 0, right: 0 },
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
