// /ops reads (W-OP-01): each read ends in a ReadOutcome and never throws, so a route the API hasn't shipped reads
// "not served yet" instead of breaking the page. Nothing polls: the page reads once, and again when a person asks.

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import { useAdapter } from "../../data/hooks.js";
import {
  ed25519Supported,
  type KeyStore,
  makeKey,
  memoryKeyStore,
  openKeyStore,
  type StoredKey,
  TREASURER_APPROVER,
  TREASURER_KEY_ID,
} from "./keystore.js";
import { classifyFailure, Healthz, OPS_PATHS, OutboxRead, type ReadOutcome, Readyz } from "./opsModel.js";

function useOpsRead<S extends z.ZodType>(name: string, path: string, schema: S) {
  const adapter = useAdapter();
  return useQuery<ReadOutcome<z.output<S>>>({
    queryKey: ["ops", name],
    queryFn: async () => {
      try {
        const data = await adapter.api.request({ path, schema, name });
        return { kind: "ok", data: data as z.output<S>, at: Date.now() };
      } catch (error) {
        return classifyFailure(error, adapter.source, Date.now());
      }
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function useHealth() {
  const live = useOpsRead("healthz", OPS_PATHS.healthz, Healthz);
  const ready = useOpsRead("readyz", OPS_PATHS.readyz, Readyz);
  const refetchLive = live.refetch;
  const refetchReady = ready.refetch;
  const refresh = useCallback(() => {
    void refetchLive();
    void refetchReady();
  }, [refetchLive, refetchReady]);
  return {
    live: live.data,
    ready: ready.data,
    checking: live.isFetching || ready.isFetching,
    checkedAt: Math.max(live.dataUpdatedAt, ready.dataUpdatedAt) || null,
    refresh,
  };
}

export function useOutbox() {
  return useOpsRead("outbox", OPS_PATHS.outbox, OutboxRead);
}

// ------------------------------------------------------------------------------------------------ the treasurer's key

export type KeyPhase =
  | { readonly kind: "checking" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "none" }
  | { readonly kind: "making" }
  | { readonly kind: "made"; readonly key: StoredKey }
  | { readonly kind: "registering"; readonly key: StoredKey }
  | { readonly kind: "registered"; readonly key: StoredKey }
  /** The ops slice hasn't shipped the registration route yet: the key stays in this browser, unregistered. */
  | { readonly kind: "not-served"; readonly key: StoredKey }
  /** Only the operator registers keys (S3.8). */
  | { readonly kind: "refused"; readonly key: StoredKey }
  | { readonly kind: "failed"; readonly key: StoredKey | null; readonly error: unknown };

export interface TreasurerKey {
  readonly phase: KeyPhase;
  /** False when the key lives for this page only (no IndexedDB here). */
  readonly durable: boolean;
  make(): void;
  register(): void;
}

export interface TreasurerKeyOptions {
  /** Injected in tests: the store and WebCrypto underneath. */
  readonly store?: KeyStore;
  readonly subtle?: SubtleCrypto;
}

export function useTreasurerKey(options: TreasurerKeyOptions = {}): TreasurerKey {
  const adapter = useAdapter();
  const storeRef = useRef<KeyStore>(options.store ?? openKeyStore());
  const subtle = options.subtle ?? globalThis.crypto?.subtle;
  const [phase, setPhase] = useState<KeyPhase>({ kind: "checking" });
  const [durable, setDurable] = useState(storeRef.current.durable);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void (async () => {
      const supported = await ed25519Supported(subtle);
      if (!alive.current) return;
      if (!supported) {
        setPhase({ kind: "unsupported" });
        return;
      }
      let found: StoredKey | null = null;
      try {
        found = await storeRef.current.get(TREASURER_KEY_ID);
      } catch {
        // IndexedDB refused (a private window): keep the key for this page only.
        storeRef.current = memoryKeyStore();
        setDurable(false);
      }
      if (!alive.current) return;
      setPhase(
        found
          ? found.registeredAt
            ? { kind: "registered", key: found }
            : { kind: "made", key: found }
          : { kind: "none" },
      );
    })();
    return () => {
      alive.current = false;
    };
  }, [subtle]);

  const make = useCallback(() => {
    setPhase({ kind: "making" });
    void (async () => {
      try {
        const key = await makeKey(TREASURER_KEY_ID, TREASURER_APPROVER, undefined, subtle);
        try {
          await storeRef.current.put(key);
        } catch {
          storeRef.current = memoryKeyStore();
          await storeRef.current.put(key);
          if (alive.current) setDurable(false);
        }
        if (alive.current) setPhase({ kind: "made", key });
      } catch (error) {
        if (alive.current) setPhase({ kind: "failed", key: null, error });
      }
    })();
  }, [subtle]);

  // The register press reads the phase it was pressed in (a ref, so the request is sent once, never from an updater).
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const register = useCallback(() => {
    const current = phaseRef.current;
    if (
      !("key" in current) ||
      !current.key ||
      current.kind === "registering" ||
      current.kind === "registered"
    )
      return;
    const key = current.key;
    setPhase({ kind: "registering", key });
    void (async () => {
      try {
        await adapter.api.request({
          method: "POST",
          path: OPS_PATHS.registerKey,
          body: {
            keyId: key.keyId,
            approverId: key.approverId,
            role: "treasurer",
            publicKeyHex: key.publicKeyHex,
          },
          name: "registerKey",
        });
        const registered: StoredKey = { ...key, registeredAt: new Date().toISOString() };
        await storeRef.current.put(registered).catch(() => undefined);
        if (alive.current) setPhase({ kind: "registered", key: registered });
      } catch (error) {
        const outcome = classifyFailure(error, adapter.source, Date.now());
        if (!alive.current) return;
        if (outcome.kind === "not-served") setPhase({ kind: "not-served", key });
        else if (outcome.kind === "refused") setPhase({ kind: "refused", key });
        else setPhase({ kind: "failed", key, error });
      }
    })();
  }, [adapter]);

  return useMemo(() => ({ phase, durable, make, register }), [phase, durable, make, register]);
}
