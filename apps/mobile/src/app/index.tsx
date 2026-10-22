import { Redirect } from "expo-router";
import { runSlug } from "../_shims/seed";
import { HREF, homeHref } from "../services/session";
import { useApp } from "../state/app";

/**
 * The front door (register §4): first run, then pairing, then the role's home. The onboarding flow decides its own
 * steps and calls `completeOnboarding()`; this only knows "not onboarded", "not paired" and "paired as …".
 */
export default function Index() {
  const { onboarded, session } = useApp();
  if (!onboarded) return <Redirect href={HREF.language} />;
  if (!session) return <Redirect href={HREF.pair} />;
  // TEMPORARY: the board's open run comes from the co-sign push or the workspace feed once WS-API lands.
  return <Redirect href={homeHref(session.role, runSlug)} />;
}
