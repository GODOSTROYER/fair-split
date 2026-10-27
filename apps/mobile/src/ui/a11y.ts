/**
 * Accessibility helpers the screens share (S1.12: TalkBack, NVDA, 200% text and font scale 2.0 pass by G5).
 *
 * - `focusFirst(ref)`: S1.9's "the amount block takes first accessibility focus (native `setAccessibilityFocus`;
 *   DOM focus on web)". Call it once the content is on screen.
 * - `announce(text)`: a polite announcement for a change that has no focus of its own ("Bayad na").
 */
import type { RefObject } from "react";
import { AccessibilityInfo, findNodeHandle, Platform, type ViewInstance } from "react-native";

/** Gives a view first focus after a short settle, so the screen reader lands on it rather than the top bar. */
export function focusFirst(ref: RefObject<ViewInstance | null>, delayMs = 400): () => void {
  const id = setTimeout(() => {
    const node = ref.current;
    if (!node) return;
    if (Platform.OS === "web") {
      const el = node as unknown as {
        focus?: (o?: { preventScroll?: boolean }) => void;
        setAttribute?: (k: string, v: string) => void;
        style?: { outline?: string };
      };
      el.setAttribute?.("tabindex", "-1");
      // A landing point for the screen reader, not a control: browsers ring a scripted focus on page load, which
      // drew a black frame around the hero amount. Controls keep their own focus ring; Tab moves on from here.
      if (el.style) el.style.outline = "none";
      el.focus?.({ preventScroll: true });
      return;
    }
    const handle = findNodeHandle(node);
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
  }, delayMs);
  return () => clearTimeout(id);
}

export function announce(text: string): void {
  AccessibilityInfo.announceForAccessibility(text);
}
