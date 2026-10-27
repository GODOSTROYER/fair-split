import { createFileRoute, Outlet } from "@tanstack/react-router";
import { snapshotQuery } from "../data/query.js";
import { Stage } from "../stage/Stage.js";

// The Judge stage around every console route (/judge, /season/*, /runs/*): bar, rail, run pill, phone,
// ribbon. The loader warms the seeded snapshot so the first view paints without a flash, and with no calls.
export const Route = createFileRoute("/_stage")({
  loader: ({ context }) => context.runtime.client.ensureQueryData(snapshotQuery(context.runtime.adapter)),
  component: function StageLayout() {
    return (
      <Stage>
        <Outlet />
      </Stage>
    );
  },
});
