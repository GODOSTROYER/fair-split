import { SCREENS } from "@fairsplit/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useDocumentTitle } from "../chrome/Fallbacks.js";
import { Surface } from "../chrome/Surface.js";
import { Screen } from "../screens/W-AU-01/index.js";

// W-AU-01 /sign-in: real accounts are P2 (plan, "Cut"); the route answers so the register's route exists.
export const Route = createFileRoute("/sign-in")({
  component: function SignInRoute() {
    useDocumentTitle(SCREENS["W-AU-01"].name);
    return (
      <Surface theme="adlaw" className="fsc-surface fsc-surface--centered">
        <Screen />
      </Surface>
    );
  },
});
