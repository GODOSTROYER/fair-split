import { Redirect, Stack } from "expo-router";
import { StatementProvider } from "../../features/statement/statement-store";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";

/**
 * Member area: the three tabs, plus Paminawa (M-MB-03) presented over them as a modal (register §4). Every member
 * screen shares one statement: one read, one offline copy and one live `line:` stream (`StatementProvider`).
 */
export default function MemberLayout() {
  const { session } = useApp();
  const { t } = useFs();
  if (!session) return <Redirect href="/" />;
  return (
    <StatementProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.color.ground } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="paminawa" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
      </Stack>
    </StatementProvider>
  );
}
