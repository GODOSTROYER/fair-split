/** Clerk UI parts: the per-capture progress ring, a Material snackbar, and the in-app camera fallback. */
import { CameraView, useCameraPermissions } from "expo-camera";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";
import { radius, space, target } from "../../_shims/tokens.native";
import type { CaptureState } from "../../lib/outbox";
import { useFs } from "../../theme/theme";
import { Glyph } from "../../ui/glyph";
import { Button } from "../../ui/primitives";
import { Txt, useT } from "../../ui/text";

export function ProgressRing({
  state,
  progress,
  size = 36,
}: {
  state: CaptureState;
  progress: number;
  size?: number;
}) {
  const { t } = useFs();
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const done = state === "uploaded" || state === "read";
  const color = state === "failed" ? t.color.canaryText : t.color.ink;
  const frac = done ? 1 : state === "uploading" ? Math.max(0.04, progress) : 0;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(frac * 100) }}
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={state === "failed" ? t.color.canaryBorder : t.color.rule}
          strokeWidth={2}
          strokeDasharray={state === "queued" ? [3, 3] : undefined}
          fill="none"
        />
        {frac > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={3}
            fill="none"
            strokeDasharray={[c * frac, c]}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
        {done ? (
          <Path
            d={`M${size * 0.3} ${size * 0.52}l${size * 0.14} ${size * 0.14} ${size * 0.26}-${size * 0.3}`}
            stroke={t.color.ink}
            strokeWidth={2.5}
            fill="none"
          />
        ) : null}
      </Svg>
    </View>
  );
}

export function useSnackbar() {
  const [msg, setMsg] = useState<{ text: string; tone: "neutral" | "decide"; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const show = (text: string, tone: "neutral" | "decide" = "neutral") => {
    if (timer.current) clearTimeout(timer.current);
    setMsg({ text, tone, id: Date.now() });
    timer.current = setTimeout(() => setMsg(null), 4000);
  };
  return { msg, show };
}

export function Snackbar({
  msg,
  bottom,
}: {
  msg: { text: string; tone: "neutral" | "decide"; id: number } | null;
  bottom: number;
}) {
  const { t } = useFs();
  if (!msg) return null;
  return (
    <Animated.View
      key={msg.id}
      entering={FadeInDown.duration(160)}
      exiting={FadeOutDown.duration(130)}
      accessibilityLiveRegion="polite"
      testID="snackbar"
      style={[
        styles.snack,
        {
          bottom,
          backgroundColor: msg.tone === "decide" ? t.color.canaryWash : t.color.ink,
          borderColor: msg.tone === "decide" ? t.color.canaryBorder : t.color.ink,
        },
      ]}
    >
      <Txt kind="body" style={{ color: msg.tone === "decide" ? t.color.ink : t.color.plate }}>
        {msg.text}
      </Txt>
    </Animated.View>
  );
}

/** Fallback when the system document scanner is unavailable: the camera with an edge guide (design K1). */
export function CameraCapture({
  visible,
  onClose,
  onCaptured,
  title,
}: {
  visible: boolean;
  onClose(): void;
  onCaptured(uri: string): void;
  title: ReactNode;
}) {
  const { t } = useFs();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const [permission, request] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) void request();
  }, [visible, permission, request]);
  const capture = async () => {
    if (!cam.current || busy) return;
    setBusy(true);
    try {
      const photo = await cam.current.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) onCaptured(photo.uri);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.camera, { backgroundColor: "#000", paddingTop: insets.top }]}>
        <View style={styles.camTop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr("common.close")}
            onPress={onClose}
            style={styles.camClose}
          >
            <Glyph name="close" color="#FFFFFF" />
          </Pressable>
          {title}
        </View>
        {permission?.granted ? (
          <View style={{ flex: 1 }}>
            <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" />
            <View pointerEvents="none" style={styles.guideWrap}>
              <View style={[styles.guide, { borderColor: t.color.copyYellow }]} />
              <Txt kind="bodyStrong" style={{ color: "#FFFFFF" }}>
                {tr("M-CL-01.edgeGuide")}
              </Txt>
            </View>
          </View>
        ) : (
          <View style={styles.denied}>
            <Txt kind="body" style={{ color: "#FFFFFF" }} align="center">
              {tr("M-CL-01.cameraDenied")}
            </Txt>
          </View>
        )}
        <View style={[styles.camBottom, { paddingBottom: insets.bottom + space.s24 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr("M-CL-01.capture")}
            onPress={() => void capture()}
            disabled={!permission?.granted || busy}
            style={({ pressed }) => [styles.shutter, { opacity: pressed || busy ? 0.6 : 1 }]}
          />
          <Button
            variant="text"
            label={tr("common.cancel")}
            onPress={onClose}
            style={{ position: "absolute", right: space.s16 }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  snack: {
    position: "absolute",
    left: space.s16,
    right: space.s16,
    padding: space.s16,
    borderWidth: 1,
    borderRadius: radius.plate,
  },
  camera: { flex: 1 },
  camTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s8,
    paddingHorizontal: space.s8,
    minHeight: 56,
  },
  camClose: { width: target.min, height: target.min, alignItems: "center", justifyContent: "center" },
  guideWrap: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: space.s16 },
  guide: { width: "86%", aspectRatio: 1.55, borderWidth: 3, borderStyle: "dashed" },
  denied: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.s24 },
  camBottom: { alignItems: "center", justifyContent: "center", paddingTop: space.s16 },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: "#FFFFFF",
    backgroundColor: "rgba(255,255,255,0.25)",
  },
});
