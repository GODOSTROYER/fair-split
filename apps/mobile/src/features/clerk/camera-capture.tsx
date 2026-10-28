/**
 * The camera fallback when the phone has no document scanner (design K1: "falls back to the camera with an edge
 * guide"). The guide is an A6 slip's own shape, portrait, so the clerk fills it the way the scanner would crop it.
 * Camera access is asked for in words; when it was refused for good, the screen says how to fix it and opens the
 * phone's settings, and a photo already on the phone is always one tap away. Native only.
 */
import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { Linking, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { space, target } from "../../_shims/tokens.native";
import { useFs } from "../../theme/theme";
import { Glyph } from "../../ui/glyph";
import { Button } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import { SAMPLE_SIZE } from "./samples";
import { useT } from "./use-t";

const A6 = SAMPLE_SIZE.width / SAMPLE_SIZE.height;

export function CameraCapture({
  visible,
  title,
  onClose,
  onCaptured,
  onLibrary,
  onDenied,
  testID = "M-CL-01.camera",
}: {
  visible: boolean;
  title: string;
  onClose(): void;
  onCaptured(uri: string): void;
  onLibrary?(): void;
  onDenied?(): void;
  testID?: string;
}) {
  const { t } = useFs();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const [permission, request] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const denied = permission ? !permission.granted && !permission.canAskAgain : false;

  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) void request();
  }, [visible, permission, request]);
  useEffect(() => {
    if (visible && denied) onDenied?.();
  }, [visible, denied, onDenied]);
  useEffect(() => {
    if (!visible) setReady(false);
  }, [visible]);

  const capture = async () => {
    if (!cam.current || busy || !ready) return;
    setBusy(true);
    try {
      const photo = await cam.current.takePictureAsync({ quality: 0.92, skipProcessing: false });
      if (photo?.uri) onCaptured(photo.uri);
    } finally {
      setBusy(false);
    }
  };

  const fg = t.color.plate;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View testID={testID} style={[styles.root, { backgroundColor: t.color.ink, paddingTop: insets.top }]}>
        <View style={styles.top}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr("common.close")}
            onPress={onClose}
            style={styles.iconButton}
            testID={`${testID}.close`}
          >
            <Glyph name="close" color={fg} />
          </Pressable>
          <Txt kind="title2" style={{ color: fg, flex: 1 }} accessibilityRole="header" numberOfLines={2}>
            {title}
          </Txt>
        </View>

        {permission?.granted ? (
          <View style={styles.viewfinder}>
            <CameraView
              ref={cam}
              style={StyleSheet.absoluteFill}
              facing="back"
              onCameraReady={() => setReady(true)}
            />
            <View pointerEvents="none" style={styles.guideWrap}>
              <View style={[styles.guide, { borderColor: t.color.copyYellow }]} />
              <Txt kind="bodyStrong" style={{ color: fg }} align="center">
                {tr("M-CL-01.edgeGuide")}
              </Txt>
            </View>
          </View>
        ) : (
          <View style={styles.ask}>
            <Glyph name="camera" size={40} color={fg} />
            <Txt kind="body" style={{ color: fg }} align="center">
              {tr("M-CL-01.cameraDenied")}
            </Txt>
            {permission && !denied ? (
              <Button
                variant="tonal"
                icon="camera"
                label={tr("M-CL-01.cameraAsk")}
                onPress={() => void request()}
                testID={`${testID}.allow`}
              />
            ) : (
              <Button
                variant="tonal"
                label={tr("M-CL-01.openSettings")}
                onPress={() => void Linking.openSettings()}
                testID={`${testID}.settings`}
              />
            )}
          </View>
        )}

        <View style={[styles.bottom, { paddingBottom: insets.bottom + space.s24 }]}>
          {onLibrary ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr("M-CL-01.library")}
              onPress={onLibrary}
              style={styles.iconButton}
              testID={`${testID}.library`}
            >
              <Glyph name="slip" color={fg} />
            </Pressable>
          ) : (
            <View style={styles.iconButton} />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr("M-CL-01.capture")}
            accessibilityState={{ disabled: !permission?.granted || !ready || busy }}
            onPress={() => void capture()}
            disabled={!permission?.granted || !ready || busy}
            testID={`${testID}.shutter`}
            style={({ pressed }) => [
              styles.shutter,
              { borderColor: fg, opacity: !permission?.granted || !ready ? 0.4 : pressed || busy ? 0.7 : 1 },
            ]}
          >
            <View style={[styles.shutterFace, { backgroundColor: fg }]} />
          </Pressable>
          <View style={styles.iconButton} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s8,
    paddingHorizontal: space.s8,
    minHeight: 64,
  },
  iconButton: { width: target.min, height: target.min, alignItems: "center", justifyContent: "center" },
  viewfinder: { flex: 1 },
  guideWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: space.s16,
    padding: space.s24,
  },
  guide: { width: "72%", aspectRatio: A6, borderWidth: 3, borderStyle: "dashed" },
  ask: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.s16, padding: space.s24 },
  bottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.s24,
    paddingTop: space.s16,
  },
  shutter: {
    width: target.play,
    height: target.play,
    borderRadius: target.play / 2,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterFace: { width: target.play - 18, height: target.play - 18, borderRadius: (target.play - 18) / 2 },
});
