import { Redirect } from "expo-router";
import { runSlug } from "../_shims/seed";
import { homeRouteFor } from "../lib/pairing";
import { useApp } from "../state/app";

/** First run, then pairing, then the role's first tab (register §4). */
export default function Index() {
  const { langChosen, themeChosen, session } = useApp();
  if (!langChosen) return <Redirect href="/onboarding/language" />;
  if (!themeChosen) return <Redirect href="/onboarding/theme" />;
  if (!session) return <Redirect href="/onboarding/pair" />;
  // TEMPORARY: the board's current run comes from the co-sign push or the workspace feed once WS-API lands.
  return <Redirect href={homeRouteFor(session.role, runSlug) as never} />;
}
