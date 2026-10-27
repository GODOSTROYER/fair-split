// src/routes/season: owned by the RUNS slice (apps/api/SPLIT.md).
// Season reads for W-TR-01 (the season page and its run strip), W-TR-03 (the reading room, `?photo=B`) and
// W-TR-04 (one slip by hand). The season is addressed by its label or code ("2026-A" or "2026A").
import { SlipSerial } from "@fairsplit/contracts";
import { defineRouteFolder } from "../../lib/slice.js";
import { allow, CAN } from "../../runs/access.js";
import { SeasonParam, SeasonView, SlipList, SlipQuery, seasonView, slipList } from "../../runs/reads.js";

export default defineRouteFolder({
  folder: "season",
  commands: {},
  routes: (r) => {
    r.route(
      {
        method: "GET",
        path: "/v1/seasons/:seasonCode",
        auth: "frame_or_session",
        name: "season",
        summary: "A season: co-op, lot, rate card, runs and the latest run's strip (W-TR-01)",
        params: { seasonCode: SeasonParam },
        response: SeasonView,
      },
      async (ctx) => {
        allow(ctx.credential, CAN.readRuns, "Reading the season");
        return seasonView(ctx.deps, ctx.scope, ctx.params.seasonCode);
      },
    );
    r.route(
      {
        method: "GET",
        path: "/v1/seasons/:seasonCode/slips",
        auth: "frame_or_session",
        name: "slips",
        summary: "Slip rows with both reads of every field (W-TR-03; `?photo=B` for one photo)",
        params: { seasonCode: SeasonParam },
        request: SlipQuery,
        response: SlipList,
      },
      async (ctx) => {
        allow(ctx.credential, CAN.readRuns, "Reading slips");
        return slipList(
          ctx.deps,
          ctx.scope,
          ctx.params.seasonCode,
          ctx.input.photo ? { photo: ctx.input.photo } : {},
        );
      },
    );
    r.route(
      {
        method: "GET",
        path: "/v1/seasons/:seasonCode/slips/:serial",
        auth: "frame_or_session",
        name: "slip",
        summary: "One slip by serial, every copy of it, with its fields (W-TR-04 By hand)",
        params: { seasonCode: SeasonParam, serial: SlipSerial },
        response: SlipList,
      },
      async (ctx) => {
        allow(ctx.credential, CAN.readRuns, "Reading a slip");
        return slipList(ctx.deps, ctx.scope, ctx.params.seasonCode, { serial: ctx.params.serial });
      },
    );
  },
});
