/**
 * TEMPORARY SHIM: replace with @fairsplit/motion/native `feedback.play(event)` after WS-DS merges.
 *
 * `feedback.play(event, {index})` is the only way UI makes sound or haptics (S2.10). Haptics follow the table with the
 * Android fallbacks below API 30 (Confirm, Reject) and 34 (Segment_Tick); `performAndroidHapticsAsync` needs no
 * VIBRATE permission. Native plays three sounds (chime, plunk, clack: `scripts/make-sfx.mjs`), respecting the
 * ringer (`playsInSilentMode: false`). Haptics and sound only decorate; they never carry meaning, and a failure is
 * never an error.
 *
 * No product sound plays under narration: Paminawa calls `feedback.narration(true)` before it takes the audio
 * session and `feedback.narration(false)` when it stops, which restores the product mode.
 */
import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from "expo-audio";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { type FeedbackEvent, NATIVE_SOUND, type NativeSound } from "../_shims/motion";

export type { FeedbackEvent } from "../_shims/motion";

const SOURCES: Readonly<Record<NativeSound, number>> = {
  chime: require("../../assets/sfx/chime.wav"),
  plunk: require("../../assets/sfx/plunk.wav"),
  clack: require("../../assets/sfx/clack.wav"),
};

const api = typeof Platform.Version === "number" ? Platform.Version : 0;
const A = Haptics.AndroidHaptics;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function android(primary: Haptics.AndroidHaptics, minApi: number, fallback: () => Promise<void>) {
  return api >= minApi ? Haptics.performAndroidHapticsAsync(primary) : fallback();
}

const twice = async (f: () => Promise<void>, gapMs: number) => {
  await f();
  await wait(gapMs);
  await f();
};

const ANDROID: Readonly<Partial<Record<FeedbackEvent, () => Promise<void>>>> = {
  "slip.captured": () =>
    android(A.Confirm, 30, () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  "slab.d1.press": () => Haptics.performAndroidHapticsAsync(A.Virtual_Key),
  "slab.d1.release": () => Haptics.performAndroidHapticsAsync(A.Virtual_Key_Release),
  "slab.d2.commit": () => Haptics.performAndroidHapticsAsync(A.Virtual_Key),
  "duplicate.found": () => twice(() => Haptics.performAndroidHapticsAsync(A.Clock_Tick), 90),
  "hold.quarter": () => android(A.Segment_Tick, 34, () => Haptics.performAndroidHapticsAsync(A.Clock_Tick)),
  "hold.bottom": () => Haptics.performAndroidHapticsAsync(A.Long_Press),
  "bolted.refuse": () =>
    android(A.Reject, 30, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  "seal.mismatch": () =>
    android(A.Reject, 30, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  "seal.complete": () => android(A.Confirm, 30, () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  "item.paid.member": () =>
    twice(
      () => android(A.Confirm, 30, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
      90,
    ),
  "paypal.failure": () =>
    android(A.Reject, 30, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  "zoom.commit": () => android(A.Segment_Tick, 34, () => Haptics.performAndroidHapticsAsync(A.Clock_Tick)),
};

const IOS: Readonly<Partial<Record<FeedbackEvent, () => Promise<void>>>> = {
  "slip.captured": () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  "slab.d1.press": () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  "slab.d1.release": () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  "slab.d2.commit": () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid),
  "duplicate.found": () => twice(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid), 90),
  "hold.quarter": () => Haptics.selectionAsync(),
  "hold.bottom": () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  "bolted.refuse": () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  "seal.mismatch": () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  "seal.complete": () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  "item.paid.member": () =>
    twice(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), 90),
  "paypal.failure": () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  "zoom.commit": () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid),
};

const HAPTICS = Platform.OS === "android" ? ANDROID : IOS;

/** The product's audio mode: quiet in silent mode, mixing with whatever else is playing. */
const PRODUCT_MODE = { playsInSilentMode: false, interruptionMode: "mixWithOthers" } as const;

const players: Partial<Record<NativeSound, AudioPlayer>> = {};
let modeSet = false;
let narrating = false;

function playSound(name: NativeSound): void {
  if (narrating) return;
  try {
    if (!modeSet) {
      modeSet = true;
      setAudioModeAsync(PRODUCT_MODE).catch(() => {
        modeSet = false;
      });
    }
    let p = players[name];
    if (!p) {
      p = createAudioPlayer(SOURCES[name]);
      players[name] = p;
    }
    const player = p;
    player
      .seekTo(0)
      .then(() => player.play())
      .catch(() => {});
  } catch {
    // No audio output, or the module is unavailable: sound is decoration.
  }
}

export const feedback = {
  /** Plays an event's haptic (and its sound, on native, where S2.10 gives it one). `index` is for the console scale. */
  play(event: FeedbackEvent, _opts?: { index?: number }): void {
    const sound = NATIVE_SOUND[event];
    if (sound) playSound(sound);
    HAPTICS[event]?.().catch(() => {
      // Low Power Mode, no vibrator, emulator: haptics are decoration, never an error.
    });
  },
  /** Loads the three sounds ahead of their first use (the root layout calls this once). */
  preload(): void {
    for (const name of Object.keys(SOURCES) as NativeSound[]) {
      try {
        players[name] ??= createAudioPlayer(SOURCES[name]);
      } catch {
        // ignore
      }
    }
  },
  /** Paminawa owns the audio session while it reads: product sounds stay silent, then the product mode returns. */
  narration(on: boolean): void {
    narrating = on;
    if (!on) {
      modeSet = true;
      setAudioModeAsync(PRODUCT_MODE).catch(() => {
        modeSet = false;
      });
    }
  },
};
