// A contract-faithful mock of fs-api for development and tests, built on the seed snapshot (IC-03). It
// answers every API_COMMANDS entry with the contract's own shapes and errors, keeps one in-memory judge
// session per createJudgeSession, and emits the RunEvents a real judge run produces, in order: funding,
// the replayed reading, the holds, two keys, the fan-out with Rhea parked and one repeated delivery, and
// her cash re-route. Mock data only: the stage labels it, and nothing here signs or verifies anything.

import {
  type ApiError,
  type ApprovalPayload,
  type ApprovalRole,
  apiError,
  type ErrorCode,
  type HoldDTO,
  type HoldResolutionKind,
  type MemberLineDTO,
  type MemberLineState,
  type PayRunState,
  type Provenance,
  RunEvent,
  type RunEventPayload,
  type RunEventType,
  type SeasonSnapshot,
  type SlipFieldDTO,
  type SnapshotHold,
} from "@fairsplit/contracts";
import type { z } from "zod";
import type { CommandRequest, CommandResponse, FramePersona, FrameTokenGrant } from "../adapter.js";
import { canonicalJson, mockHex, mockUuid } from "./ids.js";

export class MockApiError extends Error {
  readonly body: ApiError & Record<string, unknown>;

  constructor(code: ErrorCode, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.body = { ...apiError(code, message), ...extra };
  }

  get status(): number {
    return this.body.status;
  }
}

export type MockPace = "instant" | "paced";

export interface MockWorldOptions {
  readonly snapshot: SeasonSnapshot;
  /** "instant" emits a step's events at once (tests); "paced" spaces them like the real stage (dev). */
  readonly pace?: MockPace;
  readonly now?: () => number;
  /** The live run-number block k (S3.9: runSeq = k × 10,000 + 1). Fixed in tests. */
  readonly runBlock?: number;
  /** Replay speed-up for the reading (C-26: 48 rows in 20 s or less). */
  readonly readingSpeedup?: number;
}

type Actor = z.infer<typeof RunEvent>["actor"];

interface MockHold {
  readonly holdId: string;
  readonly seed: SnapshotHold;
  state: "OPEN" | "ASKED_CHAIR" | "RESOLVED" | "EXCLUDED";
  resolution: HoldResolutionKind | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface MockSession {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly runSeq: number;
  readonly runSlug: string;
  readonly token: string;
  readonly expiresAt: string;
  state: PayRunState;
  version: number;
  readonly holds: Map<string, MockHold>;
  readonly lines: Map<string, { lineId: string; state: MemberLineState }>;
  readonly items: Map<string, { senderItemId: string; memberNo: string; status: string }>;
  readonly approvals: Map<ApprovalRole, { nonce: string; keyId: string }>;
  readonly payloads: Map<ApprovalRole, ApprovalPayload>;
  readonly usedNonces: Set<string>;
  readonly captures: Map<string, string>;
  readonly events: RunEvent[];
  readonly timers: Set<ReturnType<typeof setTimeout>>;
  readingDone: boolean;
  fanoutDone: boolean;
}

type Listener = (event: RunEvent) => void;

const PERSONA_SCOPE: Readonly<Record<FramePersona, string>> = {
  member: "member:M-014",
  chair: "board:ernesto",
  clerk: "clerk:jessie",
};

const TREASURER: Actor = { kind: "human", id: "treasurer:analyn", impersonatedBy: null };
const CHAIR: Actor = { kind: "human", id: "board:ernesto", impersonatedBy: null };
const ENGINE: Actor = { kind: "engine", id: "engine-v1", impersonatedBy: null };
const CLAUDE: Actor = { kind: "agent", id: "claude-opus-5-5", impersonatedBy: null };
const PAYPAL: Actor = { kind: "paypal", id: "paypal", impersonatedBy: null };
const SYSTEM: Actor = { kind: "system", id: "fs-api", impersonatedBy: null };

/** Spacing of the paced script (ms). The stage director spaces landings itself; these only order events. */
const PACE = { beat: 400, row: 240, webhook: 320 } as const;

export class MockWorld {
  readonly snapshot: SeasonSnapshot;
  private readonly pace: MockPace;
  private readonly now: () => number;
  private readonly runBlock: number;
  private readonly sessions = new Map<string, MockSession>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private nextEventId = 1;
  private sessionCount = 0;
  readonly readingSpeedup: number;

  constructor(options: MockWorldOptions) {
    this.snapshot = options.snapshot;
    this.pace = options.pace ?? "instant";
    this.now = options.now ?? (() => Date.now());
    this.runBlock = options.runBlock ?? 417;
    this.readingSpeedup = options.readingSpeedup ?? 12;
  }

  // ------------------------------------------------------------------------------------- sessions

  createJudgeSession(): CommandResponse<"createJudgeSession"> {
    this.sessionCount += 1;
    const n = this.sessionCount;
    const runSeq = this.runBlock * 10_000 + n;
    const runSlug = `${this.snapshot.season.code}-r${runSeq}`;
    const session: MockSession = {
      sessionId: mockUuid(`session:${n}`),
      workspaceId: mockUuid(`workspace:${n}`),
      runId: mockUuid(`run:${n}`),
      runSeq,
      runSlug,
      token: `fsc_mock_${mockHex(`token:${n}`, 32)}`,
      expiresAt: new Date(this.now() + 2 * 3600_000).toISOString(),
      state: "DRAFT",
      version: 0,
      holds: new Map(),
      lines: new Map(
        this.snapshot.members.map((m) => [
          m.memberNo,
          { lineId: mockUuid(`line:${n}:${m.memberNo}`), state: "COMPUTED" },
        ]),
      ),
      items: new Map(),
      approvals: new Map(),
      payloads: new Map(),
      usedNonces: new Set(),
      captures: new Map(),
      events: [],
      timers: new Set(),
      readingDone: false,
      fanoutDone: false,
    };
    this.sessions.set(session.sessionId, session);
    const invoiceNumber = `FS-${runSlug}`;
    const invoiceId = `INV2-MOCK-${mockHex(`invoice:${n}`, 12).toUpperCase()}`;
    const amount = this.snapshot.run.invoice.amountCents;
    this.emit(session, "run.state", SYSTEM, "live", {
      runId: session.runId,
      from: "DRAFT",
      to: "QUOTED",
      cause: cause("quote"),
    });
    this.emit(session, "policy.verdict", CLAUDE, "replay", {
      tool: "create_invoice",
      verdict: "ALLOW",
      decidedBy: ["invoiceEqualsQuote", "referenceCarriesHash", "dueWithin30Days"],
      reasons: [],
      sessionId: null,
    });
    this.emit(session, "invoice.state", PAYPAL, "simulated_rail", {
      invoiceId,
      invoiceNumber,
      from: null,
      to: "DRAFT",
      dueCents: amount,
    });
    this.emit(session, "invoice.state", PAYPAL, "simulated_rail", {
      invoiceId,
      invoiceNumber,
      from: "DRAFT",
      to: "SENT",
      dueCents: amount,
    });
    this.setRunState(session, "INVOICED", SYSTEM, "invoice_sent");
    return {
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
      runId: session.runId,
      runSlug,
      consoleToken: session.token,
      expiresAt: session.expiresAt,
      queuePosition: null,
    };
  }

  /** The session a bearer token belongs to, or null. */
  sessionForToken(token: string | null): MockSession | null {
    if (!token) return null;
    for (const s of this.sessions.values()) if (s.token === token) return s;
    return null;
  }

  sessionById(sessionId: string): MockSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  sessionForRun(runSlug: string): MockSession | null {
    for (const s of this.sessions.values()) if (s.runSlug === runSlug) return s;
    return null;
  }

  resetSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new MockApiError("NOT_FOUND", "No judge session with that ID.");
    for (const t of session.timers) clearTimeout(t);
    this.sessions.delete(sessionId);
  }

  frameToken(sessionId: string, persona: FramePersona): FrameTokenGrant {
    const session = this.sessions.get(sessionId);
    if (!session) throw new MockApiError("NOT_FOUND", "No judge session with that ID.");
    return {
      token: `fst_mock_${mockHex(`frame:${sessionId}:${persona}:${this.now()}`, 32)}`,
      exp: this.now() + 2 * 3600_000,
      persona: PERSONA_SCOPE[persona],
      ws: session.workspaceId,
    };
  }

  // ------------------------------------------------------------------------------------- events

  /** Events in a scope after `lastEventId` (SSE replay), oldest first. */
  eventsAfter(scope: string, lastEventId: string | null): RunEvent[] {
    const after = lastEventId === null ? 0 : Number(lastEventId);
    const out: RunEvent[] = [];
    for (const session of this.sessions.values()) {
      if (scope !== `run:${session.runSlug}` && scope !== `workspace:${session.workspaceId}`) continue;
      for (const event of session.events) if (Number(event.id) > after) out.push(event);
    }
    return out.sort((a, b) => Number(a.id) - Number(b.id));
  }

  listen(scope: string, listener: Listener): () => void {
    let set = this.listeners.get(scope);
    if (!set) {
      set = new Set();
      this.listeners.set(scope, set);
    }
    set.add(listener);
    return () => set?.delete(listener);
  }

  private emit<T extends RunEventType>(
    session: MockSession,
    type: T,
    actor: Actor,
    provenance: Provenance,
    payload: RunEventPayload<T>,
  ): RunEvent {
    const event = RunEvent.parse({
      id: String(this.nextEventId++),
      ws: session.workspaceId,
      runId: session.runId,
      at: new Date(this.now()).toISOString(),
      actor,
      provenance,
      type,
      payload,
    });
    session.events.push(event);
    session.version += 1;
    for (const scope of [`run:${session.runSlug}`, `workspace:${session.workspaceId}`]) {
      for (const listener of this.listeners.get(scope) ?? []) listener(event);
    }
    return event;
  }

  /** Runs steps now (instant) or spaced by `gap` ms (paced). */
  private schedule(session: MockSession, steps: readonly (() => void)[], gap: number): void {
    if (this.pace === "instant") {
      for (const step of steps) step();
      return;
    }
    steps.forEach((step, i) => {
      const timer = setTimeout(
        () => {
          session.timers.delete(timer);
          if (this.sessions.has(session.sessionId)) step();
        },
        gap * (i + 1),
      );
      session.timers.add(timer);
    });
  }

  private setRunState(session: MockSession, to: PayRunState, actor: Actor, code: string): void {
    const from = session.state;
    if (from === to) return;
    session.state = to;
    this.emit(session, "run.state", actor, "live", { runId: session.runId, from, to, cause: cause(code) });
  }

  private setLine(
    session: MockSession,
    memberNo: string,
    to: MemberLineState,
    actor: Actor,
    code: string,
  ): void {
    const line = session.lines.get(memberNo);
    if (!line || line.state === to) return;
    const from = line.state;
    line.state = to;
    this.emit(session, "line.state", actor, "live", {
      lineId: line.lineId,
      memberNo,
      from,
      to,
      cause: cause(code),
    });
  }

  // ------------------------------------------------------------------------------------- commands

  private requireSession(runSlug: string): MockSession {
    const session = this.sessionForRun(runSlug);
    if (!session) throw new MockApiError("NOT_FOUND", `No run ${runSlug} in this mock.`);
    return session;
  }

  markPaid(runSlug: string): CommandResponse<"markPaid"> {
    const session = this.requireSession(runSlug);
    if (session.state !== "INVOICED") {
      throw new MockApiError("INVALID_TRANSITION", "The invoice is not waiting for payment.");
    }
    const invoiceNumber = `FS-${session.runSlug}`;
    const invoiceId = `INV2-MOCK-${mockHex(`invoice:${session.runSeq % 10_000}`, 12).toUpperCase()}`;
    this.emit(session, "invoice.state", PAYPAL, "simulated_rail", {
      invoiceId,
      invoiceNumber,
      from: "SENT",
      to: "MARKED_AS_PAID",
      dueCents: 0,
    });
    this.setRunState(session, "FUNDED", SYSTEM, "invoice_paid_get");
    this.emit(session, "webhook.received", PAYPAL, "simulated_rail", {
      webhookEventId: mockUuid(`wh:${session.runSlug}:invoice`),
      paypalEventId: `WH-MOCK-${mockHex(`wh:${session.runSlug}:invoice`, 10).toUpperCase()}`,
      eventType: "INVOICING.INVOICE.PAID",
      verified: "self",
      duplicate: false,
    });
    this.startReading(session);
    return {
      runSlug: session.runSlug,
      invoiceId,
      invoiceStatus: "MARKED_AS_PAID",
      runState: "FUNDED",
      provenance: "simulated_rail",
    };
  }

  private startReading(session: MockSession): void {
    const replayPhotos = this.snapshot.photos.filter((p) => p.set === "REPLAY");
    const slips = this.snapshot.slips;
    const steps: (() => void)[] = [() => this.setRunState(session, "EXTRACTING", SYSTEM, "funded")];
    replayPhotos.forEach((photo) => {
      photo.slips.forEach((placed, row) => {
        const slip = slips.find((s) => s.serial === placed.serial && s.copy === placed.copy);
        if (!slip) return;
        steps.push(() => {
          const byHand = slip.artifacts.includes("WATER_STAIN");
          this.emit(session, "extract.row", CLAUDE, "replay", {
            docId: photo.documentId,
            row,
            serial: slip.serial,
            memberNo: slip.memberNo,
            fields: {
              serial: field(slip.serial, 0.97),
              member_no: field(slip.memberNo, 0.97),
              gross_kg: byHand
                ? field(null, 0.4, slip.boxes["6"].replace(/^(\d)\d/, "$1?"))
                : field(slip.boxes["6"], 0.97),
              tare_kg: field(slip.boxes["7"], 0.97),
              net_kg: byHand ? field(null, 0.4, "?") : field(slip.boxes["8"], 0.97),
              grade: field(slip.boxes["12"], 0.97),
            },
          });
          if (slip.marginNote) {
            this.emit(session, "extract.quarantined", CLAUDE, "replay", {
              docId: photo.documentId,
              row,
              box: null,
              source: "screen",
            });
          }
        });
      });
    });
    steps.push(() => this.raiseHolds(session));
    steps.push(() => this.setRunState(session, "COMPUTED", ENGINE, "lines_computed"));
    steps.push(() => {
      this.setRunState(session, "IN_REVIEW", ENGINE, "holds_open");
      session.readingDone = true;
    });
    this.schedule(session, steps, PACE.row);
  }

  private raiseHolds(session: MockSession): void {
    for (const seed of this.snapshot.holds) {
      const holdId = mockUuid(`hold:${session.runSeq}:${seed.key}`);
      session.holds.set(holdId, {
        holdId,
        seed,
        state: "OPEN",
        resolution: null,
        resolvedBy: null,
        resolvedAt: null,
      });
      const line = seed.memberNo ? session.lines.get(seed.memberNo) : undefined;
      this.emit(session, "hold.raised", ENGINE, "live", {
        holdId,
        label: seed.label,
        key: seed.key,
        kind: seed.kind,
        gate: seed.gate,
        memberNo: seed.memberNo,
        lineId: line?.lineId ?? null,
      });
      if (seed.memberNo) this.setLine(session, seed.memberNo, "HELD", ENGINE, `hold:${seed.label}`);
    }
  }

  private holdOf(holdId: string): { session: MockSession; hold: MockHold } {
    for (const session of this.sessions.values()) {
      const byId = session.holds.get(holdId);
      if (byId) return { session, hold: byId };
      for (const hold of session.holds.values()) if (hold.seed.label === holdId) return { session, hold };
    }
    throw new MockApiError("NOT_FOUND", "No hold with that ID.");
  }

  private holdDto(session: MockSession, hold: MockHold): HoldDTO {
    const line = hold.seed.memberNo ? session.lines.get(hold.seed.memberNo) : undefined;
    return {
      id: hold.holdId,
      workspaceId: session.workspaceId,
      runId: session.runId,
      label: hold.seed.label,
      key: hold.seed.key,
      lineId: line?.lineId ?? null,
      memberNo: hold.seed.memberNo,
      kind: hold.seed.kind,
      gate: hold.seed.gate,
      state: hold.state,
      engineParams: {},
      engineLine: hold.seed.engineLine,
      claudeLine: hold.seed.claudeLine,
      evidence: hold.seed.serials.map((s) => ({ kind: "slip", ref: s })),
      resolution: hold.resolution
        ? { kind: hold.resolution, by: hold.resolvedBy ?? "AS", at: hold.resolvedAt, reason: null }
        : null,
      provenance: "live",
    };
  }

  private resolve(
    session: MockSession,
    hold: MockHold,
    kind: HoldResolutionKind,
    by: Actor,
    state: "RESOLVED" | "ASKED_CHAIR" = "RESOLVED",
  ): void {
    hold.state = state;
    hold.resolution = kind;
    hold.resolvedBy = by.kind === "human" ? "AS" : "engine";
    hold.resolvedAt = new Date(this.now()).toISOString();
    this.emit(session, "hold.resolved", by, "live", {
      holdId: hold.holdId,
      label: hold.seed.label,
      state,
      resolution: kind,
      resolvedBy: hold.resolvedBy,
    });
    if (state === "RESOLVED" && hold.seed.memberNo) {
      this.setLine(session, hold.seed.memberNo, "READY", ENGINE, `resolved:${hold.seed.label}`);
    }
  }

  resolveHold(holdId: string, request: CommandRequest<"resolveHold">): CommandResponse<"resolveHold"> {
    const { session, hold } = this.holdOf(holdId);
    if (hold.state !== "OPEN") throw new MockApiError("HOLD_NOT_OPEN", "This hold is already decided.");
    const allowed: Readonly<Record<string, readonly string[]>> = {
      DUPLICATE_SLIP: ["COUNT_ONCE", "TWO_DELIVERIES", "ASK_CHAIR"],
      IMPLAUSIBLE_YIELD: ["REGISTER_PLOT", "EXCLUDE_LINE", "ASK_CHAIR"],
      NO_RULE: ["RETURN_AS_CREDIT", "APPLY_RULE", "ASK_CHAIR"],
      LOW_CONFIDENCE: ["CONFIRM_AS_READ"],
      MASS_BALANCE: [],
      RATE_MISMATCH: ["APPLY_RULE", "EXCLUDE_LINE"],
      SUSPECTED_INJECTION: ["EXCLUDE_LINE"],
    };
    if (!(allowed[hold.seed.kind] ?? []).includes(request.resolution)) {
      throw new MockApiError("RESOLUTION_NOT_ALLOWED", "That resolution does not apply to this hold.");
    }
    const needsChair = request.resolution === "TWO_DELIVERIES" || request.resolution === "ASK_CHAIR";
    if (needsChair) {
      this.resolve(
        session,
        hold,
        request.resolution === "ASK_CHAIR" ? "TWO_DELIVERIES" : request.resolution,
        TREASURER,
        "ASKED_CHAIR",
      );
    } else {
      this.resolve(session, hold, request.resolution as HoldResolutionKind, TREASURER);
      if (hold.seed.kind === "DUPLICATE_SLIP") {
        for (const other of session.holds.values()) {
          if (other.seed.kind === "MASS_BALANCE" && other.state === "OPEN")
            this.resolve(session, other, "ENGINE_CLEARED", ENGINE);
        }
      }
    }
    return {
      hold: this.holdDto(session, hold),
      resolution: hold.resolution,
      runVersion: session.version,
      recomputed: !needsChair,
      needsChair,
    };
  }

  enterField(fieldId: string, request: CommandRequest<"enterField">): CommandResponse<"enterField"> {
    let found: { session: MockSession; hold: MockHold } | null = null;
    for (const session of this.sessions.values()) {
      for (const hold of session.holds.values()) {
        if (
          hold.seed.kind === "LOW_CONFIDENCE" &&
          (fieldIdFor(session, hold) === fieldId || hold.seed.serials.includes(fieldId))
        ) {
          found = { session, hold };
        }
      }
    }
    if (!found) throw new MockApiError("NOT_FOUND", "No field waiting for a person with that ID.");
    const { session, hold } = found;
    if (!/^\d{1,3}\.\d{2}$/.test(request.value)) {
      throw new MockApiError("VALIDATION_FAILED", "Type kilos with two decimals, like 64.80.");
    }
    const serial = hold.seed.serials[0] ?? "0462";
    const slip = this.snapshot.slips.find((s) => s.serial === serial);
    const tare = slip ? Number(slip.boxes["7"]) : 0.3;
    const gross = Number(request.value);
    const net = (Math.round(gross * 100) - Math.round(tare * 100)) / 100;
    const netText = net.toFixed(2);
    const logbook = this.snapshot.logbook.flatMap((p) => p.lines).find((l) => l.serial === serial);
    const logbookMatch = logbook ? logbook.netKgText === netText : null;
    const pattern = slip ? slip.boxes["6"].replace(/^(\d)\d/, "$1?") : "?";
    const matchesReadPattern = new RegExp(`^${pattern.replace(".", "\\.").replace("?", "\\d")}$`).test(
      request.value,
    );
    const id = fieldIdFor(session, hold);
    this.emit(session, "field.entered", TREASURER, "live", {
      fieldId: id,
      docId: slip?.documentId ?? mockUuid(`doc:${serial}`),
      serial,
      field: "gross_kg",
      value: request.value,
      derived: { net_kg: netText },
      enteredBy: "AS",
    });
    this.resolve(session, hold, "ENTERED_BY_HAND", TREASURER);
    const dto: SlipFieldDTO = {
      id,
      workspaceId: session.workspaceId,
      slipRowId: slip?.rowId ?? mockUuid(`row:${serial}`),
      field: "gross_kg",
      readA: { valueText: pattern, legibility: "SMUDGED" },
      readB: { valueText: pattern, legibility: "SMUDGED" },
      zoom: null,
      score: 0.4,
      displayMerge: pattern,
      finalValue: request.value,
      decidedBy: "person",
      provenance: "live",
    };
    return {
      field: dto,
      derived: { net_kg: netText },
      logbookMatch,
      matchesReadPattern,
      runVersion: session.version,
    };
  }

  addDeduction(): never {
    const card = this.snapshot.rateCard;
    throw new MockApiError(
      "RATE_CARD_RATIFIED",
      "Closed list. BR 2026-04, Schedule A, allows only CBU, hauling, loans with an Authority to Deduct and advances with a voucher. A new deduction needs a new Board resolution for Season 2026-B.",
      { hash: card.sha256, rateCard: card.canonical.resolutionNo, ratifiedOn: card.canonical.ratifiedOn },
    );
  }

  private blockingOpen(session: MockSession): number {
    let n = 0;
    for (const hold of session.holds.values()) {
      if (hold.seed.gate === "BLOCKS_APPROVAL" && (hold.state === "OPEN" || hold.state === "ASKED_CHAIR"))
        n += 1;
    }
    return n;
  }

  /** The batch digest a session's signers bind (mock: derived from the session and the seed's batch). */
  batchSha256(session: MockSession): string {
    return mockHex(`batch:${session.runId}:${this.snapshot.run.batchSha256}`, 64);
  }

  approvalPayload(runSlug: string, role: ApprovalRole): CommandResponse<"approvalPayload"> {
    const session = this.requireSession(runSlug);
    if (!session.readingDone || this.blockingOpen(session) > 0) {
      throw new MockApiError("BLOCKING_HOLDS_OPEN", "Resolve the holds that change kilos first.");
    }
    if (role === "chair" && !session.approvals.has("treasurer")) {
      throw new MockApiError("INVALID_TRANSITION", "The treasurer signs first.");
    }
    const run = this.snapshot.run;
    const payload: ApprovalPayload = {
      v: 1,
      runId: session.runId,
      seasonId: this.snapshot.season.id,
      rateCardSha256: this.snapshot.rateCard.sha256,
      batchSha256: this.batchSha256(session),
      itemCount: run.items.length,
      totalCents: run.items.reduce((sum, i) => sum + i.amountCents, 0),
      currency: "USD",
      role,
      approverId: role === "treasurer" ? "treasurer:analyn" : "board:ernesto",
      nonce: mockHex(`nonce:${session.runId}:${role}:${session.version}`, 24),
      exp: new Date(this.now() + 30 * 60_000).toISOString(),
    };
    session.payloads.set(role, payload);
    return { payload, jcs: canonicalJson(payload) };
  }

  submitApproval(
    runSlug: string,
    request: CommandRequest<"submitApproval">,
  ): CommandResponse<"submitApproval"> {
    const session = this.requireSession(runSlug);
    const role = request.role;
    if (this.blockingOpen(session) > 0)
      throw new MockApiError("BLOCKING_HOLDS_OPEN", "Resolve the holds first.");
    if (request.payload.batchSha256 !== this.batchSha256(session)) {
      throw new MockApiError("DIGEST_MISMATCH", "The batch changed after it was signed. Nothing was sent.");
    }
    if (Date.parse(request.payload.exp) <= this.now()) {
      throw new MockApiError("APPROVAL_EXPIRED", "The co-sign request expired. Send again.");
    }
    if (session.usedNonces.has(request.payload.nonce))
      throw new MockApiError("NONCE_REUSED", "That approval was already used.");
    if (request.payload.role !== role)
      throw new MockApiError("APPROVER_MISMATCH", "The payload names another role.");
    if (role === "chair" && !session.approvals.has("treasurer")) {
      throw new MockApiError("INVALID_TRANSITION", "The treasurer signs first.");
    }
    if (session.approvals.has(role))
      throw new MockApiError("INVALID_TRANSITION", "This role already signed.");
    const other = session.approvals.get(role === "treasurer" ? "chair" : "treasurer");
    if (other && other.keyId === request.keyId)
      throw new MockApiError("SIGNERS_NOT_DISTINCT", "Two people sign with two keys.");
    session.usedNonces.add(request.payload.nonce);
    session.approvals.set(role, { nonce: request.payload.nonce, keyId: request.keyId });
    const approvalId = mockUuid(`approval:${session.runId}:${role}`);
    const actor = role === "treasurer" ? TREASURER : CHAIR;
    this.emit(session, "approval.signed", actor, "live", {
      approvalId,
      role,
      keyId: request.keyId,
      batchSha256: request.payload.batchSha256,
    });
    if (role === "treasurer") {
      this.setRunState(session, "TREASURER_APPROVED", TREASURER, "key_1");
      this.setRunState(session, "AWAITING_BOARD", SYSTEM, "chair_needed");
    } else {
      this.setRunState(session, "APPROVED", CHAIR, "key_2");
      this.startFanout(session);
    }
    const signedAt = new Date(this.now()).toISOString();
    return {
      approval: {
        id: approvalId,
        workspaceId: session.workspaceId,
        runId: session.runId,
        role,
        keyId: request.keyId,
        payloadJcs: canonicalJson(request.payload),
        signatureHex: request.signature,
        nonce: request.payload.nonce,
        exp: request.payload.exp,
        signedAt,
        voidedAt: null,
        keyLabel: "Demo key (this browser)",
        provenance: "live",
      },
      runState: session.state,
      needsChair: role === "treasurer",
    };
  }

  /** The Chair's key, from the Chair frame or the judge's phone. Tests and the dev toolbar call it. */
  cosign(runSlug: string): CommandResponse<"submitApproval"> {
    const payload = this.approvalPayload(runSlug, "chair").payload;
    return this.submitApproval(runSlug, {
      role: "chair",
      keyId: "fs-ernesto-w1",
      signature: mockHex(`sig:${payload.nonce}`, 128),
      payload,
    });
  }

  declineApproval(
    runSlug: string,
    request: CommandRequest<"declineApproval">,
  ): CommandResponse<"declineApproval"> {
    const session = this.requireSession(runSlug);
    if (session.state !== "AWAITING_BOARD")
      throw new MockApiError("INVALID_TRANSITION", "Nothing is waiting for the Chair.");
    this.emit(session, "approval.declined", CHAIR, "live", {
      role: request.role,
      reason: request.reason,
      by: "board:ernesto",
    });
    session.approvals.clear();
    this.setRunState(session, "IN_REVIEW", CHAIR, "declined");
    return { runState: session.state };
  }

  private startFanout(session: MockSession): void {
    const items = this.snapshot.run.items;
    const steps: (() => void)[] = [
      () => this.setRunState(session, "POSTING", SYSTEM, "post_batch"),
      () => {
        this.setRunState(session, "POSTED", PAYPAL, "batch_201");
        for (const item of items) {
          const senderItemId = `r${session.runSeq}-${item.memberNo}`;
          session.items.set(senderItemId, { senderItemId, memberNo: item.memberNo, status: "PENDING" });
          this.emit(session, "item.updated", PAYPAL, "simulated_rail", {
            itemId: mockUuid(`item:${senderItemId}`),
            senderItemId,
            memberNo: item.memberNo,
            payoutItemId: `MOCK${mockHex(`pi:${senderItemId}`, 9).toUpperCase()}`,
            from: "SUBMITTED",
            to: "PENDING",
            rank: 10,
            source: "post_response",
            eventId: null,
          });
        }
      },
    ];
    const rhea = items.find((i) => i.status === "RETURNED");
    for (const item of items) {
      steps.push(() => {
        const senderItemId = `r${session.runSeq}-${item.memberNo}`;
        const parked = item === rhea;
        const eventId = `WH-MOCK-${mockHex(`wh:${senderItemId}`, 10).toUpperCase()}`;
        this.emit(session, "webhook.received", PAYPAL, "simulated_rail", {
          webhookEventId: mockUuid(`whid:${senderItemId}`),
          paypalEventId: eventId,
          eventType: parked ? "PAYMENT.PAYOUTS-ITEM.UNCLAIMED" : "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
          verified: "self",
          duplicate: false,
        });
        session.items.set(senderItemId, {
          senderItemId,
          memberNo: item.memberNo,
          status: parked ? "UNCLAIMED" : "SUCCESS",
        });
        this.emit(session, "item.updated", PAYPAL, "simulated_rail", {
          itemId: mockUuid(`item:${senderItemId}`),
          senderItemId,
          memberNo: item.memberNo,
          payoutItemId: `MOCK${mockHex(`pi:${senderItemId}`, 9).toUpperCase()}`,
          from: "PENDING",
          to: parked ? "UNCLAIMED" : "SUCCESS",
          rank: parked ? 30 : 60,
          source: "webhook",
          eventId,
        });
      });
    }
    steps.push(() => {
      const hero = items.find((i) => i.memberNo === "M-014") ?? items[0];
      if (!hero) return;
      const senderItemId = `r${session.runSeq}-${hero.memberNo}`;
      this.emit(session, "webhook.received", PAYPAL, "simulated_rail", {
        webhookEventId: mockUuid(`whid:${senderItemId}:resend`),
        paypalEventId: `WH-MOCK-${mockHex(`wh:${senderItemId}`, 10).toUpperCase()}`,
        eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        verified: "self",
        duplicate: true,
      });
    });
    steps.push(() => {
      this.setRunState(session, "SETTLING", SYSTEM, "items_landing");
      this.setRunState(session, "NEEDS_FOLLOW_UP", SYSTEM, rhea ? "unclaimed" : "settled");
      session.fanoutDone = true;
    });
    this.schedule(session, steps, PACE.webhook);
  }

  payCash(lineId: string): CommandResponse<"payCash"> {
    for (const session of this.sessions.values()) {
      for (const [memberNo, line] of session.lines) {
        if (line.lineId !== lineId) continue;
        const senderItemId = `r${session.runSeq}-${memberNo}`;
        const item = session.items.get(senderItemId);
        if (item?.status !== "UNCLAIMED") {
          throw new MockApiError("INVALID_TRANSITION", "Only a parked PayPal item moves to cash.");
        }
        item.status = "RETURNED";
        this.emit(session, "item.updated", PAYPAL, "simulated_rail", {
          itemId: mockUuid(`item:${senderItemId}`),
          senderItemId,
          memberNo,
          payoutItemId: `MOCK${mockHex(`pi:${senderItemId}`, 9).toUpperCase()}`,
          from: "UNCLAIMED",
          to: "RETURNED",
          rank: 40,
          source: "cancel",
          eventId: null,
        });
        this.setLine(session, memberNo, "OFF_RAIL_DUE", ENGINE, "rerouted_to_cash");
        this.setRunState(session, "SETTLED", SYSTEM, "all_terminal");
        return { line: this.lineDto(session, memberNo), cancelled: true };
      }
    }
    throw new MockApiError("NOT_FOUND", "No line with that ID.");
  }

  private lineDto(session: MockSession, memberNo: string): MemberLineDTO {
    const line = session.lines.get(memberNo);
    const engine = this.snapshot.checkpoints.resolved.lines.find((l) => l.memberNo === memberNo);
    const member = this.snapshot.members.find((m) => m.memberNo === memberNo);
    if (!line || !engine || !member) throw new MockApiError("NOT_FOUND", "No line for that member.");
    return {
      id: line.lineId,
      workspaceId: session.workspaceId,
      runId: session.runId,
      memberId: member.id,
      memberNo,
      state: line.state,
      rail: engine.rail,
      verifiedG: engine.verifiedG,
      grade1G: engine.grade1G,
      premiumCents: engine.premiumCents,
      bonusCents: engine.bonusCents,
      deductions: engine.deductions.map((d) => ({
        ruleId: d.ruleId,
        category: d.category,
        amountCents: d.amountCents,
        ref: d.ref,
      })),
      creditsCents: engine.creditsCents,
      netCents: engine.netCents,
      lineSha256: engine.lineSha256,
      trace: engine.slipSerials,
      provenance: "live",
    };
  }

  /** A line ID for a member in the session that owns `runSlug` (tests and the dev toolbar). */
  lineIdFor(runSlug: string, memberNo: string): string | null {
    return this.sessionForRun(runSlug)?.lines.get(memberNo)?.lineId ?? null;
  }

  /** The by-hand field ID in a session (S1.6: slip 0462). */
  byHandFieldId(runSlug: string): string | null {
    const session = this.sessionForRun(runSlug);
    if (!session) return null;
    for (const hold of session.holds.values())
      if (hold.seed.kind === "LOW_CONFIDENCE") return fieldIdFor(session, hold);
    return null;
  }

  holdIdFor(runSlug: string, label: string): string | null {
    const session = this.sessionForRun(runSlug);
    if (!session) return null;
    for (const hold of session.holds.values()) if (hold.seed.label === label) return hold.holdId;
    return null;
  }

  resend(lineId: string, request: CommandRequest<"resend">): CommandResponse<"resend"> {
    for (const session of this.sessions.values()) {
      for (const [memberNo, line] of session.lines) {
        if (line.lineId !== lineId) continue;
        if (session.items.get(`r${session.runSeq}-${memberNo}`)?.status !== "UNCLAIMED") {
          throw new MockApiError("INVALID_TRANSITION", "Only a parked item can be re-sent.");
        }
        void request;
        return {
          line: this.lineDto(session, memberNo),
          senderBatchId: `${this.snapshot.season.code}-mock-r${session.runSeq}-x1`,
        };
      }
    }
    throw new MockApiError("NOT_FOUND", "No line with that ID.");
  }

  capture(request: CommandRequest<"capture">, session: MockSession | null): CommandResponse<"capture"> {
    const known = session?.captures.get(request.captureId);
    if (known) return { documentId: known, status: "already_received", exactDuplicateOf: null };
    const documentId = mockUuid(`capture:${request.captureId}`);
    session?.captures.set(request.captureId, documentId);
    return { documentId, status: "accepted", exactDuplicateOf: null };
  }

  createPairing(request: CommandRequest<"createPairing">): CommandResponse<"createPairing"> {
    const code = String(
      100_000 + (Number.parseInt(mockHex(`pair:${request.persona}:${this.now()}`, 8), 16) % 900_000),
    );
    return {
      url: `/app/pair#t=${mockHex(`pair-token:${request.persona}:${this.now()}`, 32)}`,
      code6: code,
      expiresAt: new Date(this.now() + 10 * 60_000).toISOString(),
    };
  }

  claimPairing(): CommandResponse<"claimPairing"> {
    throw new MockApiError("PAIRING_TOKEN_INVALID", "Pairing runs on the app's own API.");
  }

  presence(session: MockSession | null, request: CommandRequest<"presence">): CommandResponse<"presence"> {
    if (session) {
      this.emit(session, "presence", TREASURER, "live", {
        persona: "treasurer:analyn",
        view: request.view,
        holdId: request.holdId ?? null,
        expiresAt: new Date(this.now() + 25_000).toISOString(),
      });
    }
    return { ok: true };
  }

  createReviewRequest(
    session: MockSession | null,
    request: CommandRequest<"createReviewRequest">,
  ): CommandResponse<"createReviewRequest"> {
    const memberNo = session
      ? [...session.lines].find(([, l]) => l.lineId === request.lineId)?.[0]
      : undefined;
    return {
      reviewRequest: {
        id: mockUuid(`review:${request.lineId}:${this.now()}`),
        workspaceId: session?.workspaceId ?? mockUuid("workspace:showcase"),
        lineId: request.lineId,
        memberNo: memberNo ?? "M-014",
        slipSerial: request.slipSerial ?? null,
        note: request.note ?? null,
        state: "open",
        answer: null,
        createdAt: new Date(this.now()).toISOString(),
        provenance: "live",
      },
    };
  }

  setFlag(session: MockSession | null, request: CommandRequest<"setFlag">): CommandResponse<"setFlag"> {
    if (session)
      this.emit(session, "flag.changed", TREASURER, "live", {
        flag: request.flag,
        on: request.on,
        by: "treasurer:analyn",
      });
    return {
      flag: {
        workspaceId: session?.workspaceId ?? mockUuid("workspace:showcase"),
        flag: request.flag,
        on: request.on,
        setBy: "treasurer:analyn",
        setAt: new Date(this.now()).toISOString(),
        forcedByEnv: false,
      },
    };
  }

  proof(runSlug: string, brand: boolean): CommandResponse<"proof"> {
    if (runSlug !== this.snapshot.run.runSlug && !this.sessionForRun(runSlug)) {
      throw new MockApiError("NOT_FOUND", `No Proof for ${runSlug} yet.`);
    }
    return { bundle: this.snapshot.proof, provenance: "seeded", redacted: !brand };
  }
}

function cause(code: string, ref: string | null = null) {
  return { code, ref };
}

function field(value: string | null, score: number, display?: string) {
  return {
    value,
    score,
    decidedBy: score >= 0.85 ? ("agreement" as const) : null,
    display: display ?? value ?? "?",
  };
}

function fieldIdFor(session: MockSession, hold: MockHold): string {
  return mockUuid(`field:${session.runSeq}:${hold.seed.key}`);
}
