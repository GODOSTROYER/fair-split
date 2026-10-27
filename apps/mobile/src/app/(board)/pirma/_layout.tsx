import { Stack } from "expo-router";
import { useFs } from "../../../theme/theme";

/** The Pirma tab: its index finds the open request; each run has its own stack (request, then the sign sheet). */
export default function PirmaStack() {
  const { t } = useFs();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.color.ground },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="index" options={{ animation: "none" }} />
      <Stack.Screen name="[runSlug]" />
    </Stack>
  );
}
