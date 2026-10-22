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
  // Adlaw (light) is the app default; members may pick Tablea at first run. The app owns its theme.
  userInterfaceStyle: "automatic",
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
    blockedPermissions: ["android.permission.RECORD_AUDIO"],
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
        dark: { backgroundColor: "#201712", image: "./assets/images/splash-icon.png" },
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
