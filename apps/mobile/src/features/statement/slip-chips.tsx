import { useRef } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import type { StatementSlip } from "../../_shims/api-client";
import { format } from "../../_shims/domain";
import { space } from "../../_shims/tokens.native";
import { Chip } from "../../ui/primitives";
import { useT } from "../../ui/text";

/** Slip chips that report where they were tapped, so MM-7 can zoom about the tap point. */
export function SlipChips({
  slips,
  onOpen,
  testPrefix,
}: {
  slips: readonly StatementSlip[];
  onOpen(serial: string, at: { x: number; y: number }): void;
  testPrefix: string;
}) {
  const tr = useT();
  const refs = useRef<Record<string, ViewInstance | null>>({});
  const open = (serial: string) => {
    const node = refs.current[serial];
    if (!node) return onOpen(serial, { x: 0, y: 0 });
    node.measureInWindow((x, y, w, h) => onOpen(serial, { x: x + w / 2, y: y + h / 2 }));
  };
  return (
    <View style={styles.row}>
      {slips.map((s) => (
        <View
          key={s.serial}
          collapsable={false}
          ref={(r) => {
            refs.current[s.serial] = r;
          }}
        >
          <Chip
            icon="slip"
            label={s.serial}
            testID={`${testPrefix}.${s.serial}`}
            accessibilityLabel={`${tr("M-MB-02.slip", { serial: s.serial })}, ${format.kg(s.netGrams, 2)}`}
            onPress={() => open(s.serial)}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: "row", flexWrap: "wrap", gap: space.s8 } });
