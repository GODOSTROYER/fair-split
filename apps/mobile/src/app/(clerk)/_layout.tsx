import { Redirect, Tabs } from "expo-router";
import { CashDayProvider } from "../../features/clerk/cash-provider";
import { OutboxProvider } from "../../features/clerk/outbox-provider";
import { OutboxTabIcon } from "../../features/clerk/outbox-tab-icon";
import { RescanProvider } from "../../features/clerk/rescan-provider";
import { useApp } from "../../state/app";
import { NavBar } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { useT } from "../../ui/text";

/**
 * Clerk tabs: Scan, Outbox (register §4). The offline outbox, the cash list and the treasurer's rescan requests open
 * here, for clerk phones only, so no other role ever opens the outbox database.
 */
export default function ClerkTabs() {
  const { session } = useApp();
  const t = useT();
  if (session?.role !== "clerk") return <Redirect href="/" />;
  return (
    <OutboxProvider>
      <CashDayProvider>
        <RescanProvider>
          <Tabs tabBar={(p) => <NavBar {...p} />} screenOptions={{ headerShown: false, animation: "none" }}>
            <Tabs.Screen
              name="scan"
              options={{
                title: t("tab.scan"),
                tabBarIcon: ({ color }) => <Glyph name="scan" color={color} />,
              }}
            />
            <Tabs.Screen
              name="outbox"
              options={{
                title: t("tab.outbox"),
                tabBarIcon: ({ color }) => <OutboxTabIcon color={color} />,
              }}
            />
          </Tabs>
        </RescanProvider>
      </CashDayProvider>
    </OutboxProvider>
  );
}
