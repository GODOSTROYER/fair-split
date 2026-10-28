// The judge session (S3.9): the first press starts it, Reset ends it. The console token lives in memory only
// (never storage, never a URL); a refresh returns to the first view, and the API's judge cookie resumes the
// session on the next press.

import { judgeRoutes } from "@fairsplit/api-client";
import type { PayRunState } from "@fairsplit/contracts";
import type { DataAdapter } from "./adapter.js";
import type { CommandError } from "./errors.js";

export interface JudgeSession {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly runSlug: string;
  readonly expiresAt: string;
  /** Position in the single-flight live lane, when the sandbox is pacing us (S1.6 `queued`). */
  readonly queuePosition: number | null;
}

export type SessionStatus = "none" | "starting" | "active" | "resetting" | "failed";

export interface SessionState {
  readonly status: SessionStatus;
  readonly session: JudgeSession | null;
  readonly error: CommandError | null;
}

const NONE: SessionState = { status: "none", session: null, error: null };

/**
 * How the first press waits for the session's run to be invoiced. fs-api creates the run in DRAFT and only
 * enqueues Claude's invoice turn (quote, then create and send the invoice), so markPaid answers 409 until the run
 * reads INVOICED. The press polls the session's own status read (GET /v1/judge/session, `runState`) from 250 ms
 * up to 1 s apart, and asks anyway after the deadline (the server's answer is then shown as it is).
 */
export const INVOICE_WAIT = { firstMs: 250, maxMs: 1000, deadlineMs: 45_000 } as const;

/** The states before the invoice is sent: the press waits through them. */
const BEFORE_INVOICED: ReadonlySet<PayRunState> = new Set<PayRunState>(["DRAFT", "QUOTED"]);

/**
 * What the run stood at when the press may go on: "INVOICED" (record the payment), a later state (a resumed
 * session past funding: nothing to record, the stream replays where it is), `null` when the status read is not
 * available (the press goes on and the server answers), or "ended" when the session went away meanwhile.
 */
export type InvoiceReadiness = PayRunState | null | "ended";

export class SessionStore {
  private state: SessionState = NONE;
  private readonly listeners = new Set<() => void>();
  private starting: Promise<JudgeSession> | null = null;

  constructor(private readonly adapter: DataAdapter) {}

  getState = (): SessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: SessionState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  /** Starts a session once; concurrent presses share the same request. */
  start(): Promise<JudgeSession> {
    if (this.state.session) return Promise.resolve(this.state.session);
    if (this.starting) return this.starting;
    this.set({ status: "starting", session: null, error: null });
    this.starting = this.adapter
      .call("createJudgeSession", { body: {} })
      .then((created) => {
        this.adapter.setToken(created.consoleToken);
        const session: JudgeSession = {
          sessionId: created.sessionId,
          workspaceId: created.workspaceId,
          runId: created.runId,
          runSlug: created.runSlug,
          expiresAt: created.expiresAt,
          queuePosition: created.queuePosition,
        };
        this.set({ status: "active", session, error: null });
        return session;
      })
      .catch((error: CommandError) => {
        this.set({ status: "failed", session: null, error });
        throw error;
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }

  /** Waits until the session's run is invoiced (or past it): see INVOICE_WAIT. */
  async whenInvoiced(
    session: JudgeSession,
    sleep: (ms: number) => Promise<void> = wait,
  ): Promise<InvoiceReadiness> {
    const routes = judgeRoutes(this.adapter.api);
    const deadline = Date.now() + INVOICE_WAIT.deadlineMs;
    let delay: number = INVOICE_WAIT.firstMs;
    for (;;) {
      if (this.state.session?.sessionId !== session.sessionId) return "ended";
      let runState: PayRunState | null;
      try {
        const status = await routes.judgeSession();
        if (status.runSlug !== null && status.runSlug !== session.runSlug) return null;
        runState = status.runState;
      } catch {
        // No status read (an older API, a blip): go on, and let markPaid's own answer speak.
        return null;
      }
      if (runState === null || !BEFORE_INVOICED.has(runState)) return runState;
      if (Date.now() >= deadline) return runState;
      await sleep(delay);
      delay = Math.min(INVOICE_WAIT.maxMs, delay * 2);
    }
  }

  /** Reset: cancels parked items and expires the workspace (about 10 s), then the first view returns. */
  async reset(): Promise<void> {
    const session = this.state.session;
    if (!session) {
      this.set(NONE);
      return;
    }
    this.set({ status: "resetting", session, error: null });
    try {
      await this.adapter.pending.resetSession(session.sessionId);
    } finally {
      this.adapter.setToken(null);
      this.set(NONE);
    }
  }

  /** Clears a failed start so the press can be tried again. */
  dismissError(): void {
    if (this.state.status === "failed") this.set(NONE);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
