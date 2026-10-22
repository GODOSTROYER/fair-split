import { useFonts } from "expo-font";
import { Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { fontSources } from "../_shims/font-sources";
import { themes } from "../_shims/tokens.native";
import { AppProvider, useApp } from "../state/app";
import { usePushRegistration } from "../state/use-push";
import { FsThemeProvider } from "../theme/theme";

void SplashScreen.preventAutoHideAsync();

function Root() {
  const { ready, theme } = useApp();
  usePushRegistration();
  const [fontsLoaded, fontError] = useFonts(fontSources);
  const fontsReady = fontsLoaded || !!fontError || Object.keys(fontSources).length === 0;
  const tokens = themes[theme];
  const navTheme = useMemo(
    () => ({
      dark: tokens.dark,
      colors: {
        primary: tokens.color.ink,
        background: tokens.color.ground,
        card: tokens.color.plate,
        text: tokens.color.ink,
        border: tokens.color.rule,
        notification: tokens.color.canary,
      },
      fonts: {
        regular: { fontFamily: "MonaSans_400Regular", fontWeight: "400" as const },
        medium: { fontFamily: "MonaSans_500Medium", fontWeight: "500" as const },
        bold: { fontFamily: "MonaSans_700Bold", fontWeight: "700" as const },
        heavy: { fontFamily: "MonaSans_800ExtraBold", fontWeight: "800" as const },
      },
    }),
    [tokens],
  );

  useEffect(() => {
    if (ready && fontsReady) void SplashScreen.hideAsync();
  }, [ready, fontsReady]);

  if (!ready || !fontsReady) return null;
  return (
    <ThemeProvider value={navTheme}>
      <FsThemeProvider name={theme}>
        <StatusBar style={tokens.dark ? "light" : "dark"} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: tokens.color.ground },
            animation: "fade_from_bottom",
          }}
        >
          <Stack.Screen name="index" options={{ animation: "none" }} />
          <Stack.Screen name="(member)" />
          <Stack.Screen name="(clerk)" />
          <Stack.Screen name="(board)" />
        </Stack>
      </FsThemeProvider>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppProvider>
        <Root />
      </AppProvider>
    </GestureHandlerRootView>
  );
}
