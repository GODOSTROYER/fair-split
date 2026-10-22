import { Redirect, Tabs } from "expo-router";
import { useApp } from "../../state/app";
import { NavBar } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { useT } from "../../ui/text";

/** Clerk tabs: Scan, Outbox (register §4). */
export default function ClerkTabs() {
  const { session } = useApp();
  const t = useT();
  if (session?.role !== "clerk") return <Redirect href="/" />;
  return (
    <Tabs tabBar={(p) => <NavBar {...p} />} screenOptions={{ headerShown: false, animation: "none" }}>
      <Tabs.Screen
        name="scan"
        options={{ title: t("tab.scan"), tabBarIcon: ({ color }) => <Glyph name="scan" color={color} /> }}
      />
      <Tabs.Screen
        name="outbox"
        options={{ title: t("tab.outbox"), tabBarIcon: ({ color }) => <Glyph name="outbox" color={color} /> }}
      />
    </Tabs>
  );
}
