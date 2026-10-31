// The judge session (S3.9): the first press starts it, Reset ends it. The console token lives in memory only
// (never storage, never a URL); a refresh returns to the first view, and the API's judge cookie resumes the
// session on the next press.

import { judgeRoutes } from "@fairsplit/api-client";
import type { PayRunState } from "@fairsplit/contracts";
import type { DataAdapter } from "./adapter.js";
import { type CommandError, isApiClientError } from "./errors.js";

export interface JudgeSession {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly runSlug: string;
  readonly expiresAt: string;
  /** Position in the single-flight live lane, when the sandbox is pacing us (S1.6 `queued`). */
  readonly queuePosition: number | null;
}

/** `ended`: the server ended the session meanwhile (a Reset in another tab, or the workspace expired). */
export type SessionStatus = "none" | "starting" | "active" | "resetting" | "failed" | "ended";

export interface SessionState {
  readonly status: SessionStatus;
  readonly session: JudgeSession | null;
  /** Why the start failed ("failed"), or why the last Reset did not go through ("active"). */
  readonly error: CommandError | null;
}

const NONE: SessionState = { status: "none", session: null, error: null };

/**
 * The console token lives 2 hours while the judge cookie and its workspace live 24 (S3.8): the store renews the
 * token this long before it lapses, and at once when a call answers FRAME_TOKEN_EXPIRED. A renewal is
 * createJudgeSession sent with the cookie alone, which resumes the same session with a fresh token (S3.9).
 */
export const TOKEN_RENEW_EARLY_MS = 5 * 60_000;

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
  private renewing: Promise<void> | null = null;
  private renewTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly renewListeners = new Set<() => void>();

  constructor(
    private readonly adapter: DataAdapter,
    private readonly now: () => number = () => Date.now(),
  ) {
    adapter.onFailure((failure) => {
      if (isApiClientError(failure, "FRAME_TOKEN_EXPIRED") && this.state.session) void this.renew();
    });
    // A Reset in another tab revoked this session's tokens (fs-api answers the console's token 401
    // UNAUTHENTICATED): the session ended, as when a renewal lands in another workspace. Nothing is renewed (that
    // would mint a new workspace), and the stage returns to the first press and says why.
    adapter.onTokenRefused(() => {
      if (this.state.status === "active" && this.state.session) this.end();
    });
  }

  /** Called after the token is renewed (the hub reopens the streams the lapsed token closed). */
  onRenewed = (listener: () => void): (() => void) => {
    this.renewListeners.add(listener);
    return () => this.renewListeners.delete(listener);
  };

  private scheduleRenewal(session: JudgeSession, atLeastMs = 0): void {
    this.cancelRenewal();
    const at = Date.parse(session.expiresAt) - TOKEN_RENEW_EARLY_MS;
    if (Number.isNaN(at)) return;
    this.renewTimer = setTimeout(() => void this.renew(), Math.max(atLeastMs, at - this.now()));
  }

  private cancelRenewal(): void {
    if (this.renewTimer !== null) clearTimeout(this.renewTimer);
    this.renewTimer = null;
  }

  /**
   * Renews the console token: createJudgeSession with the judge cookie alone resumes the session with a fresh
   * token. A failure leaves the session as it is (the next lapse or refusal tries again). An answer for another
   * workspace or run means the cookie's workspace had ended (a Reset in another tab clears the claim, or it
   * expired) and fs-api started a new one: that is not this session, so nothing adopts it, and the session ends.
   */
  renew(): Promise<void> {
    if (this.renewing) return this.renewing;
    const session = this.state.session;
    if (!session || this.state.status !== "active") return Promise.resolve();
    this.renewing = this.adapter.api
      .call("createJudgeSession", { body: {}, token: null })
      .then((resumed) => {
        if (this.state.session?.sessionId !== session.sessionId) return;
        if (!sameSession(session, resumed)) {
          this.end();
          return;
        }
        this.adapter.setToken(resumed.consoleToken);
        const next: JudgeSession = { ...sessionOf(resumed) };
        this.set({ ...this.state, session: next });
        // Never sooner than a minute after a renewal, whatever the clocks say.
        this.scheduleRenewal(next, 60_000);
        for (const listener of this.renewListeners) listener();
      })
      .catch(() => undefined)
      .finally(() => {
        this.renewing = null;
      });
    return this.renewing;
  }

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
        const session = sessionOf(created);
        this.set({ status: "active", session, error: null });
        this.scheduleRenewal(session);
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
    // Reset (or a new session) while waiting ends the press: nothing is recorded for a session being let go.
    const current = () =>
      this.state.status === "active" && this.state.session?.sessionId === session.sessionId;
    for (;;) {
      if (!current()) return "ended";
      let runState: PayRunState | null;
      try {
        const status = await routes.judgeSession();
        if (!current()) return "ended";
        if (status.runSlug !== null && status.runSlug !== session.runSlug) return null;
        runState = status.runState;
      } catch {
        if (!current()) return "ended";
        // No status read (an older API, a blip): go on, and let markPaid's own answer speak.
        return null;
      }
      if (runState === null || !BEFORE_INVOICED.has(runState)) return runState;
      if (Date.now() >= deadline) return runState;
      await sleep(delay);
      delay = Math.min(INVOICE_WAIT.maxMs, delay * 2);
    }
  }

  /**
   * Reset: cancels parked items and expires the workspace (about 10 s), then the first view returns. A session
   * the server already ended (401, 410) counts as reset. Any other failure leaves the session as it is, with
   * the error, because the server still holds it: the stage says so and Reset can be pressed again.
   */
  async reset(): Promise<void> {
    const session = this.state.session;
    if (!session) {
      this.set(NONE);
      return;
    }
    this.set({ status: "resetting", session, error: null });
    try {
      await this.adapter.pending.resetSession(session.sessionId);
    } catch (error) {
      if (!alreadyEnded(error)) {
        this.set({ status: "active", session, error: error as CommandError });
        throw error;
      }
    }
    this.cancelRenewal();
    this.adapter.setToken(null);
    this.set(NONE);
  }

  /** The server ended the session: no credential, no renewal, and the first view returns with a notice. */
  private end(): void {
    this.cancelRenewal();
    this.adapter.setToken(null);
    this.set({ status: "ended", session: null, error: null });
  }

  /** Clears a failed start so the press can be tried again, a failed Reset's notice, or an ended session's. */
  dismissError(): void {
    if (this.state.status === "failed" || this.state.status === "ended") this.set(NONE);
    else if (this.state.error) this.set({ ...this.state, error: null });
  }
}

function sessionOf(created: {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly runSlug: string;
  readonly expiresAt: string;
  readonly queuePosition: number | null;
}): JudgeSession {
  return {
    sessionId: created.sessionId,
    workspaceId: created.workspaceId,
    runId: created.runId,
    runSlug: created.runSlug,
    expiresAt: created.expiresAt,
    queuePosition: created.queuePosition,
  };
}

/** The same session, workspace and run: a renewal that answers anything else is a new workspace, not this one. */
function sameSession(
  session: JudgeSession,
  resumed: { readonly sessionId: string; readonly workspaceId: string; readonly runId: string },
): boolean {
  return (
    resumed.sessionId === session.sessionId &&
    resumed.workspaceId === session.workspaceId &&
    resumed.runId === session.runId
  );
}

/** A Reset answered 401 or 410: the session had already ended on the server. */
function alreadyEnded(error: unknown): boolean {
  return isApiClientError(error) && (error.status === 401 || error.status === 410);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
