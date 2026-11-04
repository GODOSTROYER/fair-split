// The judge session as the last live slot of the hour leaves it: the quota now reads "replay, hourly_cap", while
// the run that took the slot keeps its own simulated payout evidence. Shared by the payout-honesty tests, so the
// live cases always run against the quota that tempted surfaces to relabel them.

import type { PayRunState } from "@fairsplit/contracts";
import { getResponse, HttpResponse, http } from "msw";
import type { TestWorld } from "./world.js";

export function hourlyCapSession(
  world: TestWorld,
  options: { readonly runState?: PayRunState; readonly onRead?: () => void } = {},
) {
  return http.get("*/v1/judge/session", async ({ request }) => {
    const response = await getResponse([...world.mock.handlers], request);
    const body = (await response?.json()) as Record<string, unknown>;
    options.onRead?.();
    return HttpResponse.json({
      ...body,
      ...(options.runState ? { runState: options.runState } : {}),
      rail: {
        ...(body.rail as object),
        mode: "replay",
        reason: "hourly_cap",
        label: "Replay: this hour is full",
      },
    });
  });
}
