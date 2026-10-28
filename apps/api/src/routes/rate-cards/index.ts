// src/routes/rate-cards: owned by the RUNS slice (apps/api/SPLIT.md).
// Rate-card read and ratify; any edit to a ratified card answers 409 RATE_CARD_RATIFIED citing the hash the
// database trigger raised (MM-4 "Bolted").
import { defineRouteFolder } from "../../lib/slice.js";
import { allow, CAN } from "../../runs/access.js";
import {
  addDeductionHandler,
  RateCardView,
  RatifyRequest,
  rateCardView,
  ratify,
} from "../../runs/ratecard.js";

export default defineRouteFolder({
  folder: "rate-cards",
  commands: {
    addDeduction: addDeductionHandler,
  },
  routes: (r) => {
    r.route(
      {
        method: "GET",
        path: "/v1/rate-cards/:id",
        auth: "frame_or_session",
        name: "rateCard",
        summary: "The rate card, its canonical Schedule A, hash and ratifications (W-TR-02)",
        response: RateCardView,
      },
      async (ctx) => {
        allow(ctx.credential, CAN.readRuns, "Reading the rate card");
        return rateCardView(ctx.deps, ctx.scope, ctx.params.id);
      },
    );
    r.route(
      {
        method: "POST",
        path: "/v1/rate-cards/:id/ratify",
        auth: "frame_or_session",
        name: "ratify",
        summary: "One board signature on the card; the Secretary's and the Chair's together bolt it",
        request: RatifyRequest,
        response: RateCardView,
        errors: ["RATE_CARD_RATIFIED", "VERSION_CONFLICT"],
      },
      async (ctx) => ratify(ctx.deps, ctx.scope, ctx.credential, ctx.params.id, ctx.input.role, ctx.now()),
    );
  },
});
