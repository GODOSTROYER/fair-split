/**
 * The root of every route: gesture handling, the shell's state, fonts, the theme (Adlaw), Material 3 navigation
 * colours from our tokens, and the stack that holds onboarding, the three role areas and the web entry points
 * (`/pair`, `/s/:token`). Role areas guard themselves (a member phone never sees the clerk's outbox).
 */
import { useFonts } from "expo-font";
import { Stack, ThemeProvider, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useMemo } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { fontSources } from "../_shims/font-sources";
import { fontFamily } from "../_shims/fonts";
import { m3, themes } from "../_shims/tokens.native";
import { feedback } from "../platform/feedback";
import { AppProvider, useApp } from "../state/app";
import { usePushRegistration } from "../state/use-push";
import { FsThemeProvider } from "../theme/theme";

void SplashScreen.preventAutoHideAsync().catch(() => {});

function Root() {
  const { ready, theme, frame, session } = useApp();
  const router = useRouter();
  // Seam (BOARD+ONBOARDING owns state/use-push.ts): registers this phone for push once it is paired.
  usePushRegistration();
  const [fontsLoaded, fontError] = useFonts(fontSources);
  const fontsReady = fontsLoaded || !!fontError || Object.keys(fontSources).length === 0;
  useEffect(() => {
    if (
      ready &&
      fontsReady &&
      frame.inFrame &&
      session?.kind === "frame" &&
      session.bearer !== "demo-session"
    ) {
      // A preview may have opened showcase r37. Start at this persona's home so fs-api names its workspace run.
      router.replace("/");
    }
  }, [ready, fontsReady, frame.inFrame, session?.kind, session?.bearer, router]);
  const tokens = themes[theme];
  const roles = m3(tokens);
  const navTheme = useMemo(
    () => ({
      dark: tokens.dark,
      colors: {
        primary: roles.primary,
        background: roles.surface,
        card: roles.surfaceContainer,
        text: roles.onSurface,
        border: roles.outline,
        notification: roles.error,
      },
      fonts: {
        regular: { fontFamily: fontFamily.ui, fontWeight: "400" as const },
        medium: { fontFamily: fontFamily.figure, fontWeight: "500" as const },
        bold: { fontFamily: fontFamily.strong, fontWeight: "700" as const },
        heavy: { fontFamily: fontFamily.amount, fontWeight: "800" as const },
      },
    }),
    [tokens.dark, roles],
  );
  const motion = useMemo(
    () => ({
      reduced: frame.prefs?.reducedMotion,
      low: frame.prefs ? frame.prefs.tier === "low" : undefined,
    }),
    [frame.prefs],
  );

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(tokens.color.ground).catch(() => {});
  }, [tokens.color.ground]);

  useEffect(() => {
    if (ready && fontsReady) {
      void SplashScreen.hideAsync().catch(() => {});
      feedback.preload();
    }
  }, [ready, fontsReady]);

  if (!ready || !fontsReady) return null;
  return (
    <ThemeProvider value={navTheme}>
      <FsThemeProvider name={theme} motion={motion}>
        <StatusBar style={tokens.dark ? "light" : "dark"} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: tokens.color.ground },
            animation: "fade_from_bottom",
          }}
        >
          <Stack.Screen name="index" options={{ animation: "none" }} />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="(member)" />
          <Stack.Screen name="(clerk)" />
          <Stack.Screen name="(board)" />
          <Stack.Screen name="pair" />
          <Stack.Screen name="s/[token]" />
        </Stack>
      </FsThemeProvider>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProvider>
          <Root />
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
