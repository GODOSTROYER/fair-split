// W-JG-01 Judge stage, first view (S1.6): the showcase snapshot with Claude's recorded invoice draft in pencil,
// no calls until the first press, which starts the session. The stage extras add "Play it for me" to the run
// pill and its cursor to the stage overlay. The screen is the season slice's (features/judge); this module
// keeps the route contract (screens/contract.ts).

import { StageAutoplay } from "../../features/judge/Autoplay.js";
import { FirstView } from "../../features/judge/FirstView.js";
import type { JudgeScreenProps, StageExtrasProps } from "../contract.js";

export function Screen(_props: JudgeScreenProps) {
  return <FirstView />;
}

/** Always mounted inside the stage: "Play it for me" and its cursor (ChromePortal). */
export function StageExtras(_props: StageExtrasProps) {
  return <StageAutoplay />;
}
