import { Redirect, Tabs, useSegments } from "expo-router";
import { bootSearch } from "../../platform/query";
import { carriedFlags, withFlags } from "../../services/session";
import { useApp } from "../../state/app";
import { NavBar } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { useT } from "../../ui/text";

/**
 * Board tabs (register §4): Pirma, Bayad, Pangutana; Bayad and Pangutana reuse the member screens. The sign sheet
 * (M-BD-02) takes the whole screen so its 64 dp slab owns the thumb zone: the navigation bar steps aside there.
 */
export default function BoardTabs() {
  const { session } = useApp();
  const t = useT();
  const segments = useSegments() as string[];
  const leaf = segments.at(-1);
  // /bayad and /pangutana are shared with members (register §4); send a member phone to its own copy, with the
  // visit's flags (`?demo=&stage=&line=`…), so a reload or a shared address still shows the same thing.
  if (session?.role === "member" && (leaf === "bayad" || leaf === "pangutana")) {
    return <Redirect href={withFlags(`/(member)/(tabs)/${leaf}`, carriedFlags(bootSearch()))} />;
  }
  if (session?.role !== "board") return <Redirect href="/" />;
  const signing = segments.includes("sign");
  return (
    <Tabs
      tabBar={(p) => (signing ? null : <NavBar {...p} />)}
      screenOptions={{ headerShown: false, animation: "none" }}
    >
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
