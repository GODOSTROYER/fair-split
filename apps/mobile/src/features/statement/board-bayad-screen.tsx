/**
 * The board's Bayad tab (S1.8): Ernesto's own statement when the registry lists him as a member; otherwise the
 * run summary. The fixture registry does not list him, so this shows the run: PayPal payouts, the seal and the
 * Proof page where every payment can be verified.
 */

import { useEffect, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import type { CosignRequestDTO } from "../../_shims/api-client";
import { format } from "../../_shims/domain";
import { runSlug } from "../../_shims/seed";
import { radius, space } from "../../_shims/tokens.native";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { Screen } from "../../ui/chrome";
import { Button, Rule, SectionTitle } from "../../ui/primitives";
import { SealView } from "../../ui/seal-view";
import { Txt } from "../../ui/text";
import { useT } from "./use-t";

export function BoardBayadScreen() {
  const { api } = useApp();
  const { t } = useFs();
  const tr = useT();
  const [run, setRun] = useState<CosignRequestDTO | null>(null);
  useEffect(() => {
    void api.getCosignRequest(runSlug).then((r) => r.ok && setRun(r.value));
  }, [api]);
  if (!run)
    return (
      <Screen testID="M-MB-01" state="loading">
        {null}
      </Screen>
    );
  const origin = process.env.EXPO_PUBLIC_API_ORIGIN;
  const proofUrl =
    origin && origin !== "same-origin" ? `${origin}/proof/${run.runSlug}` : `/proof/${run.runSlug}`;
  return (
    <Screen testID="M-MB-01" state="run-summary">
      <Txt kind="title1" accessibilityRole="header">
        {tr("M-MB-01.season", { code: run.seasonCode })}
      </Txt>
      <View style={[styles.card, { backgroundColor: t.color.plate }]}>
        <Txt kind="label" color="ink2">
          {tr("M-MB-01.runItems")}
        </Txt>
        <Txt kind="amountHero">{format.usd(run.totalCents)}</Txt>
        <Txt kind="body" color="ink2">
          {tr("M-MB-01.runRequest", { season: run.seasonCode, n: run.itemCount })}
        </Txt>
        <Rule />
        <SectionTitle>{tr("M-MB-01.runItems")}</SectionTitle>
        {run.items.map((i) => (
          <View key={i.senderItemId} style={styles.item}>
            <Txt kind="figure" style={{ flex: 1 }}>
              {i.memberNo}
            </Txt>
            <Txt kind="figure">{format.usd(i.amountCents)}</Txt>
          </View>
        ))}
        <Rule />
        <View style={styles.sealRow}>
          <SealView
            batchSha256={run.batchSha256}
            size={72}
            keys={run.state === "signed" ? 2 : run.treasurerSigned ? 1 : 0}
            engrave={false}
          />
          <Txt kind="hash" color="ink2" style={{ flex: 1 }}>
            {format.hash(run.batchSha256, 4)}
          </Txt>
        </View>
      </View>
      <Button
        variant="tonal"
        icon="forward"
        label="Proof"
        onPress={() => void Linking.openURL(proofUrl)}
        testID="M-MB-01.proof"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.s16, gap: space.s12, borderRadius: radius.none },
  item: { flexDirection: "row", alignItems: "center", minHeight: 32 },
  sealRow: { flexDirection: "row", alignItems: "center", gap: space.s12 },
});
