import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { PairScreen } from "../features/onboarding/pair-screen";

/**
 * The pairing QR's target: `/app/pair?t=…` on the web (register §4) and `fairsplit://pair?t=…` on Android.
 * S3's fragment form `#t=…` is read too, so the token never has to reach a server log. Once read, the token is
 * taken out of the address bar and the history entry (it is single-use, but it should not be left lying around).
 */
export default function PairLink() {
  const { t } = useLocalSearchParams<{ t?: string }>();
  const [token] = useState(() => {
    if (typeof t === "string") return t;
    if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.hash) {
      return new URLSearchParams(window.location.hash.slice(1)).get("t") ?? undefined;
    }
    return undefined;
  });

  // The router syncs the URL asynchronously after mount and may write the token back: clean it a few times during the
  // first second, and only while the address still carries it.
  useEffect(() => {
    if (!token || Platform.OS !== "web" || typeof window === "undefined") return;
    const clean = () => {
      try {
        const { hash, search, pathname } = window.location;
        if (/[?#&]t=/.test(`${search}${hash}`)) {
          window.history.replaceState(window.history.state, "", pathname);
        }
      } catch {
        // A sandboxed frame may refuse; the token is single-use either way.
      }
    };
    const ids = [0, 250, 600, 1200].map((ms) => setTimeout(clean, ms));
    return () => {
      for (const id of ids) clearTimeout(id);
    };
  }, [token]);

  return <PairScreen initialToken={token} />;
}
