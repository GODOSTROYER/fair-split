// The judge session (S3.9): the first press starts it, Reset ends it. The console token lives in memory only
// (never storage, never a URL). A tab saves only its visit identifiers; the judge cookie authenticates resume.

import { judgeRoutes } from "@fairsplit/api-client";
import type { PayRunState } from "@fairsplit/contracts";
import { forgetBrowserKeys } from "../features/approve/keys.js";
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
export type SessionStatus = "none" | "starting" | "resuming" | "active" | "resetting" | "failed" | "ended";

export interface SessionState {
  readonly status: SessionStatus;
  readonly session: JudgeSession | null;
  /** Why the start failed ("failed"), or why the last Reset did not go through ("active"). */
  readonly error: CommandError | null;
  readonly pressing?: boolean;
}

const NONE: SessionState = { status: "none", session: null, error: null };
export const JUDGE_TAB_KEY = "fs.judge.tab";
type TabStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserTabStorage(): TabStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The console token lives 2 hours while the judge cookie and its workspace live 24 (S3.8): the store renews the
 * token this long before it lapses, and at once when a call answers FRAME_TOKEN_EXPIRED. A renewal is
 * renewJudgeSession sent with the cookie alone, which resumes only the same session with a fresh token (S3.9).
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
  private resumeVersion = 0;

  constructor(
    private readonly adapter: DataAdapter,
    private readonly now: () => number = () => Date.now(),
    private readonly storage: TabStorage | null = browserTabStorage(),
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
    const saved = this.savedVisit();
    if (saved) {
      const version = this.resumeVersion;
      this.set({ status: "resuming", session: null, error: null });
      this.starting = judgeRoutes(adapter.api)
        .renewJudgeSession({ params: { sid: saved.sessionId }, token: null })
        .then((resumed) => {
          if (version !== this.resumeVersion) throw new Error("The saved visit was reset while resuming.");
          if (resumed.sessionId !== saved.sessionId || resumed.runSlug !== saved.runSlug) {
            this.end();
            throw new Error("The saved visit no longer matches its run.");
          }
          const session = sessionOf(resumed);
          this.adapter.setToken(resumed.consoleToken);
          this.saveVisit(session);
          this.set({ status: "active", session, error: null });
          this.scheduleRenewal(session);
          return session;
        })
        .catch((error: unknown) => {
          if (version !== this.resumeVersion) throw error;
          if (isApiClientError(error) && [401, 403, 404, 410].includes(error.status)) this.end();
          else if (this.state.status !== "ended")
            this.set({ status: "failed", session: null, error: error as CommandError });
          throw error;
        })
        .finally(() => {
          if (version === this.resumeVersion) this.starting = null;
        });
      // Boot has no awaiting caller; a later first press can still join this same promise.
      void this.starting.catch(() => undefined);
    }
  }

  private savedVisit(): { sessionId: string; runSlug: string } | null {
    try {
      const text = this.storage?.getItem(JUDGE_TAB_KEY);
      if (!text) return null;
      const saved: unknown = JSON.parse(text);
      if (
        saved &&
        typeof saved === "object" &&
        "sessionId" in saved &&
        "runSlug" in saved &&
        typeof saved.sessionId === "string" &&
        saved.sessionId.length > 0 &&
        typeof saved.runSlug === "string" &&
        saved.runSlug.length > 0
      )
        return { sessionId: saved.sessionId, runSlug: saved.runSlug };
    } catch {
      /* A blocked or malformed storage entry cannot prevent the first view. */
    }
    return null;
  }

  private saveVisit(session: JudgeSession | null): void {
    try {
      if (session)
        this.storage?.setItem(
          JUDGE_TAB_KEY,
          JSON.stringify({ sessionId: session.sessionId, runSlug: session.runSlug }),
        );
      else this.storage?.removeItem(JUDGE_TAB_KEY);
    } catch {
      /* Storage is optional; credentials remain in memory. */
    }
  }

  setPressing = (pressing: boolean): void => {
    this.set({ ...this.state, pressing });
  };

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
   * Renews the console token: renewJudgeSession with the judge cookie alone resumes the session with a fresh
   * token. A transient failure leaves the session for a retry; an ended or forbidden cookie ends it. An answer
   * for another workspace or run also ends it: nothing adopts a credential for a different session.
   */
  renew(): Promise<void> {
    if (this.renewing) return this.renewing;
    const session = this.state.session;
    if (!session || this.state.status !== "active") return Promise.resolve();
    this.renewing = judgeRoutes(this.adapter.api)
      .renewJudgeSession({ params: { sid: session.sessionId }, token: null })
      .then((resumed) => {
        if (this.state.session?.sessionId !== session.sessionId) return;
        if (!sameSession(session, resumed)) {
          this.end();
          return;
        }
        this.adapter.setToken(resumed.consoleToken);
        const next: JudgeSession = { ...sessionOf(resumed) };
        this.saveVisit(next);
        this.set({ ...this.state, session: next });
        // Never sooner than a minute after a renewal, whatever the clocks say.
        this.scheduleRenewal(next, 60_000);
        for (const listener of this.renewListeners) listener();
      })
      .catch((error: unknown) => {
        if (this.state.session?.sessionId !== session.sessionId) return;
        if (alreadyEnded(error) || isApiClientError(error, "FORBIDDEN")) this.end();
      })
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
    this.set({
      status: "starting",
      session: null,
      error: null,
      ...(this.state.pressing ? { pressing: true } : {}),
    });
    this.starting = this.adapter
      .call("createJudgeSession", { body: {} })
      .then((created) => {
        this.adapter.setToken(created.consoleToken);
        const session = sessionOf(created);
        this.saveVisit(session);
        this.set({
          status: "active",
          session,
          error: null,
          ...(this.state.pressing ? { pressing: true } : {}),
        });
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
    this.resumeVersion++;
    const session = this.state.session;
    if (!session) {
      this.starting = null;
      this.saveVisit(null);
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
    this.saveVisit(null);
    forgetBrowserKeys();
    this.set(NONE);
  }

  /** The server ended the session: no credential, no renewal, and the first view returns with a notice. */
  private end(): void {
    this.cancelRenewal();
    this.adapter.setToken(null);
    this.saveVisit(null);
    forgetBrowserKeys();
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
