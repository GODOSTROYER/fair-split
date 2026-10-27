/**
 * Her slips as a row of small papers (S1.9 "slip chips"; design §6 M1): each is the slip itself in miniature, the
 * serial in red and the kilos in the clerk's hand, and each opens MM-7's zoom about the point it was tapped. When
 * Paminawa's voice names a slip, its paper rises 8 dp (`settle`) and is framed in ink for 1.2 s (S1.9 M-MB-03).
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, Pressable, StyleSheet, View, type ViewInstance } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
} from "react-native-reanimated";
import type { StatementSlip } from "../../_shims/api-client";
import { format } from "../../_shims/domain";
import { space, target } from "../../_shims/tokens.native";
import { useFs } from "../../theme/theme";
import { spring, TIMELINE } from "../../ui/motion";
import { type SlipOwner, SlipPaper } from "./slip-paper";
import { useT } from "./use-t";

const MAX_TILE = 104;

export interface TapPoint {
  x: number;
  y: number;
}

/** A slip that lifts when it is named; `lit` is the stamp of its latest naming (0: never). */
function Lift({ lit, children }: { lit: number; children: ReactNode }) {
  const { t, motion } = useFs();
  const y = useSharedValue(0);
  const [framed, setFramed] = useState(false);
  useEffect(() => {
    if (!lit) return;
    setFramed(true);
    const off = setTimeout(() => setFramed(false), TIMELINE.paminawaChip.litMs);
    if (!motion.reduced) {
      y.set(
        withSequence(
          withSpring(-TIMELINE.paminawaChip.liftDp, spring("settle")),
          withDelay(TIMELINE.paminawaChip.litMs, withSpring(0, spring("settle"))),
        ),
      );
    }
    return () => clearTimeout(off);
  }, [lit, motion.reduced, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  return (
    <Animated.View style={style} dataSet={{ lit: framed ? "on" : "off" }}>
      <View style={[styles.frame, { borderColor: framed ? t.color.ink : "transparent" }]}>{children}</View>
    </Animated.View>
  );
}

export function SlipTiles({
  slips,
  owner,
  onOpen,
  testPrefix,
  lit,
  current,
  columns = 4,
}: {
  slips: readonly StatementSlip[];
  owner: SlipOwner;
  onOpen?(serial: string, at: TapPoint): void;
  testPrefix: string;
  lit?: Readonly<Record<string, number>>;
  /** The slip open in the zoom: framed in ink and not pressable. */
  current?: string | null;
  columns?: number;
}) {
  const tr = useT();
  const { t } = useFs();
  const [width, setWidth] = useState(0);
  const refs = useRef<Record<string, ViewInstance | null>>({});
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const n = Math.max(1, Math.min(columns, slips.length));
  const tile = width > 0 ? Math.min(MAX_TILE, Math.floor((width - space.s8 * (n - 1)) / n)) : 0;

  const open = (serial: string) => {
    if (!onOpen) return;
    const node = refs.current[serial];
    if (!node) return onOpen(serial, { x: 0, y: 0 });
    node.measureInWindow((x, y, w, h) => onOpen(serial, { x: x + w / 2, y: y + h / 2 }));
  };

  return (
    <View style={styles.grid} onLayout={onLayout}>
      {tile > 0
        ? slips.map((s) => {
            const paper = (
              <Lift lit={lit?.[s.serial] ?? 0}>
                <SlipPaper slip={s} owner={owner} width={tile} />
              </Lift>
            );
            const label = tr("M-MB-02.slipLabel", {
              serial: s.serial,
              date: format.date(s.deliveredOn, "en"),
              kg: format.kg(s.netGrams, 2),
            });
            return (
              <View
                key={s.serial}
                collapsable={false}
                ref={(r) => {
                  refs.current[s.serial] = r;
                }}
              >
                {onOpen && current !== s.serial ? (
                  <Pressable
                    testID={`${testPrefix}.${s.serial}`}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityHint={tr("M-MB-01.traceSlips")}
                    onPress={() => open(s.serial)}
                    style={({ pressed }) => [styles.tap, pressed && styles.pressed]}
                  >
                    {paper}
                  </Pressable>
                ) : (
                  <View
                    testID={`${testPrefix}.${s.serial}`}
                    dataSet={{ state: current === s.serial ? "open" : "idle" }}
                    style={[
                      styles.tap,
                      current === s.serial && [styles.currentTile, { borderBottomColor: t.color.ink }],
                    ]}
                  >
                    {paper}
                  </View>
                )}
              </View>
            );
          })
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.s8, minHeight: target.min },
  tap: { minHeight: target.min, justifyContent: "center", paddingVertical: space.s4 },
  pressed: { opacity: 0.8 },
  currentTile: { borderBottomWidth: 2 },
  frame: { borderWidth: 1, margin: -1 },
});
