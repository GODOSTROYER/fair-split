/**
 * ReceiptBar (design §5, S2.2.1 member wording): her share of the co-op's verified kilos, then the premium
 * (protected, "walay kaltas"), the bonus, ruled deductions as rule chips, credits, the net, and for a PayPal line a
 * dotted segment with PayPal's and GCash's published rates, which are not co-op deductions. Members never see a
 * per-kg rate. A proportional bar over a list, so it reads on a narrow phone and at 2× text.
 *
 * Every amount can be tapped (MM-7): it lifts into a 1 px ink frame (`framed`, 90 ms), then the line opens in place
 * (`expanded`, `glide`) to say where it comes from, down to her slips; a slip opens the zoom. All figures come from
 * `lib/figures` (I1); the words wrap them.
 */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import type { StatementDTO } from "../../_shims/api-client";
import type { Lang } from "../../_shims/contracts";
import { SPRINGS } from "../../_shims/motion";
import { radius, space, target } from "../../_shims/tokens.native";
import {
  feeFigures,
  receiptBarWeights,
  receiptRows,
  shareFigures,
  type Trace,
  type TraceId,
  traceFor,
} from "../../lib/figures";
import { useFs } from "../../theme/theme";
import { Glyph } from "../../ui/glyph";
import { ms } from "../../ui/motion";
import { Hatch, RuleChip } from "../../ui/primitives";
import { figures, Sentence } from "../../ui/sentence";
import { Txt } from "../../ui/text";
import type { SlipOwner } from "./slip-paper";
import { SlipTiles, type TapPoint } from "./slip-tiles";
import { useT } from "./use-t";

const glide = LinearTransition.springify()
  .stiffness(SPRINGS.glide.stiffness)
  .damping(SPRINGS.glide.damping)
  .mass(SPRINGS.glide.mass);

export type ExpandState = "framed" | "expanded";

function Row({
  id,
  label,
  amount,
  note,
  strong,
  dotted,
  open,
  onPress,
  srLabel,
  children,
}: {
  id: TraceId;
  label: ReactNode;
  amount?: string;
  note?: string;
  strong?: boolean;
  dotted?: boolean;
  open: ExpandState | null;
  onPress(id: TraceId): void;
  srLabel: string;
  children?: ReactNode;
}) {
  const { t, motion } = useFs();
  const tr = useT();
  const safeId = id.replace(":", "-");
  return (
    <Animated.View
      layout={motion.reduced ? undefined : glide}
      style={[
        styles.rowWrap,
        dotted && { borderStyle: "dotted", borderColor: t.color.ink3, marginTop: space.s8 },
        !dotted && { borderColor: open ? t.color.ink : "transparent" },
        dotted && open ? { borderStyle: "solid", borderColor: t.color.ink } : null,
        open ? { backgroundColor: t.color.plate } : null,
      ]}
    >
      <Pressable
        testID={`M-MB-01.receipt.${safeId}`}
        dataSet={{ state: open ?? "closed" }}
        accessibilityRole="button"
        accessibilityLabel={srLabel}
        accessibilityHint={tr("M-MB-01.tapHint")}
        aria-expanded={!!open}
        onPress={() => onPress(id)}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.color.pencilWash }]}
      >
        <View style={styles.rowText}>
          {typeof label === "string" ? <Txt kind={strong ? "bodyStrong" : "body"}>{label}</Txt> : label}
          {note ? (
            <Txt kind="caption" color="ink2">
              {note}
            </Txt>
          ) : null}
        </View>
        {amount ? (
          <Txt kind={strong ? "amountM" : "figure"} align="right" style={styles.amount}>
            {amount}
          </Txt>
        ) : null}
        <View style={[styles.chevron, open === "expanded" && styles.chevronOpen]}>
          <Glyph name="chevronDown" size={16} color={t.color.ink3} />
        </View>
      </Pressable>
      {open === "expanded" ? (
        <Animated.View
          entering={FadeIn.duration(ms(motion.reduced ? "reduced" : "print"))}
          exiting={motion.reduced ? undefined : FadeOut.duration(ms("microOut"))}
          style={styles.trace}
          testID={`M-MB-01.trace.${safeId}`}
        >
          {children}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/** What a trace says, in words around the DTO's figures. */
function TraceBody({
  trace,
  lang,
  owner,
  dto,
  onSlip,
  treasurer,
}: {
  trace: Trace;
  lang: Lang;
  owner: SlipOwner;
  dto: StatementDTO;
  onSlip(serial: string, at: TapPoint): void;
  treasurer: string;
}) {
  const { t } = useFs();
  const tr = useT();
  const slips = dto.slips.filter((s) => trace.slips.includes(s.serial));
  const tiles = slips.length ? (
    <View style={{ gap: space.s8 }}>
      <SlipTiles slips={slips} owner={owner} onOpen={onSlip} testPrefix="M-MB-01.slip" />
      <Txt kind="caption" color="ink2">
        {tr("M-MB-01.traceSlips")}
      </Txt>
    </View>
  ) : null;
  switch (trace.id) {
    case "premium":
      return (
        <>
          <Sentence
            lang={lang}
            segments={figures(
              tr("M-MB-01.tracePremium", { kg: trace.kg, coopKg: trace.coopKg, rule: trace.rule }),
            )}
          />
          {tiles}
        </>
      );
    case "bonus":
      return (
        <>
          <Sentence lang={lang} segments={figures(tr("M-MB-01.traceBonus", { kg: trace.grade1Kg }))} />
          {tiles}
        </>
      );
    case "net":
      return (
        <>
          <View
            style={styles.equation}
            accessible
            accessibilityLabel={`${trace.terms.map((x) => `${x.op ?? ""} ${x.amount}`).join(" ")} = ${trace.total}`}
          >
            {trace.terms.map((x) => (
              <Txt key={`${x.op}${x.amount}`} kind="figure" color="ink2">
                {`${x.op ? `${x.op} ` : ""}${x.amount}`}
              </Txt>
            ))}
            <Txt kind="figure">{`= ${trace.total}`}</Txt>
          </View>
          <View style={styles.check}>
            <Glyph
              name={trace.conserved ? "check" : "info"}
              size={20}
              color={trace.conserved ? t.color.ink : t.color.canaryText}
            />
            <Txt kind="body" color={trace.conserved ? "ink" : "canaryText"} style={styles.flex}>
              {trace.conserved ? tr("M-MB-01.traceNet") : tr("M-MB-01.traceNetOff", { name: treasurer })}
            </Txt>
          </View>
        </>
      );
    case "fees":
      return (
        <>
          <Sentence lang={lang} segments={figures(tr("M-MB-01.traceFees", { rate: trace.rate }))} />
          {trace.sources.map((s) => (
            <Txt key={s} kind="caption" color="ink2" lang="en">
              {s}
            </Txt>
          ))}
        </>
      );
    default:
      if (trace.id.startsWith("ded:") && "rule" in trace && "card" in trace) {
        return (
          <View style={styles.bolted}>
            <Glyph name="bolt" size={20} color={t.color.ink2} />
            <View style={styles.flex}>
              <Sentence
                lang={lang}
                segments={figures(
                  tr(trace.beforeFirstSlip ? "M-MB-01.traceDeduction" : "M-MB-01.traceDeductionPlain", {
                    label: trace.label,
                    rule: trace.rule,
                    card: trace.card,
                    date: trace.ratifiedOn,
                  }),
                )}
              />
            </View>
          </View>
        );
      }
      if ("written" in trace) {
        return (
          <>
            <Sentence
              lang={lang}
              segments={figures(tr("M-MB-01.traceCredit", { written: trace.written, slip: trace.slip }))}
            />
            {tiles}
          </>
        );
      }
      return null;
  }
}

export function ReceiptBar({
  dto,
  lang,
  paypal,
  open,
  onSegment,
  onSlip,
  owner,
}: {
  dto: StatementDTO;
  lang: Lang;
  /** A PayPal line also shows PayPal's and GCash's published rates. */
  paypal: boolean;
  open: { id: TraceId; state: ExpandState } | null;
  onSegment(id: TraceId): void;
  onSlip(serial: string, at: TapPoint): void;
  owner: SlipOwner;
}) {
  const { t } = useFs();
  const tr = useT();
  const rows = receiptRows(dto);
  const w = receiptBarWeights(dto);
  const share = shareFigures(dto);
  const fees = feeFigures();
  const stateOf = (id: TraceId) => (open?.id === id ? open.state : null);
  const body = (id: TraceId) => {
    const trace = open?.id === id && open.state === "expanded" ? traceFor(dto, id, lang) : null;
    return trace ? (
      <TraceBody
        trace={trace}
        lang={lang}
        owner={owner}
        dto={dto}
        onSlip={onSlip}
        treasurer={dto.treasurer.first}
      />
    ) : null;
  };

  return (
    <View testID="M-MB-01.receipt" style={styles.root}>
      <View style={styles.bar} importantForAccessibility="no-hide-descendants" aria-hidden>
        <View style={{ flex: w.premium, backgroundColor: t.color.ink }} />
        <View style={{ flex: w.bonus, backgroundColor: t.color.pencil }} />
        {w.deducted > 0 ? (
          <View style={[styles.hatched, { flex: w.deducted, backgroundColor: t.color.plate2 }]}>
            <Hatch />
          </View>
        ) : null}
        {w.credited > 0 ? <View style={{ flex: w.credited, backgroundColor: t.color.ink2 }} /> : null}
      </View>
      <Sentence
        kind="figureS"
        color="ink2"
        segments={figures(tr("M-MB-01.share", { kg: share.kg, coopKg: share.coopKg }))}
      />

      <View style={[styles.list, { borderTopColor: t.color.rule }]}>
        {rows.map((r) => {
          if (r.kind === "premium") {
            return (
              <Row
                key={r.id}
                id={r.id}
                open={stateOf(r.id)}
                onPress={onSegment}
                label={
                  <View style={styles.labelRow}>
                    <Glyph name="lock" size={16} color={t.color.ink2} />
                    <Txt kind="body">{tr("M-MB-01.premium")}</Txt>
                  </View>
                }
                note={tr("M-MB-01.noDeductions")}
                amount={r.amount}
                srLabel={`${tr("M-MB-01.premium")}, ${r.spoken}, ${tr("M-MB-01.noDeductions")}`}
              >
                {body(r.id)}
              </Row>
            );
          }
          if (r.kind === "bonus") {
            return (
              <Row
                key={r.id}
                id={r.id}
                open={stateOf(r.id)}
                onPress={onSegment}
                label={tr("M-MB-01.bonus")}
                amount={r.amount}
                srLabel={`${tr("M-MB-01.bonus")}, ${r.spoken}`}
              >
                {body(r.id)}
              </Row>
            );
          }
          if (r.kind === "deduction") {
            return (
              <Row
                key={r.id}
                id={r.id}
                open={stateOf(r.id)}
                onPress={onSegment}
                label={
                  <View style={styles.labelRow}>
                    <Txt kind="body">{r.label ?? ""}</Txt>
                    <RuleChip ruleId={r.ruleId ?? ""} />
                  </View>
                }
                note={tr("M-MB-01.ruleRef", { card: dto.rateCard.id })}
                amount={r.amount}
                srLabel={`${r.label ?? ""}, ${r.spoken}, ${r.ruleId ?? ""}, ${dto.rateCard.id}`}
              >
                {body(r.id)}
              </Row>
            );
          }
          if (r.kind === "credit") {
            return (
              <Row
                key={r.id}
                id={r.id}
                open={stateOf(r.id)}
                onPress={onSegment}
                label={tr("M-MB-01.credit")}
                note={tr("M-MB-01.creditSlip", { slip: r.slip ?? "" })}
                amount={r.amount}
                srLabel={`${tr("M-MB-01.credit")}, ${r.spoken}, ${tr("M-MB-01.creditSlip", { slip: r.slip ?? "" })}`}
              >
                {body(r.id)}
              </Row>
            );
          }
          return (
            <View key={r.id} style={[styles.total, { borderTopColor: t.color.ink }]}>
              <Row
                id={r.id}
                open={stateOf(r.id)}
                onPress={onSegment}
                strong
                label={tr("M-MB-01.net")}
                amount={r.amount}
                srLabel={`${tr("M-MB-01.net")}, ${r.spoken}`}
              >
                {body(r.id)}
              </Row>
            </View>
          );
        })}
        {paypal ? (
          <Row
            id="fees"
            dotted
            open={stateOf("fees")}
            onPress={onSegment}
            label={
              <Sentence
                kind="body"
                color="ink2"
                segments={figures(tr("M-MB-01.fees", { paypal: fees.paypal, gcash: fees.gcash }))}
              />
            }
            srLabel={tr("M-MB-01.fees", { paypal: fees.paypal, gcash: fees.gcash })}
          >
            {body("fees")}
          </Row>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.s12 },
  bar: { flexDirection: "row", height: 10, gap: 2, overflow: "hidden" },
  hatched: { overflow: "hidden" },
  list: { borderTopWidth: 1 },
  rowWrap: { borderWidth: 1, borderRadius: radius.none, marginTop: -1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    minHeight: target.min + 8,
    paddingVertical: space.s8,
    paddingLeft: space.s8,
    paddingRight: space.s4,
  },
  rowText: { flex: 1, gap: space.s2 },
  amount: { flexShrink: 0 },
  chevron: { width: 16, alignItems: "center" },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
  labelRow: { flexDirection: "row", alignItems: "center", gap: space.s8, flexWrap: "wrap" },
  trace: { gap: space.s12, paddingHorizontal: space.s8, paddingBottom: space.s16 },
  equation: { flexDirection: "row", flexWrap: "wrap", gap: space.s8, alignItems: "baseline" },
  check: { flexDirection: "row", alignItems: "flex-start", gap: space.s8 },
  bolted: { flexDirection: "row", alignItems: "flex-start", gap: space.s8 },
  flex: { flex: 1 },
  total: { borderTopWidth: 2, marginTop: space.s4 },
});
