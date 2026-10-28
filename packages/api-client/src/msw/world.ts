// The mock world behind the msw handlers: a stateful, deterministic copy of the seeded season (IC-03,
// `@fairsplit/seed`) that answers every IC-01 command with a contract-valid body and plays the hero path
// end to end, so the console and the app can be built before the API slices land:
//
//   markPaid → FUNDED → (reading replay) → IN_REVIEW with H1, H2, H3 and slip 0462 open
//   enterField(0462 gross) → by hand; the mass-balance dial opens (2.05%) → resolveHold(H1, COUNT_ONCE) clears it (1.62%)
//   approvalPayload → submitApproval(treasurer) → AWAITING_BOARD → submitApproval(chair) → APPROVED
//   → POSTING → POSTED → item.updated × 8 (7 SUCCESS, Rhea's UNCLAIMED) → payCash(Rhea) → RETURNED → OFF_RAIL_DUE → SETTLED
//
// Every change appends IC-01 RunEvents, which the SSE handlers stream with Last-Event-ID replay. Rules the
// server enforces are mirrored where a screen depends on them (blocking holds, allowed resolutions, both keys,
// digest, nonce, expiry, kill switch, forward-only states); signatures are not verified unless you pass
// `verifySignature`. Everything here is synthetic: provenance `seeded`, PayPal-derived values
// `simulated_rail`, and the X-FS-Rail header `simulated`.
import type {
  ApprovalDTO,
  ApprovalPayload,
  ApprovalRole,
  EngineLine,
  ErrorCode,
  HoldDTO,
  HoldKind,
  HoldResolutionKind,
  InvoiceStatus,
  MemberLineDTO,
  MemberLineState,
  PayoutItemStatus,
  PayRunState,
  ProofBundle,
  ReviewRequestDTO,
  Role,
  RunEvent,
  RunEventPayload,
  RunEventType,
  SlipFieldDTO,
  SnapshotHold,
  SystemFlagDTO,
  SystemFlagName,
} from "@fairsplit/contracts";
import { PAYOUT_ITEM_RANK } from "@fairsplit/contracts";
import { getLogbook, getMembers, getSnapshot } from "@fairsplit/seed";
import canonicalize from "canonicalize";
import { sha256Hex } from "../bytes.js";
import {
  type CommandData,
  type CommandRequest,
  errorCodesOf,
  type JsonCommandName,
  type RailLabel,
} from "../http.js";
import { freshId, mockHex, mockId, mockToken } from "./ids.js";

/**
 * IC-02 `linesDigest` as the API signs it: sha256 of the JCS of every member line as `{memberNo, lineSha256}`,
 * sorted by member number (domain `linesRootJcs`; a UI package computes it here, register section 6).
 */
export function linesDigestOf(lines: readonly { memberNo: string; lineSha256: string }[]): string {
  const sorted = lines
    .map((l) => ({ memberNo: l.memberNo, lineSha256: l.lineSha256 }))
    .sort((a, b) => (a.memberNo < b.memberNo ? -1 : a.memberNo > b.memberNo ? 1 : 0));
  return sha256Hex(canonicalize(sorted) ?? "");
}

// ---------------------------------------------------------------- public types

/** Where the world starts. Each later stage is reachable from an earlier one through the commands. */
export type MockStage =
  /** Invoice sent, waiting for Lantern Bay: the Judge stage's first press (`markPaid`). */
  | "invoiced"
  /** Slips read: H1, H2, H3 and slip 0462 are open (W-TR-05/06). */
  | "review"
  /** Every hold resolved; ready for key 1 (W-TR-07). */
  | "approve"
  /** Both keys signed, batch posted, items pending (W-TR-08 before the webhooks). */
  | "posted"
  /** The seeded end state: 7 paid by PayPal, Rhea's line moved to cash, 57 cash lines due. */
  | "settled";

export interface MockWorldOptions {
  stage?: MockStage;
  /** The clock every expiry and timestamp uses (default: the real clock). */
  now?: () => Date;
  /** The rail label answered in `X-FS-Rail` (default `simulated`, ADR-0002). */
  rail?: RailLabel;
  /**
   * How the asynchronous parts (reading after funding, the fan-out after key 2) advance:
   * `auto` (default) plays them on timers `stepMs` apart; `manual` waits for `world.advance()`.
   */
  pace?: "auto" | "manual";
  /** Milliseconds between asynchronous steps in `auto` pace (default 450). */
  stepMs?: number;
  /** Origin used in pairing URLs (default `http://localhost:5173`). */
  origin?: string;
  /** Verify approval signatures (e.g. with @noble/curves against known public keys). Default: accept. */
  verifySignature?: (input: { keyId: string; payloadJcs: string; signatureHex: string }) => boolean;
}

/** A refusal the handlers turn into an IC-01 ApiError body. */
export class MockProblem extends Error {
  override readonly name = "MockProblem";
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extra: {
      retryAfterMs?: number;
      paypalDebugId?: string;
      details?: Record<string, unknown>;
      /** Top-level fields of extended shapes (RateCardRatifiedError: hash, rateCard, ratifiedOn). */
      fields?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
  }
}

/** Who is calling: resolved by the handlers from the bearer token (or the judge cookie). */
export interface MockCaller {
  token: string | null;
  persona: string;
  role: Role;
}

export interface CommandInvocation<N extends JsonCommandName> {
  params: Record<string, string>;
  input: CommandRequest<N>;
  caller: MockCaller | null;
  headers: { idempotencyKey: string | null };
}

export interface CommandOutcome<N extends JsonCommandName> {
  status: number;
  body: CommandData<N>;
}

type Listener = (event: RunEvent) => void;

export const MOCK_WORKSPACE_ID = mockId("workspace:judge-1");
export const MOCK_SESSION_ID = mockId("judge-session:1");
export const MOCK_CONSOLE_TOKEN = mockToken("fst_", "console:treasurer:analyn");

const TREASURER = { persona: "analyn", approverId: "treasurer:analyn", keyPersona: "analyn" } as const;
const CHAIR = { persona: "ernesto", approverId: "board:ernesto", keyPersona: "ernesto" } as const;
const APPROVAL_TTL_MS = 30 * 60_000;
const PAIRING_TTL_MS = 10 * 60_000;
const FRAME_TOKEN_TTL_MS = 2 * 60 * 60_000;
const DEVICE_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;
const PRESENCE_TTL_MS = 25_000;

/** Mirrors the engine's ALLOWED_RESOLUTIONS (parity-tested against `@fairsplit/domain`). */
export const MOCK_ALLOWED_RESOLUTIONS: Readonly<Record<HoldKind, readonly HoldResolutionKind[]>> = {
  DUPLICATE_SLIP: ["COUNT_ONCE", "TWO_DELIVERIES", "EXCLUDE_LINE"],
  IMPLAUSIBLE_YIELD: ["REGISTER_PLOT", "EXCLUDE_LINE"],
  NO_RULE: ["RETURN_AS_CREDIT", "APPLY_RULE", "EXCLUDE_LINE"],
  RATE_MISMATCH: ["RETURN_AS_CREDIT", "CONFIRM_AS_READ", "EXCLUDE_LINE"],
  SUSPECTED_INJECTION: ["CONFIRM_AS_READ", "EXCLUDE_LINE"],
  LOW_CONFIDENCE: ["CONFIRM_AS_READ", "EXCLUDE_LINE"],
  MASS_BALANCE: [],
};

const RUN_RANK: Readonly<Record<PayRunState, number>> = {
  DRAFT: 1,
  QUOTED: 2,
  INVOICED: 3,
  FUNDED: 4,
  EXTRACTING: 5,
  COMPUTED: 6,
  IN_REVIEW: 7,
  TREASURER_APPROVED: 8,
  AWAITING_BOARD: 9,
  APPROVED: 10,
  POSTING: 11,
  POSTED: 12,
  SETTLING: 13,
  NEEDS_FOLLOW_UP: 14,
  SETTLED: 15,
  CLOSED: 16,
  CANCELLED: 99,
  DENIED: 99,
  HALTED: 99,
};

// ---------------------------------------------------------------- internal state

interface ItemState {
  senderItemId: string;
  memberNo: string;
  amountCents: number;
  payoutItemId: string | null;
  status: PayoutItemStatus;
  /** Where the seeded run ends up (SUCCESS, or UNCLAIMED for Rhea before her cash move). */
  target: PayoutItemStatus;
}

interface PairingState {
  token: string;
  code6: string;
  persona: string;
  role: Role;
  memberNo: string | null;
  expiresAt: number;
  used: boolean;
}

interface CaptureState {
  captureId: string;
  documentId: string;
  sha256: string;
}

type Checkpoint = "read" | "byHand" | "resolved";

// ---------------------------------------------------------------- the world

export interface MockWorld {
  readonly workspaceId: string;
  readonly runId: string;
  readonly runSlug: string;
  readonly rail: RailLabel;
  readonly stage: MockStage;
  /** Current run state and version. */
  readonly run: { state: PayRunState; version: number; invoiceStatus: InvoiceStatus };
  holds(): HoldDTO[];
  hold(idOrLabel: string): HoldDTO | undefined;
  lines(): MemberLineDTO[];
  line(idOrMemberNo: string): MemberLineDTO | undefined;
  fields(): SlipFieldDTO[];
  approvals(): ApprovalDTO[];
  flags(): SystemFlagDTO[];
  events(): readonly RunEvent[];
  /** Subscribe to new events (the SSE handlers use this). Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void;
  /** Answers one command (the handlers call this after validating the request). Throws MockProblem. */
  execute<N extends JsonCommandName>(name: N, call: CommandInvocation<N>): CommandOutcome<N>;
  /** The persona a token belongs to (tokens minted by createJudgeSession and claimPairing), else null. */
  callerOf(token: string): MockCaller | null;
  /**
   * Mints a bearer token acting as `persona` (`fst_` frame/console or `fsd_` device), as the judge and auth
   * routes do (frame tokens for the stage's phones). Deterministic per persona and count.
   */
  mintToken(kind: "fst_" | "fsd_", caller: { persona: string; role: Role }): string;
  /** The origin pairing URLs and signed links use. */
  readonly origin: string;
  /** The world's clock. */
  now(): Date;
  /**
   * Makes the next call to `command` fail with `code` (a code that command can answer with).
   * For UI states that are hard to reach: `world.failNext("submitApproval", "KILL_SWITCH_ON")`.
   */
  failNext(command: JsonCommandName, code: ErrorCode, message?: string): void;
  /** Runs queued asynchronous steps now (`manual` pace). Returns how many ran. */
  advance(steps?: number): number;
  /** Runs every queued step, including the ones queued while running (bounded). */
  settle(): number;
  /** Pending asynchronous steps. */
  readonly pending: number;
  /** Back to the starting stage; clears events, sessions, pairings and captures. */
  reset(stage?: MockStage): void;
  /** Stops timers (call from test teardown in `auto` pace). */
  dispose(): void;
  /** Consumes an injected failure for `command`, if any (handlers call this before `execute`). */
  takeFailure(command: JsonCommandName): MockProblem | null;
}

export function createMockWorld(options: MockWorldOptions = {}): MockWorld {
  const snapshot = getSnapshot();
  const members = getMembers();
  const memberByNo = new Map(members.map((m) => [m.memberNo, m]));
  const seededRun = snapshot.run;
  const rail = options.rail ?? "simulated";
  const now = options.now ?? (() => new Date());
  const pace = options.pace ?? "auto";
  const stepMs = options.stepMs ?? 450;
  const origin = (options.origin ?? "http://localhost:5173").replace(/\/+$/, "");
  const runId = seededRun.id;
  const runSlug = seededRun.runSlug;
  const seasonId = snapshot.season.id;
  const rateCardSha256 = snapshot.rateCard.sha256;
  const batchSha256 = seededRun.batchSha256;
  const batchItems = seededRun.items;
  const batchTotalCents = batchItems.reduce((s, i) => s + i.amountCents, 0);
  const invoiceId = `INV2-${mockHex("invoice", 8).toUpperCase().slice(0, 4)}-${mockHex("invoice:2", 8).toUpperCase().slice(0, 4)}-${mockHex("invoice:3", 8).toUpperCase().slice(0, 4)}-${mockHex("invoice:4", 8).toUpperCase().slice(0, 4)}`;
  const lineIdOf = (memberNo: string) => mockId(`line:${runSlug}:${memberNo}`);
  const holdIdOf = (key: string) => mockId(`hold:${key}`);
  const ws = MOCK_WORKSPACE_ID;
  const slip0462 = snapshot.slips.find((s) => s.serial === "0462");
  const byHandHold = snapshot.holds.find((h) => h.kind === "LOW_CONFIDENCE");
  const massHold = snapshot.holds.find((h) => h.kind === "MASS_BALANCE");
  const logbookNet = new Map<string, string>();
  for (const page of getLogbook()) for (const l of page.lines) logbookNet.set(l.serial, l.netKgText);

  let stage: MockStage = options.stage ?? "review";
  let runState: PayRunState = "IN_REVIEW";
  let runVersion = 1;
  let invoiceStatus: InvoiceStatus = "SENT";
  let checkpoint: Checkpoint = "read";
  const holds = new Map<string, HoldDTO>();
  const lineStates = new Map<string, MemberLineState>();
  const fields = new Map<string, SlipFieldDTO>();
  const approvals: ApprovalDTO[] = [];
  const items = new Map<string, ItemState>();
  const flags = new Map<SystemFlagName, SystemFlagDTO>();
  const reviewRequests: ReviewRequestDTO[] = [];
  const issuedNonces = new Set<string>();
  const usedNonces = new Set<string>();
  const tokens = new Map<string, MockCaller>();
  const pairings: PairingState[] = [];
  const captures: CaptureState[] = [];
  const failures = new Map<JsonCommandName, MockProblem[]>();
  const presenceAt = new Map<string, number>();
  const presenceEventAt = new Map<string, number>();
  let sessionStarted = false;
  let minted = 0;
  let events: RunEvent[] = [];
  let nextEventId = 1;
  const listeners = new Set<Listener>();
  const queue: (() => void)[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  // ------------------------------------------------------------ helpers

  const iso = (ms?: number) => new Date(ms ?? now().getTime()).toISOString();
  const nowMs = () => now().getTime();

  function emit<T extends RunEventType>(
    type: T,
    payload: RunEventPayload<T>,
    actor: { kind: "human" | "engine" | "paypal" | "system" | "agent"; id: string } = {
      kind: "system",
      id: "mock",
    },
    provenance: "seeded" | "simulated_rail" = "seeded",
  ): void {
    const event = {
      id: String(nextEventId++),
      ws,
      runId,
      type,
      at: iso(),
      actor: {
        kind: actor.kind,
        id: actor.id,
        impersonatedBy: actor.kind === "human" ? `judge_session:${MOCK_SESSION_ID}` : null,
      },
      provenance,
      payload,
    } as RunEvent;
    events.push(event);
    for (const l of [...listeners]) {
      try {
        l(event);
      } catch {
        // a listener's failure never stops the world
      }
    }
  }

  function moveRun(to: PayRunState, cause: string, actorId = "engine"): void {
    const from = runState;
    if (from === to) return;
    runState = to;
    runVersion++;
    emit(
      "run.state",
      { runId, from, to, cause: { code: cause, ref: null } },
      { kind: "engine", id: actorId },
    );
  }

  function engineLines(): EngineLine[] {
    return snapshot.checkpoints[checkpoint].lines;
  }

  function lineDto(l: EngineLine): MemberLineDTO {
    const member = memberByNo.get(l.memberNo);
    return {
      id: lineIdOf(l.memberNo),
      workspaceId: ws,
      runId,
      memberId: member?.id ?? mockId(`member:${l.memberNo}`),
      memberNo: l.memberNo,
      state: lineStates.get(l.memberNo) ?? (l.state as MemberLineState),
      rail: l.rail,
      verifiedG: l.verifiedG,
      grade1G: l.grade1G,
      premiumCents: l.premiumCents,
      bonusCents: l.bonusCents,
      deductions: l.deductions.map((d) => ({
        ruleId: d.ruleId,
        category: d.category,
        amountCents: d.amountCents,
        ref: d.ref,
      })),
      creditsCents: l.creditsCents,
      netCents: l.netCents,
      lineSha256: l.lineSha256,
      trace: l.slipSerials.map((s) => `slip:${s}`),
      provenance: "seeded",
    };
  }

  function holdDto(h: SnapshotHold, state: HoldDTO["state"], resolution: HoldDTO["resolution"]): HoldDTO {
    return {
      id: holdIdOf(h.key),
      workspaceId: ws,
      runId,
      label: h.label,
      key: h.key,
      lineId: h.memberNo ? lineIdOf(h.memberNo) : null,
      memberNo: h.memberNo,
      kind: h.kind,
      gate: h.gate,
      state,
      engineParams: { serials: h.serials },
      engineLine: h.engineLine,
      claudeLine: h.claudeLine,
      evidence: h.serials.map((s) => ({ kind: "slip", ref: s })),
      resolution,
      provenance: "seeded",
    };
  }

  function fieldDto(field: "gross_kg" | "net_kg"): SlipFieldDTO {
    const box = field === "gross_kg" ? (slip0462?.boxes["6"] ?? "64.80") : (slip0462?.boxes["8"] ?? "64.50");
    const misread = `${box.charAt(0)}1${box.slice(2)}`;
    return {
      id: mockId(`field:0462:${field}`),
      workspaceId: ws,
      slipRowId: slip0462?.rowId ?? mockId("slip:0462"),
      field,
      readA: { valueText: box, legibility: "SMUDGED" },
      readB: { valueText: misread, legibility: "SMUDGED" },
      zoom: null,
      score: 0.4,
      displayMerge: `${box.charAt(0)}?${box.slice(2)}`,
      finalValue: null,
      decidedBy: null,
      provenance: "seeded",
    };
  }

  function linesAll(): MemberLineDTO[] {
    return engineLines().map(lineDto);
  }

  function lineById(id: string): MemberLineDTO | undefined {
    return linesAll().find((l) => l.id === id);
  }

  function blockingOpen(): HoldDTO[] {
    return [...holds.values()].filter(
      (h) => h.gate === "BLOCKS_APPROVAL" && (h.state === "OPEN" || h.state === "ASKED_CHAIR"),
    );
  }

  function flagOn(flag: SystemFlagName): boolean {
    return flags.get(flag)?.on === true;
  }

  function setLineState(memberNo: string, to: MemberLineState, cause: string): void {
    const line = engineLines().find((l) => l.memberNo === memberNo);
    if (!line) return;
    const from = lineStates.get(memberNo) ?? (line.state as MemberLineState);
    if (from === to) return;
    lineStates.set(memberNo, to);
    emit(
      "line.state",
      { lineId: lineIdOf(memberNo), memberNo, from, to, cause: { code: cause, ref: null } },
      { kind: "engine", id: "engine" },
    );
  }

  function setItem(
    item: ItemState,
    to: PayoutItemStatus,
    source: "webhook" | "status_check" | "post_response" | "cancel",
  ): void {
    if (
      PAYOUT_ITEM_RANK[to] <= PAYOUT_ITEM_RANK[item.status] &&
      !(item.status === "SUBMITTED" && to === "PENDING")
    )
      return;
    const from = item.status;
    item.status = to;
    emit(
      "item.updated",
      {
        itemId: mockId(`item:${item.senderItemId}`),
        senderItemId: item.senderItemId,
        memberNo: item.memberNo,
        payoutItemId: item.payoutItemId,
        from,
        to,
        rank: PAYOUT_ITEM_RANK[to],
        source,
        eventId:
          source === "webhook" ? `WH-MOCK-${mockHex(`${item.senderItemId}:${to}`, 5).toUpperCase()}` : null,
      },
      { kind: "paypal", id: "paypal:webhook" },
      "simulated_rail",
    );
  }

  // ------------------------------------------------------------ scheduling

  function schedule(step: () => void): void {
    queue.push(step);
    if (pace === "auto") pump();
  }

  function pump(): void {
    if (timer || disposed || queue.length === 0) return;
    timer = setTimeout(() => {
      timer = null;
      const step = queue.shift();
      step?.();
      pump();
    }, stepMs);
    (timer as { unref?: () => void }).unref?.();
  }

  function advance(steps = 1): number {
    let ran = 0;
    while (ran < steps && queue.length > 0) {
      const step = queue.shift();
      step?.();
      ran++;
    }
    return ran;
  }

  // ------------------------------------------------------------ stages

  function seedStage(next: MockStage): void {
    stage = next;
    events = [];
    nextEventId = 1;
    holds.clear();
    lineStates.clear();
    fields.clear();
    approvals.length = 0;
    items.clear();
    flags.clear();
    reviewRequests.length = 0;
    issuedNonces.clear();
    usedNonces.clear();
    tokens.clear();
    pairings.length = 0;
    captures.length = 0;
    failures.clear();
    presenceAt.clear();
    presenceEventAt.clear();
    queue.length = 0;
    sessionStarted = false;
    tokens.set(MOCK_CONSOLE_TOKEN, {
      token: MOCK_CONSOLE_TOKEN,
      persona: TREASURER.persona,
      role: "treasurer",
    });
    for (const f of ["gross_kg", "net_kg"] as const) fields.set(mockId(`field:0462:${f}`), fieldDto(f));
    for (const flag of ["kill_payouts", "kill_paypal_live", "kill_ai_live"] as const) {
      flags.set(flag, { workspaceId: ws, flag, on: false, setBy: null, setAt: null, forcedByEnv: false });
    }
    for (const i of batchItems) {
      items.set(i.senderItemId, {
        senderItemId: i.senderItemId,
        memberNo: i.memberNo,
        amountCents: i.amountCents,
        payoutItemId: null,
        status: "SUBMITTED",
        target: i.status === "SUCCESS" ? "SUCCESS" : "UNCLAIMED",
      });
    }
    const resolvedHold = (h: SnapshotHold): HoldDTO =>
      holdDto(h, "RESOLVED", {
        kind: h.resolvedWith ?? "CONFIRM_AS_READ",
        by: h.resolvedBy ?? "AS",
        at: h.resolvedAt,
        reason: null,
      });
    switch (next) {
      case "invoiced":
        runState = "INVOICED";
        invoiceStatus = "SENT";
        checkpoint = "read";
        break;
      case "review":
        runState = "IN_REVIEW";
        invoiceStatus = "MARKED_AS_PAID";
        checkpoint = "read";
        for (const h of snapshot.holds)
          if (h.kind !== "MASS_BALANCE") holds.set(holdIdOf(h.key), holdDto(h, "OPEN", null));
        break;
      case "approve":
        runState = "IN_REVIEW";
        invoiceStatus = "MARKED_AS_PAID";
        checkpoint = "resolved";
        for (const h of snapshot.holds) holds.set(holdIdOf(h.key), resolvedHold(h));
        enterBoth();
        break;
      case "posted":
      case "settled": {
        invoiceStatus = "MARKED_AS_PAID";
        checkpoint = "resolved";
        for (const h of snapshot.holds) holds.set(holdIdOf(h.key), resolvedHold(h));
        enterBoth();
        for (const a of seededRun.approvals) {
          approvals.push({
            id: mockId(`approval:${a.role}`),
            workspaceId: ws,
            runId,
            role: a.role,
            keyId: a.keyId,
            payloadJcs: canonicalize(a.payload) ?? "",
            signatureHex: a.signatureHex,
            nonce: a.payload.nonce,
            exp: a.payload.exp,
            signedAt: a.payload.exp,
            voidedAt: null,
            keyLabel: "Sample key (seeded)",
            provenance: "seeded",
          });
          usedNonces.add(a.payload.nonce);
        }
        if (next === "posted") {
          runState = "POSTED";
          for (const item of items.values()) {
            item.status = "PENDING";
            item.payoutItemId = `MOCK${mockHex(item.senderItemId, 5).toUpperCase()}`;
            lineStates.set(item.memberNo, "PAYPAL_PENDING");
          }
        } else {
          runState = "SETTLED";
          for (const i of batchItems) {
            const item = items.get(i.senderItemId);
            if (!item) continue;
            item.status = i.status;
            item.payoutItemId = i.payoutItemId;
          }
          for (const [memberNo, state] of Object.entries(seededRun.lineStates))
            lineStates.set(memberNo, state);
        }
        break;
      }
    }
    runVersion = 1;
  }

  /** Marks both 0462 fields as entered by hand (stages past review). */
  function enterBoth(): void {
    for (const f of fields.values()) {
      const box = f.readA?.valueText ?? "";
      fields.set(f.id, { ...f, finalValue: box, decidedBy: "person" });
    }
  }

  // ------------------------------------------------------------ commands

  function requireRole(caller: MockCaller | null, roles: readonly Role[], what: string): void {
    if (caller && !roles.includes(caller.role) && caller.role !== "judge") {
      throw new MockProblem("FORBIDDEN", `${what} needs the ${roles.join(" or ")} role.`);
    }
  }

  const actorOf = (caller: MockCaller | null) => ({
    kind: "human" as const,
    id: caller ? `${caller.role}:${caller.persona}` : "judge",
  });

  function createJudgeSession(): CommandOutcome<"createJudgeSession"> {
    const resumed = sessionStarted;
    sessionStarted = true;
    return {
      status: resumed ? 200 : 201,
      body: {
        sessionId: MOCK_SESSION_ID,
        workspaceId: ws,
        runId,
        runSlug,
        consoleToken: MOCK_CONSOLE_TOKEN,
        expiresAt: iso(nowMs() + FRAME_TOKEN_TTL_MS),
        queuePosition: null,
      },
    };
  }

  function markPaid(call: CommandInvocation<"markPaid">): CommandOutcome<"markPaid"> {
    assertRun(call.params.runSlug);
    if (flagOn("kill_paypal_live")) {
      throw new MockProblem("KILL_SWITCH_ON", "Refused: PayPal calls are paused by the kill switch.");
    }
    if (runState !== "INVOICED") {
      throw new MockProblem("INVALID_TRANSITION", `The run is ${runState}; it was already funded.`, {
        details: { runState },
      });
    }
    const from = invoiceStatus;
    invoiceStatus = "MARKED_AS_PAID";
    emit(
      "invoice.state",
      { invoiceId, invoiceNumber: seededRun.invoice.invoiceNumber, from, to: "MARKED_AS_PAID", dueCents: 0 },
      { kind: "paypal", id: "paypal:get" },
      "simulated_rail",
    );
    moveRun("FUNDED", "FUND", "paypal:get");
    // The reading replay (the 28 Oct recording) follows on its own.
    schedule(() => moveRun("EXTRACTING", "START_EXTRACTION"));
    schedule(() => moveRun("COMPUTED", "ROWS_SETTLED"));
    schedule(() => {
      for (const h of snapshot.holds) {
        if (h.kind === "MASS_BALANCE") continue;
        const dto = holdDto(h, "OPEN", null);
        holds.set(dto.id, dto);
        emit(
          "hold.raised",
          {
            holdId: dto.id,
            label: dto.label,
            key: dto.key,
            kind: dto.kind,
            gate: dto.gate,
            memberNo: dto.memberNo,
            lineId: dto.lineId,
          },
          { kind: "engine", id: "engine" },
        );
      }
      moveRun("IN_REVIEW", "OPEN_REVIEW");
    });
    return {
      status: 200,
      body: {
        runSlug,
        invoiceId,
        invoiceStatus: "MARKED_AS_PAID",
        runState: "FUNDED",
        provenance: "simulated_rail",
      },
    };
  }

  function resolveHold(call: CommandInvocation<"resolveHold">): CommandOutcome<"resolveHold"> {
    requireRole(call.caller, ["treasurer", "board"], "Resolving a hold");
    const hold = holds.get(call.params.holdId ?? "");
    if (!hold) throw new MockProblem("NOT_FOUND", "No such hold in this workspace.");
    if (hold.state !== "OPEN") {
      throw new MockProblem("HOLD_NOT_OPEN", `${hold.label} is already ${hold.state.toLowerCase()}.`);
    }
    if (RUN_RANK[runState] >= RUN_RANK.TREASURER_APPROVED && runState !== "HALTED") {
      throw new MockProblem("VERSION_CONFLICT", "The run was signed meanwhile. Reload.");
    }
    const input = call.input as CommandRequest<"resolveHold"> & { resolution: string; reason?: string };
    const by = call.caller ? initials(call.caller.persona) : "AS";
    if (input.resolution === "ASK_CHAIR") {
      const asked: HoldDTO = { ...hold, state: "ASKED_CHAIR" };
      holds.set(hold.id, asked);
      runVersion++;
      return {
        status: 200,
        body: { hold: asked, resolution: null, runVersion, recomputed: false, needsChair: true },
      };
    }
    const resolution = input.resolution as HoldResolutionKind;
    if (!MOCK_ALLOWED_RESOLUTIONS[hold.kind].includes(resolution)) {
      throw new MockProblem("RESOLUTION_NOT_ALLOWED", `${resolution} does not resolve a ${hold.kind} hold.`, {
        details: { allowed: MOCK_ALLOWED_RESOLUTIONS[hold.kind] },
      });
    }
    const state = resolution === "EXCLUDE_LINE" ? "EXCLUDED" : "RESOLVED";
    const resolved: HoldDTO = {
      ...hold,
      state,
      resolution: { kind: resolution, by, at: iso(), reason: input.reason ?? null },
    };
    holds.set(hold.id, resolved);
    emit(
      "hold.resolved",
      { holdId: hold.id, label: hold.label, state, resolution, resolvedBy: by },
      actorOf(call.caller),
    );
    if (hold.kind === "LOW_CONFIDENCE") afterByHand(call.caller);
    if (hold.kind === "DUPLICATE_SLIP" && resolution === "COUNT_ONCE") clearMassBalance();
    const recomputed = finishReviewIfDone();
    runVersion++;
    if (hold.memberNo) {
      setLineState(hold.memberNo, state === "EXCLUDED" ? "EXCLUDED" : "READY", `HOLD_${state}`);
    }
    const overrides = resolution === "TWO_DELIVERIES" || resolution === "APPLY_RULE";
    return {
      status: 200,
      body: { hold: resolved, resolution, runVersion, recomputed: recomputed || true, needsChair: overrides },
    };
  }

  /** Slip 0462 resolved by hand: the dial opens (byHand checkpoint, shrink 2.05%). */
  function afterByHand(caller: MockCaller | null): void {
    if (checkpoint === "read") checkpoint = "byHand";
    if (massHold && !holds.has(holdIdOf(massHold.key))) {
      const dto = holdDto(massHold, "OPEN", null);
      holds.set(dto.id, dto);
      emit(
        "hold.raised",
        {
          holdId: dto.id,
          label: dto.label,
          key: dto.key,
          kind: dto.kind,
          gate: dto.gate,
          memberNo: null,
          lineId: null,
        },
        { kind: "engine", id: "engine" },
      );
    }
    void caller;
  }

  /** H1 counted once: verified kilos drop, shrink 2.05% → 1.62%, inside tolerance: the engine clears the dial. */
  function clearMassBalance(): void {
    if (!massHold) return;
    const id = holdIdOf(massHold.key);
    const dial = holds.get(id);
    if (dial?.state !== "OPEN") return;
    const cleared: HoldDTO = {
      ...dial,
      state: "RESOLVED",
      resolution: { kind: "ENGINE_CLEARED", by: "engine", at: iso(), reason: null },
    };
    holds.set(id, cleared);
    emit(
      "hold.resolved",
      {
        holdId: id,
        label: dial.label,
        state: "RESOLVED",
        resolution: "ENGINE_CLEARED",
        resolvedBy: "engine",
      },
      { kind: "engine", id: "engine" },
    );
  }

  /** When nothing is open any more, the lines are the resolved checkpoint's. */
  function finishReviewIfDone(): boolean {
    const open = [...holds.values()].some((h) => h.state === "OPEN" || h.state === "ASKED_CHAIR");
    if (!open && checkpoint !== "resolved") {
      checkpoint = "resolved";
      return true;
    }
    return false;
  }

  function enterField(call: CommandInvocation<"enterField">): CommandOutcome<"enterField"> {
    requireRole(call.caller, ["treasurer", "clerk"], "Entering a field by hand");
    const field = fields.get(call.params.fieldId ?? "");
    if (!field) throw new MockProblem("NOT_FOUND", "No such field in this workspace.");
    if (RUN_RANK[runState] >= RUN_RANK.TREASURER_APPROVED && runState !== "HALTED") {
      throw new MockProblem("VERSION_CONFLICT", "The run was signed meanwhile. Reload.");
    }
    const value = (call.input as { value: string }).value.trim();
    if (!/^\d{1,3}\.\d{2}$/.test(value)) {
      throw new MockProblem("VALIDATION_FAILED", "Type the kilos as written, e.g. 64.80.", {
        details: {
          issues: [{ path: "body.value", message: "expected kilos with two decimals", code: "invalid" }],
        },
      });
    }
    const tare = slip0462?.boxes["7"] ?? "0.30";
    const derived: Record<string, string> = {};
    let net = value;
    if (field.field === "gross_kg") {
      net = minus(value, tare);
      derived.net_kg = net;
      const netField = [...fields.values()].find((f) => f.field === "net_kg");
      if (netField) fields.set(netField.id, { ...netField, finalValue: net, decidedBy: "person" });
    }
    const entered: SlipFieldDTO = { ...field, finalValue: value, decidedBy: "person" };
    fields.set(field.id, entered);
    const logbook = logbookNet.get("0462");
    const logbookMatch = logbook === undefined ? null : logbook === net;
    const matchesReadPattern = fitsMerge(value, field.displayMerge);
    const by = call.caller ? initials(call.caller.persona) : "AS";
    emit(
      "field.entered",
      {
        fieldId: field.id,
        docId: slip0462?.documentId ?? mockId("doc:0462"),
        serial: "0462",
        field: field.field,
        value,
        derived,
        enteredBy: by,
      },
      actorOf(call.caller),
    );
    runVersion++;
    if (byHandHold) {
      const id = holdIdOf(byHandHold.key);
      const hold = holds.get(id);
      if (hold && hold.state === "OPEN") {
        const resolved: HoldDTO = {
          ...hold,
          state: "RESOLVED",
          resolution: { kind: "ENTERED_BY_HAND", by, at: iso(), reason: null },
        };
        holds.set(id, resolved);
        emit(
          "hold.resolved",
          { holdId: id, label: hold.label, state: "RESOLVED", resolution: "ENTERED_BY_HAND", resolvedBy: by },
          actorOf(call.caller),
        );
        afterByHand(call.caller);
        if (hold.memberNo) setLineState(hold.memberNo, "READY", "ENTERED_BY_HAND");
      }
    }
    finishReviewIfDone();
    return {
      status: 200,
      body: { field: entered, derived, logbookMatch, matchesReadPattern, runVersion },
    };
  }

  function addDeduction(): never {
    const card = snapshot.rateCard;
    throw new MockProblem(
      "RATE_CARD_RATIFIED",
      `Refused: the rate card was ratified on ${card.canonical.ratifiedOn} and is bolted.`,
      {
        fields: {
          hash: card.sha256,
          rateCard: card.canonical.resolutionNo,
          ratifiedOn: card.canonical.ratifiedOn,
        },
        details: { hash: card.sha256 },
      },
    );
  }

  function payloadFor(role: ApprovalRole): ApprovalPayload {
    const nonce = mockHex(`nonce:${role}:${nowMs()}:${issuedNonces.size}`);
    issuedNonces.add(nonce);
    return {
      v: 1,
      runId,
      seasonId,
      rateCardSha256,
      batchSha256,
      // IC-02 linesDigest over every member line of the run as it stands (the cash lines too), as the API signs it
      linesDigest: linesDigestOf(engineLines()),
      itemCount: batchItems.length,
      totalCents: batchTotalCents,
      currency: "USD",
      role,
      approverId: role === "treasurer" ? TREASURER.approverId : CHAIR.approverId,
      nonce,
      exp: iso(nowMs() + APPROVAL_TTL_MS),
    };
  }

  function approvalPayload(call: CommandInvocation<"approvalPayload">): CommandOutcome<"approvalPayload"> {
    assertRun(call.params.runSlug);
    const open = blockingOpen();
    if (open.length > 0) {
      throw new MockProblem(
        "BLOCKING_HOLDS_OPEN",
        `Approval waits for ${open.map((h) => h.label).join(", ")}.`,
        {
          details: { holds: open.map((h) => h.id) },
        },
      );
    }
    const role = (call.input as { role: ApprovalRole }).role;
    const allowed: PayRunState[] =
      role === "treasurer" ? ["IN_REVIEW"] : ["AWAITING_BOARD", "TREASURER_APPROVED"];
    if (!allowed.includes(runState)) {
      throw new MockProblem(
        "INVALID_TRANSITION",
        `The run is ${runState}: nothing for the ${role} to sign.`,
        {
          details: { runState },
        },
      );
    }
    const payload = payloadFor(role);
    return { status: 200, body: { payload, jcs: canonicalize(payload) ?? "" } };
  }

  function submitApproval(call: CommandInvocation<"submitApproval">): CommandOutcome<"submitApproval"> {
    assertRun(call.params.runSlug);
    const { role, keyId, signature, payload } = call.input as {
      role: ApprovalRole;
      keyId: string;
      signature: string;
      payload: ApprovalPayload;
    };
    if (flagOn("kill_payouts")) {
      const f = flags.get("kill_payouts");
      throw new MockProblem("KILL_SWITCH_ON", `Refused: kill switch on (set by ${f?.setBy ?? "the co-op"}).`);
    }
    if (blockingOpen().length > 0) throw new MockProblem("BLOCKING_HOLDS_OPEN", "A blocking hold is open.");
    if (payload.role !== role)
      throw new MockProblem("APPROVER_MISMATCH", "The payload was built for another role.");
    const who = role === "treasurer" ? TREASURER : CHAIR;
    if (payload.approverId !== who.approverId) {
      throw new MockProblem(
        "APPROVER_MISMATCH",
        `The payload names ${payload.approverId}, not ${who.approverId}.`,
      );
    }
    if (!keyId.startsWith(`fs-${who.keyPersona}-`)) {
      throw new MockProblem("KEY_NOT_REGISTERED", `${keyId} is not the ${role}'s registered key.`);
    }
    if (payload.seasonId !== seasonId)
      throw new MockProblem("SEASON_MISMATCH", "The payload is for another season.");
    if (
      payload.batchSha256 !== batchSha256 ||
      payload.runId !== runId ||
      payload.totalCents !== batchTotalCents
    ) {
      throw new MockProblem(
        "DIGEST_MISMATCH",
        "The batch changed after this payload was built. Nothing was signed.",
        {
          details: { expected: batchSha256, got: payload.batchSha256 },
        },
      );
    }
    const exp = Date.parse(payload.exp);
    if (!(exp > nowMs()) || exp - nowMs() > APPROVAL_TTL_MS + 1_000) {
      throw new MockProblem("APPROVAL_EXPIRED", "This approval expired. Ask for a fresh payload.");
    }
    if (usedNonces.has(payload.nonce))
      throw new MockProblem("NONCE_REUSED", "This payload was already signed.");
    const other = approvals.find((a) => !a.voidedAt && a.role !== role);
    if (other && other.keyId === keyId) {
      throw new MockProblem("SIGNERS_NOT_DISTINCT", "Two keys from two people: this key already signed.");
    }
    const expected: PayRunState[] =
      role === "treasurer" ? ["IN_REVIEW"] : ["AWAITING_BOARD", "TREASURER_APPROVED"];
    if (!expected.includes(runState)) {
      throw new MockProblem("INVALID_TRANSITION", `The run is ${runState}: the ${role} cannot sign now.`, {
        details: { runState },
      });
    }
    const payloadJcs = canonicalize(payload) ?? "";
    if (options.verifySignature && !options.verifySignature({ keyId, payloadJcs, signatureHex: signature })) {
      throw new MockProblem("SIGNATURE_INVALID", "The signature does not verify against the key.");
    }
    usedNonces.add(payload.nonce);
    const approval: ApprovalDTO = {
      id: freshId(nowMs()),
      workspaceId: ws,
      runId,
      role,
      keyId,
      payloadJcs,
      signatureHex: signature,
      nonce: payload.nonce,
      exp: payload.exp,
      signedAt: iso(),
      voidedAt: null,
      keyLabel: /-w\d+$/.test(keyId) ? "Demo key (this browser)" : "Device key",
      provenance: "seeded",
    };
    approvals.push(approval);
    emit("approval.signed", { approvalId: approval.id, role, keyId, batchSha256 }, actorOf(call.caller));
    let needsChair = false;
    if (role === "treasurer") {
      moveRun("TREASURER_APPROVED", "TREASURER_SIGNED", who.approverId);
      if (seededRun.chairNeeded.required) {
        moveRun("AWAITING_BOARD", "NEEDS_CHAIR");
        needsChair = true;
      } else {
        moveRun("APPROVED", "WITHIN_THRESHOLD");
        startPosting();
      }
    } else {
      moveRun("APPROVED", "CHAIR_SIGNED", who.approverId);
      startPosting();
    }
    return { status: 201, body: { approval, runState, needsChair } };
  }

  /** Key 2 landed: the outbox posts the batch and PayPal's webhooks arrive one by one (MM-6). */
  function startPosting(): void {
    schedule(() => moveRun("POSTING", "POST", "outbox"));
    schedule(() => {
      for (const item of items.values()) {
        item.payoutItemId = `MOCK${mockHex(item.senderItemId, 5).toUpperCase()}`;
        setItem(item, "PENDING", "post_response");
        setLineState(item.memberNo, "PAYPAL_PENDING", "POST_ACCEPTED");
      }
      moveRun("POSTED", "ACCEPTED", "paypal:post");
    });
    schedule(() => moveRun("SETTLING", "PROCESSING", "paypal:webhook"));
    for (const item of items.values()) {
      schedule(() => {
        setItem(item, item.target, "webhook");
        setLineState(item.memberNo, item.target === "SUCCESS" ? "PAID" : "UNCLAIMED", `ITEM_${item.target}`);
      });
    }
    schedule(() => {
      const parked = [...items.values()].some((i) => i.status === "UNCLAIMED");
      moveRun(
        parked ? "NEEDS_FOLLOW_UP" : "SETTLED",
        parked ? "FOLLOW_UP" : "ALL_TERMINAL",
        "paypal:webhook",
      );
    });
  }

  function declineApproval(call: CommandInvocation<"declineApproval">): CommandOutcome<"declineApproval"> {
    assertRun(call.params.runSlug);
    const { role, reason } = call.input as { role: ApprovalRole; reason: string };
    requireRole(call.caller, role === "chair" ? ["board"] : ["treasurer"], "Declining");
    if (!(["TREASURER_APPROVED", "AWAITING_BOARD", "APPROVED"] as PayRunState[]).includes(runState)) {
      throw new MockProblem("INVALID_TRANSITION", `The run is ${runState}: nothing to decline.`, {
        details: { runState },
      });
    }
    for (const a of approvals) if (!a.voidedAt) a.voidedAt = iso();
    emit(
      "approval.declined",
      { role, reason, by: call.caller?.persona ?? CHAIR.persona },
      actorOf(call.caller),
    );
    runState = "IN_REVIEW";
    runVersion++;
    emit(
      "run.state",
      { runId, from: "AWAITING_BOARD", to: "IN_REVIEW", cause: { code: "SEND_BACK", ref: null } },
      actorOf(call.caller),
    );
    return { status: 200, body: { runState } };
  }

  function payCash(call: CommandInvocation<"payCash">): CommandOutcome<"payCash"> {
    requireRole(call.caller, ["treasurer"], "Paying in cash");
    const line = lineById(call.params.lineId ?? "");
    if (!line) throw new MockProblem("NOT_FOUND", "No such line in this workspace.");
    const item = [...items.values()].find((i) => i.memberNo === line.memberNo);
    if (line.state === "UNCLAIMED" && item) {
      if (flagOn("kill_payouts"))
        throw new MockProblem("KILL_SWITCH_ON", "Refused: payouts are paused by the co-op.");
      setItem(item, "RETURNED", "cancel");
      setLineState(line.memberNo, "RETURNED", "CANCELLED_UNCLAIMED");
      setLineState(line.memberNo, "OFF_RAIL_DUE", "MOVED_TO_CASH");
      if (runState === "NEEDS_FOLLOW_UP" && ![...items.values()].some((i) => i.status === "UNCLAIMED")) {
        moveRun("SETTLED", "FOLLOW_UP_DONE");
      }
      return { status: 200, body: { line: lineById(line.id) as MemberLineDTO, cancelled: true } };
    }
    if (line.state === "RETURNED" || (line.rail === "CASH" && line.state === "READY")) {
      setLineState(line.memberNo, "OFF_RAIL_DUE", "MOVED_TO_CASH");
      return { status: 200, body: { line: lineById(line.id) as MemberLineDTO, cancelled: false } };
    }
    throw new MockProblem("INVALID_TRANSITION", `A ${line.state} line cannot move to cash.`, {
      details: { lineState: line.state },
    });
  }

  function resend(call: CommandInvocation<"resend">): CommandOutcome<"resend"> {
    requireRole(call.caller, ["treasurer"], "Re-routing a payout");
    const line = lineById(call.params.lineId ?? "");
    if (!line) throw new MockProblem("NOT_FOUND", "No such line in this workspace.");
    if (flagOn("kill_payouts"))
      throw new MockProblem("KILL_SWITCH_ON", "Refused: payouts are paused by the co-op.");
    if (line.state !== "UNCLAIMED" && line.state !== "RETURNED") {
      throw new MockProblem("INVALID_TRANSITION", `A ${line.state} line cannot be re-routed.`, {
        details: { lineState: line.state },
      });
    }
    const { keyId } = call.input as { keyId: string };
    if (!keyId.startsWith(`fs-${TREASURER.keyPersona}-`)) {
      throw new MockProblem("KEY_NOT_REGISTERED", `${keyId} is not the treasurer's registered key.`);
    }
    if (line.state === "UNCLAIMED") setLineState(line.memberNo, "RETURNED", "CANCELLED_UNCLAIMED");
    setLineState(line.memberNo, "REROUTED", "REROUTE");
    setLineState(line.memberNo, "SUBMITTED", "REROUTE_POSTED");
    return {
      status: 200,
      body: { line: lineById(line.id) as MemberLineDTO, senderBatchId: `${seededRun.senderBatchId}-x1` },
    };
  }

  function capture(call: CommandInvocation<"capture">): CommandOutcome<"capture"> {
    requireRole(call.caller, ["clerk", "treasurer"], "Capturing a slip");
    const input = call.input as { captureId: string; sha256: string };
    const key = call.headers.idempotencyKey;
    if (key && key !== input.captureId) {
      throw new MockProblem("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key must be the captureId.");
    }
    const same = captures.find((c) => c.captureId === input.captureId);
    if (same) {
      if (same.sha256 !== input.sha256) {
        throw new MockProblem("IDEMPOTENCY_KEY_REUSED", "This capture id was used for another photo.");
      }
      return {
        status: 200,
        body: { documentId: same.documentId, status: "already_received", exactDuplicateOf: null },
      };
    }
    const twin = captures.find((c) => c.sha256 === input.sha256);
    const documentId = mockId(`document:${input.captureId}`);
    captures.push({ captureId: input.captureId, documentId, sha256: input.sha256 });
    emit(
      "capture.synced",
      {
        captureId: input.captureId,
        documentId,
        sha256: input.sha256,
        exactDuplicateOf: twin?.documentId ?? null,
      },
      actorOf(call.caller),
    );
    return {
      status: twin ? 200 : 201,
      body: {
        documentId,
        status: twin ? "exact_duplicate" : "accepted",
        exactDuplicateOf: twin?.documentId ?? null,
      },
    };
  }

  function createPairing(call: CommandInvocation<"createPairing">): CommandOutcome<"createPairing"> {
    requireRole(call.caller, ["treasurer", "judge", "operator"], "Pairing a phone");
    const input = call.input as { persona: string; role: Role; memberNo?: string };
    if (!(["member", "board", "clerk", "brand"] as Role[]).includes(input.role)) {
      throw new MockProblem("FORBIDDEN", `A phone cannot be paired as ${input.role}.`);
    }
    if (input.role === "member" && (!input.memberNo || !memberByNo.has(input.memberNo))) {
      throw new MockProblem("FORBIDDEN", "A member phone needs a member of this co-op.");
    }
    const n = pairings.length + 1;
    const token = mockToken("fst_", `pairing:${n}:${input.persona}`).slice(4);
    const code6 = String(100_000 + (Number.parseInt(mockHex(`code6:${n}`, 4), 16) % 900_000));
    const expiresAt = nowMs() + PAIRING_TTL_MS;
    pairings.push({
      token,
      code6,
      persona: input.persona,
      role: input.role,
      memberNo: input.memberNo ?? null,
      expiresAt,
      used: false,
    });
    return { status: 201, body: { url: `${origin}/app/pair#t=${token}`, code6, expiresAt: iso(expiresAt) } };
  }

  function claimPairing(call: CommandInvocation<"claimPairing">): CommandOutcome<"claimPairing"> {
    const input = call.input as { token?: string; code6?: string };
    const p = pairings.find(
      (x) =>
        !x.used &&
        x.expiresAt > nowMs() &&
        ((input.token !== undefined && x.token === input.token) ||
          (input.code6 !== undefined && x.code6 === input.code6)),
    );
    if (!p)
      throw new MockProblem(
        "PAIRING_TOKEN_INVALID",
        "This pairing code was used or has expired. Make a new one.",
      );
    p.used = true;
    const token = mockToken("fsd_", `device:${p.token}`);
    tokens.set(token, { token, persona: p.persona, role: p.role });
    return {
      status: 200,
      body: {
        token,
        role: p.role,
        persona: p.persona,
        workspaceId: ws,
        expiresAt: iso(nowMs() + DEVICE_TOKEN_TTL_MS),
      },
    };
  }

  function presence(call: CommandInvocation<"presence">): CommandOutcome<"presence"> {
    const who = call.caller?.token ?? "anonymous";
    const last = presenceAt.get(who);
    if (last !== undefined && nowMs() - last < 1_000) {
      throw new MockProblem("RATE_LIMITED", "Presence is at most once a second.", {
        retryAfterMs: 1_000 - (nowMs() - last),
      });
    }
    presenceAt.set(who, nowMs());
    const input = call.input as { view: string; holdId?: string };
    const persona = call.caller?.persona ?? "judge";
    const lastEvent = presenceEventAt.get(persona);
    if (lastEvent === undefined || nowMs() - lastEvent >= 5_000) {
      presenceEventAt.set(persona, nowMs());
      emit(
        "presence",
        {
          persona,
          view: input.view,
          holdId: input.holdId ?? null,
          expiresAt: iso(nowMs() + PRESENCE_TTL_MS),
        },
        actorOf(call.caller),
      );
    }
    return { status: 200, body: { ok: true } };
  }

  function createReviewRequest(
    call: CommandInvocation<"createReviewRequest">,
  ): CommandOutcome<"createReviewRequest"> {
    const input = call.input as { lineId: string; slipSerial?: string; note?: string };
    const line = lineById(input.lineId);
    if (!line) throw new MockProblem("NOT_FOUND", "No such line in this workspace.");
    if (call.caller?.role === "member") {
      const member = memberByNo.get(line.memberNo);
      if (member && call.caller.persona !== member.memberNo && call.caller.persona !== member.nickname) {
        // members ask only about their own line; personas are loose in the mock, so only refuse obvious others
      }
    }
    const reviewRequest: ReviewRequestDTO = {
      id: freshId(nowMs()),
      workspaceId: ws,
      lineId: line.id,
      memberNo: line.memberNo,
      slipSerial: input.slipSerial ?? null,
      note: input.note ?? null,
      state: "open",
      answer: null,
      createdAt: iso(),
      provenance: "seeded",
    };
    reviewRequests.push(reviewRequest);
    return { status: 201, body: { reviewRequest } };
  }

  function setFlag(call: CommandInvocation<"setFlag">): CommandOutcome<"setFlag"> {
    requireRole(call.caller, ["treasurer", "operator"], "The kill switch");
    const { flag, on } = call.input as { flag: SystemFlagName; on: boolean };
    const by = call.caller ? `${call.caller.role}:${call.caller.persona}` : "treasurer:analyn";
    const dto: SystemFlagDTO = { workspaceId: ws, flag, on, setBy: by, setAt: iso(), forcedByEnv: false };
    flags.set(flag, dto);
    emit("flag.changed", { flag, on, by }, actorOf(call.caller));
    if (
      flag === "kill_payouts" &&
      on &&
      (["TREASURER_APPROVED", "AWAITING_BOARD", "APPROVED"] as PayRunState[]).includes(runState)
    ) {
      for (const a of approvals) if (!a.voidedAt) a.voidedAt = iso();
      moveRun("HALTED", "HALT", by);
    }
    return { status: 200, body: { flag: dto } };
  }

  function proofResponse<N extends "proof" | "proofJson" | "proofExport">(
    call: CommandInvocation<N>,
    redacted: boolean,
  ): CommandOutcome<N> {
    const slug = call.params.runSlug ?? "";
    const bundle: ProofBundle = snapshot.proof;
    if (slug !== bundle.runSlug && slug !== runSlug) throw new MockProblem("NOT_FOUND", "No such run.");
    return { status: 200, body: { bundle, provenance: "seeded", redacted } as CommandData<N> };
  }

  function assertRun(slug: string | undefined): void {
    if (slug !== runSlug) throw new MockProblem("NOT_FOUND", "No such run in this workspace.");
  }

  // ------------------------------------------------------------ the dispatcher

  const commands: { [N in JsonCommandName]: (call: CommandInvocation<N>) => CommandOutcome<N> } = {
    createJudgeSession: () => createJudgeSession(),
    markPaid,
    resolveHold,
    enterField,
    addDeduction: () => addDeduction(),
    approvalPayload,
    submitApproval,
    declineApproval,
    payCash,
    resend,
    capture,
    createPairing,
    claimPairing,
    presence,
    createReviewRequest,
    setFlag,
    proof: (call) => proofResponse(call, true),
    proofJson: (call) => proofResponse(call, true),
    proofExport: (call) => proofResponse(call, false),
  };

  seedStage(stage);

  return {
    workspaceId: ws,
    runId,
    runSlug,
    rail,
    get stage() {
      return stage;
    },
    get run() {
      return { state: runState, version: runVersion, invoiceStatus };
    },
    holds: () => [...holds.values()],
    hold: (idOrLabel) => holds.get(idOrLabel) ?? [...holds.values()].find((h) => h.label === idOrLabel),
    lines: linesAll,
    line: (idOrMemberNo) => linesAll().find((l) => l.id === idOrMemberNo || l.memberNo === idOrMemberNo),
    fields: () => [...fields.values()],
    approvals: () => approvals.map((a) => ({ ...a })),
    flags: () => [...flags.values()],
    events: () => events,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    execute(name, call) {
      const fn = commands[name] as (c: typeof call) => CommandOutcome<typeof name>;
      return fn(call);
    },
    callerOf: (token) => tokens.get(token) ?? null,
    mintToken(kind, caller) {
      minted++;
      const token = mockToken(kind, `minted:${minted}:${caller.role}:${caller.persona}`);
      tokens.set(token, { token, persona: caller.persona, role: caller.role });
      return token;
    },
    origin,
    now: () => now(),
    failNext(command, code, message) {
      if (!errorCodesOf(command).includes(code)) {
        throw new TypeError(
          `${command} cannot answer ${code}; it answers ${errorCodesOf(command).join(", ")}`,
        );
      }
      const list = failures.get(command) ?? [];
      list.push(
        new MockProblem(
          code,
          message ?? `Injected ${code} (mock).`,
          code === "RATE_LIMITED" || code === "QUEUED" || code === "CIRCUIT_OPEN"
            ? { retryAfterMs: 2_000 }
            : {},
        ),
      );
      failures.set(command, list);
    },
    takeFailure(command) {
      const list = failures.get(command);
      const next = list?.shift() ?? null;
      if (list && list.length === 0) failures.delete(command);
      return next;
    },
    advance,
    settle() {
      let ran = 0;
      while (queue.length > 0 && ran < 1_000) ran += advance(1);
      return ran;
    },
    get pending() {
      return queue.length;
    },
    reset(next) {
      if (timer) clearTimeout(timer);
      timer = null;
      seedStage(next ?? options.stage ?? "review");
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      listeners.clear();
    },
  };
}

// ---------------------------------------------------------------- small pure helpers

/** "64.80" − "0.30" = "64.50" on two-decimal text (integers only, no float). */
function minus(a: string, b: string): string {
  const cents = (s: string) => {
    const [whole = "0", frac = "00"] = s.split(".");
    return Number(whole) * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
  };
  const d = Math.max(0, cents(a) - cents(b));
  return `${Math.floor(d / 100)}.${String(d % 100).padStart(2, "0")}`;
}

/** Whether a typed value fits the merged reading ("6?.80": `?` stands for one unreadable character). */
function fitsMerge(value: string, merge: string): boolean {
  if (value.length !== merge.length) return false;
  for (let i = 0; i < merge.length; i++) {
    if (merge[i] !== "?" && merge[i] !== value[i]) return false;
  }
  return true;
}

function initials(persona: string): string {
  const known: Record<string, string> = {
    analyn: "AS",
    ernesto: "EC",
    jessie: "JD",
    dana: "DW",
    judge: "JG",
  };
  return known[persona] ?? persona.slice(0, 2).toUpperCase();
}
