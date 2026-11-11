/**
 * A slip a line was weighed on, as data, not paper (UI gate round 4, the console's `ReceiptChip`): its serial in the
 * mono's id role at ink 3 and its verified kilos in ink with tabular figures, flat on a 1 px rule. No evidence red and
 * no ballpoint blue: those colours belong to the slip itself, which the zoom (MM-7) still shows as paper.
 */
import { StyleSheet, View } from "react-native";
import { radius, space, target } from "../_shims/tokens.native";
import { useFs } from "../theme/theme";
import { Txt } from "./text";

export function ReceiptChip({
  serial,
  kilos,
  width,
  framed = false,
}: {
  /** As printed: "No. 0403". */
  serial: string;
  /** The verified kilos, formatted: "38.45". */
  kilos: string;
  width?: number;
  /** The slip open in the zoom, or the one Paminawa names: a 1 px ink ring instead of the rule. */
  framed?: boolean;
}) {
  const { t } = useFs();
  return (
    <View
      style={[
        styles.chip,
        width ? { width } : null,
        { backgroundColor: t.color.plate, borderColor: framed ? t.color.ink : t.color.rule },
      ]}
    >
      <Txt kind="hash" color="ink3" numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {serial}
      </Txt>
      <Txt kind="figure" color="ink" numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {kilos}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: target.min,
    justifyContent: "center",
    gap: space.s2,
    paddingHorizontal: space.s8 + 2,
    paddingVertical: space.s4,
    borderWidth: 1,
    borderRadius: radius.cell,
  },
});
