// The registered product route inventory, shared by route-contract and payout-honesty sweeps.
import { webRoutes } from "@fairsplit/contracts";

const RUN = "2026A-r37";
const SEASON = "2026-A";

export const WEB_ROUTE_CASES: readonly {
  readonly path: string;
  readonly screens: readonly string[];
  readonly stage: boolean;
}[] = [
  { path: webRoutes.judge(), screens: ["W-JG-01"], stage: true },
  { path: webRoutes.season(SEASON), screens: ["W-TR-01"], stage: true },
  { path: webRoutes.rateCard(SEASON), screens: ["W-TR-02"], stage: true },
  { path: webRoutes.reading(SEASON), screens: ["W-TR-03"], stage: true },
  { path: webRoutes.reading(SEASON, "B"), screens: ["W-TR-03"], stage: true },
  { path: webRoutes.byHand(SEASON, "0462"), screens: ["W-TR-04"], stage: true },
  { path: webRoutes.split(RUN), screens: ["W-TR-05"], stage: true },
  { path: webRoutes.holdDrawer(RUN, "H1"), screens: ["W-TR-05", "W-TR-06"], stage: true },
  { path: webRoutes.memberLine(RUN, "M-014"), screens: ["W-TR-05", "W-TR-09"], stage: true },
  { path: webRoutes.approve(RUN), screens: ["W-TR-07"], stage: true },
  { path: webRoutes.fanout(RUN), screens: ["W-TR-08"], stage: true },
  { path: webRoutes.memberPrint(RUN, "M-053"), screens: ["W-TR-09"], stage: false },
  { path: webRoutes.proof(RUN), screens: ["W-PF-01"], stage: false },
  { path: "/b/fsb_0123456789abcdef.sample", screens: ["W-BR-01"], stage: false },
  { path: webRoutes.ops(), screens: ["W-OP-01"], stage: false },
  { path: webRoutes.signIn(), screens: ["W-AU-01"], stage: false },
];
