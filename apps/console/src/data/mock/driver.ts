// Drives the mock world the way people would, without the UI: each step is the IC-01 command a screen or a
// phone would send, run as that person (the treasurer's console, the Chair's phone) against the world itself.
// Tests use it to bring a run to any state in a line; `vite dev` exposes it as `window.__fsMock.driver` (the
// Chair's co-sign while no Chair frame is attached). Requests are parsed with their contract schemas first, so
// a step the API would refuse with 400 is refused here too.

import type { CommandData, CommandRequest, JsonCommandName } from "@fairsplit/api-client";
import {
  MOCK_CONSOLE_TOKEN,
  type MockCaller,
  type MockWorld,
  mockHex,
  mockId,
} from "@fairsplit/api-client/msw";
import { API_COMMANDS, type ApprovalRole, type RunEvent } from "@fairsplit/contracts";

/** The judge's console acts as Analyn, the treasurer (S3.8). */
export const TREASURER: MockCaller = { token: MOCK_CONSOLE_TOKEN, persona: "analyn", role: "treasurer" };
/** Ernesto, the Chair, signing from his phone (the second key). */
export const CHAIR: MockCaller = { token: null, persona: "ernesto", role: "board" };

/** Each approver's session-only demo key (S3.8: `fs-{persona}-w{n}`). */
export const DEMO_KEYS: Readonly<Record<ApprovalRole, string>> = {
  treasurer: "fs-analyn-w1",
  chair: "fs-ernesto-w1",
};

export type StepArgs<N extends JsonCommandName> = {
  readonly params?: Readonly<Record<string, string>>;
  readonly as?: MockCaller;
} & ((typeof API_COMMANDS)[N]["method"] extends "GET"
  ? { readonly query?: CommandRequest<N> }
  : { readonly body?: CommandRequest<N> });

export interface MockDriver {
  /** Runs one command as a person (the treasurer by default) and returns its answer. Throws MockProblem. */
  command<N extends JsonCommandName>(name: N, args?: StepArgs<N>): CommandData<N>;
  /** J1's first press: Lantern Bay's invoice is marked paid; reading follows. */
  markPaid(): CommandData<"markPaid">;
  /** W-TR-04: the by-hand value for slip 0462's gross (the net derives from it). */
  enterByHand(value?: string): CommandData<"enterField">;
  /** W-TR-06: decides a hold by its label (H1, H2, H3) with the decision the hero path makes by default. */
  resolve(label: string, body?: CommandRequest<"resolveHold">): CommandData<"resolveHold">;
  /** Every open hold decided the way the hero path decides them, and slip 0462 entered. */
  resolveAll(): void;
  /** W-TR-07: builds the approval payload for a role and signs it with that role's demo key. */
  sign(role: ApprovalRole): CommandData<"submitApproval">;
  /** The Chair's key (the second signature). */
  cosign(): CommandData<"submitApproval">;
  /** W-TR-08: moves a parked member's line to cash (Rhea's beat). */
  payCash(memberNo: string): CommandData<"payCash">;
  holdId(label: string): string;
  /** The by-hand field of slip 0462 (`gross_kg` by default). */
  fieldId(field?: "gross_kg" | "net_kg"): string;
  lineId(memberNo: string): string;
  /** The world's events after an SSE ID (all of them for null), oldest first. */
  eventsAfter(lastEventId: string | null): RunEvent[];
}

/** How the hero path decides each hold (S1 W-TR-06). */
export const HERO_DECISIONS: Readonly<Record<"H1" | "H2" | "H3", CommandRequest<"resolveHold">>> = {
  H1: { resolution: "COUNT_ONCE" },
  H2: { resolution: "REGISTER_PLOT", plot: { plotNo: "P-053-B", areaHa: "0.80", trees: 120 } },
  H3: { resolution: "RETURN_AS_CREDIT" },
};

export interface MockDriverOptions {
  /** Play the asynchronous steps each command queues (reading, the fan-out) before returning. Default true. */
  readonly settle?: boolean;
}

export function createMockDriver(world: MockWorld, options: MockDriverOptions = {}): MockDriver {
  const settle = options.settle ?? true;

  function command<N extends JsonCommandName>(
    name: N,
    args: StepArgs<N> = {} as StepArgs<N>,
  ): CommandData<N> {
    const def = API_COMMANDS[name];
    const loose = args as {
      params?: Record<string, string>;
      query?: unknown;
      body?: unknown;
      as?: MockCaller;
    };
    const raw = def.method === "GET" ? (loose.query ?? {}) : (loose.body ?? {});
    const input = (def.request ? def.request.parse(raw) : undefined) as never;
    const outcome = world.execute(name, {
      params: { ...(loose.params ?? {}) },
      input,
      caller: loose.as ?? TREASURER,
      headers: { idempotencyKey: null },
    });
    if (settle) world.settle();
    return outcome.body;
  }

  const runSlug = () => world.runSlug;

  const holdId = (label: string): string => {
    const hold = world.hold(label);
    if (!hold) throw new Error(`The mock world has no hold ${label}.`);
    return hold.id;
  };

  const lineId = (memberNo: string): string => {
    const line = world.line(memberNo);
    if (!line) throw new Error(`The mock world has no line for ${memberNo}.`);
    return line.id;
  };

  const fieldId = (field: "gross_kg" | "net_kg" = "gross_kg") => mockId(`field:0462:${field}`);

  function sign(role: ApprovalRole): CommandData<"submitApproval"> {
    const as = role === "treasurer" ? TREASURER : CHAIR;
    const { payload } = command("approvalPayload", { params: { runSlug: runSlug() }, query: { role }, as });
    const signature = mockHex(`sig:${payload.nonce}:1`, 32) + mockHex(`sig:${payload.nonce}:2`, 32);
    return command("submitApproval", {
      params: { runSlug: runSlug() },
      body: { role, keyId: DEMO_KEYS[role], signature, payload },
      as,
    });
  }

  const driver: MockDriver = {
    command,
    markPaid: () => command("markPaid", { params: { runSlug: runSlug() } }),
    enterByHand: (value = "64.80") =>
      command("enterField", { params: { fieldId: fieldId() }, body: { value } }),
    resolve: (label, body) => {
      const decision = body ?? HERO_DECISIONS[label as keyof typeof HERO_DECISIONS];
      if (!decision) throw new Error(`No default decision for ${label}; pass one.`);
      return command("resolveHold", { params: { holdId: holdId(label) }, body: decision });
    },
    resolveAll() {
      const gross = world.fields().find((f) => f.id === fieldId());
      if (gross && gross.finalValue === null) driver.enterByHand();
      for (const label of ["H1", "H2", "H3"] as const) {
        if (world.hold(label)?.state === "OPEN") driver.resolve(label);
      }
    },
    sign,
    cosign: () => sign("chair"),
    payCash: (memberNo) => command("payCash", { params: { lineId: lineId(memberNo) } }),
    holdId,
    fieldId,
    lineId,
    eventsAfter: (lastEventId) => {
      const after = lastEventId === null ? 0 : Number(lastEventId);
      return world.events().filter((e) => Number(e.id) > after);
    },
  };
  return driver;
}
