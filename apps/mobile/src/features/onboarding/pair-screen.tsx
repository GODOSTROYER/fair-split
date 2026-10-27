/**
 * M-ON-01 pairing (S1.9, design A0): "Pangayo sa treasurer sa inyong QR." The treasurer's QR binds this phone to a
 * role and a workspace, once, for 10 minutes. On the phone the camera scans it; with the camera denied, or on the
 * web, the 6-digit code under the QR does the same (WCAG 3.3.8: no step asks for re-entry). A judge's phone opens
 * the QR's link (`/app/pair?t=…`) straight into this screen. Members then answer one question, read or listen first,
 * stored on this phone and never inferred.
 * States: idle, camera-denied, pairing, paired, listen-choice, expired, used, invalid, offline, error.
 */
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import type { AppRole } from "../../_shims/contracts";
import { runSlug } from "../../_shims/seed";
import { radius, space } from "../../_shims/tokens.native";
import { claimPairing, type PairingOutcome, parsePairingInput } from "../../lib/pairing";
import { feedback } from "../../platform/feedback";
import { BUILD } from "../../services/build";
import { demoSession } from "../../services/demo-api";
import { homeHref, type PairedSession } from "../../services/session";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { announce } from "../../ui/a11y";
import { Screen } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { Banner, Button, InkStamp } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import { afterPairing, firstLanguage, type PairState, pairScreenState } from "./flow";
import { ListenChoice } from "./listen-choice";
import type { OnboardingKey } from "./messages";
import { CodeInput } from "./parts";
import { useT } from "./use-t";

const MESSAGE: Partial<Record<PairState, OnboardingKey>> = {
  expired: "M-ON-01.pair.expired",
  used: "M-ON-01.pair.used",
  invalid: "M-ON-01.pair.invalid",
  offline: "M-ON-01.pair.offline",
  error: "M-ON-01.pair.error",
};

const ROLE_WORD: Readonly<Record<AppRole, OnboardingKey>> = {
  member: "role.member",
  board: "role.board",
  clerk: "role.clerk",
};

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter((p) => /^[A-Za-zÑñ]/.test(p) && !p.endsWith("."));
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

function browserLocale(): string | null {
  return typeof navigator !== "undefined" && typeof navigator.language === "string"
    ? navigator.language
    : null;
}

export function PairScreen({ initialToken }: { initialToken?: string }) {
  const { api, demo, setSession, session, onboarded, completeOnboarding, setLang, listenFirst } = useApp();
  const { t } = useFs();
  const tr = useT();
  const { width } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<PairState>("idle");
  const [code, setCode] = useState("");
  const [paired, setPaired] = useState<PairedSession | null>(null);
  const [choosing, setChoosing] = useState(false);
  const busy = useRef(false);
  const native = Platform.OS !== "web";

  const finish = (outcome: PairingOutcome) => {
    if (!outcome.ok) {
      busy.current = false;
      setCode("");
      setState(outcome.state);
      announce(tr(MESSAGE[outcome.state] ?? "M-ON-01.pair.error"));
      return;
    }
    const s = outcome.session;
    // A phone that never chose a language (a judge opening the QR link) starts in the registry's or browser's.
    if (!onboarded) {
      const l = firstLanguage(s.lang, browserLocale());
      if (l) setLang(l);
      completeOnboarding();
    }
    setSession(s);
    setPaired(s);
    setState("paired");
    feedback.play("slip.captured");
    announce(tr("M-ON-01.pair.paired", { role: tr(ROLE_WORD[s.role]) }));
    if (afterPairing(s.role, listenFirst) === "listen-choice") setChoosing(true);
  };

  const tryInput = async (raw: string) => {
    if (busy.current) return;
    const input = parsePairingInput(raw);
    if (input.kind === "invalid") {
      setCode("");
      setState("invalid");
      return;
    }
    busy.current = true;
    setState("pairing");
    finish(
      await claimPairing(input, {
        claim: api.claimPairing,
        device: { platform: BUILD.platform, appVersion: BUILD.version },
        now: () => new Date(),
      }),
    );
  };

  // The QR's link (`/app/pair?t=…`, `fairsplit://pair?t=…`) arrives with its token: claim it once.
  const claimed = useRef(false);
  useEffect(() => {
    if (initialToken && !claimed.current) {
      claimed.current = true;
      void tryInput(initialToken);
    }
  });

  // Already paired and nothing to do here: go home.
  useEffect(() => {
    if (session && state === "idle" && !initialToken) router.replace("/");
  }, [session, state, initialToken]);

  const goHome = () => {
    const s = paired ?? session;
    router.replace(s ? homeHref(s.role, runSlug) : "/");
  };

  const cameraDenied = native && permission?.granted === false && permission.canAskAgain === false;
  const screenState = pairScreenState({ state, cameraDenied, listenChoice: choosing });

  if (choosing) {
    return <ListenChoice onDone={goHome} />;
  }

  const message = MESSAGE[state];
  const finder = Math.min(width - 2 * space.s16, 360);
  const working = state === "pairing" || state === "paired";

  return (
    <Screen testID="M-ON-01" state={screenState}>
      <View style={styles.lead}>
        <Txt kind="title1" accessibilityRole="header">
          {tr("M-ON-01.pair.title")}
        </Txt>
        <Txt kind="body" color="ink2">
          {tr(native ? "M-ON-01.pair.scanHint" : "M-ON-01.pair.scanWeb")}
        </Txt>
      </View>

      {state === "paired" && paired ? (
        <View
          style={[styles.paired, { backgroundColor: t.color.plate, borderColor: t.color.ink }]}
          testID="M-ON-01.paired"
          accessibilityLiveRegion="polite"
        >
          <View style={styles.pairedHead}>
            <Glyph name="check" color={t.color.ink} />
            <Txt kind="title2" style={styles.flex}>
              {tr("M-ON-01.pair.paired", { role: tr(ROLE_WORD[paired.role]) })}
            </Txt>
          </View>
          {paired.displayName ? (
            <View style={styles.who}>
              <InkStamp initials={initialsOf(paired.displayName)} />
              <Txt kind="bodyStrong">{paired.displayName}</Txt>
            </View>
          ) : null}
          <Button tall label={tr("M-ON-01.continue")} onPress={goHome} testID="M-ON-01.continue" />
        </View>
      ) : null}

      {native && !cameraDenied && state !== "paired" ? (
        <View
          style={[styles.viewfinder, { width: finder, height: finder, backgroundColor: t.color.ink }]}
          testID="M-ON-01.viewfinder"
        >
          {permission?.granted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={working ? undefined : (r) => void tryInput(r.data)}
            />
          ) : (
            <View style={styles.permission}>
              <Glyph name="qr" size={48} color={t.color.plate} />
              <Txt kind="body" align="center" style={{ color: t.color.plate }}>
                {tr("M-ON-01.pair.cameraNeeded")}
              </Txt>
              <Button
                variant="tonal"
                icon="camera"
                label={tr("M-ON-01.pair.allowCamera")}
                onPress={() => void requestPermission()}
                testID="M-ON-01.allow-camera"
              />
            </View>
          )}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {(["tl", "tr", "bl", "br"] as const).map((corner) => (
              <View
                key={corner}
                style={[
                  styles.corner,
                  {
                    borderColor: t.color.plate,
                    top: corner[0] === "t" ? space.s24 : undefined,
                    bottom: corner[0] === "b" ? space.s24 : undefined,
                    left: corner[1] === "l" ? space.s24 : undefined,
                    right: corner[1] === "r" ? space.s24 : undefined,
                    borderTopWidth: corner[0] === "t" ? 3 : 0,
                    borderBottomWidth: corner[0] === "b" ? 3 : 0,
                    borderLeftWidth: corner[1] === "l" ? 3 : 0,
                    borderRightWidth: corner[1] === "r" ? 3 : 0,
                  },
                ]}
              />
            ))}
          </View>
          {state === "pairing" ? (
            <View style={[StyleSheet.absoluteFill, styles.scrim, { backgroundColor: t.color.scrim }]}>
              <Txt kind="bodyStrong" style={{ color: t.color.plate }}>
                {tr("M-ON-01.pair.pairing")}
              </Txt>
            </View>
          ) : null}
        </View>
      ) : null}

      {cameraDenied && state !== "paired" ? (
        <Banner
          tone="decide"
          icon="camera"
          testID="M-ON-01.camera-denied"
          action={
            <Button
              variant="text"
              label={tr("M-ON-01.pair.openSettings")}
              onPress={() => void Linking.openSettings().catch(() => {})}
            />
          }
        >
          <Txt kind="body">{tr("M-ON-01.pair.cameraDenied")}</Txt>
        </Banner>
      ) : null}

      {message ? (
        <Banner tone="decide" icon="info" testID={`M-ON-01.${state}`}>
          <Txt kind="body">{tr(message)}</Txt>
        </Banner>
      ) : null}

      {state !== "paired" ? (
        <View style={styles.code}>
          <Txt kind="label" color="ink2">
            {tr("M-ON-01.pair.codeLabel")}
          </Txt>
          <CodeInput
            value={code}
            onChange={(v) => {
              setCode(v);
              if (state !== "pairing" && state !== "idle") setState("idle");
            }}
            onComplete={(v) => void tryInput(v)}
            disabled={state === "pairing"}
            label={tr("M-ON-01.pair.codeA11y", { n: code.length })}
            testID="M-ON-01.code"
          />
          <Button
            tall
            label={tr("M-ON-01.pair.codeAction")}
            disabled={code.length !== 6 || state === "pairing"}
            onPress={() => void tryInput(code)}
            testID="M-ON-01.pair"
          />
          {state === "pairing" ? (
            <Txt kind="body" color="ink2" accessibilityLiveRegion="polite" testID="M-ON-01.pairing">
              {tr("M-ON-01.pair.pairing")}
            </Txt>
          ) : null}
        </View>
      ) : null}

      {demo && state !== "paired" ? (
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
  flex: { flex: 1 },
  lead: { gap: space.s8 },
  viewfinder: { alignSelf: "center", borderRadius: radius.none, overflow: "hidden" },
  permission: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.s16, padding: space.s24 },
  corner: { position: "absolute", width: 40, height: 40 },
  scrim: { alignItems: "center", justifyContent: "center" },
  code: { gap: space.s12 },
  paired: { gap: space.s16, padding: space.s16, borderWidth: 2, borderRadius: radius.plate },
  pairedHead: { flexDirection: "row", alignItems: "center", gap: space.s8 },
  who: { flexDirection: "row", alignItems: "center", gap: space.s8 },
  demo: {
    gap: space.s8,
    padding: space.s16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radius.plate,
  },
});
