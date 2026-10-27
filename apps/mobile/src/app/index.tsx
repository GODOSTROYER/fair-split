import { Redirect } from "expo-router";
import { bootSearch } from "../platform/query";
import { carriedFlags, HREF, homeHref, withFlags } from "../services/session";
import { useApp } from "../state/app";

/**
 * The front door (register §4): first run, then pairing, then the role's home. The onboarding flow decides its own
 * steps and calls `completeOnboarding()`; this only knows "not onboarded", "not paired" and "paired as …".
 *
 * The board lands on its Pirma tab, which opens the run waiting for the Chair (or says there is nothing to sign);
 * the index never guesses a run. Demo and display flags (`?demo=&stage=&motion=`…) travel with the redirect.
 */
export default function Index() {
  const { onboarded, session } = useApp();
  if (!onboarded) return <Redirect href={HREF.language} />;
  if (!session) return <Redirect href={HREF.pair} />;
  return <Redirect href={withFlags(homeHref(session.role, null), carriedFlags(bootSearch()))} />;
}
