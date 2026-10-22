import { Stack } from "expo-router";
import { useFs } from "../../../theme/theme";

export default function PirmaStack() {
  const { t } = useFs();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.color.ground },
        animation: "slide_from_right",
      }}
    />
  );
}
