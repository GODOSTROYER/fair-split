import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SCREEN_STATES } from "../../_shims/contracts";
import { MOMENTS } from "../../_shims/moments";
import type { CosignFailure } from "../../lib/signing";
import type { HoldState } from "../../ui/hold";
import type { RequestStatus } from "./cosign-model";
import {
  amountStateFor,
  BUSY,
  type FlowEvent,
  type FlowPhase,
  failureCue,
  flowReducer,
  SIGN_MOMENT_PHASE,
  SIGN_SCREEN_STATE,
  type SignPhase,
  sealKeys,
  signPhase,
  slabLive,
} from "./sign-flow";

const run = (events: FlowEvent[], from: FlowPhase = "idle") => events.reduce(flowReducer, from);
const hold = (state: HoldState): FlowEvent => ({ type: "hold", state });

describe("M-BD-02 flow (MM-5, the second key)", () => {
  it("holds, arms, signs on release, then seals and inks", () => {
    const steps: FlowPhase[] = [];
    let p: FlowPhase = "idle";
    for (const e of [
      hold("holding"),
      hold("armed"),
      hold("committed"),
      { type: "commit" },
      { type: "result", ok: true },
      { type: "sealed" },
      { type: "inked" },
    ] as FlowEvent[]) {
      p = flowReducer(p, e);
      steps.push(p);
    }
    expect(steps).toEqual(["holding", "armed", "armed", "biometric", "signed", "sealed", "inked"]);
    const shown = steps.map((s) => SIGN_MOMENT_PHASE[signPhase("request", true, s)]);
    expect(shown).toEqual(["hold-2", "armed-2", "armed-2", "armed-2", "signed-2", "sealed", "inked"]);
  });

  it("inv.i6.release-inside: nothing is signed before a full hold released inside, or the dialog", () => {
    expect(run([{ type: "commit" }])).toBe("idle");
    expect(run([hold("holding"), { type: "commit" }])).toBe("holding");
    expect(run([hold("holding"), hold("released-early"), { type: "commit" }])).toBe("released-early");
    expect(run([hold("holding"), hold("armed"), hold("disarmed"), { type: "commit" }])).toBe("disarmed");
    expect(run([hold("confirm"), { type: "commit" }])).toBe("biometric");
  });

  it("inv.i6.release-inside (property): any event order reaches the key only from armed or the dialog", () => {
    const events: FlowEvent[] = [
      hold("rest"),
      hold("holding"),
      hold("armed"),
      hold("confirm"),
      hold("released-early"),
      hold("disarmed"),
      hold("committed"),
      { type: "commit" },
      { type: "result", ok: false, state: "cancelled" },
      { type: "reset" },
    ];
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...events), { maxLength: 30 }), (seq) => {
        let p: FlowPhase = "idle";
        for (const e of seq) {
          const next = flowReducer(p, e);
          if (next === "biometric" && p !== "biometric") {
            expect(e.type).toBe("commit");
            expect(["armed", "confirm"]).toContain(p);
          }
          p = next;
        }
      }),
      { numRuns: 300 },
    );
  });

  it.each([
    ["cancelled", "cancelled", "cancelled"],
    ["mismatch", "mismatch", "mismatch"],
    ["offline", "offline", "offline"],
    ["no-lock", "no-lock", "no-lock"],
    ["invalidated", "invalidated", "invalidated"],
    ["locked-out", "locked-out", "error"],
    ["error", "error", "error"],
    ["stale", "ready", "ready"],
  ] as const)("a %s outcome shows %s (data-state %s), with nothing signed", (state, phase, dataState) => {
    const after = run([
      hold("holding"),
      hold("armed"),
      { type: "commit" },
      { type: "result", ok: false, state },
    ]);
    const shown = signPhase("request", true, after);
    expect(shown).toBe(phase);
    expect(SIGN_SCREEN_STATE[shown]).toBe(dataState);
  });

  it("a cancelled fingerprint springs the slab back: the next hold starts afresh", () => {
    const cancelled = run(
      [hold("armed"), { type: "commit" }, { type: "result", ok: false, state: "cancelled" }],
      "holding",
    );
    expect(slabLive(signPhase("request", true, cancelled))).toBe(true);
    expect(flowReducer(cancelled, hold("holding"))).toBe("holding");
  });

  it("ignores a stray result, a hold or a reset while the signature is under way or done", () => {
    for (const busy of BUSY) {
      expect(flowReducer(busy, hold("holding"))).toBe(busy);
      expect(flowReducer(busy, { type: "reset" })).toBe(busy);
    }
    expect(run([{ type: "result", ok: true }])).toBe("idle");
    expect(run([{ type: "sealed" }, { type: "inked" }])).toBe("idle");
  });

  it("shows the end state, without replaying the moment, when the key went in from elsewhere", () => {
    expect(flowReducer("idle", { type: "remote-signed" })).toBe("inked");
    expect(flowReducer("biometric", { type: "remote-signed" })).toBe("biometric");
  });
});

describe("joining the request's status", () => {
  it.each([
    ["loading", "loading"],
    ["changed", "mismatch"],
    ["expired", "expired"],
    ["offline", "offline"],
    ["signed", "inked"],
    ["sent-back", "declined"],
    ["none", "closed"],
    ["error", "closed"],
  ] as const)("a %s request shows %s", (request, phase) => {
    expect(signPhase(request, true, "idle")).toBe(phase);
  });

  it("waits for key 1 before the slab can be held", () => {
    expect(signPhase("request", false, "idle")).toBe("waiting");
    expect(slabLive("waiting")).toBe(false);
    expect(SIGN_MOMENT_PHASE.waiting).toBe("blocked");
    expect(signPhase("override", true, "idle")).toBe("ready");
  });

  it("keeps a signature in flight on screen even if the request changes under it", () => {
    expect(signPhase("changed", true, "biometric")).toBe("biometric");
    expect(signPhase("offline", true, "sealed")).toBe("sealed");
  });

  it("refuses to hold a changed, expired or offline request", () => {
    for (const request of ["changed", "expired", "offline"] as RequestStatus[]) {
      expect(slabLive(signPhase(request, true, "idle"))).toBe(false);
    }
  });
});

describe("contracts", () => {
  const phases = Object.keys(SIGN_SCREEN_STATE) as SignPhase[];

  it("every phase has a data-state from IC-01 and an MM-5 phase from IC-10", () => {
    for (const p of phases) {
      expect(SCREEN_STATES["M-BD-02"]).toContain(SIGN_SCREEN_STATE[p]);
      expect(MOMENTS["MM-5"]).toContain(SIGN_MOMENT_PHASE[p]);
    }
    expect(Object.keys(SIGN_MOMENT_PHASE).sort()).toEqual([...phases].sort());
  });

  it("reaches every S1.9 M-BD-02 state", () => {
    const reached = new Set(phases.map((p) => SIGN_SCREEN_STATE[p]));
    for (const s of ["ready", "holding", "biometric", "signed", "cancelled", "mismatch"]) {
      expect(reached).toContain(s);
    }
  });

  it("amounts stay pencil until the seal lands, and the seal shows the keys that are in", () => {
    expect(amountStateFor("signed")).toBe("pencil");
    expect(amountStateFor("inked")).toBe("ink");
    expect(sealKeys("ready", true)).toBe(1);
    expect(sealKeys("waiting", false)).toBe(0);
    expect(sealKeys("signed", true)).toBe(2);
  });

  it("maps every cosign failure to a phase", () => {
    const failures: CosignFailure[] = [
      "offline",
      "mismatch",
      "stale",
      "cancelled",
      "no-lock",
      "invalidated",
      "locked-out",
      "error",
    ];
    for (const state of failures) {
      const p = flowReducer("biometric", { type: "result", ok: false, state });
      expect(SCREEN_STATES["M-BD-02"]).toContain(SIGN_SCREEN_STATE[signPhase("request", true, p)]);
    }
  });
});

describe("the sound of a refusal (S2.9 MM-5)", () => {
  it("clacks only for a hash or lines digest the phone refused, never for a cancel or a lost connection", () => {
    expect(failureCue("mismatch")).toBe("seal.mismatch");
    for (const quiet of [
      "offline",
      "stale",
      "cancelled",
      "no-lock",
      "invalidated",
      "locked-out",
      "error",
    ] as const) {
      expect(failureCue(quiet), quiet).toBeNull();
    }
  });
});
