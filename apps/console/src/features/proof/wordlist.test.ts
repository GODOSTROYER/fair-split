// S1.11's word list for PayPal activity on the sandbox or the simulator: never "live", "real" or "verified".
// The Proof hero's source line and /ops's notices caption describe PayPal's notices, which on this build come
// from the simulated sandbox (or the PayPal sandbox): each is checked word by word.

import { describe, expect, it } from "vitest";
import { OPS_COPY } from "../ops/OpsPage.js";
import { STATE_COPY } from "./copy.js";

const BLOCKED = /\b(live|real|verified)\b/i;

describe("inv.i8 word list: PayPal notices", () => {
  it("the Proof hero's source line never calls the notices live", () => {
    expect(STATE_COPY.sourceSession).not.toMatch(BLOCKED);
    expect(STATE_COPY.sourcePublic).not.toMatch(BLOCKED);
  });

  it("/ops's notices caption never calls the session's stream live", () => {
    expect(OPS_COPY.notices).not.toMatch(BLOCKED);
    expect(OPS_COPY.noticesSession).not.toMatch(BLOCKED);
    expect(OPS_COPY.noticesSeason("2026A-r37")).not.toMatch(BLOCKED);
  });
});
