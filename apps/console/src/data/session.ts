// The judge session (S3.9): the first press starts it, Reset ends it. The console token lives in memory only
// (never storage, never a URL); a refresh returns to the first view, and the API's judge cookie resumes the
// session on the next press.

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
