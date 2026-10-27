/**
 * The Pirma tab's front door, where a board phone lands after pairing: it asks the candidate runs (`open-run.ts`)
 * and opens the request that is waiting for the Chair, or says there is nothing to sign, that there is no signal, or
 * that it could not ask. It never opens a run just because the seed names it.
 */
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { runSlug as seedRun } from "../../_shims/seed";
import { space } from "../../_shims/tokens.native";
import { prefs } from "../../platform/kv";
import { pirmaHref } from "../../services/session";
import { useApp } from "../../state/app";
import { Screen } from "../../ui/chrome";
import { Banner, Button } from "../../ui/primitives";
import { EmptyState, Skeleton } from "../../ui/states";
import { Txt } from "../../ui/text";
import {
  LAST_RUN_KEY,
  type PirmaTarget,
  parseRememberedRun,
  pickTarget,
  probeRequest,
  type RunProbe,
  runCandidates,
} from "./open-run";
import { PushNote } from "./parts";
import { useT } from "./use-t";

export function PirmaIndexScreen() {
  const { api, session } = useApp();
  const tr = useT();
  const [target, setTarget] = useState<PirmaTarget | null>(null);
  const [round, setRound] = useState(0);
  const ws = session?.workspaceId ?? null;

  useEffect(() => {
    let alive = true;
    setTarget(null);
    void (async () => {
      const remembered = parseRememberedRun(await prefs.get(LAST_RUN_KEY), ws);
      const probes: { runSlug: string; probe: RunProbe }[] = [];
      for (const runSlug of runCandidates(remembered, seedRun)) {
        const probe = probeRequest(await api.getCosignRequest(runSlug), Date.now());
        probes.push({ runSlug, probe });
        if (probe === "open" || probe === "offline") break;
      }
      if (alive) setTarget(pickTarget(probes));
    })().catch(() => alive && setTarget({ kind: "error" }));
    return () => {
      alive = false;
    };
  }, [api, ws, round]);

  if (target?.kind === "open") return <Redirect href={pirmaHref(target.runSlug)} />;

  const retry = (
    <Button
      variant="tonal"
      icon="refresh"
      label={tr("common.tryAgain")}
      onPress={() => setRound((r) => r + 1)}
      testID="M-BD-01.retry"
    />
  );

  return (
    <Screen testID="M-BD-01" state={target ? target.kind : "loading"}>
      {target === null ? (
        <View style={styles.loading}>
          <Skeleton lines={1} block={52} />
          <Skeleton lines={3} />
        </View>
      ) : target.kind === "none" ? (
        <EmptyState
          glyph="sign"
          title={tr("M-BD-01.none")}
          body={tr("M-BD-01.noneBody")}
          testID="M-BD-01.none"
          action={retry}
        />
      ) : (
        <Banner
          tone={target.kind === "offline" ? "neutral" : "decide"}
          icon={target.kind === "offline" ? "wifiOff" : "info"}
          testID={`M-BD-01.${target.kind}`}
          action={retry}
        >
          <Txt kind="bodyStrong">{tr(target.kind === "offline" ? "common.offline" : "M-BD-01.error")}</Txt>
          <Txt kind="body" color="ink2">
            {tr(target.kind === "offline" ? "M-BD-01.offline" : "common.error")}
          </Txt>
        </Banner>
      )}
      <PushNote />
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { gap: space.s24 },
});
