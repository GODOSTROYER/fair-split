/**
 * M-BD-02 Sign, the phone side of MM-5 "Two keys" (design D2, S2.9). A d3 jade slab "Pirmahi", 64 dp, in the thumb
 * zone: hold 1,200 ms (a tick at each quarter), then the fingerprint or device PIN, then an Ed25519 signature over
 * the JCS payload with `fs-ernesto-a1`; web frames sign with a labelled demo key. The outer two seal rings engrave
 * when the signature is accepted and the seal lands.
 * Phases (data-moment-phase): ready → hold-2 → biometric → signed-2 → sealed, or released-early / mismatch /
 * expired. Cancelled: the slab springs back and nothing is signed.
 */
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { format } from "../../_shims/domain";
import { people } from "../../_shims/seed";
import { holdMs, radius, space, target } from "../../_shims/tokens.native";
import { cosign } from "../../lib/signing";
import { feedback } from "../../platform/feedback";
import { type KeyMeta, keyVault } from "../../platform/key-vault";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { Screen } from "../../ui/chrome";
import { Banner, Button } from "../../ui/primitives";
import { SealView } from "../../ui/seal-view";
import { Slab } from "../../ui/slab";
import { Txt, useT } from "../../ui/text";
import { expectedFor, useCosign } from "./use-cosign";

type Phase =
  | "ready"
  | "hold-2"
  | "biometric"
  | "signed-2"
  | "sealed"
  | "released-early"
  | "cancelled"
  | "mismatch"
  | "expired"
  | "error"
  | "no-lock"
  | "invalidated";

export function SignScreen() {
  const { runSlug } = useLocalSearchParams<{ runSlug: string }>();
  const { api, session, online } = useApp();
  const { t } = useFs();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const { dto, payload, state, reload, markSigned } = useCosign(runSlug ?? "");
  const [phase, setPhase] = useState<Phase>("ready");
  const [attempt, setAttempt] = useState(0);
  const [meta, setMeta] = useState<KeyMeta | null>(null);
  const registered = useRef(new Set<string>());

  useEffect(() => {
    void keyVault.current().then(setMeta);
  }, []);
  useEffect(() => {
    if (state === "signed" && phase === "ready") setPhase("sealed");
    if (state === "changed") setPhase("mismatch");
    if (state === "expired") setPhase("expired");
  }, [state, phase]);

  const persona = (session?.persona ?? "board:ernesto").split(":")[1] ?? "ernesto";
  const season = dto?.seasonCode ?? "";
  const demoKey = keyVault.kind === "demo";

  const sign = async () => {
    if (!dto || !payload) return;
    setPhase("biometric");
    const prompt = tr("M-BD-02.prompt", { season });
    const key = await keyVault.ensureKey(persona, prompt);
    if ("error" in key) {
      setPhase(key.error === "no-lock" ? "no-lock" : key.error === "cancelled" ? "cancelled" : "error");
      setAttempt((a) => a + 1);
      return;
    }
    setMeta(key);
    if (!registered.current.has(key.keyId)) {
      const reg = await api.registerDeviceKey({
        keyId: key.keyId,
        publicKey: key.publicKeyHex,
        kind: demoKey ? "web_demo" : "app",
        biometricClass: key.biometricClass,
      });
      if (!reg.ok) {
        setPhase("error");
        setAttempt((a) => a + 1);
        return;
      }
      registered.current.add(key.keyId);
    }
    const result = await cosign(payload, expectedFor(dto), prompt, {
      signer: keyVault.signer(key, tr("common.cancel")),
      now: () => new Date(),
      submit: (body) => api.postApproval(dto.runSlug, body),
    });
    if (result.ok) {
      setPhase("signed-2");
      markSigned();
      setTimeout(() => {
        setPhase("sealed");
        feedback.play("seal.complete");
      }, 720);
      return;
    }
    if (result.state === "mismatch") {
      feedback.play("seal.mismatch");
      setPhase("mismatch");
    } else if (result.state === "cancelled") {
      setPhase(result.detail === "invalidated" ? "invalidated" : "cancelled");
    } else if (result.detail === "invalidated") {
      setPhase("invalidated");
    } else {
      setPhase(result.state === "expired" ? "expired" : "error");
    }
    setAttempt((a) => a + 1); // remount the slab so it springs back to rest
  };

  if (!dto)
    return (
      <Screen testID="M-BD-02" state="loading">
        {null}
      </Screen>
    );

  const keys: 0 | 1 | 2 = phase === "signed-2" || phase === "sealed" ? 2 : dto.treasurerSigned ? 1 : 0;
  const done = phase === "signed-2" || phase === "sealed";
  const blocked = !online
    ? tr("M-BD-01.offline")
    : phase === "mismatch" || phase === "expired" || !payload
      ? " "
      : undefined;
  const caption = demoKey
    ? tr("M-BD-02.captionDemo")
    : meta?.biometricClass === "pin-gated"
      ? tr("M-BD-02.captionPin")
      : tr("M-BD-02.caption");
  const amount = format.usd(dto.totalCents);
  const message: Partial<Record<Phase, string>> = {
    cancelled: tr("M-BD-02.cancelled"),
    mismatch: tr("M-BD-02.mismatch"),
    expired: tr("M-BD-01.expired", { name: people.treasurer.first }),
    error: tr("M-BD-02.error"),
    "no-lock": tr("M-BD-02.noLock"),
    invalidated: tr("M-BD-02.invalidated"),
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.color.ground }}>
      <Screen testID="M-BD-02" state={phase} contentStyle={{ paddingBottom: 220 }}>
        <View
          style={styles.markerWrap}
          testID="moment-MM-5"
          dataSet={{ moment: "MM-5", momentPhase: phase }}
          collapsable={false}
        >
          <View collapsable={false} testID={`moment-MM-5-phase-${phase}`} style={styles.marker} />
        </View>
        <Txt kind="title1" accessibilityRole="header">
          {tr("M-BD-02.title")}
        </Txt>
        <View style={[styles.card, { backgroundColor: t.color.plate }]}>
          <SealView batchSha256={dto.batchSha256} size={168} keys={keys} testID="M-BD-02.seal" />
          <Txt
            kind="amountHero"
            color={done ? "ink" : "pencil"}
            accessibilityLabel={format.amountSpoken(dto.totalCents)}
          >
            {amount}
          </Txt>
          <Txt kind="body" color="ink2" align="center">
            {tr("M-BD-01.request", { season, n: dto.itemCount })}
          </Txt>
          <Txt kind="hash" color="ink2">
            {`${format.hash(dto.batchSha256, 2)} … ${dto.batchSha256.slice(-8).replace(/(.{4})/, "$1 ")}`}
          </Txt>
        </View>
        {done ? (
          <Banner icon="check" testID="M-BD-02.signed">
            <Txt kind="bodyStrong">{tr("M-BD-02.signed", { key: meta?.keyId ?? "" })}</Txt>
            {phase === "sealed" ? (
              <Txt kind="body" color="ink2">
                {tr("M-BD-02.sealed", { a: people.treasurer.first, b: people.chair.first })}
              </Txt>
            ) : null}
          </Banner>
        ) : null}
        {message[phase] ? (
          <Banner tone="decide" icon="info" testID={`M-BD-02.${phase}`}>
            <Txt kind="body">{message[phase]}</Txt>
          </Banner>
        ) : null}
        <Txt kind="caption" color="ink2" testID="M-BD-02.key">
          {demoKey
            ? `${tr("M-BD-02.demoKey")}${meta ? `, ${meta.keyId}` : ""}`
            : tr("M-BD-02.deviceKey", { key: meta?.keyId ?? `fs-${persona}-a1` })}
        </Txt>
        {done ? (
          <Button variant="tonal" label={tr("common.back")} icon="back" onPress={() => router.back()} />
        ) : null}
        {phase === "mismatch" || phase === "expired" ? (
          <Button
            variant="tonal"
            icon="refresh"
            label={tr("common.tryAgain")}
            onPress={() => {
              setPhase("ready");
              void reload();
            }}
          />
        ) : null}
      </Screen>

      {!done ? (
        <View
          style={[
            styles.thumbZone,
            {
              paddingBottom: insets.bottom + space.s16,
              backgroundColor: t.color.ground,
              borderTopColor: t.color.rule,
            },
          ]}
        >
          <Slab
            key={attempt}
            testID="M-BD-02.slab"
            label={tr("M-BD-02.slab")}
            icon="fingerprint"
            depth="d3"
            tone="jade"
            hold={holdMs.phone}
            height={target.hero}
            unavailableReason={blocked}
            srLabel={tr("M-BD-02.srLabel", {
              label: tr("M-BD-02.slab"),
              amount: format.amountSpoken(dto.totalCents),
            })}
            onHoldChange={(h) => setPhase((p) => (h ? "hold-2" : p === "hold-2" ? "released-early" : p))}
            onCommit={() => void sign()}
            holdUntilLabel={tr("M-BD-02.holdUntil")}
            anotherWayLabel={tr("M-BD-02.another")}
            confirm={{
              title: tr("M-BD-02.confirmTitle"),
              body: tr("M-BD-02.confirmBody", { n: dto.itemCount, amount }),
              confirmLabel: tr("M-BD-02.confirmSign"),
              cancelLabel: tr("common.cancel"),
            }}
          />
          <Txt kind="body" color="ink2" align="center" style={{ marginTop: space.s8 }}>
            {caption}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  markerWrap: { position: "absolute", width: 1, height: 1 },
  marker: { width: 1, height: 1, opacity: 0 },
  card: { padding: space.s16, gap: space.s12, alignItems: "center", borderRadius: radius.none },
  thumbZone: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.s16,
    paddingTop: space.s16,
    borderTopWidth: 1,
  },
});
