/**
 * ReceiptBar (design §5, S2.2.1 member wording): her share of the co-op's verified kilos, then the premium
 * (protected, "walay kaltas"), the bonus, ruled deductions as rule chips, credits, the net, and for a PayPal line a
 * dotted segment with PayPal's and GCash's published rates, which are not co-op deductions. Members never see a
 * per-kg rate. A proportional bar over a list, so it reads on a narrow phone and at 2× text.
 *
 * Every amount can be tapped (MM-7): it lifts into a 1 px ink frame (`framed`, 90 ms), then the line opens in place
 * (`expanded`, `glide`) to say where it comes from, down to her slips; a slip opens the zoom. All figures come from
 * `lib/figures` (I1); the words wrap them. Every amount keeps the amount grammar (`receiptStates`): the parts in the
 * ink of the officers who approved them, the net as the hero reads it, hollow until PayPal or the clerk settles it.
 *
 * UI gate round 2: no raw rate-card id on her phone ("CBU · R1 · Schedule A"); the fees row folds to its two
 * published rates and opens to the sentence; captions in statement ink 2 (7:1 or better).
 *
 * UI gate round 3: the bar is her pay split, labelled. Each row's swatch is its segment's colour (premium ink, bonus
 * pencil, a ruled deduction hatched, a credit ink 2), so the bar reads as premium, bonus and deduction with their
 * amounts beside them, never as her share of the co-op's kilos (that sentence leaves: her kilos sit beside her pay).
 * The fees row is solid: dashed and dotted lines mean simulated only.
 */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import type { StatementDTO } from "../../_shims/api-client";
import type { AmountState, Lang } from "../../_shims/contracts";
import { format } from "../../_shims/domain";
import { SPRINGS } from "../../_shims/motion";
import { radius, space, target } from "../../_shims/tokens.native";
import {
  feeFigures,
  receiptBarWeights,
  receiptRows,
  type Trace,
  type TraceId,
  traceFor,
} from "../../lib/figures";
import { useFs } from "../../theme/theme";
import { AmountDisplay } from "../../ui/amount";
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

/** A row's segment of the pay-split bar. */
type Segment = "premium" | "bonus" | "deducted" | "credited";

/** The row's swatch: the same colour (or hatch) as its segment of the bar above the rows. */
function Swatch({ segment }: { segment: Segment }) {
  const { t } = useFs();
  if (segment === "deducted") {
    return (
      <View style={[styles.swatch, { borderColor: t.color.hatch, backgroundColor: t.color.plate2 }]}>
        <Hatch />
      </View>
    );
  }
  const fill = segment === "premium" ? t.color.ink : segment === "bonus" ? t.color.pencil : t.color.ink2;
  return <View style={[styles.swatch, { borderColor: fill, backgroundColor: fill }]} />;
}

function Row({
  id,
  label,
  amount,
  note,
  strong,
  dotted,
  segment,
  open,
  onPress,
  srLabel,
  children,
}: {
  id: TraceId;
  label: ReactNode;
  /** Its segment of the pay-split bar: the row leads with that swatch. */
  segment?: Segment;
  /** The row's figure and its amount state; the row's own label speaks it. */
  amount?: { text: string; state: AmountState };
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
        // The fees row is set apart by a solid hairline (round 3: dashed and dotted mean simulated only).
        dotted && { borderColor: t.color.rule, marginTop: space.s8 },
        !dotted && { borderColor: open ? t.color.pod : "transparent" },
        // Open is a selection: a rounded card ringed in ballpoint indigo, on e1 (ADR-0016), never an ink box.
        dotted && open ? { borderColor: t.color.pod } : null,
        open ? { backgroundColor: t.color.plate, boxShadow: t.shadow.e1 } : null,
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
        {segment ? (
          <View style={styles.swatchSlot} importantForAccessibility="no-hide-descendants" aria-hidden>
            <Swatch segment={segment} />
          </View>
        ) : null}
        <View style={styles.rowText}>
          {typeof label === "string" ? <Txt kind={strong ? "bodyStrong" : "body"}>{label}</Txt> : label}
          {note ? (
            <Txt kind="micro" color="statementInk2">
              {note}
            </Txt>
          ) : null}
        </View>
        {amount ? (
          <View style={styles.amount}>
            <AmountDisplay
              text={amount.text}
              state={amount.state}
              size={strong ? "m" : "figure"}
              testID={`M-MB-01.receipt.${safeId}.amount`}
            />
          </View>
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
          {/* MM-7 drawn as the equation (ADR-0016): each part at a readable size, the operators between them, and
              the paid amount after the equals sign; the figures are the statement's own lines. */}
          <View
            style={styles.equation}
            accessible
            accessibilityLabel={`${trace.terms.map((x) => `${x.op ?? ""} ${x.amount}`).join(" ")} = ${trace.total}`}
          >
            {trace.terms.map((x) => (
              <View key={`${x.op}${x.amount}`} style={styles.term}>
                {x.op ? (
                  <Txt kind="amountM" color="statementInk2">
                    {x.op}
                  </Txt>
                ) : null}
                <Txt kind="amountM" color="ink2">
                  {x.amount}
                </Txt>
              </View>
            ))}
            <View style={styles.term}>
              <Txt kind="amountM" color="statementInk2">
                =
              </Txt>
              <Txt kind="amountM">{trace.total}</Txt>
            </View>
          </View>
          {/* The slips the line was weighed on, as chips: serial and verified kilos (her statement's own slips). */}
          {dto.slips.length > 0 ? (
            <View style={styles.slipChips} testID="M-MB-01.trace.net.slips">
              {dto.slips.map((slip) => (
                <View
                  key={slip.serial}
                  style={[
                    styles.slipChip,
                    { borderColor: t.color.ruleStrong, backgroundColor: t.color.plate },
                  ]}
                >
                  <View
                    style={[
                      styles.slipChipPaper,
                      { backgroundColor: t.color.copyWhite, borderColor: t.color.ruleStrong },
                    ]}
                  />
                  <Txt kind="figureS">{slip.serial}</Txt>
                  <Txt kind="caption" color="ink2">
                    {format.kg(slip.netGrams, 2)}
                  </Txt>
                </View>
              ))}
            </View>
          ) : null}
          <View style={styles.check}>
            <Glyph
              name={trace.conserved ? "check" : "info"}
              size={18}
              color={trace.conserved ? t.color.ink : t.color.canaryText}
            />
            <Txt kind="body" color={trace.conserved ? "statementInk2" : "canaryText"} style={styles.flex}>
              {trace.conserved ? tr("M-MB-01.traceNet") : tr("M-MB-01.traceNetOff", { name: treasurer })}
            </Txt>
          </View>
        </>
      );
    case "fees":
      return (
        <>
          <Sentence
            lang={lang}
            segments={figures(tr("M-MB-01.fees", { paypal: trace.paypal, gcash: trace.gcash }))}
          />
          <Sentence lang={lang} segments={figures(tr("M-MB-01.traceFees", { rate: trace.rate }))} />
          {trace.sources.map((s) => (
            <Txt key={s} kind="micro" color="statementInk2" lang="en">
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
                    card: tr("M-MB-01.ruleRef"),
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
  states,
}: {
  dto: StatementDTO;
  lang: Lang;
  /** A PayPal line also shows PayPal's and GCash's published rates. */
  paypal: boolean;
  open: { id: TraceId; state: ExpandState } | null;
  onSegment(id: TraceId): void;
  onSlip(serial: string, at: TapPoint): void;
  owner: SlipOwner;
  /** The amount grammar of the parts and of the net (`receiptStates` of the line). */
  states: { parts: AmountState; net: AmountState };
}) {
  const { t } = useFs();
  const tr = useT();
  const rows = receiptRows(dto);
  const part = (text: string) => ({ text, state: states.parts });
  const w = receiptBarWeights(dto);
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
                segment="premium"
                note={tr("M-MB-01.noDeductions")}
                amount={part(r.amount)}
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
                segment="bonus"
                label={tr("M-MB-01.bonus")}
                amount={part(r.amount)}
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
                segment="deducted"
                note={tr("M-MB-01.ruleRef")}
                amount={part(r.amount)}
                srLabel={`${r.label ?? ""}, ${r.spoken}, ${r.ruleId ?? ""}, ${tr("M-MB-01.ruleRef")}`}
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
                segment="credited"
                label={tr("M-MB-01.credit")}
                note={tr("M-MB-01.creditSlip", { slip: r.slip ?? "" })}
                amount={part(r.amount)}
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
                amount={{ text: r.amount, state: states.net }}
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
              <Txt kind="figureS" color="statementInk2">
                {tr("M-MB-01.feesShort", { paypal: fees.paypal, gcash: fees.gcash })}
              </Txt>
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
  rowWrap: { borderWidth: 1, borderRadius: radius.card, marginTop: -1 },
  // A narrow column (200% zoom, a 2× font) wraps the figure under its words, right-aligned: the receipt becomes a
  // list (design §8) instead of squeezing the words into a sliver beside the figure.
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    // A wrapping row's lines sit in its middle: a short row (the fees) is never pinned to its top.
    alignContent: "center",
    columnGap: space.s12,
    rowGap: space.s4,
    minHeight: target.min + 8,
    paddingVertical: space.s8,
    paddingLeft: space.s8,
    paddingRight: space.s4,
  },
  rowText: { flexGrow: 1, flexShrink: 1, flexBasis: 128, gap: space.s2 },
  amount: { flexShrink: 0, marginLeft: "auto" },
  chevron: { width: 16, alignItems: "center" },
  swatchSlot: { alignSelf: "flex-start", paddingTop: 5 },
  swatch: { width: 10, height: 10, borderRadius: 2, borderWidth: 1, overflow: "hidden" },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
  labelRow: { flexDirection: "row", alignItems: "center", gap: space.s8, flexWrap: "wrap" },
  trace: { gap: space.s12, paddingHorizontal: space.s8, paddingBottom: space.s16 },
  equation: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: space.s8,
    rowGap: space.s4,
    alignItems: "baseline",
  },
  term: { flexDirection: "row", alignItems: "baseline", gap: space.s8 },
  slipChips: { flexDirection: "row", flexWrap: "wrap", gap: space.s8 },
  slipChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s4,
    minHeight: 28,
    paddingHorizontal: space.s8,
    borderWidth: 1,
    borderRadius: radius.cell,
  },
  slipChipPaper: { width: 10, height: 13, borderWidth: 1 },
  check: { flexDirection: "row", alignItems: "flex-start", gap: space.s8 },
  bolted: { flexDirection: "row", alignItems: "flex-start", gap: space.s8 },
  flex: { flex: 1 },
  total: { borderTopWidth: 2, marginTop: space.s4 },
});
