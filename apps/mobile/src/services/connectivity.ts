/**
 * Connectivity, for every role: the member's "Katapusang kopya" (last copy), the Chair's "Signing needs a
 * connection" (a signature is never queued), and the clerk's outbox sync. NetInfo on every platform.
 */
import NetInfo, { useNetInfo } from "@react-native-community/netinfo";
import { isOnlineState } from "./online-state";

export { isOnlineState } from "./online-state";

export function useOnline(): boolean {
  return isOnlineState(useNetInfo());
}

/** Calls back on every change; returns the unsubscribe. */
export function onConnectivity(cb: (online: boolean) => void): () => void {
  return NetInfo.addEventListener((s) => cb(isOnlineState(s)));
}
