/** What this build is, for the pairing claim (`device.appVersion`) and the stage's `fs.ready`. */
import Constants from "expo-constants";
import { Platform } from "react-native";

export const BUILD = {
  version: Constants.expoConfig?.version ?? "0.0.0",
  platform: (Platform.OS === "android" || Platform.OS === "ios" ? Platform.OS : "web") as
    | "android"
    | "ios"
    | "web",
} as const;

/**
 * `EXPO_PUBLIC_API_ORIGIN`: an https origin, or `same-origin` when fs-api serves this web export at /app.
 * Unset means demo mode: the whole API runs in memory and every screen says "Demo data" (I8).
 */
export function apiOrigin(): string | null {
  const v = process.env.EXPO_PUBLIC_API_ORIGIN?.trim();
  if (!v) return null;
  if (v === "same-origin") {
    return typeof window !== "undefined" && window.location ? window.location.origin : null;
  }
  return v;
}
