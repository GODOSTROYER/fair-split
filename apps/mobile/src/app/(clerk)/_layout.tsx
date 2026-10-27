import { Redirect, Tabs } from "expo-router";
import { CashDayProvider } from "../../features/clerk/cash-provider";
import { OutboxProvider, useOutbox } from "../../features/clerk/outbox-provider";
import { OutboxTabIcon } from "../../features/clerk/outbox-tab-icon";
import { RescanProvider } from "../../features/clerk/rescan-provider";
import { useT } from "../../features/clerk/use-t";
import { summarise } from "../../lib/outbox";
import { useApp } from "../../state/app";
import { NavBar } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";

/**
 * Clerk tabs: Scan, Outbox (register §4). The offline outbox, the cash list and the treasurer's rescan requests open
 * here, for clerk phones only, so no other role ever opens the outbox database.
 */
export default function ClerkTabs() {
  const { session } = useApp();
  if (session?.role !== "clerk") return <Redirect href="/" />;
  return (
    <OutboxProvider>
      <CashDayProvider>
        <RescanProvider>
          <ClerkTabBar />
        </RescanProvider>
      </CashDayProvider>
    </OutboxProvider>
  );
}

/** Inside the outbox, so the Outbox tab tells a screen reader its badge: "Outbox, 3 on this phone". */
function ClerkTabBar() {
  const t = useT();
  const onPhone = summarise(useOutbox().records).onPhone;
  return (
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
          tabBarAccessibilityLabel: onPhone > 0 ? t("M-CL-02.badgeSr", { n: onPhone }) : undefined,
          tabBarIcon: ({ color }) => <OutboxTabIcon color={color} />,
        }}
      />
    </Tabs>
  );
}
