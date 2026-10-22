/**
 * TEMPORARY SHIM: replace with @fairsplit/motion/native `feedback.play(event)` after WS-DS merges.
 *
 * Haptics per design §4 / S2.10, with the Android fallbacks below API 30 (Confirm, Reject) and 34 (Segment_Tick).
 * Haptics only decorate; they never carry meaning. Product sounds (tick, plunk, chime…) arrive as WS-DS WAVs;
 * until then `play` is silent. `performAndroidHapticsAsync` needs no VIBRATE permission.
 */
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export type FeedbackEvent =
  | "slip.captured"
  | "slab.d1.press"
  | "slab.d1.release"
  | "slab.d2.commit"
  | "hold.quarter"
  | "hold.bottom"
  | "bolted.refuse"
  | "seal.complete"
  | "item.paid.member"
  | "paypal.failure"
  | "seal.mismatch"
  | "zoom.commit";

const api = typeof Platform.Version === "number" ? Platform.Version : 0;
const A = Haptics.AndroidHaptics;

function android(primary: Haptics.AndroidHaptics, minApi: number, fallback: () => Promise<void>) {
  return api >= minApi ? Haptics.performAndroidHapticsAsync(primary) : fallback();
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PLAY: Readonly<Record<FeedbackEvent, () => Promise<void>>> =
  Platform.OS === "android"
    ? {
        "slip.captured": () =>
          android(A.Confirm, 30, () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
        "slab.d1.press": () => Haptics.performAndroidHapticsAsync(A.Virtual_Key),
        "slab.d1.release": () => Haptics.performAndroidHapticsAsync(A.Virtual_Key_Release),
        "slab.d2.commit": () => Haptics.performAndroidHapticsAsync(A.Virtual_Key),
        "hold.quarter": () =>
          android(A.Segment_Tick, 34, () => Haptics.performAndroidHapticsAsync(A.Clock_Tick)),
        "hold.bottom": () =>
          android(A.Confirm, 30, () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
        "bolted.refuse": () =>
          android(A.Reject, 30, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
        "seal.complete": () =>
          android(A.Confirm, 30, () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
        "item.paid.member": async () => {
          const confirm = () =>
            android(A.Confirm, 30, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
          await confirm();
          await wait(90);
          await confirm();
        },
        "paypal.failure": () =>
          android(A.Reject, 30, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
        "seal.mismatch": () =>
          android(A.Reject, 30, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
        "zoom.commit": () =>
          android(A.Segment_Tick, 34, () => Haptics.performAndroidHapticsAsync(A.Clock_Tick)),
      }
    : {
        "slip.captured": () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
        "slab.d1.press": () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
        "slab.d1.release": () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
        "slab.d2.commit": () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid),
        "hold.quarter": () => Haptics.selectionAsync(),
        "hold.bottom": async () => {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          await wait(110);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        },
        "bolted.refuse": () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
        "seal.complete": () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
        "item.paid.member": async () => {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          await wait(90);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        },
        "paypal.failure": () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
        "seal.mismatch": () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
        "zoom.commit": () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid),
      };

export const feedback = {
  play(event: FeedbackEvent): void {
    PLAY[event]().catch(() => {
      // Low Power Mode, no vibrator, emulator: haptics are decoration, never an error.
    });
  },
};
