/**
 * ReceiptBar (design §5): kilos × rate → premium (protected, "walay kaltas") → bonus → ruled deductions as rule
 * chips → credits → net. A proportional bar over a list, so it reads on a narrow phone and at 2× text. Every amount
 * can be tapped (MM-7 "Tap a peso").
 */
import { type ReactNode, useRef } from "react";
import { Pressable, StyleSheet, View, type ViewInstance } from "react-native";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";
import type { StatementDTO } from "../../_shims/api-client";
import { format } from "../../_shims/domain";
import { radius, space, springs, target } from "../../_shims/tokens.native";
import { useFs } from "../../theme/theme";
import { Glyph } from "../../ui/glyph";
import { Chip, Hatch } from "../../ui/primitives";
import { Txt, useT } from "../../ui/text";

export type SegmentId = "premium" | "bonus" | "net" | `ded:${string}` | "credit";
export type Mm7Phase = "rest" | "framed" | "expanded" | "zooming" | "zoomed" | "tiled" | "returning";

const glide = LinearTransition.springify()
  .stiffness(springs.glide.stiffness)
  .damping(springs.glide.damping)
  .mass(springs.glide.mass);

function Row({
  id,
  label,
  amount,
  note,
  strong,
  framed,
  onPress,
  srLabel,
  children,
}: {
  id: SegmentId;
  label: ReactNode;
  amount: string;
  note?: string;
  strong?: boolean;
  framed: boolean;
  onPress?: (id: SegmentId) => void;
  srLabel: string;
  children?: ReactNode;
}) {
  const { t, motion } = useFs();
  return (
    <Animated.View
      layout={motion.reduced ? undefined : glide}
      style={[styles.rowWrap, { borderColor: framed ? t.color.ink : "transparent" }]}
    >
      <Pressable
        testID={`M-MB-01.receipt.${id}`}
        accessibilityRole="button"
        accessibilityLabel={srLabel}
        accessibilityHint={onPress ? undefined : ""}
        disabled={!onPress}
        onPress={() => onPress?.(id)}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.color.pencilWash }]}
      >
        <View style={{ flex: 1, gap: space.s2 }}>
          {typeof label === "string" ? <Txt kind={strong ? "bodyStrong" : "body"}>{label}</Txt> : label}
          {note ? (
            <Txt kind="caption" color="ink2">
              {note}
            </Txt>
          ) : null}
        </View>
        <Txt kind={strong ? "amountM" : "figure"} align="right">
          {amount}
        </Txt>
      </Pressable>
      {children}
    </Animated.View>
  );
}

export function ReceiptBar({
  dto,
  expanded,
  onSegment,
  onSlip,
}: {
  dto: StatementDTO;
  expanded: SegmentId | null;
  onSegment(id: SegmentId): void;
  onSlip(serial: string, at: { x: number; y: number }): void;
}) {
  const { t } = useFs();
  const tr = useT();
  const a = dto.amounts;
  const gross = a.premiumCents + a.bonusCents;
  const deducted = a.deductions.reduce((s, d) => s + d.cents, 0);
  const kg = format.kg(dto.kilos.netGrams);
  const spoken = (c: number) => format.amountSpoken(c);
  const chipRefs = useRef<Record<string, ViewInstance | null>>({});

  const openSlip = (serial: string) => {
    const node = chipRefs.current[serial];
    if (!node) return onSlip(serial, { x: 0, y: 0 });
    node.measureInWindow((x, y, w, h) => onSlip(serial, { x: x + w / 2, y: y + h / 2 }));
  };

  return (
    <View testID="M-MB-01.receipt" style={{ gap: space.s12 }}>
      <View style={styles.bar} importantForAccessibility="no-hide-descendants" aria-hidden>
        <View style={{ flex: a.premiumCents, backgroundColor: t.color.ink }} />
        <View style={{ flex: Math.max(0, a.bonusCents - deducted), backgroundColor: t.color.pencil }} />
        {deducted > 0 ? (
          <View style={{ flex: Math.max(deducted, gross * 0.012), backgroundColor: t.color.plate2 }}>
            <Hatch />
          </View>
        ) : null}
      </View>
      <Txt kind="figureS" color="ink2">
        {tr("M-MB-01.kgRate", { kg, rate: `US$${dto.premiumRatePerKg}` })}
      </Txt>

      <View style={[styles.list, { borderColor: t.color.rule }]}>
        <Row
          id="premium"
          label={
            <View style={styles.labelRow}>
              <Glyph name="lock" size={16} color={t.color.ink2} />
              <Txt kind="body">{tr("M-MB-01.premium")}</Txt>
            </View>
          }
          note={tr("M-MB-01.noDeductions")}
          amount={format.usd(a.premiumCents)}
          framed={expanded === "premium"}
          onPress={onSegment}
          srLabel={`${tr("M-MB-01.premium")}, ${spoken(a.premiumCents)}, ${tr("M-MB-01.noDeductions")}. ${tr("M-MB-01.tapHint")}`}
        >
          {expanded === "premium" ? (
            <Animated.View entering={FadeIn.duration(150)} style={styles.expanded} testID="M-MB-01.expanded">
              <Txt kind="statementBody">
                {tr("M-MB-01.expanded", { kg, rate: `US$${dto.premiumRatePerKg}`, rule: "R0" })}
              </Txt>
              <View style={styles.chips}>
                {dto.slips.map((s) => (
                  <View
                    key={s.serial}
                    ref={(r) => {
                      chipRefs.current[s.serial] = r;
                    }}
                    collapsable={false}
                  >
                    <Chip
                      icon="slip"
                      label={s.serial}
                      testID={`M-MB-01.slip.${s.serial}`}
                      accessibilityLabel={tr("M-MB-02.slip", { serial: s.serial })}
                      onPress={() => openSlip(s.serial)}
                    />
                  </View>
                ))}
              </View>
            </Animated.View>
          ) : null}
        </Row>
        <Row
          id="bonus"
          label={tr("M-MB-01.bonus")}
          amount={format.usd(a.bonusCents)}
          framed={expanded === "bonus"}
          onPress={onSegment}
          srLabel={`${tr("M-MB-01.bonus")}, ${spoken(a.bonusCents)}`}
        />
        {a.deductions.map((d) => (
          <Row
            key={d.ruleId}
            id={`ded:${d.ruleId}`}
            label={
              <View style={styles.labelRow}>
                <View
                  style={[styles.ruleChip, { backgroundColor: t.color.plate2, borderColor: t.color.rule }]}
                >
                  <Txt kind="label">{`${d.label} ${format.usdPlain(-d.cents)} ${d.ruleId}`}</Txt>
                </View>
              </View>
            }
            note={tr("M-MB-01.ruleRef", { rule: d.ruleId, card: dto.rateCard.id })}
            amount={format.usd(-d.cents)}
            framed={expanded === `ded:${d.ruleId}`}
            onPress={onSegment}
            srLabel={`${d.label}, minus ${spoken(d.cents)}, ${d.ruleId}, ${dto.rateCard.id}`}
          />
        ))}
        {a.creditsCents > 0 ? (
          <Row
            id="credit"
            label={tr("M-MB-01.credit")}
            amount={format.usd(a.creditsCents)}
            framed={false}
            srLabel={`${tr("M-MB-01.credit")}, ${spoken(a.creditsCents)}`}
          />
        ) : null}
        <View style={[styles.total, { borderTopColor: t.color.ink }]}>
          <Row
            id="net"
            strong
            label={tr("M-MB-01.net")}
            amount={format.usd(a.netCents)}
            framed={false}
            srLabel={`${tr("M-MB-01.net")}, ${format.amountSpoken(a.netCents, dto.fx.phpPerUsd)}`}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", height: 10, gap: 2, overflow: "hidden" },
  list: { borderTopWidth: 1 },
  rowWrap: { borderWidth: 1, borderRadius: radius.none, marginTop: -1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    minHeight: target.min + 8,
    paddingVertical: space.s8,
    paddingHorizontal: space.s8,
  },
  labelRow: { flexDirection: "row", alignItems: "center", gap: space.s8 },
  ruleChip: { paddingHorizontal: space.s8, paddingVertical: 2, borderWidth: 1, borderRadius: radius.plate },
  expanded: { gap: space.s12, paddingHorizontal: space.s8, paddingBottom: space.s12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.s8 },
  total: { borderTopWidth: 2, marginTop: space.s4 },
});
