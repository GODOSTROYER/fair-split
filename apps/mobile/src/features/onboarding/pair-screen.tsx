/**
 * M-ON-01 pairing (S1.9, design A0): "Pangayo sa treasurer sa inyong QR." The treasurer's QR binds this phone to a
 * role and a workspace, once, for 10 minutes. The screen is that card: a sheet of paper on the tablea desk with the
 * QR where the treasurer's QR is printed and the six digits under it. On the phone the camera looks through the QR's
 * place; with the camera denied, or on the web, the 6-digit code does the same (WCAG 3.3.8: no step asks for
 * re-entry). A judge's phone opens the QR's link (`/app/pair?t=…`) straight into this screen. When the claim is
 * accepted, an ink stamp with the person's initials lands on the card. Members then answer one question, read or
 * listen first, stored on this phone and never inferred.
 *
 * The camera reads the QR in front of it many times a second: a code is claimed once, a refused code is never sent
 * again by itself (`shouldClaimScan`), and "Scan again" or a different QR starts over.
 * States: idle, camera-denied, pairing, paired, listen-choice, expired, used, invalid, offline, error.
 */
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import type { AppRole } from "../../_shims/contracts";
import { season } from "../../_shims/seed";
import { space } from "../../_shims/tokens.native";
import { claimPairing, type PairingOutcome, parsePairingInput } from "../../lib/pairing";
import { feedback } from "../../platform/feedback";
import { BUILD } from "../../services/build";
import { demoSession } from "../../services/demo-api";
import { homeHref, type PairedSession } from "../../services/session";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { announce } from "../../ui/a11y";
import { Screen } from "../../ui/chrome";
import { Banner, Button, Rule } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import {
  afterPairing,
  firstLanguage,
  type PairState,
  pairScreenState,
  QR_CELLS,
  scanRefused,
  shouldClaimScan,
  stampInitials,
} from "./flow";
import { ListenChoice } from "./listen-choice";
import type { OnboardingKey } from "./messages";
import { COLUMN, CodeInput, Desk, FinderGuide, PairStamp, Paper, QrFacsimile, StencilMark } from "./parts";
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

/** The QR's place on the card: as wide as the card allows, never wider than a phone's comfortable aim. */
const QR_MAX = 280;
/** The printed QR on the card (web, or before the camera is allowed): QR-sized, so the code under it stays in view. */
const FACSIMILE_MAX = 150;
/** The card is card-sized on any window: a judge's laptop shows the same card as a phone. */
const CARD_MAX = 360;

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
  /** The last code the camera read and claimed: the same QR, still in view, is never claimed again by itself. */
  const lastScan = useRef<string | null>(null);
  const [scanned, setScanned] = useState(false);
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

  const onScan = (data: string) => {
    if (!shouldClaimScan(lastScan.current, data, busy.current ? "pairing" : state)) return;
    lastScan.current = data;
    setScanned(true);
    void tryInput(data);
  };

  const scanAgain = () => {
    lastScan.current = null;
    setScanned(false);
    setState("idle");
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

  // The board lands on the Pirma tab, which finds the request that is actually open (never a fixture's run).
  const goHome = () => {
    const s = paired ?? session;
    router.replace(s ? homeHref(s.role, null) : "/");
  };

  const cameraDenied = native && permission?.granted === false && permission.canAskAgain === false;
  const screenState = pairScreenState({ state, cameraDenied, listenChoice: choosing });

  if (choosing) {
    return <ListenChoice onDone={goHome} />;
  }

  const message = MESSAGE[state];
  // The card's inside: the screen's column on the desk (16 dp each side), at most 360 wide, less its own padding.
  const cardInner = Math.min(width - 2 * space.s16, CARD_MAX) - 2 * space.s16;
  const square = Math.max(160, Math.min(cardInner, QR_MAX));
  // Whole modules only (25 a side), so the printed QR draws without seams between its squares.
  const printed = QR_CELLS * Math.floor(Math.min(square, FACSIMILE_MAX) / QR_CELLS);
  const camera = native && !cameraDenied && permission?.granted === true && state !== "paired";
  const askCamera = native && !cameraDenied && permission?.granted !== true && state !== "paired";
  const done = state === "paired" && paired;

  return (
    <Screen testID="M-ON-01" state={screenState} contentStyle={COLUMN}>
      <View style={styles.lead}>
        <Txt kind="title1" accessibilityRole="header">
          {tr("M-ON-01.pair.title")}
        </Txt>
        <Txt kind="body" color="ink2">
          {tr(native ? "M-ON-01.pair.scanHint" : "M-ON-01.pair.scanWeb")}
        </Txt>
      </View>

      <Desk testID="M-ON-01.desk">
        <Paper style={styles.card} testID="M-ON-01.card">
          <View style={styles.cardHead}>
            <Txt kind="bodyStrong" style={styles.flex}>
              {tr("app.name")}
            </Txt>
            <StencilMark
              text={season.code}
              label={tr("M-ON-01.size.season", { season: season.code })}
              size={16}
              color={t.color.ink2}
              ground={t.color.copyWhite}
            />
          </View>
          <Rule />

          <View
            style={[
              styles.qr,
              camera ? { width: square, height: square } : { width: printed, height: printed },
            ]}
            testID={camera ? "M-ON-01.viewfinder" : "M-ON-01.qr"}
            dataSet={{ state: done ? "stamped" : camera ? "camera" : "facsimile" }}
          >
            {camera ? (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: t.color.ink }]}>
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={state === "pairing" ? undefined : (r) => onScan(r.data)}
                />
                <FinderGuide size={square} color={t.color.plate} />
                {state === "pairing" ? (
                  <View style={[StyleSheet.absoluteFill, styles.scrim, { backgroundColor: t.color.scrim }]}>
                    <Txt kind="bodyStrong" style={{ color: t.color.plate }}>
                      {tr("M-ON-01.pair.pairing")}
                    </Txt>
                  </View>
                ) : null}
              </View>
            ) : (
              <QrFacsimile size={printed} />
            )}
            {done ? (
              <View style={[StyleSheet.absoluteFill, styles.stampSpot]}>
                <PairStamp
                  initials={stampInitials(paired.displayName)}
                  label={paired.displayName || tr(ROLE_WORD[paired.role])}
                  testID="M-ON-01.stamp"
                />
              </View>
            ) : null}
          </View>

          {done ? (
            <View style={styles.result} testID="M-ON-01.paired" accessibilityLiveRegion="polite">
              <Txt kind="title2">{tr("M-ON-01.pair.paired", { role: tr(ROLE_WORD[paired.role]) })}</Txt>
              {paired.displayName ? (
                <Txt kind="body" color="ink2">
                  {paired.displayName}
                </Txt>
              ) : null}
            </View>
          ) : askCamera ? (
            <View style={styles.cameraAsk}>
              <Txt kind="body" color="ink2">
                {tr("M-ON-01.pair.cameraNeeded")}
              </Txt>
              <Button
                variant="tonal"
                icon="camera"
                label={tr("M-ON-01.pair.allowCamera")}
                onPress={() => void requestPermission()}
                style={styles.start}
                testID="M-ON-01.allow-camera"
              />
            </View>
          ) : null}

          {!done ? (
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
            </View>
          ) : null}
        </Paper>
      </Desk>

      {cameraDenied && !done ? (
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
        <Banner
          tone="decide"
          icon="info"
          testID={`M-ON-01.${state}`}
          action={
            camera && scanned && scanRefused(state) ? (
              <Button
                variant="text"
                label={tr("M-ON-01.pair.scanAgain")}
                onPress={scanAgain}
                testID="M-ON-01.scan-again"
              />
            ) : undefined
          }
        >
          <Txt kind="body">{tr(message)}</Txt>
        </Banner>
      ) : null}

      {done ? (
        <Button tall label={tr("M-ON-01.continue")} onPress={goHome} testID="M-ON-01.continue" />
      ) : (
        <View style={styles.actions}>
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
      )}

      {demo && !done ? (
        <View style={styles.demo} testID="M-ON-01.demo">
          <Rule />
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
  card: { alignSelf: "center", width: "100%", maxWidth: CARD_MAX, padding: space.s16, gap: space.s16 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: space.s8 },
  qr: { alignSelf: "center", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  stampSpot: { alignItems: "center", justifyContent: "center" },
  scrim: { alignItems: "center", justifyContent: "center" },
  result: { gap: space.s4 },
  cameraAsk: { gap: space.s12 },
  start: { alignSelf: "flex-start" },
  code: { gap: space.s12 },
  actions: { gap: space.s12 },
  demo: { gap: space.s8 },
});
