/**
 * M-ON-01 pairing: "Pangayo sa treasurer sa inyong QR." The QR binds this phone to a role and workspace
 * (single use, 10 minutes). Camera denied: the 6-digit code (WCAG 3.3.8). States: camera-denied, expired, paired.
 */
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, TextInput, View } from "react-native";

import { runSlug } from "../../_shims/seed";
import { radius, space, target } from "../../_shims/tokens.native";
import { claimPairing, type PairingOutcome, parsePairingInput } from "../../lib/pairing";
import { feedback } from "../../platform/feedback";
import { demoSession } from "../../services/demo-api";
import { homeHref } from "../../services/session";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { Screen } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { Banner, Button } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import type { OnboardingKey } from "./messages";
import { useT } from "./use-t";

type PairState = "idle" | "pairing" | "paired" | "expired" | "used" | "invalid" | "offline" | "error";

const MESSAGE: Partial<Record<PairState, OnboardingKey>> = {
  expired: "M-ON-01.pair.expired",
  used: "M-ON-01.pair.used",
  invalid: "M-ON-01.pair.invalid",
  offline: "M-ON-01.pair.offline",
  error: "M-ON-01.pair.error",
};

export function PairScreen({ initialToken }: { initialToken?: string }) {
  const { api, demo, setSession, session } = useApp();
  const { t } = useFs();
  const tr = useT();
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<PairState>("idle");
  const [code, setCode] = useState("");
  const busy = useRef(false);
  const native = Platform.OS !== "web";

  const finish = (outcome: PairingOutcome) => {
    if (outcome.ok) {
      setSession(outcome.session);
      setState("paired");
      feedback.play("slip.captured");
      setTimeout(() => router.replace(homeHref(outcome.session.role, runSlug)), 700);
    } else {
      setState(outcome.state);
      busy.current = false;
    }
  };

  const tryInput = async (raw: string) => {
    if (busy.current) return;
    const input = parsePairingInput(raw);
    if (input.kind === "invalid") {
      setState("invalid");
      return;
    }
    busy.current = true;
    setState("pairing");
    finish(
      await claimPairing(input, {
        claim: api.claimPairing,
        device: { platform: native ? (Platform.OS as "android" | "ios") : "web", appVersion: "0.1.0" },
        now: () => new Date(),
      }),
    );
  };

  useEffect(() => {
    if (initialToken) void tryInput(initialToken);
  }, [initialToken]);

  useEffect(() => {
    if (session && state === "idle" && !initialToken) router.replace("/");
  }, [session, state, initialToken]);

  const cameraDenied = native && permission?.granted === false && permission.canAskAgain === false;
  const message = MESSAGE[state];
  const roleWord = session ? tr(`role.${session.role}` as OnboardingKey) : "";

  return (
    <Screen testID="M-ON-01" state={cameraDenied && state === "idle" ? "camera-denied" : state}>
      <Txt kind="title1" accessibilityRole="header">
        {tr("M-ON-01.pair.title")}
      </Txt>

      {native && !cameraDenied ? (
        <View style={[styles.viewfinder, { borderColor: t.color.rule, backgroundColor: t.color.ink }]}>
          {permission?.granted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={
                state === "pairing" || state === "paired" ? undefined : (r) => void tryInput(r.data)
              }
            />
          ) : (
            <View style={styles.permission}>
              <Glyph name="qr" size={48} color={t.color.plate} />
              <Button
                variant="tonal"
                label={tr("M-ON-01.pair.allowCamera")}
                onPress={() => void requestPermission()}
              />
            </View>
          )}
          <View pointerEvents="none" style={styles.corners}>
            {(["tl", "tr", "bl", "br"] as const).map((c) => (
              <View
                key={c}
                style={[
                  styles.corner,
                  {
                    borderColor: t.color.plate,
                    top: c[0] === "t" ? 16 : undefined,
                    bottom: c[0] === "b" ? 16 : undefined,
                    left: c[1] === "l" ? 16 : undefined,
                    right: c[1] === "r" ? 16 : undefined,
                    borderTopWidth: c[0] === "t" ? 3 : 0,
                    borderBottomWidth: c[0] === "b" ? 3 : 0,
                    borderLeftWidth: c[1] === "l" ? 3 : 0,
                    borderRightWidth: c[1] === "r" ? 3 : 0,
                  },
                ]}
              />
            ))}
          </View>
        </View>
      ) : null}
      {native && !cameraDenied ? (
        <Txt kind="body" color="ink2">
          {tr("M-ON-01.pair.scanHint")}
        </Txt>
      ) : null}
      {cameraDenied ? (
        <Banner tone="decide" icon="camera" testID="M-ON-01.camera-denied">
          <Txt kind="body">{tr("M-ON-01.pair.cameraDenied")}</Txt>
        </Banner>
      ) : null}

      <View style={{ gap: space.s8 }}>
        <Txt kind="label" color="ink2" nativeID="code-label">
          {tr("M-ON-01.pair.codeLabel")}
        </Txt>
        <TextInput
          testID="M-ON-01.code"
          accessibilityLabelledBy="code-label"
          accessibilityLabel={tr("M-ON-01.pair.codeLabel")}
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          placeholder="000000"
          placeholderTextColor={t.color.ink3}
          onSubmitEditing={() => void tryInput(code)}
          style={[
            styles.code,
            {
              color: t.color.ink,
              borderColor: t.color.ink2,
              backgroundColor: t.color.plate,
              fontFamily: "MonaSans_500Medium",
            },
          ]}
        />
        <Button
          tall
          label={tr("M-ON-01.pair.codeAction")}
          disabled={code.length !== 6 || state === "pairing"}
          onPress={() => void tryInput(code)}
          testID="M-ON-01.pair"
        />
      </View>

      {state === "pairing" ? (
        <Txt kind="body" color="ink2" accessibilityLiveRegion="polite">
          {tr("M-ON-01.pair.pairing")}
        </Txt>
      ) : null}
      {state === "paired" ? (
        <Banner icon="check" testID="M-ON-01.paired">
          <Txt kind="bodyStrong">{tr("M-ON-01.pair.paired", { role: roleWord })}</Txt>
        </Banner>
      ) : null}
      {message ? (
        <Banner tone="decide" icon="info" testID={`M-ON-01.${state}`}>
          <Txt kind="body">{tr(message)}</Txt>
        </Banner>
      ) : null}

      {demo ? (
        <View style={[styles.demo, { borderColor: t.color.rule }]} testID="M-ON-01.demo">
          <Txt kind="body" color="ink2">
            {tr("M-ON-01.pair.demoTitle")}
          </Txt>
          {(["member", "board", "clerk"] as const).map((role) => (
            <Button
              key={role}
              variant="tonal"
              label={tr(
                role === "member"
                  ? "M-ON-01.pair.demoMember"
                  : role === "board"
                    ? "M-ON-01.pair.demoBoard"
                    : "M-ON-01.pair.demoClerk",
              )}
              testID={`M-ON-01.demo.${role}`}
              onPress={() => finish({ ok: true, session: demoSession(role, new Date()) })}
            />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  viewfinder: {
    width: "100%",
    aspectRatio: 1,
    maxWidth: 420,
    alignSelf: "center",
    borderWidth: 1,
    borderRadius: radius.none,
    overflow: "hidden",
  },
  permission: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.s16 },
  corners: { ...StyleSheet.absoluteFill },
  corner: { position: "absolute", width: 36, height: 36 },
  code: {
    minHeight: target.primary,
    borderWidth: 2,
    borderRadius: radius.plate,
    paddingHorizontal: space.s16,
    fontSize: 28,
    letterSpacing: 8,
    fontVariant: ["tabular-nums"],
  },
  demo: {
    gap: space.s8,
    padding: space.s16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radius.plate,
  },
});
