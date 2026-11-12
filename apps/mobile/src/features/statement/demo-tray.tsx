/**
 * Demo controls (I8: labelled as simulated PayPal events). They drive the demo server along the hero line's real
 * paths, forward only, as PayPal and the officers would: approve and send, then PayPal confirms or parks it; a parked
 * item moves to cash at the bodega, and the clerk records it received. Only the next possible steps are offered,
 * because item statuses never move back (I5); "Back to checking" starts the demo over.
 */
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { radius, space } from "../../_shims/tokens.native";
import type { DemoController } from "../../services/demo-api";
import type { DemoStage } from "../../services/demo-fixtures";
import { useFs } from "../../theme/theme";
import { Glyph } from "../../ui/glyph";
import { Button } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import type { StatementKey } from "./messages";
import { useT } from "./use-t";

const NEXT: Readonly<Record<DemoStage, readonly DemoStage[]>> = {
  checking: ["sent"],
  sent: ["paid", "unclaimed"],
  paid: [],
  unclaimed: ["cash-due"],
  "cash-due": ["cash-received"],
  "cash-received": [],
};

const LABEL: Readonly<Record<DemoStage, StatementKey>> = {
  checking: "M-MB-01.demoReset",
  sent: "M-MB-01.demoSend",
  paid: "M-MB-01.demoConfirm",
  unclaimed: "M-MB-01.demoUnclaimed",
  "cash-due": "M-MB-01.demoCash",
  "cash-received": "M-MB-01.demoReceived",
};

export function DemoTray({ demo }: { demo: DemoController }) {
  const { t } = useFs();
  const tr = useT();
  const [stage, setStage] = useState<DemoStage>(() => demo.stage());
  useEffect(() => demo.subscribe(() => setStage(demo.stage())), [demo]);
  return (
    <View
      style={[styles.tray, { borderColor: t.color.rule }]}
      testID="M-MB-01.demo"
      dataSet={{ state: stage }}
    >
      <View style={styles.head}>
        <Glyph name="info" size={16} color={t.color.ink2} />
        <Txt kind="label" color="ink2" style={styles.flex}>
          {tr("M-MB-01.demoTitle")}
        </Txt>
      </View>
      <View style={styles.row}>
        {NEXT[stage].map((s) => (
          <Button
            key={s}
            variant="tonal"
            label={tr(LABEL[s])}
            onPress={() => demo.advance(s)}
            testID={`demo.${s}`}
          />
        ))}
        {stage !== "checking" ? (
          <Button
            variant="text"
            icon="refresh"
            label={tr(LABEL.checking)}
            onPress={() => demo.advance("checking")}
            testID="demo.reset"
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tray: {
    gap: space.s8,
    padding: space.s12,
    borderWidth: 1,
    // Dashed: the demo tray drives simulated data (the one place besides the honesty glyphs a dash belongs).
    borderStyle: "dashed",
    borderRadius: radius.card,
  },
  head: { flexDirection: "row", alignItems: "center", gap: space.s8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.s8 },
  flex: { flex: 1 },
});
