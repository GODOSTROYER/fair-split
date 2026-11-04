// The Verify press (W-PF-01): a person's own action, so it is its own evidence. The verifier chunk and the
// published keys load on the press; the result replaces "Checking" when the computation returns, never on a
// timer. A newer bundle (the record moved on: a later item notice, a cash receipt) makes a finished check stale.

import type { ProofBundle } from "@fairsplit/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdapter, useSnapshot } from "../../data/hooks.js";
import { recordProofChecks } from "../../lib/proof-checks.js";
import {
  headOf,
  loadPublishedKeys,
  loadServerPlate6,
  PLATES,
  runVerification,
  type VerifyInput,
  type VerifyOutcome,
} from "./verify.js";

export type VerifyState =
  | { readonly kind: "idle"; readonly stale: boolean }
  | { readonly kind: "checking"; readonly pressId: string }
  | { readonly kind: "done"; readonly outcome: VerifyOutcome; readonly at: string; readonly pressId: string }
  | { readonly kind: "error"; readonly error: unknown };

export interface Verification {
  readonly state: VerifyState;
  verify(): void;
}

/** Lets "Checking" paint before the hashing starts (a task boundary, not a delay). */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function useVerification(
  bundle: ProofBundle | null,
  runSlug: string,
  load?: VerifyInput["load"],
): Verification {
  const adapter = useAdapter();
  const snapshot = useSnapshot().data;
  const [state, setState] = useState<VerifyState>({ kind: "idle", stale: false });
  const generation = useRef(0);
  const head = bundle ? headOf(bundle) : null;

  useEffect(() => {
    setState((prev) =>
      prev.kind === "done" && head !== null && prev.outcome.head !== head
        ? { kind: "idle", stale: true }
        : prev,
    );
  }, [head]);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const verify = useCallback(() => {
    if (!bundle) return;
    generation.current += 1;
    const mine = generation.current;
    const pressId = `press:verify:${mine}`;
    setState({ kind: "checking", pressId });
    // Mock data only: when the mock publishes no keys, the seed's published sample keys stand in, labelled.
    const seed = adapter.source === "mock" ? (snapshot?.publishedKeys ?? null) : null;
    void yieldToPaint()
      .then(() =>
        runVerification({
          bundle,
          keys: () => loadPublishedKeys(adapter.api, runSlug, seed),
          server: () => loadServerPlate6(adapter.api, runSlug),
          ...(load ? { load } : {}),
        }),
      )
      .then((outcome) => {
        if (mine !== generation.current) return;
        setState({ kind: "done", outcome, at: new Date().toISOString(), pressId });
        // The stage's Proof counter counts these same six checks (UI gate round 3).
        recordProofChecks(
          runSlug,
          PLATES.filter((p) => ["matches", "server"].includes(outcome.checks[p].state)).length,
        );
      })
      .catch((error: unknown) => {
        if (mine !== generation.current) return;
        setState({ kind: "error", error });
      });
  }, [adapter, bundle, load, runSlug, snapshot]);

  return { state, verify };
}
