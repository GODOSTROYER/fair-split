import { Redirect, Tabs } from "expo-router";
import { useApp } from "../../../state/app";
import { NavBar } from "../../../ui/chrome";
import { Glyph } from "../../../ui/glyph";
import { useT } from "../../../ui/text";

/** Member tabs: Bayad, Resibo, Pangutana (register §4). Pangutana is always last (WCAG 3.2.6). */
export default function MemberTabs() {
  const { session } = useApp();
  const t = useT();
  if (session?.role !== "member") return <Redirect href="/" />;
  return (
    <Tabs tabBar={(p) => <NavBar {...p} />} screenOptions={{ headerShown: false, animation: "none" }}>
      <Tabs.Screen
        name="bayad"
        options={{ title: t("tab.bayad"), tabBarIcon: ({ color }) => <Glyph name="cash" color={color} /> }}
      />
      <Tabs.Screen
        name="resibo"
        options={{ title: t("tab.resibo"), tabBarIcon: ({ color }) => <Glyph name="slip" color={color} /> }}
      />
      <Tabs.Screen
        name="pangutana"
        options={{
          title: t("tab.pangutana"),
          tabBarIcon: ({ color }) => <Glyph name="question" color={color} />,
        }}
      />
    </Tabs>
  );
}
