/**
 * Overlays on Material 3 structure, themed from our tokens (design §2.4: system containers keep M3's own radii):
 * - `Sheet`: a bottom sheet over a scrim (Paminawa's language chips, "Ipasusi pag-usab", "Ipabalik kang Analyn");
 * - `ConfirmDialog`: the dialog route of every hold-to-commit slab (S2.7): the amount, every recipient, and the seal
 *   at 96 px with its hash in groups of four, so a person who cannot hold still sees exactly what they approve;
 * - `Snackbar` + `useSnackbar`: transient, optionally actionable feedback ("Already sent at 09:12").
 * Each traps nothing it does not need to: the dialog is modal (it asks for a decision), the sheet closes on Back and
 * on the scrim, the snackbar never takes focus but is announced.
 */
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { layer, radius, space, target } from "../_shims/tokens.native";
import { useFs } from "../theme/theme";
import { ms } from "./motion";
import { Button } from "./primitives";
import { SealView } from "./seal-view";
import { Txt, useT } from "./text";

/* ------------------------------------------------------------------ Sheet */

export function Sheet({
  visible,
  title,
  onClose,
  children,
  testID,
}: {
  visible: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  testID?: string;
}) {
  const { t, motion } = useFs();
  const insets = useSafeAreaInsets();
  const tr = useT();
  return (
    <Modal
      transparent
      visible={visible}
      animationType={motion.reduced ? "fade" : "slide"}
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.sheetRoot}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: t.color.scrim }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={tr("common.close")}
          testID={testID ? `${testID}.scrim` : undefined}
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: t.color.plate2,
              borderTopColor: t.color.rule,
              paddingBottom: Math.max(insets.bottom, space.s16),
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: t.color.rule }]} />
          <Txt kind="title2" accessibilityRole="header">
            {title}
          </Txt>
          <ScrollView contentContainerStyle={{ gap: space.s16 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ ConfirmDialog */

/** What a hold slab's dialog route shows (S2.7 `ConfirmSpec`); amounts arrive formatted by `format.*`. */
export interface ConfirmSpec {
  title: string;
  body?: string;
  /** "US$368.39": the total this decision moves. */
  amount?: string;
  recipients?: readonly { name: string; amount: string }[];
  /** The batch hash: the dialog draws the seal at 96 px with the hash in groups of four. */
  batchSha256?: string;
  /** How many keys have signed so far, for the seal. */
  keys?: 0 | 1 | 2;
  confirmLabel: string;
  cancelLabel?: string;
}

export function ConfirmDialog({
  visible,
  spec,
  onConfirm,
  onCancel,
  testID = "confirm",
}: {
  visible: boolean;
  spec: ConfirmSpec;
  onConfirm(): void;
  onCancel(): void;
  testID?: string;
}) {
  const { t } = useFs();
  const tr = useT();
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[styles.scrim, { backgroundColor: t.color.scrim }]}>
        <View
          testID={testID}
          accessibilityViewIsModal
          accessibilityRole="alert"
          style={[styles.dialog, { backgroundColor: t.color.plate2, borderColor: t.color.rule }]}
        >
          <Txt kind="title2" accessibilityRole="header">
            {spec.title}
          </Txt>
          <ScrollView style={styles.dialogBody} contentContainerStyle={{ gap: space.s12 }}>
            {spec.amount ? <Txt kind="amountL">{spec.amount}</Txt> : null}
            {spec.body ? (
              <Txt kind="body" color="ink2">
                {spec.body}
              </Txt>
            ) : null}
            {spec.recipients?.length ? (
              <View accessibilityLabel={tr("slab.recipients")} style={{ gap: space.s4 }}>
                <Txt kind="label" color="ink2">
                  {tr("slab.recipients")}
                </Txt>
                {spec.recipients.map((r) => (
                  <View key={`${r.name}-${r.amount}`} style={styles.recipient}>
                    <Txt kind="body" style={{ flex: 1 }}>
                      {r.name}
                    </Txt>
                    <Txt kind="figure">{r.amount}</Txt>
                  </View>
                ))}
              </View>
            ) : null}
            {spec.batchSha256 ? (
              <View style={styles.sealRow}>
                <SealView batchSha256={spec.batchSha256} size={96} keys={spec.keys ?? 0} engrave={false} />
                <Txt kind="hash" color="ink2" style={{ flex: 1 }} selectable>
                  {spec.batchSha256.match(/.{1,4}/g)?.join(" ")}
                </Txt>
              </View>
            ) : null}
          </ScrollView>
          <View style={styles.dialogActions}>
            <Button
              variant="text"
              label={spec.cancelLabel ?? tr("common.cancel")}
              onPress={onCancel}
              testID={`${testID}.cancel`}
            />
            <Button label={spec.confirmLabel} onPress={onConfirm} testID={`${testID}.ok`} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Snackbar */

export type SnackTone = "neutral" | "decide";

export interface SnackMessage {
  id: number;
  text: string;
  tone: SnackTone;
  action?: { label: string; onPress(): void };
}

/** One message at a time, replaced by the next; 4 s, or 8 s with an action so it can be reached. */
export function useSnackbar() {
  const [msg, setMsg] = useState<SnackMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const show = useCallback((text: string, tone: SnackTone = "neutral", action?: SnackMessage["action"]) => {
    if (timer.current) clearTimeout(timer.current);
    setMsg({ id: Date.now(), text, tone, action });
    timer.current = setTimeout(() => setMsg(null), action ? 8000 : 4000);
  }, []);
  const hide = useCallback(() => setMsg(null), []);
  return { msg, show, hide };
}

export function Snackbar({ msg, bottom = space.s16 }: { msg: SnackMessage | null; bottom?: number }) {
  const { t, motion } = useFs();
  if (!msg) return null;
  const decide = msg.tone === "decide";
  return (
    <Animated.View
      key={msg.id}
      entering={motion.reduced ? undefined : FadeInDown.duration(ms("micro"))}
      exiting={motion.reduced ? undefined : FadeOutDown.duration(ms("micro") * 0.8)}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      testID="snackbar"
      style={[
        styles.snack,
        {
          bottom,
          backgroundColor: decide ? t.color.canaryWash : t.color.ink,
          borderColor: decide ? t.color.canaryBorder : t.color.ink,
        },
      ]}
    >
      <Txt kind="body" style={{ flex: 1, color: decide ? t.color.ink : t.color.plate }}>
        {msg.text}
      </Txt>
      {msg.action ? (
        <Pressable
          onPress={msg.action.onPress}
          accessibilityRole="button"
          hitSlop={8}
          style={styles.snackAction}
          testID="snackbar.action"
        >
          <Txt kind="bodyStrong" style={{ color: decide ? t.color.ink : t.color.plate }}>
            {msg.action.label}
          </Txt>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheetRoot: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    maxHeight: "85%",
    gap: space.s16,
    paddingHorizontal: space.s16,
    paddingTop: space.s8,
    borderTopWidth: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    zIndex: layer.drawer,
  },
  grabber: { alignSelf: "center", width: 32, height: 4, borderRadius: 2, marginBottom: space.s8 },
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.s24 },
  dialog: {
    width: "100%",
    maxWidth: 440,
    maxHeight: "90%",
    gap: space.s16,
    padding: space.s24,
    borderWidth: 1,
    borderRadius: 28,
    zIndex: layer.dialog,
  },
  dialogBody: { flexGrow: 0 },
  recipient: { flexDirection: "row", alignItems: "center", gap: space.s12, minHeight: 28 },
  sealRow: { flexDirection: "row", alignItems: "center", gap: space.s12 },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: space.s8 },
  snack: {
    position: "absolute",
    left: space.s16,
    right: space.s16,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    minHeight: target.min,
    paddingHorizontal: space.s16,
    paddingVertical: space.s12,
    borderWidth: 1,
    borderRadius: radius.plate,
    zIndex: layer.snackbar,
  },
  snackAction: { minHeight: target.min, justifyContent: "center" },
});
