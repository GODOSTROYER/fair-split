// The console's screens: IDs and routes come from contracts (register §4); the `data-state` names come
// from S1.6 to S1.8 because IC-01 does not export SCREENS[id].states yet (reported as a missing API).
// When contracts adds them, this map becomes an alias and spec-lint checks both against each other.

import { type ScreenId, testId } from "@fairsplit/contracts";

/** The web screens this SPA renders (W-DP-01 is WS-DS's /prototype and is not listed). */
export const CONSOLE_SCREEN_IDS = [
  "W-JG-01",
  "W-AU-01",
  "W-TR-01",
  "W-TR-02",
  "W-TR-03",
  "W-TR-04",
  "W-TR-05",
  "W-TR-06",
  "W-TR-07",
  "W-TR-08",
  "W-TR-09",
  "W-TR-10",
  "W-PF-01",
  "W-BR-01",
  "W-OP-01",
] as const satisfies readonly ScreenId[];

export type ConsoleScreenId = (typeof CONSOLE_SCREEN_IDS)[number];

/** States every screen may show while its data is not in yet, or when it failed. */
export const SHELL_STATES = ["loading", "error", "placeholder"] as const;
export type ShellState = (typeof SHELL_STATES)[number];

/** S1's `data-state` names per screen (S1.6–S1.8, S2.7 for the hold drawer). */
export const SCREEN_STATES = {
  "W-JG-01": [
    "ready",
    "session",
    "queued",
    "resetting",
    "session-ended",
    "reset-failed",
    "circuit",
    "balance-low",
    "ai-off",
    "paypal-off",
    "start-failed",
    "autoplay",
    "paused",
    "phone-visit",
  ],
  "W-AU-01": ["not-built"],
  "W-TR-01": [
    "unratified",
    "drafted",
    "draft-refused",
    "waiting",
    "unverified",
    "funded",
    "auto-cancelled",
    "offline",
  ],
  "W-TR-02": ["draft", "ratified", "proposal", "refused"],
  "W-TR-03": [
    "loading",
    "reading",
    "read",
    "confirm-one",
    "low-confidence",
    "blurred",
    "quarantined",
    "live-paused",
    "offline",
  ],
  "W-TR-04": ["empty", "typing", "match", "mismatch", "committed", "skipped"],
  "W-TR-05": ["loading", "empty", "ready", "declined"],
  "W-TR-06": ["open", "resolving", "resolved", "asked-chair", "conflict", "excluded"],
  "W-TR-07": [
    "blocked",
    "ready",
    "key1",
    "declined",
    "expired",
    "approved",
    "posting",
    "mismatch",
    "retrying",
    "denied",
    "killed",
  ],
  "W-TR-08": ["waiting", "parked", "denied", "done"],
  "W-TR-09": ["held", "ready", "paid", "cash-due", "cash-received", "parked", "request-open"],
  "W-TR-10": ["closed", "open"],
  "W-PF-01": ["none", "progress", "verified", "failed"],
  "W-BR-01": ["unpaid", "progress", "mismatch"],
  "W-OP-01": ["ready", "degraded"],
} as const satisfies Record<ConsoleScreenId, readonly string[]>;

export type ScreenState<S extends ConsoleScreenId> = (typeof SCREEN_STATES)[S][number] | ShellState;

/** Which parallel slice builds each screen (SPLIT.md). The shell owns W-AU-01 outright. */
export const SCREEN_SLICE = {
  "W-JG-01": "season",
  "W-AU-01": "shell",
  "W-TR-01": "season",
  "W-TR-02": "season",
  "W-TR-03": "season",
  "W-TR-04": "season",
  "W-TR-05": "runs",
  "W-TR-06": "runs",
  "W-TR-07": "runs",
  "W-TR-08": "runs",
  "W-TR-09": "runs",
  "W-TR-10": "proof",
  "W-PF-01": "proof",
  "W-BR-01": "proof",
  "W-OP-01": "proof",
} as const satisfies Record<ConsoleScreenId, "season" | "runs" | "proof" | "shell">;

/** `data-testid="{screenId}.{element}"` (register §4). The screen root itself is the bare ID. */
export function tid(screen: ConsoleScreenId, element?: string): string {
  return element === undefined ? screen : testId(screen, element);
}
