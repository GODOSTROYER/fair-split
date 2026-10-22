import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Fair Split app (register §4, M-* screens). Android first; the web export runs as the judge's phone frames.
 *
 * - `EXPO_WEB_BASE` sets `experiments.baseUrl` for the web export only (C-11: served at `/app`). It is never set for
 *   native builds, because the base URL is inlined into every platform bundle. `pnpm --filter @fairsplit/mobile build`
 *   sets it to `/app` (scripts/export-web.mjs).
 * - Fonts are embedded at build time on native (expo-font plugin) and loaded at runtime on web.
 *   TEMPORARY: Mona Sans / Atkinson Hyperlegible Next from Google Fonts until WS-DS ships the FS Sans cuts.
 */
const webBase = process.env.EXPO_WEB_BASE?.trim();

const fontFiles = [
  "@expo-google-fonts/mona-sans/400Regular/MonaSans_400Regular.ttf",
  "@expo-google-fonts/mona-sans/500Medium/MonaSans_500Medium.ttf",
  "@expo-google-fonts/mona-sans/700Bold/MonaSans_700Bold.ttf",
  "@expo-google-fonts/mona-sans/800ExtraBold/MonaSans_800ExtraBold.ttf",
  "@expo-google-fonts/atkinson-hyperlegible-next/400Regular/AtkinsonHyperlegibleNext_400Regular.ttf",
  "@expo-google-fonts/atkinson-hyperlegible-next/700Bold/AtkinsonHyperlegibleNext_700Bold.ttf",
].map((f) => require.resolve(f));

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Fair Split",
  slug: "fair-split",
  description: "Fair Split: co-op payroll. Every peso, traced to the pencil mark.",
  version: "0.1.0",
  orientation: "portrait",
  scheme: "fairsplit",
  icon: "./assets/images/icon.png",
  // One theme per surface (approved plan): the app is Adlaw, light. The app draws its own chrome, so the system UI
  // stays light too (a dark system theme must not put light navigation icons over the Adlaw ground).
  userInterfaceStyle: "light",
  backgroundColor: "#EEEEEA",
  primaryColor: "#1C1511",
  ios: {
    bundleIdentifier: "org.fairsplit.app",
    supportsTablet: false,
  },
  android: {
    package: "org.fairsplit.app",
    adaptiveIcon: {
      backgroundColor: "#201712",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    // Design §6: Predictive Back works everywhere (unverified on SDK 58 until spike S7 runs on hardware).
    predictiveBackGestureEnabled: true,
    // Least privilege: no microphone anywhere, and nothing writes to shared storage (captures stay app-private).
    blockedPermissions: ["android.permission.RECORD_AUDIO", "android.permission.WRITE_EXTERNAL_STORAGE"],
  },
  web: {
    output: "single",
    bundler: "metro",
    favicon: "./assets/images/favicon.png",
    name: "Fair Split",
    shortName: "Fair Split",
    lang: "ceb",
    backgroundColor: "#EEEEEA",
    themeColor: "#EEEEEA",
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#EEEEEA",
        image: "./assets/images/splash-icon.png",
        imageWidth: 96,
      },
    ],
    ["expo-font", { fonts: fontFiles }],
    [
      "expo-camera",
      {
        cameraPermission: "Fair Split uses the camera to scan resibo and the pairing QR.",
        microphonePermission: false,
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
    [
      "expo-audio",
      { microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: true },
    ],
    ["expo-secure-store", { faceIDPermission: "Fair Split uses Face ID to unlock your signing key." }],
    [
      "expo-local-authentication",
      { faceIDPermission: "Fair Split asks for Face ID before you co-sign a pay run." },
    ],
    ["expo-notifications", { color: "#1C1511", defaultChannel: "cosign" }],
    [
      // The clerk's fallback when no document scanner exists (and the web frames' file picker). The camera
      // permission is shared with expo-camera, so it is never blocked here; the microphone always is.
      "expo-image-picker",
      {
        photosPermission: "Fair Split opens a photo of a resibo when the scanner is not available.",
        cameraPermission: "Fair Split uses the camera to scan resibo and the pairing QR.",
        microphonePermission: false,
      },
    ],
    // The clerk's outbox may sync in the background (cut order item 4); harmless until a task is registered.
    "expo-background-task",
    "expo-sqlite",
    [
      "expo-build-properties",
      {
        android: {
          // Architecture §18: pin CMake for Windows-friendly native builds (EAS builds on Linux anyway).
          cmakeVersion: "3.31.6",
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
    ...(webBase ? { baseUrl: webBase } : {}),
  },
  extra: {
    ...config.extra,
    // `eas init` writes the real project ID; push registration stays a scaffold until it exists.
    eas: { ...(config.extra?.eas ?? {}) },
  },
});
