/**
 * NetInfo's state, reduced to one boolean (pure, so it is unit-tested without the native module).
 * `isInternetReachable` is null until NetInfo has probed; trust `isConnected` until then.
 */
export function isOnlineState(s: {
  isConnected: boolean | null;
  isInternetReachable?: boolean | null;
}): boolean {
  if (s.isConnected === false) return false;
  return s.isInternetReachable !== false;
}
