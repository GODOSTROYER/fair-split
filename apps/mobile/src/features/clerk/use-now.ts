import { useEffect, useState } from "react";

/**
 * The time, ticking every `everyMs` only while `live` (a retry countdown is on screen); otherwise it updates when the
 * component re-renders for another reason. Nothing ticks on a screen with nothing counting down.
 */
export function useNow(live: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [live, everyMs]);
  return live ? now : Date.now();
}
