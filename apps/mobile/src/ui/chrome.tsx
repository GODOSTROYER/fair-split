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
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  type ScrollViewProps,
  StyleSheet,
  View,
  type ViewInstance,
  type ViewProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ScreenStateOf, ScreenWithStates } from "../_shims/contracts";
import { layout, space, target } from "../_shims/tokens.native";
import {
  type RowBox,
  rowSnapCover,
  SNAP_REST_MS,
  SNAP_SETTLE_MS,
  type SnapNode,
  snapCoverFrom,
  snapEdge,
  viewportRows,
} from "../lib/row-snap";
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
  // Round 7: no ghost text under the inset. The first two thirds of the 24 px are plain surface (a line scrolled
  // under it is clipped, never read through a veil); only the last third fades, so the cut has no hard edge.
  const solid = Math.round((layout.fade * 2) / 3);
  const soft = layout.fade - solid;
  return (
    <View pointerEvents="none" aria-hidden style={[styles.topFade, { height: inset + layout.fade }]}>
      <View style={[styles.fadeBand, { top: 0, height: inset + solid, backgroundColor: color }]} />
      {topFadeBands(soft).map((band) => (
        <View
          key={band.top}
          style={[
            styles.fadeBand,
            {
              top: inset + solid + band.top,
              height: band.height,
              opacity: band.opacity,
              backgroundColor: color,
            },
          ]}
        />
      ))}
    </View>
  );
}

/** What a screen's blocks ask of the screen that scrolls them (UI gate round 4). */
interface ScreenScroll {
  /** Registers a block the bar may never cut; returns its unregistration. */
  add(node: SnapNode): () => void;
  /**
   * Scrolls so `node` starts `gap` px under the top inset: an opened card, never mid-row. Round 5: 32 by default, the
   * 24 px top fade and 8 more, so a revealed card's top edge is never under the fade or against the status inset.
   */
  reveal(node: SnapNode, gap?: number): void;
}

/** Where a revealed block starts under the top inset (round 5): clear of the 24 px fade, with 8 px to spare. */
export const REVEAL_GAP = layout.fade + space.s8;

/**
 * The room under a sticky footer's last line (round 5): the bottom inset and 24 px, so nothing sits on the bezel.
 * Footers (the thumb zone, a step's footer) pad their foot with it.
 */
export function useFooterEnd(): number {
  const insets = useSafeAreaInsets();
  return insets.bottom + layout.end;
}

const ScreenScrollContext = createContext<ScreenScroll | null>(null);

/** The screen this block scrolls in (null outside a scrolling `Screen`). */
export function useScreenScroll(): ScreenScroll | null {
  return useContext(ScreenScrollContext);
}

/**
 * A ref callback that makes its view one row the tab bar or a sticky footer never cuts (UI gate round 4): at rest,
 * a row the bottom edge would cut is covered whole. Rows may nest; the lowest cut row is the one covered.
 */
export function useSnapRow(): (node: SnapNode | null) => void {
  const scroll = useContext(ScreenScrollContext);
  const off = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      off.current?.();
      off.current = null;
    },
    [],
  );
  return useCallback(
    (node: SnapNode | null) => {
      off.current?.();
      off.current = node && scroll ? scroll.add(node) : null;
    },
    [scroll],
  );
}

/** A view that is one snap row (`useSnapRow`): use it in place of a `View` around a block of a list. */
export function SnapRow({ children, ...rest }: ViewProps & { children?: ReactNode }) {
  const ref = useSnapRow();
  return (
    <View {...rest} ref={ref} collapsable={false}>
      {children}
    </View>
  );
}

/** A promise of a view's top and height in the window. */
function measured(node: SnapNode): Promise<{ y: number; height: number }> {
  return new Promise((resolve) => node.measureInWindow((_x, y, _w, height) => resolve({ y, height })));
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
   * Blocks inside the screen can instead register themselves (`SnapRow`, `useSnapRow`), measured at rest.
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
  const { t, motion } = useFs();
  const insets = useSafeAreaInsets();
  useFocusEffect(
    useCallback(() => {
      stage.focus(testID);
    }, [testID]),
  );
  const inset = topInset ? insets.top : 0;
  const pad = { paddingTop: inset + space.s16 };
  // Round 4: the top fade shows once content is under it; the snap cover is placed when the list is at rest. Both
  // change state only when they change (a scroll does not re-render the screen on every frame).
  const [scrolled, setScrolled] = useState(false);
  const [viewport, setViewport] = useState(0);
  const [restY, setRestY] = useState<number | null>(0);
  const [measuredCover, setMeasuredCover] = useState<number | null>(null);
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const root = useRef<ViewInstance>(null);
  const scroller = useRef<ScrollViewInstance>(null);
  const scrollY = useRef(0);
  const nodes = useRef(new Set<SnapNode>());
  const viewportRef = useRef(0);
  const pass = useRef(0);
  useEffect(
    () => () => {
      if (restTimer.current) clearTimeout(restTimer.current);
    },
    [],
  );

  // The registered rows, measured where they rest against the viewport: the cut one is covered from its top.
  const measureRows = useCallback(() => {
    const list = [...nodes.current];
    const box = root.current;
    const height = viewportRef.current;
    if (!box || !list.length || !(height > 0)) {
      setMeasuredCover(null);
      return;
    }
    const at = ++pass.current;
    void Promise.all([measured(box), ...list.map(measured)]).then(([top, ...rows]) => {
      if (at !== pass.current || !top) return;
      setMeasuredCover(snapCoverFrom(viewportRows(top.y, rows), height, NAV_FADE_PX));
    });
  }, []);
  const settle = useCallback(
    (ms: number) => {
      if (restTimer.current) clearTimeout(restTimer.current);
      restTimer.current = setTimeout(() => {
        setRestY(scrollY.current);
        measureRows();
      }, ms);
    },
    [measureRows],
  );
  const api = useMemo<ScreenScroll>(
    () => ({
      add(node) {
        nodes.current.add(node);
        settle(SNAP_SETTLE_MS);
        return () => {
          nodes.current.delete(node);
          settle(SNAP_SETTLE_MS);
        };
      },
      reveal(node, gap = REVEAL_GAP) {
        const box = root.current;
        if (!box) return;
        void Promise.all([measured(box), measured(node)]).then(([top, row]) => {
          const y = scrollY.current + (row.y - top.y) - inset - gap;
          scroller.current?.scrollTo({ y: Math.max(0, y), animated: !motion.reduced });
        });
      },
    }),
    [settle, inset, motion.reduced],
  );

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    scrollY.current = y;
    setScrolled(y > 0);
    // Nothing is covered while the list moves; the cover is placed again once it rests.
    setRestY(null);
    setMeasuredCover(null);
    settle(SNAP_REST_MS);
  };
  const edge = snapEdge(viewport, NAV_FADE_PX);
  const given = snapRows && restY !== null ? rowSnapCover(snapRows, restY, edge) : null;
  const cover = restY === null ? null : (given ?? measuredCover);
  const surfaceColor = t.color[surface];
  return (
    <View
      ref={root}
      collapsable={false}
      testID={testID}
      dataSet={{ state }}
      style={[styles.screen, { backgroundColor: surfaceColor }]}
    >
      {scroll ? (
        <ScreenScrollContext.Provider value={api}>
          <ScrollView
            ref={scroller}
            refreshControl={refreshControl}
            contentContainerStyle={[styles.content, pad, contentStyle]}
            keyboardShouldPersistTaps="handled"
            onScroll={onScroll}
            scrollEventThrottle={32}
            onLayout={(e) => {
              viewportRef.current = e.nativeEvent.layout.height;
              setViewport(e.nativeEvent.layout.height);
              settle(SNAP_SETTLE_MS);
            }}
            onContentSizeChange={() => settle(SNAP_SETTLE_MS)}
          >
            <SurfaceLabels screen={testID} />
            {children}
          </ScrollView>
        </ScreenScrollContext.Provider>
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
  // The scrolled content ends 48 px under its last line: above the tab bar's 12 px fade, and at least 24 px (layout.end)
  // above the bezel on a screen with no bar (round 5).
  content: { paddingHorizontal: space.s16, paddingBottom: space.s48, gap: space.s24 },
});
