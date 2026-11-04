// The top bar's Proof counter counts the same six checks Proof runs (UI gate round 3): "Proof 0/6" until this
// browser has checked the run's record, then how many matched ("6/6"). Proof's Verify press records its outcome
// here, per run, for this tab (and this tab's session storage, so a reload keeps it); a newer record (another
// notice, a cash receipt) makes it stale, and Proof says so itself. Nothing here is shared or sent anywhere.

import { useSyncExternalStore } from "react";

/** Proof's six checks (verify.ts PLATES). */
export const PROOF_CHECKS = 6;

export interface ProofChecks {
  /** Checks that matched in this browser (or that the server checked, where the tier withholds receivers). */
  readonly matched: number;
  readonly total: number;
  /** This browser has checked this run. */
  readonly checked: boolean;
}

const UNCHECKED: ProofChecks = { matched: 0, total: PROOF_CHECKS, checked: false };
const KEY = (runSlug: string) => `fs.proofChecks.${runSlug}`;
const memory = new Map<string, ProofChecks>();
const listeners = new Set<() => void>();

function readSession(runSlug: string): ProofChecks | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY(runSlug));
    if (!raw) return null;
    const matched = Number.parseInt(raw, 10);
    return Number.isInteger(matched) && matched >= 0 && matched <= PROOF_CHECKS
      ? { matched, total: PROOF_CHECKS, checked: true }
      : null;
  } catch {
    return null;
  }
}

/** Proof's Verify landed: `matched` of the six held in this browser. */
export function recordProofChecks(runSlug: string, matched: number): void {
  const next: ProofChecks = {
    matched: Math.max(0, Math.min(PROOF_CHECKS, matched)),
    total: PROOF_CHECKS,
    checked: true,
  };
  memory.set(runSlug, next);
  try {
    globalThis.sessionStorage?.setItem(KEY(runSlug), String(next.matched));
  } catch {
    // Blocked storage: the count holds for this page only.
  }
  for (const listener of listeners) listener();
}

/** Forgets every run's count (a Reset starts a fresh run; tests). */
export function clearProofChecks(): void {
  memory.clear();
  for (const listener of listeners) listener();
}

export function proofChecksFor(runSlug: string | null): ProofChecks {
  if (!runSlug) return UNCHECKED;
  const known = memory.get(runSlug);
  if (known) return known;
  const stored = readSession(runSlug);
  if (stored) memory.set(runSlug, stored);
  return stored ?? UNCHECKED;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The run's six checks as the counter reads them, live. */
export function useProofChecks(runSlug: string | null): ProofChecks {
  return useSyncExternalStore(
    subscribe,
    () => proofChecksFor(runSlug),
    () => UNCHECKED,
  );
}
