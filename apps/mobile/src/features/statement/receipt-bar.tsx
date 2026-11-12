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
 *
 * UI gate round 5 (docs/DESIGN.md §10): hatch means cash only, so a deduction's segment and key are an ink-2 outline;
 * the keys are the vocabulary's one 8 px square; a deduction reads its words ("CBU") with the rule only in its
 * spoken label; the traced peso's equation stays on one line; her slips appear once, in the one receipt-chip shape.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type ViewInstance } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import type { StatementDTO } from "../../_shims/api-client";
import type { AmountState, Lang } from "../../_shims/contracts";
import { SPRINGS } from "../../_shims/motion";
import { radius, space, target } from "../../_shims/tokens.native";
import {
  type EquationTerm,
  feeFigures,
  receiptRows,
  type Trace,
  type TraceId,
  traceFor,
} from "../../lib/figures";
import { typeScale, useFs } from "../../theme/theme";
import { AmountDisplay } from "../../ui/amount";
import { useScreenScroll, useSnapRow } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { ms } from "../../ui/motion";
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

/** An opened row comes up once the row that closed above it has glided shut (`glide` settles in about 300 ms). */
const REVEAL_AFTER_MS = 320;

/** A row's part of the pay split (its legend key's look). */
type Segment = "premium" | "bonus" | "deducted" | "credited";

/**
 * A part's look, on its row's legend key. Round 5 (hatch only for cash): a ruled deduction is the
 * money taken out, an outline in ink 2 with nothing inside, never hatched.
 */
function useSegmentLook(segment: Segment): { fill: string; edge: string } {
  const { t } = useFs();
  switch (segment) {
    case "premium":
      return { fill: t.color.ink, edge: t.color.ink };
    case "bonus":
      return { fill: t.color.pencil, edge: t.color.pencil };
    case "deducted":
      return { fill: t.color.plate, edge: t.color.ink2 };
    case "credited":
      return { fill: t.color.ink2, edge: t.color.ink2 };
  }
}

/** The row's legend key (round 5: the vocabulary's one square, 8 px), one look a part. */
function Swatch({ segment }: { segment: Segment }) {
  const look = useSegmentLook(segment);
  return <View style={[styles.swatch, { borderColor: look.edge, backgroundColor: look.fill }]} />;
}

/**
 * The traced peso's equation on one line (round 5): "43.69 + 21.85 − 1.09 = US$64.45" at the amount-l step (24/30),
 * the operators and the parts quieter than the paid amount. It never wraps: on a column narrower than the whole
 * equation (the stage's phone, 200% text) the line scales down until it fits, as the hero amount does.
 */
function Equation({ terms, total }: { terms: readonly EquationTerm[]; total: string }) {
  const { t } = useFs();
  const [room, setRoom] = useState(0);
  const [natural, setNatural] = useState(0);
  const base = typeScale.amountM;
  const fit = room > 0 && natural > room ? room / natural : 1;
  const sized = { fontSize: base.fontSize * fit, lineHeight: base.lineHeight * fit };
  const quiet = { color: t.color.statementInk2 };
  const part = { color: t.color.ink2 };
  const line = (
    <>
      {terms.map((x, i) => (
        <Text key={`${x.op}${x.amount}`}>
          {i > 0 ? " " : null}
          {x.op ? <Text style={quiet}>{`${x.op} `}</Text> : null}
          <Text style={part}>{x.amount}</Text>
        </Text>
      ))}
      <Text style={quiet}>{" = "}</Text>
      {total}
    </>
  );
  return (
    <View
      testID="M-MB-01.trace.net.equation"
      onLayout={(e) => setRoom(e.nativeEvent.layout.width)}
      accessible
      accessibilityLabel={`${terms.map((x) => `${x.op ?? ""} ${x.amount}`).join(" ")} = ${total}`}
    >
      <View
        style={styles.measure}
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      >
        <View style={styles.measureLine}>
          <Txt kind="amountM" numberOfLines={1} onLayout={(e) => setNatural(e.nativeEvent.layout.width)}>
            {line}
          </Txt>
        </View>
      </View>
      <Txt kind="amountM" numberOfLines={1} style={sized} importantForAccessibility="no" aria-hidden>
        {line}
      </Txt>
    </View>
  );
}

/** The lines whose trace shows her slips (round 5: while one is open, the statement's own slip row steps aside). */
export function listsSlips(id: TraceId): boolean {
  return id === "premium" || id === "bonus" || id === "net" || id.startsWith("credit");
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
  // Round 4: each row is one snap row (never cut by the tab bar), and an opened row comes up to 16 px under the top
  // inset once the rows around it have settled, so the traced card starts whole, never mid-row.
  const scroll = useScreenScroll();
  const snap = useSnapRow();
  const node = useRef<ViewInstance | null>(null);
  const expanded = open === "expanded";
  useEffect(() => {
    if (!expanded || !scroll) return;
    const at = setTimeout(
      () => {
        if (node.current) scroll.reveal(node.current);
      },
      motion.reduced ? 0 : REVEAL_AFTER_MS,
    );
    return () => clearTimeout(at);
  }, [expanded, scroll, motion.reduced]);
  return (
    <Animated.View
      layout={motion.reduced ? undefined : glide}
      style={[
        styles.rowWrap,
        // The fees row is set apart by a solid hairline (round 3: dashed and dotted mean simulated only).
        dotted && { borderColor: t.color.rule, marginTop: space.s8 },
        !dotted && { borderColor: open ? t.color.pod : "transparent" },
        // Open is a selection: a rounded card ringed in ballpoint indigo, never an ink box. Round 3: the ring is its
        // only edge (elevation is a border or a shadow, never both).
        dotted && open ? { borderColor: t.color.pod } : null,
        open ? { backgroundColor: t.color.plate } : null,
      ]}
    >
      <View
        collapsable={false}
        ref={(v) => {
          node.current = v;
          snap(v);
        }}
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
      </View>
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
          {/* MM-7 drawn as the equation (ADR-0016): each part, the operators between them, and the paid amount after
              the equals sign, on one line (round 5); the figures are the statement's own lines. */}
          <Equation terms={trace.terms} total={trace.total} />
          {/* The slips the line was weighed on (round 5: her receipts once a screen, in the one receipt-chip shape,
              each opening the slip itself): the statement's own slip row steps aside while this line is open. */}
          {dto.slips.length > 0 ? (
            <View testID="M-MB-01.trace.net.slips">
              <SlipTiles slips={dto.slips} owner={owner} onOpen={onSlip} testPrefix="M-MB-01.slip" />
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
      {/* Round 6: no bar above the rows. Each row carries its own key and amount; a strip repeating them said the
          same thing twice. */}
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
                // Round 5 (no ids for people): the deduction reads its words ("CBU") beside its figure; the rule's
                // id is spoken with the row, never shown.
                label={r.label ?? ""}
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
              // Round 6: a label is the label role at width 100, never the condensed figure cut.
              <View style={styles.feesLabel}>
                <Txt kind="label">{tr("M-MB-01.feesLabel")}</Txt>
                <Txt kind="caption" color="statementInk2">
                  {tr("M-MB-01.feesShort", { paypal: fees.paypal, gcash: fees.gcash })}
                </Txt>
              </View>
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
  /** The fees row's name over its two rates (round 7). */
  feesLabel: { gap: space.s2, flexShrink: 1 },
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
  // The legend key sits on the label's first line (body 17/24: 8 px above an 8 px square, round 5's one square).
  swatchSlot: { alignSelf: "flex-start", paddingTop: 8 },
  swatch: { width: 8, height: 8, borderRadius: 2, borderWidth: 1, overflow: "hidden" },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
  labelRow: { flexDirection: "row", alignItems: "center", gap: space.s8, flexWrap: "wrap" },
  trace: { gap: space.s12, paddingHorizontal: space.s8, paddingBottom: space.s16 },
  // The equation measured on one line where it takes no room and is never seen (as the hero amount is).
  measure: { position: "absolute", left: 0, top: 0, width: 0, height: 0, overflow: "hidden" },
  measureLine: { width: 1024, alignItems: "flex-start" },
  check: { flexDirection: "row", alignItems: "flex-start", gap: space.s8 },
  bolted: { flexDirection: "row", alignItems: "flex-start", gap: space.s8 },
  flex: { flex: 1 },
  total: { borderTopWidth: 2, marginTop: space.s4 },
});
