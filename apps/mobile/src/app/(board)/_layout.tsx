import { Redirect, Tabs, useSegments } from "expo-router";
import { useApp } from "../../state/app";
import { NavBar } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { useT } from "../../ui/text";

/** Board tabs: Pirma, Bayad, Pangutana; Bayad and Pangutana reuse the member screens (register §4). */
export default function BoardTabs() {
  const { session } = useApp();
  const t = useT();
  const leaf = useSegments().at(-1);
  // /bayad and /pangutana are shared with members (register §4); send a member phone to its own copy.
  if (session?.role === "member" && (leaf === "bayad" || leaf === "pangutana")) {
    return <Redirect href={`/(member)/(tabs)/${leaf}`} />;
  }
  if (session?.role !== "board") return <Redirect href="/" />;
  return (
    <Tabs tabBar={(p) => <NavBar {...p} />} screenOptions={{ headerShown: false, animation: "none" }}>
      <Tabs.Screen
        name="pirma"
        options={{ title: t("tab.pirma"), tabBarIcon: ({ color }) => <Glyph name="sign" color={color} /> }}
      />
      <Tabs.Screen
        name="bayad"
        options={{ title: t("tab.bayad"), tabBarIcon: ({ color }) => <Glyph name="cash" color={color} /> }}
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
