/**
 * Today, at a glance (M-CL-01): one ring per slip scanned today, oldest first, so when signal returns the clerk
 * watches them close left to right, the moment he knows his work arrived (design §1, Jessie's peak). The sentence
 * under the rings says the same in words; the rings themselves are hidden from screen readers.
 */
import { StyleSheet, View } from "react-native";
import { radius, space } from "../../_shims/tokens.native";
import type { CaptureRecord } from "../../lib/outbox";
import { useFs } from "../../theme/theme";
import { SectionTitle } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import { tallyOf } from "./capture-view";
import { pluralKey } from "./messages";
import { CaptureRing } from "./ring";
import { useT } from "./use-t";

const RING = 28;

export function TodayTally({ records, now }: { records: readonly CaptureRecord[]; now: number }) {
  const { t } = useFs();
  const tr = useT();
  const tally = tallyOf(records, now);
  const { total, sent, onPhone } = tally.counts;
  const sentence =
    total === 0
      ? tr("M-CL-01.tallyEmpty")
      : tr(pluralKey("M-CL-01.tally", total), { n: total, sent, phone: onPhone });
  return (
    <View
      testID="M-CL-01.tally"
      dataSet={{ total, sent, onPhone }}
      style={[styles.plate, { backgroundColor: t.color.plate }]}
    >
      <SectionTitle>{tr("M-CL-01.today")}</SectionTitle>
      {total > 0 ? (
        <View
          style={styles.rings}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          {tally.hidden > 0 ? (
            <View style={[styles.more, { borderColor: t.color.rule }]}>
              <Txt kind="caption" color="ink2" maxFontSizeMultiplier={1.3}>
                {tr("M-CL-01.tallyMore", { n: tally.hidden })}
              </Txt>
            </View>
          ) : null}
          {tally.rings.map((r) => (
            <CaptureRing key={r.id} tone={r.tone} progress={r.progress} size={RING} />
          ))}
        </View>
      ) : null}
      <Txt
        kind={total > 0 ? "bodyStrong" : "body"}
        color={total > 0 ? "ink" : "ink2"}
        testID="M-CL-01.tally.text"
      >
        {sentence}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  plate: { padding: space.s16, gap: space.s12, borderRadius: radius.plate },
  rings: { flexDirection: "row", flexWrap: "wrap", gap: space.s8, alignItems: "center" },
  more: {
    minWidth: RING,
    height: RING,
    paddingHorizontal: space.s4,
    borderWidth: 1,
    borderRadius: RING / 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
