// Provenance footers (S1.5, design §2.5 "Print"): every printed value says who made it. One function, so the
// words never drift between screens, and so nothing simulated is ever unlabelled (I8): under the simulated
// rail (ADR-0002) a PayPal footer says so and never claims "verified" (S1.11's CI word list).

import type { Provenance } from "@fairsplit/contracts";
import type { PaypalRail } from "./env.js";
import { format } from "./format.js";

export const CLAUDE_MODEL = "claude-opus-5-5";
export const ENGINE_VERSION = "v1";

export type FooterInput =
  /** Claude's readings and drafts; `replayOf` is the recording's ISO date when this is a replay. */
  | { readonly kind: "claude"; readonly model?: string; readonly replayOf?: string }
  /** The engine's figures, bound to the ratified card. */
  | { readonly kind: "engine"; readonly rateCardSha256: string; readonly version?: string }
  /** A person entered or decided it. */
  | { readonly kind: "person"; readonly name: string }
  /** PayPal's word on it, by how we learned it. */
  | {
      readonly kind: "paypal";
      readonly source: "webhook" | "status_check" | "post_response" | "cancel";
      readonly rail: PaypalRail;
      readonly provenance?: Provenance;
    }
  /** The seed's figures (IC-03). */
  | { readonly kind: "seeded" };

const PAYPAL_SOURCE: Readonly<Record<"webhook" | "status_check" | "post_response" | "cancel", string>> = {
  webhook: "webhook",
  status_check: "status check",
  post_response: "PayPal's answer to the batch",
  cancel: "our cancel",
};

export function provenanceFooter(input: FooterInput): string {
  switch (input.kind) {
    case "claude": {
      const read = `Read by Claude (${input.model ?? CLAUDE_MODEL})`;
      return input.replayOf ? `${read}, replay of the ${format.dateShort(input.replayOf)} run` : read;
    }
    case "engine":
      return `Computed by engine ${input.version ?? ENGINE_VERSION}, rate card ${format.hashGroups(input.rateCardSha256)}`;
    case "person":
      return `Entered by ${input.name}`;
    case "paypal": {
      const simulated = input.rail === "simulator" || input.provenance === "simulated_rail";
      const source = PAYPAL_SOURCE[input.source];
      if (input.source === "webhook") {
        return simulated
          ? "Simulated PayPal sandbox, webhook, signature checked"
          : "PayPal, webhook, signature verified";
      }
      return simulated ? `Simulated PayPal sandbox, ${source}` : `PayPal, ${source}`;
    }
    case "seeded":
      return "Seeded sample";
  }
}
