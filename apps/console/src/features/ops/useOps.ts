// /ops reads (W-OP-01): each read ends in a ReadOutcome and never throws, so a route the API hasn't shipped reads
// "not served yet" instead of breaking the page. Nothing polls: the page reads once, and again when a person asks.

import { PublishedKeys } from "@fairsplit/contracts";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import { useAdapter } from "../../data/hooks.js";
import { utf8 } from "../../lib/jcs.js";
import {
  ed25519Supported,
  type KeyStore,
  makeKey,
  memoryKeyStore,
  openKeyStore,
  type StoredKey,
  TREASURER_APPROVER,
  TREASURER_KEY_ID,
} from "../../lib/keystore.js";
import { toHex } from "../../lib/sha256.js";
import {
  classifyFailure,
  Healthz,
  OPS_PATHS,
  OutboxRead,
  OverviewWorkspaces,
  type ReadOutcome,
  Readyz,
  type RegisterKeyBody,
  registrationStatement,
  showcaseWorkspace,
} from "./opsModel.js";
import {
  BalanceRead,
  ClaudeRead,
  EvalRead,
  LatencyRead,
  LimiterRead,
  OpsSession,
  QuotasRead,
  ReconciliationRead,
  ScopesRead,
  SECTION_PATHS,
} from "./sections.js";

/** Every /ops read lives under this query key, so "Check again" asks each of them once more. */
const OPS_KEY = "ops";

export function useOpsRead<S extends z.ZodType>(name: string, path: string, schema: S) {
  const adapter = useAdapter();
  return useQuery<ReadOutcome<z.output<S>>>({
    queryKey: [OPS_KEY, name],
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

/** "Check again": every /ops read, once, on a person's press (nothing polls). */
export function useOpsRefresh() {
  const client = useQueryClient();
  const checking = useIsFetching({ queryKey: [OPS_KEY] }) > 0;
  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: [OPS_KEY] });
  }, [client]);
  return { checking, refresh };
}

export function useHealth() {
  const live = useOpsRead("healthz", OPS_PATHS.healthz, Healthz);
  const ready = useOpsRead("readyz", OPS_PATHS.readyz, Readyz);
  return {
    live: live.data,
    ready: ready.data,
    checkedAt: Math.max(live.dataUpdatedAt, ready.dataUpdatedAt) || null,
  };
}

export function useOutbox() {
  return useOpsRead("outbox", OPS_PATHS.outbox, OutboxRead);
}

/** The showcase workspace (the treasurer key's), from the operator's overview; null until it names one. */
export function useShowcaseWorkspace(): string | null {
  const read = useOpsRead("overview", OPS_PATHS.overview, OverviewWorkspaces).data;
  return read?.kind === "ok" ? showcaseWorkspace(read.data) : null;
}

/**
 * The registration fs-api's POST /v1/ops/keys takes: the key, the showcase workspace, and a proof of possession
 * (the new key's Ed25519 signature over the registration statement, made in this browser; its private half never
 * leaves WebCrypto).
 */
export async function registrationBody(
  key: StoredKey,
  workspaceId: string,
  at: string,
  subtle: SubtleCrypto,
): Promise<RegisterKeyBody> {
  const statement = {
    workspaceId,
    keyId: key.keyId,
    publicKeyHex: key.publicKeyHex,
    approverId: key.approverId,
  };
  const bytes = utf8(registrationStatement({ ...statement, at }));
  const signature = await subtle.sign({ name: "Ed25519" }, key.keys.privateKey, bytes as BufferSource);
  return { ...statement, proof: { at, signatureHex: toHex(new Uint8Array(signature)) } };
}

/**
 * Who is reading /ops. Only the operator's session (the `fs_ops` cookie from /ops/login, S3.8) makes or
 * registers the treasurer key; a judge, or anyone the API doesn't name as the operator, reads it. Until the API
 * serves the read, nobody is the operator here.
 */
export function useOperator(): {
  readonly operator: boolean;
  readonly outcome: ReadOutcome<OpsSession> | undefined;
} {
  const read = useOpsRead("session", SECTION_PATHS.session, OpsSession);
  const outcome = read.data;
  return { operator: outcome?.kind === "ok" && outcome.data.role === "operator", outcome };
}

/** The keys Fair Split publishes (Proof's trust anchors): whether fs-analyn-w1 is registered, for anyone. */
export function usePublishedKeys() {
  return useOpsRead("keys", SECTION_PATHS.keys, PublishedKeys).data;
}

export interface SectionOutcomes {
  readonly scopes: ReadOutcome<ScopesRead> | undefined;
  readonly limiter: ReadOutcome<LimiterRead> | undefined;
  readonly latency: ReadOutcome<LatencyRead> | undefined;
  readonly claude: ReadOutcome<ClaudeRead> | undefined;
  readonly eval: ReadOutcome<EvalRead> | undefined;
  readonly reconciliation: ReadOutcome<ReconciliationRead> | undefined;
  readonly balance: ReadOutcome<BalanceRead> | undefined;
  readonly quotas: ReadOutcome<QuotasRead> | undefined;
}

/** S3.15's sections, each read once from its own route. */
export function useSections(): SectionOutcomes {
  return {
    scopes: useOpsRead("scopes", SECTION_PATHS.scopes, ScopesRead).data,
    limiter: useOpsRead("limiter", SECTION_PATHS.limiter, LimiterRead).data,
    latency: useOpsRead("latency", SECTION_PATHS.latency, LatencyRead).data,
    claude: useOpsRead("claude", SECTION_PATHS.claude, ClaudeRead).data,
    eval: useOpsRead("eval", SECTION_PATHS.eval, EvalRead).data,
    reconciliation: useOpsRead("reconciliation", SECTION_PATHS.reconciliation, ReconciliationRead).data,
    balance: useOpsRead("balance", SECTION_PATHS.balance, BalanceRead).data,
    quotas: useOpsRead("quotas", SECTION_PATHS.quotas, QuotasRead).data,
  };
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
  /**
   * The operator's session only (default true). Off, nothing touches WebCrypto or IndexedDB in this browser and
   * make and register do nothing: a judge never makes a key named fs-analyn-w1 in their own browser.
   */
  readonly enabled?: boolean;
  /** The workspace the key is registered in (the showcase's, from the overview); none yet, registering fails. */
  readonly workspaceId?: string | null;
}

export function useTreasurerKey(options: TreasurerKeyOptions = {}): TreasurerKey {
  const adapter = useAdapter();
  const enabled = options.enabled ?? true;
  const workspaceRef = useRef(options.workspaceId ?? null);
  workspaceRef.current = options.workspaceId ?? null;
  const storeRef = useRef<KeyStore | null>(options.store ?? null);
  const subtle = options.subtle ?? globalThis.crypto?.subtle;
  const [phase, setPhase] = useState<KeyPhase>({ kind: "checking" });
  const [durable, setDurable] = useState(options.store?.durable ?? true);
  const alive = useRef(true);
  // The key store opens only for the operator, on first use.
  const store = useCallback((): KeyStore => {
    storeRef.current ??= openKeyStore();
    return storeRef.current;
  }, []);

  useEffect(() => {
    alive.current = true;
    if (!enabled) {
      return () => {
        alive.current = false;
      };
    }
    setDurable(store().durable);
    void (async () => {
      const supported = await ed25519Supported(subtle);
      if (!alive.current) return;
      if (!supported) {
        setPhase({ kind: "unsupported" });
        return;
      }
      let found: StoredKey | null = null;
      try {
        found = await store().get(TREASURER_KEY_ID);
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
  }, [subtle, enabled, store]);

  const make = useCallback(() => {
    if (!enabled) return;
    setPhase({ kind: "making" });
    void (async () => {
      try {
        const key = await makeKey(TREASURER_KEY_ID, TREASURER_APPROVER, undefined, subtle);
        try {
          await store().put(key);
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
  }, [subtle, enabled, store]);

  // The register press reads the phase it was pressed in (a ref, so the request is sent once, never from an updater).
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const register = useCallback(() => {
    const current = phaseRef.current;
    if (
      !enabled ||
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
        const workspaceId = workspaceRef.current;
        if (!workspaceId) {
          throw new Error("The showcase workspace isn't known yet: GET /v1/ops/overview didn't name one.");
        }
        if (!subtle) throw new Error("This browser has no WebCrypto.");
        await adapter.api.request({
          method: "POST",
          path: OPS_PATHS.registerKey,
          body: await registrationBody(key, workspaceId, new Date().toISOString(), subtle),
          name: "registerKey",
        });
        const registered: StoredKey = { ...key, registeredAt: new Date().toISOString() };
        await store()
          .put(registered)
          .catch(() => undefined);
        if (alive.current) setPhase({ kind: "registered", key: registered });
      } catch (error) {
        const outcome = classifyFailure(error, adapter.source, Date.now());
        if (!alive.current) return;
        if (outcome.kind === "not-served") setPhase({ kind: "not-served", key });
        else if (outcome.kind === "refused") setPhase({ kind: "refused", key });
        else setPhase({ kind: "failed", key, error });
      }
    })();
  }, [adapter, enabled, store, subtle]);

  return useMemo(() => ({ phase, durable, make, register }), [phase, durable, make, register]);
}
