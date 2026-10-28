/**
 * `/(member)/paminawa`, the Paminawa sheet as a modal over the member's tabs (register §4). `?auto=1` comes from
 * the statement when the member chose "Paminawon una": the reading starts by itself (never under TalkBack).
 */
import { router, useLocalSearchParams } from "expo-router";
import { HREF } from "../../services/session";
import { PaminawaPanel } from "./paminawa-panel";

export function PaminawaScreen() {
  const { auto } = useLocalSearchParams<{ auto?: string }>();
  return (
    <PaminawaPanel
      auto={auto === "1"}
      onClose={() => (router.canGoBack() ? router.back() : router.replace(HREF.bayad))}
    />
  );
}
