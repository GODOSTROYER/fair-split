// Whether the browser says it is online (S1.7 `offline` states). Read through useSyncExternalStore so every
// season screen agrees, and the server snapshot is "online" (nothing renders offline before it is known).

import { useSyncExternalStore } from "react";

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}
