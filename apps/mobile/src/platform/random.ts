import { getRandomBytes } from "expo-crypto";

/** CSPRNG bytes on every platform (Android SecureRandom, iOS SecRandomCopyBytes, crypto.getRandomValues on web). */
export function randomBytes(n: number): Uint8Array {
  return getRandomBytes(n);
}
