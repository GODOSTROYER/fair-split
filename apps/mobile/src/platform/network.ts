/** Connectivity for the offline outbox and the "Signing needs a connection" rule (NetInfo on every platform). */
import NetInfo, { useNetInfo } from "@react-native-community/netinfo";

/** `isInternetReachable` is null until NetInfo has probed; trust `isConnected` until then. */
export function isOnlineState(s: {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}): boolean {
  if (s.isConnected === false) return false;
  return s.isInternetReachable !== false;
}

export function useOnline(): boolean {
  const s = useNetInfo();
  return isOnlineState(s);
}

export function onConnectivity(cb: (online: boolean) => void): () => void {
  return NetInfo.addEventListener((s) => cb(isOnlineState(s)));
}
