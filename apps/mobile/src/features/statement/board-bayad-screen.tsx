/**
 * The board's Bayad tab (register §4 reuses the member's Bayad; S1.9): the Chair's own statement when the registry
 * lists him as a member, otherwise the run he co-signed. The fixture registry does not list Ernesto, so this shows the
 * run: the PayPal payouts, the seal with how many keys have closed it, and the Proof page where anyone can check
 * every payment. Read only; nothing here moves money. Its figures keep the amount grammar (`runAmountState`): pencil
 * until both keys are in, then ink, as the Chair sees the same figures on M-BD-01.
 *
 * UI gate round 2: full-bleed on white like the member's statement, and the PayPal payouts carry the one honesty
 * tag under the line that names them.
 */
import { useCallback, useEffect, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import type { CosignRequestDTO } from "../../_shims/api-client";
import { format } from "../../_shims/domain";
import { runSlug } from "../../_shims/seed";
import { space } from "../../_shims/tokens.native";
import { seasonLabel } from "../../lib/display";
import { railLabel } from "../../lib/payout-status";
import { apiOrigin } from "../../services/build";
import { useApp } from "../../state/app";
import { AmountDisplay } from "../../ui/amount";
import { Screen } from "../../ui/chrome";
import { MicroTag } from "../../ui/honesty";
import { Button, HashText, Rule, SectionTitle } from "../../ui/primitives";
import { SealView } from "../../ui/seal-view";
import { EmptyState, Skeleton } from "../../ui/states";
import { Txt } from "../../ui/text";
import { runAmountState } from "./line-view";
import { COLUMN } from "./parts";
import { useT } from "./use-t";

export function BoardBayadScreen() {
  const { api, lang } = useApp();
  const tr = useT();
  const [run, setRun] = useState<CosignRequestDTO | null>(null);
  const [failed, setFailed] = useState(false);
  // TEMPORARY: the board's run comes from the co-sign push or the workspace feed once WS-API lands (as app/index).
  const load = useCallback(async () => {
    setFailed(false);
    const r = await api.getCosignRequest(runSlug);
    if (r.ok) setRun(r.value);
    else setFailed(true);
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!run) {
    return (
      <Screen testID="M-MB-01" state={failed ? "error" : "loading"} contentStyle={COLUMN} surface="plate">
        {failed ? (
          <EmptyState
            glyph="wifiOff"
            title={tr("M-MB-01.loadFailed")}
            body={tr("M-MB-01.loadFailedBody")}
            action={
              <Button
                variant="tonal"
                icon="refresh"
                label={tr("common.tryAgain")}
                onPress={() => void load()}
              />
            }
          />
        ) : (
          <Skeleton lines={5} block={64} />
        )}
      </Screen>
    );
  }

  const keys = run.state === "signed" ? 2 : run.treasurerSigned ? 1 : 0;
  const amountState = runAmountState(run);
  const origin = apiOrigin();
  const proofUrl = `${origin ?? ""}/proof/${run.runSlug}`;
  return (
    <Screen testID="M-MB-01" state="run-summary" contentStyle={COLUMN} surface="plate">
      <Txt kind="title1" accessibilityRole="header">
        {tr("M-MB-01.season", { code: seasonLabel(run.seasonCode) })}
      </Txt>
      <View style={styles.card}>
        <AmountDisplay
          size="l"
          text={format.usd(run.totalCents)}
          srLabel={format.amountSpoken(run.totalCents)}
          state={amountState}
          testID="M-MB-01.runTotal"
        />
        <Txt kind="body" color="ink2">
          {tr("M-MB-01.runRequest", { season: seasonLabel(run.seasonCode), n: run.itemCount })}
        </Txt>
        {run.rail === "simulated" ? (
          <MicroTag testID="M-MB-01.runRail" label={railLabel(run.rail, "simulated_rail", lang).chip} />
        ) : null}
        <Rule />
        <SectionTitle>{tr("M-MB-01.runItems")}</SectionTitle>
        <View style={styles.items}>
          {run.items.map((i) => (
            <View key={i.senderItemId} style={styles.item}>
              <Txt
                kind="figure"
                style={styles.flex}
                importantForAccessibility="no"
                accessibilityElementsHidden
                aria-hidden
              >
                {i.memberNo}
              </Txt>
              <AmountDisplay
                size="figure"
                text={format.usd(i.amountCents)}
                srLabel={`${i.memberNo}, ${format.amountSpoken(i.amountCents)}`}
                state={amountState}
                testID={`M-MB-01.runItem.${i.memberNo}`}
              />
            </View>
          ))}
        </View>
        <Rule />
        <View style={styles.sealRow}>
          <SealView batchSha256={run.batchSha256} size={72} keys={keys} engrave={false} />
          <View style={styles.flex}>
            <Txt kind="bodyStrong">{keys === 2 ? tr("M-MB-01.runSigned") : tr("M-MB-01.runWaiting")}</Txt>
            <HashText hex={run.batchSha256} groups={4} />
          </View>
        </View>
      </View>
      <View style={styles.proof}>
        <Button
          variant="tonal"
          icon="forward"
          label={tr("M-MB-01.proof")}
          onPress={() => void Linking.openURL(proofUrl)}
          testID="M-MB-01.proof"
        />
        <Txt kind="caption" color="ink2">
          {tr("M-MB-01.proofHint")}
        </Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.s12 },
  items: { gap: space.s4 },
  item: { flexDirection: "row", alignItems: "center", minHeight: 32 },
  sealRow: { flexDirection: "row", alignItems: "center", gap: space.s12 },
  proof: { gap: space.s8, alignItems: "flex-start" },
  flex: { flex: 1 },
});
