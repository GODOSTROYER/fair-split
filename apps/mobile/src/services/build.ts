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
 * Unset means demo mode outside the stage. Embedded web frames always use their own origin once an accepted
 * IC-12 token switches them from labelled local preview to fs-api; a build setting cannot redirect that token.
 */
export function apiOrigin(framed = false): string | null {
  if (framed && Platform.OS === "web") {
    return typeof window !== "undefined" && window.location ? window.location.origin : null;
  }
  const v = process.env.EXPO_PUBLIC_API_ORIGIN?.trim();
  if (!v) return null;
  if (v === "same-origin") {
    return typeof window !== "undefined" && window.location ? window.location.origin : null;
  }
  return v;
}
