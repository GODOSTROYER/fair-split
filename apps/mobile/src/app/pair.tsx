import { useLocalSearchParams } from "expo-router";
import { PairScreen } from "../features/onboarding/pair-screen";

/**
 * The pairing QR's target: `/app/pair?t=…` on the web (register §4) and `fairsplit://pair?t=…` on Android.
 * S3's fragment form `#t=…` is read too, so the token never has to reach a server log.
 */
export default function PairLink() {
  const { t } = useLocalSearchParams<{ t?: string }>();
  let token = typeof t === "string" ? t : undefined;
  if (!token && typeof window !== "undefined" && window.location?.hash) {
    token = new URLSearchParams(window.location.hash.slice(1)).get("t") ?? undefined;
  }
  return <PairScreen initialToken={token} />;
}
