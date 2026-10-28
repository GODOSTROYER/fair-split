import { Stack, useLocalSearchParams } from "expo-router";
import { CosignProvider } from "../../../../features/board/cosign-context";
import { requestScope } from "../../../../features/board/cosign-model";
import { identityKey } from "../../../../services/session";
import { useApp } from "../../../../state/app";
import { useFs } from "../../../../theme/theme";

/**
 * One co-sign request: M-BD-01 and its sign sheet M-BD-02 share one fetch, one SSE stream and the hash the Chair
 * opened (I4). The sheet rises from the bottom and the system Back returns to the request. The request starts over
 * for another run, and for anyone else paired on this phone (`requestScope`): what one officer opened is not another's.
 */
export default function RunLayout() {
  const { runSlug } = useLocalSearchParams<{ runSlug: string }>();
  const { session } = useApp();
  const { t } = useFs();
  return (
    <CosignProvider
      key={requestScope(runSlug ?? "", session ? identityKey(session) : null)}
      runSlug={runSlug ?? ""}
    >
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.color.ground },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen
          name="sign"
          options={{ animation: "slide_from_bottom", gestureDirection: "vertical" }}
        />
      </Stack>
    </CosignProvider>
  );
}
