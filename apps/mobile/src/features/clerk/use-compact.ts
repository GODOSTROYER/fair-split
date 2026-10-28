import { useWindowDimensions } from "react-native";

/**
 * S1.12: from font scale 1.3 (Android scales text non-linearly up to 2×), or on a narrow window (a browser zoomed
 * to 200%), rows stack into one column so no word, amount or stamp is ever clipped.
 */
export function useCompact(): boolean {
  const { width, fontScale } = useWindowDimensions();
  return width < 340 || fontScale > 1.3;
}
